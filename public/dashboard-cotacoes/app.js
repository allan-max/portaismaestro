/* Gestão administrativa: consultas sem comandos de escrita operacional. */
(function () {
  'use strict';
  const D = window.DashboardData;
  const state = { view: 'overview', sellers: [], status: '', deadline: '', from: '', to: '', search: '', sort: 'asc', page: 1, dateMode: 'safe' };
  const prazoUrl = new URLSearchParams(location.search).get('prazo');   // link da faixa de saúde
  if (['today', 'overdue', 'next7'].includes(prazoUrl)) Object.assign(state, { deadline: prazoUrl, view: 'quotes' });
  let authorized = false, accessState = 'checking', sourceState = 'loading', sourceError = '', rawRows = [], lastSuccess = null;
  let account = '', socket, requestId = '', sequence = 0, requestTimer, sessionTimer, exporting = false, reloadAfter = false;
  const number = value => Number(value).toLocaleString('pt-BR');
  const paths = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    history: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8M3 3v5h5M12 7v5l3 2"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    refresh: '<path d="M20 7a8.1 8.1 0 0 0-14-2L3 8M3 3v5h5M4 17a8.1 8.1 0 0 0 14 2l3-3M16 16h5v5"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6zM18 12h.01"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    alert: '<path d="m10.3 3.9-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    shield: '<path d="m12 3 9 4v5c0 5-9 10-9 10S3 17 3 12V7z"/><path d="m8 12 3 3 5-6"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2M5.5 4h13l3.5 8v7a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-7z"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    chart: '<path d="M3 3v18h18M7 15l4-5 4 3 5-7"/>',
    cart: '<path d="M3 3h2l3 12h11l3-9H6M9 20h.01M18 20h.01"/>',
    filter: '<path d="M4 4h16l-6 8v7l-4 2v-9z"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.file}</svg>`;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const date = value => D.validDate(value) ? value.slice(8, 10) + '/' + value.slice(5, 7) + '/' + value.slice(0, 4) : 'Não informado';
  const timestamp = value => value ? new Date(value).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : 'Não registrado';
  const initials = seller => seller === 'Sem vendedor' ? '—' : esc(seller.slice(0, 2).toUpperCase());
  const avatar = seller => `<span class="avatar" aria-hidden="true">${initials(seller)}</span>`;
  const response = row => `<span class="status-badge ${D.STATUS[row.status].color}">${D.STATUS[row.status].short}</span>`;
  const deadlineLabels = { overdue: 'Vencida', today: 'Vence hoje', week: 'Próximos 7 dias', later: 'No prazo', missing: 'Sem data' };
  const deadlineBadge = row => `<span class="deadline-badge ${({ overdue: 'red', today: 'amber', week: 'blue' })[D.deadline(row)] || ''}">${deadlineLabels[D.deadline(row)]}</span>`;
  const btn = (action, label, glyph, cls = '') => `<button class="button ${cls}" data-action="${action}" aria-label="${esc(label)}">${glyph ? icon(glyph) : ''}<span>${label}</span></button>`;
  const app = document.getElementById('app');
  // Controle → Auditoria / Usuários (dashboard-cotacoes/auditoria.js)
  const A = window.DashAuditoria.criar({ icon, esc, btn, number, timestamp: v => v ? new Date(v).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'medium' }) : 'Não registrado',
    mountDialog: html => mountDialog(html), toast: m => toast(m), render: () => render(), socket: () => socket,
    irPara: view => { state.view = view; state.page = 1; render(); A.carregar(false); } });

  function nav() {
    return `<nav class="subnav" aria-label="Seções da gestão">${[
      ['overview', 'Visão geral', 'grid'], ['vendors', 'Vendedores', 'users'], ['quotes', 'Cotações', 'file'], ['history', 'Histórico', 'history']
    ].map(([key, label, glyph]) => `<button data-view="${key}" ${state.view === key ? 'class="selected" aria-current="page"' : ''}>${icon(glyph)}${label}${key === 'quotes' ? `<span class="nav-count">${D.select(D.rows, state).length}</span>` : ''}</button>`).join('')}</nav>`;
  }
  function portal() {
    const status = sourceState === 'ready' ? `Atualizado às ${new Date(lastSuccess).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}` : sourceState === 'loading' ? 'Consultando a base…' : 'Dados indisponíveis ou desatualizados';
    return `<header class="portal-nav"><a href="index.html?portais=1" class="brand" aria-label="Voltar ao portal Maestro"><span class="brand-logo"><img src="img/logo-maestro-dashboard.png" alt=""></span>MAESTRO</a><div class="portal-links"><a class="portal-link" href="index.html?portais=1">${icon('left')}Voltar ao portal</a></div><div class="portal-right"><span class="source-pill ${sourceState === 'error' ? 'amber' : ''}"><span class="status-dot ${sourceState === 'error' ? 'offline' : ''}"></span>${status}</span><div class="admin-account" title="${esc(account)}">${avatar('Admin')}<span>Administrador</span></div></div></header>`;
  }
  function heading() {
    return `<div class="heading"><div><div class="breadcrumb">ADMINISTRAÇÃO ${icon('chevron')} ACOMPANHAMENTO DA EQUIPE</div><h1>Gestão de cotações</h1><p>Acompanhe carteira, prazos e respostas da equipe.</p></div>
      <div class="actions">${btn('refresh', sourceState === 'loading' ? 'Atualizando…' : 'Atualizar', 'refresh')}${btn('print', 'Imprimir', 'print', 'print-button')}${btn('export', exporting ? 'Gerando Excel…' : 'Exportar Excel', 'download', 'primary')}</div></div>`;
  }
  function filters() {
    const sellers = [...D.SELLERS, ...(D.rows.some(r => r.seller === 'Sem vendedor') ? ['Sem vendedor'] : [])];
    const chips = [
      ...state.sellers.map(s => `<button class="chip" data-remove-seller="${esc(s)}" aria-label="Remover filtro ${esc(s)}">${esc(s)}${icon('close')}</button>`),
      state.status ? `<button class="chip" data-clear="status">${D.STATUS[state.status].label}${icon('close')}</button>` : '',
      state.deadline ? `<button class="chip" data-clear="deadline">${({ active: 'Carteira no prazo', pendingActive: 'Pendentes no prazo', next7: 'Próximos 7 dias' })[state.deadline] || deadlineLabels[state.deadline]}${icon('close')}</button>` : ''
    ].join('');
    return `<div class="filterbar" role="search" aria-label="Filtros globais">
      <div class="field"><span class="field-label" id="seller-label">Vendedores</span><details class="vendor-picker" id="vendor-picker"><summary aria-labelledby="seller-label seller-value"><span id="seller-value">${state.sellers.length === 1 ? esc(state.sellers[0]) : state.sellers.length ? state.sellers.length + ' selecionados' : 'Todos os vendedores'}</span>${icon('down')}</summary>
      <div class="vendor-menu">${sellers.map(s => `<label><input type="checkbox" data-seller="${esc(s)}" ${state.sellers.includes(s) ? 'checked' : ''}>${esc(s)}</label>`).join('')}${btn('vendors-done', 'Concluir seleção', 'check')}</div></details></div>
      <label class="field"><span class="field-label">Vencimento de</span><input type="date" id="filter-from" value="${state.from}" ${state.from && state.to && state.from > state.to ? 'aria-describedby="date-error" aria-invalid="true"' : ''}></label>
      <label class="field"><span class="field-label">Até</span><input type="date" id="filter-to" value="${state.to}" ${state.from && state.to && state.from > state.to ? 'aria-describedby="date-error" aria-invalid="true"' : ''}></label>
      <label class="field"><span class="field-label">Status de resposta</span><select id="filter-status"><option value="">Todos os status</option>${Object.entries(D.STATUS).map(([key, value]) => `<option value="${key}" ${state.status === key ? 'selected' : ''}>${value.label}</option>`).join('')}</select></label>
      <label class="field date-mode-field"><span class="field-label">Datas ambíguas ${icon('info')}</span><select id="date-mode" title="A base contém datas BR e US. Escolha como ler valores como 06/07/2026. Datas inequívocas não mudam."><option value="safe" ${state.dateMode === 'safe' ? 'selected' : ''}>Sinalizar para revisão</option><option value="br" ${state.dateMode === 'br' ? 'selected' : ''}>Interpretar dia/mês/ano</option><option value="us" ${state.dateMode === 'us' ? 'selected' : ''}>Interpretar mês/dia/ano</option></select></label>
      <label class="field search-field"><span class="field-label">Buscar na carteira</span><span class="search-box">${icon('search')}<input id="filter-search" type="search" placeholder="Cotação, item ou localidade…" value="${esc(state.search)}"></span></label>
    </div>
    <div id="date-error" class="error-text" ${state.from && state.to && state.from > state.to ? '' : 'hidden'}>A data inicial precisa ser anterior ou igual à data final.</div>
    <div class="filter-meta"><div class="cohort">${icon('calendar')}<span>${state.from || state.to ? `Vencimento: ${state.from ? date(state.from) : 'sem início'} a ${state.to ? date(state.to) : 'sem fim'}` : 'Todo o período · inclui registros históricos'} <span class="muted">/ Referência: ${date(D.TODAY)}</span></span></div>
    <div class="filter-chips">${chips}${state.sellers.length || state.status || state.deadline || state.search || state.from || state.to ? btn('clear', 'Limpar filtros', '', 'text small') : btn('pending', 'Pendentes no prazo', 'filter', 'text small')}</div></div>`;
  }
  function metrics(data) {
    const m = D.metrics(data);
    return `<section class="metrics" aria-label="Indicadores do recorte">${[
      ['active', 'Carteira no prazo', 'calendar', '', 'vencimento a partir de hoje'],
      ['pendingActive', 'Sem resposta registrada no prazo', 'inbox', 'blue', 'não respondidas + sem informação'],
      ['today', 'Vencem hoje', 'clock', 'amber', 'sem resposta registrada'],
      ['next7', 'Próximos 7 dias', 'calendar', '', `${date(D.TODAY)} a ${date(D.day(D.TODAY, 7))} · inclusive`],
      ['overdue', 'Vencidas sem resposta registrada', 'alert', 'red', 'prazo anterior a hoje'],
      ['draft', 'Rascunhos a enviar', 'inbox', 'cyan', 'salvos pelo robô; falta enviar ao cliente'],
      ['responded', 'Resposta registrada', 'check', 'green', 'no recorte selecionado']
    ].map(([key, label, glyph, color, foot]) => `<button class="metric ${state.deadline === key || state.status === key ? 'selected' : ''}" data-metric="${key}" aria-pressed="${state.deadline === key || state.status === key}" title="Aplicar filtro: ${label}. Unidade: registros de cotação."><span class="metric-label">${label}</span><span class="metric-icon">${icon(glyph)}</span><strong class="metric-value number ${color}">${number(m[key])}</strong><span class="metric-foot">${foot}</span></button>`).join('')}</section>`;
  }
  const counts = data => Object.keys(D.STATUS).map(status => data.filter(r => r.status === status).length);
  const segment = (status, value, total) => `<span class="segment ${D.STATUS[status].color}" style="width:${total ? value / total * 100 : 0}%"></span>`;
  function sellerChart(data) {
    const allGroups = [...new Set(data.map(r => r.seller))].map(s => ({ name: s, rows: data.filter(r => r.seller === s) })).sort((a, b) => b.rows.length - a.rows.length);
    const groups = allGroups.slice(0, 8);
    const max = Math.max(1, ...groups.map(s => s.rows.length));
    return `<section class="panel"><div class="panel-head"><div><h2>Carteira por vendedor</h2><p>Distribuição dos registros por status</p></div><button class="panel-link" data-view="vendors" aria-label="Ver todos os vendedores">Ver equipe ${icon('arrow')}</button></div>
      <div class="panel-body"><div class="legend"><span><i class="swatch green"></i>Resposta</span><span><i class="swatch"></i>Não respondida</span><span><i class="swatch cyan"></i>Rascunho</span><span><i class="swatch muted"></i>Sem informação</span><span><i class="swatch amber"></i>Não reconhecido</span></div>
      <div class="seller-bars">${groups.map(s => `<button class="seller-bar ${state.sellers.includes(s.name) ? 'selected' : ''}" data-select-seller="${esc(s.name)}" aria-label="Filtrar ${esc(s.name)}: ${s.rows.length} registros, ${D.metrics(s.rows).responded} com resposta registrada"><span>${esc(s.name)}</span><span class="bar-track" style="width:${s.rows.length / max * 100}%">${Object.keys(D.STATUS).map((k, i) => segment(k, counts(s.rows)[i], s.rows.length)).join('')}</span><span class="total number">${number(s.rows.length)}</span></button>`).join('') || '<p class="muted">Sem registros neste recorte.</p>'}</div><p class="chart-caption">${groups.length} de ${allGroups.length} carteiras por volume. Todas estão na aba Vendedores.</p></div></section>`;
  }
  function deadlineChart(data) {
    const groups = Array.from({ length: 8 }, (_, i) => { const due = D.day(D.TODAY, i); return { date: due, rows: data.filter(r => r.due === due) }; });
    const max = Math.max(1, ...groups.map(g => g.rows.length));
    return `<section class="panel"><div class="panel-head"><div><h2>Próximos vencimentos</h2><p>${date(D.TODAY)}–${date(D.day(D.TODAY, 7))} · inclusive</p></div>${icon('calendar')}</div><div class="panel-body"><div class="legend"><span><i class="swatch green"></i>Resposta</span><span><i class="swatch"></i>Não respondida</span><span><i class="swatch cyan"></i>Rascunho</span><span><i class="swatch muted"></i>Sem informação</span><span><i class="swatch amber"></i>Não reconhecido</span></div>
      <div class="deadline-chart" aria-label="Vencimentos de hoje até sete dias à frente, inclusive">${groups.map((g, i) => `<button class="day-column ${i === 0 ? 'today' : ''}" data-day="${g.date}" aria-label="Vencimento ${date(g.date)}: ${g.rows.length} registros"><span class="bar-value number">${g.rows.length}</span><span class="column-stack" style="height:${g.rows.length / max * 114}px">${Object.entries(D.STATUS).map(([k, v]) => `<span class="segment ${v.color}" style="height:${g.rows.length ? g.rows.filter(r => r.status === k).length / g.rows.length * 100 : 0}%;width:100%"></span>`).join('')}</span><span class="date-label">${g.date.slice(8)}/${g.date.slice(5, 7)}</span></button>`).join('')}</div><div class="chart-bottom"></div><p class="chart-caption">Os demais vencimentos continuam na lista de cotações.</p></div></section>`;
  }
  function statusChart(data) {
    const values = counts(data), total = data.length;
    let start = 0;
    const stops = values.map((value, i) => {
      const end = start + (total ? value / total * 100 : 0);
      const color = ['#34d399', '#60a5fa', '#7588a0', '#f4bf68'][i];
      const stop = `${color} ${start}% ${end}%`; start = end; return stop;
    }).join(',');
    const coverage = total ? Math.round(values[0] / total * 100) + '%' : '—';
    return `<section class="panel status-panel"><div class="panel-head"><div><h2>Status de resposta</h2><p>Cobertura dos registros da carteira</p></div></div><div class="panel-body"><div class="composition"><div class="donut" style="background:${total ? `conic-gradient(${stops})` : '#2a3441'}" aria-hidden="true"><span class="donut-center number">${total}<small>registros</small></span></div><div><strong class="coverage green number">${coverage}</strong><p class="composition-text">com resposta<br>registrada${total ? '' : ' · sem base'}</p></div></div>
      <div class="status-list">${Object.entries(D.STATUS).map(([k, v], i) => `<button class="status-line ${state.status === k ? 'selected' : ''}" data-status="${k}" aria-label="Filtrar ${v.label}: ${values[i]} registros"><i class="swatch ${v.color}"></i><span>${v.short}</span><b class="number">${values[i]}</b></button>`).join('')}</div></div></section>`;
  }
  function table(data, limit = 6, compact = false) {
    const sorted = D.sortRows(data, state.sort), pages = Math.max(1, Math.ceil(data.length / limit));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * limit, page = sorted.slice(start, start + limit);
    return `<section class="panel table-panel" id="quotation-table"><div class="panel-head"><div><div class="table-title"><h2>${'Cotações da carteira'}</h2><span class="counter number">${number(data.length)}</span></div><p>Ordem por vencimento · abra uma cotação para consultar</p></div><div class="table-toolbar"><select class="sort-select" id="sort-order" aria-label="Ordenação por vencimento"><option value="asc" ${state.sort === 'asc' ? 'selected' : ''}>Vencimento ↑ crescente</option><option value="desc" ${state.sort === 'desc' ? 'selected' : ''}>Vencimento ↓ decrescente</option></select>${state.view !== 'quotes' ? '<button class="panel-link" data-view="quotes">Ver todas ' + icon('arrow') + '</button>' : ''}</div></div>
      ${data.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Lista de cotações, deslize para ver todas as colunas"><table class="quote-table"><thead><tr><th>Cotação / item</th><th>Vendedor</th><th>Localidade</th><th>Vencimento</th><th>Prazo</th><th>Status de resposta</th>${compact ? '' : '<th>Resposta em</th><th>Canal</th>'}<th><span class="sr-only">Detalhes</span></th></tr></thead><tbody>${page.map(row => `<tr><td><button class="quote-ref" id="open-${row.id}" data-quote="${row.id}" aria-label="Abrir cotação ${esc(row.number)}">${esc(row.number)}</button><span class="item-description" title="${esc(row.item)}">${esc(row.item)}</span></td><td><span class="seller-cell">${avatar(row.seller)}${esc(row.seller)}</span></td><td>${esc(row.city)}</td><td class="number ${D.deadline(row) === 'overdue' ? 'red' : D.deadline(row) === 'today' ? 'amber' : ''}">${date(row.due)}</td><td>${deadlineBadge(row)}</td><td>${response(row)}</td>${compact ? '' : `<td class="${row.respondedAt ? 'number' : 'unknown-value'}">${row.respondedAt ? timestamp(row.respondedAt) : 'Não registrado'}</td><td class="${row.channel ? '' : 'unknown-value'}">${esc(row.channel || 'Não registrado')}</td>`}<td><button class="icon-button" data-quote="${row.id}" aria-label="Detalhes da cotação ${esc(row.number)}">${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">${icon('search')}<h3>Nenhuma cotação neste recorte</h3><p>Altere os filtros ou retorne à carteira completa.</p>${btn('clear', 'Limpar filtros', 'refresh')}</div>`}
      <div class="table-footer"><span>${data.length ? `${start + 1}–${Math.min(start + limit, data.length)} de ${data.length}` : '0'} registros <span class="muted">· cada linha conta como uma cotação</span></span><div class="pagination"><button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Página anterior">${icon('left')}</button><button class="selected" aria-current="page">${state.page}</button><span>de ${pages}</span><button data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''} aria-label="Próxima página">${icon('chevron')}</button></div></div></section>`;
  }
  function quality(data) {
    const m = D.metrics(data), unassigned = data.filter(r => r.seller === 'Sem vendedor').length;
    return `<div class="data-note">${icon('info')}<span>Qualidade dos dados: <b>${number(m.missing)}</b> sem data classificável (${number(m.ambiguous)} ambíguas) · <b>${number(m.invalid)}</b> com status não reconhecido · <b>${number(unassigned)}</b> sem vendedor.</span><button class="panel-link" data-action="quality">Revisar datas ${icon('arrow')}</button></div>`;
  }
  function sellersByUrgency(data) {
    return [...new Set(data.map(r => r.seller))].map(name => ({ name, rows: data.filter(r => r.seller === name), m: D.metrics(data.filter(r => r.seller === name)) }))
      .sort((a, b) => b.m.today - a.m.today || b.m.overdue - a.m.overdue || b.m.next7 - a.m.next7 || a.name.localeCompare(b.name));
  }
  function cards(data, all = false) {
    const sellers = sellersByUrgency(data);
    return `<div class="seller-cards">${(all ? sellers : sellers.slice(0, 6)).map(({ name, rows, m }) => `<button class="seller-card ${state.sellers.includes(name) ? 'selected' : ''}" data-select-seller="${esc(name)}" aria-label="Consultar carteira de ${esc(name)}: ${rows.length} registros"><div class="seller-card-head">${avatar(name)}<div><h3>${esc(name)}</h3><small>${rows.length} registros na carteira</small></div>${icon('chevron')}</div><div class="seller-card-stats"><strong class="number">${m.pendingActive}</strong><span>sem resposta no prazo</span></div><div class="mini-stats"><span><b class="amber number">${m.today}</b>Vencem hoje</span><span><b class="number">${m.next7}</b>Em 7 dias</span><span><b class="red number">${m.overdue}</b>Vencidas</span></div><div class="card-progress" aria-hidden="true">${Object.keys(D.STATUS).map((k, i) => segment(k, counts(rows)[i], rows.length)).join('')}</div><div class="card-progress-note"><span>${m.responded} com resposta registrada</span><span>${Math.round(m.responded / rows.length * 100)}%</span></div></button>`).join('')}</div>`;
  }
  function insights(data) {
    const m = D.metrics(data);
    return `<section class="panel"><div class="panel-head"><h2>Pontos de atenção</h2></div><div class="panel-body insight-list"><div class="insight">${icon('clock')}<div><strong>${m.today} cotações vencem hoje</strong><p>Sem resposta registrada no recorte.</p><button class="panel-link" data-metric="today">Consultar ${icon('arrow')}</button></div></div><div class="insight">${icon('alert')}<div><strong>${m.overdue} vencidas sem resposta</strong><p>Verifique a situação registrada e as evidências.</p><button class="panel-link" data-metric="overdue">Conferir ${icon('arrow')}</button></div></div><div class="insight">${icon('info')}<div><strong>Histórico incompleto</strong><p>Status não comprova data ou canal. Campos ausentes aparecem como “Não registrado”.</p></div></div></div></section>`;
  }
  function overview(data) {
    return `${metrics(data)}<div class="analysis-grid">${sellerChart(data)}${deadlineChart(data)}${statusChart(data)}</div>${table(data)}${quality(data)}`;
  }
  function vendors(data) {
    const sellers = sellersByUrgency(data);
    return `<div class="section-label"><div><h2>Acompanhamento por vendedor</h2><p>Ordem de urgência: vencem hoje, vencidas e próximos 7 dias.</p></div><span class="muted">${sellers.length} carteiras</span></div>${cards(data, true)}<section class="panel table-panel" style="margin-top:22px"><div class="panel-head"><div><h2>Resumo da equipe</h2><p>Contagens por registro · volume não representa desempenho comercial</p></div></div><div class="table-scroll" tabindex="0" role="region" aria-label="Resumo dos vendedores"><table class="vendor-table"><thead><tr><th>Vendedor</th><th>No prazo</th><th>Hoje</th><th>Em 7 dias</th><th>Vencidas sem resposta</th><th>Resposta registrada</th><th>Sem informação</th><th></th></tr></thead><tbody>${sellers.map(s => `<tr><td><span class="seller-cell">${avatar(s.name)}${esc(s.name)}</span></td><td class="number">${s.m.active}</td><td class="amber number">${s.m.today}</td><td class="number">${s.m.next7}</td><td class="red number">${s.m.overdue}</td><td class="green number">${s.m.responded}</td><td class="number muted">${s.m.unknown}</td><td><button class="panel-link" data-select-seller="${esc(s.name)}">Consultar ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div></section>${quality(data)}`;
  }
  function history(data) {
    const responded = data.filter(r => r.status === 'responded'), known = responded.filter(r => r.respondedAt);
    const pages = Math.max(1, Math.ceil(responded.length / 12)); state.page = Math.min(state.page, pages);
    const ordered = [...responded].sort((a, b) => (b.respondedAt || '').localeCompare(a.respondedAt || '') || Number(a.id) - Number(b.id));
    const events = ordered.slice((state.page - 1) * 12, state.page * 12);
    return `<div class="history-layout"><section class="panel"><div class="summary-rail"><div><strong class="green number">${number(responded.length)}</strong><span>respostas registradas</span><p>no recorte selecionado</p></div><div><strong class="number">${number(known.length)}</strong><span>com data de resposta</span><p>campo explícito disponível na fonte</p></div><div><strong class="amber number">${number(responded.length - known.length)}</strong><span>sem data de resposta</span><p>histórico de envio não registrado</p></div></div><div class="panel-head"><div><h2>Registros de resposta</h2><p>Data de resposta e data de detecção são informações distintas</p></div></div><div class="history-list">${events.map(row => `<article class="history-event"><span class="event-marker" aria-hidden="true"></span><div><small>${row.respondedAt ? 'RESPOSTA · ' + timestamp(row.respondedAt) : 'DATA DE RESPOSTA · NÃO REGISTRADO'}</small><h3 style="margin-top:5px">Cotação ${esc(row.number)} <span class="muted">· ${esc(row.seller)}</span></h3><p>Canal: ${esc(row.channel || 'Não registrado')} · Modo: ${esc(row.mode || 'Não registrado')}</p><span class="event-label">${esc(row.source)}</span></div><button class="panel-link" data-quote="${row.id}">Ver detalhes ${icon('arrow')}</button></article>`).join('') || '<div class="empty"><h3>Sem respostas registradas neste recorte</h3><p>Altere os filtros para consultar outros registros.</p></div>'}</div><div class="table-footer"><span>${number(responded.length)} registros com resposta</span><div class="pagination"><button data-page="${state.page - 1}" ${state.page === 1 ? 'disabled' : ''} aria-label="Página anterior">${icon('left')}</button><span>${state.page} de ${pages}</span><button data-page="${state.page + 1}" ${state.page === pages ? 'disabled' : ''} aria-label="Próxima página">${icon('chevron')}</button></div></div></section><aside><section class="panel"><div class="panel-head"><h2>Cobertura do histórico</h2></div><div class="panel-body evidence-definitions"><strong>Quando e como</strong><p>São apresentados somente campos explicitamente registrados na fonte. O status RESPONDIDO, sozinho, não comprova data, canal ou responsável pelo envio.</p><strong>Data de detecção</strong><p>Também permanece Não registrado quando a fonte não a fornece. O horário desta consulta não é a data da resposta.</p><strong>Registro administrativo</strong><p>Esta tela consulta a base atual. Não reconstrói eventos antigos nem grava alterações nas cotações.</p></div></section>${insights(data)}</aside></div>`;
  }
  function accessScreen() {
    const titles = { checking: 'Verificando acesso administrativo…', denied: 'Acesso restrito', expired: 'Sua sessão expirou', connection: 'Não foi possível conectar ao Maestro' };
    const descriptions = { checking: 'Aguarde a confirmação da sua sessão.', denied: 'Esta área é exclusiva de administradores. Se precisar de acesso, procure o administrador do Maestro.', expired: 'Entre novamente para consultar os dados.', connection: 'Verifique a conexão e tente novamente.' };
    app.innerHTML = `<main id="main" class="access-screen"><img class="access-logo" src="img/logo-maestro-dashboard.png" alt="Maestro"><h1>${titles[accessState]}</h1><p>${descriptions[accessState]}</p><div class="actions"><a class="button" href="index.html?portais=1">Voltar ao Maestro</a>${accessState === 'connection' ? btn('refresh', 'Tentar novamente', 'refresh') : ''}</div></main>`;
  }
  function render() {
    if (!authorized) return accessScreen();
    const focused = document.activeElement?.id;
    const position = ['filter-search', 'aud-busca', 'aud-busca-usuario'].includes(focused) ? document.activeElement.selectionStart : null;
    const vendorOpen = document.getElementById('vendor-picker')?.open;
    const data = D.select(D.rows, state);
    const loadedContent = state.view === 'vendors' ? vendors(data) : state.view === 'quotes' ? metrics(data) + table(data, 12) + quality(data) : state.view === 'history' ? history(data) : overview(data);
    const sourceNotice = sourceState === 'error' ? `<div class="source-notice" role="alert">${icon('alert')}<span>${esc(sourceError)} ${lastSuccess ? `Exibindo a última leitura de ${timestamp(lastSuccess)} (horário de Brasília), que pode estar desatualizada.` : 'Os indicadores serão exibidos depois de uma leitura válida.'}</span>${btn('refresh', 'Tentar novamente', 'refresh', 'small')}</div>` : sourceState === 'loading' && lastSuccess ? `<div class="source-notice" role="status">${icon('refresh')}<span>Atualizando. Até a confirmação, os dados exibidos são da leitura de ${timestamp(lastSuccess)} (horário de Brasília).</span></div>` : '';
    const controle = A.ativa(state.view);
    const content = controle ? A.conteudo(state.view) : lastSuccess ? loadedContent :`<section class="panel empty" role="status">${icon(sourceState === 'error' ? 'alert' : 'refresh')}<h2>${sourceState === 'error' ? 'Base indisponível' : 'Consultando as cotações…'}</h2><p>${sourceState === 'error' ? 'Use Atualizar para tentar uma nova leitura.' : 'Aguarde a confirmação do gerenciador.'}</p></section>`;
    app.innerHTML = `${portal()}<div class="page-wrap workspace"><aside class="sidebar"><div class="eyebrow">Gestão comercial</div>${nav()}${A.nav(state.view)}<div class="sidebar-bottom">${icon('shield')}<p>Visão administrativa</p><small>Consulta da carteira e evidências</small></div></aside><main class="page-main" id="main" tabindex="-1">${controle ? A.heading(state.view) + A.aviso() + A.filtros(state.view) : heading() + sourceNotice + filters()}<div id="content" aria-busy="${sourceState === 'loading'}">${content}</div><footer class="footer"><span>MAESTRO <span class="muted">/ Gestão comercial</span></span><span>Somente consulta · dados de resposta conforme evidência</span></footer></main></div>`;
    document.querySelectorAll('[data-action="export"], [data-action="print"]').forEach(b => { b.disabled = !data.length || sourceState !== 'ready' || exporting; });
    if (vendorOpen) document.getElementById('vendor-picker').open = true;
    const target = focused && document.getElementById(focused);
    if (target) { target.focus({ preventScroll: true }); if (position !== null) target.setSelectionRange(position, position); }
  }
  function changeFilters(updates) { Object.assign(state, updates, { page: 1 }); render(); }
  function clear() { changeFilters({ sellers: [], status: '', deadline: '', from: '', to: '', search: '' }); }
  let toastTimer;
  function toast(message) {
    const node = document.getElementById('toast'); node.textContent = message; node.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('show'), 5000);
  }
  let previousFocus;
  function closeDrawer() {
    document.getElementById('drawer-root').innerHTML = ''; document.body.style.overflow = '';
    app.inert = false;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function mountDialog(html) {
    previousFocus = document.activeElement;
    document.getElementById('drawer-root').innerHTML = html;
    app.inert = true; document.body.style.overflow = 'hidden';
    document.querySelector('[data-close-dialog]').focus();
  }
  function openQuote(id) {
    const row = D.rows.find(r => r.id === id); if (!row) return;
    const detail = (label, value, full = false) => `<div class="${full ? 'full' : ''}"><dt>${label}</dt><dd>${esc(value || 'Não registrado')}</dd></div>`;
    mountDialog(`<div class="drawer-shade" data-backdrop><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-header"><div class="drawer-header-top"><span class="eyebrow">DETALHE DA COTAÇÃO</span><button class="icon-button" data-close-dialog aria-label="Fechar detalhes">${icon('close')}</button></div><h2 id="drawer-title">${esc(row.number)}</h2><p>${esc(row.city)} · ${esc(row.seller)}</p>${response(row)}</header><div class="drawer-body"><section class="drawer-section"><h3>Informações da cotação</h3><dl class="detail-grid">${detail('Descrição do item', row.item, true)}${detail('Vendedor atribuído', row.seller)}${detail('Vencimento normalizado', row.due ? date(row.due) : row.dateProblem === 'ambiguous' ? 'Data ambígua: selecione o formato no filtro' : 'Não informado / inválido')}${detail('Vencimento original', row.dueRaw)}${detail('Quantidade', row.qty)}${detail('Localidade', row.city)}${detail('Marca', row.brand)}${detail('Modelo', row.model)}</dl></section><section class="drawer-section"><h3>Registro da resposta</h3><dl class="detail-grid">${detail('Status original na fonte', row.raw || 'Em branco')}${detail('Data de resposta', timestamp(row.respondedAt))}${detail('Canal de negócio', row.channel)}${detail('Modo de envio', row.mode)}${detail('Responsável pelo envio', row.author)}${detail('Data de detecção do status', timestamp(row.detectedAt))}${detail('Origem da informação', row.source, true)}${detail('Resumo da resposta', row.summary, true)}</dl>${!row.respondedAt ? '<div class="evidence-banner">O status registrado não comprova quando nem como a resposta foi enviada. Esses campos permanecem “Não registrado”.</div>' : ''}</section><section class="drawer-section"><h3>Histórico disponível</h3><div class="timeline">${row.respondedAt ? `<div class="timeline-event"><time>${timestamp(row.respondedAt)} · horário de Brasília</time><strong>Data de resposta registrada na fonte</strong><p>${esc(row.source)} · ${esc(row.channel || 'Canal não registrado')} · ${esc(row.mode || 'Modo não registrado')}</p></div>` : '<div class="timeline-event"><strong>Data de envio não registrada</strong><p>A base contém o estado atual. Não há histórico datado de envio para este registro.</p></div>'}${row.detectedAt ? `<div class="timeline-event"><time>${timestamp(row.detectedAt)}</time><strong>Detecção registrada na fonte</strong><p>Esta data pode ser posterior ao envio.</p></div>` : ''}</div></section></div><footer class="drawer-bottom">${icon('lock')}Acompanhamento administrativo · somente consulta</footer></section></div>`);
  }
  document.addEventListener('click', event => {
    const element = event.target.closest('button, [data-backdrop]'); if (!element) return;
    if (element.hasAttribute('data-close-dialog') || (event.target === element && element.hasAttribute('data-backdrop'))) return closeDrawer();
    if (element.dataset.view) { state.view = element.dataset.view; state.page = 1; render(); if (A.ativa(state.view)) A.carregar(false); return; }
    if (!authorized) { if (element.dataset.action === 'refresh') refresh(); return; }
    if (A.clique(element)) return;
    if (element.dataset.quote) return openQuote(element.dataset.quote);
    if (element.dataset.selectSeller) { changeFilters({ sellers: [element.dataset.selectSeller], view: 'quotes' }); return; }
    if (element.dataset.removeSeller) return changeFilters({ sellers: state.sellers.filter(s => s !== element.dataset.removeSeller) });
    if (element.dataset.clear) return changeFilters({ [element.dataset.clear]: '' });
    if (element.dataset.status) return changeFilters({ status: state.status === element.dataset.status ? '' : element.dataset.status });
    if (element.dataset.day) return changeFilters({ from: element.dataset.day, to: element.dataset.day, view: 'quotes' });
    if (element.dataset.page) { state.page = Number(element.dataset.page); render(); return; }
    if (element.dataset.metric) {
      const key = element.dataset.metric;
      if (key === 'responded' || key === 'draft') return changeFilters({ status: state.status === key ? '' : key });
      return changeFilters({ deadline: state.deadline === key ? '' : key });
    }
    switch (element.dataset.action) {
      case 'clear': return clear();
      case 'pending': return changeFilters({ deadline: state.deadline === 'pendingActive' ? '' : 'pendingActive' });
      case 'today': return changeFilters({ deadline: 'today', view: 'quotes' });
      case 'vendors-done': document.getElementById('vendor-picker').open = false; document.querySelector('.vendor-picker summary').focus(); return;
      case 'refresh': refresh(); return;
      case 'export': exportExcel(); return;
      case 'print': if (authorized && sourceState === 'ready') window.print(); return;
      case 'quality': changeFilters({ deadline: 'missing', view: 'quotes' }); return;
    }
  });
  document.addEventListener('change', event => {
    const element = event.target;
    if (A.mudanca(element)) return;
    if (element.dataset.seller) {
      const seller = element.dataset.seller;
      changeFilters({ sellers: element.checked ? [...state.sellers, seller] : state.sellers.filter(s => s !== seller) }); return;
    }
    if (element.id === 'date-mode') { state.dateMode = element.value; D.rows = D.normalizeRows(rawRows, state.dateMode); state.page = 1; render(); return; }
    const keys = { 'filter-from': 'from', 'filter-to': 'to', 'filter-status': 'status', 'sort-order': 'sort' };
    if (keys[element.id]) changeFilters({ [keys[element.id]]: element.value });
  });
  document.addEventListener('input', event => {
    if (A.digitar(event.target)) return;
    if (event.target.id === 'filter-search') changeFilters({ search: event.target.value });
  });
  document.addEventListener('keydown', event => {
    const dialog = document.querySelector('[role="dialog"]');
    if (event.key === 'Escape') {
      if (dialog) closeDrawer();
      else { const picker = document.getElementById('vendor-picker'); if (picker?.open) { picker.open = false; picker.querySelector('summary').focus(); } }
    }
    if (dialog && event.key === 'Tab') {
      const focusable = [...dialog.querySelectorAll('button, a, input, select, [tabindex="0"]')].filter(n => !n.disabled);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  function unavailable(message) {
    clearTimeout(requestTimer); sourceState = 'error'; sourceError = message; render();
  }
  function invalidate(kind = 'expired') {
    clearTimeout(requestTimer); clearTimeout(sessionTimer);
    closeDrawer(); authorized = false; accessState = kind; D.rows = []; rawRows = []; lastSuccess = null;
    requestId = ''; reloadAfter = false; render();
    if (kind === 'expired') localStorage.removeItem('maestro_session');
  }
  function requestData() {
    if (!authorized || !socket?.connected) return;
    if (sourceState === 'loading' && requestId) { reloadAfter = true; return; }
    sourceState = 'loading'; sourceError = ''; requestId = `${Date.now()}-${++sequence}`;
    clearTimeout(requestTimer);
    requestTimer = setTimeout(() => unavailable('Sem confirmação da leitura. Tente atualizar.'), 35000);
    render(); socket.emit('solicitar_dashboard_cotacoes', { requestId });
  }
  function refresh() {
    if (!socket) return connect();
    if (!socket.connected) { accessState = 'checking'; render(); socket.connect(); }
    else if (authorized) requestData();
    else requestAccess();
  }
  function requestAccess() {
    accessState = 'checking'; render(); clearTimeout(requestTimer);
    requestTimer = setTimeout(() => {
      if (!authorized) { accessState = 'connection'; render(); }
    }, 10000);
    socket.emit('solicitar_acesso_estatisticas');
  }
  function connect() {
    const sessionId = localStorage.getItem('maestro_session');
    if (!sessionId) return invalidate();
    if (typeof window.io !== 'function') { accessState = 'connection'; render(); return; }
    socket = window.io({ auth: { sessionId }, transports: ['websocket'] });
    socket.on('connect', () => {
      authorized = false; accessState = 'checking'; sourceState = 'loading'; requestId = ''; render();
      requestAccess();
    });
    socket.on('acesso_estatisticas', reply => {
      if (reply?.sucesso !== true || reply.admin !== true) return invalidate('denied');
      if (!Number.isFinite(reply.expires) || reply.expires <= Date.now()) return invalidate();
      authorized = true; account = String(reply.email || '');
      clearTimeout(sessionTimer); sessionTimer = setTimeout(() => { invalidate(); socket.disconnect(); }, reply.expires - Date.now());
      socket.emit('sou_frontend', { usuario: account }); requestData();
    });
    socket.on('retorno_dashboard_cotacoes', reply => {
      if (!authorized || !reply || reply.requestId !== requestId) return;
      clearTimeout(requestTimer); requestId = '';
      if (reply.sucesso !== true) {
        if (reply.codigo === 'SEM_PERMISSAO') return invalidate('denied');
        return unavailable(reply.erro || 'Não foi possível consultar a base. Tente atualizar.');
      }
      try {
        const rows = D.normalizeRows(reply.cotacoes, state.dateMode);
        if (!reply.consultado_em || Number.isNaN(Date.parse(reply.consultado_em))) throw new Error('Leitura sem confirmação de horário.');
        closeDrawer(); rawRows = reply.cotacoes; D.rows = rows; lastSuccess = reply.consultado_em;
        sourceState = 'ready'; sourceError = ''; render();
        if (reloadAfter) { reloadAfter = false; requestData(); }
      } catch { unavailable('A resposta recebida não contém uma base de cotações válida. Tente atualizar.'); }
    });
    A.ouvir(socket);
    socket.on('planilha_atualizada', requestData);
    socket.on('sessao_invalida', () => { invalidate(); socket.disconnect(); });
    socket.on('disconnect', () => {
      clearTimeout(requestTimer); requestId = '';
      if (authorized) unavailable('Conexão interrompida. A atualização e a exportação estão suspensas até uma nova leitura.');
      else if (accessState === 'checking') { accessState = 'connection'; render(); }
    });
    socket.on('connect_error', () => {
      clearTimeout(requestTimer);
      if (authorized) unavailable('Não foi possível conectar ao servidor. Tente atualizar.');
      else { accessState = 'connection'; render(); }
    });
    window.addEventListener('focus', () => {
      if (authorized && sourceState !== 'loading' && Date.now() - Date.parse(lastSuccess || 0) > 30000) requestData();
    });
  }
  async function exportExcel() {
    if (!authorized || sourceState !== 'ready' || exporting) return;
    const rows = D.sortRows(D.select(D.rows, state), state.sort);
    if (!rows.length) return toast('Nenhuma cotação no recorte selecionado.');
    exporting = true; render();
    try {
      const workbook = window.DashboardExcel.criarWorkbook(window.ExcelJS, rows, {
        ...state, sellers: [...state.sellers], consultado_em: lastSuccess, responsavel: account
      });
      const buffer = await workbook.xlsx.writeBuffer();
      if (!authorized || sourceState !== 'ready') throw new Error('Atualize a sessão e a base antes de exportar.');
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
      const link = document.createElement('a'); link.href = url; link.download = `maestro_gestao_cotacoes_${D.TODAY}.xlsx`;
      document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`${number(rows.length)} registros exportados para Excel.`);
    } catch (error) { toast(error.message || 'Não foi possível gerar o Excel. Tente novamente.'); }
    finally { exporting = false; render(); }
  }
  render(); connect();
})();
