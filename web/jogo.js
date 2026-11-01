// A tela do escritório: o mundo em pixel art, o seu personagem (você anda,
// conversa e senta nos computadores), a vida da equipe e o painel.
//
// Trabalho é real, vida é livre: o que um funcionário faz de trabalho vem de
// eventos reais do cérebro (comportamento.js). Quando não está trabalhando, ele
// vive: bebedouro, sofá, janela, conversa — e isso nunca atrapalha o trabalho.

import {
  TILE as T, MESAS, OBJETOS, LUGARES, SOFA,
  caminho, vizinhoLivre, bloqueado, comportamento, lugarDaAcao, curto, TRABALHO,
} from './comportamento.js';
import { W, H, desenharMundo, corDoModelo } from './desenho.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const aleatorio = (lista) => lista[Math.floor(Math.random() * lista.length)];
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const lembrar = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

// ---------- estado ----------
const personagens = new Map(); // id → Personagem (inclui 'voce')
const sessaoParaId = new Map();
const sessaoConversa = new Set();
const sessoesFim = new Set();
const pedidos = new Map();
const contratacoes = new Map();
const conversas = {}; // id → [{de, para, texto, em}]
const aniversariantes = new Set();
const feedGeral = [];
const abertos = new Set();
let contador = 0;
let equipeInfo = [];
let projeto = null;
let cargosInfo = {};
let agenda = null;
let internet = true;
let aprovarTudo = false;
let maquina = null;
let ultimaCota = null;
let almocoAte = null;
let diario = [];
let fase = 'aberto'; // expediente: aberto | encerrando | encerrado
let luz = 1;
let luzAlvo = 1;
let selecionado = null;
let interlocutor = null;
let reconstruindo = true;
let somLigado = lembrar('som') !== 'nao';
let telaAbertaDe = null;

const temperatura = () => maquina?.temperatura ?? 23;

// ---------- aparência ----------
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const PELES = ['#f1c7a5', '#e0ac85', '#c68863', '#9d6644', '#6f4630', '#f6d4bb'];
const CABELOS = ['#2b1d16', '#5a3620', '#a8692e', '#d9b25c', '#1d1d24', '#8c2f2a', '#6b6b78', '#3b2a4f'];
const TITULOS = { chefe: 'Chefe de equipe', senior: 'Sênior', pleno: 'Pleno', junior: 'Júnior', designer: 'Designer', redator: 'Redator', pesquisador: 'Pesquisador', qa: 'QA', arquiteto: 'Arquiteto', ti: 'T.I.' };
const tituloDe = (p) => TITULOS[p.cargo] ?? p.cargo ?? '';
const centro = (t) => ({ x: t.x * T + T / 2, y: t.y * T + T - 3 });
const nomeDe = (id) => (id === 'voce' ? 'Você' : personagens.get(id)?.nome ?? equipeInfo.find((f) => f.id === id)?.nome ?? id);
const horaCurta = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

// ---------- personagens ----------
const VELOCIDADE = 3.6 * T;
const VELOCIDADE_VOCE = 5 * T;
const PERMANENCIA = 1400;
const TEMPO_ENTREGA = 5000;
const reservas = new Map();

class Personagem {
  constructor(id, info = {}, indiceMesa = 0) {
    this.id = id;
    this.nome = info.nome ?? id;
    this.cargo = info.cargo ?? '';
    this.modelo = info.modelo ?? '';
    this.personalidade = info.personalidade ?? '';
    this.humor = info.humor ?? 70;
    this.aniversario = info.aniversario ?? '';
    this.ferias = Boolean(info.ferias);
    this.ehVoce = id === 'voce';
    this.mesa = this.ehVoce ? null : MESAS[indiceMesa % MESAS.length];
    const h = hash(id);
    this.pele = PELES[h % PELES.length];
    this.cabelo = CABELOS[(h >> 4) % CABELOS.length];
    this.fase = (h % 1000) / 1000;
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
    this.local = null; // mesa de outra pessoa (T.I. visitando)
    this.eventos = [];
    this.passos = 0;
    this.chegarEm = 0;
    this.saudacao = '';
    this.proximaVida = performance.now() + 8000 + Math.random() * 20000;
    this.ocupadoAte = 0; // pausa a vida (conversando com você, daily…)
    this.roteiro = []; // falas agendadas (conversa entre colegas)
    this.noSofa = false;
    this.celular = false;
    this.comCafe = 0;
    this.mesaSentada = null; // (você) mesa onde está sentado
    this.noComputador = false;
    this.aoChegarFn = null;
  }

  get sentado() {
    if (!this.chegou || !this.visivel) return false;
    if (this.ehVoce) return Boolean(this.mesaSentada) || (this.tile.x === LUGARES.gestor.x && this.tile.y === LUGARES.gestor.y && this.acao === 'sentado');
    if (this.noSofa) return true;
    if (this.acao === 'reuniao') return true;
    return lugarDaAcao(this.acao) === 'mesa' && this.mesa && this.tile.x === this.mesa.assento.x && this.tile.y === this.mesa.assento.y;
  }

  get descricao() {
    if (this.ferias) return 'de férias 🏖️';
    if (!this.visivel) return { almoco: 'almoçando', banheiro: 'no banheiro (compactando a memória)', saindo: 'foi embora' }[this.acao] ?? 'fora da sala';
    if (!this.chegou) return 'andando';
    return {
      ocioso: 'na mesa', pensando: 'pensando', digitando: 'escrevendo', lendo: 'pesquisando na estante',
      cafe: 'esperando um comando rodar (cafezinho)', pedindo: 'esperando você na sua mesa', entregando: 'na sua mesa',
      travado: 'com o PC travado', visitando: `ajudando na mesa de ${nomeDe(this.local)}`, reuniao: 'em reunião',
      bebedouro: 'no bebedouro', sofa: 'no sofá', tv: 'vendo o jornal', janela: 'olhando a janela', planta: 'regando as plantas',
    }[this.acao] ?? this.acao;
  }

  receber(r, instantaneo, agora) {
    if (r.chegando) this.ocupado = true;
    if (r.liberar) this.fixo = false;
    if (r.fala && !instantaneo) this.falar(r.fala, agora);
    if (r.acao) {
      let acao = r.acao;
      if (instantaneo && r.terminou && acao === 'entregando') acao = 'ocioso';
      // O T.I. trabalha na mesa de outra pessoa.
      if (this.local && lugarDaAcao(acao) === 'mesa' && acao !== 'ocioso') acao = 'visitando';
      this.desejo = { acao, fixo: !!r.fixo && !(instantaneo && r.terminou) };
    }
    if (r.terminou) {
      this.ocupado = false;
      this.local = null;
    }
    if (instantaneo && this.desejo) this.aplicar(this.desejo, true, agora);
  }

  falar(texto, agora = performance.now(), ms) {
    if (!texto) return;
    this.fala = { texto, ate: agora + (ms ?? Math.max(3500, texto.length * 70)) };
    falarEmVoz(this, texto);
  }

  liberarLugar() {
    for (const [k, n] of reservas) if (n === this.id) reservas.delete(k);
  }

  reservar(lista) {
    const livre = lista.find((p) => !reservas.has(`${p.x},${p.y}`)) ?? lista[lista.length - 1];
    reservas.set(`${livre.x},${livre.y}`, this.id);
    return livre;
  }

  destino(lugar) {
    if (lugar === 'mesa') return this.mesa?.assento ?? LUGARES.gestor;
    if (lugar === 'visita') return personagens.get(this.local)?.mesa?.ao_lado ?? this.mesa.assento;
    if (lugar === 'banheiro' || lugar === 'porta') return LUGARES[lugar];
    if (lugar === 'reuniao' && this.cargo === 'chefe') return LUGARES.cabeceira;
    return this.reservar(LUGARES[lugar]);
  }

  aplicar(desejo, instantaneo, agora) {
    this.desejo = null;
    this.liberarLugar();
    this.noSofa = false;
    const lugar = lugarDaAcao(desejo.acao);
    const alvo = this.destino(lugar);
    if (!this.visivel) {
      this.tile = { ...(this.acao === 'banheiro' ? LUGARES.banheiro : LUGARES.porta) };
      this.pos = centro(this.tile);
      this.visivel = true;
    }
    this.acao = desejo.acao;
    this.fixo = desejo.fixo;
    this.desdeAcao = agora;
    const rota = instantaneo ? [] : caminho(this.tile, alvo);
    this.rota = rota ?? [];
    if (instantaneo || !rota) {
      this.tile = { ...alvo };
      this.pos = centro(alvo);
    }
    this.chegou = this.rota.length === 0;
    if (this.chegou) this.aoChegar(agora);
  }

  irPara(alvo, agora, aoChegar) {
    // Movimento livre (você): sem ação de trabalho.
    const rota = alvo ? caminho(this.tile, alvo) : null;
    if (!rota) return false;
    this.rota = rota;
    this.chegou = rota.length === 0;
    this.aoChegarFn = aoChegar ?? null;
    if (this.chegou) this.aoChegar(agora);
    return true;
  }

  aoChegar(agora) {
    this.chegou = true;
    this.chegouEm = agora;
    if (this.ehVoce) {
      const fn = this.aoChegarFn;
      this.aoChegarFn = null;
      fn?.();
      return;
    }
    const a = this.acao;
    this.dir = a === 'cafe' ? 'down' : a === 'bebedouro' ? 'right' : 'up';
    if (a === 'reuniao') {
      this.dir = this.cargo === 'chefe' ? 'right' : this.tile.y <= 3 ? 'down' : this.tile.x <= 22 ? 'right' : this.tile.x >= 28 ? 'left' : 'up';
    }
    if (a === 'sofa') this.noSofa = true;
    if (a === 'planta') this.dir = this.tile.x >= 22 ? 'down' : 'left';
    if (['banheiro', 'almoco', 'saindo', 'ferias'].includes(a)) this.visivel = false;
    this.celular = this.cargo === 'ti' && a === 'ocioso';
  }

