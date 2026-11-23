import { db } from '../app.js';
import { h, num, data, dataHora, chip, ler, distintos, filtroSel, contem } from '../util.js';

// Estoque por SKU e vendas do Upseller (planilha SKU GMS). Primeira versão: consulta.
// A importação do arquivo do Upseller (web app do Apps Script) entra na próxima etapa.
let aba = 'saldo', busca = '', fCanal = '', zerados = false;

export async function render(el) {
  el.innerHTML = `
    <div class="cab"><div><h1>SKU / Upseller</h1><p>Saldo por SKU, movimentos e vendas do Upseller pendentes de cadastro.</p></div></div>
    <div class="abas">
      <button data-a="saldo" class="${aba === 'saldo' ? 'ativo' : ''}">Saldo por SKU</button>
      <button data-a="mov" class="${aba === 'mov' ? 'ativo' : ''}">Movimentos</button>
      <button data-a="pend" class="${aba === 'pend' ? 'ativo' : ''}">Pendências Upseller</button>
      <button data-a="imp" class="${aba === 'imp' ? 'ativo' : ''}">Importações</button>
    </div><div id="alvo"></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  const alvo = el.querySelector('#alvo');
  const filtroBusca = `<label class="campo">Buscar<input id="fb" value="${h(busca)}" placeholder="SKU, produto, pedido…"></label>`;
  const ligarBusca = () => { alvo.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); }; };

  if (aba === 'mov') {
    const movs = (await ler(db.from('sku_mov').select('*').order('em', { ascending: false }).limit(2000)))
      .filter(m => (!fCanal || m.loja_canal === fCanal) && contem(m, ['sku', 'pedido', 'tipo', 'obs'], busca));
    alvo.innerHTML = `<div class="filtros">${filtroSel('fc', 'Canal', distintos(movs, 'loja_canal'), fCanal)}${filtroBusca}</div>
      <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Tipo</th><th>SKU</th><th class="n">Qtd</th><th>Pedido</th><th>Canal</th><th>Obs.</th></tr></thead>
      <tbody>${movs.map(m => `<tr><td>${dataHora(m.em)}</td><td>${chip(m.tipo, m.qtd > 0 ? 'ok' : 'erro')}</td><td>${h(m.sku)}</td><td class="n forte">${num(m.qtd)}</td>
        <td>${h(m.pedido || '')}</td><td>${h(m.loja_canal || '')}</td><td class="peq">${h(m.obs || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Sem movimentos.</td></tr>'}</tbody></table></div>`;
    alvo.querySelector('#fc').onchange = (e) => { fCanal = e.target.value; render(el); };
    return ligarBusca();
  }
  if (aba === 'pend') {
    const pend = (await ler(db.from('v_upseller_pendencias').select('*').order('linha_arquivo').limit(5000)))
      .filter(p => (!fCanal || p.loja_canal === fCanal) && contem(p, ['sku_original', 'pedido', 'motivo'], busca));
    const porSku = new Map();
    pend.forEach(p => { const k = p.sku_normalizado || p.sku_original; porSku.set(k, (porSku.get(k) || 0) + Number(p.qtd || 0)); });
    alvo.innerHTML = `<div class="filtros">${filtroSel('fc', 'Canal', distintos(pend, 'loja_canal'), fCanal)}${filtroBusca}</div>
      <p class="muted peq">${num(pend.length)} linhas pendentes · ${num(porSku.size)} SKUs diferentes</p>
      <div class="tabela-wrap"><table><thead><tr><th>Arquivo</th><th class="n">Linha</th><th>Pedido</th><th>SKU</th><th class="n">Qtd</th><th>Canal</th><th>Status</th><th>Motivo</th></tr></thead>
      <tbody>${pend.map(p => `<tr><td class="peq">${h(p.arquivo)}</td><td class="n">${p.linha_arquivo ?? ''}</td><td>${h(p.pedido || '')}</td><td>${h(p.sku_original || '')}</td>
        <td class="n">${num(p.qtd)}</td><td>${h(p.loja_canal || '')}</td><td>${chip(p.status, 'alerta')}</td><td class="peq">${h(p.motivo || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio">Sem pendências.</td></tr>'}</tbody></table></div>`;
    alvo.querySelector('#fc').onchange = (e) => { fCanal = e.target.value; render(el); };
    return ligarBusca();
  }
  if (aba === 'imp') {
    const imps = await ler(db.from('importacoes_upseller').select('*').order('importado_em', { ascending: false }));
    alvo.innerHTML = `<div class="tabela-wrap"><table><thead><tr><th>Importado em</th><th>Arquivo</th><th class="n">Linhas</th><th class="n">Baixados</th><th class="n">Pendentes</th><th class="n">Qtd baixada</th><th>Status</th><th>Usuário</th></tr></thead>
      <tbody>${imps.map(i => `<tr><td>${dataHora(i.importado_em)}</td><td>${h(i.arquivo)}</td><td class="n">${num(i.total_linhas)}</td><td class="n">${num(i.itens_aprovados)}</td>
        <td class="n">${num(i.itens_pendentes)}</td><td class="n">${num(i.quantidade_baixada)}</td><td>${chip(i.status || '', i.status === 'CONCLUÍDO' ? 'ok' : 'alerta')}</td><td class="peq">${h(i.usuario || '')}</td></tr>`).join('')
        || '<tr><td colspan="8" class="vazio">Nenhuma importação.</td></tr>'}</tbody></table></div>`;
    return;
  }

  let q = db.from('v_sku_saldo').select('*').order('sku').limit(5000);
  if (!zerados) q = q.neq('saldo', 0);
  const lista = (await ler(q)).filter(x => contem(x, ['sku', 'nome', 'produto', 'cor1', 'tamanho'], busca));
  alvo.innerHTML = `<div class="filtros">${filtroBusca}</div>
    <label class="peq"><input type="checkbox" id="zer" ${zerados ? 'checked' : ''}> mostrar SKUs sem movimento</label>
    <p class="muted peq">${num(lista.length)} SKUs · saldo total ${num(lista.reduce((a, x) => a + Number(x.saldo), 0))}</p>
    <div class="tabela-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Kit</th><th>Cores</th><th>Tam.</th><th class="n">Entradas</th><th class="n">Saídas</th><th class="n">Saldo</th><th>Último mov.</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td>${h(x.sku)}</td><td>${h(x.nome || x.produto || '')}</td><td>${h(x.kit || '')}</td><td class="peq">${h([x.cor1, x.cor2, x.cor3].filter(Boolean).join(' / '))}</td>
      <td>${h(x.tamanho || '')}</td><td class="n">${num(x.entradas)}</td><td class="n">${num(x.saidas)}</td>
      <td class="n forte">${Number(x.saldo) < 0 ? chip(num(x.saldo), 'erro') : num(x.saldo)}</td><td class="peq">${x.ultimo_mov ? data(x.ultimo_mov) : ''}</td></tr>`).join('')
      || '<tr><td colspan="9" class="vazio">Nenhum SKU.</td></tr>'}</tbody></table></div>`;
  alvo.querySelector('#zer').onchange = (e) => { zerados = e.target.checked; render(el); };
  ligarBusca();
}
