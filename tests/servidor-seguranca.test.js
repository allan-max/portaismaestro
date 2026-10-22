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

test('servidor real: eventos do robô, fila de extração, clientId e /api/responder', async t => {
  const port = await portFree(), secret = crypto.randomBytes(32).toString('hex'), sockets = [];
  const child = spawn(process.env.NODE_DO_SERVIDOR || process.execPath, ['server.js'], { cwd: root,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), ROBO_SECRET: secret, SYNC_NF_TOKEN: 'token-nf-de-teste', MASTER_SECRET: crypto.randomBytes(32).toString('hex') }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  bot.on('validar_login', data => bot.emit('resultado_login', { sucesso: true, user: data.user, clientId: data.clientId, vendedor: 'ANA' }));
  async function login(user) {
    const socket = await client(), response = event(socket, 'resposta_login');
    socket.emit('solicitar_login', { user, pass: 'senha-de-teste' });
    const data = await response; socket.disconnect();
    const logado = await client({ sessionId: data.sessionId });
    const estado = event(logado, 'sincronizar_estado'); logado.emit('sou_frontend', { usuario: 'outra.pessoa@example.test' }); await estado;
    return { socket: logado, sessionId: data.sessionId };
  }
  const usuario = await login('ana@example.test');
  const tela = usuario.socket;
  const visitante = await client();
  const naTela = [], doVisitante = [];
  tela.onAny(nome => naTela.push(nome)); visitante.onAny(nome => doVisitante.push(nome));

  // Visitante sem login tentando se passar pelo robô: nada chega às telas nem a outro cliente
  visitante.emit('sincronizar_estado_me', { status: 'forjado' });
  visitante.emit('relatar_progresso_coupa', { mensagem: '<img src=x onerror=alert(1)>' });
  visitante.emit('tarefa_concluida', { evento: 'Login do Robô', sucesso: false });
  visitante.emit('resposta_cadastro', { sucesso: true, clientId: tela.id });
  visitante.emit('receber_config_admin', { config: { falsa: true }, clientId: tela.id });
  visitante.emit('atualizar_fila_extracao', { fila: ['forjada'] });
  await pausa(300);
  assert.deepEqual(naTela, []);

  // O robô de verdade continua chegando às telas; a fila de extração não vaza para quem não está logado
  const progresso = event(tela, 'relatar_progresso_coupa');
  bot.emit('relatar_progresso_coupa', { mensagem: 'ok' }); assert.equal((await progresso).mensagem, 'ok');
  const fila = event(tela, 'atualizar_fila_extracao');
  bot.emit('atualizar_fila_extracao', { fila: [] }); await fila;
  await pausa(200);
  assert.equal(doVisitante.includes('atualizar_fila_extracao'), false);

  // Token do serviço de NF com caractere multibyte (mesmo nº de caracteres): recusa e desconecta
  const falsoNf = await client();
  const recusado = event(falsoNf, 'sync_nf_recusado');
  falsoNf.emit('sou_o_sync_nf', { token: 'token-nf-de-testé' });
  await recusado;

  // obter_fila_extracao exige login
  visitante.emit('obter_fila_extracao', {}); await pausa(200);
  assert.equal(doRobo.some(e => e.nome === 'obter_fila_extracao'), false);

  // clientId vem sempre do servidor, nunca do navegador
  const pedido = event(bot, 'comando_registrar_vendedor_cotacao');
  tela.emit('solicitar_registro_vendedor_cotacao', { vendedor: 'ANA', cotacoes: ['1'], clientId: visitante.id });
  assert.equal((await pedido).clientId, tela.id);

  // /api/responder
  const marca = 'teste-' + crypto.randomUUID() + '.pdf';
  async function responder(campos, comArquivo = true) {
    const form = new FormData();
    for (const [k, v] of Object.entries(campos)) form.append(k, v);
    if (comArquivo) form.append('datasheet', new Blob([Buffer.from('%PDF-1.4 teste')]), marca);
    const r = await fetch(`http://127.0.0.1:${port}/api/responder`, { method: 'POST', body: form });
    return { status: r.status, corpo: await r.json() };
  }
  const restosNoTmp = () => fs.readdirSync(os.tmpdir()).filter(n => n.endsWith(marca));
  assert.equal((await responder({ sessionId: 'nao-existe', evento: '123' })).status, 401);
  assert.equal((await responder({ sessionId: usuario.sessionId, evento: '<img src=x onerror=alert(1)>' })).status, 400);
  assert.equal((await responder({ sessionId: usuario.sessionId, evento: '123', portal: 'outro' })).status, 400);
  assert.equal((await responder({ sessionId: usuario.sessionId, evento: '123', precos: '{"a":1}' })).status, 400);
  const paraRobo = event(bot, 'comando_para_robo');
  const ok = await responder({ sessionId: usuario.sessionId, evento: '165060', precos: '["10,00"]', prazos: '["5"]', origens: '["Nacional"]', icms: '["18"]' });
  assert.equal(ok.status, 200);
  const comando = await paraRobo;
  assert.equal(comando.evento, '165060'); assert.equal(comando.portal, 'coupa');
  assert.equal(Buffer.from(comando.datasheets[0].data, 'base64').toString(), '%PDF-1.4 teste');
  assert.equal((await responder({ sessionId: usuario.sessionId, evento: '165060' })).status, 409);
  await pausa(200);
  assert.deepEqual(restosNoTmp(), []);   // nenhum anexo fica no disco, aceito ou recusado
});
