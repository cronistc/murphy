// A tela do escritório: desenha o mundo em pixel art, move os personagens
// conforme os eventos reais do cérebro e cuida do painel lateral.

import {
  TILE as T, LARGURA, ALTURA, MESAS, OBJETOS, LUGARES,
  caminho, comportamento, lugarDaAcao, curto,
} from './comportamento.js';

const W = LARGURA * T;
const H = ALTURA * T;
const $ = (s) => document.querySelector(s);

// ---------- estado ----------
const personagens = new Map(); // nome → Personagem
const sessaoParaNome = new Map(); // id da sessão → nome
const pedidos = new Map(); // idPedido → evento permissao_pedida
const reservas = new Map(); // "x,y" → nome
const feedGeral = [];
let selecionado = null;
let ultimaCota = null;
let contador = 0; // número de cada evento recebido (para manter abertos os detalhes)
const abertos = new Set();

// ---------- utilidades ----------
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const PELES = ['#f1c7a5', '#e0ac85', '#c68863', '#9d6644', '#6f4630', '#f6d4bb'];
const CABELOS = ['#2b1d16', '#5a3620', '#a8692e', '#d9b25c', '#1d1d24', '#8c2f2a', '#6b6b78', '#3b2a4f'];
function corDoModelo(m = '') {
  if (m.includes('opus')) return '#9b6ae0';
  if (m.includes('haiku')) return '#4cbf6a';
  if (m.includes('sonnet')) return '#4a8ae8';
  return '#d98a3d';
}
function cargo(m = '') {
  if (m.includes('opus')) return 'Sênior (Opus)';
  if (m.includes('haiku')) return 'Júnior (Haiku)';
  if (m.includes('sonnet')) return 'Pleno (Sonnet)';
  return m || '?';
}
const centro = (t) => ({ x: t.x * T + T / 2, y: t.y * T + T - 3 });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- personagem ----------
const VELOCIDADE = 3.6 * T; // px/s
const PERMANENCIA = 1400; // ms mínimos num lugar antes de trocar de lugar
const TEMPO_ENTREGA = 5000;

class Personagem {
  constructor(nome, modelo, indice) {
    this.nome = nome;
    this.modelo = modelo;
    this.mesa = MESAS[indice % MESAS.length];
    const h = hash(nome);
    this.pele = PELES[h % PELES.length];
    this.cabelo = CABELOS[(h >> 4) % CABELOS.length];
    this.fase = (h % 1000) / 1000; // dessincroniza respiração
    this.tile = { ...LUGARES.porta };
    this.pos = centro(this.tile);
    this.rota = [];
    this.acao = 'ocioso';
    this.dir = 'up';
    this.visivel = false;
    this.chegou = true;
    this.chegouEm = 0;
    this.desdeAcao = 0;
    this.fixo = false;
    this.desejo = null;
    this.fala = null;
    this.ocupado = false;
    this.branch = '';
    this.pasta = '';
    this.tarefa = '';
    this.eventos = [];
    this.passos = 0;
  }

  receber(r, instantaneo, agora) {
    if (r.chegando) this.ocupado = true;
    if (r.liberar) this.fixo = false;
    if (r.fala && !instantaneo) this.fala = { texto: r.fala, ate: agora + Math.max(3200, r.fala.length * 70) };
    if (r.acao) {
      let acao = r.acao;
      // Ao reconstruir o histórico, entregas antigas já foram feitas.
      if (instantaneo && r.terminou && acao === 'entregando') acao = 'ocioso';
      this.desejo = { acao, fixo: !!r.fixo && !(instantaneo && r.terminou) };
    }
    if (r.terminou) this.ocupado = false;
    if (instantaneo && this.desejo) this.aplicar(this.desejo, true, agora);
  }

  liberarLugar() {
    for (const [k, n] of reservas) if (n === this.nome) reservas.delete(k);
  }

  destino(lugar) {
    if (lugar === 'mesa') return this.mesa.assento;
    if (lugar === 'banheiro' || lugar === 'porta') return LUGARES[lugar];
    const opcoes = LUGARES[lugar];
    const livre = opcoes.find((p) => !reservas.has(`${p.x},${p.y}`)) ?? opcoes[opcoes.length - 1];
    reservas.set(`${livre.x},${livre.y}`, this.nome);
    return livre;
  }

