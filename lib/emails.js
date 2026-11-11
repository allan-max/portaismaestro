const crypto = require('node:crypto');
const path = require('node:path');
const { lerSessao } = require('./dashboard-cotacoes');
const { criarPreferencias } = require('./emails-preferencias');

// Central de E-mails: o portal não guarda conteúdo. Confere a sessão a cada pedido, repassa ao serviço
// de e-mails (Python, vaga emails_socket_id) e devolve só se a sessão ainda valer na volta.
// As preferências da tela são a exceção: ficam no próprio portal e não vão ao serviço.
const ACOES = new Set(['listar', 'detalhe', 'html', 'anexo', 'resumo', 'status', 'categoria', 'lote', 'desfazer',
    'preferencias', 'preferencias_salvar']);
const DO_PORTAL = new Set(['preferencias', 'preferencias_salvar']);
const COM_USUARIO = new Set(['status', 'categoria', 'lote', 'desfazer']);
const STATUS = new Set(['pendente', 'respondido', 'arquivado']);
const PERIODOS = new Set(['hoje', '7d', '30d']);
const MAX_LOTE = 100;
const LIMITE_ANEXO = 25 * 1024 * 1024;
const MAX_ANEXOS_EM_MEMORIA = 8;   // ponytail: limite global simples; por usuário se houver muita gente baixando
const LIMITE_HTML = 5 * 1024 * 1024;
// Versão formatada do e-mail: documento servido por /emails/html/:token, aberto só em iframe sandbox="".
// Sem script, sem rede, sem formulário; estilo inline e imagens e fontes data: liberados para o e-mail ter a cara dele.
const CSP_HTML_EMAIL = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
    "form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox";
