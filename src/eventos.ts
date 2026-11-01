// Eventos normalizados do cérebro.
// Cada evento corresponde a um estado técnico real de uma sessão de trabalho
// (princípio 1: "trabalho é real"). A camada do jogo só reage a estes eventos.

export type EventoBase = {
  sessao: string; // id interno do cérebro (não o session_id da CLI)
  em: string; // ISO timestamp
};

export type Evento = EventoBase &
  (
    | { tipo: 'sessao_iniciada'; pasta: string; modelo: string; tarefa: string }
    | { tipo: 'cli_pronta'; sessionIdCli: string; modelo: string; ferramentas: number }
    | { tipo: 'texto'; texto: string }
    | { tipo: 'ferramenta_chamada'; idChamada: string; ferramenta: string; resumo: string }
    | { tipo: 'ferramenta_resultado'; idChamada: string; erro: boolean; resumo: string }
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
  );

export type TipoEvento = Evento['tipo'];
