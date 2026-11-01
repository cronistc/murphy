// Pixel art do escritório, desenhada à mão em código (sem imagens).
// Tudo é desenhado num canvas de baixa resolução e depois ampliado.

import { TILE as T, LARGURA, ALTURA, MESAS, OBJETOS, LUGARES, SOFA } from './mapa.js';

export const W = LARGURA * T;
export const H = ALTURA * T;

let g;
const r = (x, y, w, h, c) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};

export function corDoModelo(m = '') {
  if (m.includes('opus')) return '#9b6ae0';
  if (m.includes('haiku')) return '#4cbf6a';
  if (m.includes('sonnet')) return '#4a8ae8';
  return '#d98a3d';
}

// ---------- sala ----------
function ceu(hora) {
  if (hora < 6 || hora >= 19) return ['#1d2547', '#2c3a6b'];
  if (hora < 8) return ['#f2b58a', '#f7d6b0'];
  if (hora >= 17) return ['#e8906a', '#f4b98a'];
  return ['#9fd3f0', '#c4e6f8'];
}

function chao() {
  for (let y = 2; y < ALTURA - 1; y++) {
    for (let x = 1; x < LARGURA - 1; x++) {
      r(x * T, y * T, T, T, (x + y) % 2 ? '#c49a6c' : '#bd9366');
      r(x * T, y * T + 7, T, 1, '#a97f55');
      r(x * T + ((y * 5) % 16), y * T, 1, 7, '#ad835a');
      r(x * T + ((y * 11 + 7) % 16), y * T + 8, 1, 8, '#ad835a');
    }
  }
  // tapete da área de trabalho
  r(7 * T + 8, 4 * T + 8, 13 * T, 11 * T, '#7d6a8a');
  r(7 * T + 10, 4 * T + 10, 13 * T - 4, 11 * T - 4, '#8a779a');
  // sala de reunião
  r(21 * T + 4, 2 * T + 4, 9 * T, 6 * T - 4, '#5e7f8a');
  r(21 * T + 6, 2 * T + 6, 9 * T - 4, 6 * T - 8, '#6b8e99');
  // canto de descanso
  r(21 * T + 4, 10 * T + 6, 9 * T + 8, 7 * T - 6, '#8a6f55');
  r(21 * T + 6, 10 * T + 8, 9 * T + 4, 7 * T - 10, '#97795c');
}

function paredes(t, hora) {
  r(0, 0, W, 2 * T, '#ecdfca');
  r(0, 2 * T - 4, W, 4, '#8a6f55');
  r(0, 0, W, 3, '#d6c6ad');
  const [c1, c2] = ceu(hora);
  for (const jx of [18, 24]) {
    r(jx * T, 4, 3 * T, 20, '#6d5843');
    r(jx * T + 2, 6, 3 * T - 4, 16, c1);
    r(jx * T + 2, 6, 3 * T - 4, 5, c2);
    if (hora < 6 || hora >= 19) {
      r(jx * T + 8, 9, 1, 1, '#fff');
      r(jx * T + 30, 13, 1, 1, '#fff');
      r(jx * T + 40, 8, 2, 2, '#f4f1d0');
    }
    r(jx * T + T + 7, 6, 2, 16, '#6d5843');
    r(jx * T + 2 * T + 7, 6, 2, 16, '#6d5843');
    r(jx * T - 1, 24, 3 * T + 2, 2, '#8a6f55');
  }
  // quadro
  r(4 * T + 4, 6, 20, 14, '#5b4636');
  r(4 * T + 6, 8, 16, 10, '#e9a35b');
  r(4 * T + 6, 13, 16, 5, '#6aa36f');
  // relógio
  const cx = 12 * T + 8;
  r(cx - 5, 6, 10, 10, '#f4f1ea');
  r(cx - 5, 6, 10, 1, '#5b4636');
  r(cx - 5, 15, 10, 1, '#5b4636');
  r(cx - 1, 8, 1, 4, '#222');
  r(cx, 11, 3, 1, '#222');
  // laterais e chão de baixo
  r(0, 0, T, H, '#4b3e33');
  r(W - T, 0, T, H, '#4b3e33');
  r(0, H - T, W, T, '#4b3e33');
  r(T - 2, 2 * T, 2, H - 3 * T, '#3a2f27');
  r(W - T, 2 * T, 2, H - 3 * T, '#3a2f27');
  // porta de entrada
  const p = LUGARES.porta;
  r(p.x * T, p.y * T, T, T, '#bd9366');
  r(p.x * T + 1, p.y * T + 2, T - 2, 8, '#7a3b2e');
  r(p.x * T + 3, p.y * T + 4, T - 6, 4, '#8f4a3b');
  // banheiro
  const b = LUGARES.banheiro;
  r(b.x * T, b.y * T - 4, T, T + 4, '#a0764f');
  r(b.x * T + 2, b.y * T - 2, T - 4, T, '#b8875b');
  r(b.x * T + 3, b.y * T + 5, 2, 2, '#f2d36b');
  r(b.x * T + 6, b.y * T - 1, 6, 4, '#e8e8f0');
  r(b.x * T + 7, b.y * T, 1, 2, '#4a8ae8');
  r(b.x * T + 10, b.y * T, 1, 2, '#e5675f');
}

