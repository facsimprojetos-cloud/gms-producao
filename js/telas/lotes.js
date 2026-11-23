import { db, tem } from '../app.js';
import { PREVISAO_DIAS } from '../config.js';
import { h, num, moeda, data, dataHora, chip, modal, chamar, ler, cadastros, opcoes, toast, token, hojeISO, confirmar, contem, formModal, pedirTexto } from '../util.js';
import { imprimirRomaneio, imprimirFolhaFaccao } from '../romaneio.js';

let aba = 'separar';
let busca = '';
const selecionados = new Map(); // sublote_id -> qtd
const abertos = new Set();      // cortes com as variações abertas

export async function render(el) {
  if (aba === 'remessas') return renderRemessas(el);
  const cad = await cadastros(db);
  const todos = await ler(db.from('v_sublotes').select('*').gt('qtd_saldo', 0).order('criado_em', { ascending: false }).order('tamanho_ordem').order('codigo').limit(1500));
  todos.forEach(s => { s.produto = cad.produtos.find(p => p.id === s.produto_id)?.nome || s.produto; });
  const lista = todos.filter(s => aba === 'envio' ? s.faccao_corte_id : !s.faccao_corte_id);
  const pode = tem('faccao');
  const filtrada = lista.filter(s => contem(s, ['codigo', 'lote', 'produto', 'cor', 'tamanho', 'faccao_corte'], busca));
  for (const id of selecionados.keys()) if (!lista.some(s => s.id === id)) selecionados.delete(id);
  const grupos = new Map(); // por corte: o lote fica fechado numa linha; "Ver variações" abre cor × tamanho
  filtrada.forEach(s => { if (!grupos.has(s.corte_id)) grupos.set(s.corte_id, []); grupos.get(s.corte_id).push(s); });
  const sup = tem('supervisor');
  const ncol = pode ? 8 : 6;
  const estado = (itens) => { const n = itens.filter(s => selecionados.has(s.id)).length; return n === 0 ? '' : n === itens.length ? 'checked' : 'data-meio'; };

  el.innerHTML = `
    ${cab(pode)}
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Lote, produto, cor, facção…"></label></div>
    <p class="muted peq">${num(grupos.size)} lote(s) · ${num(filtrada.reduce((a, s) => a + s.qtd_saldo, 0))} peças. Marque o lote inteiro ou abra as variações para escolher cor × tamanho.</p>
    <div class="tabela-wrap"><table>
      <thead><tr>${pode ? '<th></th>' : ''}<th>Sublote</th><th>Produto</th><th>Cor</th><th>Tam.</th><th class="n">Cortado</th><th class="n">A distribuir</th>${pode ? '<th class="n">Enviar</th>' : ''}</tr></thead>
      <tbody>${[...grupos.entries()].map(([cid, itens]) => {
        const x = itens[0], aberto = abertos.has(cid);
        const cores = [...new Set(itens.map(s => s.cor))], tams = [...new Set(itens.map(s => s.tamanho))];
        return `
        <tr class="grupo lote-linha">${pode ? `<td><input type="checkbox" data-lote="${cid}" ${estado(itens)}></td>` : ''}
          <td colspan="${ncol - (pode ? 2 : 1)}"><button class="btn peq" data-abrir="${cid}">${aberto ? '▾' : '▸'} ${aberto ? 'Fechar' : 'Ver variações'}</button>
            <b style="margin-left:8px">Lote ${h(x.lote || '(sem número)')}</b> · ${h(x.produto)}${x.faccao_corte ? ` · <b>${h(x.faccao_corte)}</b>` : ''}
            <span class="muted peq"> · ${cores.length} cor(es) · ${h(tams.join(' '))}</span>
            ${sup ? `<button class="btn peq perigo" data-apagar="${cid}" style="margin-left:8px">🗑 Apagar lote</button>` : ''}</td>
          <td class="n forte">${num(itens.reduce((a, s) => a + s.qtd_saldo, 0))}</td></tr>
        ${aberto ? itens.map(s => `<tr>
          ${pode ? `<td><input type="checkbox" data-sel="${s.id}" ${selecionados.has(s.id) ? 'checked' : ''}></td>` : ''}
          <td class="forte">${h(s.codigo)}</td><td>${h(s.produto)}</td><td>${h(s.cor)}</td><td>${h(s.tamanho)}</td>
          <td class="n">${num(s.qtd_cortada)}</td><td class="n forte">${num(s.qtd_saldo)}</td>
          ${pode ? `<td class="n"><input class="inp num" type="number" min="1" max="${s.qtd_saldo}" data-qtd="${s.id}" value="${selecionados.get(s.id) ?? s.qtd_saldo}"></td>` : ''}
        </tr>`).join('') : ''}`; }).join('') || `<tr><td colspan="${ncol}" class="vazio">${aba === 'envio' ? 'Nenhum lote aguardando envio.' : 'Nenhum lote aguardando distribuição.'}</td></tr>`}
      </tbody></table></div>`;

  ligarAbas(el);
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelectorAll('[data-meio]').forEach(cb => { cb.indeterminate = true; });
  const btn = el.querySelector('#enviar');
  const atualizar = () => { if (btn) { btn.disabled = !selecionados.size; btn.textContent = `Enviar para facção (${selecionados.size})`; } };
  el.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => { const id = b.dataset.abrir; abertos.has(id) ? abertos.delete(id) : abertos.add(id); render(el); });
  el.querySelectorAll('[data-sel]').forEach(cb => cb.onchange = () => {
    const id = cb.dataset.sel, qi = el.querySelector(`[data-qtd="${id}"]`);
    if (cb.checked) selecionados.set(id, +qi.value); else selecionados.delete(id);
    render(el);
  });
  el.querySelectorAll('[data-lote]').forEach(cb => cb.onchange = () => {
    const itens = grupos.get(cb.dataset.lote);
    itens.forEach(s => cb.checked ? selecionados.set(s.id, selecionados.get(s.id) ?? s.qtd_saldo) : selecionados.delete(s.id));
    render(el);
  });
  el.querySelectorAll('[data-apagar]').forEach(b => b.onclick = async () => {
    const itens = grupos.get(b.dataset.apagar), x = itens[0];
    const m = await pedirTexto(`Apagar lote ${x.lote || '(sem número)'}`, `O corte deste lote (${h(x.produto)}, ${num(itens.reduce((a, s) => a + s.qtd_cortada, 0))} peças) e todos os sublotes serão apagados. Só é possível se nada foi enviado.`, { botao: 'Apagar lote' });
    if (m && await chamar(db, 'apagar_lote', { p_corte_id: b.dataset.apagar, p_motivo: m })) { itens.forEach(s => selecionados.delete(s.id)); toast('Lote apagado.', 'ok'); render(el); }
  });
  el.querySelectorAll('[data-qtd]').forEach(i => i.oninput = () => { if (selecionados.has(i.dataset.qtd)) selecionados.set(i.dataset.qtd, +i.value); });
  atualizar();
  btn?.addEventListener('click', () => {
    const itens = lista.filter(s => selecionados.has(s.id));
    const facs = [...new Set(itens.map(s => s.faccao_corte_id).filter(Boolean))];
    if (facs.length > 1) return toast('Selecione lotes de uma facção só por envio.', 'erro');
    telaEnvio(itens, () => render(el), facs[0] || null);
  });
}

