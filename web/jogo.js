// A tela do escritório: o mundo em pixel art, o seu personagem (você anda,
// conversa e senta nos computadores), a vida da equipe, a caixa de diálogo,
// o computador e o painel.
//
// Trabalho é real, vida é livre: o que um funcionário faz de trabalho vem de
// eventos reais do cérebro (comportamento.js). Quando não está trabalhando, ele
// vive: bebedouro, sofá, janela, conversa — e isso nunca atrapalha o trabalho.

import {
  TILE as T, MESAS, OBJETOS, LUGARES, SOFA,
  caminho, vizinhoLivre, bloqueado, comportamento, lugarDaAcao, curto, TRABALHO,
} from './comportamento.js';
import { W, H, desenharMundo, corDoModelo } from './desenho.js';
import { desenharRetrato } from './retrato.js';

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
const naoLidas = {}; // id → quantas mensagens novas
const aniversariantes = new Set();
const pensandoCom = new Set();
const feedGeral = [];
const abertos = new Set();
let contador = 0;
let equipeInfo = [];
let projeto = null;
let escritorio = null;
let fase = 'operando';
let relatorio = {};
let recomendacao = [];
let areas = [];
let cargosInfo = {};
let agenda = null;
let internet = true;
let aprovarTudo = false;
let vozConfigurada = false;
let maquina = null;
let ultimaCota = null;
let almocoAte = null;
let diario = [];
let faseDia = 'aberto'; // expediente: aberto | encerrando | encerrado
let luz = 1;
let luzAlvo = 1;
let selecionado = null;
let reconstruindo = true;
let somLigado = lembrar('som') !== 'nao';
let telaAbertaDe = null;

const temperatura = () => maquina?.temperatura ?? 23;

// ---------- aparência ----------
function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
const PELES = ['#f6d4bb', '#f1c7a5', '#e0ac85', '#c68863', '#9d6644', '#6f4630'];
const CABELOS = ['#2b1d16', '#5a3620', '#a8692e', '#d9b25c', '#1d1d24', '#8c2f2a', '#8a8a96', '#3b2a4f', '#c9c2b5'];
const tituloDe = (p) => p.titulo || cargosInfo[p.cargo]?.titulo || (p.cargo === 'chefe' ? 'Chefe' : p.cargo) || '';
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
    this.ehVoce = id === 'voce';
    this.mesa = this.ehVoce ? null : MESAS[indiceMesa % MESAS.length];
    this.atualizarInfo(info);
    const h = hash(id);
    this.pele = PELES[h % PELES.length];
    this.cabelo = CABELOS[(h >>> 4) % CABELOS.length];
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
    this.local = null;
    this.eventos = [];
    this.passos = 0;
    this.chegarEm = 0;
    this.saudacao = '';
    this.proximaVida = performance.now() + 8000 + Math.random() * 20000;
    this.ocupadoAte = 0;
    this.roteiro = [];
    this.noSofa = false;
    this.celular = false;
    this.comCafe = 0;
    this.mesaSentada = null;
    this.noComputador = false;
    this.aoChegarFn = null;
  }

  atualizarInfo(f) {
    this.nome = f.nome ?? this.nome ?? this.id;
    this.cargo = f.cargo ?? this.cargo ?? '';
    this.modelo = f.modelo ?? this.modelo ?? '';
    this.personalidade = f.personalidade ?? this.personalidade ?? '';
    this.humor = f.humor ?? this.humor ?? 70;
    this.aniversario = f.aniversario ?? this.aniversario ?? '';
    this.ferias = Boolean(f.ferias ?? this.ferias);
    this.genero = f.genero ?? this.genero;
    this.ficha = f.ficha ?? this.ficha;
    this.titulo = f.titulo ?? this.titulo;
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
    if (pensandoCom.has(this.id)) return 'pensando com calma';
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
    if (r.fala && !instantaneo) this.falar(r.fala, agora, undefined, false);
    if (r.acao) {
      let acao = r.acao;
      if (instantaneo && r.terminou && acao === 'entregando') acao = 'ocioso';
      if (this.local && lugarDaAcao(acao) === 'mesa' && acao !== 'ocioso') acao = 'visitando';
      this.desejo = { acao, fixo: !!r.fixo && !(instantaneo && r.terminou) };
    }
    if (r.terminou) {
      this.ocupado = false;
      this.local = null;
    }
    if (instantaneo && this.desejo) this.aplicar(this.desejo, true, agora);
  }

  // comVoz: fala de verdade (mensagem completa); balões de trabalho e vida
  // curtinha não precisam de voz.
  falar(texto, agora = performance.now(), ms, comVoz = true) {
    if (!texto) return;
    this.fala = { texto, ate: agora + (ms ?? Math.max(3500, texto.length * 70)) };
    if (comVoz) falarEmVoz(this, texto);
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
    if (a === 'reuniao') this.dir = this.cargo === 'chefe' ? 'right' : this.tile.y <= 3 ? 'down' : this.tile.x <= 22 ? 'right' : this.tile.x >= 28 ? 'left' : 'up';
    if (a === 'sofa') this.noSofa = true;
    if (a === 'planta') this.dir = this.tile.x >= 22 ? 'down' : 'left';
    if (['banheiro', 'almoco', 'saindo', 'ferias'].includes(a)) this.visivel = false;
    this.celular = this.cargo === 'ti' && a === 'ocioso';
  }

  atualizar(dt, agora) {
    if (this.chegarEm && agora >= this.chegarEm) {
      this.chegarEm = 0;
      if (!this.desejo) this.desejo = { acao: 'ocioso', fixo: false };
      if (this.saudacao) this.falar(this.saudacao, agora, 4000, false);
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
    if (this.roteiro.length && agora >= this.roteiro[0].em) this.falar(this.roteiro.shift().texto, agora, undefined, false);
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
  const livre = (nx, ny) => [-4, 4].every((ox) => !bloqueado(Math.floor((nx + ox) / T), Math.floor((ny - 1) / T)));
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
    const trabalhandoNela = dono && dono.visivel && dono.sentado && dono.ocupado;
    lista.push({ tipo: 'mesa', alvo: m, dono, pos: centro(m.assento), rotulo: trabalhandoNela ? `ver a tela de ${dono.nome}` : dono ? `usar o computador de ${dono.nome}` : 'usar um computador vago' });
  }
  const obj = (tipo, rotulo, spot) => lista.push({ tipo, pos: centro(spot), rotulo, spot });
  obj('minhaMesa', 'sentar no seu computador', LUGARES.gestor);
  obj('cofre', 'abrir o cofre (histórico, desfazer)', LUGARES.cofre);
  obj('wifi', 'Wi-Fi do escritório', LUGARES.roteador);
  obj('ar', 'ar-condicionado (temperatura)', LUGARES.arCondicionado);
  obj('tv', 'ver o jornal do dia', { x: 24, y: 12 });
  obj('estante', 'ler o diário e o relatório', { x: 2, y: 3 });
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
    if (d < dist) { dist = d; melhor = i; }
  }
  return melhor;
}

