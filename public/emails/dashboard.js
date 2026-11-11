/* Central de E-mails: Dashboard (#dashboard). Carregado por tela.js depois de graficos.js e saude.js. */
(function () {
    'use strict';
    const T = window.EmailsTela;
    const { $, el, botao, etiquetaCategoria, SVG, estado, minhas, paraHash, pedir, contadores, comMovimento, tempo, manterFoco, tabela, tabelaSimples, situacao, tabelaSaude } = T;
    const F = window.EmailsFormato, Q = window.EmailsFiltro, G = window.EmailsGraficos;
    const dataHora = F.dataHora;

    // ----- dashboard (seção 7): cada número leva à Caixa filtrada -----
    const dash = { periodo: 'hoje', escopo: '', ocultas: new Set(), d: null, em: 0, vez: 0 };
    const escopoDash = () => (minhas().length ? dash.escopo || 'minhas' : 'todas');
    const contasDash = () => (escopoDash() === 'minhas' ? minhas() : []);
    // endereço da Caixa com o filtro do clique; sem categoria, "sem ruído" desliga (a lista conta o mesmo que o painel)
    function paraCaixa(campos) {
        const f = Object.assign(Q.novo(), { contas: contasDash() }, campos);
        if (!f.categorias.length) f.sem_ruido = false;
        return paraHash(f);
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
        const meu = ++dash.vez;
        desenharControlesDash();
        if (!auto) {
            $('em-dash-estado').setAttribute('aria-live', 'polite');
            $('em-dash-estado').textContent = 'Carregando o dashboard…';
        }
        $('em-dash-conteudo').classList.add('em-recarregando');
        const params = { periodo: dash.periodo };
        if (contasDash().length) params.contas = contasDash();
        const r = await pedir('resumo', params);
        // cancelado por um pedido mais novo: ele tira o esmaecido; pela queda da conexão: tira aqui
        if (meu === dash.vez) $('em-dash-conteudo').classList.remove('em-recarregando');
        if (r.cancelado) return;
        // a atualização automática que deu certo só troca a hora: o leitor de tela não ouve isso a cada 2 minutos
        if (auto) $('em-dash-estado').setAttribute('aria-live', r.sucesso ? 'off' : 'polite');
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
    T.partes.dashboard = carregarDash;
})();
