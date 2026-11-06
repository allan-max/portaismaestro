const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
globalThis.WebSocket = globalThis.WebSocket || require('ws');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');
const root = path.join(__dirname, '..');

function evento(socket, nome, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(nome, h); reject(new Error('Sem evento: ' + nome)); }, timeout);
    function h(d) { clearTimeout(timer); resolve(d); }
    socket.once(nome, h);
  });
}
async function portaLivre() {
  const l = net.createServer(); await new Promise(r => l.listen(0, '127.0.0.1', r));
  const p = l.address().port; await new Promise(r => l.close(r)); return p;
}
function baixar(url) {
  return new Promise((resolve, reject) => http.get(url, res => {
    const partes = []; res.on('data', d => partes.push(d));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, corpo: Buffer.concat(partes) }));
  }).on('error', reject));
}

// Sem t.after (não existe no Node 16.20.2 do servidor): limpeza em finally.
test('servidor real: token do serviço, permissão emails_access, offline, resposta e anexo como attachment', async () => {
  const porta = await portaLivre(), segredo = crypto.randomBytes(32).toString('hex'), token = crypto.randomBytes(32).toString('hex');
  const auditoria = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-emails-'));
  const filho = spawn(process.env.NODE_DO_SERVIDOR || process.execPath, ['server.js'], { cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(porta), ROBO_SECRET: segredo, EMAILS_TOKEN: token,
      AUDITORIA_DIR: auditoria, MASTER_SECRET: crypto.randomBytes(32).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
  const sockets = [];
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 15000);
      filho.stdout.on('data', d => { if (String(d).includes('rodando na porta')) { clearTimeout(timer); resolve(); } });
      filho.once('exit', c => { clearTimeout(timer); reject(new Error('Servidor encerrou: ' + c)); });
    });
    async function cliente(auth = {}) {
      const s = io(`http://127.0.0.1:${porta}`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(s); await evento(s, 'connect'); return s;
    }
    const robo = await cliente({ robo_secret: segredo });
    const pronto = evento(robo, 'sincronizar_estado'); robo.emit('sou_o_robo'); await pronto;
    robo.on('validar_login', d => robo.emit('resultado_login', { sucesso: true, user: d.user, clientId: d.clientId,
      isAdmin: false, hasEmailsAccess: d.user === 'leitora@example.test', hasPortaisAccess: d.user === 'portais@example.test' }));
    async function login(user) {
      const s = await cliente(), r = evento(s, 'resposta_login');
      s.emit('solicitar_login', { user, pass: 'senha-de-teste' });
      const d = await r; s.disconnect(); return { socket: await cliente({ sessionId: d.sessionId }), resposta: d };
    }
    const leitora = await login('leitora@example.test');
    assert.equal(leitora.resposta.emails_access, true); assert.equal(leitora.resposta.portais_access, false);
    const portais = await login('portais@example.test');
    assert.equal(portais.resposta.emails_access, false);

    // sem serviço: erro claro, nunca lista vazia
    let r = evento(leitora.socket, 'emails_retorno'); leitora.socket.emit('emails_pedir', { requestId: 'a', acao: 'listar', params: {} });
    assert.equal((await r).codigo, 'FONTE_OFFLINE');

    // token errado ou ausente é recusado
    for (const t of ['', 'errado', token.slice(0, -1) + 'x']) {
      const falso = await cliente(), recusa = evento(falso, 'servico_emails_recusado');
      falso.emit('sou_o_servico_emails', { token: t }); await recusa;
    }
    r = evento(leitora.socket, 'emails_retorno'); leitora.socket.emit('emails_pedir', { requestId: 'b', acao: 'listar', params: {} });
    assert.equal((await r).codigo, 'FONTE_OFFLINE');

    const servico = await cliente(), aceito = evento(servico, 'servico_emails_aceito');
    servico.emit('sou_o_servico_emails', { token }); await aceito;
    const pedidos = [];
    servico.on('emails_pedido', p => {
      pedidos.push(p);
      if (p.acao === 'anexo') servico.emit('emails_resposta', { id: p.id, sucesso: true, dados: { nome: 'lista.pdf', conteudo: Buffer.from('%PDF-1.4').toString('base64') } });
      else servico.emit('emails_resposta', { id: p.id, sucesso: true, dados: { itens: [{ id: 1, assunto: '<script>alert(1)</script>' }], proximo: null } });
    });

    // sem permissão: barrado sem chegar ao serviço; um socket comum não responde como serviço
    r = evento(portais.socket, 'emails_retorno'); portais.socket.emit('emails_pedir', { requestId: 'c', acao: 'listar', params: {} });
    assert.equal((await r).codigo, 'SEM_PERMISSAO'); assert.equal(pedidos.length, 0);

    r = evento(leitora.socket, 'emails_retorno'); leitora.socket.emit('emails_pedir', { requestId: 'd', acao: 'listar', params: { busca: 'cabo' } });
    const lista = await r;
    assert.equal(lista.sucesso, true); assert.equal(lista.requestId, 'd'); assert.equal(lista.dados.itens[0].id, 1);
    assert.notEqual(pedidos[0].id, leitora.socket.id); assert.equal(pedidos[0].params.busca, 'cabo');

    r = evento(leitora.socket, 'emails_retorno'); leitora.socket.emit('emails_pedir', { requestId: 'e', acao: 'anexo', params: { id: 1, anexo: 9 } });
    const anexo = await r;
    const baixado = await baixar(`http://127.0.0.1:${porta}${anexo.dados.url}`);
    assert.equal(baixado.status, 200); assert.equal(baixado.corpo.toString(), '%PDF-1.4');
    assert.match(baixado.headers['content-disposition'], /^attachment;/);
    assert.equal(baixado.headers['content-type'], 'application/octet-stream');
    assert.equal(baixado.headers['x-content-type-options'], 'nosniff');
    assert.equal((await baixar(`http://127.0.0.1:${porta}${anexo.dados.url}`)).status, 404); // uso único

    // serviço cai: próxima ação recebe FONTE_OFFLINE
    servico.disconnect();
    await new Promise(res => setTimeout(res, 200));
    r = evento(leitora.socket, 'emails_retorno'); leitora.socket.emit('emails_pedir', { requestId: 'f', acao: 'detalhe', params: { id: 1 } });
    assert.equal((await r).codigo, 'FONTE_OFFLINE');
  } finally {
    sockets.forEach(s => s.disconnect()); filho.kill();
    fs.rmSync(auditoria, { recursive: true, force: true });
  }
});
