const crypto = require('node:crypto');

// Sessão real do cofre do servidor; o que o navegador guarda nunca dá acesso.
function lerSessao(sessoes, socket) {
    const raw = socket?.sessionId && sessoes.get(socket.sessionId);
    if (!raw) return null;
    try {
        const user = JSON.parse(raw);
        if (!Number.isFinite(user.expires) || user.expires <= Date.now() || user.bloqueado === true) return null;
        return user;
    } catch { return null; }
}
function autorizarAdmin(sessoes, socket, evento, requestId) {
    const user = lerSessao(sessoes, socket);
    if (!user) { socket.emit('sessao_invalida'); return null; }
    if (user.admin !== true) {
        socket.emit(evento, { sucesso: false, codigo: 'SEM_PERMISSAO', requestId,
            erro: 'Esta área é exclusiva de administradores.' });
        return null;
    }
    return user;
}

function criarDashboardCotacoes({ sessoes, io, obterRobo, obterSocket, timeoutMs = 30000 }) {
    const pendentes = new Map();
    const expiracoes = new Map();

    function sessao(socket) { return lerSessao(sessoes, socket); }
    function administrador(socket) { return sessao(socket)?.admin === true; }
    function autorizar(socket, evento, requestId) { return autorizarAdmin(sessoes, socket, evento, requestId); }
    function remover(id) {
        const pending = pendentes.get(id);
        if (pending) clearTimeout(pending.timer);
        pendentes.delete(id);
    }
    function limparCliente(id) {
        for (const [key, pending] of pendentes) if (pending.socketId === id) remover(key);
        clearTimeout(expiracoes.get(id)); expiracoes.delete(id);
    }
    function conectar(socket) {
        socket.on('solicitar_acesso_estatisticas', () => {
            const user = autorizar(socket, 'acesso_estatisticas');
            if (!user) return;
            socket.emit('acesso_estatisticas', { sucesso: true, admin: true, email: user.email, expires: user.expires });
            clearTimeout(expiracoes.get(socket.id));
            const timer = setTimeout(() => {
                socket.emit('sessao_invalida'); limparCliente(socket.id);
            }, Math.min(2147483647, Math.max(1, user.expires - Date.now())));
            timer.unref?.(); expiracoes.set(socket.id, timer);
        });
        socket.on('solicitar_dashboard_cotacoes', (dados = {}) => {
            const requestId = typeof dados?.requestId === 'string' ? dados.requestId.slice(0, 80) : '';
            if (!autorizar(socket, 'retorno_dashboard_cotacoes', requestId)) return;
            const robo = obterRobo();
            if (!robo) return socket.emit('retorno_dashboard_cotacoes', { sucesso: false, requestId,
                codigo: 'FONTE_OFFLINE', erro: 'O gerenciador está offline. Tente atualizar quando a conexão for restabelecida.' });
            for (const [key, pending] of pendentes) if (pending.socketId === socket.id) remover(key);
            const id = 'dashboard:' + crypto.randomUUID();
            const timer = setTimeout(() => {
                remover(id);
                if (autorizar(socket, 'retorno_dashboard_cotacoes', requestId)) socket.emit('retorno_dashboard_cotacoes', {
                    sucesso: false, requestId, codigo: 'TEMPO_ESGOTADO', erro: 'O gerenciador não confirmou a leitura. Tente atualizar.' });
            }, timeoutMs);
            timer.unref?.();
            pendentes.set(id, { socketId: socket.id, requestId, timer });
            io.to(robo).emit('comando_carregar_planilha_json', { origem: 'todas', clientId: id });
        });
        socket.on('disconnect', () => limparCliente(socket.id));
    }
    function receber(origem, dados = {}) {
        if (!obterRobo() || origem !== obterRobo()) return false;
        const id = dados?.clientId;
        if (typeof id !== 'string' || !id.startsWith('dashboard:')) return false;
        const pending = pendentes.get(id);
        if (!pending) return true; // resposta antiga ou consulta já cancelada
        remover(id);
        const socket = obterSocket(pending.socketId);
        if (!socket || !autorizar(socket, 'retorno_dashboard_cotacoes', pending.requestId)) return true;
        if (dados.sucesso !== true || !Array.isArray(dados.cotacoes) || dados.cotacoes.some(row => !row || typeof row !== 'object' || Array.isArray(row))) {
            socket.emit('retorno_dashboard_cotacoes', { sucesso: false, requestId: pending.requestId,
                codigo: 'BASE_INDISPONIVEL', erro: 'A base de cotações não pôde ser lida ou contém registros inválidos. Verifique o gerenciador e tente atualizar.' });
            return true;
        }
        socket.emit('retorno_dashboard_cotacoes', { sucesso: true, requestId: pending.requestId,
            cotacoes: dados.cotacoes, consultado_em: new Date().toISOString(), fonte: 'COTAÇÕES.json' });
        return true;
    }
    function fechar() {
        for (const id of pendentes.keys()) remover(id);
        for (const timer of expiracoes.values()) clearTimeout(timer);
        expiracoes.clear();
    }
    return { conectar, receber, administrador, fechar };
}
module.exports = { criarDashboardCotacoes, lerSessao, autorizarAdmin };
