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

// Folha da facção (romaneio de envio) — mesmo conteúdo da aba FOLHA_FACÇÃO da planilha ETIQUETA GMS, em layout novo:
// uma folha por lote da remessa, grade cor × tamanho com linha de conferência, aviamentos por cor
// (arredondar para cima: consumo da ficha técnica × peças da cor; tecido fica fora) e 2 vias (empresa e facção).
export async function imprimirFolhaFaccao(remessaIds) {
  // aceita um romaneio ou vários (envio de vários lotes de uma vez = um romaneio por lote, impressos juntos)
  const ids = Array.isArray(remessaIds) ? remessaIds : [remessaIds];
  const paginas = [];
  for (const id of ids) paginas.push(await folhasDoRomaneio(id));
  imprimirHtml(paginas.join(''));
}

async function folhasDoRomaneio(remessaId) {
  const [rem] = await ler(db.from('v_remessas').select('*').eq('id', remessaId));
  if (!rem) return '';
  const itens = await ler(db.from('v_envios').select('*').eq('remessa_id', remessaId));
  const [fac] = await ler(db.from('faccoes').select('maquinas,apelido,bairro').eq('id', rem.faccao_id));
  const prodIds = [...new Set(itens.map(e => e.produto_id))];
  const [prods, ficha] = await Promise.all([
    ler(db.from('produtos').select('id,codigo,nome').in('id', prodIds)),
    ler(db.from('ficha_tecnica').select('produto_id,consumo,sequencia,materias_primas(nome,tipo,unidade)').in('produto_id', prodIds).order('sequencia')),
  ]);
  const cod = (p) => p && p.codigo ? String(Number(p.codigo) || p.codigo) : '';
  const lotes = new Map();
  itens.forEach(e => { const l = String(e.lote || '').replace(/\.\d+$/, ''); if (!lotes.has(l)) lotes.set(l, []); lotes.get(l).push(e); });
  const folhas = [...lotes.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'pt-BR', { numeric: true })).map(([lote, es]) => {
    const p = prods.find(x => x.id === es[0].produto_id);
    const modelo = [cod(p), p?.nome || es[0].produto].filter(Boolean).join(' | ');
    const tams = [...new Map(es.map(e => [e.tamanho, e.tamanho_ordem ?? 0])).entries()].sort((a, b) => a[1] - b[1]).map(x => x[0]);
    const cores = [...new Set(es.map(e => e.cor))];
    const q = (c, t) => es.filter(e => e.cor === c && e.tamanho === t).reduce((a, e) => a + Number(e.qtd), 0);
    const totCor = (c) => tams.reduce((a, t) => a + q(c, t), 0);
    const total = cores.reduce((a, c) => a + totCor(c), 0);
    const avs = ficha.filter(f => f.produto_id === es[0].produto_id && f.materias_primas?.tipo !== 'TECIDO');
    const av = (c, f) => Math.ceil(Number(f.consumo) * totCor(c) - 1e-9);
    const nomeAv = (f) => { const n = f.materias_primas?.nome || ''; const m = n.match(/^(.*?)\s*\(([^)]*)\)\s*$/); return m ? `${h(m[1])}<small>${h(m[2])}</small>` : h(n); };
    const info = (rot, val, cls = '') => `<div class="fx-info ${cls}"><span>${rot}</span><b>${val || '—'}</b></div>`;
    const via = (nome) => `<section class="fx">
      <header class="fx-topo"><div class="fx-marca">${h(EMPRESA)}</div><div class="fx-tit">Controle de facção<small>Romaneio de envio</small></div><div class="fx-via">${nome}</div></header>
      <div class="fx-destaque">
        <div><span>Lote</span><b class="fx-lote">${h(lote)}</b></div>
        <div class="fx-modelo"><span>Modelo</span><b>${h(modelo)}</b></div>
        <div class="fx-total"><span>Total</span><b>${num(total)}</b><small>peças</small></div>
      </div>
      <div class="fx-infos">
        ${info('Facção', h(rem.faccao), 'largo')}${info('Contato', h(rem.telefone || ''))}
        ${info('Endereço', h([rem.endereco, fac?.bairro].filter(Boolean).join(' · ')), 'largo')}${info('Máquinas', h(fac?.maquinas || ''))}
        ${info('Data de envio', data(rem.data))}${info('Previsão de retorno', data(rem.previsao))}
      </div>
      <h3 class="fx-sec">Peças por cor e tamanho</h3>
      <table class="fx-tab"><thead><tr><th class="esq">Cor</th>${tams.map(t => `<th>${h(t)}</th>`).join('')}<th>Total</th></tr></thead>
        <tbody>${cores.map(c => `<tr><td class="esq">${h(String(c).toUpperCase())}</td>${tams.map(t => `<td>${q(c, t) ? num(q(c, t)) : '<span class="fx-zero">–</span>'}</td>`).join('')}<td class="fx-forte">${num(totCor(c))}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="fx-soma"><td class="esq">Total</td>${tams.map(t => `<td>${num(cores.reduce((a, c) => a + q(c, t), 0))}</td>`).join('')}<td>${num(total)}</td></tr>
          <tr class="fx-conf"><td class="esq">Conferência</td>${tams.map(() => '<td></td>').join('')}<td></td></tr></tfoot></table>
      <h3 class="fx-sec">Aviamentos <small>retirar do estoque e enviar com o lote</small></h3>
      ${avs.length ? `<table class="fx-tab fx-av"><thead><tr><th class="esq">Cor</th>${avs.map(f => `<th>${nomeAv(f)}</th>`).join('')}</tr></thead>
        <tbody>${cores.map(c => `<tr><td class="esq">${h(String(c).toUpperCase())}</td>${avs.map(f => `<td>${num(av(c, f))}</td>`).join('')}</tr>`).join('')}</tbody>
        <tfoot><tr class="fx-soma"><td class="esq">Total</td>${avs.map(f => `<td>${num(cores.reduce((a, c) => a + av(c, f), 0))}</td>`).join('')}</tr>
          <tr class="fx-conf"><td class="esq">Conferido</td>${avs.map(() => '<td></td>').join('')}</tr></tfoot></table>`
        : '<div class="fx-vazio">Este produto não tem aviamentos na ficha técnica.</div>'}
      ${rem.obs ? `<div class="fx-obs"><b>Observação:</b> ${h(rem.obs)}</div>` : ''}
      <footer class="fx-assin"><div>Entregue por</div><div>Recebido por (facção)</div><div class="curto">Data ____/____/______</div></footer>
    </section>`;
    return via('1ª via · Empresa') + via('2ª via · Facção');
  });
  return folhas.join('');
}