// ---------- móveis ----------
function tela(x, y, p, t, mesaId) {
  r(x, y, 14, 10, '#24232b');
  const ligado = p && (p.ocupado || p.computadorLigado);
  if (!ligado) return r(x + 1, y + 1, 12, 8, p ? '#1d3048' : '#15161b');
  const acao = p.sentado ? p.acao : 'fora';
  if (acao === 'travado') {
    r(x + 1, y + 1, 12, 8, '#2346b8');
    r(x + 3, y + 3, 8, 1, '#fff');
    r(x + 3, y + 5, 5, 1, '#fff');
    return;
  }
  r(x + 1, y + 1, 12, 8, '#0f1a14');
  if (acao === 'digitando' || p.ehVoce) {
    const s = Math.floor(t * 7) + mesaId * 13;
    for (let i = 0; i < 4; i++) {
      const w = 2 + (((s + i * 7) * 31) % 9);
      r(x + 2 + (i % 2) * 2, y + 2 + i * 2, Math.min(w, 9), 1, i % 3 ? '#6fe39a' : '#e6f2ea');
    }
  } else if (acao === 'pensando' || acao === 'ocioso') {
    r(x + 2, y + 2, 6, 1, '#6fe39a');
    r(x + 2, y + 4, 4, 1, '#6fe39a');
    if (Math.floor(t * 2) % 2) r(x + 7, y + 4, 2, 1, '#e6f2ea');
  } else {
    r(x + 2, y + 3, 10, 3, '#203328');
    r(x + 2, y + 3, 1 + Math.floor((t * 3) % 10), 3, '#6fe39a');
  }
}

function mesa(m, ocupante, t, festa) {
  const x = m.x * T;
  const y = m.y * T;
  r(x + 1, y + 14, 3, 6, '#5a3a1c');
  r(x + 28, y + 14, 3, 6, '#5a3a1c');
  r(x, y + 3, 32, 11, '#8b5a2b');
  r(x, y + 3, 32, 2, '#a8713f');
  r(x, y + 13, 32, 2, '#6b4220');
  tela(x + 9, y - 6, ocupante, t, m.id);
  r(x + 15, y + 4, 2, 2, '#24232b');
  r(x + 11, y + 9, 10, 2, '#d9d9e0');
  r(x + 25, y + 6, 3, 4, '#f4f1ea');
  r(x + 25, y + 7, 3, 1, '#d36a4a');
  if (festa) {
    // bolo e balões de aniversário
    r(x + 2, y + 5, 7, 4, '#f4d6e4');
    r(x + 2, y + 5, 7, 1, '#e5675f');
    r(x + 5, y + 2, 1, 3, '#f2d36b');
    const b = Math.sin(t * 2) * 1.5;
    r(x + 28, y - 14 + b, 5, 6, '#e5675f');
    r(x + 33, y - 11 - b, 5, 6, '#4a8ae8');
    r(x + 30, y - 8 + b, 1, 10, '#ddd');
    r(x + 35, y - 5 - b, 1, 10, '#ddd');
  }
}

