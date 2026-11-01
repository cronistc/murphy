// O "cérebro": a porta de entrada HTTP para o orquestrador (o escritório).
// Qualquer interface (a janela do app, um celular, curl) só se conecta a ele.
//
//   GET  /estado               projeto, equipe, conversa com o chefe, pedidos
//   POST /boas-vindas          {"nome", "descricao"?, "pasta"?}  primeira abertura
//   POST /chefe                {"texto"}  fala com o chefe
//   GET  /candidatos?cargo=    candidatos para contratar (junior | pleno | senior)
//   POST /contratar            {"nome", "cargo"}
//   POST /contratacoes/:id     {"aprovar": bool}  pedido de contratação do chefe
//   POST /funcionarios/:id/tarefa {"tarefa"}  tarefa direta (sem passar pelo chefe)
//   POST /permissoes/:id       {"aprovar": bool}
//   GET  /eventos              stream SSE (histórico + ao vivo)
//   GET  /config, POST /config {"aprovarTudo": bool}
//   GET  /conta, POST /conta/entrar, POST /conta/codigo {"codigo"}  login na conta Claude
//   POST /sessoes, GET /sessoes, GET /mesas?projeto=  API de baixo nível (demos)
//   GET  /                     a tela do escritório (pasta web/)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Escritorio } from './escritorio.ts';
import { Orquestrador } from './orquestrador.ts';
import { CARGOS } from './candidatos.ts';
import { formatar } from './log.ts';
import { PASTA_DADOS } from './estado.ts';
import * as conta from './conta.ts';
import type { Cargo, Evento } from './eventos.ts';

const PORTA = Number(process.env.PORTA ?? 4317);
const PASTA_LOGS = path.resolve(process.env.PASTA_LOGS ?? path.join(PASTA_DADOS, 'logs'));
const PASTA_WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
};

const escritorio = new Orquestrador({ pastaLogs: PASTA_LOGS, aprovarTudo: process.env.APROVAR_TUDO === '1' });
const historico: Evento[] = [];
const ouvintes = new Set<http.ServerResponse>();

// O id SSE é a posição no histórico: ao reconectar, o navegador manda
// Last-Event-ID e recebe só o que perdeu.
const sse = (i: number) => `id: ${i}\ndata: ${JSON.stringify(historico[i])}\n\n`;
escritorio.on('evento', (ev: Evento) => {
  if (ev.sessao === 'escritorio') console.log(formatar(ev)); // as sessões já se registram sozinhas
  historico.push(ev);
  const linha = sse(historico.length - 1);
  for (const res of ouvintes) res.write(linha);
});

async function lerJson(req: http.IncomingMessage): Promise<any> {
  let corpo = '';
  for await (const parte of req) corpo += parte;
  return corpo ? JSON.parse(corpo) : {};
}

function json(res: http.ServerResponse, status: number, dados: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(dados, null, 2));
}