function interagir(i) {
  if (!i) return;
  const agora = performance.now();
  switch (i.tipo) {
    case 'pessoa': return abrirDialogo(i.alvo);
    case 'mesa': {
      const { alvo: m, dono } = i;
      if (dono && dono.visivel && dono.sentado && dono.ocupado) return abrirTelaDele(dono);
      sentar(m.assento, m, () => abrirComputador(dono ? dono.id : 'voce', dono ? `Computador de ${dono.nome}` : 'Seu computador (mesa de trabalho)'));
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
      voce.falar(temperatura() >= 28 ? 'Café com esse calor… mas vamos.' : 'Hmm, café.', agora, 2500, false);
      break;
    case 'bebedouro':
      voce.falar('Água geladinha.', agora, 2200, false);
      break;
    case 'sofa':
      voce.irPara({ x: 24, y: 15 }, agora, () => { voce.dir = 'up'; });
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
    if ((ty === m.y || ty === m.y - 1 || (ty === m.assento.y && tx === m.assento.x)) && tx >= m.x && tx <= m.x + 1) return interativos().find((i) => i.tipo === 'mesa' && i.alvo === m);
  }
  const dentro = (o) => tx >= o.x && tx < o.x + o.w && ty >= o.y - 1 && ty < o.y + o.h;
  const mapa = [['cofre', 'cofre'], ['roteador', 'wifi'], ['arCondicionado', 'ar'], ['tv', 'tv'], ['estante', 'estante'], ['balcaoCafe', 'cafe'], ['bebedouro', 'bebedouro'], ['mesaGestor', 'minhaMesa']];
  for (const [k, tipo] of mapa) if (dentro(OBJETOS[k])) return interativos().find((i) => i.tipo === tipo);
  if (tx === LUGARES.gestor.x && ty === LUGARES.gestor.y) return interativos().find((i) => i.tipo === 'minhaMesa');
  if (ty === SOFA.y && tx >= SOFA.x && tx < SOFA.x + SOFA.w) return interativos().find((i) => i.tipo === 'sofa');
  if (tx === LUGARES.porta.x && ty === LUGARES.porta.y) return interativos().find((i) => i.tipo === 'porta');
  return null;
}

// ---------- a vida no escritório ----------
// Cada um vive a própria vida: as falas vêm da ficha pessoal (família, pet,
// hobbies, time…), da agenda do dia e do que acontece no escritório.
function falasDaFicha(p) {
  const f = p.ficha;
  if (!f) return [];
  const l = [
    `Ontem fui de ${f.hobbies[0]}, tô moído.`,
    `Saudade de ${f.comida}.`,
    `Tô ouvindo muito ${f.musica} ultimamente.`,
    f.pet.startsWith('nenhum') ? 'Ainda quero adotar um cachorro…' : `Preciso mostrar a foto do meu bichinho: ${f.pet.replace(/^(um|uma|dois) /, '')}.`,
    `Lá em ${f.cidade} é diferente, viu.`,
  ];
  if (f.time !== 'não liga para futebol') l.push(`E o ${f.time}, hein?`, `Viram o jogo do ${f.time}?`);
  if (f.hobbies[1]) l.push(`Fim de semana tem ${f.hobbies[1]}!`);
  return l;
}
const FALAS_CARGO = {
  junior: ['Aprendi um atalho novo!', 'Será que eu dou conta sozinho?'],
  ti: ['Já tentou desligar e ligar?', 'Não é a rede. Nunca é a rede.'],
  qa: ['E se o usuário clicar duas vezes?'],
  designer: ['Esse botão tá 2 pixels torto.'],
  advogado: ['Prazo é prazo.'],
  chefe: ['Bom trabalho, pessoal.', 'Alguém precisa de ajuda?'],
};
function falasDe(p) {
  if ((p.humor ?? 70) <= 35) return ['Hmm.', '…', 'Tá.', 'Vou só fazer o meu.'];
  const l = [...(agenda?.falas?.[p.id] ?? []), ...falasDaFicha(p), ...(FALAS_CARGO[p.cargo] ?? []), 'Que semana, hein.', 'Preciso de mais água.'];
  const d = new Date();
  if (d.getDay() === 5) l.push('Sexta-feira, finalmente!');
  if (d.getDay() === 1) l.push('Segunda… mais um café.');
  if (temperatura() >= 28) l.push('Que calor! Alguém liga o ar?');
  if (agenda?.jornal?.length) l.push(`Viu essa? ${curto(aleatorio(agenda.jornal).titulo, 70)}`);
  return l;
}
function fofoca() {
  const hojeISO = new Date().toISOString().slice(0, 10);
  const opcoes = [];
  for (const d of diario.filter((x) => x.data === hojeISO && x.texto.startsWith('Entregou')).slice(-5)) opcoes.push(`Ouvi dizer que ${nomeDe(d.quem)} entregou: ${curto(d.texto.replace(/^Entregou: /, ''), 50)}`);
  for (const p of personagens.values()) if (p.ocupado && !p.ehVoce && p.cargo !== 'chefe') opcoes.push(`${p.nome} tá no meio de uma tarefa daquelas.`);
  for (const p of personagens.values()) if (!p.ehVoce && p.cargo && (p.humor ?? 70) < 35) opcoes.push(`Acho que ${p.nome} não tá num dia bom…`);
  return opcoes.length ? aleatorio(opcoes) : null;
}
function livreParaViver(p, agora) {
  return !p.ehVoce && p.cargo && p.visivel && !p.ferias && !p.ocupado && !TRABALHO.has(p.acao) && !p.fixo && p.ocupadoAte < agora && !p.chegarEm && faseDia === 'aberto' && !almocoAte && p.chegou && dialogoCom !== p.id;
}
function vida(p, agora) {
  if (!livreParaViver(p, agora) || agora < p.proximaVida) return;
  p.proximaVida = agora + 18000 + Math.random() * 40000;
  if (p.acao !== 'ocioso') {
    p.desejo = { acao: 'ocioso', fixo: false };
    return;
  }
  const s = Math.random();
  let atividade;
  if (p.cargo === 'chefe') atividade = s < 0.75 ? 'ocioso' : s < 0.9 ? 'janela' : 'bebedouro';
  else if (s < 0.4) atividade = 'ocioso';
  else if (s < 0.58) atividade = 'bebedouro';
  else if (s < 0.72) atividade = agenda?.jornal?.length ? 'tv' : 'sofa';
  else if (s < 0.8) atividade = 'sofa';
  else if (s < 0.9) atividade = 'janela';
  else atividade = 'planta';
  if (atividade === 'ocioso') {
    if (Math.random() < 0.3) p.falar(aleatorio(falasDe(p)), agora, undefined, false);
    return;
  }
  p.desejo = { acao: atividade, fixo: false };
  if (atividade === 'bebedouro') {
    const colega = [...personagens.values()].find((q) => q !== p && livreParaViver(q, agora) && q.acao === 'ocioso' && Math.random() < 0.6);
    if (colega) {
      colega.desejo = { acao: 'bebedouro', fixo: false };
      colega.proximaVida = p.proximaVida;
      const t0 = agora + 6000;
      p.roteiro = [{ em: t0, texto: aleatorio(falasDe(p)) }, { em: t0 + 8000, texto: fofoca() ?? aleatorio(falasDe(p)) }];
      colega.roteiro = [{ em: t0 + 4000, texto: aleatorio(['Pois é!', 'Nem me fala.', 'Sério?', 'Haha, verdade.']) }, { em: t0 + 12000, texto: aleatorio(falasDe(colega)) }];
      return;
    }
  }
  p.roteiro = [{ em: agora + 5000, texto: aleatorio(falasDe(p)) }];
}

// ---------- expediente na tela ----------
let roteiroDia = [];
function abrirDiaNaTela(ev, instantaneo) {
  faseDia = 'aberto';
  $('#fimDia').hidden = true;
  if (instantaneo) {
    luz = luzAlvo = 1;
    return;
  }
  luz = luzAlvo = 0.12;
  const agora = performance.now();
  const presentes = () => [...personagens.values()].filter((p) => !p.ehVoce && p.cargo && !p.ferias);
  roteiroDia = [
    { em: agora + 3400, f: () => { luzAlvo = 1; } },
    { em: agora + 4200, f: () => entrarVoce(false) },
  ];
  if (fase === 'entrevista') {
    // Primeiro dia: o chefe vem até você para começar a conversa.
    roteiroDia.push({ em: agora + 9000, f: () => { const c = presentes().find((p) => p.cargo === 'chefe'); if (c && !dialogoCom) abrirDialogo(c, true); } });
  } else {
    roteiroDia.push(
      { em: agora + 15000, f: () => { if (presentes().length >= 2) for (const p of presentes()) if (!p.ocupado) { p.desejo = { acao: 'reuniao', fixo: false }; p.ocupadoAte = performance.now() + 22000; } } },
      { em: agora + 22000, f: () => { const c = presentes().find((p) => p.cargo === 'chefe'); if (presentes().length >= 2 && c) c.falar(ev.daily ?? 'Bom dia, pessoal!', performance.now(), 8000, false); } },
      { em: agora + 32000, f: () => { for (const p of presentes()) if (p.acao === 'reuniao') p.desejo = { acao: 'ocioso', fixo: false }; } },
    );
  }
  roteiroDia.sort((a, b) => a.em - b.em);
}

function encerrarDiaNaTela(ev, instantaneo) {
  if (ev.fase === 'encerrando') {
    faseDia = 'encerrando';
    fecharDialogo();
    if (instantaneo) return;
    let i = 0;
    for (const p of personagens.values()) {
      if (p.ehVoce || p.cargo === 'chefe' || !p.visivel) continue;
      setTimeout(() => { p.falar(aleatorio(['Até amanhã!', 'Tchau, pessoal!', 'Fui!', 'Commit feito, até amanhã.']), performance.now(), 2500, false); p.desejo = { acao: 'saindo', fixo: true }; }, 400 + i++ * 900);
    }
    return;
  }
  faseDia = 'encerrado';
  const chefe = [...personagens.values()].find((p) => p.cargo === 'chefe');
  if (instantaneo) {
    luz = luzAlvo = 0.12;
    for (const p of personagens.values()) if (!p.ehVoce) p.visivel = false;
  } else {
    chefe?.falar(ev.resumo, performance.now(), 6000, false);
    setTimeout(() => { if (chefe) chefe.desejo = { acao: 'saindo', fixo: true }; }, 5000);
    setTimeout(() => { luzAlvo = 0.12; }, 6500);
  }
  $('#fimResumo').textContent = ev.resumo ?? '';
  setTimeout(() => { if (faseDia === 'encerrado') $('#fimDia').hidden = false; }, instantaneo ? 0 : 7500);
}

async function encerrarDia() {
  if (faseDia !== 'aberto') return;
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
    else { p.desejo = { acao: 'saindo', fixo: true }; setTimeout(() => personagens.delete(p.id), 12000); }
  }
  const ordem = [...ev.equipe].sort((a, b) => (a.cargo === 'chefe' ? -1 : b.cargo === 'chefe' ? 1 : 0));
  for (const f of ordem) {
    const i = ev.equipe.indexOf(f);
    let p = personagens.get(f.id);
    const novo = !p;
    if (!p) { p = new Personagem(f.id, f, i); personagens.set(f.id, p); }
    const voltou = p.ferias && !f.ferias;
    const saiu = !p.ferias && f.ferias;
    p.atualizarInfo(f);
    if (f.ferias) {
      if (saiu && !instantaneo) { p.falar('Férias! 🏖️ Até a volta!', agora, undefined, false); p.desejo = { acao: 'ferias', fixo: true }; }
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
        if (ev.de !== 'voce' && !instantaneo) aoReceberMensagem(ev, agora);
        break;
      }
      case 'fala_parcial': aoFalaParcial(ev, agora); return; // ao vivo, sem histórico
      case 'pensando':
        if (ev.ate) pensandoCom.delete(ev.funcionario);
        else pensandoCom.add(ev.funcionario);
        if (dialogoCom === ev.funcionario) atualizarStatusDialogo();
        if (!ev.ate && !instantaneo) personagens.get(ev.funcionario)?.falar('🧠 deixa eu ver direitinho…', agora, 4000, false);
        break;
      case 'relatorio': relatorio = ev.secoes; break;
      case 'recomendacao':
        recomendacao = ev.itens;
        if (!instantaneo) setTimeout(() => abrirContratacao(), 4500);
        break;
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
        if (!instantaneo && ev.de !== 'voce' && !ev.tarefa.startsWith('(na fila')) personagens.get(ev.de)?.falar(`${nomeDe(ev.para)}, tenho uma tarefa pra você!`, agora, undefined, false);
        break;
      }
      case 'integracao':
        if (!instantaneo && ev.mensagem !== 'nada novo para integrar') personagens.get(ev.funcionario)?.falar(ev.ok ? 'Meu trabalho já está na versão principal.' : 'Ih, deu conflito ao juntar meu trabalho…', agora, undefined, false);
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
          if (!instantaneo && ev.motivo === 'elogio do gestor' && dialogoCom !== p.id) p.falar(aleatorio(['Valeu! 😊', 'Obrigado!', 'Ah, que bom ouvir isso!']), agora, undefined, false);
          if (!instantaneo && antes >= 35 && ev.humor < 35) notificar(`${p.nome} está chateado(a).`);
        }
        break;
      }
      case 'almoco':
        almocoAte = ev.ate;
        if (!instantaneo) for (const p of personagens.values()) {
          if (p.ehVoce || !p.cargo || p.ferias || p.ocupado) continue;
          if (ev.ate) { p.falar(`Almoço! Volto às ${horaCurta(ev.ate)}.`, agora, undefined, false); p.desejo = { acao: 'almoco', fixo: true }; }
          else { p.saudacao = 'Voltei do almoço!'; p.chegarEm = agora + 500 + Math.random() * 4000; }
        }
        break;
      case 'agenda': agenda = ev.agenda; break;
      case 'aniversario':
        aniversariantes.add(ev.funcionario);
        if (!instantaneo) setTimeout(() => { for (const p of personagens.values()) if (!p.ehVoce && p.cargo && p.id !== ev.funcionario && p.visivel) p.roteiro.push({ em: performance.now() + 2000 + Math.random() * 8000, texto: `Parabéns, ${nomeDe(ev.funcionario)}! 🎂` }); }, 12000);
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

  // eventos de uma sessão de trabalho (ou de uma conversa pensada)
  if (ev.tipo === 'sessao_iniciada') {
    const id = ev.funcionario ?? `sessao-${ev.sessao}`;
    sessaoParaId.set(ev.sessao, id);
    if (ev.conversa) sessaoConversa.add(ev.sessao);
    let p = personagens.get(id);
    if (!p) { p = new Personagem(id, { nome: id, modelo: ev.modelo }, personagens.size); personagens.set(id, p); }
    if (!ev.conversa) Object.assign(p, { branch: ev.branch ?? '', pasta: ev.pasta, tarefa: ev.tarefa });
  }
  if (ev.tipo === 'permissao_pedida') pedidos.set(ev.idPedido, ev);
  if (ev.tipo === 'permissao_respondida') pedidos.delete(ev.idPedido);
  if (ev.tipo === 'cota') ultimaCota = ev;
  const id = sessaoParaId.get(ev.sessao);
  feedGeral.push({ ev, id });
  if (feedGeral.length > 400) feedGeral.shift();
  if (ev.tipo === 'tarefa_terminada' || ev.tipo === 'erro') sessoesFim.add(ev.sessao);
  const p = personagens.get(id);
  if (p) {
    p.eventos.push(ev);
    if (p.eventos.length > 600) p.eventos.splice(0, 200);
    const r = comportamento(ev);
    if (sessaoConversa.has(ev.sessao)) {
      // Conversa pensada (planejar / pensar melhor): não sai do lugar.
      if (ev.tipo === 'permissao_pedida' || ev.tipo === 'permissao_respondida') p.receber(r, instantaneo, agora);
    } else {
      if (ev.tipo === 'texto') r.fala = undefined;
      p.receber(r, instantaneo, agora);
    }
  }
  if (!instantaneo) {
    atualizarPainel();
    if (telaAbertaDe === id) renderizarTelaDele();
  }
}

