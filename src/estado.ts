// O que o escritório lembra entre um dia e outro: projeto, equipe, a conversa
// com o chefe (e a sessão dele, para continuar de onde parou).
// Fica em ~/.local/share/escritorio-pixel/escritorio.json (ou PASTA_DADOS).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Funcionario } from './eventos.ts';

export type Mensagem = { de: string; para: string; texto: string; em: string };

export type Estado = {
  versao: 1;
  boasVindas: boolean; // primeira abertura concluída
  projeto?: { nome: string; pasta: string; descricao: string };
  equipe: Funcionario[];
  conversa: Mensagem[];
  sessaoChefe?: string; // session_id da CLI do chefe
};

export const PASTA_DADOS = path.resolve(
  process.env.PASTA_DADOS ?? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'escritorio-pixel'),
);
const ARQUIVO = path.join(PASTA_DADOS, 'escritorio.json');

export function carregar(): Estado {
  try {
    const e = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    if (e.versao === 1) return e;
  } catch {}
  return { versao: 1, boasVindas: false, equipe: [], conversa: [] };
}

export function salvar(e: Estado) {
  fs.mkdirSync(PASTA_DADOS, { recursive: true });
  e.conversa = e.conversa.slice(-200);
  const tmp = `${ARQUIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(e, null, 2));
  fs.renameSync(tmp, ARQUIVO); // escrita atômica: queda de luz não corrompe
}
