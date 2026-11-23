import { db, tem } from '../app.js';
import { EMPRESA } from '../config.js';
import { h, num, data, formModal, imprimirHtml, chip, modal, confirmar, chamar, ler, cadastros, opcoes, toast, imprimirEtiquetas, pedirTexto, contem } from '../util.js';

const COR_STATUS = { 'Programado': 'alerta', 'Cortado': 'ok', 'Cancelado': 'erro' };
let filtro = 'Programado';
let busca = '';

export async function render(el) {
  const cad = await cadastros(db);
  // cortados: mais recente primeiro pela data em que foi cortado; a cortar: pela data de programação
  let q = db.from('v_cortes').select('*');
  q = (filtro === 'Programado' ? q.order('data', { ascending: false }) : q.order('cortado_em', { ascending: false, nullsFirst: false }).order('data', { ascending: false })).limit(300);
  if (filtro !== 'todos') q = q.eq('status', filtro);
  const cortes0 = await ler(q);
  const nomeProd = (id) => cad.produtos.find(p => p.id === id)?.nome;
  cortes0.forEach(c => { c.faccao = c.faccao || ''; c.produto = nomeProd(c.produto_id) || c.produto; });
  const cortes = cortes0.filter(c => contem(c, ['lote', 'produto', 'faccao'], busca));
  const pode = tem('corte');
  const sup = tem('supervisor');

  el.innerHTML = `
    <div class="cab"><div><h1>1 - Corte</h1><p>Programe o corte (cores × folhas, tamanhos × riscos). Ao cortar, abre a etiqueta de volume: só sacos ou dividir o lote e registrar.</p></div>
      ${pode ? '<button class="btn acento" id="novo">+ Novo corte</button>' : ''}</div>
    <div class="abas">
      ${[['Programado', 'A cortar'], ['Cortado', 'Cortados'], ['Cancelado', 'Cancelados'], ['todos', 'Todos']].map(([k, r]) => `<button data-f="${k}" class="${filtro === k ? 'ativo' : ''}">${r}</button>`).join('')}
    </div>
    <div class="filtros"><label class="campo">Buscar<input id="busca" value="${h(busca)}" placeholder="Lote, produto, facção…"></label></div>
    <div class="lista-cards">${cortes.map(c => cartao(c, pode, sup)).join('') || '<div class="vazio">Nenhum corte.</div>'}</div>`;

  el.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filtro = b.dataset.f; render(el); });
  el.querySelector('#busca').onchange = (e) => { busca = e.target.value; render(el); };
  el.querySelector('#novo')?.addEventListener('click', () => formCorte(cad, null, () => render(el)));
  el.querySelectorAll('[data-acao]').forEach(b => b.onclick = async () => {
    const c = cortes.find(x => x.id === b.dataset.id);
    const ac = b.dataset.acao;
    if (ac === 'editar') formCorte(cad, c, () => render(el));
    if (ac === 'duplicar') formCorte(cad, { ...c, id: null }, () => render(el));
    if (ac === 'faccao') {
      const v = await formModal({ titulo: `Facção do lote ${c.lote}`, botao: 'Salvar', campos: [{ k: 'f', r: 'Facção', tipo: 'select', vazio: 'Sem facção (aguardando distribuição)', valor: c.faccao_id, opcoes: cad.faccoes.filter(f => f.ativo).map(f => [f.id, f.nome]) }] });
      if (v && await chamar(db, 'definir_faccao_corte', { p_corte_id: c.id, p_faccao_id: v.f ? +v.f : null })) { toast('Facção definida.', 'ok'); render(el); }
    }
    if (ac === 'confirmar') telaConfirmar(c, () => render(el));
    if (ac === 'sublotes') verSublotes(c);
    if (ac === 'volumes') return etiquetaVolume(c);
    if (ac === 'etiquetas') {
      const { data: r } = await db.from('cortes').select('etiquetas').eq('id', c.id).single();
      if (r?.etiquetas?.length) imprimirEtiquetas(r.etiquetas, EMPRESA); else toast('Sem etiquetas salvas.', 'erro');
    }
    if (ac === 'estornar') {
      const m = await pedirTexto(`Estornar corte do lote ${c.lote}`, 'Os sublotes e etiquetas serão apagados e o pedido volta para <b>Programado</b>. Só é possível se nada foi enviado para facção.', { botao: 'Estornar corte' });
      if (m && await chamar(db, 'estornar_corte', { p_corte_id: c.id, p_motivo: m })) { toast('Corte estornado.', 'ok'); render(el); }
    }
    if (ac === 'excluir') {
      const m = await pedirTexto(`Excluir lote ${c.lote}`, 'O pedido de corte será apagado definitivamente.', { botao: 'Excluir' });
      if (m && await chamar(db, 'excluir_corte', { p_corte_id: c.id, p_motivo: m })) { toast('Excluído.', 'ok'); render(el); }
    }
    if (ac === 'cancelar') {
      const m = await pedirTexto(`Cancelar lote ${c.lote}`, 'O pedido de corte ficará como cancelado.', { botao: 'Cancelar corte' });
      if (m && await chamar(db, 'cancelar_corte', { p_corte_id: c.id, p_motivo: m })) { toast('Cancelado.', 'ok'); render(el); }
    }
  });
}

