// Comandos aos robôs exigem "Acesso aos portais": antes bastava estar logado (relatório de segurança 2026-11-06, H-2).
const { test } = require('node:test');
const assert = require('node:assert/strict');
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

test('comandos aos robôs: sem acesso aos portais nada chega; com acesso só modos e campos conhecidos', async t => {
  const port = await portFree(), secret = crypto.randomBytes(32).toString('hex'), sockets = [];
  const child = spawn(process.execPath, ['server.js'], { cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ROBO_SECRET: secret, MASTER_SECRET: crypto.randomBytes(32).toString('hex') },
    stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { sockets.forEach(s => s.disconnect()); child.kill(); });
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
  const doRobo = [];
  bot.onAny((nome, dados) => doRobo.push({ nome, dados }));
  bot.on('validar_login', data => bot.emit('resultado_login', { sucesso: true, user: data.user, clientId: data.clientId,
    hasPortaisAccess: data.user.startsWith('portais') }));
  async function login(user) {
    const socket = await client(), response = event(socket, 'resposta_login');
    socket.emit('solicitar_login', { user, pass: 'senha-de-teste' });
    const data = await response; socket.disconnect();
    const logado = await client({ sessionId: data.sessionId });
    const estado = event(logado, 'sincronizar_estado'); logado.emit('sou_frontend', {}); await estado;
    return { socket: logado, sessionId: data.sessionId };
  }
  const comandos = () => doRobo.filter(e => ['comando_para_robo', 'comando_imprimir', 'executar_clique'].includes(e.nome));

  // Vendedor logado sem portais: nenhum comando chega ao robô
  const vendedor = await login('vendedor@example.test');
  vendedor.socket.emit('comando_direto', { modo: 'desligar_robo', portal: 'coupa' });
  vendedor.socket.emit('solicitar_impressao', { portal: 'coupa', impressora: 'X' });
  vendedor.socket.emit('clique_no_captcha', { x: 1, y: 2 });
  await pausa(300);
  assert.deepEqual(comandos(), []);

  // /api/responder também exige portais
  const form = new FormData();
  form.append('sessionId', vendedor.sessionId); form.append('evento', '165060');
  const r = await fetch(`http://127.0.0.1:${port}/api/responder`, { method: 'POST', body: form });
  assert.equal(r.status, 403);

  // Com portais: modo conhecido passa, só com os campos das telas
  const operador = await login('portais@example.test');
  const chegou = event(bot, 'comando_para_robo');
  operador.socket.emit('comando_direto', { modo: 'ligar_robo', portal: 'ariba', prioridades: 'A B', clientId: 'forjado', extra: 'x' });
  assert.deepEqual(await chegou, { modo: 'ligar_robo', portal: 'ariba', prioridades: 'A B' });

  // Modo fora da lista ('responder' só pela fila) ou portal desconhecido: descartado
  doRobo.length = 0;
  operador.socket.emit('comando_direto', { modo: 'responder', portal: 'coupa', evento: '1' });
  operador.socket.emit('comando_direto', { modo: 'extrair', portal: 'outro' });
  operador.socket.emit('comando_direto', null);
  await pausa(300);
  assert.deepEqual(comandos(), []);

  // O piloto automático do gerenciador manda comando_direto pelo próprio socket do robô (sem usuário)
  const doPiloto = event(bot, 'comando_para_robo');
  bot.emit('comando_direto', { modo: 'extrair', portal: 'coupa' });
  assert.deepEqual(await doPiloto, { modo: 'extrair', portal: 'coupa' });
});