function aoReceberMensagem(ev, agora) {
  const p = personagens.get(ev.de);
  if (dialogoCom === ev.de) {
    // A fala parcial já mostrou; se veio sem parcial (resposta pensada), digita agora.
    if (falaAtual.idFala === null || falaAtual.alvo !== ev.texto) mostrarFala(ev.texto);
    falarEmVoz(p, ev.texto);
  } else {
    naoLidas[ev.de] = (naoLidas[ev.de] ?? 0) + 1;
    p?.falar(curto(ev.texto, 90), agora, 6000, false);
    notificar(`${nomeDe(ev.de)} quer falar com você: ${curto(ev.texto, 70)}`);
    // Ideia ou recado: a pessoa vem até a sua mesa.
    if (p && !p.ocupado && (ev.texto.startsWith('Ei, tive uma ideia') || p.cargo === 'chefe')) p.desejo = { acao: 'entregando', fixo: true };
  }
}

function conectar() {
  const fonte = new EventSource('/eventos');
  fonte.onopen = () => { $('#conexao').textContent = '● conectado'; $('#conexao').className = 'chip on'; };
  fonte.onerror = () => { $('#conexao').textContent = '● sem conexão com o cérebro'; $('#conexao').className = 'chip off'; };
  fonte.onmessage = (m) => aoEvento(JSON.parse(m.data), reconstruindo);
  fonte.addEventListener('historico_fim', () => {
    reconstruindo = false;
    if (!voce.visivel && faseDia === 'aberto' && !roteiroDia.length) entrarVoce(true);
    atualizarPainel();
  });
}

// ---------- caixa de diálogo (RPG) ----------
let dialogoCom = null;
const falaAtual = { idFala: null, alvo: '', mostrado: 0, falando: false };
let quadroBoca = 0;
let piscarAte = 0;

function abrirDialogo(p, iniciativaDele = false) {
  if (!p || p.ehVoce) return;
  dialogoCom = p.id;
  naoLidas[p.id] = 0;
  selecionado = p;
  $('#dialogo').hidden = false;
  $('#dlgNome').textContent = p.nome;
  $('#dlgCargo').textContent = `${tituloDe(p)}${p.cargo === 'chefe' ? ' ★' : ''}`;
  $('#dlgHistorico').hidden = true;
  // vira para você
  voce.dir = p.pos.x > voce.pos.x + 4 ? 'right' : p.pos.x < voce.pos.x - 4 ? 'left' : p.pos.y > voce.pos.y ? 'down' : 'up';
  if (!p.ocupado && p.chegou) { p.dir = { right: 'left', left: 'right', up: 'down', down: 'up' }[voce.dir]; p.ocupadoAte = performance.now() + 60000; }
  const lista = conversas[p.id] ?? [];
  const ultima = lista[lista.length - 1];
  const recente = ultima && Date.now() - new Date(ultima.em).getTime() < 15 * 60_000;
  if (recente && ultima.de !== 'voce') mostrarFala(ultima.texto, true);
  else if (iniciativaDele && ultima && ultima.de !== 'voce') mostrarFala(ultima.texto);
  else if (p.ferias) mostrarFala('Tô de férias! 🏖️', true);
  else mostrarFala(aleatorio(p.humor <= 35 ? ['Oi.', 'Fala.'] : ['Oi! Pode falar.', 'Opa, tudo bem?', 'Diga!', `Oi! ${p.ocupado ? 'Tô no meio de uma coisa, mas pode falar.' : 'Tô por aqui.'}`]), true);
  atualizarStatusDialogo();
  $('#dlgTexto').value = '';
  setTimeout(() => $('#dlgTexto').focus(), 50);
  atualizarPainel();
}

function fecharDialogo() {
  if (!dialogoCom) return;
  const p = personagens.get(dialogoCom);
  if (p) p.ocupadoAte = performance.now() + 4000;
  dialogoCom = null;
  $('#dialogo').hidden = true;
  tela.focus();
}

// Texto aparecendo como se a pessoa estivesse falando.
function mostrarFala(texto, instantaneo = false, idFala = null) {
  falaAtual.idFala = idFala;
  falaAtual.alvo = texto;
  falaAtual.mostrado = instantaneo ? texto.length : Math.min(falaAtual.mostrado, texto.length);
  if (!idFala) falaAtual.mostrado = instantaneo ? texto.length : 0;
  falaAtual.eu = null;
  renderizarFala();
}

function aoFalaParcial(ev, agora) {
  const p = personagens.get(ev.funcionario);
  if (!p) return;
  if (ev.texto) p.fala = { texto: curto(ev.texto, 120), ate: agora + 6000 };
  if (dialogoCom !== ev.funcionario) return;
  if (falaAtual.idFala !== ev.idFala) {
    falaAtual.idFala = ev.idFala;
    falaAtual.mostrado = 0;
    falaAtual.eu = null;
  }
  falaAtual.alvo = ev.texto;
  if (ev.fim) falaAtual.fim = true;
  atualizarStatusDialogo();
}

function renderizarFala() {
  const el = $('#dlgFala');
  const visivel = falaAtual.alvo.slice(0, falaAtual.mostrado);
  const digitando = falaAtual.mostrado < falaAtual.alvo.length;
  el.innerHTML = `${falaAtual.eu ? `<span class="eu">Você: ${esc(falaAtual.eu)}</span>` : ''}<span class="${digitando ? 'cursor' : ''}">${esc(visivel)}</span>`;
  el.scrollTop = el.scrollHeight;
}

function atualizarStatusDialogo() {
  if (!dialogoCom) return;
  const p = personagens.get(dialogoCom);
  const esperando = falaAtual.eu && !falaAtual.alvo;
  $('#dlgStatus').textContent = pensandoCom.has(dialogoCom) ? '🧠 pensando com calma… a resposta completa vem já já'
    : esperando ? `${p?.nome ?? ''} está pensando…`
    : p?.ocupado ? `(${p.descricao})` : '';
}

function animarDialogo(agora) {
  if (!dialogoCom) return;
  const p = personagens.get(dialogoCom);
  if (!p) return fecharDialogo();
  // digita alguns caracteres por quadro
  if (falaAtual.mostrado < falaAtual.alvo.length) {
    falaAtual.mostrado = Math.min(falaAtual.alvo.length, falaAtual.mostrado + 2);
    renderizarFala();
  }
  const falando = falaAtual.mostrado < falaAtual.alvo.length;
  if (agora > piscarAte + 3800 + (hash(p.id) % 2000)) piscarAte = agora;
  const piscando = agora - piscarAte < 140;
  if (Math.floor(agora / 110) !== quadroBoca) quadroBoca = Math.floor(agora / 110);
  desenharRetrato($('#dlgRetrato'), p, { falando, quadro: quadroBoca, piscando });
}

$('#dlgForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('#dlgTexto').value.trim();
  if (!texto || !dialogoCom) return;
  $('#dlgTexto').value = '';
  falaAtual.eu = texto;
  falaAtual.alvo = '';
  falaAtual.mostrado = 0;
  falaAtual.idFala = 'esperando';
  renderizarFala();
  atualizarStatusDialogo();
  try {
    await api('POST', '/conversar', { para: dialogoCom, texto });
  } catch (err) {
    falaAtual.alvo = `(${err.message})`;
  }
});
$('#dlgFechar').addEventListener('click', fecharDialogo);
$('#dlgVerHist').addEventListener('click', () => {
  const h = $('#dlgHistorico');
  h.hidden = !h.hidden;
  if (!h.hidden) {
    const lista = (conversas[dialogoCom] ?? []).slice(-40);
    h.innerHTML = lista.map((m) => `<p><b>${esc(nomeDe(m.de))}:</b> ${esc(m.texto)}</p>`).join('') || '<p>Nada ainda.</p>';
    h.scrollTop = h.scrollHeight;
  }
});

