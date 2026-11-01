// Login do usuário na conta Claude, sem terminal.
// Usa o mesmo executável do Claude Code que o Agent SDK traz embutido, então o
// login vale para os funcionários. O fluxo é o oficial (`claude auth login`):
// ele abre o navegador sozinho e, se o site mostrar um código, o usuário cola
// o código na tela do escritório.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { ambienteLimpo } from './sessao.ts';

export type StatusConta = { logado: boolean; metodo?: string; erro?: string };

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

export function status(): Promise<StatusConta> {
  if (FINGIR_DESLOGADO && !login?.concluido) return Promise.resolve({ logado: false });
  return new Promise((resolver) => {
    execFile(executavelClaude(), ['auth', 'status', '--json'], { env: ambienteLimpo(), timeout: 30000 }, (erro, saida) => {
      try {
        const j = JSON.parse(saida);
        resolver({ logado: Boolean(j.loggedIn), metodo: j.authMethod });
      } catch {
        resolver({ logado: false, erro: erro ? erro.message : 'resposta inesperada do Claude Code' });
      }
    });
  });
}

type Login = { processo: ChildProcess; saida: string; url?: string; concluido: boolean; codigoSaida?: number | null };
let login: Login | null = null;

const semCores = (s: string) =>
  s.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '');

// Inicia `claude auth login`. Roda dentro de `script` para ter um terminal
// (pty): o CLI só pede o código quando está num terminal.
export async function iniciarLogin(): Promise<{ url?: string; saida: string }> {
  if (login && !login.concluido) return { url: login.url, saida: semCores(login.saida) };
  const bin = executavelClaude();
  const comando = `'${bin.replace(/'/g, `'\\''`)}' auth login --claudeai`;
  const processo = spawn('script', ['-qfc', comando, '/dev/null'], {
    env: { ...ambienteLimpo(), TERM: 'xterm-256color', COLUMNS: '400' },
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
  for (let i = 0; i < 100 && !atual.url && !atual.concluido; i++) await new Promise((r) => setTimeout(r, 100));
  return { url: atual.url, saida: semCores(atual.saida) };
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

export function cancelarLogin() {
  if (login && !login.concluido) login.processo.kill();
}