function estadoPublico() {
  const e = escritorio.estado;
  return {
    boasVindas: e.boasVindas,
    projeto: e.projeto,
    equipe: e.equipe.map((f) => ({ ...f, titulo: CARGOS[f.cargo].titulo, ocupado: escritorio.ocupado(f.id) })),
    conversa: e.conversa.slice(-100),
    contratacoes: [...escritorio.contratacoes].map(([id, c]) => ({ id, ...c, titulo: CARGOS[c.cargo].titulo })),
    aprovarTudo: escritorio.aprovarTudo,
    cargos: Object.fromEntries(Object.entries(CARGOS).filter(([k]) => k !== 'chefe').map(([k, v]) => [k, { titulo: v.titulo, verdade: v.verdade, modelo: v.modelo }])),
  };
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const rota = `${req.method} ${url.pathname}`;
    let m: RegExpMatchArray | null;

    if (rota === 'GET /estado') return json(res, 200, estadoPublico());
    if (rota === 'POST /boas-vindas') {
      escritorio.boasVindas(await lerJson(req));
      return json(res, 200, estadoPublico());
    }
    if (rota === 'POST /chefe') {
      escritorio.falarComChefe(String((await lerJson(req)).texto ?? ''));
      return json(res, 200, { ok: true });
    }
    if (rota === 'GET /candidatos') return json(res, 200, { candidatos: escritorio.candidatos(url.searchParams.get('cargo') as Cargo) });
    if (rota === 'POST /contratar') {
      const { nome, cargo } = await lerJson(req);
      return json(res, 200, { contratado: escritorio.contratar(nome, cargo) });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/contratacoes\/([\w-]+)$/))) {
      const { aprovar } = await lerJson(req);
      return json(res, 200, { contratado: escritorio.responderContratacao(m[1], Boolean(aprovar)) ?? null });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/funcionarios\/([\w-]+)\/tarefa$/))) {
      const { tarefa } = await lerJson(req);
      if (!tarefa?.trim()) return json(res, 400, { erro: 'descreva a tarefa' });
      return json(res, 201, { sessao: escritorio.tarefa(m[1], tarefa.trim(), 'voce') });
    }
    if (req.method === 'POST' && (m = url.pathname.match(/^\/permissoes\/([\w-]+)$/))) {
      const { aprovar, motivo } = await lerJson(req);
      escritorio.responderPermissao(m[1], Boolean(aprovar), motivo);
      return json(res, 200, { ok: true });
    }
    if (rota === 'GET /eventos') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      const ultimo = Number(req.headers['last-event-id'] ?? -1);
      for (let i = Number.isInteger(ultimo) ? ultimo + 1 : 0; i < historico.length; i++) res.write(sse(i));
      res.write('event: historico_fim\ndata: {}\n\n');
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }
    if (rota === 'GET /config') return json(res, 200, { aprovarTudo: escritorio.aprovarTudo });
    if (rota === 'POST /config') {
      const c = await lerJson(req);
      if (typeof c.aprovarTudo === 'boolean') escritorio.definirAprovarTudo(c.aprovarTudo);
      return json(res, 200, { aprovarTudo: escritorio.aprovarTudo });
    }
    if (rota === 'GET /conta') return json(res, 200, await conta.status());
    if (rota === 'POST /conta/entrar') return json(res, 200, await conta.iniciarLogin());
    if (rota === 'POST /conta/codigo') {
      const { codigo } = await lerJson(req);
      if (!codigo) return json(res, 400, { erro: 'informe o código' });
      const r = await conta.enviarCodigo(String(codigo));
      return json(res, 200, { ...r, ...(await conta.status()) });
    }

    // API de baixo nível (demos e testes)
    if (rota === 'POST /sessoes') {
      const p = await lerJson(req);
      if (!p.tarefa) return json(res, 400, { erro: 'informe a tarefa' });
      return json(res, 201, { sessao: escritorio.sessaoLivre({ ...p, pasta: p.pasta && path.resolve(p.pasta) }) });
    }
    if (rota === 'GET /sessoes') {
      return json(res, 200, {
        sessoes: [...escritorio.sessoes.values()].map((r) => ({ id: r.sessao.id, estado: r.estado, funcionario: r.funcionario, pasta: r.sessao.opcoes.pasta, tarefa: r.tarefa })),
        permissoesPendentes: [...escritorio.pendentes.values()].map(({ sessao, pedido }) => ({ sessao, id: pedido.idPedido, ferramenta: pedido.ferramenta, resumo: pedido.resumo })),
      });
    }
    if (rota === 'GET /mesas') {
      const projeto = url.searchParams.get('projeto');
      if (!projeto) return json(res, 400, { erro: 'informe ?projeto=' });
      return json(res, 200, { mesas: Escritorio.abrir(projeto).mesas() });
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
    escritorio.desligar();
    servidor.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
}

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`🧠 cérebro ouvindo. Abra o escritório em http://127.0.0.1:${PORTA}`);
  console.log(`   dados em ${PASTA_DADOS}; logs em ${PASTA_LOGS}${escritorio.aprovarTudo ? '; aprovação automática ligada' : ''}`);
  escritorio.abrirExpediente();
});