// ---------- voz ----------
// Vozes da Microsoft (Azure Speech, chave do usuário). Só quem está perto ou
// em conversa com você; o volume cai com a distância.
let audioAtual = null;
function falarEmVoz(p, texto) {
  if (!p || !somLigado || reconstruindo || p.ehVoce || !vozConfigurada) return;
  const d = Math.hypot(p.pos.x - voce.pos.x, p.pos.y - voce.pos.y) / T;
  if (dialogoCom !== p.id && (d > 7 || !p.visivel)) return;
  try {
    if (dialogoCom === p.id) audioAtual?.pause();
    const a = new Audio(`/voz?funcionario=${encodeURIComponent(p.id)}&texto=${encodeURIComponent(texto.slice(0, 600))}`);
    a.volume = dialogoCom === p.id ? 1 : Math.max(0.15, 1 - d / 7);
    a.play().catch(() => {});
    if (dialogoCom === p.id) audioAtual = a;
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
  // O escritório ocupa a janela inteira (sem cortar nada da sala).
  const e = Math.min(window.innerWidth / W, window.innerHeight / H);
  escala = Math.max(0.5, e);
  const dpr = window.devicePixelRatio || 1;
  tela.style.width = `${W * escala}px`;
  tela.style.height = `${H * escala}px`;
  tela.width = Math.round(W * escala * dpr);
  tela.height = Math.round(H * escala * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { redimensionar(); posicionarNavegadorNativo(); });

function quebrar(texto, max) {
  const linhas = [''];
  for (const p of texto.split(' ')) {
    const atual = linhas[linhas.length - 1];
    if ((atual + ' ' + p).trim().length > max && atual) linhas.push(p);
    else linhas[linhas.length - 1] = (atual + ' ' + p).trim();
  }
  if (linhas.length > 3) { linhas.length = 3; linhas[2] = curto(linhas[2], max - 1) + '…'; }
  return linhas;
}

function balao(x, y, texto, cor = '#fffaf0', borda = '#2a2430') {
  const fs = Math.max(11, Math.round(escala * 3.4));
  ctx.font = `${Math.round(fs * 1.3)}px VT323, monospace`;
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
  ctx.font = `${Math.round(fs * 1.3)}px VT323, monospace`;
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
    const nome = p.ehVoce ? 'você' : `${p.nome}${p.cargo === 'chefe' ? ' ★' : ''}${naoLidas[p.id] ? ' 💬' : ''}`;
    etiqueta(p.pos.x * s, (p.pos.y + 3) * s, nome, p.ehVoce ? '#f2b84b' : corDoModelo(p.modelo), p === selecionado);
  }
  for (const p of personagens.values()) {
    if (!p.visivel || p.id === dialogoCom) continue; // quem está no diálogo fala na caixa
    const topo = (p.pos.y - 18) * s;
    const ct = [...contratacoes.values()].find((e) => e.pedidoPor === p.id);
    if (p.chegou && (p.acao === 'pedindo' || (ct && p.acao === 'entregando'))) {
      const pd = [...pedidos.values()].find((e) => sessaoParaId.get(e.sessao) === p.id);
      balao(p.pos.x * s, topo, pd ? `✋ Posso? ${pd.ferramenta}: ${curto(pd.resumo, 48)}` : ct ? `📋 Precisamos contratar: ${curto(ct.motivo, 50)}` : '✋ Com licença…', '#fff1c9', '#f2b84b');
    } else if (p.fala) balao(p.pos.x * s, topo, p.fala.texto);
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
  for (const p of personagens.values()) { p.atualizar(dt, agora); vida(p, agora); }
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
  animarDialogo(agora);
  if (agora > dicaTravadaAte) {
    const perto = !modalAberto() && !dialogoCom && voce.visivel ? maisProximo() : null;
    const dica = dialogoCom ? '<kbd>Esc</kbd> fecha a conversa' : perto ? `<kbd>E</kbd> ${esc(perto.rotulo)}` : 'Ande com <kbd>WASD</kbd> ou as setas, ou clique na sala. <kbd>E</kbd> interage.';
    if (dica !== ultimaDica) { $('#dica').innerHTML = dica; ultimaDica = dica; }
  }
  if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) atualizarVivos();
  requestAnimationFrame(quadro);
}

function notificar(texto) {
  const t = document.createElement('div');
  t.className = 'toast px';
  t.textContent = `🔔 ${texto}`;
  $('#toasts').append(t);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(() => t.remove(), 6000);
}

// ---------- teclado e mouse ----------
const modalAberto = () => [...document.querySelectorAll('.sobre')].some((m) => !m.hidden);
const digitando = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || Boolean(document.activeElement?.closest?.('.xterm'));
window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') { e.preventDefault(); return telaCheia(); }
  if (e.key === 'Escape') {
    if (modalAberto()) return fecharModais();
    if (dialogoCom) return fecharDialogo();
    if (!$('#abertura').hidden || !$('#boasvindas').hidden) return;
    return abrirMenu();
  }
  if (modalAberto() || digitando()) return;
  const k = e.key.toLowerCase();
  if (k === 't') return abrirEquipe();
  if (k === 'r' && Object.keys(relatorio).length) return abrirRelatorio();
  if (k === 'm') return abrirMenu();
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'].includes(k)) {
    if (dialogoCom) fecharDialogo();
    teclas.add(k);
    e.preventDefault();
  }
  if (k === 'e' || k === ' ' || k === 'enter') { e.preventDefault(); interagir(maisProximo()); }
});
window.addEventListener('keyup', (e) => teclas.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => teclas.clear());

tela.addEventListener('mousemove', (e) => { tela.style.cursor = alvoNoClique(noMundo(e)) ? 'pointer' : 'default'; });
tela.addEventListener('click', (e) => {
  tela.focus();
  if (!voce.visivel) return;
  const pt = noMundo(e);
  const alvo = alvoNoClique(pt);
  const agora = performance.now();
  if (dialogoCom && !(alvo?.tipo === 'pessoa' && alvo.alvo.id === dialogoCom)) fecharDialogo();
  levantar();
  if (alvo) {
    if (alvo.tipo === 'pessoa') {
      const p = alvo.alvo;
      if (Math.hypot(p.pos.x - voce.pos.x, p.pos.y - voce.pos.y) < 1.8 * T) return interagir(alvo);
      const perto = vizinhoLivre({ x: Math.floor(p.pos.x / T), y: Math.floor((p.pos.y - 1) / T) }, voce.tile);
      return voce.irPara(perto, agora, () => interagir(alvo)) || interagir(alvo);
    }
    if (alvo.tipo === 'mesa' || alvo.tipo === 'minhaMesa' || alvo.tipo === 'sofa') return interagir(alvo);
    return voce.irPara(alvo.spot ?? alvo.pos, agora, () => interagir(alvo)) || interagir(alvo);
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

// ---------- pedidos ----------
$('#pedidos').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-id]');
  if (!b) return;
  b.disabled = true;
  const aprovar = b.dataset.aprovar === '1';
  try {
    if (b.dataset.tipo === 'contratacao') await api('POST', `/contratacoes/${b.dataset.id}`, { aprovar });
    else await api('POST', `/permissoes/${b.dataset.id}`, { aprovar });
  } catch (err) { b.disabled = false; alert(err.message); }
});
$('#fAuto').addEventListener('change', async (e) => { try { await api('POST', '/config', { aprovarTudo: e.target.checked }); } catch { e.target.checked = !e.target.checked; } });
$('#btnPasta').addEventListener('click', () => api('POST', '/abrir-pasta', { alvo: 'principal' }).catch((e) => alert(e.message)));