  aplicar(desejo, instantaneo, agora) {
    this.desejo = null;
    this.liberarLugar();
    const lugar = lugarDaAcao(desejo.acao);
    const alvo = this.destino(lugar);
    if (!this.visivel) {
      // Volta de onde saiu (banheiro ou porta da rua); recém-chegado entra pela porta.
      this.tile = { ...(this.acao === 'banheiro' ? LUGARES.banheiro : LUGARES.porta) };
      this.pos = centro(this.tile);
      this.visivel = true;
    }
    this.acao = desejo.acao;
    this.fixo = desejo.fixo;
    this.desdeAcao = agora;
    const rota = instantaneo ? [] : caminho(this.tile, alvo);
    if (!rota) this.tile = { ...alvo }; // sem caminho: teletransporta (não deveria acontecer)
    this.rota = rota ?? [];
    if (instantaneo) {
      this.tile = { ...alvo };
      this.pos = centro(alvo);
    }
    this.chegou = this.rota.length === 0;
    if (this.chegou) this.aoChegar(agora);
  }

  aoChegar(agora) {
    this.chegou = true;
    this.chegouEm = agora;
    this.dir = this.acao === 'cafe' ? 'down' : 'up';
    if (this.acao === 'banheiro' || this.acao === 'almoco') this.visivel = false;
  }

  atualizar(dt, agora) {
    // Decide se o próximo desejo já pode virar ação.
    if (this.desejo) {
      const mesmoLugar = lugarDaAcao(this.desejo.acao) === lugarDaAcao(this.acao);
      if (this.desejo.fixo || (!this.fixo && (mesmoLugar || agora - this.desdeAcao >= PERMANENCIA))) {
        this.aplicar(this.desejo, false, agora);
      }
    }
    // Entrega feita: volta para a mesa.
    if (this.acao === 'entregando' && this.chegou && agora - this.chegouEm > TEMPO_ENTREGA) {
      this.fixo = false;
      if (!this.desejo) this.desejo = { acao: 'ocioso', fixo: false };
    }
    if (this.fala && agora > this.fala.ate) this.fala = null;

    // Anda pela rota.
    let resta = VELOCIDADE * dt;
    while (resta > 0 && this.rota.length) {
      const prox = centro(this.rota[0]);
      const dx = prox.x - this.pos.x;
      const dy = prox.y - this.pos.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > Math.abs(dy)) this.dir = dx > 0 ? 'right' : 'left';
      else if (d > 0) this.dir = dy > 0 ? 'down' : 'up';
      if (d <= resta) {
        this.pos = prox;
        this.tile = this.rota.shift();
        resta -= d;
        this.passos += d;
        if (!this.rota.length) this.aoChegar(agora);
      } else {
        this.pos = { x: this.pos.x + (dx / d) * resta, y: this.pos.y + (dy / d) * resta };
        this.passos += resta;
        resta = 0;
      }
    }
  }

  get sentado() {
    return this.chegou && lugarDaAcao(this.acao) === 'mesa' && this.tile.x === this.mesa.assento.x && this.tile.y === this.mesa.assento.y;
  }

  get descricao() {
    if (!this.chegou) return 'andando';
    return {
      ocioso: 'na mesa, sem tarefa', pensando: 'pensando', digitando: 'escrevendo código',
      lendo: 'pesquisando na estante', cafe: 'esperando comando rodar (cafezinho)', pedindo: 'esperando sua permissão',
      entregando: 'entregando o trabalho', banheiro: 'no banheiro (compactando contexto)',
      almoco: 'almoçando (cota no limite)', travado: 'com o PC travado (erro)',
    }[this.acao] ?? this.acao;
  }
}

// ---------- eventos ----------
function aoEvento(ev, instantaneo) {
  const agora = performance.now();
  ev._n = contador++;
  if (ev.tipo === 'sessao_iniciada') {
    const nome = ev.funcionario ?? `sessao-${ev.sessao}`;
    sessaoParaNome.set(ev.sessao, nome);
    let p = personagens.get(nome);
    if (!p) {
      p = new Personagem(nome, ev.modelo, personagens.size);
      personagens.set(nome, p);
    }
    Object.assign(p, { modelo: ev.modelo, branch: ev.branch ?? '', pasta: ev.pasta, tarefa: ev.tarefa });
  }
  if (ev.tipo === 'cli_pronta') {
    const p = personagens.get(sessaoParaNome.get(ev.sessao));
    if (p) p.modelo = ev.modelo;
  }
  if (ev.tipo === 'permissao_pedida') pedidos.set(ev.idPedido, ev);
  if (ev.tipo === 'permissao_respondida') pedidos.delete(ev.idPedido);
  if (ev.tipo === 'cota') ultimaCota = ev;

  const nome = sessaoParaNome.get(ev.sessao);
  feedGeral.push({ ev, nome });
  if (feedGeral.length > 300) feedGeral.shift();
  const p = personagens.get(nome);
  if (p) {
    p.eventos.push(ev);
    p.receber(comportamento(ev), instantaneo, agora);
  }
  if (!instantaneo) atualizarPainel();
}

