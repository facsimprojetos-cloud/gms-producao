import { db, tem } from '../app.js';
import { h, num, data, chip, chamar, ler, cadastros, toast, formModal, contem } from '../util.js';
import { formRetorno } from './faccao.js';

// Produção interna (supervisora): lotes enviados para a produção interna e lotes que voltaram das facções para a
// finalização interna. O % feito vem do apontador: peças apontadas no último processo do roteiro do produto.
let busca = '';

export async function render(el) {
  const cad = await cadastros(db);
  const pode = tem('producao') || tem('supervisor');
  const linhas = (await ler(db.from('v_producao_interna').select('*').order('desde').limit(2000)))
    .map(x => ({ ...x, produto: cad.produtos.find(p => p.id === x.produto_id)?.nome || x.produto }))
    .filter(x => contem(x, ['lote', 'produto', 'cor', 'tamanho'], busca));
  const grupos = new Map();
  linhas.forEach(x => { const k = `${x.origem}|${x.lote}|${x.produto_id}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(x); });
  const feitoDe = (x) => Math.min(x.feito, x.qtd_total);
  el.innerHTML = `
    <div class="cab"><div><h1>Produção interna</h1><p>O que está na produção interna e quanto de cada lote já passou pelo último processo do roteiro (pelo apontador).</p></div></div>
    <div class="filtros"><label class="campo">Buscar<input id="fb" value="${h(busca)}" placeholder="Lote, produto, cor…"></label></div>
    <div class="lista-cards">${[...grupos.values()].sort((a, b) => String(a[0].desde).localeCompare(String(b[0].desde))).map(itens => {
      const x0 = itens[0], tot = itens.reduce((a, x) => a + x.qtd_total, 0), feito = itens.reduce((a, x) => a + feitoDe(x), 0);
      const pct = tot ? Math.round(feito / tot * 100) : 0;
      itens.sort((a, b) => a.tamanho_ordem - b.tamanho_ordem || String(a.cor).localeCompare(String(b.cor)));
      return `<div class="item">
        <div class="linha1"><div><div class="tit">Lote ${h(x0.lote)}</div><div class="det">${h(x0.produto)} · desde ${data(x0.desde)}</div></div>
          ${chip(x0.origem === 'ENVIO' ? 'Produção interna' : 'Finalização interna', x0.origem === 'ENVIO' ? 'info' : 'acento')}</div>
        <div class="barra" title="${num(feito)} de ${num(tot)}"><div style="width:${pct}%"></div><span>${pct}% · ${num(feito)} de ${num(tot)} peças</span></div>
        <div class="det peq">Último processo: <b>${h(x0.ultimo_processo || 'roteiro não cadastrado')}</b></div>
        <div class="tabela-wrap" style="margin-top:6px"><table><thead><tr><th>Cor</th><th>Tam.</th><th class="n">Peças</th><th class="n">Feito</th><th class="n">Falta</th><th></th></tr></thead><tbody>
        ${itens.map(x => `<tr><td>${h(x.cor)}</td><td>${h(x.tamanho)}</td><td class="n">${num(x.qtd_total)}</td><td class="n">${num(feitoDe(x))}</td>
          <td class="n forte">${num(Math.max(0, x.qtd_total - x.feito))}</td>
          <td>${pode ? `<button class="btn peq pri" data-${x.origem === 'ENVIO' ? 'ret' : 'fin'}="${x.id}">${x.origem === 'ENVIO' ? 'Retorno' : 'Concluir'}</button>` : ''}</td></tr>`).join('')}
        </tbody></table></div></div>`; }).join('') || '<div class="vazio">Nada na produção interna.</div>'}</div>`;
  el.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelectorAll('[data-ret]').forEach(b => b.onclick = async () => {
    const [e] = await ler(db.from('v_envios').select('*').eq('id', b.dataset.ret));
    if (e) formRetorno({ ...e, produto: cad.produtos.find(p => p.id === e.produto_id)?.nome || e.produto }, cad, () => render(el));
  });
  el.querySelectorAll('[data-fin]').forEach(b => b.onclick = async () => {
    const x = linhas.find(l => l.id === b.dataset.fin);
    const v = await formModal({ titulo: `Concluir finalização — ${x.lote} ${x.cor} ${x.tamanho}`, botao: 'Concluir',
      texto: `<p><b>${num(x.qtd_total)}</b> peças. As aprovadas seguem para <b>revisão e embalagem</b>.</p>`,
      campos: [{ k: 'ok', r: 'Aprovadas', tipo: 'number', min: 0, valor: x.qtd_total, req: true }, { k: 'perda', r: 'Perdidas', tipo: 'number', min: 0, valor: 0 }, { k: 'obs', r: 'Observação' }],
      validar: (o) => (o.ok || 0) + (o.perda || 0) === x.qtd_total ? null : `Aprovadas + perdidas deve dar ${x.qtd_total}.` });
    if (v && await chamar(db, 'concluir_etapa', { p_etapa_id: x.id, p_aprovada: v.ok || 0, p_conserto: 0, p_perda: v.perda || 0, p_destino: 'REVISÃO', p_faccao_conserto: null, p_obs: v.obs })) {
      toast('Finalização concluída.', 'ok'); render(el);
    }
  });
}