// ---------- janelas ----------
function fecharModais() {
  for (const m of document.querySelectorAll('.sobre')) {
    if (['boasvindas', 'fimDia', 'abertura'].includes(m.id)) continue;
    if (m.id === 'computador' && !m.hidden) fecharComputador();
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

function htmlHistorico(historico, comDesfazer = true) {
  return `<div class="lista">${historico.map((h) => `<div class="item"><div class="linha"><div style="flex:3"><b>${esc(h.assunto)}</b><div class="sub">${esc(h.autor)} · ${new Date(h.em).toLocaleString('pt-BR')}</div></div>
    <button class="neutro pequeno" data-ver="${h.hash}" style="flex:0">ver</button>
    ${comDesfazer && !h.assunto.startsWith('Escritório aberto') ? `<button class="perigo pequeno" data-desfazer="${h.hash}" style="flex:0">desfazer</button>` : ''}</div><pre hidden data-d="${h.hash}"></pre></div>`).join('') || '<div class="vazio">Nada ainda.</div>'}</div>`;
}
async function cliqueHistorico(e, recarregar) {
  const ver = e.target.closest('[data-ver]');
  const desf = e.target.closest('[data-desfazer]');
  if (ver) {
    const pre = e.currentTarget.querySelector(`pre[data-d="${ver.dataset.ver}"]`);
    if (!pre.hidden) return (pre.hidden = true);
    pre.textContent = 'carregando…';
    pre.hidden = false;
    try { pre.textContent = (await api('GET', `/cofre/${ver.dataset.ver}`)).detalhe; } catch (err) { pre.textContent = err.message; }
  }
  if (desf && confirm('Desfazer esta entrega? A versão principal volta ao que era antes dela.')) {
    try { await api('POST', `/cofre/${desf.dataset.desfazer}/desfazer`); recarregar(); } catch (err) { alert(err.message); }
  }
}
async function abrirCofre() {
  janela('🗄️ Cofre', '<div class="vazio">Abrindo…</div>');
  try {
    const { historico } = await api('GET', '/cofre');
    $('#janCorpo').innerHTML = `<p>O histórico do projeto. Desfazer cria um registro novo que volta ao estado anterior (dá para desfazer o desfazer).</p>${htmlHistorico(historico)}`;
  } catch (e) { $('#janCorpo').innerHTML = `<div class="erro">${esc(e.message)}</div>`; }
}
$('#janCorpo').addEventListener('click', async (e) => {
  if (e.target.closest('[data-ver],[data-desfazer]')) return cliqueHistorico(e, abrirCofre);
  const jornal = e.target.closest('#btnAtualizarJornal');
  if (jornal) { jornal.disabled = true; await api('POST', '/agenda/gerar').catch(() => {}); jornal.textContent = 'Pedido! O jornal chega em um ou dois minutos.'; }
});
$('#janCorpo').addEventListener('change', async (e) => {
  if (e.target.id === 'wifiInternet') await api('POST', '/config', { internet: e.target.checked }).catch((err) => alert(err.message));
  if (e.target.id === 'wifiAuto') await api('POST', '/config', { aprovarTudo: e.target.checked }).catch((err) => alert(err.message));
});
$('#janCorpo').addEventListener('submit', async (e) => {
  if (e.target.id !== 'formVoz') return;
  e.preventDefault();
  const botao = e.submitter;
  botao.disabled = true;
  $('#vozErro').textContent = '';
  try {
    const r = await api('POST', '/voz/config', { chave: $('#vozChave').value.trim(), regiao: $('#vozRegiao').value.trim() || 'brazilsouth' });
    vozConfigurada = r.configurada;
    $('#vozErro').textContent = r.configurada ? '✅ Vozes ligadas!' : 'Vozes desligadas.';
  } catch (err) { $('#vozErro').textContent = err.message; } finally { botao.disabled = false; }
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
  janela('❄️ Ar-condicionado', m ? `<p>A temperatura do escritório é a carga real do seu computador.</p>
    <div class="item"><b>🌡️ ${m.temperatura}°C</b><div class="sub">Carga do processador: ${Math.round(m.carga * 100)}% de ${m.nucleos} núcleos</div></div>
    <p>${m.temperatura >= 28 ? 'Está quente: o computador está trabalhando muito. Menos gente em paralelo refresca.' : m.temperatura >= 25 ? 'Morno: trabalho em andamento.' : 'Fresquinho: o computador está tranquilo.'}</p>` : '<p>Medindo…</p>');
}
function abrirJornal() {
  const j = agenda?.jornal ?? [];
  janela('📺 Jornal do escritório', `${j.length ? `<p>Notícias reais de hoje, buscadas de manhã. A equipe comenta no bebedouro.</p>
    <div class="lista">${j.map((n) => `<div class="item"><b>${esc(n.titulo)}</b><div class="sub">${esc(n.fonte)}</div><div>${esc(n.resumo)}</div>${n.url ? `<a href="${esc(n.url)}" target="_blank" rel="noopener">ler na fonte</a>` : ''}</div>`).join('')}</div>`
    : `<p>${internet ? 'O jornal de hoje ainda não chegou.' : 'A internet do escritório está desligada.'}</p>`}
    <button class="neutro" id="btnAtualizarJornal" style="margin-top:10px">Buscar o jornal agora</button>`);
}
async function abrirDiario() {
  try { const e = await api('GET', '/estado'); diario = e.diario ?? diario; relatorio = e.relatorio ?? relatorio; } catch {}
  const porDia = {};
  for (const d of diario) (porDia[d.data] ??= []).push(d);
  const rel = Object.entries(relatorio);
  janela('📒 Estante: relatório e diário', `${rel.length ? `<h2>Relatório do escritório</h2><div class="lista">${rel.map(([k, v]) => `<div class="item"><b>${esc(k)}</b><div style="white-space:pre-wrap">${esc(v)}</div></div>`).join('')}</div>` : ''}
    <h2 style="margin-top:14px">Diário</h2>${Object.keys(porDia).length ? Object.entries(porDia).reverse().map(([data, l]) => `<h2 style="margin-top:10px;text-transform:none">${new Date(data + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
    <div class="lista">${l.map((d) => `<div class="item"><b>${esc(nomeDe(d.quem))}</b> <span class="sub">${horaCurta(d.em)}</span><div>${esc(d.texto)}</div></div>`).join('')}</div>`).join('') : '<p>Vazio ainda.</p>'}`);
}
function abrirVozes() {
  janela('🔊 Vozes', `
    <p>As vozes vêm do serviço oficial de voz da Microsoft (Azure). O nível gratuito cobre meio milhão de caracteres por mês. Você precisa de uma chave:</p>
    <ol style="color:var(--suave);font-size:13px;padding-left:18px">
      <li>Entre em <a href="https://portal.azure.com" target="_blank" rel="noopener">portal.azure.com</a> (conta gratuita).</li>
      <li>Crie um recurso <b>Speech</b> (Serviços de Fala), plano <b>Free F0</b>, região <b>Brazil South</b>.</li>
      <li>Em "Chaves e ponto de extremidade", copie a <b>Chave 1</b> e cole aqui.</li>
    </ol>
    <form id="formVoz">
      <label for="vozChave">Chave</label><input id="vozChave" autocomplete="off" placeholder="cole a chave aqui">
      <label for="vozRegiao">Região</label><input id="vozRegiao" value="brazilsouth">
      <button class="grande" type="submit">Salvar e testar</button>
      <div class="erro" id="vozErro">${vozConfigurada ? 'Vozes já estão ligadas. Deixe a chave vazia e salve para desligar.' : ''}</div>
    </form>`);
}
function abrirAjuda() {
  janela('❔ Como jogar', `
    <p><b>Você é o gestor.</b> Ande com <b>WASD</b> ou as setas (ou clique). Chegue perto de algo e aperte <b>E</b>. Para conversar, chegue perto de alguém e aperte <b>E</b>: abre a conversa.</p>
    <div class="lista">
      <div class="item">🗣️ <b>Chefe ★:</b> seu parceiro. Organiza o escritório e a equipe. Peça o que quer fazer a ele.</div>
      <div class="item">💻 <b>Computadores:</b> sente numa mesa para usar um computador de verdade (navegador, arquivos, editor, terminal, ver o projeto). Na mesa de quem está trabalhando, você vê a tela da pessoa.</div>
      <div class="item">📋 <b>Pedidos:</b> permissões e contratações aparecem no painel, e a pessoa vem até a sua mesa.</div>
      <div class="item">🗄️ Cofre: histórico e desfazer · 📶 Roteador: internet · ❄️ Ar: carga do PC · 📺 TV: jornal real · 📒 Estante: relatório e diário.</div>
    </div>
    <h2 style="margin-top:14px">O que cada cena quer dizer</h2>
    <div class="lista">
      <div class="item">⌨️ Digitando → escrevendo arquivos · 📚 Estante → lendo/pesquisando · ☕ Cafezinho → esperando um comando rodar</div>
      <div class="item">✋ Indo à sua mesa → permissão, contratação ou entrega com evidência · 🧠 "deixa eu ver direitinho" → pensando com o modelo mais inteligente</div>
      <div class="item">🚻 Banheiro → compactando a memória · 🍽️ Almoço → cota no limite · 🔵 Tela azul → erro · 🌡️ Calor → carga do PC</div>
      <div class="item">🛋️ Bebedouro, sofá, janela → vida própria (só quem não está trabalhando) · 🌙 Fim do dia → cada um salva e vai embora</div>
    </div>`);
}
$('#btnAjuda').addEventListener('click', () => { $('#menu').hidden = true; abrirAjuda(); });
$('#btnVozes').addEventListener('click', () => { $('#menu').hidden = true; abrirVozes(); });
$('#btnEncerrar').addEventListener('click', () => { $('#menu').hidden = true; encerrarDia(); });
$('#btnSom').addEventListener('click', () => {
  if (!vozConfigurada) return abrirVozes();
  somLigado = !somLigado;
  guardar('som', somLigado ? 'sim' : 'nao');
  if (!somLigado) audioAtual?.pause();
  atualizarVivos();
});
$('#btnReabrir').addEventListener('click', async () => { $('#fimDia').hidden = true; await api('POST', '/expediente/abrir').catch((e) => alert(e.message)); });

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
  if (p) abrirComputador(p.id, `Junto com ${p.nome} (computador dele/dela)`);
});

// ---------- o computador do escritório ----------
// Uma área de trabalho de verdade: navegador, arquivos, editor, terminal,
// ver o projeto e histórico, na pasta daquele computador.
let alvoPc = 'voce';
let appAtivo = null;
const appsAbertos = new Set();
const navNativo = Boolean(window.webkit?.messageHandlers?.navegador);
const navHist = { lista: [], pos: -1 };
let arqCaminho = '';
let edArquivo = null;
let edSujo = false;

function abrirComputador(alvo, titulo) {
  if (alvoPc !== alvo) { appsAbertos.clear(); navHist.lista = []; navHist.pos = -1; arqCaminho = ''; edArquivo = null; $('#editorTexto').value = ''; }
  alvoPc = alvo;
  $('#pcDono').textContent = titulo;
  $('#pcPasta').textContent = '';
  $('#icoEntregar').hidden = alvo !== 'voce';
  $('#pcErro').textContent = '';
  $('#computador').hidden = false;
  voce.noComputador = true;
  mostrarApp(null);
  api('GET', `/arquivos?alvo=${alvo}`).then(() => {}).catch((e) => ($('#pcErro').textContent = e.message));
}

function fecharComputador() {
  fecharNavegadorNativo();
  $('#computador').hidden = true;
  voce.noComputador = false;
  tela.focus();
}
$('#pcLevantar').addEventListener('click', fecharComputador);

function mostrarApp(app) {
  appAtivo = app;
  for (const j of document.querySelectorAll('.janela-pc')) j.hidden = j.id !== `jan-${app}`;
  $('#icones').style.visibility = app ? 'hidden' : 'visible';
  if (app) appsAbertos.add(app);
  const nomes = { navegador: '🌐 Navegador', arquivos: '📁 Arquivos', editor: '📝 Editor', terminal: '⌨️ Terminal', historico: '🗄️ Histórico' };
  $('#tarefasPc').innerHTML = `<button data-ir="area" class="${app ? '' : 'ativa'}">🖥️ Área de trabalho</button>` +
    [...appsAbertos].map((a) => `<button data-ir="${a}" class="${a === app ? 'ativa' : ''}">${nomes[a]}</button>`).join('');
  if (app === 'navegador') posicionarNavegadorNativo();
  else fecharNavegadorNativo(true);
  if (app === 'terminal') abrirTerminal();
}
$('#tarefasPc').addEventListener('click', (e) => { const b = e.target.closest('[data-ir]'); if (b) mostrarApp(b.dataset.ir === 'area' ? null : b.dataset.ir); });
for (const b of document.querySelectorAll('[data-minimizar]')) b.addEventListener('click', () => mostrarApp(null));
$('#icones').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-app]');
  if (!b) return;
  const app = b.dataset.app;
  if (app === 'projeto') { mostrarApp('navegador'); return navegar(`/previa/${alvoPc}/`); }
  if (app === 'entregar') {
    try { const r = await api('POST', '/entregar-meu-trabalho'); $('#pcErro').textContent = r.ok ? `✅ ${r.mensagem}` : r.mensagem; } catch (err) { $('#pcErro').textContent = err.message; }
    return;
  }
  mostrarApp(app);
  if (app === 'arquivos') listarArquivos(arqCaminho);
  if (app === 'historico') carregarHistoricoPc();
  if (app === 'navegador' && navHist.pos < 0) navegar(`/previa/${alvoPc}/`);
});

// Navegador: o site do projeto abre aqui dentro; sites de fora abrem num
// navegador de verdade (no app instalado, por cima desta janela).
function normalizarEndereco(t) {
  t = t.trim();
  if (!t) return null;
  if (t.startsWith('/')) return t;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(t) || t.startsWith('localhost')) return `https://${t}`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
function navegar(endereco, registrar = true) {
  const url = normalizarEndereco(endereco);
  if (!url) return;
  $('#navEndereco').value = url;
  if (registrar) { navHist.lista = navHist.lista.slice(0, navHist.pos + 1); navHist.lista.push(url); navHist.pos = navHist.lista.length - 1; }
  const local = url.startsWith('/');
  $('#navAviso').hidden = true;
  if (!local && navNativo) {
    $('#navArea').innerHTML = '';
    return abrirNavegadorNativo(url);
  }
  fecharNavegadorNativo(true);
  $('#navArea').innerHTML = `<iframe src="${esc(url)}" title="página" sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals allow-downloads"></iframe>`;
  if (!local) {
    $('#navAviso').hidden = false;
    $('#navAviso').innerHTML = `Alguns sites não deixam abrir dentro de outra página. <a href="${esc(url)}" target="_blank" rel="noopener">Abrir no navegador do sistema</a>.`;
  }
  const f = $('#navArea iframe');
  f.addEventListener('load', () => { try { if (f.contentWindow.location.pathname) $('#navEndereco').value = f.contentWindow.location.pathname; } catch {} });
}
$('#navIr').addEventListener('click', () => navegar($('#navEndereco').value));
$('#navEndereco').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); navegar($('#navEndereco').value); } });
$('#navVoltar').addEventListener('click', () => {
  if (navAtivoNativo) return window.webkit.messageHandlers.navegador.postMessage({ acao: 'voltar' });
  if (navHist.pos > 0) { navHist.pos--; navegar(navHist.lista[navHist.pos], false); }
});
$('#navAvancar').addEventListener('click', () => {
  if (navAtivoNativo) return window.webkit.messageHandlers.navegador.postMessage({ acao: 'avancar' });
  if (navHist.pos < navHist.lista.length - 1) { navHist.pos++; navegar(navHist.lista[navHist.pos], false); }
});
$('#navRecarregar').addEventListener('click', () => {
  if (navAtivoNativo) return window.webkit.messageHandlers.navegador.postMessage({ acao: 'recarregar' });
  const f = $('#navArea iframe');
  if (f) f.src = f.src;
});

