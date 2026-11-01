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
import { spawn } from 'node:child_process';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Sessao, encurtar, type Decisao, type PedidoPermissao } from './sessao.ts';
import { Escritorio, slug } from './escritorio.ts';
import { registrar } from './log.ts';
import { carregar, salvar, hoje, PASTA_DADOS, type Estado, type Pendente } from './estado.ts';
import { CARGOS, candidatos, type Candidato } from './candidatos.ts';
import type { Agenda, Cargo, Evento, Funcionario } from './eventos.ts';

const PASTA_PROJETOS = path.join(os.homedir(), 'escritorio-projetos');
const CARGOS_CONTRATAVEIS = Object.keys(CARGOS).filter((c) => c !== 'chefe') as Exclude<Cargo, 'chefe'>[];
// Ferramentas do escritório sempre visíveis para o modelo (sem precisar de
// ToolSearch); sem isso, quem não "procura" a ferramenta acha que ela não existe.
const SEMPRE = { alwaysLoad: true };
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
  private equipeMudou(motivo: string) {
    this.salvar();
    this.doEscritorio({ tipo: 'equipe', equipe: this.estado.equipe, motivo });
  }

  // ---------- expediente ----------
  // Abre quando o app abre: o chefe chega, a equipe chega, daily, e quem parou
  // no meio de uma tarefa ontem continua de onde parou.
  abrirExpediente() {
    this.iniciarMaquina();
    if (!this.estado.boasVindas) return;
    const luzCaiu = this.estado.aberto;
    this.estado.aberto = true;
    this.encerrando = false;
    this.salvar();
    this.doEscritorio({ tipo: 'equipe', equipe: this.estado.equipe, motivo: 'chegada' });
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
  boasVindas({ nome, descricao = '', pasta }: { nome: string; descricao?: string; pasta?: string }) {
    if (!nome?.trim()) throw new Error('dê um nome ao projeto');
    const destino = path.resolve((pasta?.trim() || path.join(PASTA_PROJETOS, slug(nome))).replace(/^~(?=\/|$)/, os.homedir()));
    Escritorio.abrir(destino); // valida e cria o repositório
    this.estado.projeto = { nome: nome.trim(), pasta: destino, descricao: descricao.trim() };
    if (!this.chefe) this.admitir(candidatos('chefe', [])[0]);
    this.estado.boasVindas = true;
    this.estado.aberto = true;
    this.salvar();
    const chefe = this.chefe!;
    this.equipeMudou('chegada');
    this.doEscritorio({ tipo: 'expediente', fase: 'aberto', luzCaiu: false, daily: `Bem-vindo! Eu sou ${chefe.nome}.` });
    this.mensagem(
      chefe.id,
      'voce',
      `Oi! Eu sou ${chefe.nome} e vou cuidar da equipe do "${this.estado.projeto.nome}". Por enquanto a equipe sou só eu. ` +
        'Me conta o que vamos construir: eu monto o plano, distribuo o trabalho e, se faltar gente, peço para contratar.',
    );
    setTimeout(() => this.gerarAgenda().catch(() => {}), 2000).unref();
  }

  // ---------- equipe: contratar, férias, demitir, humor ----------
  candidatos(cargo: Cargo): Candidato[] {
    if (!CARGOS_CONTRATAVEIS.includes(cargo as any)) throw new Error('cargo inválido');
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
    };
    this.estado.equipe.push(f);
    return f;
  }

  contratar(nome: string, cargo: Cargo): Funcionario {
    const c = this.candidatos(cargo).find((x) => x.nome === nome);
    if (!c) throw new Error(`${nome} não está entre os candidatos de ${CARGOS[cargo]?.titulo ?? cargo}`);
    const f = this.admitir(c);
    this.equipeMudou(`contratou ${f.nome}`);
    this.diario('voce', `Contratou ${f.nome} (${CARGOS[cargo].titulo}).`);
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
      setTimeout(() => this.processarConversa(f.id), 300);
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
    const sessao: Sessao = new Sessao({
      ...opcoes,
      decidirPermissao: (pedido) =>
        reg.autoAprovar || this.estado.aprovarTudo
          ? Promise.resolve({ aprovada: true, motivo: 'aprovação automática ligada' })
          : new Promise((responder) => this.pendentes.set(pedido.idPedido, { sessao: sessao.id, pedido, responder })),
    });
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
    for (const id of this.filas.keys()) this.processarConversa(id);
    this.proximoDoChefe();
  }

  // ---------- conversas ----------
  private mensagem(de: string, para: string, texto: string) {
    const m = { de, para, texto, em: new Date().toISOString() };
    const chave = de === 'voce' ? para : de;
    (this.estado.conversas[chave] ??= []).push(m);
    this.salvar();
    this.doEscritorio({ tipo: 'mensagem', de, para, texto, em: m.em }); // mesmo horário: a tela não duplica
  }

  // O gestor fala com alguém (de perto, ou pelo ramal).
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
    if (f.cargo === 'chefe') {
      this.avisarChefe(texto, true);
      return;
    }
    const fila = this.filas.get(f.id) ?? [];
    fila.push(texto);
    this.filas.set(f.id, fila);
    this.processarConversa(f.id);
  }

  // Compatibilidade: falar com o chefe.
  falarComChefe(texto: string) {
    if (!this.chefe) throw new Error('o escritório ainda não abriu');
    this.conversar(this.chefe.id, texto);
  }

  // Conversa sobre trabalho: quem responde é a própria trabalhadora (a sessão
  // dela é retomada), então o personagem nunca inventa progresso.
  private async processarConversa(id: string) {
    const fila = this.filas.get(id);
    const f = this.funcionario(id);
    if (!fila?.length || !f || this.conversando.has(id)) return;
    if (this.almocoAte) {
      if (!this.avisadoOcupado.has(id)) {
        this.avisadoOcupado.add(id);
        this.mensagem(id, 'voce', `Tô no almoço! Volto às ${horaCurta(this.almocoAte)}.`);
      }
      return;
    }
    if (this.trabalhando(id)) {
      if (!this.avisadoOcupado.has(id)) {
        this.avisadoOcupado.add(id);
        this.mensagem(id, 'voce', 'Tô no meio de uma tarefa. Assim que terminar eu te respondo!');
      }
      return;
    }
    this.avisadoOcupado.delete(id);
    this.conversando.add(id);
    const texto = fila.splice(0).join('\n\n');
    try {
      const r = await this.turnoDeConversa(f, texto);
      if (r.resposta?.trim()) this.mensagem(id, 'voce', r.resposta.trim());
    } finally {
      this.conversando.delete(id);
      if (fila.length) this.processarConversa(id);
    }
  }

  // Cada conversa é uma sessão nova com a memória vinda de dados reais (diário
  // e conversa recente). Retomar a sessão antiga carregava junto conclusões
  // erradas ("não posso trabalhar aqui") e o funcionário travava.
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
      `[Agora o gestor diz]\n${texto}`,
    ].filter(Boolean).join('\n\n');
    const sessao = this.novaSessao(
      {
        ...mesa,
        funcionario: f.id,
        tarefa: prompt,
        modelo: f.modelo,
        instrucoes: [
          `Você é ${f.nome}, ${CARGOS[f.cargo].titulo} no escritório do projeto "${this.estado.projeto?.nome}". Seu jeito: ${f.personalidade}`,
          'O gestor (o usuário, dono do escritório) está falando com você pessoalmente. Responda em português do Brasil, curto (até 3 frases), no seu jeito.',
          'Sobre trabalho, fale só do que você realmente fez (veja sua memória) ou do que está nos arquivos (pode ler o projeto). Nunca invente progresso.',
          'IMPORTANTE: esta é uma conversa, não o seu computador: aqui não há edição de arquivos nem terminal, e isso é normal.',
          'Quando o gestor pedir qualquer trabalho (criar, mudar, consertar, testar, pesquisar, escrever), chame a ferramenta comecar_tarefa com a tarefa completa. É assim que você vai para a sua mesa trabalhar. Depois responda dizendo que vai começar.',
          `Seu humor agora: ${humor >= 65 ? 'animado, com iniciativa' : humor >= 35 ? 'normal' : 'chateado: seco e objetivo, sem iniciativa'}. O humor muda seu tom, nunca a qualidade do trabalho.`,
        ].join('\n'),
        conversa: true,
        mcpServers: { escritorio: this.ferramentasDoFuncionario(f) },
        ferramentasLiberadas: ['mcp__escritorio__comecar_tarefa'],
        ferramentasProibidas: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent', ...(this.estado.internet ? [] : ['WebFetch', 'WebSearch'])],
      },
      { funcionario: f.id, projeto: esc.projeto, tarefa: texto, conversa: true },
    );
    sessao.on('evento', (ev: Evento) => {
      if (ev.tipo === 'tarefa_terminada') {
        falhou = !ev.sucesso;
        resposta = ev.sucesso ? ev.resultado : 'Desculpa, me enrolei aqui. Pode repetir?';
      }
      if (ev.tipo === 'erro') falhou = true;
    });
    await this.sessoes.get(sessao.id)!.fim;
    return { resposta, falhou };
  }

  private ferramentasDoFuncionario(f: Funcionario) {
    return createSdkMcpServer({
      name: 'escritorio',
      version: '1.0.0',
      tools: [
        tool(
          'comecar_tarefa',
          'Vai para a sua mesa fazer um trabalho que o gestor pediu. É o ÚNICO jeito de trabalhar: use sempre que o gestor pedir para criar, mudar, consertar, testar, pesquisar ou escrever algo. Começa logo depois desta resposta.',
          { tarefa: z.string().describe('a tarefa completa e autocontida') },
          async ({ tarefa }) => {
            setTimeout(() => {
              try {
                this.tarefa(f.id, tarefa, 'voce');
              } catch (e) {
                this.mensagem(f.id, 'voce', `Não consegui começar: ${(e as Error).message}`);
              }
            }, 1500);
            return { content: [{ type: 'text' as const, text: 'Combinado: a tarefa começa assim que esta conversa terminar.' }] };
          },
          SEMPRE,
        ),
      ],
    });
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
    const cargos = CARGOS_CONTRATAVEIS.map((c) => `${c} (${CARGOS[c].titulo}: ${CARGOS[c].verdade})`).join('; ');
    return [
      `Você é ${chefe.nome}, chefe de equipe de um pequeno escritório de IA. Fale sempre em português do Brasil.`,
      'Quem fala com você é o gestor (o usuário, dono do escritório). Mensagens que começam com "[Aviso do escritório]" são avisos automáticos, não do gestor.',
      `Projeto: "${p.nome}"${p.descricao ? ` — ${p.descricao}` : ''}. Repositório git em ${p.pasta}.`,
      'Seu trabalho: entender o que o gestor quer, planejar e distribuir o trabalho para a equipe com delegar_tarefa. Você NÃO edita arquivos nem roda comandos. Pode ler o projeto (Read, Glob, Grep) para planejar e revisar.',
      'Cada funcionário trabalha numa cópia própria (git worktree); ao terminar, o trabalho é integrado automaticamente na branch principal, e antes de cada tarefa a cópia dele é atualizada.',
      'Escreva cada tarefa completa e autocontida (o funcionário não vê esta conversa): objetivo, arquivos, critério de pronto, rodar os testes quando fizer sentido, e fazer commit.',
      'Divida trabalho grande em partes e distribua para quem estiver livre. Tarefas dependentes: delegue uma, espere o aviso de que terminou, depois a próxima.',
      `Cargos que existem: ${cargos}. Use o especialista certo para cada área.`,
      'Qualidade: quando um júnior entregar algo não trivial e houver sênior livre, peça ao sênior para revisar. Se houver QA, peça ao QA para tentar quebrar antes de dizer ao gestor que está pronto.',
      'Problema de AMBIENTE (dependência, porta ocupada, versão errada) no relato de alguém: use chamar_ti se houver T.I. Bug de código é do programador.',
      'Se não houver ninguém adequado livre, use pedir_contratacao com o cargo e o motivo; o gestor decide. Não peça contratação se já houver alguém adequado: cada pessoa gasta cota.',
      'Use ver_equipe antes de delegar (mostra quem está livre, trabalhando ou de férias). ver_diario mostra o que aconteceu nos últimos expedientes.',
      'Respostas ao gestor: curtas (até 4 frases), diretas, sem títulos nem listas longas. Diga o que vai acontecer e quem vai fazer.',
      'Nunca diga que algo está pronto sem a evidência do relato de quem fez (testes rodados, saída real).',
    ].join('\n');
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
        .map((f) => `- id "${f.id}": ${f.nome}, ${CARGOS[f.cargo].titulo}. Jeito: ${f.personalidade} Humor: ${f.humor ?? 70}/100.`)
        .join('\n');
      const prompt = [
        `Hoje é ${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
        'Você escreve a "vida" de um jogo de escritório em pixel art. Faça três coisas:',
        this.estado.internet
          ? '1) Use WebSearch para achar 5 notícias REAIS de hoje ou de ontem (tecnologia, IA, ciência e Brasil). Nunca invente: só o que achou, com a fonte e o link.'
          : '1) A internet está desligada: deixe "jornal" vazio.',
        `2) Para cada pessoa da equipe abaixo, 4 falas curtas (até 90 caracteres) de conversa de escritório, no jeito dela: comentar as notícias, o dia, o café, o tempo, o projeto "${p.nome}". Ninguém promete ou relata trabalho nessas falas.`,
        `3) Para cada pessoa (exceto o chefe), uma ideia de melhoria para o projeto "${p.nome}"${p.descricao ? ` (${p.descricao})` : ''}, em primeira pessoa, até 140 caracteres.`,
        `Equipe:\n${equipe}`,
        'Responda SÓ com um JSON, sem texto antes ou depois: {"jornal":[{"titulo":"","fonte":"","url":"","resumo":""}],"falas":{"<id>":["",""]},"ideias":{"<id>":""}}',
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
        ideias: Object.fromEntries(Object.entries(bruto.ideias ?? {}).filter(([id]) => this.funcionario(id)).map(([id, t]) => [id, String(t).slice(0, 200)])),
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
    const esc = this.escritorio();
    if (alvo === 'principal') return esc.projeto;
    if (alvo === 'voce') return esc.mesa('voce').pasta;
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

  abrirPasta(alvo = 'principal') {
    const pasta = this.pastaDoComputador(alvo);
    spawn('xdg-open', [pasta], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
    return pasta;
  }

  desligar() {
    for (const r of this.sessoes.values()) r.sessao.parar();
  }
}