function cartao(c, pode, sup) {
  const cores = (c.cores || []).map(x => `${h(x.cor)} <b>${x.folhas}</b>`).join(' · ');
  const tams = (c.tamanhos || []).map(x => `${h(x.tamanho)} <b>${x.riscos}</b>`).join(' · ');
  return `<div class="item">
    <div class="linha1"><div><div class="tit">Lote ${h(c.lote)}</div><div class="det">${h(c.produto)} · ${c.cortado_em && data(c.cortado_em) !== data(c.data) ? `programado ${data(c.data)} · <b>cortado ${data(c.cortado_em)}</b>` : data(c.cortado_em || c.data)}</div></div>
      ${chip(c.status, COR_STATUS[c.status])}</div>
    <div class="det" style="margin-top:8px">${c.faccao ? chip('Facção: ' + c.faccao, 'info') : chip('Sem facção definida', '')}</div>
    <div class="det" style="margin-top:6px">Folhas: ${cores}</div>
    <div class="det">Riscos: ${tams}</div>
    <div class="det">Total: <b>${num(c.total_pecas)}</b> peças</div>
    ${c.obs ? `<div class="det">Obs.: ${h(c.obs)}</div>` : ''}
    <div class="acoes" style="margin-top:10px">
      ${pode && c.status === 'Programado' ? `<button class="btn pri peq" data-acao="confirmar" data-id="${c.id}">✂️ Cortar</button>` : ''}
      ${pode && c.status === 'Programado' ? `<button class="btn peq" data-acao="editar" data-id="${c.id}">Editar</button>` : ''}
      ${c.status === 'Cortado' ? `<button class="btn peq" data-acao="volumes" data-id="${c.id}">📦 Etiqueta de volume</button><button class="btn peq" data-acao="sublotes" data-id="${c.id}">Sublotes</button>${pode ? `<button class="btn peq" data-acao="faccao" data-id="${c.id}">Facção</button>` : ''}` : ''}
      ${pode ? `<button class="btn peq" data-acao="duplicar" data-id="${c.id}">Duplicar</button>` : ''}
      ${pode && c.status === 'Programado' ? `<button class="btn peq perigo" data-acao="cancelar" data-id="${c.id}">Cancelar</button>` : ''}
      ${sup && c.status === 'Cortado' ? `<button class="btn peq perigo" data-acao="estornar" data-id="${c.id}">↩ Estornar</button>` : ''}
      ${sup && c.status !== 'Cortado' ? `<button class="btn peq perigo" data-acao="excluir" data-id="${c.id}">🗑 Excluir</button>` : ''}
    </div></div>`;
}

