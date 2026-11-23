import { db, tem } from '../app.js';
import { h, num, data, dataHora, chip, ler, distintos, filtroSel, contem, chamar, toast, formModal, cadastros, confirmar } from '../util.js';

// Estoque por SKU e vendas do Upseller (antigo web app "GMS | Estoque e Upseller" do Apps Script).
let aba = 'saldo', busca = '', fCanal = '', zerados = false;
let arq = null; // arquivo lido: { nome, hash, cab, linhas, mapa, previa }

const CAMPOS = [
  ['pedido', 'Pedido', /pedido|numero.*pedido|order/, true],
  ['sku', 'SKU', /sku|codigo.*produto|referencia/, true],
  ['qtd', 'Quantidade', /quantidade|qtd|quantity/, true],
  ['loja', 'Nome da loja', /^(.*nome.*loja|loja|loja.*venda|canal.*venda|sales.*channel|marketplace|origem.*venda|seller|plataforma|store|site.*venda)$/, false],
  ['data', 'Data', /data|date/, false],
  ['produto', 'Produto', /produto|nome.*produto/, false],
];
const semAcento = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

async function carregarXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((ok, erro) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => erro(new Error('Não foi possível carregar o leitor de planilhas.')); document.head.appendChild(s); });
  return window.XLSX;
}
async function sha256(buf) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join(''); }
const celula = (v) => v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}` : String(v ?? '').trim();

async function lerArquivo(file) {
  if (file.size > 8 * 1024 * 1024) throw new Error('Arquivo maior que 8 MB.');
  const XLSX = await carregarXlsx();
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
  if (rows.length < 2) throw new Error('O arquivo não tem linhas de venda.');
  if (rows.length - 1 > 3000) throw new Error('Envie até 3000 linhas por arquivo.');
  const cab = rows[0].map(c => String(c ?? '').trim());
  const mapa = {};
  CAMPOS.forEach(([k, , re]) => { mapa[k] = cab.findIndex((c, i) => re.test(semAcento(c)) && !Object.values(mapa).includes(i)); });
  return { nome: file.name, file, hash: await sha256(buf), cab, rows: rows.slice(1), mapa, previa: null };
}
function linhasPayload() {
  const pega = (r, k) => arq.mapa[k] >= 0 ? celula(r[arq.mapa[k]]) : null;
  return arq.rows.map((r, i) => ({ linha: i + 2, pedido: pega(r, 'pedido'), sku: pega(r, 'sku'), qtd: pega(r, 'qtd'), loja: pega(r, 'loja'), data: pega(r, 'data'), produto: pega(r, 'produto') }))
    .filter(l => [l.pedido, l.sku, l.qtd].some(v => v));
}

// sugestão de cadastro a partir do SKU (código-cor[/cor/cor]-tamanho)
async function cadastrarSku(sku, aoSalvar) {
  const cad = await cadastros(db);
  const partes = String(sku).toUpperCase().split(/\s*-\s*/);
  const cod = partes[0], tam = partes.length > 2 ? partes[partes.length - 1] : '';
  const coresSku = partes.slice(1, partes.length > 2 ? -1 : undefined).join('-').split(/\s*\/\s*/).filter(Boolean);
  const achaCor = (c) => { const a = semAcento(c).replace(/[^a-z0-9]/g, ''); const alias = { marinho: 'azulmarinho', azmarinho: 'azulmarinho', pt: 'preto', pto: 'preto', cz: 'cinza', cza: 'cinza', bco: 'branco' }[a] || a;
    return (cad.cores.find(x => semAcento(x.nome).replace(/[^a-z0-9]/g, '') === alias) || {}).nome || ''; };
  const prod = cad.produtos.find(p => String(p.codigo || '').toUpperCase() === cod);
  const tamOk = (cad.tamanhos.find(t => semAcento(t.nome) === semAcento(tam)) || {}).nome || '';
  const opsCor = cad.cores.filter(c => c.ativo !== false).map(c => [c.nome, c.nome]);
  const v = await formModal({ titulo: 'Cadastrar SKU do Upseller', largo: true, botao: 'Cadastrar',
    texto: `<p class="peq muted">SKU <b>${h(sku)}</b>. Confira a sugestão. Para kit, informe o nome do kit e as cores; cada cor precisa ter o SKU físico (produto-cor-tamanho) cadastrado.</p>`,
    campos: [
      { k: 'codigo_produto', r: 'Produto', tipo: 'select', req: true, valor: prod ? prod.codigo : '', opcoes: cad.produtos.filter(p => p.codigo).map(p => [p.codigo, p.nome]) },
      { k: 'tamanho', r: 'Tamanho', tipo: 'select', req: true, valor: tamOk, opcoes: cad.tamanhos.map(t => [t.nome, t.nome]) },
      { k: 'cor', r: 'Cor', tipo: 'select', req: true, valor: achaCor(coresSku[0]), opcoes: opsCor },
      { k: 'cor2', r: 'Cor 2 / Estampa', tipo: 'select', vazio: '—', valor: achaCor(coresSku[1]), opcoes: opsCor },
      { k: 'cor3', r: 'Cor 3', tipo: 'select', vazio: '—', valor: achaCor(coresSku[2]), opcoes: opsCor },
      { k: 'kit', r: 'Kit (ex.: KIT 3)', valor: coresSku.length > 1 ? `KIT ${coresSku.length}` : '' },
    ] });
  if (!v) return;
  const p = cad.produtos.find(x => x.codigo === v.codigo_produto);
  return aoSalvar({ ...v, sku, produto: p ? p.nome_base : '' });
}

export async function render(el) {
  el.innerHTML = `
    <div class="cab"><div><h1>SKU / Upseller</h1><p>Saldo por SKU, movimentos e vendas do Upseller pendentes de cadastro.</p></div></div>
    <div class="abas">
      <button data-a="saldo" class="${aba === 'saldo' ? 'ativo' : ''}">Saldo por SKU</button>
      ${tem('estoque') ? `<button data-a="importar" class="${aba === 'importar' ? 'ativo' : ''}">Importar Upseller</button>
      <button data-a="entrada" class="${aba === 'entrada' ? 'ativo' : ''}">Entrada / Inventário</button>` : ''}
      <button data-a="mov" class="${aba === 'mov' ? 'ativo' : ''}">Movimentos</button>
      <button data-a="pend" class="${aba === 'pend' ? 'ativo' : ''}">Pendências Upseller</button>
      <button data-a="imp" class="${aba === 'imp' ? 'ativo' : ''}">Importações</button>
    </div><div id="alvo"></div>`;
  el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { aba = b.dataset.a; render(el); });
  const alvo = el.querySelector('#alvo');
  const filtroBusca = `<label class="campo">Buscar<input id="fb" value="${h(busca)}" placeholder="SKU, produto, pedido…"></label>`;
  const ligarBusca = () => { alvo.querySelector('#fb').onchange = (e) => { busca = e.target.value; render(el); }; };

  if (aba === 'importar') return telaImportar(el, alvo);
  if (aba === 'entrada') return telaEntrada(el, alvo);
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
      <div class="tabela-wrap"><table><thead><tr><th>Arquivo</th><th class="n">Linha</th><th>Pedido</th><th>SKU</th><th class="n">Qtd</th><th>Canal</th><th>Status</th><th>Motivo</th><th></th></tr></thead>
      <tbody>${pend.map(p => `<tr><td class="peq">${h(p.arquivo)}</td><td class="n">${p.linha_arquivo ?? ''}</td><td>${h(p.pedido || '')}</td><td>${h(p.sku_original || '')}</td>
        <td class="n">${num(p.qtd)}</td><td>${h(p.loja_canal || '')}</td><td>${chip(p.status, 'alerta')}</td><td class="peq">${h(p.motivo || '')}</td>
        <td>${tem('estoque') && p.status === 'PENDENTE' ? `<button class="peq" data-res="${p.id}">Regularizar</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Sem pendências.</td></tr>'}</tbody></table></div>`;
    alvo.querySelector('#fc').onchange = (e) => { fCanal = e.target.value; render(el); };
    alvo.querySelectorAll('[data-res]').forEach(b => b.onclick = async () => {
      const p = pend.find(x => x.id === b.dataset.res);
      const resolver = async (d) => { const r = await chamar(db, 'upseller_resolver_pendencia', { p_item_id: p.id, d }); if (r) { toast(r.conciliado ? 'Movimentos conciliados.' : `Baixa de ${num(r.quantidade)} peça(s) efetuada.`, 'ok'); render(el); } };
      if (/não cadastrado/i.test(p.motivo || '')) return cadastrarSku(p.sku_normalizado || p.sku_original, resolver);
      if (/peças físicas/i.test(p.motivo || '')) {
        const sug = (p.motivo.split(':')[1] || '').split(',').map(x => x.trim()).filter(Boolean);
        toast(`Cadastre primeiro o SKU físico de: ${sug.join(', ')}. Depois clique em Regularizar de novo.`, 'alerta');
        const cod = String(p.sku_normalizado || '').split('-')[0];
        const [cor, tam] = (sug[0] || '').split(' / ');
        return cadastrarSku(`${cod}-${(cor || '').toUpperCase()}-${tam || ''}`, async (d) => { if (await chamar(db, 'cadastrar_sku', { d })) { toast('SKU físico cadastrado.', 'ok'); render(el); } });
      }
      if (await confirmar('Regularizar pendência', `Dar baixa de ${num(p.qtd)} peça(s) do SKU ${h(p.sku_normalizado)} (pedido ${h(p.pedido)})?`, 'Dar baixa')) resolver(null);
    });
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

async function telaImportar(el, alvo) {
  if (!arq) {
    alvo.innerHTML = `<div class="card"><p>Envie o relatório de vendas exportado do Upseller (.xlsx ou .csv, até 3000 linhas). Cada pedido + SKU é baixado uma única vez; kits viram as peças físicas de cada cor.</p>
      <label class="campo">Arquivo<input type="file" id="arq" accept=".xlsx,.xls,.csv"></label></div>`;
    alvo.querySelector('#arq').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { arq = await lerArquivo(f); render(el); } catch (err) { toast(err.message, 'erro'); }
    };
    return;
  }
  const opc = (k, obrig) => `<option value="-1">${obrig ? 'Selecione…' : 'Não informado'}</option>` + arq.cab.map((c, i) => `<option value="${i}" ${arq.mapa[k] === i ? 'selected' : ''}>${h(c || `Coluna ${i + 1}`)}</option>`).join('');
  const pv = arq.previa;
  alvo.innerHTML = `<div class="card"><p><b>${h(arq.nome)}</b> · ${num(arq.rows.length)} linhas <button class="peq" id="trocar">Trocar arquivo</button></p>
    <div class="grade g3">${CAMPOS.map(([k, r, , obrig]) => `<label class="campo">${h(r)}${obrig || k === 'loja' ? ' *' : ''}<select data-m="${k}">${opc(k, obrig || k === 'loja')}</select></label>`).join('')}</div>
    <div class="acoes"><button class="pri" id="validar">Conferir arquivo</button></div></div>
    ${pv ? `<div class="card">
      ${pv.ja_importado ? `<p>${chip('Este arquivo já foi importado', 'erro')}</p>` : ''}
      <p>${chip(`${num(pv.validos)} válidas`, 'ok')} ${chip(`${num(pv.pendentes)} pendentes / duplicadas`, pv.pendentes ? 'alerta' : '')} · ${num(pv.quantidade)} peças a baixar
      ${pv.sem_loja ? chip(`${num(pv.sem_loja)} sem loja`, 'erro') : ''}</p>
      ${pv.motivos.length ? `<div class="tabela-wrap"><table><thead><tr><th class="n">Linha</th><th>Pedido</th><th>SKU</th><th class="n">Qtd</th><th>Status</th><th>Motivo</th></tr></thead><tbody>
        ${pv.motivos.map(m => `<tr><td class="n">${m.linha}</td><td>${h(m.pedido)}</td><td>${h(m.sku_original)}</td><td class="n">${num(m.qtd)}</td><td>${chip(m.status, 'alerta')}</td><td class="peq">${h(m.motivo)}</td></tr>`).join('')}
        </tbody></table></div><p class="peq muted">As pendentes ficam gravadas e podem ser regularizadas na aba Pendências depois do cadastro do SKU.</p>` : ''}
      <div class="acoes"><button class="pri" id="gravar" ${pv.ja_importado || !pv.validos && !pv.pendentes ? 'disabled' : ''}>Confirmar importação e dar baixa</button></div></div>` : ''}`;
  alvo.querySelector('#trocar').onclick = () => { arq = null; render(el); };
  alvo.querySelectorAll('[data-m]').forEach(s => s.onchange = () => { arq.mapa[s.dataset.m] = Number(s.value); arq.previa = null; render(el); });
  alvo.querySelector('#validar').onclick = async () => {
    if (['pedido', 'sku', 'qtd'].some(k => arq.mapa[k] < 0)) return toast('Escolha as colunas de pedido, SKU e quantidade.', 'erro');
    if (arq.mapa.loja < 0) return toast('Obrigatório selecionar a coluna Nome da Loja no UpSeller.', 'erro');
    const r = await chamar(db, 'upseller_validar', { p_linhas: linhasPayload(), p_hash: arq.hash });
    if (r) { arq.previa = r; render(el); }
  };
  const g = alvo.querySelector('#gravar');
  if (g) g.onclick = async () => {
    if (!await confirmar('Confirmar importação', `Gravar ${num(pv.validos)} venda(s) e baixar ${num(pv.quantidade)} peça(s) do estoque? Esta ação não pode ser repetida para o mesmo arquivo.`, 'Importar')) return;
    g.disabled = true;
    const r = await chamar(db, 'upseller_registrar', { p_arquivo: arq.nome, p_hash: arq.hash, p_linhas: linhasPayload(), p_tem_coluna_loja: arq.mapa.loja >= 0 });
    if (!r) { g.disabled = false; return; }
    const caminho = `${r.importacao_id}/${arq.nome.replace(/[^\w.\-]+/g, '_')}`;
    const up = await db.storage.from('gms-upseller').upload(caminho, arq.file, { upsert: false });
    if (!up.error) await chamar(db, 'upseller_anexar', { p_importacao_id: r.importacao_id, p_path: caminho }, { silencioso: true });
    else toast('Importação gravada, mas o arquivo original não foi guardado.', 'alerta');
    toast(`Importação concluída: ${num(r.aprovados)} baixadas, ${num(r.pendentes)} pendentes, ${num(r.quantidade)} peças.`, 'ok');
    arq = null; aba = r.pendentes ? 'pend' : 'imp'; render(el);
  };
}

