// Listas com busca: todo <select> com várias opções vira um campo em que se digita e a lista flutuante vai filtrando.
// O <select> original continua no formulário (valor, required e evento change), só fica escondido.
const MIN_OPCOES = 6;
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function montar(sel) {
  if (sel.dataset.cbx || sel.multiple || sel.hasAttribute('data-nobusca') || sel.options.length < MIN_OPCOES) return;
  sel.dataset.cbx = '1';
  const caixa = document.createElement('span'); caixa.className = 'cbx';
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'cbx-in'; inp.autocomplete = 'off'; inp.spellcheck = false;
  const lista = document.createElement('div'); lista.className = 'cbx-lista'; lista.hidden = true;
  sel.parentNode.insertBefore(caixa, sel); caixa.append(sel, inp, lista);
  sel.classList.add('cbx-sel'); sel.tabIndex = -1;
  let itens = [], ativo = -1;
  const textoSel = () => { const o = sel.options[sel.selectedIndex]; return o && o.value !== '' ? o.text : ''; };
  const vazio = () => { const o = [...sel.options].find(o => o.value === ''); return o ? o.text : 'Selecione…'; };
  const sync = () => { inp.value = textoSel(); inp.placeholder = vazio(); inp.disabled = sel.disabled; };
  const desenhar = (filtro) => {
    const f = norm(filtro);
    itens = [...sel.options].filter(o => !o.disabled && (!f || norm(o.text).includes(f)));
    ativo = itens.findIndex(o => o.value === sel.value && o.value !== '');
    lista.innerHTML = itens.slice(0, 300).map((o, i) => `<div class="cbx-op${i === ativo ? ' ativo' : ''}${o.value === '' ? ' cbx-vazio' : ''}" data-i="${i}"></div>`).join('') || '<div class="cbx-nada">Nada encontrado</div>';
    lista.querySelectorAll('[data-i]').forEach(d => { d.textContent = itens[+d.dataset.i].text; });
    lista.hidden = false;
    lista.querySelector('.ativo')?.scrollIntoView({ block: 'nearest' });
  };
  const escolher = (o) => {
    if (!o) return;
    const mudou = sel.value !== o.value;
    sel.value = o.value; sync(); lista.hidden = true;
    if (mudou) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  inp.addEventListener('focus', () => { inp.select(); desenhar(''); });
  inp.addEventListener('input', () => desenhar(inp.value));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (lista.hidden) desenhar('');
      ativo = Math.max(0, Math.min(itens.length - 1, ativo + (e.key === 'ArrowDown' ? 1 : -1)));
      lista.querySelectorAll('.cbx-op').forEach((d, i) => d.classList.toggle('ativo', i === ativo));
      lista.querySelector('.ativo')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (!lista.hidden) { e.preventDefault(); escolher(itens[ativo >= 0 ? ativo : 0]); }
    } else if (e.key === 'Escape') { lista.hidden = true; sync(); }
  });
  lista.addEventListener('mousedown', (e) => { const d = e.target.closest('[data-i]'); if (d) { e.preventDefault(); escolher(itens[+d.dataset.i]); } });
  inp.addEventListener('blur', () => { setTimeout(() => { lista.hidden = true; sync(); }, 120); });
  sel.addEventListener('change', sync);
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
  sync();
}

export function ativarBusca(raiz = document.body) {
  const varrer = (n) => { if (n.nodeType !== 1) return; if (n.tagName === 'SELECT') montar(n); else if (n.tagName === 'OPTION' && n.parentElement?.tagName === 'SELECT') montar(n.parentElement); else n.querySelectorAll?.('select').forEach(montar); };
  varrer(raiz);
  new MutationObserver((ms) => ms.forEach(m => m.addedNodes.forEach(varrer))).observe(raiz, { childList: true, subtree: true });
}
