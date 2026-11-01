// O orquestrador: o escritório em si. Guarda a equipe e a conversa com o chefe,
// contrata, distribui tarefas, integra o trabalho e publica todos os eventos.
// O servidor HTTP é só a porta de entrada para ele.
//
// Fluxo normal (documento da ideia, "O papel do usuário"):
//   gestor (usuário) conversa com o chefe → chefe planeja e delega para a
//   equipe → cada um trabalha na sua mesa → o trabalho é integrado na branch
//   principal → o chefe avalia e conta ao gestor. Falta gente? O chefe pede
//   contratação e o gestor aprova.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { Sessao, encurtar, type Decisao, type PedidoPermissao } from './sessao.ts';
import { Escritorio, slug } from './escritorio.ts';
import { registrar } from './log.ts';
import { carregar, salvar, type Estado } from './estado.ts';
import { CARGOS, candidatos, type Candidato } from './candidatos.ts';
import type { Cargo, Evento, Funcionario } from './eventos.ts';

const PASTA_PROJETOS = path.join(os.homedir(), 'escritorio-projetos');

type Registro = {
  sessao: Sessao;
  estado: 'rodando' | 'terminada';
  funcionario?: string;
  projeto?: string;
  delegadoPor?: string;
  tarefa: string;
  fim?: Promise<void>;
};

export class Orquestrador extends EventEmitter {
  estado: Estado = carregar();
  readonly sessoes = new Map<string, Registro>();
  readonly pendentes = new Map<string, { sessao: string; pedido: PedidoPermissao; responder: (d: Decisao) => void }>();
  readonly contratacoes = new Map<string, { cargo: Cargo; motivo: string; pedidoPor: string }>();
  aprovarTudo: boolean;
  private pastaLogs: string;
  private filaChefe: string[] = [];
  private chefeOcupado = false;

  constructor(opcoes: { pastaLogs: string; aprovarTudo: boolean }) {
    super();
    this.pastaLogs = opcoes.pastaLogs;
    this.aprovarTudo = opcoes.aprovarTudo;
  }

  // ---------- eventos ----------
  private publicar(ev: Evento) {
    this.emit('evento', ev);
  }
  private doEscritorio(dados: Record<string, unknown>) {
    this.publicar({ sessao: 'escritorio', em: new Date().toISOString(), ...dados } as Evento);
  }
  private salvar() {
    salvar(this.estado);
  }

  // Abertura do dia: a equipe chega.
  abrirExpediente() {
    if (this.estado.boasVindas) this.doEscritorio({ tipo: 'equipe', equipe: this.estado.equipe, motivo: 'chegada' });
  }

  get chefe(): Funcionario | undefined {
    return this.estado.equipe.find((f) => f.cargo === 'chefe');
  }
  private escritorio(): Escritorio {
    if (!this.estado.projeto) throw new Error('nenhum projeto aberto ainda');
    return Escritorio.abrir(this.estado.projeto.pasta);
  }
  ocupado(id: string) {
    return [...this.sessoes.values()].some((r) => r.estado === 'rodando' && r.funcionario === id);
  }

  // ---------- primeira abertura ----------
  boasVindas({ nome, descricao = '', pasta }: { nome: string; descricao?: string; pasta?: string }) {
    if (!nome?.trim()) throw new Error('dê um nome ao projeto');
    const destino = path.resolve(pasta?.trim() || path.join(PASTA_PROJETOS, slug(nome)));
    Escritorio.abrir(destino); // valida e cria o repositório
    this.estado.projeto = { nome: nome.trim(), pasta: destino, descricao: descricao.trim() };
    if (!this.chefe) this.admitir(candidatos('chefe', [])[0]);
    this.estado.boasVindas = true;
    this.salvar();
    const chefe = this.chefe!;
    this.doEscritorio({ tipo: 'equipe', equipe: this.estado.equipe, motivo: 'chegada' });
    this.mensagem(
      chefe.id,
      'voce',
      `Oi! Eu sou ${chefe.nome} e vou cuidar da equipe do "${this.estado.projeto.nome}". Por enquanto a equipe sou só eu. ` +
        'Me conta o que vamos construir: eu monto o plano, distribuo o trabalho e, se faltar gente, peço para contratar.',
    );
  }

