/* Base dos dashboards admin (Cotações, Monitoramento, Atividade, NFs, Sync e Contas):
   barra superior, faixa de saúde, menu lateral unificado por seções, conexão/acesso,
   pedidos com requestId, atualização a cada 60 s, selo "desatualizado" e animações. */
(function () {
    'use strict';
    const S = typeof window !== 'undefined' && window.DashSaude ? window.DashSaude : require('./saude.js');
    const esc = S.esc;
    const ATUALIZAR_MS = 60 * 1000, VELHO_MS = 3 * 60 * 1000, COTACOES_MS = 5 * 60 * 1000, ESPERA_MS = 35 * 1000;
    const reduzido = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ICONES = {
        grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
        users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
        history: '<path d="M3 12a9 9 0 1 0 2.64-6.36L3 8M3 3v5h5M12 7v5l3 2"/>',
        cotacoes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
        sync: '<path d="M20 7a8.1 8.1 0 0 0-14-2L3 8M3 3v5h5M4 17a8.1 8.1 0 0 0 14 2l3-3M16 16h5v5"/>',
        nfs: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 .7z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
        atividade: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        monitoramento: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
        contas: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>',
        shield: '<path d="m12 3 9 4v5c0 5-9 10-9 10S3 17 3 12V7z"/><path d="m8 12 3 3 5-6"/>',
        config: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        calendario: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        voltar: '<path d="m15 5-7 7 7 7"/>',
        alerta: '<path d="m10.3 3.9-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
        atualizar: '<path d="M20 7a8.1 8.1 0 0 0-14-2L3 8M3 3v5h5M4 17a8.1 8.1 0 0 0 14 2l3-3M16 16h5v5"/>',
        abaixo: '<path d="m6 9 6 6 6-6"/>',
        busca: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
        fechar: '<path d="m6 6 12 12M6 18 18 6"/>',
        editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
        salvar: '<path d="m5 12 4 4L19 6"/>',
    };
    const icone = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;

    function nav() {
        const email = (typeof localStorage !== 'undefined' && localStorage.getItem('maestro_user')) || 'Administrador';
        const iniciais = esc(String(email).split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'AD');
        return `<nav class="dash-nav" aria-label="Topo do painel"><a class="brand" href="index.html?portais=1"><span class="brand-logo"><img src="img/logo-maestro-dashboard.png" alt=""></span><span class="brand-texto">MAESTRO</span></a>
            <a class="voltar" href="index.html?portais=1">${icone('voltar')}<span>Voltar ao portal</span></a>
            <div class="dash-nav-right"><span class="source-pill"><span class="status-dot"></span>Painel administrativo</span><div class="admin-account" title="${esc(email)}"><span class="avatar" aria-hidden="true">${iniciais}</span><span>Administrador</span></div></div></nav>`;
    }

    // Menu lateral unificado em todas as páginas, dividido em seções com cada rótulo.
    function sidebar(ativa, op = {}) {
        const naCotacoes = ativa === 'cotacoes';
        const naContas = ativa === 'contas';
        const view = op.view || '';
        const itemCotacao = (chave, rotulo, ico, badge = '') => {
            const sel = naCotacoes && view === chave;
            const attr = sel ? 'class="selected" aria-current="page"' : '';
            return naCotacoes
                ? `<button type="button" data-view="${chave}" ${attr}>${icone(ico)}<span>${rotulo}</span>${badge}</button>`
                : `<a href="dashboard2.html?view=${chave}" ${attr}>${icone(ico)}<span>${rotulo}</span>${badge}</a>`;
        };
        const itemPagina = (id, rotulo, href, ico) => {
            const sel = ativa === id && !op.configAberta;
            return `<a href="${href}" ${sel ? 'class="selected" aria-current="page"' : ''}>${icone(ico)}<span>${rotulo}</span></a>`;
        };
        const badgeQuotes = op.quotesCount != null ? `<span class="nav-count">${Number(op.quotesCount).toLocaleString('pt-BR')}</span>` : '';
        const badgeAudit = op.auditCountHtml || '';
        const itemConfig = naContas
            ? `<button type="button" data-acao="abrir-config" ${op.configAberta ? 'class="selected" aria-current="page"' : ''}>${icone('config')}<span>Configurações</span></button>`
            : `<a href="dashboard.html?config=1">${icone('config')}<span>Configurações</span></a>`;

        return `<aside class="sidebar" aria-label="Menu principal">
            <div class="eyebrow">Gestão comercial</div>
            <nav class="subnav" aria-label="Gestão comercial">
                ${itemCotacao('overview', 'Visão geral', 'grid')}
                ${itemCotacao('vendors', 'Vendedores', 'users')}
                ${itemCotacao('quotes', 'Cotações', 'cotacoes', badgeQuotes)}
                ${itemCotacao('history', 'Histórico', 'history')}
            </nav>
            <div class="eyebrow">Operação e robôs</div>
            <nav class="subnav" aria-label="Operação e robôs">
                ${itemPagina('monitoramento', 'Monitoramento', 'monitoramento.html', 'monitoramento')}
                ${itemPagina('atividade', 'Atividade', 'atividade.html', 'atividade')}
            </nav>
            <div class="eyebrow">Pedidos e planilha</div>
            <nav class="subnav" aria-label="Pedidos e planilha">
                ${itemPagina('sync', 'Sincronização planilha', 'sync.html', 'sync')}
                ${itemPagina('nfs', 'Notas fiscais (NFs)', 'nfs.html', 'nfs')}
            </nav>
            <div class="eyebrow">Controle e admin</div>
            <nav class="subnav" aria-label="Controle e administração">
                ${itemPagina('contas', 'Contas e acessos', 'dashboard.html', 'contas')}
                ${itemCotacao('audit', 'Auditoria', 'shield', badgeAudit)}
                ${itemCotacao('users', 'Usuários e apelidos', 'users')}
                ${itemConfig}
            </nav>
            <div class="sidebar-bottom">${icone('shield')}<p>Visão administrativa</p><small>Painel central do Maestro</small></div>
        </aside>`;
    }

    // Números que contam até o valor (só na primeira vez; nunca com animação reduzida).
    function contar(raiz) {
        if (reduzido()) return;
        raiz.querySelectorAll('[data-contar]').forEach(el => {
            const alvo = Number(el.dataset.contar);
            if (!Number.isFinite(alvo) || alvo <= 0) return;
            const inicio = performance.now(), dur = 700;
            const passo = t => {
                const p = Math.max(0, Math.min(1, (t - inicio) / dur)), v = Math.round(alvo * (1 - Math.pow(1 - p, 3)));
                el.textContent = v.toLocaleString('pt-BR');
                if (p < 1) requestAnimationFrame(passo);
            };
            requestAnimationFrame(passo);
        });
    }

    function hora(iso) {
        const d = S.hora(iso);
        return d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    }

    function iniciar(cfg) {
        const topo = document.getElementById('dash-topo');
        const app = cfg.pagina === 'cotacoes' ? null : document.getElementById('app');
        const estado = { autorizado: false, acesso: 'verificando', dados: null, ok_em: null, erro: null, carregando: false,
            saude: null, metricas: null, desenhou: false };
        let socket, requestId = '', seq = 0, espera, saudeId = '', cotasId = '';

        function desenharTopo() {
            if (!estado.autorizado) { topo.innerHTML = nav(cfg.pagina); return; }
            let metricas = estado.metricas;
            const D = window.DashboardData;
            if (cfg.pagina === 'cotacoes' && D && D.rows && D.rows.length) metricas = D.metrics(D.rows);
            topo.innerHTML = nav(cfg.pagina) + S.html(S.calcular(estado.saude, metricas));
        }

        function telaAcesso() {
            const t = { verificando: ['Verificando acesso administrativo…', 'Aguarde a confirmação da sua sessão.'],
                negado: ['Acesso restrito', 'Esta área é exclusiva de administradores.'],
                expirada: ['Sua sessão expirou', 'Entre novamente para consultar os dados.'],
                conexao: ['Não foi possível conectar ao Maestro', 'Verifique a conexão e tente novamente.'] }[estado.acesso];
            app.innerHTML = `<main id="main" class="access-screen"><img class="access-logo" src="img/logo-maestro-dashboard.png" alt="Maestro"><h1>${t[0]}</h1><p>${t[1]}</p><div class="actions"><a class="button" href="index.html?portais=1">Voltar ao Maestro</a></div></main>`;
        }

        const ctx = {
            esc, icone, hora, data: S.hora, agora: () => new Date(),
            socket: () => socket,
            num: (n, cls = '') => `<strong class="number ${cls}" data-contar="${Number(n) || 0}">${Number(n || 0).toLocaleString('pt-BR')}</strong>`,
        };

        function selos() {
            const s = [];
            if (estado.carregando) s.push(`<span class="selo">${icone('atualizar')}Atualizando…</span>`);
            if (estado.ok_em) s.push(`<span class="selo">Atualizado ${S.ha(new Date(estado.ok_em), new Date())}</span>`);
            if (estado.ok_em && Date.now() - Date.parse(estado.ok_em) > VELHO_MS) s.push('<span class="selo velho">Desatualizado</span>');
            if (estado.erro) s.push(`<span class="selo erro">${esc(estado.erro)}</span>`);
            return s.join('');
        }

        function desenhar() {
            desenharTopo();
            if (!app) return;
            if (!estado.autorizado) return telaAcesso();
            const foco = document.activeElement && document.activeElement.id;
            const pos = foco && document.activeElement.selectionStart;
            const aviso = estado.erro ? `<div class="source-notice" role="alert">${icone('alerta')}<span>${esc(estado.erro)} ${estado.dados
                ? `Mostrando a última leitura (${hora(estado.ok_em)}), que pode estar desatualizada.` : 'Os números aparecem depois de uma leitura válida.'}</span></div>` : '';
            const corpo = estado.dados ? cfg.render(estado.dados, ctx)
                : `<section class="panel empty" role="status"><h2>${estado.erro ? 'Fonte indisponível' : 'Consultando…'}</h2><p>${estado.erro ? 'Nenhum dado é mostrado até a fonte responder.' : 'Aguarde a resposta do serviço.'}</p></section>`;
            const opSidebar = cfg.sidebarOpcoes ? cfg.sidebarOpcoes() : {};
            const breadcrumb = cfg.breadcrumb || 'ADMINISTRAÇÃO · SÓ CONSULTA';
            const rodapeNota = cfg.rodape || 'Somente consulta · nada é gravado por esta tela';
            app.innerHTML = `<div class="page-wrap workspace">${sidebar(cfg.pagina, opSidebar)}<main id="main" class="page-main dash-main${estado.desenhou ? ' sem-anima' : ''}" tabindex="-1"><div class="dash-titulo"><div><div class="breadcrumb">${esc(breadcrumb)}</div><h1>${esc(cfg.titulo)}</h1><p>${esc(cfg.subtitulo)}</p></div>
                <div class="dash-estado">${selos()}${cfg.controles ? cfg.controles(ctx) : ''}<button class="button" data-acao="atualizar">${icone('atualizar')}<span>Atualizar</span></button></div></div>${aviso}<div id="conteudo">${corpo}</div>
                <footer class="footer"><span>MAESTRO <span class="muted">/ ${esc(cfg.titulo)}</span></span><span>${esc(rodapeNota)}</span></footer></main></div>`;
            if (estado.dados && !estado.desenhou) { estado.desenhou = true; contar(app); }
            const alvo = foco && document.getElementById(foco);
            if (alvo) { alvo.focus({ preventScroll: true }); if (typeof pos === 'number' && alvo.setSelectionRange) alvo.setSelectionRange(pos, pos); }
        }

        function pedir() {
            if (!estado.autorizado || !socket || !socket.connected) return;
            if (cfg.pedirCustom) { cfg.pedirCustom(socket, estado, desenhar); return; }
            if (!cfg.fonte) return;
            requestId = `${Date.now()}-${++seq}`;
            estado.carregando = true;
            clearTimeout(espera);
            espera = setTimeout(() => { estado.carregando = false; estado.erro = 'A fonte não respondeu. Tentando de novo em 1 minuto.'; desenhar(); }, ESPERA_MS);
            socket.emit(`solicitar_dashboard_${cfg.fonte}`, { requestId, ...(cfg.parametros ? cfg.parametros() : {}) });
            desenhar();
        }
        function pedirSaude() {
            if (!estado.autorizado || !socket.connected) return;
            saudeId = `s${Date.now()}`;
            socket.emit('solicitar_dashboard_saude', { requestId: saudeId });
        }
        function pedirCotacoes() {    // números de cotações da faixa: mesma regra do dashboard2 (dados.js)
            if (cfg.pagina === 'cotacoes' || !window.DashboardData || !estado.autorizado || !socket.connected) return;
            cotasId = `c${Date.now()}`;
            socket.emit('solicitar_dashboard_cotacoes', { requestId: cotasId });
        }

        function conectar() {
            const sessionId = localStorage.getItem('maestro_session');
            if (!sessionId || typeof window.io !== 'function') { estado.acesso = sessionId ? 'conexao' : 'expirada'; return desenhar(); }
            socket = window.io({ auth: { sessionId }, transports: ['websocket'] });
            if (cfg.ouvirSocket) cfg.ouvirSocket(socket, estado, desenhar);
            socket.on('connect', () => socket.emit('solicitar_acesso_estatisticas'));
            socket.on('acesso_estatisticas', r => {
                if (!r || r.sucesso !== true || r.admin !== true) { estado.autorizado = false; estado.acesso = 'negado'; return desenhar(); }
                estado.autorizado = true;
                socket.emit('sou_frontend', { usuario: String(r.email || '') });
                desenhar(); pedir(); pedirSaude(); pedirCotacoes();
            });
            if (cfg.fonte) socket.on(`retorno_dashboard_${cfg.fonte}`, r => {
                if (!r || r.requestId !== requestId) return;
                clearTimeout(espera); estado.carregando = false;
                if (r.codigo === 'SEM_PERMISSAO') { estado.autorizado = false; estado.acesso = 'negado'; return desenhar(); }
                if (r.sucesso === true) { estado.dados = cfg.extrair ? cfg.extrair(r) : r.painel; estado.ok_em = r.consultado_em; estado.erro = null; }
                else estado.erro = r.erro || 'A fonte não respondeu.';         // os dados antigos ficam, marcados
                desenhar();
            });
            socket.on('retorno_dashboard_saude', r => { if (r && r.requestId === saudeId && r.sucesso) { estado.saude = r; desenharTopo(); } });
            socket.on('retorno_dashboard_cotacoes', r => {
                if (!r || r.requestId !== cotasId || r.sucesso !== true) return;
                try { const D = window.DashboardData; estado.metricas = D.metrics(D.normalizeRows(r.cotacoes)); desenharTopo(); } catch { /* fica "carregando" */ }
            });
            socket.on('planilha_atualizada', () => { pedir(); pedirSaude(); });
            socket.on('sessao_invalida', () => { estado.autorizado = false; estado.acesso = 'expirada'; localStorage.removeItem('maestro_session'); desenhar(); socket.disconnect(); });
            socket.on('disconnect', () => { if (estado.autorizado) { estado.erro = 'Conexão com o portal interrompida.'; desenhar(); } });
            socket.on('connect_error', () => { if (!estado.autorizado) { estado.acesso = 'conexao'; desenhar(); } });
            setInterval(() => { pedir(); pedirSaude(); }, ATUALIZAR_MS);
            setInterval(pedirCotacoes, COTACOES_MS);
            setInterval(() => { if (estado.autorizado) desenhar(); }, 15000);      // "visto há", selo desatualizado
        }

        if (app) {
            app.addEventListener('click', e => {
                const el = e.target.closest('[data-acao]');
                if (!el) return;
                if (el.classList.contains('drawer-shade') && e.target !== el) return;
                if (el.tagName === 'A') e.preventDefault();
                if (el.dataset.acao === 'atualizar') { pedir(); pedirSaude(); return; }
                if (cfg.acoes && cfg.acoes[el.dataset.acao]) { cfg.acoes[el.dataset.acao](el, ctx, estado); desenhar(); }
            });
            app.addEventListener('change', e => {
                const el = e.target.closest('[data-acao-change]');
                if (el && cfg.acoes && cfg.acoes[el.dataset.acaoChange]) { cfg.acoes[el.dataset.acaoChange](el, ctx, estado); desenhar(); return; }
                const fEl = e.target.closest('[data-filtro]');
                if (fEl && cfg.filtrar) { cfg.filtrar(fEl.dataset.filtro, fEl.value); desenhar(); }
            });
            app.addEventListener('input', e => {
                const el = e.target.closest('[data-filtro]');
                if (el && cfg.filtrar) { cfg.filtrar(el.dataset.filtro, el.value); desenhar(); }
            });
        }
        desenhar();
        conectar();
        return { atualizar: () => pedir(), desenhar };
    }

    const API = { iniciar, nav, sidebar, icone };
    if (typeof window !== 'undefined') window.Dash = API;
    if (typeof module !== 'undefined') module.exports = API;
    if (typeof document !== 'undefined' && document.body && document.body.dataset.dashboard === 'cotacoes') iniciar({ pagina: 'cotacoes' });
})();