function cadeira(p) {
  r(p.x * T + 3, p.y * T + 1, 10, 7, '#3a3a48');
  r(p.x * T + 4, p.y * T + 8, 8, 4, '#4a4a5c');
  r(p.x * T + 7, p.y * T + 12, 2, 2, '#222');
  r(p.x * T + 4, p.y * T + 14, 8, 1, '#222');
}

function estante() {
  const o = OBJETOS.estante;
  const x = o.x * T;
  const y = T + 2;
  r(x, y, o.w * T, 2 * T - 2, '#6b4423');
  r(x + 2, y + 2, o.w * T - 4, 2 * T - 6, '#4a2f18');
  const cores = ['#d9534f', '#4a8ae8', '#f2b84b', '#5fc27e', '#9b6ae0', '#e8e0d0', '#d98a3d'];
  for (let prat = 0; prat < 3; prat++) {
    const py = y + 3 + prat * 9;
    let bx = x + 3;
    let i = prat * 3;
    while (bx < x + o.w * T - 5) {
      const w = 2 + ((i * 7) % 3);
      const h = 6 + ((i * 5) % 2);
      r(bx, py + 7 - h, w, h, cores[i % cores.length]);
      bx += w + 1;
      i++;
    }
    r(x + 2, py + 7, o.w * T - 4, 2, '#6b4423');
  }
}

function cafe(t) {
  const o = OBJETOS.balcaoCafe;
  const x = o.x * T;
  const y = o.y * T;
  r(x, y + 2, o.w * T, 13, '#7b8494');
  r(x, y + 2, o.w * T, 3, '#9aa3b2');
  r(x + 6, y - 10, 14, 16, '#2f2f38');
  r(x + 8, y - 8, 10, 5, '#454552');
  r(x + 16, y - 1, 2, 2, Math.floor(t * 2) % 2 ? '#e5675f' : '#7a2f2a');
  r(x + 11, y + 1, 4, 4, '#f4f1ea');
  r(x + 26, y - 2, 4, 5, '#f4f1ea');
  r(x + 32, y - 2, 4, 5, '#4a8ae8');
  r(x + 38, y - 6, 6, 9, '#c94f3d');
}

function roteador(t, internet) {
  const o = OBJETOS.roteador;
  const x = o.x * T;
  const y = o.y * T;
  r(x + 2, y + 6, 12, 8, '#3b3f4a');
  r(x + 2, y + 6, 12, 2, '#4d5260');
  r(x + 4, y, 1, 7, '#2a2d35');
  r(x + 11, y, 1, 7, '#2a2d35');
  const pisca = Math.floor(t * 4) % 2;
  r(x + 5, y + 10, 1, 1, internet ? (pisca ? '#6fe39a' : '#2f7a4a') : '#e5675f');
  r(x + 8, y + 10, 1, 1, internet ? '#6fe39a' : '#7a2f2a');
  r(x + 11, y + 10, 1, 1, '#f2b84b');
}

function arCondicionado(t, temperatura) {
  const o = OBJETOS.arCondicionado;
  const x = o.x * T;
  const y = o.y * T;
  // termômetro na parede + aparelho
  r(x + 2, y - 10, 12, 6, '#f4f1ea');
  r(x + 2, y - 5, 12, 1, '#c9c2b5');
  for (let i = 0; i < 3; i++) r(x + 4 + i * 3, y - 8 + (Math.floor(t * 6 + i) % 2), 1, 2, '#bcd8e8');
  r(x + 5, y + 2, 6, 12, '#f4f1ea');
  r(x + 7, y + 4, 2, 8, '#ddd');
  const nivel = Math.max(1, Math.min(8, Math.round((temperatura - 18) / 2)));
  r(x + 7, y + 12 - nivel, 2, nivel, temperatura >= 28 ? '#e5675f' : temperatura >= 25 ? '#f2b84b' : '#4a8ae8');
}

