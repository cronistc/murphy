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
  acesso_pedido: '🔑',
  acesso_respondido: '🔓',
  compartilhado: '📥',
  aval_pedido: '🙋',
  vida: '🌱',
  aval_respondido: '👍',
  cota: '⏱️',
  compactacao: '🚻',
  tarefa_terminada: '🏁',
  erro: '❌',
  mensagem: '🗨️',
  equipe: '👥',
  contratacao_pedida: '📋',
  contratacao_respondida: '🤝',
  tarefa_delegada: '📌',
  integracao: '🔀',
  expediente: '🏢',
  humor: '🙂',
  almoco: '🍽️',
  agenda: '📰',
  aniversario: '🎂',
  maquina: '🌡️',
  cofre: '🗄️',
  config: '⚙️',
  fala_parcial: '💭',
  relatorio: '📝',
  recomendacao: '👥',
  pensando: '🧠',
};

export function formatar(ev: Evento): string {
  const hora = ev.em.slice(11, 19);
  let corpo: string;
  switch (ev.tipo) {
    case 'sessao_iniciada':
      corpo = `${ev.funcionario ? `${ev.funcionario}${ev.branch ? ` (${ev.branch})` : ''} ` : ''}modelo=${ev.modelo} pasta=${ev.pasta} tarefa="${encurtar(ev.tarefa, 80)}"`;
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
    case 'mensagem':
      corpo = `${ev.de} → ${ev.para}: ${encurtar(ev.texto, 140)}`;
      break;
    case 'equipe':
      corpo = `${ev.motivo}: ${ev.equipe.map((f) => `${f.nome} (${f.cargo})`).join(', ')}`;
      break;
    case 'contratacao_pedida':
      corpo = `[${ev.idPedido}] ${ev.pedidoPor} pede um ${ev.cargo}: ${encurtar(ev.motivo, 100)}`;
      break;
    case 'contratacao_respondida':
      corpo = `[${ev.idPedido}] ${ev.aprovada ? `aprovada: ${ev.contratado}` : 'negada'}`;
      break;
    case 'integracao':
      corpo = `${ev.funcionario}: ${ev.ok ? 'OK' : 'FALHOU'} ${ev.mensagem}`;
      break;
    case 'expediente':
      corpo = `${ev.fase}${ev.luzCaiu ? ' (a luz caiu)' : ''} ${ev.daily ?? ev.resumo ?? ''}`;
      break;
    case 'humor':
      corpo = `${ev.funcionario}: ${ev.humor} (${ev.motivo})`;
      break;
    case 'almoco':
      corpo = ev.ate ? `até ${ev.ate} (${ev.motivo ?? ''})` : 'voltaram do almoço';
      break;
    case 'agenda':
      corpo = `jornal com ${ev.agenda.jornal.length} notícias; falas para ${Object.keys(ev.agenda.falas).length}`;
      break;
    case 'aniversario':
      corpo = ev.funcionario;
      break;
    case 'maquina':
      corpo = `carga ${ev.carga} → ${ev.temperatura}°C`;
      break;
    case 'cofre':
      corpo = `${ev.acao}: ${ev.assunto}`;
      break;
    case 'config':
      corpo = `internet=${ev.internet} aprovarTudo=${ev.aprovarTudo}`;
      break;
    case 'fala_parcial':
      corpo = `${ev.funcionario}: ${encurtar(ev.texto, 80)}`;
      break;
    case 'relatorio':
      corpo = Object.keys(ev.secoes).join(', ');
      break;
    case 'recomendacao':
      corpo = ev.itens.map((i) => i.cargo).join(', ');
      break;
    case 'pensando':
      corpo = `${ev.funcionario}: ${ev.motivo}${ev.ate ? ' (pronto)' : ''}`;
      break;
    case 'acesso_pedido':
      corpo = `[${ev.idPedido}] ${ev.funcionario}: ${ev.oque} (${ev.porque})`;
      break;
    case 'acesso_respondido':
      corpo = `[${ev.idPedido}] ${ev.aprovado ? 'respondido' : 'não liberado'}`;
      break;
    case 'compartilhado':
      corpo = `${ev.funcionario}: ${ev.nome}`;
      break;
    case 'vida':
      corpo = `${ev.funcionario}${ev.acao ? ` [${ev.acao}]` : ''}${ev.fala ? ` diz${ev.para ? ` a ${ev.para}` : ''}: ${ev.fala}` : ''}${ev.pensamento ? ` (pensa: ${ev.pensamento})` : ''}`;
      break;
    case 'aval_pedido':
      corpo = `${ev.funcionario} → ${ev.chefe}: ${ev.oque}`;
      break;
    case 'aval_respondido':
      corpo = `${ev.chefe} → ${ev.funcionario}: ${ev.aprovado ? 'aprovado' : 'não aprovado'} (${ev.orientacao})`;
      break;
    case 'tarefa_delegada':
      corpo = `${ev.de} → ${ev.para}: ${encurtar(ev.tarefa, 120)}`;
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