let navAtivoNativo = false;
function retanguloNav() {
  const r = $('#navArea').getBoundingClientRect();
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
}
function abrirNavegadorNativo(url) {
  navAtivoNativo = true;
  window.webkit.messageHandlers.navegador.postMessage({ acao: 'abrir', url, ...retanguloNav() });
}
function posicionarNavegadorNativo() {
  if (navAtivoNativo && appAtivo === 'navegador' && !$('#computador').hidden) window.webkit.messageHandlers.navegador.postMessage({ acao: 'mover', ...retanguloNav() });
}
function fecharNavegadorNativo(soEsconder = false) {
  if (!navNativo || !navAtivoNativo) return;
  window.webkit.messageHandlers.navegador.postMessage({ acao: soEsconder ? 'esconder' : 'fechar' });
  if (!soEsconder) navAtivoNativo = false;
}
// O app nativo avisa quando a página muda (endereço e título).
window.__navegadorNativo = (dados) => {
  if (dados.url) $('#navEndereco').value = dados.url;
};

// Arquivos
async function listarArquivos(caminho) {
  try {
    const r = await api('GET', `/arquivos?alvo=${alvoPc}&caminho=${encodeURIComponent(caminho)}`);
    arqCaminho = r.caminho;
    $('#arqCaminho').textContent = `/${r.caminho}`;
    $('#arqLista').innerHTML = r.itens.map((i) => `<tr data-nome="${esc(i.nome)}" data-pasta="${i.pasta ? 1 : 0}"><td>${i.pasta ? '📁' : '📄'} ${esc(i.nome)}</td><td style="color:#7a8296;width:120px">${i.pasta ? '' : `${(i.tamanho / 1024).toFixed(1)} KB`}</td><td style="color:#7a8296;width:160px">${new Date(i.modificado).toLocaleString('pt-BR')}</td></tr>`).join('')
      || '<tr><td style="color:#7a8296">Pasta vazia.</td></tr>';
  } catch (e) { $('#pcErro').textContent = e.message; }
}
$('#arqLista').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-nome]');
  if (!tr) return;
  const alvo = arqCaminho ? `${arqCaminho}/${tr.dataset.nome}` : tr.dataset.nome;
  if (tr.dataset.pasta === '1') listarArquivos(alvo);
  else abrirNoEditor(alvo);
});
$('#arqSubir').addEventListener('click', () => listarArquivos(arqCaminho.split('/').slice(0, -1).join('/')));
$('#arqNovo').addEventListener('click', () => {
  const nome = prompt('Nome do novo arquivo (ex.: notas.md)');
  if (!nome) return;
  const caminho = arqCaminho ? `${arqCaminho}/${nome}` : nome;
  api('PUT', '/arquivo', { alvo: alvoPc, caminho, conteudo: '' }).then(() => { listarArquivos(arqCaminho); abrirNoEditor(caminho); }).catch((err) => ($('#pcErro').textContent = err.message));
});

// Editor
async function abrirNoEditor(caminho) {
  if (edSujo && !confirm('Há alterações não salvas no editor. Descartar?')) return;
  try {
    const r = await api('GET', `/arquivo?alvo=${alvoPc}&caminho=${encodeURIComponent(caminho)}`);
    mostrarApp('editor');
    edArquivo = r.caminho;
    $('#edTitulo').textContent = `📝 ${r.caminho}`;
    if (r.binario || r.grande) {
      $('#editorTexto').value = r.binario ? '(arquivo binário: abra pelo navegador)' : '(arquivo grande demais para o editor)';
      $('#editorTexto').readOnly = true;
    } else {
      $('#editorTexto').value = r.texto;
      $('#editorTexto').readOnly = false;
    }
    edSujo = false;
    $('#edStatus').textContent = '';
  } catch (e) { $('#pcErro').textContent = e.message; }
}
async function salvarEditor() {
  if (!edArquivo || $('#editorTexto').readOnly) return;
  try {
    await api('PUT', '/arquivo', { alvo: alvoPc, caminho: edArquivo, conteudo: $('#editorTexto').value });
    edSujo = false;
    $('#edStatus').textContent = `salvo às ${new Date().toLocaleTimeString('pt-BR')}`;
  } catch (e) { $('#edStatus').textContent = e.message; }
}
$('#editorTexto').addEventListener('input', () => { edSujo = true; $('#edStatus').textContent = 'não salvo'; });
$('#editorTexto').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); salvarEditor(); }
  if (e.key === 'Tab') {
    e.preventDefault();
    const t = e.target;
    const i = t.selectionStart;
    t.value = t.value.slice(0, i) + '  ' + t.value.slice(t.selectionEnd);
    t.selectionStart = t.selectionEnd = i + 2;
    edSujo = true;
  }
});
$('#edSalvar').addEventListener('click', salvarEditor);
$('#edVer').addEventListener('click', async () => { if (!edArquivo) return; if (edSujo) await salvarEditor(); mostrarApp('navegador'); navegar(`/previa/${alvoPc}/${edArquivo}`); });

// Histórico (no computador)
async function carregarHistoricoPc() {
  try { const { historico } = await api('GET', '/cofre'); $('#histLista').innerHTML = htmlHistorico(historico, false); } catch (e) { $('#histLista').textContent = e.message; }
}
$('#histLista').addEventListener('click', (e) => cliqueHistorico(e, carregarHistoricoPc));

// Terminal (de verdade)
const terminais = {};
let term = null;
let ajuste = null;
let fonteTerm = null;
let alvoTerm = null;
async function abrirTerminal() {
  if (!window.Terminal) return ($('#pcErro').textContent = 'O terminal não carregou.');
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
      timer = setTimeout(() => { const dados = buffer; buffer = ''; if (terminais[alvoTerm]) api('POST', `/terminais/${terminais[alvoTerm].id}/entrada`, { dados }).catch(() => {}); }, 8);
    });
    window.addEventListener('resize', () => { if (appAtivo === 'terminal') ajustarTerminal(); });
  }
  if (alvoTerm !== alvoPc || !terminais[alvoPc]?.vivo) {
    fonteTerm?.close();
    term.reset();
    alvoTerm = alvoPc;
    try { if (!terminais[alvoPc]?.vivo) terminais[alvoPc] = { ...(await api('POST', '/terminais', { alvo: alvoPc })), vivo: true }; } catch (e) { $('#pcErro').textContent = e.message; return; }
    $('#pcPasta').textContent = `· ${terminais[alvoPc].pasta}`;
    fonteTerm = new EventSource(`/terminais/${terminais[alvoPc].id}/saida`);
    fonteTerm.onmessage = (m) => term.write(Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)));
    fonteTerm.addEventListener('fim', () => { terminais[alvoTerm].vivo = false; term.write('\r\n\x1b[33m[terminal fechado]\x1b[0m\r\n'); fonteTerm.close(); });
  }
  setTimeout(() => { ajustarTerminal(); term.focus(); }, 60);
}
function ajustarTerminal() {
  try { ajuste.fit(); if (terminais[alvoTerm]) api('POST', `/terminais/${terminais[alvoTerm].id}/tamanho`, { colunas: term.cols, linhas: term.rows }).catch(() => {}); } catch {}
}

// ---------- contratação ----------
function retratoPequeno(canvas, p) { desenharRetrato(canvas, p, {}); }
async function candidatosHtml(cargo) {
  const { candidatos } = await api('GET', `/candidatos?cargo=${cargo}`);
  candidatos.forEach((c, i) => candidatosVistos.set(`${cargo}-${i}`, c));
  return candidatos.map((c, i) => `<div class="candidato">
      <div class="topo"><canvas width="48" height="64" data-cand="${cargo}-${i}"></canvas>
      <div><div class="nome">${esc(c.nome)}</div><div class="vazio">${esc(c.titulo)} · ${esc(c.modelo)}</div><div class="vazio">${c.ficha.idade} anos, ${esc(c.ficha.cidade)}</div></div></div>
      <div class="pers">“${esc(c.personalidade)}”</div>
      <div class="vida">Gosta de ${esc(c.ficha.hobbies.join(' e '))}. ${esc(c.ficha.pet.charAt(0).toUpperCase() + c.ficha.pet.slice(1))}.</div>
      <button data-nome="${esc(c.nome)}" data-cargo="${cargo}">Contratar</button></div>`).join('');
}
const candidatosVistos = new Map(); // "cargo-i" → candidato
function desenharCandidatos(raiz) {
  for (const cv of raiz.querySelectorAll('canvas[data-cand]')) {
    const c = candidatosVistos.get(cv.dataset.cand);
    if (c) retratoPequeno(cv, { ...c, id: c.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') });
  }
}
async function abrirContratacao() {
  $('#contratacao').hidden = false;
  $('#erroContratar').textContent = '';
  const chefe = [...personagens.values()].find((p) => p.cargo === 'chefe');
  const jaTem = new Set(equipeInfo.map((f) => f.cargo));
  const pendentesRec = recomendacao.filter((r) => !jaTem.has(r.cargo));
  if (pendentesRec.length) {
    $('#recomendados').innerHTML = `<h2>Recomendados por ${esc(chefe?.nome ?? 'o chefe')}</h2>` + (await Promise.all(pendentesRec.map(async (r) => `<div class="recomendado"><h3>${esc(cargosInfo[r.cargo]?.titulo ?? r.cargo)}</h3><p>${esc(r.motivo)}</p><div class="candidatos">${await candidatosHtml(r.cargo)}</div></div>`))).join('');
    desenharCandidatos($('#recomendados'));
  } else $('#recomendados').innerHTML = '';
  const ordem = Object.entries(cargosInfo).sort((a, b) => (a[1].daArea === b[1].daArea ? 0 : a[1].daArea ? -1 : 1));
  $('#abas').innerHTML = ordem.map(([k, v]) => `<button class="neutro" data-cargo="${k}" title="${esc(v.verdade)}">${esc(v.titulo)}${v.daArea ? '' : ' ·'}</button>`).join('');
  $('#tituloOutros').textContent = pendentesRec.length ? 'Outros cargos' : 'Cargos';
  mostrarCandidatos(ordem[0]?.[0]);
}
async function mostrarCandidatos(cargo) {
  if (!cargo) return;
  for (const b of document.querySelectorAll('#abas button')) b.classList.toggle('ativa', b.dataset.cargo === cargo);
  $('#verdade').textContent = cargosInfo[cargo]?.verdade ?? '';
  $('#candidatos').innerHTML = '<div class="vazio">Chamando candidatos…</div>';
  try { $('#candidatos').innerHTML = await candidatosHtml(cargo); desenharCandidatos($('#candidatos')); } catch (err) { $('#candidatos').innerHTML = ''; $('#erroContratar').textContent = err.message; }
}
$('#btnContratar').addEventListener('click', abrirContratacao);
$('#abas').addEventListener('click', (e) => { const b = e.target.closest('button[data-cargo]'); if (b) mostrarCandidatos(b.dataset.cargo); });
$('#contratacao').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-nome]');
  if (!b) return;
  b.disabled = true;
  try {
    await api('POST', '/contratar', { nome: b.dataset.nome, cargo: b.dataset.cargo });
    b.textContent = 'Contratado!';
    b.closest('.candidato').classList.add('contratado');
    // quem estava na mesma vaga recomendada sai da lista
    const bloco = b.closest('.recomendado');
    if (bloco) for (const o of bloco.querySelectorAll('button[data-nome]')) o.disabled = true;
  } catch (err) { b.disabled = false; $('#erroContratar').textContent = err.message; }
});

