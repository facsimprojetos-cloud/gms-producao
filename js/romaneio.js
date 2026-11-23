import { db } from './app.js';
import { EMPRESA } from './config.js';
import { h, num, moeda, data, dataHora, ler, imprimirHtml } from './util.js';

// Imprime o romaneio (A4) de uma remessa, com os aviamentos enviados
export async function imprimirRomaneio(remessaId) {
  const [rem] = await ler(db.from('v_remessas').select('*').eq('id', remessaId));
  const itens = await ler(db.from('v_envios').select('*').eq('remessa_id', remessaId).order('lote'));
  if (!rem) return;
  const av = [['Viés', rem.vies], ['Fio', rem.fio], ['Linha', rem.linha], ['Elástico', rem.elastico], ['Alça', rem.alca], ['Etiqueta', rem.etiqueta]].filter(x => x[1] != null);
  const linhas = itens.map(e => `<tr>
    <td>${h(e.lote)}</td><td>${h(e.produto)}</td><td>${h(e.cor)}</td><td>${h(e.tamanho)}</td>
    <td style="text-align:right">${num(e.qtd)}</td><td style="text-align:right">${moeda(e.valor_unit)}</td>
    <td style="text-align:right">${moeda(e.qtd * e.valor_unit)}</td></tr>`).join('');
  imprimirHtml(`<div class="romaneio">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div><h1>${h(EMPRESA)} — ROMANEIO DE ENVIO Nº ${h(rem.numero)}</h1>
        <div>Facção: <b>${h(rem.faccao)}</b>${rem.telefone ? ` · ${h(rem.telefone)}` : ''}</div>${rem.endereco ? `<div>${h(rem.endereco)}</div>` : ''}</div>
      <div style="text-align:right">Envio: <b>${dataHora(rem.data)}</b><br>Previsão de retorno: <b>${data(rem.previsao)}</b></div>
    </div>
    <table><thead><tr><th>Sublote</th><th>Produto</th><th>Cor</th><th>Tam.</th><th>Qtd</th><th>R$ unit.</th><th>Total</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><th colspan="4" style="text-align:right">Totais</th><th style="text-align:right">${num(rem.qtd_total)}</th><th></th><th style="text-align:right">${moeda(rem.valor_total)}</th></tr></tfoot>
    </table>
    ${av.length ? `<p><b>Aviamentos enviados:</b> ${av.map(([n, v]) => `${n}: ${num(v, 2)}`).join(' · ')}</p>` : ''}
    ${rem.obs ? `<p>Obs.: ${h(rem.obs)}</p>` : ''}
    <div class="assin"><div>Responsável pelo envio</div><div>Facção (recebido em ___/___/____)</div></div>
  </div>`);
}