  atualizar(dt, agora) {
    if (this.chegarEm && agora >= this.chegarEm) {
      this.chegarEm = 0;
      if (!this.desejo) this.desejo = { acao: 'ocioso', fixo: false };
      if (this.saudacao) this.falar(this.saudacao, agora, 4000);
    }
    if (this.desejo) {
      const mesmoLugar = lugarDaAcao(this.desejo.acao) === lugarDaAcao(this.acao);
      if (this.desejo.fixo || (!this.fixo && (mesmoLugar || agora - this.desdeAcao >= PERMANENCIA))) this.aplicar(this.desejo, false, agora);
    }
    if (this.acao === 'entregando' && this.chegou && agora - this.chegouEm > TEMPO_ENTREGA && ![...contratacoes.values()].some((e) => e.pedidoPor === this.id)) {
      this.fixo = false;
      if (!this.desejo) this.desejo = { acao: 'ocioso', fixo: false };
    }
    if (this.fala && agora > this.fala.ate) this.fala = null;
    if (this.roteiro.length && agora >= this.roteiro[0].em) this.falar(this.roteiro.shift().texto, agora);
    if (this.comCafe && agora > this.comCafe) this.comCafe = 0;

    let resta = (this.ehVoce ? VELOCIDADE_VOCE : VELOCIDADE) * dt;
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
}

// ---------- você (o gestor) ----------
const voce = new Personagem('voce', { nome: 'Você' });
voce.pele = PELES[2];
voce.cabelo = CABELOS[3];
personagens.set('voce', voce);
const teclas = new Set();

function entrarVoce(instantaneo) {
  voce.visivel = true;
  if (instantaneo) {
    voce.tile = { ...LUGARES.gestor };
    voce.pos = centro(voce.tile);
    voce.acao = 'sentado';
    voce.dir = 'down';
    return;
  }
  voce.tile = { ...LUGARES.porta };
  voce.pos = centro(voce.tile);
  voce.acao = 'andando';
  voce.irPara(LUGARES.gestor, performance.now(), () => {
    voce.acao = 'sentado';
    voce.dir = 'down';
  });
}

function levantar() {
  if (voce.mesaSentada || voce.acao === 'sentado') {
    voce.mesaSentada = null;
    voce.noComputador = false;
    voce.acao = 'andando';
  }
}

function moverComTeclado(dt) {
  if (!voce.visivel || modalAberto() || digitando()) return;
  let dx = 0;
  let dy = 0;
  if (teclas.has('arrowleft') || teclas.has('a')) dx -= 1;
  if (teclas.has('arrowright') || teclas.has('d')) dx += 1;
  if (teclas.has('arrowup') || teclas.has('w')) dy -= 1;
  if (teclas.has('arrowdown') || teclas.has('s')) dy += 1;
  if (!dx && !dy) return;
  levantar();
  voce.rota = [];
  voce.chegou = true;
  voce.aoChegarFn = null;
  const n = Math.hypot(dx, dy);
  const passo = VELOCIDADE_VOCE * dt;
  const livre = (nx, ny) => {
    for (const ox of [-4, 4]) {
      if (bloqueado(Math.floor((nx + ox) / T), Math.floor((ny - 1) / T))) return false;
    }
    return true;
  };
  const nx = voce.pos.x + (dx / n) * passo;
  const ny = voce.pos.y + (dy / n) * passo;
  if (livre(nx, voce.pos.y)) voce.pos.x = nx;
  if (livre(voce.pos.x, ny)) voce.pos.y = ny;
  voce.passos += passo;
  voce.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
  voce.tile = { x: Math.floor(voce.pos.x / T), y: Math.floor((voce.pos.y - 1) / T) };
}

// ---------- o que dá para fazer perto de você ----------
function interativos() {
  const lista = [];
  for (const p of personagens.values()) {
    if (p.ehVoce || !p.visivel) continue;
    lista.push({ tipo: 'pessoa', alvo: p, pos: { x: p.pos.x, y: p.pos.y - 6 }, rotulo: `conversar com ${p.nome}` });
  }
  for (const m of MESAS) {
    const dono = [...personagens.values()].find((p) => p.mesa === m && !p.ehVoce);
    const trabalhandoNela = dono && dono.visivel && dono.sentado;
    lista.push({
      tipo: 'mesa', alvo: m, dono, pos: centro(m.assento),
      rotulo: trabalhandoNela ? `ver a tela de ${dono.nome}` : dono ? `sentar no computador de ${dono.nome}` : 'sentar num computador vago',
    });
  }
  const obj = (tipo, rotulo, spot) => lista.push({ tipo, pos: centro(spot), rotulo, spot });
  obj('minhaMesa', 'sentar na sua mesa (seu computador)', LUGARES.gestor);
  obj('cofre', 'abrir o cofre (histórico, desfazer)', LUGARES.cofre);
  obj('wifi', 'Wi-Fi do escritório', LUGARES.roteador);
  obj('ar', 'ar-condicionado (temperatura)', LUGARES.arCondicionado);
  obj('tv', 'ver o jornal do dia', { x: 24, y: 12 });
  obj('estante', 'ler o diário do escritório', { x: 2, y: 3 });
  obj('cafe', 'tomar um café', { x: 10, y: 3 });
  obj('bebedouro', 'beber água', { x: 28, y: 11 });
  obj('sofa', 'sentar no sofá', { x: 24, y: 15 });
  obj('porta', 'encerrar o dia', { x: 7, y: 16 });
  return lista;
}

function maisProximo(raio = 1.6 * T) {
  let melhor = null;
  let dist = raio;
  for (const i of interativos()) {
    const d = Math.hypot(i.pos.x - voce.pos.x, i.pos.y - voce.pos.y);
    if (d < dist) {
      dist = d;
      melhor = i;
    }
  }
  return melhor;
}

function interagir(i) {
  if (!i) return;
  const agora = performance.now();
  switch (i.tipo) {
    case 'pessoa': {
      const p = i.alvo;
      voce.dir = p.pos.x > voce.pos.x + 4 ? 'right' : p.pos.x < voce.pos.x - 4 ? 'left' : p.pos.y > voce.pos.y ? 'down' : 'up';
      if (!p.ocupado && p.chegou) {
        p.dir = { right: 'left', left: 'right', up: 'down', down: 'up' }[voce.dir];
        p.ocupadoAte = agora + 45000;
      }
      definirInterlocutor(p.id);
      selecionado = p;
      atualizarPainel();
      if (!p.ocupado && !p.ferias) p.falar(aleatorio(['Oi! Pode falar.', 'Fala, chefe!', 'Diga!', 'Opa, tudo bem?']), agora, 2500);
      $('#fMsg').focus();
      break;
    }
    case 'mesa': {
      const { alvo: m, dono } = i;
      if (dono && dono.visivel && dono.sentado) return abrirTelaDele(dono);
      sentar(m.assento, m, () => abrirComputador(dono ? dono.id : 'voce', dono ? `Computador de ${dono.nome}` : 'Computador vago (sua mesa de trabalho)'));
      break;
    }
    case 'minhaMesa':
      sentar(LUGARES.gestor, null, () => abrirComputador('voce', 'Seu computador'));
      break;
    case 'cofre': return abrirCofre();
    case 'wifi': return abrirWifi();
    case 'ar': return abrirAr();
    case 'tv': return abrirJornal();
    case 'estante': return abrirDiario();
    case 'cafe':
      voce.comCafe = agora + 30000;
      voce.falar(temperatura() >= 28 ? 'Café com esse calor… mas vamos.' : 'Hmm, café.', agora, 2500);
      break;
    case 'bebedouro':
      voce.falar('Água geladinha.', agora, 2200);
      break;
    case 'sofa':
      voce.irPara({ x: 24, y: 15 }, agora, () => { voce.dir = 'up'; voce.falar('Uma pausa…', performance.now(), 2000); });
      break;
    case 'porta':
      encerrarDia();
      break;
  }
}

function sentar(lugar, mesa, depois) {
  const ok = voce.irPara(lugar, performance.now(), () => {
    voce.mesaSentada = mesa;
    voce.acao = 'sentado';
    voce.dir = mesa ? 'up' : 'down';
    voce.noComputador = true;
    depois?.();
  });
  if (!ok) depois?.();
}

// Clique na sala: anda até lá e interage com o que estiver ali.
function noMundo(ev) {
  const b = tela.getBoundingClientRect();
  return { x: (ev.clientX - b.left) / escala, y: (ev.clientY - b.top) / escala };
}

function alvoNoClique(pt) {
  for (const p of personagens.values()) {
    if (p.ehVoce || !p.visivel) continue;
    if (Math.abs(p.pos.x - pt.x) < 7 && pt.y > p.pos.y - 18 && pt.y < p.pos.y + 2) return { tipo: 'pessoa', alvo: p };
  }
  const tx = Math.floor(pt.x / T);
  const ty = Math.floor(pt.y / T);
  for (const m of MESAS) {
    if ((ty === m.y || ty === m.y - 1 || (ty === m.assento.y && tx === m.assento.x)) && tx >= m.x && tx <= m.x + 1) {
      return interativos().find((i) => i.tipo === 'mesa' && i.alvo === m);
    }
  }
  const dentro = (o) => tx >= o.x && tx < o.x + o.w && ty >= o.y - 1 && ty < o.y + o.h;
  const mapa = [
    ['cofre', 'cofre'], ['roteador', 'wifi'], ['arCondicionado', 'ar'], ['tv', 'tv'], ['estante', 'estante'],
    ['balcaoCafe', 'cafe'], ['bebedouro', 'bebedouro'], ['mesaGestor', 'minhaMesa'],
  ];
  for (const [k, tipo] of mapa) if (dentro(OBJETOS[k])) return interativos().find((i) => i.tipo === tipo);
  if (tx === LUGARES.gestor.x && ty === LUGARES.gestor.y) return interativos().find((i) => i.tipo === 'minhaMesa');
  if (ty === SOFA.y && tx >= SOFA.x && tx < SOFA.x + SOFA.w) return interativos().find((i) => i.tipo === 'sofa');
  if (tx === LUGARES.porta.x && ty === LUGARES.porta.y) return interativos().find((i) => i.tipo === 'porta');
  return null;
}

// ---------- a vida no escritório ----------
const FALAS_SEMPRE = {
  geral: ['Bom esse café hoje.', 'Alguém viu meu fone?', 'Que semana, hein.', 'Bora!', 'Hoje rende.', 'Preciso de mais água.'],
  junior: ['Será que eu consigo fazer isso sozinho?', 'Aprendi um atalho novo!', 'Ai, esqueci de dar commit ontem…'],
  pleno: ['Lista de tarefas em dia.', 'Tudo sob controle.', 'Mais um teste passando.'],
  senior: ['Antes de mexer, eu leio.', 'Simples é melhor.', 'Isso aí vai dar dor de cabeça daqui a um ano.'],
  ti: ['Já tentou desligar e ligar?', 'Não é a rede. Nunca é a rede.', 'Me chama só se pegar fogo.', 'Opa, notificação.'],
  designer: ['Esse botão tá 2 pixels torto.', 'Contraste, gente. Contraste.', 'Que paleta linda.'],
  redator: ['Corta esse adjetivo.', 'Vírgula antes do "mas".', 'Menos é mais.'],
  pesquisador: ['Fonte?', 'Li o artigo inteiro, não só o título.', 'Interessante esse dado.'],
  qa: ['E se o usuário clicar duas vezes?', 'Achei um bug. Brincadeira. Ou não.', 'Funciona na minha máquina?'],
  arquiteto: ['Desenhei umas caixinhas aqui.', 'Isso escala?', 'Vamos pensar no todo.'],
  chefe: ['Bom trabalho, pessoal.', 'Alguém precisa de ajuda?', 'Depois a gente faz uma reunião rápida.'],
};

function falasDe(p) {
  if ((p.humor ?? 70) <= 35) return ['Hmm.', '…', 'Tá.', 'Vou só fazer o meu.'];
  const l = [...(agenda?.falas?.[p.id] ?? []), ...(FALAS_SEMPRE[p.cargo] ?? []), ...FALAS_SEMPRE.geral];
  const d = new Date();
  if (d.getDay() === 5) l.push('Sexta-feira, finalmente!');
  if (d.getDay() === 1) l.push('Segunda… mais um café.');
  if (temperatura() >= 28) l.push('Que calor! Alguém liga o ar?', 'Tá um forno aqui.');
  if (temperatura() <= 20) l.push('Tá frio, hein?');
  if ((p.humor ?? 70) >= 85) l.push('Hoje tô inspirado!', 'Que dia bom!');
  if (agenda?.jornal?.length) l.push(`Viu essa? ${curto(aleatorio(agenda.jornal).titulo, 70)}`);
  return l;
}

// Fofoca no café: status real do escritório.
function fofoca() {
  const hojeISO = new Date().toISOString().slice(0, 10);
  const opcoes = [];
  for (const d of diario.filter((x) => x.data === hojeISO && x.texto.startsWith('Entregou')).slice(-5)) {
    opcoes.push(`Ouvi dizer que ${nomeDe(d.quem)} entregou: ${curto(d.texto.replace(/^Entregou: /, ''), 50)}`);
  }
  for (const p of personagens.values()) if (p.ocupado && !p.ehVoce && p.cargo !== 'chefe') opcoes.push(`${p.nome} tá no meio de uma tarefa daquelas.`);
  for (const p of personagens.values()) if (!p.ehVoce && p.cargo && (p.humor ?? 70) < 35) opcoes.push(`Acho que ${p.nome} não tá num dia bom…`);
  return opcoes.length ? aleatorio(opcoes) : null;
}

function livreParaViver(p, agora) {
  return !p.ehVoce && p.cargo && p.visivel && !p.ferias && !p.ocupado && !TRABALHO.has(p.acao) && !p.fixo && p.ocupadoAte < agora && !p.chegarEm && fase === 'aberto' && !almocoAte && p.chegou;
}

function vida(p, agora) {
  if (!livreParaViver(p, agora) || agora < p.proximaVida) return;
  p.proximaVida = agora + 18000 + Math.random() * 40000;
  if (p.acao !== 'ocioso') {
    p.desejo = { acao: 'ocioso', fixo: false }; // de volta para a mesa
    return;
  }
  const s = Math.random();
  const temJornal = agenda?.jornal?.length;
  let atividade;
  if (p.cargo === 'chefe') atividade = s < 0.75 ? 'ocioso' : s < 0.9 ? 'janela' : 'bebedouro';
  else if (s < 0.4) atividade = 'ocioso';
  else if (s < 0.58) atividade = 'bebedouro';
  else if (s < 0.72) atividade = temJornal ? 'tv' : 'sofa';
  else if (s < 0.8) atividade = 'sofa';
  else if (s < 0.9) atividade = 'janela';
  else atividade = 'planta';
  if (atividade === 'ocioso') {
    if (Math.random() < 0.3) p.falar(aleatorio(falasDe(p)), agora);
    return;
  }
  p.desejo = { acao: atividade, fixo: false };
  if (atividade === 'bebedouro') {
    const colega = [...personagens.values()].find((q) => q !== p && livreParaViver(q, agora) && q.acao === 'ocioso' && Math.random() < 0.6);
    if (colega) {
      colega.desejo = { acao: 'bebedouro', fixo: false };
      colega.proximaVida = p.proximaVida;
      const assunto = fofoca();
      const t0 = agora + 6000;
      p.roteiro = [{ em: t0, texto: aleatorio(falasDe(p)) }, { em: t0 + 8000, texto: assunto ?? aleatorio(falasDe(p)) }];
      colega.roteiro = [{ em: t0 + 4000, texto: aleatorio(['Pois é!', 'Nem me fala.', 'Sério?', 'Haha, verdade.']) }, { em: t0 + 12000, texto: aleatorio(falasDe(colega)) }];
      return;
    }
  }
  p.roteiro = [{ em: agora + 5000, texto: aleatorio(falasDe(p)) }];
}

// ---------- expediente na tela ----------
let roteiroDia = [];
function abrirDiaNaTela(ev, instantaneo) {
  fase = 'aberto';
  $('#fimDia').hidden = true;
  if (instantaneo) {
    luz = luzAlvo = 1;
    return;
  }
  luz = 0.12;
  luzAlvo = 0.12;
  const agora = performance.now();
  const presentes = () => [...personagens.values()].filter((p) => !p.ehVoce && p.cargo && !p.ferias);
  roteiroDia = [
    { em: agora + 3400, f: () => { luzAlvo = 1; } },
    { em: agora + 4200, f: () => entrarVoce(false) },
    // Daily: todos na sala de reunião, o chefe fala, cada um volta.
    { em: agora + 15000, f: () => { if (presentes().length >= 2) for (const p of presentes()) if (!p.ocupado) { p.desejo = { acao: 'reuniao', fixo: false }; p.ocupadoAte = performance.now() + 22000; } } },
    { em: agora + 22000, f: () => { const c = presentes().find((p) => p.cargo === 'chefe'); if (presentes().length >= 2 && c) c.falar(ev.daily ?? 'Bom dia, pessoal!', performance.now(), 8000); } },
    { em: agora + 32000, f: () => { for (const p of presentes()) if (p.acao === 'reuniao') { p.desejo = { acao: 'ocioso', fixo: false }; if (Math.random() < 0.5) p.falar(aleatorio(['Bora!', 'Partiu.', 'Combinado.']), performance.now(), 2500); } } },
  ];
  if (ev.daily) roteiroDia.push({ em: agora + 9000, f: () => { if (presentes().length < 2) presentes()[0]?.falar(ev.daily, performance.now(), 6000); } });
  roteiroDia.sort((a, b) => a.em - b.em);
}

function encerrarDiaNaTela(ev, instantaneo) {
  if (ev.fase === 'encerrando') {
    fase = 'encerrando';
    if (instantaneo) return;
    let i = 0;
    for (const p of personagens.values()) {
      if (p.ehVoce || p.cargo === 'chefe' || !p.visivel) continue;
      setTimeout(() => { p.falar(aleatorio(['Até amanhã!', 'Tchau, pessoal!', 'Fui!', 'Commit feito, até amanhã.']), performance.now(), 2500); p.desejo = { acao: 'saindo', fixo: true }; }, 400 + i++ * 900);
    }
    return;
  }
  fase = 'encerrado';
  const chefe = [...personagens.values()].find((p) => p.cargo === 'chefe');
  if (instantaneo) {
    luz = luzAlvo = 0.12;
    for (const p of personagens.values()) if (!p.ehVoce) p.visivel = false;
  } else {
    chefe?.falar(ev.resumo, performance.now(), 6000);
    setTimeout(() => { if (chefe) chefe.desejo = { acao: 'saindo', fixo: true }; }, 5000);
    setTimeout(() => { luzAlvo = 0.12; }, 6500);
  }
  $('#fimResumo').textContent = ev.resumo ?? '';
  setTimeout(() => { if (fase === 'encerrado') $('#fimDia').hidden = false; }, instantaneo ? 0 : 7500);
}

async function encerrarDia() {
  if (fase !== 'aberto') return;
  if (!confirm('Encerrar o expediente? Cada um salva o que estava fazendo e vai embora. Amanhã continuam de onde pararam.')) return;
  try { await api('POST', '/expediente/encerrar'); } catch (e) { alert(e.message); }
}

// ---------- eventos do cérebro ----------
function sincronizarEquipe(ev, instantaneo, agora) {
  equipeInfo = ev.equipe;
  const recente = Date.now() - new Date(ev.em).getTime() < 20000;
  let fila = 0;
  const ids = new Set(ev.equipe.map((f) => f.id));
  for (const p of [...personagens.values()]) {
    if (p.ehVoce || ids.has(p.id) || !p.cargo) continue;
    if (instantaneo) personagens.delete(p.id);
    else {
      p.desejo = { acao: 'saindo', fixo: true };
      setTimeout(() => personagens.delete(p.id), 12000);
    }
  }
  const ordem = [...ev.equipe].sort((a, b) => (a.cargo === 'chefe' ? -1 : b.cargo === 'chefe' ? 1 : 0));
  for (const f of ordem) {
    const i = ev.equipe.indexOf(f);
    let p = personagens.get(f.id);
    const novo = !p;
    if (!p) {
      p = new Personagem(f.id, f, i);
      personagens.set(f.id, p);
    }
    const voltou = p.ferias && !f.ferias;
    const saiu = !p.ferias && f.ferias;
    Object.assign(p, { nome: f.nome, cargo: f.cargo, modelo: f.modelo, personalidade: f.personalidade, humor: f.humor ?? p.humor, aniversario: f.aniversario, ferias: Boolean(f.ferias) });
    if (f.ferias) {
      if (saiu && !instantaneo) { p.falar('Férias! 🏖️ Até a volta!', agora); p.desejo = { acao: 'ferias', fixo: true }; }
      else if (novo || instantaneo) p.visivel = false;
      continue;
    }
    if (novo || voltou || ev.motivo === 'chegada') {
      if (instantaneo && !recente) p.aplicar({ acao: 'ocioso', fixo: false }, true, agora);
      else {
        p.visivel = false;
        p.tile = { ...LUGARES.porta };
        p.pos = centro(p.tile);
        p.chegarEm = agora + (ev.motivo === 'chegada' ? 3000 : 600) + fila++ * 1500;
        p.saudacao = voltou ? 'Voltei! Descansado.' : ev.motivo === 'chegada' ? (f.cargo === 'chefe' ? 'Bom dia! Acendendo as luzes.' : aleatorio(['Bom dia!', 'Bom dia, pessoal!', 'Cheguei!'])) : `Oi! Sou ${f.nome}. Prazer!`;
      }
    }
  }
}

function aoEvento(ev, instantaneo) {
  const agora = performance.now();
  ev._n = contador++;

  if (ev.sessao === 'escritorio') {
    switch (ev.tipo) {
      case 'equipe': sincronizarEquipe(ev, instantaneo, agora); break;
      case 'mensagem': {
        const chave = ev.de === 'voce' ? ev.para : ev.de;
        conversas[chave] ??= [];
        if (!conversas[chave].some((m) => m.em === ev.em && m.de === ev.de)) conversas[chave].push({ de: ev.de, para: ev.para, texto: ev.texto, em: ev.em });
        if (ev.de !== 'voce' && !instantaneo) {
          const p = personagens.get(ev.de);
          p?.falar(curto(ev.texto, 90), agora, 6000);
          if (p && ev.texto.startsWith('Ei, tive uma ideia') && !p.ocupado) p.desejo = { acao: 'entregando', fixo: true };
          if (interlocutor !== ev.de) notificar(`${nomeDe(ev.de)}: ${curto(ev.texto, 80)}`);
        }
        break;
      }
      case 'contratacao_pedida':
        contratacoes.set(ev.idPedido, ev);
        personagens.get(ev.pedidoPor)?.receber({ acao: 'pedindo', fixo: true }, instantaneo, agora);
        break;
      case 'contratacao_respondida': {
        const pedido = contratacoes.get(ev.idPedido);
        contratacoes.delete(ev.idPedido);
        if (pedido) personagens.get(pedido.pedidoPor)?.receber({ acao: 'ocioso', liberar: true, fala: ev.aprovada ? 'Ótimo, obrigado!' : 'Tudo bem, seguimos assim.' }, instantaneo, agora);
        break;
      }
      case 'tarefa_delegada': {
        const p = personagens.get(ev.para);
        if (p && ev.local && ev.local !== ev.para) p.local = ev.local;
        if (!instantaneo && ev.de !== 'voce' && !ev.tarefa.startsWith('(na fila')) personagens.get(ev.de)?.falar(`${nomeDe(ev.para)}, tenho uma tarefa pra você!`, agora);
        break;
      }
      case 'integracao':
        if (!instantaneo && ev.mensagem !== 'nada novo para integrar') personagens.get(ev.funcionario)?.falar(ev.ok ? 'Meu trabalho já está na versão principal.' : 'Ih, deu conflito ao juntar meu trabalho…', agora);
        break;
      case 'expediente':
        if (ev.fase === 'aberto') abrirDiaNaTela(ev, instantaneo);
        else encerrarDiaNaTela(ev, instantaneo);
        break;
      case 'humor': {
        const p = personagens.get(ev.funcionario);
        if (p) {
          const antes = p.humor;
          p.humor = ev.humor;
          if (!instantaneo && ev.motivo === 'elogio do gestor') p.falar(aleatorio(['Valeu! 😊', 'Obrigado, chefe!', 'Ah, que bom ouvir isso!']), agora);
          if (!instantaneo && ev.motivo === 'bronca do gestor') p.falar(aleatorio(['…tá bom.', 'Ok.', 'Entendi.']), agora);
          if (!instantaneo && antes >= 35 && ev.humor < 35) notificar(`${p.nome} está chateado(a).`);
        }
        break;
      }
      case 'almoco':
        almocoAte = ev.ate;
        if (!instantaneo) {
          for (const p of personagens.values()) {
            if (p.ehVoce || !p.cargo || p.ferias || p.ocupado) continue;
            if (ev.ate) { p.falar(`Almoço! Volto às ${horaCurta(ev.ate)}.`, agora); p.desejo = { acao: 'almoco', fixo: true }; }
            else { p.saudacao = 'Voltei do almoço!'; p.chegarEm = agora + 500 + Math.random() * 4000; }
          }
        }
        break;
      case 'agenda': agenda = ev.agenda; break;
      case 'aniversario':
        aniversariantes.add(ev.funcionario);
        if (!instantaneo) setTimeout(() => {
          for (const p of personagens.values()) if (!p.ehVoce && p.cargo && p.id !== ev.funcionario && p.visivel) p.roteiro.push({ em: performance.now() + 2000 + Math.random() * 8000, texto: `Parabéns, ${nomeDe(ev.funcionario)}! 🎂` });
        }, 12000);
        break;
      case 'maquina': maquina = ev; break;
      case 'config': internet = ev.internet; aprovarTudo = ev.aprovarTudo; $('#fAuto').checked = aprovarTudo; break;
      case 'cofre': if (!instantaneo) notificar(`Desfeito: ${ev.assunto}`); break;
    }
    if (ev.tipo !== 'maquina') {
      feedGeral.push({ ev, id: ev.funcionario ?? ev.de ?? ev.pedidoPor });
      if (feedGeral.length > 400) feedGeral.shift();
      if (!instantaneo) atualizarPainel();
    }
    return;
  }

  // eventos de uma sessão (trabalho ou conversa)
  if (ev.tipo === 'sessao_iniciada') {
    const id = ev.funcionario ?? `sessao-${ev.sessao}`;
    sessaoParaId.set(ev.sessao, id);
    if (ev.conversa) sessaoConversa.add(ev.sessao);
    let p = personagens.get(id);
    if (!p) {
      p = new Personagem(id, { nome: id, modelo: ev.modelo }, personagens.size);
      personagens.set(id, p);
    }
    if (!ev.conversa) Object.assign(p, { branch: ev.branch ?? '', pasta: ev.pasta, tarefa: ev.tarefa });
  }
  if (ev.tipo === 'permissao_pedida') pedidos.set(ev.idPedido, ev);
  if (ev.tipo === 'permissao_respondida') pedidos.delete(ev.idPedido);
  if (ev.tipo === 'cota') ultimaCota = ev;

  const id = sessaoParaId.get(ev.sessao);
  feedGeral.push({ ev, id });
  if (feedGeral.length > 400) feedGeral.shift();
  const p = personagens.get(id);
  if (ev.tipo === 'tarefa_terminada' || ev.tipo === 'erro') sessoesFim.add(ev.sessao);
  if (p) {
    p.eventos.push(ev);
    if (p.eventos.length > 600) p.eventos.splice(0, 200);
    const r = comportamento(ev);
    if (sessaoConversa.has(ev.sessao)) {
      // Conversa: não sai do lugar; pensa e responde (a resposta vem como mensagem).
      if (ev.tipo === 'sessao_iniciada') { p.ocupado = true; if (!instantaneo) p.falar(aleatorio(['Hmm, deixa eu ver…', 'Hmm…', 'Deixa eu pensar…']), agora, 2500); }
      if (ev.tipo === 'permissao_pedida' || ev.tipo === 'permissao_respondida') p.receber(r, instantaneo, agora);
      if (ev.tipo === 'tarefa_terminada' || ev.tipo === 'erro') {
        p.ocupado = [...sessaoParaId.entries()].some(([s, q]) => q === id && !sessoesFim.has(s));
        if (p.acao === 'pedindo') p.receber({ acao: 'ocioso', liberar: true }, instantaneo, agora);
      }
    } else {
      if (ev.tipo === 'texto') r.fala = undefined; // o relato vai para a ficha; o balão mostra o andamento
      p.receber(r, instantaneo, agora);
    }
  }
  if (!instantaneo) {
    atualizarPainel();
    if (telaAbertaDe === id) renderizarTelaDele();
  }
}

function conectar() {
  const fonte = new EventSource('/eventos');
  fonte.onopen = () => {
    $('#conexao').textContent = 'conectado';
    $('#conexao').className = 'pilula on';
  };
  fonte.onerror = () => {
    $('#conexao').textContent = 'sem conexão com o cérebro';
    $('#conexao').className = 'pilula off';
  };
  fonte.onmessage = (m) => aoEvento(JSON.parse(m.data), reconstruindo);
  fonte.addEventListener('historico_fim', () => {
    reconstruindo = false;
    if (!voce.visivel && fase === 'aberto' && !roteiroDia.length) entrarVoce(true);
    atualizarPainel();
  });
}

// ---------- voz por proximidade ----------
let vozes = [];
function carregarVozes() {
  try {
    const todas = window.speechSynthesis?.getVoices() ?? [];
    vozes = todas.filter((v) => v.lang?.toLowerCase().startsWith('pt'));
    if (!vozes.length) vozes = todas;
  } catch {}
}
if ('speechSynthesis' in window) {
  carregarVozes();
  window.speechSynthesis.onvoiceschanged = carregarVozes;
}
function falarEmVoz(p, texto) {
  if (!somLigado || reconstruindo || p.ehVoce || !('speechSynthesis' in window) || !voce.visivel || !p.visivel) return;
  const d = Math.hypot(p.pos.x - voce.pos.x, p.pos.y - voce.pos.y) / T;
  if (d > 7) return; // longe: não se ouve
  try {
    const u = new SpeechSynthesisUtterance(texto.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ''));
    const h = hash(p.id);
    if (vozes.length) u.voice = vozes[h % vozes.length];
    u.lang = u.voice?.lang ?? 'pt-BR';
    u.pitch = 0.75 + (h % 60) / 100;
    u.rate = { junior: 1.15, ti: 0.85, senior: 0.95, chefe: 0.95 }[p.cargo] ?? 1.02;
    u.volume = Math.max(0.15, 1 - d / 7); // perto: claro; um pouco longe: baixo
    window.speechSynthesis.speak(u);
  } catch {}
}

