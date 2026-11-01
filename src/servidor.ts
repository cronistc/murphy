// O "cérebro": serviço local que inicia sessões de trabalho e publica os eventos.
// Qualquer interface (o jogo, um app de celular, curl) só se conecta a ele.
//
//   POST /sessoes             {"pasta": "...", "tarefa": "...", "modelo": "haiku"}
//   GET  /sessoes             lista sessões e permissões pendentes
//   GET  /eventos             stream SSE com todos os eventos (histórico + ao vivo)
//   POST /permissoes/:id      {"aprovar": true, "motivo": "ok"}

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { Sessao, type Decisao, type PedidoPermissao } from './sessao.ts';
import { registrar } from './log.ts';
import type { Evento } from './eventos.ts';

const PORTA = Number(process.env.PORTA ?? 4317);
const PASTA_LOGS = path.resolve(process.env.PASTA_LOGS ?? 'logs');
const APROVAR_TUDO = process.env.APROVAR_TUDO === '1';

const sessoes = new Map<string, { sessao: Sessao; estado: 'rodando' | 'terminada' }>();
const pendentes = new Map<string, { sessao: string; pedido: PedidoPermissao; responder: (d: Decisao) => void }>();
const historico: Evento[] = [];
const ouvintes = new Set<http.ServerResponse>();

function publicar(ev: Evento) {
  historico.push(ev);
  const linha = `data: ${JSON.stringify(ev)}\n\n`;
  for (const res of ouvintes) res.write(linha);
}

function iniciar(pasta: string, tarefa: string, modelo?: string) {
  if (!fs.existsSync(pasta) || !fs.statSync(pasta).isDirectory()) {
    throw new Error(`pasta não existe: ${pasta}`);
  }
  const sessao: Sessao = new Sessao({
    pasta,
    tarefa,
    modelo,
    decidirPermissao: (pedido) =>
      APROVAR_TUDO
        ? Promise.resolve({ aprovada: true, motivo: 'APROVAR_TUDO=1' })
        : new Promise((responder) => pendentes.set(pedido.idPedido, { sessao: sessao.id, pedido, responder })),
  });
  registrar(sessao, PASTA_LOGS);
  sessao.on('evento', publicar);
  sessoes.set(sessao.id, { sessao, estado: 'rodando' });
  sessao.rodar().finally(() => (sessoes.get(sessao.id)!.estado = 'terminada'));
  return sessao.id;
}

async function lerJson(req: http.IncomingMessage): Promise<any> {
  let corpo = '';
  for await (const parte of req) corpo += parte;
  return corpo ? JSON.parse(corpo) : {};
}

function json(res: http.ServerResponse, status: number, dados: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(dados, null, 2));
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (req.method === 'POST' && url.pathname === '/sessoes') {
      const { pasta, tarefa, modelo } = await lerJson(req);
      if (!pasta || !tarefa) return json(res, 400, { erro: 'informe pasta e tarefa' });
      return json(res, 201, { sessao: iniciar(path.resolve(pasta), tarefa, modelo) });
    }
    if (req.method === 'GET' && url.pathname === '/sessoes') {
      return json(res, 200, {
        sessoes: [...sessoes.values()].map(({ sessao, estado }) => ({
          id: sessao.id,
          estado,
          pasta: sessao.opcoes.pasta,
          tarefa: sessao.opcoes.tarefa,
        })),
        permissoesPendentes: [...pendentes.values()].map(({ sessao, pedido }) => ({
          sessao,
          id: pedido.idPedido,
          ferramenta: pedido.ferramenta,
          resumo: pedido.resumo,
        })),
      });
    }
    if (req.method === 'GET' && url.pathname === '/eventos') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      for (const ev of historico) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }
    const m = url.pathname.match(/^\/permissoes\/([\w-]+)$/);
    if (req.method === 'POST' && m) {
      const p = pendentes.get(m[1]);
      if (!p) return json(res, 404, { erro: 'pedido não encontrado ou já respondido' });
      const { aprovar, motivo } = await lerJson(req);
      pendentes.delete(m[1]);
      p.responder({ aprovada: Boolean(aprovar), motivo: motivo ?? (aprovar ? 'aprovado pelo usuário' : 'negado pelo usuário') });
      return json(res, 200, { ok: true });
    }
    json(res, 404, { erro: 'rota desconhecida' });
  } catch (e) {
    json(res, 400, { erro: e instanceof Error ? e.message : String(e) });
  }
});

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`🧠 cérebro ouvindo em http://127.0.0.1:${PORTA}  (logs em ${PASTA_LOGS}${APROVAR_TUDO ? ', APROVAR_TUDO' : ''})`);
});