// ---------- painel ----------
function hora(ev) { return new Date(ev.em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function resumoEvento(ev) {
  switch (ev.tipo) {
    case 'sessao_iniciada': return ev.conversa ? '🧠 pensando com calma' : `🚪 começou: "${curto(ev.tarefa, 90)}"`;
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
    case 'contratacao_pedida': return `📋 ${nomeDe(ev.pedidoPor)} pediu: ${cargosInfo[ev.cargo]?.titulo ?? ev.cargo}: ${curto(ev.motivo, 90)}`;
    case 'contratacao_respondida': return `🤝 contratação ${ev.aprovada ? `aprovada: ${ev.contratado}` : 'negada'}`;
    case 'tarefa_delegada': return `📌 ${nomeDe(ev.de)} → ${nomeDe(ev.para)}${ev.local && ev.local !== ev.para ? ` (na mesa de ${nomeDe(ev.local)})` : ''}: ${curto(ev.tarefa, 100)}`;
    case 'integracao': return `🔀 ${ev.ok ? '' : 'FALHOU: '}${ev.mensagem}`;
    case 'expediente': return `🏢 expediente ${ev.fase}${ev.luzCaiu ? ' (a luz caiu ontem)' : ''}`;
    case 'humor': return `🙂 ${nomeDe(ev.funcionario)}: humor ${ev.humor} (${ev.motivo})`;
    case 'almoco': return ev.ate ? `🍽️ almoço até ${horaCurta(ev.ate)} (cota)` : '🍽️ voltaram do almoço';
    case 'agenda': return `📰 agenda do dia: ${ev.agenda.jornal.length} notícias`;
    case 'aniversario': return `🎂 aniversário de ${nomeDe(ev.funcionario)}`;
    case 'cofre': return `🗄️ desfeito: ${ev.assunto}`;
    case 'config': return `⚙️ internet ${ev.internet ? 'ligada' : 'desligada'}; aprovação automática ${ev.aprovarTudo ? 'ligada' : 'desligada'}`;
    case 'relatorio': return `📝 relatório: ${Object.keys(ev.secoes).join(', ')}`;
    case 'recomendacao': return `👥 equipe recomendada: ${ev.itens.map((i) => cargosInfo[i.cargo]?.titulo ?? i.cargo).join(', ')}`;
    case 'pensando': return ev.ate ? `🧠 ${nomeDe(ev.funcionario)} terminou de pensar` : `🧠 ${nomeDe(ev.funcionario)} foi pensar: ${ev.motivo}`;
    default: return ev.tipo;
  }
}
function itemFeed(ev, id) {
  const quem = id ? `<b>${esc(nomeDe(id))}</b> ` : '';
  return `<details data-n="${ev._n}"${abertos.has(ev._n) ? ' open' : ''}><summary><span class="hora">${hora(ev)}</span> ${quem}${esc(resumoEvento(ev))}</summary><pre>${esc(JSON.stringify({ ...ev, _n: undefined }, null, 2))}</pre></details>`;
}
const corHumor = (h) => (h >= 65 ? '#5fc27e' : h >= 35 ? '#f2b84b' : '#e5675f');
const statusDe = (p) => (p.ferias ? 'de férias 🏖️' : p.ocupado ? p.descricao : p.visivel ? `livre · ${p.descricao}` : p.descricao);

function atualizarVivos() {
  const d = new Date();
  $('#relogio').textContent = `🕒 ${d.toLocaleDateString('pt-BR', { weekday: 'short' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
  $('#pcRelogio').textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const n = [...personagens.values()].filter((p) => p.ocupado && !p.ehVoce).length;
  $('#trabalhando').textContent = n ? `⌨️ ${n} trabalhando` : '';
  if (maquina) {
    $('#temperatura').hidden = false;
    $('#temperatura').textContent = `🌡️ ${maquina.temperatura}°C · CPU ${Math.round(maquina.carga * 100)}%`;
    $('#temperatura').className = `chip ${maquina.temperatura >= 28 ? 'off' : ''}`;
  }
  if (ultimaCota) {
    const c = $('#cota');
    c.hidden = false;
    c.textContent = `cota ${ultimaCota.janela === 'five_hour' ? '5h' : ultimaCota.janela === 'seven_day' ? '7 dias' : ultimaCota.janela ?? ''} ${Math.round((ultimaCota.uso ?? 0) * 100)}%`;
    c.className = `chip ${ultimaCota.status === 'allowed' ? 'on' : 'off'}`;
  }
  $('#almoco').hidden = !almocoAte;
  if (almocoAte) $('#almoco').textContent = `🍽️ almoço até ${horaCurta(almocoAte)}`;
  $('#btnSom').hidden = !vozConfigurada;
  $('#btnSom').textContent = somLigado ? '🔊 vozes ligadas' : '🔇 vozes desligadas';
  for (const el of document.querySelectorAll('.membro .det[data-id]')) {
    const p = personagens.get(el.dataset.id);
    if (p) el.textContent = `${tituloDe(p)} · ${statusDe(p)}`;
  }
  const fe = $('#fichaEstado');
  if (fe && selecionado) fe.textContent = statusDe(selecionado);
  atualizarStatusDialogo();
}

function htmlFicha(p) {
  const f = p.ficha;
  return `<div class="topo"><canvas width="48" height="64" id="fichaRetrato"></canvas>
      <div style="flex:1"><div class="nome">${esc(p.nome)}${p.cargo === 'chefe' ? ' ★' : ''}</div><div class="vazio">${esc(tituloDe(p))} · ${esc(p.modelo)}</div>
      <div class="humorbarra" style="margin-top:8px"><div style="width:${p.humor}%;background:${corHumor(p.humor)}"></div></div><div class="vazio">${p.humor >= 65 ? 'animado' : p.humor >= 35 ? 'normal' : 'chateado'} (${p.humor})</div></div>
      <button class="neutro pequeno" data-fechar>fechar</button></div>
    <dl>
      ${p.personalidade ? `<dt>Jeito</dt><dd>${esc(p.personalidade)}</dd>` : ''}
      ${f ? `<dt>Vida</dt><dd>${f.idade} anos, de ${esc(f.cidade)}. ${esc(f.familia.charAt(0).toUpperCase() + f.familia.slice(1))}. Tem ${esc(f.pet)}. Gosta de ${esc(f.hobbies.join(' e '))}. ${f.time === 'não liga para futebol' ? 'Não liga para futebol' : `Torce para o ${esc(f.time)}`}. Ouve ${esc(f.musica)}. Mania: ${esc(f.mania)}.</dd>` : ''}
      ${agenda?.vida?.[p.id] ? `<dt>Ontem</dt><dd>${esc(agenda.vida[p.id])}</dd>` : ''}
      ${p.aniversario ? `<dt>Aniversário</dt><dd>${p.aniversario.split('-').reverse().join('/')}${aniversariantes.has(p.id) ? ' 🎂 é hoje!' : ''}</dd>` : ''}
      <dt>Agora</dt><dd id="fichaEstado">${esc(statusDe(p))}</dd>
      ${p.tarefa ? `<dt>Última tarefa</dt><dd>${esc(curto(p.tarefa, 240))}</dd>` : ''}
    </dl>
    <div class="acoes">
      <button data-acao="conversar">🗣️ conversar</button>
      ${p.mesa ? '<button class="neutro pequeno" data-acao="tela">🖥️ ver a tela</button>' : ''}
      <button class="neutro pequeno" data-acao="elogiar">👏 elogiar</button>
      <button class="neutro pequeno" data-acao="bronca">😠 bronca</button>
      ${p.cargo !== 'chefe' ? `<button class="neutro pequeno" data-acao="ferias">${p.ferias ? '🏢 voltar das férias' : '🏖️ dar férias'}</button><button class="perigo pequeno" data-acao="demitir">desligar</button>` : ''}
    </div>
    ${p.cargo && p.cargo !== 'chefe' && !p.ferias ? `<details><summary>Dar uma tarefa direto (sem passar pelo chefe)</summary>
      <form id="formDireta"><textarea id="fDireta" required placeholder="O que ${esc(p.nome)} deve fazer?"></textarea><button type="submit" style="margin-top:6px">Entregar tarefa</button><div class="erro" id="erroDireta"></div></form></details>` : ''}
    <details><summary>Log técnico</summary><div class="feed">${p.eventos.slice(-150).reverse().map((e) => itemFeed(e)).join('') || '<div class="vazio">Nada ainda.</div>'}</div></details>`;
}

function atualizarPainel() {
  if (document.activeElement?.id === 'fDireta') return;
  atualizarVivos();
  if (escritorio) $('#nomeEscritorio').textContent = escritorio.nome;
  if (projeto) $('#projetoNome').textContent = `${areas.find((a) => a.id === escritorio?.area)?.nome ?? ''} · projeto: ${projeto.nome}`;

  // pedidos: cartões no canto da tela
  const ps = [...pedidos.values()];
  const cs = [...contratacoes.values()];
  $('#pedidos').innerHTML =
    cs.map((e) => `<div class="pedido px"><div class="titulo">📋 ${esc(nomeDe(e.pedidoPor))} quer contratar: ${esc(cargosInfo[e.cargo]?.titulo ?? e.cargo)}</div><p>${esc(e.motivo)}</p>
        <div class="linha"><button data-tipo="contratacao" data-id="${e.idPedido}" data-aprovar="1">Contratar</button><button class="neutro" data-tipo="contratacao" data-id="${e.idPedido}" data-aprovar="0">Agora não</button></div></div>`).join('') +
    ps.map((e) => `<div class="pedido px"><div class="titulo">✋ ${esc(nomeDe(sessaoParaId.get(e.sessao)))} quer usar ${esc(e.ferramenta)}</div><code>${esc(e.resumo)}</code>
        <div class="linha"><button data-id="${e.idPedido}" data-aprovar="1">Aprovar</button><button class="neutro" data-id="${e.idPedido}" data-aprovar="0">Negar</button></div></div>`).join('');

  // equipe: fileira de rostos e janela
  const membros = [...personagens.values()].filter((p) => !p.ehVoce && p.cargo);
  $('#barraEquipe').innerHTML = membros.map((p) => `<div class="rosto${p === selecionado ? ' sel' : ''}${p.ferias ? ' ferias' : ''}" data-id="${esc(p.id)}" title="${esc(p.nome)} — ${esc(tituloDe(p))} · ${esc(statusDe(p))}">
      <canvas width="48" height="64" data-mini="${esc(p.id)}"></canvas>${p.ocupado ? '<span class="ocup"></span>' : ''}${naoLidas[p.id] ? `<span class="badge">${naoLidas[p.id]}</span>` : ''}
      <div class="n">${esc(p.nome)}${p.cargo === 'chefe' ? '★' : ''}</div><div class="humor"><div style="width:${p.humor}%;background:${corHumor(p.humor)}"></div></div></div>`).join('')
    + '<div class="rosto novo" data-contratar title="Contratar alguém">+</div>';
  $('#barraEquipe').hidden = !membros.length;
  if (!$('#janEquipe').hidden) {
    $('#equipe').innerHTML = membros.map((p) => `<div class="membro${p.ferias ? ' ferias' : ''}" data-id="${esc(p.id)}">
        <canvas width="48" height="64" data-mini="${esc(p.id)}"></canvas>
        <div class="info"><div class="nome">${esc(p.nome)}${p.cargo === 'chefe' ? ' ★' : ''}${aniversariantes.has(p.id) ? ' 🎂' : ''}</div>
        <div class="det" data-id="${esc(p.id)}">${esc(tituloDe(p))} · ${esc(statusDe(p))}</div>
        <div class="humorbarra"><div style="width:${p.humor}%;background:${corHumor(p.humor)}"></div></div></div></div>`).join('') || '<div class="vazio">Ninguém ainda.</div>';
  }
  for (const cv of document.querySelectorAll('canvas[data-mini]')) { const p = personagens.get(cv.dataset.mini); if (p) desenharRetrato(cv, p, {}); }

  // relatório
  const rel = Object.entries(relatorio);
  $('#hudRelatorio').hidden = !rel.length;
  if (!$('#janRelatorio').hidden) $('#relatorio').innerHTML = rel.map(([k, v]) => `<div class="secao"><b>${esc(k)}</b><div>${esc(v)}</div></div>`).join('') || '<div class="vazio">O chefe ainda não anotou nada.</div>';

  // ficha
  if (!$('#janFicha').hidden && selecionado && personagens.has(selecionado.id)) {
    const p = selecionado;
    $('#ficha').innerHTML = htmlFicha(p);
    desenharRetrato($('#fichaRetrato'), p, {});
    $('#ficha .acoes').onclick = async (e) => {
      const a = e.target.closest('[data-acao]')?.dataset.acao;
      if (!a) return;
      try {
        if (a === 'conversar') { $('#janFicha').hidden = true; abrirDialogo(p); }
        if (a === 'tela') { $('#janFicha').hidden = true; abrirTelaDele(p); }
        if (a === 'elogiar' || a === 'bronca') await api('POST', `/funcionarios/${p.id}/${a}`);
        if (a === 'ferias') await api('POST', `/funcionarios/${p.id}/ferias`, { ferias: !p.ferias });
        if (a === 'demitir' && confirm(`Desligar ${p.nome}? O trabalho continua guardado na branch mesa/${p.id}.`)) { await api('POST', `/funcionarios/${p.id}/demitir`); $('#janFicha').hidden = true; selecionado = null; }
      } catch (err) { alert(err.message); }
    };
    $('#formDireta')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api('POST', `/funcionarios/${encodeURIComponent(p.id)}/tarefa`, { tarefa: $('#fDireta').value }); $('#fDireta').value = ''; $('#erroDireta').textContent = 'Entregue!'; } catch (err) { $('#erroDireta').textContent = err.message; }
    });
  }

  if (!$('#menu').hidden) $('#feed').innerHTML = feedGeral.slice(-80).reverse().map(({ ev, id }) => itemFeed(ev, id)).join('') || '<div class="vazio">Nada ainda.</div>';
}

function abrirFicha(p) {
  if (!p) return;
  selecionado = p;
  $('#janFicha').hidden = false;
  atualizarPainel();
}
function abrirEquipe() { $('#janEquipe').hidden = false; atualizarPainel(); }
function abrirRelatorio() { $('#janRelatorio').hidden = false; atualizarPainel(); }
function abrirMenu() { $('#menu').hidden = false; atualizarPainel(); }
function telaCheia() {
  if (window.webkit?.messageHandlers?.janela) return window.webkit.messageHandlers.janela.postMessage({ acao: 'telaCheia' });
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}

$('#barraEquipe').addEventListener('click', (e) => {
  if (e.target.closest('[data-contratar]')) return abrirContratacao();
  const r = e.target.closest('.rosto[data-id]');
  if (r) abrirFicha(personagens.get(r.dataset.id));
});
$('#barraEquipe').addEventListener('dblclick', (e) => { const r = e.target.closest('.rosto[data-id]'); if (r) { $('#janFicha').hidden = true; abrirDialogo(personagens.get(r.dataset.id)); } });
$('#equipe').addEventListener('click', (e) => { const m = e.target.closest('.membro'); if (m) { $('#janEquipe').hidden = true; abrirFicha(personagens.get(m.dataset.id)); } });
$('#hudEquipe').addEventListener('click', abrirEquipe);
$('#hudRelatorio').addEventListener('click', abrirRelatorio);
$('#hudMenu').addEventListener('click', abrirMenu);
$('#btnTelaCheia').addEventListener('click', telaCheia);
$('#btnWifiMenu').addEventListener('click', () => { $('#menu').hidden = true; abrirWifi(); });
document.addEventListener('toggle', (e) => {
  const n = Number(e.target.dataset?.n);
  if (Number.isNaN(n)) return;
  if (e.target.open) abertos.add(n);
  else abertos.delete(n);
}, true);

// ---------- abertura, login e criação do escritório ----------
function cenaAbertura(t) {
  const cv = $('#aberturaCena');
  if (!cv || $('#abertura').hidden) return;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  // um recorte do escritório de verdade, com a luz pulsando
  c.drawImage(mundo, 7 * T, 3 * T, 16 * T, 7 * T, 0, 0, 256, 112);
  c.fillStyle = `rgba(20,14,30,${0.25 + Math.sin(t / 900) * 0.08})`;
  c.fillRect(0, 0, 256, 112);
  requestAnimationFrame(cenaAbertura);
}

function passo(id) { for (const p of ['bvVerificando', 'bvLogado', 'bvEntrar', 'bvCodigo']) $(`#${p}`).hidden = p !== id; }
async function verificarConta() {
  passo('bvVerificando');
  const c = await api('GET', '/conta');
  if (c.logado) { $('#bvEmail').textContent = c.email ? `: ${c.email}` : ''; passo('bvLogado'); } else passo('bvEntrar');
  return c;
}
let areaEscolhida = 'programacao';
function irParaEscritorio() {
  $('#bvConta').hidden = true;
  $('#bvEscritorio').hidden = false;
  $('#areas').innerHTML = areas.map((a) => `<button type="button" class="area${a.id === areaEscolhida ? ' ativa' : ''}" data-area="${a.id}"><b>${esc(a.nome)}</b><span>${esc(a.descricao)}</span></button>`).join('');
  $('#eNome').focus();
}
$('#areas').addEventListener('click', (e) => {
  const b = e.target.closest('[data-area]');
  if (!b) return;
  areaEscolhida = b.dataset.area;
  for (const x of document.querySelectorAll('.area')) x.classList.toggle('ativa', x === b);
});
$('#bvContinuar').addEventListener('click', irParaEscritorio);
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
    esperandoLogin = setInterval(async () => { const c = await api('GET', '/conta').catch(() => ({})); if (c.logado) loginConcluido(); }, 3000);
  } catch (err) { $('#loginErro').textContent = err.message; }
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
  } catch (err) { $('#loginErro').textContent = err.message; passo('bvEntrar'); } finally { botao.disabled = false; }
});
function loginConcluido() {
  clearInterval(esperandoLogin);
  if (projeto) $('#boasvindas').hidden = true;
  else irParaEscritorio();
}
$('#bvEscritorio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const botao = e.submitter;
  botao.disabled = true;
  $('#bvErro').textContent = '';
  try {
    const estado = await api('POST', '/boas-vindas', { escritorio: $('#eNome').value, area: areaEscolhida, pasta: $('#ePasta').value || undefined });
    aplicarEstado(estado);
    $('#boasvindas').hidden = true;
  } catch (err) { $('#bvErro').textContent = err.message; } finally { botao.disabled = false; }
});