// links ficam visíveis, mas não clicáveis; o fundo branco vem do iframe (tela.css)
const CABECALHO_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<style>a,area{pointer-events:none!important;cursor:default!important}body{font-family:sans-serif}</style></head><body>';
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
// Lista vinda do navegador: só os textos dos primeiros `max` itens, cada um cortado em `tam`.
const lista = (v, max, tam) => (Array.isArray(v) ? v.slice(0, max).filter(x => typeof x === 'string').map(x => x.slice(0, tam)) : []);
// Lista de 1 a 100 itens válidos, ou null (um item inválido recusa o pedido inteiro).
function lote(v, validar) {
    if (!Array.isArray(v) || v.length < 1 || v.length > MAX_LOTE) return null;
    const itens = v.map(validar);
    return itens.every(Boolean) ? itens : null;
}
function sanearListar(p) {
    p = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    return { categoria: texto(p.categoria, 40), conta: texto(p.conta, 120), status: texto(p.status, 20),
        de: DATA.test(p.de) ? p.de : '', ate: DATA.test(p.ate) ? p.ate : '', busca: texto(p.busca, 200),
        cursor: texto(p.cursor, 80), revisao: p.revisao === true,
        categorias: lista(p.categorias, 20, 40), excluir: lista(p.excluir, 20, 40), contas: lista(p.contas, 50, 120),
        estados: lista(p.estados, 3, 20).filter(s => STATUS.has(s)), anexo: p.anexo === true,
        atrasados: p.atrasados === true, remetente: texto(p.remetente, 120) };
}
function sanear(acao, p) {
    p = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    if (acao === 'listar') return sanearListar(p);
    // `admin` nunca vem do navegador: é posto em conectar() a partir da sessão
    if (acao === 'resumo') return { periodo: PERIODOS.has(p.periodo) ? p.periodo : 'hoje', contas: lista(p.contas, 50, 120) };
    if (acao === 'lote') {
        const itens = lote(p.itens, i => (i && inteiro(i.id) && STATUS.has(i.status) ? { id: i.id, status: i.status } : null));
        return itens && { itens };
    }
    if (acao === 'desfazer') {
        const auditoria = lote(p.auditoria, inteiro);
        return auditoria && { auditoria };
    }
    const id = inteiro(p.id);
    if (!id) return null;
    if (acao === 'status') return STATUS.has(p.status) ? { id, status: p.status } : null;
    if (acao === 'categoria') return texto(p.categoria, 40) ? { id, categoria: texto(p.categoria, 40) } : null;
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

function criarEmails({ sessoes, io, obterServico, obterSocket, timeoutMs = 20000, anexoTtlMs = 60000,
    prefsDir = process.env.EMAILS_PREFS_DIR || path.join(__dirname, '..', 'dados') }) {
    const pendentes = new Map();
    const anexos = new Map();
    const htmls = new Map();
    const preferencias = criarPreferencias({ dir: prefsDir, sanearFiltro: sanearListar });

    // Tratadas aqui, sem o serviço (funcionam com ele offline). Lê e grava só as do usuário da sessão.
    function tratarPreferencias(socket, user, requestId, acao, params) {
        try {
            const dados = acao === 'preferencias' ? preferencias.obter(user.email)
                : preferencias.salvar(user.email, user.admin === true, params);
            responder(socket, { sucesso: true, requestId, acao, dados });
        } catch (e) {
            if (!e.codigo) console.error('Preferências da tela de E-mails:', e.message);
            responder(socket, { sucesso: false, requestId, acao, codigo: e.codigo || 'ERRO_PREFERENCIAS',
                erro: e.codigo ? e.message : 'Não foi possível guardar as preferências agora.' });
        }
    }

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
            const user = autorizarEmails(sessoes, socket, 'emails_retorno', requestId);
            if (!user) return;
            if (!ACOES.has(acao)) {
                return responder(socket, { sucesso: false, requestId, acao: null, codigo: 'ACAO_INVALIDA', erro: 'Pedido inválido.' });
            }
            if (DO_PORTAL.has(acao)) return tratarPreferencias(socket, user, requestId, acao, dados.params);
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
            // Quem marcou vem da sessão do servidor, nunca do navegador; o mesmo para ser administrador
            if (COM_USUARIO.has(acao)) params.usuario = String(user.email || '');
            if (acao === 'resumo') params.admin = user.admin === true;
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
            if (anexos.size >= MAX_ANEXOS_EM_MEMORIA) {
                responder(socket, { sucesso: false, requestId: p.requestId, acao: 'anexo', codigo: 'OCUPADO',
                    erro: 'Muitos downloads ao mesmo tempo. Tente de novo em um minuto.' });
                return true;
            }
            const token = guardar(anexos, { nome: nomeSeguro(dados.dados.nome), conteudo });
            responder(socket, { sucesso: true, requestId: p.requestId, acao: 'anexo',
                dados: { url: '/emails/anexo/' + token, nome: nomeSeguro(dados.dados.nome), tamanho: conteudo.length } });
            return true;
        }
        if (p.acao === 'html') {
            // o HTML não volta pelo socket: fica guardado e o navegador o carrega no iframe por um endereço de uso único
            const html = typeof dados.dados.html === 'string' ? dados.dados.html : '';
            const recusa = Buffer.byteLength(html) > LIMITE_HTML ? ['HTML_GRANDE', 'A versão formatada deste e-mail é grande demais para abrir aqui.']
                : htmls.size >= MAX_ANEXOS_EM_MEMORIA ? ['OCUPADO', 'Muitas versões formatadas abertas ao mesmo tempo. Tente de novo em um minuto.'] : null;
            if (recusa) {
                responder(socket, { sucesso: false, requestId: p.requestId, acao: 'html', codigo: recusa[0], erro: recusa[1] });
                return true;
            }
            const token = guardar(htmls, { html: CABECALHO_HTML + html + '</body></html>' });
            responder(socket, { sucesso: true, requestId: p.requestId, acao: 'html', dados: { url: '/emails/html/' + token } });
            return true;
        }
        responder(socket, { sucesso: true, requestId: p.requestId, acao: p.acao, dados: dados.dados });
        return true;
    }

    // Uso único: o token some na primeira leitura ou em 60 s.
    function guardar(mapa, valor) {
        const token = crypto.randomBytes(32).toString('hex');
        const timer = setTimeout(() => mapa.delete(token), anexoTtlMs);
        timer.unref?.();
        mapa.set(token, { valor, timer });
        return token;
    }
    function retirar(mapa, token) {
        if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
        const a = mapa.get(token);
        if (!a) return null;
        clearTimeout(a.timer);
        mapa.delete(token);
        return a.valor;
    }
    const retirarAnexo = token => retirar(anexos, token);
    const retirarHtml = token => { const v = retirar(htmls, token); return v && v.html; };

    function novidade(origem, dados = {}) {
        if (!obterServico() || origem !== obterServico()) return;
        const novos = dados && Number.isSafeInteger(dados.novos) ? dados.novos : 0;
        const atrasados = dados && Number.isSafeInteger(dados.atrasados) ? dados.atrasados : null;
        const aviso = { novos, atrasados };
        // cotações e pedidos classificados no ciclo: só número, e só se vier inteiro
        for (const k of ['cotacoes', 'pedidos']) if (dados && Number.isSafeInteger(dados[k])) aviso[k] = dados[k];
        const sala = io.sockets && io.sockets.adapter && io.sockets.adapter.rooms.get('emails');
        for (const sid of [...(sala || [])]) {
            const s = obterSocket(sid);
            if (!s) continue;
            if (podeVerEmails(lerSessao(sessoes, s))) s.emit('emails_novidade', aviso);
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
        for (const mapa of [anexos, htmls]) {
            for (const a of mapa.values()) clearTimeout(a.timer);
            mapa.clear();
        }
    }

    return { conectar, receber, retirarAnexo, retirarHtml, novidade, servicoCaiu, fechar };
}

module.exports = { criarEmails, autorizarEmails, podeVerEmails, nomeSeguro, sanearListar, CSP_HTML_EMAIL };