// Folha da facção no modelo da planilha ETIQUETA GMS (aba FOLHA_FACÇÃO): uma folha por lote da remessa,
// grade cor × tamanho, aviamentos por cor = arredondar para cima(consumo da ficha técnica × peças da cor), 2 vias.
export async function imprimirFolhaFaccao(remessaId) {
  const [rem] = await ler(db.from('v_remessas').select('*').eq('id', remessaId));
  if (!rem) return;
  const itens = await ler(db.from('v_envios').select('*').eq('remessa_id', remessaId));
  const [fac] = await ler(db.from('faccoes').select('maquinas').eq('id', rem.faccao_id));
  const prodIds = [...new Set(itens.map(e => e.produto_id))];
  const [prods, ficha] = await Promise.all([
    ler(db.from('produtos').select('id,codigo,nome').in('id', prodIds)),
    ler(db.from('ficha_tecnica').select('produto_id,consumo,sequencia,materias_primas(nome,tipo)').in('produto_id', prodIds).order('sequencia')),
  ]);
  const cod = (p) => p && p.codigo ? String(Number(p.codigo) || p.codigo) : '';
  const lotes = new Map();
  itens.forEach(e => { const l = String(e.lote || '').replace(/\.\d+$/, ''); if (!lotes.has(l)) lotes.set(l, []); lotes.get(l).push(e); });
  const folhas = [...lotes.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR', { numeric: true })).map(([lote, es]) => {
    const p = prods.find(x => x.id === es[0].produto_id);
    const tams = [...new Map(es.map(e => [e.tamanho, e.tamanho_ordem ?? 0])).entries()].sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const cores = [...new Set(es.map(e => e.cor))];
    const q = (c, t) => es.filter(e => e.cor === c && e.tamanho === t).reduce((a, e) => a + Number(e.qtd), 0);
    const totCor = (c) => tams.reduce((a, t) => a + q(c, t), 0);
    const total = cores.reduce((a, c) => a + totCor(c), 0);
    const avs = ficha.filter(f => f.produto_id === es[0].produto_id && f.materias_primas?.tipo !== 'TECIDO'); // tecido sai do estoque no corte, não vai na folha
    const av = (c, f) => Math.ceil(Number(f.consumo) * totCor(c) - 1e-9);
    const via = (nome) => `<div class="folha">
      <table class="f-cab">
        <tr><td class="f-logo" rowspan="1">${h(EMPRESA)}</td><td colspan="5" class="f-tit">CONTROLE DE FACÇÃO - ${nome}</td></tr>
        <tr><th>LOTE</th><td class="f-lote">${h(lote)}</td><td class="f-cod">${h(cod(p))}</td><th>MÁQUINAS</th><td colspan="2">${h(fac?.maquinas || '')}</td></tr>
        <tr><th>FACÇÃO</th><td>${h(rem.faccao)}</td><th>CONTATO</th><td>${h(rem.telefone || '')}</td><th>ENDEREÇO</th><td>${h(rem.endereco || '')}</td></tr>
        <tr><th>DATA DE ENVIO</th><td colspan="2">${data(rem.data)}</td><th colspan="2">PREVISÃO DE RETORNO</th><td>${data(rem.previsao)}</td></tr>
        <tr><th>MODELO</th><td colspan="3">${h(cod(p))} | ${h(p?.nome || es[0].produto)}</td><th>TOTAL</th><td class="f-forte">${num(total)}</td></tr>
      </table>
      <table class="f-grade"><thead><tr><th>CORES</th>${tams.map(t => `<th>${h(t)}</th>`).join('')}<th>TOTAL</th></tr></thead>
        <tbody>${cores.map(c => `<tr><th>${h(String(c).toUpperCase())}</th>${tams.map(t => `<td>${num(q(c, t))}</td>`).join('')}<td class="f-forte">${num(totCor(c))}</td></tr>`).join('')}</tbody>
        <tfoot><tr><th>TOTAL</th>${tams.map(t => `<td>${num(cores.reduce((a, c) => a + q(c, t), 0))}</td>`).join('')}<td class="f-forte">${num(total)}</td></tr>
        <tr class="f-conf"><th>CONFERÊNCIA</th>${tams.map(() => '<td></td>').join('')}<td></td></tr></tfoot></table>
      ${avs.length ? `<table class="f-grade"><thead><tr><th colspan="${avs.length + 1}" class="f-sub">AVIAMENTOS</th></tr>
        <tr><th>CORES</th>${avs.map(f => `<th>${h(f.materias_primas?.nome || '')}</th>`).join('')}</tr></thead>
        <tbody>${cores.map(c => `<tr><th>${h(String(c).toUpperCase())}</th>${avs.map(f => `<td>${num(av(c, f))}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr><th>TOTAL</th>${avs.map(f => `<td class="f-forte">${num(cores.reduce((a, c) => a + av(c, f), 0))}</td>`).join('')}</tr></tfoot></table>`
        : '<p class="f-aviso">Produto sem aviamentos na ficha técnica.</p>'}
      ${rem.obs ? `<p>Obs.: ${h(rem.obs)}</p>` : ''}
      <table class="f-assin"><tr><th>Assinatura</th><td></td><th>DATA</th><td></td></tr></table>
    </div>`;
    return via('1ª VIA EMPRESA') + via('2ª VIA FACÇÃO');
  });
  imprimirHtml(folhas.join(''));
}
