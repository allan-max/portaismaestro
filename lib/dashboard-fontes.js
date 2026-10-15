const crypto = require('node:crypto');
const { autorizarAdmin } = require('./dashboard-cotacoes');

// De onde vem cada parte dos dashboards novos (todos só leitura).
// destino: 'robo' = gerenciador (ROBO_SECRET), 'sync' = serviço de NF (SYNC_NF_TOKEN).
const PARTES = {
    sync: { destino: 'sync', pedido: 'comando_sync_planilha_painel', resposta: 'retorno_sync_planilha_painel', chave: 'painel' },
    nfs: { destino: 'sync', pedido: 'comando_nf_painel', resposta: 'retorno_nf_painel', chave: 'painel' },
    eventos_nf: { destino: 'sync', pedido: 'comando_eventos_nf', resposta: 'retorno_eventos_nf', chave: 'resultado' },
    eventos_gerenciador: { destino: 'robo', pedido: 'comando_eventos', resposta: 'retorno_eventos', chave: 'resultado' },
    estado_nf: { destino: 'sync', pedido: 'comando_sync_nf_estado', resposta: 'retorno_sync_nf_estado', chave: 'estado' },
};
const DASHBOARDS = {
    sync: ['sync'], nfs: ['nfs'], atividade: ['eventos_gerenciador', 'eventos_nf'], saude: ['estado_nf'],
};
const NOME_FONTE = { robo: 'O gerenciador', sync: 'O serviço de NF' };
const RESPOSTAS = new Set(Object.values(PARTES).map(p => p.resposta));
const MAX_EVENTOS = 500;
const CAMPOS_EVENTO = ['em', 'servico', 'tipo', 'nivel', 'resumo', 'ref'];

