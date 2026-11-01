// Log simples: uma linha legível no terminal por evento, e arquivos JSONL com
// os eventos normalizados e as mensagens brutas da CLI (o "log técnico real").

import fs from 'node:fs';
import path from 'node:path';
import type { Evento } from './eventos.ts';
import type { Sessao } from './sessao.ts';
import { encurtar } from './sessao.ts';

const ICONE: Record<Evento['tipo'], string> = {
  sessao_iniciada: '🚪',
  cli_pronta: '💻',
  texto: '💬',
  ferramenta_chamada: '🔧',
  ferramenta_resultado: '📎',
  permissao_pedida: '✋',
  permissao_respondida: '🧑‍💼',
  cota: '⏱️',
  compactacao: '🚻',
  tarefa_terminada: '🏁',
  erro: '❌',
};

export function formatar(ev: Evento): string {
  const hora = ev.em.slice(11, 19);
  let corpo: string;
  switch (ev.tipo) {
    case 'sessao_iniciada':
      corpo = `${ev.funcionario ? `${ev.funcionario} (${ev.branch}) ` : ''}modelo=${ev.modelo} pasta=${ev.pasta} tarefa="${encurtar(ev.tarefa, 80)}"`;
      break;
    case 'cli_pronta':
      corpo = `session_id=${ev.sessionIdCli} modelo=${ev.modelo} ferramentas=${ev.ferramentas}`;
      break;
    case 'texto':
      corpo = encurtar(ev.texto, 160);
      break;
    case 'ferramenta_chamada':
      corpo = `${ev.ferramenta}: ${ev.resumo}`;
      break;
    case 'ferramenta_resultado':
      corpo = `${ev.erro ? 'ERRO ' : ''}${ev.resumo}`;
      break;
    case 'permissao_pedida':
      corpo = `[${ev.idPedido}] ${ev.ferramenta}: ${ev.resumo}`;
      break;
    case 'permissao_respondida':
      corpo = `[${ev.idPedido}] ${ev.aprovada ? 'APROVADA' : 'NEGADA'} (${ev.motivo})`;
      break;
    case 'cota':
      corpo = `status=${ev.status} janela=${ev.janela ?? '?'} uso=${ev.uso ?? '?'} renova=${ev.renovaEm ?? '?'}`;
      break;
    case 'compactacao':
      corpo = `tokens ${ev.tokensAntes} → ${ev.tokensDepois ?? '?'}`;
      break;
    case 'tarefa_terminada':
      corpo = `${ev.sucesso ? 'SUCESSO' : 'FALHA'} (${ev.subtipo}) ${ev.turnos} turnos, ${(ev.duracaoMs / 1000).toFixed(1)}s, US$ ${ev.custoUsd?.toFixed(4)}`;
      break;
    case 'erro':
      corpo = ev.mensagem;
      break;
  }
  return `${hora} [${ev.sessao}] ${ICONE[ev.tipo]} ${ev.tipo.padEnd(20)} ${corpo}`;
}

// Liga uma sessão ao terminal e aos arquivos de log. Retorna os caminhos.
export function registrar(sessao: Sessao, pastaLogs: string) {
  fs.mkdirSync(pastaLogs, { recursive: true });
  const eventos = path.join(pastaLogs, `${sessao.id}.eventos.jsonl`);
  const brutos = path.join(pastaLogs, `${sessao.id}.bruto.jsonl`);
  sessao.on('evento', (ev: Evento) => {
    console.log(formatar(ev));
    fs.appendFileSync(eventos, JSON.stringify(ev) + '\n');
  });
  sessao.on('bruto', (msg: unknown) => {
    fs.appendFileSync(brutos, JSON.stringify(msg) + '\n');
  });
  return { eventos, brutos };
}
