// Candidatos para contratação. A personalidade de cada cargo nasce do que o
// modelo realmente é (documento da ideia, "Equipe"), então o usuário aprende
// quando usar cada um sem precisar entender de modelos.

import type { Cargo, Funcionario } from './eventos.ts';
import { slug } from './escritorio.ts';

export type InfoCargo = { titulo: string; modelo: string; verdade: string; personalidades: string[] };

export const CARGOS: Record<Cargo, InfoCargo> = {
  chefe: {
    titulo: 'Chefe de equipe',
    modelo: 'opus',
    verdade: 'O mais capaz e o mais caro. Planeja, distribui o trabalho e revisa.',
    personalidades: ['Calma, pensa antes de agir e gosta de uma boa reunião.'],
  },
  senior: {
    titulo: 'Sênior',
    modelo: 'opus',
    verdade: 'O mais capaz e o mais caro. Para tarefas difíceis e decisões de arquitetura.',
    personalidades: [
      'Calmo e metódico; lê tudo antes de mexer.',
      'Experiente, fala pouco e acerta muito.',
      'Gosta de explicar o porquê das coisas.',
    ],
  },
  pleno: {
    titulo: 'Pleno',
    modelo: 'sonnet',
    verdade: 'Bom equilíbrio entre custo e qualidade. Resolve a maior parte sem drama.',
    personalidades: [
      'O confiável do time: entrega sem alarde.',
      'Organizado, adora uma lista de tarefas.',
      'Prático e direto; prefere mostrar a explicar.',
    ],
  },
  junior: {
    titulo: 'Júnior',
    modelo: 'haiku',
    verdade: 'Rápido e barato. Ótimo em tarefas simples; erra mais nas complexas.',
    personalidades: [
      'Rápido e animado; às vezes apronta e pede ajuda.',
      'Curioso, faz mil perguntas e aprende rápido.',
      'Empolgado com tudo, digita antes de pensar.',
    ],
  },
};

const NOMES = [
  'Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Fábio', 'Gabi', 'Heitor', 'Iara', 'João', 'Kátia', 'Léo',
  'Marta', 'Nina', 'Otávio', 'Paula', 'Rafa', 'Sofia', 'Tiago', 'Úrsula', 'Vítor', 'Wagner', 'Yara', 'Zeca',
  'Bia', 'Caio', 'Duda', 'Enzo', 'Flora', 'Guto', 'Helô', 'Igor', 'Juju', 'Lara', 'Malu', 'Nando',
];

export type Candidato = Omit<Funcionario, 'id' | 'contratadoEm'> & { verdade: string; titulo: string };

// Sorteio estável dentro do dia, para a lista não mudar a cada clique.
function embaralhar<T>(lista: T[], semente: number): T[] {
  const a = [...lista];
  let s = semente || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function candidatos(cargo: Cargo, ocupados: string[], quantos = 3, semente = new Date().getDate()): Candidato[] {
  const info = CARGOS[cargo];
  const usados = new Set(ocupados.map(slug));
  const livres = embaralhar(NOMES, semente * 31 + cargo.length).filter((n) => !usados.has(slug(n)));
  return livres.slice(0, quantos).map((nome, i) => ({
    nome,
    cargo,
    modelo: info.modelo,
    personalidade: info.personalidades[(i + semente) % info.personalidades.length],
    verdade: info.verdade,
    titulo: info.titulo,
  }));
}
