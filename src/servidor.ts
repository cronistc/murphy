// O "cérebro": serviço local que inicia sessões de trabalho e publica os eventos.
// Qualquer interface (o jogo, um app de celular, curl) só se conecta a ele.
//
//   POST /sessoes             {"projeto": "...", "funcionario": "ana", "tarefa": "...", "modelo": "haiku"}
//                             cada funcionário trabalha na sua mesa (git worktree próprio).
//                             Alternativa sem mesa: {"pasta": "...", "tarefa": "..."}
//   GET  /mesas?projeto=...   mesas (worktrees) do projeto
//   GET  /sessoes             lista sessões e permissões pendentes
//   GET  /eventos             stream SSE com todos os eventos (histórico + ao vivo)
//   POST /permissoes/:id      {"aprovar": true, "motivo": "ok"}
//   GET  /config              {"projetoPadrao", "aprovarTudo"}
//   POST /config              {"aprovarTudo": true}  (aprova também os pedidos pendentes)
//   GET  /conta               {"logado": bool}  login do usuário na conta Claude
//   POST /conta/entrar        inicia o login oficial; devolve {"url"} (o navegador abre sozinho)
//   POST /conta/codigo        {"codigo": "..."} cola o código mostrado pelo site
//   GET  /                    a tela do escritório (pasta web/)

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sessao, type Decisao, type PedidoPermissao } from './sessao.ts';
import { registrar } from './log.ts';
import { Escritorio, slug } from './escritorio.ts';
import * as conta from './conta.ts';
import type { Evento } from './eventos.ts';

const PORTA = Number(process.env.PORTA ?? 4317);
const PASTA_LOGS = path.resolve(process.env.PASTA_LOGS ?? 'logs');
let aprovarTudo = process.env.APROVAR_TUDO === '1';
const PROJETO_PADRAO = path.resolve(process.env.PROJETO ?? path.join(os.homedir(), 'escritorio-projetos', 'meu-escritorio'));
const PASTA_WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

const sessoes = new Map<string, { sessao: Sessao; projeto?: string; estado: 'rodando' | 'terminada' }>();
const pendentes = new Map<string, { sessao: string; pedido: PedidoPermissao; responder: (d: Decisao) => void }>();
const historico: Evento[] = [];
const ouvintes = new Set<http.ServerResponse>();

// O id SSE é a posição no histórico: ao reconectar, o navegador manda
// Last-Event-ID e recebe só o que perdeu.
const sse = (i: number) => `id: ${i}\ndata: ${JSON.stringify(historico[i])}\n\n`;

function publicar(ev: Evento) {
  historico.push(ev);
  const linha = sse(historico.length - 1);
  for (const res of ouvintes) res.write(linha);
}

type Pedido = { pasta?: string; projeto?: string; funcionario?: string; tarefa: string; modelo?: string };

