const { execFile } = require('node:child_process');
const { lerSessao, autorizarAdmin } = require('./dashboard-cotacoes');
const { ipDe } = require('./dashboard-auditoria');

// Botões "rodar agora" do dashboard do admin (docs/sincronizacao/plano.md).
// destino: 'robo' = gerenciador, 'sync' = serviço de NF, 'local' = tarefa do Agendador do Windows.
const SERVICOS = {
    ciclo_coupa: { destino: 'robo', nome: 'Ciclo Coupa' },
    ciclo_vale: { destino: 'robo', nome: 'Ciclo Vale' },
    nf_completo: { destino: 'sync', nome: 'NF completo' },
    sync_planilha: { destino: 'sync', nome: 'Sync planilha ⇄ portal' },
    backup: { destino: 'robo', nome: 'Backup' },
    atualizador: { destino: 'local', nome: 'Procurar atualização' },
};
const NOME_FONTE = { robo: 'O gerenciador', sync: 'O serviço de NF' };
const TAREFA_ATUALIZADOR = 'Maestro Atualizador';
const MAX_TEXTO = 500;
// O schtasks responde no código de página do console (cp850 no Windows em português), não em UTF-8.
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';
const doConsole = saida => (Buffer.isBuffer(saida)
    ? Array.from(saida, b => (b < 128 ? String.fromCharCode(b) : CP850[b - 128])).join('') : String(saida ?? ''));

function criarSincronizacao({ sessoes, io, obterRobo, obterSync, registrar, fechar, executar = execFile }) {
    const fonte = destino => (destino === 'robo' ? obterRobo() : obterSync());

    // Todos os admins com uma tela aberta veem o andamento (ninguém clica de novo achando que parou).
    function emitirAdmins(evento, dados) {
        for (const id of [...(io.sockets.adapter.rooms.get('frontend') || [])]) {
            const s = io.sockets.sockets.get(id);
            if (s && lerSessao(sessoes, s)?.admin === true) s.emit(evento, dados);
        }
    }

    function resultado(servico, sucesso, texto) {
        return { servico, sucesso, [sucesso ? 'mensagem' : 'erro']: String(texto ?? '').slice(0, MAX_TEXTO) };
    }

    function concluir(auditId, r) {
        fechar(auditId, { sucesso: r.sucesso, [r.sucesso ? 'mensagem' : 'erro']: r.sucesso ? r.mensagem : r.erro });
        emitirAdmins('retorno_sincronizacao', r);
    }

    function rodarAtualizador(auditId) {
        executar('schtasks', ['/Run', '/TN', TAREFA_ATUALIZADOR], { windowsHide: true, timeout: 15000, encoding: 'buffer' }, (erro, _saida, stderr) => {
            concluir(auditId, erro
                ? resultado('atualizador', false, `O Windows não rodou a tarefa "${TAREFA_ATUALIZADOR}": ${(doConsole(stderr) || erro.message).trim()}`)
                : resultado('atualizador', true, 'Atualizador disparado. Se houver versão nova, o portal reinicia em instantes; '
                    + 'o andamento aparece na Atividade.'));
        });
    }

    function solicitar(socket, dados) {
        const requestId = typeof dados?.requestId === 'string' ? dados.requestId.slice(0, 80) : '';
        const user = autorizarAdmin(sessoes, socket, 'retorno_sincronizacao', requestId);
        if (!user) return;
        const servico = String(dados?.servico || '');
        const cfg = Object.prototype.hasOwnProperty.call(SERVICOS, servico) ? SERVICOS[servico] : null;
        if (!cfg) return socket.emit('retorno_sincronizacao', { ...resultado(servico.slice(0, 40), false, 'Serviço desconhecido.'), requestId });
        const reg = registrar({ email: user.email || null, ip: ipDe(socket), area: 'admin', acao: 'rodar_agora',
            alvo: cfg.nome, detalhes: { servico } });
        const auditId = reg && reg.id;
        if (cfg.destino === 'local') return rodarAtualizador(auditId);
        const destino = fonte(cfg.destino);
        if (!destino) return concluir(auditId, resultado(servico, false, `${NOME_FONTE[cfg.destino]} está offline.`));
        // origem 'portal': a tela não confunde isto com a resposta do serviço (que pode estar numa versão sem o botão)
        emitirAdmins('progresso_sincronizacao', { servico, origem: 'portal', mensagem: `Disparado por ${user.email || 'um administrador'}.` });
        io.to(destino).emit('comando_sincronizacao', { servico, clientId: socket.id, audit_id: auditId, usuario: user.email || null });
    }

    function conectar(socket) {
        socket.on('solicitar_sincronizacao', (dados = {}) => solicitar(socket, dados));
    }

    // Respostas das fontes. true = era deste módulo (aceita ou descartada); false = não é.
    function receber(evento, origem, dados = {}) {
        if (evento !== 'progresso_sincronizacao' && evento !== 'retorno_sincronizacao') return false;
        const cfg = SERVICOS[dados?.servico];
        if (!cfg || cfg.destino === 'local' || origem !== fonte(cfg.destino)) return true;   // só o socket certo fala por cada serviço
        if (evento === 'progresso_sincronizacao') {
            emitirAdmins(evento, { servico: dados.servico, mensagem: String(dados.mensagem ?? '').slice(0, MAX_TEXTO) });
        } else {
            concluir(dados.audit_id, resultado(dados.servico, dados.sucesso === true, dados.sucesso === true ? dados.mensagem : dados.erro));
        }
        return true;
    }

    return { conectar, receber };
}

module.exports = { criarSincronizacao, SERVICOS, doConsole };
