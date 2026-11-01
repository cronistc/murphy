// Explorador de arquivos do computador do jogo: como o de um sistema de verdade.
// Lugares na lateral (projeto, pasta pessoal, Drive da empresa, Lixeira),
// voltar/avançar/subir, trilha clicável, busca, lista com colunas ordenáveis
// ou ícones, seleção múltipla, renomear na linha, menu do botão direito,
// copiar/recortar/colar, arrastar para mover (Ctrl copia), atalhos de teclado,
// propriedades e lixeira com restaurar.

const TIPOS = {
  md: 'Documento', txt: 'Texto', doc: 'Documento do Word', docx: 'Documento do Word', odt: 'Documento', rtf: 'Documento', pdf: 'PDF',
  png: 'Imagem PNG', jpg: 'Imagem JPEG', jpeg: 'Imagem JPEG', gif: 'Imagem GIF', webp: 'Imagem WebP', svg: 'Imagem SVG',
  html: 'Página da web', htm: 'Página da web', css: 'Folha de estilo', js: 'JavaScript', ts: 'TypeScript', json: 'Dados JSON',
  py: 'Python', sh: 'Script', csv: 'Planilha CSV', xlsx: 'Planilha do Excel', xls: 'Planilha do Excel', ods: 'Planilha',
  zip: 'Arquivo compactado', mp3: 'Áudio', wav: 'Áudio', mp4: 'Vídeo', yml: 'Configuração', yaml: 'Configuração', toml: 'Configuração', lock: 'Trava de versões',
};
const ext = (n) => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
export const tipoDe = (n, pasta) => (pasta ? 'Pasta' : TIPOS[ext(n)] ?? (ext(n) ? `Arquivo ${ext(n).toUpperCase()}` : 'Arquivo'));
export function iconeDe(n, pasta) {
  if (pasta) return '📁';
  const e = ext(n);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return '🖼️';
  if (['html', 'htm'].includes(e)) return '🌐';
  if (['csv', 'xlsx', 'xls', 'ods'].includes(e)) return '📊';
  if (['md', 'txt', 'doc', 'docx', 'odt', 'rtf'].includes(e)) return '📄';
  if (e === 'pdf') return '📕';
  if (['js', 'ts', 'py', 'sh', 'css', 'json', 'yml', 'yaml', 'toml'].includes(e)) return '🧩';
  if (['mp3', 'wav'].includes(e)) return '🎵';
  if (e === 'mp4') return '🎬';
  if (e === 'zip') return '🗜️';
  return '📦';
}
const tamanho = (b) => (b == null ? '' : b < 1024 ? `${b} B` : b < 1024 ** 2 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const data = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const juntar = (a, b) => (a ? `${a}/${b}` : b);
const PASTAS_DRIVE = { 'Para você': '📥', 'Relatórios': '📋', 'Documentos': '📄', 'Imagens': '🖼️' };

export function criarExplorador(raiz, dep) {
  const { api, esc, perguntar, confirmar, avisar, abrirArquivo, nomeDe } = dep;
  const st = {
    pc: 'voce', alvo: 'voce', caminho: '', lixeira: false, hist: [], pos: -1, itens: [], sel: new Set(), ancora: null,
    vista: lerPref('expVista', 'lista'), ordem: { col: 'nome', dir: 1 }, filtro: '', ocultos: lerPref('expOcultos', '') === '1', clip: null, renomeando: null,
  };
  function lerPref(k, padrao) { try { return localStorage.getItem(k) ?? padrao; } catch { return padrao; } }
  function guardarPref(k, v) { try { localStorage.setItem(k, v); } catch {} }

  raiz.innerHTML = `<div class="exp">
    <div class="exp-barra">
      <button data-x="voltar" title="Voltar (Alt+←)">←</button><button data-x="avancar" title="Avançar (Alt+→)">→</button>
      <button data-x="subir" title="Pasta acima (Backspace)">↑</button><button data-x="recarregar" title="Atualizar (F5)">↻</button>
      <div class="exp-trilha"></div>
      <input class="exp-busca" placeholder="🔍 Buscar nesta pasta">
      <div class="exp-vistas"><button data-vista="lista" title="Lista com detalhes">☰</button><button data-vista="icones" title="Ícones grandes">▦</button></div>
    </div>
    <div class="exp-acoes">
      <button data-x="nova-pasta">📁 Nova pasta</button><button data-x="novo-doc">📄 Novo documento</button>
      <span class="sep"></span>
      <button data-x="recortar" title="Ctrl+X">✂️ Recortar</button><button data-x="copiar" title="Ctrl+C">📋 Copiar</button><button data-x="colar" title="Ctrl+V">📌 Colar</button>
      <button data-x="renomear" title="F2">✏️ Renomear</button><button data-x="apagar" title="Delete">🗑️ Apagar</button>
      <span class="sep"></span><button data-x="propriedades">ℹ️ Propriedades</button>
      <span class="exp-espaco"></span>
      <label class="exp-ocultos"><input type="checkbox" ${st.ocultos ? 'checked' : ''}> mostrar ocultos</label>
      <button data-x="restaurar" hidden>↩️ Restaurar</button><button data-x="esvaziar" hidden>🧹 Esvaziar a lixeira</button>
    </div>
    <div class="exp-corpo"><aside class="exp-lateral"></aside><div class="exp-main" tabindex="0"></div></div>
    <div class="exp-status"></div>
    <div class="exp-menu" hidden></div>
  </div>`;
  const $ = (s) => raiz.querySelector(s);
  const main = $('.exp-main');

  // ---------- lugares ----------
  function lugares() {
    const l = [{ grupo: 'Este computador' }];
    l.push({ alvo: st.pc, caminho: '', nome: st.pc === 'principal' ? 'Projeto principal' : st.pc === 'voce' ? 'Meu projeto (minha mesa)' : `Projeto (mesa de ${nomeDe(st.pc)})`, ico: '💼' });
    if (st.pc !== 'principal') {
      const p = `pessoal-${st.pc}`;
      l.push({ alvo: p, caminho: '', nome: st.pc === 'voce' ? 'Pasta pessoal' : `Pasta pessoal de ${nomeDe(st.pc)}`, ico: '🏠' });
      for (const sub of ['Downloads', 'Imagens', 'Notas']) l.push({ alvo: p, caminho: sub, nome: sub, ico: sub === 'Downloads' ? '⬇️' : sub === 'Imagens' ? '🖼️' : '📝', filho: true });
    }
    l.push({ grupo: 'Empresa' });
    l.push({ alvo: 'drive', caminho: '', nome: 'Drive da empresa', ico: '🗂️' });
    for (const [sub, ico] of Object.entries(PASTAS_DRIVE)) l.push({ alvo: 'drive', caminho: sub, nome: sub, ico, filho: true });
    l.push({ grupo: ' ' });
    l.push({ lixeira: true, nome: 'Lixeira', ico: '🗑️' });
    return l;
  }
  function nomeDoLugar(alvo) {
    if (alvo === 'drive') return 'Drive da empresa';
    if (alvo.startsWith('pessoal-')) return alvo === 'pessoal-voce' ? 'Pasta pessoal' : `Pasta pessoal de ${nomeDe(alvo.slice(8))}`;
    if (alvo === 'principal') return 'Projeto principal';
    return alvo === 'voce' ? 'Meu projeto' : `Projeto de ${nomeDe(alvo)}`;
  }
  function desenharLateral() {
    $('.exp-lateral').innerHTML = lugares().map((x) => x.grupo
      ? `<div class="exp-grupo">${esc(x.grupo)}</div>`
      : `<div class="exp-lugar${x.filho ? ' filho' : ''}${(x.lixeira && st.lixeira) || (!x.lixeira && !st.lixeira && x.alvo === st.alvo && x.caminho === st.caminho) ? ' ativo' : ''}" ${x.lixeira ? 'data-lixeira="1"' : `data-alvo="${esc(x.alvo)}" data-caminho="${esc(x.caminho)}"`}>${x.ico} ${esc(x.nome)}</div>`).join('');
  }

  // ---------- navegação ----------
  async function ir(destino, registrar = true) {
    st.renomeando = null;
    st.lixeira = Boolean(destino.lixeira);
    if (!st.lixeira) { st.alvo = destino.alvo; st.caminho = destino.caminho ?? ''; }
    if (registrar) { st.hist = st.hist.slice(0, st.pos + 1); st.hist.push({ ...destino }); st.pos = st.hist.length - 1; }
    st.sel.clear(); st.ancora = null; st.filtro = ''; $('.exp-busca').value = '';
    await carregar();
  }
  async function carregar() {
    try {
      if (st.lixeira) {
        st.itens = (await api('GET', '/lixeira')).itens.map((i) => ({ ...i, modificado: i.em, origem: `${nomeDoLugar(i.alvo)} › ${i.caminho}` }));
      } else {
        const r = await api('GET', `/arquivos?alvo=${encodeURIComponent(st.alvo)}&caminho=${encodeURIComponent(st.caminho)}`);
        st.caminho = r.caminho;
        st.itens = r.itens;
      }
    } catch (e) { st.itens = []; desenhar(); return avisar(e.message); }
    desenhar();
  }
  function visiveis() {
    const f = st.filtro.toLowerCase();
    const l = st.itens.filter((i) => (st.ocultos || !i.nome.startsWith('.')) && (!f || i.nome.toLowerCase().includes(f)));
    const { col, dir } = st.ordem;
    const val = (i) => col === 'nome' ? i.nome.toLowerCase() : col === 'modificado' ? i.modificado ?? '' : col === 'tamanho' ? (i.pasta ? -1 : i.tamanho ?? 0) : col === 'tipo' ? tipoDe(i.nome, i.pasta) : col === 'de' ? i.de ?? '' : col === 'origem' ? i.origem ?? '' : '';
    return l.sort((a, b) => (st.lixeira || a.pasta === b.pasta ? (val(a) > val(b) ? dir : val(a) < val(b) ? -dir : 0) : a.pasta ? -1 : 1));
  }
  const chaveDe = (i) => (st.lixeira ? i.id : i.nome);

  // ---------- desenho ----------
  function desenhar() {
    desenharLateral();
    // trilha clicável (e alvo de soltar)
    const partes = st.lixeira ? [] : st.caminho ? st.caminho.split('/') : [];
    $('.exp-trilha').innerHTML = st.lixeira ? '<span class="exp-migalha">🗑️ Lixeira</span>'
      : [`<span class="exp-migalha" data-ir="">${esc(nomeDoLugar(st.alvo))}</span>`, ...partes.map((p, i) => `<span class="exp-sep">›</span><span class="exp-migalha" data-ir="${esc(partes.slice(0, i + 1).join('/'))}">${esc(p)}</span>`)].join('');
    for (const v of raiz.querySelectorAll('[data-vista]')) v.classList.toggle('ativo', v.dataset.vista === st.vista);
    for (const b of ['nova-pasta', 'novo-doc', 'recortar', 'copiar', 'colar', 'renomear', 'propriedades']) raiz.querySelector(`[data-x="${b}"]`).hidden = st.lixeira;
    raiz.querySelector('[data-x="restaurar"]').hidden = !st.lixeira;
    raiz.querySelector('[data-x="esvaziar"]').hidden = !st.lixeira;
    $('.exp-ocultos').hidden = st.lixeira;
    raiz.querySelector('[data-x="voltar"]').disabled = st.pos <= 0;
    raiz.querySelector('[data-x="avancar"]').disabled = st.pos >= st.hist.length - 1;
    raiz.querySelector('[data-x="subir"]').disabled = st.lixeira || !st.caminho;
    raiz.querySelector('[data-x="colar"]').disabled = !st.clip;
    const l = visiveis();
    const noDrive = st.alvo === 'drive' && !st.lixeira;
    if (!l.length) {
      main.innerHTML = `<div class="exp-vazio">${st.filtro ? 'Nada encontrado com essa busca.' : st.lixeira ? 'A lixeira está vazia.' : 'Esta pasta está vazia.<br><small>Clique com o botão direito para criar uma pasta ou um documento, ou arraste arquivos para cá.</small>'}</div>`;
    } else if (st.vista === 'icones') {
      main.innerHTML = `<div class="exp-grade">${l.map((i) => `<div class="exp-item exp-bloco${st.sel.has(chaveDe(i)) ? ' sel' : ''}${st.clip?.modo === 'recortar' && st.clip.itens.some((c) => c.alvo === st.alvo && c.caminho === juntar(st.caminho, i.nome)) ? ' recortado' : ''}" data-k="${esc(chaveDe(i))}" data-pasta="${i.pasta ? 1 : 0}" draggable="${!st.lixeira}" title="${esc(i.recado ?? i.nome)}">
          ${miniatura(i)}<div class="exp-nome">${st.renomeando === i.nome ? `<input class="exp-ren" value="${esc(i.nome)}">` : esc(i.nome)}</div>
          ${noDrive && i.de ? `<div class="exp-de">de ${esc(i.de)}</div>` : ''}</div>`).join('')}</div>`;
    } else {
      const cols = st.lixeira ? [['nome', 'Nome'], ['origem', 'Local original'], ['modificado', 'Apagado em'], ['tamanho', 'Tamanho']]
        : [['nome', 'Nome'], ['modificado', 'Modificado em'], ['tipo', 'Tipo'], ['tamanho', 'Tamanho'], ...(noDrive ? [['de', 'Enviado por']] : [])];
      main.innerHTML = `<table class="exp-tabela"><thead><tr>${cols.map(([c, t]) => `<th data-ordem="${c}">${t}${st.ordem.col === c ? (st.ordem.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead><tbody>${l.map((i) => `<tr class="exp-item${st.sel.has(chaveDe(i)) ? ' sel' : ''}${st.clip?.modo === 'recortar' && st.clip.itens.some((c) => c.alvo === st.alvo && c.caminho === juntar(st.caminho, i.nome)) ? ' recortado' : ''}" data-k="${esc(chaveDe(i))}" data-pasta="${i.pasta ? 1 : 0}" draggable="${!st.lixeira}" title="${esc(i.recado ?? '')}">
          <td class="exp-cel-nome">${iconeDe(i.nome, i.pasta)} ${st.renomeando === i.nome ? `<input class="exp-ren" value="${esc(i.nome)}">` : esc(i.nome)}</td>
          ${st.lixeira ? `<td>${esc(i.origem)}</td><td>${data(i.em)}</td><td>${i.pasta ? '' : tamanho(i.tamanho)}</td>`
            : `<td>${data(i.modificado)}</td><td>${esc(tipoDe(i.nome, i.pasta))}</td><td>${i.pasta ? `${i.itens ?? ''} ${i.itens === 1 ? 'item' : 'itens'}` : tamanho(i.tamanho)}</td>${noDrive ? `<td>${esc(i.de ?? '')}</td>` : ''}`}</tr>`).join('')}</tbody></table>`;
    }
    const ren = main.querySelector('.exp-ren');
    if (ren) { ren.focus(); const p = ren.value.lastIndexOf('.'); ren.setSelectionRange(0, p > 0 ? p : ren.value.length); }
    status();
  }
  function miniatura(i) {
    const e = ext(i.nome);
    if (!i.pasta && ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(e)) return `<img class="exp-mini" src="/previa/${encodeURIComponent(st.alvo)}/${juntar(st.caminho, i.nome).split('/').map(encodeURIComponent).join('/')}" alt="" loading="lazy">`;
    return `<div class="exp-ico">${st.alvo === 'drive' && !st.caminho && PASTAS_DRIVE[i.nome] ? PASTAS_DRIVE[i.nome] : iconeDe(i.nome, i.pasta)}</div>`;
  }
  function status() {
    const l = visiveis();
    const sel = l.filter((i) => st.sel.has(chaveDe(i)));
    const soma = sel.reduce((t, i) => t + (i.pasta ? 0 : i.tamanho ?? 0), 0);
    $('.exp-status').textContent = `${l.length} ${l.length === 1 ? 'item' : 'itens'}${sel.length ? ` · ${sel.length} selecionado${sel.length > 1 ? 's' : ''}${soma ? ` (${tamanho(soma)})` : ''}` : ''}${st.clip ? ` · ${st.clip.itens.length} ${st.clip.modo === 'copiar' ? 'copiado' : 'recortado'}${st.clip.itens.length > 1 ? 's' : ''} para colar` : ''}`;
  }
  // seleção sem redesenhar (o duplo clique precisa do mesmo elemento)
  function marcarSelecao() {
    for (const el of main.querySelectorAll('.exp-item')) el.classList.toggle('sel', st.sel.has(el.dataset.k));
    status();
  }
  const selecionados = () => visiveis().filter((i) => st.sel.has(chaveDe(i)));
  const refDe = (i) => ({ alvo: st.alvo, caminho: juntar(st.caminho, i.nome) });

  // ---------- ações ----------
  async function abrirItem(i) {
    if (st.lixeira) return;
    if (i.pasta) return ir({ alvo: st.alvo, caminho: juntar(st.caminho, i.nome) });
    abrirArquivo({ alvo: st.alvo, caminho: juntar(st.caminho, i.nome), nome: i.nome });
  }
  async function novaPasta() {
    let nome = 'Nova pasta';
    for (let n = 2; st.itens.some((i) => i.nome === nome); n++) nome = `Nova pasta (${n})`;
    try { await api('POST', '/pasta', { alvo: st.alvo, caminho: juntar(st.caminho, nome) }); await carregar(); st.sel = new Set([nome]); st.renomeando = nome; desenhar(); } catch (e) { avisar(e.message); }
  }
  async function novoDoc() {
    const nome = await perguntar({ titulo: '📄 Novo documento', texto: 'Nome do documento (sem extensão vira .md; use .html, .txt, .csv… se quiser):', campo: 'ex.: Ideias para o site', sim: 'Criar' });
    if (!nome) return;
    const arq = /\.\w{1,5}$/.test(nome) ? nome : `${nome}.md`;
    try { await api('POST', '/arquivo/novo', { alvo: st.alvo, caminho: juntar(st.caminho, arq) }); await carregar(); abrirArquivo({ alvo: st.alvo, caminho: juntar(st.caminho, arq), nome: arq, editar: true }); } catch (e) { avisar(e.message); }
  }
  async function confirmarRenomear(antigo, novo) {
    st.renomeando = null;
    novo = (novo ?? '').trim();
    if (!novo || novo === antigo) return desenhar();
    try { await api('POST', '/arquivo/renomear', { alvo: st.alvo, de: juntar(st.caminho, antigo), para: juntar(st.caminho, novo) }); st.sel = new Set([novo]); await carregar(); } catch (e) { desenhar(); avisar(e.message); }
  }
  async function apagar() {
    const l = selecionados();
    if (!l.length) return;
    if (st.lixeira) return excluirDeVez(l);
    if (!(await confirmar(l.length === 1 ? `"${l[0].nome}" vai para a lixeira. Dá para restaurar depois.` : `${l.length} itens vão para a lixeira. Dá para restaurar depois.`, { titulo: '🗑️ Mover para a lixeira?', sim: 'Apagar', perigo: true }))) return;
    for (const i of l) try { await api('POST', '/arquivo/apagar', refDe(i)); } catch (e) { avisar(e.message); }
    st.sel.clear(); await carregar();
  }
  async function excluirDeVez() {
    avisar('Para apagar de vez, use "Esvaziar a lixeira". Itens restaurados voltam ao lugar de onde saíram.', 'Lixeira');
  }
  async function restaurar() {
    for (const i of selecionados()) try { await api('POST', '/arquivo/restaurar', { id: i.id }); } catch (e) { avisar(e.message); }
    st.sel.clear(); await carregar();
  }
  async function esvaziar() {
    if (!(await confirmar('Tudo o que está na lixeira será apagado de vez. Isso não pode ser desfeito.', { titulo: '🧹 Esvaziar a lixeira?', sim: 'Esvaziar', perigo: true }))) return;
    try { await api('POST', '/lixeira/esvaziar'); await carregar(); } catch (e) { avisar(e.message); }
  }
  function prender(modo) {
    const l = selecionados();
    if (!l.length) return;
    st.clip = { modo, itens: l.map(refDe) };
    desenhar();
  }
  async function transferir(modo, itens, para) {
    let erros = 0;
    for (const de of itens) try { await api('POST', `/arquivo/${modo}`, { de, para }); } catch (e) { erros++; avisar(e.message); }
    return erros;
  }
  async function colar() {
    if (!st.clip || st.lixeira) return;
    const { modo, itens } = st.clip;
    await transferir(modo === 'copiar' ? 'copiar' : 'mover', itens, { alvo: st.alvo, pasta: st.caminho });
    if (modo === 'recortar') st.clip = null;
    await carregar();
  }
  async function duplicar() {
    await transferir('copiar', selecionados().map(refDe), { alvo: st.alvo, pasta: st.caminho });
    await carregar();
  }
  function propriedades() {
    const l = selecionados();
    if (!l.length) return avisar(`${nomeDoLugar(st.alvo)}${st.caminho ? ` › ${st.caminho.split('/').join(' › ')}` : ''}\n${st.itens.length} itens`, 'ℹ️ Propriedades da pasta');
    if (l.length > 1) return avisar(`${l.length} itens selecionados\nTamanho dos arquivos: ${tamanho(l.reduce((t, i) => t + (i.pasta ? 0 : i.tamanho ?? 0), 0))}`, 'ℹ️ Propriedades');
    const i = l[0];
    avisar([
      `Tipo: ${tipoDe(i.nome, i.pasta)}`,
      `Local: ${nomeDoLugar(st.alvo)}${st.caminho ? ` › ${st.caminho.split('/').join(' › ')}` : ''}`,
      i.pasta ? `Conteúdo: ${i.itens ?? 0} itens` : `Tamanho: ${tamanho(i.tamanho)}`,
      `Modificado em: ${data(i.modificado)}`,
      i.criado ? `Criado em: ${data(i.criado)}` : '',
      i.de ? `Enviado por: ${i.de}` : '',
      i.recado ? `Recado: ${i.recado}` : '',
    ].filter(Boolean).join('\n'), `ℹ️ ${i.nome}`);
  }

  // ---------- menu do botão direito ----------
  function menu(x, y, itens) {
    const m = $('.exp-menu');
    m.innerHTML = itens.map((i) => (i === '-' ? '<hr>' : `<button data-m="${i[0]}" ${i[2] ? 'disabled' : ''}>${i[1]}</button>`)).join('');
    m.hidden = false;
    const r = raiz.getBoundingClientRect();
    m.style.left = `${Math.min(x - r.left, r.width - 230)}px`;
    m.style.top = `${Math.min(y - r.top, r.height - m.offsetHeight - 8)}px`;
  }
  const fecharMenu = () => { $('.exp-menu').hidden = true; };
  $('.exp-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    fecharMenu();
    acao(b.dataset.m);
  });
  function acao(a) {
    const l = selecionados();
    ({
      abrir: () => l[0] && abrirItem(l[0]),
      editar: () => l[0] && abrirArquivo({ ...refDe(l[0]), nome: l[0].nome, editar: true }),
      'nova-pasta': novaPasta, 'novo-doc': novoDoc, recortar: () => prender('recortar'), copiar: () => prender('copiar'), colar, duplicar,
      renomear: () => { if (l.length === 1) { st.renomeando = l[0].nome; desenhar(); } },
      apagar, propriedades, restaurar, esvaziar,
      voltar: () => { if (st.pos > 0) { st.pos--; ir(st.hist[st.pos], false); } },
      avancar: () => { if (st.pos < st.hist.length - 1) { st.pos++; ir(st.hist[st.pos], false); } },
      subir: () => { if (!st.lixeira && st.caminho) ir({ alvo: st.alvo, caminho: st.caminho.split('/').slice(0, -1).join('/') }); },
      recarregar: carregar,
      'sel-tudo': () => { st.sel = new Set(visiveis().map(chaveDe)); marcarSelecao(); },
    })[a]?.();
  }
  raiz.querySelector('.exp-barra').addEventListener('click', (e) => {
    const b = e.target.closest('[data-x]');
    if (b) return acao(b.dataset.x);
    const v = e.target.closest('[data-vista]');
    if (v) { st.vista = v.dataset.vista; guardarPref('expVista', st.vista); desenhar(); }
    const m = e.target.closest('[data-ir]');
    if (m) ir({ alvo: st.alvo, caminho: m.dataset.ir });
  });
  raiz.querySelector('.exp-acoes').addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (b) acao(b.dataset.x); });
  raiz.querySelector('.exp-ocultos input').addEventListener('change', (e) => { st.ocultos = e.target.checked; guardarPref('expOcultos', st.ocultos ? '1' : ''); desenhar(); });
  $('.exp-busca').addEventListener('input', (e) => { st.filtro = e.target.value; desenhar(); });
  $('.exp-lateral').addEventListener('click', (e) => {
    const l = e.target.closest('.exp-lugar');
    if (!l) return;
    ir(l.dataset.lixeira ? { lixeira: true } : { alvo: l.dataset.alvo, caminho: l.dataset.caminho });
  });

  // ---------- seleção, abrir, renomear na linha ----------
  main.addEventListener('click', (e) => {
    fecharMenu();
    if (e.target.closest('.exp-ren')) return;
    const th = e.target.closest('th[data-ordem]');
    if (th) { st.ordem = { col: th.dataset.ordem, dir: st.ordem.col === th.dataset.ordem ? -st.ordem.dir : 1 }; return desenhar(); }
    const it = e.target.closest('.exp-item');
    if (!it) { st.sel.clear(); return marcarSelecao(); }
    const k = it.dataset.k;
    const l = visiveis().map(chaveDe);
    if (e.shiftKey && st.ancora != null) {
      const [a, b] = [l.indexOf(st.ancora), l.indexOf(k)].sort((x, y) => x - y);
      st.sel = new Set(l.slice(a, b + 1));
    } else if (e.ctrlKey || e.metaKey) {
      st.sel.has(k) ? st.sel.delete(k) : st.sel.add(k);
      st.ancora = k;
    } else { st.sel = new Set([k]); st.ancora = k; }
    marcarSelecao();
    main.focus();
  });
  main.addEventListener('dblclick', (e) => {
    const it = e.target.closest('.exp-item');
    if (!it || e.target.closest('.exp-ren')) return;
    const i = visiveis().find((x) => chaveDe(x) === it.dataset.k);
    if (i) abrirItem(i);
  });
  main.addEventListener('keydown', (e) => {
    const ren = e.target.closest?.('.exp-ren');
    if (ren) {
      if (e.key === 'Enter') { e.preventDefault(); confirmarRenomear(st.renomeando, ren.value); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); st.renomeando = null; desenhar(); main.focus(); }
      return;
    }
    const ctrl = e.ctrlKey || e.metaKey;
    const l = visiveis();
    const atalhos = { Delete: 'apagar', F2: 'renomear', F5: 'recarregar', Backspace: 'subir' };
    if (atalhos[e.key]) { e.preventDefault(); return acao(atalhos[e.key]); }
    if (e.key === 'Enter') { e.preventDefault(); const s = selecionados(); if (s.length === 1) abrirItem(s[0]); return; }
    if (ctrl && 'acxvd'.includes(e.key.toLowerCase())) { e.preventDefault(); return acao({ a: 'sel-tudo', c: 'copiar', x: 'recortar', v: 'colar', d: 'duplicar' }[e.key.toLowerCase()]); }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); return acao(e.key === 'ArrowLeft' ? 'voltar' : 'avancar'); }
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key) && l.length) {
      e.preventDefault();
      const ks = l.map(chaveDe);
      const atual = ks.indexOf(st.ancora);
      const passo = st.vista === 'icones' ? { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -colunas(), ArrowDown: colunas() } : { ArrowUp: -1, ArrowDown: 1 };
      const novo = e.key === 'Home' ? 0 : e.key === 'End' ? ks.length - 1 : Math.max(0, Math.min(ks.length - 1, (atual < 0 ? -1 : atual) + (passo[e.key] ?? 0)));
      st.ancora = ks[novo];
      st.sel = new Set([ks[novo]]);
      marcarSelecao();
      main.querySelector('.exp-item.sel')?.scrollIntoView({ block: 'nearest' });
    }
  });
  const colunas = () => { const g = main.querySelector('.exp-grade'); return g ? Math.max(1, Math.floor(g.clientWidth / 128)) : 1; };
  main.addEventListener('focusout', (e) => { if (e.target.classList?.contains('exp-ren') && st.renomeando) confirmarRenomear(st.renomeando, e.target.value); });
  main.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const it = e.target.closest('.exp-item');
    if (it && !st.sel.has(it.dataset.k)) { st.sel = new Set([it.dataset.k]); st.ancora = it.dataset.k; marcarSelecao(); }
    const um = selecionados().length === 1;
    if (st.lixeira) return menu(e.clientX, e.clientY, it ? [['restaurar', '↩️ Restaurar']] : [['esvaziar', '🧹 Esvaziar a lixeira']]);
    menu(e.clientX, e.clientY, it
      ? [['abrir', '📂 Abrir', !um], ['editar', '📝 Abrir no editor', !um || selecionados()[0].pasta], '-', ['recortar', '✂️ Recortar'], ['copiar', '📋 Copiar'], ['duplicar', '⧉ Duplicar'], '-', ['renomear', '✏️ Renomear', !um], ['apagar', '🗑️ Apagar'], '-', ['propriedades', 'ℹ️ Propriedades']]
      : [['nova-pasta', '📁 Nova pasta'], ['novo-doc', '📄 Novo documento'], '-', ['colar', '📌 Colar', !st.clip], ['sel-tudo', '☑️ Selecionar tudo'], '-', ['recarregar', '↻ Atualizar'], ['propriedades', 'ℹ️ Propriedades da pasta']]);
  });
  raiz.addEventListener('click', (e) => { if (!e.target.closest('.exp-menu')) fecharMenu(); });

  // ---------- arrastar e soltar ----------
  let arrastando = null;
  main.addEventListener('dragstart', (e) => {
    const it = e.target.closest('.exp-item');
    if (!it || st.lixeira) return;
    if (!st.sel.has(it.dataset.k)) { st.sel = new Set([it.dataset.k]); }
    arrastando = selecionados().map(refDe);
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', arrastando.map((x) => x.caminho).join('\n'));
    for (const el of main.querySelectorAll('.exp-item.sel')) el.classList.add('arrastado');
  });
  raiz.addEventListener('dragend', () => { arrastando = null; for (const el of raiz.querySelectorAll('.arrastado, .soltar-aqui')) el.classList.remove('arrastado', 'soltar-aqui'); });
  function destinoDoSoltar(e) {
    const pasta = e.target.closest('.exp-item[data-pasta="1"]');
    if (pasta && !pasta.classList.contains('arrastado')) return { el: pasta, alvo: st.alvo, pasta: juntar(st.caminho, pasta.dataset.k) };
    const lugar = e.target.closest('.exp-lugar[data-alvo]');
    if (lugar) return { el: lugar, alvo: lugar.dataset.alvo, pasta: lugar.dataset.caminho };
    const mig = e.target.closest('.exp-migalha[data-ir]');
    if (mig) return { el: mig, alvo: st.alvo, pasta: mig.dataset.ir };
    if (e.target.closest('.exp-main') && !st.lixeira) return { el: main, alvo: st.alvo, pasta: st.caminho };
    return null;
  }
  raiz.addEventListener('dragover', (e) => {
    if (!arrastando) return;
    const d = destinoDoSoltar(e);
    for (const el of raiz.querySelectorAll('.soltar-aqui')) if (el !== d?.el) el.classList.remove('soltar-aqui');
    if (!d) return;
    e.preventDefault();
    const outroLugar = d.alvo !== arrastando[0].alvo;
    e.dataTransfer.dropEffect = e.ctrlKey || outroLugar ? 'copy' : 'move';
    if (d.el !== main) d.el.classList.add('soltar-aqui');
  });
  raiz.addEventListener('drop', async (e) => {
    if (!arrastando) return;
    const d = destinoDoSoltar(e);
    if (!d) return;
    e.preventDefault();
    const itens = arrastando;
    arrastando = null;
    if (d.alvo === itens[0].alvo && itens.every((x) => x.caminho.split('/').slice(0, -1).join('/') === d.pasta)) return desenhar();
    // mesmo lugar: move (Ctrl copia); outro lugar (ex.: do projeto para o Drive): copia (Shift move)
    const modo = e.ctrlKey ? 'copiar' : e.shiftKey ? 'mover' : d.alvo === itens[0].alvo ? 'mover' : 'copiar';
    await transferir(modo, itens, { alvo: d.alvo, pasta: d.pasta });
    st.sel.clear();
    await carregar();
  });

  return {
    abrir(pc, destino) { st.pc = pc; st.hist = []; st.pos = -1; st.clip = st.clip && st.pc === pc ? st.clip : st.clip; return ir(destino ?? { alvo: pc, caminho: '' }); },
    recarregar: () => carregar(),
    get local() { return { alvo: st.alvo, caminho: st.caminho, lixeira: st.lixeira }; },
  };
}
