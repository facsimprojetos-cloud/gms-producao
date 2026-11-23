import { db, tem } from '../app.js';
import { h, num, moeda, data, chip, modal, chamar, ler, cadastros, opcoes, toast, hojeISO, pedirTexto, confirmar, distintos, filtroSel, contem, DESTINOS, PROXIMOS } from '../util.js';

let aba = 'aberto';
let fFac = '', fAtraso = '', busca = '', fProd = '';
const abertosFac = new Set(); // lotes abertos (lote|romaneio)

export async function render(el) {
  const pode = tem('faccao'), sup = tem('supervisor');
  const cad = await cadastros(db);
  let q = db.from('v_envios').select('*').eq('interna', false).limit(600);
  q = aba === 'aberto' ? q.is('data_retorno', null).order('previsao') : q.not('data_retorno', 'is', null).order('data_retorno', { ascending: false });
  const lista = (await ler(q)).map(x => ({ ...x, produto: cad.produtos.find(p => p.id === x.produto_id)?.nome || x.produto }));
  const filtrada = lista.filter(x => (!fFac || String(x.faccao_id) === fFac) && (!fAtraso || x.atraso === fAtraso) && (!fProd || x.produto === fProd)
    && contem(x, ['lote', 'produto', 'cor', 'tamanho', 'faccao'], busca));

  el.innerHTML = `
    <div class="cab"><div><h1>3 - Gestão de Facção</h1><p>O que está nas facções externas, retornos (parciais ou totais), ocorrências e prazos. A produção interna fica em Produção.</p></div></div>
    <div class="abas">
      <button data-a="aberto" class="${aba === 'aberto' ? 'ativo' : ''}">Em aberto</button>
      <button data-a="retornados" class="${aba === 'retornados' ? 'ativo' : ''}">Retornados</button>
    </div>
    <div class="filtros">
      ${aba !== 'interna' ? `<label class="campo">Facção<select id="ff">${opcoes(cad.faccoes.filter(f => !f.interna), fFac, 'nome', 'id', 'Todas')}</select></label>` : ''}
      ${filtroSel('fa', 'Prazo', aba === 'retornados' ? ['Entregue no prazo', 'Entregue com atraso'] : ['Atrasado', 'No Prazo'], fAtraso)}
      ${filtroSel('fp', 'Produto', distintos(lista, 'produto'), fProd)}
      <label class="campo">Buscar<input id="fb" value="${h(busca)}" placeholder="Sublote, cor…"></label>
    </div>
    <p class="muted peq">${num(filtrada.length)} envio(s) · ${num(filtrada.reduce((a, e) => a + e.saldo, 0))} peças pendentes · ${num(filtrada.reduce((a, e) => a + e.qtd, 0))} enviadas</p>
    <div id="lista"></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; fAtraso = ''; render(el); });
  el.querySelector('#ff')?.addEventListener('change', (e) => { fFac = e.target.value; render(el); });
  el.querySelector('#fa').onchange = (e) => { fAtraso = e.target.value; render(el); };
  el.querySelector('#fp').onchange = (e) => { fProd = e.target.value; render(el); };
  el.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); };

  // facção → lotes (uma linha por lote) → variações (abre o lote)
  const loteDe = (e) => String(e.lote || '').replace(/\.\d+$/, '') || '(sem número)';
  const grupos = new Map();
  filtrada.forEach(e => {
    if (!grupos.has(e.faccao)) grupos.set(e.faccao, new Map());
    const g = grupos.get(e.faccao), k = loteDe(e) + '|' + e.remessa_id;
    if (!g.has(k)) g.set(k, []); g.get(k).push(e);
  });
  const piorPrazo = (es) => { const at = es.filter(e => /atraso|Atrasado/.test(e.atraso)); const d = Math.max(0, ...es.map(e => e.dias_atraso || 0)); return at.length ? chip(`${at[0].atraso}${d ? ` (${d}d)` : ''}`, 'erro') : chip(es[0].atraso, 'ok'); };
  const linhaVar = (e) => `<tr class="var-linha">
      <td></td><td>${h(e.lote)}</td><td>${h(e.cor)}</td><td>${h(e.tamanho)}</td>
      <td class="n">${num(e.qtd)}</td><td class="n">${num(e.qtd - e.saldo)}</td><td class="n forte">${num(e.saldo)}</td>
      <td colspan="2" class="peq">${h(e.ocorrencia || '')}</td>
      <td><div class="acoes">
        ${pode && !e.data_retorno ? `<button class="btn pri peq" data-ret="${e.id}">Retorno</button>` : ''}
        ${pode && !e.data_retorno ? `<button class="btn peq" data-oc="${e.id}">Ocorrência</button>` : ''}
        ${e.qtd - e.saldo > 0 ? `<button class="btn peq" data-hist="${e.id}">Retornos</button>` : ''}
        ${pode && !e.data_retorno && e.saldo > 0 && e.qtd - e.saldo > 0 ? `<button class="btn peq" data-fin="${e.id}">Encerrar saldo</button>` : ''}
        ${sup && e.data_retorno && e.saldo > 0 ? `<button class="btn peq" data-reab="${e.id}">Reabrir</button>` : ''}
        ${sup && e.qtd === e.saldo ? `<button class="btn peq perigo" data-del="${e.id}">🗑</button>` : ''}
      </div></td></tr>`;
  el.querySelector('#lista').innerHTML = [...grupos.entries()].map(([fac, lotes]) => {
    const todos = [...lotes.values()].flat();
    return `
    <h2 style="margin-top:14px">${h(fac)} <span class="muted peq">${num(todos.reduce((a, e) => a + e.saldo, 0))} peças pendentes · ${lotes.size} lote(s)</span></h2>
    <div class="tabela-wrap"><table><thead><tr><th>Lote</th><th>Produto</th><th>Cor</th><th>Tam.</th><th class="n">Enviado</th><th class="n">Retornado</th><th class="n">Saldo</th>
      <th>Envio / previsão</th><th>Prazo</th><th></th></tr></thead>
    <tbody>${[...lotes.entries()].map(([k, es]) => { const x = es[0], aberto = abertosFac.has(k), abertos = es.filter(e => !e.data_retorno && e.saldo > 0);
      const cores = [...new Set(es.map(e => e.cor))], tams = [...new Set(es.map(e => e.tamanho))];
      return `<tr class="grupo lote-linha"><td class="forte" style="white-space:nowrap">${h(loteDe(x))}</td><td>${h(x.produto)}</td>
        <td class="peq">${cores.length} cor(es)</td><td class="peq">${h(tams.join(' '))}</td>
        <td class="n">${num(es.reduce((a, e) => a + e.qtd, 0))}</td><td class="n">${num(es.reduce((a, e) => a + e.qtd - e.saldo, 0))}</td><td class="n forte">${num(es.reduce((a, e) => a + e.saldo, 0))}</td>
        <td class="peq">${data(x.remessa_data)} → ${data(x.previsao)}</td><td>${piorPrazo(es)}</td>
        <td><div class="acoes"><button class="btn peq" data-abrir="${h(k)}">${aberto ? '▾ Fechar' : '▸ Variações'}</button>
          ${pode && abertos.length ? `<button class="btn pri peq" data-retlote="${h(k)}">Retorno do lote</button>` : ''}</div></td></tr>
        ${aberto ? es.map(linhaVar).join('') : ''}`; }).join('')}</tbody></table></div>`; }).join('') || '<div class="vazio">Nada por aqui.</div>';
  const lotesPorChave = new Map(); grupos.forEach(g => g.forEach((es, k) => lotesPorChave.set(k, es)));
  el.querySelectorAll('[data-abrir]').forEach(b => b.onclick = () => { const k = b.dataset.abrir; abertosFac.has(k) ? abertosFac.delete(k) : abertosFac.add(k); render(el); });
  el.querySelectorAll('[data-retlote]').forEach(b => b.onclick = () => retornoLote(lotesPorChave.get(b.dataset.retlote).filter(e => !e.data_retorno && e.saldo > 0), () => render(el)));

  const acha = (id) => filtrada.find(x => x.id === id);
  el.querySelectorAll('[data-ret]').forEach(b => b.onclick = () => formRetorno(acha(b.dataset.ret), cad, () => render(el)));
  el.querySelectorAll('[data-oc]').forEach(b => b.onclick = async () => {
    const e = acha(b.dataset.oc);
    const t = await pedirTexto(`Ocorrência — ${e.lote}`, 'Descreva a ocorrência (deixe em branco e confirme para limpar).', { rotulo: 'Ocorrência', minimo: 0, botao: 'Salvar', classe: 'pri', valor: e.ocorrencia || '' });
    if (t !== null && await chamar(db, 'registrar_ocorrencia', { p_envio_id: e.id, p_texto: t })) { toast('Ocorrência salva.', 'ok'); render(el); }
  });
  el.querySelectorAll('[data-fin]').forEach(b => b.onclick = async () => {
    const e = acha(b.dataset.fin);
    const m = await pedirTexto(`Encerrar envio ${e.lote}`, `Ainda faltam <b>${e.saldo}</b> peças. Encerrar o envio assim mesmo (peças perdidas/não devolvidas)?`, { botao: 'Encerrar' });
    if (m && await chamar(db, 'finalizar_envio', { p_envio_id: e.id, p_motivo: m })) { toast('Envio encerrado.', 'ok'); render(el); }
  });
  el.querySelectorAll('[data-reab]').forEach(b => b.onclick = async () => {
    if (await chamar(db, 'reabrir_envio', { p_envio_id: b.dataset.reab })) { toast('Envio reaberto.', 'ok'); render(el); }
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const e = acha(b.dataset.del);
    const m = await pedirTexto(`Excluir envio ${e.lote}`, `As ${e.qtd} peças voltam para "Aguardando distribuição".`, { botao: 'Excluir envio' });
    if (m && await chamar(db, 'excluir_envio', { p_envio_id: e.id, p_motivo: m })) { toast('Envio excluído.', 'ok'); render(el); }
  });
  el.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => historico(acha(b.dataset.hist), () => render(el)));
}

export function formRetorno(e, cad, depois) {
  modal({
    titulo: `${e.interna ? 'Retorno da produção interna' : 'Retorno da facção'} — ${e.lote}`,
    corpo: `<p>${h(e.faccao)} · ${h(e.produto)} ${h(e.cor)} ${h(e.tamanho)} · enviado <b>${e.qtd}</b> · pendente <b>${e.saldo}</b></p>
      <form id="fr" class="grade g3">
        <label class="campo">Peças boas<input type="number" name="qtd" min="0" max="${e.saldo}" value="${e.saldo}" required></label>
        <label class="campo">Consertos (voltam para a facção)<input type="number" name="cons" min="0" max="${e.saldo}" value="0"></label>
        <label class="campo">Defeito (a descontar)<input type="number" name="def" min="0" max="${e.saldo}" value="0"></label>
        <label class="campo">Próximo processo<select name="prox">${PROXIMOS.map(k => `<option value="${k}">${DESTINOS[k]}</option>`).join('')}</select></label>
        <label class="campo">Data do retorno<input type="date" name="data" value="${hojeISO()}" max="${hojeISO()}"></label>
        <label class="campo">Observação<input name="obs"></label>
      </form>
      <p class="muted peq">No fechamento paga-se (boas + consertos) × valor por peça; o conserto é pago junto com o lote. Defeito não tem conserto e é descontado.</p>`,
    botoes: [{ texto: 'Cancelar' }, { texto: 'Registrar', classe: 'pri', acao: async (m) => {
      const f = m.querySelector('#fr'); if (!f.reportValidity()) return false;
      const qtd = +f.qtd.value || 0, cons = +f.cons.value || 0, def = +f.def.value || 0;
      if (qtd + cons + def <= 0 || qtd + cons + def > e.saldo) { toast(`Boas + consertos + defeito deve ficar entre 1 e ${e.saldo}.`, 'erro'); return false; }
      if (!await chamar(db, 'registrar_retorno', { p_envio_id: e.id, p_qtd: qtd, p_conserto: cons, p_defeito: def, p_proximo: f.prox.value, p_data: f.data.value || null, p_obs: f.obs.value || null })) return false;
      toast(`Retorno registrado. ${qtd} peça(s) → ${DESTINOS[f.prox.value]}.`, 'ok'); depois();
    } }]
  });
}

async function historico(e, depois) {
  const rets = await ler(db.from('v_retornos').select('*').eq('envio_id', e.id).order('criado_em'));
  const sup = tem('supervisor');
  const m = modal({ titulo: `Retornos de ${e.lote}`, largo: true, corpo: `<div class="tabela-wrap"><table>
    <thead><tr><th>Data</th><th class="n">Boas</th><th class="n">Consertos</th><th class="n">Defeito</th><th>Destino</th><th class="n">Valor</th><th>Pago</th><th>Obs.</th><th></th></tr></thead>
    <tbody>${rets.map(r => `<tr><td>${data(r.data_retorno)}</td><td class="n">${num(r.qtd)}</td><td class="n">${num(r.qtd_conserto)}</td><td class="n">${num(r.qtd_defeito)}</td><td>${h(DESTINOS[r.proximo] || r.proximo)}</td>
      <td class="n">${moeda(r.valor_a_pagar)}</td><td>${r.pago ? chip('Pago', 'ok') : chip('A pagar', 'info')}</td><td class="peq">${h(r.obs || '')}</td>
      <td>${sup && !r.pago ? `<button class="btn peq perigo" data-x="${r.id}">🗑</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` });
  m.el.querySelectorAll('[data-x]').forEach(b => b.onclick = async () => {
    const mt = await pedirTexto('Excluir retorno', 'As peças voltam a ficar pendentes na facção. Só é possível se a etapa seguinte não começou.', { botao: 'Excluir retorno' });
    if (mt && await chamar(db, 'excluir_retorno', { p_retorno_id: b.dataset.x, p_motivo: mt })) { toast('Retorno excluído.', 'ok'); m.fechar(); depois(); }
  });
}

// Retorno do lote inteiro: uma linha por variação (boas / consertos / defeito), mesmo próximo processo e data
function retornoLote(es, depois) {
  es.sort((a, b) => (a.tamanho_ordem ?? 0) - (b.tamanho_ordem ?? 0) || String(a.cor).localeCompare(String(b.cor)));
  const lote = String(es[0].lote || '').replace(/\.\d+$/, '');
  modal({ titulo: `Retorno do lote ${lote} — ${es[0].faccao}`, largo: true,
    corpo: `<p class="muted peq">Já vem preenchido com tudo pendente como peças boas. Ajuste consertos (voltam para a facção, pagos junto com o lote) e defeito (a descontar). Linha com tudo zerado não é registrada.</p>
      <div class="tabela-wrap"><table><thead><tr><th>Cor</th><th>Tam.</th><th class="n">Pendente</th><th class="n">Boas</th><th class="n">Consertos</th><th class="n">Defeito</th></tr></thead>
      <tbody>${es.map(e => `<tr data-id="${e.id}" data-pend="${e.saldo}"><td>${h(e.cor)}</td><td>${h(e.tamanho)}</td><td class="n">${num(e.saldo)}</td>
        <td class="n"><input class="inp num" type="number" min="0" max="${e.saldo}" data-c="boas" value="${e.saldo}"></td>
        <td class="n"><input class="inp num" type="number" min="0" max="${e.saldo}" data-c="cons" value="0"></td>
        <td class="n"><input class="inp num" type="number" min="0" max="${e.saldo}" data-c="def" value="0"></td></tr>`).join('')}</tbody>
      <tfoot><tr class="grupo"><td colspan="3">Total</td><td class="n" id="tb"></td><td class="n" id="tc"></td><td class="n" id="td"></td></tr></tfoot></table></div>
      <div class="grade g3" style="margin-top:10px">
        <label class="campo">Próximo processo<select id="prox">${PROXIMOS.map(k => `<option value="${k}">${DESTINOS[k]}</option>`).join('')}</select></label>
        <label class="campo">Data do retorno<input type="date" id="dt" value="${hojeISO()}" max="${hojeISO()}"></label>
        <label class="campo">Observação<input id="obs"></label></div>`,
    aoAbrir: (m) => {
      const tot = () => ['boas', 'cons', 'def'].forEach((c, i) => { m.querySelector(['#tb', '#tc', '#td'][i]).textContent = num([...m.querySelectorAll(`[data-c=${c}]`)].reduce((a, x) => a + (+x.value || 0), 0)); });
      m.addEventListener('input', tot); tot();
    },
    botoes: [{ texto: 'Cancelar' }, { texto: 'Registrar retorno', classe: 'pri', acao: async (m) => {
      const linhas = [...m.querySelectorAll('tbody tr')].map(tr => ({ id: tr.dataset.id, pend: +tr.dataset.pend, b: +tr.querySelector('[data-c=boas]').value || 0, c: +tr.querySelector('[data-c=cons]').value || 0, d: +tr.querySelector('[data-c=def]').value || 0 }));
      const ruim = linhas.find(l => l.b < 0 || l.c < 0 || l.d < 0 || l.b + l.c + l.d > l.pend);
      if (ruim) { toast('Em alguma linha boas + consertos + defeito passou do pendente.', 'erro'); return false; }
      const validas = linhas.filter(l => l.b + l.c + l.d > 0);
      if (!validas.length) { toast('Nada para registrar.', 'erro'); return false; }
      const prox = m.querySelector('#prox').value, dt = m.querySelector('#dt').value || null, obs = m.querySelector('#obs').value || null;
      let ok = 0;
      for (const l of validas) { if (await chamar(db, 'registrar_retorno', { p_envio_id: l.id, p_qtd: l.b, p_conserto: l.c, p_defeito: l.d, p_proximo: prox, p_data: dt, p_obs: obs })) ok++; else break; }
      toast(`Retorno registrado em ${ok} de ${validas.length} variação(ões).`, ok === validas.length ? 'ok' : 'erro'); depois();
    } }] });
}