// ---------- tela (canvas) ----------
const tela = $('#tela');
const ctx = tela.getContext('2d');
const mundo = document.createElement('canvas');
mundo.width = W;
mundo.height = H;
const g = mundo.getContext('2d');
let escala = 2;

function redimensionar() {
  const palco = $('#palco');
  const largura = Math.max(240, palco.clientWidth - 24);
  const altura = Math.max(200, window.innerHeight - 110);
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
  const linhas = [''];
  for (const p of texto.split(' ')) {
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
  const fs = Math.max(11, Math.round(escala * 3.4));
  ctx.font = `600 ${fs}px system-ui, sans-serif`;
  const linhas = quebrar(texto, 30);
  const lw = Math.max(...linhas.map((l) => ctx.measureText(l).width));
  const pad = fs * 0.5;
  const bw = lw + pad * 2;
  const bh = linhas.length * fs * 1.25 + pad * 1.4;
  const bx = Math.min(Math.max(4, x - bw / 2), W * escala - bw - 4);
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
  const fs = Math.max(10, Math.round(escala * 2.9));
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

function sobreposicao() {
  const s = escala;
  for (const p of personagens.values()) {
    if (!p.visivel) continue;
    if (p === selecionado || p.ehVoce) {
      ctx.strokeStyle = p.ehVoce ? 'rgba(242,184,75,.55)' : '#f2b84b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.pos.x * s, (p.pos.y + 1) * s, 8 * s, 3 * s, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    const nome = p.ehVoce ? 'você' : p.cargo === 'chefe' ? `${p.nome} ★` : p.nome;
    etiqueta(p.pos.x * s, (p.pos.y + 3) * s, nome, p.ehVoce ? '#f2b84b' : corDoModelo(p.modelo), p === selecionado);
  }
  for (const p of personagens.values()) {
    if (!p.visivel) continue;
    const topo = (p.pos.y - 18) * s;
    const ct = [...contratacoes.values()].find((e) => e.pedidoPor === p.id);
    if (p.chegou && (p.acao === 'pedindo' || (ct && p.acao === 'entregando'))) {
      const pd = [...pedidos.values()].find((e) => sessaoParaId.get(e.sessao) === p.id);
      const texto = pd ? `✋ Posso? ${pd.ferramenta}: ${curto(pd.resumo, 48)}` : ct ? `📋 Precisamos contratar: ${curto(ct.motivo, 50)}` : '✋ Com licença…';
      balao(p.pos.x * s, topo, texto, '#fff1c9', '#f2b84b');
    } else if (p.fala) {
      balao(p.pos.x * s, topo, p.fala.texto);
    }
  }
}

// ---------- laço principal (o mundo nunca congela esperando a IA) ----------
let anterior = performance.now();
let ultimaDica = '';
let dicaTravadaAte = 0;
function quadro(agora) {
  const dt = Math.min(0.1, (agora - anterior) / 1000);
  anterior = agora;
  while (roteiroDia.length && agora >= roteiroDia[0].em) roteiroDia.shift().f();
  luz += (luzAlvo - luz) * Math.min(1, dt * 1.5);
  moverComTeclado(dt);
  for (const p of personagens.values()) {
    p.atualizar(dt, agora);
    vida(p, agora);
  }
  const t = agora / 1000;
  const pessoas = [...personagens.values()];
  desenharMundo(g, t, {
    pessoas, data: new Date(), temperatura: temperatura(), internet, agenda, luz, aniversariantes,
    mesasFesta: new Set(pessoas.filter((p) => aniversariantes.has(p.id) && p.mesa).map((p) => p.mesa.id)),
  });
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, W * escala, H * escala);
  ctx.drawImage(mundo, 0, 0, W * escala, H * escala);
  sobreposicao();
  if (agora > dicaTravadaAte) {
    const perto = !modalAberto() && voce.visivel ? maisProximo() : null;
    const dica = perto ? `<kbd>E</kbd> ${esc(perto.rotulo)}` : 'Ande com <kbd>WASD</kbd> ou as setas, ou clique na sala. <kbd>E</kbd> interage.';
    if (dica !== ultimaDica) {
      $('#dica').innerHTML = dica;
      ultimaDica = dica;
    }
  }
  if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) atualizarVivos();
  requestAnimationFrame(quadro);
}

function notificar(texto) {
  $('#dica').innerHTML = `🔔 ${esc(texto)}`;
  ultimaDica = '';
  dicaTravadaAte = performance.now() + 5000;
}

// ---------- teclado e mouse ----------
const modalAberto = () => [...document.querySelectorAll('.sobre')].some((m) => !m.hidden);
const digitando = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || Boolean(document.activeElement?.closest?.('.xterm'));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalAberto()) {
    fecharModais();
    return;
  }
  if (modalAberto() || digitando()) return;
  const k = e.key.toLowerCase();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k)) {
    teclas.add(k);
    e.preventDefault();
  }
  if (k === 'e' || k === ' ' || k === 'enter') {
    e.preventDefault();
    interagir(maisProximo());
  }
});
window.addEventListener('keyup', (e) => teclas.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => teclas.clear());