function cofre() {
  const o = OBJETOS.cofre;
  const x = o.x * T;
  const y = o.y * T;
  r(x + 1, y - 2, 14, 16, '#5d6470');
  r(x + 2, y - 1, 12, 14, '#717986');
  r(x + 5, y + 3, 6, 6, '#3f444d');
  r(x + 7, y + 5, 2, 2, '#f2b84b');
  r(x + 12, y + 4, 1, 4, '#cfd3da');
}

function mesaReuniao() {
  const o = OBJETOS.mesaReuniao;
  const x = o.x * T;
  const y = o.y * T;
  r(x - 2, y + 2, o.w * T + 4, o.h * T - 2, '#5e3b22');
  r(x - 2, y + 2, o.w * T + 4, 3, '#7a4e2d');
  r(x + 20, y + 12, 10, 6, '#f4f1ea');
  r(x + 50, y + 8, 4, 5, '#f4f1ea');
}

function cadeiraReuniao(p) {
  r(p.x * T + 4, p.y * T + 4, 8, 8, '#3a5560');
  r(p.x * T + 5, p.y * T + 5, 6, 6, '#4b6b78');
}

function tv(t, agenda) {
  const o = OBJETOS.tv;
  const x = o.x * T;
  const y = o.y * T;
  r(x + 2, y + 8, o.w * T - 4, 7, '#4a3524');
  r(x + 4, y - 14, o.w * T - 8, 22, '#1d1d24');
  const ligada = agenda?.jornal?.length;
  r(x + 6, y - 12, o.w * T - 12, 18, ligada ? '#1c3b5c' : '#15161b');
  if (ligada) {
    r(x + 8, y - 10, 14, 6, '#e5675f'); // vinheta do jornal
    r(x + 24, y - 9, 12, 1, '#e6f2ea');
    r(x + 24, y - 7, 8, 1, '#e6f2ea');
    // letreiro correndo
    const pos = Math.floor((t * 12) % (o.w * T - 12));
    r(x + 6, y + 1, o.w * T - 12, 4, '#f2b84b');
    for (let i = 0; i < 6; i++) r(x + 6 + ((pos + i * 7) % (o.w * T - 14)), y + 2, 4, 1, '#241a05');
  }
}

function sofa() {
  const x = SOFA.x * T;
  const y = SOFA.y * T;
  r(x - 4, y - 2, SOFA.w * T + 8, 6, '#7a2f2a');
  r(x - 4, y + 4, SOFA.w * T + 8, 9, '#93403a');
  r(x - 6, y - 2, 4, 15, '#6a2925');
  r(x + SOFA.w * T + 2, y - 2, 4, 15, '#6a2925');
}

function bebedouro(t) {
  const o = OBJETOS.bebedouro;
  const x = o.x * T;
  const y = o.y * T;
  r(x + 3, y - 8, 10, 10, '#bfe3f7');
  r(x + 4, y - 7, 8, 8, '#9fd3f0');
  if (Math.floor(t * 0.5) % 4 === 0) r(x + 7, y - 4 + Math.floor((t * 4) % 3), 1, 1, '#fff');
  r(x + 2, y + 2, 12, 12, '#e8e8f0');
  r(x + 5, y + 5, 2, 2, '#4a8ae8');
  r(x + 9, y + 5, 2, 2, '#e5675f');
}

function mesaGestor() {
  const o = OBJETOS.mesaGestor;
  const x = o.x * T;
  const y = o.y * T;
  r(x, y + 1, o.w * T, 14, '#5e3b22');
  r(x, y + 1, o.w * T, 3, '#7a4e2d');
  r(x + 2, y + 13, o.w * T - 4, 3, '#4a2e1a');
  r(x + 18, y - 4, 14, 8, '#24232b');
  r(x + 24, y + 4, 2, 2, '#24232b');
  r(x + 4, y + 6, 10, 3, '#f2b84b');
  r(x + 36, y + 5, 6, 6, '#f4f1ea');
  r(x + 37, y + 6, 4, 2, '#e9e0d0');
}

