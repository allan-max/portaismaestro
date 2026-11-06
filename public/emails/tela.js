/* Central de E-mails: caixa unificada, só leitura.
   Regra de segurança: todo campo vindo de e-mail entra por textContent. Nunca innerHTML com dado de e-mail.
   HTML do e-mail só em iframe sandbox="" (sem scripts e sem mesma origem), por clique, com CSP própria. */
(function () {
    'use strict';
    const $ = id => document.getElementById(id);
    const sessao = localStorage.getItem('maestro_session');
    const FUSO = 'America/Sao_Paulo';
    const estado = { filtros: {}, proximo: null, itens: 0, total: 0, aberto: null, contas: [] };
    const CANCELADO = { sucesso: false, cancelado: true };
    const esperando = new Map();
    let seq = 0;

    function el(tag, texto, classe) {
        const e = document.createElement(tag);
        if (texto !== undefined && texto !== null) e.textContent = String(texto);
        if (classe) e.className = classe;
        return e;
    }
    function dataHora(iso) {
        const d = iso ? new Date(iso) : null;
        return d && !isNaN(d) ? d.toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    }
    function tamanho(n) {
        if (!Number.isFinite(n)) return '';
        return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    }
    function avisar(texto) { $('em-estado').textContent = texto; }
    function telaAcesso(titulo, texto) {
        $('em-app').hidden = true;
        $('em-acesso').hidden = false;
        $('em-acesso-titulo').textContent = titulo;
        $('em-acesso-texto').textContent = texto;
    }

    if (!sessao) {
        telaAcesso('Entre no Maestro', 'Faça login no portal para ver os e-mails.');
        return;
    }
    $('em-usuario').textContent = localStorage.getItem('maestro_user') || '';

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
    socket.on('connect', () => { socket.emit('emails_entrar'); if (!estado.itens) listar(false); });
    socket.on('connect_error', () => avisar('Sem conexão com o Maestro. Tentando de novo…'));
    socket.on('disconnect', () => {
        // o servidor descarta os pedidos deste socket; quem espera recebe "cancelado" e libera a tela
        for (const p of esperando.values()) p.resolve(CANCELADO);
        esperando.clear();
        avisar('Conexão perdida. Tentando reconectar…');
    });
    socket.on('emails_novidade', d => {
        const n = d && Number.isSafeInteger(d.novos) ? d.novos : 0;
        if (n <= 0) return;
        $('em-novidade-texto').textContent = n === 1 ? '1 e-mail novo chegou.' : n + ' e-mails novos chegaram.';
        $('em-novidade').hidden = false;
    });

    function lerFiltros() {
        return { busca: $('em-busca').value.trim(), categoria: $('em-categoria').value, conta: $('em-conta').value,
            de: $('em-de').value, ate: $('em-ate').value, revisao: $('em-revisao').checked };
    }

    function preencherContas(contas) {
        if (!Array.isArray(contas) || contas.join() === estado.contas.join()) return;
        estado.contas = contas.slice();
        const sel = $('em-conta'), atual = sel.value;
        while (sel.options.length > 1) sel.remove(1);
        for (const c of contas) {
            const o = el('option', String(c).split('@')[0]);
            o.value = String(c);
            sel.appendChild(o);
        }
        sel.value = atual;
    }

    function itemLista(e) {
        const li = el('li');
        const b = el('button', null, 'em-item');
        b.type = 'button';
        b.dataset.id = String(e.id);
        if (e.revisao) b.classList.add('em-revisao');
        const topo = el('span', null, 'em-item-topo');
        topo.appendChild(el('span', e.remetente_nome || e.remetente || '(sem remetente)', 'em-de'));
        topo.appendChild(el('span', dataHora(e.data), 'em-data'));
        b.appendChild(topo);
        b.appendChild(el('span', e.assunto || '(sem assunto)', 'em-assunto-linha'));
        const rodape = el('span', null, 'em-item-rodape');
        rodape.appendChild(el('span', e.categoria || 'não classificado', 'em-chip'));
        if (e.revisao) rodape.appendChild(el('span', 'revisar', 'em-chip em-chip-alerta'));
        if (e.removido) rodape.appendChild(el('span', 'removido da caixa', 'em-chip em-chip-cinza'));
        if (e.anexos) rodape.appendChild(el('span', e.anexos === 1 ? '1 anexo' : e.anexos + ' anexos', 'em-chip em-chip-cinza'));
        rodape.appendChild(el('span', (e.caixas || []).map(c => String(c).split('@')[0]).join(', '), 'em-caixas'));
        b.appendChild(rodape);
        if (e.resumo) b.appendChild(el('span', e.resumo, 'em-resumo'));
        b.addEventListener('click', () => abrir(e.id, b));
        li.appendChild(b);
        return li;
    }

    async function listar(mais) {
        if (!mais) {
            estado.filtros = lerFiltros(); estado.proximo = null; estado.itens = 0;
            $('em-lista').replaceChildren(); $('em-novidade').hidden = true;
        }
        avisar('Carregando e-mails…');
        $('em-mais').hidden = true;
        const r = await pedir('listar', Object.assign({}, estado.filtros, { cursor: mais ? estado.proximo : '' }));
        if (r.cancelado) return;
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
        dl.appendChild(el('dd', valor || '—'));
    }

    async function abrir(id, botao) {
        document.querySelectorAll('.em-item.em-ativo').forEach(b => b.classList.remove('em-ativo'));
        if (botao) botao.classList.add('em-ativo');
        const painel = $('em-detalhe');
        painel.hidden = false;
        $('em-assunto').textContent = 'Carregando…';
        $('em-meta').replaceChildren(); $('em-avisos').replaceChildren(); $('em-anexos').replaceChildren();
        $('em-corpo').textContent = ''; mostrarTexto();
        $('em-ver-html').hidden = true;
        const r = await pedir('detalhe', { id });
        if (r.cancelado) return;
        if (!r.sucesso) { $('em-assunto').textContent = r.erro || 'Não foi possível abrir o e-mail.'; return; }
        const e = r.dados;
        estado.aberto = e;
        $('em-assunto').textContent = e.assunto || '(sem assunto)';
        meta('De', (e.remetente_nome ? e.remetente_nome + ' ' : '') + '<' + (e.remetente || '') + '>');
        meta('Para', e.destinatarios);
        if (e.cc) meta('Cc', e.cc);
        meta('Data', dataHora(e.data));
        meta('Caixas', (e.ocorrencias || []).map(o => String(o.conta).split('@')[0] + ' / ' + o.pasta + (o.removida_em ? ' (removido)' : '')).join('; '));
        meta('Categoria', (e.categoria || 'não classificado') + (e.confianca != null ? ` (confiança ${Math.round(e.confianca * 100)}%)` : ''));
        if (e.resumo) meta('Resumo', e.resumo);
        meta('Autenticação', `SPF ${e.spf || 'ausente'} · DKIM ${e.dkim || 'ausente'}`);
        const avisos = $('em-avisos');
        if (e.removido) avisos.appendChild(el('p', 'Este e-mail foi apagado ou movido em todas as caixas. A central guarda a cópia.', 'em-aviso'));
        if (e.categoria === 'phishing' || e.categoria === 'spam') avisos.appendChild(el('p', 'Classificado como ' + e.categoria + ': não abra links e não responda. Anexos bloqueados.', 'em-aviso em-aviso-forte'));
        if (e.revisao) avisos.appendChild(el('p', 'Classificação com baixa confiança: está na fila de revisão.', 'em-aviso'));
        const anexos = $('em-anexos');
        if ((e.anexos || []).length) {
            anexos.appendChild(el('h3', 'Anexos'));
            const ul = el('ul');
            for (const a of e.anexos) {
                const li = el('li');
                li.appendChild(el('span', `${a.nome || 'anexo sem nome'} ${tamanho(a.tamanho)}`));
                const b = el('button', a.bloqueado ? 'Bloqueado' : 'Baixar', 'em-botao em-secundario');
                b.type = 'button';
                b.disabled = !!a.bloqueado;
                if (a.bloqueado) b.title = a.motivo_bloqueio || 'Anexo bloqueado';
                b.addEventListener('click', () => baixar(e.id, a.id, b));
                li.appendChild(b);
                ul.appendChild(li);
            }
            anexos.appendChild(ul);
        }
        if (e.corpo_oculto) $('em-corpo').textContent = 'Corpo oculto: este e-mail traz código de acesso ou senha e não é exibido na central.';
        else $('em-corpo').textContent = e.corpo_texto || '(e-mail sem texto)';
        $('em-ver-html').hidden = !e.tem_html || e.corpo_oculto;
        $('em-assunto').focus();
    }

    async function baixar(id, anexo, botao) {
        botao.disabled = true;
        const texto = botao.textContent;
        botao.textContent = 'Baixando…';
        const r = await pedir('anexo', { id, anexo });
        botao.disabled = false;
        botao.textContent = texto;
        if (r.cancelado) return;
        if (!r.sucesso) { avisar(r.erro || 'Não foi possível baixar o anexo.'); return; }
        const url = r.dados && r.dados.url;
        if (typeof url === 'string' && /^\/emails\/anexo\/[0-9a-f]{64}$/.test(url)) window.location.assign(url);
    }

    // CSP do documento do iframe: nada de rede, nada de script, nada de formulário; links não clicáveis.
    const CABECALHO_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; form-action \'none\'">' +
        '<style>a,area{pointer-events:none!important;cursor:default!important}body{font-family:sans-serif;color:#111;background:#fff}</style></head><body>';

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
})();