tela.addEventListener('mousemove', (e) => {
  tela.style.cursor = alvoNoClique(noMundo(e)) ? 'pointer' : 'default';
});
tela.addEventListener('click', (e) => {
  tela.focus();
  if (!voce.visivel) return;
  const pt = noMundo(e);
  const alvo = alvoNoClique(pt);
  const agora = performance.now();
  levantar();
  if (alvo) {
    if (alvo.tipo === 'pessoa') {
      const p = alvo.alvo;
      if (Math.hypot(p.pos.x - voce.pos.x, p.pos.y - voce.pos.y) < 1.8 * T) return interagir(alvo);
      const perto = vizinhoLivre({ x: Math.floor(p.pos.x / T), y: Math.floor((p.pos.y - 1) / T) }, voce.tile);
      return voce.irPara(perto, agora, () => interagir(alvo)) || interagir(alvo);
    }
    if (alvo.tipo === 'mesa' || alvo.tipo === 'minhaMesa' || alvo.tipo === 'sofa') return interagir(alvo);
    const ponto = alvo.spot ?? alvo.pos;
    return voce.irPara(ponto, agora, () => interagir(alvo)) || interagir(alvo);
  }
  const tile = { x: Math.floor(pt.x / T), y: Math.floor(pt.y / T) };
  voce.irPara(bloqueado(tile.x, tile.y) ? vizinhoLivre(tile, voce.tile) : tile, agora);
});