let reconstruindo = true;
function conectar() {
  const fonte = new EventSource('/eventos');
  fonte.onopen = () => {
    $('#conexao').textContent = 'conectado ao cérebro';
    $('#conexao').className = 'pilula on';
  };
  fonte.onerror = () => {
    $('#conexao').textContent = 'sem conexão com o cérebro';
    $('#conexao').className = 'pilula off';
  };
  fonte.onmessage = (m) => aoEvento(JSON.parse(m.data), reconstruindo);
  fonte.addEventListener('historico_fim', () => {
    reconstruindo = false;
    atualizarPainel();
  });
}

// ---------- desenho do mundo (baixa resolução) ----------
const mundo = document.createElement('canvas');
mundo.width = W;
mundo.height = H;
const g = mundo.getContext('2d');
const r = (x, y, w, h, c) => {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
};

function desenharChao() {
  for (let y = 2; y < ALTURA - 1; y++) {
    for (let x = 1; x < LARGURA - 1; x++) {
      const base = (x + y) % 2 ? '#c49a6c' : '#bd9366';
      r(x * T, y * T, T, T, base);
      r(x * T, y * T + 7, T, 1, '#a97f55');
      r(x * T + ((y * 5) % 16), y * T, 1, 7, '#ad835a');
      r(x * T + ((y * 11 + 7) % 16), y * T + 8, 1, 8, '#ad835a');
    }
  }
  // tapete da área de trabalho
  r(7 * T + 8, 3 * T + 10, 13 * T, 8 * T - 4, '#7d6a8a');
  r(7 * T + 10, 3 * T + 12, 13 * T - 4, 8 * T - 8, '#8a779a');
  // paredes do topo
  r(0, 0, W, 2 * T, '#ecdfca');
  r(0, 2 * T - 4, W, 4, '#8a6f55');
  r(0, 0, W, 3, '#d6c6ad');
  for (const jx of [9, 15]) {
    r(jx * T, 4, 2 * T, 20, '#6d5843');
    r(jx * T + 2, 6, 2 * T - 4, 16, '#9fd3f0');
    r(jx * T + 2, 6, 2 * T - 4, 5, '#c4e6f8');
    r(jx * T + T - 1, 6, 2, 16, '#6d5843');
    r(jx * T - 1, 24, 2 * T + 2, 2, '#8a6f55');
  }
  // quadro
  r(4 * T + 4, 6, 20, 14, '#5b4636');
  r(4 * T + 6, 8, 16, 10, '#e9a35b');
  r(4 * T + 6, 13, 16, 5, '#6aa36f');
  // paredes laterais e de baixo
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
  // porta do banheiro
  const b = LUGARES.banheiro;
  r(b.x * T, b.y * T - 4, T, T + 4, '#a0764f');
  r(b.x * T + 2, b.y * T - 2, T - 4, T, '#b8875b');
  r(b.x * T + 3, b.y * T + 5, 2, 2, '#f2d36b');
  r(b.x * T + 6, b.y * T - 1, 6, 4, '#e8e8f0');
  r(b.x * T + 7, b.y * T, 1, 2, '#4a8ae8');
  r(b.x * T + 10, b.y * T, 1, 2, '#e5675f');
}

function ocupanteDaMesa(m) {
  for (const p of personagens.values()) if (p.mesa === m && p.visivel) return p;
  return null;
}

function desenharTela(x, y, p, t) {
  // monitor visto de frente (a tela aponta para quem está na cadeira, logo para nós)
  r(x, y, 14, 10, '#24232b');
  const ligado = p && p.ocupado;
  if (!ligado) return r(x + 1, y + 1, 12, 8, p ? '#1d3048' : '#15161b');
  const sentado = p.sentado;
  const acao = sentado ? p.acao : 'fora';
  if (acao === 'travado') {
    r(x + 1, y + 1, 12, 8, '#2346b8');
    r(x + 3, y + 3, 8, 1, '#fff');
    r(x + 3, y + 5, 5, 1, '#fff');
    return;
  }
  r(x + 1, y + 1, 12, 8, '#0f1a14');
  if (acao === 'digitando') {
    const s = Math.floor(t * 7) + p.mesa.id * 13;
    for (let i = 0; i < 4; i++) {
      const w = 2 + ((s + i * 7) * 31 % 9);
      r(x + 2 + (i % 2) * 2, y + 2 + i * 2, Math.min(w, 9), 1, i % 3 ? '#6fe39a' : '#e6f2ea');
    }
  } else if (acao === 'pensando' || acao === 'ocioso') {
    r(x + 2, y + 2, 6, 1, '#6fe39a');
    r(x + 2, y + 4, 4, 1, '#6fe39a');
    if (Math.floor(t * 2) % 2) r(x + 7, y + 4, 2, 1, '#e6f2ea');
  } else {
    // dono foi para outro lugar: a tela mostra o que ficou rodando
    r(x + 2, y + 3, 10, 3, '#203328');
    r(x + 2, y + 3, 1 + Math.floor((t * 3) % 10), 3, '#6fe39a');
  }
}

