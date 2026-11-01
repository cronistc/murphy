// Uma sessão de trabalho real: uma IA trabalhadora (Claude Code via Agent SDK)
// rodando dentro de uma pasta de projeto. Converte mensagens do SDK em Eventos.

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Evento } from './eventos.ts';

export type PedidoPermissao = {
  idPedido: string;
  ferramenta: string;
  entrada: Record<string, unknown>;
  resumo: string;
};

export type Decisao = { aprovada: boolean; motivo: string };

export type OpcoesSessao = {
  pasta: string;
  tarefa: string;
  modelo?: string; // 'haiku' | 'sonnet' | 'opus' ou id completo
  // Quem decide permissões (o usuário, pela interface). O cérebro aplica antes
  // a regra de segurança: nada fora da pasta do projeto.
  decidirPermissao: (pedido: PedidoPermissao) => Promise<Decisao>;
  executavelClaude?: string;
};

// Emite: 'evento' (Evento normalizado) e 'bruto' (mensagem original do SDK).
export class Sessao extends EventEmitter {
  readonly id: string;
  readonly opcoes: OpcoesSessao;
  private abortar = new AbortController();

  constructor(opcoes: OpcoesSessao) {
    super();
    this.id = randomUUID().slice(0, 8);
    this.opcoes = { ...opcoes, pasta: path.resolve(opcoes.pasta) };
  }

  parar() {
    this.abortar.abort();
  }

  private emitir(dados: Record<string, unknown>) {
    const ev = { sessao: this.id, em: new Date().toISOString(), ...dados } as Evento;
    this.emit('evento', ev);
  }

  async rodar(): Promise<void> {
    const { pasta, tarefa, modelo = 'sonnet' } = this.opcoes;
    this.emitir({ tipo: 'sessao_iniciada', pasta, modelo, tarefa });

    try {
      const fluxo = query({
        prompt: tarefa,
        options: {
          cwd: pasta,
          model: modelo,
          abortController: this.abortar,
          // 'default' = toda ação sensível passa por canUseTool.
          permissionMode: 'default',
          // Só configurações do próprio projeto; nada do perfil do usuário vaza.
          settingSources: ['project'],
          canUseTool: (ferramenta, entrada, { blockedPath }) =>
            this.pedirPermissao(ferramenta, entrada, blockedPath),
          ...(this.opcoes.executavelClaude
            ? { pathToClaudeCodeExecutable: this.opcoes.executavelClaude }
            : {}),
        },
      });

      for await (const msg of fluxo) {
        this.emit('bruto', msg);
        this.traduzir(msg as Record<string, any>);
      }
    } catch (e) {
      this.emitir({ tipo: 'erro', mensagem: e instanceof Error ? e.message : String(e) });
    }
  }

  private async pedirPermissao(ferramenta: string, entrada: Record<string, unknown>, bloqueado?: string) {
    const idPedido = randomUUID().slice(0, 8);
    const resumo = resumirEntrada(ferramenta, entrada);
    this.emitir({ tipo: 'permissao_pedida', idPedido, ferramenta, resumo });

    let decisao: Decisao;
    // blockedPath: a CLI detectou um caminho fora dos diretórios permitidos (ex.: dentro de um comando Bash).
    const fora = bloqueado ?? caminhoForaDaPasta(entrada, this.opcoes.pasta);
    if (fora) {
      decisao = { aprovada: false, motivo: `fora da pasta do projeto: ${fora}` };
    } else {
      decisao = await this.opcoes.decidirPermissao({ idPedido, ferramenta, entrada, resumo });
    }
    this.emitir({ tipo: 'permissao_respondida', idPedido, ...decisao });

    return decisao.aprovada
      ? { behavior: 'allow' as const, updatedInput: entrada }
      : { behavior: 'deny' as const, message: `Negado pelo chefe: ${decisao.motivo}` };
  }

  private traduzir(msg: Record<string, any>) {
    switch (msg.type) {
      case 'system':
        if (msg.subtype === 'init') {
          this.emitir({
            tipo: 'cli_pronta',
            sessionIdCli: msg.session_id,
            modelo: msg.model,
            ferramentas: (msg.tools ?? []).length,
          });
        } else if (msg.subtype === 'compact_boundary') {
          this.emitir({
            tipo: 'compactacao',
            tokensAntes: msg.compact_metadata?.pre_tokens,
            tokensDepois: msg.compact_metadata?.post_tokens,
          });
        }
        return;

      case 'assistant':
        for (const bloco of msg.message?.content ?? []) {
          if (bloco.type === 'text' && bloco.text?.trim()) {
            this.emitir({ tipo: 'texto', texto: bloco.text });
          } else if (bloco.type === 'tool_use') {
            this.emitir({
              tipo: 'ferramenta_chamada',
              idChamada: bloco.id,
              ferramenta: bloco.name,
              resumo: resumirEntrada(bloco.name, bloco.input ?? {}),
            });
          }
        }
        return;

      case 'user':
        // Resultados de ferramentas voltam como mensagem do "usuário" para o modelo.
        for (const bloco of msg.message?.content ?? []) {
          if (bloco?.type === 'tool_result') {
            this.emitir({
              tipo: 'ferramenta_resultado',
              idChamada: bloco.tool_use_id,
              erro: Boolean(bloco.is_error),
              resumo: encurtar(textoDoResultado(bloco.content), 160),
            });
          }
        }
        return;

      case 'rate_limit_event': {
        const info = msg.rate_limit_info ?? {};
        this.emitir({
          tipo: 'cota',
          status: info.status,
          janela: info.rateLimitType,
          uso: info.utilization,
          renovaEm: info.resetsAt ? new Date(info.resetsAt * 1000).toISOString() : undefined,
        });
        return;
      }

      case 'result':
        this.emitir({
          tipo: 'tarefa_terminada',
          sucesso: msg.subtype === 'success' && !msg.is_error,
          subtipo: msg.subtype,
          resultado: msg.result,
          duracaoMs: msg.duration_ms,
          turnos: msg.num_turns,
          custoUsd: msg.total_cost_usd,
        });
        return;
    }
  }
}

// ---------- utilidades ----------

export function encurtar(s: string, n: number) {
  const uma = s.replace(/\s+/g, ' ').trim();
  return uma.length > n ? uma.slice(0, n - 1) + '…' : uma;
}

function textoDoResultado(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((b) => (b?.type === 'text' ? b.text : `[${b?.type}]`)).join(' ');
  return '';
}

export function resumirEntrada(ferramenta: string, e: Record<string, any>): string {
  switch (ferramenta) {
    case 'Bash':
      return encurtar(String(e.command ?? ''), 120);
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'NotebookEdit':
      return String(e.file_path ?? e.notebook_path ?? '');
    case 'Glob':
    case 'Grep':
      return `${e.pattern ?? ''}${e.path ? ` em ${e.path}` : ''}`;
    case 'WebFetch':
      return String(e.url ?? '');
    case 'WebSearch':
      return String(e.query ?? '');
    default:
      return encurtar(JSON.stringify(e), 120);
  }
}

// Regra de segurança do documento: funcionários só trabalham dentro da pasta.
// Retorna o caminho ofensor, ou null se tudo está dentro.
export function caminhoForaDaPasta(e: Record<string, unknown>, pasta: string): string | null {
  for (const chave of ['file_path', 'notebook_path', 'path']) {
    const v = e[chave];
    if (typeof v !== 'string' || !v) continue;
    const abs = path.resolve(pasta, v);
    const rel = path.relative(pasta, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return abs;
  }
  return null;
}