async function telaEntrada(el, alvo) {
  const skus = await ler(db.from('v_sku_saldo').select('sku,nome,kit,cor1,cor2,tamanho,saldo').order('sku').limit(5000));
  const fisicos = skus.filter(s => !(s.kit && s.cor2));
  alvo.innerHTML = `<datalist id="dl-sku">${fisicos.map(s => `<option value="${h(s.sku)}">${h([s.nome, s.cor1, s.tamanho].filter(Boolean).join(' · '))} · saldo ${num(s.saldo)}</option>`).join('')}</datalist>
    <div class="grade g2">
    <div class="card"><h2>Entrada de estoque</h2><p class="peq muted">Peças físicas que chegaram ao estoque (não use kit virtual).</p>
      <label class="campo">SKU<input id="e-sku" list="dl-sku"></label><label class="campo">Quantidade<input id="e-qtd" type="number" min="1" step="1"></label>
      <label class="campo">Origem<input id="e-org" placeholder="Ex.: produção, devolução"></label><label class="campo">Obs.<input id="e-obs"></label>
      <div class="acoes"><button class="pri" id="e-ok">Registrar entrada</button></div></div>
    <div class="card"><h2>Inventário</h2><p class="peq muted">Informe a contagem física; o sistema lança só a diferença.</p>
      <label class="campo">SKU<input id="i-sku" list="dl-sku"></label><label class="campo">Contagem física<input id="i-qtd" type="number" min="0" step="1"></label>
      <label class="campo">Obs.<input id="i-obs"></label>
      <div class="acoes"><button class="pri" id="i-ok">Conferir</button></div></div></div>`;
  const v = (id) => alvo.querySelector(id).value.trim();
  alvo.querySelector('#e-ok').onclick = async () => {
    const q = Number(v('#e-qtd'));
    if (!v('#e-sku') || !(q > 0) || q % 1) return toast('Informe o SKU e uma quantidade inteira positiva.', 'erro');
    const r = await chamar(db, 'sku_entrada', { p_sku: v('#e-sku'), p_qtd: q, p_origem: v('#e-org') || null, p_obs: v('#e-obs') || null });
    if (r) { toast(`Entrada de ${num(r.quantidade)} peça(s) em ${r.sku}.`, 'ok'); render(el); }
  };
  alvo.querySelector('#i-ok').onclick = async () => {
    const q = Number(v('#i-qtd'));
    if (!v('#i-sku') || v('#i-qtd') === '' || q < 0 || q % 1) return toast('Informe o SKU e a contagem (inteiro, zero ou mais).', 'erro');
    const a = await chamar(db, 'sku_inventario_previa', { p_sku: v('#i-sku'), p_contagem: q });
    if (!a) return;
    if (a.diferenca === 0) return toast('Contagem igual ao saldo do sistema; nada a ajustar.', 'ok');
    if (!await confirmar('Ajuste de inventário', `${h(a.sku)} · ${h(a.produto || '')} ${h(a.cor || '')} ${h(a.tamanho || '')}<br>Saldo no sistema: <b>${num(a.saldo_sistema)}</b> · Contagem: <b>${num(a.contagem)}</b><br>Ajuste: <b>${a.diferenca > 0 ? '+' : ''}${num(a.diferenca)}</b>`, 'Registrar ajuste')) return;
    const r = await chamar(db, 'sku_inventario_registrar', { p_sku: a.sku, p_contagem: q, p_obs: v('#i-obs') || null, p_saldo_conferido: a.saldo_sistema });
    if (r) { toast('Ajuste de inventário registrado.', 'ok'); render(el); }
  };
}
