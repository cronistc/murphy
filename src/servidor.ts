// O "cérebro": a porta de entrada HTTP para o orquestrador (o escritório).
// Qualquer interface (a janela do app, um celular, curl) só se conecta a ele.
//
//   GET  /estado                      tudo o que a tela precisa ao abrir
//   POST /boas-vindas                 {"nome", "descricao"?, "pasta"?}
//   POST /conversar                   {"para", "texto"}  fala com alguém (o chefe ou qualquer um)
//   GET  /candidatos?cargo=           candidatos para contratar
//   POST /contratar                   {"nome", "cargo"}
//   POST /contratacoes/:id            {"aprovar"}  pedido de contratação do chefe
//   POST /funcionarios/:id/tarefa     {"tarefa"}  tarefa direta
//   POST /funcionarios/:id/ferias     {"ferias": bool}
//   POST /funcionarios/:id/demitir
//   POST /funcionarios/:id/elogiar | /bronca
//   POST /permissoes/:id              {"aprovar"}
//   GET  /eventos                     stream SSE (histórico + ao vivo)
//   GET  /config, POST /config        {"aprovarTudo"?, "internet"?}
//   POST /expediente/encerrar         fim do expediente (a janela chama ao fechar)
//   GET  /cofre, GET /cofre/:hash, POST /cofre/:hash/desfazer
//   POST /terminais {"alvo"}          abre o computador (principal | voce | id); GET /terminais/:id/saida (SSE);
//                                     POST /terminais/:id/entrada {"dados"}, /tamanho {"colunas","linhas"}, /fechar
//   POST /entregar-meu-trabalho, POST /abrir-pasta {"alvo"}, POST /agenda/gerar
//   GET  /conta, POST /conta/entrar, POST /conta/codigo {"codigo"}
//   POST /sessoes, GET /sessoes, GET /mesas?projeto=   API de baixo nível (demos)
//   GET  /                            a tela do escritório (pasta web/)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Escritorio } from './escritorio.ts';
import { Orquestrador } from './orquestrador.ts';
import { CARGOS, AREAS, area, tituloDe } from './candidatos.ts';
import { formatar } from './log.ts';
import { PASTA_DADOS } from './estado.ts';
import { Terminal, terminais } from './terminal.ts';
import * as conta from './conta.ts';
import { sintetizar, vozDe } from './voz.ts';
import type { Cargo, Evento } from './eventos.ts';

const PORTA = Number(process.env.PORTA ?? 4317);
const PASTA_LOGS = path.resolve(process.env.PASTA_LOGS ?? path.join(PASTA_DADOS, 'logs'));
const PASTA_WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const TIPOS: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const escritorio = new Orquestrador({ pastaLogs: PASTA_LOGS, aprovarTudo: process.env.APROVAR_TUDO === '1' });
const historico: Evento[] = [];
const ouvintes = new Set<http.ServerResponse>();

// O id SSE é a posição no histórico: ao reconectar, o navegador manda
// Last-Event-ID e recebe só o que perdeu. A leitura da máquina (a cada 10 s)
// não entra no histórico: só a última importa.
const sse = (i: number) => `id: ${i}\ndata: ${JSON.stringify(historico[i])}\n\n`;
let ultimaMaquina: Evento | undefined;
escritorio.on('evento', (ev: Evento) => {
  if (ev.tipo === 'fala_parcial') {
    for (const res of ouvintes) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    return;
  }
  if (ev.tipo === 'maquina') {
    ultimaMaquina = ev;
    for (const res of ouvintes) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    return;
  }
  if (ev.sessao === 'escritorio') console.log(formatar(ev)); // as sessões já se registram sozinhas
  historico.push(ev);
  if (historico.length > 20000) historico.splice(0, 5000); // dia muito longo: guarda o recente
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
    equipe: e.equipe.map((f) => ({ ...f, titulo: tituloDe(f), ocupado: escritorio.ocupado(f.id), trabalhando: escritorio.trabalhando(f.id) })),
    conversas: Object.fromEntries(Object.entries(e.conversas).map(([k, v]) => [k, v.slice(-60)])),
    contratacoes: [...escritorio.contratacoes].map(([id, c]) => ({ id, ...c, titulo: CARGOS[c.cargo].titulo })),
    aprovarTudo: e.aprovarTudo,
    internet: e.internet,
    almocoAte: escritorio.almocoAte,
    agenda: e.agenda,
    diario: e.diario.slice(-40),
    pendentes: e.pendentes.length,
    maquina: escritorio.ultimaMaquina,
    escritorio: e.escritorio,
    fase: e.fase,
    relatorio: e.relatorio,
    recomendacao: e.recomendacao ?? [],
    areas: AREAS,
    vozConfigurada: Boolean(e.voz?.chave),
    cargos: Object.fromEntries(
      Object.entries(CARGOS)
        .filter(([k]) => k !== 'chefe')
        .map(([k, v]) => [k, { titulo: v.titulo, verdade: v.verdade, modelo: v.modelo, daArea: area(e.escritorio?.area).cargos.includes(k) }]),
    ),
  };
}

