// Lógica pura do escritório: o mapa, caminhos e a tradução de eventos reais em
// comportamento. Sem DOM, para poder ser testada no Node.
//
// Princípio 1: todo comportamento de trabalho vem de um evento real. Esta
// tabela é a única fonte de verdade de "o que o personagem está fazendo".

export const TILE = 16;
export const LARGURA = 24;
export const ALTURA = 14;

// ---------- mapa ----------
// Objetos ocupam tiles (bloqueados); "lugares" são tiles onde alguém fica.

export const MESAS = [
  // mesa ocupa (x,y) e (x+1,y); a cadeira/assento fica em (x, y+1)
  { x: 8, y: 4 }, { x: 11, y: 4 }, { x: 14, y: 4 }, { x: 17, y: 4 },
  { x: 8, y: 8 }, { x: 11, y: 8 }, { x: 14, y: 8 }, { x: 17, y: 8 },
].map((m, i) => ({ ...m, id: i, assento: { x: m.x, y: m.y + 1 } }));

export const OBJETOS = {
  estante: { x: 1, y: 2, w: 3, h: 1 },
  balcaoCafe: { x: 20, y: 2, w: 3, h: 1 },
  mesaChefe: { x: 2, y: 9, w: 3, h: 1 },
  cadeiraChefe: { x: 3, y: 8, w: 1, h: 1 },
  planta1: { x: 1, y: 12, w: 1, h: 1 },
  planta2: { x: 22, y: 12, w: 1, h: 1 },
  planta3: { x: 6, y: 2, w: 1, h: 1 },
};

export const LUGARES = {
  estante: [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
  cafe: [{ x: 20, y: 3 }, { x: 21, y: 3 }, { x: 22, y: 3 }, { x: 21, y: 4 }],
  chefe: [{ x: 3, y: 10 }, { x: 2, y: 10 }, { x: 4, y: 10 }, { x: 5, y: 10 }, { x: 1, y: 10 }],
  porta: { x: 6, y: 13 },
  banheiro: { x: 23, y: 11 },
};

export function bloqueado(x, y) {
  if (x < 0 || y < 0 || x >= LARGURA || y >= ALTURA) return true;
  if (x === LUGARES.porta.x && y === LUGARES.porta.y) return false;
  if (x === LUGARES.banheiro.x && y === LUGARES.banheiro.y) return false;
  if (y <= 1 || y === ALTURA - 1 || x === 0 || x === LARGURA - 1) return true; // paredes
  for (const o of Object.values(OBJETOS)) {
    if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.h) return true;
  }
  for (const m of MESAS) if (y === m.y && (x === m.x || x === m.x + 1)) return true;
  return false;
}

// Caminho em tiles (BFS, 4 direções). Inclui o destino, exclui a origem.
export function caminho(de, para) {
  const chave = (p) => p.y * LARGURA + p.x;
  const anterior = new Map([[chave(de), null]]);
  const fila = [de];
  while (fila.length) {
    const p = fila.shift();
    if (p.x === para.x && p.y === para.y) {
      const rota = [];
      for (let q = p; q && chave(q) !== chave(de); q = anterior.get(chave(q))) rota.unshift(q);
      return rota;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (anterior.has(chave(n)) || bloqueado(n.x, n.y)) continue;
      anterior.set(chave(n), p);
      fila.push(n);
    }
  }
  return null;
}

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

// Onde cada ação acontece.
export function lugarDaAcao(acao) {
  switch (acao) {
    case 'lendo': return 'estante';
    case 'cafe': return 'cafe';
    case 'pedindo':
    case 'entregando': return 'chefe';
    case 'banheiro': return 'banheiro';
    case 'almoco': return 'porta';
    default: return 'mesa'; // pensando, digitando, ocioso, travado
  }
}
