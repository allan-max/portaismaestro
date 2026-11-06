// Minhas Cotações, permissão "Pesquisar cotações de outros vendedores": o servidor só entrega a cotação
// com o número exato, de outro vendedor, e só para quem tem a permissão (admin sempre tem).
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

test('busca de cotação de outro vendedor: só com a permissão, só o número exato e só de outro vendedor', async t => {
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
  bot.on('validar_login', data => bot.emit('resultado_login', { sucesso: true, user: data.user, clientId: data.clientId,
    vendedor: data.user.startsWith('busca') ? 'ANA' : 'BETO', hasBuscaOutrosAccess: data.user.startsWith('busca') }));
  const pedidos = [];
  bot.on('comando_carregar_planilha_json', d => pedidos.push(d));
  async function login(user) {
    const socket = await client(), response = event(socket, 'resposta_login');
    socket.emit('solicitar_login', { user, pass: 'senha-de-teste' });
    const data = await response; socket.disconnect();
    const logado = await client({ sessionId: data.sessionId });
    const estado = event(logado, 'sincronizar_estado'); logado.emit('sou_frontend', {}); await estado;
    return { socket: logado, login: data };
  }

  // Sem a permissão: lista vazia e nada pedido ao gerenciador
  const semPermissao = await login('vendedor@example.test');
  assert.equal(semPermissao.login.busca_outros_access, false);
  const vazio = event(semPermissao.socket, 'retorno_busca_cotacao_outro_vendedor');
  semPermissao.socket.emit('buscar_cotacao_outro_vendedor', { numero: 'PPG0241188' });
  assert.deepEqual((await vazio).cotacoes, []);
  await pausa(200);
  assert.deepEqual(pedidos, []);

  // Com a permissão: o gerenciador recebe o número exato e o vendedor a excluir
  const comPermissao = await login('busca@example.test');
  assert.equal(comPermissao.login.busca_outros_access, true);
  comPermissao.socket.emit('buscar_cotacao_outro_vendedor', { numero: ' ppg0241188 ' });
  await pausa(300);
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].numero_exato, 'PPG0241188');
  assert.equal(pedidos[0].vendedor_excluir, 'ANA');
  assert.equal(pedidos[0].tela, 'minhas_cotacoes');
  assert.equal(pedidos[0].vendedor_filtro, undefined);

  // O servidor confere de novo: número diferente, número parcial ou cotação do próprio vendedor não passam
  const chegou = event(comPermissao.socket, 'retorno_busca_cotacao_outro_vendedor');
  let trocouLista = false;
  comPermissao.socket.on('retorno_planilha_json', () => { trocouLista = true; });
  bot.emit('retorno_planilha_json', {
    sucesso: true, clientId: pedidos[0].clientId, busca_numero: 'PPG0241188',
    cotacoes: [
      { 'COTAÇÃO': 'COTAÇÃO/ES (EDIVIT) > PPG0241188', VENDEDOR: 'JOÃO', VENCIMENTO: '01/01/2099', ITEM: 'Cabo' },
      { 'COTAÇÃO': 'PPG0241188', VENDEDOR: 'ANA', VENCIMENTO: '01/01/2099', ITEM: 'Dela mesma' },
      { 'COTAÇÃO': 'PPG02411880', VENDEDOR: 'JOÃO', VENCIMENTO: '01/01/2099', ITEM: 'Outro número' },
    ],
    portais_robo: { 'COTAÇÃO/ES (EDIVIT) > PPG0241188': 'coupa', 'OUTRA': 'vale' },
    onde_encontrar: { 'OUTRA': [] },
  });
  const res = await chegou;
  assert.equal(res.numero, 'PPG0241188');
  assert.deepEqual(res.cotacoes.map(c => c.ITEM), ['Cabo']);
  assert.deepEqual(res.portais_robo, { 'COTAÇÃO/ES (EDIVIT) > PPG0241188': 'coupa' });
  assert.deepEqual(res.onde_encontrar, {});
  await pausa(200);
  assert.equal(trocouLista, false, 'a resposta da busca não troca a lista normal do vendedor');
});
