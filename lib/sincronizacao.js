const path = require('node:path');
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
// Caminho absoluto: no Windows o execFile procura primeiro na pasta atual (um schtasks.exe plantado ali rodaria).
const SCHTASKS = path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe');
// Fonte que nunca responde (caiu sem avisar) não trava o botão para sempre. Um ciclo pode levar horas.
const VALIDADE_MS = { local: 60 * 1000, remoto: 6 * 3600 * 1000 };
const MAX_TEXTO = 500;
// O schtasks responde no código de página do console (cp850 no Windows em português), não em UTF-8.
const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0';
const doConsole = saida => (Buffer.isBuffer(saida)
    ? Array.from(saida, b => (b < 128 ? String.fromCharCode(b) : CP850[b - 128])).join('') : String(saida ?? ''));
const temServico = s => typeof s === 'string' && Object.prototype.hasOwnProperty.call(SERVICOS, s);

function criarSincronizacao({ sessoes, io, obterRobo, obterSync, registrar, fechar, executar = execFile, agora = Date.now }) {
    const fonte = destino => (destino === 'robo' ? obterRobo() : obterSync());
    // servico -> { auditId, destino, ate }: a resposta fecha a auditoria guardada aqui, nunca um id que venha nela
    const emAndamento = new Map();

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

    function fecharAuditoria(atual, r) {
        if (atual) fechar(atual.auditId, { sucesso: r.sucesso, [r.sucesso ? 'mensagem' : 'erro']: r.sucesso ? r.mensagem : r.erro });
    }

    function concluir(servico, r) {
        fecharAuditoria(emAndamento.get(servico), r);
        emAndamento.delete(servico);
        emitirAdmins('retorno_sincronizacao', r);
    }

    function rodarAtualizador() {
        executar(SCHTASKS, ['/Run', '/TN', TAREFA_ATUALIZADOR], { windowsHide: true, timeout: 15000, encoding: 'buffer' }, (erro, _saida, stderr) => {
            concluir('atualizador', erro
                ? resultado('atualizador', false, `O Windows não rodou a tarefa "${TAREFA_ATUALIZADOR}": ${(doConsole(stderr) || erro.message).trim()}`)
                : resultado('atualizador', true, 'Atualizador disparado. Se houver versão nova, o portal reinicia em instantes; '
                    + 'o andamento aparece na Atividade.'));
        });
    }

    function solicitar(socket, dados) {
        const requestId = typeof dados?.requestId === 'string' ? dados.requestId.slice(0, 80) : '';
        const user = autorizarAdmin(sessoes, socket, 'retorno_sincronizacao', requestId);
        if (!user) return;
        const servico = dados?.servico;
        if (!temServico(servico)) {
            return socket.emit('retorno_sincronizacao', { ...resultado(String(servico ?? '').slice(0, 40), false, 'Serviço desconhecido.'), requestId });
        }
        const cfg = SERVICOS[servico];
        const atual = emAndamento.get(servico);
        if (atual && atual.ate > agora()) {
            return socket.emit('retorno_sincronizacao', { ...resultado(servico, false, `${cfg.nome} já está rodando. Espere terminar.`), requestId });
        }
        fecharAuditoria(atual, resultado(servico, false, 'A fonte não respondeu.'));   // vencido: o registro antigo não fica "pendente"
        const reg = registrar({ email: user.email || null, ip: ipDe(socket), area: 'admin', acao: 'rodar_agora',
            alvo: cfg.nome, detalhes: { servico } });
        emAndamento.set(servico, { auditId: reg && reg.id, destino: cfg.destino,
            ate: agora() + (cfg.destino === 'local' ? VALIDADE_MS.local : VALIDADE_MS.remoto) });
        if (cfg.destino === 'local') return rodarAtualizador();
        const destino = fonte(cfg.destino);
        if (!destino) return concluir(servico, resultado(servico, false, `${NOME_FONTE[cfg.destino]} está offline.`));
        // origem 'portal': a tela não confunde isto com a resposta do serviço (que pode estar numa versão sem o botão)
        emitirAdmins('progresso_sincronizacao', { servico, origem: 'portal', mensagem: `Disparado por ${user.email || 'um administrador'}.` });
        io.to(destino).emit('comando_sincronizacao', { servico, clientId: socket.id, usuario: user.email || null });
    }

    function conectar(socket) {
        socket.on('solicitar_sincronizacao', (dados = {}) => solicitar(socket, dados));
    }

    // Respostas das fontes. true = era deste módulo (aceita ou descartada); false = não é.
    function receber(evento, origem, dados = {}) {
        if (evento !== 'progresso_sincronizacao' && evento !== 'retorno_sincronizacao') return false;
        if (!temServico(dados?.servico)) return true;
        const cfg = SERVICOS[dados.servico];
        if (cfg.destino === 'local' || origem !== fonte(cfg.destino)) return true;   // só o socket certo fala por cada serviço
        if (evento === 'progresso_sincronizacao') {
            emitirAdmins(evento, { servico: dados.servico, mensagem: String(dados.mensagem ?? '').slice(0, MAX_TEXTO) });
        } else {
            concluir(dados.servico, resultado(dados.servico, dados.sucesso === true, dados.sucesso === true ? dados.mensagem : dados.erro));
        }
        return true;
    }

    // O gerenciador ou o serviço de NF desconectou: o que estava rodando nele não vai mais responder.
    function fonteCaiu(destino) {
        for (const [servico, atual] of emAndamento) {
            if (atual.destino === destino) concluir(servico, resultado(servico, false, `${NOME_FONTE[destino]} desconectou antes de responder.`));
        }
    }

    return { conectar, receber, fonteCaiu };
}

module.exports = { criarSincronizacao, SERVICOS, doConsole, SCHTASKS };