function desenharMesa(m, t) {
  const x = m.x * T;
  const y = m.y * T;
  r(x + 1, y + 14, 3, 6, '#5a3a1c');
  r(x + 28, y + 14, 3, 6, '#5a3a1c');
  r(x, y + 3, 32, 11, '#8b5a2b');
  r(x, y + 3, 32, 2, '#a8713f');
  r(x, y + 13, 32, 2, '#6b4220');
  desenharTela(x + 9, y - 6, ocupanteDaMesa(m), t);
  r(x + 15, y + 4, 2, 2, '#24232b');
  r(x + 11, y + 9, 10, 2, '#d9d9e0');
  r(x + 25, y + 6, 3, 4, '#f4f1ea');
  r(x + 25, y + 7, 3, 1, '#d36a4a');
}

function desenharCadeira(m) {
  const { x, y } = m.assento;
  r(x * T + 3, y * T + 1, 10, 7, '#3a3a48');
  r(x * T + 4, y * T + 8, 8, 4, '#4a4a5c');
  r(x * T + 7, y * T + 12, 2, 2, '#222');
  r(x * T + 4, y * T + 14, 8, 1, '#222');
}

function desenharEstante() {
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

function desenharCafe(t) {
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

function desenharMesaChefe() {
  const o = OBJETOS.mesaChefe;
  const x = o.x * T;
  const y = o.y * T;
  r(x, y + 1, o.w * T, 14, '#5e3b22');
  r(x, y + 1, o.w * T, 3, '#7a4e2d');
  r(x + 2, y + 13, o.w * T - 4, 3, '#4a2e1a');
  r(x + 18, y - 4, 14, 8, '#24232b'); // monitor de costas
  r(x + 24, y + 4, 2, 2, '#24232b');
  r(x + 4, y + 6, 10, 3, '#f2b84b'); // plaquinha
  r(x + 36, y + 5, 6, 6, '#f4f1ea');
  r(x + 37, y + 6, 4, 2, '#e9e0d0');
}

function desenharCadeiraChefe() {
  const o = OBJETOS.cadeiraChefe;
  r(o.x * T + 2, o.y * T + 1, 12, 9, '#7a2f2a');
  r(o.x * T + 3, o.y * T + 2, 10, 6, '#93403a');
  r(o.x * T + 7, o.y * T + 10, 2, 3, '#222');
}

function desenharPlanta(o) {
  const x = o.x * T;
  const y = o.y * T;
  r(x + 4, y + 9, 8, 6, '#b5653d');
  r(x + 4, y + 9, 8, 2, '#c97a4f');
  r(x + 2, y + 1, 5, 8, '#3f8f4f');
  r(x + 8, y - 1, 5, 10, '#4fa85f');
  r(x + 5, y - 3, 5, 9, '#5fc27e');
}

function desenharPessoa(p, t) {
  if (!p.visivel) return;
  const x = Math.round(p.pos.x);
  let y = Math.round(p.pos.y);
  const andando = !p.chegou;
  const resp = Math.sin((t + p.fase) * Math.PI * 1.3) > 0.6 ? 1 : 0;
  const passo = Math.floor(p.passos / 5) % 2;
  const sentado = p.sentado;
  const camisa = corDoModelo(p.modelo);
  const calca = '#343a4a';

  // sombra
  g.fillStyle = 'rgba(0,0,0,.22)';
  g.fillRect(x - 5, y, 10, 2);

  if (sentado) {
    y += 1;
    // cadeira por baixo
    r(x - 5, y - 6, 10, 5, '#3a3a48');
    r(x - 1, y - 1, 2, 2, '#222');
  } else {
    const l = andando ? (passo ? -1 : 0) : 0;
    const rr = andando ? (passo ? 0 : -1) : 0;
    r(x - 4, y - 4 + l, 3, 4, calca);
    r(x + 1, y - 4 + rr, 3, 4, calca);
    r(x - 4, y + l, 3, 1, '#1f1f26');
    r(x + 1, y + rr, 3, 1, '#1f1f26');
  }
  const top = y - 16 + (andando ? 0 : resp) + (sentado ? 2 : 0);
  // corpo
  r(x - 4, top + 6, 8, 7, camisa);
  r(x - 4, top + 12, 8, 1, 'rgba(0,0,0,.25)');
  // braços
  const digitando = sentado && p.acao === 'digitando';
  const ba = digitando ? Math.floor(t * 9) % 2 : 0;
  r(x - 6, top + 7 - ba, 2, 5, camisa);
  r(x + 4, top + 7 - (digitando ? 1 - ba : 0), 2, 5, camisa);
  r(x - 6, top + 12 - ba, 2, 1, p.pele);
  r(x + 4, top + 12 - (digitando ? 1 - ba : 0), 2, 1, p.pele);
  // cabeça
  r(x - 4, top, 8, 7, p.pele);
  if (p.dir === 'up') {
    r(x - 4, top - 1, 8, 6, p.cabelo);
  } else {
    r(x - 4, top - 1, 8, 3, p.cabelo);
    if (p.dir === 'left') r(x + 2, top, 2, 4, p.cabelo);
    else if (p.dir === 'right') r(x - 4, top, 2, 4, p.cabelo);
    else { r(x - 4, top, 1, 3, p.cabelo); r(x + 3, top, 1, 3, p.cabelo); }
    const pisca = Math.floor((t + p.fase * 7) * 10) % 37 === 0;
    const ex = p.dir === 'left' ? -2 : p.dir === 'right' ? 1 : 0;
    if (!pisca) {
      if (p.dir !== 'right') r(x - 2 + ex, top + 3, 1, 2, '#1f1f26');
      if (p.dir !== 'left') r(x + 1 + ex, top + 3, 1, 2, '#1f1f26');
    }
  }
  // objetos na mão
  if (p.chegou && p.acao === 'lendo') {
    r(x - 3, top + 3, 6, 5, '#d9534f');
    r(x - 2, top + 4, 4, 3, '#f4f1ea');
  }
  if (p.chegou && p.acao === 'cafe') {
    r(x + 4, top + 9, 3, 3, '#f4f1ea');
    if (Math.floor(t * 3) % 2) r(x + 5, top + 6, 1, 2, 'rgba(255,255,255,.7)');
    else r(x + 6, top + 5, 1, 2, 'rgba(255,255,255,.7)');
  }
  if (p.acao === 'entregando' || p.acao === 'pedindo') {
    r(x + 3, top + 4, 4, 5, '#f4f1ea');
    r(x + 4, top + 5, 2, 1, '#9aa3b2');
  }
  if (p.acao === 'travado' && p.chegou) {
    r(x + 5, top - 1 + (Math.floor(t * 2) % 2), 2, 3, '#7fc8f0');
  }
}

function desenharMundo(t) {
  g.clearRect(0, 0, W, H);
  desenharChao();
  // tudo que tem "pé" é desenhado de cima para baixo
  const coisas = [
    { y: 3 * T, f: desenharEstante },
    { y: 3 * T, f: () => desenharCafe(t) },
    { y: 9 * T, f: desenharCadeiraChefe },
    { y: 10 * T, f: desenharMesaChefe },
    ...['planta1', 'planta2', 'planta3'].map((k) => ({ y: (OBJETOS[k].y + 1) * T, f: () => desenharPlanta(OBJETOS[k]) })),
    ...MESAS.map((m) => ({ y: (m.y + 1) * T, f: () => desenharMesa(m, t) })),
    ...MESAS.filter((m) => !ocupanteDaMesa(m)?.sentado).map((m) => ({ y: (m.assento.y + 1) * T - 1, f: () => desenharCadeira(m) })),
    ...[...personagens.values()].map((p) => ({ y: p.pos.y + 0.5, f: () => desenharPessoa(p, t) })),
  ];
  coisas.sort((a, b) => a.y - b.y);
  for (const c of coisas) c.f();
}

// ---------- tela (alta resolução: escala + balões e nomes nítidos) ----------
const tela = $('#tela');
const ctx = tela.getContext('2d');
let escala = 3;

function redimensionar() {
  const palco = $('#palco');
  const largura = Math.max(200, palco.clientWidth - 32);
  const altura = Math.max(200, window.innerHeight - 90);
  const e = Math.min(largura / W, altura / H);
  escala = e >= 2 ? Math.floor(e * 4) / 4 : e;
  const dpr = window.devicePixelRatio || 1;
  tela.style.width = `${W * escala}px`;
  tela.style.height = `${H * escala}px`;
  tela.width = Math.round(W * escala * dpr);
  tela.height = Math.round(H * escala * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', redimensionar);

function quebrar(texto, max) {
  const palavras = texto.split(' ');
  const linhas = [''];
  for (const p of palavras) {
    const atual = linhas[linhas.length - 1];
    if ((atual + ' ' + p).trim().length > max && atual) linhas.push(p);
    else linhas[linhas.length - 1] = (atual + ' ' + p).trim();
  }
  if (linhas.length > 3) {
    linhas.length = 3;
    linhas[2] = curto(linhas[2], max - 1) + '…';
  }
  return linhas;
}

function balao(x, y, texto, cor = '#fffaf0', borda = '#2a2430') {
  const fs = Math.max(11, Math.round(escala * 3.6));
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  const linhas = quebrar(texto, 30);
  const lw = Math.max(...linhas.map((l) => ctx.measureText(l).width));
  const pad = fs * 0.5;
  const bw = lw + pad * 2;
  const bh = linhas.length * fs * 1.25 + pad * 1.4;
  let bx = Math.min(Math.max(4, x - bw / 2), W * escala - bw - 4);
  const by = Math.max(4, y - bh - 8);
  ctx.fillStyle = cor;
  ctx.strokeStyle = borda;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 6);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 5, by + bh - 1);
  ctx.lineTo(x, by + bh + 7);
  ctx.lineTo(x + 5, by + bh - 1);
  ctx.fill();
  ctx.fillStyle = '#2a2430';
  linhas.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad * 0.7 + fs * (i + 0.95) * 1.2 - fs * 0.15));
}

