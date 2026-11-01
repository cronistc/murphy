// O computador de verdade do escritório: quando o gestor senta numa mesa, abre
// um terminal real (bash) na pasta daquela mesa. Roda num pty via `script`
// (util-linux), sem módulo nativo; o tamanho da tela é ajustado com stty.

import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { ambienteLimpo } from './sessao.ts';

export class Terminal extends EventEmitter {
  readonly id = randomUUID().slice(0, 8);
  readonly pasta: string;
  private proc: ChildProcess;
  private buffer = ''; // o que já saiu (para quem conectar depois)
  vivo = true;

  constructor(pasta: string) {
    super();
    this.pasta = pasta;
    const shell = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/bash';
    this.proc = spawn('script', ['-qfc', `${shell} -i`, '/dev/null'], {
      cwd: pasta,
      env: { ...ambienteLimpo(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const sair = (d: Buffer) => {
      const t = d.toString('utf8');
      this.buffer = (this.buffer + t).slice(-200_000);
      this.emit('saida', t);
    };
    this.proc.stdout!.on('data', sair);
    this.proc.stderr!.on('data', sair);
    this.proc.on('exit', () => {
      this.vivo = false;
      this.emit('fim');
    });
  }

  get historico() {
    return this.buffer;
  }

  escrever(dados: string) {
    if (this.vivo) this.proc.stdin!.write(dados);
  }

  // O shell roda num pty criado pelo `script`; acha esse pty e ajusta o tamanho.
  redimensionar(colunas: number, linhas: number) {
    const c = Math.max(20, Math.min(400, Math.floor(colunas)));
    const l = Math.max(5, Math.min(200, Math.floor(linhas)));
    execFile('pgrep', ['-P', String(this.proc.pid)], (_e, filhos) => {
      for (const pid of String(filhos).split(/\s+/).filter(Boolean)) {
        try {
          const tty = fs.readlinkSync(`/proc/${pid}/fd/0`);
          if (!tty.startsWith('/dev/pts/')) continue;
          execFile('stty', ['-F', tty, 'cols', String(c), 'rows', String(l)], () => {
            try {
              process.kill(Number(pid), 'SIGWINCH');
            } catch {}
          });
        } catch {}
      }
    });
  }

  fechar() {
    if (!this.vivo) return;
    this.vivo = false;
    try {
      this.proc.kill('SIGHUP');
    } catch {}
  }
}

export const terminais = new Map<string, Terminal>();
