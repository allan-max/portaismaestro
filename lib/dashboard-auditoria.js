// Auditoria no dashboard2 (Controle → Auditoria / Usuários): leitura do log e apelidos. Só admin, conferido na sessão.
const { autorizarAdmin } = require('./dashboard-cotacoes');

const DIA_MS = 24 * 3600 * 1000;
const MAX_DIAS = 366;
const dataValida = d => typeof d === 'string' && /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);

function ipDe(socket) {
    const h = socket.handshake || {};
    return String((h.headers || {})['x-forwarded-for'] || '').split(',')[0].trim() || h.address || null;
}

function criarDashboardAuditoria({ sessoes, auditoria, registrar }) {
    function conectar(socket) {
        socket.on('solicitar_dashboard_auditoria', (p = {}) => {
            const requestId = String(p.requestId || '').slice(0, 80);
            if (!autorizarAdmin(sessoes, socket, 'retorno_dashboard_auditoria', requestId)) return;
            const responder = r => socket.emit('retorno_dashboard_auditoria', { requestId, ...r });
            const dias = (Date.parse(p.ate) - Date.parse(p.de)) / DIA_MS;
            if (!dataValida(p.de) || !dataValida(p.ate) || !(dias >= 0) || dias > MAX_DIAS) {
                return responder({ sucesso: false, erro: 'Período inválido (máximo de 1 ano).' });
            }
            try {
                const registros = auditoria.ler(p.de, p.ate);
                socket.join('auditoria');   // passa a receber as ações novas ao vivo
                responder({ sucesso: true, registros, apelidos: auditoria.lerApelidos(), consultado_em: new Date().toISOString() });
            } catch (e) {
                console.error('Erro ao ler auditoria:', e);
                responder({ sucesso: false, erro: 'Não foi possível ler o log de auditoria.' });
            }
        });

        socket.on('admin_definir_apelido', (p = {}) => {
            const user = autorizarAdmin(sessoes, socket, 'admin_apelido_definido');
            if (!user) return;
            try {
                const email = String(p.email || '').trim().toLowerCase();
                const mudanca = auditoria.definirApelido(email, p.apelido);
                registrar({ email: user.email, ip: ipDe(socket), area: 'admin', acao: 'definir_apelido',
                    alvo: email, detalhes: mudanca, status: 'sucesso' });
                socket.emit('admin_apelido_definido', { sucesso: true, email, apelido: mudanca.depois });
            } catch (e) {
                socket.emit('admin_apelido_definido', { sucesso: false, erro: e.message || 'Não foi possível salvar o apelido.' });
            }
        });
    }
    return { conectar };
}

module.exports = { criarDashboardAuditoria, ipDe };