function etiqueta(x, y, texto, cor, destaque) {
  const fs = Math.max(10, Math.round(escala * 3));
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  const w = ctx.measureText(texto).width + fs;
  ctx.fillStyle = destaque ? '#f2b84b' : 'rgba(20,16,26,.78)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y, w, fs * 1.45, 4);
  ctx.fill();
  ctx.fillStyle = cor;
  ctx.fillRect(x - w / 2 + fs * 0.35, y + fs * 0.5, fs * 0.45, fs * 0.45);
  ctx.fillStyle = destaque ? '#241a05' : '#fff';
  ctx.fillText(texto, x - w / 2 + fs * 1.0, y + fs * 1.08);
}

function desenharSobreposicao(t) {
  const s = escala;
  // seleção
  if (selecionado?.visivel) {
    ctx.strokeStyle = '#f2b84b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(selecionado.pos.x * s, (selecionado.pos.y + 1) * s, 8 * s, 3 * s, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // "VOCÊ" na cadeira do chefe
  const cc = OBJETOS.cadeiraChefe;
  etiqueta((cc.x * T + 8) * s, (cc.y * T - 3) * s - 14, 'você (chefe)', '#f2b84b', false);
  for (const p of personagens.values()) {
    if (!p.visivel) continue;
    etiqueta(p.pos.x * s, (p.pos.y + 3) * s, p.nome, corDoModelo(p.modelo), p === selecionado);
  }
  for (const p of personagens.values()) {
    if (!p.visivel) continue;
    const topo = (p.pos.y - 18) * s;
    if (p.acao === 'pedindo' && p.chegou) {
      const pd = [...pedidos.values()].find((e) => sessaoParaNome.get(e.sessao) === p.nome);
      balao(p.pos.x * s, topo, pd ? `✋ Posso? ${pd.ferramenta}: ${curto(pd.resumo, 48)}` : '✋ Chefe…', '#fff1c9', '#f2b84b');
    } else if (p.fala) {
      balao(p.pos.x * s, topo, p.fala.texto);
    }
  }
}

// ---------- laço principal (o mundo nunca congela esperando a IA) ----------
let anterior = performance.now();
function quadro(agora) {
  const dt = Math.min(0.1, (agora - anterior) / 1000);
  anterior = agora;
  for (const p of personagens.values()) p.atualizar(dt, agora);
  const t = agora / 1000;
  desenharMundo(t);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W * escala, H * escala);
  ctx.drawImage(mundo, 0, 0, W * escala, H * escala);
  desenharSobreposicao(t);
  if (Math.floor(t * 2) !== Math.floor((t - dt) * 2) && selecionado) atualizarFichaStatus();
  requestAnimationFrame(quadro);
}

