// Retrato grande em pixel art (48×64) para a caixa de diálogo, gerado a partir
// do id da pessoa: sempre o mesmo rosto, com expressão pelo humor e boca que
// mexe enquanto fala.

const PELES = [
  ['#f6d4bb', '#e6b898'], ['#f1c7a5', '#dcab85'], ['#e0ac85', '#c99068'],
  ['#c68863', '#a96f4c'], ['#9d6644', '#82533a'], ['#6f4630', '#5a3826'],
];
const CABELOS = ['#2b1d16', '#5a3620', '#a8692e', '#d9b25c', '#1d1d24', '#8c2f2a', '#8a8a96', '#3b2a4f', '#c9c2b5'];
const IRIS = ['#4a2f1d', '#2b1d16', '#3d6b3a', '#3a5f8a', '#6b4a2b'];
const ROUPA = {
  chefe: '#3b3f4a', senior: '#9b6ae0', pleno: '#4a8ae8', junior: '#4cbf6a', qa: '#e08a3a', arquiteto: '#6b5aa8', ti: '#5f6b7a',
  designer: '#e05a8a', ilustrador: '#f2b84b', designer_grafico: '#d0508a', ux: '#58b0a8', redator: '#c9a227', revisor: '#9aa04a',
  roteirista: '#b05a3a', advogado: '#2e3442', paralegal: '#5a6a8a', pesquisador_juridico: '#4a5a7a', estrategista: '#d9534f',
  copywriter: '#e07a3a', social_media: '#e05ac0', analista_dados: '#3a9a8a', pesquisador: '#4a7ab0',
};
const FUNDO = ['#2b2633', '#26303b', '#332b2b', '#2b332e', '#30283a'];

export function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// Traços fixos de cada pessoa.
export function tracos(p) {
  const h = hash(p.id);
  const h2 = hash(p.id + '·');
  const f = p.genero === 'f';
  return {
    pele: PELES[h % PELES.length],
    cabelo: CABELOS[(h >>> 4) % CABELOS.length],
    // 0 curto, 1 lateral, 2 longo liso, 3 cacheado, 4 coque, 5 rabo, 6 careca, 7 black power
    estilo: f ? [2, 3, 4, 5, 7, 1, 2, 3][(h >>> 8) % 8] : [0, 1, 0, 3, 6, 7, 0, 1][(h >>> 8) % 8],
    iris: IRIS[(h2 >>> 3) % IRIS.length],
    oculos: h2 % 5 === 0,
    barba: !f && (h2 >>> 5) % 4 === 0,
    brincos: f && (h2 >>> 7) % 3 !== 0,
    sardas: (h2 >>> 9) % 7 === 0,
    fundo: FUNDO[(h2 >>> 11) % FUNDO.length],
  };
}

