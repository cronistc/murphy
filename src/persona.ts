// A personalidade de cada personagem: um Claude rápido (Haiku) sempre ligado.
//
// O documento da ideia separa a "IA atriz" (quem dá vida ao personagem) da
// "IA trabalhadora" (quem trabalha). A persona é a atriz: fica com a sessão
// aberta (sem custo de abrir o Claude Code a cada mensagem), com um prompt curto
// e sem ferramentas de programação, e o texto sai enquanto é escrito.
// Quando a conversa pede mais, ela chama ferramentas do escritório: começar uma
// tarefa, pensar melhor (o modelo mais inteligente) ou, no caso do chefe,
// planejar, anotar o relatório e recomendar a equipe.

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ambienteLimpo } from './sessao.ts';

type Pendente = { texto: string; resolver: (t: string) => void; rejeitar: (e: Error) => void };

// Fila de mensagens que alimenta a sessão aberta.
function filaDeEntrada() {
  const itens: unknown[] = [];
  let acordar: (() => void) | null = null;
  let fechada = false;
  return {
    empurrar(texto: string) {
      itens.push({ type: 'user', message: { role: 'user', content: texto }, parent_tool_use_id: null });
      acordar?.();
    },
    fechar() {
      fechada = true;
      acordar?.();
    },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (itens.length) yield itens.shift();
        if (fechada) return;
        await new Promise<void>((r) => (acordar = r));
        acordar = null;
      }
    },
  };
}

export type OpcoesPersona = {
  id: string;
  modelo?: string;
  sistema: string; // quem é, como fala, o que pode fazer
  ferramentas: Record<string, any>; // mcpServers
  liberadas: string[]; // nomes completos das ferramentas do escritório
  pasta: string; // diretório de trabalho (vazio; a persona não mexe em arquivos)
  log?: string; // arquivo JSONL do log técnico da persona
};

// Emite: 'parcial' (texto acumulado da fala em andamento), 'cota' (rate_limit_event).
export class Persona extends EventEmitter {
  readonly opcoes: OpcoesPersona;
  private entrada?: ReturnType<typeof filaDeEntrada>;
  private abortar?: AbortController;
  private fila: Pendente[] = [];
  private atual?: Pendente;
  private parcial = '';
  vivo = false;
  ultimoUso = Date.now();

  constructor(opcoes: OpcoesPersona) {
    super();
    this.opcoes = opcoes;
  }

  private registrar(dados: unknown) {
    if (!this.opcoes.log) return;
    try {
      fs.appendFileSync(this.opcoes.log, JSON.stringify(dados) + '\n');
    } catch {}
  }

  // Liga a sessão (o processo do Claude Code fica aberto esperando).
  ligar() {
    if (this.vivo) return;
    this.vivo = true;
    fs.mkdirSync(this.opcoes.pasta, { recursive: true });
    if (this.opcoes.log) fs.mkdirSync(path.dirname(this.opcoes.log), { recursive: true });
    this.entrada = filaDeEntrada();
    this.abortar = new AbortController();
    const fluxo = query({
      prompt: this.entrada as any,
      options: {
        model: this.opcoes.modelo ?? 'haiku',
        cwd: this.opcoes.pasta,
        env: ambienteLimpo(),
        settingSources: [],
        tools: [], // nada de ferramentas de programação: só conversa e as do escritório
        includePartialMessages: true,
        systemPrompt: this.opcoes.sistema,
        mcpServers: this.opcoes.ferramentas,
        allowedTools: this.opcoes.liberadas,
        abortController: this.abortar,
        permissionMode: 'default',
        canUseTool: async () => ({ behavior: 'deny' as const, message: 'Nesta conversa só as ferramentas do escritório.' }),
      },
    });
    (async () => {
      try {
        for await (const m of fluxo as AsyncIterable<any>) {
          this.registrar(m);
          if (m.type === 'rate_limit_event') this.emit('cota', m.rate_limit_info);
          if (m.type === 'stream_event' && !m.parent_tool_use_id) {
            const e = m.event;
            if (e?.type === 'content_block_delta' && e.delta?.type === 'text_delta') {
              this.parcial += e.delta.text;
              this.emit('parcial', this.parcial);
            }
            // Texto antes de uma ferramenta e texto depois viram uma fala só.
            if (e?.type === 'content_block_start' && e.content_block?.type === 'text' && this.parcial && !/\s$/.test(this.parcial)) {
              this.parcial += ' ';
            }
          }
          if (m.type === 'result') {
            const p = this.atual;
            this.atual = undefined;
            const final = (this.parcial.trim() || String(m.result ?? '')).trim();
            this.parcial = '';
            if (p) {
              if (m.is_error) p.rejeitar(new Error(String(m.result ?? m.subtype)));
              else p.resolver(final);
            }
            this.proxima();
          }
        }
      } catch (e) {
        this.atual?.rejeitar(e as Error);
        this.atual = undefined;
      } finally {
        this.vivo = false;
        // Quem ainda esperava tenta de novo numa sessão nova.
        const restantes = this.fila.splice(0);
        for (const p of restantes) this.fila.push(p);
        if (restantes.length) setTimeout(() => this.proxima(), 200);
      }
    })();
  }

  private proxima() {
    if (this.atual || !this.fila.length) return;
    if (!this.vivo) this.ligar();
    this.atual = this.fila.shift()!;
    this.parcial = '';
    this.entrada!.empurrar(this.atual.texto);
  }

  // Manda uma mensagem e espera a fala completa (as parciais saem por evento).
  falar(texto: string): Promise<string> {
    this.ultimoUso = Date.now();
    return new Promise((resolver, rejeitar) => {
      this.fila.push({ texto, resolver, rejeitar });
      this.proxima();
    });
  }

  get ocupada() {
    return Boolean(this.atual) || this.fila.length > 0;
  }

  desligar() {
    this.entrada?.fechar();
    this.abortar?.abort();
    this.vivo = false;
  }
}