// ---------- API ----------
async function api(metodo, rota, corpo) {
  const res = await fetch(rota, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo ? JSON.stringify(corpo) : undefined });
  const dados = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(dados.erro ?? `erro ${res.status}`);
  return dados;
}

// ---------- conversa ----------
function definirInterlocutor(id) {
  interlocutor = id;
  ultimaConversa = '';
  renderizarChat();
}
$('#interlocutor').addEventListener('change', (e) => definirInterlocutor(e.target.value));
$('#formFala').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#fMsg').value.trim();
  if (!texto || !interlocutor) return;
  const botao = $('#formFala button');
  botao.disabled = true;
  $('#erroChat').textContent = '';
  try {
    await api('POST', '/conversar', { para: interlocutor, texto });
    $('#fMsg').value = '';
  } catch (err) {
    $('#erroChat').textContent = err.message;
  } finally {
    botao.disabled = false;
  }
});
$('#fMsg').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('#formFala').requestSubmit();
  }
});

let ultimaConversa = '';
function sessaoAtivaDeConversa(id) {
  return [...sessaoParaId.entries()].some(([s, q]) => q === id && sessaoConversa.has(s) && !sessoesFim.has(s));
}
function renderizarChat() {
  const membros = [...personagens.values()].filter((p) => !p.ehVoce && p.cargo);
  const opcoes = membros.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)} (${esc(tituloDe(p))})${p.ferias ? ' 🏖️' : ''}</option>`).join('');
  if ($('#interlocutor').dataset.opcoes !== opcoes) {
    $('#interlocutor').innerHTML = opcoes;
    $('#interlocutor').dataset.opcoes = opcoes;
  }
  if (!interlocutor || !personagens.has(interlocutor)) interlocutor = membros.find((p) => p.cargo === 'chefe')?.id ?? membros[0]?.id ?? null;
  if (interlocutor && $('#interlocutor').value !== interlocutor) $('#interlocutor').value = interlocutor;
  const p = personagens.get(interlocutor);
  const perto = p && p.visivel && voce.visivel && Math.hypot(p.pos.x - voce.pos.x, p.pos.y - voce.pos.y) < 3.2 * T;
  $('#modoConversa').textContent = p ? (perto ? '🗣️ pessoalmente' : '📞 pelo ramal') : '';
  $('#fMsg').placeholder = p ? `Fale com ${p.nome}… (Enter envia)` : 'Ninguém no escritório ainda';
  const lista = conversas[interlocutor] ?? [];
  const pensando = p && sessaoAtivaDeConversa(p.id) ? `<div class="pensando">${esc(p.nome)} está pensando…</div>` : '';
  const html = lista.map((m) => `<div class="msg ${m.de === 'voce' ? 'minha' : 'dele'}"><span class="quem">${esc(nomeDe(m.de))}</span>${esc(m.texto)}</div>`).join('') + pensando;
  if (html !== ultimaConversa) {
    $('#chat').innerHTML = html || '<div class="vazio">Comece a conversa. Chegue perto de alguém e aperte E, ou escolha acima (ramal).</div>';
    $('#chat').scrollTop = $('#chat').scrollHeight;
    ultimaConversa = html;
  }
}

// ---------- pedidos ----------
$('#pedidos').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  b.disabled = true;
  const aprovar = b.dataset.aprovar === '1';
  try {
    if (b.dataset.tipo === 'contratacao') await api('POST', `/contratacoes/${b.dataset.id}`, { aprovar });
    else await api('POST', `/permissoes/${b.dataset.id}`, { aprovar });
  } catch (err) {
    b.disabled = false;
    alert(err.message);
  }
});
$('#fAuto').addEventListener('change', async (e) => {
  try { await api('POST', '/config', { aprovarTudo: e.target.checked }); } catch { e.target.checked = !e.target.checked; }
});
$('#btnPasta').addEventListener('click', () => api('POST', '/abrir-pasta', { alvo: 'principal' }).catch((e) => alert(e.message)));

// ---------- janelas ----------
function fecharModais() {
  for (const m of document.querySelectorAll('.sobre')) {
    if (['boasvindas', 'fimDia'].includes(m.id)) continue;
    m.hidden = true;
  }
  telaAbertaDe = null;
  voce.noComputador = false;
  tela.focus();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-fechar]')) fecharModais(); });

function janela(titulo, html) {
  $('#janTitulo').textContent = titulo;
  $('#janCorpo').innerHTML = html;
  $('#janela').hidden = false;
}

async function abrirCofre() {
  janela('🗄️ Cofre', '<div class="vazio">Abrindo…</div>');
  try {
    const { historico } = await api('GET', '/cofre');
    $('#janCorpo').innerHTML = `<p>O histórico do projeto. Cada entrega é um registro; desfazer cria um registro novo que volta ao estado anterior (dá para desfazer o desfazer).</p>
      <div class="lista">${historico.map((h) => `<div class="item"><div class="linha"><div style="flex:3"><b>${esc(h.assunto)}</b><div class="sub">${esc(h.autor)} · ${new Date(h.em).toLocaleString('pt-BR')}</div></div>
      <button class="neutro pequeno" data-ver="${h.hash}" style="flex:0">ver</button>
      ${h.assunto.startsWith('Escritório aberto') ? '' : `<button class="perigo pequeno" data-desfazer="${h.hash}" style="flex:0">desfazer</button>`}</div><pre hidden id="d-${h.hash}"></pre></div>`).join('') || '<div class="vazio">Nada ainda.</div>'}</div>`;
  } catch (e) {
    $('#janCorpo').innerHTML = `<div class="erro">${esc(e.message)}</div>`;
  }
}
$('#janCorpo').addEventListener('click', async (e) => {
  const ver = e.target.closest('[data-ver]');
  const desf = e.target.closest('[data-desfazer]');
  const jornal = e.target.closest('#btnAtualizarJornal');
  if (ver) {
    const pre = $(`#d-${ver.dataset.ver}`);
    if (!pre.hidden) return (pre.hidden = true);
    pre.textContent = 'carregando…';
    pre.hidden = false;
    try { pre.textContent = (await api('GET', `/cofre/${ver.dataset.ver}`)).detalhe; } catch (err) { pre.textContent = err.message; }
  }
  if (desf && confirm('Desfazer esta entrega? A versão principal volta ao que era antes dela.')) {
    try { await api('POST', `/cofre/${desf.dataset.desfazer}/desfazer`); abrirCofre(); } catch (err) { alert(err.message); }
  }
  if (jornal) {
    jornal.disabled = true;
    await api('POST', '/agenda/gerar').catch(() => {});
    jornal.textContent = 'Pedido! O jornal chega em um ou dois minutos.';
  }
});
$('#janCorpo').addEventListener('change', async (e) => {
  if (e.target.id === 'wifiInternet') await api('POST', '/config', { internet: e.target.checked }).catch((err) => alert(err.message));
  if (e.target.id === 'wifiAuto') await api('POST', '/config', { aprovarTudo: e.target.checked }).catch((err) => alert(err.message));
});