async function verSublotes(c) {
  const subs = await ler(db.from('v_sublotes').select('*').eq('corte_id', c.id).order('tamanho_ordem').order('codigo'));
  modal({ titulo: `Sublotes do lote ${c.lote}`, largo: true, corpo: `<div class="tabela-wrap"><table>
    <thead><tr><th>Sublote</th><th>Cor</th><th>Tam.</th><th class="n">Cortado</th><th class="n">A distribuir</th><th class="n">Facção</th><th class="n">Etapas</th><th class="n">Conserto</th><th class="n">Estoque</th><th>Status</th></tr></thead>
    <tbody>${subs.map(s => `<tr><td class="forte">${h(s.codigo)}</td><td>${h(s.cor)}</td><td>${h(s.tamanho)}</td><td class="n">${num(s.qtd_cortada)}</td>
      <td class="n">${num(s.qtd_saldo)}</td><td class="n">${num(s.na_faccao)}</td><td class="n">${num(s.em_etapa)}</td><td class="n">${num(s.em_conserto)}</td><td class="n">${num(s.no_estoque)}</td><td>${chip(s.status)}</td></tr>`).join('')}</tbody></table></div>` });
}

function linhaCor(cad, v = {}) {
  return `<div class="linha-grade" data-tipo="cor">
    <label class="campo">Cor<select name="cor">${opcoes(cad.cores.filter(c => c.ativo || c.id === v.cor_id), v.cor_id)}</select></label>
    <label class="campo">Folhas<input type="number" name="folhas" min="1" step="1" value="${h(v.folhas ?? '')}" required></label>
    <button type="button" class="btn peq perigo" data-remove>×</button></div>`;
}
function linhaTam(cad, v = {}) {
  return `<div class="linha-grade" data-tipo="tam">
    <label class="campo">Tamanho<select name="tam">${opcoes(cad.tamanhos.filter(t => t.ativo || t.id === v.tamanho_id), v.tamanho_id)}</select></label>
    <label class="campo">Riscos<input type="number" name="riscos" min="1" step="1" value="${h(v.riscos ?? '')}" required></label>
    <button type="button" class="btn peq perigo" data-remove>×</button></div>`;
}

export async function formCorte(cad, c, depois) {
  const editar = !!(c && c.id);
  const corpo = `
    <form id="fc" class="grade">
      <div class="grade g2">
        <label class="campo">Produto<select name="produto" required>${opcoes(cad.produtos.filter(p => p.ativo || p.id === c?.produto_id), c?.produto_id)}</select></label>
        <label class="campo">Facção (opcional)<select name="faccao">${opcoes(cad.faccoes.filter(f => f.ativo || f.id === c?.faccao_id), c?.faccao_id, 'nome', 'id', 'Sem facção (definir depois)')}</select></label>
      </div>
      <p class="muted peq">${editar ? '' : 'O número do lote é dado na hora de salvar, seguindo a sequência do mês (ex.: 78-11 2026). '}Com facção escolhida, depois do corte o lote vai direto para <b>Aguardando envio</b>; sem facção, fica em <b>Aguardando distribuição</b>.</p>
      <div class="grade g2">
        <div><h3>Cores e folhas</h3><div class="grade-corte" id="cores">${(c?.cores?.length ? c.cores : [{}]).map(v => linhaCor(cad, v)).join('')}</div>
          <button type="button" class="btn peq" id="add-cor" style="margin-top:6px">+ Cor</button></div>
        <div><h3>Tamanhos e riscos</h3><div class="grade-corte" id="tams">${(c?.tamanhos?.length ? c.tamanhos : [{}]).map(v => linhaTam(cad, v)).join('')}</div>
          <button type="button" class="btn peq" id="add-tam" style="margin-top:6px">+ Tamanho</button></div>
      </div>
      <label class="campo">Observação<input name="obs" value="${h(c?.obs || '')}"></label>
      <div class="ok-box" id="total"></div>
    </form>`;
  modal({
    titulo: editar ? `Editar lote ${c.lote}` : 'Novo corte (a cortar)', corpo, largo: true,
    aoAbrir: (m) => {
      const atualizar = () => {
        const f = [...m.querySelectorAll('[name=folhas]')].reduce((a, i) => a + (+i.value || 0), 0);
        const r = [...m.querySelectorAll('[name=riscos]')].reduce((a, i) => a + (+i.value || 0), 0);
        m.querySelector('#total').innerHTML = `Total previsto: <b>${num(f * r)}</b> peças (${num(f)} folhas × ${num(r)} riscos)`;
      };
      m.addEventListener('input', atualizar);
      m.addEventListener('click', (e) => { if (e.target.matches('[data-remove]')) { const g = e.target.closest('.grade-corte'); if (g.children.length > 1) e.target.parentElement.remove(); atualizar(); } });
      m.querySelector('#add-cor').onclick = () => { if (m.querySelectorAll('#cores > div').length < 20) m.querySelector('#cores').insertAdjacentHTML('beforeend', linhaCor(cad)); };
      m.querySelector('#add-tam').onclick = () => { if (m.querySelectorAll('#tams > div').length < 8) m.querySelector('#tams').insertAdjacentHTML('beforeend', linhaTam(cad)); };
      atualizar();
    },
    botoes: [{ texto: 'Cancelar' }, {
      texto: editar ? 'Salvar' : 'Criar corte', classe: 'pri', acao: async (m) => {
        const f = m.querySelector('#fc');
        if (!f.reportValidity()) return false;
        const cores = [...m.querySelectorAll('#cores > div')].map(d => ({ cor_id: +d.querySelector('[name=cor]').value, folhas: +d.querySelector('[name=folhas]').value }));
        const tamanhos = [...m.querySelectorAll('#tams > div')].map(d => ({ tamanho_id: +d.querySelector('[name=tam]').value, riscos: +d.querySelector('[name=riscos]').value }));
        if (cores.some(x => !x.cor_id) || tamanhos.some(x => !x.tamanho_id)) { toast('Selecione todas as cores e tamanhos.', 'erro'); return false; }
        if (new Set(cores.map(x => x.cor_id)).size !== cores.length || new Set(tamanhos.map(x => x.tamanho_id)).size !== tamanhos.length) { toast('Cor ou tamanho repetido.', 'erro'); return false; }
        const base = { p_produto_id: +f.produto.value, p_cores: cores, p_tamanhos: tamanhos, p_faccao_id: f.faccao.value ? +f.faccao.value : null, p_obs: f.obs.value || null };
        const r = editar ? await chamar(db, 'editar_corte', { p_corte_id: c.id, ...base }) : await chamar(db, 'criar_corte', base);
        if (!r) return false;
        toast(editar ? 'Pedido de corte atualizado.' : `Lote ${r.lote} criado.`, 'ok'); depois();
      }
    }]
  });
}

