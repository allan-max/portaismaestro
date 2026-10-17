const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarAuditoria } = require('../lib/auditoria');
const { criarDashboardAuditoria } = require('../lib/dashboard-auditoria');

function setup({ user = { admin: true } } = {}) {
  const sessions = new Map(), handlers = {}, messages = [], salas = [], registrados = [];
  const socket = { id: 'cliente', sessionId: 'sessao', handshake: { headers: {}, address: '10.0.0.1' },
    on: (e, fn) => handlers[e] = fn, emit: (e, d) => messages.push({ e, d }), join: s => salas.push(s) };
  sessions.set('sessao', JSON.stringify({ email: 'admin@example.test', expires: Date.now() + 100000, ...user }));
  const auditoria = criarAuditoria({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'aud-dash-')), uuid: () => 'id-' + registrados.length });
  const painel = criarDashboardAuditoria({ sessoes: sessions, auditoria, registrar: r => { registrados.push(r); return r; } });
  painel.conectar(socket);
  return { handlers, messages, salas, registrados, auditoria };
}
const hoje = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

test('não admin não lê o log nem define apelido; sessão vencida derruba', () => {
  for (const user of [{ admin: false }, { admin: false, dashboard_access: true }]) {
    const s = setup({ user });
    s.handlers.solicitar_dashboard_auditoria({ requestId: 'r', de: hoje, ate: hoje });
    s.handlers.admin_definir_apelido({ email: 'a@x.com', apelido: 'X' });
    assert.ok(s.messages.every(m => m.d.codigo === 'SEM_PERMISSAO'));
    assert.deepEqual(s.salas, []);
    assert.deepEqual(s.auditoria.lerApelidos(), {});
  }
  const s = setup({ user: { expires: Date.now() - 1 } });
  s.handlers.solicitar_dashboard_auditoria({ requestId: 'r', de: hoje, ate: hoje });
  assert.equal(s.messages.at(-1).e, 'sessao_invalida');
});

test('admin recebe registros do período, apelidos e entra na sala ao vivo', () => {
  const s = setup();
  s.auditoria.registrar({ email: 'ana@x.com', area: 'planilha', acao: 'editar_linha', status: 'sucesso' });
  s.auditoria.definirApelido('ana@x.com', 'Ana');
  s.handlers.solicitar_dashboard_auditoria({ requestId: 'r1', de: hoje, ate: hoje });
  const r = s.messages.at(-1);
  assert.equal(r.e, 'retorno_dashboard_auditoria');
  assert.equal(r.d.sucesso, true);
  assert.equal(r.d.requestId, 'r1');
  assert.equal(r.d.registros.length, 1);
  assert.deepEqual(r.d.apelidos, { 'ana@x.com': 'Ana' });
  assert.ok(r.d.consultado_em);
  assert.deepEqual(s.salas, ['auditoria']);
});

test('período inválido ou maior que 366 dias é recusado', () => {
  const s = setup();
  for (const p of [{ de: '2026-13-01', ate: hoje }, { de: hoje, ate: '2026-01-01' }, { de: '2024-01-01', ate: '2026-01-01' }, {}]) {
    s.handlers.solicitar_dashboard_auditoria({ requestId: 'r', ...p });
    assert.equal(s.messages.at(-1).d.sucesso, false);
  }
});

test('definir apelido grava, registra na auditoria quem mudou e responde', () => {
  const s = setup();
  s.handlers.admin_definir_apelido({ email: 'Ana@X.com', apelido: ' Ana Souza ' });
  assert.deepEqual(s.messages.at(-1), { e: 'admin_apelido_definido', d: { sucesso: true, email: 'ana@x.com', apelido: 'Ana Souza' } });
  assert.equal(s.registrados[0].acao, 'definir_apelido');
  assert.equal(s.registrados[0].email, 'admin@example.test');
  assert.deepEqual(s.registrados[0].detalhes, { antes: null, depois: 'Ana Souza' });
  s.handlers.admin_definir_apelido({ email: 'invalido', apelido: 'X' });
  assert.equal(s.messages.at(-1).d.sucesso, false);
});

test('ao vivo só chega a quem ainda é admin; quem perdeu o acesso sai da sala', () => {
  const vm = require('node:vm');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
  const fn = src.match(/function emitirAuditoria\(evento, dados\) \{[\s\S]*?\n\}/)[0];
  const { lerSessao } = require('../lib/dashboard-cotacoes');
  const sessoes = new Map([['a', JSON.stringify({ admin: true, expires: Date.now() + 60000 })],
    ['b', JSON.stringify({ admin: false, expires: Date.now() + 60000 })]]);
  const sala = new Set(['sa', 'sb', 'sc']), recebidos = [];
  const sock = (id, sessionId) => ({ id, sessionId, emit: e => recebidos.push(id + ':' + e), leave: () => sala.delete(id) });
  const sockets = new Map([['sa', sock('sa', 'a')], ['sb', sock('sb', 'b')], ['sc', sock('sc', 'expirada')]]);
  const io = { sockets: { adapter: { rooms: new Map([['auditoria', sala]]) }, sockets } };
  vm.runInNewContext(`${fn}; emitirAuditoria('auditoria_nova', {})`, { io, lerSessao, cofreSessoes: sessoes });
  assert.deepEqual(recebidos, ['sa:auditoria_nova']);
  assert.deepEqual([...sala], ['sa']);
});
