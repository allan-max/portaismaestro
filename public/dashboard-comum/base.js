/* Base dos dashboards admin (Sync, NFs, Atividade e a faixa no dashboard2):
   barra de navegação, faixa de saúde, conexão/acesso, pedidos com requestId,
   atualização a cada 60 s, selo "desatualizado" e animações. Só leitura. */
(function () {
    'use strict';
    const S = window.DashSaude;
    const esc = S.esc;
    const ATUALIZAR_MS = 60 * 1000, VELHO_MS = 3 * 60 * 1000, COTACOES_MS = 5 * 60 * 1000, ESPERA_MS = 35 * 1000;
    const reduzido = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ICONES = {
        cotacoes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
        sync: '<path d="M20 7a8.1 8.1 0 0 0-14-2L3 8M3 3v5h5M4 17a8.1 8.1 0 0 0 14 2l3-3M16 16h5v5"/>',
        nfs: '<path d="M4 2h16v20l-3-2-3 2-3-2-3 2-3-2-1 .7z"/><path d="M8 7h8M8 11h8M8 15h5"/>',
        atividade: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        voltar: '<path d="m15 5-7 7 7 7"/>', alerta: '<path d="m10.3 3.9-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
        atualizar: '<path d="M20 7a8.1 8.1 0 0 0-14-2L3 8M3 3v5h5M4 17a8.1 8.1 0 0 0 14 2l3-3M16 16h5v5"/>',
        abaixo: '<path d="m6 9 6 6 6-6"/>',
    };
    const icone = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;
    const PAGINAS = [['cotacoes', 'Cotações', 'dashboard2.html'], ['sync', 'Sincronização planilha', 'sync.html'],
        ['nfs', 'NFs', 'nfs.html'], ['atividade', 'Atividade', 'atividade.html']];

    function nav(ativa) {
        return `<nav class="dash-nav" aria-label="Dashboards"><a class="brand" href="dashboard.html"><span class="brand-logo"><img src="img/logo-maestro-dashboard.png" alt=""></span><span class="brand-texto">MAESTRO</span></a>
            <div class="dash-nav-links">${PAGINAS.map(([id, nome, href]) => `<a href="${href}" ${id === ativa ? 'aria-current="page"' : ''}>${icone(id)}${nome}</a>`).join('')}</div>
            <a class="voltar" href="dashboard.html">${icone('voltar')}<span>Painel admin</span></a></nav>`;
    }

    // Números que contam até o valor (só na primeira vez; nunca com animação reduzida).
    function contar(raiz) {
        if (reduzido()) return;
        raiz.querySelectorAll('[data-contar]').forEach(el => {
            const alvo = Number(el.dataset.contar);
            if (!Number.isFinite(alvo) || alvo <= 0) return;
            const inicio = performance.now(), dur = 700;
            const passo = t => {
                // o horário do quadro pode vir antes de `inicio`: sem o max, o primeiro número sai negativo
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
            const links = topo.querySelector('.dash-nav-links'), ativa = links && links.querySelector('[aria-current]');
            if (ativa) links.scrollLeft = ativa.offsetLeft - 40;          // celular: a aba atual sempre à vista
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
            app.innerHTML = `<main id="main" class="dash-main${estado.desenhou ? ' sem-anima' : ''}" tabindex="-1"><div class="dash-titulo"><div><div class="breadcrumb">ADMINISTRAÇÃO · SÓ CONSULTA</div><h1>${esc(cfg.titulo)}</h1><p>${esc(cfg.subtitulo)}</p></div>
                <div class="dash-estado">${selos()}<button class="button" data-acao="atualizar">${icone('atualizar')}<span>Atualizar</span></button></div></div>${aviso}<div id="conteudo">${corpo}</div>
                <footer class="footer"><span>MAESTRO <span class="muted">/ ${esc(cfg.titulo)}</span></span><span>Somente consulta · nada é gravado por esta tela</span></footer></main>`;
            if (estado.dados && !estado.desenhou) { estado.desenhou = true; contar(app); }
            const alvo = foco && document.getElementById(foco);
            if (alvo) { alvo.focus({ preventScroll: true }); if (typeof pos === 'number' && alvo.setSelectionRange) alvo.setSelectionRange(pos, pos); }
        }

        function pedir() {
            if (!cfg.fonte || !estado.autorizado || !socket.connected) return;
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
                if (el.dataset.acao === 'atualizar') { pedir(); pedirSaude(); return; }
                if (cfg.acoes && cfg.acoes[el.dataset.acao]) { cfg.acoes[el.dataset.acao](el); desenhar(); }
            });
            app.addEventListener('input', e => {
                const el = e.target.closest('[data-filtro]');
                if (el && cfg.filtrar) { cfg.filtrar(el.dataset.filtro, el.value); desenhar(); }
            });
        }
        desenhar();
        conectar();
        return { atualizar: () => pedir() };
    }

    window.Dash = { iniciar, nav, icone };
    // dashboard2: só a barra e a faixa; o resto é do dashboard-cotacoes/app.js (os números vêm de DashboardData.rows)
    if (document.body && document.body.dataset.dashboard === 'cotacoes') iniciar({ pagina: 'cotacoes' });
})();
