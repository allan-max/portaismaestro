/* Faixa "Saúde dos serviços": cálculo (testável no Node) e HTML. Só leitura. */
(function (root) {
    'use strict';
    const MIN = 60 * 1000;
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // '2026-10-15T12:30:21', '15/10/2026 14:42:01' ou ISO com fuso -> Date (ou null)
    function hora(texto) {
        const t = String(texto || '').trim();
        const br = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
        if (br) return new Date(+br[3], +br[2] - 1, +br[1], +br[4], +br[5], +(br[6] || 0));
        const d = t ? new Date(t) : null;
        return d && !Number.isNaN(d.getTime()) ? d : null;
    }
    function ha(data, agora) {
        if (!data) return 'nunca';
        const min = Math.max(0, Math.round((agora - data) / MIN));
        if (min < 1) return 'agora';
        if (min < 60) return `há ${min} min`;
        const h = Math.floor(min / 60);
        return h < 48 ? `há ${h} h${min % 60 ? ` ${min % 60} min` : ''}` : `há ${Math.floor(h / 24)} dias`;
    }
    const hhmm = d => d ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

    function conexao(id, titulo, c, agora) {
        if (!c) return { id, titulo, cor: 'cinza', texto: 'Sem informação' };
        if (c.online) return { id, titulo, cor: 'verde', texto: `Online · visto ${ha(hora(c.visto_em), agora)}` };
        const desde = hora(c.desconectado_em);
        return { id, titulo, cor: 'vermelho', texto: desde ? `Offline desde ${hhmm(desde)}` : 'Offline (não conectou desde o reinício do portal)' };
    }

    // A NF roda nos dias úteis (12:30); no fim de semana e na segunda de manhã a última pode ter ~3 dias.
    function limiteNf(agora) { return ([0, 1, 6].includes(agora.getDay()) ? 74 : 26) * 60 * MIN; }

    function rodadaNf(estado, erro, agora) {
        const id = 'nf_rodada', titulo = 'Última rodada da NF';
        if (!estado) return { id, titulo, cor: 'cinza', texto: erro || 'Sem dados do serviço de NF' };
        // prévia (botão do portal sem gravar) não conta como rodada
        const ultima = (estado.historico || []).find(h => h.gravou !== false) || estado.ultima;
        const quando = hora(ultima && ultima.rodou_em);
        if (!ultima || !quando) return { id, titulo, cor: 'cinza', texto: 'Nenhuma rodada registrada' };
        if (ultima.sucesso === false) return { id, titulo, cor: 'vermelho', texto: `Falhou ${ha(quando, agora)}: ${ultima.erro || 'erro'}` };
        if (estado.rodando) return { id, titulo, cor: 'verde', texto: 'Rodando agora' };
        return { id, titulo, cor: agora - quando > limiteNf(agora) ? 'amarelo' : 'verde', texto: `${ha(quando, agora)} · ${ultima.origem || ''}`.trim() };
    }

    function cadastro(estado, agora) {
        const id = 'cadastro', titulo = 'Cadastro automático';
        const c = estado && estado.cadastro_pedidos;
        if (!c) return { id, titulo, cor: 'cinza', texto: 'Sem dados' };
        if (c.erro && c.erro.mensagem) return { id, titulo, cor: 'vermelho', texto: c.erro.mensagem };
        if (!c.ativo) return { id, titulo, cor: 'cinza', texto: 'Ainda não ativo' };
        const quando = hora(c.verificado_em);
        const idade = quando ? agora - quando : Infinity;
        return { id, titulo, cor: idade > 120 * MIN ? 'vermelho' : idade > 30 * MIN ? 'amarelo' : 'verde',
            texto: `Verificado ${ha(quando, agora)}${c.cadastrados_hoje ? ` · ${c.cadastrados_hoje} hoje` : ''}` };
    }

    function sync(estado) {
        const id = 'sync', titulo = 'Sync planilha';
        const s = estado && estado.sync_planilha_portal;
        if (!s) return { id, titulo, cor: 'cinza', texto: estado ? 'Ainda não rodou' : 'Sem dados' };
        if (s.erro) return { id, titulo, cor: 'vermelho', texto: s.erro };
        if (s.adiado) return { id, titulo, cor: 'amarelo', texto: `Adiada: ${s.aviso || 'tenta de novo'}` };
        return { id, titulo, cor: 'verde', texto: `Última rodada ${s.gerado_em || '—'}` };
    }

    function cotacoes(m) {
        const id = 'cotacoes', titulo = 'Cotações pendentes';
        if (!m) return { id, titulo, cor: 'cinza', texto: 'Carregando a base…' };
        return { id, titulo, cor: m.today ? 'amarelo' : 'verde', texto: '', cotas: [
            { prazo: 'today', rotulo: 'vencem hoje', n: m.today },
            { prazo: 'overdue', rotulo: 'vencidas', n: m.overdue },
            { prazo: 'next7', rotulo: 'próx. 7 dias', n: m.next7 }] };
    }

    // dados = resposta de solicitar_dashboard_saude; metricas = DashboardData.metrics(...) ou null
    function calcular(dados, metricas, agora = new Date()) {
        const conexoes = (dados && dados.conexoes) || {};
        const estado = dados ? dados.estado_nf : null;
        return [
            conexao('gerenciador', 'Gerenciador', conexoes.gerenciador, agora),
            conexao('nf', 'Serviço de NF', conexoes.nf, agora),
            rodadaNf(estado, dados && dados.estado_nf_erro, agora),
            cadastro(estado, agora),
            sync(estado),
            cotacoes(metricas),
        ];
    }

    const LINK = { gerenciador: 'atividade.html', nf: 'nfs.html', nf_rodada: 'nfs.html', cadastro: 'nfs.html', sync: 'sync.html' };
    function html(itens) {
        return `<section class="saude" aria-label="Saúde dos serviços">${itens.map(i => {
            const corpo = `<span class="saude-luz" aria-hidden="true"></span><div><b>${esc(i.titulo)}</b>${i.cotas
                ? `<div class="saude-cotas">${i.cotas.map(c => `<a href="dashboard2.html?prazo=${c.prazo}"><strong>${Number(c.n).toLocaleString('pt-BR')}</strong> ${c.rotulo}</a>`).join('')}</div>`
                : `<span title="${esc(i.texto)}">${esc(i.texto)}</span>`}</div>`;
            const cls = `saude-item ${i.cor}`, rotulo = `${esc(i.titulo)}: ${({ verde: 'ok', amarelo: 'atenção', vermelho: 'problema', cinza: 'sem dados' })[i.cor]}`;
            return i.cotas ? `<div class="${cls}" aria-label="${rotulo}">${corpo}</div>`
                : `<a class="${cls}" href="${LINK[i.id]}" aria-label="${rotulo}">${corpo}</a>`;
        }).join('')}</section>`;
    }

    const api = { calcular, html, hora, ha, esc };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DashSaude = api;
})(typeof window !== 'undefined' ? window : globalThis);