function telaConfirmar(c, depois) {
  const linhas = [];
  for (const t of c.tamanhos) for (const cor of c.cores) linhas.push({ cor, t });
  const corpo = `
    <p>Confira as folhas e os riscos reais antes de confirmar. Cada cor × tamanho vira um sublote. Ao confirmar, abre a etiqueta de volume.
</p>
    <div class="grade g2">
      <div><h3>Folhas por cor</h3>${c.cores.map(x => `<label class="campo">${h(x.cor)}<input type="number" min="1" step="1" data-cor="${x.posicao}" value="${x.folhas}"></label>`).join('')}</div>
      <div><h3>Riscos por tamanho</h3>${c.tamanhos.map(x => `<label class="campo">${h(x.tamanho)}<input type="number" min="1" step="1" data-tam="${x.posicao}" value="${x.riscos}"></label>`).join('')}</div>
    </div>
    <div class="tabela-wrap" style="margin-top:12px"><table><thead><tr><th>Tamanho</th><th>Cor</th><th class="n">Peças</th><th class="n">Riscos</th></tr></thead><tbody id="prev"></tbody></table></div>`;
  modal({
    titulo: `Cortar lote ${c.lote} — ${c.produto}`, corpo, largo: true,
    aoAbrir: (m) => {
      const atualizar = () => {
        let tp = 0, te = 0;
        m.querySelector('#prev').innerHTML = linhas.map(({ cor, t }) => {
          const fo = +m.querySelector(`[data-cor="${cor.posicao}"]`).value || 0, ri = +m.querySelector(`[data-tam="${t.posicao}"]`).value || 0;
          tp += fo * ri; te += ri;
          return `<tr><td>${h(t.tamanho)}</td><td>${h(cor.cor)}</td><td class="n">${num(fo * ri)}</td><td class="n">${ri}</td></tr>`;
        }).join('') + `<tr class="grupo"><td colspan="2">Total</td><td class="n">${num(tp)}</td><td class="n">${num(te)}</td></tr>`;
      };
      m.addEventListener('input', atualizar); atualizar();
    },
    botoes: [{ texto: 'Cancelar' }, {
      texto: 'Confirmar corte', classe: 'pri', acao: async (m) => {
        const ajustes = {
          cores: [...m.querySelectorAll('[data-cor]')].map(i => ({ posicao: +i.dataset.cor, folhas: +i.value })),
          tamanhos: [...m.querySelectorAll('[data-tam]')].map(i => ({ posicao: +i.dataset.tam, riscos: +i.value })),
        };
        if ([...ajustes.cores.map(x => x.folhas), ...ajustes.tamanhos.map(x => x.riscos)].some(v => !(v > 0))) { toast('Valores devem ser maiores que zero.', 'erro'); return false; }
        if (!await confirmar('Confirmar corte', `Gravar o corte do lote <b>${h(c.lote)}</b>?`)) return false;
        const r = await chamar(db, 'confirmar_corte', { p_corte_id: c.id, p_ajustes: ajustes });
        if (!r) return false;
        toast(r.mensagem, 'ok'); depois();
        etiquetaVolume(c); // depois do corte já abre a etiqueta de volume (só sacos ou dividir e registrar)
      }
    }]
  });
}

