/* Central de E-mails: casca (cabeçalho, trilho, visões), caixa unificada e dashboard.
   Regra de segurança: todo campo vindo de e-mail entra por textContent. Nunca HTML montado a partir de texto.
   HTML do e-mail só em iframe sandbox="" (sem scripts e sem mesma origem), por clique, com CSP própria.
   Lógica pura (rota, categoria, formatos) fica em formato.js, que o node --test carrega. */
(function () {
    'use strict';
    const F = window.EmailsFormato;
    const $ = id => document.getElementById(id);
    const sessao = localStorage.getItem('maestro_session');
    // só arrumação da tela: o servidor já não manda o dado de administrador (gasto, saúde) a quem não é
    const admin = localStorage.getItem('maestro_admin') === 'true';
    const SVG = 'http://www.w3.org/2000/svg';
    const estado = { filtros: {}, proximo: null, itens: 0, total: 0, aberto: null, contas: [], visao: '', bloqueado: false };
    const CANCELADO = { sucesso: false, cancelado: true };
    const esperando = new Map();
    let seq = 0;

    function el(tag, texto, classe) {
        const e = document.createElement(tag);
        if (texto !== undefined && texto !== null) e.textContent = String(texto);
        if (classe) e.className = classe;
        return e;
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
        if (r && r.sucesso) aoVivo('vivo');
        else if (r && r.codigo === 'FONTE_OFFLINE') aoVivo('offline');
        const p = r && esperando.get(r.requestId);
        if (!p) {
            if (r && r.codigo === 'SEM_PERMISSAO' && !r.requestId) telaAcesso('Acesso restrito', r.erro || 'Sem permissão.');
            return;
        }
        esperando.delete(r.requestId);
        if (r.codigo === 'SEM_PERMISSAO') {
            telaAcesso('Acesso restrito', 'Você não tem o acesso "E-mails". Peça a um administrador do Maestro.');
            return;
        }
        p.resolve(r);
    });
    socket.on('sessao_invalida', () => telaAcesso('Sua sessão expirou', 'Entre de novo no Maestro para continuar.'));
    socket.on('connect', () => {
        aoVivo('conectando');
        socket.emit('emails_entrar');
        if (!estado.itens) listar(false);
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
        if (!aberto) return;
        fecharMenus();
        $(aberto[0]).focus();
    });
    mostrarNovidades();

    // ----- busca do cabeçalho: a mesma busca da Caixa -----
    function buscar() {
        if (estado.visao !== 'caixa') location.hash = '#caixa';
        listar(false);
    }
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

    // ----- visões pelo endereço: #caixa, #dashboard, #saude, #filtros -----
    const ITENS_TRILHO = { caixa: 'em-ir-caixa', dashboard: 'em-ir-dash', revisao: 'em-ir-revisao', atrasados: 'em-ir-atrasados', filtros: 'em-ir-filtros', saude: 'em-ir-saude' };
    function mostrarVisao() {
        if (estado.bloqueado) return;
        const r = F.rota(location.hash);
        if (r.visao === 'saude' && !admin) r.visao = 'caixa';
        estado.visao = r.visao;
        $('em-app').hidden = r.visao !== 'caixa';
        $('em-dash').hidden = r.visao !== 'dashboard';
        $('em-saude').hidden = r.visao !== 'saude';
        $('em-filtros-salvos').hidden = r.visao !== 'filtros';
        const ativo = ITENS_TRILHO[r.revisao ? 'revisao' : r.ver || r.visao];
        for (const id of Object.values(ITENS_TRILHO)) {
            if (id === ativo) $(id).setAttribute('aria-current', 'page');
            else $(id).removeAttribute('aria-current');
        }
        if (r.visao === 'caixa' && r.revisao && !$('em-revisao').checked) {
            $('em-revisao').checked = true;
            listar(false);
        }
        if (r.visao === 'dashboard') carregarDash(r.ver);
        if (r.visao === 'saude') carregarSaude();
    }
    window.addEventListener('hashchange', mostrarVisao);
    // clique no item da visão que já está aberta: o endereço não muda, então aplica de novo
    $('em-trilho').addEventListener('click', ev => {
        const a = ev.target.closest('a');
        if (a && a.getAttribute('href') === location.hash) mostrarVisao();
    });

    // ----- caixa -----
    function lerFiltros() {
        return { busca: $('em-busca').value.trim(), categoria: $('em-categoria').value, status: $('em-status').value, conta: $('em-conta').value,
            de: $('em-de').value, ate: $('em-ate').value, revisao: $('em-revisao').checked };
    }

    function preencherContas(contas) {
        if (!Array.isArray(contas) || contas.join() === estado.contas.join()) return;
        estado.contas = contas.slice();
        const sel = $('em-conta'), atual = sel.value;
        while (sel.options.length > 1) sel.remove(1);
        for (const c of contas) {
            const o = el('option', F.nomeCaixa(c));
            o.value = String(c);
            sel.appendChild(o);
        }
        sel.value = atual;
    }

    function itemLista(e) {
        const li = el('li');
        const b = el('button', null, 'em-item ' + F.categoria(e.categoria).classe);
        b.type = 'button';
        b.dataset.id = String(e.id);
        if (e.revisao) b.classList.add('em-revisao');
        const topo = el('span', null, 'em-item-topo');
        topo.appendChild(el('span', e.remetente_nome || e.remetente || '(sem remetente)', 'em-de'));
        topo.appendChild(el('span', dataHora(e.data), 'em-data em-num'));
        b.appendChild(topo);
        b.appendChild(el('span', e.assunto || '(sem assunto)', 'em-assunto-linha'));
        if (e.resumo) b.appendChild(el('span', e.resumo, 'em-resumo'));
        const rodape = el('span', null, 'em-item-rodape');
        rodape.appendChild(etiquetaCategoria(e.categoria));
        if (e.revisao) rodape.appendChild(etiqueta('revisar', 'em-etiqueta-atencao', 'revisao'));
        if (e.removido) rodape.appendChild(etiqueta('removido da caixa'));
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
        if (!mais) {
            estado.filtros = lerFiltros(); estado.proximo = null; estado.itens = 0;
            $('em-lista').replaceChildren(); $('em-novidade').hidden = true;
            esqueleto();
        }
        avisar('Carregando e-mails…');
        $('em-mais').hidden = true;
        const r = await pedir('listar', Object.assign({}, estado.filtros, { cursor: mais ? estado.proximo : '' }));
        if (r.cancelado) return;
        $('em-lista').querySelectorAll('.em-esqueleto-item').forEach(x => x.remove());
        if (!r.sucesso) {
            avisar(r.erro || 'Não foi possível carregar os e-mails.');
            return;
        }
        const d = r.dados || {};
        if (Number.isFinite(d.total)) estado.total = d.total;
        preencherContas(d.contas);
        const itens = Array.isArray(d.itens) ? d.itens : [];
        const frag = document.createDocumentFragment();
        itens.forEach(e => frag.appendChild(itemLista(e)));
        $('em-lista').appendChild(frag);
        estado.itens += itens.length;
        estado.proximo = d.proximo || null;
        $('em-mais').hidden = !estado.proximo;
        avisar(estado.itens ? `${estado.itens} de ${Math.max(estado.total, estado.itens).toLocaleString('pt-BR')} e-mails` : 'Nenhum e-mail encontrado com esses filtros.');
    }

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

    async function abrir(id, botao) {
        document.querySelectorAll('.em-item.em-ativo').forEach(b => b.classList.remove('em-ativo'));
        if (botao) botao.classList.add('em-ativo');
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
    async function baixar(id, anexo, botao, rotulo) {
        botao.disabled = true;
        const texto = rotulo.textContent;
        rotulo.textContent = 'Baixando…';
        const r = await pedir('anexo', { id, anexo });
        botao.disabled = false;
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

    $('em-form').addEventListener('submit', ev => { ev.preventDefault(); listar(false); });
    $('em-limpar').addEventListener('click', () => { $('em-form').reset(); listar(false); });
    $('em-mais').addEventListener('click', () => listar(true));
    $('em-recarregar').addEventListener('click', () => listar(false));
    $('em-ver-html').addEventListener('click', verHtml);
    $('em-ver-texto').addEventListener('click', mostrarTexto);
    mostrarVisao();
})();
