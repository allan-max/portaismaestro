/* Central de E-mails: casca (cabeçalho, trilho, visões), caixa unificada e detalhe. Dashboard, Saúde das caixas,
   gestão dos filtros salvos e exportação ficam em arquivos próprios, carregados na primeira vez que abrem (PARTES).
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
        idAberto: null, sel: new Set(), ancora: null, dados: new Map(), retomar: null, caiu: false };
    const CANCELADO = { sucesso: false, cancelado: true };
    const ESCRITAS = new Set(['status', 'categoria', 'lote', 'desfazer', 'comentar', 'apagar_comentario']);
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
    // avisos flutuantes: pilha de até 3, cada um com o seu prazo e o seu "Desfazer" (5 s; sem ele, 4 s).
    // O quarto tira o mais velho. O prazo de todos para enquanto o foco está na pilha.
    const pilha = $('em-aviso-flutuante'), prazos = new Map();
    const prazo = a => { clearTimeout(prazos.get(a)); prazos.set(a, setTimeout(() => esconderAviso(a), a.querySelector('.em-desfazer') ? 5000 : 4000)); };
    function esconderAviso(a) {
        clearTimeout(prazos.get(a));
        if (!prazos.delete(a)) return;   // já saiu
        if (a.contains(document.activeElement)) focoNaLista();
        const fim = () => { a.remove(); pilha.hidden = !pilha.childElementCount; };
        if (!comMovimento()) return fim();
        a.classList.add('em-sumindo');   // sobe ao entrar e desce ao sair
        a.addEventListener('animationend', fim, { once: true });
    }
    // `erro`: true é falha (ícone de alerta); 'neutro' é só informação (sem ícone); senão, deu certo
    function avisoFlutuante(texto, aoDesfazer, erro) {
        const a = el('div', null, 'em-aviso-item');
        if (erro !== 'neutro') a.appendChild(icone(erro ? 'alerta' : 'conferir', 'em-ic-p ' + (erro ? 'em-ruim' : 'em-ok')));
        a.appendChild(el('span', texto));
        if (aoDesfazer) {
            const b = botao('Desfazer', 'em-botao em-secundario em-desfazer');
            b.addEventListener('click', () => { esconderAviso(a); aoDesfazer(); });
            a.appendChild(b);
        }
        pilha.appendChild(a);
        pilha.hidden = false;
        prazo(a);
        const vivos = [...prazos.keys()];
        if (vivos.length > 3) esconderAviso(vivos[0]);
    }
    pilha.addEventListener('focusin', () => prazos.forEach(clearTimeout));
    pilha.addEventListener('focusout', () => prazos.forEach((_t, a) => prazo(a)));
    function telaAcesso(titulo, texto) {
        estado.bloqueado = true;
        for (const id of ['em-app', 'em-dash', 'em-saude', 'em-aberturas', 'em-filtros-salvos', 'em-trilho', 'em-busca-global', 'em-abrir-busca', 'em-sino']) $(id).hidden = true;
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
    $('em-ir-aberturas').hidden = !admin;

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
        } else if (estado.retomar !== null) listar(estado.retomar);   // a conexão caiu com a lista carregando: pede de novo
        else if (!estado.itens && estado.visao === 'caixa') listar(false);
        else if (estado.caiu && estado.listou && !estado.carregando) avisar(contagem());   // tira o "Conexão perdida"
        // o e-mail aberto durante a queda ficou em "Carregando…": pede de novo
        if (estado.caiu && estado.idAberto !== null && !estado.aberto) abrir(estado.idAberto);
        estado.caiu = false;
        if (estado.visao === 'caixa' || estado.visao === 'filtros') atualizarContadores();
    });
    socket.on('connect_error', () => { estado.caiu = true; aoVivo('reconectando'); avisar('Sem conexão com o Maestro. Tentando de novo…'); });
    socket.on('disconnect', () => {
        estado.caiu = true;
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
        const ir = () => filtrar(Object.assign({}, estado.filtro, { busca }), estado.visao === 'caixa');
        // no celular o e-mail aberto cobre a lista: fecha antes (sem tirar o foco do campo) e espera o histórico voltar
        if (estreito.matches && estado.idAberto !== null) {
            const voltar = comEntrada && noHistorico();
            fecharDetalhe(false);
            if (voltar) { window.addEventListener('popstate', ir, { once: true }); return; }
        }
        ir();
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
    const ITENS_TRILHO = { caixa: 'em-ir-caixa', dashboard: 'em-ir-dash', revisao: 'em-ir-revisao', atrasados: 'em-ir-atrasados', filtros: 'em-ir-filtros', saude: 'em-ir-saude',
        aberturas: 'em-ir-aberturas' };
    const minhas = () => estado.prefs.minhas_caixas || [];
    // minhas caixas e "Sem ruído" guardados são o padrão: ficam fora do endereço
    const paraHash = f => Q.paraHash(f, minhas(), estado.prefs.sem_ruido);
    const deHash = h => Q.deHash(h, minhas(), estado.prefs.sem_ruido);
    function mostrarVisao() {
        if (estado.bloqueado) return;
        const r = F.rota(location.hash);
        if ((r.visao === 'saude' || r.visao === 'aberturas') && !admin) r.visao = 'caixa';
        estado.visao = r.visao;
        if (r.visao !== 'caixa' && emFoco()) modoFoco(false);   // sem trilho não haveria como voltar
        $('em-app').hidden = r.visao !== 'caixa';
        $('em-dash').hidden = r.visao !== 'dashboard';
        $('em-saude').hidden = r.visao !== 'saude';
        $('em-aberturas').hidden = r.visao !== 'aberturas';
        $('em-filtros-salvos').hidden = r.visao !== 'filtros';
        let item = r.ver || r.visao;
        if (r.visao === 'caixa') {
            const f = deHash(location.hash);
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
        if (r.visao !== 'caixa') abrirVisao(r.visao, r.ver);
    }
    window.addEventListener('hashchange', mostrarVisao);
    // clique na visão já aberta: aplica de novo
    $('em-trilho').addEventListener('click', ev => {
        const a = ev.target.closest('a');
        if (a && a.getAttribute('href') === location.hash) mostrarVisao();
    });

    // o filtro vai para o endereço, e o endereço manda listar
    function filtrar(f, substituir) {
        const hash = paraHash(f);
        if (estado.visao === 'caixa' && location.hash === hash) {
            if (!Q.igual(f, estado.filtro)) { estado.filtro = Q.normalizar(f); listar(false); desenharFiltros(); }
            return;
        }
        if (substituir) { history.replaceState(null, '', hash); mostrarVisao(); }
        else location.hash = hash;
    }
    const padrao = () => deHash('#caixa');

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
        case 'sem-ruido': {
            // a escolha vira a preferência: a próxima abertura da Caixa já vem assim
            const sem_ruido = !f.sem_ruido;
            estado.prefs = Object.assign({}, estado.prefs, { sem_ruido });
            salvarPreferencias({ sem_ruido }, 'em-salvar-estado');
            return filtrar(Object.assign({}, f, { sem_ruido }));
        }
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
        history.replaceState(null, '', paraHash(estado.filtro));
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
        // cotação e pedido pendentes que ninguém abriu; `aberto` null (antes do registro) ou ausente (serviço antigo) não marca
        if (e.aberto === false && st === 'pendente' && ['cotação', 'pedido'].includes(e.categoria)) {
            const m = el('span', null, 'em-item-anexos em-nao-aberto');
            m.appendChild(icone('olho', 'em-ic-p'));
            m.appendChild(el('span', 'ninguém abriu'));
            rodape.appendChild(m);
        }
        if (Number.isSafeInteger(e.comentarios) && e.comentarios > 0) {
            const c = el('span', null, 'em-item-anexos');
            c.appendChild(icone('comentario', 'em-ic-p'));
            c.appendChild(el('span', String(e.comentarios), 'em-num'));
            c.appendChild(el('span', e.comentarios === 1 ? ' comentário' : ' comentários', 'em-sr'));
            rodape.appendChild(c);
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

    const contagem = () => {
        const total = Math.max(estado.total, estado.itens);
        return estado.itens ? (total === 1 ? '1 e-mail' : total.toLocaleString('pt-BR') + ' e-mails') : '0 e-mails';
    };
    async function listar(mais) {
        const meu = ++estado.seqLista;
        estado.retomar = null;
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
        // a conexão caiu no meio: a lista segue carregando e o connect pede de novo
        if (r.cancelado) { estado.retomar = !!mais; return; }
        estado.carregando = false;
        $('em-lista').setAttribute('aria-busy', 'false');
        $('em-lista').querySelectorAll('.em-esqueleto-item').forEach(x => x.remove());
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
        avisar(contagem());   // o estado vazio diz o resto
        $('em-exportar').disabled = !estado.itens || !$('em-exportando').hidden;   // exportação em andamento
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
    // no celular o e-mail aberto ganha uma entrada no histórico: o voltar do aparelho fecha o e-mail, sem mexer no filtro
    // (trocar o filtro muda location.hash, que também dispara popstate: só fecha quem saiu da entrada do e-mail)
    const noHistorico = () => !!(history.state && history.state.detalhe);
    let comEntrada = false;
    window.addEventListener('popstate', () => { if (comEntrada && !noHistorico()) fecharDetalhe(); });
    // o que fica escondido quando o e-mail não abre (vazio, só confundiria)
    const soComDados = () => [document.querySelector('.em-cabeca'), $('em-copiar-assunto'), $('em-historico').parentElement];
    async function abrir(id) {
        estado.idAberto = id;
        for (const b of $('em-lista').querySelectorAll('.em-item')) b.classList.toggle('em-ativo', Number(b.dataset.id) === id);
        // abrir desliza da direita; trocar de e-mail com o detalhe já aberto só esmaece
        const fechado = $('em-detalhe').hidden;
        // uma entrada { detalhe } que sobrou (recarregar, voltar até ela) tem antes de si o mesmo endereço: serve de entrada deste e-mail
        if (fechado && estreito.matches) { if (!noHistorico()) history.pushState({ detalhe: true }, '', location.href); comEntrada = true; }
        for (const x of soComDados()) x.hidden = false;
        $('em-detalhe').hidden = false;
        animar($('em-detalhe'), fechado ? 'em-abrindo' : 'em-trocando');
        $('em-app').classList.add('em-com-detalhe');
        fecharMenus();
        $('em-assunto').textContent = 'Carregando…';
        for (const x of ['em-meta', 'em-avisos', 'em-anexos', 'em-historico', 'em-do-remetente', 'em-comentarios']) $(x).replaceChildren();
        for (const x of ['em-avatar', 'em-rem-nome', 'em-rem-email', 'em-quando', 'em-status-atual', 'em-corpo']) $(x).textContent = '';
        $('em-controle').hidden = true; $('em-ia').hidden = true; $('em-outros').hidden = true;
        $('em-vistos').hidden = true; $('em-conversa').hidden = true;
        estado.aberto = null;
        mostrarTexto();
        $('em-assunto').focus({ preventScroll: true });
        const r = await pedir('detalhe', { id });
        if (r.cancelado || estado.idAberto !== id) return;
        if (!r.sucesso) {
            // estado de erro do detalhe: título fixo, o motivo num aviso e "Tentar de novo"
            $('em-assunto').textContent = 'Não foi possível abrir o e-mail.';
            for (const x of soComDados()) x.hidden = true;
            const tentar = botao('Tentar de novo', 'em-botao em-secundario');
            tentar.addEventListener('click', () => abrir(id));
            $('em-avisos').append(aviso(r.erro || 'Confira a conexão e tente de novo.', true), tentar);
            return;
        }
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
    // `focar` false: quem fechou cuida do foco (a busca do celular mantém o foco no campo)
    function fecharDetalhe(focar) {
        if (comEntrada && noHistorico()) history.back();   // tira a entrada do e-mail aberto; o popstate encontra o detalhe já fechado
        comEntrada = false;
        const id = estado.idAberto;
        estado.aberto = null; estado.idAberto = null;
        mostrarTexto();
        fecharMenus();
        $('em-detalhe').hidden = true;
        $('em-app').classList.remove('em-com-detalhe');
        for (const b of $('em-lista').querySelectorAll('.em-item.em-ativo')) b.classList.remove('em-ativo');
        if (focar === false) return;
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
        if (F.categoria(e.categoria).id === 'spam') avisos.appendChild(aviso('Classificado como spam: não abra links e não responda. Anexos bloqueados.', true));
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
        // quem abriu e comentários: o serviço antigo não manda, e aí nada aparece (nem "Visto por" vazio)
        const vistos = Array.isArray(e.vistos);
        $('em-vistos').hidden = !vistos;
        $('em-vistos').textContent = vistos ? [A.vistoPor(e.vistos), 'Aberturas são registradas.'].filter(Boolean).join(' ') : '';
        $('em-conversa').hidden = !Array.isArray(e.comentarios);
        if (Array.isArray(e.comentarios)) {
            // a parte de comentários carrega na primeira vez que um e-mail abre
            parte('comentarios').then(mostrar => { if (estado.aberto === e) mostrar(e); }, () => {
                if (estado.aberto === e) $('em-comentarios').replaceChildren(el('p', 'Não foi possível carregar os comentários. Abra o e-mail de novo.', 'em-estado'));
            });
        }
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
            // z: o "Desfazer" do aviso mais novo que ainda tem um
            z: () => { const b = [...pilha.querySelectorAll('.em-aviso-item:not(.em-sumindo) .em-desfazer')].pop(); if (b) b.click(); },
            x: () => {
                const id = itemFocado() !== null ? itemFocado() : estado.idAberto;
                if (id !== null && estado.dados.has(id)) selecionar(id, ev.shiftKey, !estado.sel.has(id));
            } }[ev.key.toLowerCase()];
        if (!acao || (ev.shiftKey && ev.key.toLowerCase() !== 'x')) return;
        ev.preventDefault();
        acao();
    });

    // ----- partes carregadas na primeira vez que abrem: <script src> do próprio portal, como o exceljs (a CSP não muda) -----
    // Cada arquivo lê de EmailsTela os utilitários da casca e registra em `partes` a sua entrada.
    const T = window.EmailsTela = { $, el, botao, icone, etiqueta, etiquetaCategoria, SVG, estado, admin, minhas, hoje, pedir, cancelarPedidos,
        contadores, comMovimento, tempo, manterFoco, avisoFlutuante, salvarPreferencias, filtrar, paraHash, opcoesCor, atualizarItem, partes: {} };
    // os arquivos de cada parte, na ordem: graficos.js antes de quem usa G; saude.js tem as tabelas que o Dashboard e Aberturas usam;
    // exportar.js monta a planilha de Aberturas
    const PARTES = { dashboard: ['graficos', 'saude', 'dashboard'], saude: ['graficos', 'saude'], filtros: ['gestao-filtros'], exportar: ['exportar'],
        aberturas: ['saude', 'exportar', 'aberturas'], comentarios: ['comentarios'] };
    const baixados = {};
    function arquivo(nome) {
        if (!baixados[nome]) {
            baixados[nome] = new Promise((ok, falha) => {
                const s = document.createElement('script');
                s.src = 'emails/' + nome + '.js';
                s.onload = ok;
                s.onerror = () => { delete baixados[nome]; s.remove(); falha(new Error(nome)); };
                document.head.appendChild(s);
            });
        }
        return baixados[nome];
    }
    async function parte(nome) {
        for (const a of PARTES[nome]) await arquivo(a);
        return T.partes[nome];
    }
    // enquanto o arquivo vem, a visão diz "Carregando…"; se não vier, erro e "Tentar de novo"
    const LUGAR = { dashboard: ['em-dash-estado', 'em-dash-conteudo'], saude: ['em-saude-estado', 'em-saude-conteudo'], filtros: ['em-gestao-estado', 'em-gestao'],
        aberturas: ['em-aberturas-estado', 'em-aberturas-conteudo'] };
    // `doBotao`: veio de "Tentar de novo", que some quando a visão abre; o foco vai ao título da visão
    async function abrirVisao(nome, ver, doBotao) {
        if (!T.partes[nome]) {
            const [estadoId, conteudoId] = LUGAR[nome];
            $(estadoId).textContent = 'Carregando…';
            try {
                await parte(nome);
            } catch (erro) {
                if (estado.visao !== nome) return;
                const tentar = botao('Tentar de novo', 'em-botao em-secundario');
                tentar.addEventListener('click', () => { if (estado.visao === nome) abrirVisao(nome, ver, true); });
                $(conteudoId).replaceChildren(tentar);
                $(estadoId).textContent = 'Não foi possível carregar esta visão. Confira a conexão e tente de novo.';
                return;
            }
            $(conteudoId).replaceChildren();
            $(estadoId).textContent = '';
            if (estado.visao !== nome) return;   // saiu da visão enquanto o arquivo vinha
        }
        T.partes[nome](ver);
        if (doBotao) {
            const titulo = $(LUGAR[nome][0]).closest('.em-visao').querySelector('h2');
            titulo.tabIndex = -1;
            titulo.focus();
        }
    }
    // exportação: o primeiro clique baixa exportar.js (e ele, depois, o exceljs)
    $('em-exportar').addEventListener('click', () => {
        if (T.partes.exportar) { T.partes.exportar(); return; }
        $('em-exportar').disabled = true;
        parte('exportar').then(exportar => exportar(), () => {
            $('em-exportar').disabled = !estado.itens;
            avisoFlutuante('Não foi possível carregar a exportação. Tente de novo.', null, true);
        });
    });

    $('em-mais').addEventListener('click', () => listar(true));
    $('em-tentar').addEventListener('click', () => listar(estado.itens > 0 && !!estado.proximo));
    $('em-recarregar').addEventListener('click', () => { estado.idsAntes = new Set(estado.dados.keys()); listar(false); });
    $('em-ver-html').addEventListener('click', verHtml);
    $('em-ver-texto').addEventListener('click', mostrarTexto);
    larguraGuardada();
    mostrarVisao();
})();
