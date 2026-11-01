// Login do usuário na conta Claude, sem terminal.
// Usa o mesmo executável do Claude Code que o Agent SDK traz embutido, então o
// login vale para os funcionários. O fluxo é o oficial (`claude auth login`):
// ele tentaria abrir o navegador do sistema, mas aqui o `xdg-open` que ele acha
// é um do próprio escritório, que só anota o endereço: o login abre no
// navegador de dentro do jogo. Se o site mostrar um código, o usuário cola na tela.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { ambienteLimpo } from './sessao.ts';
import { PASTA_DADOS } from './estado.ts';

export type StatusConta = { logado: boolean; metodo?: string; email?: string; erro?: string };

// Caminho do Claude Code embutido no SDK (pacote da plataforma); senão, o do PATH.
export function executavelClaude(): string {
  const req = createRequire(import.meta.url);
  const nomes = [`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}`];
  if (process.platform === 'linux') nomes.push(`${nomes[0]}-musl`);
  for (const nome of nomes) {
    try {
      const bin = path.join(path.dirname(req.resolve(`${nome}/package.json`)), process.platform === 'win32' ? 'claude.exe' : 'claude');
      if (fs.existsSync(bin)) return bin;
    } catch {}
  }
  return 'claude';
}

// Só para testar a tela de login num ambiente que já está logado.
const FINGIR_DESLOGADO = process.env.ESCRITORIO_FINGIR_DESLOGADO === '1';

export async function status(): Promise<StatusConta> {
  if (FINGIR_DESLOGADO && !login?.concluido) return { logado: false };
  const rodar = (formato: string) =>
    new Promise<{ erro: Error | null; saida: string }>((r) =>
      execFile(executavelClaude(), ['auth', 'status', formato], { env: ambienteLimpo(), timeout: 30000 }, (erro, saida) => r({ erro, saida })),
    );
  // O JSON diz se está logado; o texto costuma trazer o e-mail da conta.
  const [j, t] = await Promise.all([rodar('--json'), rodar('--text')]);
  try {
    const d = JSON.parse(j.saida);
    const email = d.email ?? t.saida.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0];
    return { logado: Boolean(d.loggedIn), metodo: d.authMethod, ...(email ? { email } : {}) };
  } catch {
    return { logado: false, erro: j.erro ? j.erro.message : 'resposta inesperada do Claude Code' };
  }
}

type Login = { processo: ChildProcess; saida: string; url?: string; urlAutomatica?: string; concluido: boolean; codigoSaida?: number | null };
let login: Login | null = null;

const semCores = (s: string) =>
  s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');

// Inicia `claude auth login`. Roda dentro de `script` para ter um terminal
// (pty): o CLI só pede o código quando está num terminal.
// Os programas que o CLI usaria para abrir o navegador do sistema, trocados
// por um que só anota o endereço.
function navegadorDoJogo() {
  const pasta = path.join(PASTA_DADOS, 'navegador-do-jogo');
  const anotacoes = path.join(pasta, 'enderecos.txt');
  fs.mkdirSync(pasta, { recursive: true });
  const script = '#!/bin/sh\nfor a in "$@"; do case "$a" in http*) printf \'%s\\n\' "$a" >> "$ESCRITORIO_ENDERECOS";; esac; done\nexit 0\n';
  for (const nome of ['xdg-open', 'gio', 'sensible-browser', 'x-www-browser', 'www-browser', 'gnome-open', 'kde-open', 'kde-open5', 'wslview']) {
    fs.writeFileSync(path.join(pasta, nome), script, { mode: 0o755 });
  }
  fs.rmSync(anotacoes, { force: true });
  return { pasta, anotacoes };
}

export async function iniciarLogin(): Promise<{ url?: string; urlCodigo?: string; saida: string }> {
  if (login && !login.concluido) return { url: login.urlAutomatica ?? login.url, urlCodigo: login.url, saida: semCores(login.saida) };
  const bin = executavelClaude();
  const comando = `'${bin.replace(/'/g, `'\\''`)}' auth login --claudeai`;
  const nav = navegadorDoJogo();
  const base = ambienteLimpo();
  const processo = spawn('script', ['-qfc', comando, '/dev/null'], {
    env: { ...base, TERM: 'xterm-256color', COLUMNS: '400', PATH: `${nav.pasta}:${base.PATH ?? process.env.PATH ?? '/usr/bin:/bin'}`, BROWSER: path.join(nav.pasta, 'xdg-open'), ESCRITORIO_ENDERECOS: nav.anotacoes },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const atual: Login = { processo, saida: '', concluido: false };
  login = atual;
  const ler = (d: Buffer) => {
    atual.saida += d.toString();
    atual.url ??= semCores(atual.saida).match(/https:\/\/\S+oauth\/authorize\S+/)?.[0];
  };
  processo.stdout.on('data', ler);
  processo.stderr.on('data', ler);
  processo.on('error', (e) => {
    atual.saida += `\n${e.message}`;
    atual.concluido = true;
  });
  processo.on('exit', (codigo) => {
    atual.concluido = true;
    atual.codigoSaida = codigo;
  });
  // Espera o link aparecer (ou o processo terminar).
  // O endereço "automático" (volta sozinho para o CLI, sem código) é o que ele
  // manda abrir; o impresso na tela pede o código.
  const lerAnotado = () => {
    try { atual.urlAutomatica ??= fs.readFileSync(nav.anotacoes, 'utf8').split('\n').find((l) => l.startsWith('https://')); } catch {}
  };
  for (let i = 0; i < 100 && !(atual.url && atual.urlAutomatica) && !atual.concluido; i++) {
    lerAnotado();
    await new Promise((r) => setTimeout(r, 100));
  }
  lerAnotado();
  return { url: atual.urlAutomatica ?? atual.url, urlCodigo: atual.url, saida: semCores(atual.saida) };
}

// Envia o código que o site mostrou e espera o CLI terminar.
export async function enviarCodigo(codigo: string): Promise<{ ok: boolean; saida: string }> {
  if (!login || login.concluido) throw new Error('nenhum login em andamento; clique em Entrar de novo');
  const atual = login;
  const antes = atual.saida.length;
  atual.processo.stdin?.write(codigo.trim() + '\r');
  // Termina quando o CLI sai (sucesso) ou responde com erro (aí continua
  // esperando outro código, e o usuário pode tentar de novo).
  const resposta = () => semCores(atual.saida.slice(antes)).replace(codigo.trim(), '');
  for (let i = 0; i < 300 && !atual.concluido && !/invalid|error|fail|expired/i.test(resposta()); i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const saida = resposta().replace(/Paste code here if prompted >/g, '').trim().slice(-400);
  return { ok: atual.concluido && atual.codigoSaida === 0, saida };
}

export function loginEmAndamento() {
  return Boolean(login && !login.concluido);
}

export function cancelarLogin() {
  if (login && !login.concluido) login.processo.kill();
}
