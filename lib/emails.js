const crypto = require('node:crypto');
const { lerSessao } = require('./dashboard-cotacoes');

// Central de E-mails: o portal não guarda conteúdo. Confere a sessão a cada pedido, repassa ao serviço
// de e-mails (Python, vaga emails_socket_id) e devolve só se a sessão ainda valer na volta.
const ACOES = new Set(['listar', 'detalhe', 'html', 'anexo']);
const LIMITE_ANEXO = 25 * 1024 * 1024;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function podeVerEmails(user) {
    return !!user && (user.admin === true || user.emails_access === true);
}
function autorizarEmails(sessoes, socket, evento, requestId) {
    const user = lerSessao(sessoes, socket);
    if (!user) { socket.emit('sessao_invalida'); return null; }
    if (!podeVerEmails(user)) {
        socket.emit(evento, { sucesso: false, codigo: 'SEM_PERMISSAO', requestId,
            erro: 'Você não tem permissão para ver os e-mails. Peça o acesso "E-mails" a um administrador.' });
        return null;
    }
    return user;
}

const texto = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
const inteiro = v => (Number.isSafeInteger(v) && v > 0 ? v : null);
function sanear(acao, p) {
    p = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    if (acao === 'listar') {
        return { categoria: texto(p.categoria, 40), conta: texto(p.conta, 120), status: texto(p.status, 20),
            de: DATA.test(p.de) ? p.de : '', ate: DATA.test(p.ate) ? p.ate : '', busca: texto(p.busca, 200),
            cursor: texto(p.cursor, 80), revisao: p.revisao === true };
    }
    const id = inteiro(p.id);
    if (!id) return null;
    if (acao === 'anexo') {
        const anexo = inteiro(p.anexo);
        return anexo ? { id, anexo } : null;
    }
    return { id };
}

function nomeSeguro(nome) {
    const limpo = String(nome || 'anexo').replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, '_').slice(0, 150).trim();
    return limpo || 'anexo';
}

