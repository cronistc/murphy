// Eventos normalizados do cérebro.
// Cada evento corresponde a um estado técnico real de uma sessão de trabalho
// (princípio 1: "trabalho é real"). A camada do jogo só reage a estes eventos.

export type EventoBase = {
  sessao: string; // id interno do cérebro (não o session_id da CLI)
  em: string; // ISO timestamp
};

export type Evento = EventoBase &
  (
    | {
        tipo: 'sessao_iniciada';
        pasta: string;
        modelo: string;
        tarefa: string;
        funcionario?: string;
        branch?: string;
        conversa?: boolean;
      }
    | { tipo: 'cli_pronta'; sessionIdCli: string; modelo: string; ferramentas: number }
    | { tipo: 'texto'; texto: string }
    | { tipo: 'ferramenta_chamada'; idChamada: string; ferramenta: string; resumo: string; detalhe?: string }
    | { tipo: 'ferramenta_resultado'; idChamada: string; erro: boolean; resumo: string; detalhe?: string }
    | { tipo: 'permissao_pedida'; idPedido: string; ferramenta: string; resumo: string }
    | { tipo: 'permissao_respondida'; idPedido: string; aprovada: boolean; motivo: string }
    | { tipo: 'cota'; status: string; janela?: string; uso?: number; renovaEm?: string }
    | { tipo: 'compactacao'; tokensAntes: number; tokensDepois?: number }
    | {
        tipo: 'tarefa_terminada';
        sucesso: boolean;
        subtipo: string;
        resultado?: string;
        duracaoMs: number;
        turnos: number;
        custoUsd: number;
      }
    | { tipo: 'erro'; mensagem: string }
    // Eventos do escritório (não de uma sessão): sessao = 'escritorio'.
    | { tipo: 'mensagem'; de: string; para: string; texto: string }
    | { tipo: 'equipe'; equipe: Funcionario[]; motivo: string }
    | { tipo: 'contratacao_pedida'; idPedido: string; cargo: Cargo; motivo: string; pedidoPor: string }
    | { tipo: 'contratacao_respondida'; idPedido: string; aprovada: boolean; contratado?: string }
    | { tipo: 'tarefa_delegada'; de: string; para: string; tarefa: string; local?: string }
    | { tipo: 'integracao'; funcionario: string; ok: boolean; mensagem: string }
    // Expediente: abre quando o app abre, fecha quando o app fecha.
    | { tipo: 'expediente'; fase: 'aberto' | 'encerrando' | 'encerrado'; luzCaiu?: boolean; resumo?: string; daily?: string }
    | { tipo: 'humor'; funcionario: string; humor: number; motivo: string }
    | { tipo: 'almoco'; ate: string | null; motivo?: string } // cota perto do limite
    | { tipo: 'agenda'; agenda: Agenda }
    | { tipo: 'aniversario'; funcionario: string }
    | { tipo: 'maquina'; carga: number; temperatura: number; nucleos: number } // carga real do PC
    | { tipo: 'cofre'; acao: 'desfeito'; hash: string; assunto: string }
    | { tipo: 'config'; internet: boolean; aprovarTudo: boolean }
  );

export type Cargo = 'chefe' | 'senior' | 'pleno' | 'junior' | 'designer' | 'redator' | 'pesquisador' | 'qa' | 'arquiteto' | 'ti';

export type Funcionario = {
  id: string; // slug: nome da mesa e da branch
  nome: string;
  cargo: Cargo;
  modelo: string; // opus | sonnet | haiku
  personalidade: string;
  contratadoEm: string;
  humor?: number; // 0–100; muda com o tratamento e com o trabalho, nunca a qualidade
  aniversario?: string; // MM-DD
  ferias?: boolean;
  ultimaSessao?: string; // session_id da CLI da última conversa/tarefa (memória)
};

// Agenda do dia, gerada uma vez de manhã pela "atriz" (modelo barato).
export type Agenda = {
  data: string; // AAAA-MM-DD
  jornal: { titulo: string; fonte: string; url?: string; resumo: string }[];
  falas: Record<string, string[]>;
  ideias: Record<string, string>;
};

export type TipoEvento = Evento['tipo'];