// ---------- interação ----------
function personagemEm(ev) {
  const b = tela.getBoundingClientRect();
  const x = (ev.clientX - b.left) / escala;
  const y = (ev.clientY - b.top) / escala;
  let melhor = null;
  let dist = 14;
  for (const p of personagens.values()) {
    if (!p.visivel) continue;
    const d = Math.hypot(p.pos.x - x, p.pos.y - 8 - y);
    if (d < dist) { dist = d; melhor = p; }
  }
  return melhor;
}
tela.addEventListener('mousemove', (e) => { tela.style.cursor = personagemEm(e) ? 'pointer' : 'default'; });
tela.addEventListener('click', (e) => {
  selecionado = personagemEm(e);
  if (selecionado) $('#fNome').value = selecionado.nome;
  atualizarPainel();
});

async function api(metodo, rota, corpo) {
  const res = await fetch(rota, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.erro ?? `erro ${res.status}`);
  return dados;
}

const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lembrar = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

$('#delegar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = e.submitter ?? $('#delegar button');
  $('#erroForm').textContent = '';
  botao.disabled = true;
  try {
    const projeto = $('#fProjeto').value.trim();
    await api('POST', '/sessoes', {
      projeto,
      funcionario: $('#fNome').value.trim(),
      modelo: $('#fModelo').value,
      tarefa: $('#fTarefa').value.trim(),
    });
    guardar('projeto', projeto);
    $('#fTarefa').value = '';
  } catch (err) {
    $('#erroForm').textContent = err.message;
  } finally {
    botao.disabled = false;
  }
});