  // ---------- contratação ----------
  candidatos(cargo: Cargo): Candidato[] {
    if (cargo === 'chefe' || !CARGOS[cargo]) throw new Error('cargo inválido');
    return candidatos(cargo, this.estado.equipe.map((f) => f.nome));
  }

  private admitir(c: Pick<Candidato, 'nome' | 'cargo' | 'modelo' | 'personalidade'>): Funcionario {
    const f: Funcionario = {
      id: slug(c.nome),
      nome: c.nome,
      cargo: c.cargo,
      modelo: c.modelo,
      personalidade: c.personalidade,
      contratadoEm: new Date().toISOString(),
    };
    this.estado.equipe.push(f);
    return f;
  }

  contratar(nome: string, cargo: Cargo): Funcionario {
    const c = this.candidatos(cargo).find((x) => x.nome === nome);
    if (!c) throw new Error(`${nome} não está entre os candidatos de ${cargo}`);
    const f = this.admitir(c);
    this.salvar();
    this.doEscritorio({ tipo: 'equipe', equipe: this.estado.equipe, motivo: `contratou ${f.nome}` });
    if (this.chefe) {
      this.avisarChefe(`[Aviso do escritório] O gestor contratou ${f.nome} (${CARGOS[cargo].titulo}, id "${f.id}"). Já pode delegar para ${f.nome}.`, false);
    }
    return f;
  }