function cadeiraGestor() {
  const p = LUGARES.gestor;
  r(p.x * T + 2, p.y * T + 1, 12, 9, '#7a2f2a');
  r(p.x * T + 3, p.y * T + 2, 10, 6, '#93403a');
  r(p.x * T + 7, p.y * T + 10, 2, 3, '#222');
}

function planta(o) {
  const x = o.x * T;
  const y = o.y * T;
  r(x + 4, y + 9, 8, 6, '#b5653d');
  r(x + 4, y + 9, 8, 2, '#c97a4f');
  r(x + 2, y + 1, 5, 8, '#3f8f4f');
  r(x + 8, y - 1, 5, 10, '#4fa85f');
  r(x + 5, y - 3, 5, 9, '#5fc27e');
}

// Datas festivas (calendário real).
function decoracao(t, data) {
  const mes = data.getMonth() + 1;
  const dia = data.getDate();
  if (mes === 12) {
    // árvore de Natal no canto
    const x = 20 * T;
    const y = 15 * T;
    r(x + 6, y + 10, 4, 5, '#6b4423');
    for (let i = 0; i < 4; i++) r(x + 8 - (i + 1) * 2, y - 8 + i * 5, (i + 1) * 4, 5, '#2f7a4a');
    r(x + 7, y - 11, 2, 3, '#f2d36b');
    for (let i = 0; i < 6; i++) r(x + 3 + ((i * 5) % 10), y - 4 + i * 2, 1, 1, ['#e5675f', '#f2d36b', '#4a8ae8'][(i + Math.floor(t * 2)) % 3]);
  }
  if (mes === 6 || (mes === 7 && dia <= 15)) {
    // festa junina: bandeirinhas
    const cores = ['#e5675f', '#f2b84b', '#4a8ae8', '#5fc27e', '#9b6ae0'];
    for (let i = 0; i < 40; i++) {
      const x = T + i * 12;
      const y = 2 * T + 2 + Math.sin(i * 0.8) * 2;
      r(x, y, 6, 4, cores[i % cores.length]);
      r(x + 1, y + 4, 4, 1, cores[i % cores.length]);
    }
  }
  if (mes === 10 && dia >= 25) {
    const x = 20 * T;
    const y = 15 * T;
    r(x + 2, y + 4, 12, 9, '#e8892e');
    r(x + 7, y + 1, 2, 3, '#3f8f4f');
    r(x + 4, y + 6, 2, 2, '#241a05');
    r(x + 10, y + 6, 2, 2, '#241a05');
  }
}

