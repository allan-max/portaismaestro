/* Tela "Minhas cotações": quadro por prazo, filtros em pílula, cotação aberta numa janela central.
   Os dados chegam do socket (Tela.receber, chamado por minhas_cotacoes.html) e as exportações usam as
   funções da página: exportarMinhasCotacoesExcel/Word, exportarCotacaoWordCore, exportarCotacaoPlanilhaBase.
   Também usa da página: parseDataVenc, isRespondida, marcarComoRespondida, carregarMinhasCotacoes,
   fazerLogout, vendedorLogado, temAcessoPlanilha, temAcessoPortais. */
(function () {
    'use strict';

    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hoje0 = () => { const h = new Date(); h.setHours(0, 0, 0, 0); return h.getTime(); };
    const pad = n => String(n).padStart(2, '0');

    // id estável por cotação (sobrevive às recargas do socket), guardado fora do objeto para não ir para o Excel
    const ID = new WeakMap(), CHAVES = new Map();
    const id = c => ID.get(c);
    function registrar(lista) {
        const vistas = {};
        return lista.map(c => {
            const base = ['COTAÇÃO', 'LOCALIDADE', 'VENCIMENTO', 'ITEM'].map(k => String(c[k] ?? '')).join('|');
            const chave = base + '#' + (vistas[base] = (vistas[base] || 0) + 1);
            if (!CHAVES.has(chave)) CHAVES.set(chave, CHAVES.size + 1);
            ID.set(c, CHAVES.get(chave));
            return c;
        });
    }

    // ---------- leitura dos itens para a tela: "CÓDIGO || NOME CURTO - PT || DESCRIÇÃO" ----------
    const PREFIXO = /^\s*(?:\(\s*item\s*\d+\s*\)|item\s*\d+)\s*[:.\-–—]?\s*/i;
    function lista(v) {
        const s = String(v ?? '').trim();
        if (!s) return [];
        let partes = s.split(/\r?\n/);
        if (partes.length === 1 && /\(\s*item\s*\d+\s*\)/i.test(s)) partes = s.split(/(?=\(\s*item\s*\d+\s*\))/i);
        return partes.map(p => p.replace(PREFIXO, '').replace(/^[*•\-\s]+/, '').trim()).filter(Boolean);
    }
    function rotuloQtd(s) {
        const m = String(s || '').match(/^([\d.,]+)\s*([A-Za-zÀ-ÿ]+)?/);
        return m ? m[1].replace(/^0+(?=\d)/, '') + (m[2] ? ' ' + m[2].toUpperCase() : '') : String(s || '');
    }
    const marcasCampo = c => c['MARCAS '] || c.MARCAS || c.MARCA;
    function itens(c) {
        const linhas = lista(c.ITEM || c.ITENS), qtds = lista(c.QUANTIDADE || c.QTD), marcas = lista(marcasCampo(c)), modelos = lista(c.MODELOS || c.MODELO);
        const unico = linhas.length <= 1;
        const r = linhas.map((l, i) => {
            const p = l.split('||').map(x => x.trim());
            let codigo = '', nome = p[0], desc = '', categoria = '';
            if (p.length > 1) {
                if (/^\d{5,}$/.test(p[0])) codigo = p.shift();
                nome = p.shift().replace(/\s*-\s*PT$/i, '');
                desc = p.join(' · ');
                // código de categoria (ex.: 35001117 MADEIRA SERRADA): a descrição curta é o produto de verdade
                if (desc && desc.length <= 80 && !desc.includes(':')) { categoria = nome; nome = desc; desc = ''; }
            }
            const qtd = unico ? qtds.map(rotuloQtd).join(' + ') : rotuloQtd(qtds[i]);
            return { n: i + 1, codigo, nome, desc, categoria, qtd: qtd || '—', marca: marcas[i] || (unico ? marcas[0] : '') || '', modelo: modelos[i] || (unico ? modelos[0] : '') || '' };
        });
        return r.length ? r : [{ n: 1, codigo: '', nome: 'Sem descrição na planilha', desc: '', categoria: '', qtd: qtds.map(rotuloQtd).join(' + ') || '—', marca: marcas[0] || '', modelo: modelos[0] || '' }];
    }
    const marcasDe = c => [...new Set(lista(marcasCampo(c)))].join(', ');
    const localDe = c => String(c.LOCALIDADE || c.CIDADE || '').trim() || 'Sem localidade';

    // número da cotação sem o texto em volta: "COTAÇÃO/ES (EDIVIT) > PPG0241188" vira PPG0241188 + origem EDIVIT
    function numero(c) {
        const s = String(c['COTAÇÃO'] ?? '').trim();
        const origem = (s.match(/\(([^)]+)\)/) || [])[1] || '';
        const num = s.split('>').pop().replace(/^\s*cota[çc][ãa]o\s*[:/\-]?\s*/i, '').trim();
        return { num: num || s, origem };
    }

    // ---------- prazo e status ----------
    function dias(c) {
        const t = parseDataVenc(c.VENCIMENTO);
        return t === null ? 999 : Math.round((t - hoje0()) / 864e5);
    }
    const isoDe = c => { const t = parseDataVenc(c.VENCIMENTO); if (t === null) return ''; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
    const dataBr = off => { const d = new Date(hoje0()); d.setDate(d.getDate() + off); return d.toLocaleDateString('pt-BR'); };
    function prazo(c) {
        const d = dias(c);
        const urg = Math.max(0.06, Math.min(1, 1 - d / 8));
        if (d === 0) {
            const fim = new Date(); fim.setHours(23, 59, 0, 0);
            const h = Math.max(0, Math.floor((fim - Date.now()) / 36e5));
            return { d, txt: 'Vence hoje', sub: h ? `${h}h restantes` : 'últimos minutos', cls: 'red', urg };
        }
        if (d === 1) return { d, txt: 'Amanhã', sub: c.VENCIMENTO, cls: 'amber', urg };
        return { d, txt: `Em ${d} dias`, sub: c.VENCIMENTO, cls: d <= 7 ? 'blue' : '', urg };
    }
    const respondida = c => isRespondida(c);
    const statusTag = c => respondida(c)
        ? '<span class="tag verde">Respondida</span>'
        : `<span class="tag ${dias(c) === 0 ? 'vermelho' : 'amarelo'}">Pendente</span>`;

    // ---------- estado e filtros (lembrados no navegador; o dia clicado no gráfico não, porque "hoje" muda) ----------
    const CHAVE = 'minhas_cotacoes_filtros_v1';
    const LEMBRAR = ['status', 'prazo', 'de', 'ate', 'locais', 'marcas', 'ordem'];
    const ler = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
    const gravar = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* navegador sem armazenamento: só não lembra */ } };
    const lembrado = (() => { try { return JSON.parse(ler(CHAVE)) || {}; } catch (_) { return {}; } })();
    const arr = v => (Array.isArray(v) ? v : []);
    const estado = {
        lista: [], carregado: false, erro: '', busca: '', status: lembrado.status || 'pendentes',
        prazo: lembrado.prazo === 'dia' ? '' : lembrado.prazo || '', dia: null, de: lembrado.de || '', ate: lembrado.ate || '',
        locais: arr(lembrado.locais), marcas: arr(lembrado.marcas), ordem: lembrado.ordem || 'prioridade',
        selecionadas: new Set(), aberta: null, confirmando: false, respondeuAgora: null, novos: new Set(), pop: null,
    };
    const lembrar = () => gravar(CHAVE, JSON.stringify(Object.fromEntries(LEMBRAR.map(k => [k, estado[k]]))));
    const LIMITE_PRAZO = { hoje: 0, '7': 7, '15': 15, '30': 30 };
    function passaPrazo(c) {
        const p = estado.prazo;
        if (p === 'dia') return dias(c) === estado.dia;
        if (p === 'periodo') { const iso = isoDe(c); return (!estado.de || iso >= estado.de) && (!estado.ate || iso <= estado.ate); }
        return !(p in LIMITE_PRAZO) || dias(c) <= LIMITE_PRAZO[p];
    }
    function passaStatus(c) {
        const s = estado.status, d = dias(c);
        if (s === 'hoje') return d === 0;
        if (s === 'pendentes') return !respondida(c);
        if (s === 'respondidas') return respondida(c);
        if (s === 'semana') return d >= 1 && d <= 7;
        return true;
    }
    function filtradas() {
        const b = estado.busca.trim().toLowerCase();
        const r = estado.lista.filter(c => passaStatus(c) && passaPrazo(c)
            && (!estado.locais.length || estado.locais.includes(localDe(c)))
            && (!estado.marcas.length || marcasDe(c).split(', ').some(m => estado.marcas.includes(m)))
            && (!b || Object.values(c).some(v => String(v ?? '').toLowerCase().includes(b))));
        const prio = c => (dias(c) === 0 ? 0 : dias(c) <= 7 ? 1 : 2);
        if (estado.ordem === 'prioridade') r.sort((a, z) => prio(a) - prio(z) || dias(a) - dias(z) || respondida(a) - respondida(z));
        else if (estado.ordem === 'venc_asc') r.sort((a, z) => dias(a) - dias(z));
        else if (estado.ordem === 'venc_desc') r.sort((a, z) => dias(z) - dias(a));
        return r;
    }
    function contagem() {
        const l = estado.lista;
        return {
            todas: l.length, pendentes: l.filter(c => !respondida(c)).length, respondidas: l.filter(respondida).length,
            hoje: l.filter(c => dias(c) === 0).length, hojePend: l.filter(c => dias(c) === 0 && !respondida(c)).length,
            semana: l.filter(c => dias(c) >= 1 && dias(c) <= 7).length,
        };
    }
    const temFiltro = () => !!(estado.busca || estado.prazo || estado.locais.length || estado.marcas.length || estado.status !== 'todas');
    const porId = v => estado.lista.find(c => id(c) === Number(v));
    const alvoExportacao = () => (estado.selecionadas.size ? estado.lista.filter(c => estado.selecionadas.has(id(c))) : filtradas());

    // ---------- pedaços de tela ----------
    const ICONES = {
        busca: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
        baixar: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16"/>',
        excel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 8 8 8M16 8l-8 8"/>',
        word: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l1.5 5 2.5-4 2.5 4 1.5-5"/>',
        base: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
        copiar: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        ok: '<path d="m5 12 4 4L19 6"/>',
        fechar: '<path d="m6 6 12 12M6 18 18 6"/>',
        mais: '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>',
        local: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
        relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
        marca: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
        ordem: '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
        seta: '<path d="m6 9 6 6 6-6"/>',
        esq: '<path d="m15 6-6 6 6 6"/>',
        dir: '<path d="m9 6 6 6-6 6"/>',
        tabela: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
        robo: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 14h.01M15 14h.01"/>',
        sair: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/>',
        atualizar: '<path d="M20 7a8.1 8.1 0 0 0-14-2L3 8M3 3v5h5M4 17a8.1 8.1 0 0 0 14 2l3-3M16 16h5v5"/>',
        cotacoes: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h6"/>',
    };
    const icone = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;

    function nav() {
        const nome = (vendedorLogado || '').toUpperCase();
        return `<nav class="dash-nav pc-nav" aria-label="Topo">
            <a class="brand" href="minhas_cotacoes.html"><span class="brand-logo"><img src="img/logo-maestro-dashboard.png" alt=""></span><span class="brand-texto">MAESTRO</span></a>
            <div class="dash-nav-links">
                <a href="minhas_cotacoes.html" aria-current="page">${icone('cotacoes')}<span>Minhas cotações</span></a>
                ${temAcessoPlanilha ? `<a href="planilha_vale.html">${icone('tabela')}<span>Planilha geral</span></a>` : ''}
                ${temAcessoPortais ? `<a href="index.html?portais=1">${icone('robo')}<span>Portais</span></a>` : ''}
            </div>
            <div class="dash-nav-right">
                <span class="source-pill off" id="mc-conexao"><span class="status-dot"></span><span>Conectando…</span></span>
                <div class="admin-account" title="${nome ? 'Vendedor logado' : 'Seu usuário não tem vendedor vinculado'}"><span class="avatar" aria-hidden="true">${esc(nome.slice(0, 2) || '?')}</span><span>${esc(nome || 'Sem vendedor vinculado')}</span></div>
                <button type="button" class="icon-button" data-acao="sair" title="Sair" aria-label="Sair">${icone('sair')}</button>
            </div></nav>`;
    }

    // pílula com menu: <details> nativo; o id guarda qual está aberta entre um redesenho e outro
    function pilula(idPop, ic, rotulo, ativo, campo, corpo) {
        return `<div class="pc-pill-wrap ${ativo ? 'ativo' : ''}">
            <details class="pc-pop" id="${idPop}" ${estado.pop === idPop ? 'open' : ''}>
                <summary class="pc-pill">${icone(ic)}<span>${rotulo}</span>${icone('seta')}</summary>
                <div class="pc-pop-corpo">${corpo}</div>
            </details>
            ${ativo ? `<button type="button" class="pc-pill-x" data-acao="limpar-campo" data-campo="${campo}" title="Limpar este filtro" aria-label="Limpar ${esc(rotulo)}">${icone('fechar')}</button>` : ''}
        </div>`;
    }
    function multipla(campo, contas) {
        const valores = Object.keys(contas).sort((a, b) => a.localeCompare(b, 'pt-BR'));
        if (!valores.length) return '<small>Nenhuma opção nas suas cotações.</small>';
        return `${valores.length > 6 ? '<input type="search" class="pc-pop-busca" data-pop-busca placeholder="Buscar na lista">' : ''}
            <div class="pc-pop-lista">${valores.map(v => `<label data-valor="${esc(v.toLowerCase())}">
                <input type="checkbox" class="pc-check" data-multi="${campo}" value="${esc(v)}" ${estado[campo].includes(v) ? 'checked' : ''}>
                <span>${esc(v)}</span><small>${contas[v]}</small></label>`).join('')}</div>`;
    }
    const PRAZOS = [['', 'Qualquer data'], ['hoje', 'Vence hoje'], ['7', 'Até 7 dias'], ['15', 'Até 15 dias'], ['30', 'Até 30 dias']];
    const ORDENS = [['prioridade', 'Prioridade'], ['venc_asc', 'Vence primeiro'], ['venc_desc', 'Vence por último']];
    const diaMes = iso => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '…');
    function rotuloPrazo() {
        if (estado.prazo === 'dia') return `Vence ${dataBr(estado.dia).slice(0, 5)}`;
        if (estado.prazo === 'periodo') return `${diaMes(estado.de)} a ${diaMes(estado.ate)}`;
        return (PRAZOS.find(p => p[0] === estado.prazo) || ['', 'Vencimento'])[1].replace('Qualquer data', 'Vencimento');
    }
    const rotuloMulti = (nome, v) => (v.length === 1 ? v[0] : v.length ? `${nome} · ${v.length}` : nome);
    const contarPor = chaves => estado.lista.reduce((a, c) => { chaves(c).forEach(k => { if (k) a[k] = (a[k] || 0) + 1; }); return a; }, {});

    function filtros() {
        const opcao = (acao, [v, t], atual) => `<button type="button" data-acao="${acao}" data-valor="${v}" aria-pressed="${v === atual}">${t}</button>`;
        const vencimento = `<div class="pc-pop-opcoes">${PRAZOS.map(p => opcao('prazo', p, estado.prazo)).join('')}</div>
            <div class="pc-pop-periodo"><span>Ou um período</span>
                <label>De <input type="date" data-data="de" value="${esc(estado.de)}"></label>
                <label>Até <input type="date" data-data="ate" value="${esc(estado.ate)}"></label></div>`;
        const ordem = ORDENS.find(o => o[0] === estado.ordem) || ORDENS[0];
        return `<div class="pc-filtros">
            <label class="pc-busca">${icone('busca')}<input id="pc-busca" type="search" value="${esc(estado.busca)}" placeholder="Buscar cotação, produto, código, marca ou cidade" aria-label="Buscar"><kbd>/</kbd></label>
            <div class="pc-pills">
                ${pilula('pop-prazo', 'calendario', rotuloPrazo(), !!estado.prazo, 'prazo', vencimento)}
                ${pilula('pop-locais', 'local', esc(rotuloMulti('Localidade', estado.locais)), estado.locais.length > 0, 'locais', multipla('locais', contarPor(c => [localDe(c)])))}
                ${pilula('pop-marcas', 'marca', esc(rotuloMulti('Marca', estado.marcas)), estado.marcas.length > 0, 'marcas', multipla('marcas', contarPor(c => marcasDe(c).split(', '))))}
                ${pilula('pop-ordem', 'ordem', ordem[1], false, '', `<div class="pc-pop-opcoes">${ORDENS.map(o => opcao('ordem', o, estado.ordem)).join('')}</div>`)}
                ${temFiltro() ? '<button type="button" class="button text small" data-acao="limpar-filtros">Limpar tudo</button>' : ''}
            </div>
            ${exportar()}
        </div>`;
    }

    function exportar() {
        const n = alvoExportacao().length;
        const escopo = estado.selecionadas.size ? `${n} selecionada${n === 1 ? '' : 's'}` : `${n} na lista`;
        return `<details class="pc-pop pc-exportar" id="pc-exportar" ${estado.pop === 'pc-exportar' ? 'open' : ''}>
            <summary class="button primary">${icone('baixar')}<span>Exportar</span><span class="pc-escopo">${escopo}</span></summary>
            <div class="pc-menu" role="menu">
                <small>Vai no arquivo: ${escopo}${estado.selecionadas.size ? '' : ' (com os filtros atuais)'}</small>
                <button type="button" role="menuitem" data-acao="exp-excel">${icone('excel')}<span><b>Planilha Excel</b><em>Uma linha por cotação, com status e prazo</em></span></button>
                <button type="button" role="menuitem" data-acao="exp-word">${icone('word')}<span><b>Word padrão Coupa</b><em>Documento com todas as cotações e itens</em></span></button>
            </div></details>`;
    }

    function itensTabela(c) {
        return `<div class="pc-itens">${itens(c).map(it => `
            <div class="pc-item">
                <span class="pc-item-n">${it.n}</span>
                <div class="pc-item-prod">
                    <strong>${esc(it.nome)}</strong>
                    <div class="pc-item-meta">${it.codigo ? `<span class="pc-cod" title="Código do material">${esc(it.codigo)}</span>` : ''}${it.categoria ? `<span>${esc(it.categoria)}</span>` : ''}${it.marca ? `<span>Marca <b>${esc(it.marca)}</b></span>` : ''}${it.modelo && it.modelo !== it.codigo ? `<span>Modelo <b>${esc(it.modelo)}</b></span>` : ''}</div>
                    ${it.desc ? `<p class="pc-item-desc">${esc(it.desc)}</p>` : ''}
                </div>
                <span class="pc-qtd">${esc(it.qtd)}</span>
            </div>`).join('')}</div>`;
    }

    function botaoResposta(c) {
        if (estado.respondeuAgora === id(c)) {
            const prox = proximaPendente();
            return prox
                ? `<button type="button" class="button primary pc-resp-prox" data-acao="abrir" data-id="${id(prox)}">Ir para a próxima pendente: ${esc(numero(prox).num)}${icone('dir')}</button>`
                : '<span class="pc-resp-fim">Nenhuma outra pendente com esses filtros.</span>';
        }
        if (respondida(c)) return '';
        return estado.confirmando
            ? `<button type="button" class="button primary" data-acao="confirmar-resp" data-id="${id(c)}">${icone('ok')}Confirmar: respondida</button><button type="button" class="button text" data-acao="cancelar-resp">Cancelar</button>`
            : `<button type="button" class="button pc-resp" data-acao="responder" data-id="${id(c)}">${icone('ok')}Marcar como respondida</button>`;
    }

    function detalhe(c) {
        const p = prazo(c), its = itens(c), resp = respondida(c), { num, origem } = numero(c);
        return `<div class="pc-det">
            <header class="pc-det-topo">
                <div class="eyebrow">Cotação · ${esc(localDe(c))}${origem ? ` · ${esc(origem)}` : ''}</div>
                <div class="pc-det-num"><h2>${esc(num)}</h2><button type="button" class="icon-button" data-acao="copiar-num" data-id="${id(c)}" title="Copiar número">${icone('copiar')}</button></div>
                ${num !== String(c['COTAÇÃO'] ?? '').trim() ? `<small class="pc-det-orig">Na planilha: ${esc(c['COTAÇÃO'])}</small>` : ''}
                <div class="pc-det-linha">${statusTag(c)}<span class="pc-prazo ${p.cls}">${icone('relogio')}<b>${p.txt}</b>${p.sub ? ` · ${esc(p.sub)}` : ''}</span></div>
                <div class="pc-urg ${p.cls}" title="Quanto mais cheia, mais perto do vencimento"><i style="--w:${resp ? 0 : Math.round(p.urg * 100)}%"></i></div>
            </header>
            <div class="pc-acoes">
                <button type="button" class="button" data-acao="copiar" data-id="${id(c)}">${icone('copiar')}Copiar itens</button>
                <button type="button" class="button" data-acao="word" data-id="${id(c)}">${icone('word')}Word Coupa</button>
                <button type="button" class="button" id="btn-exportar-planilha-base" data-acao="base" data-id="${id(c)}">${icone('base')}Planilha Base</button>
                ${botaoResposta(c)}
            </div>
            <section class="pc-det-sec">
                <h3>Produtos <span class="nav-count">${its.length} ${its.length === 1 ? 'item' : 'itens'}</span></h3>
                ${itensTabela(c)}
            </section>
            <details class="pc-det-sec pc-campos"><summary>Todos os campos da planilha</summary>
                <dl class="detail-grid">${Object.entries(c).map(([k, v]) => `<div class="${k === 'ITEM' ? 'full' : ''}"><dt>${esc(k.trim())}</dt><dd>${esc(v || '—').replace(/\n/g, '<br>')}</dd></div>`).join('')}</dl>
            </details>
        </div>`;
    }

    // janela central com a cotação aberta; ← → passam pela fila filtrada
    function janela() {
        const c = porId(estado.aberta);
        let el = document.getElementById('pc-modal');
        if (!c) { if (el) el.remove(); document.body.classList.remove('pc-travado'); return; }
        const nova = !el;
        if (nova) {
            el = document.createElement('div');
            el.id = 'pc-modal';
            el.className = 'pc-modal-fundo';
            el.innerHTML = '<div class="pc-modal" role="dialog" aria-modal="true" aria-label="Cotação aberta" tabindex="-1"></div>';
            document.body.appendChild(el);
            document.body.classList.add('pc-travado');
        }
        const caixa = el.firstElementChild;
        const trocou = caixa.dataset.id !== String(id(c));
        const l = filtradas(), i = l.indexOf(c);
        caixa.dataset.id = id(c);
        caixa.innerHTML = `<div class="pc-modal-barra">
                <span>${i >= 0 ? `${i + 1} de ${l.length} na fila` : 'Fora dos filtros atuais'}</span>
                <button type="button" class="icon-button" data-acao="anterior" title="Anterior (←)" aria-label="Cotação anterior">${icone('esq')}</button>
                <button type="button" class="icon-button" data-acao="proxima" title="Próxima (→)" aria-label="Próxima cotação">${icone('dir')}</button>
                <button type="button" class="icon-button" data-acao="fechar" title="Fechar (Esc)" aria-label="Fechar">${icone('fechar')}</button>
            </div>${detalhe(c)}`;
        if (trocou && !nova) { caixa.scrollTop = 0; caixa.querySelector('.pc-det').classList.add('trocou'); }
        if (nova) caixa.focus();
    }

    // ---------- quadro principal ----------
    let primeira = true;
    let visaoAberta = ler('minhas_cotacoes_visao') !== '0';
    const COR = { red: 'var(--red)', amber: 'var(--amber)', blue: 'var(--blue)', '': '#5b6f88' };

    function cards(n) {
        const def = [
            ['todas', 'Atribuídas a você', n.todas, 'em aberto a partir de hoje', 'var(--blue)'],
            ['pendentes', 'Pendentes', n.pendentes, 'ainda sem resposta', 'var(--amber)'],
            ['hoje', 'Vencem hoje', n.hoje, `${n.hojePend} sem resposta`, 'var(--red)'],
            ['semana', 'Próximos 7 dias', n.semana, 'de amanhã a 7 dias', 'var(--cyan)'],
            ['respondidas', 'Respondidas', n.respondidas, `${Math.round(n.respondidas / Math.max(1, n.todas) * 100)}% do total`, 'var(--green)'],
        ];
        return `<div class="cards b-cards-num">${def.map(([k, rot, v, pe, cor], i) => `
            <button type="button" class="card-num ${primeira ? 'entra' : ''} ${estado.status === k ? 'selecionado' : ''}" style="--i:${i + 1};--c:${cor}" data-acao="status" data-status="${k}" aria-pressed="${estado.status === k}">
                <small>${rot}</small><strong data-contar="${v}">${primeira ? 0 : v}</strong><em>${pe}</em>
            </button>`).join('')}</div>`;
    }

    function grafico() {
        const rot = d => (d === 0 ? 'Hoje' : dataBr(d).slice(0, 5));
        const porDia = Array.from({ length: 14 }, (_, d) => {
            const doDia = estado.lista.filter(c => dias(c) === d);
            return { d, pend: doDia.filter(c => !respondida(c)).length, resp: doDia.filter(respondida).length };
        });
        const max = Math.max(1, ...porDia.map(x => x.pend + x.resp));
        return `<section class="panel">
            <div class="panel-head"><div><h2>Vencimentos nos próximos 14 dias</h2><p>Clique num dia para ver só as cotações dele.</p></div>
                <div class="legend" style="margin:0"><span><i class="swatch" style="background:var(--red)"></i>Hoje, pendente</span><span><i class="swatch amber"></i>Pendente</span><span><i class="swatch green"></i>Respondida</span></div></div>
            <div class="b-chart"><div class="deadline-chart">${porDia.map(x => {
                const tot = x.pend + x.resp, h = Math.round(tot / max * 100);
                const sel = estado.prazo === 'dia' && estado.dia === x.d;
                return `<button type="button" class="day-column ${x.d === 0 ? 'today' : ''} ${sel ? 'selecionado' : ''}" data-acao="dia" data-dia="${x.d}" aria-pressed="${sel}" title="${rot(x.d)}: ${x.pend} pendente(s), ${x.resp} respondida(s)">
                    <span class="bar-value">${tot || ''}</span>
                    <span class="column-stack" style="height:${primeira ? 0 : h}%" data-h="${h}">
                        <i class="segment green" style="flex:${x.resp}"></i><i class="segment ${x.d === 0 ? 'red' : 'amber'}" style="flex:${x.pend}"></i>
                    </span><span class="date-label">${rot(x.d)}</span></button>`;
            }).join('')}</div></div>
        </section>`;
    }

    function ritmo(n) {
        const C = 2 * Math.PI * 62, p = n.respondidas / Math.max(1, n.todas);
        const locais = Object.entries(contarPor(c => [localDe(c)])).sort((a, b) => b[1] - a[1]).slice(0, 5);
        const maxL = Math.max(1, ...locais.map(l => l[1]));
        return `<section class="panel">
            <div class="panel-head"><div><h2>Seu ritmo</h2><p>Clique numa cidade para filtrar.</p></div></div>
            <div class="b-ritmo">
                <div class="anel"><svg viewBox="0 0 140 140"><circle class="fundo" cx="70" cy="70" r="62"/><circle class="valor" cx="70" cy="70" r="62" style="--total:${C};stroke-dasharray:${C};stroke-dashoffset:${C * (1 - p)}"/></svg>
                    <div class="anel-centro"><strong>${Math.round(p * 100)}%</strong><span>respondidas</span></div></div>
                <div class="barras">${locais.map(([l, q]) => `<button type="button" class="barra ${estado.locais.includes(l) ? 'selecionado' : ''}" data-acao="local" data-valor="${esc(l)}" aria-pressed="${estado.locais.includes(l)}"><span>${esc(l)}</span><span class="barra-trilho"><i style="--w:${q / maxL * 100}%"></i></span><b>${q}</b></button>`).join('')}</div>
            </div>
        </section>`;
    }

    function cartao(c, i) {
        const p = prazo(c), its = itens(c), resp = respondida(c), { num, origem } = numero(c), k = id(c), novo = estado.novos.has(k);
        const qtd = its.length > 1 ? `${its.length} itens` : its[0].qtd;
        return `<article class="b-card ${resp ? 'feita' : ''} ${novo ? 'pc-novo' : ''} ${primeira ? 'entra' : ''}" style="--i:${Math.min(i, 10) + 6};--cor:${resp ? 'var(--green)' : COR[p.cls]}" data-acao="abrir" data-id="${k}" tabindex="0" aria-label="Cotação ${esc(num)}: ${esc(its[0].nome)}">
            <div class="b-num-linha">
                <span class="b-num" title="${esc(c['COTAÇÃO'])}">${esc(num)}</span>
                <button type="button" class="b-copiar-num" data-acao="copiar-num" data-id="${k}" title="Copiar número" aria-label="Copiar número ${esc(num)}">${icone('copiar')}</button>
                ${novo ? '<span class="pc-selo-novo">NOVA</span>' : ''}
                <label class="b-sel" data-acao="sel" title="Selecionar para exportar"><input class="pc-check" type="checkbox" data-sel="${k}" ${estado.selecionadas.has(k) ? 'checked' : ''} aria-label="Selecionar cotação ${esc(num)}"></label>
            </div>
            ${origem ? `<div class="b-origem">${esc(origem)}</div>` : ''}
            <div class="b-prazo"><span class="pc-prazo ${resp ? '' : p.cls}">${icone(resp ? 'ok' : 'relogio')}<b>${resp ? 'Respondida' : p.txt}</b>${!resp && p.d === 0 ? ` · ${esc(p.sub)}` : ''}</span>
                ${resp ? '' : `<div class="pc-urg ${p.cls}"><i style="--w:${Math.round(p.urg * 100)}%"></i></div>`}</div>
            <div class="b-nome">${esc(its[0].nome)}</div>
            <div class="b-chips"><span class="pc-qtd">${esc(qtd)}</span>${its[0].codigo ? `<span class="pc-cod">${esc(its[0].codigo)}</span>` : ''}${marcasDe(c) ? `<span class="tag">${esc(marcasDe(c))}</span>` : ''}${its.length > 1 ? `<span class="pc-mais" style="font-size:10px">+${its.length - 1} produto(s)</span>` : ''}</div>
            <div class="b-pe"><span class="lugar">${icone('local')}${esc(localDe(c))}</span>
                <button type="button" class="button small" data-acao="copiar" data-id="${k}">${icone('copiar')}Copiar itens</button>
                <details class="pc-pop b-mais" id="menu-${k}" ${estado.pop === 'menu-' + k ? 'open' : ''}>
                    <summary class="icon-button" data-acao="menu" title="Exportar esta cotação" aria-label="Mais exportações">${icone('mais')}</summary>
                    <div class="pc-menu" role="menu"><small>Exportar só esta cotação</small>
                        <button type="button" role="menuitem" data-acao="word" data-id="${k}">${icone('word')}<span><b>Word Coupa</b><em>Documento no padrão Coupa</em></span></button>
                        <button type="button" role="menuitem" data-acao="base" data-id="${k}">${icone('base')}<span><b>Planilha Base</b><em>Aba ORÇAMENTO com os ${its.length} produto(s)</em></span></button>
                    </div>
                </details>
            </div>
        </article>`;
    }

    function quadro(l) {
        const cols = [
            { titulo: 'Vence hoje', sub: 'responda primeiro', cor: 'var(--red)', cs: l.filter(c => dias(c) === 0) },
            { titulo: 'Esta semana', sub: 'de amanhã a 7 dias', cor: 'var(--amber)', cs: l.filter(c => dias(c) >= 1 && dias(c) <= 7) },
            { titulo: 'Mais adiante', sub: 'depois de 7 dias', cor: 'var(--blue)', cs: l.filter(c => dias(c) > 7) },
        ].filter(col => col.cs.length);
        if (!cols.length) {
            return estado.lista.length
                ? '<div class="b-vazio"><p>Nenhuma cotação com esses filtros.</p><button type="button" class="button" data-acao="limpar-filtros">Limpar filtros</button></div>'
                : '<div class="b-vazio"><p>Nenhuma cotação em aberto atribuída a você.</p></div>';
        }
        let i = 0;
        return `<div class="b-board n${cols.length}" style="--n:${cols.length}">${cols.map((col, ci) => `
            <section class="b-col ${primeira ? 'entra' : ''}" style="--i:${ci + 5};--cor:${col.cor}">
                <header class="b-col-head"><span class="ponto"></span><h2>${col.titulo}</h2><p>${col.sub}</p><span class="counter">${col.cs.length}</span></header>
                <div class="b-cards">${col.cs.map(c => cartao(c, i++)).join('')}</div>
            </section>`).join('')}</div>`;
    }

    function contar(raiz) {
        if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) {
            raiz.querySelectorAll('[data-contar]').forEach(el => (el.textContent = el.dataset.contar));
            return;
        }
        raiz.querySelectorAll('[data-contar]').forEach(el => {
            const alvo = Number(el.dataset.contar), ini = performance.now();
            if (!(alvo > 0)) return;
            const passo = t => { const p = Math.min(1, (t - ini) / 700); el.textContent = Math.round(alvo * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(passo); };
            requestAnimationFrame(passo);
        });
    }

    function render(main) {
        if (estado.erro && !estado.carregado) {
            main.innerHTML = `<div class="mc-estado erro"><p>Não foi possível carregar suas cotações: ${esc(estado.erro)}</p><button type="button" class="button" data-acao="atualizar">Tentar de novo</button></div>`;
            return;
        }
        if (!estado.carregado) { main.innerHTML = '<div class="mc-estado">Carregando suas cotações…</div>'; return; }
        const n = contagem(), l = filtradas();
        const feitasHoje = n.hoje - n.hojePend, pct = Math.round(feitasHoje / Math.max(1, n.hoje) * 100);
        main.innerHTML = `
            <div class="dash-titulo ${primeira ? 'entra' : ''}"><div><div class="eyebrow">Área do vendedor</div><h1>Minhas cotações</h1>
                <p>Comece por <b class="red">Vence hoje</b>. Clique num cartão para ver os produtos e exportar.</p></div>
                <div class="dash-estado"><button type="button" class="button" data-acao="atualizar" title="Buscar de novo na planilha">${icone('atualizar')}Atualizar</button>
                    <div class="b-hoje"><small><span>Meta de hoje</span><span><b>${feitasHoje}</b> de ${n.hoje} respondidas</span></small><div class="barra-trilho"><i style="--w:${pct}%"></i></div></div></div></div>
            ${cards(n)}
            <details class="b-visao" id="b-visao" ${visaoAberta ? 'open' : ''}><summary>${icone('seta')}Visão geral</summary>
                <div class="b-grid">${grafico()}${ritmo(n)}</div></details>
            <section class="panel b-filtros ${primeira ? 'entra' : ''}" style="--i:4">${filtros()}</section>
            <div class="b-barra">${estado.selecionadas.size
                ? `<div class="pc-selbar">${estado.selecionadas.size} selecionada(s). O Exportar agora gera só essas. <button type="button" class="button text small" data-acao="limpar-sel">Limpar seleção</button></div>`
                : `<small>${l.length} de ${estado.lista.length} cotações na fila</small>`}</div>
            ${quadro(l)}
            <div class="pc-atalhos"><span><kbd>/</kbd> buscar</span><span><kbd>←</kbd> <kbd>→</kbd> cotação anterior e próxima</span><span><kbd>Esc</kbd> fechar</span></div>`;
        if (primeira) {
            contar(main);
            requestAnimationFrame(() => requestAnimationFrame(() => main.querySelectorAll('.column-stack').forEach(el => (el.style.height = el.dataset.h + '%'))));
            primeira = false;
            setTimeout(() => document.body.classList.add('sem-anima'), 1200);
        }
    }

    function redesenhar() {
        const main = document.getElementById('main');
        if (!main) return; // fora do navegador (testes): só o estado importa
        render(main);
        janela();
    }

    // ---------- avisos ----------
    function toast(msg) {
        const t = document.getElementById('toast');
        if (!t) return;
        t.innerHTML = msg;
        t.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => t.classList.remove('show'), 4500);
    }
    async function copiar(txt, ok) {
        try { await navigator.clipboard.writeText(txt); toast(ok); }
        catch (_) { toast('O navegador bloqueou a cópia. Abra a cotação e copie o texto em "Todos os campos da planilha".'); }
    }
    function copiarItens(c) {
        const its = itens(c);
        copiar(its.map(it => `${it.nome}\t${it.qtd}${it.codigo ? '\t' + it.codigo : ''}`).join('\n'),
            `${its.length} ${its.length === 1 ? 'item copiado' : 'itens copiados'}. Cole direto no Excel ou no portal.`);
    }

    // ---------- dados do socket ----------
    function receber(novaLista) {
        const antes = new Set(estado.lista.map(id));
        estado.lista = registrar(novaLista || []);
        const agora = new Set(estado.lista.map(id));
        if (estado.carregado) {
            const chegaram = estado.lista.filter(c => !antes.has(id(c)));
            chegaram.forEach(c => estado.novos.add(id(c)));
            if (chegaram.length === 1) toast(`Nova cotação atribuída a você: <b>${esc(numero(chegaram[0]).num)}</b>. <button type="button" class="button text small" data-acao="abrir" data-id="${id(chegaram[0])}">Abrir</button>`);
            else if (chegaram.length > 1) toast(`${chegaram.length} novas cotações atribuídas a você.`);
        }
        estado.selecionadas = new Set([...estado.selecionadas].filter(k => agora.has(k)));
        estado.carregado = true;
        estado.erro = '';
        redesenhar();
    }
    function falhou(msg) {
        estado.erro = msg || 'erro desconhecido';
        if (estado.carregado) toast(`Não foi possível atualizar: ${esc(estado.erro)}`);
        redesenhar();
    }
    function conexao(ok) {
        const el = document.getElementById('mc-conexao');
        if (!el) return;
        el.classList.toggle('off', !ok);
        el.lastElementChild.textContent = ok ? 'Ao vivo' : 'Reconectando…';
    }

    // ---------- ações ----------
    function abrir(v) { estado.aberta = Number(v); estado.confirmando = false; estado.respondeuAgora = null; estado.novos.delete(Number(v)); redesenhar(); }
    function fechar() { estado.aberta = null; estado.confirmando = false; estado.respondeuAgora = null; redesenhar(); }
    function navegar(passo) {
        const l = filtradas();
        if (!l.length) return;
        const i = l.findIndex(c => id(c) === estado.aberta);
        abrir(id(l[i < 0 ? 0 : (i + passo + l.length) % l.length]));
    }
    function proximaPendente() {
        const l = filtradas(), i = l.findIndex(c => id(c) === estado.aberta);
        return [...l.slice(i + 1), ...l.slice(0, Math.max(i, 0))].find(c => !respondida(c) && id(c) !== estado.aberta);
    }
    function mudar(campos) { Object.assign(estado, campos); lembrar(); redesenhar(); }
    const LIMPO = { prazo: { prazo: '', dia: null, de: '', ate: '' }, locais: { locais: [] }, marcas: { marcas: [] } };

    // as exportações da página leem window.cotacoesFiltradas: aqui vira o que o vendedor escolheu (seleção ou fila filtrada)
    function exportarLista(tipo) {
        window.cotacoesFiltradas = alvoExportacao();
        return tipo === 'word' ? exportarMinhasCotacoesWord() : exportarMinhasCotacoesExcel();
    }
    function confirmarResposta(c) {
        const k = id(c), marcada = { ...c, RESPOSTA: 'RESPONDIDO' };
        ID.set(marcada, k);
        estado.lista = estado.lista.map(x => (x === c ? marcada : x)); // otimista: a recarga do socket confirma
        estado.confirmando = false;
        estado.respondeuAgora = k;
        marcarComoRespondida(c);
        redesenhar();
        toast(`Cotação <b>${esc(numero(c).num)}</b> marcada como respondida.`);
    }

    const ACOES = {
        abrir: el => abrir(el.dataset.id),
        fechar,
        anterior: () => navegar(-1),
        proxima: () => navegar(1),
        atualizar: () => { estado.erro = ''; carregarMinhasCotacoes(); toast('Buscando suas cotações na planilha…'); },
        sair: () => fazerLogout(),
        status: el => mudar({ status: estado.status === el.dataset.status ? 'todas' : el.dataset.status }),
        prazo: el => mudar({ ...LIMPO.prazo, prazo: el.dataset.valor, pop: null }),
        ordem: el => mudar({ ordem: el.dataset.valor, pop: null }),
        dia: el => { const d = Number(el.dataset.dia); mudar(estado.prazo === 'dia' && estado.dia === d ? LIMPO.prazo : { ...LIMPO.prazo, prazo: 'dia', dia: d }); },
        local: el => { const v = el.dataset.valor; mudar({ locais: estado.locais.includes(v) ? estado.locais.filter(x => x !== v) : [...estado.locais, v] }); },
        'limpar-campo': el => mudar(LIMPO[el.dataset.campo]),
        'limpar-filtros': () => mudar({ ...LIMPO.prazo, ...LIMPO.locais, ...LIMPO.marcas, busca: '', status: 'todas' }),
        'limpar-sel': () => { estado.selecionadas.clear(); redesenhar(); },
        word: (el, c) => exportarCotacaoWordCore(c, el),
        base: (el, c) => exportarCotacaoPlanilhaBase(c),
        copiar: (el, c) => copiarItens(c),
        'copiar-num': (el, c) => copiar(numero(c).num, `Número <b>${esc(numero(c).num)}</b> copiado.`),
        responder: () => { estado.confirmando = true; redesenhar(); },
        'cancelar-resp': () => { estado.confirmando = false; redesenhar(); },
        'confirmar-resp': (el, c) => confirmarResposta(c),
        'exp-excel': () => exportarLista('excel'),
        'exp-word': () => exportarLista('word'),
    };
    // ações sobre uma cotação que sumiu numa recarga do socket não fazem nada
    const PRECISA_COTACAO = ['word', 'base', 'copiar', 'copiar-num', 'confirmar-resp'];

    document.addEventListener('click', e => {
        document.querySelectorAll('details.pc-pop[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
        const alvo = e.target.closest('[data-acao]');
        if (!alvo) { if (e.target.id === 'pc-modal') fechar(); return; }
        const fazer = ACOES[alvo.dataset.acao];
        if (!fazer) return; // "sel" e "menu": só não deixam o clique abrir o cartão
        const pop = alvo.closest('details.pc-pop');
        if (pop && alvo.tagName === 'BUTTON') pop.open = false;
        const c = porId(alvo.dataset.id);
        if (PRECISA_COTACAO.includes(alvo.dataset.acao) && !c) return;
        fazer(alvo, c);
    });
    document.addEventListener('toggle', e => {
        const d = e.target;
        if (d.id === 'b-visao') { visaoAberta = d.open; gravar('minhas_cotacoes_visao', d.open ? '1' : '0'); return; }
        if (!d.classList || !d.classList.contains('pc-pop')) return;
        if (d.open) {
            estado.pop = d.id;
            document.querySelectorAll('details.pc-pop[open]').forEach(o => { if (o !== d) o.open = false; });
            d.querySelector('.pc-pop-busca')?.focus();
        } else if (estado.pop === d.id) estado.pop = null;
    }, true);
    document.addEventListener('change', e => {
        const t = e.target;
        if (t.dataset.multi) {
            const v = estado[t.dataset.multi];
            mudar({ [t.dataset.multi]: t.checked ? [...v, t.value] : v.filter(x => x !== t.value) });
        } else if (t.dataset.data) {
            const datas = { de: estado.de, ate: estado.ate, [t.dataset.data]: t.value };
            mudar({ ...datas, dia: null, prazo: datas.de || datas.ate ? 'periodo' : '' });
        } else if (t.dataset.sel) {
            const k = Number(t.dataset.sel);
            if (t.checked) estado.selecionadas.add(k); else estado.selecionadas.delete(k);
            redesenhar();
        }
    });
    document.addEventListener('input', e => {
        const t = e.target;
        if (t.hasAttribute('data-pop-busca')) {
            const q = t.value.trim().toLowerCase();
            t.parentElement.querySelectorAll('.pc-pop-lista label').forEach(l => { l.hidden = !!q && !l.dataset.valor.includes(q); });
            return;
        }
        if (t.id !== 'pc-busca') return;
        estado.busca = t.value;
        const pos = t.selectionStart;
        redesenhar();
        const novo = document.getElementById('pc-busca');
        if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    });
    document.addEventListener('keydown', e => {
        const digitando = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
        const popAberto = document.querySelector('details.pc-pop[open]');
        if (e.key === '/' && !digitando) { e.preventDefault(); document.getElementById('pc-busca')?.focus(); }
        else if (e.key === 'Escape') {
            if (popAberto) { popAberto.open = false; popAberto.querySelector('summary').focus(); }
            else if (digitando) document.activeElement.blur();
            else fechar();
        } else if (!digitando && estado.aberta && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            e.preventDefault(); navegar(e.key === 'ArrowRight' ? 1 : -1);
        } else if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('b-card')) {
            abrir(e.target.dataset.id);
        }
    });

    const topo = document.getElementById('topo');
    if (topo) topo.innerHTML = nav();
    redesenhar();

    window.Tela = { estado, filtradas, contagem, itens, numero, dias, alvoExportacao, exportarLista, receber, falhou, conexao, toast, abrir, id };
})();
