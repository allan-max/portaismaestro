/* "Rodar agora" (sincronizar.html): roda na hora o que só roda no horário (docs/sincronizacao/plano.md).
   Estado dos cartões: dashboard 'sincronizar' (gerenciador + serviço de NF). Disparo: solicitar_sincronizacao. */
(function () {
    'use strict';
    const SILENCIO_MS = 25 * 1000;   // sem nenhuma resposta do serviço depois do clique: versão sem o botão?

    const CARTOES = [
        { id: 'ciclo_coupa', fonte: 'gerenciador', titulo: 'Ciclo Coupa', horario: 'Automático: Auto-Pilot, a cada 3 h',
            faz: 'Liga o robô, extrai, verifica e desliga (o mesmo ciclo do Auto-Pilot).' },
        { id: 'ciclo_vale', fonte: 'gerenciador', titulo: 'Ciclo Vale', horario: 'Automático: Auto-Pilot, a cada 3 h',
            faz: 'Liga, extrai, verifica e desliga. Conta como a verificação do dia.',
            confirmar: 'A verificação da Vale vai pedir o código OTP no painel da Vale. Rodar agora?' },
        { id: 'nf_completo', fonte: 'nf', titulo: 'NF completo', horario: 'Automático: 07:30',
            faz: 'Busca as NFs no HSE, grava no portal e depois na coluna N da planilha dos estagiários.' },
        { id: 'sync_planilha', fonte: 'nf', titulo: 'Sync planilha ⇄ portal', horario: 'Automático: dias úteis, 12:30 às 18:00',
            faz: 'Leva as alterações da planilha dos estagiários para o portal e do portal para a planilha, mesmo depois da rodada do dia.' },
        { id: 'backup', fonte: 'gerenciador', titulo: 'Backup', horario: 'Automático: 07:00',
            faz: 'Copia COTAÇÕES e PEDIDOS para a pasta de backups.' },
        { id: 'atualizador', fonte: 'local', titulo: 'Procurar atualização', horario: 'Automático: a cada 5 min',
            faz: 'Roda agora o atualizador do portal e do gerenciador. O andamento aparece na Atividade.',
            confirmar: 'Se houver versão nova, o portal e o gerenciador reiniciam e todas as telas desconectam por alguns segundos. Procurar agora?' },
    ];
    const STATUS = { rodando: ['Rodando', 'azul'], ok: ['Concluído', 'verde'], erro: ['Erro', 'vermelho'], parado: ['Parado', ''], offline: ['Offline', 'amarelo'] };
    const ORIGEM = { agendado: 'automático', portal: 'pelo portal' };
    const cartao = id => CARTOES.find(c => c.id === id);
    const doEstado = (c, dados) => (c.fonte === 'local' ? null : ((dados && dados.estado) || {})[c.fonte]);

    function status(c, dados, vivo) {
        const v = vivo[c.id] || {}, est = doEstado(c, dados);
        const fonte = c.fonte === 'local' ? { status: 'ok' } : (((dados && dados.fontes) || {})[c.fonte] || { status: 'offline' });
        if (v.rodando || (est && (est.rodando || []).includes(c.id))) return { id: 'rodando', texto: v.mensagem || 'Rodando…' };
        if (fonte.status !== 'ok') {
            return { id: 'offline', texto: fonte.status === 'tempo'
                ? `${fonte.erro || 'Não respondeu.'} Pode estar numa versão sem este botão.` : (fonte.erro || 'Indisponível.') };
        }
        if (v.resultado) return { id: v.resultado.sucesso ? 'ok' : 'erro', texto: v.resultado.sucesso ? v.resultado.mensagem : v.resultado.erro };
        const u = est && (est.ultimas || {})[c.id];
        if (u) return { id: u.nivel === 'erro' ? 'erro' : 'ok', texto: u.resumo };
        return { id: 'parado', texto: 'Sem execução registrada nos últimos dias.' };
    }

    function ultima(c, dados, vivo, ctx) {
        const v = vivo[c.id] || {};
        if (v.resultado) return `${ctx.hora(v.resultado.em)} · manual`;   // pode ter sido outro admin: o retorno vai para todos
        const est = doEstado(c, dados), u = est && (est.ultimas || {})[c.id];
        if (!u) return '—';
        const d = u.detalhe || {};
        const quem = d.manual === true ? `manual${d.por ? ` por ${d.por}` : ''}` : d.manual === false ? 'automático'
            : d.origem ? (ORIGEM[d.origem] || d.origem) : '';
        return quem ? `${ctx.hora(u.em)} · ${quem}` : ctx.hora(u.em);
    }

    function pagina(dados, ctx, vivo) {
        const esc = ctx.esc;
        const card = (c, i) => {
            const st = status(c, dados, vivo), [rotulo, cor] = STATUS[st.id], v = vivo[c.id] || {};
            const bloqueado = st.id === 'rodando' || st.id === 'offline';
            const acoes = v.confirmando
                ? `<p class="confirmar">${esc(c.confirmar)}</p><div class="rodar-acoes"><button class="button primary" data-acao="confirmar" data-servico="${c.id}">Sim, rodar agora</button><button class="button text" data-acao="cancelar" data-servico="${c.id}">Cancelar</button></div>`
                : `<div class="rodar-acoes"><button class="button primary" data-acao="rodar" data-servico="${c.id}"${bloqueado ? ' disabled' : ''}>${ctx.icone('atualizar')}<span>Rodar agora</span></button></div>`;
            return `<section class="panel entra rodar-card" style="--i:${i}"><div class="panel-head"><div><h2>${esc(c.titulo)}</h2><p>${esc(c.faz)}</p></div><span class="tag ${cor}">${rotulo}</span></div>
                <div class="panel-body"><p class="rodar-msg${st.id === 'erro' ? ' erro' : ''}" aria-live="polite">${esc(st.texto)}</p>
                <p class="muted">Última: ${esc(ultima(c, dados, vivo, ctx))}<br>${esc(c.horario)}</p>${acoes}</div></section>`;
        };
        return `<div class="rodar-grade">${CARTOES.map(card).join('')}</div>`;
    }

    // -- estado ao vivo desta tela (sempre uma cópia nova) --------------------------------------
    function aoProgresso(vivo, d, agora) {
        if (!d || !cartao(d.servico)) return vivo;
        const { resultado, confirmando, ...resto } = vivo[d.servico] || {};
        const novo = { ...resto, rodando: true, mensagem: d.mensagem };
        if (d.origem !== 'portal') novo.resposta_em = agora;
        return { ...vivo, [d.servico]: novo };
    }

    function aoRetorno(vivo, d, em) {
        if (!d || !cartao(d.servico)) return vivo;
        return { ...vivo, [d.servico]: { rodando: false, resultado: { ...d, em } } };
    }

    function verificarSilencio(vivo, agora) {
        let novo = vivo;
        for (const [id, v] of Object.entries(vivo)) {
            if (v.rodando && v.pedido_em != null && v.resposta_em == null && agora - v.pedido_em > SILENCIO_MS) {
                novo = { ...novo, [id]: { rodando: false, resultado: { sucesso: false, em: new Date(agora).toISOString(),
                    erro: 'O serviço não respondeu ao botão. Ele pode estar numa versão sem este botão (atualize e reinicie).' } } };
            }
        }
        return novo;
    }

    const API = { CARTOES, cartao, status, pagina, aoProgresso, aoRetorno, verificarSilencio };
    if (typeof module !== 'undefined') module.exports = API;
    if (typeof window === 'undefined' || !window.Dash || document.body.dataset.dashboard !== 'sincronizar') return;

    let vivo = {}, painel = null;
    const marcar = (id, campos) => { vivo = { ...vivo, [id]: { ...(vivo[id] || {}), ...campos } }; };

    function disparar(ctx, id) {
        const socket = ctx.socket();
        if (!cartao(id)) return;
        if (!socket || !socket.connected) { vivo = aoRetorno(vivo, { servico: id, sucesso: false, erro: 'Sem conexão com o portal.' }, new Date().toISOString()); return; }
        vivo = { ...vivo, [id]: { rodando: true, pedido_em: Date.now(), mensagem: 'Enviando…' } };
        socket.emit('solicitar_sincronizacao', { servico: id, requestId: `${id}-${Date.now()}` });
    }

    painel = window.Dash.iniciar({
        pagina: 'sincronizar', fonte: 'sincronizar', titulo: 'Rodar agora',
        subtitulo: 'Roda na hora o que hoje só roda no horário, para conferir uma alteração sem esperar.',
        breadcrumb: 'ADMINISTRAÇÃO · OPERAÇÃO', rodape: 'Os botões rodam na hora; os horários automáticos continuam iguais',
        extrair: r => ({ fontes: r.fontes, estado: r.estado }),
        render: (dados, ctx) => pagina(dados, ctx, vivo),
        acoes: {
            rodar: (el, ctx) => { const c = cartao(el.dataset.servico); if (c && c.confirmar) marcar(c.id, { confirmando: true }); else disparar(ctx, el.dataset.servico); },
            confirmar: (el, ctx) => disparar(ctx, el.dataset.servico),
            cancelar: el => marcar(el.dataset.servico, { confirmando: false }),
        },
        ouvirSocket: (socket, estado, desenhar) => {
            socket.on('progresso_sincronizacao', d => { vivo = aoProgresso(vivo, d, Date.now()); desenhar(); });
            socket.on('retorno_sincronizacao', d => {
                if (d && d.codigo === 'SEM_PERMISSAO') { estado.autorizado = false; estado.acesso = 'negado'; return desenhar(); }
                vivo = aoRetorno(vivo, d, new Date().toISOString()); desenhar();
                if (painel) painel.atualizar();          // "Última" e o que está rodando, direto das fontes
            });
            for (const portal of ['coupa', 'vale']) {    // o que o robô está fazendo no ciclo
                socket.on(`relatar_progresso_${portal}`, d => {
                    const id = `ciclo_${portal}`;
                    if (vivo[id] && vivo[id].rodando && d && d.mensagem) { marcar(id, { mensagem: String(d.mensagem) }); desenhar(); }
                });
            }
            setInterval(() => { const antes = vivo; vivo = verificarSilencio(vivo, Date.now()); if (vivo !== antes) desenhar(); }, 5000);
        },
    });
})();
