/* Dashboard de NFs (nfs.html). Monta HTML a partir de comando_nf_painel (cruzar_nf/painel_nf.py). Só leitura. */
(function (root) {
    'use strict';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const RESOLVE = 'Some daqui sozinho na próxima rodada de NF depois de corrigido.';

    const FAIXAS = [
        { id: 'ate7', nome: 'Até 7 dias', cor: 'verde', teste: d => d !== null && d <= 7 },
        { id: 'ate30', nome: '8 a 30 dias', cor: 'amarelo', teste: d => d !== null && d > 7 && d <= 30 },
        { id: 'ate90', nome: '31 a 90 dias', cor: 'vermelho', teste: d => d !== null && d > 30 && d <= 90 },
        { id: 'mais90', nome: 'Mais de 90 dias', cor: 'vermelho', teste: d => d !== null && d > 90 },
        { id: 'semdata', nome: 'Sem data legível', cor: '', teste: d => d === null },
    ];
    const faixa = dias => FAIXAS.find(f => f.teste(dias == null ? null : dias)).id;

    const LISTAS = {
        sem_nf: { titulo: 'Pedidos sem NF', oque: 'Pedidos do portal que o HSE ainda não mostra com nota fiscal. Os mais antigos (pela data de entrega) vêm primeiro.',
            fazer: 'Confira no HSE se a venda foi faturada com o número do pedido (OC) certo. Se faturou com outro número, corrija a OC no HSE ou o PEDIDO no portal. ' + RESOLVE },
        divergencias: { titulo: 'Divergências', oque: 'O HSE achou a NF, mas o valor ou a nota não batem com o portal.',
            fazer: 'Confira o valor do pedido na planilha/portal e o total da NF no HSE; corrija o lado errado. ' + RESOLVE },
        portal_planilha: { titulo: 'NF no portal, planilha vazia', oque: 'O portal já tem a NF, mas a coluna de NF da planilha dos estagiários está vazia.',
            fazer: 'Use "Abrir ações de NF" e o botão "Gravar NF na planilha" (precisa da planilha fechada no Excel).' },
    };

    // Parte que o serviço não conseguiu ler vem como {erro: "..."}: mostra o erro, nunca zero.
    function falhou(parte) { return !parte || (typeof parte === 'object' && !Array.isArray(parte) && 'erro' in parte && Object.keys(parte).length === 1); }
    const erroDe = parte => esc((parte && parte.erro) || 'sem dados');

    function itens(painel, f) {
        const rel = painel.relatorio, conf = painel.nf_so_no_portal;
        let lista = [];
        if (f.lista === 'sem_nf' && !falhou(rel)) lista = (rel.sem_nf || []).filter(i => !f.faixa || faixa(i.dias_desde_entrega) === f.faixa);
        if (f.lista === 'divergencias' && !falhou(rel)) lista = rel.divergencias || [];
        if (f.lista === 'portal_planilha' && !falhou(conf)) lista = conf.itens || [];
        const termo = String(f.busca || '').trim().toLowerCase();
        return termo ? lista.filter(i => Object.values(i).join(' ').toLowerCase().includes(termo)) : lista;
    }

    function cards(painel, f, ctx) {
        const ind = painel.indicadores, rel = painel.relatorio, conf = painel.nf_so_no_portal, cad = painel.cadastro;
        const card = (lista, rotulo, valor, nota, i) => `<button class="card-num entra${f.lista === lista ? ' selecionado' : ''}" style="--i:${i}" ${lista ? `data-acao="lista" data-lista="${lista}"` : 'disabled'}><small>${esc(rotulo)}</small>${valor}<em>${nota}</em></button>`;
        const n = (parte, valor, cls) => falhou(parte) ? '<strong class="muted" style="font-size:14px">indisponível</strong>' : ctx.num(valor, cls);
        return `<div class="cards">
            ${card('sem_nf', 'Pedidos sem NF', n(ind, ind.sem_nf, ind.sem_nf ? 'amber' : 'green'), falhou(rel) ? erroDe(rel) : 'clique para ver a lista', 0)}
            ${card('divergencias', 'Divergências', n(ind, ind.divergencias, ind.divergencias ? 'red' : 'green'), 'valor ou NF diferente', 1)}
            ${card('portal_planilha', 'NF no portal, planilha vazia', n(conf, conf.total, conf.total ? 'amber' : 'green'), falhou(conf) ? erroDe(conf) : conf.itens === null ? 'lista na próxima conferência diária' : 'coluna NF da planilha', 2)}
            ${card('', 'Cadastrados hoje', n(cad, cad.cadastrados_hoje, ''), falhou(cad) ? erroDe(cad) : `verificado ${esc(cad.verificado_em || '—')}`, 3)}</div>`;
    }

    function cobertura(painel, ctx) {
        const ind = painel.indicadores;
        if (falhou(ind)) return `<section class="panel entra"><div class="panel-head"><h2>Cobertura de NF</h2></div><p class="vazio">Indicadores indisponíveis: ${erroDe(ind)}</p></section>`;
        const raio = 80, total = 2 * Math.PI * raio, pct = ind.total ? ind.com_nf / ind.total : 0;
        return `<section class="panel entra"><div class="panel-head"><div><h2>Cobertura de NF</h2><p>Pedidos do portal com nota fiscal</p></div></div>
            <div class="anel" role="img" aria-label="${Number(ind.com_nf)} de ${Number(ind.total)} pedidos com NF"><svg viewBox="0 0 190 190"><circle class="fundo" cx="95" cy="95" r="${raio}"/>
            <circle class="valor" cx="95" cy="95" r="${raio}" style="--total:${total.toFixed(1)};stroke-dasharray:${total.toFixed(1)};stroke-dashoffset:${(total * (1 - pct)).toFixed(1)}"/></svg>
            <div class="anel-centro">${ctx.num(Number(ind.com_nf))}<span>de ${Number(ind.total).toLocaleString('pt-BR')} · ${Math.round(pct * 1000) / 10}%</span></div></div>
            <div class="panel-body"><p class="muted">Última sincronização: ${esc(ctx.hora(ind.ultima_sincronizacao))} (${esc(ind.origem || '—')})<br>
            Período coberto: ${esc(ind.periodo ? `${ind.periodo.de} a ${ind.periodo.ate}` : '—')}<br>Próxima janela: ${esc(ind.proxima_janela ? `${ind.proxima_janela.de} a ${ind.proxima_janela.ate}` : '—')}
            ${painel.rodando ? '<br><span class="tag azul">Sincronizando agora</span>' : ''}${ind.aviso ? `<br><span class="tag amarelo">${esc(ind.aviso)}</span>` : ''}</p></div></section>`;
    }

    function antiguidade(painel, f) {
        const rel = painel.relatorio;
        if (falhou(rel)) return `<section class="panel entra" style="--i:1"><div class="panel-head"><h2>Sem NF por antiguidade</h2></div><p class="vazio">${erroDe(rel)}</p></section>`;
        const lista = rel.sem_nf || [], cont = {};
        lista.forEach(i => { const k = faixa(i.dias_desde_entrega); cont[k] = (cont[k] || 0) + 1; });
        const max = Math.max(1, ...Object.values(cont));
        const semDias = lista.length && lista.every(i => i.dias_desde_entrega == null);
        return `<section class="panel entra" style="--i:1"><div class="panel-head"><div><h2>Sem NF por antiguidade</h2><p>Dias desde a data de entrega. Clique numa faixa para filtrar a lista.</p></div></div>
            <div class="barras">${FAIXAS.map(x => `<button class="barra${f.faixa === x.id ? ' selecionado' : ''}" data-acao="faixa" data-faixa="${x.id}"><span>${x.nome}</span><span class="barra-trilho"><i class="${x.cor}" style="--w:${Math.round(100 * (cont[x.id] || 0) / max)}%"></i></span><b>${cont[x.id] || 0}</b></button>`).join('')}</div>
            ${semDias ? '<p class="vazio" style="padding-top:0">As datas de entrega chegam na próxima rodada de NF (relatório gerado antes desta versão).</p>' : ''}</section>`;
    }

    function lista(painel, f) {
        const cfg = LISTAS[f.lista];
        const todos = itens(painel, { ...f, busca: '' }), mostrados = itens(painel, f);
        const parte = f.lista === 'portal_planilha' ? painel.nf_so_no_portal : painel.relatorio;
        const linha = i => f.lista === 'sem_nf'
            ? `<li><span class="rotulo">${i.dias_desde_entrega != null ? `${esc(i.dias_desde_entrega)} dias` : 'sem data'}<br>${esc(i.entrega || '')}</span><div class="principal"><strong>${esc(i.pedido)}${i.rfq ? ` · RFQ ${esc(i.rfq)}` : ''}</strong><p>${esc(i.produto)} · ${esc(i.cidade || '')}</p></div><span class="lado"><span class="tag">${esc(i.motivo)}</span></span></li>`
            : f.lista === 'divergencias'
                ? `<li><span class="rotulo">Pedido</span><div class="principal"><strong>${esc(i.pedido)} · ${esc(i.produto || '')}</strong><p>${esc(i.motivo)}</p></div><span class="lado">Portal: ${esc(i.nf_portal || '—')}<br>HSE: ${esc(i.nf_hse || '—')}</span></li>`
                : `<li><span class="rotulo">Linha ${esc(i.linha)}</span><div class="principal"><strong>${esc(i.pedido)} · ${esc(i.produto || '')}</strong><p>Planilha sem NF</p></div><span class="lado">NF no portal: ${esc(i.nf_portal)}</span></li>`;
        let corpo;
        if (falhou(parte)) corpo = `<p class="vazio">Não foi possível ler: ${erroDe(parte)}</p>`;
        else if (f.lista === 'portal_planilha' && parte.itens == null) corpo = `<p class="vazio">${Number(parte.total || 0).toLocaleString('pt-BR')} pedido(s) nessa situação. A lista detalhada aparece depois da próxima conferência diária.</p>`;
        else corpo = mostrados.length ? `<ul class="lista">${mostrados.map(linha).join('')}</ul>` : `<p class="vazio">${todos.length ? 'Nada com este filtro.' : 'Nada aqui. 🎉'}</p>`;
        return `<section class="panel bloco entra" style="--i:2"><div class="panel-head"><div><h2>${esc(cfg.titulo)}</h2><p>${f.faixa && f.lista === 'sem_nf' ? `Faixa: ${esc(FAIXAS.find(x => x.id === f.faixa).nome)} · ` : ''}${mostrados.length} de ${todos.length}</p></div>
            <div class="actions">${Object.keys(LISTAS).map(k => `<button class="button small${k === f.lista ? ' primary' : ''}" data-acao="lista" data-lista="${k}">${esc(LISTAS[k].titulo)}</button>`).join('')}</div></div>
            <div class="ajuda"><div><b>O que é</b>${esc(cfg.oque)}</div><div><b>O que fazer</b>${esc(cfg.fazer)}</div></div>
            <div class="filtros"><label class="field search-field"><span class="field-label">Buscar</span><span class="search-box"><input id="filtro-nf-busca" type="search" data-filtro="busca" placeholder="Pedido, RFQ, produto, cidade, NF…" value="${esc(f.busca)}"></span></label>
            ${f.faixa ? '<button class="button text small" data-acao="limpar">Limpar faixa</button>' : ''}<a class="button" href="planilha_vale.html">Abrir ações de NF</a></div>${corpo}</section>`;
    }

    function duracao(inicio, fim, hora) {
        const a = hora(inicio), b = hora(fim);
        if (!a || !b) return '';
        const s = Math.max(0, Math.round((b - a) / 1000));
        return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
    }

    // Rodadas de NF e cadastros automáticos numa linha do tempo (mais novos primeiro).
    function linhaTempo(painel, hora) {
        const eventos = [];
        if (Array.isArray(painel.rodadas)) painel.rodadas.forEach(r => eventos.push({
            em: hora(r.rodou_em), nivel: r.sucesso === false ? 'erro' : r.nfs_gravadas ? 'ok' : 'info',
            titulo: r.sucesso === false ? `Sincronização de NF falhou: ${r.erro || ''}` : r.gravou === false ? 'Prévia da NF' : `Sincronização de NF: ${r.nfs_gravadas || 0} NF(s) gravada(s)`,
            texto: [r.origem, r.inicio && `levou ${duracao(r.inicio, r.rodou_em, hora)}`, r.sem_nf != null && `${r.sem_nf} sem NF`].filter(Boolean).join(' · ') }));
        const cad = painel.cadastro;
        if (!falhou(cad)) (cad.historico || []).forEach(h => eventos.push({ em: hora(h.rodou_em), nivel: h.gravados ? 'ok' : 'aviso',
            titulo: h.gravados ? `Cadastro automático: ${h.gravados} pedido(s)` : `Cadastro: ${(h.repetidas || []).length} linha(s) repetida(s)`,
            texto: (h.gravados ? h.pedidos || [] : h.repetidas || []).slice(0, 3).join(' · ') }));
        const ok = eventos.filter(e => e.em).sort((a, b) => b.em - a.em).slice(0, 60);
        let corpo = '<p class="vazio">Nenhuma rodada registrada.</p>';
        if (falhou(painel.rodadas)) corpo = `<p class="vazio">${erroDe(painel.rodadas)}</p>`;
        else if (ok.length) {
            let dia = '';
            corpo = `<ol class="linha-tempo">${ok.map(e => {
                const d = e.em.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' });
                const cab = d !== dia ? `<li class="dia">${esc(d)}</li>` : ''; dia = d;
                return `${cab}<li class="evento ${e.nivel}"><time>${e.em.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</time><span class="ponto"></span><div class="texto"><strong>${esc(e.titulo)}</strong>${e.texto ? `<p>${esc(e.texto)}</p>` : ''}</div></li>`;
            }).join('')}</ol>`;
        }
        return `<section class="panel bloco entra" style="--i:3"><div class="panel-head"><div><h2>Rodadas e cadastros</h2><p>Sincronizações de NF (início, fim, origem) e cadastros automáticos de pedidos.</p></div></div>${corpo}</section>`;
    }

    // hora: '2026-10-15T12:30:21' / '15/10/2026 14:42:01' -> Date (DashSaude.hora)
    function pagina(painel, ctx, f = { lista: 'sem_nf', faixa: '', busca: '' }, hora = ctx.data) {
        return `<div class="grade-anel">${cobertura(painel, ctx)}<div>${cards(painel, f, ctx)}${antiguidade(painel, f)}</div></div>${lista(painel, f)}${linhaTempo(painel, hora)}`;
    }

    const api = { faixa, FAIXAS, itens, pagina, LISTAS, falhou };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DashNfs = api;

    if (typeof document !== 'undefined' && document.body && document.body.dataset.dashboard === 'nfs') {
        const f = { lista: 'sem_nf', faixa: '', busca: '' };
        root.Dash.iniciar({ pagina: 'nfs', fonte: 'nfs', titulo: 'NFs',
            subtitulo: 'Cobertura de nota fiscal dos pedidos, o que falta e o histórico das rodadas e do cadastro automático.',
            render: (p, ctx) => pagina(p, ctx, f),
            acoes: {
                lista: el => { f.lista = el.dataset.lista; f.faixa = ''; },
                faixa: el => { f.lista = 'sem_nf'; f.faixa = f.faixa === el.dataset.faixa ? '' : el.dataset.faixa; },
                limpar: () => { f.faixa = ''; },
            },
            filtrar: (k, v) => { f[k] = v; } });
    }
})(typeof window !== 'undefined' ? window : globalThis);