$('#fAuto').addEventListener('change', async (e) => {
  try {
    await api('POST', '/config', { aprovarTudo: e.target.checked });
  } catch (err) {
    e.target.checked = !e.target.checked;
    $('#erroForm').textContent = err.message;
  }
});

$('#pedidos').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  b.disabled = true;
  try {
    await api('POST', `/permissoes/${b.dataset.id}`, { aprovar: b.dataset.aprovar === '1' });
  } catch (err) {
    b.disabled = false;
    alert(err.message);
  }
});

// ---------- painel ----------
function hora(ev) {
  return new Date(ev.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function resumoEvento(ev) {
  switch (ev.tipo) {
    case 'sessao_iniciada': return `🚪 chegou: "${curto(ev.tarefa, 90)}"`;
    case 'cli_pronta': return `💻 ligou o computador (${ev.modelo})`;
    case 'texto': return `💬 ${curto(ev.texto, 140)}`;
    case 'ferramenta_chamada': return `🔧 ${ev.ferramenta}: ${curto(ev.resumo, 100)}`;
    case 'ferramenta_resultado': return `${ev.erro ? '❌' : '📎'} ${curto(ev.resumo, 100)}`;
    case 'permissao_pedida': return `✋ pediu: ${ev.ferramenta}: ${curto(ev.resumo, 90)}`;
    case 'permissao_respondida': return `${ev.aprovada ? '✅' : '⛔'} ${ev.motivo}`;
    case 'cota': return `⏱️ cota ${ev.status} (${ev.janela ?? '?'}, ${Math.round((ev.uso ?? 0) * 100)}%)`;
    case 'compactacao': return `🚻 compactou contexto: ${ev.tokensAntes} → ${ev.tokensDepois ?? '?'} tokens`;
    case 'tarefa_terminada': return `🏁 ${ev.sucesso ? 'terminou' : 'falhou'}: ${ev.turnos} turnos, ${(ev.duracaoMs / 1000).toFixed(1)}s, US$ ${ev.custoUsd?.toFixed(4)}`;
    case 'erro': return `💥 erro: ${ev.mensagem}`;
    default: return ev.tipo;
  }
}

function itemFeed(ev, nome) {
  const quem = nome ? `<b>${esc(nome)}</b> ` : '';
  return `<details data-n="${ev._n}"${abertos.has(ev._n) ? ' open' : ''}><summary><span class="hora">${hora(ev)}</span> ${quem}${esc(resumoEvento(ev))}</summary><pre>${esc(JSON.stringify({ ...ev, _n: undefined }, null, 2))}</pre></details>`;
}

function atualizarFichaStatus() {
  const el = $('#fichaEstado');
  if (el && selecionado) el.textContent = selecionado.descricao;
}

function atualizarPainel() {
  const trabalhando = [...personagens.values()].filter((p) => p.ocupado).length;
  $('#trabalhando').textContent = `${trabalhando} trabalhando`;
  if (ultimaCota) {
    const c = $('#cota');
    c.hidden = false;
    c.textContent = `cota ${ultimaCota.janela ?? ''} ${Math.round((ultimaCota.uso ?? 0) * 100)}%`;
    c.className = `pilula ${ultimaCota.status === 'allowed' ? 'on' : 'off'}`;
    c.title = ultimaCota.renovaEm ? `renova em ${new Date(ultimaCota.renovaEm).toLocaleString('pt-BR')}` : '';
  }

  $('#nomes').innerHTML = [...personagens.keys()].map((n) => `<option value="${esc(n)}">`).join('');

  const ps = [...pedidos.values()];
  $('#pedidos').innerHTML = ps.length
    ? ps.map((e) => `<div class="pedido"><b>${esc(sessaoParaNome.get(e.sessao) ?? e.sessao)}</b> quer usar <b>${esc(e.ferramenta)}</b>
        <code>${esc(e.resumo)}</code>
        <div class="linha"><button data-id="${e.idPedido}" data-aprovar="1">Aprovar</button>
        <button class="neutro" data-id="${e.idPedido}" data-aprovar="0">Negar</button></div></div>`).join('')
    : '<div class="vazio">Ninguém esperando por você.</div>';

  const ficha = $('#ficha');
  if (selecionado) {
    const p = selecionado;
    ficha.hidden = false;
    ficha.innerHTML = `<div class="topo"><span class="nome"><span class="ponto" style="background:${corDoModelo(p.modelo)}"></span>${esc(p.nome)}</span>
      <button class="neutro" id="fecharFicha">fechar</button></div>
      <dl><dt>Cargo</dt><dd>${esc(cargo(p.modelo))}</dd>
      <dt>Agora</dt><dd id="fichaEstado">${esc(p.descricao)}</dd>
      <dt>Mesa</dt><dd>${esc(p.branch || '—')}</dd>
      <dt>Pasta</dt><dd>${esc(p.pasta)}</dd>
      <dt>Tarefa</dt><dd>${esc(p.tarefa)}</dd></dl>
      <h2>Log técnico</h2>
      <div class="feed">${p.eventos.slice(-150).reverse().map((e) => itemFeed(e)).join('')}</div>`;
    $('#fecharFicha').onclick = () => { selecionado = null; atualizarPainel(); };
  } else {
    ficha.hidden = true;
  }

  $('#feed').innerHTML = feedGeral.slice(-80).reverse().map(({ ev, nome }) => itemFeed(ev, nome)).join('')
    || '<div class="vazio">Nada aconteceu ainda. Delegue uma tarefa!</div>';
}

document.querySelector('aside').addEventListener('toggle', (e) => {
  const n = Number(e.target.dataset?.n);
  if (Number.isNaN(n)) return;
  if (e.target.open) abertos.add(n);
  else abertos.delete(n);
}, true);

// ---------- login na conta Claude ----------
let verificandoConta = null;
async function verificarConta() {
  try {
    const c = await api('GET', '/conta');
    $('#login').hidden = c.logado;
    if (c.logado && verificandoConta) {
      clearInterval(verificandoConta);
      verificandoConta = null;
    }
    if (!c.logado && !verificandoConta) verificandoConta = setInterval(verificarConta, 3000);
  } catch {}
}
$('#btnEntrar').addEventListener('click', async (e) => {
  e.target.disabled = true;
  $('#loginErro').textContent = '';
  try {
    const r = await api('POST', '/conta/entrar');
    if (!r.url) throw new Error(r.saida?.trim() || 'o Claude Code não respondeu');
    $('#loginLink').href = r.url;
    $('#loginPasso1').hidden = true;
    $('#loginPasso2').hidden = false;
    $('#fCodigo').focus();
  } catch (err) {
    $('#loginErro').textContent = err.message;
  } finally {
    e.target.disabled = false;
  }
});
$('#formCodigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = e.submitter;
  botao.disabled = true;
  $('#loginErro').textContent = '';
  try {
    const r = await api('POST', '/conta/codigo', { codigo: $('#fCodigo').value });
    if (r.logado) $('#login').hidden = true;
    else $('#loginErro').textContent = r.saida || 'não deu certo; tente de novo';
  } catch (err) {
    $('#loginErro').textContent = err.message;
    $('#loginPasso1').hidden = false;
    $('#loginPasso2').hidden = true;
  } finally {
    botao.disabled = false;
  }
});

// ---------- início ----------
verificarConta();
redimensionar();
api('GET', '/config')
  .then((c) => {
    $('#fProjeto').value = lembrar('projeto') || c.projetoPadrao;
    $('#fAuto').checked = c.aprovarTudo;
  })
  .catch(() => {});
conectar();
atualizarPainel();
requestAnimationFrame(quadro);
// para testes automatizados
window.escritorio = { personagens, pedidos };
