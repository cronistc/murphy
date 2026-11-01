// O trabalho visto como gente vê: cada passo de uma sessão vira algo visual
// (a página, o documento, a imagem, o código com o trecho mudado, o comando
// com ✓/✗, a pesquisa com os sites achados), e uma entrega vira prévias.

const IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
const ext = (n) => (n.includes('.') ? n.split('.').pop().toLowerCase() : '');
const TESTE = /\b(npm (run )?test|pytest|jest|vitest|node --test|go test|cargo test|mocha|playwright test)\b/;
const nomeCurto = (rel) => rel.split('/').pop();

// Eventos de uma sessão → passos legíveis.
export function passosDaSessao(eventos, pasta = '') {
  const resultados = new Map();
  for (const ev of eventos) if (ev.tipo === 'ferramenta_resultado') resultados.set(ev.idChamada, ev);
  const relativo = (abs) => {
    if (!abs) return '';
    let r = abs.startsWith(pasta) ? abs.slice(pasta.length) : abs;
    return r.replace(/^\/+/, '');
  };
  const passos = [];
  for (const ev of eventos) {
    if (ev.tipo === 'ferramenta_chamada') {
      const r = resultados.get(ev.idChamada);
      const ok = r ? !r.erro : null;
      const f = ev.ferramenta;
      const base = { em: ev.em, ok, saida: r?.detalhe ?? r?.resumo ?? '' };
      if (f === 'Write') passos.push({ ...base, tipo: 'arquivo', icone: '📝', texto: `Escreveu ${nomeCurto(relativo(ev.resumo))}`, arquivo: relativo(ev.resumo), novo: (ev.detalhe ?? '').split('\n').slice(1).join('\n') });
      else if (f === 'Edit' || f === 'MultiEdit') {
        const novo = (ev.detalhe ?? '').split('\n').filter((l) => l.startsWith('+ ')).map((l) => l.slice(2)).join('\n');
        passos.push({ ...base, tipo: 'arquivo', icone: '✏️', texto: `Editou ${nomeCurto(relativo(ev.resumo))}`, arquivo: relativo(ev.resumo), novo });
      } else if (f === 'Read') passos.push({ ...base, tipo: 'arquivo', icone: '📖', texto: `Leu ${nomeCurto(relativo(ev.resumo))}`, arquivo: relativo(ev.resumo), leitura: true });
      else if (f === 'Bash') {
        const cmd = (ev.detalhe ?? ev.resumo ?? '').replace(/^\$ /, '');
        const teste = TESTE.test(cmd);
        passos.push({ ...base, tipo: 'comando', icone: teste ? '🧪' : '⌨️', texto: teste ? 'Rodou os testes' : `Rodou: ${cmd.split('\n')[0].slice(0, 60)}`, comando: cmd });
      } else if (f === 'WebSearch') passos.push({ ...base, tipo: 'pesquisa', icone: '🔍', texto: `Pesquisou: ${ev.resumo}`, consulta: ev.resumo });
      else if (f === 'WebFetch') { let host = ev.resumo; try { host = new URL(ev.resumo).host; } catch {} passos.push({ ...base, tipo: 'site', icone: '🌐', texto: `Abriu ${host}`, url: ev.resumo }); }
      else if (f === 'Glob' || f === 'Grep') passos.push({ ...base, tipo: 'busca', icone: '🔎', texto: `Procurou ${ev.resumo.slice(0, 50)}` });
      else if (f.endsWith('falar_com_colega')) passos.push({ ...base, tipo: 'conversa', icone: '💬', texto: 'Falou com um colega', fala: ev.detalhe ?? ev.resumo });
      else if (f.endsWith('pedir_aval_do_chefe')) passos.push({ ...base, tipo: 'conversa', icone: '🙋', texto: 'Pediu aval ao chefe', fala: ev.detalhe ?? ev.resumo });
      else if (f.endsWith('pedir_acesso') || f.endsWith('esperar_resposta')) passos.push({ ...base, tipo: 'conversa', icone: '🔑', texto: 'Pediu algo ao gestor', fala: ev.detalhe ?? ev.resumo });
      else if (f.endsWith('compartilhar_com_gestor')) passos.push({ ...base, tipo: 'conversa', icone: '🗂️', texto: 'Pôs algo no Drive', fala: ev.detalhe ?? ev.resumo });
      else if (f === 'TodoWrite') passos.push({ ...base, tipo: 'plano', icone: '🗒️', texto: 'Organizou os passos', plano: ev.detalhe ?? '' });
      else passos.push({ ...base, tipo: 'outro', icone: '🔧', texto: f.replace(/^mcp__\w+__/, '').replace(/_/g, ' ') });
    } else if (ev.tipo === 'texto' && ev.texto.trim()) {
      passos.push({ em: ev.em, tipo: 'pensamento', icone: '💭', texto: ev.texto.replace(/[*`#]/g, '').split('\n')[0].slice(0, 90), fala: ev.texto });
    } else if (ev.tipo === 'tarefa_terminada') {
      passos.push({ em: ev.em, tipo: 'fim', icone: ev.sucesso ? '✅' : '⚠️', texto: ev.sucesso ? 'Terminou a tarefa' : 'Não conseguiu terminar', fala: ev.resultado ?? '' });
    }
  }
  return passos;
}

// Arquivos que a sessão criou ou mudou (os que valem uma prévia na entrega).
export function arquivosMudados(passos) {
  const vistos = [];
  for (const p of passos) if (p.tipo === 'arquivo' && !p.leitura && p.arquivo && !vistos.includes(p.arquivo)) vistos.push(p.arquivo);
  return vistos.sort((a, b) => peso(a) - peso(b));
}
// o que um leigo quer ver primeiro: páginas, imagens, documentos; código por último
const peso = (n) => (/\.html?$/i.test(n) ? 0 : IMG.test(n) ? 1 : /\.(md|txt|csv)$/i.test(n) ? 2 : 3);

// Desenha um passo (ou um arquivo) como ele é: página, documento, imagem, código, comando…
export async function desenharVisual(el, alvo, passo, dep) {
  const { api, esc, mdParaHtml } = dep;
  const url = (rel) => `/previa/${encodeURIComponent(alvo)}/${rel.split('/').map(encodeURIComponent).join('/')}?v=${Date.now()}`;
  if (!passo) { el.innerHTML = '<div class="tv-vazio">Nada na tela ainda.</div>'; return; }
  if (passo.tipo === 'arquivo' && passo.arquivo) {
    const rel = passo.arquivo;
    const cab = `<div class="tv-cab">${passo.icone} <b>${esc(rel)}</b>${passo.leitura ? ' <span>(lendo)</span>' : ''}</div>`;
    if (/\.html?$/i.test(rel)) { el.innerHTML = `${cab}<iframe class="tv-pagina" src="${url(rel)}" sandbox="allow-scripts allow-same-origin"></iframe>`; return; }
    if (IMG.test(rel)) { el.innerHTML = `${cab}<div class="tv-img"><img src="${url(rel)}" alt=""></div>`; return; }
    let texto = '';
    try { const r = await api('GET', `/arquivo?alvo=${encodeURIComponent(alvo)}&caminho=${encodeURIComponent(rel)}`); texto = r.texto ?? ''; } catch (e) { el.innerHTML = `${cab}<div class="tv-vazio">${esc(e.message)}</div>`; return; }
    if (/\.md$/i.test(rel)) { el.innerHTML = `${cab}<div class="tv-doc doc">${mdParaHtml(texto)}</div>`; marcarNoDoc(el, passo.novo); return; }
    if (/\.csv$/i.test(rel)) { el.innerHTML = `${cab}<div class="tv-doc">${tabelaCsv(texto, esc)}</div>`; return; }
    el.innerHTML = `${cab}${codigo(texto, passo.novo, esc)}`;
    el.querySelector('.tv-linha.nova')?.scrollIntoView({ block: 'center' });
    return;
  }
  if (passo.tipo === 'comando') {
    const ok = passo.ok === null ? '<span class="tv-rodando">rodando…</span>' : passo.ok ? '<span class="tv-ok">✓ deu certo</span>' : '<span class="tv-erro">✗ deu erro</span>';
    el.innerHTML = `<div class="tv-cab">${passo.icone} <b>${esc(passo.texto)}</b> ${ok}</div><div class="tv-terminal"><div class="tv-cmd">$ ${esc(passo.comando)}</div><pre>${esc((passo.saida || '').slice(-3000))}</pre></div>`;
    return;
  }
  if (passo.tipo === 'pesquisa' || passo.tipo === 'site') {
    const links = [...new Set((passo.saida || '').match(/https?:\/\/[^\s)"'\]]+/g) ?? [])].slice(0, 8);
    el.innerHTML = `<div class="tv-cab">${passo.icone} <b>${esc(passo.texto)}</b></div><div class="tv-pesquisa">${links.map((l) => { let h = l; try { h = new URL(l).host; } catch {} return `<div class="tv-res"><b>${esc(h)}</b><span>${esc(l)}</span></div>`; }).join('') || `<pre>${esc((passo.saida || '').slice(0, 1500))}</pre>`}</div>`;
    return;
  }
  el.innerHTML = `<div class="tv-cab">${passo.icone} <b>${esc(passo.texto)}</b></div><div class="tv-doc doc">${mdParaHtml(passo.fala || passo.plano || passo.saida || '')}</div>`;
}

function codigo(texto, novo, esc) {
  const linhas = texto.split('\n');
  const marcadas = new Set();
  const alvo = (novo ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 3);
  if (alvo.length) linhas.forEach((l, i) => { if (alvo.includes(l.trim())) marcadas.add(i); });
  return `<div class="tv-codigo">${linhas.slice(0, 3000).map((l, i) => `<div class="tv-linha${marcadas.has(i) ? ' nova' : ''}"><span class="n">${i + 1}</span><span class="t">${esc(l) || ' '}</span></div>`).join('')}</div>`;
}
function marcarNoDoc(el, novo) {
  const alvo = (novo ?? '').split('\n').map((l) => l.replace(/^[#>*\-\d. ]+/, '').trim()).filter((l) => l.length > 8);
  if (!alvo.length) return;
  for (const b of el.querySelectorAll('.tv-doc p, .tv-doc li, .tv-doc h1, .tv-doc h2, .tv-doc h3')) {
    if (alvo.some((a) => b.textContent.includes(a.slice(0, 40)))) b.classList.add('tv-novo');
  }
  el.querySelector('.tv-novo')?.scrollIntoView({ block: 'center' });
}
function tabelaCsv(t, esc) {
  const linhas = t.trim().split('\n').slice(0, 200).map((l) => l.split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, '')));
  return `<table class="tv-tabela">${linhas.map((l, i) => `<tr>${l.map((c) => (i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`)).join('')}</tr>`).join('')}</table>`;
}
