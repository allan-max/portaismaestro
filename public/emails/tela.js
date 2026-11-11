/* Central de E-mails: casca (cabeçalho, trilho, visões), caixa unificada e dashboard.
   Regra de segurança: todo campo vindo de e-mail entra por textContent. Nunca HTML montado a partir de texto.
   HTML do e-mail só em iframe sandbox="" (sem scripts e sem mesma origem), por clique, com CSP própria.
   Lógica pura fica em formato.js (rota, categoria, formatos), filtro.js (filtro, endereço, realce) e acoes.js (detalhe,
   seleção, lote, desfazer), que o node --test carrega. */
(function () {
    'use strict';
    const F = window.EmailsFormato;
    const Q = window.EmailsFiltro;
    const A = window.EmailsAcoes;
    const $ = id => document.getElementById(id);
    // local(): o navegador pode bloquear o armazenamento, e aí a tela explica em vez de quebrar
    const sessao = local('maestro_session');
    // só arrumação da tela: o servidor corta o dado de administrador e recusa filtro da equipe de quem não é
    const admin = local('maestro_admin') === 'true';
    const SVG = 'http://www.w3.org/2000/svg';
    const PREFS_PADRAO = { minhas_caixas: [], filtros: [], sem_ruido: true, agrupar: false, notificar: false, som: false, equipe: [] };
    const estado = { filtro: Q.novo(), proximo: null, itens: 0, total: 0, aberto: null, contas: [], contagens: null, visao: '',
        bloqueado: false, iniciado: false, listou: false, carregando: false, parouMais: false, seqLista: 0, ultimoDia: '', prefs: PREFS_PADRAO,
        idAberto: null, sel: new Set(), ancora: null, dados: new Map() };
    const CANCELADO = { sucesso: false, cancelado: true };
    const ESCRITAS = new Set(['status', 'categoria', 'lote', 'desfazer']);
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
    // preferência do aparelho; sem armazenamento, vale o padrão
    function local(chave, valor) {
        try {
            if (valor === undefined) return localStorage.getItem(chave);
            localStorage.setItem(chave, valor);
        } catch (e) { /* sem armazenamento: só não lembra */ }
        return null;
    }
    const dataHora = F.dataHora, tamanho = F.tamanho;
    // movimento reduzido: o CSS zera o dele; o script pergunta aqui
    const reduzido = window.matchMedia('(prefers-reduced-motion: reduce)');
    const comMovimento = () => !reduzido.matches;
    const tempo = nome => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nome)) || 0;
    // põe a classe de animação de novo (a mesma animação pode repetir) e tira no fim
    function animar(e, classe) {
        if (!comMovimento()) return;
        e.classList.remove(classe);
        void e.offsetWidth;   // reinicia a animação
        e.classList.add(classe);
        e.addEventListener('animationend', () => e.classList.remove(classe), { once: true });
    }
    function avisar(texto) { $('em-estado').textContent = texto; }
    // aviso flutuante; com "Desfazer", 5 s (o prazo para com o foco nele)
    let avisoTempo = 0, avisoMs = 0, avisoVez = 0;
    function esconderAviso() {
        const a = $('em-aviso-flutuante');
        if (a.contains(document.activeElement)) focoNaLista();
        if (a.hidden || !comMovimento()) { a.hidden = true; return; }
        // sobe ao entrar e desce ao sair; um aviso novo no meio da saída cancela o sumiço
        const vez = avisoVez;
        a.classList.add('em-sumindo');
        a.addEventListener('animationend', () => { if (vez === avisoVez) a.hidden = true; a.classList.remove('em-sumindo'); }, { once: true });
    }
    function avisoFlutuante(texto, aoDesfazer, erro) {
        const a = $('em-aviso-flutuante');
        avisoVez++;
        a.classList.remove('em-sumindo');
        const filhos = [icone(erro ? 'alerta' : 'conferir', 'em-ic-p ' + (erro ? 'em-ruim' : 'em-ok')), el('span', texto)];
        if (aoDesfazer) {
            const b = botao('Desfazer', 'em-botao em-secundario em-desfazer');
            b.addEventListener('click', () => { clearTimeout(avisoTempo); esconderAviso(); aoDesfazer(); });
            filhos.push(b);
        }
        a.replaceChildren(...filhos);
        a.hidden = false;
        avisoMs = aoDesfazer ? 5000 : 4000;
        clearTimeout(avisoTempo);
        avisoTempo = setTimeout(esconderAviso, avisoMs);
    }
    $('em-aviso-flutuante').addEventListener('focusin', () => clearTimeout(avisoTempo));
    $('em-aviso-flutuante').addEventListener('focusout', () => { clearTimeout(avisoTempo); avisoTempo = setTimeout(esconderAviso, avisoMs); });
    function telaAcesso(titulo, texto) {
        estado.bloqueado = true;
        for (const id of ['em-app', 'em-dash', 'em-saude', 'em-filtros-salvos', 'em-trilho', 'em-busca-global', 'em-abrir-busca', 'em-sino']) $(id).hidden = true;
        $('em-lista').replaceChildren();   // nem o esqueleto de carregamento fica na página
        $('em-acesso').hidden = false;
        $('em-acesso-titulo').textContent = titulo;
        $('em-acesso-texto').textContent = texto;
    }

    if (!sessao) {
        try { localStorage; } catch (e) { return telaAcesso('Armazenamento bloqueado', 'O navegador bloqueou o armazenamento deste site. Libere-o para entrar no Maestro.'); }
        telaAcesso('Entre no Maestro', 'Faça login no portal para ver os e-mails.');
        return;
    }
    $('em-usuario').textContent = local('maestro_user') || '';
    $('em-ir-saude').hidden = !admin;

    // ----- indicador "ao vivo" -----
    const AO_VIVO = { vivo: 'Ao vivo', conectando: 'Conectando', reconectando: 'Reconectando', offline: 'Serviço offline' };
    function aoVivo(s) {
        if ($('em-ao-vivo').dataset.estado === s) return;
        $('em-ao-vivo').dataset.estado = s;
        $('em-ao-vivo-texto').textContent = AO_VIVO[s];
    }

    const socket = io({ auth: { sessionId: sessao }, transports: ['websocket', 'polling'] });

    // `grupo` separa pedidos da mesma ação que não se substituem (a exportação não cancela a lista da tela)
    function pedir(acao, params, grupo) {
        return new Promise(resolve => {
            const requestId = acao + ':' + (++seq);
            // a leitura mais nova cancela a anterior; a escrita já enviada grava mesmo assim: cada uma vai na fila
            grupo = grupo || (ESCRITAS.has(acao) ? requestId : acao);
            cancelarPedidos(grupo);
            esperando.set(requestId, { requestId, acao, grupo, params, resolve, enviado: false });
            enviarFila();
        });
    }
    // o portal guarda um pedido por ação e tela: espera o da mesma ação e de outro grupo
    function enviarFila() {
        const todos = [...esperando.values()];
        for (const p of todos) {
            if (p.enviado || todos.some(o => o.enviado && o.acao === p.acao && o.grupo !== p.grupo)) continue;
            p.enviado = true;
            socket.emit('emails_pedir', { requestId: p.requestId, acao: p.acao, params: p.params });
        }
    }
    function cancelarPedidos(grupo) {
        for (const [id, p] of esperando) if (p.grupo === grupo) { esperando.delete(id); p.resolve(CANCELADO); }
        enviarFila();
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
        enviarFila();
        // nas preferências, SEM_PERMISSAO é "equipe só para administrador"
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
            // as preferências vêm do portal (valem com o serviço offline)
            await carregarPreferencias();
            desenharAvisos();
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
        const n = d && Number.isSafeInteger(d.novos) && d.novos > 0 ? d.novos : 0;
        // cotações e pedidos do ciclo: só contagem; serviço antigo não manda e aí não há aviso
        const aviso = d ? A.textoAviso(d.cotacoes, d.pedidos) : '';
        if (n) {
            $('em-novidade-texto').textContent = n === 1 ? '1 e-mail novo chegou.' : n + ' e-mails novos chegaram.';
            $('em-novidade').hidden = false;
        }
        if (n || aviso) registrarNovidade(n, aviso);
        if (aviso) avisarNovidade(aviso);
    });

    // ----- aviso de cotação e pedido novos: notificação (só contagem) e som, cada um com a sua chave -----
    const temNotificacao = () => 'Notification' in window;
    function avisarNovidade(texto) {
        if (estado.prefs.notificar && temNotificacao() && Notification.permission === 'granted') {
            try { new Notification('Central de E-mails', { body: texto, tag: 'emails-novidade' }); } catch (e) { /* sem aviso: o sino guarda */ }
        }
        if (estado.prefs.som) tocar();
    }
    // o áudio só nasce ou volta dentro de um clique (ligar o som ou "Testar")
    let audio = null;
    function somPronto() {
        const Contexto = window.AudioContext || window.webkitAudioContext;
        if (!Contexto) return null;
        if (!audio) audio = new Contexto();
        if (audio.state === 'suspended') audio.resume().catch(() => {});
        return audio;
    }
    // dois toques curtos e baixos, gerados na hora (sem arquivo de áudio)
    function tocar() {
        const ctx = audio || somPronto();
        if (!ctx) return;
        const t = ctx.currentTime, osc = ctx.createOscillator(), vol = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1175, t + 0.09);
        vol.gain.setValueAtTime(0.0001, t);
        vol.gain.exponentialRampToValueAtTime(0.12, t + 0.015);
        vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
        osc.connect(vol);
        vol.connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.28);
    }
    let motivoAviso = '';
    function desenharAvisos() {
        const permitido = temNotificacao() && Notification.permission === 'granted';
        $('em-notificar').setAttribute('aria-checked', String(!!estado.prefs.notificar && permitido));
        $('em-som').setAttribute('aria-checked', String(!!estado.prefs.som));
        if (estado.prefs.notificar && !permitido && !motivoAviso) motivoAviso = semPermissao();
        $('em-aviso-estado').textContent = motivoAviso;
    }
    function semPermissao() {
        if (!temNotificacao() || !window.isSecureContext) return 'Este navegador não mostra avisos nesta página. O sino e o som continuam valendo.';
        if (Notification.permission === 'denied') return 'O navegador bloqueou os avisos desta página. Para ligar, clique no cadeado ao lado do endereço, permita as notificações e ligue de novo aqui.';
        return 'O navegador não deu a permissão. Ligue de novo e escolha "Permitir".';
    }
    $('em-notificar').addEventListener('click', async () => {
        let quer = $('em-notificar').getAttribute('aria-checked') !== 'true';
        motivoAviso = '';
        if (quer) {
            // a permissão é pedida só aqui, no clique, nunca ao abrir a tela
            if (temNotificacao() && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch (e) { /* recusado */ } }
            if (!temNotificacao() || Notification.permission !== 'granted') { quer = false; motivoAviso = semPermissao(); }
        }
        if (quer !== !!estado.prefs.notificar) await salvarPreferencias({ notificar: quer }, 'em-aviso-estado');
        desenharAvisos();
    });
    $('em-som').addEventListener('click', async () => {
        const quer = !estado.prefs.som;
        if (quer) somPronto();
        motivoAviso = '';
        if (await salvarPreferencias({ som: quer }, 'em-aviso-estado')) { desenharAvisos(); if (quer) tocar(); }
    });
    $('em-testar-som').addEventListener('click', () => { somPronto(); tocar(); });

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
    function registrarNovidade(n, aviso) {
        novidades.unshift({ n, aviso, em: new Date() });
        if (novidades.length > 10) novidades.length = 10;
        naoVistas += n;
        const c = $('em-sino-num');
        c.hidden = !naoVistas;
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
            const quando = 'às ' + x.em.toLocaleTimeString('pt-BR', { timeZone: F.FUSO, hour: '2-digit', minute: '2-digit' });
            li.appendChild(el('strong', x.n ? (x.n === 1 ? '1 e-mail novo' : x.n + ' e-mails novos') : x.aviso));
            li.appendChild(document.createTextNode(x.n && x.aviso ? x.aviso + ', ' + quando : quando));
            ul.appendChild(li);
        }
    }
    function sinoVisto() {
        naoVistas = 0;
        $('em-sino-num').hidden = true;
        $('em-sino').setAttribute('aria-label', 'Novidades');
    }

    // ----- menus flutuantes do cabeçalho -----
    const MENUS = [['em-sino', 'em-menu-sino', sinoVisto], ['em-usuario-botao', 'em-menu-usuario', null],
        ['em-categoria-botao', 'em-menu-categoria', () => focarCategoria(0)]];
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
            $(m).scrollIntoView({ block: 'nearest' });   // no celular, acima da barra inferior
            if (aoAbrir) aoAbrir();
        });
    }
    document.addEventListener('click', ev => { if (!ev.target.closest('.em-ancora')) fecharMenus(); });
    // Esc fecha uma coisa por vez: menu, dica, folha, e-mail aberto, seleção, modo foco (a ajuda fecha sozinha)
    document.addEventListener('keydown', ev => {
        if (ev.key !== 'Escape' || $('em-ajuda').open) return;
        const aberto = MENUS.find(([, m]) => !$(m).hidden);
        if (aberto) { fecharMenus(); $(aberto[0]).focus(); return; }
        if (!$('em-ponto').hidden) { $('em-ponto').hidden = true; return; }   // dica de gráfico do Dashboard
        if ($('em-app').classList.contains('em-folha')) { abrirFolha(false); $('em-abrir-filtros').focus(); return; }
        if (emCampo(ev.target) || estado.visao !== 'caixa') return;
        if (estado.idAberto !== null) { ev.preventDefault(); fecharDetalhe(); return; }
        if (estado.sel.size) { limparSelecao(); focoNaLista(); return; }
        if (emFoco()) modoFoco(false);
    });
    mostrarNovidades();

    // ----- modo foco (só na Caixa): f ou o botão, Esc sai -----
    const emFoco = () => document.body.classList.contains('em-modo-foco');
    function modoFoco(sim) {
        document.body.classList.toggle('em-modo-foco', sim);
        const b = $('em-foco');
        b.setAttribute('aria-pressed', String(sim));
        b.setAttribute('aria-label', sim ? 'Sair do modo foco' : 'Modo foco');
        b.dataset.dica = sim ? 'Sair do modo foco' : 'Modo foco';
        if (sim) abrirFolha(false);
        if (sim && document.activeElement.closest('#em-trilho, #em-filtros')) focoNaLista();   // o foco não some
    }
    $('em-foco').addEventListener('click', () => modoFoco(!emFoco()));

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

    // largo: o painel recolhe; estreito: os filtros abrem como folha
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

    // ----- busca do cabeçalho (a mesma da Caixa), 300 ms depois de digitar -----
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
    // atalhos não disparam com o foco num campo de texto (a caixa de seleção da lista não conta)
    const emCampo = alvo => !!(alvo && alvo.closest && alvo.closest('input:not([type=checkbox]), textarea, select, [contenteditable]'));
    // "/" leva à busca, fora de campo de texto
    document.addEventListener('keydown', ev => {
        if (ev.key !== '/' || ev.ctrlKey || ev.metaKey || ev.altKey || estado.bloqueado) return;
        if (emCampo(ev.target)) return;
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
        if (r.visao !== 'caixa' && emFoco()) modoFoco(false);   // sem trilho não haveria como voltar
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
        // veio de um clique que sumiu com a visão anterior (gráfico, filtro salvo): o foco vai para a lista
        if (r.visao === 'caixa' && !document.activeElement.getClientRects().length) $('em-lista').focus({ preventScroll: true });
        if (r.visao === 'dashboard') carregarDash(r.ver);
        if (r.visao === 'saude') carregarSaude();
        if (r.visao === 'filtros') desenharGestao();
    }
    window.addEventListener('hashchange', mostrarVisao);
    // clique na visão já aberta: aplica de novo
    $('em-trilho').addEventListener('click', ev => {
        const a = ev.target.closest('a');
        if (a && a.getAttribute('href') === location.hash) mostrarVisao();
    });

    // o filtro vai para o endereço, e o endereço manda listar
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
    let ativosDesenhados = false;
    function desenharAtivos() {
        const lista = Q.ativos(estado.filtro);
        const caixa = $('em-ativos');
        // o chip que entra cresce; o que sai some no lugar (nunca na primeira vez)
        const antes = new Map([...caixa.children].filter(x => x.dataset.foco && !x.classList.contains('em-saindo')).map((x, i) => [x.dataset.foco, [x, i]]));
        const novos = [];
        for (const a of lista) {
            if (a.fixo) { novos.push(el('span', a.rotulo, 'em-ativo-nota')); continue; }
            const b = botao(null, 'em-chip-ativo');
            b.dataset.acao = 'remover';
            b.dataset.chave = a.chave;
            b.dataset.valor = a.valor;
            b.dataset.foco = 'remover:' + a.chave + ':' + a.valor;
            b.setAttribute('aria-label', 'Remover o filtro ' + a.rotulo);
            b.appendChild(el('span', a.rotulo, 'em-chip-texto'));
            b.appendChild(icone('fechar', 'em-ic-p'));
            novos.push(b);
        }
        const removiveis = lista.filter(a => !a.fixo && a.chave !== 'sem_ruido').length;
        if (removiveis) {
            const limpar = botao('Limpar tudo', 'em-link');
            limpar.dataset.acao = 'limpar';
            limpar.dataset.foco = 'limpar-tudo';
            novos.push(limpar);
        }
        if (ativosDesenhados && comMovimento()) {
            const ficam = new Set(novos.map(x => x.dataset.foco).filter(Boolean));
            for (const x of novos) if (x.dataset.foco && !antes.has(x.dataset.foco)) x.classList.add('em-chip-novo');
            for (const [foco, [x, i]] of antes) {
                if (ficam.has(foco)) continue;
                x.classList.add('em-saindo');
                x.disabled = true;
                x.tabIndex = -1;
                x.setAttribute('aria-hidden', 'true');
                novos.splice(Math.min(i, novos.length), 0, x);
                x.addEventListener('animationend', () => x.remove(), { once: true });
            }
        }
        ativosDesenhados = true;
        caixa.replaceChildren(...novos);
        caixa.hidden = !lista.length || estado.sel.size > 0;
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

    // ----- gestão dos filtros salvos (#filtros); os da equipe só o administrador -----
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
    // caixa de seleção e botão lado a lado (controle dentro de controle não pode)
    function itemLista(e) {
        estado.dados.set(e.id, e);
        const li = el('li', null, 'em-linha');
        li.dataset.id = String(e.id);
        const st = ['pendente', 'respondido', 'arquivado'].includes(e.status) ? e.status : 'pendente';
        const b = botao(null, 'em-item ' + F.categoria(e.categoria).classe + ' em-st-' + st);
        b.dataset.id = String(e.id);
        if (e.id === estado.idAberto) b.classList.add('em-ativo');
        const marcado = estado.sel.has(e.id);
        li.classList.toggle('em-selecionado', marcado);
        const caixa = el('input', null, 'em-sel');
        caixa.type = 'checkbox';
        caixa.tabIndex = -1;   // pelo teclado a seleção é a tecla x; a lista fica com uma parada por e-mail
        caixa.checked = marcado;
        caixa.setAttribute('aria-label', 'Selecionar: ' + (e.assunto || '(sem assunto)'));
        caixa.addEventListener('click', ev => selecionar(e.id, ev.shiftKey, caixa.checked));
        li.addEventListener('click', ev => { if (ev.target === li) caixa.click(); });   // a coluna é o alvo de toque
        li.appendChild(caixa);
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
        b.addEventListener('click', () => abrir(e.id));
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
            estado.proximo = null; estado.itens = 0; estado.ultimoDia = ''; estado.listou = true; estado.dados.clear();
            $('em-lista').replaceChildren(); $('em-novidade').hidden = true; $('em-vazio-lista').hidden = true;
            esqueleto();
        }
        estado.carregando = true;
        estado.parouMais = false;
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
            if (!mais) $('em-exportar').disabled = true;
            // o carregamento sozinho espera um clique (sem laço de falhas)
            if (mais) { estado.parouMais = true; $('em-mais').hidden = !estado.proximo; }
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
        const linhas = [];
        for (const e of itens) {
            const dia = Q.grupoDia(e.data);
            if (dia !== estado.ultimoDia) { frag.appendChild(separador(dia)); estado.ultimoDia = dia; }
            linhas.push(frag.appendChild(itemLista(e)));
        }
        $('em-lista').appendChild(frag);
        // depois de "Atualizar", só o que chegou desce; lista nova: os 12 primeiros em escada
        const antes = estado.idsAntes;
        estado.idsAntes = null;
        if (!mais && comMovimento()) {
            if (antes) for (const li of linhas) { if (!antes.has(Number(li.dataset.id))) li.classList.add('em-chegou'); }
            else linhas.slice(0, 12).forEach((li, i) => { li.style.animationDelay = i * tempo('--em-passo') + 'ms'; li.classList.add('em-entrar'); });
        }
        // a seleção fica só com o que está na lista: nada de alterar em lote um e-mail que não se vê
        if (!mais && estado.sel.size) { for (const id of [...estado.sel]) if (!estado.dados.has(id)) estado.sel.delete(id); desenharSelecao(); }
        estado.itens += itens.length;
        estado.proximo = d.proximo || null;
        $('em-mais').hidden = !estado.proximo;
        $('em-vazio-lista').hidden = estado.itens > 0;
        const total = Math.max(estado.total, estado.itens);
        avisar(estado.itens ? (total === 1 ? '1 e-mail' : total.toLocaleString('pt-BR') + ' e-mails') : '0 e-mails');   // o estado vazio diz o resto
        $('em-exportar').disabled = !estado.itens || !!exportacao;
        $('em-ver-resultados').textContent = estado.itens ? 'Ver ' + (total === 1 ? '1 e-mail' : total.toLocaleString('pt-BR') + ' e-mails') : 'Ver e-mails';
    }
    // carregar mais sozinho ao chegar ao fim; o botão continua como reserva
    if ('IntersectionObserver' in window) {
        new IntersectionObserver(entradas => {
            if (entradas.some(x => x.isIntersecting) && estado.proximo && !estado.carregando && !estado.parouMais) listar(true);
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

    // ----- tabelas e painéis comuns ao Dashboard e à Saúde das caixas -----
    function painel(titulo, id) {
        const p = el('section', null, 'em-painel em-bloco');
        const h = el('h3', titulo, 'em-secao');
        if (id) { h.id = id; h.tabIndex = -1; }
        p.appendChild(h);
        return p;
    }
    function tabelaSimples(cabecalho, linhas) {
        const rolagem = el('div', null, 'em-rolagem');
        const t = el('table', null, 'em-tabela');
        const tr = el('tr');
        cabecalho.forEach(c => tr.appendChild(el('th', c)));
        const thead = el('thead'); thead.appendChild(tr); t.appendChild(thead);
        const tbody = el('tbody');
        for (const l of linhas) {
            const r = el('tr');
            l.forEach((c, i) => { const td = el('td'); td.dataset.rotulo = cabecalho[i]; if (c instanceof Node) td.appendChild(c); else td.textContent = c; r.appendChild(td); });
            tbody.appendChild(r);
        }
        t.appendChild(tbody);
        rolagem.appendChild(t);
        return rolagem;
    }
    function tabela(titulo, cabecalho, linhas, id, vazio) {
        const p = painel(titulo, id);
        p.appendChild(linhas.length ? tabelaSimples(cabecalho, linhas) : el('p', vazio || 'Nada a mostrar.', 'em-estado'));
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
    // backup e disco, como o serviço registrou (o caminho do arquivo de backup não aparece)
    function tabelaManutencao(m) {
        const linhas = [];
        const b = m && m.backup, dc = m && m.disco, rt = m && m.retencao;
        if (b) linhas.push(['Backup', situacao(b.ok === true, 'ok', 'com erro'),
            dataHora(b.em) + (typeof b.tamanho_mb === 'number' ? ', ' + G.numero(b.tamanho_mb, 1) + ' MB' : '') + (b.erro ? ', ' + b.erro : '')]);
        if (dc) linhas.push(['Disco', situacao(!dc.alerta, 'espaço suficiente', 'pouco espaço'),
            G.numero(dc.livre_gb, 1) + ' GB livres de ' + G.numero(dc.total_gb, 1) + ' GB']);
        if (rt) linhas.push(['Retenção', situacao(true, rt.aplicado ? 'aplicada' : 'conferida', ''),
            G.numero(rt.emails) + (rt.aplicado ? ' e-mails antigos removidos' : ' e-mails além do limite')]);
        return tabela('Manutenção', ['Item', 'Situação', 'Detalhe'], linhas, null, 'Nenhuma manutenção registrada ainda.');
    }

    // ----- dashboard (seção 7): cada número leva à Caixa filtrada -----
    const G = window.EmailsGraficos;
    const dash = { periodo: 'hoje', escopo: '', ocultas: new Set(), d: null, em: 0 };
    const escopoDash = () => (minhas().length ? dash.escopo || 'minhas' : 'todas');
    const contasDash = () => (escopoDash() === 'minhas' ? minhas() : []);
    // endereço da Caixa com o filtro do clique; sem categoria, "sem ruído" desliga (a lista conta o mesmo que o painel)
    function paraCaixa(campos) {
        const f = Object.assign(Q.novo(), { contas: contasDash() }, campos);
        if (!f.categorias.length) f.sem_ruido = false;
        return Q.paraHash(f, minhas());
    }
    function svg(tag, atributos, classe) {
        const e = document.createElementNS(SVG, tag);
        for (const [k, v] of Object.entries(atributos || {})) e.setAttribute(k, String(v));
        if (classe) e.setAttribute('class', classe);
        return e;
    }
    function textoSvg(texto, atributos, classe) {
        const t = svg('text', atributos, classe);
        t.textContent = texto;
        return t;
    }
    // marca: link para a Caixa, com o valor no nome acessível e na dica
    function marca(href, rotulo) {
        const a = href ? svg('a', { href }) : svg('g');
        if (!href) a.setAttribute('role', 'img');
        a.setAttribute('aria-label', rotulo);
        a.dataset.ponto = rotulo;
        return a;
    }
    // barra com a ponta arredondada e a base reta
    function coluna(x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h));
        return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`;
    }
    function deitada(x, y, w, h, r) {
        r = Math.max(0, Math.min(r, h / 2, w));
        return `M${x} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x}Z`;
    }
    const curto = (t, max) => (t.length > max ? t.slice(0, Math.max(1, max - 1)) + '…' : t);
    const larguraDe = area => Math.max(260, Math.floor(area.clientWidth));

    let seqFigura = 0;
    function figura(titulo, descricao, classe) {
        const id = 'em-fig-' + (++seqFigura);
        const f = el('section', null, 'em-painel em-bloco em-figura' + (classe ? ' ' + classe : ''));
        f.setAttribute('aria-labelledby', id);
        const h = el('h3', titulo, 'em-secao');
        h.id = id;
        f.appendChild(h);
        if (descricao) { const p = el('p', descricao, 'em-figura-desc'); p.id = id + '-d'; f.appendChild(p); f.setAttribute('aria-describedby', p.id); }
        return f;
    }
    // a informação do gráfico em tabela
    function tabelaEquivalente(cabecalho, linhas) {
        const d = el('details', null, 'em-tabela-equiv');
        d.appendChild(el('summary', 'Ver em tabela'));
        // montada só ao abrir; rola de lado, também pelo teclado
        d.addEventListener('toggle', () => { if (d.open && d.children.length < 2) d.appendChild(tabelaSimples(cabecalho, linhas)).tabIndex = 0; });
        return d;
    }
    function insuficiente(alvo, porque) {
        alvo.appendChild(el('p', 'Dados insuficientes', 'em-insuficiente'));
        alvo.appendChild(el('p', porque, 'em-estado'));
    }
    // legenda que liga e desliga série; a cor segue a categoria, nunca a posição
    function legenda(prefixo, series, nome, classe) {
        const g = el('div', null, 'em-legenda');
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', 'Mostrar ou esconder séries');
        for (const s of series) {
            const chave = prefixo + s.chave;
            const b = botao(null, 'em-legenda-item');
            b.setAttribute('aria-pressed', String(!dash.ocultas.has(chave)));
            b.dataset.foco = 'serie:' + chave;
            const amostra = el('span', null, 'em-amostra ' + classe(s.chave));
            amostra.setAttribute('aria-hidden', 'true');
            b.append(amostra, el('span', nome(s.chave)));
            b.addEventListener('click', () => {
                if (dash.ocultas.has(chave)) dash.ocultas.delete(chave); else dash.ocultas.add(chave);
                manterFoco(() => montarDash(''));
            });
            g.appendChild(b);
        }
        return g;
    }
    const ocultasDe = prefixo => new Set([...dash.ocultas].filter(k => k.startsWith(prefixo)).map(k => k.slice(prefixo.length)));

    // colunas empilhadas por dia, com eixo de marcas redondas e linhas de grade finas
    function colunasEmpilhadas(area, pilhas, nome, classe, link) {
        const W = larguraDe(area), H = 188, esq = 40, base = H - 24, topo = 8;
        const marcas = G.marcas(Math.max(0, ...pilhas.map(p => p.total)));
        const teto = marcas[marcas.length - 1], altura = base - topo;
        const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group' }, 'em-grafico em-colunas');
        for (const m of marcas) {
            const y = base - G.escala(m, teto, altura) + .5;
            s.appendChild(svg('line', { x1: esq, x2: W, y1: y, y2: y }, m ? 'em-grade' : 'em-grade em-grade-base'));
            s.appendChild(textoSvg(G.numero(m), { x: esq - 8, y: y + 4, 'text-anchor': 'end' }, 'em-eixo'));
        }
        const banda = (W - esq) / Math.max(1, pilhas.length), larg = Math.min(24, banda * .7);
        const cada = Math.ceil(pilhas.length / Math.max(1, Math.floor((W - esq) / 48)));
        pilhas.forEach((p, i) => {
            const x = esq + i * banda + (banda - larg) / 2;
            p.partes.forEach((parte, j) => {
                const y1 = base - G.escala(parte.y1, teto, altura), y0 = base - G.escala(parte.y0, teto, altura);
                const a = marca(link(p.dia, parte.chave), G.diaCurto(p.dia) + ', ' + nome(parte.chave) + ': ' + G.numero(parte.valor));
                a.appendChild(svg('path', { d: coluna(x, y1, larg, Math.max(1, y0 - y1 - (j ? 2 : 0)), j === p.partes.length - 1 ? 4 : 0) },
                    'em-serie ' + classe(parte.chave)));
                s.appendChild(a);
            });
            if (i % cada === 0) s.appendChild(textoSvg(G.diaCurto(p.dia), { x: x + larg / 2, y: H - 6, 'text-anchor': 'middle' }, 'em-eixo'));
        });
        return s;
    }
    // um dia só (Hoje): uma barra deitada por série
    function colunasOuBarras(area, pilhas, nome, classe, link) {
        if (pilhas.length !== 1) return colunasEmpilhadas(area, pilhas, nome, classe, link);
        const dia = pilhas[0].dia;
        return barrasDeitadas(area, pilhas[0].partes.map(p => {
            const href = link(dia, p.chave), dica = G.diaCurto(dia) + ', ' + nome(p.chave) + ': ' + G.numero(p.valor);
            return { rotulo: nome(p.chave), href, dica, partes: [{ valor: p.valor, classe: classe(p.chave), href, dica }] };
        }));
    }
    // barras deitadas, uma linha por item, com partes
    function barrasDeitadas(area, linhas) {
        const W = larguraDe(area), esq = Math.min(176, Math.round(W * .38)), dir = 48, alt = 30, H = linhas.length * alt;
        const totalDe = l => l.partes.reduce((t, p) => t + p.valor, 0);
        const max = Math.max(1, ...linhas.map(totalDe));
        const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'group' }, 'em-grafico em-barras');
        linhas.forEach((l, i) => {
            const y = i * alt, meio = y + alt / 2;
            const rot = marca(l.href, l.dica);
            rot.appendChild(svg('rect', { x: 0, y, width: esq, height: alt }, 'em-alvo'));
            rot.appendChild(textoSvg(curto(l.rotulo, Math.floor((esq - 8) / 7)), { x: 0, y: meio + 4 }, 'em-eixo-rotulo'));
            s.appendChild(rot);
            const partes = l.partes.filter(p => p.valor > 0);
            let x = esq;
            partes.forEach((p, j) => {
                const w = G.escala(p.valor, max, W - esq - dir), ultima = j === partes.length - 1;
                const a = marca(p.href, p.dica);
                a.appendChild(svg('path', { d: deitada(x, meio - 6, Math.max(2, w - (ultima ? 0 : 2)), 12, ultima ? 4 : 0) }, 'em-serie ' + p.classe));
                s.appendChild(a);
                x += w;
            });
            s.appendChild(textoSvg(G.numero(totalDe(l)), { x: x + 8, y: meio + 4 }, 'em-eixo-valor'));
        });
        return s;
    }
    // mapa de calor: só leitura; o valor exato na dica e na tabela, que é o que o leitor de tela lê.
    // Estreito: dias nas colunas e horas nas linhas.
    function mapaCalor(area, mapa) {
        const W = larguraDe(area), pe = W < 520, esq = 36, topo = 18, gap = 2;
        const cel = (W - esq) / (pe ? 7 : 24), alt = 20, H = topo + (pe ? 24 : 7) * alt;
        const max = G.maximoMapa(mapa);
        const s = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, 'em-grafico');
        const esquerda = n => ({ x: 0, y: topo + n * alt + alt / 2 + 3 }), cima = n => ({ x: esq + n * cel, y: 12 });
        for (let h = 0; h < 24; h += 3) s.appendChild(textoSvg(String(h).padStart(2, '0') + 'h', pe ? esquerda(h) : cima(h), 'em-eixo'));
        G.DIAS.forEach((dia, i) => {
            s.appendChild(textoSvg(dia.slice(0, 3), pe ? cima(i) : esquerda(i), 'em-eixo'));
            const linha = s.appendChild(svg('g', null, 'em-calor-linha'));   // aparece linha a linha ao abrir
            linha.style.animationDelay = i * 2 * tempo('--em-passo') + 'ms';
            for (let h = 0; h < 24; h++) {
                const v = (mapa[i] || [])[h] || 0;
                const g = marca('', dia + ', ' + String(h).padStart(2, '0') + 'h: ' + G.numero(v) + (v === 1 ? ' e-mail' : ' e-mails'));
                g.appendChild(svg('rect', { x: esq + (pe ? i : h) * cel, y: topo + (pe ? h : i) * alt, width: Math.max(1, cel - gap), height: alt - gap, rx: 2 },
                    'em-calor em-calor-' + G.nivelCalor(v, max)));
                linha.appendChild(g);
            }
        });
        return s;
    }
    // mini-gráfico do indicador: linha discreta, sem eixo
    function miniGrafico(serie) {
        const d = G.linhaMini(serie, 120, 24);
        if (!d) return null;
        const s = svg('svg', { width: 120, height: 28, viewBox: '0 -2 120 28', 'aria-hidden': 'true', focusable: 'false' }, 'em-mini');
        s.appendChild(svg('path', { d }));
        return s;
    }

    // indicador: link para a Caixa filtrada
    function indicador(rotulo, valor, href, extra) {
        const o = extra || {};
        const a = el('a', null, 'em-kpi em-painel' + (o.alerta ? ' em-kpi-alerta' : ''));
        a.href = href;
        a.appendChild(el('span', rotulo, 'em-kpi-rotulo'));
        if (o.insuficiente) {
            a.appendChild(el('strong', 'Dados insuficientes', 'em-kpi-insuf'));
            a.appendChild(el('span', o.insuficiente, 'em-kpi-nota'));
            return a;
        }
        const forte = a.appendChild(el('strong', valor, 'em-kpi-valor'));
        // número cru para a contagem ao abrir; o texto final é sempre o formatado acima
        if (typeof o.num === 'number' && Number.isFinite(o.num)) Object.assign(forte.dataset, { num: o.num, casas: o.casas || 0, sufixo: o.sufixo || '' });
        if (o.variacao) {
            const v = el('span', null, 'em-kpi-nota');
            v.append(el('span', o.variacao.texto, 'em-variacao em-' + G.tom(o.variacao.sentido, o.maiorMelhor)), document.createTextNode(' contra o período anterior'));
            a.appendChild(v);
        }
        const mini = o.serie && miniGrafico(o.serie);
        if (mini) a.appendChild(mini);
        return a;
    }
    function grupoIndicadores(titulo, detalhe, cartoes) {
        const g = el('section', null, 'em-grupo-kpi');
        const h = el('h3', titulo, 'em-secao');
        if (detalhe) h.appendChild(el('span', detalhe, 'em-grupo-detalhe'));
        g.appendChild(h);
        const grade = el('div', null, 'em-kpis');
        cartoes.forEach(c => grade.appendChild(c));
        g.appendChild(grade);
        return g;
    }
    const PRECISA_RESPOSTA = 'Precisa de caixa com detecção de resposta e de 5 respostas detectadas no período.';
    function indicadores(d) {
        const p = d.periodo, ind = d.indicadores, no = { de: p.de, ate: p.ate };
        const pend = (d.pendentes['cotação'] || 0) + (d.pendentes.pedido || 0);
        const agora = grupoIndicadores('Agora', '', [
            indicador('Pendentes que pedem resposta', G.numero(pend), paraCaixa({ categorias: ['cotação', 'pedido'], estados: ['pendente'] }), { num: pend }),
            indicador('Atrasados, mais de 4 h úteis', G.numero(d.atrasados), paraCaixa({ atrasados: true }), { alerta: d.atrasados > 0, num: d.atrasados }),
            indicador('Na fila de revisão', G.numero(d.revisao), paraCaixa({ revisao: true }), { num: d.revisao }),
            indicador('Não classificados', G.numero(d.nao_classificados), paraCaixa({ categorias: [Q.SEM_CLASSIFICACAO] }), { num: d.nao_classificados }),
        ]);
        const pct = ind.pct_no_prazo, tm = ind.tempo_medio;
        const periodo = grupoIndicadores('No período', G.periodoTexto(p) + ', contra ' + G.periodoTexto({ de: p.anterior_de, ate: p.anterior_ate }), [
            indicador('E-mails recebidos', G.numero(ind.recebidos.atual), paraCaixa(no),
                { variacao: G.variacao(ind.recebidos.atual, ind.recebidos.anterior), maiorMelhor: null, serie: ind.recebidos.serie, num: ind.recebidos.atual }),
            indicador('Cotações recebidas', G.numero(ind.cotacoes.atual), paraCaixa(Object.assign({ categorias: ['cotação'] }, no)),
                { variacao: G.variacao(ind.cotacoes.atual, ind.cotacoes.anterior), maiorMelhor: null, serie: ind.cotacoes.serie, num: ind.cotacoes.atual }),
            indicador('Respondidos em até 4 h úteis', G.numero(pct.atual, 1) + '%', paraCaixa(Object.assign({ categorias: ['cotação', 'pedido'] }, no)),
                { insuficiente: G.suficiente(pct) ? '' : PRECISA_RESPOSTA, variacao: G.variacao(pct.atual, pct.anterior, 'pp'), maiorMelhor: true, serie: pct.serie, num: pct.atual, casas: 1, sufixo: '%' }),
            indicador('Tempo médio de resposta', G.numero(tm.atual, 1) + ' h úteis', paraCaixa(Object.assign({ categorias: ['cotação', 'pedido'] }, no)),
                { insuficiente: G.suficiente(tm) ? '' : PRECISA_RESPOSTA, variacao: G.variacao(tm.atual, tm.anterior, 'h'), maiorMelhor: false, serie: tm.serie, num: tm.atual, casas: 1, sufixo: ' h úteis' }),
        ]);
        return [agora, periodo];
    }

    const nomeSerie = ch => (ch === 'demais' ? 'demais categorias' : F.categoria(ch).nome);
    const classeSerie = ch => (ch === 'demais' ? 'em-serie-demais' : F.categoria(ch).classe);
    function painelVolume(d, depois) {
        const f = figura('Volume por dia', 'E-mails recebidos por dia e categoria, sem os enviados. Cada parte abre esses e-mails na Caixa.', 'em-largo');
        const series = G.seriesVolume(d.volume_diario, 6);
        if (!series.length) { f.appendChild(el('p', 'Nenhum e-mail recebido no período.', 'em-estado')); return f; }
        const cats = ch => series.find(s => s.chave === ch).categorias;
        f.appendChild(legenda('vol:', series, nomeSerie, classeSerie));
        const area = el('div', null, 'em-grafico-area');
        f.appendChild(area);
        depois.push(() => area.appendChild(colunasOuBarras(area, G.empilhar(d.volume_diario, series, ocultasDe('vol:')), nomeSerie, classeSerie,
            (dia, ch) => paraCaixa({ categorias: cats(ch), de: dia, ate: dia }))));
        const pilhas = G.empilhar(d.volume_diario, series, new Set());
        f.appendChild(tabelaEquivalente(['Dia'].concat(series.map(s => nomeSerie(s.chave)), 'Total'),
            pilhas.map(p => [G.diaCurto(p.dia)].concat(series.map(s => G.numero((p.partes.find(x => x.chave === s.chave) || { valor: 0 }).valor)), G.numero(p.total)))));
        return f;
    }
    function painelFunil(d) {
        const fu = d.funil || {}, p = d.periodo;
        const f = figura('Funil de cotações', 'Cotações recebidas no período nas caixas com detecção de resposta.');
        if (!G.suficiente(fu, 'recebidas')) { insuficiente(f, PRECISA_RESPOSTA); return f; }
        const confiaveis = (d.deteccao_confiavel || []).filter(c => !contasDash().length || contasDash().includes(c));
        const base = { categorias: ['cotação'], contas: confiaveis, de: p.de, ate: p.ate };
        const etapa = (rotulo, n, campos, classe) => ({ rotulo, dica: rotulo + ': ' + G.numero(n), href: paraCaixa(Object.assign({}, base, campos)),
            partes: [{ valor: n, classe: classe || 'em-cat-cotacao', href: paraCaixa(Object.assign({}, base, campos)), dica: rotulo + ': ' + G.numero(n) }] });
        const linhas = [etapa('Recebidas', fu.recebidas, {}), etapa('Respondidas', fu.respondidas, { estados: ['respondido'] }),
            etapa('Respondidas no prazo', fu.no_prazo, { estados: ['respondido'] }), etapa('Pendentes', fu.pendentes, { estados: ['pendente'] }),
            etapa('Atrasadas', fu.atrasadas, { atrasados: true }, 'em-serie-erro')];
        const area = el('div', null, 'em-grafico-area');
        f.appendChild(area);
        f.depois = () => area.appendChild(barrasDeitadas(area, linhas));
        f.appendChild(tabelaEquivalente(['Etapa', 'Cotações'], linhas.map(l => [l.rotulo, G.numero(l.partes[0].valor)])));
        return f;
    }
    function painelMapa(d) {
        const f = figura('Recebimento por dia da semana e hora', 'Quantos e-mails chegaram em cada hora, no horário de Brasília. Quanto mais forte, mais e-mails.', 'em-largo');
        const mapa = Array.isArray(d.mapa_calor) ? d.mapa_calor : [];
        const area = el('div', null, 'em-grafico-area');
        f.appendChild(area);
        f.depois = () => area.appendChild(mapaCalor(area, mapa));
        f.appendChild(tabelaEquivalente(['Dia'].concat(Array.from({ length: 24 }, (_, h) => h + 'h')),
            G.DIAS.map((dia, i) => [dia].concat((mapa[i] || []).map(v => G.numero(v))))));
        return f;
    }
    function painelLista(titulo, descricao, vazio, linhas, cabecalho, tabelaLinhas) {
        const f = figura(titulo, descricao);
        if (!linhas.length) { f.appendChild(el('p', vazio, 'em-estado')); return f; }
        const area = el('div', null, 'em-grafico-area');
        f.appendChild(area);
        f.depois = () => area.appendChild(barrasDeitadas(area, linhas));
        f.appendChild(tabelaEquivalente(cabecalho, tabelaLinhas));
        return f;
    }
    function painelClientes(d) {
        const p = d.periodo, top = Array.isArray(d.top_clientes) ? d.top_clientes : [];
        const linhas = top.map(c => {
            const href = paraCaixa({ categorias: ['cotação'], remetente: c.cliente, de: p.de, ate: p.ate });
            const dica = c.cliente + ': ' + G.numero(c.cotacoes) + (c.cotacoes === 1 ? ' cotação' : ' cotações');
            return { rotulo: c.cliente, href, dica, partes: [{ valor: c.cotacoes, classe: 'em-cat-cotacao', href, dica }] };
        });
        return painelLista('Clientes com mais cotações', 'Domínio do remetente; em e-mail gratuito, o endereço inteiro.', 'Nenhuma cotação no período.',
            linhas, ['Cliente', 'Cotações'], top.map(c => [c.cliente, G.numero(c.cotacoes)]));
    }
    function painelCaixas(d) {
        const cx = Array.isArray(d.caixas) ? d.caixas : [];
        const linhas = cx.map(c => {
            const pend = paraCaixa({ contas: [c.conta], categorias: ['cotação', 'pedido'], estados: ['pendente'] });
            const nome = F.nomeCaixa(c.conta);
            return { rotulo: nome, href: pend, dica: nome + ': ' + G.numero(c.pendentes) + ' pendentes, ' + G.numero(c.atrasados) + ' atrasados',
                partes: [{ valor: c.atrasados, classe: 'em-serie-erro', href: paraCaixa({ contas: [c.conta], atrasados: true }), dica: nome + ': ' + G.numero(c.atrasados) + ' atrasados' },
                    { valor: Math.max(0, c.pendentes - c.atrasados), classe: 'em-serie-destaque', href: pend, dica: nome + ': ' + G.numero(c.pendentes) + ' pendentes' }] };
        });
        const f = painelLista('Caixas por pendentes e atrasados', 'Cotações e pedidos pendentes agora em cada caixa; a parte vermelha são os atrasados.',
            'Nenhuma caixa.', linhas, ['Caixa', 'Pendentes', 'Atrasados', 'Recebidos no período'],
            cx.map(c => [F.nomeCaixa(c.conta), G.numero(c.pendentes), G.numero(c.atrasados), G.numero(c.recebidos)]));
        if (linhas.length) f.insertBefore(legendaFixa([['em-serie-erro', 'atrasados'], ['em-serie-destaque', 'pendentes no prazo']]), f.querySelector('.em-grafico-area'));
        return f;
    }
    // legenda sem liga e desliga, para gráfico de uma barra só com partes
    function legendaFixa(itens) {
        const g = el('div', null, 'em-legenda');
        for (const [classe, nome] of itens) {
            const i = el('span', null, 'em-legenda-item em-legenda-fixa');
            const amostra = el('span', null, 'em-amostra ' + classe);
            amostra.setAttribute('aria-hidden', 'true');
            i.append(amostra, el('span', nome));
            g.appendChild(i);
        }
        return g;
    }
    function painelAmeacas(d, largo) {
        const f = figura('Ameaças por dia', 'Phishing e spam recebidos no período.', largo ? 'em-largo' : '');
        const am = Array.isArray(d.ameacas) ? d.ameacas : [];
        const vol = am.map(a => ({ dia: a.dia, por_categoria: { phishing: a.phishing, spam: a.spam } }));
        if (!vol.some(v => v.por_categoria.phishing > 0 || v.por_categoria.spam > 0)) { f.appendChild(el('p', 'Nenhuma ameaça no período.', 'em-estado')); return f; }
        const series = [{ chave: 'phishing', categorias: ['phishing'] }, { chave: 'spam', categorias: ['spam'] }];
        f.appendChild(legenda('ame:', series, nomeSerie, classeSerie));
        const area = el('div', null, 'em-grafico-area');
        f.appendChild(area);
        f.depois = () => area.appendChild(colunasOuBarras(area, G.empilhar(vol, series, ocultasDe('ame:')), nomeSerie, classeSerie,
            (dia, ch) => paraCaixa({ categorias: [ch], de: dia, ate: dia })));
        f.appendChild(tabelaEquivalente(['Dia', 'Phishing', 'Spam'], am.map(a => [G.diaCurto(a.dia), G.numero(a.phishing), G.numero(a.spam)])));
        return f;
    }
    function numeroPainel(rotulo, valor, href, nota) {
        const a = el(href ? 'a' : 'div', null, 'em-numero');
        if (href) a.href = href;
        a.appendChild(el('strong', valor, 'em-numero-valor'));
        a.appendChild(el('span', rotulo, 'em-numero-rotulo'));
        if (nota) a.appendChild(el('span', nota, 'em-kpi-nota'));
        return a;
    }
    function painelIa(d) {
        const ia = d.ia || {};
        const f = figura('Qualidade da IA', 'Classificações do período corrigidas à mão, e a fila de revisão de agora.');
        const g = el('div', null, 'em-numeros');
        g.appendChild(numeroPainel('corrigidas à mão', typeof ia.pct_corrigidos === 'number' ? G.numero(ia.pct_corrigidos, 1) + '%' : '—', '',
            G.numero(ia.corrigidos) + ' de ' + G.numero(ia.classificados) + ' classificadas no período'));
        g.appendChild(numeroPainel('na fila de revisão', G.numero(ia.revisao), paraCaixa({ revisao: true })));
        f.appendChild(g);
        return f;
    }
    function painelGasto(d) {
        const g = d.gasto;
        const f = figura('Gasto da IA no mês', 'Só administrador. A projeção é linear: o gasto até hoje dividido pelos dias passados, vezes os dias do mês.');
        const uso = g.teto > 0 ? 100 * g.mes_usd / g.teto : 0;
        f.appendChild(numeroPainel('de ' + G.dolar(g.teto) + ' no mês', G.dolar(g.mes_usd), ''));
        const medidor = el('span', null, 'em-medidor' + (uso >= 100 ? ' em-medidor-erro' : uso >= 80 ? ' em-medidor-atencao' : ''));
        medidor.setAttribute('role', 'img');
        medidor.setAttribute('aria-label', G.numero(uso) + '% do teto');
        const v = el('span', null, 'em-medidor-valor');
        v.style.setProperty('--em-largura', Math.min(100, uso).toFixed(1) + '%');   // CSSOM: permitido pela CSP
        medidor.appendChild(v);
        f.appendChild(medidor);
        f.appendChild(el('p', 'Projeção linear para o fim do mês: ' + G.dolar(g.projecao_usd) + (g.projecao_usd > g.teto ? ', acima do teto.' : '.'), 'em-figura-desc'));
        if (d.gasto_mes && d.gasto_mes.pausado) f.appendChild(situacao(false, '', 'Classificação pausada: o teto do mês foi atingido.'));
        const modelos = Array.isArray(g.por_modelo) ? g.por_modelo : [];
        if (modelos.length) f.appendChild(tabelaSimples(['Modelo', 'Gasto no mês'], modelos.map(m => [m.modelo, G.dolar(m.usd)])));
        return f;
    }
    function tabelaAtrasados(d) {
        return tabela('Atrasados', ['Recebido', 'Categoria', 'Remetente', 'Assunto', 'Horas úteis'],
            (d.lista_atrasados || []).map(a => [dataHora(a.data), etiquetaCategoria(a.categoria), a.remetente || '', a.assunto || '', F.decimal(a.horas_uteis)]),
            'em-atrasados', 'Nenhuma cotação ou pedido atrasado.');
    }

    // serviço antigo (sem versao 2): os números de antes, desenhados como antes
    function kpiAntigo(rotulo, valor, alerta) {
        const d = el('div', null, 'em-kpi em-painel' + (alerta ? ' em-kpi-alerta' : ''));
        d.appendChild(el('strong', valor, 'em-kpi-valor'));
        d.appendChild(el('span', rotulo, 'em-kpi-rotulo'));
        return d;
    }
    function montarAntigo(d, alvo) {
        const kpis = el('div', null, 'em-kpis');
        const pend = d.pendentes || {};
        kpis.append(kpiAntigo('cotações pendentes', G.numero(pend['cotação'])), kpiAntigo('pedidos pendentes', G.numero(pend.pedido)),
            kpiAntigo('atrasados (mais de 4 h úteis)', G.numero(d.atrasados), d.atrasados > 0), kpiAntigo('na fila de revisão', G.numero(d.revisao)));
        alvo.appendChild(kpis);
        const linhas = Object.entries(d.hoje_por_categoria || {});
        alvo.appendChild(tabela('Hoje por categoria', ['Categoria', 'E-mails'], linhas.map(([c, n]) => [etiquetaCategoria(c), G.numero(n)]), null, 'Nenhum e-mail hoje.'));
        if (Array.isArray(d.lista_atrasados)) alvo.appendChild(tabelaAtrasados(d));
        if (d.saude) alvo.appendChild(tabelaSaude(d));
    }

    function desenharControlesDash() {
        for (const b of $('em-dash-periodo').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.periodo === dash.periodo));
        $('em-dash-escopo').hidden = !minhas().length;
        for (const b of $('em-dash-escopo').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.escopo === escopoDash()));
    }
    // números contam até o valor; data-contando sai no fim
    let contaVez = 0;
    function contarNumeros(alvo) {
        const nums = [...alvo.querySelectorAll('[data-num]')];
        if (!nums.length || !comMovimento()) return;
        const finais = nums.map(s => s.textContent), dur = tempo('--em-lento') || 240, inicio = performance.now();
        const vez = ++contaVez;
        alvo.dataset.contando = '1';
        const passo = agora => {
            if (vez !== contaVez) return;   // o Dashboard foi redesenhado no meio da contagem
            const t = Math.min(1, (agora - inicio) / dur);
            nums.forEach((s, i) => {
                const casas = Number(s.dataset.casas);
                s.textContent = t < 1 ? G.numero(G.contagem(Number(s.dataset.num), t, casas), casas) + s.dataset.sufixo : finais[i];
            });
            if (t < 1) requestAnimationFrame(passo);
            else delete alvo.dataset.contando;
        };
        requestAnimationFrame(passo);
    }
    // animar: só ao abrir e ao trocar período ou caixas
    function montarDash(ver, animar) {
        const d = dash.d, alvo = $('em-dash-conteudo');
        if (!d) return;
        alvo.classList.toggle('em-animar', !!animar && comMovimento());
        contaVez++;
        delete alvo.dataset.contando;
        const v2 = Q.v2(d) && d.periodo && d.indicadores;
        $('em-dash-versao').hidden = !!v2;
        $('em-dash-estado').textContent = 'Atualizado às ' + new Date(d.gerado_em).toLocaleTimeString('pt-BR', { timeZone: F.FUSO, hour: '2-digit', minute: '2-digit' }) +
            '. Atualiza sozinho a cada 2 minutos.' +
            ((d.deteccao_confiavel || []).length ? '' : ' Nenhuma caixa grava enviados no servidor ainda: o alerta vermelho fica desligado.');
        alvo.replaceChildren();
        if (!v2) montarAntigo(d, alvo);
        else {
            indicadores(d).forEach(g => alvo.appendChild(g));
            const depois = [];
            const grade = el('div', null, 'em-graficos');
            grade.append(painelVolume(d, depois), painelFunil(d), painelIa(d), painelMapa(d), painelClientes(d), painelCaixas(d), painelAmeacas(d, !d.gasto));
            if (d.gasto) grade.appendChild(painelGasto(d));
            alvo.appendChild(grade);
            for (const f of grade.children) if (f.depois) depois.push(f.depois);
            depois.forEach(fn => fn());
            alvo.appendChild(tabelaAtrasados(d));
            if (d.saude) alvo.appendChild(tabelaSaude(d));
            if (animar) contarNumeros(alvo);
        }
        if (ver === 'atrasados' && $('em-atrasados')) { $('em-atrasados').scrollIntoView({ block: 'start' }); $('em-atrasados').focus({ preventScroll: true }); }
    }
    // numa atualização, o que está na tela fica esmaecido até a resposta
    async function carregarDash(ver, auto) {
        desenharControlesDash();
        if (!auto) $('em-dash-estado').textContent = 'Carregando o dashboard…';
        $('em-dash-conteudo').classList.add('em-recarregando');
        const params = { periodo: dash.periodo };
        if (contasDash().length) params.contas = contasDash();
        const r = await pedir('resumo', params);
        if (r.cancelado) return;
        $('em-dash-conteudo').classList.remove('em-recarregando');
        if (!r.sucesso) { $('em-dash-estado').textContent = r.erro || 'Não foi possível carregar o dashboard.'; return; }
        dash.d = r.dados || {};
        dash.em = Date.now();
        contadores(dash.d);
        montarDash(ver, !auto);
    }
    $('em-dash-periodo').addEventListener('click', ev => {
        const b = ev.target.closest('button');
        if (!b || b.dataset.periodo === dash.periodo) return;
        dash.periodo = b.dataset.periodo;
        carregarDash('');
    });
    $('em-dash-escopo').addEventListener('click', ev => {
        const b = ev.target.closest('button');
        if (!b || b.dataset.escopo === escopoDash()) return;
        dash.escopo = b.dataset.escopo;
        carregarDash('');
    });
    // a cada 2 minutos, só com a aba à vista
    const DOIS_MINUTOS = 120000;
    setInterval(() => { if (estado.visao === 'dashboard' && !document.hidden) carregarDash('', true); }, DOIS_MINUTOS);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden && estado.visao === 'dashboard' && Date.now() - dash.em >= DOIS_MINUTOS) carregarDash('', true);
    });
    // os gráficos são desenhados na largura da tela: redesenha quando ela muda
    let esperaLargura = 0, larguraDash = window.innerWidth;
    window.addEventListener('resize', () => {
        clearTimeout(esperaLargura);
        esperaLargura = setTimeout(() => {
            if (window.innerWidth === larguraDash) return;
            larguraDash = window.innerWidth;
            if (estado.visao === 'dashboard') montarDash('');
        }, 200);
    });

    // dica do gráfico: o valor exato, ao passar o mouse e ao focar pelo teclado
    function mostrarPonto(alvo) {
        const t = alvo && alvo.closest ? alvo.closest('[data-ponto]') : null;
        const p = $('em-ponto');
        if (!t) { p.hidden = true; return; }
        p.textContent = t.dataset.ponto;
        p.hidden = false;
        const r = t.getBoundingClientRect();
        const x = Math.min(window.innerWidth - p.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - p.offsetWidth / 2));
        const acima = r.top - p.offsetHeight - 8;
        p.style.setProperty('--em-x', Math.round(x) + 'px');   // CSSOM: permitido pela CSP
        p.style.setProperty('--em-y', Math.round(acima < 8 ? r.bottom + 8 : acima) + 'px');
    }
    $('em-dash').addEventListener('pointerover', ev => mostrarPonto(ev.target));
    $('em-dash').addEventListener('focusin', ev => mostrarPonto(ev.target));
    $('em-dash').addEventListener('pointerout', () => { $('em-ponto').hidden = true; });
    $('em-dash').addEventListener('focusout', () => { $('em-ponto').hidden = true; });
    window.addEventListener('scroll', () => { $('em-ponto').hidden = true; }, true);

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
        if (r.dados.manutencao) alvo.appendChild(tabelaManutencao(r.dados.manutencao));
    }

    // ----- seleção em lote -----
    const idsNaLista = () => [...$('em-lista').querySelectorAll('.em-linha')].map(li => Number(li.dataset.id));
    const linha = id => $('em-lista').querySelector('.em-linha[data-id="' + Number(id) + '"]');
    function desenharSelecao() {
        for (const li of $('em-lista').querySelectorAll('.em-linha')) {
            const marcado = estado.sel.has(Number(li.dataset.id));
            li.classList.toggle('em-selecionado', marcado);
            li.querySelector('.em-sel').checked = marcado;
        }
        const n = estado.sel.size;
        $('em-app').classList.toggle('em-com-selecao', n > 0);
        $('em-lote').hidden = !n;
        $('em-lote-num').textContent = n === 1 ? '1 selecionado' : n.toLocaleString('pt-BR') + ' selecionados';
        desenharAtivos();
    }
    // Shift: do último marcado até este
    function selecionar(id, intervalo, marcar) {
        const ids = intervalo ? A.intervalo(idsNaLista(), estado.ancora, id) : [id];
        for (const x of ids) { if (marcar) estado.sel.add(x); else estado.sel.delete(x); }
        estado.ancora = id;
        desenharSelecao();
    }
    function limparSelecao() {
        estado.sel.clear();
        estado.ancora = null;
        desenharSelecao();
    }
    $('em-lote-limpar').addEventListener('click', () => { limparSelecao(); focoNaLista(); });
    $('em-lote').addEventListener('click', ev => {
        const b = ev.target.closest('[data-lote]');
        if (b) aplicarLote(b.dataset.lote);
    });

    // ----- alterações: o item se atualiza no lugar (posição e seleção ficam) -----
    function atualizarItem(id, mudou) {
        const atual = estado.dados.get(id), velho = linha(id);
        if (!atual) return;
        Object.assign(atual, mudou);
        if (atual.status !== 'pendente') atual.atrasado = false;
        if (!velho) return;
        const foco = velho.contains(document.activeElement) ? (document.activeElement.classList.contains('em-sel') ? '.em-sel' : '.em-item') : '';
        const novo = itemLista(atual);
        velho.replaceWith(novo);
        if (foco) novo.querySelector(foco).focus({ preventScroll: true });
    }
    // o que o detalhe traz e o item da lista mostra
    const doDetalhe = e => ({ status: e.status, categoria: e.categoria, revisao: !!e.revisao, confianca: e.confianca,
        horas_uteis: typeof e.horas_uteis === 'number' ? e.horas_uteis : null });
    const auditoriaDe = d => (d && Array.isArray(d.auditoria) ? d.auditoria.filter(Number.isSafeInteger) : []);
    const ROTULO_STATUS = { pendente: 'pendente', respondido: 'respondido', arquivado: 'arquivado' };

    async function alterar(acao, params) {
        const copia = estado.dados.has(params.id) ? Object.assign({}, estado.dados.get(params.id)) : null;
        const r = await pedir(acao, params);
        if (r.cancelado) return;
        if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível salvar.', null, true); return; }
        const e = r.dados;
        atualizarItem(e.id, doDetalhe(e));
        if (estado.idAberto === e.id) mostrarDetalhe(e);
        atualizarContadores();
        const ids = auditoriaDe(e);
        const texto = acao === 'status' ? 'Status alterado para ' + (ROTULO_STATUS[e.status] || e.status) + '.' : 'Categoria corrigida para ' + F.categoria(e.categoria).nome + '.';
        avisoFlutuante(texto, ids.length ? () => desfazer(ids, new Map(copia ? ids.map(a => [a, copia]) : []), [e.id]) : null);
    }

    const FRASE_LOTE = { respondido: 'marcados como respondidos', arquivado: 'arquivados', pendente: 'de volta a pendente' };
    // até 100 por pedido, um pedido depois do outro
    async function aplicarLote(status) {
        const ids = idsNaLista().filter(id => estado.sel.has(id));
        if (!ids.length || !FRASE_LOTE[status]) return;
        const antes = new Map(), auditoria = [];
        let feitos = 0, falhas = 0, erro = '';
        for (const parte of A.partes(ids)) {
            const r = await pedir('lote', { itens: parte.map(id => ({ id, status })) });
            if (r.cancelado) return;
            if (!r.sucesso) { erro = r.erro || 'Não foi possível alterar os e-mails.'; break; }
            const falhou = new Set(Array.isArray(r.dados.falhas) ? r.dados.falhas : []);
            const aud = auditoriaDe(r.dados);
            // uma linha de auditoria por e-mail alterado, na ordem do pedido
            parte.filter(id => !falhou.has(id)).forEach((id, i) => {
                if (aud[i] !== undefined) { antes.set(aud[i], Object.assign({}, estado.dados.get(id))); auditoria.push(aud[i]); }
                atualizarItem(id, { status });
                feitos++;
            });
            falhas += falhou.size;
        }
        atualizarContadores();
        if (estado.idAberto !== null && ids.includes(estado.idAberto)) recarregarDetalhe();
        const texto = (feitos === 1 ? '1 e-mail ' + FRASE_LOTE[status].replace(/s\b/g, '') : feitos + ' e-mails ' + FRASE_LOTE[status]) + '.' +
            (falhas ? ' ' + falhas + ' não puderam ser alterados.' : '') + (erro ? ' ' + erro : '');
        avisoFlutuante(texto, auditoria.length ? () => desfazer(auditoria, antes, ids) : null, !!erro || falhas > 0);
    }

    // desfaz pelos ids de auditoria recebidos; o serviço decide e restaura o estado guardado
    async function desfazer(auditoria, antes, ids) {
        let feitos = 0;
        const recusados = new Set();
        for (const parte of A.partes(auditoria)) {
            const r = await pedir('desfazer', { auditoria: parte });
            if (r.cancelado) return;
            if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível desfazer.', null, true); return; }
            feitos += Number.isSafeInteger(r.dados.desfeitos) ? r.dados.desfeitos : 0;
            for (const x of Array.isArray(r.dados.recusados) ? r.dados.recusados : []) recusados.add(x);
        }
        for (const [aud, item] of antes) if (!recusados.has(aud)) atualizarItem(item.id, item);
        avisoFlutuante(A.desfeito(feitos, recusados.size), null, recusados.size > 0);
        atualizarContadores();
        if (estado.idAberto !== null && ids.includes(estado.idAberto)) recarregarDetalhe();
    }

    // ----- detalhe -----
    async function abrir(id) {
        estado.idAberto = id;
        for (const b of $('em-lista').querySelectorAll('.em-item')) b.classList.toggle('em-ativo', Number(b.dataset.id) === id);
        // abrir desliza da direita; trocar de e-mail com o detalhe já aberto só esmaece
        const fechado = $('em-detalhe').hidden;
        $('em-detalhe').hidden = false;
        animar($('em-detalhe'), fechado ? 'em-abrindo' : 'em-trocando');
        $('em-app').classList.add('em-com-detalhe');
        fecharMenus();
        $('em-assunto').textContent = 'Carregando…';
        for (const x of ['em-meta', 'em-avisos', 'em-anexos', 'em-historico', 'em-do-remetente']) $(x).replaceChildren();
        for (const x of ['em-avatar', 'em-rem-nome', 'em-rem-email', 'em-quando', 'em-status-atual', 'em-corpo']) $(x).textContent = '';
        $('em-controle').hidden = true; $('em-ia').hidden = true; $('em-outros').hidden = true;
        estado.aberto = null;
        mostrarTexto();
        $('em-assunto').focus({ preventScroll: true });
        const r = await pedir('detalhe', { id });
        if (r.cancelado || estado.idAberto !== id) return;
        if (!r.sucesso) { $('em-assunto').textContent = r.erro || 'Não foi possível abrir o e-mail.'; return; }
        mostrarDetalhe(r.dados);
        atualizarItem(id, doDetalhe(r.dados));
    }
    async function recarregarDetalhe() {
        const id = estado.idAberto;
        const r = await pedir('detalhe', { id });
        if (r.cancelado || !r.sucesso || estado.idAberto !== id) return;
        mostrarDetalhe(r.dados);
        atualizarItem(id, doDetalhe(r.dados));
    }
    function fecharDetalhe() {
        const id = estado.idAberto;
        estado.aberto = null; estado.idAberto = null;
        mostrarTexto();
        fecharMenus();
        $('em-detalhe').hidden = true;
        $('em-app').classList.remove('em-com-detalhe');
        for (const b of $('em-lista').querySelectorAll('.em-item.em-ativo')) b.classList.remove('em-ativo');
        const item = id !== null && linha(id);
        if (item) item.querySelector('.em-item').focus();
        else $('em-lista').focus();
    }
    // o foco nunca fica perdido: volta ao e-mail aberto na lista, ou à lista
    function focoNaLista() {
        const item = estado.idAberto !== null && linha(estado.idAberto);
        if (item) item.querySelector('.em-item').focus({ preventScroll: true });
        else $('em-lista').focus({ preventScroll: true });
    }
    $('em-fechar-detalhe').addEventListener('click', fecharDetalhe);
    $('em-voltar').addEventListener('click', fecharDetalhe);

    function aviso(texto, forte) {
        const d = el('div', null, 'em-aviso' + (forte ? ' em-aviso-forte' : ''));
        d.appendChild(icone('alerta', 'em-ic-p'));
        d.appendChild(el('p', texto));
        return d;
    }
    function controles(e) {
        $('em-controle').hidden = false;
        for (const b of $('em-status').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.status === e.status));
        const c = F.categoria(e.categoria);
        const botaoCat = $('em-categoria-botao');
        botaoCat.className = 'em-categoria-botao ' + c.classe;
        botaoCat.replaceChildren(etiquetaCategoria(e.categoria), icone('abrir-lista', 'em-ic-p'));
        botaoCat.setAttribute('aria-label', 'Categoria: ' + c.nome + '. Corrigir a categoria');
        // só as 9 de correção manual são opção; a de regra só aparece no botão
        $('em-categorias').replaceChildren(...F.CORRIGIVEIS.map(nome => {
            const k = F.categoria(nome);
            const b = botao(null, 'em-cat-opcao ' + k.classe);
            b.dataset.categoria = nome;
            b.setAttribute('aria-pressed', String(nome === e.categoria));
            b.append(icone(k.icone), el('span', k.nome));
            if (nome === e.categoria) b.appendChild(icone('conferir', 'em-ic-p em-cat-atual'));
            return b;
        }));
        $('em-status-atual').textContent = 'Status ' + (e.status || '—') + (e.status_por ? ', por ' + e.status_por : '') +
            (e.status_em ? ' em ' + dataHora(e.status_em) : '') +
            (e.categoria_original && e.categoria_original !== e.categoria ? '. Categoria original da IA: ' + e.categoria_original : '') + '.';
    }
    function focarCategoria(passo) {
        const ops = [...$('em-categorias').querySelectorAll('button')];
        if (!ops.length) return;
        const i = ops.indexOf(document.activeElement);
        const atual = i < 0 ? Math.max(0, ops.findIndex(b => b.getAttribute('aria-pressed') === 'true')) : i;
        ops[i < 0 ? atual : (atual + passo + ops.length) % ops.length].focus();
    }
    $('em-categorias').addEventListener('keydown', ev => {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); focarCategoria(ev.key === 'ArrowDown' ? 1 : -1); }
    });
    $('em-categorias').addEventListener('click', ev => {
        const b = ev.target.closest('[data-categoria]');
        const e = estado.aberto;
        if (!b || !e) return;
        fecharMenus();
        $('em-categoria-botao').focus();
        if (b.dataset.categoria !== e.categoria) alterar('categoria', { id: e.id, categoria: b.dataset.categoria });
    });
    $('em-status').addEventListener('click', ev => {
        const b = ev.target.closest('[data-status]');
        const e = estado.aberto;
        if (b && e && b.dataset.status !== e.status) alterar('status', { id: e.id, status: b.dataset.status });
    });

    function cartaoIa(e) {
        const pct = A.percentual(e.confianca);
        $('em-ia').hidden = !e.resumo && pct === null && !e.motivo;
        $('em-ia').classList.toggle('em-ia-baixa', !!e.revisao);
        $('em-ia-resumo').textContent = e.resumo || 'Sem resumo.';
        $('em-ia-confianca').hidden = pct === null;
        if (pct !== null) {
            $('em-ia-barra').style.setProperty('--em-largura', pct + '%');   // CSSOM: permitido pela CSP
            $('em-ia-pct').textContent = 'confiança ' + pct + '%';
        }
        $('em-ia-motivo').textContent = e.motivo || '';
        $('em-ia-revisao').hidden = !e.revisao;
    }
    function listaAnexos(e) {
        const anexos = $('em-anexos');
        if (!(e.anexos || []).length) return;
        anexos.appendChild(el('h3', 'Anexos', 'em-secao'));
        const ul = el('ul');
        for (const a of e.anexos) {
            const li = el('li');
            const nome = el('span', null, 'em-anexo-nome');
            nome.appendChild(icone('anexo', 'em-ic-p'));
            nome.appendChild(el('span', a.nome || 'anexo sem nome'));
            const tipo = typeof a.tipo === 'string' ? a.tipo.split('/').pop().slice(0, 24) : '';
            nome.appendChild(el('span', [tipo, tamanho(a.tamanho)].filter(Boolean).join(', '), 'em-anexo-tamanho em-num'));
            li.appendChild(nome);
            const b = botao(null, 'em-botao em-secundario');
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
    function linhaDoTempo(e) {
        $('em-historico').replaceChildren(...A.historico(e).map(h => {
            const li = el('li', null, 'em-hist');
            li.appendChild(el('span', h.texto, 'em-hist-texto'));
            li.appendChild(el('span', dataHora(h.em) + (h.quem === 'IA' ? ', pela IA' : h.quem ? ', por ' + h.quem : ''), 'em-hist-sub em-num'));
            return li;
        }));
    }
    function doRemetente(e) {
        const lista = Array.isArray(e.do_remetente) ? e.do_remetente.filter(o => o && Number.isSafeInteger(o.id)) : [];
        $('em-outros').hidden = !lista.length;
        $('em-do-remetente').replaceChildren(...lista.map(o => {
            const li = el('li');
            const b = botao(null, 'em-outro');
            const topo = el('span', null, 'em-outro-topo');
            topo.appendChild(el('span', dataHora(o.data), 'em-data em-num'));
            if (o.status && o.status !== 'pendente') topo.appendChild(el('span', o.status, 'em-st-texto'));
            b.appendChild(topo);
            b.appendChild(el('span', o.assunto || '(sem assunto)', 'em-assunto-linha'));
            b.appendChild(etiquetaCategoria(o.categoria));
            b.addEventListener('click', () => abrir(o.id));
            li.appendChild(b);
            return li;
        }));
    }
    function mostrarDetalhe(e) {
        $('em-meta').replaceChildren(); $('em-avisos').replaceChildren(); $('em-anexos').replaceChildren();
        const trocou = !estado.aberto || estado.aberto.id !== e.id;
        estado.aberto = e;
        estado.idAberto = e.id;
        if (trocou) mostrarTexto();
        const nome = e.remetente_nome || '';
        $('em-avatar').textContent = A.iniciais(nome, e.remetente);
        $('em-rem-nome').textContent = nome || e.remetente || '(sem remetente)';
        $('em-rem-email').textContent = nome && e.remetente ? e.remetente : '';
        $('em-copiar-email').hidden = !e.remetente;
        const rel = A.relativa(e.data);
        $('em-quando').textContent = (A.porExtenso(e.data) || dataHora(e.data)) + (rel ? ', ' + rel : '');
        $('em-assunto').textContent = e.assunto || '(sem assunto)';
        meta('Para', e.destinatarios);
        if (e.cc) meta('Cc', e.cc);
        meta('Caixas', (e.ocorrencias || []).map(o => F.nomeCaixa(o.conta) + ' / ' + o.pasta + (o.removida_em ? ' (removido)' : '')).join('; '));
        meta('Autenticação', `SPF ${e.spf || 'ausente'}, DKIM ${e.dkim || 'ausente'}`);
        const avisos = $('em-avisos');
        if (e.categoria === 'phishing') avisos.appendChild(aviso('Possível golpe (phishing): não abra links, não responda e não baixe anexos. Avise o responsável pela segurança.', true));
        else if (e.categoria === 'spam') avisos.appendChild(aviso('Classificado como spam: não abra links e não responda. Anexos bloqueados.', true));
        if (e.removido) avisos.appendChild(aviso('Este e-mail foi apagado ou movido em todas as caixas. A central guarda a cópia.'));
        controles(e);
        cartaoIa(e);
        listaAnexos(e);
        if (e.corpo_oculto) $('em-corpo').textContent = 'Corpo oculto: este e-mail traz código de acesso ou senha e não é exibido na central.';
        else $('em-corpo').textContent = e.corpo_texto || '(e-mail sem texto)';
        if (!$('em-html').hidden) $('em-ver-html').hidden = true;
        else $('em-ver-html').hidden = !e.tem_html || e.corpo_oculto;
        linhaDoTempo(e);
        doRemetente(e);
    }

    async function copiar(texto, oQue) {
        try {
            await navigator.clipboard.writeText(texto);
            avisoFlutuante(oQue + ' copiado.');
        } catch (erro) {
            avisoFlutuante('Não foi possível copiar. Selecione o texto e use Ctrl+C.', null, true);
        }
    }
    $('em-copiar-email').addEventListener('click', () => { if (estado.aberto) copiar(estado.aberto.remetente || '', 'Endereço'); });
    $('em-copiar-assunto').addEventListener('click', () => { if (estado.aberto) copiar(estado.aberto.assunto || '', 'Assunto'); });

    async function baixar(id, anexo, botaoAnexo, rotulo) {
        botaoAnexo.disabled = true;
        const texto = rotulo.textContent;
        rotulo.textContent = 'Baixando…';
        const r = await pedir('anexo', { id, anexo });
        botaoAnexo.disabled = false;
        rotulo.textContent = texto;
        if (r.cancelado) return;
        if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível baixar o anexo.', null, true); return; }
        const url = r.dados && r.dados.url;
        if (typeof url === 'string' && /^\/emails\/anexo\/[0-9a-f]{64}$/.test(url)) window.location.assign(url);
    }

    // versão formatada: o portal entrega o documento por um endereço de uso único, com CSP própria e fechada
    // (sem script, sem rede); o iframe continua com sandbox="" (sem scripts e sem mesma origem)
    async function verHtml() {
        const e = estado.aberto;
        if (!e) return;
        const r = await pedir('html', { id: e.id });
        if (r.cancelado || estado.aberto !== e) return;   // outro e-mail foi aberto enquanto esperava
        const url = r.sucesso && r.dados && r.dados.url;
        if (typeof url !== 'string' || !/^\/emails\/html\/[0-9a-f]{64}$/.test(url)) {
            avisoFlutuante(r.erro || 'Não foi possível abrir a versão formatada.', null, true);
            return;
        }
        const quadro = $('em-html');
        quadro.setAttribute('sandbox', '');   // reforço: sem allow-scripts e sem allow-same-origin
        quadro.src = url;
        quadro.hidden = false;
        $('em-corpo').hidden = true;
        $('em-ver-html').hidden = true;
        $('em-ver-texto').hidden = false;
    }
    function mostrarTexto() {
        const quadro = $('em-html');
        if (quadro.getAttribute('src')) quadro.src = 'about:blank';
        quadro.hidden = true;
        $('em-corpo').hidden = false;
        $('em-ver-texto').hidden = true;
        $('em-ver-html').hidden = !(estado.aberto && estado.aberto.tem_html && !estado.aberto.corpo_oculto);
    }

    // ----- coluna do detalhe: arraste ou setas no divisor; a largura fica no aparelho -----
    const LARGURA = 'emails_largura_detalhe';
    function ocupado() {
        const app = $('em-app');
        const vao = parseFloat(getComputedStyle(app).columnGap) || 12;
        const filtros = getComputedStyle($('em-filtros')).display !== 'none' ? $('em-filtros').offsetWidth + vao : 0;
        return filtros + vao;
    }
    const larguraAtual = () => (estado.idAberto !== null ? $('em-detalhe') : $('em-detalhe-vazio')).offsetWidth;
    function aplicarLargura(px, gravar) {
        if (estreito.matches) return;
        const total = $('em-app').clientWidth, outros = ocupado();
        const w = A.largura(px, total, outros);
        if (w === null) return;
        $('em-app').style.setProperty('--em-detalhe', w + 'px');   // CSSOM: permitido pela CSP
        $('em-app').classList.add('em-largura-fixa');
        const d = $('em-divisor');
        d.setAttribute('aria-valuenow', String(w));
        d.setAttribute('aria-valuemax', String(A.largura(1e6, total, outros)));
        if (gravar) local(LARGURA, String(w));
    }
    const divisor = $('em-divisor');
    divisor.addEventListener('pointerdown', ev => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        divisor.setPointerCapture(ev.pointerId);
        divisor.classList.add('em-arrastando');
    });
    divisor.addEventListener('pointermove', ev => {
        if (divisor.hasPointerCapture(ev.pointerId)) aplicarLargura($('em-app').getBoundingClientRect().right - ev.clientX, false);
    });
    function soltar(ev) {
        if (!divisor.hasPointerCapture(ev.pointerId)) return;
        divisor.releasePointerCapture(ev.pointerId);
        divisor.classList.remove('em-arrastando');
        if ($('em-app').classList.contains('em-largura-fixa')) local(LARGURA, divisor.getAttribute('aria-valuenow'));
    }
    divisor.addEventListener('pointerup', soltar);
    divisor.addEventListener('pointercancel', soltar);
    // seta para a esquerda alarga o detalhe (o divisor anda para a esquerda); Shift anda mais
    divisor.addEventListener('keydown', ev => {
        const passo = ev.shiftKey ? 64 : 16;
        const alvo = { ArrowLeft: larguraAtual() + passo, ArrowRight: larguraAtual() - passo, Home: 0, End: 1e6 }[ev.key];
        if (alvo === undefined) return;
        ev.preventDefault();
        aplicarLargura(alvo, true);
    });
    function larguraGuardada() {
        const w = Number(local(LARGURA));
        if (w > 0) aplicarLargura(w, false);
        else divisor.setAttribute('aria-valuenow', String(larguraAtual()));
    }
    window.addEventListener('resize', () => { if ($('em-app').classList.contains('em-largura-fixa')) larguraGuardada(); });

    // ----- atalhos (seção 8): fora de campo de texto e sem Ctrl, Alt ou Meta -----
    function itemFocado() {
        const li = document.activeElement && document.activeElement.closest ? document.activeElement.closest('#em-lista .em-linha') : null;
        return li ? Number(li.dataset.id) : null;
    }
    function mover(passo) {
        const itens = [...$('em-lista').querySelectorAll('.em-item')];
        if (!itens.length) return;
        let i = itens.indexOf(document.activeElement);
        if (i < 0 && estado.idAberto !== null) i = itens.findIndex(b => Number(b.dataset.id) === estado.idAberto);
        itens[i < 0 ? 0 : Math.max(0, Math.min(itens.length - 1, i + passo))].focus();
    }
    // r e e: na seleção; senão no e-mail focado; senão no aberto
    function marcarPorAtalho(status) {
        if (estado.sel.size) return aplicarLote(status);
        const id = itemFocado() !== null ? itemFocado() : estado.idAberto;
        if (id === null) return undefined;
        const atual = estado.dados.get(id) || estado.aberto;
        if (atual && atual.status === status) return avisoFlutuante('Este e-mail já está ' + status + '.');
        return alterar('status', { id, status });
    }
    function abrirAjuda() {
        fecharMenus();
        const volta = document.activeElement;
        const ajuda = $('em-ajuda');
        ajuda.addEventListener('close', () => { if (volta && volta.isConnected && volta !== document.body) volta.focus(); else focoNaLista(); }, { once: true });
        ajuda.showModal();
    }
    $('em-abrir-ajuda').addEventListener('click', abrirAjuda);
    $('em-fechar-ajuda').addEventListener('click', () => $('em-ajuda').close());
    document.addEventListener('keydown', ev => {
        if (ev.ctrlKey || ev.metaKey || ev.altKey || estado.bloqueado || ev.defaultPrevented) return;
        if (emCampo(ev.target) || $('em-ajuda').open) return;
        if (ev.key === '?') { ev.preventDefault(); abrirAjuda(); return; }
        if (estado.visao !== 'caixa' || MENUS.some(([, m]) => !$(m).hidden)) return;
        const acao = { j: () => mover(1), k: () => mover(-1), r: () => marcarPorAtalho('respondido'), e: () => marcarPorAtalho('arquivado'),
            f: () => modoFoco(!emFoco()),
            x: () => {
                const id = itemFocado() !== null ? itemFocado() : estado.idAberto;
                if (id !== null && estado.dados.has(id)) selecionar(id, ev.shiftKey, !estado.sel.has(id));
            } }[ev.key.toLowerCase()];
        if (!acao || (ev.shiftKey && ev.key.toLowerCase() !== 'x')) return;
        ev.preventDefault();
        acao();
    });

    // ----- exportar para Excel (seção 8): até 2.000 linhas, tudo texto, sem corpo -----
    // o exceljs (quase 1 MB) só carrega no primeiro clique, do próprio portal: a CSP não muda
    let excel = null, exportacao = null;
    function carregarExcel() {
        if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
        if (!excel) {
            excel = new Promise((ok, falha) => {
                const s = document.createElement('script');
                s.src = '/vendor/exceljs-4.4.0.min.js';
                s.onload = () => (window.ExcelJS ? ok(window.ExcelJS) : falha(new Error('exceljs')));
                s.onerror = () => { excel = null; s.remove(); falha(new Error('exceljs')); };
                document.head.appendChild(s);
            });
        }
        return excel;
    }
    const milhar = n => n.toLocaleString('pt-BR');
    function progresso(texto, feito) {
        $('em-exportar-texto').textContent = texto;
        $('em-exportar-barra').value = feito;
    }
    function fimExportar(minha) {
        if (exportacao !== minha) return;
        exportacao = null;
        $('em-exportando').hidden = true;
        $('em-exportar').disabled = !estado.itens;
    }
    async function exportar() {
        if (exportacao) return;
        const minha = exportacao = { cancelado: false };
        const filtro = Q.params(estado.filtro);
        $('em-exportando').hidden = false;
        $('em-exportar').disabled = true;
        progresso('Preparando a exportação…', 0);
        const carregando = carregarExcel();
        carregando.catch(() => {});   // a falha é tratada abaixo, quando a planilha for montada
        try {
            const linhas = [];
            let cursor = '', total = 0;
            do {
                // grupo próprio: buscar as páginas não cancela a lista que está na tela
                const r = await pedir('listar', Object.assign({}, filtro, { cursor }), 'exportar');
                if (minha.cancelado || r.cancelado) return;
                if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível exportar a lista.', null, true); return; }
                const d = r.dados || {};
                if (!cursor && Number.isFinite(d.total)) total = d.total;
                for (const e of Array.isArray(d.itens) ? d.itens : []) if (linhas.length < A.MAX_EXPORTAR) linhas.push(A.linhaPlanilha(e));
                cursor = d.proximo || '';
                total = Math.max(total, linhas.length);
                const alvo = Math.min(total, A.MAX_EXPORTAR);
                progresso(total > A.MAX_EXPORTAR ? 'Buscando os primeiros 2.000 de ' + milhar(total) + ' e-mails: ' + milhar(linhas.length)
                    : 'Buscando e-mails: ' + milhar(linhas.length) + ' de ' + milhar(alvo), alvo ? linhas.length / alvo : 1);
            } while (cursor && linhas.length < A.MAX_EXPORTAR);
            if (!linhas.length) { avisoFlutuante('Nenhum e-mail para exportar com esses filtros.'); return; }
            progresso('Montando a planilha…', 1);
            const ExcelJS = await carregando;
            if (minha.cancelado) return;
            const livro = new ExcelJS.Workbook();
            const folha = livro.addWorksheet('E-mails', { views: [{ state: 'frozen', ySplit: 1 }] });
            const larguras = [17, 32, 24, 48, 16, 12, 24, 10, 12, 60];
            folha.columns = A.COLUNAS_PLANILHA.map((titulo, i) => ({ header: titulo, width: larguras[i], style: { numFmt: '@' } }));
            folha.getRow(1).font = { bold: true };
            // valor como string: o exceljs só grava fórmula de { formula }
            for (const l of linhas) folha.addRow(l);
            const blob = new Blob([await livro.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            if (minha.cancelado) return;
            const url = URL.createObjectURL(blob);
            const a = el('a');
            a.href = url;
            a.download = 'emails-' + hoje() + '.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            avisoFlutuante(total > A.MAX_EXPORTAR ? 'Planilha com os primeiros 2.000 de ' + milhar(total) + ' e-mails. Refine o filtro para exportar o resto.'
                : 'Planilha com ' + (linhas.length === 1 ? '1 e-mail' : milhar(linhas.length) + ' e-mails') + ' baixada.');
        } catch (erro) {
            if (!minha.cancelado) avisoFlutuante('Não foi possível montar a planilha. Tente de novo.', null, true);
        } finally {
            fimExportar(minha);
        }
    }
    $('em-exportar').addEventListener('click', exportar);
    $('em-exportar-cancelar').addEventListener('click', () => {
        const minha = exportacao;
        if (!minha) return;
        minha.cancelado = true;
        cancelarPedidos('exportar');
        fimExportar(minha);
        avisoFlutuante('Exportação cancelada.');
        $('em-exportar').focus();
    });

    $('em-mais').addEventListener('click', () => listar(true));
    $('em-tentar').addEventListener('click', () => listar(estado.itens > 0 && !!estado.proximo));
    $('em-recarregar').addEventListener('click', () => { estado.idsAntes = new Set(estado.dados.keys()); listar(false); });
    $('em-ver-html').addEventListener('click', verHtml);
    $('em-ver-texto').addEventListener('click', mostrarTexto);
    larguraGuardada();
    mostrarVisao();
})();
