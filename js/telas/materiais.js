import { db, tem } from '../app.js';
import { h, num, dataHora, chip, ler, chamar, toast, formModal, cadastros, ops, contem } from '../util.js';

// Aviamentos (LANÇ_AVIAMENTO do Controle) e almoxarifado (LANÇAMENTOS ALMOXARIFADO do SKU).
let aba = 'saldo', tipo = 'AVIAMENTO', busca = '';

export async function render(el) {
  const pode = tem('estoque');
  el.innerHTML = `
    <div class="cab"><div><h1>Aviamentos e almoxarifado</h1><p>Entradas, saídas e saldo. Os itens são cadastrados em Cadastros → Matéria-prima.</p></div>
      ${pode ? '<button class="btn acento" id="novo">+ Lançar movimento</button>' : ''}</div>
    <div class="abas">
      <button data-t="AVIAMENTO" class="${tipo === 'AVIAMENTO' ? 'ativo' : ''}">Aviamentos</button>
      <button data-t="ALMOXARIFADO" class="${tipo === 'ALMOXARIFADO' ? 'ativo' : ''}">Almoxarifado</button>
      <span style="flex:1"></span>
      <button data-a="saldo" class="${aba === 'saldo' ? 'ativo' : ''}">Saldo</button>
      <button data-a="mov" class="${aba === 'mov' ? 'ativo' : ''}">Movimentações</button>
    </div><div id="alvo"></div>`;
  el.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { tipo = b.dataset.t; render(el); });
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  el.querySelector('#novo')?.addEventListener('click', () => lancar(null, el));
  const alvo = el.querySelector('#alvo');

  if (aba === 'mov') {
    const movs = await ler(db.from('materia_mov').select('*, materias_primas!inner(nome, tipo), cores(nome)').eq('materias_primas.tipo', tipo).order('em', { ascending: false }).limit(1000));
    const lista = movs.filter(m => contem({ n: m.materias_primas?.nome, c: m.cores?.nome, o: m.obs }, ['n', 'c', 'o'], busca));
    alvo.innerHTML = `${filtro()}
      <div class="tabela-wrap"><table><thead><tr><th>Quando</th><th>Movimento</th><th>Item</th><th>Cor</th><th class="n">Qtd</th><th class="n">Kg</th><th>Obs.</th></tr></thead>
      <tbody>${lista.map(m => `<tr><td>${dataHora(m.em)}</td><td>${chip(m.tipo, m.tipo === 'ENTRADA' ? 'ok' : m.tipo === 'SAÍDA' ? 'erro' : 'alerta')}</td>
        <td>${h(m.materias_primas?.nome)}</td><td>${h(m.cores?.nome || '')}</td><td class="n forte">${m.tipo === 'SAÍDA' ? '−' : ''}${num(m.qtd, 2)}</td>
        <td class="n">${m.kg != null ? num(m.kg, 3) : ''}</td><td class="peq">${h(m.obs || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Sem movimentações.</td></tr>'}</tbody></table></div>`;
    alvo.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); };
    return;
  }

  const itens = (await ler(db.from('v_materia_saldo').select('*').eq('tipo', tipo).order('nome'))).filter(x => (x.ativo || Number(x.saldo) !== 0) && contem(x, ['nome'], busca));
  alvo.innerHTML = `${filtro()}
    <div class="tabela-wrap"><table><thead><tr><th>Item</th><th>Unid.</th><th class="n">Entradas</th><th class="n">Saídas</th><th class="n">Saldo</th><th class="n">Mínimo</th><th></th></tr></thead>
    <tbody>${itens.map(x => `<tr><td>${h(x.nome)}</td><td>${h(x.unidade)}</td><td class="n">${num(x.entradas, 2)}</td><td class="n">${num(x.saidas, 2)}</td>
      <td class="n forte">${x.estoque_minimo != null && Number(x.saldo) < Number(x.estoque_minimo) ? chip(num(x.saldo, 2), 'erro') : num(x.saldo, 2)}</td>
      <td class="n">${x.estoque_minimo != null ? num(x.estoque_minimo, 2) : ''}</td>
      <td>${pode ? `<button class="btn peq" data-l="${x.id}">±</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="vazio">Nenhum item.</td></tr>'}</tbody></table></div>`;
  alvo.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); };
  alvo.querySelectorAll('[data-l]').forEach(b => b.onclick = () => lancar(Number(b.dataset.l), el));
}

const filtro = () => `<div class="filtros"><label class="campo">Buscar<input id="fb" value="${h(busca)}" placeholder="Item, cor…"></label></div>`;

async function lancar(materia, el) {
  const [itens, cad] = await Promise.all([ler(db.from('materias_primas').select('id, nome, tipo, ativo').eq('tipo', tipo).order('nome')), cadastros(db)]);
  const v = await formModal({ titulo: `Lançar movimento · ${tipo === 'AVIAMENTO' ? 'aviamento' : 'almoxarifado'}`, botao: 'Lançar', campos: [
    { k: 'm', r: 'Item', tipo: 'select', opcoes: ops(itens, materia), valor: materia, req: true },
    { k: 't', r: 'Movimento', tipo: 'select', opcoes: [['ENTRADA', 'Entrada'], ['SAÍDA', 'Saída']], valor: 'ENTRADA', req: true, vazio: false },
    { k: 'q', r: 'Quantidade', tipo: 'number', step: 'any', min: 0, req: true },
    ...(tipo === 'AVIAMENTO' ? [{ k: 'c', r: 'Cor', tipo: 'select', opcoes: ops(cad.cores), vazio: '(sem cor)' }, { k: 'kg', r: 'Kg', tipo: 'number', step: 'any' }] : []),
    { k: 'obs', r: 'Observação' }] });
  if (v && await chamar(db, 'lancar_materia', { p_materia_id: +v.m, p_tipo: v.t, p_qtd: v.q, p_cor_id: v.c ? +v.c : null, p_kg: v.kg ?? null, p_obs: v.obs })) {
    toast('Movimento lançado.', 'ok'); render(el);
  }
}
