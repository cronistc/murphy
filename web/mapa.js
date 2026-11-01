// O mapa do escritório: tiles, objetos (bloqueiam a passagem), lugares (onde
// alguém fica) e o caminho entre dois pontos. Lógica pura, testável no Node.

export const TILE = 16;
export const LARGURA = 32;
export const ALTURA = 18;

// Mesas de trabalho: ocupam (x,y) e (x+1,y); o assento fica em (x, y+1).
export const MESAS = [
  { x: 8, y: 5 }, { x: 11, y: 5 }, { x: 14, y: 5 }, { x: 17, y: 5 },
  { x: 8, y: 9 }, { x: 11, y: 9 }, { x: 14, y: 9 }, { x: 17, y: 9 },
  { x: 8, y: 13 }, { x: 11, y: 13 }, { x: 14, y: 13 }, { x: 17, y: 13 },
].map((m, i) => ({ ...m, id: i, assento: { x: m.x, y: m.y + 1 }, ao_lado: { x: m.x + 1, y: m.y + 1 } }));

export const OBJETOS = {
  estante: { x: 1, y: 2, w: 3, h: 1, nome: 'Estante (diário do escritório)' },
  balcaoCafe: { x: 9, y: 2, w: 3, h: 1, nome: 'Café' },
  roteador: { x: 14, y: 2, w: 1, h: 1, nome: 'Wi-Fi do escritório' },
  arCondicionado: { x: 16, y: 2, w: 1, h: 1, nome: 'Ar-condicionado' },
  mesaReuniao: { x: 23, y: 4, w: 5, h: 2, nome: 'Mesa de reunião' },
  tv: { x: 23, y: 11, w: 3, h: 1, nome: 'TV (jornal do dia)' },
  bebedouro: { x: 29, y: 11, w: 1, h: 1, nome: 'Bebedouro' },
  mesaGestor: { x: 2, y: 13, w: 3, h: 1, nome: 'Sua mesa' },
  cofre: { x: 6, y: 13, w: 1, h: 1, nome: 'Cofre (histórico e desfazer)' },
  planta1: { x: 1, y: 16, w: 1, h: 1 },
  planta2: { x: 30, y: 16, w: 1, h: 1 },
  planta3: { x: 6, y: 2, w: 1, h: 1 },
  planta4: { x: 21, y: 16, w: 1, h: 1 },
  planta5: { x: 30, y: 2, w: 1, h: 1 },
};

// O sofá não bloqueia: dá para sentar nele.
export const SOFA = { x: 23, y: 15, w: 3 };

export const LUGARES = {
  estante: [{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }],
  cafe: [{ x: 9, y: 3 }, { x: 10, y: 3 }, { x: 11, y: 3 }, { x: 12, y: 3 }],
  // em frente à sua mesa (quem vem pedir permissão ou entregar trabalho)
  chefe: [{ x: 3, y: 14 }, { x: 2, y: 14 }, { x: 4, y: 14 }, { x: 5, y: 14 }, { x: 1, y: 14 }, { x: 5, y: 15 }],
  reuniao: [
    { x: 23, y: 3 }, { x: 24, y: 3 }, { x: 25, y: 3 }, { x: 26, y: 3 }, { x: 27, y: 3 },
    { x: 23, y: 6 }, { x: 24, y: 6 }, { x: 25, y: 6 }, { x: 26, y: 6 }, { x: 27, y: 6 },
    { x: 22, y: 4 }, { x: 28, y: 5 },
  ],
  cabeceira: { x: 22, y: 5 }, // onde o chefe fica na reunião
  sofa: [{ x: 23, y: 15 }, { x: 24, y: 15 }, { x: 25, y: 15 }],
  tv: [{ x: 22, y: 13 }, { x: 26, y: 13 }, { x: 24, y: 13 }],
  bebedouro: [{ x: 28, y: 11 }, { x: 29, y: 12 }, { x: 28, y: 12 }, { x: 27, y: 12 }],
  janela: [{ x: 19, y: 2 }, { x: 20, y: 2 }, { x: 4, y: 2 }, { x: 5, y: 2 }],
  planta: [{ x: 6, y: 3 }, { x: 29, y: 2 }, { x: 22, y: 16 }, { x: 2, y: 16 }],
  roteador: { x: 14, y: 3 },
  arCondicionado: { x: 16, y: 3 },
  cofre: { x: 6, y: 14 },
  gestor: { x: 3, y: 12 }, // a sua cadeira (atrás da sua mesa)
  porta: { x: 7, y: 17 },
  banheiro: { x: 31, y: 8 },
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
  if (bloqueado(para.x, para.y)) return null;
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

// Tile livre mais perto de um ponto (para chegar perto de um objeto ou pessoa).
export function vizinhoLivre(alvo, de) {
  const opcoes = [];
  for (let r = 1; r <= 3 && !opcoes.length; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.abs(dx) + Math.abs(dy) !== r) continue;
      const p = { x: alvo.x + dx, y: alvo.y + dy };
      if (!bloqueado(p.x, p.y)) opcoes.push(p);
    }
  }
  opcoes.sort((a, b) => Math.hypot(a.x - de.x, a.y - de.y) - Math.hypot(b.x - de.x, b.y - de.y));
  return opcoes[0] ?? null;
}