function cab(pode) {
  return `<div class="cab"><div><h1>2 - Lotes / Envio</h1><p>Aguardando distribuição: lotes cortados sem facção. Aguardando envio: lotes que já têm facção definida no corte. Ao enviar sai a folha da facção (romaneio + aviamentos).</p></div>
      ${pode && aba !== 'remessas' ? `<button class="btn acento" id="enviar" ${selecionados.size ? '' : 'disabled'}>Enviar para facção (${selecionados.size})</button>` : ''}</div>
    <div class="abas">
      <button data-a="separar" class="${aba === 'separar' ? 'ativo' : ''}">Aguardando distribuição</button>
      <button data-a="envio" class="${aba === 'envio' ? 'ativo' : ''}">Aguardando envio</button>
      <button data-a="remessas" class="${aba === 'remessas' ? 'ativo' : ''}">Romaneios</button>
    </div>`;
}
function ligarAbas(el) { el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; selecionados.clear(); render(el); }); }

async function telaEnvio(itens, depois, facPadrao = null) {
  const cad = await cadastros(db);
  const previsao = new Date(Date.now() + PREVISAO_DIAS * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const tk = token();
  const corpo = `
    <div class="grade g2">
      <label class="campo">Facção<select id="fac">${opcoes(cad.faccoes.filter(f => f.ativo), facPadrao)}</select></label>
      <label class="campo">Previsão de retorno<input type="date" id="prev" value="${previsao}" min="${hojeISO()}"></label>
    </div>
    <div class="tabela-wrap" style="margin-top:12px"><table>
      <thead><tr><th>Sublote</th><th>Produto</th><th>Cor/Tam</th><th class="n">Qtd</th></tr></thead>
      <tbody>${itens.map(s => `<tr data-id="${s.id}">
          <td>${h(s.codigo)}</td><td>${h(s.produto)}</td><td>${h(s.cor)} / ${h(s.tamanho)}</td>
          <td class="n"><input class="inp num" type="number" min="1" max="${s.qtd_saldo}" data-campo="qtd" value="${selecionados.get(s.id) || s.qtd_saldo}"></td></tr>`).join('')}</tbody>
      <tfoot><tr class="grupo"><td colspan="3">Total</td><td class="n" id="tq"></td></tr></tfoot></table></div>
    <p class="muted peq">O valor por peça é lançado no fechamento da facção. Os aviamentos saem na folha da facção, calculados pela ficha técnica.</p>
    <label class="campo" style="margin-top:10px">Observação<input id="obs"></label>
    <p class="muted peq" id="aviso-int"></p>`;
  modal({
    titulo: 'Enviar para facção', corpo, largo: true,
    aoAbrir: (m) => {
      const atualizar = () => {
        const fac = cad.faccoes.find(f => f.id === +m.querySelector('#fac').value);
        m.querySelector('#aviso-int').textContent = fac?.interna ? 'Produção interna: o lote aparece em Produção para a supervisora acompanhar.' : '';
        m.querySelector('#tq').textContent = num([...m.querySelectorAll('[data-campo=qtd]')].reduce((a, i) => a + (+i.value || 0), 0));
      };
      m.addEventListener('input', atualizar); m.addEventListener('change', atualizar); atualizar();
    },
    botoes: [{ texto: 'Cancelar' }, {
      texto: 'Confirmar envio', classe: 'pri', acao: async (m) => {
        const fac = +m.querySelector('#fac').value;
        if (!fac) { toast('Selecione a facção.', 'erro'); return false; }
        const lista = [...m.querySelectorAll('tbody tr')].map(tr => ({ sublote_id: tr.dataset.id, qtd: +tr.querySelector('[data-campo=qtd]').value }));
        if (lista.some(x => !(x.qtd > 0))) { toast('Quantidade inválida.', 'erro'); return false; }
        const nomeFac = cad.faccoes.find(f => f.id === fac)?.nome || '';
        if (!await confirmar('Confirmar envio', `Enviar <b>${num(lista.reduce((a, x) => a + x.qtd, 0))}</b> peças para <b>${h(nomeFac)}</b>?`)) return false;
        const r = await chamar(db, 'enviar_faccao', { p_faccao_id: fac, p_itens: lista, p_token: tk, p_previsao: m.querySelector('#prev').value || null, p_aviamentos: null, p_obs: m.querySelector('#obs').value || null });
        if (!r) return false;
        selecionados.clear();
        const nr = (r.remessa_ids || [r.remessa_id]).length;
        toast(r.ja_processado ? 'Envio já havia sido registrado.' : `Enviado: ${num(r.qtd_total)} peças · ${nr} romaneio(s), um por lote.`, 'ok');
        depois();
        if (await confirmar('Folha da facção', `Imprimir ${nr > 1 ? `os ${nr} romaneios (um por lote)` : 'o romaneio'} com aviamentos, 2 vias cada?`, 'Imprimir')) imprimirFolhaFaccao(r.remessa_ids || r.remessa_id);
      }
    }]
  });
}

async function renderRemessas(el) {
  const cad = await cadastros(db);
  const rems = await ler(db.from('v_romaneios').select('*').order('data', { ascending: false }).limit(300));
  const pode = tem('faccao');
  rems.forEach(r => { r.lotes = r.lotes || ''; r.produtos = (r.produto_ids || []).map(id => cad.produtos.find(p => p.id === id)?.nome || '').join(', '); });
  const lista = rems.filter(r => contem(r, ['lotes', 'produtos', 'faccao', 'obs'], busca));
  el.innerHTML = `${cab(pode)}
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Lote, produto, facção…"></label></div>
    <div class="tabela-wrap"><table><thead><tr><th>Lote</th><th>Produto</th><th>Facção</th><th>Data de envio</th><th class="n">Peças</th><th></th></tr></thead>
    <tbody>${lista.map(r => `<tr><td class="forte" style="white-space:nowrap">${h(r.lotes)}</td><td>${h(r.produtos)}</td><td>${h(r.faccao)}</td><td>${data(r.data)}</td><td class="n">${num(r.qtd_total)}</td>
      <td><div class="acoes"><button class="btn peq pri" data-folha="${r.id}">🖨 Folha da facção</button>${pode ? `<button class="btn peq" data-ed="${r.id}">Editar</button>` : ''}</div></td></tr>`).join('')
      || '<tr><td colspan="6" class="vazio">Nenhum romaneio.</td></tr>'}</tbody></table></div>`;
  ligarAbas(el);
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelectorAll('[data-folha]').forEach(b => b.onclick = () => imprimirFolhaFaccao(b.dataset.folha));
  el.querySelectorAll('[data-ed]').forEach(b => b.onclick = async () => {
    const r = rems.find(x => x.id === b.dataset.ed);
    const v = await formModal({ titulo: `Romaneio do lote ${r.lotes} — ${r.faccao}`, campos: [
      { k: 'previsao', r: 'Previsão de retorno', tipo: 'date', valor: r.previsao },
      { k: 'obs', r: 'Observação', valor: r.obs }] });
    if (!v) return;
    const { previsao, obs } = v;
    if (await chamar(db, 'editar_remessa', { p_remessa_id: r.id, p_previsao: previsao, p_aviamentos: { vies: r.vies, fio: r.fio, linha: r.linha, elastico: r.elastico, alca: r.alca, etiqueta: r.etiqueta }, p_obs: obs })) { toast('Romaneio atualizado.', 'ok'); render(el); }
  });
}