function abrirWifi() {
  janela('📶 Wi-Fi do escritório', `
    <p>A rede define o que os computadores dos funcionários podem fazer.</p>
    <label class="chk"><input type="checkbox" id="wifiInternet" ${internet ? 'checked' : ''}> Internet liberada (pesquisa e navegação na web)</label>
    <p class="vazio">Desligada, os funcionários não pesquisam nem abrem sites (instalar pacotes continua possível).</p>
    <label class="chk"><input type="checkbox" id="wifiAuto" ${aprovarTudo ? 'checked' : ''}> Aprovar pedidos de permissão automaticamente</label>
    <p class="vazio">Mesmo assim, nada fora da pasta do projeto é permitido.</p>`);
}

function abrirAr() {
  const m = maquina;
  janela('❄️ Ar-condicionado', m
    ? `<p>A temperatura do escritório é a carga real do seu computador.</p>
       <div class="item"><b>🌡️ ${m.temperatura}°C</b><div class="sub">Carga do processador: ${Math.round(m.carga * 100)}% de ${m.nucleos} núcleos</div></div>
       <p>${m.temperatura >= 28 ? 'Está quente: o computador está trabalhando muito (builds, testes, muita gente trabalhando ao mesmo tempo). Menos gente em paralelo refresca.' : m.temperatura >= 25 ? 'Morno: trabalho em andamento.' : 'Fresquinho: o computador está tranquilo.'}</p>`
    : '<p>Medindo…</p>');
}

function abrirJornal() {
  const j = agenda?.jornal ?? [];
  janela('📺 Jornal do escritório', `
    ${j.length ? `<p>Notícias reais de hoje, buscadas na internet de manhã. A equipe comenta no bebedouro.</p>
    <div class="lista">${j.map((n) => `<div class="item"><b>${esc(n.titulo)}</b><div class="sub">${esc(n.fonte)}</div><div>${esc(n.resumo)}</div>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">ler na fonte</a>` : ''}</div>`).join('')}</div>`
    : `<p>${internet ? 'O jornal de hoje ainda não chegou.' : 'A internet do escritório está desligada, então não tem jornal hoje.'}</p>`}
    <button class="neutro" id="btnAtualizarJornal" style="margin-top:10px">Buscar o jornal agora</button>`);
}

async function abrirDiario() {
  try { diario = (await api('GET', '/estado')).diario ?? diario; } catch {}
  const porDia = {};
  for (const d of diario) (porDia[d.data] ??= []).push(d);
  janela('📒 Diário do escritório', Object.keys(porDia).length
    ? Object.entries(porDia).reverse().map(([data, l]) => `<h2 style="margin-top:12px">${new Date(data + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <div class="lista">${l.map((d) => `<div class="item"><b>${esc(nomeDe(d.quem))}</b> <span class="sub">${horaCurta(d.em)}</span><div>${esc(d.texto)}</div></div>`).join('')}</div>`).join('')
    : '<p>O diário ainda está vazio. Cada entrega, contratação e fim de expediente fica anotado aqui.</p>');
}

function abrirAjuda() {
  janela('❔ Como jogar', `
    <p><b>Você é o gestor.</b> Ande pelo escritório com <b>WASD</b> ou as setas (ou clique onde quer ir). Chegue perto de algo e aperte <b>E</b>.</p>
    <div class="lista">
      <div class="item">🗣️ <b>Conversar:</b> chegue perto de alguém e aperte E. Pelo painel dá para falar com qualquer um (ramal). Peça o que quer construir ao <b>chefe ★</b>.</div>
      <div class="item">💻 <b>Computadores:</b> sente numa mesa vaga ou na sua para abrir um terminal de verdade. Na mesa de quem está trabalhando, você vê a tela da pessoa.</div>
      <div class="item">📋 <b>Pedidos:</b> permissões e contratações aparecem no painel, e a pessoa vem até a sua mesa.</div>
      <div class="item">🗄️ <b>Cofre:</b> histórico e desfazer. 📶 <b>Roteador:</b> internet da equipe. ❄️ <b>Ar:</b> temperatura = carga do PC. 📺 <b>TV:</b> jornal real do dia. 📒 <b>Estante:</b> diário.</div>
    </div>
    <h2 style="margin-top:14px">O que cada cena quer dizer</h2>
    <div class="lista">
      <div class="item">⌨️ Digitando na mesa → escrevendo ou editando arquivos</div>
      <div class="item">📚 Na estante com um livro → lendo arquivos, buscando, pesquisando</div>
      <div class="item">☕ Cafezinho → esperando um comando rodar (teste, build, instalação)</div>
      <div class="item">✋ Indo à sua mesa → precisa de permissão, quer contratar ou vai entregar com evidência</div>
      <div class="item">🚻 Banheiro ("já volto") → compactando a memória (contexto)</div>
      <div class="item">🍽️ Almoço → a cota da conta está no limite; voltam quando renovar</div>
      <div class="item">🔵 Tela azul / "meu PC travou" → erro na sessão</div>
      <div class="item">🌡️ Calor → o computador de verdade está com carga alta</div>
      <div class="item">🛋️ Bebedouro, sofá, janela → vida: só quem não está trabalhando</div>
      <div class="item">🌙 Fim do dia → cada um salva o trabalho (commit) e vai embora; amanhã continuam</div>
    </div>`);
}
$('#btnAjuda').addEventListener('click', abrirAjuda);
$('#btnEncerrar').addEventListener('click', encerrarDia);
$('#btnSom').addEventListener('click', () => {
  somLigado = !somLigado;
  guardar('som', somLigado ? 'sim' : 'nao');
  if (!somLigado) try { window.speechSynthesis.cancel(); } catch {}
  atualizarVivos();
});
$('#btnReabrir').addEventListener('click', async () => {
  $('#fimDia').hidden = true;
  await api('POST', '/expediente/abrir').catch((e) => alert(e.message));
});

// ---------- a tela de um funcionário ----------
function abrirTelaDele(p) {
  telaAbertaDe = p.id;
  $('#telaTitulo').textContent = `Tela de ${p.nome}`;
  $('#telaDele').hidden = false;
  renderizarTelaDele();
}
function renderizarTelaDele() {
  const p = personagens.get(telaAbertaDe);
  if (!p) return;
  const linhas = [];
  for (const ev of p.eventos.slice(-120)) {
    if (sessaoConversa.has(ev.sessao)) continue;
    if (ev.tipo === 'sessao_iniciada') linhas.push(`<span class="sis">━━ nova tarefa: ${esc(curto(ev.tarefa, 200))}</span>`);
    if (ev.tipo === 'ferramenta_chamada') linhas.push(`<span class="cmd">▶ ${esc(ev.ferramenta)}</span>\n${esc(ev.detalhe ?? ev.resumo)}`);
    if (ev.tipo === 'ferramenta_resultado') linhas.push(`<span class="${ev.erro ? 'err' : 'sis'}">${esc(curto(ev.detalhe ?? ev.resumo, 1200))}</span>`);
    if (ev.tipo === 'texto') linhas.push(`<span class="txt">💬 ${esc(ev.texto)}</span>`);
    if (ev.tipo === 'tarefa_terminada') linhas.push(`<span class="sis">━━ ${ev.sucesso ? 'terminou' : 'não terminou'} (${(ev.duracaoMs / 1000).toFixed(0)}s)</span>`);
  }
  const el = $('#telaFunc');
  const noFim = el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  el.innerHTML = linhas.join('\n\n') || '<span class="sis">Tela parada. Ainda não fez nada hoje.</span>';
  if (noFim) el.scrollTop = el.scrollHeight;
}
$('#telaSentar').addEventListener('click', () => {
  const p = personagens.get(telaAbertaDe);
  $('#telaDele').hidden = true;
  telaAbertaDe = null;
  if (p) abrirComputador(p.id, `Junto com ${p.nome} (mesa dele/dela)`);
});

// ---------- o computador de verdade (terminal) ----------
const terminais = {}; // alvo → { id, pasta, vivo }
let term = null;
let ajuste = null;
let fonteTerm = null;
let alvoTerm = null;

async function abrirComputador(alvo, titulo) {
  $('#compTitulo').textContent = titulo;
  $('#compEntregar').hidden = alvo !== 'voce';
  $('#compErro').textContent = '';
  $('#computador').hidden = false;
  voce.noComputador = true;
  if (!window.Terminal) {
    $('#compErro').textContent = 'O terminal não carregou.';
    return;
  }
  if (!term) {
    term = new window.Terminal({ fontFamily: 'ui-monospace, "DejaVu Sans Mono", monospace', fontSize: 13, cursorBlink: true, theme: { background: '#0f0d14', foreground: '#ece6f2', cursor: '#f2b84b' } });
    ajuste = new window.FitAddon.FitAddon();
    term.loadAddon(ajuste);
    term.open($('#terminal'));
    let buffer = '';
    let timer = null;
    term.onData((d) => {
      buffer += d;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const dados = buffer;
        buffer = '';
        if (terminais[alvoTerm]) api('POST', `/terminais/${terminais[alvoTerm].id}/entrada`, { dados }).catch(() => {});
      }, 8);
    });
    window.addEventListener('resize', () => { if (!$('#computador').hidden) ajustarTerminal(); });
  }
  if (alvoTerm !== alvo || !terminais[alvo]?.vivo) {
    fonteTerm?.close();
    term.reset();
    alvoTerm = alvo;
    try {
      if (!terminais[alvo]?.vivo) terminais[alvo] = { ...(await api('POST', '/terminais', { alvo })), vivo: true };
    } catch (e) {
      $('#compErro').textContent = e.message;
      return;
    }
    $('#compInfo').textContent = `Pasta: ${terminais[alvo].pasta}${alvo === 'voce' ? ' · o que você fizer aqui fica na sua mesa (branch mesa/voce); "Entregar meu trabalho" leva para a versão principal.' : ''}`;
    fonteTerm = new EventSource(`/terminais/${terminais[alvo].id}/saida`);
    fonteTerm.onmessage = (m) => term.write(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
    fonteTerm.addEventListener('fim', () => {
      terminais[alvo].vivo = false;
      term.write('\r\n\x1b[33m[computador desligado: levante e sente de novo para religar]\x1b[0m\r\n');
      fonteTerm.close();
    });
  }
  setTimeout(() => { ajustarTerminal(); term.focus(); }, 60);
}
function ajustarTerminal() {
  try {
    ajuste.fit();
    if (terminais[alvoTerm]) api('POST', `/terminais/${terminais[alvoTerm].id}/tamanho`, { colunas: term.cols, linhas: term.rows }).catch(() => {});
  } catch {}
}
$('#compLevantar').addEventListener('click', () => {
  $('#computador').hidden = true;
  voce.noComputador = false;
  tela.focus();
});
$('#compPasta').addEventListener('click', () => api('POST', '/abrir-pasta', { alvo: alvoTerm }).catch((e) => ($('#compErro').textContent = e.message)));
$('#compEntregar').addEventListener('click', async () => {
  try {
    const r = await api('POST', '/entregar-meu-trabalho');
    $('#compErro').textContent = r.ok ? `✅ ${r.mensagem}` : r.mensagem;
  } catch (e) {
    $('#compErro').textContent = e.message;
  }
});

// ---------- contratação ----------
function retrato(canvas, id, modelo) {
  const c = canvas.getContext('2d');
  const h = hash(id);
  const px = (x, y, w, hh, cor) => { c.fillStyle = cor; c.fillRect(x, y, w, hh); };
  c.clearRect(0, 0, 12, 16);
  px(2, 9, 8, 6, corDoModelo(modelo));
  px(0, 10, 2, 4, corDoModelo(modelo));
  px(10, 10, 2, 4, corDoModelo(modelo));
  px(2, 2, 8, 7, PELES[h % PELES.length]);
  px(2, 1, 8, 3, CABELOS[(h >> 4) % CABELOS.length]);
  px(2, 2, 1, 3, CABELOS[(h >> 4) % CABELOS.length]);
  px(9, 2, 1, 3, CABELOS[(h >> 4) % CABELOS.length]);
  px(4, 5, 1, 2, '#1f1f26');
  px(7, 5, 1, 2, '#1f1f26');
}
const slugJs = (n) => n.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function montarAbas() {
  const ordem = Object.entries(cargosInfo).sort((a, b) => (a[1].grupo === b[1].grupo ? 0 : a[1].grupo === 'base' ? -1 : 1));
  $('#abas').innerHTML = ordem.map(([k, v]) => `<button class="neutro" data-cargo="${k}">${esc(v.titulo)}</button>`).join('');
}
async function mostrarCandidatos(cargo) {
  for (const b of document.querySelectorAll('#abas button')) b.classList.toggle('ativa', b.dataset.cargo === cargo);
  $('#verdade').textContent = cargosInfo[cargo]?.verdade ?? '';
  $('#erroContratar').textContent = '';
  $('#candidatos').innerHTML = '<div class="vazio">Chamando candidatos…</div>';
  try {
    const { candidatos } = await api('GET', `/candidatos?cargo=${cargo}`);
    $('#candidatos').innerHTML = candidatos.map((c, i) => `<div class="candidato">
        <canvas width="12" height="16" data-i="${i}"></canvas>
        <div class="nome">${esc(c.nome)}</div>
        <div class="vazio">${esc(c.titulo)} · ${esc(c.modelo)}</div>
        <div class="pers">“${esc(c.personalidade)}”</div>
        <button data-nome="${esc(c.nome)}" data-cargo="${cargo}">Contratar</button></div>`).join('');
    candidatos.forEach((c, i) => retrato(document.querySelector(`#candidatos canvas[data-i="${i}"]`), slugJs(c.nome), c.modelo));
  } catch (err) {
    $('#candidatos').innerHTML = '';
    $('#erroContratar').textContent = err.message;
  }
}
$('#btnContratar').addEventListener('click', () => {
  montarAbas();
  $('#contratacao').hidden = false;
  mostrarCandidatos('pleno');
});
$('#abas').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cargo]');
  if (b) mostrarCandidatos(b.dataset.cargo);
});
$('#candidatos').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-nome]');
  if (!b) return;
  b.disabled = true;
  try {
    await api('POST', '/contratar', { nome: b.dataset.nome, cargo: b.dataset.cargo });
    $('#contratacao').hidden = true;
  } catch (err) {
    b.disabled = false;
    $('#erroContratar').textContent = err.message;
  }
});