function criarEmails({ sessoes, io, obterServico, obterSocket, timeoutMs = 20000, anexoTtlMs = 60000 }) {
    const pendentes = new Map();
    const anexos = new Map();

    function responder(socket, dados) { socket.emit('emails_retorno', dados); }
    function remover(id) {
        const p = pendentes.get(id);
        if (p) clearTimeout(p.timer);
        pendentes.delete(id);
        return p;
    }
    function limparCliente(socketId) {
        for (const [id, p] of pendentes) if (p.socketId === socketId) remover(id);
    }
    function falhar(p, codigo, erro) {
        const socket = obterSocket(p.socketId);
        if (socket && autorizarEmails(sessoes, socket, 'emails_retorno', p.requestId)) {
            responder(socket, { sucesso: false, requestId: p.requestId, acao: p.acao, codigo, erro });
        }
    }

    function conectar(socket) {
        socket.on('emails_pedir', (dados = {}) => {
            const requestId = texto(dados && dados.requestId, 80);
            const acao = dados && dados.acao;
            if (!autorizarEmails(sessoes, socket, 'emails_retorno', requestId)) return;
            if (!ACOES.has(acao)) {
                return responder(socket, { sucesso: false, requestId, acao: null, codigo: 'ACAO_INVALIDA', erro: 'Pedido inválido.' });
            }
            const params = sanear(acao, dados.params);
            if (!params) {
                return responder(socket, { sucesso: false, requestId, acao, codigo: 'PARAMETRO_INVALIDO', erro: 'Pedido inválido.' });
            }
            const servico = obterServico();
            if (!servico) {
                return responder(socket, { sucesso: false, requestId, acao, codigo: 'FONTE_OFFLINE',
                    erro: 'O serviço de e-mails está offline. Os e-mails não puderam ser carregados.' });
            }
            // Um pedido de cada tipo por tela: o mais novo substitui o anterior
            for (const [id, p] of pendentes) if (p.socketId === socket.id && p.acao === acao) remover(id);
            const id = 'emails:' + crypto.randomUUID();
            const timer = setTimeout(() => {
                const p = remover(id);
                if (p) falhar(p, 'TEMPO_ESGOTADO', 'O serviço de e-mails não respondeu a tempo. Tente de novo.');
            }, acao === 'anexo' ? timeoutMs * 3 : timeoutMs);
            timer.unref?.();
            pendentes.set(id, { socketId: socket.id, requestId, acao, timer });
            io.to(servico).emit('emails_pedido', { id, acao, params });
        });
        socket.on('emails_entrar', () => {
            if (autorizarEmails(sessoes, socket, 'emails_retorno', '')) socket.join('emails');
        });
        socket.on('disconnect', () => limparCliente(socket.id));
    }

    function receber(origem, dados = {}) {
        if (!obterServico() || origem !== obterServico()) return false;
        const id = dados && dados.id;
        if (typeof id !== 'string' || !id.startsWith('emails:')) return false;
        const p = remover(id);
        if (!p) return true; // resposta atrasada ou pedido substituído
        const socket = obterSocket(p.socketId);
        if (!socket || !autorizarEmails(sessoes, socket, 'emails_retorno', p.requestId)) return true;
        if (dados.sucesso !== true || !dados.dados || typeof dados.dados !== 'object' || Array.isArray(dados.dados)) {
            responder(socket, { sucesso: false, requestId: p.requestId, acao: p.acao,
                codigo: texto(dados.codigo, 40) || 'ERRO_SERVICO', erro: texto(dados.erro, 300) || 'O serviço de e-mails não conseguiu atender o pedido.' });
            return true;
        }
        if (p.acao === 'anexo') {
            const conteudo = typeof dados.dados.conteudo === 'string' ? Buffer.from(dados.dados.conteudo, 'base64') : null;
            if (!conteudo || conteudo.length > LIMITE_ANEXO) {
                responder(socket, { sucesso: false, requestId: p.requestId, acao: 'anexo', codigo: 'ANEXO_INVALIDO',
                    erro: 'O anexo não pôde ser entregue (vazio ou acima de 25 MB).' });
                return true;
            }
            const token = crypto.randomBytes(32).toString('hex');
            const timer = setTimeout(() => anexos.delete(token), anexoTtlMs);
            timer.unref?.();
            anexos.set(token, { nome: nomeSeguro(dados.dados.nome), conteudo, timer });
            responder(socket, { sucesso: true, requestId: p.requestId, acao: 'anexo',
                dados: { url: '/emails/anexo/' + token, nome: nomeSeguro(dados.dados.nome), tamanho: conteudo.length } });
            return true;
        }
        responder(socket, { sucesso: true, requestId: p.requestId, acao: p.acao, dados: dados.dados });
        return true;
    }

    // Uso único: o token some na primeira leitura ou em 60 s.
    function retirarAnexo(token) {
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
        const a = anexos.get(token);
        if (!a) return null;
        clearTimeout(a.timer);
        anexos.delete(token);
        return { nome: a.nome, conteudo: a.conteudo };
    }

    function novidade(origem, dados = {}) {
        if (!obterServico() || origem !== obterServico()) return;
        const novos = Number.isSafeInteger(dados.novos) ? dados.novos : 0;
        const sala = io.sockets && io.sockets.adapter && io.sockets.adapter.rooms.get('emails');
        for (const sid of [...(sala || [])]) {
            const s = obterSocket(sid);
            if (!s) continue;
            if (podeVerEmails(lerSessao(sessoes, s))) s.emit('emails_novidade', { novos });
            else s.leave('emails');
        }
    }

    function servicoCaiu() {
        for (const id of [...pendentes.keys()]) {
            const p = remover(id);
            falhar(p, 'FONTE_OFFLINE', 'O serviço de e-mails desconectou. Tente de novo em instantes.');
        }
    }

    function fechar() {
        for (const id of [...pendentes.keys()]) remover(id);
        for (const a of anexos.values()) clearTimeout(a.timer);
        anexos.clear();
    }

    return { conectar, receber, retirarAnexo, novidade, servicoCaiu, fechar };
}

module.exports = { criarEmails, autorizarEmails, podeVerEmails, nomeSeguro };
