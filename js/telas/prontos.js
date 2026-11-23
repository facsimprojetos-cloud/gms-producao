import { db, tem } from '../app.js';
import { h, num, data, dataHora, ler, chamar, toast, formModal, distintos, filtroSel, contem } from '../util.js';

// Peças prontas (pronto_prod) e estoque de semiacabado (ESTOQUE_SEMI) do Apontador.
let aba = 'pendentes', fProd = '', busca = '';

export async function render(el) {
  el.innerHTML = `
    <div class="cab"><div><h1>Peças prontas</h1><p>Lotes que passaram pelo travete. Confirme a quantidade pronta para dar entrada no semiacabado.</p></div></div>
    <div class="abas">
      <button data-a="pendentes" class="${aba === 'pendentes' ? 'ativo' : ''}">A confirmar</button>
      <button data-a="confirmados" class="${aba === 'confirmados' ? 'ativo' : ''}">Confirmados</button>
      <button data-a="semi" class="${aba === 'semi' ? 'ativo' : ''}">Semiacabado</button>
    </div><div id="alvo"></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  const alvo = el.querySelector('#alvo');
  if (aba === 'semi') return semi(alvo, el);

  let q = db.from('v_pronto_producao').select('*');
  q = aba === 'pendentes' ? q.is('confirmado_em', null).order('lancado_em', { ascending: false })
                          : q.not('confirmado_em', 'is', null).order('confirmado_em', { ascending: false }).limit(1000);
  const dados = await ler(q);
  const lista = dados.filter(x => (!fProd || x.produto === fProd) && contem(x, ['produto', 'cor', 'tamanho', 'lote', 'responsavel'], busca));
  alvo.innerHTML = `${filtros(distintos(dados, 'produto'))}
    <p class="muted peq">${num(lista.length)} registros</p>
    <div class="tabela-wrap"><table><thead><tr><th>Lançado em</th><th>Produto</th><th>Cor</th><th>Tam.</th><th>Lote</th>
      ${aba === 'pendentes' ? '<th></th>' : '<th>Confirmado</th><th>Responsável</th>'}</tr></thead>
    <tbody>${lista.map(x => `<tr><td>${dataHora(x.lancado_em)}</td><td>${h(x.produto)}</td><td>${h(x.cor || '')}</td><td>${h(x.tamanho || '')}</td><td>${h(x.lote || '')}</td>
      ${aba === 'pendentes' ? `<td>${tem('producao') ? `<button class="btn peq pri" data-c="${x.id}">Confirmar</button>` : ''}</td>`
                             : `<td>${data(x.confirmado_em)}</td><td>${h(x.responsavel || '')}</td>`}</tr>`).join('')
      || `<tr><td colspan="${aba === 'pendentes' ? 6 : 7}" class="vazio">Nada aqui.</td></tr>`}</tbody></table></div>`;
  ligar(alvo, el);
  alvo.querySelectorAll('[data-c]').forEach(b => b.onclick = async () => {
    const x = lista.find(y => y.id === b.dataset.c);
    const v = await formModal({ titulo: 'Confirmar peças prontas', texto: `${h(x.produto)} · ${h(x.cor || '')} · ${h(x.tamanho || '')} · lote ${h(x.lote || '—')}`,
      botao: 'Confirmar', campos: [{ k: 'q', r: 'Quantidade pronta', tipo: 'number', step: 1, min: 1, req: true }] });
    if (v && await chamar(db, 'confirmar_pronto', { p_id: x.id, p_qtd: v.q })) { toast('Confirmado e lançado no semiacabado.', 'ok'); render(el); }
  });
}

async function semi(alvo, el) {
  const movs = await ler(db.from('estoque_semi_mov').select('*, produtos(nome, apelido), cores(nome), tamanhos(nome, ordem)').order('confirmado_em', { ascending: false }).limit(5000));
  const linhas = movs.map(m => ({ ...m, produto: m.produtos?.apelido || m.produtos?.nome, cor: m.cores?.nome, tamanho: m.tamanhos?.nome, ordem: m.tamanhos?.ordem ?? 99 }));
  const saldo = new Map();
  linhas.forEach(m => {
    const k = [m.produto, m.cor, m.tamanho].join('|');
    if (!saldo.has(k)) saldo.set(k, { produto: m.produto, cor: m.cor, tamanho: m.tamanho, ordem: m.ordem, qtd: 0 });
    saldo.get(k).qtd += (m.movimento === 'SAÍDA' ? -1 : 1) * Number(m.qtd);
  });
  const lista = [...saldo.values()].filter(x => x.qtd !== 0 && (!fProd || x.produto === fProd) && contem(x, ['produto', 'cor', 'tamanho'], busca))
    .sort((a, b) => a.produto.localeCompare(b.produto, 'pt-BR') || String(a.cor).localeCompare(String(b.cor)) || a.ordem - b.ordem);
  alvo.innerHTML = `${filtros(distintos(linhas, 'produto'))}
    <p class="muted peq">${num(lista.reduce((a, x) => a + x.qtd, 0))} peças em semiacabado</p>
    <div class="tabela-wrap"><table><thead><tr><th>Produto</th><th>Cor</th><th>Tam.</th><th class="n">Saldo</th></tr></thead>
    <tbody>${lista.map(x => `<tr><td>${h(x.produto)}</td><td>${h(x.cor || '')}</td><td>${h(x.tamanho || '')}</td><td class="n forte">${num(x.qtd)}</td></tr>`).join('')
      || '<tr><td colspan="4" class="vazio">Sem saldo.</td></tr>'}</tbody></table></div>`;
  ligar(alvo, el);
}

const filtros = (prods) => `<div class="filtros">${filtroSel('fp', 'Produto', prods, fProd)}<label class="campo">Buscar<input id="fb" value="${h(busca)}" placeholder="Cor, tamanho, lote…"></label></div>`;
function ligar(alvo, el) {
  alvo.querySelector('#fp').onchange = (e) => { fProd = e.target.value; render(el); };
  alvo.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); };
}