// ---------- pessoas ----------
export function pessoa(p, t, ctx) {
  if (!p.visivel) return;
  const x = Math.round(p.pos.x);
  let y = Math.round(p.pos.y);
  const andando = !p.chegou;
  const resp = Math.sin((t + p.fase) * Math.PI * 1.3) > 0.6 ? 1 : 0;
  const passo = Math.floor(p.passos / 5) % 2;
  const sentado = p.sentado;
  const camisa = p.ehVoce ? '#f2b84b' : corDoModelo(p.modelo);
  const calca = '#343a4a';
  const calor = ctx.temperatura >= 28;
  const frio = ctx.temperatura <= 20;
  const sexta = ctx.data.getDay() === 5;

  g.fillStyle = 'rgba(0,0,0,.22)';
  g.fillRect(x - 5, y, 10, 2);

  if (sentado) {
    y += 1;
    r(x - 5, y - 6, 10, 5, p.noSofa ? '#93403a' : '#3a3a48');
    if (!p.noSofa) r(x - 1, y - 1, 2, 2, '#222');
  } else {
    const l = andando ? (passo ? -1 : 0) : 0;
    const rr = andando ? (passo ? 0 : -1) : 0;
    r(x - 4, y - 4 + l, 3, 4, calca);
    r(x + 1, y - 4 + rr, 3, 4, calca);
    r(x - 4, y + l, 3, 1, '#1f1f26');
    r(x + 1, y + rr, 3, 1, '#1f1f26');
  }
  const top = y - 16 + (andando ? 0 : resp) + (sentado ? 2 : 0);
  // corpo (roupa muda com o dia da semana e com a temperatura)
  r(x - 4, top + 6, 8, 7, camisa);
  if (sexta && !p.ehVoce) for (let i = 0; i < 3; i++) r(x - 4, top + 7 + i * 2, 8, 1, 'rgba(255,255,255,.25)'); // sexta: listrada
  if (frio) {
    r(x - 4, top + 6, 2, 7, '#3b3f4a');
    r(x + 2, top + 6, 2, 7, '#3b3f4a'); // casaco aberto
  }
  r(x - 4, top + 12, 8, 1, 'rgba(0,0,0,.25)');
  // braços
  const digitando = sentado && (p.acao === 'digitando' || (p.ehVoce && p.noComputador));
  const ba = digitando ? Math.floor(t * 9) % 2 : 0;
  const abanando = calor && !p.ocupado && !andando && Math.floor((t + p.fase * 5) * 3) % 4 === 0;
  const manga = calor ? p.pele : frio ? '#3b3f4a' : camisa;
  r(x - 6, top + 7 - ba - (abanando ? 3 : 0), 2, 5, manga);
  r(x + 4, top + 7 - (digitando ? 1 - ba : 0), 2, 5, manga);
  r(x - 6, top + 12 - ba - (abanando ? 3 : 0), 2, 1, p.pele);
  r(x + 4, top + 12 - (digitando ? 1 - ba : 0), 2, 1, p.pele);
  // cabeça
  r(x - 4, top, 8, 7, p.pele);
  if (p.dir === 'up') {
    r(x - 4, top - 1, 8, 6, p.cabelo);
  } else {
    r(x - 4, top - 1, 8, 3, p.cabelo);
    if (p.dir === 'left') r(x + 2, top, 2, 4, p.cabelo);
    else if (p.dir === 'right') r(x - 4, top, 2, 4, p.cabelo);
    else {
      r(x - 4, top, 1, 3, p.cabelo);
      r(x + 3, top, 1, 3, p.cabelo);
    }
    const pisca = Math.floor((t + p.fase * 7) * 10) % 37 === 0;
    const ex = p.dir === 'left' ? -2 : p.dir === 'right' ? 1 : 0;
    if (!pisca) {
      if (p.dir !== 'right') r(x - 2 + ex, top + 3, 1, 2, '#1f1f26');
      if (p.dir !== 'left') r(x + 1 + ex, top + 3, 1, 2, '#1f1f26');
    }
    // humor no rosto (de frente)
    if (p.dir === 'down') {
      const h = p.humor ?? 70;
      if (h >= 65) {
        r(x - 2, top + 5, 1, 1, '#8a3b2e');
        r(x - 1, top + 6, 2, 1, '#8a3b2e');
        r(x + 1, top + 5, 1, 1, '#8a3b2e');
      } else if (h <= 35) {
        r(x - 1, top + 5, 2, 1, '#8a3b2e');
        r(x - 2, top + 6, 1, 1, '#8a3b2e');
        r(x + 1, top + 6, 1, 1, '#8a3b2e');
      } else r(x - 1, top + 6, 2, 1, '#8a3b2e');
    }
  }
  if (ctx.aniversariantes.has(p.id)) {
    // chapéu de festa
    r(x - 1, top - 6, 3, 2, '#e5675f');
    r(x - 2, top - 4, 5, 3, '#f2b84b');
    r(x, top - 7, 1, 1, '#fff');
  }
  if (p.cargo === 'chefe' && p.dir !== 'up') r(x - 1, top + 7, 2, 4, '#7a2f2a'); // gravata
  if (p.ehVoce && p.dir !== 'up') r(x - 1, top + 7, 2, 2, '#fff'); // crachá do gestor
  // objetos na mão
  if (p.chegou && p.acao === 'lendo') {
    r(x - 3, top + 3, 6, 5, '#d9534f');
    r(x - 2, top + 4, 4, 3, '#f4f1ea');
  }
  if (p.chegou && (p.acao === 'cafe' || p.comCafe)) {
    r(x + 4, top + 9, 3, 3, '#f4f1ea');
    if (Math.floor(t * 3) % 2) r(x + 5, top + 6, 1, 2, 'rgba(255,255,255,.7)');
    else r(x + 6, top + 5, 1, 2, 'rgba(255,255,255,.7)');
  }
  if (p.chegou && (p.acao === 'bebedouro')) r(x + 4, top + 9, 2, 3, '#bfe3f7');
  if (p.celular && !andando && !p.ocupado) {
    r(x + 3, top + 6, 3, 4, '#24232b');
    r(x + 4, top + 7, 1, 2, '#6fe39a');
  }
  if (p.acao === 'entregando' || p.acao === 'pedindo') {
    r(x + 3, top + 4, 4, 5, '#f4f1ea');
    r(x + 4, top + 5, 2, 1, '#9aa3b2');
  }
  if (p.chegou && p.acao === 'planta') r(x + 4, top + 8, 4, 3, '#4a8ae8'); // regador
  if ((p.acao === 'travado' && p.chegou) || (calor && p.ocupado && Math.floor(t + p.fase) % 3 === 0)) {
    r(x + 5, top - 1 + (Math.floor(t * 2) % 2), 2, 3, '#7fc8f0'); // suor
  }
}

