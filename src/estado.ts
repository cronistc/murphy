// O que o escritório lembra entre um dia e outro: projeto, equipe, conversas,
// diário, tarefas interrompidas, agenda do dia, configurações.
// Fica em ~/.local/share/escritorio-pixel/escritorio.json (ou PASTA_DADOS).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Agenda, Funcionario } from './eventos.ts';

export type Mensagem = { de: string; para: string; texto: string; em: string };
export type EntradaDiario = { data: string; quem: string; texto: string; em: string };
export type Pendente = { funcionario: string; tarefa: string; sessaoCli?: string; delegadoPor: string; local?: string };

export type Estado = {
  versao: 2;
  boasVindas: boolean; // primeira abertura concluída
  projeto?: { nome: string; pasta: string; descricao: string };
  equipe: Funcionario[];
  conversas: Record<string, Mensagem[]>; // por funcionário
  sessaoChefe?: string; // session_id da CLI do chefe
  aberto: boolean; // expediente aberto (se o app morrer, fica true: "a luz caiu")
  diario: EntradaDiario[];
  pendentes: Pendente[]; // tarefas interrompidas no fim do expediente
  agenda?: Agenda;
  internet: boolean; // Wi-Fi do escritório: pesquisa e navegação web dos funcionários
  aprovarTudo: boolean;
  ideiasDitas: string[]; // datas em que cada um já contou a ideia do dia (id:data)
  escritorio?: { nome: string; area: string };
  fase: 'entrevista' | 'operando'; // entrevista: o chefe ainda está conhecendo o escritório com você
  relatorio: Record<string, string>; // o relatório do chefe (vira ESCRITORIO.md no projeto)
  recomendacao?: { cargo: string; motivo: string }[];
  voz?: { chave: string; regiao: string }; // Azure Speech (vozes da Microsoft), opcional
  // O computador do gestor: papel de parede, ícones da tela inicial (ordem e
  // quais aparecem) e atalhos para sites.
  // A vida de cada um fora do trabalho: o que pensou, disse, ouviu e fez (memória curta).
  vida?: Record<string, { em: string; tipo: 'pensou' | 'disse' | 'ouviu' | 'fez'; texto: string; com?: string }[]>;
  // por computador (cada um é independente): 'voce', 'principal' ou o id da pessoa
  computadores?: Record<string, { papel?: string; icones?: string[]; atalhos?: { nome: string; url: string }[] }>;
  computador?: { papel?: string; icones?: string[]; atalhos?: { nome: string; url: string }[] }; // antigo (1.3 de teste)
};

export const PASTA_DADOS = path.resolve(
  process.env.PASTA_DADOS ?? path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'escritorio-pixel'),
);
const ARQUIVO = path.join(PASTA_DADOS, 'escritorio.json');

function novo(): Estado {
  return {
    versao: 2, boasVindas: false, equipe: [], conversas: {}, aberto: false, diario: [], pendentes: [],
    internet: true, aprovarTudo: false, ideiasDitas: [], fase: 'entrevista', relatorio: {},
  };
}

export function carregar(): Estado {
  try {
    const e = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
    if (e.versao === 2) {
      // 1.0 → 1.1: escritórios antigos já estavam operando.
      if (!e.fase) e.fase = e.boasVindas ? 'operando' : 'entrevista';
      if (!e.escritorio && e.projeto) e.escritorio = { nome: e.projeto.nome, area: 'programacao' };
      return { ...novo(), ...e };
    }
    if (e.versao === 1) {
      // 0.2 → 1.0: a conversa única era com o chefe.
      const chefe = (e.equipe ?? []).find((f: Funcionario) => f.cargo === 'chefe');
      const { conversa = [], ...resto } = e;
      return { ...novo(), ...resto, versao: 2, conversas: chefe ? { [chefe.id]: conversa } : {} };
    }
  } catch {}
  return novo();
}

export function salvar(e: Estado) {
  fs.mkdirSync(PASTA_DADOS, { recursive: true });
  for (const k of Object.keys(e.conversas)) e.conversas[k] = e.conversas[k].slice(-200);
  e.diario = e.diario.slice(-400);
  e.ideiasDitas = e.ideiasDitas.slice(-200);
  const tmp = `${ARQUIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(e, null, 2));
  fs.renameSync(tmp, ARQUIVO); // escrita atômica: queda de luz não corrompe
}

export const hoje = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