let estadoInicial = null;
$('#btnComecar').addEventListener('click', async () => {
  $('#abertura').hidden = true;
  if (!estadoInicial?.boasVindas) {
    $('#boasvindas').hidden = false;
    await verificarConta().catch((e) => ($('#loginErro').textContent = e.message));
  } else {
    const c = await api('GET', '/conta').catch(() => ({ logado: true }));
    if (!c.logado) { $('#boasvindas').hidden = false; passo('bvEntrar'); }
    tela.focus();
  }
});

function aplicarEstado(estado) {
  projeto = estado.projeto ?? null;
  escritorio = estado.escritorio ?? null;
  fase = estado.fase ?? 'operando';
  relatorio = estado.relatorio ?? {};
  recomendacao = estado.recomendacao ?? [];
  areas = estado.areas ?? areas;
  cargosInfo = estado.cargos ?? {};
  equipeInfo = estado.equipe ?? [];
  internet = estado.internet ?? true;
  aprovarTudo = Boolean(estado.aprovarTudo);
  vozConfigurada = Boolean(estado.vozConfigurada);
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
  for (const c of estado.contratacoes ?? []) if (!contratacoes.has(c.id)) contratacoes.set(c.id, { tipo: 'contratacao_pedida', idPedido: c.id, cargo: c.cargo, motivo: c.motivo, pedidoPor: c.pedidoPor });
  const md = `${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  for (const f of equipeInfo) if (f.aniversario === md && !f.ferias) aniversariantes.add(f.id);
  atualizarPainel();
}

async function iniciar() {
  estadoInicial = await api('GET', '/estado');
  aplicarEstado(estadoInicial);
  $('#btnComecar').textContent = estadoInicial.boasVindas ? 'ENTRAR NO ESCRITÓRIO' : 'COMEÇAR';
  requestAnimationFrame(cenaAbertura);
}

// ---------- início ----------
redimensionar();
conectar();
iniciar().catch((err) => console.error(err));
requestAnimationFrame(quadro);
// para testes automatizados
window.escritorio = { personagens, pedidos, contratacoes, conversas, voce, maisProximo, interagir: () => interagir(maisProximo()), irPara: (x, y) => voce.irPara({ x, y }, performance.now()), abrirDialogo: (id) => abrirDialogo(personagens.get(id)), falaAtual, abrirComputador };
