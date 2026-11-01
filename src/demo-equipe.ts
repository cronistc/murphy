// Etapa 2: vários funcionários trabalhando ao mesmo tempo, cada um na sua mesa
// (git worktree próprio). No fim, confere no git o que de fato aconteceu.
//
//   node src/demo-equipe.ts [--modelo haiku] [--projeto caminho]

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Escritorio } from './escritorio.ts';
import { Sessao } from './sessao.ts';
import { registrar } from './log.ts';
import type { Evento } from './eventos.ts';

const args = process.argv.slice(2);
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const modelo = opcao('--modelo') ?? 'haiku';
const projeto = path.resolve(opcao('--projeto') ?? path.join(os.homedir(), 'escritorio-projetos', `equipe-${Date.now()}`));

const equipe = [
  { nome: 'ana', arquivo: 'texto', tarefa: 'Crie texto.js exportando maiusculas(s) e contarPalavras(s), e texto.test.js com node:test.' },
  { nome: 'bruno', arquivo: 'numeros', tarefa: 'Crie numeros.js exportando media(lista) e maximo(lista), e numeros.test.js com node:test.' },
  { nome: 'carla', arquivo: 'datas', tarefa: 'Crie datas.js exportando ehBissexto(ano) e diasNoMes(ano, mes), e datas.test.js com node:test.' },
];
const sufixo =
  ' Use ESM (import/export) e crie um package.json com {"type":"module"} se não existir. ' +
  'Rode `node --test` e cite a saída real. Depois faça commit na sua branch.';

const escritorio = Escritorio.abrir(projeto);
console.log(`🏢 projeto ${escritorio.projeto}\n`);

const janelas: Record<string, { inicio: number; fim: number; ok: boolean }> = {};
await Promise.all(
  equipe.map(async (f) => {
    const mesa = escritorio.mesa(f.nome);
    const sessao = new Sessao({
      ...mesa,
      tarefa: f.tarefa + sufixo,
      modelo,
      instrucoes: escritorio.instrucoes(mesa),
      decidirPermissao: async () => ({ aprovada: true, motivo: 'aprovação automática da demo' }),
    });
    registrar(sessao, path.resolve('logs'));
    janelas[f.nome] = { inicio: Date.now(), fim: 0, ok: false };
    sessao.on('evento', (ev: Evento) => {
      if (ev.tipo === 'tarefa_terminada') janelas[f.nome].ok = ev.sucesso;
    });
    await sessao.rodar();
    janelas[f.nome].fim = Date.now();
  }),
);

// ---------- verificação independente, direto no git ----------
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
console.log('\n=== verificação ===');
let tudoOk = true;
const checar = (cond: boolean, msg: string) => {
  console.log(`${cond ? '✅' : '❌'} ${msg}`);
  tudoOk &&= cond;
};

const t0 = Math.min(...Object.values(janelas).map((j) => j.inicio));
for (const f of equipe) {
  const j = janelas[f.nome];
  console.log(`   ${f.nome.padEnd(6)} ${((j.inicio - t0) / 1000).toFixed(1)}s → ${((j.fim - t0) / 1000).toFixed(1)}s`);
}
const ultimoInicio = Math.max(...Object.values(janelas).map((j) => j.inicio));
const primeiroFim = Math.min(...Object.values(janelas).map((j) => j.fim));
checar(ultimoInicio < primeiroFim, 'as três sessões rodaram ao mesmo tempo (janelas se sobrepõem)');

const mesas = escritorio.mesas();
checar(mesas.length === equipe.length, `${mesas.length} mesas (worktrees): ${mesas.map((m) => m.branch).join(', ')}`);

for (const f of equipe) {
  const m = mesas.find((x) => x.funcionario === f.nome)!;
  const commits = git(escritorio.projeto, 'rev-list', '--count', `main..${m.branch}`);
  checar(janelas[f.nome].ok, `${f.nome}: tarefa terminou com sucesso`);
  checar(Number(commits) >= 1, `${f.nome}: ${commits} commit(s) na ${m.branch}`);
  const limpo = git(m.pasta, 'status', '--porcelain') === '';
  checar(limpo, `${f.nome}: mesa sem alterações pendentes`);
  const outros = equipe.filter((o) => o !== f).map((o) => `${o.arquivo}.js`);
  const vazou = outros.filter((a) => fs.existsSync(path.join(m.pasta, a)));
  checar(vazou.length === 0, `${f.nome}: não tem arquivos dos colegas na mesa${vazou.length ? ` (achei ${vazou})` : ''}`);
  // Roda os testes de novo, por conta própria, na mesa do funcionário.
  let testes: string;
  try {
    testes = execFileSync('node', ['--test'], { cwd: m.pasta, encoding: 'utf8' });
  } catch (e: any) {
    testes = String(e.stdout ?? '') + '\nFALHOU';
  }
  const pass = testes.match(/# pass (\d+)/)?.[1];
  const fail = testes.match(/# fail (\d+)/)?.[1];
  checar(!testes.includes('FALHOU') && fail === '0', `${f.nome}: node --test rodado pelo cérebro: pass=${pass} fail=${fail}`);
}
checar(git(escritorio.projeto, 'status', '--porcelain') === '', 'main intocada (ninguém trabalhou no repositório principal)');

console.log(tudoOk ? '\nTUDO OK' : '\nHÁ FALHAS');
process.exit(tudoOk ? 0 : 1);
