const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarDashboardCotacoes } = require('../lib/dashboard-cotacoes');

function setup(user = { admin: true }) {
  const sessions = new Map(), handlers = {}, messages = [], pending = [];
  const socket = { id: 'cliente', sessionId: 'sessao', on: (e, fn) => handlers[e] = fn,
    emit: (e, d) => messages.push({ e, d }) };
  sessions.set('sessao', JSON.stringify({ email: 'admin@example.test', expires: Date.now() + 100000, ...user }));
  const dashboard = criarDashboardCotacoes({ sessoes: sessions,
    io: { to: id => ({ emit: (e, d) => pending.push({ id, e, d }) }) },
    obterRobo: () => 'robo', obterSocket: id => id === 'cliente' ? socket : null });
  dashboard.conectar(socket);
  return { sessions, handlers, messages, pending, dashboard, socket };
}
test('somente admin da sessão real pode pedir dados; flags do cliente não concedem acesso', () => {
  for (const user of [{ admin: false }, { admin: false, dashboard_access: true }, { admin: false, dev: true }]) {
    const s = setup(user); s.handlers.solicitar_dashboard_cotacoes({ admin: true, clientId: 'alvo' });
    assert.equal(s.pending.length, 0); assert.equal(s.messages.at(-1).d.codigo, 'SEM_PERMISSAO');
    s.dashboard.fechar();
  }
});
test('sessão expirada e sessão removida não chegam ao robô', () => {
  for (const expired of [true, false]) {
    const s = setup({ expires: Date.now() - 1 }); if (!expired) s.sessions.clear();
    s.handlers.solicitar_dashboard_cotacoes({});
    assert.equal(s.pending.length, 0); assert.equal(s.messages.at(-1).e, 'sessao_invalida'); s.dashboard.fechar();
  }
});
test('correlação exclusiva, validação da origem e revalidação ao retornar', () => {
  const s = setup(); s.handlers.solicitar_dashboard_cotacoes({ requestId: 'r1', clientId: 'outra-pessoa', vendedor: 'GUSTAVO' });
  assert.equal(s.pending[0].id, 'robo');
  assert.equal(s.pending[0].e, 'comando_carregar_planilha_json');
  assert.equal(s.pending[0].d.origem, 'todas');
  assert.notEqual(s.pending[0].d.clientId, 'outra-pessoa');
  const payload = { sucesso: true, clientId: s.pending[0].d.clientId, cotacoes: [{ ITEM: 'real' }], pedidos: [{ PEDIDO: 'privado' }] };
  assert.equal(s.dashboard.receber('impostor', payload), false);
  assert.equal(s.messages.length, 0);
  s.dashboard.receber('robo', payload);
  assert.deepEqual(s.messages.at(-1).d.cotacoes, [{ ITEM: 'real' }]);
  assert.equal(s.messages.at(-1).d.pedidos, undefined);
  assert.equal(s.messages.at(-1).d.requestId, 'r1');
  s.handlers.solicitar_dashboard_cotacoes({ requestId: 'r2' });
  s.sessions.clear();
  s.dashboard.receber('robo', { ...payload, clientId: s.pending.at(-1).d.clientId });
  assert.equal(s.messages.at(-1).e, 'sessao_invalida'); s.dashboard.fechar();
});
test('base inválida não vira sucesso com zeros', () => {
  const s = setup(); s.handlers.solicitar_dashboard_cotacoes({ requestId: 'r1' });
  s.dashboard.receber('robo', { sucesso: true, clientId: s.pending[0].d.clientId, cotacoes: {} });
  assert.equal(s.messages.at(-1).d.sucesso, false); assert.equal(s.messages.at(-1).d.cotacoes, undefined); s.dashboard.fechar();
});
test('fonte offline informa erro sem devolver lista vazia', () => {
  const messages = [], sessions = new Map([['sessao', JSON.stringify({ admin: true, expires: Date.now() + 1000 })]]), handlers = {};
  const socket = { id: 'offline', sessionId: 'sessao', on: (e, fn) => handlers[e] = fn, emit: (e, d) => messages.push({ e, d }) };
  const dashboard = criarDashboardCotacoes({ sessoes: sessions, io: {}, obterRobo: () => null, obterSocket: () => socket });
  dashboard.conectar(socket); handlers.solicitar_dashboard_cotacoes({ requestId: 'offline' });
  assert.equal(messages[0].d.codigo, 'FONTE_OFFLINE'); assert.equal(messages[0].d.cotacoes, undefined); dashboard.fechar();
});
test('expiração durante uma conexão ativa é notificada', async () => {
  const s = setup({ admin: true, expires: Date.now() + 80 }); s.handlers.solicitar_acesso_estatisticas();
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(s.messages.at(-1).e, 'sessao_invalida'); s.dashboard.fechar();
});
