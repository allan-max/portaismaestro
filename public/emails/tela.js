/* Central de E-mails: casca (cabeçalho, trilho, visões), caixa unificada e dashboard.
   Regra de segurança: todo campo vindo de e-mail entra por textContent. Nunca HTML montado a partir de texto.
   HTML do e-mail só em iframe sandbox="" (sem scripts e sem mesma origem), por clique, com CSP própria.
   Lógica pura fica em formato.js (rota, categoria, formatos) e filtro.js (filtro, endereço, realce), que o node --test carrega. */
(function () {
    'use strict';
    const F = window.EmailsFormato;
    const Q = window.EmailsFiltro;
    const $ = id => document.getElementById(id);
    const sessao = localStorage.getItem('maestro_session');
    // só arrumação da tela: o servidor já não manda o dado de administrador (gasto, saúde) a quem não é,
    // e recusa filtro da equipe gravado por quem não é
    const admin = localStorage.getItem('maestro_admin') === 'true';
    const SVG = 'http://www.w3.org/2000/svg';
    const PREFS_PADRAO = { minhas_caixas: [], filtros: [], sem_ruido: true, agrupar: false, notificar: false, som: false, equipe: [] };
    const estado = { filtro: Q.novo(), proximo: null, itens: 0, total: 0, aberto: null, contas: [], contagens: null, visao: '',
        bloqueado: false, iniciado: false, listou: false, carregando: false, seqLista: 0, ultimoDia: '', prefs: PREFS_PADRAO };
    const CANCELADO = { sucesso: false, cancelado: true };
    const esperando = new Map();
    let seq = 0;

    function el(tag, texto, classe) {
        const e = document.createElement(tag);
        if (texto !== undefined && texto !== null) e.textContent = String(texto);
        if (classe) e.className = classe;
        return e;
    }
    function botao(texto, classe) {
        const b = el('button', texto, classe);
        b.type = 'button';
        return b;
    }
    // ícone de icones.svg; o id vem sempre do código, nunca de texto de e-mail
    function icone(id, classe) {
        const svg = document.createElementNS(SVG, 'svg');
        svg.setAttribute('class', 'em-ic' + (classe ? ' ' + classe : ''));
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG, 'use');
        use.setAttribute('href', 'emails/icones.svg#' + id);
        svg.appendChild(use);
        return svg;
    }
    function etiquetaCategoria(nome) {
        const c = F.categoria(nome);
        const s = el('span', null, 'em-etiqueta em-etiqueta-cat ' + c.classe);
        s.appendChild(icone(c.icone));
        s.appendChild(el('span', c.nome));
        return s;
    }
    function etiqueta(texto, classe, ic) {
        const s = el('span', null, 'em-etiqueta' + (classe ? ' ' + classe : ''));
        if (ic) s.appendChild(icone(ic));
        s.appendChild(el('span', texto));
        return s;
    }
    // texto com o termo buscado realçado: pedaços de texto e <mark> criados por nó, nunca por HTML
    function comRealce(tag, texto, classe) {
        const e = el(tag, null, classe);
        for (const p of Q.realce(texto, estado.filtro.busca)) e.appendChild(p.marca ? el('mark', p.texto) : document.createTextNode(p.texto));
        return e;
    }
    // preferência do aparelho; o navegador pode recusar o armazenamento (janela privada), e aí vale o padrão
    function local(chave, valor) {
        try {
            if (valor === undefined) return localStorage.getItem(chave);
            localStorage.setItem(chave, valor);
        } catch (e) { /* sem armazenamento: só não lembra */ }
        return null;
    }
    const dataHora = F.dataHora, tamanho = F.tamanho;
    function avisar(texto) { $('em-estado').textContent = texto; }
    // aviso flutuante de confirmação; a fase do "desfazer" acrescenta o botão aqui
    let avisoTempo = 0;
    function avisoFlutuante(texto) {
        const a = $('em-aviso-flutuante');
        a.replaceChildren(icone('conferir', 'em-ic-p em-ok'), el('span', texto));
        a.hidden = false;
        clearTimeout(avisoTempo);
        avisoTempo = setTimeout(() => { a.hidden = true; }, 4000);
    }
    function telaAcesso(titulo, texto) {
        estado.bloqueado = true;
        for (const id of ['em-app', 'em-dash', 'em-saude', 'em-filtros-salvos', 'em-trilho', 'em-busca-global', 'em-abrir-busca', 'em-sino']) $(id).hidden = true;
        $('em-lista').replaceChildren();   // nem o esqueleto de carregamento fica na página
        $('em-acesso').hidden = false;
        $('em-acesso-titulo').textContent = titulo;
        $('em-acesso-texto').textContent = texto;
    }

    if (!sessao) {
        telaAcesso('Entre no Maestro', 'Faça login no portal para ver os e-mails.');
        return;
    }
    $('em-usuario').textContent = localStorage.getItem('maestro_user') || '';
    $('em-ir-saude').hidden = !admin;

    // ----- indicador "ao vivo": verde com o serviço respondendo, âmbar reconectando, vermelho offline -----
    const AO_VIVO = { vivo: 'Ao vivo', conectando: 'Conectando', reconectando: 'Reconectando', offline: 'Serviço offline' };
    function aoVivo(s) {
        if ($('em-ao-vivo').dataset.estado === s) return;
        $('em-ao-vivo').dataset.estado = s;
        $('em-ao-vivo-texto').textContent = AO_VIVO[s];
    }

    const socket = io({ auth: { sessionId: sessao }, transports: ['websocket', 'polling'] });

    function pedir(acao, params) {
        return new Promise(resolve => {
            const requestId = acao + ':' + (++seq);
            // só a resposta mais nova de cada ação interessa; a anterior termina como cancelada
            for (const [id, p] of esperando) if (p.acao === acao) { esperando.delete(id); p.resolve(CANCELADO); }
            esperando.set(requestId, { acao, resolve });
            socket.emit('emails_pedir', { requestId, acao, params });
        });
    }
    socket.on('emails_retorno', r => {
        if (r && r.sucesso && r.acao !== 'preferencias' && r.acao !== 'preferencias_salvar') aoVivo('vivo');
        else if (r && r.codigo === 'FONTE_OFFLINE') aoVivo('offline');
        const p = r && esperando.get(r.requestId);
        if (!p) {
            if (r && r.codigo === 'SEM_PERMISSAO' && !r.requestId) telaAcesso('Acesso restrito', r.erro || 'Sem permissão.');
            return;
        }
        esperando.delete(r.requestId);
        // nas preferências, SEM_PERMISSAO é "filtro da equipe só para administrador", não falta de acesso à tela
        if (r.codigo === 'SEM_PERMISSAO' && p.acao !== 'preferencias_salvar') {
            telaAcesso('Acesso restrito', 'Você não tem o acesso "E-mails". Peça a um administrador do Maestro.');
            return;
        }
        p.resolve(r);
    });
    socket.on('sessao_invalida', () => telaAcesso('Sua sessão expirou', 'Entre de novo no Maestro para continuar.'));
    socket.on('connect', async () => {
        aoVivo('conectando');
        socket.emit('emails_entrar');
        if (!estado.iniciado) {
            // as preferências vêm do portal (funcionam com o serviço offline) e dizem quais são "minhas caixas"
            await carregarPreferencias();
            estado.iniciado = true;
            mostrarVisao();
        } else if (!estado.itens && estado.visao === 'caixa') listar(false);
        if (estado.visao === 'caixa' || estado.visao === 'filtros') atualizarContadores();
    });
    socket.on('connect_error', () => { aoVivo('reconectando'); avisar('Sem conexão com o Maestro. Tentando de novo…'); });
    socket.on('disconnect', () => {
        // o servidor descarta os pedidos deste socket; quem espera recebe "cancelado" e libera a tela
        for (const p of esperando.values()) p.resolve(CANCELADO);
        esperando.clear();
        aoVivo('reconectando');
        avisar('Conexão perdida. Tentando reconectar…');
    });
    socket.on('emails_novidade', d => {
        if (d && Number.isSafeInteger(d.atrasados)) mostrarContador(d.atrasados);
        const n = d && Number.isSafeInteger(d.novos) ? d.novos : 0;
        if (n <= 0) return;
        $('em-novidade-texto').textContent = n === 1 ? '1 e-mail novo chegou.' : n + ' e-mails novos chegaram.';
        $('em-novidade').hidden = false;
        registrarNovidade(n);
    });

    // ----- contadores do trilho -----
    function mostrarContador(n) {
        const c = $('em-contador');
        c.hidden = !(n > 0);
        c.textContent = String(n);
        c.setAttribute('aria-label', n === 1 ? '1 cotação ou pedido atrasado' : n + ' cotações ou pedidos atrasados');
        document.title = (n > 0 ? '(' + n + ') ' : '') + 'E-mails — Maestro';
    }
    function mostrarRevisao(n) {
        const c = $('em-cont-revisao');
        c.hidden = !(Number.isSafeInteger(n) && n > 0);
        c.textContent = String(n);
        c.setAttribute('aria-label', n === 1 ? '1 e-mail na fila de revisão' : n + ' e-mails na fila de revisão');
    }
    function contadores(d) {
        if (Number.isSafeInteger(d.contador_menu)) mostrarContador(d.contador_menu);
        mostrarRevisao(d.revisao);
    }
    async function atualizarContadores() {
        const r = await pedir('resumo', {});
        if (r.sucesso && r.dados) contadores(r.dados);
    }

    // ----- sino: novidades desta sessão -----
    const novidades = [];
    let naoVistas = 0;
    function registrarNovidade(n) {
        novidades.unshift({ n, em: new Date() });
        if (novidades.length > 10) novidades.length = 10;
        naoVistas += n;
        const c = $('em-sino-num');
        c.hidden = false;
        c.textContent = String(naoVistas);
        $('em-sino').setAttribute('aria-label', 'Novidades: ' + naoVistas + (naoVistas === 1 ? ' e-mail novo' : ' e-mails novos'));
        mostrarNovidades();
    }
    function mostrarNovidades() {
        const ul = $('em-novidades');
        ul.replaceChildren();
        if (!novidades.length) { ul.appendChild(el('li', 'Nenhum e-mail novo desde que a tela foi aberta.', 'em-menu-texto')); return; }
        for (const x of novidades) {
            const li = el('li', null, 'em-menu-texto');
            li.appendChild(el('strong', x.n === 1 ? '1 e-mail novo' : x.n + ' e-mails novos'));
            li.appendChild(document.createTextNode('às ' + x.em.toLocaleTimeString('pt-BR', { timeZone: F.FUSO, hour: '2-digit', minute: '2-digit' })));
            ul.appendChild(li);
        }
    }
    function sinoVisto() {
        naoVistas = 0;
        $('em-sino-num').hidden = true;
        $('em-sino').setAttribute('aria-label', 'Novidades');
    }

    // ----- menus flutuantes do cabeçalho -----
    const MENUS = [['em-sino', 'em-menu-sino', sinoVisto], ['em-usuario-botao', 'em-menu-usuario', null]];
    function fecharMenus() {
        for (const [b, m] of MENUS) { $(m).hidden = true; $(b).setAttribute('aria-expanded', 'false'); }
    }
    for (const [b, m, aoAbrir] of MENUS) {
        $(b).addEventListener('click', () => {
            const abrir = $(m).hidden;
            fecharMenus();
            if (!abrir) return;
            $(m).hidden = false;
            $(b).setAttribute('aria-expanded', 'true');
            if (aoAbrir) aoAbrir();
        });
    }
    document.addEventListener('click', ev => { if (!ev.target.closest('.em-ancora')) fecharMenus(); });
    document.addEventListener('keydown', ev => {
        if (ev.key !== 'Escape') return;
        const aberto = MENUS.find(([, m]) => !$(m).hidden);
        if (aberto) { fecharMenus(); $(aberto[0]).focus(); return; }
        if ($('em-app').classList.contains('em-folha')) { abrirFolha(false); $('em-abrir-filtros').focus(); }
    });
    mostrarNovidades();

    // ----- densidade da lista e painel de filtros recolhido: preferências do aparelho -----
    function densidade(valor) {
        const compacta = valor === 'compacta';
        $('em-app').classList.toggle('em-compacta', compacta);
        for (const b of $('em-densidade').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.densidade === (compacta ? 'compacta' : 'confortavel')));
    }
    $('em-densidade').addEventListener('click', ev => {
        const b = ev.target.closest('button');
        if (!b) return;
        local('emails_densidade', b.dataset.densidade);
        densidade(b.dataset.densidade);
    });
    densidade(local('emails_densidade'));

    // largo: o painel recolhe e volta (lembrado no aparelho); estreito: os filtros abrem como folha sobre a lista
    const estreito = window.matchMedia('(max-width: 1100px)');
    function recolher(sim) {
        $('em-app').classList.toggle('em-sem-filtros', sim);
        local('emails_filtros_recolhido', sim ? '1' : '0');
        expandido();
    }
    function abrirFolha(sim) {
        $('em-app').classList.toggle('em-folha', sim);
        expandido();
        if (sim) $('em-recolher-filtros').focus();
    }
    function expandido() {
        const aberto = estreito.matches ? $('em-app').classList.contains('em-folha') : !$('em-app').classList.contains('em-sem-filtros');
        $('em-abrir-filtros').setAttribute('aria-expanded', String(aberto));
        $('em-recolher-filtros').setAttribute('aria-label', estreito.matches ? 'Fechar os filtros' : 'Recolher os filtros');
        $('em-recolher-filtros').dataset.dica = estreito.matches ? 'Fechar' : 'Recolher';
    }
    $('em-abrir-filtros').addEventListener('click', () => {
        if (estreito.matches) abrirFolha(!$('em-app').classList.contains('em-folha'));
        else { recolher(false); $('em-recolher-filtros').focus(); }
    });
    $('em-recolher-filtros').addEventListener('click', () => {
        if (estreito.matches) abrirFolha(false);
        else recolher(true);
        $('em-abrir-filtros').focus();
    });
    $('em-ver-resultados').addEventListener('click', () => { abrirFolha(false); $('em-lista').focus(); });
    estreito.addEventListener('change', () => { abrirFolha(false); });
    $('em-app').classList.toggle('em-sem-filtros', local('emails_filtros_recolhido') === '1');
    expandido();

    // ----- busca do cabeçalho: a mesma busca da Caixa; busca ao digitar, com espera de 300 ms -----
    let esperaBusca = 0;
    function buscar() {
        clearTimeout(esperaBusca);
        const busca = $('em-busca').value.trim();
        if (estado.visao === 'caixa' && busca === estado.filtro.busca) return;
        filtrar(Object.assign({}, estado.filtro, { busca }), estado.visao === 'caixa');
    }
    $('em-busca').addEventListener('input', () => {
        clearTimeout(esperaBusca);
        esperaBusca = setTimeout(buscar, 300);
    });
    $('em-busca').addEventListener('keydown', ev => {
        if (ev.key !== 'Enter') return;
        ev.preventDefault();
        buscar();
    });
    $('em-abrir-busca').addEventListener('click', () => {
        const aberta = $('em-topo').classList.toggle('em-buscando');
        $('em-abrir-busca').setAttribute('aria-expanded', String(aberta));
        if (aberta) $('em-busca').focus();
    });
    // "/" leva à busca, fora de campo de texto
    document.addEventListener('keydown', ev => {
        if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey || estado.bloqueado) return;
        const alvo = ev.target;
        if (alvo.closest && alvo.closest('input, textarea, select, [contenteditable]')) return;
        ev.preventDefault();
        if (getComputedStyle($('em-busca-global')).display === 'none') $('em-abrir-busca').click();
        else $('em-busca').focus();
    });

    // ----- visões pelo endereço: #caixa (com o filtro), #dashboard, #saude, #filtros -----
    const ITENS_TRILHO = { caixa: 'em-ir-caixa', dashboard: 'em-ir-dash', revisao: 'em-ir-revisao', atrasados: 'em-ir-atrasados', filtros: 'em-ir-filtros', saude: 'em-ir-saude' };
    const minhas = () => estado.prefs.minhas_caixas || [];
    function mostrarVisao() {
        if (estado.bloqueado) return;
        const r = F.rota(location.hash);
        if (r.visao === 'saude' && !admin) r.visao = 'caixa';
        estado.visao = r.visao;
        $('em-app').hidden = r.visao !== 'caixa';
        $('em-dash').hidden = r.visao !== 'dashboard';
        $('em-saude').hidden = r.visao !== 'saude';
        $('em-filtros-salvos').hidden = r.visao !== 'filtros';
        let item = r.ver || r.visao;
        if (r.visao === 'caixa') {
            const f = Q.deHash(location.hash, minhas());
            item = f.atrasados ? 'atrasados' : f.revisao ? 'revisao' : 'caixa';
            if (estado.iniciado && (!estado.listou || !Q.igual(f, estado.filtro))) {
                estado.filtro = f;
                listar(false);
            }
            desenharFiltros();
        }
        for (const id of Object.values(ITENS_TRILHO)) {
            if (id === ITENS_TRILHO[item]) $(id).setAttribute('aria-current', 'page');
            else $(id).removeAttribute('aria-current');
        }
        if (r.visao === 'dashboard') carregarDash(r.ver);
        if (r.visao === 'saude') carregarSaude();
        if (r.visao === 'filtros') desenharGestao();
    }
    window.addEventListener('hashchange', mostrarVisao);
    // clique no item da visão que já está aberta: o endereço não muda, então aplica de novo
    $('em-trilho').addEventListener('click', ev => {
        const a = ev.target.closest('a');
        if (a && a.getAttribute('href') === location.hash) mostrarVisao();
    });

    // aplica um filtro: ele vai para o endereço, e o endereço manda listar (voltar, avançar e recarregar funcionam)
    function filtrar(f, substituir) {
        const hash = Q.paraHash(f, minhas());
        if (estado.visao === 'caixa' && location.hash === hash) {
            if (!Q.igual(f, estado.filtro)) { estado.filtro = Q.normalizar(f); listar(false); desenharFiltros(); }
            return;
        }
        if (substituir) { history.replaceState(null, '', hash); mostrarVisao(); }
        else location.hash = hash;
    }
    const padrao = () => Q.deHash('#caixa', minhas());

    // ----- preferências (no portal) -----
    async function carregarPreferencias() {
        const r = await pedir('preferencias', {});
        if (r.sucesso && r.dados) estado.prefs = Object.assign({}, PREFS_PADRAO, r.dados);
        else if (!r.cancelado) $('em-salvar-estado').textContent = Q.erroPreferencias(r.codigo, r.erro);
    }
    // grava só as chaves que mudaram; devolve verdadeiro se gravou. A frase de erro vai para `onde`.
    async function salvarPreferencias(parcial, onde) {
        const r = await pedir('preferencias_salvar', parcial);
        if (r.cancelado) return false;
        if (!r.sucesso) { $(onde).textContent = Q.erroPreferencias(r.codigo, r.erro); return false; }
        estado.prefs = Object.assign({}, PREFS_PADRAO, r.dados);
        $(onde).textContent = '';
        return true;
    }

    // ----- painel de filtros -----
    const hoje = () => Q.hojeBrasilia();
    // redesenha os chips sem perder o foco do teclado (o chip ligado continua focado)
    function manterFoco(fn) {
        const foco = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.foco : '';
        fn();
        if (!foco) return;
        const alvo = [...document.querySelectorAll('[data-foco]')].find(x => x.dataset.foco === foco);
        if (alvo) alvo.focus({ preventScroll: true });
    }
    function chip(texto, acao, valor, ligado, classe) {
        const b = botao(null, 'em-chip' + (classe ? ' ' + classe : ''));
        b.dataset.acao = acao;
        b.dataset.valor = valor;
        b.dataset.foco = acao + ':' + valor;
        b.setAttribute('aria-pressed', String(ligado));
        if (texto) b.appendChild(el('span', texto, 'em-chip-texto'));
        return b;
    }
    function itemFiltro(nome, acao, valor, ligado, extra, cor) {
        const b = chip(null, acao, valor, ligado, 'em-filtro-item');
        if (cor) b.appendChild(el('span', null, 'em-cor em-etq-' + cor));
        b.appendChild(el('span', nome, 'em-chip-texto'));
        if (extra) b.appendChild(el('span', extra, 'em-filtro-extra'));
        return b;
    }
    function salvosOrdenados() {
        const p = estado.prefs;
        const todos = (p.equipe || []).map(s => Object.assign({ equipe: true }, s)).concat(p.filtros || []);
        return todos.filter(s => s.fixado).concat(todos.filter(s => !s.fixado));
    }
    function desenharFiltros() {
        const f = estado.filtro;
        manterFoco(() => {
            const m = minhas();
            for (const b of $('em-escopo').querySelectorAll('button')) {
                const minhasLigado = m.length > 0 && Q.igual(Object.assign({}, f, { contas: m }), f);
                b.setAttribute('aria-pressed', String(b.dataset.valor === 'minhas' ? minhasLigado : !f.contas.length));
                if (b.dataset.valor === 'minhas') {
                    b.disabled = !m.length;
                    b.title = m.length ? m.map(F.nomeCaixa).join(', ') : 'Escolha caixas abaixo e use "Usar como minhas caixas".';
                }
            }
            $('em-sem-ruido').setAttribute('aria-pressed', String(f.sem_ruido));
            $('em-ruido-dica').textContent = Q.ruidoDesligadoPeloFiltro(f)
                ? 'Desligado por este filtro, que pede uma categoria escondida.'
                : 'Esconde marketing, spam, Coupa e códigos de login.';

            const ativo = Q.prontoAtivo(f, hoje());
            $('em-prontos').replaceChildren(...Q.PRONTOS.map(p => itemFiltro(p.nome, 'pronto', p.id, p.id === ativo)));
            const salvos = salvosOrdenados();
            $('em-salvos').replaceChildren(...salvos.map(s => itemFiltro(s.nome, 'salvo', (s.equipe ? 'e:' : 'u:') + s.id,
                Q.igual(Q.deParams(s.filtro), f), s.equipe ? 'equipe' : '', s.cor)));
            if (!salvos.length) $('em-salvos').appendChild(el('p', 'Nenhum filtro salvo ainda.', 'em-dica-texto'));

            const contas = estado.contas.concat(f.contas.filter(c => !estado.contas.includes(c)));
            $('em-chips-contas').replaceChildren(...contas.map(c => {
                const b = chip(F.nomeCaixa(c), 'contas', c, f.contas.includes(c));
                b.title = c;
                return b;
            }));
            if (!contas.length) $('em-chips-contas').appendChild(el('p', 'As caixas aparecem quando a lista carrega.', 'em-dica-texto'));
            const definir = $('em-definir-minhas');
            definir.hidden = !f.contas.length && !m.length;
            definir.textContent = f.contas.length ? 'Usar como minhas caixas' : 'Esquecer minhas caixas';
            definir.disabled = f.contas.length > 0 && Q.igual(Object.assign({}, f, { contas: m }), f);

            $('em-chips-categorias').replaceChildren(...Q.CATEGORIAS.map(nome => {
                const c = F.categoria(nome === Q.SEM_CLASSIFICACAO ? null : nome);
                const b = chip(null, 'categorias', nome, f.categorias.includes(nome), 'em-chip-cat ' + c.classe);
                b.appendChild(icone(c.icone));
                b.appendChild(el('span', c.nome, 'em-chip-texto'));
                if (estado.contagens) {
                    const n = estado.contagens[nome] || 0;
                    b.appendChild(el('span', n.toLocaleString('pt-BR'), 'em-chip-num em-num'));
                    b.setAttribute('aria-label', c.nome + ', ' + (n === 1 ? '1 e-mail' : n.toLocaleString('pt-BR') + ' e-mails'));
                }
                return b;
            }));
            $('em-chips-estados').replaceChildren(...Q.ESTADOS.map(s => chip(s, 'estados', s, f.estados.includes(s))));
            for (const b of $('em-atalhos').querySelectorAll('button')) {
                const p = Q.periodo(b.dataset.valor, hoje());
                b.setAttribute('aria-pressed', String(f.de === p.de && f.ate === p.ate));
            }
            if ($('em-de').value !== f.de) $('em-de').value = f.de;
            if ($('em-ate').value !== f.ate) $('em-ate').value = f.ate;
            for (const b of $('em-form').querySelectorAll('[data-acao=opcao]')) b.setAttribute('aria-pressed', String(f[b.dataset.valor]));
            desenharAtivos();
        });
        if (document.activeElement !== $('em-busca') && $('em-busca').value.trim() !== f.busca) $('em-busca').value = f.busca;
    }
    function desenharAtivos() {
        const lista = Q.ativos(estado.filtro);
        const caixa = $('em-ativos');
        caixa.replaceChildren();
        for (const a of lista) {
            if (a.fixo) { caixa.appendChild(el('span', a.rotulo, 'em-ativo-nota')); continue; }
            const b = botao(null, 'em-ativo');
            b.dataset.acao = 'remover';
            b.dataset.chave = a.chave;
            b.dataset.valor = a.valor;
            b.dataset.foco = 'remover:' + a.chave + ':' + a.valor;
            b.setAttribute('aria-label', 'Remover o filtro ' + a.rotulo);
            b.appendChild(el('span', a.rotulo, 'em-chip-texto'));
            b.appendChild(icone('fechar', 'em-ic-p'));
            caixa.appendChild(b);
        }
        const removiveis = lista.filter(a => !a.fixo && a.chave !== 'sem_ruido').length;
        if (removiveis) {
            const limpar = botao('Limpar tudo', 'em-link');
            limpar.dataset.acao = 'limpar';
            limpar.dataset.foco = 'limpar-tudo';
            caixa.appendChild(limpar);
        }
        caixa.hidden = !lista.length;
        $('em-num-filtros').hidden = !removiveis;
        $('em-num-filtros').textContent = String(removiveis);
    }
    function acaoFiltro(b) {
        const f = estado.filtro, v = b.dataset.valor;
        switch (b.dataset.acao) {
        case 'contas': case 'categorias': case 'estados': return filtrar(Q.alternar(f, b.dataset.acao, v));
        case 'opcao': return filtrar(Object.assign({}, f, { [v]: !f[v] }));
        case 'sem-ruido': return filtrar(Object.assign({}, f, { sem_ruido: !f.sem_ruido }));
        case 'escopo': return filtrar(Object.assign({}, f, { contas: v === 'minhas' ? minhas() : [] }));
        case 'periodo': {
            const p = Q.periodo(v, hoje());
            const ligado = f.de === p.de && f.ate === p.ate;
            return filtrar(Object.assign({}, f, ligado ? { de: '', ate: '' } : p));
        }
        case 'pronto': return filtrar(Q.pronto(v, f, hoje()));
        case 'salvo': {
            const s = salvosOrdenados().find(x => (x.equipe ? 'e:' : 'u:') + x.id === v);
            return s && filtrar(Q.deParams(s.filtro));
        }
        case 'remover': return filtrar(Q.remover(f, b.dataset.chave, v));
        case 'limpar': return filtrar(padrao());
        }
        return undefined;
    }
    $('em-form').addEventListener('click', ev => {
        const b = ev.target.closest('[data-acao]');
        if (b && !b.disabled) acaoFiltro(b);
    });
    $('em-ativos').addEventListener('click', ev => {
        const b = ev.target.closest('[data-acao]');
        if (!b) return;
        // o chip removido some: o foco passa para o vizinho, ou para a lista
        const vizinho = b.nextElementSibling || b.previousElementSibling;
        if (vizinho && vizinho.dataset && vizinho.dataset.foco) vizinho.focus();
        acaoFiltro(b);
    });
    $('em-form').addEventListener('submit', ev => { ev.preventDefault(); buscar(); });
    for (const id of ['em-de', 'em-ate']) {
        $(id).addEventListener('change', () => filtrar(Object.assign({}, estado.filtro, { de: $('em-de').value, ate: $('em-ate').value })));
    }
    for (const id of ['em-limpar', 'em-limpar-vazio']) $(id).addEventListener('click', () => filtrar(padrao()));
    $('em-definir-minhas').addEventListener('click', async () => {
        const contas = estado.filtro.contas;
        if (!(await salvarPreferencias({ minhas_caixas: contas }, 'em-salvar-estado'))) return;
        history.replaceState(null, '', Q.paraHash(estado.filtro, minhas()));
        $('em-salvar-estado').textContent = contas.length ? 'Minhas caixas: ' + contas.map(F.nomeCaixa).join(', ') + '.' : 'Minhas caixas esquecidas.';
        desenharFiltros();
    });

    // ----- salvar o filtro atual -----
    const NOMES_COR = { cinza: 'Cinza', azul: 'Azul', verde: 'Verde', ambar: 'Âmbar', violeta: 'Violeta', ciano: 'Ciano', rosa: 'Rosa', laranja: 'Laranja' };
    function opcoesCor(sel, atual) {
        sel.replaceChildren(...Q.CORES.map(c => { const o = el('option', NOMES_COR[c]); o.value = c; o.selected = c === atual; return o; }));
    }
    opcoesCor($('em-salvar-cor'), 'azul');
    $('em-salvar-equipe-rotulo').hidden = !admin;
    const novoId = () => 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    $('em-salvar-filtro').addEventListener('click', () => {
        $('em-salvar-form').hidden = false;
        $('em-salvar-filtro').hidden = true;
        $('em-salvar-nome').value = '';
        $('em-salvar-nome').focus();
    });
    function fecharSalvar() {
        $('em-salvar-form').hidden = true;
        $('em-salvar-filtro').hidden = false;
    }
    $('em-salvar-cancelar').addEventListener('click', () => { fecharSalvar(); $('em-salvar-filtro').focus(); });
    async function salvarFiltro() {
        const nome = $('em-salvar-nome').value.trim();
        if (!nome) { $('em-salvar-estado').textContent = 'Dê um nome ao filtro.'; $('em-salvar-nome').focus(); return; }
        const chave = admin && $('em-salvar-equipe').checked ? 'equipe' : 'filtros';
        const novo = { id: novoId(), nome, cor: $('em-salvar-cor').value, fixado: $('em-salvar-fixar').checked, filtro: Q.params(estado.filtro) };
        if (!(await salvarPreferencias({ [chave]: (estado.prefs[chave] || []).concat(novo) }, 'em-salvar-estado'))) return;
        fecharSalvar();
        $('em-salvar-estado').textContent = 'Filtro "' + nome + '" salvo.';
        desenharFiltros();
        $('em-salvar-filtro').focus();
    }
    $('em-salvar-ok').addEventListener('click', salvarFiltro);
    $('em-salvar-nome').addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); salvarFiltro(); }
        if (ev.key === 'Escape') { ev.stopPropagation(); fecharSalvar(); $('em-salvar-filtro').focus(); }
    });

    // ----- gestão dos filtros salvos (#filtros): renomear, cor, fixar, apagar; os da equipe só o administrador -----
    async function alterarSalvos(chave, mudar) {
        const lista = (estado.prefs[chave] || []).map(s => Object.assign({}, s));
        mudar(lista);
        if (await salvarPreferencias({ [chave]: lista }, 'em-gestao-estado')) desenharGestao();
    }
    function linhaGestao(s, chave, editavel) {
        const li = el('li', null, 'em-gestao-linha');
        const topo = el('div', null, 'em-gestao-topo');
        topo.appendChild(el('span', null, 'em-cor em-etq-' + s.cor));
        const nome = el('span', s.nome, 'em-gestao-nome');
        topo.appendChild(nome);
        if (s.fixado) topo.appendChild(etiqueta('fixado'));
        li.appendChild(topo);
        const resumo = Q.ativos(Q.deParams(s.filtro)).map(a => a.rotulo).join(', ');
        li.appendChild(el('p', resumo || 'Sem filtro: todos os e-mails.', 'em-dica-texto'));
        const acoes = el('div', null, 'em-gestao-acoes');
        const aplicar = botao('Aplicar', 'em-botao');
        aplicar.addEventListener('click', () => filtrar(Q.deParams(s.filtro)));
        acoes.appendChild(aplicar);
        if (editavel) {
            const renomear = botao('Renomear', 'em-botao em-secundario');
            renomear.addEventListener('click', () => {
                const campo = el('input', null, 'em-entrada em-gestao-campo');
                campo.type = 'text'; campo.maxLength = 40; campo.value = s.nome;
                campo.setAttribute('aria-label', 'Novo nome do filtro ' + s.nome);
                const gravar = () => {
                    const novo = campo.value.trim();
                    if (!novo) { $('em-gestao-estado').textContent = 'O nome não pode ficar vazio.'; return; }
                    alterarSalvos(chave, l => { l.find(x => x.id === s.id).nome = novo; });
                };
                campo.addEventListener('keydown', ev => {
                    if (ev.key === 'Enter') { ev.preventDefault(); gravar(); }
                    if (ev.key === 'Escape') desenharGestao();
                });
                const ok = botao('Salvar nome', 'em-botao');
                ok.addEventListener('click', gravar);
                nome.replaceWith(campo);
                renomear.replaceWith(ok);
                campo.focus();
                campo.select();
            });
            const cor = el('select', null, 'em-entrada em-gestao-cor');
            cor.setAttribute('aria-label', 'Cor do filtro ' + s.nome);
            opcoesCor(cor, s.cor);
            cor.addEventListener('change', () => alterarSalvos(chave, l => { l.find(x => x.id === s.id).cor = cor.value; }));
            const fixar = botao(s.fixado ? 'Desafixar' : 'Fixar no topo', 'em-botao em-secundario');
            fixar.addEventListener('click', () => alterarSalvos(chave, l => { const x = l.find(y => y.id === s.id); x.fixado = !x.fixado; }));
            // apagar pede um segundo clique (sem janela de confirmação do navegador)
            const apagar = botao('Apagar', 'em-botao em-secundario em-perigo');
            let armado = 0;
            apagar.addEventListener('click', () => {
                if (!armado) {
                    apagar.textContent = 'Confirmar: apagar';
                    armado = setTimeout(() => { armado = 0; apagar.textContent = 'Apagar'; }, 4000);
                    return;
                }
                clearTimeout(armado);
                alterarSalvos(chave, l => { l.splice(l.findIndex(x => x.id === s.id), 1); });
            });
            acoes.append(renomear, cor, fixar, apagar);
        }
        li.appendChild(acoes);
        return li;
    }
    function blocoGestao(titulo, lista, chave, editavel, vazio) {
        const p = el('section', null, 'em-painel em-bloco');
        p.appendChild(el('h3', titulo, 'em-secao'));
        if (!lista.length) { p.appendChild(el('p', vazio, 'em-estado')); return p; }
        const ul = el('ul', null, 'em-gestao-lista');
        lista.forEach(s => ul.appendChild(linhaGestao(s, chave, editavel)));
        p.appendChild(ul);
        return p;
    }
    function desenharGestao() {
        const p = estado.prefs;
        $('em-gestao').replaceChildren(
            blocoGestao('Meus filtros', p.filtros || [], 'filtros', true, 'Nenhum filtro salvo. Escolha os filtros na Caixa e use "Salvar filtro atual".'),
            blocoGestao('Filtros da equipe', p.equipe || [], 'equipe', admin,
                admin ? 'Nenhum filtro da equipe. Ao salvar um filtro na Caixa, marque "Publicar para a equipe".' : 'Nenhum filtro da equipe.'));
        if (!admin && (p.equipe || []).length) $('em-gestao').lastChild.appendChild(el('p', 'Só administrador edita os filtros da equipe.', 'em-dica-texto'));
    }

    // ----- lista -----
    const hora = iso => {
        const d = iso ? new Date(iso) : null;
        return d && !isNaN(d) ? d.toLocaleTimeString('pt-BR', { timeZone: F.FUSO, hour: '2-digit', minute: '2-digit' }) : '';
    };
    function itemLista(e) {
        const li = el('li', null, 'em-linha');
        const st = ['pendente', 'respondido', 'arquivado'].includes(e.status) ? e.status : 'pendente';
        const b = botao(null, 'em-item ' + F.categoria(e.categoria).classe + ' em-st-' + st);
        b.dataset.id = String(e.id);
        if (e.revisao) b.classList.add('em-revisao');
        if (e.removido) b.classList.add('em-removido');
        const topo = el('span', null, 'em-item-topo');
        topo.appendChild(comRealce('span', e.remetente_nome || e.remetente || '(sem remetente)', 'em-de'));
        const quando = el('span', hora(e.data), 'em-data em-num');
        quando.title = dataHora(e.data);
        topo.appendChild(quando);
        b.appendChild(topo);
        b.appendChild(comRealce('span', e.assunto || '(sem assunto)', 'em-assunto-linha'));
        if (e.resumo) b.appendChild(comRealce('span', e.resumo, 'em-resumo'));
        const rodape = el('span', null, 'em-item-rodape');
        rodape.appendChild(etiquetaCategoria(e.categoria));
        if (e.urgencia === 'alta') rodape.appendChild(etiqueta('urgente', 'em-etiqueta-erro', 'alerta'));
        const prazo = Q.prazo(e);
        if (prazo) {
            const r = el('span', null, 'em-prazo em-prazo-' + prazo);
            r.appendChild(icone('relogio', 'em-ic-p'));
            r.appendChild(el('span', F.decimal(e.horas_uteis) + ' h', 'em-num'));
            r.appendChild(el('span', prazo === 'atrasado' ? ' úteis, atrasado' : ' úteis', 'em-prazo-txt'));
            rodape.appendChild(r);
        }
        if (e.revisao) rodape.appendChild(etiqueta('revisar', 'em-etiqueta-atencao', 'revisao'));
        if (st !== 'pendente') rodape.appendChild(el('span', st, 'em-st-texto'));
        if (e.removido) rodape.appendChild(el('span', 'removido da caixa', 'em-removido-texto'));
        if (e.anexos) {
            const a = el('span', null, 'em-item-anexos');
            a.appendChild(icone('anexo', 'em-ic-p'));
            a.appendChild(el('span', e.anexos === 1 ? '1 anexo' : e.anexos + ' anexos'));
            rodape.appendChild(a);
        }
        rodape.appendChild(el('span', (e.caixas || []).map(F.nomeCaixa).join(', '), 'em-caixas'));
        b.appendChild(rodape);
        b.addEventListener('click', () => abrir(e.id, b));
        li.appendChild(b);
        return li;
    }
    function separador(rotulo) {
        const li = el('li', null, 'em-dia');
        li.appendChild(el('h3', rotulo, 'em-secao'));
        return li;
    }

    function esqueleto() {
        const ul = $('em-lista');
        for (let i = 0; i < 6; i++) {
            const li = el('li', null, 'em-esqueleto-item');
            li.setAttribute('aria-hidden', 'true');
            for (let j = 0; j < 3; j++) li.appendChild(el('span', null, 'em-esqueleto-linha'));
            ul.appendChild(li);
        }
    }

    async function listar(mais) {
        const meu = ++estado.seqLista;
        if (!mais) {
            estado.proximo = null; estado.itens = 0; estado.ultimoDia = ''; estado.listou = true;
            $('em-lista').replaceChildren(); $('em-novidade').hidden = true; $('em-vazio-lista').hidden = true;
            esqueleto();
        }
        estado.carregando = true;
        $('em-lista').setAttribute('aria-busy', 'true');
        $('em-tentar').hidden = true;
        avisar(mais ? 'Carregando mais e-mails…' : 'Carregando e-mails…');
        $('em-mais').hidden = true;
        const r = await pedir('listar', Object.assign(Q.params(estado.filtro), { cursor: mais ? estado.proximo : '' }));
        if (meu !== estado.seqLista) return;   // outro pedido da lista já tomou o lugar deste
        estado.carregando = false;
        $('em-lista').setAttribute('aria-busy', 'false');
        $('em-lista').querySelectorAll('.em-esqueleto-item').forEach(x => x.remove());
        if (r.cancelado) return;
        if (!r.sucesso) {
            avisar(r.erro || 'Não foi possível carregar os e-mails.');
            $('em-tentar').hidden = false;
            if (mais) $('em-mais').hidden = !estado.proximo;
            return;
        }
        const d = r.dados || {};
        $('em-versao').hidden = Q.v2(d);   // serviço antigo: avisa e segue com o que veio
        if (!mais) {
            if (Number.isFinite(d.total)) estado.total = d.total;
            if (Array.isArray(d.contas)) estado.contas = d.contas.filter(c => typeof c === 'string');
            estado.contagens = d.contagens && typeof d.contagens === 'object' ? d.contagens : null;
            desenharFiltros();
        }
        const itens = Array.isArray(d.itens) ? d.itens : [];
        const frag = document.createDocumentFragment();
        for (const e of itens) {
            const dia = Q.grupoDia(e.data);
            if (dia !== estado.ultimoDia) { frag.appendChild(separador(dia)); estado.ultimoDia = dia; }
            frag.appendChild(itemLista(e));
        }
        $('em-lista').appendChild(frag);
        estado.itens += itens.length;
        estado.proximo = d.proximo || null;
        $('em-mais').hidden = !estado.proximo;
        $('em-vazio-lista').hidden = estado.itens > 0;
        const total = Math.max(estado.total, estado.itens);
        avisar(estado.itens ? (total === 1 ? '1 e-mail' : total.toLocaleString('pt-BR') + ' e-mails') : 'Nenhum e-mail encontrado.');
        $('em-ver-resultados').textContent = estado.itens ? 'Ver ' + (total === 1 ? '1 e-mail' : total.toLocaleString('pt-BR') + ' e-mails') : 'Ver e-mails';
    }
    // carregar mais sozinho ao chegar ao fim; o botão continua como reserva
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(entradas => {
            if (entradas.some(x => x.isIntersecting) && estado.proximo && !estado.carregando) listar(true);
        }, { rootMargin: '200px' }).observe($('em-mais'));
    }
    // setas percorrem a lista de e-mail em e-mail
    $('em-lista').addEventListener('keydown', ev => {
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return;
        const itens = [...$('em-lista').querySelectorAll('.em-item')];
        if (!itens.length) return;
        const i = itens.indexOf(document.activeElement);
        const alvo = ev.key === 'Home' ? 0 : ev.key === 'End' ? itens.length - 1
            : Math.max(0, Math.min(itens.length - 1, i < 0 ? 0 : i + (ev.key === 'ArrowDown' ? 1 : -1)));
        ev.preventDefault();
        itens[alvo].focus();
    });

    function meta(rotulo, valor) {
        const dl = $('em-meta');
        dl.appendChild(el('dt', rotulo));
        const dd = el('dd');
        if (valor instanceof Node) dd.appendChild(valor);
        else dd.textContent = valor || '—';
        dl.appendChild(dd);
    }

    // ----- dashboard: números e barras de uma série (um tom), com o valor escrito ao lado -----
    function kpi(rotulo, valor, alerta) {
        const d = el('div', null, 'em-kpi em-painel' + (alerta ? ' em-kpi-alerta' : ''));
        d.appendChild(el('strong', valor, 'em-num'));
        d.appendChild(el('span', rotulo));
        return d;
    }
    function painel(titulo, id) {
        const p = el('section', null, 'em-painel em-bloco');
        const h = el('h3', titulo, 'em-secao');
        if (id) { h.id = id; h.tabIndex = -1; }
        p.appendChild(h);
        return p;
    }
    function barras(titulo, pares) {
        const p = painel(titulo);
        if (!pares.length) { p.appendChild(el('p', 'Sem dados no período.', 'em-estado')); return p; }
        const max = Math.max(1, ...pares.map(x => x[1]));
        const ul = el('ul', null, 'em-barras');
        for (const [rotulo, valor] of pares) {
            const li = el('li', null, 'em-barra');
            li.title = rotulo + ': ' + valor.toLocaleString('pt-BR');
            li.appendChild(el('span', rotulo, 'em-barra-rotulo'));
            const trilho = el('span', null, 'em-barra-trilho');
            const v = el('span', null, 'em-barra-valor');
            v.style.setProperty('--em-largura', (100 * valor / max).toFixed(1) + '%');   // CSSOM: permitido pela CSP
            trilho.appendChild(v);
            li.appendChild(trilho);
            li.appendChild(el('span', valor.toLocaleString('pt-BR'), 'em-barra-num em-num'));
            ul.appendChild(li);
        }
        p.appendChild(ul);
        return p;
    }
    function tabela(titulo, cabecalho, linhas, id, vazio) {
        const p = painel(titulo, id);
        if (!linhas.length) { p.appendChild(el('p', vazio || 'Nada a mostrar.', 'em-estado')); return p; }
        const rolagem = el('div', null, 'em-rolagem');
        const t = el('table', null, 'em-tabela');
        const tr = el('tr');
        cabecalho.forEach(c => tr.appendChild(el('th', c)));
        const thead = el('thead'); thead.appendChild(tr); t.appendChild(thead);
        const tbody = el('tbody');
        for (const l of linhas) {
            const r = el('tr');
            l.forEach(c => { const td = el('td'); if (c instanceof Node) td.appendChild(c); else td.textContent = c; r.appendChild(td); });
            tbody.appendChild(r);
        }
        t.appendChild(tbody);
        rolagem.appendChild(t);
        p.appendChild(rolagem);
        return p;
    }
    function situacao(ok, textoOk, textoRuim) {
        const s = el('span', null, 'em-situacao ' + (ok ? 'em-ok' : 'em-ruim'));
        s.appendChild(icone(ok ? 'conferir' : 'alerta', 'em-ic-p'));
        s.appendChild(el('span', ok ? textoOk : textoRuim));
        return s;
    }
    function tabelaSaude(d) {
        return tabela('Saúde das caixas', ['Caixa', 'Leitura', 'Última leitura', 'Reconciliação', 'Erro'],
            (d.saude || []).map(s => [F.nomeCaixa(s.conta), situacao(!s.parada && !s.ultimo_erro, 'em dia', s.ultimo_erro ? 'com erro' : 'parada'),
                dataHora(s.ultima_leitura), s.reconciliacao == null ? '—' : (100 * s.reconciliacao).toFixed(1).replace('.', ',') + '%',
                s.ultimo_erro || (s.pastas_com_erro ? s.pastas_com_erro + ' pasta(s) com erro' : '')]), null, 'Nenhuma caixa configurada.');
    }
    async function carregarDash(ver) {
        $('em-dash-estado').textContent = 'Carregando o dashboard…';
        const r = await pedir('resumo', {});
        if (r.cancelado) return;
        const alvo = $('em-dash-conteudo');
        alvo.replaceChildren();
        if (!r.sucesso) { $('em-dash-estado').textContent = r.erro || 'Não foi possível carregar o dashboard.'; return; }
        const d = r.dados;
        contadores(d);
        $('em-dash-estado').textContent = 'Atualizado em ' + dataHora(d.gerado_em) +
            (d.deteccao_confiavel.length ? '' : '. Nenhuma caixa grava enviados no servidor ainda: o alerta vermelho fica desligado.');
        const kpis = el('div', null, 'em-kpis');
        kpis.appendChild(kpi('cotações pendentes', d.pendentes['cotação'].toLocaleString('pt-BR')));
        kpis.appendChild(kpi('pedidos pendentes', d.pendentes['pedido'].toLocaleString('pt-BR')));
        kpis.appendChild(kpi('atrasados (mais de 4 h úteis)', d.atrasados.toLocaleString('pt-BR'), d.atrasados > 0));
        kpis.appendChild(kpi('na fila de revisão', d.revisao.toLocaleString('pt-BR')));
        kpis.appendChild(kpi('não classificados', d.nao_classificados.toLocaleString('pt-BR')));
        const t = d.tempo_medio_resposta;
        kpis.appendChild(kpi('tempo médio de resposta' + (t.n ? ' (' + t.n + ' respostas)' : ''),
            t.horas_uteis == null ? 'sem dados' : t.horas_uteis.toLocaleString('pt-BR') + ' h úteis'));
        if (d.gasto_mes) kpis.appendChild(kpi('gasto de IA no mês' + (d.gasto_mes.pausado ? ', classificação pausada' : ''),
            'US$ ' + d.gasto_mes.usd.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' de ' + d.gasto_mes.teto.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), d.gasto_mes.pausado));
        alvo.appendChild(kpis);
        const graficos = el('div', null, 'em-graficos');
        graficos.appendChild(barras('Hoje por categoria', Object.entries(d.hoje_por_categoria)));
        graficos.appendChild(barras('Volume por caixa nos últimos 7 dias', d.volume_por_caixa.map(v => [F.nomeCaixa(v.conta), v.semana])));
        alvo.appendChild(graficos);
        alvo.appendChild(tabela('Atrasados', ['Recebido', 'Categoria', 'Remetente', 'Assunto', 'Horas úteis'],
            d.lista_atrasados.map(a => [dataHora(a.data), etiquetaCategoria(a.categoria), a.remetente || '', a.assunto || '', F.decimal(a.horas_uteis)]),
            'em-atrasados', 'Nenhuma cotação ou pedido atrasado.'));
        if (d.saude) alvo.appendChild(tabelaSaude(d));
        if (ver === 'atrasados') { $('em-atrasados').scrollIntoView({ block: 'start' }); $('em-atrasados').focus({ preventScroll: true }); }
    }
    async function carregarSaude() {
        $('em-saude-estado').textContent = 'Carregando…';
        const r = await pedir('resumo', {});
        if (r.cancelado) return;
        const alvo = $('em-saude-conteudo');
        alvo.replaceChildren();
        if (!r.sucesso) { $('em-saude-estado').textContent = r.erro || 'Não foi possível carregar a saúde das caixas.'; return; }
        contadores(r.dados);
        if (!r.dados.saude) { $('em-saude-estado').textContent = 'A saúde das caixas é só para administrador.'; return; }
        $('em-saude-estado').textContent = 'Atualizado em ' + dataHora(r.dados.gerado_em);
        alvo.appendChild(tabelaSaude(r.dados));
    }

    // ----- status e categoria no detalhe -----
    function controles(e) {
        const caixa = $('em-controle');
        caixa.replaceChildren();
        const grupo = el('div', null, 'em-segmentado');
        grupo.setAttribute('role', 'group');
        grupo.setAttribute('aria-label', 'Status');
        for (const [valor, rotulo] of [['pendente', 'Pendente'], ['respondido', 'Respondido'], ['arquivado', 'Arquivado']]) {
            const b = el('button', rotulo);
            b.type = 'button';
            b.setAttribute('aria-pressed', String(e.status === valor));
            b.addEventListener('click', () => alterar('status', { id: e.id, status: valor }));
            grupo.appendChild(b);
        }
        caixa.appendChild(grupo);
        const sel = el('select', null, 'em-entrada em-categoria-sel');
        sel.setAttribute('aria-label', 'Corrigir categoria');
        // categoria de regra (interno, enviado...) aparece como opção atual, para não cair em "cotação" por engano
        const opcoes = F.CORRIGIVEIS.includes(e.categoria) || !e.categoria ? F.CORRIGIVEIS : [e.categoria].concat(F.CORRIGIVEIS);
        for (const c of opcoes) { const o = el('option', c); o.value = c; if (c === e.categoria) o.selected = true; sel.appendChild(o); }
        const corrigir = el('button', 'Corrigir categoria', 'em-botao em-secundario');
        corrigir.type = 'button';
        corrigir.addEventListener('click', () => { if (sel.value !== e.categoria) alterar('categoria', { id: e.id, categoria: sel.value }); });
        caixa.appendChild(sel);
        caixa.appendChild(corrigir);
        caixa.appendChild(el('span', 'Status: ' + (e.status || '—') + (e.status_por ? ', por ' + e.status_por : '') +
            (e.status_em ? ' em ' + dataHora(e.status_em) : ''), 'em-status-atual'));
        if (e.categoria_original && e.categoria_original !== e.categoria) {
            caixa.appendChild(el('span', 'Categoria original da IA: ' + e.categoria_original, 'em-status-atual'));
        }
    }
    async function alterar(acao, params) {
        const r = await pedir(acao, params);
        if (r.cancelado) return;
        if (!r.sucesso) { avisar(r.erro || 'Não foi possível salvar.'); return; }
        if (!estado.aberto || estado.aberto.id !== params.id) return;   // outro e-mail foi aberto enquanto salvava
        avisoFlutuante(acao === 'status' ? 'Status salvo.' : 'Categoria corrigida.');
        mostrarDetalhe(r.dados);
    }

    async function abrir(id, botaoItem) {
        document.querySelectorAll('.em-item.em-ativo').forEach(b => b.classList.remove('em-ativo'));
        if (botaoItem) botaoItem.classList.add('em-ativo');
        const painelDetalhe = $('em-detalhe');
        painelDetalhe.hidden = false;
        $('em-app').classList.add('em-com-detalhe');
        $('em-assunto').textContent = 'Carregando…';
        $('em-meta').replaceChildren(); $('em-avisos').replaceChildren(); $('em-anexos').replaceChildren(); $('em-controle').replaceChildren();
        $('em-corpo').textContent = ''; mostrarTexto();
        $('em-ver-html').hidden = true;
        const r = await pedir('detalhe', { id });
        if (r.cancelado) return;
        if (!r.sucesso) { $('em-assunto').textContent = r.erro || 'Não foi possível abrir o e-mail.'; return; }
        mostrarDetalhe(r.dados);
        $('em-assunto').focus();
    }

    function aviso(texto, forte) {
        const d = el('div', null, 'em-aviso' + (forte ? ' em-aviso-forte' : ''));
        d.appendChild(icone('alerta', 'em-ic-p'));
        d.appendChild(el('p', texto));
        return d;
    }

    function mostrarDetalhe(e) {
        $('em-meta').replaceChildren(); $('em-avisos').replaceChildren(); $('em-anexos').replaceChildren();
        mostrarTexto();
        estado.aberto = e;
        $('em-assunto').textContent = e.assunto || '(sem assunto)';
        meta('De', (e.remetente_nome ? e.remetente_nome + ' ' : '') + '<' + (e.remetente || '') + '>');
        meta('Para', e.destinatarios);
        if (e.cc) meta('Cc', e.cc);
        meta('Data', dataHora(e.data));
        meta('Caixas', (e.ocorrencias || []).map(o => F.nomeCaixa(o.conta) + ' / ' + o.pasta + (o.removida_em ? ' (removido)' : '')).join('; '));
        const cat = el('span', null, 'em-meta-categoria');
        cat.appendChild(etiquetaCategoria(e.categoria));
        if (e.confianca != null) cat.appendChild(el('span', `confiança ${Math.round(e.confianca * 100)}%`, 'em-num'));
        meta('Categoria', cat);
        if (e.resumo) meta('Resumo', e.resumo);
        meta('Autenticação', `SPF ${e.spf || 'ausente'}, DKIM ${e.dkim || 'ausente'}`);
        const avisos = $('em-avisos');
        if (e.removido) avisos.appendChild(aviso('Este e-mail foi apagado ou movido em todas as caixas. A central guarda a cópia.'));
        if (e.categoria === 'phishing' || e.categoria === 'spam') avisos.appendChild(aviso('Classificado como ' + e.categoria + ': não abra links e não responda. Anexos bloqueados.', true));
        if (e.revisao) avisos.appendChild(aviso('Classificação com baixa confiança: está na fila de revisão.'));
        const anexos = $('em-anexos');
        if ((e.anexos || []).length) {
            anexos.appendChild(el('h3', 'Anexos', 'em-secao'));
            const ul = el('ul');
            for (const a of e.anexos) {
                const li = el('li');
                const nome = el('span', null, 'em-anexo-nome');
                nome.appendChild(icone('anexo', 'em-ic-p'));
                nome.appendChild(el('span', a.nome || 'anexo sem nome'));
                nome.appendChild(el('span', tamanho(a.tamanho), 'em-anexo-tamanho em-num'));
                li.appendChild(nome);
                const b = el('button', null, 'em-botao em-secundario');
                b.type = 'button';
                b.appendChild(icone(a.bloqueado ? 'alerta' : 'baixar', 'em-ic-p'));
                const rotulo = el('span', a.bloqueado ? 'Bloqueado' : 'Baixar');
                b.appendChild(rotulo);
                b.disabled = !!a.bloqueado;
                if (a.bloqueado) b.title = a.motivo_bloqueio || 'Anexo bloqueado';
                b.addEventListener('click', () => baixar(e.id, a.id, b, rotulo));
                li.appendChild(b);
                ul.appendChild(li);
            }
            anexos.appendChild(ul);
        }
        if (e.corpo_oculto) $('em-corpo').textContent = 'Corpo oculto: este e-mail traz código de acesso ou senha e não é exibido na central.';
        else $('em-corpo').textContent = e.corpo_texto || '(e-mail sem texto)';
        $('em-ver-html').hidden = !e.tem_html || e.corpo_oculto;
        controles(e);
    }
    async function baixar(id, anexo, botaoAnexo, rotulo) {
        botaoAnexo.disabled = true;
        const texto = rotulo.textContent;
        rotulo.textContent = 'Baixando…';
        const r = await pedir('anexo', { id, anexo });
        botaoAnexo.disabled = false;
        rotulo.textContent = texto;
        if (r.cancelado) return;
        if (!r.sucesso) { avisar(r.erro || 'Não foi possível baixar o anexo.'); return; }
        const url = r.dados && r.dados.url;
        if (typeof url === 'string' && /^\/emails\/anexo\/[0-9a-f]{64}$/.test(url)) window.location.assign(url);
    }

    // CSP do documento do iframe: nada de rede, nada de script, nada de formulário; links não clicáveis.
    // O fundo branco vem da regra .em-html de tela.css (--em-papel).
    const CABECALHO_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; form-action \'none\'">' +
        '<style>a,area{pointer-events:none!important;cursor:default!important}body{font-family:sans-serif}</style></head><body>';

    async function verHtml() {
        const e = estado.aberto;
        if (!e) return;
        const r = await pedir('html', { id: e.id });
        if (r.cancelado || estado.aberto !== e) return;   // outro e-mail foi aberto enquanto esperava
        if (!r.sucesso) { avisar(r.erro || 'Não foi possível abrir a versão formatada.'); return; }
        const quadro = $('em-html');
        quadro.setAttribute('sandbox', '');   // reforço: sem allow-scripts e sem allow-same-origin
        quadro.srcdoc = CABECALHO_HTML + String((r.dados && r.dados.html) || '') + '</body></html>';
        quadro.hidden = false;
        $('em-corpo').hidden = true;
        $('em-ver-html').hidden = true;
        $('em-ver-texto').hidden = false;
    }
    function mostrarTexto() {
        const quadro = $('em-html');
        quadro.hidden = true;
        quadro.removeAttribute('srcdoc');
        $('em-corpo').hidden = false;
        $('em-ver-texto').hidden = true;
        if (estado.aberto && estado.aberto.tem_html && !estado.aberto.corpo_oculto) $('em-ver-html').hidden = false;
    }

    $('em-mais').addEventListener('click', () => listar(true));
    $('em-tentar').addEventListener('click', () => listar(estado.itens > 0 && !!estado.proximo));
    $('em-recarregar').addEventListener('click', () => listar(false));
    $('em-ver-html').addEventListener('click', verHtml);
    $('em-ver-texto').addEventListener('click', mostrarTexto);
    mostrarVisao();
})();