function iniciar({ pasta, projeto, funcionario, tarefa, modelo }: Pedido) {
  let mesa: { pasta: string; branch?: string; funcionario?: string; instrucoes?: string };
  if (projeto && funcionario) {
    const escritorio = Escritorio.abrir(projeto);
    const nome = slug(funcionario);
    const ocupada = [...sessoes.values()].some(
      (s) => s.estado === 'rodando' && s.sessao.opcoes.funcionario === nome && s.projeto === escritorio.projeto,
    );
    if (ocupada) throw new Error(`${nome} já está trabalhando numa tarefa; espere terminar`);
    const m = escritorio.mesa(nome);
    mesa = { ...m, instrucoes: escritorio.instrucoes(m) };
  } else if (pasta) {
    if (!fs.existsSync(pasta) || !fs.statSync(pasta).isDirectory()) throw new Error(`pasta não existe: ${pasta}`);
    mesa = { pasta };
  } else {
    throw new Error('informe projeto + funcionario, ou pasta');
  }
  const sessao: Sessao = new Sessao({
    ...mesa,
    tarefa,
    modelo,
    decidirPermissao: (pedido) =>
      aprovarTudo
        ? Promise.resolve({ aprovada: true, motivo: 'aprovação automática ligada' })
        : new Promise((responder) => pendentes.set(pedido.idPedido, { sessao: sessao.id, pedido, responder })),
  });
  registrar(sessao, PASTA_LOGS);
  sessao.on('evento', publicar);
  sessoes.set(sessao.id, { sessao, projeto: projeto && path.resolve(projeto), estado: 'rodando' });
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
      const p = await lerJson(req);
      if (!p.tarefa) return json(res, 400, { erro: 'informe a tarefa' });
      return json(res, 201, { sessao: iniciar({ ...p, pasta: p.pasta && path.resolve(p.pasta) }) });
    }
    if (req.method === 'GET' && url.pathname === '/mesas') {
      const projeto = url.searchParams.get('projeto');
      if (!projeto) return json(res, 400, { erro: 'informe ?projeto=' });
      return json(res, 200, { mesas: Escritorio.abrir(projeto).mesas() });
    }
    if (req.method === 'GET' && url.pathname === '/sessoes') {
      return json(res, 200, {
        sessoes: [...sessoes.values()].map(({ sessao, estado }) => ({
          id: sessao.id,
          estado,
          funcionario: sessao.opcoes.funcionario,
          branch: sessao.opcoes.branch,
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
      const ultimo = Number(req.headers['last-event-id'] ?? -1);
      for (let i = Number.isInteger(ultimo) ? ultimo + 1 : 0; i < historico.length; i++) res.write(sse(i));
      res.write('event: historico_fim\ndata: {}\n\n');
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
    if (req.method === 'GET' && url.pathname === '/conta') return json(res, 200, await conta.status());
    if (req.method === 'POST' && url.pathname === '/conta/entrar') return json(res, 200, await conta.iniciarLogin());
    if (req.method === 'POST' && url.pathname === '/conta/codigo') {
      const { codigo } = await lerJson(req);
      if (!codigo) return json(res, 400, { erro: 'informe o código' });
      const r = await conta.enviarCodigo(String(codigo));
      return json(res, 200, { ...r, ...(await conta.status()) });
    }
    if (req.method === 'GET' && url.pathname === '/config') {
      return json(res, 200, { projetoPadrao: PROJETO_PADRAO, aprovarTudo });
    }
    if (req.method === 'POST' && url.pathname === '/config') {
      const c = await lerJson(req);
      if (typeof c.aprovarTudo === 'boolean') aprovarTudo = c.aprovarTudo;
      if (aprovarTudo) {
        for (const [id, p] of pendentes) {
          pendentes.delete(id);
          p.responder({ aprovada: true, motivo: 'aprovação automática ligada' });
        }
      }
      return json(res, 200, { projetoPadrao: PROJETO_PADRAO, aprovarTudo });
    }
    if (req.method === 'GET') {
      const nome = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const tipo = TIPOS[path.extname(nome)];
      if (/^[\w.-]+$/.test(nome) && tipo && fs.existsSync(path.join(PASTA_WEB, nome))) {
        res.writeHead(200, { 'content-type': tipo, 'cache-control': 'no-cache' });
        return res.end(fs.readFileSync(path.join(PASTA_WEB, nome)));
      }
    }
    json(res, 404, { erro: 'rota desconhecida' });
  } catch (e) {
    json(res, 400, { erro: e instanceof Error ? e.message : String(e) });
  }
});

// Ao fechar o app, o login em andamento e as sessões não ficam órfãos.
for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sinal, () => {
    conta.cancelarLogin();
    for (const { sessao } of sessoes.values()) sessao.parar();
    servidor.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
}

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`🧠 cérebro ouvindo. Abra o escritório em http://127.0.0.1:${PORTA}`);
  console.log(`   logs em ${PASTA_LOGS}; projeto padrão ${PROJETO_PADRAO}${aprovarTudo ? '; aprovação automática ligada' : ''}`);
});
