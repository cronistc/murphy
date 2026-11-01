// O orquestrador: o escritório em si. Guarda a equipe, as conversas e o diário;
// contrata, distribui tarefas, integra o trabalho, abre e fecha o expediente,
// e publica todos os eventos. O servidor HTTP é só a porta de entrada.
//
// Princípios (documento da ideia): trabalho é real, vida é livre; limitações
// viram mundo (cota → almoço, compactação → banheiro, carga → calor);
// nunca mentir sobre o trabalho; tudo pode ser desfeito; sentimentos mudam o
// humor e a iniciativa, nunca a qualidade.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Sessao, encurtar, type Decisao, type PedidoPermissao } from './sessao.ts';
import { Escritorio, slug } from './escritorio.ts';
import { registrar } from './log.ts';
import { carregar, salvar, hoje, PASTA_DADOS, type Estado, type Pendente } from './estado.ts';
import { CARGOS, candidatos, area, tituloDoChefe, tituloDe, fichaDe, type Candidato } from './candidatos.ts';
import { Persona } from './persona.ts';
import type { Agenda, Cargo, Evento, Funcionario } from './eventos.ts';

const PASTA_PROJETOS = path.join(os.homedir(), 'escritorio-projetos');
const CARGOS_CONTRATAVEIS = Object.keys(CARGOS).filter((c) => c !== 'chefe');
const MAX_PERSONAS_LIGADAS = 6;
// Ferramentas do escritório sempre visíveis para o modelo (sem precisar de
// ToolSearch); sem isso, quem não "procura" a ferramenta acha que ela não existe.
const SEMPRE = { alwaysLoad: true };
// Fala de gente não tem markdown: tira negrito, títulos, marcadores e crases.
export function semMarcacao(t: string) {
  return t
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

type Registro = {
  sessao: Sessao;
  estado: 'rodando' | 'terminada';
  funcionario?: string;
  projeto?: string;
  delegadoPor?: string;
  tarefa: string;
  fim?: Promise<void>;
  conversa?: boolean; // conversa (só leitura), não trabalho
  interno?: boolean; // bastidores (agenda do dia): não aparece na sala
  mesaDe?: string; // de quem é a mesa onde está trabalhando
  autoAprovar?: boolean;
};

export class Orquestrador extends EventEmitter {
  estado: Estado = carregar();
  readonly sessoes = new Map<string, Registro>();
  readonly pendentes = new Map<string, { sessao: string; pedido: PedidoPermissao; responder: (d: Decisao) => void }>();
  readonly contratacoes = new Map<string, { cargo: Cargo; motivo: string; pedidoPor: string }>();
  almocoAte: string | null = null;
  encerrando = false;
  private pastaLogs: string;
  private filas = new Map<string, string[]>(); // conversas esperando resposta, por funcionário
  private conversando = new Set<string>();
  private avisadoOcupado = new Set<string>();
  private recados: string[] = [];
  private filaAlmoco: (() => void)[] = [];
  private seguidas = new Map<string, { n: number; ultima: number }>();
  private gerandoAgenda = false;
  private relogioMaquina?: NodeJS.Timeout;

  constructor(opcoes: { pastaLogs: string; aprovarTudo?: boolean }) {
    super();
    this.pastaLogs = opcoes.pastaLogs;
    if (opcoes.aprovarTudo) this.estado.aprovarTudo = true;
  }

  get aprovarTudo() {
    return this.estado.aprovarTudo;
  }

  // ---------- eventos e estado ----------
  private publicar(ev: Evento) {
    this.emit('evento', ev);
  }
  private doEscritorio(dados: Record<string, unknown>) {
    this.publicar({ sessao: 'escritorio', em: new Date().toISOString(), ...dados } as Evento);
  }
  private salvar() {
    salvar(this.estado);
  }
  private diario(quem: string, texto: string) {
    this.estado.diario.push({ data: hoje(), quem, texto, em: new Date().toISOString() });
    this.salvar();
  }
  get chefe(): Funcionario | undefined {
    return this.estado.equipe.find((f) => f.cargo === 'chefe');
  }
  funcionario(id: string): Funcionario | undefined {
    return this.estado.equipe.find((x) => x.id === slug(id) || slug(x.nome) === slug(id));
  }
  private escritorio(): Escritorio {
    if (!this.estado.projeto) throw new Error('nenhum projeto aberto ainda');
    return Escritorio.abrir(this.estado.projeto.pasta);
  }
  // Qualquer sessão (trabalho ou conversa): o personagem está ocupado.
  ocupado(id: string) {
    return [...this.sessoes.values()].some((r) => r.estado === 'rodando' && r.funcionario === id);
  }
  // Trabalho de verdade (não conversa).
  trabalhando(id: string) {
    return [...this.sessoes.values()].some((r) => r.estado === 'rodando' && r.funcionario === id && !r.conversa);
  }
  private mesaEmUso(id: string) {
    return [...this.sessoes.values()].some((r) => r.estado === 'rodando' && !r.conversa && r.mesaDe === id);
  }
  // A equipe como a tela vê: com o título no gênero de cada um.
  equipePublica() {
    return this.estado.equipe.map((f) => ({ ...f, titulo: tituloDe(f) }));
  }
  private equipeMudou(motivo: string) {
    this.salvar();
    this.doEscritorio({ tipo: 'equipe', equipe: this.equipePublica(), motivo });
  }

  // ---------- expediente ----------
  // Abre quando o app abre: o chefe chega, a equipe chega, daily, e quem parou
  // no meio de uma tarefa ontem continua de onde parou.
  abertoEm: Date | null = null;
  abrirExpediente() {
    this.abertoEm = new Date();
    this.iniciarVida();
    this.iniciarMaquina();
    if (!this.estado.boasVindas) return;
    const luzCaiu = this.estado.aberto;
    this.estado.aberto = true;
    this.encerrando = false;
    this.salvar();
    this.doEscritorio({ tipo: 'equipe', equipe: this.equipePublica(), motivo: 'chegada' });
    this.doEscritorio({ tipo: 'expediente', fase: 'aberto', luzCaiu, daily: this.textoDaily(luzCaiu) });
    const md = hoje().slice(5);
    for (const f of this.estado.equipe) {
      if (!f.ferias && f.aniversario === md) {
        this.doEscritorio({ tipo: 'aniversario', funcionario: f.id });
        this.ajustarHumor(f.id, 10, 'aniversário');
      }
    }
    // O chefe lê o diário de ontem (vai junto com o primeiro assunto do dia).
    const anterior = this.estado.diario.filter((d) => d.data !== hoje()).slice(-15);
    if (anterior.length) {
      this.recados.push(
        `[Aviso do escritório] Diário do último expediente:\n${anterior.map((d) => `- ${this.nomeDe(d.quem)}: ${d.texto}`).join('\n')}` +
          (luzCaiu ? '\nO app fechou de repente ("a luz caiu"); o que estava pela metade será retomado.' : ''),
      );
    }
    setTimeout(() => this.retomarPendentes(), 15000).unref();
    setTimeout(() => this.gerarAgenda().catch(() => {}), 4000).unref();
    this.aquecerPersonas();
    // Persona parada há muito tempo desliga (economiza memória); religa ao conversar.
    clearInterval(this.relogioPersonas);
    this.relogioPersonas = setInterval(() => {
      for (const [id, p] of this.personas) {
        if (id !== this.chefe?.id && p.vivo && !p.ocupada && Date.now() - p.ultimoUso > 20 * 60_000) {
          p.desligar();
          this.personas.delete(id);
        }
      }
    }, 60_000);
    this.relogioPersonas.unref();
  }

  private textoDaily(luzCaiu: boolean): string {
    const dias = [...new Set(this.estado.diario.map((d) => d.data))].filter((d) => d !== hoje());
    const ultimo = dias[dias.length - 1];
    const entregas = this.estado.diario.filter((d) => d.data === ultimo && d.texto.startsWith('Entregou')).length;
    const pend = this.estado.pendentes.length;
    const partes = ['Bom dia, pessoal!'];
    if (luzCaiu) partes.push('Ontem a luz caiu, mas ninguém perdeu nada.');
    if (entregas) partes.push(`No último expediente entregamos ${entregas} ${entregas === 1 ? 'tarefa' : 'tarefas'}.`);
    if (pend) partes.push(`Hoje retomamos ${pend} ${pend === 1 ? 'tarefa que ficou' : 'tarefas que ficaram'} pela metade.`);
    else partes.push('Bora trabalhar!');
    return partes.join(' ');
  }

  // Fecha quando o app fecha: cada um salva o que estava fazendo (commit na
  // própria branch), o diário anota onde parou, o chefe faz o resumo do dia.
  async encerrarExpediente(): Promise<string> {
    if (this.encerrando) return 'já encerrando';
    this.encerrando = true;
    this.doEscritorio({ tipo: 'expediente', fase: 'encerrando' });
    const rodando = [...this.sessoes.values()].filter((r) => r.estado === 'rodando');
    for (const r of rodando) r.sessao.parar();
    await Promise.race([Promise.all(rodando.map((r) => r.fim)), espera(6000)]);
    if (this.estado.projeto) {
      try {
        const esc = this.escritorio();
        for (const m of esc.mesas()) {
          if (esc.salvarMesa(m, this.nomeDe(m.funcionario))) this.diario(m.funcionario, 'Salvou o trabalho em andamento (commit na própria mesa).');
        }
      } catch {}
    }
    for (const p of this.estado.pendentes) this.diario(p.funcionario, `Parou no meio de: ${encurtar(p.tarefa, 160)}`);
    const entregas = this.estado.diario.filter((d) => d.data === hoje() && d.texto.startsWith('Entregou')).length;
    const pend = this.estado.pendentes.length;
    const resumo =
      `Fim do expediente. Hoje ${entregas ? `entregamos ${entregas} ${entregas === 1 ? 'tarefa' : 'tarefas'}` : 'não houve entregas'}` +
      (pend ? ` e ${pend} ${pend === 1 ? 'ficou' : 'ficaram'} para amanhã` : '') +
      '. Luzes apagadas, porta trancada. Até amanhã!';
    if (this.chefe) this.diario(this.chefe.id, resumo);
    this.estado.aberto = false;
    this.salvar();
    this.doEscritorio({ tipo: 'expediente', fase: 'encerrado', resumo });
    this.desligarPersonas();
    clearInterval(this.relogioPersonas);
    clearInterval(this.relogioMaquina);
    return resumo;
  }

  private retomarPendentes() {
    if (this.encerrando) return;
    const lista = this.estado.pendentes.splice(0);
    this.salvar();
    for (const p of lista) {
      const f = this.funcionario(p.funcionario);
      if (!f || f.ferias) {
        this.diario(p.funcionario, `Tarefa interrompida não retomada (${f ? 'de férias' : 'não está mais na equipe'}): ${encurtar(p.tarefa, 120)}`);
        continue;
      }
      try {
        this.tarefa(f.id, p.tarefa, p.delegadoPor, { retomar: p.sessaoCli, continuar: true, local: p.local });
      } catch (e) {
        this.diario(f.id, `Não consegui retomar: ${(e as Error).message}`);
      }
    }
  }

  // ---------- primeira abertura ----------
  // Você cria o escritório (nome + área). Entra só você e o seu parceiro, o
  // chefe da área, que te entrevista, monta o relatório e recomenda a equipe.
  boasVindas({ escritorio, area: idArea, projeto, descricao = '', pasta }: { escritorio?: string; area?: string; projeto?: string; nome?: string; descricao?: string; pasta?: string } & Record<string, any>) {
    const nomeEscritorio = String(escritorio ?? arguments[0]?.nome ?? '').trim();
    if (!nomeEscritorio) throw new Error('dê um nome ao escritório');
    const a = area(idArea);
    const nomeProjeto = String(projeto ?? '').trim() || nomeEscritorio;
    let destino = path.resolve((pasta?.trim() || path.join(PASTA_PROJETOS, slug(nomeProjeto))).replace(/^~(?=\/|$)/, os.homedir()));
    // Escritório novo, pasta nova: não reaproveita o projeto de um escritório anterior com o mesmo nome.
    if (!pasta?.trim()) for (let n = 2; fs.existsSync(destino) && fs.readdirSync(destino).length; n++) destino = path.join(PASTA_PROJETOS, `${slug(nomeProjeto)}-${n}`);
    Escritorio.abrir(destino); // valida e cria o repositório
    this.estado.escritorio = { nome: nomeEscritorio, area: a.id };
    this.estado.projeto = { nome: nomeProjeto, pasta: destino, descricao: descricao.trim() };
    this.estado.fase = 'entrevista';
    this.estado.relatorio = {};
    if (!this.chefe) {
      const c = candidatos('chefe', [])[0];
      this.admitir({ ...c, titulo: tituloDoChefe(a.id) });
    }
    this.estado.boasVindas = true;
    this.estado.aberto = true;
    this.salvar();
    const chefe = this.chefe!;
    this.equipeMudou('chegada');
    this.doEscritorio({ tipo: 'expediente', fase: 'aberto', luzCaiu: false, daily: `Bem-vindo ao ${nomeEscritorio}!` });
    this.mensagem(
      chefe.id,
      'voce',
      `Oi! Eu sou ${chefe.nome}, ${chefe.genero === 'f' ? 'a' : 'o'} ${tituloDe(chefe).toLowerCase()} do ${nomeEscritorio}. ` +
        'Antes de contratar alguém, quero entender direitinho o que a gente vai fazer. Me conta: o escritório vai trabalhar com o quê, e pra quem?',
    );
    this.aquecerPersonas();
    setTimeout(() => this.gerarAgenda().catch(() => {}), 2000).unref();
  }

  // ---------- equipe: contratar, férias, demitir, humor ----------
  candidatos(cargo: Cargo): Candidato[] {
    if (!CARGOS_CONTRATAVEIS.includes(cargo)) throw new Error('cargo inválido');
    return candidatos(cargo, this.estado.equipe.map((f) => f.nome));
  }

  private admitir(c: Pick<Candidato, 'nome' | 'cargo' | 'modelo' | 'personalidade'> & Partial<Candidato>): Funcionario {
    const f: Funcionario = {
      id: slug(c.nome),
      nome: c.nome,
      cargo: c.cargo,
      modelo: c.modelo,
      personalidade: c.personalidade,
      contratadoEm: new Date().toISOString(),
      humor: c.humor ?? 75,
      aniversario: c.aniversario,
      genero: c.genero,
      ficha: c.ficha ?? fichaDe(c.nome),
      ...(c.titulo && c.cargo === 'chefe' ? { titulo: c.titulo } : {}),
    };
    this.estado.equipe.push(f);
    // A personalidade já liga na contratação: a primeira conversa sai rápida.
    if (this.estado.boasVindas) setTimeout(() => this.personaDe(f).ligar(), 500).unref();
    // Quem chega no meio do dia também ganha a "vida de hoje" (agenda refeita, uma vez só).
    clearTimeout(this.agendaNovatos);
    if (this.estado.boasVindas) this.agendaNovatos = setTimeout(() => this.gerarAgenda(true).catch(() => {}), 90_000);
    return f;
  }

  contratar(nome: string, cargo: Cargo): Funcionario {
    const c = this.candidatos(cargo).find((x) => x.nome === nome);
    if (!c) throw new Error(`${nome} não está entre os candidatos de ${CARGOS[cargo]?.titulo ?? cargo}`);
    const f = this.admitir(c);
    this.equipeMudou(`contratou ${f.nome}`);
    this.diario('voce', `Contratou ${f.nome} (${CARGOS[cargo].titulo}).`);
    this.comecarOperacao();
    this.recados.push(`[Aviso do escritório] O gestor contratou ${f.nome} (${CARGOS[cargo].titulo}, id "${f.id}"). Já pode delegar.`);
    return f;
  }

  responderContratacao(idPedido: string, aprovar: boolean): Funcionario | undefined {
    const p = this.contratacoes.get(idPedido);
    if (!p) throw new Error('pedido não encontrado ou já respondido');
    this.contratacoes.delete(idPedido);
    let f: Funcionario | undefined;
    if (aprovar) {
      f = this.admitir(this.candidatos(p.cargo)[0]);
      this.equipeMudou(`contratou ${f.nome}`);
      this.comecarOperacao();
      this.diario('voce', `Aprovou a contratação de ${f.nome} (${CARGOS[p.cargo].titulo}).`);
    }
    this.doEscritorio({ tipo: 'contratacao_respondida', idPedido, aprovada: aprovar, contratado: f?.nome });
    this.avisarChefe(
      aprovar
        ? `[Aviso do escritório] O gestor aprovou a contratação: ${f!.nome} (${CARGOS[p.cargo].titulo}, id "${f!.id}") chegou. Delegue o que tinha planejado.`
        : `[Aviso do escritório] O gestor não aprovou a contratação de ${CARGOS[p.cargo].titulo}. Siga com a equipe atual.`,
      true,
    );
    return f;
  }

  definirFerias(id: string, ferias: boolean) {
    const f = this.funcionario(id);
    if (!f || f.cargo === 'chefe') throw new Error('só funcionários (não o chefe) tiram férias');
    if (ferias && this.trabalhando(f.id)) throw new Error(`${f.nome} está no meio de uma tarefa`);
    f.ferias = ferias;
    if (!ferias) this.ajustarHumor(f.id, 15, 'voltou descansado das férias', false);
    this.equipeMudou(ferias ? `${f.nome} saiu de férias` : `${f.nome} voltou das férias`);
    this.diario(f.id, ferias ? 'Saiu de férias.' : 'Voltou das férias.');
    this.recados.push(`[Aviso do escritório] ${f.nome} ${ferias ? 'saiu de férias (não delegue para ele/ela)' : 'voltou das férias'}.`);
  }

  demitir(id: string) {
    const f = this.funcionario(id);
    if (!f || f.cargo === 'chefe') throw new Error('não dá para demitir o chefe');
    if (this.trabalhando(f.id)) throw new Error(`${f.nome} está no meio de uma tarefa`);
    this.estado.equipe = this.estado.equipe.filter((x) => x.id !== f.id);
    this.estado.pendentes = this.estado.pendentes.filter((p) => p.funcionario !== f.id);
    this.equipeMudou(`${f.nome} foi desligado`);
    this.diario('voce', `Desligou ${f.nome}. O trabalho dele/dela continua na branch mesa/${f.id}.`);
    this.recados.push(`[Aviso do escritório] ${f.nome} não faz mais parte da equipe.`);
  }

  ajustarHumor(id: string, delta: number, motivo: string, salvarAgora = true) {
    const f = this.funcionario(id);
    if (!f) return;
    f.humor = Math.max(0, Math.min(100, Math.round((f.humor ?? 70) + delta)));
    if (salvarAgora) this.salvar();
    this.doEscritorio({ tipo: 'humor', funcionario: f.id, humor: f.humor, motivo });
  }

  // Tratamento muda humor e iniciativa, nunca a qualidade (princípio 8).
  private reagirAoTratamento(f: Funcionario, texto: string) {
    if (/\b(obrigad|valeu|parab[eé]ns|[oó]tim|excelente|mandou bem|incr[ií]vel|perfeit|bom trabalho|adorei|show|maravilh|genial)/i.test(texto)) {
      this.ajustarHumor(f.id, 12, 'elogio do gestor');
    } else if (/\b(burr|in[uú]til|lixo|horr[ií]vel|p[eé]ssim|incompetente|idiota|porcaria|merda|imbecil|ruim demais)/i.test(texto)) {
      this.ajustarHumor(f.id, -15, 'bronca do gestor');
    }
  }

  nomeDe(id: string) {
    if (id === 'voce') return 'Você';
    return this.funcionario(id)?.nome ?? id;
  }

  // ---------- trabalho ----------
  // Uma tarefa para um funcionário, na mesa dele (ou na de outro, no caso do
  // T.I.). Ao terminar, o trabalho entra na branch principal.
  tarefa(id: string, tarefa: string, delegadoPor: string, opts: { retomar?: string; continuar?: boolean; local?: string } = {}): string {
    const f = this.funcionario(id);
    if (!f) throw new Error(`não há ninguém chamado "${id}" na equipe`);
    if (f.cargo === 'chefe') throw new Error('o chefe não executa tarefas; converse com ele');
    if (f.ferias) throw new Error(`${f.nome} está de férias`);
    if (this.encerrando) throw new Error('o expediente está acabando');
    const local = opts.local ? this.funcionario(opts.local)?.id ?? slug(opts.local) : f.id;
    if (this.trabalhando(f.id)) throw new Error(`${f.nome} já está trabalhando numa tarefa`);
    if (this.mesaEmUso(local)) throw new Error(`a mesa de ${this.nomeDe(local)} está em uso agora`);
    if (local !== f.id && this.trabalhando(local)) throw new Error(`${this.nomeDe(local)} está trabalhando nessa mesa agora`);
    if (this.almocoAte) {
      this.filaAlmoco.push(() => this.tarefa(f.id, tarefa, delegadoPor, opts));
      this.doEscritorio({ tipo: 'tarefa_delegada', de: delegadoPor, para: f.id, tarefa: `(na fila até a volta do almoço) ${tarefa}`, local });
      return 'na-fila';
    }

    const esc = this.escritorio();
    const mesa = esc.mesa(local);
    const atualizada = esc.atualizarMesa(mesa);
    if (!atualizada.ok) this.doEscritorio({ tipo: 'integracao', funcionario: f.id, ok: false, mensagem: atualizada.mensagem });
    this.doEscritorio({ tipo: 'tarefa_delegada', de: delegadoPor, para: f.id, tarefa, local });

    const pend: Pendente = { funcionario: f.id, tarefa, delegadoPor, ...(opts.local ? { local } : {}) };
    this.estado.pendentes.push(pend);
    this.salvar();

    const oficio = CARGOS[f.cargo].oficio;
    const instrucoes = [
      esc.instrucoes(mesa),
      local !== f.id ? `Atenção: esta é a mesa de ${this.nomeDe(local)}; você veio ajudar. Mexa só no necessário.` : '',
      oficio ? `\nGuia do ofício (${CARGOS[f.cargo].titulo}):\n${oficio}` : '',
      this.estado.internet ? '' : '\nA internet do escritório está desligada: não pesquise nem acesse sites.',
      '\nAutonomia: você não precisa de permissão para trabalhar. Criar, editar e apagar arquivos, rodar comandos no terminal, instalar dependências e pesquisar dentro da pasta do projeto são liberados: faça.',
      'Mudança grande ou arriscada (repaginar tudo, mudar a arquitetura, reiniciar ou derrubar servidor, apagar muita coisa, publicar/deploy): antes, peça aval ao chefe com pedir_aval_do_chefe. Ele decide.',
      'Só o que é do gestor (o dono) passa por ele, via pedir_acesso (o chefe leva o pedido): login ou senha de uma conta, pagamento. Nunca invente credenciais.',
      'Precisa de alguém da equipe (uma dúvida, combinar algo, pedir ajuda)? Use falar_com_colega: é conversa de verdade, a resposta volta para você.',
      'Se algo deve chegar na mão do gestor (documento, imagem, planilha, prévia), use compartilhar_com_gestor: vai para o Drive da empresa com um nome claro para um leigo. Isso não muda o projeto, que continua bem feito e organizado do jeito técnico certo.',
      'Sua última mensagem vira o seu relatório para o gestor: em português claro, diga o que fez, onde está, como conferir (com a evidência real) e o que falta.',
      `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
    ].filter(Boolean).join('\n');
    const prompt = opts.continuar
      ? `O expediente anterior terminou no meio desta tarefa. O que estava pela metade foi salvo num commit na sua branch. Continue de onde parou e conclua.\n\nTarefa original:\n${tarefa}`
      : tarefa;

    const sessao = this.novaSessao(
      {
        ...mesa,
        funcionario: f.id,
        tarefa: prompt,
        modelo: f.modelo,
        instrucoes,
        retomar: opts.retomar,
        mcpServers: { escritorio: this.ferramentasDaTarefa(f, mesa.pasta) },
        ferramentasLiberadas: ['mcp__escritorio__falar_com_colega', 'mcp__escritorio__pedir_aval_do_chefe', 'mcp__escritorio__pedir_acesso', 'mcp__escritorio__esperar_resposta', 'mcp__escritorio__compartilhar_com_gestor'],
        ...(this.estado.internet ? {} : { ferramentasProibidas: ['WebFetch', 'WebSearch'] }),
      },
      { funcionario: f.id, projeto: esc.projeto, delegadoPor, tarefa, mesaDe: local },
    );
    let falhouRetomar = false;
    sessao.on('evento', (ev: Evento) => {
      if (ev.tipo === 'cli_pronta') {
        pend.sessaoCli = ev.sessionIdCli;
        f.ultimaSessao = ev.sessionIdCli;
        this.salvar();
      }
      if (ev.tipo !== 'tarefa_terminada' && ev.tipo !== 'erro') return;
      if (this.encerrando) return; // fica pendente para amanhã
      // A sessão salva pode não existir mais: recomeça a tarefa do zero.
      if (opts.retomar && ev.tipo === 'erro' && !falhouRetomar) {
        falhouRetomar = true;
        this.estado.pendentes = this.estado.pendentes.filter((p) => p !== pend);
        this.salvar();
        setTimeout(() => {
          try {
            this.tarefa(f.id, tarefa, delegadoPor, { continuar: true, local: opts.local });
          } catch {}
        }, 500);
        return;
      }
      this.estado.pendentes = this.estado.pendentes.filter((p) => p !== pend);
      const sucesso = ev.tipo === 'tarefa_terminada' && ev.sucesso;
      const integ = esc.integrar(mesa, f.nome);
      this.doEscritorio({ tipo: 'integracao', funcionario: f.id, ...integ });
      this.diario(f.id, `${sucesso ? 'Entregou' : 'Não terminou'}: ${encurtar(tarefa, 160)}${integ.commits ? ` (${integ.mensagem})` : ''}`);
      try {
        this.relatorioDaTarefa(f, tarefa, sucesso, ev.tipo === 'tarefa_terminada' ? ev.resultado ?? '' : `Erro: ${ev.mensagem}`, integ.mensagem);
      } catch {}
      // pedidos de acesso sem resposta morrem com a tarefa
      for (const a of [...this.acessos.values()]) if (a.funcionario === f.id) { this.acessos.delete(a.idPedido); this.doEscritorio({ tipo: 'acesso_respondido', idPedido: a.idPedido, funcionario: a.funcionario, ...(a.chefe ? { chefe: a.chefe } : {}), aprovado: false }); }
      this.ajustarHumor(f.id, sucesso ? 4 : -6, sucesso ? 'entregou uma tarefa' : 'a tarefa não deu certo');
      // Muita tarefa seguida sem respiro cansa (excesso de trabalho).
      const s = this.seguidas.get(f.id) ?? { n: 0, ultima: 0 };
      s.n = Date.now() - s.ultima > 10 * 60_000 ? 1 : s.n + 1;
      s.ultima = Date.now();
      this.seguidas.set(f.id, s);
      if (s.n >= 4) this.ajustarHumor(f.id, -4, 'muitas tarefas seguidas');
      if (delegadoPor === this.chefe?.id) {
        const resultado = ev.tipo === 'tarefa_terminada' ? ev.resultado ?? '(sem relato)' : `erro: ${ev.mensagem}`;
        this.avisarChefe(
          `[Aviso do escritório] ${f.nome} (${CARGOS[f.cargo].titulo}) terminou a tarefa "${encurtar(tarefa, 120)}" ` +
            `(${sucesso ? 'sucesso' : 'falhou'}). Integração: ${integ.mensagem}.\nRelato de ${f.nome}:\n${encurtar(resultado, 3000)}\n\n` +
            'Avalie. Se fizer sentido, peça revisão (sênior revisa júnior; QA tenta quebrar) ou chame o T.I. para problema de ambiente. ' +
            'Conte ao gestor em poucas frases e delegue a próxima etapa.',
          true,
        );
      }
    });
    return sessao.id;
  }

  // Sessão avulsa numa pasta ou mesa (API de baixo nível e demos).
  sessaoLivre(p: { pasta?: string; projeto?: string; funcionario?: string; tarefa: string; modelo?: string }): string {
    if (p.projeto && p.funcionario) {
      const esc = Escritorio.abrir(p.projeto);
      const nome = slug(p.funcionario);
      if ([...this.sessoes.values()].some((r) => r.estado === 'rodando' && r.funcionario === nome && r.projeto === esc.projeto)) {
        throw new Error(`${nome} já está trabalhando numa tarefa; espere terminar`);
      }
      const m = esc.mesa(nome);
      return this.novaSessao({ ...m, tarefa: p.tarefa, modelo: p.modelo, instrucoes: esc.instrucoes(m) }, { funcionario: nome, projeto: esc.projeto, tarefa: p.tarefa }).id;
    }
    if (!p.pasta) throw new Error('informe projeto + funcionario, ou pasta');
    return this.novaSessao({ pasta: p.pasta, tarefa: p.tarefa, modelo: p.modelo }, { tarefa: p.tarefa }).id;
  }

  private novaSessao(opcoes: Omit<ConstructorParameters<typeof Sessao>[0], 'decidirPermissao'>, reg: Omit<Registro, 'sessao' | 'estado'>): Sessao {
    // Autonomia: tudo dentro da pasta do projeto é liberado sem perguntar
    // (a Sessao nega o que sai dela). O que só o gestor pode dar (login de uma
    // conta, pagamento, publicar em nome dele) vem por pedir_acesso, pelo chefe.
    const sessao: Sessao = new Sessao({ ...opcoes });
    registrar(sessao, this.pastaLogs);
    sessao.on('evento', (ev: Evento) => {
      if (ev.tipo === 'cota') this.verCota(ev);
      if (!reg.interno) this.publicar(ev);
    });
    const registro: Registro = { sessao, estado: 'rodando', ...reg };
    this.sessoes.set(sessao.id, registro);
    registro.fim = sessao.rodar().finally(() => {
      registro.estado = 'terminada';
      // Pedidos de permissão sem resposta morrem com a sessão.
      for (const [id, p] of this.pendentes) if (p.sessao === sessao.id) this.pendentes.delete(id);
    });
    return sessao;
  }

  // ---------- pedidos de acesso: só o que é do gestor (contas, senhas, pagamento) ----------
  readonly acessos = new Map<string, { idPedido: string; funcionario: string; chefe?: string; oque: string; porque: string; em: string }>();
  private respostasAcesso = new Map<string, string>();
  private esperandoAcesso = new Map<string, ((r: string) => void)[]>();
  private esperarAcesso(id: string, ms = 10 * 60_000): Promise<string> {
    const pronta = this.respostasAcesso.get(id);
    if (pronta) return Promise.resolve(pronta);
    if (!this.acessos.has(id)) return Promise.resolve('Esse pedido não existe mais.');
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        this.esperandoAcesso.set(id, (this.esperandoAcesso.get(id) ?? []).filter((x) => x !== fim));
        resolve(`O gestor ainda não respondeu (pedido ${id}); o pedido continua com ele. Siga com o que dá para fazer sem isso. Se precisar mesmo, chame esperar_resposta com o id ${id} mais tarde, ou termine dizendo no relatório o que ficou faltando.`);
      }, ms);
      const fim = (r: string) => { clearTimeout(t); resolve(r); };
      this.esperandoAcesso.set(id, [...(this.esperandoAcesso.get(id) ?? []), fim]);
    });
  }
  private pedirAcesso(f: Funcionario, oque: string, porque: string): Promise<string> {
    // o mesmo pedido de novo: continua esperando o que já está com o gestor
    const aberto = [...this.acessos.values()].find((a) => a.funcionario === f.id);
    if (aberto) return this.esperarAcesso(aberto.idPedido);
    const idPedido = randomUUID().slice(0, 8);
    const chefe = this.chefe;
    this.acessos.set(idPedido, { idPedido, funcionario: f.id, chefe: chefe?.id, oque, porque, em: new Date().toISOString() });
    this.doEscritorio({ tipo: 'acesso_pedido', idPedido, funcionario: f.id, ...(chefe ? { chefe: chefe.id } : {}), oque, porque });
    this.diario(f.id, `Pediu ao gestor (pelo chefe): ${encurtar(oque, 120)}`);
    if (chefe) this.recados.push(`[Aviso do escritório] ${f.nome} precisou de algo que só o gestor pode dar: "${encurtar(oque, 160)}" (${encurtar(porque, 160)}). Você levou o pedido ao gestor.`);
    return this.esperarAcesso(idPedido);
  }
  responderAcesso(id: string, resposta: string, negar = false) {
    const a = this.acessos.get(id);
    if (!a) throw new Error('pedido não encontrado ou já respondido');
    this.acessos.delete(id);
    // no diário vai só o fato, nunca o conteúdo (pode ser uma senha)
    this.diario(a.funcionario, negar ? `O gestor não liberou: ${encurtar(a.oque, 100)}` : `O gestor respondeu ao pedido: ${encurtar(a.oque, 100)}`);
    const texto = negar ? `O gestor não liberou${resposta ? `: ${resposta}` : '.'} Siga sem isso, ou explique no relatório o que ficou faltando.` : `O gestor respondeu: ${resposta}`;
    this.respostasAcesso.set(id, texto);
    for (const fim of this.esperandoAcesso.get(id) ?? []) fim(texto);
    this.esperandoAcesso.delete(id);
    this.doEscritorio({ tipo: 'acesso_respondido', idPedido: id, funcionario: a.funcionario, ...(a.chefe ? { chefe: a.chefe } : {}), aprovado: !negar });
  }

  personalizarComputador(alvo: string, c: { papel?: unknown; icones?: unknown; atalhos?: unknown }) {
    if (alvo !== 'voce' && alvo !== 'principal' && !this.funcionario(alvo)) throw new Error('computador desconhecido');
    const todos = (this.estado.computadores ??= {});
    if (this.estado.computador) { todos.voce ??= this.estado.computador; delete this.estado.computador; }
    const atual = (todos[alvo] ??= {});
    if (typeof c.papel === 'string') atual.papel = c.papel.slice(0, 40);
    if (Array.isArray(c.icones)) atual.icones = c.icones.filter((x): x is string => typeof x === 'string').slice(0, 40);
    if (Array.isArray(c.atalhos)) {
      atual.atalhos = c.atalhos
        .filter((a): a is { nome: string; url: string } => typeof a?.nome === 'string' && typeof a?.url === 'string' && /^(https?:\/\/|\/)/.test(a.url))
        .map((a) => ({ nome: a.nome.slice(0, 30), url: a.url.slice(0, 500) }))
        .slice(0, 16);
    }
    this.salvar();
    return atual;
  }

  // Drive da empresa: o lugar simples onde a equipe põe coisas para o gestor ver
  // (pastas com nomes de gente, não a estrutura técnica do projeto). Um índice
  // escondido guarda quem mandou, quando e o recado.
  static readonly PASTAS_DRIVE = ['Para você', 'Relatórios', 'Documentos', 'Imagens'];
  pastaDrive() {
    const p = path.join(PASTA_DADOS, 'drive');
    for (const sub of Orquestrador.PASTAS_DRIVE) fs.mkdirSync(path.join(p, sub), { recursive: true });
    // o que veio da versão anterior (compartilhados) vai para "Para você"
    const antiga = path.join(PASTA_DADOS, 'compartilhados');
    if (fs.existsSync(antiga)) {
      for (const n of fs.readdirSync(antiga)) if (!n.endsWith('.recado.txt')) try { fs.renameSync(path.join(antiga, n), path.join(p, n.includes('Relatório') ? 'Relatórios' : 'Para você', n)); } catch {}
      fs.rmSync(antiga, { recursive: true, force: true });
    }
    return p;
  }
  private indiceDrive(): Record<string, { de?: string; recado?: string; em: string }> {
    try { return JSON.parse(fs.readFileSync(path.join(this.pastaDrive(), '.indice.json'), 'utf8')); } catch { return {}; }
  }
  private anotarNoDrive(rel: string, info: { de?: string; recado?: string }) {
    const idx = this.indiceDrive();
    idx[rel] = { ...info, em: new Date().toISOString() };
    fs.writeFileSync(path.join(this.pastaDrive(), '.indice.json'), JSON.stringify(idx, null, 1));
  }
  // nome que não sobrescreve nada: "Texto.md", "Texto (2).md"…
  private nomeLivre(pasta: string, nome: string) {
    const limpo = nome.replace(/[\/\\\0:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'arquivo';
    const ext = path.extname(limpo);
    const base = limpo.slice(0, limpo.length - ext.length);
    let n = 1, final = limpo;
    while (fs.existsSync(path.join(pasta, final))) final = `${base} (${++n})${ext}`;
    return final;
  }
  private quandoCurto() {
    return new Date().toLocaleString('pt-BR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(',', '').replace('.', '').replace(':', 'h');
  }
  compartilhar(f: Funcionario, origem: string, mensagem: string, nome?: string, pasta = 'Para você') {
    const st = fs.statSync(origem);
    const sub = Orquestrador.PASTAS_DRIVE.includes(pasta) ? pasta : 'Para você';
    const dir = path.join(this.pastaDrive(), sub);
    const final = this.nomeLivre(dir, nome?.trim() ? (path.extname(nome) || st.isDirectory() ? nome : nome + path.extname(origem)) : path.basename(origem));
    fs.cpSync(origem, path.join(dir, final), { recursive: st.isDirectory() });
    this.anotarNoDrive(`${sub}/${final}`, { de: f.nome, recado: mensagem.trim() });
    this.doEscritorio({ tipo: 'compartilhado', funcionario: f.id, nome: `${sub}/${final}`, mensagem: encurtar(mensagem, 300) });
    this.diario(f.id, `Pôs no Drive (${sub}): ${final}`);
    return `${sub}/${final}`;
  }
  private relatorioDaTarefa(f: Funcionario, tarefa: string, sucesso: boolean, relato: string, integracao: string) {
    const dir = path.join(this.pastaDrive(), 'Relatórios');
    // título curto em palavras inteiras: "Caio - Escreva o post do Instagram (1 de nov 19h21).md"
    const palavras = tarefa.replace(/[\n\r]+/g, ' ').replace(/[^\p{L}\p{N} ,.-]/gu, ' ').split(/\s+/).filter(Boolean);
    let titulo = '';
    for (const w of palavras) { if ((titulo + ' ' + w).length > 44) break; titulo = titulo ? `${titulo} ${w}` : w; }
    const nome = this.nomeLivre(dir, `${f.nome} - ${titulo.replace(/[,.]+$/, '')} (${this.quandoCurto()}).md`);
    const texto = [
      `# Relatório de ${f.nome}`,
      '',
      `**${tituloDe(f)}** · ${new Date().toLocaleString('pt-BR')}`,
      '',
      `**Tarefa:** ${tarefa}`,
      '',
      `**Resultado:** ${sucesso ? 'concluída ✅' : 'não concluída ⚠️'} · **Versão principal:** ${integracao}`,
      '',
      '---',
      '',
      relato.trim() || '(sem relato)',
    ].join('\n');
    fs.writeFileSync(path.join(dir, nome), texto);
    this.anotarNoDrive(`Relatórios/${nome}`, { de: f.nome, recado: `Relatório: ${encurtar(tarefa, 120)}` });
    this.doEscritorio({ tipo: 'compartilhado', funcionario: f.id, nome: `Relatórios/${nome}`, mensagem: `Relatório: ${encurtar(tarefa, 120)}`, relatorio: true });
  }
  listarDrive(relativo = '') {
    const { abs, rel } = this.caminhoSeguro('drive', relativo);
    const idx = this.indiceDrive();
    const itens = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .map((d) => {
        const st = fs.statSync(path.join(abs, d.name));
        const chave = rel ? `${rel}/${d.name}` : d.name;
        const i = idx[chave];
        return { nome: d.name, caminho: chave, pasta: d.isDirectory(), tamanho: st.size, em: (i?.em ?? st.mtime.toISOString()), de: i?.de ?? '', recado: i?.recado ?? '', itens: d.isDirectory() ? fs.readdirSync(path.join(abs, d.name)).filter((n) => !n.startsWith('.')).length : undefined };
      })
      .sort((a, b) => (a.pasta === b.pasta ? (a.pasta && !rel ? Orquestrador.PASTAS_DRIVE.indexOf(a.nome) - Orquestrador.PASTAS_DRIVE.indexOf(b.nome) : b.em.localeCompare(a.em)) : a.pasta ? -1 : 1));
    return { caminho: rel, itens };
  }

  private ferramentasDaTarefa(f: Funcionario, pasta: string) {
    const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
    const erro = (t: string) => ({ ...texto(t), isError: true });
    return createSdkMcpServer({
      name: 'escritorio',
      version: '1.0.0',
      tools: [
        tool(
          'pedir_acesso',
          'Pede ao gestor (pelo chefe) algo que só ele pode dar: login/senha de uma conta (rede social, e-mail, hospedagem, loja), pagamento, ou autorização para publicar em nome dele. ' +
            'NÃO use para trabalhar: criar, editar e apagar arquivos, rodar comandos, instalar dependências e pesquisar na pasta do projeto já são liberados. Espera a resposta do gestor.',
          { o_que: z.string().describe('o que você precisa, em uma frase'), por_que: z.string().describe('para que, em uma frase') },
          async ({ o_que, por_que }) => texto(await this.pedirAcesso(f, o_que, por_que)),
          SEMPRE,
        ),
        this.ferramentaDeConversa(f),
        tool(
          'pedir_aval_do_chefe',
          'Pede ao chefe aval antes de uma mudança GRANDE ou ARRISCADA: repaginar/redesenhar o projeto inteiro, mudar a arquitetura, reiniciar ou derrubar um servidor, apagar muita coisa, publicar ou fazer deploy. ' +
            'Escrever, editar, criar arquivos, rodar testes e comandos normais NÃO precisam de aval. Espera a decisão do chefe.',
          { o_que: z.string().describe('a mudança, em uma frase'), por_que: z.string().describe('por que é preciso, em uma frase') },
          async ({ o_que, por_que }) => texto(await this.avalDoChefe(f, o_que, por_que)),
          SEMPRE,
        ),
        tool(
          'esperar_resposta',
          'Volta a esperar a resposta do gestor a um pedido_acesso que ainda não foi respondido (até 10 minutos).',
          { id: z.string().describe('o id do pedido') },
          async ({ id }) => texto(await this.esperarAcesso(id)),
          SEMPRE,
        ),
        tool(
          'compartilhar_com_gestor',
          'Põe uma cópia de um arquivo ou pasta do projeto no Drive da empresa, para o gestor ver (ele é leigo: dê um nome claro, em português, como "Texto do Instagram.md" ou "Logo nova.png"). O projeto continua organizado do jeito técnico certo; o Drive é a cópia fácil de achar.',
          {
            arquivo: z.string().describe('caminho do arquivo ou pasta, relativo à pasta do projeto'),
            recado: z.string().describe('uma ou duas frases para o gestor'),
            nome: z.string().optional().describe('nome claro para o gestor (opcional)'),
            pasta: z.enum(['Para você', 'Documentos', 'Imagens']).optional().describe('pasta do Drive (padrão: Para você)'),
          },
          async ({ arquivo, recado, nome, pasta: pastaNoDrive }) => {
            const abs = path.resolve(pasta, arquivo);
            const rel = path.relative(pasta, abs);
            if (rel.startsWith('..') || path.isAbsolute(rel) || rel.split(path.sep)[0] === '.git') return erro('Só arquivos de dentro da pasta do projeto.');
            if (!fs.existsSync(abs)) return erro(`Não encontrei ${arquivo}.`);
            try {
              return texto(`Pronto: "${this.compartilhar(f, abs, recado, nome, pastaNoDrive)}" já está no Drive da empresa, no computador do gestor.`);
            } catch (e) {
              return erro(`Não deu: ${(e as Error).message}`);
            }
          },
          SEMPRE,
        ),
      ],
    });
  }

  responderPermissao(id: string, aprovar: boolean, motivo?: string) {
    const p = this.pendentes.get(id);
    if (!p) throw new Error('pedido não encontrado ou já respondido');
    this.pendentes.delete(id);
    p.responder({ aprovada: aprovar, motivo: motivo ?? (aprovar ? 'aprovado pelo gestor' : 'negado pelo gestor') });
  }

  definirAprovarTudo(v: boolean) {
    this.estado.aprovarTudo = v;
    this.salvar();
    if (v) for (const id of [...this.pendentes.keys()]) this.responderPermissao(id, true, 'aprovação automática ligada');
    this.doEscritorio({ tipo: 'config', internet: this.estado.internet, aprovarTudo: v });
  }

  // O Wi-Fi do escritório: com a internet desligada, os funcionários não
  // pesquisam nem navegam (WebSearch/WebFetch ficam proibidos).
  definirInternet(v: boolean) {
    this.estado.internet = v;
    this.salvar();
    this.doEscritorio({ tipo: 'config', internet: v, aprovarTudo: this.estado.aprovarTudo });
    this.recados.push(`[Aviso do escritório] O gestor ${v ? 'ligou' : 'desligou'} a internet do escritório.`);
  }

  // ---------- cota → almoço ----------
  private verCota(ev: Extract<Evento, { tipo: 'cota' }>) {
    const esgotou = ev.status === 'rejected' || (ev.janela === 'five_hour' && (ev.uso ?? 0) >= 0.97);
    if (!esgotou || !ev.renovaEm || this.almocoAte === ev.renovaEm) return;
    this.almocoAte = ev.renovaEm;
    this.doEscritorio({ tipo: 'almoco', ate: ev.renovaEm, motivo: 'cota perto do limite' });
    this.diario('escritorio', `Pausa para o almoço: a cota da conta renova às ${horaCurta(ev.renovaEm)}.`);
    const ms = Math.max(60_000, new Date(ev.renovaEm).getTime() - Date.now() + 15_000);
    setTimeout(() => this.voltarDoAlmoco(), Math.min(ms, 2 ** 31 - 1)).unref();
  }

  private voltarDoAlmoco() {
    if (!this.almocoAte) return;
    this.almocoAte = null;
    this.doEscritorio({ tipo: 'almoco', ate: null });
    for (const f of this.filaAlmoco.splice(0)) {
      try {
        f();
      } catch {}
    }
    this.proximoDoChefe();
  }

  // ---------- conversas ----------
  private mensagem(de: string, para: string, texto: string) {
    if (de !== 'voce') texto = semMarcacao(texto);
    const m = { de, para, texto, em: new Date().toISOString() };
    const chave = de === 'voce' ? para : de;
    (this.estado.conversas[chave] ??= []).push(m);
    this.salvar();
    this.doEscritorio({ tipo: 'mensagem', de, para, texto, em: m.em }); // mesmo horário: a tela não duplica
  }

  // O gestor fala com alguém (de perto, ou pelo ramal). Quem responde na hora é
  // a persona (rápida); se precisar, ela chama o modelo mais inteligente.
  conversar(id: string, texto: string) {
    const f = this.funcionario(id);
    if (!f) throw new Error('essa pessoa não está na equipe');
    texto = String(texto ?? '').trim();
    if (!texto) throw new Error('escreva alguma coisa');
    this.mensagem('voce', f.id, texto);
    this.reagirAoTratamento(f, texto);
    if (f.ferias) {
      this.mensagem(f.id, 'voce', 'Tô de férias! 🏖️ Falo com você quando voltar.');
      return;
    }
    if (this.almocoAte) {
      this.mensagem(f.id, 'voce', `Tô no almoço! Volto às ${horaCurta(this.almocoAte)}.`);
      return;
    }
    this.responderComPersona(f, texto);
  }

  // Compatibilidade: falar com o chefe.
  falarComChefe(texto: string) {
    if (!this.chefe) throw new Error('o escritório ainda não abriu');
    this.conversar(this.chefe.id, texto);
  }

  // ---------- personas (a personalidade rápida de cada um) ----------
  private personas = new Map<string, Persona>();
  private conversouDesdeQueLigou = new Set<string>();

  private personaDe(f: Funcionario): Persona {
    let p = this.personas.get(f.id);
    if (p) return p;
    // Limite de sessões ligadas: desliga a menos usada (nunca a do chefe).
    const ligadas = [...this.personas.entries()].filter(([, x]) => x.vivo);
    if (ligadas.length >= MAX_PERSONAS_LIGADAS) {
      const [idVelha, velha] = ligadas.filter(([i, x]) => i !== this.chefe?.id && !x.ocupada).sort((a, b) => a[1].ultimoUso - b[1].ultimoUso)[0] ?? [];
      if (velha) {
        velha.desligar();
        this.personas.delete(idVelha!);
      }
    }
    const ferramentas = f.cargo === 'chefe' ? this.ferramentasDaPersonaChefe(f) : this.ferramentasDoFuncionario(f);
    ferramentas.nomes.push('fazer_no_escritorio', 'falar_com_colega');
    p = new Persona({
      id: f.id,
      sistema: this.sistemaDaPersona(f),
      ferramentas: { escritorio: ferramentas.servidor },
      liberadas: ferramentas.nomes.map((n) => `mcp__escritorio__${n}`),
      pasta: path.join(PASTA_DADOS, 'personas', f.id),
      log: path.join(this.pastaLogs, `persona-${f.id}.jsonl`),
    });
    p.on('cota', (info: any) =>
      this.verCota({ tipo: 'cota', sessao: 'persona', em: new Date().toISOString(), status: info.status, janela: info.rateLimitType, uso: info.utilization, renovaEm: info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : undefined }),
    );
    this.personas.set(f.id, p);
    this.conversouDesdeQueLigou.delete(f.id);
    return p;
  }

  // Liga as personas de quem está no escritório (o chefe primeiro), para a
  // primeira conversa do dia já sair rápida.
  aquecerPersonas() {
    const presentes = this.estado.equipe.filter((f) => !f.ferias).sort((a, b) => (a.cargo === 'chefe' ? -1 : b.cargo === 'chefe' ? 1 : 0));
    presentes.slice(0, Math.min(4, MAX_PERSONAS_LIGADAS)).forEach((f, i) => setTimeout(() => this.personaDe(f).ligar(), i * 1500).unref());
  }

  private sistemaDaPersona(f: Funcionario): string {
    const fi = f.ficha ?? fichaDe(f.nome);
    const e = this.estado.escritorio;
    const titulo = tituloDe(f);
    const base = [
      `Você é ${f.nome}, ${fi.idade} anos, de ${fi.cidade}. Trabalha como ${titulo} no escritório "${e?.nome ?? 'do gestor'}" (área: ${area(e?.area).nome}). Seu jeito: ${f.personalidade}`,
      `Sua vida: ${fi.familia}; tem ${fi.pet}; gosta de ${fi.hobbies.join(' e ')}; ${fi.time === 'não liga para futebol' ? 'não liga para futebol' : `torce para o ${fi.time}`}; ouve ${fi.musica}; comida preferida: ${fi.comida}; mania: ${fi.mania}.`,
      'Você é uma pessoa de verdade dentro deste mundo: tem vida fora do trabalho, família, fins de semana, gostos e opiniões. Nunca diga que é uma IA, um modelo, um assistente ou um personagem.',
      'Fale como gente: português do Brasil coloquial, curto (1 a 3 frases), no seu jeito. Sem markdown, sem listas, sem emojis em excesso.',
      'Normalmente quem fala com você é o gestor (o dono do escritório). Quando a mensagem vier marcada [Colega], é um colega de trabalho falando com você: responda a ele. Antes chegam [Fatos do escritório]: eles são a verdade sobre o trabalho. Use-os sem recitar.',
      'Vocês trabalham na mesma sala e se falam de verdade: para falar com um colega (porque o gestor pediu ou porque você precisa), use falar_com_colega e depois conte o que ele respondeu. Nunca invente a resposta de alguém.',
      'Sobre trabalho, só fale do que está nos fatos. Nunca invente progresso, arquivos, números ou resultados.',
      'Noção de tempo: os fatos dizem a data e a hora de agora e quando cada coisa aconteceu ("hoje às…", "ontem…"). Use exatamente isso. Se não há registro, você não fez: não diga "ontem eu fiz" sem estar nos fatos.',
      'O humor muda seu tom e sua iniciativa, nunca a qualidade do trabalho.',
      'Você existe no escritório: anda, pega café, vai ao bebedouro. Quando decidir fazer algo, ou quando o gestor pedir (ex.: "me traz um café"), use fazer_no_escritorio de verdade, não só diga que vai.',
      'Às vezes chega um [Momento livre] em vez de uma fala do gestor: aí siga exatamente o formato pedido.',
    ];
    if (f.cargo === 'chefe') {
      base.push(
        'Você é o parceiro do gestor e quem organiza o escritório: a equipe fala com você e você distribui o trabalho.',
        'Quando os fatos disserem "fase: entrevista": você está conhecendo o escritório com o gestor. Converse naturalmente, uma pergunta por vez, para entender: o que o escritório faz e para quem; o projeto principal (o quê, objetivo, prazo); como o gestor gosta de trabalhar. A cada resposta útil, registre com anotar_relatorio (seções: "O escritório", "Projeto principal", "Objetivos", "Como trabalhamos", "Próximos passos"). Quando tiver o suficiente (umas 3 ou 4 respostas), proponha a equipe com recomendar_equipe (2 a 4 pessoas, só cargos da lista dos fatos, cada uma com o motivo), explique em 2 frases e diga que a tela de contratação vai abrir.',
        'Quando os fatos disserem "fase: operando": para qualquer trabalho novo, planejamento, delegar, revisar ou dúvida sobre o projeto, chame planejar com o pedido completo e responda curto que vai organizar (a resposta detalhada chega em seguida). Conversa social você responde direto.',
      );
    } else {
      base.push(
        'Se o gestor pedir um trabalho (criar, mudar, consertar, testar, pesquisar, escrever...), chame comecar_tarefa com a tarefa completa e diga que vai começar.',
        'Se a pergunta for técnica, complexa ou precisar olhar os arquivos do projeto, responda algo curto e natural (tipo "boa pergunta, deixa eu ver direitinho") e chame pensar_melhor com a pergunta; a resposta completa chega em seguida.',
      );
    }
    return base.join('\n');
  }

  // "hoje às 14:05", "ontem às 9:10", "há 3 dias (28/10)": o modelo não faz contas de data.
  private quando(iso?: string, data?: string): string {
    const d = iso ? new Date(iso) : data ? new Date(`${data}T12:00`) : null;
    if (!d || Number.isNaN(d.getTime())) return data ?? '';
    const dia = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
    const n = dia(new Date()) - dia(d);
    const h = iso ? ` às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : '';
    if (n <= 0) return `hoje${h}`;
    if (n === 1) return `ontem${h}`;
    return `há ${n} dias (${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`;
  }

  private fatosPara(f: Funcionario): string {
    const e = this.estado;
    const agora = new Date().toLocaleString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const humor = f.humor ?? 70;
    const linhas = [
      `[Fatos do escritório — agora é ${agora}]`,
      `O expediente de hoje abriu ${this.abertoEm ? this.quando(this.abertoEm.toISOString()) : 'agora há pouco'}. Você está no escritório desde então.`,
      `Fase: ${e.fase}. Escritório: ${e.escritorio?.nome ?? '-'}. Projeto principal: ${e.projeto?.nome ?? '-'}${e.projeto?.descricao ? ` (${e.projeto.descricao})` : ''}.`,
      `Seu humor: ${humor}/100 (${humor >= 65 ? 'animado' : humor >= 35 ? 'normal' : 'chateado: seco, sem iniciativa'}).`,
      `Você agora: ${this.trabalhando(f.id) ? `trabalhando na tarefa "${encurtar(e.pendentes.find((p) => p.funcionario === f.id)?.tarefa ?? '', 160)}"` : 'livre'}.`,
    ];
    const feito = e.diario.filter((d) => d.quem === f.id).slice(-6).map((d) => `${this.quando(d.em, d.data)}: ${encurtar(d.texto, 140)}`);
    linhas.push(feito.length ? `O que você fez (com quando foi): ${feito.join(' | ')}` : 'Você ainda não fez nenhum trabalho aqui, nem hoje nem antes.');
    const admitido = e.diario.find((d) => d.quem === f.id || d.texto.includes(f.nome));
    if (admitido) linhas.push(`Você entrou no escritório ${this.quando(admitido.em, admitido.data)}.`);
    const lembrancas = (e.vida?.[f.id] ?? []).slice(-8).map((v) => `${this.quando(v.em)} ${v.tipo === 'ouviu' ? `ouviu de ${v.com}` : v.tipo === 'disse' ? `disse${v.com ? ` a ${v.com}` : ''}` : v.tipo}: ${v.texto}`);
    if (lembrancas.length) linhas.push(`O que você pensou, disse, ouviu e fez por aí (é memória sua, use se fizer sentido): ${lembrancas.join(' | ')}`);
    const vida = e.agenda?.data === hoje() ? e.agenda?.vida?.[f.id] : undefined;
    if (vida) linhas.push(`Sua vida hoje: ${vida}`);
    const equipe = e.equipe.filter((x) => x.id !== f.id).map((x) => `${x.nome} (${tituloDe(x)}, ${x.ferias ? 'férias' : this.trabalhando(x.id) ? 'trabalhando' : 'livre'})`);
    linhas.push(`Equipe: ${equipe.length ? equipe.join(', ') : 'só você e o gestor'}.`);
    if (f.cargo === 'chefe') {
      const daEquipe = e.diario.filter((d) => d.quem !== f.id && d.quem !== 'voce' && e.equipe.some((x) => x.id === d.quem)).slice(-10)
        .map((d) => `${this.quando(d.em, d.data)}, ${this.nomeDe(d.quem)}: ${encurtar(d.texto, 140)}`);
      linhas.push(daEquipe.length ? `O que a equipe fez (com quando foi): ${daEquipe.join(' | ')}` : 'A equipe ainda não fez nenhum trabalho.');
      const abertos = [...this.acessos.values()].map((a) => `${this.nomeDe(a.funcionario)} precisa de "${encurtar(a.oque, 80)}"`);
      if (abertos.length) linhas.push(`Pedidos de acesso esperando o gestor: ${abertos.join('; ')}.`);
      linhas.push(`Cargos que dá para contratar nesta área: ${area(e.escritorio?.area).cargos.map((c) => `${c} (${CARGOS[c].titulo})`).join(', ')}.`);
      const rel = Object.entries(e.relatorio);
      linhas.push(rel.length ? `Relatório até agora: ${rel.map(([k, v]) => `${k}: ${encurtar(v, 160)}`).join(' | ')}` : 'Relatório: vazio ainda.');
      if (e.recomendacao?.length) linhas.push(`Equipe que você já recomendou: ${e.recomendacao.map((r) => r.cargo).join(', ')}.`);
    }
    // Ao religar (novo dia/app), lembra a conversa recente.
    if (!this.conversouDesdeQueLigou.has(f.id)) {
      const recente = (e.conversas[f.id] ?? []).slice(-9, -1).map((m) => `(${this.quando(m.em)}) ${m.de === 'voce' ? 'Gestor' : 'Você'}: ${encurtar(m.texto, 200)}`);
      if (recente.length) linhas.push(`Conversa recente: ${recente.join(' / ')}`);
    }
    return linhas.join('\n');
  }

  private async responderComPersona(f: Funcionario, texto: string) {
    const p = this.personaDe(f);
    const idFala = randomUUID().slice(0, 8);
    const parcial = (t: string) => this.doEscritorio({ tipo: 'fala_parcial', funcionario: f.id, texto: t, idFala });
    p.on('parcial', parcial);
    try {
      const resposta = await p.falar(`${this.fatosPara(f)}\n\n[O gestor diz]\n${texto}`);
      this.conversouDesdeQueLigou.add(f.id);
      this.doEscritorio({ tipo: 'fala_parcial', funcionario: f.id, texto: resposta, idFala, fim: true });
      if (resposta.trim()) this.mensagem(f.id, 'voce', resposta.trim());
    } catch {
      this.doEscritorio({ tipo: 'fala_parcial', funcionario: f.id, texto: '', idFala, fim: true });
      this.mensagem(f.id, 'voce', 'Desculpa, me distraí aqui. Pode repetir?');
    } finally {
      p.off('parcial', parcial);
    }
  }

  // "Deixa eu ver direitinho": a pergunta vai para o modelo mais inteligente
  // (o da própria pessoa), que pode ler o projeto. A resposta chega em seguida.
  private async pensarMelhor(f: Funcionario, pergunta: string) {
    this.doEscritorio({ tipo: 'pensando', funcionario: f.id, motivo: encurtar(pergunta, 120) });
    try {
      const r = await this.turnoDeConversa(f, pergunta);
      if (r.resposta?.trim()) this.mensagem(f.id, 'voce', r.resposta.trim());
    } finally {
      this.doEscritorio({ tipo: 'pensando', funcionario: f.id, motivo: '', ate: true });
    }
  }

  // Sessão do modelo da própria pessoa, com leitura do projeto, para responder
  // com profundidade (memória vinda do diário e da conversa recente).
  private async turnoDeConversa(f: Funcionario, texto: string) {
    const esc = this.escritorio();
    const mesa = esc.mesa(f.id);
    let resposta: string | undefined;
    let falhou = false;
    const humor = f.humor ?? 70;
    const feito = this.estado.diario.filter((d) => d.quem === f.id).slice(-8).map((d) => `- ${d.data}: ${d.texto}`);
    const recente = (this.estado.conversas[f.id] ?? []).slice(-9, -1).map((m) => `${m.de === 'voce' ? 'Gestor' : f.nome}: ${encurtar(m.texto, 300)}`);
    const prompt = [
      feito.length ? `[Sua memória: o que você fez recentemente]\n${feito.join('\n')}` : '[Sua memória] Você ainda não fez nenhuma tarefa aqui.',
      recente.length ? `[Conversa recente com o gestor]\n${recente.join('\n')}` : '',
      `[O gestor perguntou, e você disse que ia ver direitinho]\n${texto}`,
    ].filter(Boolean).join('\n\n');
    const sessao = this.novaSessao(
      {
        ...mesa,
        funcionario: f.id,
        tarefa: prompt,
        modelo: f.modelo,
        instrucoes: [
          `Você é ${f.nome}, ${CARGOS[f.cargo]?.titulo ?? f.cargo} no escritório "${this.estado.escritorio?.nome ?? ''}". Seu jeito: ${f.personalidade}`,
          'Responda à pergunta do gestor com cuidado e exatidão, em português do Brasil, falando como gente numa conversa (no máximo 6 frases). Texto corrido: nada de markdown, negrito, títulos ou listas. Pode ler o projeto (Read, Glob, Grep) para responder com fatos.',
          'Nunca invente progresso. Aqui você não edita nem roda comandos: se for trabalho, diga que pode fazer.',
          `Seu humor agora: ${humor >= 65 ? 'animado' : humor >= 35 ? 'normal' : 'chateado: seco'}. Muda o tom, nunca a qualidade.`,
        ].join('\n'),
        conversa: true,
        ferramentasProibidas: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent', ...(this.estado.internet ? [] : ['WebFetch', 'WebSearch'])],
      },
      { funcionario: f.id, projeto: esc.projeto, tarefa: texto, conversa: true },
    );
    sessao.on('evento', (ev: Evento) => {
      if (ev.tipo === 'tarefa_terminada') {
        falhou = !ev.sucesso;
        resposta = ev.sucesso ? ev.resultado : 'Olhei aqui, mas me enrolei. Pode perguntar de novo?';
      }
      if (ev.tipo === 'erro') falhou = true;
    });
    await this.sessoes.get(sessao.id)!.fim;
    return { resposta, falhou };
  }

  // Aval do chefe: mudança grande ou arriscada (repaginar, reiniciar servidor,
  // apagar muito, publicar). O chefe decide de verdade (o modelo dele, lendo o
  // projeto); só leva ao gestor o que ele mesmo não pode resolver.
  private async avalDoChefe(f: Funcionario, oque: string, porque: string): Promise<string> {
    const chefe = this.chefe;
    if (!chefe || !this.estado.projeto) return 'Não há chefe para dar aval: use o bom senso, faça o mínimo arriscado e explique no relatório.';
    this.doEscritorio({ tipo: 'aval_pedido', funcionario: f.id, chefe: chefe.id, oque, porque });
    const prompt = [
      `${f.nome} (${tituloDe(f)}) está trabalhando e pede o seu aval antes de uma mudança grande.`,
      `O que quer fazer: ${oque}`,
      `Por quê: ${porque}`,
      `Tarefa dele agora: ${encurtar(this.estado.pendentes.find((p) => p.funcionario === f.id)?.tarefa ?? '(sem registro)', 400)}`,
      'Relatório do escritório: ' + (Object.entries(this.estado.relatorio).map(([k, v]) => `${k}: ${encurtar(v, 200)}`).join(' | ') || '(vazio)'),
      '',
      'Decida você mesmo, como chefe. Pode ler o projeto para decidir. Só leve ao gestor (o dono) o que você realmente não pode decidir: senha ou login de conta dele, dinheiro, publicar em nome dele, ou algo que contradiz o que ele pediu.',
      'Responda com a primeira linha exatamente uma destas: "DECISÃO: APROVADO", "DECISÃO: NEGADO" ou "DECISÃO: LEVAR AO GESTOR". Depois, em até 3 frases, a orientação para a pessoa (como fazer com segurança, ou o que fazer no lugar).',
    ].join('\n');
    let resposta = '';
    const sessao = this.novaSessao(
      {
        pasta: this.estado.projeto.pasta,
        funcionario: chefe.id,
        tarefa: prompt,
        modelo: chefe.modelo,
        instrucoes: `Você é ${chefe.nome}, ${tituloDe(chefe)} do escritório "${this.estado.escritorio?.nome ?? ''}". Decide pedidos de aval da equipe com responsabilidade e sem burocracia: se é razoável para o projeto, aprove com orientação.`,
        conversa: true,
        ferramentasProibidas: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent'],
      },
      { funcionario: chefe.id, projeto: this.estado.projeto.pasta, tarefa: `aval para ${f.nome}`, conversa: true, interno: true },
    );
    sessao.on('evento', (ev: Evento) => { if (ev.tipo === 'tarefa_terminada') resposta = ev.resultado ?? ''; });
    await this.sessoes.get(sessao.id)!.fim;
    const decisao = resposta.match(/DECIS[ÃA]O:\s*(APROVADO|NEGADO|LEVAR AO GESTOR)/i)?.[1]?.toUpperCase() ?? 'NEGADO';
    const orientacao = semMarcacao(resposta.replace(/^.*DECIS[ÃA]O:[^\n]*\n?/i, '').trim()) || (resposta ? '' : 'Não consegui avaliar agora; faça do jeito menos arriscado.');
    if (decisao === 'LEVAR AO GESTOR') {
      this.doEscritorio({ tipo: 'aval_respondido', funcionario: f.id, chefe: chefe.id, aprovado: false, orientacao: 'Vou levar ao gestor.' });
      this.diario(chefe.id, `Levou ao gestor o pedido de ${f.nome}: ${encurtar(oque, 100)}`);
      return this.pedirAcesso(f, oque, `${porque} (${chefe.nome}: ${encurtar(orientacao, 200)})`);
    }
    const aprovado = decisao === 'APROVADO';
    this.doEscritorio({ tipo: 'aval_respondido', funcionario: f.id, chefe: chefe.id, aprovado, orientacao: encurtar(orientacao, 300) });
    this.diario(chefe.id, `${aprovado ? 'Deu aval' : 'Não deu aval'} a ${f.nome}: ${encurtar(oque, 100)}`);
    return `${chefe.nome} (chefe) ${aprovado ? 'APROVOU' : 'NÃO APROVOU'}. ${orientacao}`;
  }

  // Cada computador é de alguém: a pasta pessoal (Downloads, Imagens, Notas) fica
  // fora do projeto e é só da pessoa.
  pastaPessoal(id: string) {
    if (id !== 'voce' && !this.funcionario(id)) throw new Error('computador desconhecido');
    const p = path.join(PASTA_DADOS, 'pessoal', slug(id));
    for (const sub of ['Downloads', 'Imagens', 'Notas']) fs.mkdirSync(path.join(p, sub), { recursive: true });
    return p;
  }
  // Uma coisa pessoal no próprio computador (pesquisar um hobby, salvar fotos,
  // anotar algo): uma sessão de verdade, pequena, na pasta pessoal.
  private ultimaAtividadePessoal = new Map<string, number>();
  private atividadePessoalRodando = false;
  private atividadePessoal(f: Funcionario, oque: string) {
    if (this.atividadePessoalRodando || !this.estado.internet || this.almocoAte || this.trabalhando(f.id)) return false;
    if (Date.now() - (this.ultimaAtividadePessoal.get(f.id) ?? 0) < 30 * 60_000) return false;
    this.ultimaAtividadePessoal.set(f.id, Date.now());
    this.atividadePessoalRodando = true;
    const pasta = this.pastaPessoal(f.id);
    this.doEscritorio({ tipo: 'vida', funcionario: f.id, acao: 'computador', pensamento: oque });
    let resultado = '';
    const sessao = this.novaSessao(
      {
        pasta,
        funcionario: f.id,
        tarefa: `Seu momento livre no seu próprio computador. Você quer: ${oque}\nFaça de verdade, rápido (poucos passos): pesquise na internet se precisar; se for salvar imagens, baixe com curl para Imagens/ (ex.: https://cataas.com/cat para fotos de gato, ou um link direto de imagem que você achou); anotações vão em Notas/ (.md); arquivos baixados em Downloads/. No fim, diga em uma frase, em primeira pessoa e no seu jeito, o que você fez.`,
        modelo: 'haiku',
        instrucoes: `Você é ${f.nome}. Isto é pessoal, não é trabalho do escritório. Fique só na sua pasta pessoal. Nada de comprar, cadastrar, logar em contas ou postar.`,
        ferramentasProibidas: ['Task', 'Agent', 'NotebookEdit'],
      },
      { funcionario: f.id, projeto: pasta, tarefa: `pessoal: ${oque}`, interno: true },
    );
    sessao.on('evento', (ev: Evento) => { if (ev.tipo === 'tarefa_terminada') resultado = ev.resultado ?? ''; });
    this.sessoes.get(sessao.id)!.fim!.finally(() => {
      this.atividadePessoalRodando = false;
      const feito = semMarcacao(resultado).split('\n')[0]?.trim();
      this.lembrar(f.id, 'fez', `no meu computador: ${feito || oque}`);
      this.doEscritorio({ tipo: 'vida', funcionario: f.id, acao: 'mesa', ...(feito ? { pensamento: feito } : {}) });
    });
    return true;
  }

  // ---------- vida de verdade ----------
  // Ações no escritório que a pessoa decide (ou que o gestor pede): a tela anda
  // com ela até lá. "Buscar café para o gestor" leva o café até a mesa dele.
  static readonly ACOES = ['ficar', 'mesa', 'bebedouro', 'cafe', 'sofa', 'janela', 'planta', 'tv', 'buscar_cafe_gestor', 'buscar_agua_gestor', 'ir_ate_gestor'] as const;
  private ferramentaDeAcao(f: Funcionario) {
    return tool(
      'fazer_no_escritorio',
      'Faz algo de verdade no escritório: ir à mesa, ao bebedouro, à cafeteira, ao sofá, à janela, regar a planta, ver TV, ir até a mesa do gestor, ou buscar café/água para o gestor (leva até ele). Use quando decidir fazer algo ou quando o gestor pedir.',
      { acao: z.enum(Orquestrador.ACOES), com: z.string().optional().describe('id de um colega, se for conversar com alguém') },
      async ({ acao, com }) => {
        this.agir(f, acao, com);
        return { content: [{ type: 'text' as const, text: `Feito: você foi ${acao.replace(/_/g, ' ')}.` }] };
      },
      SEMPRE,
    );
  }
  // Conversa de verdade entre colegas: quem fala vai até o outro, o outro
  // responde com a própria cabeça (persona, fatos e memória dele) e os dois lembram.
  private falandoCom = new Set<string>();
  async conversarComColega(de: Funcionario, paraId: string, mensagem: string): Promise<string> {
    const para = this.funcionario(paraId);
    if (!para) return `Não há ninguém chamado "${paraId}" na equipe. Equipe: ${this.estado.equipe.map((x) => `${x.nome} (id "${x.id}")`).join(', ')}.`;
    if (para.id === de.id) return 'Você não pode falar com você mesmo.';
    if (para.ferias) return `${para.nome} está de férias.`;
    if (this.falandoCom.has(`${para.id}>${de.id}`)) return `${para.nome} está falando com você agora mesmo: responda direto a ele.`;
    const chave = `${de.id}>${para.id}`;
    this.falandoCom.add(chave);
    try {
      this.doEscritorio({ tipo: 'vida', funcionario: de.id, acao: 'ir_ate_colega', para: para.id, fala: encurtar(mensagem, 200) });
      this.lembrar(de.id, 'disse', mensagem, para.nome);
      this.lembrar(para.id, 'ouviu', mensagem, de.nome);
      const prompt = `${this.fatosPara(para)}\n\n[Colega] ${de.nome} (${tituloDe(de)}) veio até você${this.trabalhando(para.id) ? ' enquanto você trabalha' : ''} e disse:\n${mensagem}\n\nResponda a ${de.nome} como colega de trabalho, curto e de verdade. Se ele pedir um trabalho seu, você pode começar (comecar_tarefa).`;
      const resposta = await Promise.race([
        this.personaDe(para).falar(prompt),
        new Promise<string>((r) => setTimeout(() => r(''), 120_000)),
      ]);
      const r = semMarcacao(resposta).trim();
      if (!r) return `${para.nome} não respondeu agora.`;
      this.lembrar(para.id, 'disse', r, de.nome);
      this.lembrar(de.id, 'ouviu', r, para.nome);
      this.doEscritorio({ tipo: 'vida', funcionario: para.id, para: de.id, fala: encurtar(r, 220) });
      return `${para.nome} respondeu: ${r}`;
    } finally {
      this.falandoCom.delete(chave);
      setTimeout(() => this.doEscritorio({ tipo: 'vida', funcionario: de.id, acao: this.trabalhando(de.id) ? 'mesa' : 'mesa' }), 6000);
    }
  }
  private ferramentaDeConversa(f: Funcionario) {
    return tool(
      'falar_com_colega',
      'Vai até um colega e fala com ele de verdade (pergunta, combina algo, passa um recado, pede ajuda). A resposta dele volta para você. Use quando o gestor pedir para falar com alguém, ou quando você precisar de alguém da equipe.',
      { colega: z.string().describe('id ou nome do colega'), mensagem: z.string().describe('o que você diz a ele, completo') },
      async ({ colega, mensagem }) => ({ content: [{ type: 'text' as const, text: await this.conversarComColega(f, colega, mensagem) }] }),
      SEMPRE,
    );
  }

  private lembrar(id: string, tipo: 'pensou' | 'disse' | 'ouviu' | 'fez', texto: string, com?: string) {
    const v = (this.estado.vida ??= {});
    const l = (v[id] ??= []);
    l.push({ em: new Date().toISOString(), tipo, texto: encurtar(texto, 240), ...(com ? { com } : {}) });
    if (l.length > 20) l.splice(0, l.length - 20);
    this.salvar();
  }
  private agir(f: Funcionario, acao: string, com?: string) {
    if (!(Orquestrador.ACOES as readonly string[]).includes(acao) || acao === 'ficar') return;
    const nomes: Record<string, string> = { mesa: 'voltou para a mesa', bebedouro: 'foi ao bebedouro', cafe: 'foi pegar um café', sofa: 'sentou no sofá', janela: 'foi olhar pela janela', planta: 'regou a planta', tv: 'foi ver a TV', buscar_cafe_gestor: 'buscou um café para o gestor', buscar_agua_gestor: 'buscou água para o gestor', ir_ate_gestor: 'foi até a mesa do gestor' };
    this.lembrar(f.id, 'fez', nomes[acao] ?? acao);
    this.doEscritorio({ tipo: 'vida', funcionario: f.id, acao, ...(com ? { para: com } : {}) });
  }
  private ultimoMomento = new Map<string, number>();
  private relogioVida?: NodeJS.Timeout;
  private iniciarVida() {
    clearInterval(this.relogioVida);
    this.relogioVida = setInterval(() => {
      if (!this.estado.aberto || this.encerrando || this.almocoAte || !this.estado.boasVindas) return;
      const livres = this.estado.equipe.filter((x) => !x.ferias && !this.trabalhando(x.id) && !this.ocupado(x.id) && !this.personas.get(x.id)?.ocupada && Date.now() - (this.ultimoMomento.get(x.id) ?? 0) > 4 * 60_000);
      if (!livres.length) return;
      const f = livres[Math.floor(Math.random() * livres.length)];
      this.momentoLivre(f).catch(() => {});
    }, 75_000);
    this.relogioVida.unref?.();
  }
  // Um momento livre: a pessoa pensa e decide o que dizer e fazer. Fica na memória dela.
  private async momentoLivre(f: Funcionario, ouviu?: { de: Funcionario; fala: string }, profundidade = 0) {
    this.ultimoMomento.set(f.id, Date.now());
    const livres = this.estado.equipe.filter((x) => x.id !== f.id && !x.ferias && !this.trabalhando(x.id)).map((x) => `${x.nome} (id "${x.id}")`);
    const trabalhando = this.estado.equipe.filter((x) => x.id !== f.id && this.trabalhando(x.id)).map((x) => x.nome);
    const recente = this.estado.diario.slice(-4).map((d) => `${this.quando(d.em, d.data)}, ${this.nomeDe(d.quem)}: ${encurtar(d.texto, 90)}`);
    const prompt = [
      this.fatosPara(f),
      '',
      ouviu
        ? `[Momento livre] ${ouviu.de.nome} acabou de te dizer: "${ouviu.fala}". Ninguém mais falou com você.`
        : '[Momento livre] Ninguém falou com você agora. Você está no escritório, sem tarefa no momento.',
      `Colegas livres: ${livres.join(', ') || 'ninguém'}. Trabalhando: ${trabalhando.join(', ') || 'ninguém'}.`,
      recente.length ? `Aconteceu há pouco: ${recente.join(' | ')}` : '',
      'Pense como você mesmo, de verdade, no seu dia (sua vida, seu humor, o trabalho, os colegas). Não repita o que já pensou ou disse antes. Falar é opcional: muita gente só pensa.',
      'Responda SÓ neste formato, 4 linhas:',
      'PENSA: <o que você pensa agora, 1 frase>',
      'DIZ: <o que você fala em voz alta, curto, ou "nada">',
      'PARA: <id do colega com quem fala, ou "ninguém">',
      `FAZ: <uma de: ${Orquestrador.ACOES.filter((a) => !a.includes('gestor')).join(', ')}, computador>`,
      'NO PC: <se FAZ for computador: o que você vai fazer de pessoal no seu computador (ex.: pesquisar sobre o seu hobby, salvar umas fotos de algo que você ama, anotar uma receita), senão "nada">',
    ].filter(Boolean).join('\n');
    const r = await this.personaDe(f).falar(prompt);
    const campo = (n: string) => r.match(new RegExp(`^\\s*${n}:\\s*(.+)$`, 'im'))?.[1]?.trim() ?? '';
    const pensa = semMarcacao(campo('PENSA'));
    let diz = semMarcacao(campo('DIZ')).replace(/^["“]|["”]$/g, '');
    if (/^(nada|-|—)$/i.test(diz)) diz = '';
    const paraId = slug(campo('PARA'));
    const para = this.estado.equipe.find((x) => x.id === paraId && x.id !== f.id);
    const faz = campo('FAZ').toLowerCase().replace(/[^a-z_]/g, '');
    if (pensa) this.lembrar(f.id, 'pensou', pensa);
    if (diz) {
      this.lembrar(f.id, 'disse', diz, para?.nome);
      if (para) this.lembrar(para.id, 'ouviu', diz, f.nome);
    }
    this.doEscritorio({ tipo: 'vida', funcionario: f.id, ...(diz ? { fala: diz } : {}), ...(para ? { para: para.id } : {}), ...(pensa ? { pensamento: pensa } : {}) });
    const noPc = semMarcacao(campo('NO PC'));
    if (faz === 'computador' && noPc && !/^nada$/i.test(noPc)) {
      if (!this.atividadePessoal(f, noPc)) this.agir(f, 'mesa');
    } else if ((Orquestrador.ACOES as readonly string[]).includes(faz) && !faz.includes('gestor')) this.agir(f, faz, para?.id);
    // o colega responde de verdade (no máximo uma volta)
    if (diz && para && profundidade < 1 && !this.trabalhando(para.id) && !para.ferias) {
      setTimeout(() => { this.momentoLivre(para, { de: f, fala: diz }, profundidade + 1).catch(() => {}); }, 3500);
    }
  }

  private ferramentasDoFuncionario(f: Funcionario) {
    const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
    return {
      nomes: ['comecar_tarefa', 'pensar_melhor'],
      servidor: createSdkMcpServer({
        name: 'escritorio',
        version: '1.1.0',
        tools: [
          this.ferramentaDeAcao(f),
          this.ferramentaDeConversa(f),
          tool(
            'comecar_tarefa',
            'Vai para a sua mesa fazer um trabalho que o gestor pediu. É o ÚNICO jeito de trabalhar: use sempre que o gestor pedir para criar, mudar, consertar, testar, pesquisar ou escrever algo.',
            { tarefa: z.string().describe('a tarefa completa e autocontida') },
            async ({ tarefa }) => {
              setTimeout(() => {
                try {
                  this.tarefa(f.id, tarefa, 'voce');
                } catch (e) {
                  this.mensagem(f.id, 'voce', `Não consegui começar: ${(e as Error).message}`);
                }
              }, 800);
              return texto('Combinado: você vai para a sua mesa assim que terminar de falar.');
            },
            SEMPRE,
          ),
          tool(
            'pensar_melhor',
            'Para pergunta técnica, complexa ou que precise olhar os arquivos: você vai pensar com calma e a resposta completa chega logo depois.',
            { pergunta: z.string().describe('a pergunta do gestor, completa') },
            async ({ pergunta }) => {
              setTimeout(() => this.pensarMelhor(f, pergunta), 200);
              return texto('Ok: você vai pensar com calma; responda agora só algo curto e natural.');
            },
            SEMPRE,
          ),
        ],
      }),
    };
  }

  // Ferramentas da persona do chefe: a parte rápida conversa; planejar chama a
  // parte inteligente (Opus) que delega e revisa.
  private ferramentasDaPersonaChefe(chefe: Funcionario) {
    const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
    return {
      nomes: ['planejar', 'anotar_relatorio', 'recomendar_equipe'],
      servidor: createSdkMcpServer({
        name: 'escritorio',
        version: '1.1.0',
        tools: [
          this.ferramentaDeAcao(chefe),
          this.ferramentaDeConversa(chefe),
          tool(
            'planejar',
            'Para trabalho novo, planejar, delegar, revisar ou responder dúvida do projeto: você pensa com calma (vê a equipe, delega tarefas, pede contratação) e a resposta detalhada chega logo depois.',
            { pedido: z.string().describe('o pedido do gestor, completo') },
            async ({ pedido }) => {
              setTimeout(() => this.avisarChefe(pedido, true), 200);
              return texto('Ok: você vai organizar com calma; responda agora só algo curto.');
            },
            SEMPRE,
          ),
          tool(
            'anotar_relatorio',
            'Registra no relatório do escritório o que você entendeu (substitui o texto da seção).',
            { secao: z.string().describe('"O escritório", "Projeto principal", "Objetivos", "Como trabalhamos" ou "Próximos passos"'), texto: z.string().describe('o que anotar, claro e completo') },
            async ({ secao, texto: t }) => {
              this.anotarRelatorio(secao, t);
              return texto('Anotado.');
            },
            SEMPRE,
          ),
          tool(
            'recomendar_equipe',
            'Recomenda ao gestor a equipe para começar. Abre a tela de contratação com estes cargos.',
            { itens: z.array(z.object({ cargo: z.string().describe('id do cargo (da lista dos fatos)'), motivo: z.string() })).min(1).max(6) },
            async ({ itens }) => {
              const validos = itens.filter((i) => CARGOS[i.cargo] && i.cargo !== 'chefe');
              if (!validos.length) return { ...texto(`Nenhum cargo válido. Use: ${area(this.estado.escritorio?.area).cargos.join(', ')}`), isError: true };
              this.estado.recomendacao = validos;
              this.salvar();
              this.anotarRelatorio('Equipe recomendada', validos.map((i) => `- ${CARGOS[i.cargo].titulo}: ${i.motivo}`).join('\n'));
              this.doEscritorio({ tipo: 'recomendacao', itens: validos });
              return texto('Recomendação enviada; a tela de contratação vai abrir para o gestor.');
            },
            SEMPRE,
          ),
        ],
      }),
    };
  }

  // O relatório do chefe vira ESCRITORIO.md no projeto (com commit próprio).
  private relatorioTimer?: NodeJS.Timeout;
  anotarRelatorio(secao: string, texto: string) {
    this.estado.relatorio[String(secao).slice(0, 60)] = String(texto).slice(0, 4000);
    this.salvar();
    this.doEscritorio({ tipo: 'relatorio', secoes: this.estado.relatorio });
    clearTimeout(this.relatorioTimer);
    this.relatorioTimer = setTimeout(() => this.gravarRelatorio(), 3000);
  }
  private gravarRelatorio() {
    try {
      const esc = this.escritorio();
      const e = this.estado;
      const md = [
        `# ${e.escritorio?.nome ?? 'Escritório'}`,
        '',
        `Área: ${area(e.escritorio?.area).nome} · Relatório de ${this.chefe?.nome ?? 'o chefe'} · atualizado em ${new Date().toLocaleString('pt-BR')}`,
        '',
        ...Object.entries(e.relatorio).flatMap(([k, v]) => [`## ${k}`, '', v, '']),
      ].join('\n');
      fs.writeFileSync(path.join(esc.projeto, 'ESCRITORIO.md'), md);
      fs.writeFileSync(path.join(this.pastaDrive(), 'Documentos', 'Relatório do escritório.md'), md);
      esc.commitPrincipal('ESCRITORIO.md', `Relatório do escritório (${this.chefe?.nome ?? 'chefe'})`);
    } catch {}
  }

  // Primeira contratação: a entrevista vira operação.
  private comecarOperacao() {
    if (this.estado.fase !== 'entrevista') return;
    this.estado.fase = 'operando';
    this.salvar();
    const rel = Object.entries(this.estado.relatorio).map(([k, v]) => `${k}: ${v}`).join('\n');
    this.recados.push(`[Aviso do escritório] A entrevista com o gestor terminou e a equipe começou a ser contratada. Relatório do escritório:\n${rel || '(vazio)'}`);
  }

  // ---------- o chefe ----------
  private filaChefe: string[] = [];
  private chefeOcupado = false;

  private avisarChefe(texto: string, responder: boolean) {
    if (!responder) {
      this.recados.push(texto);
      return;
    }
    this.filaChefe.push([...this.recados.splice(0), texto].join('\n\n'));
    this.proximoDoChefe();
  }

  private async proximoDoChefe() {
    if (this.chefeOcupado || !this.filaChefe.length || this.encerrando) return;
    const chefe = this.chefe;
    if (!chefe) return;
    if (this.almocoAte) {
      if (!this.avisadoOcupado.has(chefe.id)) {
        this.avisadoOcupado.add(chefe.id);
        this.mensagem(chefe.id, 'voce', `A equipe está no almoço (a cota renova às ${horaCurta(this.almocoAte)}). Eu te respondo na volta!`);
      }
      return;
    }
    this.avisadoOcupado.delete(chefe.id);
    this.chefeOcupado = true;
    const prompt = this.filaChefe.splice(0).join('\n\n');
    try {
      let r = await this.turnoDoChefe(chefe, prompt);
      if (r.falhou && this.estado.sessaoChefe) {
        this.estado.sessaoChefe = undefined;
        this.salvar();
        r = await this.turnoDoChefe(chefe, prompt);
      }
      if (r.resposta?.trim()) this.mensagem(chefe.id, 'voce', r.resposta.trim());
    } finally {
      this.chefeOcupado = false;
      this.proximoDoChefe();
    }
  }

  private async turnoDoChefe(chefe: Funcionario, prompt: string): Promise<{ resposta?: string; falhou: boolean }> {
    const projeto = this.estado.projeto!;
    let resposta: string | undefined;
    let falhou = false;
    const sessao = this.novaSessao(
      {
        pasta: projeto.pasta,
        funcionario: chefe.id,
        tarefa: prompt,
        modelo: chefe.modelo,
        retomar: this.estado.sessaoChefe,
        instrucoes: this.instrucoesDoChefe(chefe),
        conversa: true,
        mcpServers: { escritorio: this.ferramentasDoChefe(chefe) },
        // Só as ferramentas do escritório dispensam permissão. Read/Glob/Grep
        // passam pelo canUseTool, que barra qualquer caminho fora do projeto.
        ferramentasLiberadas: ['ver_equipe', 'delegar_tarefa', 'pedir_contratacao', 'chamar_ti', 'ver_diario'].map((n) => `mcp__escritorio__${n}`),
        ferramentasProibidas: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent'],
      },
      { funcionario: chefe.id, projeto: projeto.pasta, tarefa: prompt, conversa: true },
    );
    sessao.on('evento', (ev: Evento) => {
      if (ev.tipo === 'cli_pronta') {
        this.estado.sessaoChefe = ev.sessionIdCli;
        this.salvar();
      }
      if (ev.tipo === 'tarefa_terminada') {
        falhou = !ev.sucesso;
        resposta = ev.sucesso ? ev.resultado : `Tive um problema agora (${ev.subtipo}). Pode repetir?`;
      }
      if (ev.tipo === 'erro') {
        falhou = true;
        resposta = `Tive um problema agora: ${ev.mensagem}`;
      }
    });
    await this.sessoes.get(sessao.id)!.fim;
    return { resposta, falhou };
  }

  private instrucoesDoChefe(chefe: Funcionario): string {
    const p = this.estado.projeto!;
    const daArea = area(this.estado.escritorio?.area).cargos;
    const cargos = daArea.map((c) => `${c} (${CARGOS[c].titulo}: ${CARGOS[c].verdade})`).join('; ');
    const rel = Object.entries(this.estado.relatorio).map(([k, v]) => `${k}: ${encurtar(v, 400)}`).join('\n');
    return [
      `Você é ${chefe.nome}, chefe de equipe de um pequeno escritório de IA. Fale sempre em português do Brasil.`,
      'Quem fala com você é o gestor (o usuário, dono do escritório). Mensagens que começam com "[Aviso do escritório]" são avisos automáticos, não do gestor.',
      `Você é ${tituloDe(chefe)} do escritório "${this.estado.escritorio?.nome ?? p.nome}" (área: ${area(this.estado.escritorio?.area).nome}).`,
      `Projeto: "${p.nome}"${p.descricao ? ` — ${p.descricao}` : ''}. Repositório git em ${p.pasta}.`,
      rel ? `Relatório do escritório (o que você combinou com o gestor):\n${rel}` : '',
      'Você também tem uma parte rápida que conversa com o gestor; ela já respondeu algo curto e passou o pedido para você. Agora responda com o plano/resultado.',
      'Seu trabalho: entender o que o gestor quer, planejar e distribuir o trabalho para a equipe com delegar_tarefa. Você NÃO edita arquivos nem roda comandos. Pode ler o projeto (Read, Glob, Grep) para planejar e revisar.',
      'Cada funcionário trabalha numa cópia própria (git worktree); ao terminar, o trabalho é integrado automaticamente na branch principal, e antes de cada tarefa a cópia dele é atualizada.',
      'Escreva cada tarefa completa e autocontida (o funcionário não vê esta conversa): objetivo, arquivos, critério de pronto, rodar os testes quando fizer sentido, e fazer commit.',
      'Divida trabalho grande em partes e distribua para quem estiver livre. Tarefas dependentes: delegue uma, espere o aviso de que terminou, depois a próxima.',
      `Cargos desta área: ${cargos}. Use o especialista certo para cada coisa.`,
      'Qualidade: quando um júnior entregar algo não trivial e houver sênior livre, peça ao sênior para revisar. Se houver QA, peça ao QA para tentar quebrar antes de dizer ao gestor que está pronto.',
      'Problema de AMBIENTE (dependência, porta ocupada, versão errada) no relato de alguém: use chamar_ti se houver T.I. Bug de código é do programador.',
      'Se não houver ninguém adequado livre, use pedir_contratacao com o cargo e o motivo; o gestor decide. Não peça contratação se já houver alguém adequado: cada pessoa gasta cota.',
      'Use ver_equipe antes de delegar (mostra quem está livre, trabalhando ou de férias). ver_diario mostra o que aconteceu nos últimos expedientes.',
      'Respostas ao gestor: curtas (até 4 frases), diretas, no tom de quem conversa. Texto corrido: nada de markdown, negrito, títulos ou listas. Diga o que vai acontecer e quem vai fazer.',
      'Nunca diga que algo está pronto sem a evidência do relato de quem fez (testes rodados, saída real).',
    ].filter(Boolean).join('\n');
  }

  private ferramentasDoChefe(chefe: Funcionario) {
    const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
    const erro = (t: string) => ({ ...texto(t), isError: true });
    return createSdkMcpServer({
      name: 'escritorio',
      version: '1.0.0',
      tools: [
        tool('ver_equipe', 'Lista a equipe: id, nome, cargo, modelo e se está livre, trabalhando ou de férias.', {}, async () => {
          const linhas = this.estado.equipe
            .filter((f) => f.id !== chefe.id)
            .map((f) => `- id "${f.id}": ${f.nome}, ${CARGOS[f.cargo].titulo} (${f.modelo}), ${f.ferias ? 'DE FÉRIAS' : this.trabalhando(f.id) ? 'TRABALHANDO' : 'livre'}`);
          const almoco = this.almocoAte ? `\nA equipe está no almoço (cota) até ${horaCurta(this.almocoAte)}; tarefas delegadas agora começam na volta.` : '';
          const net = this.estado.internet ? '' : '\nA internet do escritório está desligada.';
          return texto((linhas.length ? linhas.join('\n') : 'Ninguém além de você. Use pedir_contratacao.') + almoco + net);
        }, SEMPRE),
        tool('ver_diario', 'Mostra o diário dos últimos expedientes (entregas, interrupções, contratações).', {}, async () => {
          const d = this.estado.diario.slice(-40).map((e) => `${e.data} ${this.nomeDe(e.quem)}: ${e.texto}`);
          return texto(d.length ? d.join('\n') : 'Diário vazio.');
        }, SEMPRE),
        tool(
          'delegar_tarefa',
          'Entrega uma tarefa a um funcionário livre. Ele trabalha na cópia própria e você recebe um aviso quando terminar.',
          { funcionario: z.string().describe('id do funcionário (veja ver_equipe)'), tarefa: z.string().describe('a tarefa completa e autocontida') },
          async ({ funcionario, tarefa }) => {
            try {
              const r = this.tarefa(funcionario, tarefa, chefe.id);
              return texto(r === 'na-fila' ? 'A equipe está no almoço: a tarefa ficou na fila e começa na volta.' : `Ok: ${this.nomeDe(funcionario)} começou. Você recebe um aviso quando terminar.`);
            } catch (e) {
              return erro(`Não deu: ${(e as Error).message}`);
            }
          },
          SEMPRE,
        ),
        tool(
          'chamar_ti',
          'Chama o T.I. para resolver um problema de AMBIENTE (dependência, porta ocupada, versão errada) na mesa de alguém. Bug de código não é com o T.I.',
          { funcionario: z.string().describe('id de quem está com o problema'), problema: z.string().describe('o erro, com a mensagem real') },
          async ({ funcionario, problema }) => {
            const ti = this.estado.equipe.find((f) => f.cargo === 'ti' && !f.ferias);
            if (!ti) return erro('Não há T.I. na equipe. Se precisar, peça contratação de um T.I.');
            const dono = this.funcionario(funcionario);
            if (!dono) return erro(`não há ninguém chamado "${funcionario}"`);
            try {
              this.tarefa(ti.id, `Meu PC travou! Problema de ambiente na mesa de ${dono.nome}:\n${problema}\n\nResolva o ambiente (não o código). Rode de novo o comando que falhou para provar que resolveu.`, chefe.id, { local: dono.id });
              return texto(`${ti.nome} (T.I.) foi até a mesa de ${dono.nome}. Você recebe um aviso quando terminar.`);
            } catch (e) {
              return erro(`Não deu: ${(e as Error).message}`);
            }
          },
          SEMPRE,
        ),
        tool(
          'pedir_contratacao',
          'Pede ao gestor para contratar alguém. Ele decide; você recebe um aviso com a resposta. Não espere: responda ao gestor.',
          { cargo: z.enum(CARGOS_CONTRATAVEIS as [string, ...string[]]), motivo: z.string().describe('por que precisa, em uma frase') },
          async ({ cargo, motivo }) => {
            const idPedido = randomUUID().slice(0, 8);
            this.contratacoes.set(idPedido, { cargo: cargo as Cargo, motivo, pedidoPor: chefe.id });
            this.doEscritorio({ tipo: 'contratacao_pedida', idPedido, cargo, motivo, pedidoPor: chefe.id });
            return texto('Pedido enviado ao gestor. Avise que pediu e por quê.');
          },
          SEMPRE,
        ),
      ],
    });
  }

  // ---------- a "atriz": agenda do dia ----------
  // Uma vez por dia, um modelo barato (Haiku) busca notícias REAIS e escreve as
  // falas de vida de cada um (conversas de café, ideias). Trabalho não passa
  // por aqui: é só vida.
  async gerarAgenda(forcar = false) {
    if (!this.estado.boasVindas || this.gerandoAgenda || this.almocoAte || this.encerrando) return;
    if (!forcar && this.estado.agenda?.data === hoje()) return this.contarIdeias();
    this.gerandoAgenda = true;
    try {
      const pasta = path.join(PASTA_DADOS, 'atriz');
      fs.mkdirSync(pasta, { recursive: true });
      const p = this.estado.projeto!;
      const equipe = this.estado.equipe
        .filter((f) => !f.ferias)
        .map((f) => {
          const fi = f.ficha ?? fichaDe(f.nome);
          return `- id "${f.id}": ${f.nome}, ${fi.idade} anos, de ${fi.cidade}, ${f.titulo ?? CARGOS[f.cargo]?.titulo ?? f.cargo}. Jeito: ${f.personalidade} Vida: ${fi.familia}; ${fi.pet}; gosta de ${fi.hobbies.join(' e ')}; time: ${fi.time}; música: ${fi.musica}; comida: ${fi.comida}; mania: ${fi.mania}. Humor: ${f.humor ?? 70}/100.`;
        })
        .join('\n');
      const entregasFeitas = this.estado.diario.filter((d) => d.texto.startsWith('Entregou'));
      const temTrabalho = entregasFeitas.length > 0;
      let arquivos = '';
      try {
        arquivos = execFileSync('git', ['ls-files'], { cwd: p.pasta, encoding: 'utf8' }).split('\n').filter(Boolean).slice(0, 80).join(', ');
      } catch {}
      const entregas = entregasFeitas.slice(-6).map((d) => encurtar(d.texto, 120)).join(' | ');
      const prompt = [
        `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
        'Você escreve a "vida" de um jogo de escritório em pixel art. Faça três coisas:',
        this.estado.internet
          ? '1) Use WebSearch para achar 5 notícias REAIS de hoje ou de ontem (tecnologia, IA, ciência e Brasil). Nunca invente: só o que achou, com a fonte e o link.'
          : '1) A internet está desligada: deixe "jornal" vazio.',
        '2) Para cada pessoa da equipe abaixo, "vida": uma frase (até 160 caracteres) sobre o que ela fez ontem ou no fim de semana, coerente com a vida dela (família, pet, hobbies, time). Pessoas de verdade, com vida própria.',
        '3) Para cada pessoa, 5 falas curtas (até 90 caracteres) de conversa de escritório, no jeito dela: a maioria sobre a vida dela, as notícias, o tempo, o time, a comida; no máximo uma sobre trabalho. Ninguém promete ou relata trabalho nessas falas.',
        temTrabalho
          ? `4) Para no máximo 2 pessoas (exceto o chefe), uma ideia de melhoria para o projeto "${p.nome}", em primeira pessoa, até 140 caracteres, baseada no que JÁ EXISTE (arquivos e entregas abaixo). Sem ideia genérica: se não houver algo concreto para melhorar, deixe "ideias" vazio.\nArquivos do projeto: ${arquivos}\nEntregas recentes: ${entregas}`
          : '4) O projeto ainda não começou: deixe "ideias" vazio.',
        `Equipe:\n${equipe}`,
        'Responda SÓ com um JSON, sem texto antes ou depois: {"jornal":[{"titulo":"","fonte":"","url":"","resumo":""}],"vida":{"<id>":""},"falas":{"<id>":["",""]},"ideias":{"<id>":""}}',
      ].join('\n');
      const sessao = this.novaSessao(
        {
          pasta,
          tarefa: prompt,
          modelo: 'haiku',
          ferramentasProibidas: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent', 'Read', 'Glob', 'Grep', 'WebFetch'],
        },
        { tarefa: 'agenda do dia', interno: true, autoAprovar: true },
      );
      let resultado = '';
      sessao.on('evento', (ev: Evento) => {
        if (ev.tipo === 'tarefa_terminada' && ev.sucesso) resultado = ev.resultado ?? '';
      });
      await this.sessoes.get(sessao.id)!.fim;
      const json = resultado.slice(resultado.indexOf('{'), resultado.lastIndexOf('}') + 1);
      const bruto = JSON.parse(json);
      const agenda: Agenda = {
        data: hoje(),
        jornal: (Array.isArray(bruto.jornal) ? bruto.jornal : [])
          .filter((n: any) => n?.titulo && n?.fonte)
          .slice(0, 8)
          .map((n: any) => ({ titulo: String(n.titulo).slice(0, 200), fonte: String(n.fonte).slice(0, 80), url: n.url ? String(n.url).slice(0, 500) : undefined, resumo: String(n.resumo ?? '').slice(0, 300) })),
        falas: Object.fromEntries(
          Object.entries(bruto.falas ?? {}).filter(([id]) => this.funcionario(id)).map(([id, l]) => [id, (Array.isArray(l) ? l : []).map((x) => String(x).slice(0, 120)).slice(0, 6)]),
        ),
        ideias: temTrabalho ? Object.fromEntries(Object.entries(bruto.ideias ?? {}).filter(([id, t]) => this.funcionario(id) && String(t).trim()).slice(0, 2).map(([id, t]) => [id, String(t).slice(0, 200)])) : {},
        vida: Object.fromEntries(Object.entries(bruto.vida ?? {}).filter(([id]) => this.funcionario(id)).map(([id, t]) => [id, String(t).slice(0, 200)])),
      };
      this.estado.agenda = agenda;
      this.salvar();
      this.doEscritorio({ tipo: 'agenda', agenda });
      this.contarIdeias();
    } catch {
      // Sem agenda hoje: a vida usa as falas de sempre.
    } finally {
      this.gerandoAgenda = false;
    }
  }

  // Iniciativa: quem está de bom humor vem contar a ideia do dia ao gestor
  // (uma por pessoa por dia). Quem está chateado guarda para si.
  private contarIdeias() {
    const agenda = this.estado.agenda;
    if (!agenda || agenda.data !== hoje()) return;
    if (!this.estado.diario.some((d) => d.texto.startsWith('Entregou'))) return; // nada construído: nada de ideia
    let atraso = 60_000;
    for (const [id, ideia] of Object.entries(agenda.ideias)) {
      const f = this.funcionario(id);
      const marca = `${id}:${hoje()}`;
      if (!f || f.ferias || (f.humor ?? 70) < 60 || this.estado.ideiasDitas.includes(marca)) continue;
      this.estado.ideiasDitas.push(marca);
      setTimeout(() => {
        if (!this.encerrando && !this.trabalhando(id)) this.mensagem(id, 'voce', `Ei, tive uma ideia: ${ideia}`);
      }, atraso).unref();
      atraso += 120_000;
    }
    this.salvar();
  }

  // ---------- a máquina ----------
  // Carga real do computador → temperatura do escritório (princípio 2).
  ultimaMaquina?: { carga: number; temperatura: number; nucleos: number };
  private iniciarMaquina() {
    clearInterval(this.relogioMaquina);
    let ultimaVez = 0;
    const medir = () => {
      const nucleos = os.cpus().length || 1;
      const carga = Math.round((os.loadavg()[0] / nucleos) * 100) / 100;
      const temperatura = Math.round(21 + Math.min(1.5, carga) * 9);
      const antes = this.ultimaMaquina;
      if (!antes || Math.abs(antes.carga - carga) >= 0.08 || Date.now() - ultimaVez > 60_000) {
        this.ultimaMaquina = { carga, temperatura, nucleos };
        ultimaVez = Date.now();
        this.doEscritorio({ tipo: 'maquina', ...this.ultimaMaquina });
      }
    };
    medir();
    this.relogioMaquina = setInterval(medir, 10_000);
    this.relogioMaquina.unref();
  }

  // ---------- o cofre (histórico e desfazer) ----------
  historico() {
    return this.escritorio().historico();
  }
  detalheDoHistorico(hash: string) {
    return this.escritorio().mostrar(hash);
  }
  desfazer(hash: string) {
    const assunto = this.escritorio().desfazer(hash);
    this.doEscritorio({ tipo: 'cofre', acao: 'desfeito', hash, assunto });
    this.diario('voce', `Desfez pelo cofre: ${assunto}`);
    this.recados.push(`[Aviso do escritório] O gestor desfez pelo cofre: "${assunto}". A branch principal voltou ao estado anterior a essa entrega.`);
    return assunto;
  }

  // ---------- os computadores ----------
  // Onde fica cada computador: o da mesa de alguém, o do gestor, ou a pasta principal.
  pastaDoComputador(alvo: string): string {
    if (alvo === 'drive' || alvo === 'compartilhados') return this.pastaDrive();
    if (alvo.startsWith('pessoal-')) return this.pastaPessoal(alvo.slice(8));
    const esc = this.escritorio();
    if (alvo === 'principal') return esc.projeto;
    if (alvo === 'voce') return esc.mesa('voce').pasta;
    if (alvo === 'drive' || alvo === 'compartilhados') return this.pastaDrive();
    if (alvo.startsWith('pessoal-')) return this.pastaPessoal(alvo.slice(8));
    const f = this.funcionario(alvo);
    if (!f) throw new Error('computador desconhecido');
    return esc.mesa(f.id).pasta;
  }

  // O gestor também trabalha: o que ele fizer na própria mesa entra na principal.
  entregarMeuTrabalho() {
    const esc = this.escritorio();
    const mesa = esc.mesa('voce');
    esc.salvarMesa(mesa, 'Você');
    const integ = esc.integrar(mesa, 'Você');
    this.doEscritorio({ tipo: 'integracao', funcionario: 'voce', ...integ });
    if (integ.commits) this.diario('voce', `Entregou o próprio trabalho (${integ.mensagem}).`);
    return integ;
  }

  // Arquivos do computador (o app "Arquivos" e o editor). Nunca sai da pasta
  // daquele computador nem mexe no .git.
  caminhoSeguro(alvo: string, relativo = '') {
    const base = this.pastaDoComputador(alvo);
    const abs = path.resolve(base, String(relativo).replace(/^\/+/, ''));
    const rel = path.relative(base, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('fora da pasta deste computador');
    if (rel.split(path.sep)[0] === '.git') throw new Error('a pasta .git não é mexida por aqui');
    return { base, abs, rel };
  }

  listarArquivos(alvo: string, relativo = '') {
    const { abs, rel } = this.caminhoSeguro(alvo, relativo);
    const idx = alvo === 'drive' ? this.indiceDrive() : {};
    const itens = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => d.name !== '.git' && !(alvo === 'drive' && d.name === '.indice.json'))
      .map((d) => {
        const st = fs.statSync(path.join(abs, d.name));
        const i = idx[rel ? `${rel}/${d.name}` : d.name];
        const dentro = d.isDirectory() ? (() => { try { return fs.readdirSync(path.join(abs, d.name)).filter((n) => n !== '.git').length; } catch { return 0; } })() : undefined;
        return { nome: d.name, pasta: d.isDirectory(), tamanho: st.size, modificado: st.mtime.toISOString(), criado: st.birthtime.toISOString(), ...(dentro !== undefined ? { itens: dentro } : {}), ...(i?.de ? { de: i.de } : {}), ...(i?.recado ? { recado: i.recado } : {}) };
      })
      .sort((a, b) => (a.pasta === b.pasta ? a.nome.localeCompare(b.nome) : a.pasta ? -1 : 1));
    return { caminho: rel === '' ? '' : rel, itens };
  }

  lerArquivo(alvo: string, relativo: string) {
    const { abs, rel } = this.caminhoSeguro(alvo, relativo);
    const st = fs.statSync(abs);
    if (st.isDirectory()) throw new Error('é uma pasta');
    if (st.size > 2_000_000) return { caminho: rel, grande: true, tamanho: st.size };
    const buf = fs.readFileSync(abs);
    const binario = buf.subarray(0, 8000).includes(0);
    return { caminho: rel, tamanho: st.size, ...(binario ? { binario: true } : { texto: buf.toString('utf8') }) };
  }

  salvarArquivo(alvo: string, relativo: string, conteudo: string) {
    const { abs, rel } = this.caminhoSeguro(alvo, relativo);
    if (!rel) throw new Error('dê um nome ao arquivo');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, String(conteudo));
    return { caminho: rel };
  }

  // Vozes da Microsoft (Azure Speech, com a chave do usuário).
  definirVoz(chave: string, regiao: string) {
    this.estado.voz = chave ? { chave: chave.trim(), regiao: (regiao || 'brazilsouth').trim() } : undefined;
    this.salvar();
  }

  criarPasta(alvo: string, relativo: string) {
    const { abs, rel } = this.caminhoSeguro(alvo, relativo);
    if (!rel) throw new Error('dê um nome à pasta');
    if (fs.existsSync(abs)) throw new Error('já existe algo com esse nome');
    fs.mkdirSync(abs, { recursive: true });
    return { caminho: rel };
  }

  criarArquivo(alvo: string, relativo: string) {
    const { abs, rel } = this.caminhoSeguro(alvo, relativo);
    if (!rel) throw new Error('dê um nome ao arquivo');
    if (fs.existsSync(abs)) throw new Error('já existe algo com esse nome');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, '');
    return { caminho: rel };
  }

  renomear(alvo: string, de: string, para: string) {
    const a = this.caminhoSeguro(alvo, de);
    const b = this.caminhoSeguro(alvo, para);
    if (!a.rel || !b.rel) throw new Error('nome inválido');
    if (!fs.existsSync(a.abs)) throw new Error('não encontrei esse item');
    if (fs.existsSync(b.abs)) throw new Error('já existe algo com esse nome');
    fs.mkdirSync(path.dirname(b.abs), { recursive: true });
    fs.renameSync(a.abs, b.abs);
    return { caminho: b.rel };
  }

  // Lixeira do escritório (fora do projeto, persiste entre dias): dá para desfazer.
  private arquivoLixeira() { return path.join(PASTA_DADOS, 'lixeira', 'indice.json'); }
  private lerLixeira(): Record<string, { origem: string; guardado: string; alvo: string; caminho: string; em: string; pasta: boolean }> {
    try { return JSON.parse(fs.readFileSync(this.arquivoLixeira(), 'utf8')); } catch { return {}; }
  }
  private gravarLixeira(l: ReturnType<Orquestrador['lerLixeira']>) {
    fs.mkdirSync(path.dirname(this.arquivoLixeira()), { recursive: true });
    fs.writeFileSync(this.arquivoLixeira(), JSON.stringify(l, null, 1));
  }
  private moverFisico(de: string, para: string) {
    fs.mkdirSync(path.dirname(para), { recursive: true });
    try { fs.renameSync(de, para); } catch { fs.cpSync(de, para, { recursive: true }); fs.rmSync(de, { recursive: true, force: true }); }
  }
  apagar(alvo: string, relativo: string) {
    const { abs, rel } = this.caminhoSeguro(alvo, relativo);
    if (!rel) throw new Error('não dá para apagar a pasta inteira do computador');
    if (!fs.existsSync(abs)) throw new Error('não encontrei esse item');
    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const guardado = path.join(PASTA_DADOS, 'lixeira', id, path.basename(abs));
    const pasta = fs.statSync(abs).isDirectory();
    this.moverFisico(abs, guardado);
    const l = this.lerLixeira();
    l[id] = { origem: abs, guardado, alvo, caminho: rel, em: new Date().toISOString(), pasta };
    this.gravarLixeira(l);
    return { id, caminho: rel };
  }
  restaurar(id: string) {
    const l = this.lerLixeira();
    const item = l[id];
    if (!item) throw new Error('esse item não está mais na lixeira');
    if (fs.existsSync(item.origem)) throw new Error('já existe algo com esse nome no lugar');
    this.moverFisico(item.guardado, item.origem);
    fs.rmSync(path.dirname(item.guardado), { recursive: true, force: true });
    delete l[id];
    this.gravarLixeira(l);
    return { ok: true, alvo: item.alvo, caminho: item.caminho };
  }
  listarLixeira() {
    return Object.entries(this.lerLixeira()).map(([id, i]) => {
      let tamanho = 0;
      try { tamanho = fs.statSync(i.guardado).size; } catch {}
      return { id, nome: path.basename(i.caminho), alvo: i.alvo, caminho: i.caminho, em: i.em, pasta: i.pasta, tamanho };
    }).sort((a, b) => b.em.localeCompare(a.em));
  }
  esvaziarLixeira() {
    const l = this.lerLixeira();
    for (const i of Object.values(l)) fs.rmSync(path.dirname(i.guardado), { recursive: true, force: true });
    this.gravarLixeira({});
    return { apagados: Object.keys(l).length };
  }
  // Copiar e mover entre lugares (projeto, pasta pessoal, Drive), sem sobrescrever nada.
  transferir(modo: 'copiar' | 'mover', de: { alvo: string; caminho: string }, para: { alvo: string; pasta: string }) {
    const a = this.caminhoSeguro(de.alvo, de.caminho);
    const b = this.caminhoSeguro(para.alvo, para.pasta);
    if (!a.rel) throw new Error('não dá para mover a pasta inteira do computador');
    if (!fs.existsSync(a.abs)) throw new Error(`não encontrei ${de.caminho}`);
    if (!fs.existsSync(b.abs) || !fs.statSync(b.abs).isDirectory()) throw new Error('o destino não é uma pasta');
    if (b.abs === a.abs || b.abs.startsWith(a.abs + path.sep)) throw new Error('não dá para pôr uma pasta dentro dela mesma');
    if (modo === 'mover' && path.dirname(a.abs) === b.abs) return { caminho: a.rel };
    const nome = this.nomeLivre(b.abs, path.basename(a.abs).replace(/^(.*?)( \(\d+\))?(\.[^.]*)?$/, modo === 'copiar' && path.dirname(a.abs) === b.abs ? '$1 (cópia)$3' : '$&'));
    const destino = path.join(b.abs, nome);
    if (modo === 'copiar') fs.cpSync(a.abs, destino, { recursive: true });
    else this.moverFisico(a.abs, destino);
    return { caminho: path.relative(this.pastaDoComputador(para.alvo), destino) };
  }


  private relogioPersonas?: NodeJS.Timeout;
  private agendaNovatos?: NodeJS.Timeout;
  desligarPersonas() {
    for (const p of this.personas.values()) p.desligar();
    this.personas.clear();
  }

  desligar() {
    clearInterval(this.relogioVida);
    for (const r of this.sessoes.values()) r.sessao.parar();
    this.desligarPersonas();
  }
}