// ---------- cena completa ----------
export function desenharMundo(ctx2d, t, cena) {
  g = ctx2d;
  const hora = cena.data.getHours();
  g.clearRect(0, 0, W, H);
  chao();
  paredes(t, hora);
  decoracao(t, cena.data);
  const ocupante = (m) => cena.pessoas.find((p) => p.mesa === m && p.visivel && !p.ehVoce) ?? cena.pessoas.find((p) => p.ehVoce && p.mesaSentada === m);
  const sentadoEm = (lugar) => cena.pessoas.some((p) => p.visivel && p.sentado && p.tile.x === lugar.x && p.tile.y === lugar.y);
  const coisas = [
    { y: 3 * T, f: estante },
    { y: 3 * T, f: () => cafe(t) },
    { y: 3 * T, f: () => roteador(t, cena.internet) },
    { y: 3 * T, f: () => arCondicionado(t, cena.temperatura) },
    { y: 12 * T, f: () => (sentadoEm(LUGARES.gestor) ? null : cadeiraGestor()) },
    { y: 14 * T, f: mesaGestor },
    { y: 14 * T, f: cofre },
    { y: 6 * T, f: mesaReuniao },
    { y: 12 * T, f: () => tv(t, cena.agenda) },
    { y: 12 * T, f: () => bebedouro(t) },
    { y: (SOFA.y + 1) * T - 2, f: sofa },
    ...LUGARES.reuniao.filter((p) => !sentadoEm(p)).map((p) => ({ y: (p.y + 1) * T - 2, f: () => cadeiraReuniao(p) })),
    ...['planta1', 'planta2', 'planta3', 'planta4', 'planta5'].map((k) => ({ y: (OBJETOS[k].y + 1) * T, f: () => planta(OBJETOS[k]) })),
    ...MESAS.map((m) => ({ y: (m.y + 1) * T, f: () => mesa(m, ocupante(m), t, cena.aniversariantes.has(ocupante(m)?.id) || cena.mesasFesta.has(m.id)) })),
    ...MESAS.filter((m) => !sentadoEm(m.assento)).map((m) => ({ y: (m.assento.y + 1) * T - 1, f: () => cadeira(m.assento) })),
    ...cena.pessoas.map((p) => ({ y: p.pos.y + 0.5, f: () => pessoa(p, t, cena) })),
  ];
  coisas.sort((a, b) => a.y - b.y);
  for (const c of coisas) c.f();

  // luz do escritório (apagada antes do chefe abrir e depois de fechar)
  if (cena.luz < 1) {
    g.fillStyle = `rgba(8,8,24,${(1 - cena.luz) * 0.78})`;
    g.fillRect(0, 0, W, H);
  }
}
