/* Controle → Auditoria e Usuários, dentro do dashboard2 (mesmo visual da Gestão de cotações).
   Quem mudou o quê no portal + apelidos dos e-mails. O servidor só responde a admin (lib/dashboard-auditoria.js). */
(function (root) {
  'use strict';
  const ROTULOS = {
    editar_linha: 'Editou linha', apagar_linha: 'Apagou linha', marcar_respondida: 'Marcou cotação como respondida',
    atribuir_vendedor: 'Atribuiu vendedor', cotacao_manual: 'Registrou cotação manual', pedido_manual: 'Registrou pedido manual',
    sincronizar_nf: 'Sincronizou NFs', gravar_nf_planilha: 'Gravou NF na planilha', responder_evento: 'Respondeu evento',
    cancelar_evento: 'Cancelou evento', extracao_fila: 'Iniciou extração em fila', imprimir: 'Imprimiu evento',
    robo_ligar_robo: 'Ligou o robô', robo_desligar_robo: 'Desligou o robô', robo_forcar_troca: 'Forçou troca de portal',
    robo_solicitar_parada: 'Pediu parada do robô', robo_parar_extracao: 'Parou a extração', robo_extrair: 'Iniciou extração',
    robo_verificar: 'Iniciou verificação', robo_mover_anexos_findes: 'Moveu anexos Findes', promover_usuario: 'Promoveu a admin',
    acesso_dashboard: 'Alterou acesso ao dashboard', acesso_planilha: 'Alterou acesso à planilha', acesso_portais: 'Alterou acesso aos portais',
    vincular_vendedor: 'Vinculou vendedor ao usuário', salvar_config: 'Salvou configuração', definir_apelido: 'Definiu apelido',
    login: 'Entrou no portal', login_falha: 'Falha de login', cadastro: 'Cadastrou-se', troca_senha: 'Trocou a senha'
  };
  const AREAS = { planilha: ['Planilha', ''], portal: ['Portais', 'green'], admin: ['Admin', 'amber'], conta: ['Conta', 'muted'] };
  const STATUS = { sucesso: ['Sucesso', 'green'], erro: ['Erro', 'red'], pendente: ['Aguardando robô', 'amber'], sem_resposta: ['Sem resposta', 'amber'] };
  const PLANILHA = ['editar_linha', 'apagar_linha', 'marcar_respondida', 'atribuir_vendedor', 'cotacao_manual', 'pedido_manual', 'gravar_nf_planilha'];
  const POR_PAGINA = 12;
  const rotulo = a => ROTULOS[a] || a;
  const diaBR = iso => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
  const somarDias = (dia, n) => new Date(Date.parse(dia + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);

  // ---------- funções puras (tests/dashboard-auditoria-tela.test.js) ----------
  // Mapas vindos do servidor sem protótipo: e-mail "constructor"/"__proto__" digitado no login não vira função
  const semProto = o => Object.assign(Object.create(null), o);
  function filtrar(regs, f, apelidos = {}) {
    apelidos = semProto(apelidos);
    const termo = String(f.busca || '').trim().toLowerCase();
    return regs.filter(r => (!f.usuarios.length || f.usuarios.includes(r.email)) && (!f.area || r.area === f.area) &&
      (!f.status || r.status === f.status) && (f.card !== 'planilha' || PLANILHA.includes(r.acao)) &&
      (f.card !== 'respostas' || r.acao === 'responder_evento') &&
      (!termo || [r.alvo, r.email, apelidos[r.email], rotulo(r.acao), r.portal].join(' ').toLowerCase().includes(termo)));
  }
  function resumir(regs) {
    const porUsuario = Object.create(null);   // e-mail digitado pode ser "__proto__"
    for (const r of regs) {
      const k = r.email || '(sem login)';
      const u = porUsuario[k] || (porUsuario[k] = { email: r.email, total: 0, areas: Object.create(null), ultima: r });
      u.total++; u.areas[r.area] = (u.areas[r.area] || 0) + 1;
      if (r.data_hora > u.ultima.data_hora) u.ultima = r;
    }
    return {
      total: regs.length, usuarios: Object.values(porUsuario).filter(u => u.email).length,
      planilha: regs.filter(r => PLANILHA.includes(r.acao)).length,
      respostas: regs.filter(r => r.acao === 'responder_evento').length,
      erros: regs.filter(r => r.status === 'erro').length,
      apagadas: regs.filter(r => r.acao === 'apagar_linha' && r.status !== 'erro').length,
      falhasLogin: regs.filter(r => r.acao === 'login_falha').length,
      semResposta: regs.filter(r => r.status === 'sem_resposta').length,
      porUsuario: Object.values(porUsuario).sort((a, b) => b.total - a.total)
    };
  }
  function mudancas(d = {}) {
    if (d.novos_dados) return Object.keys(d.novos_dados).map(c => ({ campo: c, antes: d.antes ? d.antes[c] : undefined, depois: d.novos_dados[c], temAntes: !!d.antes && c in d.antes }));
    if ('depois' in d) return [{ campo: 'Valor', antes: d.antes, depois: d.depois, temAntes: 'antes' in d }];
    return [];
  }

  function criar(ctx) {
    const { icon, esc, btn, number, timestamp } = ctx;
    const hoje = diaBR(new Date().toISOString());
    const st = { registros: [], apelidos: semProto({}), usuariosDb: null, de: somarDias(hoje, -6), ate: hoje,
      f: { usuarios: [], area: '', status: '', card: '', busca: '' }, page: 1, fonte: 'idle', erro: '', em: null,
      requestId: '', seq: 0, timer: null, exportando: false, editando: false, buscaUsuario: '' };
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    const nome = email => st.apelidos[email] || email || 'Sem login';
    const iniciais = email => esc(nome(email).split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || '—');
    const avatar = email => `<span class="avatar" aria-hidden="true">${iniciais(email)}</span>`;
    const pessoa = email => `<span class="seller-cell">${avatar(email)}<span class="aud-pessoa"><b>${esc(nome(email))}</b>${st.apelidos[email] ? `<small>${esc(email)}</small>` : ''}</span></span>`;
    const badge = r => { const [t, c] = STATUS[r.status] || [r.status, '']; return `<span class="status-badge ${c}">${t}</span>`; };
    const dataBR = dia => dia.slice(8, 10) + '/' + dia.slice(5, 7) + '/' + dia.slice(0, 4);
    const lista = () => filtrar(st.registros, st.f, st.apelidos);
    const valor = v => v === undefined || v === null || v === '' ? '<span class="unknown-value">vazio</span>' : esc(typeof v === 'object' ? JSON.stringify(v) : v);

    function carregar(forcar) {
      const socket = ctx.socket();
      if (!socket || !socket.connected || (st.fonte === 'loading' && !forcar)) return;
      if (st.fonte === 'ready' && !forcar) return;
      st.fonte = 'loading'; st.erro = ''; st.requestId = `aud-${Date.now()}-${++st.seq}`;
      clearTimeout(st.timer);
      st.timer = setTimeout(() => { st.fonte = 'error'; st.erro = 'Sem resposta do servidor. Tente atualizar.'; ctx.render(); }, 15000);
      socket.emit('solicitar_dashboard_auditoria', { requestId: st.requestId, de: st.de, ate: st.ate });
      socket.emit('admin_pedir_usuarios');
      ctx.render();
    }
    function ouvir(socket) {
      socket.on('retorno_dashboard_auditoria', r => {
        if (!r || r.requestId !== st.requestId) return;
        clearTimeout(st.timer); st.requestId = '';
        if (r.sucesso !== true) { st.fonte = 'error'; st.erro = r.erro || 'Não foi possível ler o log.'; return ctx.render(); }
        st.registros = r.registros || []; st.apelidos = semProto(r.apelidos); st.em = r.consultado_em; st.fonte = 'ready'; st.page = 1;
        ctx.render();
      });
      socket.on('admin_receber_usuarios', r => { if (r && r.sucesso && r.usuarios) { st.usuariosDb = semProto(r.usuarios); if (!st.editando) ctx.render(); } });
      socket.on('admin_apelido_definido', r => {
        st.editando = false;
        if (!r || !r.sucesso) { ctx.toast('Não foi possível salvar o apelido: ' + ((r && r.erro) || 'erro desconhecido')); return ctx.render(); }
        const { [r.email]: _, ...resto } = st.apelidos;
        st.apelidos = semProto(r.apelido ? { ...resto, [r.email]: r.apelido } : resto);
        ctx.toast(r.apelido ? `Apelido salvo: ${r.apelido}` : 'Apelido removido.'); ctx.render();
      });
      socket.on('auditoria_nova', reg => {
        if (st.fonte !== 'ready' || !reg || diaBR(reg.data_hora) < st.de || diaBR(reg.data_hora) > st.ate) return;
        st.registros = [reg, ...st.registros];
        if (!st.editando && !document.querySelector('[role="dialog"]')) ctx.render();
      });
      socket.on('auditoria_atualizada', f => {
        if (!f || !st.registros.some(r => r.id === f.id)) return;
        st.registros = st.registros.map(r => r.id !== f.id ? r : { ...r, status: f.status, erro: f.erro,
          detalhes: f.detalhes_extra ? { ...r.detalhes, ...f.detalhes_extra } : r.detalhes });
        if (!st.editando && !document.querySelector('[role="dialog"]')) ctx.render();
      });
    }

    function nav(view) {
      const contagem = st.fonte === 'ready' ? `<span class="nav-count">${number(lista().length)}</span>` : '';
      return `<div class="eyebrow">Controle</div><nav class="subnav" aria-label="Controle de alterações">
        <button data-view="audit" ${view === 'audit' ? 'class="selected" aria-current="page"' : ''}>${icon('shield')}Auditoria${contagem}</button>
        <button data-view="users" ${view === 'users' ? 'class="selected" aria-current="page"' : ''}>${icon('users')}Usuários</button></nav>`;
    }
    function heading(view) {
      const usuarios = view === 'users';
      return `<div class="heading"><div><div class="breadcrumb">ADMINISTRAÇÃO ${icon('chevron')} CONTROLE DE ALTERAÇÕES</div><h1>${usuarios ? 'Usuários' : 'Auditoria'}</h1><p>${usuarios ? 'Quem usa o portal e o apelido que aparece no lugar do e-mail.' : 'Quem alterou o quê no portal: planilha, portais, robôs e acessos.'}</p></div>
        <div class="actions">${btn('aud-atualizar', st.fonte === 'loading' ? 'Atualizando…' : 'Atualizar', 'refresh')}${usuarios ? '' : btn('aud-exportar', st.exportando ? 'Gerando Excel…' : 'Exportar Excel', 'download', 'primary')}</div></div>`;
    }
    function filtros(view) {
      const emails = [...new Set(st.registros.map(r => r.email).filter(Boolean))].sort((a, b) => nome(a).localeCompare(nome(b)));
      const f = st.f, ativo = f.usuarios.length || f.area || f.status || f.card || f.busca;
      const cards = { planilha: 'Alterações na planilha', respostas: 'Respostas de evento' };
      const chips = view === 'users' ? '' : [
        ...f.usuarios.map(e => `<button class="chip" data-aud-tirar-usuario="${esc(e)}" aria-label="Remover filtro ${esc(nome(e))}">${esc(nome(e))}${icon('close')}</button>`),
        f.area ? `<button class="chip" data-aud-limpar="area">${AREAS[f.area][0]}${icon('close')}</button>` : '',
        f.status ? `<button class="chip" data-aud-limpar="status">${STATUS[f.status][0]}${icon('close')}</button>` : '',
        f.card ? `<button class="chip" data-aud-limpar="card">${cards[f.card]}${icon('close')}</button>` : ''].join('');
      const periodo = `<label class="field"><span class="field-label">De</span><input type="date" id="aud-de" value="${st.de}" max="${hoje}"></label><label class="field"><span class="field-label">Até</span><input type="date" id="aud-ate" value="${st.ate}" max="${hoje}"></label>`;
      const busca = view === 'users'
        ? `<label class="field search-field"><span class="field-label">Buscar usuário</span><span class="search-box">${icon('search')}<input id="aud-busca-usuario" type="search" placeholder="E-mail ou apelido…" value="${esc(st.buscaUsuario)}"></span></label>`
        : `<label class="field search-field"><span class="field-label">Buscar no log</span><span class="search-box">${icon('search')}<input id="aud-busca" type="search" placeholder="Cotação, pedido, evento ou usuário…" value="${esc(f.busca)}"></span></label>`;
      const usuarios = `<div class="field"><span class="field-label" id="aud-user-label">Usuários</span><details class="vendor-picker" id="aud-user-picker"><summary aria-labelledby="aud-user-label aud-user-value"><span id="aud-user-value">${f.usuarios.length === 1 ? esc(nome(f.usuarios[0])) : f.usuarios.length ? f.usuarios.length + ' selecionados' : 'Todos os usuários'}</span>${icon('down')}</summary>
        <div class="vendor-menu">${emails.map(e => `<label><input type="checkbox" data-aud-usuario="${esc(e)}" ${f.usuarios.includes(e) ? 'checked' : ''}>${esc(nome(e))}</label>`).join('') || '<p class="muted">Nenhum usuário no período.</p>'}${btn('aud-usuarios-ok', 'Concluir seleção', 'check')}</div></details></div>`;
      const selects = `<label class="field"><span class="field-label">Área</span><select id="aud-area"><option value="">Todas as áreas</option>${Object.entries(AREAS).map(([k, [n]]) => `<option value="${k}" ${f.area === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span class="field-label">Status</span><select id="aud-status"><option value="">Todos os status</option>${Object.entries(STATUS).map(([k, [n]]) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>`;
      return `<div class="filterbar" role="search" aria-label="Filtros da auditoria">${view === 'users' ? periodo + busca : usuarios + periodo + selects + busca}</div>
        <div class="filter-meta"><div class="cohort">${icon('calendar')}<span>Período: ${dataBR(st.de)} a ${dataBR(st.ate)} <span class="muted">/ horário de Brasília</span></span></div>
        <div class="filter-chips">${chips}${ativo && view !== 'users' ? btn('aud-limpar', 'Limpar filtros', '', 'text small') : view === 'users' ? '' : btn('aud-so-erros', 'Só erros', 'filter', 'text small')}</div></div>`;
    }
    function aviso() {
      if (st.fonte === 'error') return `<div class="source-notice" role="alert">${icon('alert')}<span>${esc(st.erro)}</span>${btn('aud-atualizar', 'Tentar novamente', 'refresh', 'small')}</div>`;
      return '';
    }
    function metricas(m) {
      const f = st.f;
      return `<section class="metrics aud-metrics" aria-label="Indicadores da auditoria">${[
        ['total', 'Ações no período', 'chart', '', m.total, 'tudo o que mudou dado ou estado', !f.card && !f.status],
        ['usuarios', 'Usuários ativos', 'users', 'blue', m.usuarios, 'fizeram ao menos uma ação', false],
        ['planilha', 'Alterações na planilha', 'file', 'amber', m.planilha, 'editar, apagar, atribuir, manual', f.card === 'planilha'],
        ['respostas', 'Respostas de evento', 'inbox', 'green', m.respostas, 'enviadas aos portais', f.card === 'respostas'],
        ['erros', 'Ações com erro', 'alert', 'red', m.erros, 'o robô recusou ou falhou', f.status === 'erro']
      ].map(([k, l, g, c, v, foot, sel]) => `<button class="metric ${sel ? 'selected' : ''}" data-aud-card="${k}" aria-pressed="${sel}"><span class="metric-label">${l}</span><span class="metric-icon">${icon(g)}</span><strong class="metric-value number ${c}">${number(v)}</strong><span class="metric-foot">${foot}</span></button>`).join('')}</section>`;
    }
    function porUsuario(m) {
      const top = m.porUsuario.slice(0, 8), max = Math.max(1, ...top.map(u => u.total));
      return `<section class="panel"><div class="panel-head"><div><h2>Ações por usuário</h2><p>Clique para ver só as ações da pessoa</p></div><button class="panel-link" data-view="users">Ver usuários ${icon('arrow')}</button></div>
        <div class="panel-body"><div class="legend">${Object.values(AREAS).map(([n, c]) => `<span><i class="swatch ${c}"></i>${n}</span>`).join('')}</div>
        <div class="seller-bars aud-bars">${top.map(u => `<button class="seller-bar ${st.f.usuarios.includes(u.email) ? 'selected' : ''}" ${u.email ? `data-aud-so-usuario="${esc(u.email)}"` : 'disabled'} aria-label="${esc(nome(u.email))}: ${u.total} ações"><span>${esc(nome(u.email))}</span><span class="bar-track" style="width:${u.total / max * 100}%">${Object.entries(AREAS).map(([a, [, c]]) => `<span class="segment ${c}" style="width:${(u.areas[a] || 0) / u.total * 100}%"></span>`).join('')}</span><span class="total number">${number(u.total)}</span></button>`).join('') || '<p class="muted">Nenhuma ação neste período.</p>'}</div>
        <p class="chart-caption">${top.length} de ${m.porUsuario.length} usuários por volume de ações.</p></div></section>`;
    }
    function atencao(m) {
      const item = (glyph, titulo, texto, acao, link) => `<div class="insight">${icon(glyph)}<div><strong>${titulo}</strong><p>${texto}</p>${acao ? `<button class="panel-link" ${acao}>${link} ${icon('arrow')}</button>` : ''}</div></div>`;
      return `<section class="panel"><div class="panel-head"><h2>Pontos de atenção</h2></div><div class="panel-body insight-list">
        ${item('alert', plural(m.erros, 'ação com erro', 'ações com erro'), 'O robô recusou ou falhou. Abra para ver a mensagem.', m.erros ? 'data-aud-card="erros"' : '', 'Conferir')}
        ${item('file', plural(m.apagadas, 'linha apagada', 'linhas apagadas'), 'A linha completa fica guardada no detalhe da ação.', m.apagadas ? 'data-aud-busca-acao="Apagou linha"' : '', 'Ver quais')}
        ${item('lock', plural(m.falhasLogin, 'falha de login', 'falhas de login'), 'Tentativas com senha errada ou conta bloqueada.', m.falhasLogin ? 'data-aud-busca-acao="Falha de login"' : '', 'Ver tentativas')}
        ${item('clock', plural(m.semResposta, 'pedido sem resposta do robô', 'pedidos sem resposta do robô'), 'Pedidos que o gerenciador não confirmou em 10 minutos.', m.semResposta ? 'data-aud-status="sem_resposta"' : '', 'Consultar')}</div></section>`;
    }
    function tabela(dados) {
      const paginas = Math.max(1, Math.ceil(dados.length / POR_PAGINA));
      st.page = Math.min(st.page, paginas);
      const ini = (st.page - 1) * POR_PAGINA, pagina = dados.slice(ini, ini + POR_PAGINA);
      return `<section class="panel table-panel"><div class="panel-head"><div><div class="table-title"><h2>Log de ações</h2><span class="counter number">${number(dados.length)}</span></div><p>Mais recentes primeiro · abra uma ação para ver o que mudou</p></div></div>
        ${dados.length ? `<div class="table-scroll" tabindex="0" role="region" aria-label="Log de ações, deslize para ver todas as colunas"><table class="quote-table aud-table"><thead><tr><th>Data / hora</th><th>Usuário</th><th>Ação</th><th>Área</th><th>Alvo</th><th>Status</th><th><span class="sr-only">Detalhes</span></th></tr></thead><tbody>${pagina.map(r => `<tr>
          <td class="number">${esc(timestamp(r.data_hora))}</td><td>${pessoa(r.email)}</td>
          <td><button class="quote-ref" data-aud-abrir="${esc(r.id)}">${esc(rotulo(r.acao))}</button>${r.portal ? `<span class="item-description">${esc(r.portal)}</span>` : ''}</td>
          <td><span class="deadline-badge ${({ portal: 'blue', admin: 'amber', conta: '' })[r.area] || ''}">${esc((AREAS[r.area] || [r.area])[0])}</span></td>
          <td>${esc(r.alvo || '—')}</td><td>${badge(r)}</td>
          <td><button class="icon-button" data-aud-abrir="${esc(r.id)}" aria-label="Detalhes da ação">${icon('chevron')}</button></td></tr>`).join('')}</tbody></table></div>`
          : `<div class="empty">${icon('search')}<h3>Nenhuma ação neste recorte</h3><p>Altere o período ou limpe os filtros.</p>${btn('aud-limpar', 'Limpar filtros', 'refresh')}</div>`}
        <div class="table-footer"><span>${dados.length ? `${ini + 1}–${Math.min(ini + POR_PAGINA, dados.length)} de ${dados.length}` : '0'} ações</span><div class="pagination"><button data-aud-pagina="${st.page - 1}" ${st.page === 1 ? 'disabled' : ''} aria-label="Página anterior">${icon('left')}</button><button class="selected" aria-current="page">${st.page}</button><span>de ${paginas}</span><button data-aud-pagina="${st.page + 1}" ${st.page === paginas ? 'disabled' : ''} aria-label="Próxima página">${icon('chevron')}</button></div></div></section>`;
    }
    function usuarios(m) {
      const termo = st.buscaUsuario.trim().toLowerCase();
      const db = st.usuariosDb || semProto({});
      const total = e => (m.porUsuario.find(u => u.email === e) || { total: 0 }).total;
      const emails = [...new Set([...Object.keys(db), ...m.porUsuario.map(u => u.email).filter(Boolean)])]
        .filter(e => !termo || (e + ' ' + (st.apelidos[e] || '')).toLowerCase().includes(termo))
        .sort((a, b) => total(b) - total(a) || a.localeCompare(b));
      return `<section class="panel table-panel"><div class="panel-head"><div><div class="table-title"><h2>Usuários do portal</h2><span class="counter number">${number(emails.length)}</span></div><p>O apelido aparece no lugar do e-mail na Auditoria. Deixe em branco para remover.</p></div></div>
        ${st.usuariosDb === null ? `<div class="data-note">${icon('info')}<span>Lista de contas indisponível agora (gerenciador offline). Aparecem só os usuários com ações no período.</span></div>` : ''}
        <div class="table-scroll" tabindex="0" role="region" aria-label="Usuários e apelidos"><table class="vendor-table aud-users"><thead><tr><th>Usuário</th><th>Apelido</th><th>Online</th><th>Ações no período</th><th>Última ação</th><th></th></tr></thead><tbody>${emails.map(e => {
          const u = m.porUsuario.find(x => x.email === e), info = db[e] || {};
          return `<tr><td>${pessoa(e)}${info.admin ? ' <span class="deadline-badge blue">Admin</span>' : ''}</td>
            <td><span class="aud-apelido"><input maxlength="40" data-aud-apelido="${esc(e)}" value="${esc(st.apelidos[e] || '')}" placeholder="Sem apelido" aria-label="Apelido de ${esc(e)}"><button class="button small" data-aud-salvar="${esc(e)}">${icon('check')}<span>Salvar</span></button></span></td>
            <td><span class="aud-online ${info.online ? 'on' : ''}">${info.online ? 'Online' : 'Offline'}</span></td>
            <td class="number">${u ? number(u.total) : '0'}</td>
            <td>${u ? `${esc(rotulo(u.ultima.acao))}<span class="item-description">${esc(timestamp(u.ultima.data_hora))}</span>` : '<span class="unknown-value">Sem ações no período</span>'}</td>
            <td>${u ? `<button class="panel-link" data-aud-so-usuario="${esc(e)}">Ver ações ${icon('arrow')}</button>` : ''}</td></tr>`;
        }).join('') || '<tr><td colspan="6" class="unknown-value">Nenhum usuário encontrado.</td></tr>'}</tbody></table></div></section>`;
    }
    function conteudo(view) {
      if (st.fonte !== 'ready') return `<section class="panel empty" role="status">${icon(st.fonte === 'error' ? 'alert' : 'refresh')}<h2>${st.fonte === 'error' ? 'Log indisponível' : 'Lendo o log de auditoria…'}</h2><p>${st.fonte === 'error' ? 'Use Atualizar para tentar de novo.' : 'Aguarde a confirmação do servidor.'}</p></section>`;
      const m = resumir(st.registros);
      if (view === 'users') return usuarios(m);
      const dados = lista();
      return `${metricas(resumir(dados))}<div class="analysis-grid aud-grid">${porUsuario(m)}${atencao(m)}</div>${tabela(dados)}
        <div class="data-note">${icon('info')}<span>O log guarda só ações que mudam algo. Abrir telas e consultar não entra. Preços enviados aos portais não são gravados.</span></div>`;
    }
    function abrir(id) {
      const r = st.registros.find(x => x.id === id); if (!r) return;
      const linha = (dt, dd, full) => `<div class="${full ? 'full' : ''}"><dt>${dt}</dt><dd>${dd}</dd></div>`;
      const d = r.detalhes || {}, lista = mudancas(d);
      const resto = Object.entries(d).filter(([k]) => !['novos_dados', 'antes', 'depois', 'linha_apagada'].includes(k));
      ctx.mountDialog(`<div class="drawer-shade" data-backdrop><section class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-header"><div class="drawer-header-top"><span class="eyebrow">DETALHE DA AÇÃO</span><button class="icon-button" data-close-dialog aria-label="Fechar detalhes">${icon('close')}</button></div><h2 id="drawer-title">${esc(rotulo(r.acao))}</h2><p>${esc(nome(r.email))} · ${esc(timestamp(r.data_hora))}</p>${badge(r)}</header>
        <div class="drawer-body"><section class="drawer-section"><h3>Quem e quando</h3><dl class="detail-grid">${linha('Usuário', esc(nome(r.email)))}${linha('E-mail', esc(r.email || 'Sem login'))}${linha('Data e hora', esc(timestamp(r.data_hora)) + ' · horário de Brasília')}${linha('IP', esc(r.ip || 'Não registrado'))}${linha('Área', esc((AREAS[r.area] || [r.area])[0]))}${linha('Portal', esc(r.portal || '—'))}${linha('Alvo', esc(r.alvo || '—'), true)}</dl></section>
        ${lista.length ? `<section class="drawer-section"><h3>O que mudou</h3><dl class="detail-grid">${lista.map(c => linha(esc(c.campo), `${c.temAntes ? `<s class="red">${valor(c.antes)}</s> → ` : ''}<b class="green">${valor(c.depois)}</b>`, true)).join('')}</dl>${d.novos_dados && !d.antes ? '<div class="evidence-banner">O valor anterior ainda não é enviado pelo gerenciador. Aparece só o valor novo.</div>' : ''}</section>` : ''}
        ${d.linha_apagada ? `<section class="drawer-section"><h3>Linha apagada</h3><dl class="detail-grid">${Object.entries(d.linha_apagada).map(([k, v]) => linha(esc(k), `<s class="red">${valor(v)}</s>`)).join('')}</dl></section>` : ''}
        ${resto.length ? `<section class="drawer-section"><h3>Detalhes</h3><dl class="detail-grid">${resto.map(([k, v]) => linha(esc(k), valor(Array.isArray(v) ? v.join(', ') : v), true)).join('')}</dl></section>` : ''}
        ${r.erro ? `<section class="drawer-section"><h3>Erro</h3><div class="evidence-banner">${esc(r.erro)}</div></section>` : ''}</div>
        <footer class="drawer-bottom">${icon('lock')}Auditoria administrativa · somente consulta · ID ${esc(r.id)}</footer></section></div>`);
    }
    async function exportar() {
      const dados = lista();
      if (!dados.length || st.exportando) return ctx.toast('Nenhuma ação no recorte selecionado.');
      st.exportando = true; ctx.render();
      try {
        const wb = new root.ExcelJS.Workbook(), aba = wb.addWorksheet('Auditoria', { views: [{ state: 'frozen', ySplit: 1 }] });
        aba.columns = [['Data/hora', 20], ['Usuário', 24], ['E-mail', 32], ['Ação', 32], ['Área', 12], ['Portal', 12], ['Alvo', 24], ['Status', 16], ['Erro', 32], ['IP', 16], ['Detalhes', 80]].map(([header, width]) => ({ header, width }));
        dados.forEach(r => aba.addRow([timestamp(r.data_hora), st.apelidos[r.email] || '', r.email || '', rotulo(r.acao), (AREAS[r.area] || [r.area])[0], r.portal || '', r.alvo || '', (STATUS[r.status] || [r.status])[0], r.erro || '', r.ip || '', JSON.stringify(r.detalhes || {})]));
        aba.getRow(1).font = { bold: true }; aba.autoFilter = { from: 'A1', to: 'K1' };
        const url = URL.createObjectURL(new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const a = document.createElement('a'); a.href = url; a.download = `maestro_auditoria_${st.de}_${st.ate}.xlsx`;
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        ctx.toast(`${number(dados.length)} ações exportadas para Excel.`);
      } catch (e) { ctx.toast('Não foi possível gerar o Excel: ' + e.message); }
      finally { st.exportando = false; ctx.render(); }
    }

    const mudarFiltro = mud => { st.f = { ...st.f, ...mud }; st.page = 1; ctx.render(); return true; };
    function clique(el) {
      const d = el.dataset;
      if (d.audAbrir) { abrir(d.audAbrir); return true; }
      if (d.audSoUsuario) { st.f = { ...st.f, usuarios: [d.audSoUsuario] }; st.page = 1; ctx.irPara('audit'); return true; }
      if (d.audTirarUsuario) return mudarFiltro({ usuarios: st.f.usuarios.filter(e => e !== d.audTirarUsuario) });
      if (d.audLimpar) return mudarFiltro({ [d.audLimpar]: '' });
      if (d.audStatus) return mudarFiltro({ status: d.audStatus, card: '' });
      if (d.audBuscaAcao) return mudarFiltro({ busca: d.audBuscaAcao });
      if (d.audPagina) { st.page = Number(d.audPagina); ctx.render(); return true; }
      if (d.audCard) {
        const k = d.audCard;
        if (k === 'usuarios') { ctx.irPara('users'); return true; }
        if (k === 'total') return mudarFiltro({ card: '', status: '' });
        if (k === 'erros') return mudarFiltro({ status: st.f.status === 'erro' ? '' : 'erro', card: '' });
        return mudarFiltro({ card: st.f.card === k ? '' : k, status: '' });
      }
      if (d.audSalvar) {
        const input = [...document.querySelectorAll('[data-aud-apelido]')].find(i => i.dataset.audApelido === d.audSalvar);
        el.disabled = true; st.editando = true;
        ctx.socket().emit('admin_definir_apelido', { email: d.audSalvar, apelido: input ? input.value : '' });
        return true;
      }
      switch (d.action) {
        case 'aud-atualizar': carregar(true); return true;
        case 'aud-exportar': exportar(); return true;
        case 'aud-limpar': return mudarFiltro({ usuarios: [], area: '', status: '', card: '', busca: '' });
        case 'aud-so-erros': return mudarFiltro({ status: 'erro', card: '' });
        case 'aud-usuarios-ok': document.getElementById('aud-user-picker').open = false; return true;
      }
      return false;
    }
    function mudanca(el) {
      if (el.dataset.audUsuario) {
        const e = el.dataset.audUsuario;
        return mudarFiltro({ usuarios: el.checked ? [...st.f.usuarios, e] : st.f.usuarios.filter(x => x !== e) });
      }
      if (el.id === 'aud-de' || el.id === 'aud-ate') {
        const de = document.getElementById('aud-de').value, ate = document.getElementById('aud-ate').value;
        if (!de || !ate || de > ate) { ctx.toast('A data inicial precisa ser anterior ou igual à final.'); return true; }
        st.de = de; st.ate = ate; carregar(true); return true;
      }
      if (el.id === 'aud-area') return mudarFiltro({ area: el.value });
      if (el.id === 'aud-status') return mudarFiltro({ status: el.value, card: '' });
      return false;
    }
    function digitar(el) {
      if (el.id === 'aud-busca') return mudarFiltro({ busca: el.value });
      if (el.id === 'aud-busca-usuario') { st.buscaUsuario = el.value; ctx.render(); return true; }
      if (el.dataset.audApelido !== undefined) { st.editando = true; return true; }   // não redesenha enquanto digita
      return false;
    }

    return { nav, heading, filtros, aviso, conteudo, carregar, ouvir, clique, mudanca, digitar,
      ativa: v => v === 'audit' || v === 'users', pickerAberto: () => !!document.getElementById('aud-user-picker')?.open };
  }

  const api = { criar, filtrar, resumir, mudancas, rotulo, ROTULOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DashAuditoria = api;
})(typeof window !== 'undefined' ? window : globalThis);