  responderContratacao(idPedido: string, aprovar: boolean): Funcionario | undefined {
    const p = this.contratacoes.get(idPedido);
    if (!p) throw new Error('pedido não encontrado ou já respondido');
    this.contratacoes.delete(idPedido);
    let f: Funcionario | undefined;
    if (aprovar) {
      const c = this.candidatos(p.cargo)[0];
      f = this.admitir(c);
      this.salvar();
      this.doEscritorio({ tipo: 'equipe', equipe: this.estado.equipe, motivo: `contratou ${f.nome}` });
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

  // ---------- trabalho ----------
  // Uma tarefa para um funcionário, na mesa dele. Ao terminar, o trabalho é
  // integrado na branch principal; se foi o chefe quem delegou, ele avalia.
  tarefa(id: string, tarefa: string, delegadoPor: string): string {
    const f = this.estado.equipe.find((x) => x.id === slug(id) || slug(x.nome) === slug(id));
    if (!f) throw new Error(`não há ninguém chamado "${id}" na equipe`);
    if (f.cargo === 'chefe') throw new Error('o chefe não executa tarefas; converse com ele');
    if (this.ocupado(f.id)) throw new Error(`${f.nome} já está trabalhando numa tarefa`);
    const esc = this.escritorio();
    const mesa = esc.mesa(f.id);
    const atualizada = esc.atualizarMesa(mesa);
    if (!atualizada.ok) this.doEscritorio({ tipo: 'integracao', funcionario: f.id, ok: false, mensagem: atualizada.mensagem });
    this.doEscritorio({ tipo: 'tarefa_delegada', de: delegadoPor, para: f.id, tarefa });
    const sessao = this.novaSessao(
      { ...mesa, funcionario: f.id, tarefa, modelo: f.modelo, instrucoes: esc.instrucoes(mesa) },
      { funcionario: f.id, projeto: esc.projeto, delegadoPor, tarefa },
    );
    sessao.on('evento', (ev: Evento) => {
      if (ev.tipo !== 'tarefa_terminada' && ev.tipo !== 'erro') return;
      const integ = esc.integrar(mesa, f.nome);
      this.doEscritorio({ tipo: 'integracao', funcionario: f.id, ...integ });
      if (delegadoPor === this.chefe?.id) {
        const resultado = ev.tipo === 'tarefa_terminada' ? ev.resultado ?? '(sem resposta)' : `erro: ${ev.mensagem}`;
        this.avisarChefe(
          `[Aviso do escritório] ${f.nome} terminou a tarefa "${encurtar(tarefa, 120)}" ` +
            `(${ev.tipo === 'tarefa_terminada' && ev.sucesso ? 'sucesso' : 'falhou'}). Integração: ${integ.mensagem}.\n` +
            `Relato de ${f.nome}:\n${encurtar(resultado, 3000)}\n\n` +
            'Avalie e conte ao gestor em poucas frases. Se houver próxima etapa, delegue.',
          true,
        );
      }
    });
    return sessao.id;
  }

  // Sessão avulsa numa pasta ou mesa (API antiga e demos).
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
        this.aprovarTudo
          ? Promise.resolve({ aprovada: true, motivo: 'aprovação automática ligada' })
          : new Promise((responder) => this.pendentes.set(pedido.idPedido, { sessao: sessao.id, pedido, responder })),
    });
    registrar(sessao, this.pastaLogs);
    sessao.on('evento', (ev: Evento) => this.publicar(ev));
    const registro: Registro = { sessao, estado: 'rodando', ...reg };
    this.sessoes.set(sessao.id, registro);
    registro.fim = sessao.rodar().finally(() => {
      registro.estado = 'terminada';
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
    this.aprovarTudo = v;
    if (v) for (const id of [...this.pendentes.keys()]) this.responderPermissao(id, true, 'aprovação automática ligada');
  }

  // ---------- conversa com o chefe ----------
  private mensagem(de: string, para: string, texto: string) {
    const m = { de, para, texto, em: new Date().toISOString() };
    this.estado.conversa.push(m);
    this.salvar();
    this.doEscritorio({ tipo: 'mensagem', de, para, texto });
  }

  falarComChefe(texto: string) {
    if (!this.chefe) throw new Error('o escritório ainda não abriu');
    if (!texto.trim()) throw new Error('escreva alguma coisa');
    this.mensagem('voce', this.chefe.id, texto.trim());
    this.avisarChefe(texto.trim(), true);
  }

  // Coloca um recado na fila do chefe. `responder`: a resposta vai para o chat.
  private avisarChefe(texto: string, responder: boolean) {
    if (!responder) {
      // Recados que não pedem resposta seguem junto do próximo assunto.
      this.recados.push(texto);
      return;
    }
    this.filaChefe.push([...this.recados.splice(0), texto].join('\n\n'));
    this.proximoDoChefe();
  }
  private recados: string[] = [];

  private async proximoDoChefe() {
    if (this.chefeOcupado || !this.filaChefe.length) return;
    const chefe = this.chefe;
    if (!chefe) return;
    this.chefeOcupado = true;
    const prompt = this.filaChefe.shift()!;
    try {
      let r = await this.turnoDoChefe(chefe, prompt);
      // A conversa salva pode não existir mais (outra máquina, CLI limpa): começa outra.
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
        mcpServers: { escritorio: this.ferramentasDoChefe(chefe) },
        // Só as ferramentas do escritório dispensam permissão. Read/Glob/Grep
        // passam pelo canUseTool, que barra qualquer caminho fora do projeto.
        ferramentasLiberadas: ['mcp__escritorio__ver_equipe', 'mcp__escritorio__delegar_tarefa', 'mcp__escritorio__pedir_contratacao'],
        ferramentasProibidas: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task', 'Agent'],
      },
      { funcionario: chefe.id, projeto: projeto.pasta, tarefa: prompt },
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
    return [
      `Você é ${chefe.nome}, chefe de equipe de um pequeno escritório de IA. Fale sempre em português do Brasil.`,
      'Quem fala com você é o gestor (o usuário, dono do escritório). Mensagens que começam com "[Aviso do escritório]" são avisos automáticos, não do gestor.',
      `Projeto: "${p.nome}"${p.descricao ? ` — ${p.descricao}` : ''}. Repositório git em ${p.pasta}.`,
      'Seu trabalho: entender o que o gestor quer, planejar e distribuir o trabalho para a equipe com a ferramenta delegar_tarefa.',
      'Você NÃO edita arquivos nem roda comandos: quem executa é a equipe. Pode ler o projeto (Read, Glob, Grep) para planejar e revisar.',
      'Cada funcionário trabalha numa cópia própria (git worktree) e, ao terminar, o trabalho é integrado automaticamente na branch principal. Antes de cada tarefa a cópia dele é atualizada com a principal.',
      'Escreva cada tarefa completa e autocontida (o funcionário não vê esta conversa): objetivo, arquivos envolvidos, critério de pronto, e peça para rodar os testes quando fizer sentido e fazer commit.',
      'Divida trabalho grande em partes e distribua para quem estiver livre. Tarefas que dependem uma da outra: delegue uma, espere o aviso de que terminou, depois delegue a próxima.',
      'Escolha o cargo certo: júnior (rápido e barato) para tarefas simples; pleno para a maioria; sênior para o difícil.',
      'Se não houver ninguém (ou ninguém adequado) para delegar, use pedir_contratacao com o cargo e o motivo; o gestor decide.',
      'Use ver_equipe para saber quem existe e quem está livre antes de delegar.',
      'Respostas ao gestor: curtas (até 4 frases), diretas, sem títulos nem listas longas. Diga o que vai acontecer e quem vai fazer.',
      'Nunca diga que algo está pronto sem a evidência do relato de quem fez (testes rodados, saída real).',
    ].join('\n');
  }

  private ferramentasDoChefe(chefe: Funcionario) {
    const texto = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
    return createSdkMcpServer({
      name: 'escritorio',
      version: '1.0.0',
      tools: [
        tool('ver_equipe', 'Lista a equipe do escritório: id, nome, cargo, modelo e se está livre ou trabalhando.', {}, async () => {
          const linhas = this.estado.equipe
            .filter((f) => f.id !== chefe.id)
            .map((f) => `- id "${f.id}": ${f.nome}, ${CARGOS[f.cargo].titulo} (${f.modelo}), ${this.ocupado(f.id) ? 'TRABALHANDO' : 'livre'}`);
          return texto(linhas.length ? linhas.join('\n') : 'Ninguém além de você. Use pedir_contratacao para pedir gente ao gestor.');
        }),
        tool(
          'delegar_tarefa',
          'Entrega uma tarefa a um funcionário livre. Ele trabalha na cópia própria dele e você recebe um aviso quando terminar.',
          { funcionario: z.string().describe('id do funcionário (veja ver_equipe)'), tarefa: z.string().describe('a tarefa completa e autocontida') },
          async ({ funcionario, tarefa }) => {
            try {
              this.tarefa(funcionario, tarefa, chefe.id);
              return texto(`Ok: ${funcionario} começou. Você receberá um aviso quando terminar.`);
            } catch (e) {
              return { ...texto(`Não deu: ${(e as Error).message}`), isError: true };
            }
          },
        ),
        tool(
          'pedir_contratacao',
          'Pede ao gestor para contratar alguém. Ele decide; você recebe um aviso com a resposta. Não espere: responda ao gestor.',
          { cargo: z.enum(['junior', 'pleno', 'senior']), motivo: z.string().describe('por que precisa, em uma frase') },
          async ({ cargo, motivo }) => {
            const idPedido = randomUUID().slice(0, 8);
            this.contratacoes.set(idPedido, { cargo, motivo, pedidoPor: chefe.id });
            this.doEscritorio({ tipo: 'contratacao_pedida', idPedido, cargo, motivo, pedidoPor: chefe.id });
            return texto('Pedido enviado ao gestor. Avise que pediu e por quê.');
          },
        ),
      ],
    });
  }

  desligar() {
    for (const r of this.sessoes.values()) r.sessao.parar();
  }
}
