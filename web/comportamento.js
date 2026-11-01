// A única tabela evento real → comportamento do personagem (princípio 1:
// todo comportamento de trabalho corresponde a um estado técnico real).
// Lógica pura, sem DOM, testável no Node. O mapa fica em mapa.js.

export * from './mapa.js';

// ---------- eventos → comportamento ----------

const LEITURA = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'LS', 'NotebookRead']);
const ESCRITA = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
// Comandos que esperam algo rodar: o "cafezinho" do documento.
const ESPERA = /\b(npm|pnpm|yarn|bun|pip|poetry|cargo|go|make|gradle|mvn|pytest|jest|vitest|tsc|docker)\b|node\s+--test|\b(test|build|install)\b/;

export function curto(s, n = 70) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function primeiraFrase(s) {
  const t = String(s ?? '').replace(/[`*#>_]/g, '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^.{10,120}?[.!?](\s|$)/);
  return curto(m ? m[0] : t, 90);
}

// Retorna o que o evento muda no personagem:
//   acao: onde ele deve estar e o que faz lá (ou undefined = não muda)
//   fala: balão de fala curto
//   fixo: a ação não pode ser interrompida por eventos menores
export function comportamento(ev) {
  switch (ev.tipo) {
    case 'sessao_iniciada':
      return { acao: 'pensando', fala: 'Deixa comigo!', chegando: true };
    case 'cli_pronta':
      return { acao: 'pensando' };
    case 'texto':
      return { acao: 'pensando', fala: curto(ev.texto, 80) };
    case 'ferramenta_chamada':
      if (LEITURA.has(ev.ferramenta)) return { acao: 'lendo' };
      if (ESCRITA.has(ev.ferramenta)) return { acao: 'digitando' };
      if (ev.ferramenta === 'Bash') return { acao: ESPERA.test(ev.resumo) ? 'cafe' : 'digitando' };
      if (ev.ferramenta === 'TodoWrite' || ev.ferramenta === 'ToolSearch') return { acao: 'pensando' };
      // Ferramentas do escritório (ver equipe, delegar, pedir contratação): é gestão, não código.
      if (ev.ferramenta.startsWith('mcp__escritorio__')) return { acao: 'pensando' };
      return { acao: 'digitando' };
    case 'ferramenta_resultado':
      return ev.erro ? { fala: 'Hmm, deu erro…' } : {};
    case 'permissao_pedida':
      return { acao: 'pedindo', fala: `Posso? ${ev.ferramenta}: ${curto(ev.resumo, 50)}`, fixo: true };
    case 'permissao_respondida':
      return { acao: 'pensando', fala: ev.aprovada ? 'Valeu!' : 'Ok, não vou fazer.', liberar: true };
    case 'compactacao':
      return { acao: 'banheiro', fala: 'Já volto!' };
    case 'cota':
      return ev.status === 'rejected' ? { acao: 'almoco', fala: 'Cota no limite. Vou almoçar.' } : {};
    case 'tarefa_terminada':
      return ev.sucesso
        ? { acao: 'entregando', fala: `Pronto! ${primeiraFrase(ev.resultado)}`, fixo: true, terminou: true }
        : { acao: 'entregando', fala: `Não consegui terminar (${ev.subtipo}).`, fixo: true, terminou: true };
    case 'erro':
      return { acao: 'travado', fala: `Meu PC travou! ${curto(ev.mensagem, 50)}`, terminou: true };
    default:
      return {};
  }
}

// Onde cada ação acontece. Ações de trabalho vêm de eventos; ações de "vida"
// (bebedouro, sofá, janela…) só acontecem com quem não está trabalhando.
export function lugarDaAcao(acao) {
  switch (acao) {
    case 'lendo': return 'estante';
    case 'cafe': return 'cafe';
    case 'pedindo':
    case 'entregando': return 'chefe';
    case 'banheiro': return 'banheiro';
    case 'almoco':
    case 'saindo':
    case 'ferias': return 'porta';
    case 'visitando': return 'visita'; // o T.I. na mesa de alguém
    case 'reuniao': return 'reuniao';
    case 'bebedouro':
    case 'sofa':
    case 'tv':
    case 'janela':
    case 'planta': return acao;
    default: return 'mesa'; // pensando, digitando, ocioso, travado
  }
}

// Ações que são trabalho (vida nunca interrompe trabalho).
export const TRABALHO = new Set(['pensando', 'digitando', 'lendo', 'cafe', 'pedindo', 'entregando', 'banheiro', 'travado', 'visitando']);