function objeto(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// Só o contrato; texto vira string (o navegador ainda escapa ao mostrar).
function limparEvento(e, fonte) {
    if (!objeto(e) || typeof e.em !== 'string' || Number.isNaN(Date.parse(e.em))) return null;
    const saida = { fonte };
    for (const k of CAMPOS_EVENTO) saida[k] = e[k] == null ? null : String(e[k]).slice(0, k === 'resumo' ? 200 : 80);
    saida.detalhe = objeto(e.detalhe) ? e.detalhe : {};
    return saida;
}

function juntarEventos(listas, limite = 200) {
    const todos = [];
    for (const [fonte, eventos] of Object.entries(listas)) {
        for (const e of Array.isArray(eventos) ? eventos : []) {
            const limpo = limparEvento(e, fonte);
            if (limpo) todos.push(limpo);
        }
    }
    todos.sort((a, b) => Date.parse(b.em) - Date.parse(a.em));
    return todos.slice(0, Math.max(1, Math.min(Number(limite) || 200, MAX_EVENTOS)));
}

function criarDashboardFontes({ sessoes, io, obterSocket, obterRobo, obterSync, obterConexoes, timeoutMs = 30000 }) {
    const pedidos = new Map();      // id do pedido -> { socketId, requestId, dashboard, partes, timer }
    const porCliente = new Map();   // clientId mandado à fonte -> { pedidoId, nome }
    const destinos = { robo: obterRobo, sync: obterSync };

    function remover(id) {
        const p = pedidos.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        for (const parte of Object.values(p.partes)) porCliente.delete(parte.clientId);
        pedidos.delete(id);
    }

    function falha(status) {
        if (status === 'offline') return 'FONTE_OFFLINE';
        if (status === 'tempo') return 'TEMPO_ESGOTADO';
        return 'FONTE_ERRO';
    }

    function mensagem(parte) {
        const quem = NOME_FONTE[PARTES[parte.nome].destino];
        if (parte.status === 'offline') return `${quem} está offline.`;
        if (parte.status === 'tempo') return `${quem} não respondeu a tempo.`;
        return parte.erro || `${quem} devolveu uma resposta inválida.`;
    }

    function montar(p) {
        const base = { requestId: p.requestId, consultado_em: new Date().toISOString() };
        const partes = p.partes;
        if (p.dashboard === 'atividade') {
            const ok = Object.values(partes).filter(x => x.status === 'ok');
            const fontes = {};
            for (const x of Object.values(partes)) {
                fontes[PARTES[x.nome].destino === 'robo' ? 'gerenciador' : 'nf'] =
                    x.status === 'ok' ? { status: 'ok', erros: x.dados.erros || {} } : { status: x.status, erro: mensagem(x) };
            }
            if (!ok.length) {
                const primeira = Object.values(partes)[0];
                return { ...base, sucesso: false, codigo: falha(primeira.status), fontes,
                    erro: 'Nenhuma fonte de eventos respondeu.' };
            }
            const listas = {};
            for (const x of ok) listas[PARTES[x.nome].destino === 'robo' ? 'gerenciador' : 'nf'] = x.dados.eventos;
            return { ...base, sucesso: true, fontes, eventos: juntarEventos(listas, p.limite) };
        }
        if (p.dashboard === 'saude') {
            const nf = partes.estado_nf;
            return { ...base, sucesso: true, conexoes: obterConexoes(),
                estado_nf: nf.status === 'ok' ? nf.dados : null, estado_nf_erro: nf.status === 'ok' ? null : mensagem(nf) };
        }
        const unica = Object.values(partes)[0];
        if (unica.status !== 'ok') return { ...base, sucesso: false, codigo: falha(unica.status), erro: mensagem(unica) };
        return { ...base, sucesso: true, painel: unica.dados };
    }

    function finalizar(id) {
        const p = pedidos.get(id);
        if (!p) return;
        remover(id);
        const socket = obterSocket(p.socketId);
        const evento = `retorno_dashboard_${p.dashboard}`;
        if (!socket || !autorizarAdmin(sessoes, socket, evento, p.requestId)) return;   // revalida na entrega
        socket.emit(evento, montar(p));
    }

    function talvezFinalizar(id) {
        const p = pedidos.get(id);
        if (p && Object.values(p.partes).every(x => x.status !== 'aguardando')) finalizar(id);
    }

    function solicitar(socket, dashboard, dados) {
        const evento = `retorno_dashboard_${dashboard}`;
        const requestId = typeof dados?.requestId === 'string' ? dados.requestId.slice(0, 80) : '';
        if (!autorizarAdmin(sessoes, socket, evento, requestId)) return;
        for (const [id, p] of pedidos) if (p.socketId === socket.id && p.dashboard === dashboard) remover(id);
        const id = crypto.randomUUID();
        const limite = Math.max(1, Math.min(Number(dados?.limite) || 200, MAX_EVENTOS));
        const desde = typeof dados?.desde === 'string' ? dados.desde.slice(0, 40) : null;
        const p = { socketId: socket.id, requestId, dashboard, limite, partes: {} };
        pedidos.set(id, p);
        for (const nome of DASHBOARDS[dashboard]) {
            const cfg = PARTES[nome];
            const destino = destinos[cfg.destino]();
            const clientId = `painel:${id}:${nome}`;
            p.partes[nome] = { nome, clientId, origem: destino, status: destino ? 'aguardando' : 'offline' };
            if (!destino) continue;
            porCliente.set(clientId, { pedidoId: id, nome });
            const args = nome.startsWith('eventos') ? { limite, desde } : {};
            io.to(destino).emit(cfg.pedido, { ...args, clientId });
        }
        p.timer = setTimeout(() => {
            for (const parte of Object.values(p.partes)) if (parte.status === 'aguardando') parte.status = 'tempo';
            finalizar(id);
        }, timeoutMs);
        p.timer.unref?.();
        talvezFinalizar(id);
    }

    function conectar(socket) {
        for (const dashboard of Object.keys(DASHBOARDS)) {
            socket.on(`solicitar_dashboard_${dashboard}`, (dados = {}) => solicitar(socket, dashboard, dados));
        }
    }

    // true = a resposta era de um dashboard (aceita ou descartada); false = não é deste módulo.
    function receber(evento, origem, dados = {}) {
        const clientId = dados?.clientId;
        if (!RESPOSTAS.has(evento) || typeof clientId !== 'string' || !clientId.startsWith('painel:')) return false;
        const ref = porCliente.get(clientId);
        if (!ref) return true;                         // pedido já entregue, vencido ou cancelado
        const p = pedidos.get(ref.pedidoId);
        const parte = p && p.partes[ref.nome];
        const cfg = PARTES[ref.nome];
        if (!parte || cfg.resposta !== evento || origem !== parte.origem || parte.status !== 'aguardando') return true;
        const conteudo = dados[cfg.chave];
        const valido = dados.sucesso === true && objeto(conteudo) &&
            (!ref.nome.startsWith('eventos') || Array.isArray(conteudo.eventos));
        Object.assign(parte, valido ? { status: 'ok', dados: conteudo }
            : { status: 'erro', erro: dados.sucesso === true ? null : String(dados.erro || '').slice(0, 300) || null });
        porCliente.delete(clientId);
        talvezFinalizar(ref.pedidoId);
        return true;
    }

    function limparCliente(socketId) {
        for (const [id, p] of pedidos) if (p.socketId === socketId) remover(id);
    }

    function fechar() { for (const id of [...pedidos.keys()]) remover(id); }

    return { conectar, receber, limparCliente, fechar };
}

module.exports = { criarDashboardFontes, juntarEventos, PARTES };
