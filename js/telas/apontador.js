import { db, tem } from '../app.js';
import { h, num, data, chip, chamar, ler, cadastros, toast, hojeISO, pedirTexto, distintos, filtroSel, contem } from '../util.js';

// Apontador por hora (substitui o APONTADOR GMS do AppSheet).
// Regras no banco (gms.salvar_apontamento_hora): meta da hora = arredondar(META/HORA × tempo ÷ 60);
// tempo = fim − início, menos 60 min se atravessar a hora inteira do almoço do grupo do operador;
// eficiência = realizado ÷ meta da hora; saldo = realizado − meta da hora. Travete com produção vai para Peças prontas.

let aba = 'lancar';
let fData = hojeISO(), fAte = hojeISO(), fOper = '', busca = '';
let mes = hojeISO().slice(0, 7);
let ultimo = {}; // mantém operador/produto/lote entre lançamentos seguidos

export async function render(el) {
  el.innerHTML = `
    <div class="cab"><div><h1>Apontador</h1><p>Produção por hora: operador, produto, função, início e fim. Meta e eficiência são calculadas como na planilha.</p></div></div>
    <div class="abas">
      ${tem('producao') ? `<button data-a="lancar" class="${aba === 'lancar' ? 'ativo' : ''}">Lançar</button>` : ''}
      <button data-a="lista" class="${aba === 'lista' ? 'ativo' : ''}">Lançamentos</button>
      <button data-a="indicador" class="${aba === 'indicador' ? 'ativo' : ''}">Indicador</button>
      <button data-a="mensal" class="${aba === 'mensal' ? 'ativo' : ''}">Mensal</button>
    </div>
    <div id="alvo"></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  const alvo = el.querySelector('#alvo');
  if (aba === 'lancar' && tem('producao')) return lancar(alvo, el);
  if (aba === 'indicador') return indicador(alvo, el);
  if (aba === 'mensal') return mensal(alvo, el);
  aba = 'lista';
  return lista(alvo, el);
}

// ---------------- Lançar ----------------
async function dadosLancamento() {
  const [cad, horarios, roteiro, lotes] = await Promise.all([
    cadastros(db),
    ler(db.from('horarios').select('*').order('ordem')),
    ler(db.from('produto_processos').select('produto_id, processo_id, meta_hora, sequencia').order('sequencia')),
    ler(db.from('cortes').select('lote, produto_id').order('data', { ascending: false }).limit(300)),
  ]);
  return { cad, horarios, roteiro, lotes };
}

function faixaAtual(horarios) {
  const agora = new Date().toTimeString().slice(0, 5);
  const f = horarios.find(x => x.hora.slice(0, 5) >= agora) || horarios[horarios.length - 1];
  return f ? f.hora.slice(0, 5) : '';
}

async function lancar(alvo, el, edicao = null) {
  const d = await dadosLancamento();
  const { cad, horarios, roteiro, lotes } = d;
  const comRoteiro = new Set(roteiro.map(r => r.produto_id));
  const produtos = cad.produtos.filter(p => p.ativo !== false && (comRoteiro.has(p.id) || p.apelido))
    .map(p => ({ id: p.id, nome: p.cod ? `${p.cod} | ${p.apelido || p.nome_base}` : (p.apelido || p.nome_base), codigo: p.codigo }));
  const v = edicao || { data: hojeISO(), hora: faixaAtual(horarios), ...ultimo };
  const opt = (lista, atual, rot = 'nome') => '<option value="">Selecione…</option>' + lista.map(x => `<option value="${x.id}" ${String(x.id) === String(atual ?? '') ? 'selected' : ''}>${h(x[rot])}</option>`).join('');
  alvo.innerHTML = `
    <div class="card">
      ${edicao ? '<div class="aviso-box">Alterando um lançamento (perfil supervisor).</div>' : ''}
      <form id="fa" class="grade g2">
        <label class="campo">Data<input type="date" name="data" value="${h(v.data)}" required></label>
        <label class="campo">Hora (faixa)<select name="hora" required>${horarios.map(x => `<option ${x.hora.slice(0, 5) === String(v.hora || '').slice(0, 5) ? 'selected' : ''}>${x.hora.slice(0, 5)}</option>`).join('')}</select></label>
        <label class="campo">Operador<select name="operador" required>${opt(cad.operadores.filter(o => o.ativo || String(o.id) === String(v.operador)), v.operador)}</select></label>
        <label class="campo">Produto<select name="produto" required>${opt(produtos, v.produto)}</select></label>
        <label class="campo">Função<select name="funcao" required></select></label>
        <label class="campo">Lote<input name="lote" list="dl-lotes" value="${h(v.lote || '')}" placeholder="ex.: 75-11 2026"><datalist id="dl-lotes">${lotes.map(l => `<option value="${h(l.lote)}">`).join('')}</datalist></label>
        <label class="campo">Cor<select name="cor">${opt(cad.cores.filter(c => c.ativo !== false || String(c.id) === String(v.cor)), v.cor)}</select></label>
        <label class="campo">Tamanho<select name="tamanho">${opt(cad.tamanhos.filter(t => t.ativo !== false || String(t.id) === String(v.tamanho)), v.tamanho)}</select></label>
        <label class="campo">Início<input type="time" name="inicio" value="${h((v.inicio || '').slice(0, 5))}" required></label>
        <label class="campo">Fim<input type="time" name="fim" value="${h((v.fim || '').slice(0, 5))}" required></label>
        <label class="campo">Realizado (peças)<input type="number" name="realizado" min="0" step="1" value="${h(v.realizado ?? '')}" required></label>
        <label class="campo">Observação<input name="obs" value="${h(v.obs || '')}"></label>
      </form>
      <div id="previa" class="muted" style="margin:10px 0"></div>
      <div class="acoes"><button class="btn pri" id="salvar">${edicao ? 'Salvar alteração' : 'Lançar'}</button>${edicao ? '<button class="btn" id="cancelar">Cancelar</button>' : ''}</div>
    </div>
    ${edicao ? '' : '<h3 style="margin-top:18px">Lançados hoje</h3><div id="hoje"></div>'}`;
  const f = alvo.querySelector('#fa');
  const selFunc = f.elements.funcao;
  const montarFuncoes = () => {
    const pid = Number(f.elements.produto.value);
    const funcs = roteiro.filter(r => r.produto_id === pid).map(r => ({ ...r, nome: (cad.processos.find(p => p.id === r.processo_id) || {}).nome || '?' }));
    const outras = cad.processos.filter(p => p.ativo !== false && !funcs.some(x => x.processo_id === p.id));
    selFunc.innerHTML = '<option value="">Selecione…</option>' +
      (funcs.length ? `<optgroup label="Roteiro do produto">${funcs.map(x => `<option value="${x.processo_id}" ${String(x.processo_id) === String(v.funcao ?? '') ? 'selected' : ''}>${h(x.nome)}${x.meta_hora ? ` · ${x.meta_hora}/h` : ' · sem meta'}</option>`).join('')}</optgroup>` : '') +
      `<optgroup label="Outras funções">${outras.map(p => `<option value="${p.id}" ${String(p.id) === String(v.funcao ?? '') ? 'selected' : ''}>${h(p.nome)}</option>`).join('')}</optgroup>`;
  };
  const previa = () => {
    const o = Object.fromEntries(new FormData(f));
    const op = cad.operadores.find(x => String(x.id) === o.operador);
    const r = roteiro.find(x => String(x.produto_id) === o.produto && String(x.processo_id) === o.funcao);
    if (!o.inicio || !o.fim || o.fim <= o.inicio) { alvo.querySelector('#previa').innerHTML = ''; return; }
    const min = (t) => { const [a, b] = t.split(':').map(Number); return a * 60 + b; };
    let tempo = min(o.fim) - min(o.inicio);
    const alm = op && op.grupo_almoco === 1 ? ['11:30', '12:30'] : op && op.grupo_almoco === 2 ? ['12:30', '13:30'] : null;
    if (alm && o.inicio <= alm[0] && o.fim > alm[1]) tempo -= 60;
    const metaH = r?.meta_hora;
    const meta = metaH ? Math.round(metaH * tempo / 60) : 0;
    const real = Number(o.realizado || 0);
    alvo.querySelector('#previa').innerHTML = metaH
      ? `Tempo ${tempo} min · meta da hora <b>${meta}</b> (${metaH}/h) · eficiência <b>${meta ? num(real / meta * 100, 2) : '—'}%</b> · saldo ${num(real - meta)}`
      : `Tempo ${tempo} min · <span class="alerta">esta função não tem meta cadastrada para o produto; a eficiência fica em branco.</span>`;
  };
  montarFuncoes();
  f.elements.produto.onchange = () => { montarFuncoes(); previa(); };
  f.oninput = previa; previa();
  alvo.querySelector('#cancelar')?.addEventListener('click', () => render(el));
  alvo.querySelector('#salvar').onclick = async () => {
    if (!f.reportValidity()) return;
    const o = Object.fromEntries(new FormData(f));
    const r = await chamar(db, 'salvar_apontamento_hora', {
      p_id: edicao?.id || null, p_data: o.data, p_hora: o.hora, p_operador_id: +o.operador, p_produto_id: +o.produto,
      p_cor_id: o.cor ? +o.cor : null, p_tamanho_id: o.tamanho ? +o.tamanho : null, p_processo_id: +o.funcao, p_lote: o.lote || null,
      p_inicio: o.inicio, p_fim: o.fim, p_realizado: +o.realizado, p_obs: o.obs || null });
    if (!r) return;
    toast(`Lançado: meta ${r.meta}, eficiência ${r.eficiencia != null ? num(r.eficiencia * 100, 2) + '%' : '—'}${r.pronto_criado ? ' · enviado para Peças prontas' : ''}`, 'ok');
    if (edicao) { aba = 'lista'; return render(el); }
    ultimo = { data: o.data, hora: o.hora, operador: o.operador, produto: o.produto, funcao: o.funcao, lote: o.lote, cor: o.cor, tamanho: o.tamanho, inicio: o.fim };
    render(el);
  };
  if (!edicao) {
    const hoje = await ler(db.from('v_apontamentos_hora').select('*').eq('data', hojeISO()).order('criado_em', { ascending: false }).limit(200));
    alvo.querySelector('#hoje').innerHTML = tabela(hoje, false);
  }
}

// ---------------- Lista ----------------
function tabela(lista, acoes) {
  return `<div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Hora</th><th>Operador</th><th>Produto</th><th>Função</th><th>Cor</th><th>Tam.</th><th>Lote</th>
    <th>Início–fim</th><th class="n">Min</th><th class="n">Meta/h</th><th class="n">Meta</th><th class="n">Real.</th><th class="n">Efic.</th><th>Origem</th>${acoes ? '<th></th>' : ''}</tr></thead>
    <tbody>${lista.map(a => `<tr><td>${data(a.data)}</td><td>${h((a.hora || '').slice(0, 5))}</td><td>${h(a.operador)}</td><td>${h(a.produto)}</td><td>${h(a.funcao)}</td>
      <td>${h(a.cor || '')}</td><td>${h(a.tamanho || '')}</td><td>${h(a.lote || '')}</td><td class="peq">${h((a.inicio || '').slice(0, 5))}–${h((a.fim || '').slice(0, 5))}</td>
      <td class="n">${num(a.tempo_apontado)}</td><td class="n">${a.meta ?? ''}</td><td class="n">${a.nova_meta != null ? num(a.nova_meta) : ''}</td><td class="n forte">${num(a.realizado)}</td>
      <td class="n">${a.eficiencia != null ? chip(num(a.eficiencia * 100, 1) + '%', a.eficiencia >= 1 ? 'ok' : a.eficiencia >= 0.8 ? 'alerta' : 'erro') : ''}</td>
      <td class="peq">${h(a.origem || '')}</td>
      ${acoes ? `<td><div class="acoes">${tem('supervisor') && !a.importado ? `<button class="btn peq" data-ed="${a.id}">✏️</button>` : ''}${tem('supervisor') ? `<button class="btn peq perigo" data-ex="${a.id}">🗑</button>` : ''}</div></td>` : ''}</tr>`).join('')
      || `<tr><td colspan="${acoes ? 16 : 15}" class="vazio">Nenhum lançamento.</td></tr>`}</tbody></table></div>`;
}

async function lista(alvo, el) {
  const dados = await ler(db.from('v_apontamentos_hora').select('*').gte('data', fData).lte('data', fAte)
    .order('data', { ascending: false }).order('hora', { ascending: false }).limit(3000));
  const filtrada = dados.filter(a => (!fOper || a.operador === fOper) && contem(a, ['produto', 'funcao', 'lote', 'cor', 'origem'], busca));
  const tot = filtrada.reduce((s, a) => ({ r: s.r + a.realizado, m: s.m + Number(a.nova_meta || 0) }), { r: 0, m: 0 });
  alvo.innerHTML = `
    <div class="filtros"><label class="campo">De<input type="date" id="fde" value="${fData}"></label><label class="campo">Até<input type="date" id="fate" value="${fAte}"></label>
      ${filtroSel('fop', 'Operador', distintos(dados, 'operador'), fOper)}<label class="campo">Buscar<input id="fb" value="${h(busca)}" placeholder="Produto, função, lote…"></label></div>
    <p class="muted peq">${num(filtrada.length)} lançamentos · realizado ${num(tot.r)} · meta ${num(tot.m)}</p>
    ${tabela(filtrada, true)}`;
  alvo.querySelector('#fde').onchange = (e) => { fData = e.target.value; render(el); };
  alvo.querySelector('#fate').onchange = (e) => { fAte = e.target.value; render(el); };
  alvo.querySelector('#fop').onchange = (e) => { fOper = e.target.value; render(el); };
  alvo.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); };
  alvo.querySelectorAll('[data-ed]').forEach(b => b.onclick = () => {
    const a = filtrada.find(x => x.id === b.dataset.ed);
    lancar(alvo, el, { id: a.id, data: a.data, hora: a.hora, operador: a.operador_id, produto: a.produto_id, funcao: a.processo_id, lote: a.lote,
      cor: a.cor_id, tamanho: a.tamanho_id, inicio: a.inicio, fim: a.fim, realizado: a.realizado, obs: a.obs });
  });
  alvo.querySelectorAll('[data-ex]').forEach(b => b.onclick = async () => {
    const motivo = await pedirTexto('Excluir lançamento', 'O lançamento sai do apontador e do indicador. Fica registrado na auditoria.');
    if (motivo && await chamar(db, 'excluir_apontamento_hora', { p_id: b.dataset.ex, p_motivo: motivo })) { toast('Excluído.', 'ok'); render(el); }
  });
}

// ---------------- Indicador (aba INDICADOR da planilha) ----------------
async function indicador(alvo, el) {
  const [ini, fim] = limitesMes(mes);
  const [linhas, horarios] = await Promise.all([
    ler(db.from('v_indicador_hora').select('*').gte('data', ini).lt('data', fim).order('data').limit(10000)),
    ler(db.from('horarios').select('*').order('ordem')),
  ]);
  const faixas = horarios.map(x => x.hora.slice(0, 5));
  const mapa = new Map();
  linhas.forEach(l => {
    const k = l.data + '|' + l.operador;
    if (!mapa.has(k)) mapa.set(k, { data: l.data, operador: l.operador, grupo: l.grupo_almoco, h: {} });
    mapa.get(k).h[l.hora.slice(0, 5)] = l.eficiencia;
  });
  const cor = (v) => v == null ? '' : v >= 1 ? 'ok' : v >= 0.8 ? 'alerta' : 'erro';
  const linhasTab = [...mapa.values()].filter(r => !fOper || r.operador === fOper).sort((a, b) => b.data.localeCompare(a.data) || a.operador.localeCompare(b.operador));
  alvo.innerHTML = `
    <div class="filtros"><label class="campo">Mês<input type="month" id="fmes" value="${mes}"></label>${filtroSel('fop', 'Operador', distintos([...mapa.values()], 'operador'), fOper)}</div>
    <p class="muted peq">Eficiência média dos lançamentos de cada faixa de hora (mesma conta da aba INDICADOR).</p>
    <div class="tabela-wrap"><table><thead><tr><th>Data</th><th>Operador</th>${faixas.map(f => `<th class="n">${f}</th>`).join('')}<th class="n">Média</th></tr></thead>
    <tbody>${linhasTab.map(r => {
      const vals = faixas.map(f => r.h[f]).filter(v => v != null);
      const media = vals.length ? vals.reduce((a, b) => a + Number(b), 0) / vals.length : null;
      return `<tr><td>${data(r.data)}</td><td>${h(r.operador)}</td>${faixas.map(f => `<td class="n">${r.h[f] != null ? `<span class="chip ${cor(r.h[f])}">${num(r.h[f] * 100, 0)}%</span>` : ''}</td>`).join('')}
        <td class="n forte">${media != null ? num(media * 100, 1) + '%' : ''}</td></tr>`;
    }).join('') || `<tr><td colspan="${faixas.length + 3}" class="vazio">Sem lançamentos no mês.</td></tr>`}</tbody></table></div>`;
  alvo.querySelector('#fmes').onchange = (e) => { mes = e.target.value; render(el); };
  alvo.querySelector('#fop').onchange = (e) => { fOper = e.target.value; render(el); };
}

// ---------------- Mensal por operador ----------------
async function mensal(alvo, el) {
  const [ini, fim] = limitesMes(mes);
  const linhas = await ler(db.from('v_indicador_hora').select('*').gte('data', ini).lt('data', fim).limit(10000));
  const ops = new Map();
  linhas.forEach(l => {
    if (!ops.has(l.operador)) ops.set(l.operador, { operador: l.operador, dias: new Set(), efs: [], real: 0, meta: 0 });
    const o = ops.get(l.operador);
    o.dias.add(l.data); o.real += Number(l.realizado || 0); o.meta += Number(l.meta || 0);
    if (l.eficiencia != null) o.efs.push(Number(l.eficiencia));
  });
  const lista = [...ops.values()].map(o => ({ ...o, media: o.efs.length ? o.efs.reduce((a, b) => a + b, 0) / o.efs.length : null }))
    .sort((a, b) => (b.media ?? -1) - (a.media ?? -1));
  alvo.innerHTML = `
    <div class="filtros"><label class="campo">Mês<input type="month" id="fmes" value="${mes}"></label></div>
    <div class="tabela-wrap"><table><thead><tr><th>Operador</th><th class="n">Dias</th><th class="n">Faixas lançadas</th><th class="n">Realizado</th><th class="n">Eficiência média</th></tr></thead>
    <tbody>${lista.map(o => `<tr><td>${h(o.operador)}</td><td class="n">${o.dias.size}</td><td class="n">${o.efs.length}</td><td class="n">${num(o.real)}</td>
      <td class="n forte">${o.media != null ? chip(num(o.media * 100, 1) + '%', o.media >= 1 ? 'ok' : o.media >= 0.8 ? 'alerta' : 'erro') : ''}</td></tr>`).join('')
      || '<tr><td colspan="5" class="vazio">Sem lançamentos no mês.</td></tr>'}</tbody></table></div>`;
  alvo.querySelector('#fmes').onchange = (e) => { mes = e.target.value; render(el); };
}

function limitesMes(m) {
  const [a, b] = m.split('-').map(Number);
  const prox = b === 12 ? `${a + 1}-01` : `${a}-${String(b + 1).padStart(2, '0')}`;
  return [`${m}-01`, `${prox}-01`];
}