// Etiqueta de volume no modelo da GMS (modelo, nome, data, tamanho, lote, volume n/N, QR = lote + tamanho, cores do lote).
// Duas formas: só etiquetas (o tamanho saiu em N sacos) ou dividir o lote e registrar a quantidade de cada volume.
async function etiquetaVolume(c) {
  const [subs, vols, cad] = await Promise.all([
    ler(db.from('v_sublotes').select('tamanho_id,tamanho,tamanho_ordem,cor,qtd_cortada').eq('corte_id', c.id)),
    ler(db.from('corte_volumes').select('*').eq('corte_id', c.id).order('numero')),
    cadastros(db)]);
  const tams = [...new Map(subs.map(s => [s.tamanho_id, { id: s.tamanho_id, nome: s.tamanho, ordem: s.tamanho_ordem ?? 0 }])).values()].sort((a, b) => a.ordem - b.ordem);
  if (!tams.length) return toast('Este corte não tem sublotes.', 'erro');
  const pecas = (t) => subs.filter(s => s.tamanho_id === t).reduce((a, s) => a + Number(s.qtd_cortada || 0), 0);
  const cores = (t) => [...new Set(subs.filter(s => s.tamanho_id === t).map(s => String(s.cor).toUpperCase()))];
  const reg = (t) => vols.filter(v => v.tamanho_id === t).map(v => v.qtd);
  const prod = cad.produtos.find(p => p.id === c.produto_id) || { cod: '', nome_base: c.produto };
  const corpo = `<div class="abas" style="margin-bottom:10px"><button type="button" data-modo="sacos" class="ativo">Só etiquetas (sacos)</button><button type="button" data-modo="dividir">Dividir o lote e registrar</button></div>
    <p class="peq muted" id="ajuda"></p>
    <div class="tabela-wrap"><table><thead><tr><th>Tamanho</th><th class="n">Peças</th><th class="n">Volumes</th><th class="col-div">Peças em cada volume</th></tr></thead><tbody>
    ${tams.map(t => `<tr data-t="${t.id}"><td class="forte">${h(t.nome)}</td><td class="n">${num(pecas(t.id))}</td>
      <td class="n"><input class="inp num" type="number" min="0" step="1" data-n value="${reg(t.id).length || ''}"></td>
      <td class="col-div"><input class="inp" data-q value="${h(reg(t.id).join(' + '))}" placeholder="ex.: 200 + 200 + 200"></td></tr>`).join('')}
    </tbody></table></div>`;
  modal({ titulo: `Etiqueta de volume · lote ${c.lote}`, corpo, largo: true,
    aoAbrir: (m) => {
      let modo = vols.length ? 'dividir' : 'sacos';
      const aplicar = () => {
        m.querySelectorAll('[data-modo]').forEach(b => b.classList.toggle('ativo', b.dataset.modo === modo));
        m.querySelectorAll('.col-div').forEach(x => x.style.display = modo === 'dividir' ? '' : 'none');
        m.querySelector('#ajuda').innerHTML = modo === 'dividir'
          ? 'O tamanho é dividido em volumes com quantidade definida (ex.: 600 P → 200 + 200 + 200). A divisão fica registrada no lote e a quantidade sai na etiqueta.'
          : 'Só imprime as etiquetas: o lote continua o mesmo, as peças apenas foram em sacos diferentes (ex.: frente e costas). Deixe em branco o tamanho que não quer imprimir.';
      };
      m.querySelectorAll('[data-modo]').forEach(b => b.onclick = () => { modo = b.dataset.modo; aplicar(); });
      m.querySelectorAll('[data-n]').forEach(i => i.oninput = () => {
        const tr = i.closest('tr'), n = Math.floor(+i.value || 0), tot = pecas(+tr.dataset.t);
        if (n > 0) { const base = Math.floor(tot / n), resto = tot - base * n; tr.querySelector('[data-q]').value = Array.from({ length: n }, (_, k) => base + (k < resto ? 1 : 0)).join(' + '); }
      });
      m.dataset.modo = modo; m._modo = () => modo; aplicar();
    },
    botoes: [{ texto: 'Cancelar' }, { texto: 'Imprimir', classe: 'pri', acao: async (m) => {
      const modo = m._modo(); const imprimir = [];
      for (const tr of m.querySelectorAll('tbody tr')) {
        const t = +tr.dataset.t, n = Math.floor(+tr.querySelector('[data-n]').value || 0);
        if (modo === 'sacos') { if (n > 0) imprimir.push({ t, n, qtds: null }); continue; }
        const txt = tr.querySelector('[data-q]').value.trim();
        if (!txt) continue;
        const qtds = txt.split(/[+;,\s]+/).filter(Boolean).map(Number);
        if (qtds.some(q => !(q > 0) || q % 1)) { toast('Use só números inteiros separados por +.', 'erro'); return false; }
        const soma = qtds.reduce((a, q) => a + q, 0);
        if (soma !== pecas(t)) { toast(`Tamanho ${tams.find(x => x.id === t).nome}: a soma (${soma}) tem que dar ${pecas(t)} peças.`, 'erro'); return false; }
        if (!await chamar(db, 'registrar_volumes', { p_corte_id: c.id, p_tamanho_id: t, p_qtds: qtds })) return false;
        imprimir.push({ t, n: qtds.length, qtds });
      }
      if (!imprimir.length) { toast('Informe os volumes de pelo menos um tamanho.', 'erro'); return false; }
      const qr = (txt) => { if (!window.qrcode) return ''; const q = window.qrcode(0, 'M'); q.addData(String(txt)); q.make(); return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true }); };
      imprimirHtml(imprimir.flatMap(({ t, n, qtds }) => { const tm = tams.find(x => x.id === t); return Array.from({ length: n }, (_, k) => `<div class="vol"><table>
        <tr><th class="v-rot"><img class="v-logo" src="img/simbolo-gms-pb.png" alt=""> MODELO:</th><td class="v-cod">${h(prod.cod)}</td><td class="v-qr" rowspan="2">${qr(c.lote + tm.nome)}</td></tr>
        <tr><td colspan="2" class="v-nome">${h(prod.nome_base)}</td></tr>
        <tr><td colspan="2" class="v-data"><span>DATA:</span> ${data(c.cortado_em || c.data)}</td><td rowspan="2" class="v-tam"><small>TAMANHO</small>${h(tm.nome)}</td></tr>
        <tr><th colspan="2" class="v-rot" style="text-align:left">LOTE:</th></tr>
        <tr><td colspan="3" class="v-lote">${h(c.lote)}</td></tr>
        <tr><td colspan="3" class="v-vol">VOLUME: <b>${k + 1}/${n}</b>${qtds ? ` · <b>${qtds[k]}</b> peças` : ''}</td></tr>
        <tr><td colspan="3" class="v-cores">${h(cores(t).join(' · '))}</td></tr></table></div>`); }).join(''));
    } }] });
}
