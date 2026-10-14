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
test('servidor real: admin exclusivo, origem do robô, correlação, JSON intacto e compatibilidade da Planilha', async t => {
  const port = await portFree(), secret = crypto.randomBytes(32).toString('hex');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-dashboard-'));
  const fixture = path.join(temporary, 'COTAÇÕES.json');
  const records = [{ 'COTAÇÃO': '001', VENCIMENTO: '20/10/2026', VENDEDOR: 'GUSTAVO', RESPOSTA: 'NÃO RESPONDIDO' }];
  fs.writeFileSync(fixture, JSON.stringify({ 'COTAÇÃO': records }));
  const before = fs.readFileSync(fixture), sockets = [], commands = [];
  const child = spawn(process.execPath, ['server.js'], { cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ROBO_SECRET: secret, MASTER_SECRET: crypto.randomBytes(32).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { sockets.forEach(s => s.disconnect()); child.kill(); fs.unlinkSync(fixture); fs.rmdirSync(temporary); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 10000);
    child.stdout.on('data', d => { if (String(d).includes('rodando na porta')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Servidor encerrou: ' + code)); });
  });
  async function client(auth = {}) {
    const socket = io(`http://127.0.0.1:${port}`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket); await event(socket, 'connect'); return socket;
  }
  const visitor = await client();
  const deniedBot = event(visitor, 'robo_recusado'); visitor.emit('sou_o_robo'); await deniedBot;
  const invalid = event(visitor, 'sessao_invalida'); visitor.emit('solicitar_dashboard_cotacoes', { admin: true }); await invalid;
  let forgedLogin = false; visitor.on('resposta_login', () => { forgedLogin = true; });
  visitor.emit('resultado_login', { sucesso: true, isAdmin: true, clientId: visitor.id, user: 'forjado' });
  const bot = await client({ robo_secret: secret });
  const ready = event(bot, 'sincronizar_estado'); bot.emit('sou_o_robo'); await ready;
  bot.on('validar_login', data => bot.emit('resultado_login', { sucesso: true, user: data.user,
    isAdmin: data.user === 'admin@example.test', hasDashboardAccess: true, hasPlanilhaAccess: true, clientId: data.clientId }));
  bot.on('comando_carregar_planilha_json', data => {
    commands.push(data);
    bot.emit('retorno_planilha_json', { sucesso: true, clientId: data.clientId,
      cotacoes: JSON.parse(fs.readFileSync(fixture, 'utf8'))['COTAÇÃO'], pedidos: [{ PEDIDO: 'não entregar ao dashboard' }] });
  });
  async function login(user) {
    const socket = await client(), response = event(socket, 'resposta_login');
    socket.emit('solicitar_login', { user, pass: 'senha-de-teste' });
    const data = await response; socket.disconnect(); return client({ sessionId: data.sessionId });
  }
  const common = await login('comum@example.test');
  let denied = event(common, 'retorno_dashboard_cotacoes'); common.emit('solicitar_dashboard_cotacoes', { requestId: 'comum', admin: true });
  assert.equal((await denied).codigo, 'SEM_PERMISSAO'); assert.equal(commands.length, 0);
  const legacyDenied = event(common, 'receber_dados_dashboard'); common.emit('pedir_dados_dashboard', {}); assert.equal((await legacyDenied).sucesso, false);
  const admin = await login('admin@example.test');
  const access = event(admin, 'acesso_estatisticas'); admin.emit('solicitar_acesso_estatisticas'); assert.equal((await access).admin, true);
  const response = event(admin, 'retorno_dashboard_cotacoes'); admin.emit('solicitar_dashboard_cotacoes', { requestId: 'admin', clientId: common.id });
  const data = await response; assert.deepEqual(data.cotacoes, records); assert.equal(data.pedidos, undefined); assert.equal(data.requestId, 'admin');
  assert.notEqual(commands[0].clientId, common.id); assert.notEqual(commands[0].clientId, admin.id);
  const existing = event(common, 'retorno_planilha_json'); common.emit('solicitar_planilha_json', { origem: 'todas' }); assert.equal((await existing).sucesso, true);
  assert.equal(forgedLogin, false); assert.deepEqual(fs.readFileSync(fixture), before);
});
