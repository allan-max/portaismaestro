const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
globalThis.WebSocket ??= require('ws');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');
const root = path.join(__dirname, '..');
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));
function event(socket, name, timeout = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error('Sem evento: ' + name)); }, timeout);
    function handler(data) { clearTimeout(timer); resolve(data); }
    socket.once(name, handler);
  });
}
async function portFree() {
  const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port;
}

test('planilha ANMYNA (HTTP) e prints das respostas exigem login', async t => {
  const port = await portFree(), secret = crypto.randomBytes(32).toString('hex'), sockets = [];
  // Prints de teste num arquivo temporário: o teste não toca dados/prints_respostas.json
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-vazamentos-'));
  const arquivoPrints = path.join(pasta, 'prints.json');
  fs.writeFileSync(arquivoPrints, JSON.stringify({ '55537': [{ item: 1, imagem: 'PRINT-SECRETA' }] }));
  const child = spawn(process.env.NODE_DO_SERVIDOR || process.execPath, ['server.js'], { cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ROBO_SECRET: secret, PRINTS_RESPOSTAS_FILE: arquivoPrints,
      ERROS_RESPOSTAS_FILE: path.join(pasta, 'erros.json'), MASTER_SECRET: crypto.randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { sockets.forEach(s => s.disconnect()); child.kill(); fs.rmSync(pasta, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 10000);
    child.stdout.on('data', d => { if (String(d).includes('rodando na porta')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Servidor encerrou: ' + code)); });
  });
  async function client(auth = {}) {
    const socket = io(`http://127.0.0.1:${port}`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket); await event(socket, 'connect'); return socket;
  }
  const bot = await client({ robo_secret: secret });
  const ready = event(bot, 'sincronizar_estado'); bot.emit('sou_o_robo'); await ready;
  bot.on('validar_login', data => bot.emit('resultado_login', {
    sucesso: true, user: data.user, clientId: data.clientId, vendedor: 'ANA', isAdmin: data.user.startsWith('admin')
  }));
  async function login(user) {
    const socket = await client(), response = event(socket, 'resposta_login');
    socket.emit('solicitar_login', { user, pass: 'senha-de-teste' });
    const data = await response; socket.disconnect();
    return { socket: await client({ sessionId: data.sessionId }), sessionId: data.sessionId };
  }
  const url = `http://127.0.0.1:${port}/api/planilha-anmyna`;

  // 1. /api/planilha-anmyna: sem sessão 401, sessão falsa 401, sem acesso às planilhas 403, admin passa
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-session-id': 'sessao-inventada' } })).status, 401);
  const vendedor = await login('ana@example.test');
  assert.equal((await fetch(url, { headers: { 'x-session-id': vendedor.sessionId } })).status, 403);
  const admin = await login('admin@example.test');
  const doAdmin = await fetch(url, { headers: { 'x-session-id': admin.sessionId } });
  assert.ok(![401, 403].includes(doAdmin.status), 'admin deveria passar da checagem: ' + doAdmin.status);

  // 2. solicitar_prints_evento: visitante não recebe as prints; usuário logado recebe
  const visitante = await client();
  const doVisitante = [];
  visitante.onAny((nome, dados) => doVisitante.push({ nome, dados }));
  visitante.emit('solicitar_prints_evento', { evento: '55537' });
  await pausa(300);
  assert.equal(doVisitante.some(e => e.nome === 'retorno_prints_evento'), false);
  assert.equal(JSON.stringify(doVisitante).includes('PRINT-SECRETA'), false);

  const resposta = event(vendedor.socket, 'retorno_prints_evento');
  vendedor.socket.emit('solicitar_prints_evento', { evento: '55537' });
  assert.equal((await resposta).prints[0].imagem, 'PRINT-SECRETA');
});
