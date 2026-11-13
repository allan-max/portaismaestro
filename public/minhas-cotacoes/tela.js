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

    const numeroDaBusca = () => estado.busca.trim().toUpperCase();
    const casaNumeroBusca = c => {
        const n = numeroDaBusca();
        return !!n && [String(c['COTAÇÃO'] ?? '').trim().toUpperCase(), numero(c).num.toUpperCase()].includes(n);
    };
    const ehDeOutro = c => estado.outros.includes(c);
    const seloOutro = c => (ehDeOutro(c) ? `<span class="pc-selo-outro" title="Cotação atribuída a outro vendedor">Cotação de ${esc(String(c.VENDEDOR || '').trim() || 'outro vendedor')}</span>` : '');

    // portal de origem vindo do gerenciador (só Coupa e Vale exibem o botão Responder na cotação aberta)
    function portalRobo(c) {
        if (!c) return '';
        const mapa = (typeof window !== 'undefined' && window.portaisRobo && Object.keys(window.portaisRobo).length ? window.portaisRobo : null) || estado.portais || {};
        const bruto = String(c['COTAÇÃO'] ?? '').trim();
        const limpo = numero(c).num;
        const outros = estado.portaisOutros || {};
        const p = String(mapa[bruto] || mapa[limpo] || outros[bruto] || outros[limpo] || c.PORTAL || c.portal || '').trim().toLowerCase();
        return (p === 'coupa' || p === 'vale') ? p : '';
    }

    function printsDe(c) {
        if (!c) return [];
        const mapaWin = (typeof window !== 'undefined' && window.printsRobo && typeof window.printsRobo === 'object') ? window.printsRobo : {};
        const mapa = { ...mapaWin, ...(estado.printsRobo || {}) };
        const bruto = String(c['COTAÇÃO'] ?? '').trim();
        const limpo = numero(c).num;
        const apenasDigitos = (bruto.match(/\d+/) || limpo.match(/\d+/) || [])[0] || '';

        let listaPrints = mapa[bruto] || mapa[limpo] || (apenasDigitos ? mapa[apenasDigitos] : null) || (c.id ? mapa[c.id] : null);
        if (!listaPrints && apenasDigitos) {
            for (const k in mapa) {
                const kDigitos = (k.match(/\d+/) || [])[0];
                if (kDigitos && kDigitos === apenasDigitos) {
                    listaPrints = mapa[k];
                    break;
                }
            }
        }
        return Array.isArray(listaPrints) ? listaPrints : [];
    }

    function formatarErroCurto(msg) {
        const raw = String(msg || '').replace(/<[^>]+>/g, '').trim();
        if (!raw) return '';
        const low = raw.toLowerCase();
        const motivos = [];
        const add = m => { if (m && !motivos.includes(m)) motivos.push(m); };

        // Se já vier em formato curto separado por " · "
        if (raw.length <= 70 && !low.includes('o portal recusou') && !low.includes('traceback') && !low.includes('exception')) {
            return raw;
        }

        if (low.includes('ncm não existe') || low.includes('ncm nao existe') || low.includes('ncm inexistente') || low.includes('ncm inválido') || low.includes('ncm invalido')) {
            add('NCM não existe');
        } else if (low.includes('faltou o ncm')) {
            add('Faltou o NCM');
        } else if (/\bncm\b/.test(low)) {
            add('NCM não existe');
        }
        if (low.includes('faltou a origem') || (/\borigem\b/.test(low) && (low.includes('vazio') || low.includes('faltou') || low.includes('obrigat')))) {
            add('Faltou a origem');
        } else if (/\borigem\b/.test(low)) {
            add('Origem inválida');
        }
        if (low.includes('valor errado') || (/(pre[çc]o|valor)/.test(low) && (low.includes('errado') || low.includes('inválido') || low.includes('invalido')))) {
            add('Valor errado');
        } else if (low.includes('faltou o valor') || /(pre[çc]o|valor)/.test(low)) {
            add('Faltou o valor');
        }
        if (low.includes('faltou o prazo') || (/(prazo|tempo de espera)/.test(low) && (low.includes('vazio') || low.includes('faltou') || low.includes('obrigat')))) {
            add('Faltou o prazo');
        } else if (/(prazo|tempo de espera)/.test(low)) {
            add('Prazo inválido');
        }
        if (/\bicms\b/.test(low)) add(low.includes('faltou') ? 'Faltou o ICMS' : 'ICMS inválido');
        if (/\bipi\b/.test(low)) add(low.includes('faltou') ? 'Faltou o IPI' : 'IPI inválido');
        if (/\bcofins\b/.test(low)) add(low.includes('faltou') ? 'Faltou o COFINS' : 'COFINS inválido');
        if (low.includes('encerrad') || low.includes('fechad') || low.includes('expirad')) add('Evento encerrado');

        if (motivos.length) return motivos.join(' · ');
        return raw.length > 60 ? raw.slice(0, 57).trim() + '…' : raw;
    }

    function erroDe(c) {
        if (!c) return '';
        const mapaWin = (typeof window !== 'undefined' && window.errosRobo && typeof window.errosRobo === 'object') ? window.errosRobo : {};
        const mapa = { ...mapaWin, ...(estado.errosResposta || {}) };
        const bruto = String(c['COTAÇÃO'] ?? '').trim();
        const limpo = numero(c).num;
        const apenasDigitos = (bruto.match(/\d+/) || limpo.match(/\d+/) || [])[0] || '';

        let msg = mapa[bruto] || mapa[limpo] || (apenasDigitos ? mapa[apenasDigitos] : '') || (c.id ? mapa[c.id] : '');
        if (!msg && apenasDigitos) {
            for (const k in mapa) {
                const kDigitos = (k.match(/\d+/) || [])[0];
                if (kDigitos && kDigitos === apenasDigitos && mapa[k]) {
                    msg = mapa[k];
                    break;
                }
            }
        }
        return formatarErroCurto(msg);
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
        if (d < 0) {
            return { d, txt: `Venceu há ${Math.abs(d)}d`, sub: c.VENCIMENTO, cls: 'red', urg: 1 };
        }
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
        selecionadas: new Set(), aberta: null, confirmando: false, respondeuAgora: null, novos: new Set(), pop: null, portais: {},
        respondendoPortal: false, respostas: {}, printsRobo: {}, captchaImagem: '', printViewer: null, errosResposta: {},
        // cotações de OUTRO vendedor achadas pela busca do número exato (permissão conferida no servidor)
        outros: [], outrosNumero: '', portaisOutros: {},
    };
    function dadosResposta(c) {
        if (!c) return null;
        const k = id(c);
        if (!estado.respostas[k]) {
            estado.respostas[k] = {
                planilhaNome: '',
                planilhaArquivo: null,   // com "Gerar DAV com base na planilha", vai ao Cotafrete
                gerarDavPlanilha: false,
                planilhaErro: '',
                carregandoPlanilha: false,
                davs: [],
                datasheets: [],
                datasheetPorLinha: false,
                datasheetsPorItem: {},
                itens: [],
                enviando: false,
                enviado: false,
            };
        }
        return estado.respostas[k];
    }
    function alternarDatasheetPorLinha(k, ativo) {
        const c = porId(k);
        if (!c) return;
        const d = dadosResposta(c);
        d.datasheetPorLinha = Boolean(ativo);
        if (d.datasheetPorLinha && !d.itens.length) {
            d.itens = itens(c).map((it, idx) => ({
                n: idx + 1,
                produto: it.nome || `Item ${idx + 1}`,
                quantidade: it.qtd || 1,
                preco: '',
                prazo: '',
                ncm: '',
                origem: '',
                icms: '',
            }));
        }
        redesenhar();
    }
    const lembrar = () => gravar(CHAVE, JSON.stringify(Object.fromEntries(LEMBRAR.map(k => [k, estado[k]]))));
    const LIMITE_PRAZO = { hoje: 0, '7': 7, '15': 15, '30': 30 };
    function passaPrazo(c) {
        const p = estado.prazo;
        if (p === 'dia') return dias(c) === estado.dia;
        if (p === 'periodo') { const iso = isoDe(c); return (!estado.de || iso >= estado.de) && (!estado.ate || iso <= estado.ate); }
        if (p === 'hoje') return dias(c) === 0;
        if (p in LIMITE_PRAZO) return dias(c) >= 0 && dias(c) <= LIMITE_PRAZO[p];
        return true;
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
        // cotação de outro vendedor: só com o número exato na busca, e aí ignora os filtros
        const jaTem = new Set(r.map(id));
        r.push(...estado.outros.filter(c => casaNumeroBusca(c) && !jaTem.has(id(c))));
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
    const porId = v => estado.lista.find(c => id(c) === Number(v)) || estado.outros.find(c => id(c) === Number(v));
    const alvoExportacao = () => (estado.selecionadas.size ? estado.lista.filter(c => estado.selecionadas.has(id(c))) : filtradas());

    // ---------- pedaços de tela ----------
    const ICONES = {
        busca: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
        baixar: '<path d="M12 3v12m0 0 5-5m-5 5-5-5M4 21h16"/>',
        excel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m8 8 8 8M16 8l-8 8"/>',
        word: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13l1.5 5 2.5-4 2.5 4 1.5-5"/>',
        base: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
        copiar: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
        responder: '<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>',
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
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
        pdf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 15h6M9 11h3"/>',
        enviar: '<path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4 20-7z"/>',
    };
    const icone = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n] || ''}</svg>`;

    function nav() {
        const nome = (vendedorLogado || '').toUpperCase();
        return `<nav class="dash-nav pc-nav" aria-label="Topo">
            <a class="brand" href="minhas_cotacoes.html"><span class="brand-logo"><img src="img/logo-maestro-dashboard.png" alt=""></span><span class="brand-texto">MAESTRO</span></a>
            <div class="dash-nav-links" style="overflow:visible;">
                <a href="minhas_cotacoes.html" aria-current="page">${icone('cotacoes')}<span>Minhas cotações</span></a>
                ${(typeof temAcessoPlanilha !== 'undefined' && temAcessoPlanilha) ? `
                    <details class="pc-pop pc-nav-planilhas" id="pop-planilhas" style="position:relative; display:inline-flex;">
                        <summary class="pc-nav-btn-planilhas" style="list-style:none; display:flex; align-items:center; gap:7px; padding:8px 12px; border-radius:7px; color:var(--muted); font-size:12px; background:transparent; border:none; cursor:pointer; font-family:inherit; white-space:nowrap; user-select:none;">
                            ${icone('tabela')}<span>Planilhas</span>${icone('seta')}
                        </summary>
                        <div class="pc-menu pc-menu-planilhas" role="menu" style="position:absolute; left:0; right:auto; top:calc(100% + 6px); width:200px; z-index:100; background:#202b3c; border:1px solid #455469; border-radius:10px; box-shadow:0 16px 36px #0007; padding:6px; display:flex; flex-direction:column; gap:2px;">
                            <a href="planilha_vale.html" role="menuitem" style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:7px; text-decoration:none; color:var(--text); font-size:12px; font-weight:600; transition:background .15s;">
                                ${icone('base')}<span>Planilha Vale</span>
                            </a>
                            <a href="planilha_anmyna.html" role="menuitem" style="display:flex; align-items:center; gap:10px; padding:9px 12px; border-radius:7px; text-decoration:none; color:var(--text); font-size:12px; font-weight:600; transition:background .15s;">
                                ${icone('cotacoes')}<span>Planilha Anmyna</span>
                            </a>
                        </div>
                    </details>
                ` : ''}
                ${(typeof temAcessoPortais !== 'undefined' && temAcessoPortais) ? `<a href="index.html?portais=1">${icone('robo')}<span>Portais</span></a>` : ''}
                ${(typeof temAcessoEstatisticas !== 'undefined' && temAcessoEstatisticas) ? `<a href="dashboard2.html">${icone('cotacoes')}<span>Estatísticas</span></a>` : ''}
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

    function painelResponderPortal(c, portal) {
        if (!portal || !estado.respondendoPortal) return '';
        const k = id(c), d = dadosResposta(c);
        const listaArq = (arrArq, tipo) => arrArq.length
            ? `<div class="pc-drop-arquivos">${arrArq.map((a, idx) => `
                <div class="pc-drop-arq">
                    <span title="${esc(a.name)}">${icone('pdf')}<b>${esc(a.name)}</b></span>
                    <button type="button" class="pc-drop-rem" data-acao="remover-arq-resp" data-tipo="${tipo}" data-idx="${idx}" data-id="${k}" title="Remover arquivo" aria-label="Remover ${esc(a.name)}">${icone('fechar')}</button>
                </div>`).join('')}</div>`
            : '';

        const listaArqItem = (arrArq, idxItem) => arrArq && arrArq.length
            ? `<div class="pc-drop-arquivos">${arrArq.map((a, idx) => `
                <div class="pc-drop-arq">
                    <span title="${esc(a.name)}">${icone('pdf')}<b>${esc(a.name)}</b></span>
                    <button type="button" class="pc-drop-rem" data-acao="remover-arq-resp-item" data-item-idx="${idxItem}" data-idx="${idx}" data-id="${k}" title="Remover arquivo" aria-label="Remover ${esc(a.name)}">${icone('fechar')}</button>
                </div>`).join('')}</div>`
            : '';

        const secaoItens = d.itens.length
            ? `<div class="pc-resp-itens-wrap" id="pc-resp-itens-preview">
                <div class="pc-resp-itens-head">
                    <h4>Informações da Planilha Base <span class="nav-count">${d.itens.length} ${d.itens.length === 1 ? 'item' : 'itens'}</span></h4>
                    <small>Confira os valores lidos da planilha ou edite qualquer campo abaixo antes de enviar.</small>
                </div>
                <div class="pc-resp-itens-lista">
                    ${d.itens.map((it, idx) => {
                        const dsItem = Array.isArray(d.datasheetsPorItem && d.datasheetsPorItem[idx]) ? d.datasheetsPorItem[idx] : [];
                        return `
                        <div class="pc-resp-item-card" data-item-idx="${idx}">
                            <div class="pc-resp-item-topo">
                                <span class="pc-item-n">${idx + 1}</span>
                                <strong>${esc(it.produto || `Item ${idx + 1}`)}</strong>
                                <span class="pc-qtd">Qtd: ${esc(it.quantidade ?? 1)}</span>
                            </div>
                            <div class="pc-resp-campos-grid">
                                <label class="pc-resp-campo">
                                    <span>Valor Unitário de Venda (R$)</span>
                                    <input type="text" data-resp-campo="preco" data-id="${k}" data-idx="${idx}" value="${esc(it.preco)}" placeholder="0,00">
                                </label>
                                <label class="pc-resp-campo">
                                    <span>Prazo (Dias)</span>
                                    <input type="text" inputmode="numeric" data-resp-campo="prazo" data-id="${k}" data-idx="${idx}" value="${esc(it.prazo)}" placeholder="Ex: 15">
                                </label>
                                <label class="pc-resp-campo">
                                    <span>NCM</span>
                                    <input type="text" data-resp-campo="ncm" data-id="${k}" data-idx="${idx}" value="${esc(it.ncm || '')}" placeholder="Ex: 8413.70.90">
                                </label>
                                <label class="pc-resp-campo">
                                    <span>Origem</span>
                                    <input type="text" data-resp-campo="origem" data-id="${k}" data-idx="${idx}" value="${esc(it.origem)}" placeholder="Ex: 0 ou Nacional">
                                </label>
                                <label class="pc-resp-campo">
                                    <span>ICMS (%)</span>
                                    <input type="text" data-resp-campo="icms" data-id="${k}" data-idx="${idx}" value="${esc(it.icms)}" placeholder="Ex: 18">
                                </label>
                            </div>
                            ${d.datasheetPorLinha ? `
                                <div class="pc-resp-item-ds">
                                    <label class="pc-dropzone pc-dropzone-item ${dsItem.length ? 'preenchido' : ''}" id="drop-datasheet-item-${idx}" data-drop-tipo="datasheet-item" data-item-idx="${idx}" data-id="${k}">
                                        <input type="file" id="input-resp-datasheet-item-${idx}" data-resp-file="datasheet-item" data-item-idx="${idx}" data-id="${k}" accept=".pdf" multiple hidden>
                                        <span class="pc-drop-icone">${icone('upload')}</span>
                                        <span class="pc-drop-textos">
                                            <strong>Arraste o Datasheet (Item ${idx + 1})</strong>
                                            <small>${dsItem.length ? `${dsItem.length} anexado(s) · arraste ou clique para adicionar mais (.pdf)` : 'ou clique para selecionar um ou mais (.pdf)'}</small>
                                        </span>
                                    </label>
                                    ${listaArqItem(dsItem, idx)}
                                </div>
                            ` : ''}
                        </div>`;
                    }).join('')}
                </div>
            </div>`
            : '';

        return `<section class="pc-det-sec pc-resp-painel" id="painel-responder-cotacao" aria-label="Responder cotação">
            <div class="pc-resp-painel-topo">
                <div>
                    <h3>Responder no portal <span class="tag">${esc(portal.toUpperCase())}</span></h3>
                    <p>Arraste a Planilha Base e o Datasheet nos campos abaixo. Marque "Gerar DAV com base na planilha" para o Cotafrete gerar o DAV.</p>
                </div>
                <button type="button" class="button text small" data-acao="fechar-resp-portal" data-id="${k}">Fechar</button>
            </div>
            <div class="pc-drop-grid">
                <div class="pc-drop-col">
                    <div class="pc-drop-topo"></div>
                    <div class="pc-drop-corpo">
                    <label class="pc-dropzone ${d.planilhaNome ? 'preenchido' : ''}" id="drop-planilha-base" data-drop-tipo="planilha" data-id="${k}">
                        <input type="file" id="input-resp-planilha" data-resp-file="planilha" data-id="${k}" accept=".xlsx,.xls" hidden>
                        <span class="pc-drop-icone">${icone('base')}</span>
                        <strong>Arraste a Planilha Base</strong>
                        <small>${d.carregandoPlanilha ? 'Lendo planilha…' : 'ou clique para selecionar (.xlsx)'}</small>
                    </label>
                    ${d.planilhaNome ? `<div class="pc-drop-arquivos"><div class="pc-drop-arq ok"><span title="${esc(d.planilhaNome)}">${icone('excel')}<b>${esc(d.planilhaNome)}</b></span><button type="button" class="pc-drop-rem" data-acao="limpar-planilha-resp" data-id="${k}" title="Remover planilha" aria-label="Remover planilha">${icone('fechar')}</button></div></div>` : ''}
                    ${d.planilhaErro ? `<small class="pc-drop-erro">${esc(d.planilhaErro)}</small>` : ''}
                    </div>
                </div>
                <div class="pc-drop-col">
                    <label class="pc-check-ds-linha" title="Ao clicar em Enviar, o Cotafrete gera o DAV com a Planilha Base">
                        <input type="checkbox" class="pc-check" id="check-gerar-dav-planilha" data-check-gerar-dav="${k}" ${d.gerarDavPlanilha ? 'checked' : ''}>
                        <span>Gerar DAV com base na planilha</span>
                    </label>
                    <div class="pc-drop-corpo">${d.gerarDavPlanilha ? '' : `
                        <label class="pc-dropzone ${d.davs.length ? 'preenchido' : ''}" id="drop-dav" data-drop-tipo="dav" data-id="${k}">
                            <input type="file" id="input-resp-dav" data-resp-file="dav" data-id="${k}" accept=".pdf" multiple hidden>
                            <span class="pc-drop-icone">${icone('upload')}</span>
                            <strong>Arraste o DAV</strong>
                            <small>ou clique para selecionar (.pdf)</small>
                        </label>
                        ${listaArq(d.davs, 'dav')}`}</div>
                </div>
                <div class="pc-drop-col">
                    <label class="pc-check-ds-linha" title="Anexar um Datasheet diferente em cada item do evento">
                        <input type="checkbox" class="pc-check" id="check-datasheet-por-linha" data-check-ds-linha="${k}" ${d.datasheetPorLinha ? 'checked' : ''}>
                        <span>Datasheet por linha</span>
                    </label>
                    <div class="pc-drop-corpo">${!d.datasheetPorLinha ? `
                        <label class="pc-dropzone ${d.datasheets.length ? 'preenchido' : ''}" id="drop-datasheet" data-drop-tipo="datasheet" data-id="${k}">
                            <input type="file" id="input-resp-datasheet" data-resp-file="datasheet" data-id="${k}" accept=".pdf" multiple hidden>
                            <span class="pc-drop-icone">${icone('upload')}</span>
                            <strong>Arraste o Datasheet</strong>
                            <small>${d.datasheets.length ? `${d.datasheets.length} anexado(s) · arraste ou clique para adicionar mais (.pdf)` : 'ou clique para selecionar um ou mais (.pdf)'}</small>
                        </label>
                        ${listaArq(d.datasheets, 'datasheet')}
                    ` : ''}</div>
                </div>
            </div>
            ${secaoItens}
            <div class="pc-resp-rodape">
                <button type="button" class="button text" data-acao="fechar-resp-portal" data-id="${k}">Cancelar</button>
                <button type="button" class="button primary" id="btn-enviar-resposta-portal" data-acao="enviar-resp-portal" data-id="${k}" ${d.enviando || !d.itens.length ? 'disabled' : ''}>
                    ${icone('enviar')}<span>${d.enviando ? 'Enviando para a fila…' : 'Enviar Resposta'}</span>
                </button>
            </div>
        </section>`;
    }


    function bannerErroResposta(c) {
        if (!c) return '';
        const erroEv = erroDe(c);
        if (!erroEv) return '';
        return `<div class="pc-alerta-erro-evento" id="alerta-erro-evento" role="alert" aria-label="Erro ao responder evento: ${esc(erroEv)}">
            <span class="pc-alerta-erro-dot" aria-hidden="true"></span>
            <span class="pc-alerta-erro-label">Não respondido:</span>
            <strong class="pc-alerta-erro-msg">${esc(erroEv)}</strong>
        </div>`;
    }

    function receberErroResposta(eventoId, erro) {
        const chave = String(eventoId || '').replace(/^Evento\s+/i, '').trim();
        if (!chave) return;
        const msgCurta = formatarErroCurto(erro);
        if (!msgCurta) return;
        estado.errosResposta[chave] = msgCurta;
        const limpo = chave.replace(/\D+/g, '');
        if (limpo) estado.errosResposta[limpo] = msgCurta;
        if (typeof window !== 'undefined' && window.errosRobo && typeof window.errosRobo === 'object') {
            window.errosRobo[chave] = msgCurta;
            if (limpo) window.errosRobo[limpo] = msgCurta;
        }
        redesenhar();
    }

    function limparErroResposta(eventoId) {
        const chave = String(eventoId || '').replace(/^Evento\s+/i, '').trim();
        if (!chave) return;
        const limpo = chave.replace(/\D+/g, '');
        const apagarDe = (mapa) => {
            if (!mapa || typeof mapa !== 'object') return;
            delete mapa[chave];
            if (limpo) delete mapa[limpo];
            for (const k of Object.keys(mapa)) {
                const kLimpo = String(k).replace(/\D+/g, '');
                if (k === chave || (limpo && kLimpo === limpo)) {
                    delete mapa[k];
                }
            }
        };
        apagarDe(estado.errosResposta);
        if (typeof window !== 'undefined' && window.errosRobo) {
            apagarDe(window.errosRobo);
        }
        redesenhar();
    }

    // ---------- DAV gerado pelo Cotafrete (server.js: status_dav_atualizado / dav_robo) ----------
    function davDe(c) {
        if (!c) return null;
        const mapa = (typeof window !== 'undefined' && window.davRobo && typeof window.davRobo === 'object') ? window.davRobo : {};
        const bruto = String(c['COTAÇÃO'] ?? '').trim();
        const limpo = numero(c).num;
        const digitos = (bruto.match(/\d+/) || limpo.match(/\d+/) || [])[0] || '';
        return mapa[bruto] || mapa[limpo] || (digitos ? mapa[digitos] : null) || null;
    }

    const TITULO_DAV = { gerando: 'Gerando DAV…', erro: 'Erro no DAV', pronto: 'DAV pronto' };

    function tituloDav(s) {
        if (s.estado === 'pronto' && s.numero) return `DAV ${s.numero} pronto`;
        return TITULO_DAV[s.estado] || 'DAV';
    }

    function bannerDav(c) {
        const s = davDe(c);
        if (!s || !TITULO_DAV[s.estado]) return '';
        const lista = (titulo, itens) => (Array.isArray(itens) && itens.length)
            ? `<div class="pc-dav-lista"><b>${titulo}</b><ul>${itens.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
        // a ponte monta a mensagem juntando os motivos: com a lista na tela, não repete o mesmo texto
        const repetida = s.estado === 'erro' && Array.isArray(s.erros) && s.erros.length && s.mensagem === s.erros.join(' · ');
        return `<div class="pc-dav-status ${esc(s.estado)}" id="status-dav-evento" role="${s.estado === 'erro' ? 'alert' : 'status'}" aria-live="polite">
            <strong class="pc-dav-titulo">${esc(tituloDav(s))}</strong>
            ${s.mensagem && !repetida ? `<span class="pc-dav-msg">${esc(s.mensagem)}</span>` : ''}
            ${s.estado === 'erro' ? lista('Motivos', s.erros) : ''}
            ${lista('Avisos', s.avisos)}
        </div>`;
    }

    function receberStatusDav(eventoId, status) {
        const chave = String(eventoId || '').replace(/^Evento\s+/i, '').trim();
        if (!chave || typeof window === 'undefined') return;
        if (!window.davRobo || typeof window.davRobo !== 'object') window.davRobo = {};
        const limpo = chave.replace(/\D+/g, '');
        for (const k of [chave, limpo]) {
            if (!k) continue;
            if (status) window.davRobo[k] = status;
            else delete window.davRobo[k];
        }
        redesenhar();
    }

    function secaoPrintsEvento(c) {
        const prints = printsDe(c);
        if (!prints.length) return '';
        const cid = id(c);
        return `<section class="pc-det-sec pc-prints-sec" id="prints-itens-respondidos" aria-label="Prints dos itens respondidos">
            <h3>Prints dos itens respondidos <span class="nav-count">${prints.length} ${prints.length === 1 ? 'item' : 'itens'}</span></h3>
            <div class="pc-prints-grid">
                ${prints.map((p, idx) => {
                    const numItem = p.item || (idx + 1);
                    const src = String(p.imagem || '').startsWith('data:image') ? p.imagem : `data:image/png;base64,${p.imagem || ''}`;
                    return `<figure class="pc-print-card" data-print-item="${numItem}">
                        <figcaption>
                            <b>Item ${esc(numItem)}</b>
                            <span>${p.preco ? `R$ ${esc(p.preco)}` : ''}${p.preco && p.prazo ? ' · ' : ''}${p.prazo ? `${esc(p.prazo)}d` : ''}</span>
                        </figcaption>
                        <div class="pc-print-link" data-acao="abrir-print" data-id="${cid}" data-idx="${idx}" title="Clique para abrir e ampliar a print do Item ${esc(numItem)}">
                            <img src="${esc(src)}" alt="Print do Item ${esc(numItem)} respondido" loading="lazy">
                            <div class="pc-print-zoom-hint">🔍 Clique para Ampliar</div>
                        </div>
                    </figure>`;
                }).join('')}
            </div>
        </section>`;
    }

    function painelCaptchaGlobal() {
        if (!estado.captchaImagem) return '';
        const src = String(estado.captchaImagem).startsWith('data:image')
            ? estado.captchaImagem
            : `data:image/png;base64,${estado.captchaImagem}`;
        return `<section class="panel pc-captcha-banner" id="painel-captcha-vendedores" role="alert" aria-live="assertive">
            <div class="pc-captcha-topo">
                <div>
                    <div class="eyebrow">Intervenção de segurança solicitada pelo portal</div>
                    <h2>⚠️ Desafio Captcha Detectado</h2>
                    <p>Qualquer vendedor pode clicar na imagem abaixo para responder ao Captcha e liberar o robô.</p>
                </div>
                <button type="button" class="button text small" data-acao="fechar-captcha">Ocultar</button>
            </div>
            <div class="pc-captcha-palco">
                <img id="imagem-captcha-vendedor" src="${esc(src)}" alt="Desafio Captcha do Portal">
            </div>
        </section>`;
    }

    function detalhe(c) {
        const p = prazo(c), its = itens(c), resp = respondida(c), { num, origem } = numero(c), portal = portalRobo(c);
        return `<div class="pc-det">
            <header class="pc-det-topo">
                <div class="eyebrow">Cotação · ${esc(localDe(c))}${origem ? ` · ${esc(origem)}` : ''}${c.ORIGEM_PLANILHA === 'anmyna' ? ' · Planilha Anmyna' : ''}</div>
                <div class="pc-det-num"><h2>${esc(num)}</h2><button type="button" class="icon-button" data-acao="copiar-num" data-id="${id(c)}" title="Copiar número">${icone('copiar')}</button>${seloOutro(c)}</div>
                ${num !== String(c['COTAÇÃO'] ?? '').trim() ? `<small class="pc-det-orig">Na planilha: ${esc(c['COTAÇÃO'])}</small>` : ''}
                <div class="pc-det-linha">${statusTag(c)}<span class="pc-prazo ${p.cls}">${icone('relogio')}<b>${p.txt}</b>${p.sub ? ` · ${esc(p.sub)}` : ''}</span></div>
                <div class="pc-urg ${p.cls}" title="Quanto mais cheia, mais perto do vencimento"><i style="--w:${resp ? 0 : Math.round(p.urg * 100)}%"></i></div>
            </header>
            <div class="pc-acoes">
                <button type="button" class="button" data-acao="copiar" data-id="${id(c)}">${icone('copiar')}Copiar itens</button>
                <button type="button" class="button" data-acao="word" data-id="${id(c)}">${icone('word')}Word Coupa</button>
                <button type="button" class="button" id="btn-exportar-planilha-base" data-acao="base" data-id="${id(c)}">${icone('base')}Planilha Base</button>
                ${portal ? `<button type="button" class="button ${estado.respondendoPortal ? 'primary' : ''}" id="btn-responder-cotacao" data-acao="responder-portal" data-portal="${portal}" data-id="${id(c)}" aria-pressed="${estado.respondendoPortal}">${icone('responder')}Responder</button>` : ''}
                ${botaoResposta(c)}
            </div>
            ${bannerErroResposta(c)}
            ${bannerDav(c)}
            ${painelResponderPortal(c, portal)}
            ${secaoPrintsEvento(c)}
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
    // lightbox ampliado para inspecionar as prints dos itens respondidos
    function janelaLightboxPrint() {
        let el = document.getElementById('pc-lightbox-print');
        if (!estado.printViewer) {
            if (el) el.remove();
            if (!estado.aberta) document.body.classList.remove('pc-travado');
            return;
        }
        const c = porId(estado.printViewer.cotacaoId);
        if (!c) {
            if (el) el.remove();
            return;
        }
        const prints = printsDe(c);
        if (!prints.length) {
            if (el) el.remove();
            return;
        }
        const idx = Math.max(0, Math.min(estado.printViewer.index, prints.length - 1));
        const p = prints[idx];
        if (!p) {
            if (el) el.remove();
            return;
        }
        const numItem = p.item || (idx + 1);
        const numCot = numero(c).num;
        const src = String(p.imagem || '').startsWith('data:image') ? p.imagem : `data:image/png;base64,${p.imagem || ''}`;
        const zoom = estado.printViewer.zoom || 1;

        if (!el) {
            el = document.createElement('div');
            el.id = 'pc-lightbox-print';
            el.className = 'pc-lightbox-fundo';
            document.body.appendChild(el);
        }
        document.body.classList.add('pc-travado');

        el.innerHTML = `
            <div class="pc-lightbox-barra">
                <div class="pc-lightbox-info">
                    <span class="pc-lightbox-icone">📸</span>
                    <div class="pc-lightbox-textos">
                        <h4>Print do Portal · Item ${esc(numItem)}</h4>
                        <div class="pc-lightbox-sub">
                            <span>Cotação <b>${esc(numCot)}</b></span>
                            ${p.preco ? `<span class="pc-lb-badge preco">R$ ${esc(p.preco)}</span>` : ''}
                            ${p.prazo ? `<span class="pc-lb-badge prazo">${esc(p.prazo)} dias</span>` : ''}
                            <span class="pc-lb-contador">(${idx + 1} de ${prints.length})</span>
                        </div>
                    </div>
                </div>
                <div class="pc-lightbox-botoes">
                    <button type="button" class="pc-lb-btn" data-acao="lb-zoom-out" title="Reduzir zoom (-)">🔍−</button>
                    <button type="button" class="pc-lb-btn" data-acao="lb-zoom-reset" title="Tamanho normal (100%)" id="pc-lb-zoom-nivel">${Math.round(zoom * 100)}%</button>
                    <button type="button" class="pc-lb-btn" data-acao="lb-zoom-in" title="Aumentar zoom (+)">🔍+</button>
                    <button type="button" class="pc-lb-btn pc-lb-btn-destaque" data-acao="lb-nova-aba" title="Abrir imagem em tamanho real em uma nova aba">↗ Nova Aba</button>
                    <button type="button" class="pc-lb-btn" data-acao="lb-baixar" title="Baixar imagem no computador">💾 Baixar</button>
                    <button type="button" class="pc-lb-fechar" data-acao="fechar-lb-print" title="Fechar visualizador (Esc)">✕</button>
                </div>
            </div>
            <div class="pc-lightbox-palco" id="pc-lb-palco" data-acao="fechar-lb-se-fundo">
                ${prints.length > 1 ? `<button type="button" class="pc-lb-nav pc-lb-nav-prev" data-acao="lb-prev" title="Item anterior (←)">❮</button>` : ''}
                <div class="pc-lightbox-img-wrap" id="pc-lb-img-wrap" data-acao="fechar-lb-se-fundo">
                    <img id="pc-lb-imagem-alvo" src="${esc(src)}" alt="Print Item ${esc(numItem)}" style="transform: scale(${zoom});">
                </div>
                ${prints.length > 1 ? `<button type="button" class="pc-lb-nav pc-lb-nav-next" data-acao="lb-next" title="Próximo item (→)">❯</button>` : ''}
            </div>
        `;
    }

    function abrirVisualizadorPrint(c, idx) {
        if (!c) return;
        const cid = id(c);
        const lista = printsDe(c);
        if (!lista || !lista.length) return;
        const i = Math.max(0, Math.min(Number(idx || 0), lista.length - 1));
        estado.printViewer = { cotacaoId: cid, index: i, zoom: 1 };
        redesenhar();
    }

    function fecharVisualizadorPrint() {
        if (!estado.printViewer) return;
        estado.printViewer = null;
        redesenhar();
    }

    function zoomVisualizadorPrint(delta) {
        if (!estado.printViewer) return;
        const novo = Math.max(0.5, Math.min(3.0, (estado.printViewer.zoom || 1) + delta));
        estado.printViewer.zoom = Math.round(novo * 100) / 100;
        const img = document.getElementById('pc-lb-imagem-alvo');
        const badge = document.getElementById('pc-lb-zoom-nivel');
        if (img) img.style.transform = `scale(${estado.printViewer.zoom})`;
        if (badge) badge.textContent = `${Math.round(estado.printViewer.zoom * 100)}%`;
    }

    function resetZoomVisualizadorPrint() {
        if (!estado.printViewer) return;
        estado.printViewer.zoom = 1;
        const img = document.getElementById('pc-lb-imagem-alvo');
        const badge = document.getElementById('pc-lb-zoom-nivel');
        if (img) img.style.transform = 'scale(1)';
        if (badge) badge.textContent = '100%';
    }

    function navVisualizadorPrint(dir) {
        if (!estado.printViewer) return;
        const c = porId(estado.printViewer.cotacaoId);
        if (!c) return;
        const prints = printsDe(c);
        if (!prints.length) return;
        const total = prints.length;
        let prox = (estado.printViewer.index + dir) % total;
        if (prox < 0) prox = total - 1;
        estado.printViewer.index = prox;
        estado.printViewer.zoom = 1;
        redesenhar();
    }

    function abrirVisualizadorPrintNovaAba() {
        if (!estado.printViewer) return;
        const c = porId(estado.printViewer.cotacaoId);
        if (!c) return;
        const prints = printsDe(c);
        const p = prints[estado.printViewer.index];
        if (!p) return;
        abrirPrintEmNovaAba(p.imagem, `Item_${p.item || estado.printViewer.index + 1}_Cotacao_${numero(c).num}`);
    }

    function baixarPrintVisualizador() {
        if (!estado.printViewer) return;
        const c = porId(estado.printViewer.cotacaoId);
        if (!c) return;
        const prints = printsDe(c);
        const p = prints[estado.printViewer.index];
        if (!p) return;
        const itemNum = p.item || (estado.printViewer.index + 1);
        const numCot = numero(c).num || 'evento';
        const src = String(p.imagem || '');
        const b64 = src.includes(',') ? src.split(',')[1] : src;
        const mime = src.includes('image/jpeg') ? 'image/jpeg' : 'image/png';
        const ext = mime === 'image/jpeg' ? 'jpg' : 'png';
        try {
            const byteCharacters = atob(b64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mime });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `Print_Item_${itemNum}_${numCot}.${ext}`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(blobUrl);
            }, 2000);
        } catch (_) {
            toast('Erro ao preparar download da print.');
        }
    }

    function abrirPrintEmNovaAba(base64OuData, titulo) {
        if (!base64OuData) return;
        const src = String(base64OuData);
        const b64 = src.includes(',') ? src.split(',')[1] : src;
        const mime = src.includes('image/jpeg') ? 'image/jpeg' : 'image/png';
        try {
            const byteCharacters = atob(b64);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: mime });
            const blobUrl = URL.createObjectURL(blob);
            const win = window.open(blobUrl, '_blank');
            if (!win) {
                toast('O navegador bloqueou a abertura de nova aba. Permita popups para este site.');
            }
            setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
        } catch (e) {
            const win = window.open('', '_blank');
            if (win && win.document) {
                win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(titulo || 'Print do Portal')}</title><style>body{margin:0;background:#0b0f19;display:flex;align-items:center;justify-content:center;min-height:100vh;}img{max-width:100%;height:auto;box-shadow:0 10px 40px rgba(0,0,0,0.5);}</style></head><body><img src="${esc(src.startsWith('data:') ? src : `data:image/png;base64,${src}`)}"></body></html>`);
                win.document.close();
            } else {
                toast('Não foi possível abrir a imagem em nova aba.');
            }
        }
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
        const erroMsg = erroDe(c);
        const blocoErroCard = erroMsg
            ? `<div class="b-erro-card" id="erro-card-${k}" role="alert" aria-label="Erro ao responder: ${esc(erroMsg)}">
                <span class="b-erro-ponto" aria-hidden="true"></span>
                <span class="b-erro-txt">${esc(erroMsg)}</span>
            </div>`
            : '';
        const dav = davDe(c);
        const blocoDavCard = dav && TITULO_DAV[dav.estado]
            ? `<div class="b-dav-card ${esc(dav.estado)}" id="dav-card-${k}">${esc(tituloDav(dav))}</div>`
            : '';
        const prints = printsDe(c);
        const blocoPrintsCard = prints.length
            ? `<div class="b-prints-card" id="prints-card-${k}" aria-label="Prints dos itens respondidos">
                <div class="b-prints-titulo"><span>📸 ${prints.length} ${prints.length === 1 ? 'item salvo' : 'itens salvos'}</span></div>
                <div class="b-prints-lista">
                    ${prints.map((pr, idx) => {
                        const nItem = pr.item || (idx + 1);
                        const src = String(pr.imagem || '').startsWith('data:image') ? pr.imagem : `data:image/png;base64,${pr.imagem || ''}`;
                        return `<div class="b-print-thumb" data-acao="abrir-print" data-id="${k}" data-idx="${idx}" title="Clique para ver a print do Item ${esc(nItem)}${pr.preco ? ` · R$ ${esc(pr.preco)}` : ''}">
                            <img src="${esc(src)}" alt="Print Item ${esc(nItem)}" loading="lazy">
                            <span>Item ${esc(nItem)}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`
            : '';
        return `<article class="b-card ${resp ? 'feita' : ''} ${erroMsg ? 'com-erro' : ''} ${novo ? 'pc-novo' : ''} ${primeira ? 'entra' : ''}" style="--i:${Math.min(i, 10) + 6};--cor:${erroMsg ? 'var(--red)' : (resp ? 'var(--green)' : COR[p.cls])}" data-acao="abrir" data-id="${k}" tabindex="0" aria-label="Cotação ${esc(num)}: ${esc(its[0].nome)}">
            <div class="b-num-linha">
                <span class="b-num" title="${esc(c['COTAÇÃO'])}">${esc(num)}</span>
                <button type="button" class="b-copiar-num" data-acao="copiar-num" data-id="${k}" title="Copiar número" aria-label="Copiar número ${esc(num)}">${icone('copiar')}</button>
                ${novo ? '<span class="pc-selo-novo">NOVA</span>' : ''}
                ${seloOutro(c)}
                <label class="b-sel" data-acao="sel" title="Selecionar para exportar"><input class="pc-check" type="checkbox" data-sel="${k}" ${estado.selecionadas.has(k) ? 'checked' : ''} aria-label="Selecionar cotação ${esc(num)}"></label>
            </div>
            ${origem ? `<div class="b-origem">${esc(origem)}</div>` : (c.ORIGEM_PLANILHA === 'anmyna' ? `<div class="b-origem" style="color: #a78bfa; font-weight: 600;">ANMYNA${c.PORTAL ? ` · ${esc(c.PORTAL)}` : ''}</div>` : '')}
            ${blocoErroCard}
            ${blocoDavCard}
            <div class="b-prazo"><span class="pc-prazo ${resp ? '' : p.cls}">${icone(resp ? 'ok' : 'relogio')}<b>${resp ? 'Respondida' : p.txt}</b>${!resp && p.d === 0 ? ` · ${esc(p.sub)}` : ''}</span>
                ${resp ? '' : `<div class="pc-urg ${p.cls}"><i style="--w:${Math.round(p.urg * 100)}%"></i></div>`}</div>
            <div class="b-nome">${esc(its[0].nome)}</div>
            <div class="b-chips"><span class="pc-qtd">${esc(qtd)}</span>${its[0].codigo ? `<span class="pc-cod">${esc(its[0].codigo)}</span>` : ''}${marcasDe(c) ? `<span class="tag">${esc(marcasDe(c))}</span>` : ''}${its.length > 1 ? `<span class="pc-mais" style="font-size:10px">+${its.length - 1} produto(s)</span>` : ''}</div>
            ${blocoPrintsCard}
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
            // só a cotação de outro vendedor achada pela busca exata pode estar vencida (a lista própria não traz vencidas)
            { titulo: 'Vencidas', sub: 'de outro vendedor', cor: '#5b6f88', cs: l.filter(c => ehDeOutro(c) && dias(c) < 0) },
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
            main.innerHTML = `${painelCaptchaGlobal()}<div class="mc-estado erro"><p>Não foi possível carregar suas cotações: ${esc(estado.erro)}</p><button type="button" class="button" data-acao="atualizar">Tentar de novo</button></div>`;
            return;
        }
        if (!estado.carregado) { main.innerHTML = `${painelCaptchaGlobal()}<div class="mc-estado">Carregando suas cotações…</div>`; return; }
        const n = contagem(), l = filtradas();
        const feitasHoje = n.hoje - n.hojePend, pct = Math.round(feitasHoje / Math.max(1, n.hoje) * 100);
        main.innerHTML = `
            ${painelCaptchaGlobal()}
            <div class="dash-titulo ${primeira ? 'entra' : ''}"><div><div class="eyebrow">Área do vendedor</div><h1>Minhas cotações</h1>
                <p>Comece por <b class="red">Vence hoje</b>. Clique num cartão para ver os produtos e exportar.</p></div>
                <div class="dash-estado"><a class="button" href="https://cotafrete.ventura.inf.br/dav" target="_blank" rel="noopener" title="Abrir o Gerar DAV no Cotafrete">GERAR DAV</a><button type="button" class="button" data-acao="atualizar" title="Buscar de novo na planilha">${icone('atualizar')}Atualizar</button>
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
    janelaLightboxPrint();
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
    function receber(novaLista, portais, prints, erros) {
        if (portais && typeof portais === 'object') estado.portais = portais;
        else if (typeof window !== 'undefined' && window.portaisRobo && typeof window.portaisRobo === 'object') estado.portais = window.portaisRobo;
        if (prints && typeof prints === 'object') estado.printsRobo = { ...estado.printsRobo, ...prints };
        else if (typeof window !== 'undefined' && window.printsRobo && typeof window.printsRobo === 'object') estado.printsRobo = { ...estado.printsRobo, ...window.printsRobo };
        if (erros && typeof erros === 'object') estado.errosResposta = { ...estado.errosResposta, ...erros };
        else if (typeof window !== 'undefined' && window.errosRobo && typeof window.errosRobo === 'object') estado.errosResposta = { ...estado.errosResposta, ...window.errosRobo };
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
        // a planilha mudou: a cotação de outro vendedor na tela também precisa do status novo
        if (estado.outros.length && typeof window !== 'undefined' && window.buscarCotacaoOutroVendedor) window.buscarCotacaoOutroVendedor(estado.outrosNumero);
    }

    // ---------- busca exata de cotação de outro vendedor ----------
    let timerBuscaOutros = null;
    function agendarBuscaOutros() {
        clearTimeout(timerBuscaOutros);
        const n = numeroDaBusca();
        if (n !== estado.outrosNumero) { estado.outros = []; estado.outrosNumero = ''; estado.portaisOutros = {}; }
        if (!n || n === estado.outrosNumero || typeof window === 'undefined' || !window.buscarCotacaoOutroVendedor) return;
        timerBuscaOutros = setTimeout(() => window.buscarCotacaoOutroVendedor(estado.busca.trim()), 400);
    }
    function receberOutros(numeroBuscado, novaLista, portais) {
        if (String(numeroBuscado || '') !== numeroDaBusca()) return; // a busca já mudou
        estado.outros = registrar(Array.isArray(novaLista) ? novaLista : []);
        estado.outrosNumero = numeroDaBusca();
        estado.portaisOutros = portais && typeof portais === 'object' ? portais : {};
        const campo = document.activeElement && document.activeElement.id === 'pc-busca' ? document.activeElement : null;
        const pos = campo ? campo.selectionStart : null;
        redesenhar();
        const novo = campo && document.getElementById('pc-busca');
        if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    }

    function receberPrintsEvento(eventoId, prints) {
        const chave = String(eventoId || '').replace(/^Evento\s+/i, '').trim();
        if (!chave || !Array.isArray(prints)) return;
        estado.printsRobo[chave] = prints;
        if (typeof window !== 'undefined' && window.printsRobo) {
            window.printsRobo[chave] = prints;
        }
        redesenhar();
    }

    let timerCaptchaGlobal = null;
    function receberCaptcha(imagemB64) {
        if (!imagemB64) return;
        const jaEstavaAberto = Boolean(estado.captchaImagem);
        const novaSrc = String(imagemB64).startsWith('data:image')
            ? String(imagemB64)
            : `data:image/png;base64,${imagemB64}`;
        estado.captchaImagem = String(imagemB64);
        const imgExistente = document.getElementById('imagem-captcha-vendedor');
        if (jaEstavaAberto && imgExistente) {
            imgExistente.src = novaSrc;
        } else {
            // Garante que o Captcha apareça na tela principal de minhas_cotacoes.html (fechando qualquer modal por cima)
            estado.aberta = null;
            estado.respondendoPortal = false;
            redesenhar();
            toast('⚠️ <b>Captcha detectado!</b> Clique na imagem do Captcha na tela principal para liberar o robô.');
            const painel = document.getElementById('painel-captcha-vendedores');
            if (painel && typeof painel.scrollIntoView === 'function') {
                painel.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
        clearTimeout(timerCaptchaGlobal);
        timerCaptchaGlobal = setTimeout(() => {
            fecharCaptcha();
        }, 8000);
    }

    function fecharCaptcha() {
        clearTimeout(timerCaptchaGlobal);
        timerCaptchaGlobal = null;
        if (!estado.captchaImagem) return;
        estado.captchaImagem = '';
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
    function abrir(v) {
        estado.aberta = Number(v);
        estado.confirmando = false;
        estado.respondeuAgora = null;
        estado.respondendoPortal = false;
        estado.novos.delete(Number(v));
        const c = porId(Number(v));
        if (c) {
            const printsAtuais = printsDe(c);
            if (!printsAtuais.length && typeof socket !== 'undefined' && socket && socket.emit) {
                const n = numero(c).num;
                socket.emit('solicitar_prints_evento', { evento: n, cota: c['COTAÇÃO'] });
            }
        }
        redesenhar();
    }
    function fechar() { estado.aberta = null; estado.confirmando = false; estado.respondeuAgora = null; estado.respondendoPortal = false; redesenhar(); }
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
        estado.outros = estado.outros.map(x => (x === c ? marcada : x));
        estado.confirmando = false;
        estado.respondeuAgora = k;
        marcarComoRespondida(c);
        redesenhar();
        toast(`Cotação <b>${esc(numero(c).num)}</b> marcada como respondida.`);
    }

    async function receberArquivosResposta(k, tipo, fileList, itemIdx) {
        const c = porId(k);
        if (!c || !fileList || !fileList.length) return;
        const d = dadosResposta(c);
        const arquivos = Array.from(fileList);

        if (tipo === 'planilha') {
            const arq = arquivos[0];
            d.planilhaNome = arq.name || 'planilha_base.xlsx';
            d.planilhaArquivo = null;   // só vale depois de ler: a grade e o DAV saem da MESMA planilha
            d.planilhaErro = '';
            d.carregandoPlanilha = true;
            redesenhar();
            try {
                if (typeof lerPlanilhaBaseResposta !== 'function') {
                    throw new Error('Leitor de Planilha Base indisponível.');
                }
                const lido = await lerPlanilhaBaseResposta(arq, c);
                d.itens = Array.isArray(lido && lido.itens) ? lido.itens : [];
                d.planilhaArquivo = arq;
                d.carregandoPlanilha = false;
                d.enviado = false;
                redesenhar();
                toast(`Planilha <b>${esc(d.planilhaNome)}</b> carregada (${d.itens.length} ${d.itens.length === 1 ? 'item' : 'itens'}). Confira os dados abaixo.`);
            } catch (err) {
                d.carregandoPlanilha = false;
                d.planilhaErro = (err && err.message) ? err.message : 'Erro ao ler a planilha.';
                redesenhar();
                toast(`Não foi possível ler a planilha: ${esc(d.planilhaErro)}`);
            }
        } else if (tipo === 'dav') {
            arquivos.forEach(f => d.davs.push(f));
            redesenhar();
        } else if (tipo === 'datasheet') {
            arquivos.forEach(f => d.datasheets.push(f));
            redesenhar();
        } else if (tipo === 'datasheet-item') {
            const idxNum = Number(itemIdx);
            if (!Number.isNaN(idxNum) && idxNum >= 0) {
                if (!d.datasheetsPorItem) d.datasheetsPorItem = {};
                if (!Array.isArray(d.datasheetsPorItem[idxNum])) d.datasheetsPorItem[idxNum] = [];
                arquivos.forEach(f => d.datasheetsPorItem[idxNum].push(f));
                redesenhar();
            }
        }
    }

    async function enviarRespostaDoModal(c) {
        if (!c) return;
        const d = dadosResposta(c);
        if (!d.itens.length) {
            toast('Arraste a Planilha Base primeiro para carregar os itens da resposta.');
            return;
        }
        const temAlgumValor = d.itens.some(it => String(it.preco ?? '').trim() !== '' || String(it.prazo ?? '').trim() !== '');
        if (!temAlgumValor) {
            toast('Preencha ao menos o Valor Unitário de Venda ou Prazo de um item antes de enviar.');
            return;
        }
        const gerarDav = Boolean(d.gerarDavPlanilha);
        if (gerarDav && !(d.planilhaArquivo && /\.xlsx$/i.test(d.planilhaNome))) {
            toast('Para gerar o DAV, a Planilha Base precisa ser .xlsx.');
            return;
        }
        d.enviando = true;
        redesenhar();
        try {
            const portal = portalRobo(c) || 'coupa';
            const num = numero(c).num;
            const datasheetsPorItem = d.itens.map((_, idx) =>
                (d.datasheetPorLinha && d.datasheetsPorItem && Array.isArray(d.datasheetsPorItem[idx]))
                    ? d.datasheetsPorItem[idx]
                    : []
            );
            const retorno = await enviarRespostaCotacaoPortal({
                portal,
                evento: num,
                itens: d.itens,
                // "Gerar DAV com base na planilha": o DAV anexado não vai; a Planilha Base vai e o Cotafrete gera o DAV
                davs: gerarDav ? [] : d.davs,
                planilha: gerarDav ? d.planilhaArquivo : null,
                datasheets: d.datasheetPorLinha ? [] : d.datasheets,
                datasheetPorLinha: Boolean(d.datasheetPorLinha),
                datasheetsPorItem,
            });
            d.enviando = false;
            d.enviado = true;
            estado.respondendoPortal = false;
            // Se a pessoa enviar a resposta de novo para esse evento, o alerta de erro some imediatamente
            limparErroResposta(num);
            if (c['COTAÇÃO']) limparErroResposta(c['COTAÇÃO']);
            if (retorno && retorno.gerando_dav) {
                receberStatusDav(num, { estado: 'gerando', mensagem: 'Pedindo o DAV ao Cotafrete...' });
                toast(`Cotação <b>${esc(num)}</b>: gerando o DAV no Cotafrete. A resposta vai para a fila do robô quando o DAV ficar pronto.`);
            } else {
                receberStatusDav(num, null);
                redesenhar();
                toast(`Cotação <b>${esc(num)}</b> enviada para a fila de resposta do robô!`);
            }
        } catch (err) {
            d.enviando = false;
            redesenhar();
            toast(`Falha ao enviar resposta: ${esc((err && err.message) || 'erro desconhecido')}`);
        }
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
        'responder-portal': () => { estado.respondendoPortal = !estado.respondendoPortal; redesenhar(); },
        'fechar-resp-portal': () => { estado.respondendoPortal = false; redesenhar(); },
        'limpar-planilha-resp': (el, c) => {
            const d = dadosResposta(c);
            d.planilhaNome = '';
            d.planilhaArquivo = null;
            d.planilhaErro = '';
            d.itens = [];
            redesenhar();
        },
        'remover-arq-resp': (el, c) => {
            const d = dadosResposta(c);
            const idx = Number(el.dataset.idx);
            const lista = el.dataset.tipo === 'dav' ? d.davs : d.datasheets;
            if (Array.isArray(lista) && idx >= 0 && idx < lista.length) lista.splice(idx, 1);
            redesenhar();
        },
        'remover-arq-resp-item': (el, c) => {
            const d = dadosResposta(c);
            const itemIdx = Number(el.dataset.itemIdx);
            const idx = Number(el.dataset.idx);
            const lista = d.datasheetsPorItem && d.datasheetsPorItem[itemIdx];
            if (Array.isArray(lista) && idx >= 0 && idx < lista.length) lista.splice(idx, 1);
            redesenhar();
        },
        'enviar-resp-portal': (el, c) => enviarRespostaDoModal(c),
        'abrir-print': (el, c) => {
            const idx = Number(el.dataset.idx || 0);
            abrirVisualizadorPrint(c, idx);
        },
        'fechar-lb-print': () => fecharVisualizadorPrint(),
        'fechar-lb-se-fundo': (el, c, e) => {
            if (e && (e.target.id === 'pc-lb-palco' || e.target.id === 'pc-lb-img-wrap')) {
                fecharVisualizadorPrint();
            }
        },
        'lb-zoom-in': () => zoomVisualizadorPrint(0.25),
        'lb-zoom-out': () => zoomVisualizadorPrint(-0.25),
        'lb-zoom-reset': () => resetZoomVisualizadorPrint(),
        'lb-prev': () => navVisualizadorPrint(-1),
        'lb-next': () => navVisualizadorPrint(1),
        'lb-nova-aba': () => abrirVisualizadorPrintNovaAba(),
        'lb-baixar': () => baixarPrintVisualizador(),
        'fechar-captcha': () => fecharCaptcha(),
        responder: () => { estado.confirmando = true; redesenhar(); },
        'cancelar-resp': () => { estado.confirmando = false; redesenhar(); },
        'confirmar-resp': (el, c) => confirmarResposta(c),
        'exp-excel': () => exportarLista('excel'),
        'exp-word': () => exportarLista('word'),
    };
    // ações sobre uma cotação que sumiu numa recarga do socket não fazem nada
    const PRECISA_COTACAO = ['word', 'base', 'copiar', 'copiar-num', 'confirmar-resp', 'limpar-planilha-resp', 'remover-arq-resp', 'remover-arq-resp-item', 'enviar-resp-portal', 'abrir-print'];

    document.addEventListener('click', e => {
        if (e.target && e.target.id === 'imagem-captcha-vendedor') {
            const img = e.target;
            const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 1, height: 1 };
            const escalaX = (img.naturalWidth || rect.width || 1) / (rect.width || 1);
            const escalaY = (img.naturalHeight || rect.height || 1) / (rect.height || 1);
            const x = Math.round((e.offsetX || 0) * escalaX);
            const y = Math.round((e.offsetY || 0) * escalaY);
            if (typeof clicarCaptchaGlobal === 'function') {
                clicarCaptchaGlobal(x, y);
                toast('Clique enviado ao robô. Aguarde a imagem do captcha atualizar.');
            }
            return;
        }
        document.querySelectorAll('details.pc-pop[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
        const alvo = e.target.closest('[data-acao]');
        if (!alvo) { if (e.target.id === 'pc-modal') fechar(); return; }
        const fazer = ACOES[alvo.dataset.acao];
        if (!fazer) return; // "sel" e "menu": só não deixam o clique abrir o cartão
        const pop = alvo.closest('details.pc-pop');
        if (pop && alvo.tagName === 'BUTTON') pop.open = false;
        const c = porId(alvo.dataset.id);
        if (PRECISA_COTACAO.includes(alvo.dataset.acao) && !c) return;
        fazer(alvo, c, e);
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
        if (t.dataset.checkGerarDav) {
            const c = porId(Number(t.dataset.checkGerarDav));
            if (c) { dadosResposta(c).gerarDavPlanilha = t.checked; redesenhar(); }
            return;
        }
        if (t.dataset.checkDsLinha) {
            alternarDatasheetPorLinha(Number(t.dataset.checkDsLinha), t.checked);
            return;
        }
        if (t.dataset.respFile) {
            const arquivos = t.files;
            const k = Number(t.dataset.id);
            const tipo = t.dataset.respFile;
            const itemIdx = t.dataset.itemIdx !== undefined ? Number(t.dataset.itemIdx) : undefined;
            receberArquivosResposta(k, tipo, arquivos, itemIdx);
            t.value = '';
        } else if (t.dataset.multi) {
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
        if (t.dataset && t.dataset.respCampo) {
            const c = porId(t.dataset.id);
            if (!c) return;
            const d = dadosResposta(c);
            const idx = Number(t.dataset.idx);
            if (d.itens[idx]) d.itens[idx][t.dataset.respCampo] = t.value;
            return;
        }
        if (t.hasAttribute('data-pop-busca')) {
            const q = t.value.trim().toLowerCase();
            t.parentElement.querySelectorAll('.pc-pop-lista label').forEach(l => { l.hidden = !!q && !l.dataset.valor.includes(q); });
            return;
        }
        if (t.id !== 'pc-busca') return;
        estado.busca = t.value;
        agendarBuscaOutros();
        const pos = t.selectionStart;
        redesenhar();
        const novo = document.getElementById('pc-busca');
        if (novo) { novo.focus(); novo.setSelectionRange(pos, pos); }
    });
    document.addEventListener('dragover', e => {
        const dz = e.target.closest && e.target.closest('.pc-dropzone[data-drop-tipo]');
        if (!dz) return;
        e.preventDefault();
        dz.classList.add('arrastando');
    });
    document.addEventListener('dragleave', e => {
        const dz = e.target.closest && e.target.closest('.pc-dropzone[data-drop-tipo]');
        if (!dz) return;
        if (!dz.contains(e.relatedTarget)) dz.classList.remove('arrastando');
    });
    document.addEventListener('drop', e => {
        const dz = e.target.closest && e.target.closest('.pc-dropzone[data-drop-tipo]');
        if (!dz) return;
        e.preventDefault();
        dz.classList.remove('arrastando');
        const files = e.dataTransfer && e.dataTransfer.files;
        if (files && files.length) {
            const itemIdx = dz.dataset.itemIdx !== undefined ? Number(dz.dataset.itemIdx) : undefined;
            receberArquivosResposta(Number(dz.dataset.id), dz.dataset.dropTipo, files, itemIdx);
        }
    });
    document.addEventListener('keydown', e => {
        if (estado.printViewer) {
            if (e.key === 'Escape') { e.preventDefault(); fecharVisualizadorPrint(); return; }
            if (e.key === 'ArrowLeft') { e.preventDefault(); navVisualizadorPrint(-1); return; }
            if (e.key === 'ArrowRight') { e.preventDefault(); navVisualizadorPrint(1); return; }
            if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomVisualizadorPrint(0.25); return; }
            if (e.key === '-') { e.preventDefault(); zoomVisualizadorPrint(-0.25); return; }
        }
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

    window.Tela = { estado, davDe, bannerDav, receberStatusDav, filtradas, contagem, itens, numero, portalRobo, printsDe, erroDe, formatarErroCurto, bannerErroResposta, receberErroResposta, limparErroResposta, abrirVisualizadorPrint, fecharVisualizadorPrint, abrirPrintEmNovaAba, dadosResposta, alternarDatasheetPorLinha, receberArquivosResposta, enviarRespostaDoModal, receberPrintsEvento, receberCaptcha, fecharCaptcha, painelCaptchaGlobal, cartao, detalhe, dias, alvoExportacao, exportarLista, receber, receberOutros, falhou, conexao, toast, abrir, id };
})();
