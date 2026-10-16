/* Dashboard de Atividade (atividade.html): eventos do gerenciador + serviço de NF juntos pelo portal. Só leitura. */
(function (root) {
    'use strict';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const SERVICOS = { gerenciador: 'Gerenciador', coupa: 'Coupa', vale: 'Vale', cadastro: 'Cadastro', nf: 'NF', sync_planilha: 'Sync planilha' };
    const NIVEIS = { erro: 'Erro', aviso: 'Aviso', ok: 'OK', info: 'Info' };
    const COR = { erro: 'vermelho', aviso: 'amarelo', ok: 'verde', info: 'azul' };
    const JUNTAR_MIN = 10;
    const FONTE = { gerenciador: 'Gerenciador', nf: 'Serviço de NF' };

    function filtrar(eventos, f) {
        const termo = String(f.busca || '').trim().toLowerCase();
        return eventos.filter(e => (!f.servico || e.servico === f.servico) && (!f.nivel || e.nivel === f.nivel) &&
            (!termo || [e.resumo, e.ref, e.tipo, JSON.stringify(e.detalhe || {})].join(' ').toLowerCase().includes(termo)));
    }

    // Eventos iguais em sequência (mesmo serviço, tipo e nível, a menos de 10 min) viram um item só.
    function agrupar(eventos) {
        const grupos = [];
        for (const e of eventos) {
            const g = grupos[grupos.length - 1];
            const perto = g && Math.abs(Date.parse(g.itens[g.itens.length - 1].em) - Date.parse(e.em)) <= JUNTAR_MIN * 60000;
            if (g && perto && g.servico === e.servico && g.tipo === e.tipo && g.nivel === e.nivel) g.itens.push(e);
            else grupos.push({ servico: e.servico, tipo: e.tipo, nivel: e.nivel, em: e.em, itens: [e] });
        }
        return grupos;
    }

    function porDia(grupos) {
        const dias = [];
        for (const g of grupos) {
            const dia = new Date(g.em).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' });
            if (!dias.length || dias[dias.length - 1].dia !== dia) dias.push({ dia, grupos: [] });
            dias[dias.length - 1].grupos.push(g);
        }
        return dias;
    }

    const hora = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const valor = v => Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? JSON.stringify(v) : v;

    function htmlGrupo(g) {
        const e = g.itens[0];
        const varios = g.itens.length > 1;
        const titulo = varios ? `${g.itens.length}× ${String(e.resumo).replace(/\s*em 1 cotação\(ões\)$/, '')}` : e.resumo;
        let detalhe = '';
        if (varios) detalhe = `<details><summary>ver os ${g.itens.length}</summary><ul>${g.itens.slice(0, 100).map(x =>
            `<li>${hora(x.em)} · ${esc(x.detalhe && Array.isArray(x.detalhe.mudancas) ? x.detalhe.mudancas.join(', ') : `${x.ref ? x.ref + ' · ' : ''}${x.resumo}`)}</li>`).join('')}</ul></details>`;
        else if (Object.keys(e.detalhe || {}).length) detalhe = `<details><summary>detalhes</summary><ul>${Object.entries(e.detalhe).map(([k, v]) => `<li>${esc(k)}: ${esc(valor(v))}</li>`).join('')}</ul></details>`;
        return `<li class="evento ${COR[g.nivel] ? g.nivel : 'info'}"><time>${varios ? `${hora(g.itens[g.itens.length - 1].em)}–<br>${hora(e.em)}` : hora(e.em)}</time><span class="ponto"></span>
            <div class="texto"><strong>${esc(titulo)}</strong>${!varios && e.ref ? `<p>Ref.: ${esc(e.ref)}</p>` : ''}${detalhe}</div>
            <span class="tag ${COR[g.nivel] || ''}">${esc(SERVICOS[g.servico] || g.servico)}</span></li>`;
    }

    function pagina(dados, ctx, f = { servico: '', nivel: '', busca: '' }, limite = 200) {
        const eventos = dados.eventos || [], fontes = dados.fontes || {};
        const lista = filtrar(eventos, f);
        const agora = ctx.agora(), dia = 24 * 3600 * 1000;
        const erros = eventos.filter(e => e.nivel === 'erro' && agora - Date.parse(e.em) < dia);
        const quedas = Object.entries(fontes).filter(([, v]) => v.status !== 'ok');
        const parciais = Object.values(fontes).flatMap(v => Object.entries(v.erros || {}).map(([k, m]) => `${SERVICOS[k] || k}: ${m}`));
        const contagem = n => eventos.filter(e => e.nivel === n).length;
        const topo = erros.length || quedas.length || parciais.length ? `<section class="erros-topo entra" role="alert"><h2>${erros.length ? `${erros.length} erro(s) nas últimas 24 h` : 'Fontes com problema'}</h2><ul>
            ${quedas.map(([k, v]) => `<li>${esc(FONTE[k] || k)}: ${esc(v.erro || v.status)} Os eventos dele não aparecem abaixo.</li>`).join('')}
            ${parciais.map(m => `<li>${esc(m)}</li>`).join('')}
            ${erros.slice(0, 8).map(e => `<li>${hora(e.em)} · ${esc(SERVICOS[e.servico] || e.servico)} · ${esc(e.resumo)}</li>`).join('')}</ul></section>` : '';
        const cards = `<div class="cards">${Object.entries(NIVEIS).map(([n, nome], i) => `<button class="card-num entra${f.nivel === n ? ' selecionado' : ''}" style="--i:${i}" data-acao="nivel" data-nivel="${n}"><small>${nome}</small>${ctx.num(contagem(n), ({ erro: 'red', aviso: 'amber', ok: 'green', info: '' })[n])}<em>no período carregado</em></button>`).join('')}</div>`;
        const corpo = lista.length ? `<ol class="linha-tempo">${porDia(agrupar(lista)).map(d => `<li class="dia">${esc(d.dia)}</li>${d.grupos.map(htmlGrupo).join('')}`).join('')}</ol>`
            : `<p class="vazio">${eventos.length ? 'Nada com este filtro.' : 'Nenhum evento nos últimos 7 dias.'}</p>`;
        const mais = eventos.length >= limite && limite < 500 ? '<button class="button" data-acao="mais">Carregar mais</button>' : '';
        return `${topo}${cards}<section class="panel bloco entra" style="--i:4"><div class="panel-head"><div><h2>Linha do tempo</h2><p>Gerenciador, Coupa, Vale, cadastro, NF e sync planilha num lugar só. Eventos iguais em sequência ficam juntos.</p></div></div>
            <div class="filtros"><label class="field"><span class="field-label">Serviço</span><select id="filtro-at-servico" data-filtro="servico"><option value="">Todos</option>${Object.entries(SERVICOS).map(([k, v]) => `<option value="${k}" ${f.servico === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="field"><span class="field-label">Nível</span><select id="filtro-at-nivel" data-filtro="nivel"><option value="">Todos</option>${Object.entries(NIVEIS).map(([k, v]) => `<option value="${k}" ${f.nivel === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="field search-field"><span class="field-label">Buscar</span><span class="search-box"><input id="filtro-at-busca" type="search" data-filtro="busca" placeholder="Cotação, pedido, mensagem…" value="${esc(f.busca)}"></span></label></div>
            ${corpo}<div class="lista-rodape"><span>${lista.length} de ${eventos.length} evento(s)</span>${mais}</div></section>`;
    }

    const api = { filtrar, agrupar, porDia, pagina, SERVICOS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DashAtividade = api;

    if (typeof document !== 'undefined' && document.body && document.body.dataset.dashboard === 'atividade') {
        const f = { servico: '', nivel: '', busca: '' };
        let limite = 200;
        const painel = root.Dash.iniciar({ pagina: 'atividade', fonte: 'atividade', titulo: 'Atividade',
            subtitulo: 'Tudo o que os robôs e serviços fizeram nos últimos 7 dias, numa linha do tempo só.',
            parametros: () => ({ limite }),
            extrair: r => ({ eventos: r.eventos, fontes: r.fontes }),
            render: (d, ctx) => pagina(d, ctx, f, limite),
            acoes: {
                nivel: el => { f.nivel = f.nivel === el.dataset.nivel ? '' : el.dataset.nivel; },
                mais: () => { limite = Math.min(500, limite + 200); painel.atualizar(); },
            },
            filtrar: (k, v) => { f[k] = v; } });
    }
})(typeof window !== 'undefined' ? window : globalThis);