// ---------- painel ----------
function hora(ev) {
  return new Date(ev.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function resumoEvento(ev) {
  switch (ev.tipo) {
    case 'sessao_iniciada': return ev.conversa ? '🗣️ conversando' : `🚪 começou: "${curto(ev.tarefa, 90)}"`;
    case 'cli_pronta': return `💻 ligou o computador (${ev.modelo})`;
    case 'texto': return `💬 ${curto(ev.texto, 140)}`;
    case 'ferramenta_chamada': return `🔧 ${ev.ferramenta}: ${curto(ev.resumo, 100)}`;
    case 'ferramenta_resultado': return `${ev.erro ? '❌' : '📎'} ${curto(ev.resumo, 100)}`;
    case 'permissao_pedida': return `✋ pediu: ${ev.ferramenta}: ${curto(ev.resumo, 90)}`;
    case 'permissao_respondida': return `${ev.aprovada ? '✅' : '⛔'} ${ev.motivo}`;
    case 'cota': return `⏱️ cota ${ev.status} (${ev.janela ?? '?'}, ${Math.round((ev.uso ?? 0) * 100)}%)`;
    case 'compactacao': return `🚻 compactou a memória: ${ev.tokensAntes} → ${ev.tokensDepois ?? '?'} tokens`;
    case 'tarefa_terminada': return `🏁 ${ev.sucesso ? 'terminou' : 'falhou'}: ${ev.turnos} turnos, ${(ev.duracaoMs / 1000).toFixed(1)}s, US$ ${ev.custoUsd?.toFixed(4)}`;
    case 'erro': return `💥 erro: ${ev.mensagem}`;
    case 'mensagem': return `🗨️ ${nomeDe(ev.de)} → ${nomeDe(ev.para)}: ${curto(ev.texto, 100)}`;
    case 'equipe': return `👥 ${ev.motivo}`;
    case 'contratacao_pedida': return `📋 ${nomeDe(ev.pedidoPor)} pediu: ${TITULOS[ev.cargo] ?? ev.cargo}: ${curto(ev.motivo, 90)}`;
    case 'contratacao_respondida': return `🤝 contratação ${ev.aprovada ? `aprovada: ${ev.contratado}` : 'negada'}`;
    case 'tarefa_delegada': return `📌 ${nomeDe(ev.de)} → ${nomeDe(ev.para)}${ev.local && ev.local !== ev.para ? ` (na mesa de ${nomeDe(ev.local)})` : ''}: ${curto(ev.tarefa, 100)}`;
    case 'integracao': return `🔀 ${ev.ok ? '' : 'FALHOU: '}${ev.mensagem}`;
    case 'expediente': return `🏢 expediente ${ev.fase}${ev.luzCaiu ? ' (a luz caiu ontem)' : ''}`;
    case 'humor': return `🙂 ${nomeDe(ev.funcionario)}: humor ${ev.humor} (${ev.motivo})`;
    case 'almoco': return ev.ate ? `🍽️ almoço até ${horaCurta(ev.ate)} (cota)` : '🍽️ voltaram do almoço';
    case 'agenda': return `📰 jornal do dia: ${ev.agenda.jornal.length} notícias`;
    case 'aniversario': return `🎂 aniversário de ${nomeDe(ev.funcionario)}`;
    case 'cofre': return `🗄️ desfeito: ${ev.assunto}`;
    case 'config': return `⚙️ internet ${ev.internet ? 'ligada' : 'desligada'}; aprovação automática ${ev.aprovarTudo ? 'ligada' : 'desligada'}`;
    default: return ev.tipo;
  }
}
function itemFeed(ev, id) {
  const quem = id ? `<b>${esc(nomeDe(id))}</b> ` : '';
  return `<details data-n="${ev._n}"${abertos.has(ev._n) ? ' open' : ''}><summary><span class="hora">${hora(ev)}</span> ${quem}${esc(resumoEvento(ev))}</summary><pre>${esc(JSON.stringify({ ...ev, _n: undefined }, null, 2))}</pre></details>`;
}
const corHumor = (h) => (h >= 65 ? '#5fc27e' : h >= 35 ? '#f2b84b' : '#e5675f');
const statusDe = (p) => (p.ferias ? 'de férias 🏖️' : p.ocupado ? p.descricao : p.visivel ? `livre · ${p.descricao}` : p.descricao);

// O que muda sozinho (relógio, status) sem redesenhar o painel todo.
function atualizarVivos() {
  const d = new Date();
  $('#relogio').textContent = `🕒 ${d.toLocaleDateString('pt-BR', { weekday: 'short' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  const n = [...personagens.values()].filter((p) => p.ocupado && !p.ehVoce).length;
  $('#trabalhando').textContent = `${n} trabalhando`;
  if (maquina) {
    $('#temperatura').hidden = false;
    $('#temperatura').textContent = `🌡️ ${maquina.temperatura}°C · CPU ${Math.round(maquina.carga * 100)}%`;
    $('#temperatura').className = `pilula ${maquina.temperatura >= 28 ? 'off' : ''}`;
  }
  if (ultimaCota) {
    const c = $('#cota');
    c.hidden = false;
    c.textContent = `cota ${ultimaCota.janela === 'five_hour' ? '5h' : ultimaCota.janela === 'seven_day' ? '7 dias' : ultimaCota.janela ?? ''} ${Math.round((ultimaCota.uso ?? 0) * 100)}%`;
    c.className = `pilula ${ultimaCota.status === 'allowed' ? 'on' : 'off'}`;
  }
  $('#almoco').hidden = !almocoAte;
  if (almocoAte) $('#almoco').textContent = `🍽️ almoço até ${horaCurta(almocoAte)}`;
  $('#btnSom').textContent = somLigado ? '🔊 som' : '🔇 som';
  for (const el of document.querySelectorAll('.membro .det[data-id]')) {
    const p = personagens.get(el.dataset.id);
    if (p) el.textContent = `${tituloDe(p)} · ${statusDe(p)}`;
  }
  const fe = $('#fichaEstado');
  if (fe && selecionado) fe.textContent = statusDe(selecionado);
  renderizarChat();
}

function atualizarPainel() {
  if (document.activeElement?.id === 'fDireta') return renderizarChat();
  atualizarVivos();
  if (projeto) $('#projetoNome').textContent = `Projeto: ${projeto.nome} · ${projeto.pasta}`;

  const ps = [...pedidos.values()];
  const cs = [...contratacoes.values()];
  $('#secPedidos').hidden = !ps.length && !cs.length;
  $('#pedidos').innerHTML =
    cs.map((e) => `<div class="pedido"><b>${esc(nomeDe(e.pedidoPor))}</b> pede para contratar: <b>${esc(TITULOS[e.cargo] ?? e.cargo)}</b>
        <p>${esc(e.motivo)}</p>
        <div class="linha"><button data-tipo="contratacao" data-id="${e.idPedido}" data-aprovar="1">Contratar</button>
        <button class="neutro" data-tipo="contratacao" data-id="${e.idPedido}" data-aprovar="0">Agora não</button></div></div>`).join('') +
    ps.map((e) => `<div class="pedido"><b>${esc(nomeDe(sessaoParaId.get(e.sessao)))}</b> quer usar <b>${esc(e.ferramenta)}</b>
        <code>${esc(e.resumo)}</code>
        <div class="linha"><button data-id="${e.idPedido}" data-aprovar="1">Aprovar</button>
        <button class="neutro" data-id="${e.idPedido}" data-aprovar="0">Negar</button></div></div>`).join('');

  const membros = [...personagens.values()].filter((p) => !p.ehVoce && p.cargo);
  $('#equipe').innerHTML = membros.length
    ? membros.map((p) => `<div class="membro${p === selecionado ? ' sel' : ''}${p.ferias ? ' ferias' : ''}" data-id="${esc(p.id)}">
        <span class="ponto" style="background:${corDoModelo(p.modelo)}"></span>
        <div class="info"><div class="nome">${esc(p.nome)}${p.cargo === 'chefe' ? ' ★' : ''}${aniversariantes.has(p.id) ? ' 🎂' : ''}</div>
        <div class="det" data-id="${esc(p.id)}">${esc(tituloDe(p))} · ${esc(statusDe(p))}</div>
        <div class="humorbarra" title="humor ${p.humor}"><div style="width:${p.humor}%;background:${corHumor(p.humor)}"></div></div></div></div>`).join('')
    : '<div class="vazio">Ninguém ainda.</div>';

  const ficha = $('#ficha');
  if (selecionado && !selecionado.ehVoce && personagens.has(selecionado.id)) {
    const p = selecionado;
    ficha.hidden = false;
    ficha.innerHTML = `<div class="topo"><span class="nome"><span class="ponto" style="background:${corDoModelo(p.modelo)}"></span>${esc(p.nome)}</span>
      <button class="neutro pequeno" id="fecharFicha">fechar</button></div>
      <dl><dt>Cargo</dt><dd>${esc(tituloDe(p))} (${esc(p.modelo)})</dd>
      ${p.personalidade ? `<dt>Jeito</dt><dd>${esc(p.personalidade)}</dd>` : ''}
      <dt>Humor</dt><dd><div class="humorbarra"><div style="width:${p.humor}%;background:${corHumor(p.humor)}"></div></div>${p.humor >= 65 ? 'animado' : p.humor >= 35 ? 'normal' : 'chateado'} (${p.humor})</dd>
      ${p.aniversario ? `<dt>Aniversário</dt><dd>${p.aniversario.split('-').reverse().join('/')}</dd>` : ''}
      <dt>Agora</dt><dd id="fichaEstado">${esc(statusDe(p))}</dd>
      ${p.tarefa ? `<dt>Última tarefa</dt><dd>${esc(curto(p.tarefa, 240))}</dd>` : ''}
      ${p.branch ? `<dt>Mesa</dt><dd>${esc(p.branch)}</dd>` : ''}</dl>
      <div class="acoes">
        <button class="neutro pequeno" data-acao="conversar">🗣️ conversar</button>
        ${p.mesa ? '<button class="neutro pequeno" data-acao="tela">🖥️ ver a tela</button>' : ''}
        <button class="neutro pequeno" data-acao="elogiar">👏 elogiar</button>
        <button class="neutro pequeno" data-acao="bronca">😠 bronca</button>
        ${p.cargo !== 'chefe' ? `<button class="neutro pequeno" data-acao="ferias">${p.ferias ? '🏢 voltar das férias' : '🏖️ dar férias'}</button>
        <button class="perigo pequeno" data-acao="demitir">desligar</button>` : ''}
      </div>
      ${p.cargo && p.cargo !== 'chefe' && !p.ferias ? `<details><summary>Dar uma tarefa direto (sem passar pelo chefe)</summary>
        <form id="formDireta"><textarea id="fDireta" required placeholder="O que ${esc(p.nome)} deve fazer?"></textarea>
        <button type="submit" style="margin-top:6px">Entregar tarefa</button><div class="erro" id="erroDireta"></div></form></details>` : ''}
      <details><summary>Log técnico</summary><div class="feed">${p.eventos.slice(-150).reverse().map((e) => itemFeed(e)).join('') || '<div class="vazio">Nada ainda.</div>'}</div></details>`;
    $('#fecharFicha').onclick = () => { selecionado = null; atualizarPainel(); };
    ficha.querySelector('.acoes').onclick = async (e) => {
      const a = e.target.closest('[data-acao]')?.dataset.acao;
      if (!a) return;
      try {
        if (a === 'conversar') { definirInterlocutor(p.id); $('#fMsg').focus(); }
        if (a === 'tela') abrirTelaDele(p);
        if (a === 'elogiar' || a === 'bronca') await api('POST', `/funcionarios/${p.id}/${a}`);
        if (a === 'ferias') await api('POST', `/funcionarios/${p.id}/ferias`, { ferias: !p.ferias });
        if (a === 'demitir' && confirm(`Desligar ${p.nome}? O trabalho continua guardado na branch mesa/${p.id}.`)) {
          await api('POST', `/funcionarios/${p.id}/demitir`);
          selecionado = null;
        }
      } catch (err) {
        alert(err.message);
      }
    };
    $('#formDireta')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', `/funcionarios/${encodeURIComponent(p.id)}/tarefa`, { tarefa: $('#fDireta').value });
        $('#fDireta').value = '';
      } catch (err) {
        $('#erroDireta').textContent = err.message;
      }
    });
  } else ficha.hidden = true;

  $('#feed').innerHTML = feedGeral.slice(-80).reverse().map(({ ev, id }) => itemFeed(ev, id)).join('') || '<div class="vazio">Nada ainda.</div>';
}
$('#equipe').addEventListener('click', (e) => {
  const m = e.target.closest('.membro');
  if (!m) return;
  selecionado = personagens.get(m.dataset.id) ?? null;
  atualizarPainel();
});
document.querySelector('aside').addEventListener('toggle', (e) => {
  const n = Number(e.target.dataset?.n);
  if (Number.isNaN(n)) return;
  if (e.target.open) abertos.add(n);
  else abertos.delete(n);
}, true);

// ---------- primeira abertura: conta e projeto ----------
function passo(id) {
  for (const p of ['bvVerificando', 'bvLogado', 'bvEntrar', 'bvCodigo']) $(`#${p}`).hidden = p !== id;
}
async function verificarConta() {
  passo('bvVerificando');
  const c = await api('GET', '/conta');
  if (c.logado) {
    $('#bvEmail').textContent = c.email ? `: ${c.email}` : '';
    passo('bvLogado');
  } else passo('bvEntrar');
  return c;
}
function irParaProjeto() {
  $('#bvConta').hidden = true;
  $('#bvProjeto').hidden = false;
  $('#pNome').focus();
}
$('#bvContinuar').addEventListener('click', irParaProjeto);
$('#bvOutra').addEventListener('click', () => entrar());
$('#btnEntrar').addEventListener('click', () => entrar());
let esperandoLogin = null;
async function entrar() {
  $('#loginErro').textContent = '';
  try {
    const r = await api('POST', '/conta/entrar');
    if (!r.url) throw new Error(r.saida?.trim() || 'o Claude Code não respondeu');
    $('#loginLink').href = r.url;
    passo('bvCodigo');
    $('#fCodigo').focus();
    clearInterval(esperandoLogin);
    esperandoLogin = setInterval(async () => {
      const c = await api('GET', '/conta').catch(() => ({}));
      if (c.logado) loginConcluido();
    }, 3000);
  } catch (err) {
    $('#loginErro').textContent = err.message;
  }
}
$('#formCodigo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = e.submitter;
  botao.disabled = true;
  $('#loginErro').textContent = '';
  try {
    const r = await api('POST', '/conta/codigo', { codigo: $('#fCodigo').value });
    if (r.logado) loginConcluido();
    else $('#loginErro').textContent = r.saida || 'não deu certo; tente de novo';
  } catch (err) {
    $('#loginErro').textContent = err.message;
    passo('bvEntrar');
  } finally {
    botao.disabled = false;
  }
});
function loginConcluido() {
  clearInterval(esperandoLogin);
  if (projeto) $('#boasvindas').hidden = true;
  else irParaProjeto();
}
$('#bvProjeto').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = e.submitter;
  botao.disabled = true;
  $('#bvErro').textContent = '';
  try {
    const estado = await api('POST', '/boas-vindas', { nome: $('#pNome').value, descricao: $('#pDesc').value, pasta: $('#pPasta').value || undefined });
    aplicarEstado(estado);
    $('#boasvindas').hidden = true;
    if (!lembrar('ajudaVista')) {
      guardar('ajudaVista', '1');
      // Depois da primeira manhã (chegada + daily), se você ainda não se mexeu.
      const inicio = { ...voce.pos };
      setTimeout(() => { if (!modalAberto() && Math.hypot(voce.pos.x - inicio.x, voce.pos.y - inicio.y) < 2) abrirAjuda(); }, 38000);
    }
  } catch (err) {
    $('#bvErro').textContent = err.message;
  } finally {
    botao.disabled = false;
  }
});

