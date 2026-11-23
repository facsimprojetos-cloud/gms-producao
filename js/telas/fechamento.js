import { db, tem } from '../app.js';
import { EMPRESA } from '../config.js';
import { h, num, moeda, data, chip, modal, chamar, ler, cadastros, opcoes, toast, hojeISO, confirmar, pedirTexto, imprimirHtml } from '../util.js';

// Fechamento da facção: tudo o que retornou (lançado no app) entra aqui. O valor por peça é definido no fechamento.
// Valor = (peças boas + consertos) × valor por peça. Conserto é pago junto com o lote; defeito é descontado (não pago).
let aba = 'abertos';
let fFac = '';
const marcados = new Set();
const valores = new Map(); // retorno_id -> valor por peça digitado

export async function render(el) {
  const pode = tem('financeiro');
  const cad = await cadastros(db);
  el.innerHTML = `
    <div class="cab"><div><h1>Fechamento de Facção</h1><p>Valor = (peças boas + consertos) × valor por peça. Peças com defeito são descontadas.</p></div></div>
    <div class="abas">
      <button data-a="abertos" class="${aba === 'abertos' ? 'ativo' : ''}">A pagar</button>
      <button data-a="pagos" class="${aba === 'pagos' ? 'ativo' : ''}">Pagamentos realizados</button>
    </div>
    <div class="filtros"><label class="campo">Facção<select id="ff">${opcoes(cad.faccoes.filter(f => !f.interna), fFac, 'nome', 'id', aba === 'abertos' ? 'Todas (resumo)' : 'Todas')}</select></label></div>
    <div id="alvo"></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; marcados.clear(); render(el); });
  el.querySelector('#ff').onchange = (e) => { fFac = e.target.value; marcados.clear(); render(el); };
  const alvo = el.querySelector('#alvo');
  if (aba === 'pagos') return renderPagos(alvo, el);

  let qr = db.from('v_retornos').select('*').eq('pago', false).eq('historico', false).eq('interna', false).order('data_retorno');
  if (fFac) qr = qr.eq('faccao_id', +fFac);
  const rets = await ler(qr);

  if (!fFac) {
    const porFac = new Map();
    rets.forEach(r => { if (!porFac.has(r.faccao_id)) porFac.set(r.faccao_id, { nome: r.faccao, n: 0, p: 0 }); const x = porFac.get(r.faccao_id); x.n++; x.p += r.qtd_paga; });
    alvo.innerHTML = `<div class="lista-cards">${[...porFac.entries()].sort((a, b) => b[1].p - a[1].p).map(([id, x]) => `<div class="item"><div class="tit">${h(x.nome)}</div>
      <div class="det">${x.n} retorno(s)</div><div style="font-size:1.4rem;font-weight:900;margin:6px 0">${num(x.p)} peças</div>
      <button class="btn pri peq" data-fac="${id}">Abrir</button></div>`).join('') || '<div class="vazio">Nenhum retorno a pagar.</div>'}</div>`;
    alvo.querySelectorAll('[data-fac]').forEach(b => b.onclick = () => { fFac = b.dataset.fac; render(el); });
    return;
  }

  const vu = (r) => valores.has(r.id) ? valores.get(r.id) : (r.valor_faccao ?? '');
  const total = () => rets.filter(r => marcados.has(r.id)).reduce((a, r) => a + r.qtd_paga * (+vu(r) || 0), 0);
  alvo.innerHTML = `
    <div class="tabela-wrap"><table><thead><tr>${pode ? '<th><input type="checkbox" id="todos"></th>' : ''}<th>Retorno</th><th>Sublote</th><th>Produto</th><th>Cor</th><th>Tam.</th>
      <th class="n">Boas</th><th class="n">Consertos</th><th class="n">Defeito</th><th class="n">A pagar</th><th class="n">R$ por peça</th><th class="n">Valor total</th></tr></thead>
    <tbody>${rets.map(r => `<tr>${pode ? `<td><input type="checkbox" data-m="${r.id}" ${marcados.has(r.id) ? 'checked' : ''}></td>` : ''}
        <td>${data(r.data_retorno)}</td><td>${h(r.lote)}</td><td>${h(cad.produtos.find(p => p.id === r.produto_id)?.nome || r.produto)}</td><td>${h(r.cor)}</td><td>${h(r.tamanho)}</td>
        <td class="n">${num(r.qtd)}</td><td class="n">${num(r.qtd_conserto)}</td><td class="n">${r.qtd_defeito ? chip(num(r.qtd_defeito), 'erro') : 0}</td><td class="n forte">${num(r.qtd_paga)}</td>
        <td class="n">${pode ? `<input class="inp num" type="number" min="0" step="0.01" data-v="${r.id}" value="${vu(r)}">` : moeda(vu(r))}</td>
        <td class="n forte" data-t="${r.id}">${moeda(r.qtd_paga * (+vu(r) || 0))}</td></tr>`).join('')
      || '<tr><td colspan="12" class="vazio">Nada a pagar para esta facção.</td></tr>'}</tbody></table></div>
    ${pode && rets.length ? `<div class="card" style="margin-top:12px"><div class="grade g4">
      <label class="campo">Selecionado<input id="tsel" readonly></label>
      <label class="campo">Desconto (R$)<input type="number" id="desc" min="0" step="0.01" value="0"></label>
      <label class="campo">Data do pagamento<input type="date" id="dt" value="${hojeISO()}"></label>
      <label class="campo">Observação<input id="obs"></label></div>
      <div class="acoes" style="margin-top:10px"><span id="tliq" class="forte"></span><button class="btn pri" id="pagar">Registrar pagamento</button></div></div>` : ''}`;
  const atualizar = () => {
    if (!pode) return;
    const t = total(), d = +(alvo.querySelector('#desc')?.value || 0);
    const ts = alvo.querySelector('#tsel'); if (ts) ts.value = `${marcados.size} retorno(s) · ${moeda(t)}`;
    const tl = alvo.querySelector('#tliq'); if (tl) tl.textContent = `Total a pagar: ${moeda(Math.max(0, t - d))}`;
  };
  alvo.querySelectorAll('[data-m]').forEach(cb => cb.onchange = () => { cb.checked ? marcados.add(cb.dataset.m) : marcados.delete(cb.dataset.m); atualizar(); });
  alvo.querySelectorAll('[data-v]').forEach(i => i.oninput = () => {
    valores.set(i.dataset.v, i.value); const r = rets.find(x => x.id === i.dataset.v);
    alvo.querySelector(`[data-t="${i.dataset.v}"]`).textContent = moeda(r.qtd_paga * (+i.value || 0)); atualizar();
  });
  alvo.querySelector('#todos')?.addEventListener('change', (e) => { alvo.querySelectorAll('[data-m]').forEach(cb => { cb.checked = e.target.checked; e.target.checked ? marcados.add(cb.dataset.m) : marcados.delete(cb.dataset.m); }); atualizar(); });
  alvo.querySelector('#desc')?.addEventListener('input', atualizar);
  atualizar();
  alvo.querySelector('#pagar')?.addEventListener('click', async () => {
    if (!marcados.size) return toast('Selecione os retornos.', 'erro');
    const itens = rets.filter(r => marcados.has(r.id)).map(r => ({ retorno_id: r.id, valor_unit: vu(r) === '' ? null : +vu(r) }));
    if (itens.some(i => i.valor_unit == null || i.valor_unit < 0)) return toast('Informe o valor por peça de todos os retornos selecionados.', 'erro');
    const d = +(alvo.querySelector('#desc').value || 0), t = total();
    if (d < 0 || d > t) return toast('Desconto inválido.', 'erro');
    const nome = cad.faccoes.find(f => String(f.id) === fFac)?.nome;
    if (!await confirmar('Registrar pagamento', `Pagar <b>${moeda(t - d)}</b> para <b>${h(nome)}</b>?`, 'Registrar')) return;
    const r = await chamar(db, 'registrar_fechamento', { p_faccao_id: +fFac, p_itens: itens, p_desconto: d, p_data: alvo.querySelector('#dt').value || null, p_obs: alvo.querySelector('#obs').value || null });
    if (!r) return;
    marcados.clear(); itens.forEach(i => valores.delete(i.retorno_id)); toast('Pagamento registrado.', 'ok');
    if (await confirmar('Recibo', 'Imprimir o recibo deste pagamento?', 'Imprimir')) recibo(r);
    render(el);
  });
}

async function renderPagos(alvo, el) {
  let q = db.from('v_fechamentos').select('*').order('data', { ascending: false }).limit(200);
  if (fFac) q = q.eq('faccao_id', +fFac);
  const lista = await ler(q);
  const pode = tem('financeiro');
  alvo.innerHTML = `<div class="tabela-wrap"><table><thead><tr><th>Nº</th><th>Data</th><th>Facção</th><th class="n">Peças</th><th class="n">Bruto</th><th class="n">Desconto</th><th class="n">Pago</th><th>Por</th><th></th></tr></thead>
    <tbody>${lista.map(f => `<tr><td class="forte">${f.numero}</td><td>${data(f.data)}</td><td>${h(f.faccao)}</td><td class="n">${num(f.pecas)}</td><td class="n">${moeda(f.total_bruto)}</td>
      <td class="n">${moeda(f.desconto)}</td><td class="n forte">${moeda(f.total)}</td><td class="peq">${h(f.usuario || '')}</td>
      <td><div class="acoes"><button class="btn peq" data-rec="${f.id}">🖨 Recibo</button>${pode ? `<button class="btn peq perigo" data-est="${f.id}">↩</button>` : ''}</div></td></tr>`).join('')
      || '<tr><td colspan="9" class="vazio">Nenhum pagamento.</td></tr>'}</tbody></table></div>`;
  alvo.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => recibo(b.dataset.rec));
  alvo.querySelectorAll('[data-est]').forEach(b => b.onclick = async () => {
    const m = await pedirTexto('Estornar pagamento', 'Os itens voltam para "A pagar".', { botao: 'Estornar' });
    if (m && await chamar(db, 'estornar_fechamento', { p_fechamento_id: b.dataset.est, p_motivo: m })) { toast('Pagamento estornado.', 'ok'); render(el); }
  });
}

async function recibo(id) {
  const [f] = await ler(db.from('v_fechamentos').select('*').eq('id', id));
  const itens = await ler(db.from('fechamento_itens').select('*').eq('fechamento_id', id));
  const rIds = itens.filter(i => i.tipo === 'RETORNO').map(i => i.ref_id), cIds = itens.filter(i => i.tipo === 'CONSERTO').map(i => i.ref_id);
  const [rets, cons] = await Promise.all([
    rIds.length ? ler(db.from('v_retornos').select('id,lote,produto,cor,tamanho').in('id', rIds)) : [],
    cIds.length ? ler(db.from('v_consertos').select('id,sublote,produto,cor,tamanho').in('id', cIds)) : [],
  ]);
  const info = (i) => i.tipo === 'RETORNO' ? rets.find(r => r.id === i.ref_id) : (x => x && { ...x, lote: x.sublote })(cons.find(c => c.id === i.ref_id));
  imprimirHtml(`<div class="romaneio"><h1 style="display:flex;align-items:center;gap:4mm"><img src="img/logo-gms-pb.png" alt="" style="height:12mm">${h(EMPRESA)} — RECIBO DE PAGAMENTO Nº ${f.numero}</h1>
    <p>Facção: <b>${h(f.faccao)}</b> · Data: <b>${data(f.data)}</b>${f.pix ? ` · PIX: ${h(f.pix)}` : ''}</p>
    <table><thead><tr><th>Tipo</th><th>Sublote</th><th>Produto</th><th>Cor</th><th>Tam.</th><th>Peças</th><th>R$ peça</th><th>Valor</th></tr></thead>
    <tbody>${itens.map(i => { const x = info(i) || {}; return `<tr><td>${i.tipo === 'RETORNO' ? 'Retorno' : 'Conserto'}</td><td>${h(x.lote || '')}</td><td>${h(x.produto || '')}</td><td>${h(x.cor || '')}</td><td>${h(x.tamanho || '')}</td>
      <td style="text-align:right">${num(i.qtd)}</td><td style="text-align:right">${moeda(i.valor_unit)}</td><td style="text-align:right">${moeda(i.valor)}</td></tr>`; }).join('')}</tbody>
    <tfoot><tr><th colspan="7" style="text-align:right">Bruto</th><th style="text-align:right">${moeda(f.total_bruto)}</th></tr>
      <tr><th colspan="7" style="text-align:right">Desconto</th><th style="text-align:right">${moeda(f.desconto)}</th></tr>
      <tr><th colspan="7" style="text-align:right">Total pago</th><th style="text-align:right">${moeda(f.total)}</th></tr></tfoot></table>
    ${f.obs ? `<p>Obs.: ${h(f.obs)}</p>` : ''}
    <div class="assin"><div>${h(EMPRESA)}</div><div>${h(f.faccao)}</div></div></div>`);
}
