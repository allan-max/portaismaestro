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

test('servidor real: botão "Rodar agora" só para admin, vai à fonte certa e volta para os admins', async t => {
  const port = await portFree(), secret = crypto.randomBytes(32).toString('hex'), tokenNf = crypto.randomBytes(16).toString('hex');
  const auditDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-auditoria-'));
  const sockets = [];
  const child = spawn(process.env.NODE_DO_SERVIDOR || process.execPath, ['server.js'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ROBO_SECRET: secret, SYNC_NF_TOKEN: tokenNf,
      AUDITORIA_DIR: auditDir, MASTER_SECRET: crypto.randomBytes(32).toString('hex') } });
  t.after(() => { sockets.forEach(s => s.disconnect()); child.kill(); fs.rmSync(auditDir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 10000);
    child.stdout.on('data', d => { if (String(d).includes('rodando na porta')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Servidor encerrou: ' + code)); });
  });
  async function client(auth = {}) {
    const socket = io(`http://127.0.0.1:${port}`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
    sockets.push(socket); await event(socket, 'connect'); return socket;
  }

  // gerenciador e serviço de NF falsos
  const bot = await client({ robo_secret: secret });
  const ready = event(bot, 'sincronizar_estado'); bot.emit('sou_o_robo'); await ready;
  bot.on('validar_login', d => bot.emit('resultado_login', { sucesso: true, user: d.user, isAdmin: d.user === 'admin@example.test',
    hasDashboardAccess: true, hasPlanilhaAccess: true, clientId: d.clientId }));
  const nf = await client();
  nf.emit('sou_o_sync_nf', { token: tokenNf });
  const comandosBot = [], comandosNf = [];
  bot.on('comando_sincronizacao', d => comandosBot.push(d));
  nf.on('comando_sincronizacao', d => comandosNf.push(d));

  async function login(user) {
    const socket = await client(), response = event(socket, 'resposta_login');
    socket.emit('solicitar_login', { user, pass: 'senha-de-teste' });
    const data = await response; socket.disconnect();
    const logado = await client({ sessionId: data.sessionId });
    const entrou = event(logado, 'sincronizar_estado'); logado.emit('sou_frontend', { usuario: user }); await entrou;
    return logado;
  }
  const vendedor = await login('comum@example.test');
  const admin = await login('admin@example.test');
  let vendedorViu = 0;
  for (const e of ['progresso_sincronizacao', 'retorno_sincronizacao']) vendedor.on(e, () => { vendedorViu++; });

  // vendedor não dispara
  const negado = event(vendedor, 'retorno_sincronizacao'); vendedor.emit('solicitar_sincronizacao', { servico: 'ciclo_coupa', requestId: 'v' });
  assert.equal((await negado).codigo, 'SEM_PERMISSAO');
  vendedorViu = 0;

  // admin dispara o ciclo: chega no gerenciador com quem clicou
  const disparado = event(admin, 'progresso_sincronizacao');
  admin.emit('solicitar_sincronizacao', { servico: 'ciclo_coupa', requestId: 'a1' });
  assert.equal((await disparado).origem, 'portal');
  await new Promise(r => setTimeout(r, 200));
  assert.equal(comandosBot.length, 1); assert.equal(comandosNf.length, 0);
  const cmd = comandosBot[0];
  assert.equal(cmd.servico, 'ciclo_coupa'); assert.equal(cmd.usuario, 'admin@example.test');
  assert.equal(cmd.audit_id, undefined);                                              // o id da auditoria não sai do servidor

  // o serviço de NF tentando responder pelo gerenciador é ignorado; o gerenciador responde
  nf.emit('retorno_sincronizacao', { servico: 'ciclo_coupa', sucesso: false, erro: 'forjado', audit_id: cmd.audit_id });
  const resultado = event(admin, 'retorno_sincronizacao');
  bot.emit('progresso_sincronizacao', { servico: 'ciclo_coupa', mensagem: 'Ciclo manual começou' });
  bot.emit('retorno_sincronizacao', { servico: 'ciclo_coupa', sucesso: true, mensagem: 'Ciclo manual do Coupa terminou', audit_id: cmd.audit_id });
  assert.deepEqual(await resultado, { servico: 'ciclo_coupa', sucesso: true, mensagem: 'Ciclo manual do Coupa terminou' });

  // NF completo vai para o serviço de NF
  admin.emit('solicitar_sincronizacao', { servico: 'nf_completo', requestId: 'a2' });
  await new Promise(r => setTimeout(r, 200));
  assert.equal(comandosNf.length, 1); assert.equal(comandosNf[0].servico, 'nf_completo');

  // estado dos cartões junta as duas fontes
  bot.on('comando_sincronizacao_estado', d => bot.emit('retorno_sincronizacao_estado', { sucesso: true, clientId: d.clientId,
    estado: { rodando: [], ultimas: { backup: { em: '2026-10-21T07:00:00-03:00', nivel: 'ok', resumo: 'Backup automático' } } } }));
  nf.on('comando_sincronizacao_estado', d => nf.emit('retorno_sincronizacao_estado', { sucesso: true, clientId: d.clientId,
    estado: { rodando: ['sync_planilha'], ultimas: {} } }));
  const painel = event(admin, 'retorno_dashboard_sincronizar');
  admin.emit('solicitar_dashboard_sincronizar', { requestId: 'p1' });
  const p = await painel;
  assert.equal(p.sucesso, true);
  assert.deepEqual(p.fontes, { gerenciador: { status: 'ok' }, nf: { status: 'ok' } });
  assert.equal(p.estado.gerenciador.ultimas.backup.resumo, 'Backup automático');
  assert.deepEqual(p.estado.nf.rodando, ['sync_planilha']);

  // nada disso foi para o vendedor; a auditoria tem quem clicou e o resultado
  assert.equal(vendedorViu, 0);
  const linhas = fs.readdirSync(auditDir, { recursive: true }).filter(f => String(f).endsWith('.jsonl'))
    .flatMap(f => fs.readFileSync(path.join(auditDir, f), 'utf8').trim().split('\n')).map(l => JSON.parse(l));
  const porId = new Map();                                                            // registro + fechamento, como a auditoria lê
  for (const l of linhas) porId.set(l.id, { ...porId.get(l.id), ...Object.fromEntries(Object.entries(l).filter(([, v]) => v != null)) });
  const ciclo = [...porId.values()].find(r => r.acao === 'rodar_agora' && r.alvo === 'Ciclo Coupa');
  assert.equal(ciclo.email, 'admin@example.test');
  assert.equal(ciclo.status, 'sucesso');                                             // fechado pela resposta do gerenciador, não pela forjada
});