function aplicarEstado(estado) {
  projeto = estado.projeto ?? null;
  cargosInfo = estado.cargos ?? {};
  equipeInfo = estado.equipe ?? [];
  internet = estado.internet ?? true;
  aprovarTudo = Boolean(estado.aprovarTudo);
  $('#fAuto').checked = aprovarTudo;
  agenda = estado.agenda ?? agenda;
  almocoAte = estado.almocoAte ?? null;
  diario = estado.diario ?? diario;
  if (estado.maquina) maquina = { ...estado.maquina };
  for (const [id, lista] of Object.entries(estado.conversas ?? {})) {
    conversas[id] ??= [];
    for (const m of lista) if (!conversas[id].some((x) => x.em === m.em && x.de === m.de)) conversas[id].push(m);
    conversas[id].sort((a, b) => a.em.localeCompare(b.em));
  }
  for (const c of estado.contratacoes ?? []) {
    if (!contratacoes.has(c.id)) contratacoes.set(c.id, { tipo: 'contratacao_pedida', idPedido: c.id, cargo: c.cargo, motivo: c.motivo, pedidoPor: c.pedidoPor });
  }
  const md = `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  for (const f of equipeInfo) if (f.aniversario === md && !f.ferias) aniversariantes.add(f.id);
  atualizarPainel();
}

async function iniciar() {
  const estado = await api('GET', '/estado');
  aplicarEstado(estado);
  if (!estado.boasVindas) {
    $('#boasvindas').hidden = false;
    await verificarConta();
  } else {
    const c = await api('GET', '/conta').catch(() => ({ logado: true }));
    if (!c.logado) {
      $('#boasvindas').hidden = false;
      passo('bvEntrar');
    }
  }
}

// ---------- início ----------
redimensionar();
conectar();
iniciar().catch((err) => console.error(err));
tela.focus();
requestAnimationFrame(quadro);
// para testes automatizados
window.escritorio = { personagens, pedidos, contratacoes, conversas, voce, maisProximo, interagir: () => interagir(maisProximo()), irPara: (x, y) => voce.irPara({ x, y }, performance.now()) };
