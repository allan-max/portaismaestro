// Dashboard da sincronização planilha ⇄ portal (sync.html). Só monta HTML a partir do
// que o serviço de NF manda (painel_para_tela); não grava nada.
(function (global) {
    const esc = v => String(v ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;').replaceAll('"', '&quot;');

    function fmtValor(v, campo) {   // dinheiro só no VALOR: PEDIDO/RFQ também chegam como número
        if (v === null || v === undefined || v === '') return '(vazio)';
        if (typeof v === 'number' && campo === 'VALOR') return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
        return iso ? `${iso[3]}/${iso[2]}/${iso[1]}` : String(v);
    }

    function partes(chave) {
        const [pedido, rfq, produto] = String(chave || '').split('|');
        return { pedido: pedido || '', rfq: rfq || '', produto: produto || '' };
    }

    const IDENT = ['PEDIDO', 'NMR DA RFQ', 'PRODUTO'];
    const RESOLVE = 'Na próxima rodada a sync confere de novo e, se estiver certo, o item some desta lista.';

    // Explicação de cada tipo: o que é e o que fazer (linguagem de quem corrige a planilha).
    const TIPOS = {
        identidade: {
            titulo: 'Pedido, RFQ ou produto diferente', cor: 'vermelho',
            oque: 'O número do PEDIDO, da RFQ ou o PRODUTO não é igual na planilha e no portal. A sync não sabe se é o mesmo pedido e para de sincronizar esta linha.',
            fazer: 'Confira qual lado está certo e corrija o outro para ficarem iguais. ' + RESOLVE,
        },
        campo: {
            titulo: 'Campo alterado nos dois lados', cor: 'vermelho',
            oque: 'O mesmo campo foi mudado na planilha e no portal desde a última vez que estavam iguais. A sync não escolhe um vencedor e, enquanto isso, não sincroniza nenhum campo deste pedido.',
            fazer: 'Decida o valor certo e corrija o lado errado (planilha ou portal). Quando os dois ficarem iguais, o conflito some sozinho.',
        },
        data: {
            titulo: 'Data de entrega inválida', cor: 'amarelo',
            oque: 'A DATA DE ENTREGA não é uma data que a sync consiga ler: tem texto, pontos, várias datas na mesma célula ou está vazia.',
            fazer: 'Deixe só uma data no formato dd/mm/aaaa (ex.: 19/09/2026). Observações vão em outra coluna. ' + RESOLVE,
        },
        formula: {
            titulo: 'Fórmula ou célula mesclada', cor: 'amarelo',
            oque: 'Alguma coluna sincronizada desta linha tem fórmula ou célula mesclada. A sync não mexe nela para não estragar a fórmula.',
            fazer: 'Troque a fórmula pelo valor (copiar → colar valores) ou desfaça a mesclagem. ' + RESOLVE,
        },
        incompleto: {
            titulo: 'Pedido incompleto', cor: 'amarelo',
            oque: 'Faltam campos obrigatórios (como PEDIDO, PRODUTO ou CIDADE) para copiar este pedido para o outro lado.',
            fazer: 'Complete os campos que faltam. ' + RESOLVE,
        },
        ambigua: {
            titulo: 'Pode ser mais de um pedido', cor: 'amarelo',
            oque: 'Esta linha combina com mais de um pedido do outro lado (mesmo item, cidade e valor). A sync não adivinha qual é.',
            fazer: 'Confira o número do PEDIDO e da RFQ nos dois lados e corrija o que estiver errado ou repetido. ' + RESOLVE,
        },
        repetida: {
            titulo: 'Pedido repetido', cor: 'amarelo',
            oque: 'O mesmo pedido + RFQ + produto aparece mais de uma vez (na planilha ou no portal).',
            fazer: 'Apague a linha duplicada ou diferencie os pedidos. ' + RESOLVE,
        },
        reapareceu: {
            titulo: 'Pedido apagado que voltou', cor: 'amarelo',
            oque: 'Este pedido tinha sido apagado de um lado e voltou a aparecer. A sync não recria nem apaga sozinha.',
            fazer: 'Confirme se o pedido deve existir e deixe os dois lados iguais (nos dois ou em nenhum).',
        },
        outro: {
            titulo: 'Outra pendência', cor: 'amarelo',
            oque: 'A sync não conseguiu processar esta linha.',
            fazer: 'Leia o motivo ao lado e corrija o dado. ' + RESOLVE,
        },
    };

    const onde = (linha, lado) => lado === 'portal' ? 'no portal'
        : linha !== null && linha !== undefined ? `na planilha, linha ${linha}`
        : lado === 'excel' ? 'na planilha' : 'na planilha ou no portal';   // relatório antigo não traz o local

    function itemConflito(c) {
        const p = partes(c.chave);
        if (c.campo === 'IDENTIDADE') {
            const ex = c.valores_excel || {}, po = c.valores_portal || {};
            const difs = IDENT.filter(n => String(ex[n] ?? '') !== String(po[n] ?? ''));
            return { tipo: 'identidade', filtro: 'Conflito · identidade', linha: c.linha, ...p,
                campo: difs.join(', ') || 'PEDIDO/RFQ/PRODUTO',
                excel: difs.map(n => `${n}: ${fmtValor(ex[n])}`).join(' · ') || '—',
                portal: difs.map(n => `${n}: ${fmtValor(po[n])}`).join(' · ') || '—',
                base: '', detalhe: `Corrija ${difs.join(', ') || 'o identificador'} para ficar igual nos dois lados.` };
        }
        const base = c.base === null || c.base === undefined ? null : fmtValor(c.base, c.campo);
        const excel = fmtValor(c.excel, c.campo), portal = fmtValor(c.portal, c.campo);
        return { tipo: 'campo', filtro: `Conflito · ${c.campo}`, linha: c.linha, ...p, campo: c.campo,
            excel, portal, base: base ?? 'já estavam diferentes no início',
            detalhe: `${c.campo}: planilha "${excel}" × portal "${portal}"` +
                (base !== null ? ` (antes os dois eram "${base}").` : ' (já estavam diferentes quando a sync começou).') };
    }

    function itemPendente(x) {
        const erro = String(x.erro || '');
        const p = partes(x.chave);
        const comum = { linha: x.linha, ...p, campo: '', excel: '', portal: '', base: '', lado: x.lado };
        if (erro.startsWith('Data inválida')) {
            const valor = erro.replace(/^Data inválida:\s*/, '');
            return { ...comum, tipo: 'data', filtro: 'Data inválida', campo: 'DATA DE ENTREGA',
                [x.lado === 'portal' ? 'portal' : 'excel']: valor,
                detalhe: `Está "${valor}" ${onde(x.linha, x.lado)}. Troque por uma única data dd/mm/aaaa.` };
        }
        if (/fórmula|mesclagem/i.test(erro)) {
            return { ...comum, tipo: 'formula', filtro: 'Fórmula / mesclagem', detalhe: `${erro} (${onde(x.linha, 'excel')}).` };
        }
        if (erro === 'Pedido incompleto') {
            return { ...comum, tipo: 'incompleto', filtro: 'Pedido incompleto', detalhe: `Complete o pedido ${onde(x.linha, x.lado)}.` };
        }
        return { ...comum, tipo: 'outro', filtro: 'Outra pendência', detalhe: `${erro} (${onde(x.linha, x.lado)}).` };
    }

    function itemAmbigua(a) {
        const p = partes(a.chave);
        const repetida = a.erro === 'Chave repetida';
        const n = Array.isArray(a.candidatos) ? a.candidatos.length : Array.isArray(a.estado) ? a.estado.length : 0;
        return { tipo: repetida ? 'repetida' : 'ambigua', filtro: repetida ? 'Pedido repetido' : 'Ambíguo',
            linha: a.linha, ...p, campo: '', excel: '', portal: '', base: '',
            detalhe: repetida ? `O pedido aparece mais de uma vez (${onde(a.linha)}).`
                : `Esta linha (${onde(a.linha)}) combina com ${n || 'vários'} pedidos do outro lado.` };
    }

    // Tudo o que precisa de alguém: conflitos, pendências, ambíguos e apagados que voltaram.
    function itensParaRevisar(painel) {
        const l = (painel && painel.listas) || {};
        const itens = [
            ...(l.conflitos || []).map(itemConflito),
            ...(l.pendentes || []).map(itemPendente),
            ...(l.ambiguas || []).map(itemAmbigua),
            ...(l.removidos || []).filter(r => /reapareceu/.test(r.lado || ''))
                .map(r => ({ tipo: 'reapareceu', filtro: 'Apagado que voltou', linha: null, ...partes(r.chave),
                    campo: '', excel: '', portal: '', base: '', detalhe: 'Confirme se este pedido deve existir nos dois lados.' })),
        ];
        return itens.map(i => ({ ...i, busca: [i.pedido, i.rfq, i.produto, i.linha, i.campo, i.excel, i.portal, i.detalhe]
            .join(' ').toLowerCase() }));
    }

    function filtrar(itens, filtro, busca) {
        const termo = String(busca || '').trim().toLowerCase();
        return itens.filter(i => (!filtro || i.filtro === filtro) && (!termo || i.busca.includes(termo)));
    }

    function hora(texto) {   // 'dd/mm/aaaa hh:mm:ss' -> Date
        const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(texto || ''));
        return m ? new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0)) : null;
    }

    // Tarefa "Maestro Sync Planilha": dias úteis, 12:37 a 17:57 de 10 em 10 min; --diario para no dia
    // depois de uma rodada concluída.
    function proximaRodada(painel, agora) {
        const concluida = hora(painel && painel.concluido_em);
        const mesmoDia = d => d && d.toDateString() === agora.toDateString();
        const d = new Date(agora);
        d.setSeconds(0, 0);
        const util = x => x.getDay() !== 0 && x.getDay() !== 6;
        if (!mesmoDia(concluida) && util(d)) {
            const min = d.getHours() * 60 + d.getMinutes();
            const proximo = Math.max(12 * 60 + 37, Math.ceil((min - 7) / 10) * 10 + 7);
            if (proximo <= 17 * 60 + 57) {
                d.setHours(Math.floor(proximo / 60), proximo % 60);
                return { quando: d, texto: `hoje às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` };
            }
        }
        do { d.setDate(d.getDate() + 1); } while (!util(d));
        d.setHours(12, 37);
        const texto = `${d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })} às 12:37`;
        return { quando: d, texto: mesmoDia(concluida) ? `rodada de hoje concluída; próxima ${texto}` : texto };
    }

    function situacao(painel) {
        if (!painel || !painel.gerado_em) return { cor: 'cinza', titulo: 'Ainda não há rodadas', texto: 'A sincronização ainda não gerou relatório.' };
        if (painel.erro) return { cor: 'vermelho', titulo: 'Erro na última rodada', texto: painel.erro };
        if (painel.alerta) {
            return { cor: 'vermelho', titulo: `Há ${painel.alerta.minutos} min sem conseguir gravar`,
                texto: `Desde ${painel.alerta.desde}. Motivo: ${painel.alerta.motivo || 'não informado'}` };
        }
        if (painel.adiado) return { cor: 'amarelo', titulo: 'Rodada adiada', texto: painel.aviso || 'Tenta de novo na próxima rodada.' };
        if (painel.gravou) return { cor: 'verde', titulo: 'Sincronizou', texto: `Gravou ${(painel.totais || {}).acoes || 0} mudança(s) às ${painel.concluido_em || painel.gerado_em}.` };
        return { cor: 'verde', titulo: 'Em dia', texto: 'Última rodada sem nada para copiar entre planilha e portal.' };
    }

    const NOME_RESULTADO = { gravou: 'Gravou', sem_acoes: 'Nada a fazer', adiado: 'Adiada', erro: 'Erro', inicializou: 'Inicializou' };
    const COR_RESULTADO = { gravou: 'verde', sem_acoes: 'verde', inicializou: 'azul', adiado: 'amarelo', erro: 'vermelho' };

    const COR_TAG = { vermelho: 'vermelho', amarelo: 'amarelo', verde: 'verde', azul: 'azul', cinza: '' };

    // --- visual novo (padrão dos dashboards: comum.css) ---------------------------------
    function htmlSituacao(painel, agora, ctx) {
        const s = situacao(painel);
        const t = (painel && painel.totais) || {};
        const precisa = itensParaRevisar(painel).length;
        const card = (n, rotulo, nota, cls, i) => `<div class="card-num entra" style="--i:${i}"><small>${esc(rotulo)}</small>${ctx.num(n, cls)}<em>${esc(nota)}</em></div>`;
        return `<section class="panel bloco entra"><div class="panel-head"><div><h2>Situação</h2><p>Última rodada: ${esc((painel && painel.gerado_em) || '—')} · Próxima: ${esc(proximaRodada(painel, agora).texto)}</p></div>
            <span class="tag ${COR_TAG[s.cor] || ''}">${esc(s.titulo)}</span></div><div class="panel-body"><p class="muted">${esc(s.texto)}</p></div></section>
            <div class="cards">${card(precisa, 'Precisam de você', 'conflitos, pendências e ambíguos', precisa ? 'red' : 'green', 0)}
            ${card(t.conflitos || 0, 'Conflitos', 'mudou dos dois lados', '', 1)}${card(t.pendentes || 0, 'Pendentes', 'dado que a sync não lê', '', 2)}
            ${card(t.ambiguas || 0, 'Ambíguos', 'mais de um pedido possível', '', 3)}
            ${card(t.acoes || 0, painel && painel.gravou ? 'Feitas pela sync' : 'A sync vai fazer', 'cópias entre planilha e portal', 'green', 4)}</div>`;
    }

    function htmlRevisar(itens, filtro, busca, todos, grupo = '') {
        const tipos = [...new Set(todos.map(i => i.filtro))].sort();
        const cont = {};
        todos.forEach(i => { cont[i.tipo] = (cont[i.tipo] || 0) + 1; });
        const max = Math.max(1, ...Object.values(cont));
        const barras = Object.entries(cont).sort((a, b) => b[1] - a[1]).map(([tipo, n]) => {
            const t = TIPOS[tipo] || TIPOS.outro;
            return `<button class="barra${tipo === grupo ? ' selecionado' : ''}" aria-pressed="${tipo === grupo}" data-acao="tipo" data-tipo="${esc(tipo)}"><span>${esc(t.titulo)}</span><span class="barra-trilho"><i class="${t.cor}" style="--w:${Math.round(100 * n / max)}%"></i></span><b>${n}</b></button>`;
        }).join('');
        const grupos = {};
        itens.forEach(i => (grupos[i.tipo] = grupos[i.tipo] || []).push(i));
        const secoes = Object.entries(grupos).map(([tipo, lista]) => {
            const t = TIPOS[tipo] || TIPOS.outro;
            return `<div class="ajuda"><div><b>${esc(t.titulo)} · o que é</b>${esc(t.oque)}</div><div><b>O que fazer</b>${esc(t.fazer)}</div></div>
                <ul class="lista">${lista.map(i => `<li><span class="rotulo">${i.linha != null ? `Linha ${esc(i.linha)}` : esc(i.lado === 'portal' ? 'Portal' : '—')}<br><span class="tag ${COR_TAG[t.cor] || ''}">${esc(i.filtro)}</span></span>
                    <div class="principal"><strong>${esc(i.pedido || 'Sem pedido')}${i.rfq ? ` · RFQ ${esc(i.rfq)}` : ''} · ${esc(i.produto)}</strong><p>${esc(i.detalhe)}</p></div>
                    <span class="lado">${i.excel ? `Planilha: ${esc(i.excel)}<br>` : ''}${i.portal ? `Portal: ${esc(i.portal)}` : ''}</span></li>`).join('')}</ul>`;
        }).join('');
        return `<section class="panel bloco entra" style="--i:2"><div class="panel-head"><div><h2>O que precisa de você</h2><p>Clique num tipo para filtrar. Cada grupo diz o que é e o que fazer.</p></div></div>
            ${todos.length ? `<div class="barras">${barras}</div>` : ''}
            <div class="filtros"><label class="field"><span class="field-label">Tipo</span><select id="filtro-sync-tipo" data-filtro="tipo"><option value="">Todos (${todos.length})</option>${tipos.map(t => `<option ${t === filtro ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
            <label class="field search-field"><span class="field-label">Buscar</span><span class="search-box"><input id="filtro-sync-busca" type="search" data-filtro="busca" placeholder="Pedido, RFQ, produto ou linha…" value="${esc(busca)}"></span></label></div>
            ${itens.length ? secoes : `<p class="vazio">${todos.length ? 'Nada com este filtro.' : 'Nada para revisar. A planilha e o portal estão em dia.'}</p>`}
            <div class="lista-rodape"><span>${itens.length} de ${todos.length} item(ns)</span><span>${esc(RESOLVE)}</span></div></section>`;
    }

    function htmlAcoes(painel) {
        const l = (painel && painel.listas) || {};
        const acoes = l.acoes || [];
        const feito = painel && painel.gravou;
        const historico = (l.historico || []).length;
        const itens = acoes.map(a => {
            const p = a.pedido || {};
            const pedido = a.tipo === 'novo' ? (p.PEDIDO ?? partes(a.chave).pedido) : partes(a.chave).pedido;
            const oque = a.tipo === 'novo' ? `Pedido novo: ${p.PRODUTO || partes(a.chave).produto}`
                : `${a.campo}: "${fmtValor(a.antes, a.campo)}" → "${fmtValor(a.valor, a.campo)}"`;
            return `<li><span class="rotulo">${a.destino === 'excel' ? 'Portal → planilha' : 'Planilha → portal'}</span><div class="principal"><strong>${esc(pedido)}</strong><p>${esc(oque)}</p></div><span class="lado">${esc(a.linha ?? '(nova)')}</span></li>`;
        }).join('');
        return `<section class="panel bloco entra" style="--i:3"><div class="panel-head"><div><h2>O que a sync faz sozinha</h2><p>${feito ? 'Feito na última rodada.' : 'Previsto para a próxima rodada que conseguir gravar.'}</p></div></div>
            ${acoes.length ? `<ul class="lista">${itens}</ul>` : '<p class="vazio">Nenhuma cópia pendente entre planilha e portal.</p>'}
            ${historico ? `<p class="vazio">${historico} pedido(s) antigo(s) existem só de um lado desde antes da sync começar. Eles não são copiados de propósito (não é erro).</p>` : ''}</section>`;
    }

    const TIPO_RODADA = { gravou: 'ok', sem_acoes: 'info', inicializou: 'info', adiado: 'aviso', erro: 'erro' };

    function htmlHistorico(painel) {
        const rodadas = (painel && painel.rodadas) || [];
        let corpo = '<p class="vazio">O histórico começa a ser registrado a partir desta versão.</p>';
        if (rodadas.length) {
            const dias = {};
            rodadas.forEach(r => (dias[r.em.slice(0, 10)] = dias[r.em.slice(0, 10)] || []).push(r));
            corpo = `<ol class="linha-tempo">${Object.entries(dias).reverse().map(([dia, lista]) => `<li class="dia">${esc(dia)}</li>${lista.slice().reverse().map(r =>
                `<li class="evento ${TIPO_RODADA[r.resultado] || 'info'}"><time>${esc(r.em.slice(11, 16))}</time><span class="ponto"></span>
                <div class="texto"><strong>${esc(NOME_RESULTADO[r.resultado] || r.resultado)}</strong>${r.aviso ? `<p>${esc(r.aviso)}</p>` : ''}</div>
                <span class="tag">${esc((r.contagens || {}).acoes ?? 0)} ações · ${esc((r.contagens || {}).conflitos ?? 0)} conflitos</span></li>`).join('')}`).join('')}</ol>`;
        }
        return `<section class="panel bloco entra" style="--i:4"><div class="panel-head"><div><h2>Histórico de 7 dias</h2><p>Uma linha por rodada da tarefa "Maestro Sync Planilha".</p></div></div>${corpo}</section>`;
    }

    const NOME_CONFERENCIA = {
        planilha_sem_portal: 'Na planilha e não no portal', portal_sem_planilha: 'No portal e não na planilha',
        campos_divergentes: 'Campos diferentes', ambiguas: 'Ambíguas', nf_divergente: 'NF diferente',
        nf_so_no_portal: 'NF só no portal', nf_so_no_portal_lista: 'NF só no portal (lista)',
        linhas: 'Linhas lidas da planilha', pedidos: 'Pedidos no portal', ignoradas: 'Linhas ignoradas',
    };

    function htmlConferencia(painel, icone) {
        const tot = (painel && painel.conferencia_totais) || {};
        const listas = (painel && painel.conferencia) || {};
        const resumo = Object.entries(NOME_CONFERENCIA).filter(([k]) => k in tot)
            .map(([k, nome]) => `<li><span class="rotulo">${esc(nome)}</span><div class="principal"></div><span class="lado"><b>${esc(tot[k])}</b></span></li>`).join('');
        const outros = x => Object.entries(x).filter(([k]) => !['linha', 'pedido', 'produto', 'indice_portal'].includes(k))
            .map(([k, v]) => `${k}: ${fmtValor(v, k === 'planilha' || k === 'portal' ? x.campo : k)}`).join(' · ');
        const tabela = (nome, lista) => !lista.length ? '' : `<details class="recolhido"><summary><span>${esc(NOME_CONFERENCIA[nome] || nome)} (${lista.length})</span>${icone('abaixo')}</summary>
            <ul class="lista">${lista.slice(0, 200).map(x => `<li><span class="rotulo">${x.linha != null ? `Linha ${esc(x.linha)}` : '—'}</span><div class="principal"><strong>${esc(x.pedido ?? '')} · ${esc(x.produto ?? '')}</strong>
            <p>${esc(outros(x))}</p></div><span class="lado"></span></li>`).join('')}</ul></details>`;
        return `<details class="panel recolhido bloco"><summary><div><h2>Conferência geral (planilha × portal)</h2><p class="muted" style="font-size:10px;margin-top:5px">Comparação de tudo, inclusive pedidos antigos. <b>Não é erro da sincronização</b>: use para limpeza aos poucos.</p></div>${icone('abaixo')}</summary>
            <ul class="lista">${resumo}</ul>${Object.entries(listas).map(([k, v]) => tabela(k, v)).join('')}</details>`;
    }

    // filtro.grupo vem do clique na barra (tipo de item); filtro.tipo, do select (rótulo fino)
    function pagina(painel, ctx, filtro = { grupo: '', tipo: '', busca: '' }) {
        const todos = itensParaRevisar(painel);
        const itens = filtrar(todos.filter(i => !filtro.grupo || i.tipo === filtro.grupo), filtro.tipo, filtro.busca);
        return htmlSituacao(painel, ctx.agora(), ctx) + htmlRevisar(itens, filtro.tipo, filtro.busca, todos, filtro.grupo) +
            htmlAcoes(painel) + htmlHistorico(painel) + htmlConferencia(painel, ctx.icone);
    }

    const api = { esc, fmtValor, itensParaRevisar, filtrar, proximaRodada, situacao, pagina, TIPOS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else global.DashSync = api;

    if (typeof document !== 'undefined' && document.body && document.body.dataset.dashboard === 'sync') {
        const f = { grupo: '', tipo: '', busca: '' };
        global.Dash.iniciar({ pagina: 'sync', fonte: 'sync', titulo: 'Sincronização planilha',
            subtitulo: 'Planilha dos estagiários ⇄ portal: situação, o que precisa de você, o que a sync faz sozinha e o histórico de 7 dias.',
            render: (p, ctx) => pagina(p, ctx, f),
            acoes: { tipo: el => { f.grupo = f.grupo === el.dataset.tipo ? '' : el.dataset.tipo; f.tipo = ''; } },
            filtrar: (k, v) => { f[k] = v; } });
    }
})(typeof window !== 'undefined' ? window : globalThis);
