// Um escritório = um projeto (repositório git) + mesas.
// Cada mesa é um git worktree próprio, numa branch própria: o "computador"
// de um funcionário. Assim vários trabalham ao mesmo tempo sem pisar no
// arquivo do outro, e o trabalho de cada um fica versionado na sua branch.
//
//   ~/escritorio-projetos/meu-app            ← repositório principal (main)
//   ~/escritorio-projetos/meu-app.mesas/ana  ← worktree da Ana, branch mesa/ana

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export type Mesa = { funcionario: string; pasta: string; branch: string };

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function tenta(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}

// Nome do funcionário vira nome de pasta e de branch: só [a-z0-9-].
export function slug(nome: string): string {
  const s = nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) throw new Error(`nome de funcionário inválido: "${nome}"`);
  return s;
}

export class Escritorio {
  readonly projeto: string;
  readonly pastaMesas: string;

  private constructor(projeto: string) {
    this.projeto = projeto;
    this.pastaMesas = `${projeto}.mesas`;
  }

  // Abre (ou cria) o projeto: garante repositório git com pelo menos um commit,
  // que é o ponto de partida das mesas.
  static abrir(pasta: string): Escritorio {
    const projeto = path.resolve(pasta);
    if (projeto === path.parse(projeto).root || projeto === os.homedir()) {
      throw new Error(`não uso ${projeto} como projeto; escolha uma pasta própria`);
    }
    fs.mkdirSync(projeto, { recursive: true });
    const raiz = tenta(() => git(projeto, 'rev-parse', '--show-toplevel'));
    const ehRaizDeRepo = raiz !== null && path.resolve(raiz) === projeto;
    if (!ehRaizDeRepo) {
      // Pasta nova ou vazia vira um repositório próprio (mesmo que esteja
      // dentro de outro, ex.: home versionada). Pasta com arquivos é do
      // usuário: ele decide se vira projeto; nunca sequestramos um repo maior.
      if (fs.readdirSync(projeto).length > 0) {
        throw new Error(
          raiz
            ? `${projeto} está dentro de outro repositório (${raiz}); use a raiz dele ou uma pasta vazia`
            : `${projeto} já tem arquivos e não é um repositório git; use uma pasta vazia ou rode git init nela`,
        );
      }
      git(projeto, 'init', '-q', '-b', 'main');
    }
    if (tenta(() => git(projeto, 'config', 'user.name')) === null) {
      git(projeto, 'config', 'user.name', 'Escritório Pixel');
      git(projeto, 'config', 'user.email', 'escritorio@localhost');
    }
    if (tenta(() => git(projeto, 'rev-parse', '--verify', 'HEAD')) === null) {
      git(projeto, 'commit', '-q', '--allow-empty', '-m', 'Escritório aberto');
    }
    return new Escritorio(projeto);
  }

  // A mesa do funcionário; cria o worktree na primeira vez, reutiliza depois.
  mesa(funcionario: string): Mesa {
    const nome = slug(funcionario);
    const pasta = path.join(this.pastaMesas, nome);
    const branch = `mesa/${nome}`;
    const existente = this.mesas().find((m) => m.pasta === pasta);
    if (existente) return existente;

    fs.mkdirSync(this.pastaMesas, { recursive: true });
    const branchExiste = tenta(() => git(this.projeto, 'rev-parse', '--verify', `refs/heads/${branch}`)) !== null;
    if (branchExiste) git(this.projeto, 'worktree', 'add', '-q', pasta, branch);
    else git(this.projeto, 'worktree', 'add', '-q', '-b', branch, pasta, 'HEAD');
    return { funcionario: nome, pasta, branch };
  }

  // Mesas existentes (worktrees dentro da pasta de mesas).
  mesas(): Mesa[] {
    const saida = git(this.projeto, 'worktree', 'list', '--porcelain');
    const mesas: Mesa[] = [];
    for (const bloco of saida.split('\n\n')) {
      const pasta = bloco.match(/^worktree (.+)$/m)?.[1];
      const ref = bloco.match(/^branch refs\/heads\/(.+)$/m)?.[1];
      if (!pasta || !ref || path.dirname(pasta) !== this.pastaMesas) continue;
      mesas.push({ funcionario: path.basename(pasta), pasta, branch: ref });
    }
    return mesas;
  }

  // Instruções anexadas ao system prompt de quem trabalha numa mesa.
  instrucoes(m: Mesa): string {
    return [
      `Você é ${m.funcionario}, trabalhando na sua própria mesa: o git worktree ${m.pasta}, branch ${m.branch}.`,
      'Trabalhe só dentro desta pasta. Outros colegas trabalham em paralelo em outras branches; não mexa nelas.',
      'Ao terminar uma tarefa que mudou arquivos, faça commit na sua branch com uma mensagem clara.',
      'Só diga que algo está pronto com evidência (comando rodado e saída real).',
    ].join('\n');
  }
}