function servirTerminal(t: Terminal, req: http.IncomingMessage, res: http.ServerResponse) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const enviar = (texto: string) => res.write(`data: ${Buffer.from(texto, 'utf8').toString('base64')}\n\n`);
  if (t.historico) enviar(t.historico);
  const ouvir = (texto: string) => enviar(texto);
  const fim = () => {
    res.write('event: fim\ndata: {}\n\n');
    res.end();
  };
  t.on('saida', ouvir);
  t.once('fim', fim);
  req.on('close', () => {
    t.off('saida', ouvir);
    t.off('fim', fim);
  });
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
    if (rota === 'POST /conversar') {
      const { para, texto } = await lerJson(req);
      escritorio.conversar(String(para ?? ''), String(texto ?? ''));
      return json(res, 200, { ok: true });
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
    if (req.method === 'POST' && (m = url.pathname.match(/^\/funcionarios\/([\w-]+)\/(tarefa|ferias|demitir|elogiar|bronca)$/))) {
      const [, id, acao] = m;
      const corpo = await lerJson(req);
      if (acao === 'tarefa') {
        if (!corpo.tarefa?.trim()) return json(res, 400, { erro: 'descreva a tarefa' });
        return json(res, 201, { sessao: escritorio.tarefa(id, corpo.tarefa.trim(), 'voce') });
      }
      if (acao === 'ferias') escritorio.definirFerias(id, Boolean(corpo.ferias));
      if (acao === 'demitir') escritorio.demitir(id);
      if (acao === 'elogiar') escritorio.ajustarHumor(id, 12, 'elogio do gestor');
      if (acao === 'bronca') escritorio.ajustarHumor(id, -15, 'bronca do gestor');
      return json(res, 200, { ok: true });
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
      if (ultimaMaquina) res.write(`data: ${JSON.stringify(ultimaMaquina)}\n\n`);
      ouvintes.add(res);
      req.on('close', () => ouvintes.delete(res));
      return;
    }
    if (rota === 'GET /config') return json(res, 200, { aprovarTudo: escritorio.aprovarTudo, internet: escritorio.estado.internet });
    if (rota === 'POST /config') {
      const c = await lerJson(req);
      if (typeof c.aprovarTudo === 'boolean') escritorio.definirAprovarTudo(c.aprovarTudo);
      if (typeof c.internet === 'boolean') escritorio.definirInternet(c.internet);
      return json(res, 200, { aprovarTudo: escritorio.aprovarTudo, internet: escritorio.estado.internet });
    }
    if (rota === 'POST /expediente/encerrar') {
      for (const t of terminais.values()) t.fechar();
      return json(res, 200, { resumo: await escritorio.encerrarExpediente() });
    }
    if (rota === 'POST /expediente/abrir') {
      if (!escritorio.estado.aberto) escritorio.abrirExpediente();
      return json(res, 200, { ok: true });
    }
    if (rota === 'GET /cofre') return json(res, 200, { historico: escritorio.historico() });
    if (req.method === 'GET' && (m = url.pathname.match(/^\/cofre\/([0-9a-f]{7,40})$/))) return json(res, 200, { detalhe: escritorio.detalheDoHistorico(m[1]) });
    if (req.method === 'POST' && (m = url.pathname.match(/^\/cofre\/([0-9a-f]{7,40})\/desfazer$/))) return json(res, 200, { desfeito: escritorio.desfazer(m[1]) });

    if (rota === 'POST /terminais') {
      const { alvo = 'voce' } = await lerJson(req);
      const pasta = escritorio.pastaDoComputador(String(alvo));
      const t = new Terminal(pasta);
      terminais.set(t.id, t);
      t.once('fim', () => setTimeout(() => terminais.delete(t.id), 60_000));
      return json(res, 201, { id: t.id, pasta });
    }
    if ((m = url.pathname.match(/^\/terminais\/([\w-]+)\/(saida|entrada|tamanho|fechar)$/))) {
      const t = terminais.get(m[1]);
      if (!t) return json(res, 404, { erro: 'esse computador já foi desligado' });
      if (m[2] === 'saida' && req.method === 'GET') return servirTerminal(t, req, res);
      const corpo = await lerJson(req);
      if (m[2] === 'entrada') t.escrever(String(corpo.dados ?? ''));
      if (m[2] === 'tamanho') t.redimensionar(Number(corpo.colunas), Number(corpo.linhas));
      if (m[2] === 'fechar') t.fechar();
      return json(res, 200, { ok: true });
    }
    // ---------- computador: arquivos e prévia ----------
    if (rota === 'GET /arquivos') return json(res, 200, escritorio.listarArquivos(url.searchParams.get('alvo') ?? 'voce', url.searchParams.get('caminho') ?? ''));
    if (rota === 'GET /arquivo') return json(res, 200, escritorio.lerArquivo(url.searchParams.get('alvo') ?? 'voce', url.searchParams.get('caminho') ?? ''));
    if (rota === 'PUT /arquivo') {
      const { alvo = 'voce', caminho, conteudo } = await lerJson(req);
      return json(res, 200, escritorio.salvarArquivo(alvo, caminho, conteudo ?? ''));
    }
    if (req.method === 'GET' && (m = url.pathname.match(/^\/previa\/([\w-]+)\/?(.*)$/))) {
      // O site que a equipe fez, servido de verdade (abre no navegador do computador).
      let { abs } = escritorio.caminhoSeguro(m[1], decodeURIComponent(m[2]));
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html');
      if (!fs.existsSync(abs)) {
        res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        return res.end('<body style="font-family:system-ui;padding:2em;color:#555"><h2>Ainda não tem página aqui</h2><p>Quando a equipe criar um index.html nesta pasta, ele aparece aqui.</p></body>');
      }
      const ext = path.extname(abs).toLowerCase();
      const tipos: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.pdf': 'application/pdf' };
      res.writeHead(200, { 'content-type': tipos[ext] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      return res.end(fs.readFileSync(abs));
    }

    // ---------- vozes ----------
    if (rota === 'GET /voz') {
      const cfg = escritorio.estado.voz;
      const f = escritorio.funcionario(url.searchParams.get('funcionario') ?? '');
      if (!cfg || !f) return json(res, 404, { erro: 'voz não configurada' });
      const audio = await sintetizar(cfg, url.searchParams.get('texto') ?? '', vozDe(f));
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'max-age=86400' });
      return res.end(audio);
    }
    if (rota === 'POST /voz/config') {
      const { chave, regiao } = await lerJson(req);
      if (chave) await sintetizar({ chave, regiao: regiao || 'brazilsouth' }, 'Olá!', { voz: 'pt-BR-FranciscaNeural', ritmo: '0%', tom: '0%' }); // testa antes de guardar
      escritorio.definirVoz(chave ?? '', regiao ?? '');
      return json(res, 200, { ok: true, configurada: Boolean(chave) });
    }

    if (rota === 'POST /entregar-meu-trabalho') return json(res, 200, escritorio.entregarMeuTrabalho());
    if (rota === 'POST /abrir-pasta') return json(res, 200, { pasta: escritorio.abrirPasta(String((await lerJson(req)).alvo ?? 'principal')) });
    if (rota === 'POST /agenda/gerar') {
      escritorio.gerarAgenda(true);
      return json(res, 202, { ok: true });
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

// Fechou sem passar pelo fim do expediente (sinal): salva o que der e sai.
let saindo = false;
for (const sinal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(sinal, async () => {
    if (saindo) return;
    saindo = true;
    conta.cancelarLogin();
    for (const t of terminais.values()) t.fechar();
    setTimeout(() => process.exit(0), 8000).unref();
    try {
      if (escritorio.estado.aberto) await escritorio.encerrarExpediente();
    } catch {}
    escritorio.desligar();
    servidor.close();
    process.exit(0);
  });
}

servidor.listen(PORTA, '127.0.0.1', () => {
  console.log(`🧠 cérebro ouvindo. Abra o escritório em http://127.0.0.1:${PORTA}`);
  console.log(`   dados em ${PASTA_DADOS}; logs em ${PASTA_LOGS}${escritorio.aprovarTudo ? '; aprovação automática ligada' : ''}`);
  escritorio.abrirExpediente();
});