export function desenharRetrato(canvas, p, { falando = false, quadro = 0, piscando = false } = {}) {
  const c = canvas.getContext('2d');
  const t = tracos(p);
  const [pele, sombra] = t.pele;
  const px = (x, y, w, h, cor) => { c.fillStyle = cor; c.fillRect(x, y, w, h); };
  const humor = p.humor ?? 70;
  c.clearRect(0, 0, 48, 64);

  // fundo
  px(0, 0, 48, 64, t.fundo);
  for (let y = 0; y < 64; y += 4) px(0, y, 48, 1, 'rgba(255,255,255,.03)');

  // cabelo de trás (longo, rabo, black power)
  if (t.estilo === 2) px(11, 14, 26, 34, t.cabelo);
  if (t.estilo === 7) { px(8, 6, 32, 30, t.cabelo); px(10, 4, 28, 4, t.cabelo); }
  if (t.estilo === 5) px(33, 18, 6, 18, t.cabelo);

  // roupa e ombros
  const roupa = ROUPA[p.cargo] ?? '#4a8ae8';
  px(4, 50, 40, 14, roupa);
  px(2, 54, 44, 10, roupa);
  px(4, 50, 40, 2, 'rgba(255,255,255,.12)');
  // pescoço
  px(19, 40, 10, 10, sombra);
  px(20, 40, 8, 9, pele);
  // gola
  if (['chefe', 'advogado', 'arquiteto', 'senior', 'pesquisador_juridico'].includes(p.cargo)) {
    px(16, 50, 6, 6, '#f4f1ea'); px(26, 50, 6, 6, '#f4f1ea'); // camisa social
    px(22, 50, 4, 14, p.cargo === 'chefe' ? '#7a2f2a' : '#2e3442'); // gravata
    px(4, 52, 10, 12, '#2e3442'); px(34, 52, 10, 12, '#2e3442'); // paletó
  } else {
    px(19, 49, 10, 3, sombra); px(20, 50, 8, 2, pele); // gola redonda
  }

  // orelhas
  px(12, 27, 3, 6, sombra); px(33, 27, 3, 6, sombra);
  if (t.brincos) { px(12, 33, 2, 2, '#f2d36b'); px(34, 33, 2, 2, '#f2d36b'); }

  // rosto
  px(15, 15, 18, 26, pele);
  px(14, 18, 20, 20, pele);
  px(16, 41, 16, 1, sombra);
  px(14, 36, 2, 2, sombra); px(32, 36, 2, 2, sombra);

  // cabelo da frente
  const cab = t.cabelo;
  switch (t.estilo) {
    case 0: px(14, 11, 20, 7, cab); px(13, 14, 3, 8, cab); px(32, 14, 3, 8, cab); break;
    case 1: px(14, 11, 20, 6, cab); px(13, 13, 4, 10, cab); px(25, 15, 9, 3, cab); px(32, 14, 3, 6, cab); break;
    case 2: px(14, 10, 20, 7, cab); px(12, 13, 4, 30, cab); px(32, 13, 4, 30, cab); px(17, 15, 8, 3, cab); break;
    case 3: for (let i = 0; i < 6; i++) { px(12 + i * 4, 9 + (i % 2) * 2, 5, 6, cab); } px(12, 14, 4, 12, cab); px(32, 14, 4, 12, cab); break;
    case 4: px(14, 11, 20, 6, cab); px(19, 4, 10, 8, cab); px(13, 14, 3, 6, cab); px(32, 14, 3, 6, cab); break;
    case 5: px(14, 11, 20, 6, cab); px(13, 13, 3, 8, cab); px(32, 13, 3, 6, cab); break;
    case 6: px(15, 14, 18, 2, sombra); break; // careca
    case 7: px(12, 10, 24, 6, cab); px(11, 13, 4, 12, cab); px(33, 13, 4, 12, cab); break;
  }
  px(14, 16, 20, 1, 'rgba(0,0,0,.08)');

  // sobrancelhas (preocupado quando o humor está baixo)
  const sob = t.estilo === 6 ? '#6b4a2b' : cab;
  if (humor <= 35) { px(17, 23, 5, 1, sob); px(16, 24, 1, 1, sob); px(26, 23, 5, 1, sob); px(31, 24, 1, 1, sob); }
  else if (humor >= 80) { px(17, 22, 5, 1, sob); px(26, 22, 5, 1, sob); }
  else { px(17, 23, 5, 1, sob); px(26, 23, 5, 1, sob); }

  // olhos
  if (piscando) {
    px(17, 27, 5, 1, '#2a1f1a'); px(26, 27, 5, 1, '#2a1f1a');
  } else {
    px(17, 25, 5, 4, '#fbf8f2'); px(26, 25, 5, 4, '#fbf8f2');
    px(19, 25, 3, 4, t.iris); px(28, 25, 3, 4, t.iris);
    px(20, 26, 1, 2, '#120c0a'); px(29, 26, 1, 2, '#120c0a');
    px(19, 25, 1, 1, '#fff'); px(28, 25, 1, 1, '#fff');
    px(17, 24, 5, 1, 'rgba(0,0,0,.25)'); px(26, 24, 5, 1, 'rgba(0,0,0,.25)');
  }
  if (t.oculos) {
    c.strokeStyle = '#1f1f26'; c.lineWidth = 1;
    c.strokeRect(15.5, 23.5, 8, 7); c.strokeRect(24.5, 23.5, 8, 7);
    px(23, 26, 2, 1, '#1f1f26');
    px(16, 24, 2, 1, 'rgba(255,255,255,.35)'); px(25, 24, 2, 1, 'rgba(255,255,255,.35)');
  }

  // nariz e bochechas
  px(23, 29, 2, 4, sombra); px(22, 32, 4, 1, sombra);
  if (humor >= 75) { px(16, 32, 3, 2, 'rgba(229,103,95,.35)'); px(29, 32, 3, 2, 'rgba(229,103,95,.35)'); }
  if (t.sardas) for (const [x, y] of [[17, 31], [19, 32], [28, 31], [30, 32], [18, 33], [29, 33]]) px(x, y, 1, 1, sombra);

  // barba
  if (t.barba) { px(15, 33, 18, 7, t.cabelo); px(17, 40, 14, 2, t.cabelo); px(19, 35, 10, 3, pele); }

  // boca: fala (abre e fecha), sorriso, neutra ou triste
  const labio = '#8a3b2e';
  if (falando && quadro % 2 === 0) {
    px(20, 35, 8, 4, '#4a1a16'); px(21, 35, 6, 1, '#f4f1ea'); px(21, 38, 6, 1, '#c45a5a');
  } else if (falando) {
    px(21, 36, 6, 2, '#4a1a16');
  } else if (humor >= 65) {
    px(19, 35, 1, 1, labio); px(20, 36, 8, 1, labio); px(28, 35, 1, 1, labio); px(21, 37, 6, 1, 'rgba(0,0,0,.15)');
  } else if (humor <= 35) {
    px(20, 37, 1, 1, labio); px(21, 36, 6, 1, labio); px(27, 37, 1, 1, labio);
  } else {
    px(21, 36, 6, 1, labio);
  }

  // acessórios do cargo
  if (p.cargo === 'ti') { px(11, 22, 3, 10, '#24232b'); px(13, 12, 22, 2, '#24232b'); px(34, 22, 3, 10, '#24232b'); px(10, 30, 6, 2, '#24232b'); }
  if (p.cargo === 'ilustrador') { px(33, 10, 3, 14, '#f2b84b'); px(33, 8, 3, 2, '#e5675f'); } // lápis na orelha
}
