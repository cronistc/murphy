// Demo de ponta a ponta sem servidor: cria uma pasta de projeto de exemplo,
// roda uma tarefa real com o Claude Code e mostra os eventos no terminal.
//
//   node src/demo.ts [--modelo haiku] [--perguntar] [--pasta caminho] ["tarefa"]
//
// Por padrão aprova as permissões automaticamente (mostrando cada uma no log).
// Com --perguntar, pergunta s/n no terminal a cada pedido.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { Sessao, type PedidoPermissao } from './sessao.ts';
import { registrar } from './log.ts';
import type { Evento } from './eventos.ts';

const args = process.argv.slice(2);
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const flag = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? (args.splice(i, 1), true) : false;
};

const modelo = opcao('--modelo') ?? 'haiku';
const perguntar = flag('--perguntar');
const pasta = path.resolve(opcao('--pasta') ?? path.join(os.homedir(), 'escritorio-projetos', `demo-${Date.now()}`));
const tarefa =
  args.join(' ') ||
  'Crie soma.js exportando uma função soma(a, b) e soma.test.js usando node:test e node:assert. ' +
    'Rode os testes com `node --test` e diga se passaram, citando a saída real do comando.';

if (!fs.existsSync(pasta)) {
  fs.mkdirSync(pasta, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: pasta });
}

const rl = perguntar ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null;
async function decidir(p: PedidoPermissao) {
  if (!rl) return { aprovada: true, motivo: 'aprovação automática da demo' };
  const r = await rl.question(`   ✋ Permitir ${p.ferramenta}: ${p.resumo}? [s/N] `);
  return /^s/i.test(r) ? { aprovada: true, motivo: 'usuário aprovou' } : { aprovada: false, motivo: 'usuário negou' };
}

const sessao = new Sessao({ pasta, tarefa, modelo, decidirPermissao: decidir });
const arquivos = registrar(sessao, path.resolve('logs'));
let fim: Evento | undefined;
sessao.on('evento', (ev: Evento) => {
  if (ev.tipo === 'tarefa_terminada' || ev.tipo === 'erro') fim = ev;
});

await sessao.rodar();
rl?.close();

console.log('\n--- resumo ---');
if (fim?.tipo === 'tarefa_terminada') console.log(`resultado final:\n${fim.resultado}\n`);
console.log(`eventos: ${arquivos.eventos}\nbruto:   ${arquivos.brutos}\npasta:   ${pasta}`);
process.exit(fim?.tipo === 'tarefa_terminada' && fim.sucesso ? 0 : 1);
