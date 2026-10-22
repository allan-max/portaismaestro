const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarSincronizacao, SERVICOS, doConsole } = require('../lib/sincronizacao');

test('mensagem do Windows em cp850 (console em português) vira texto certo', () => {
  assert.equal(doConsole(Buffer.from([0x45, 0x52, 0x52, 0x4f, 0x3a, 0x20, 0x6e, 0xc6, 0x6f, 0x20, 0x87, 0xc6, 0x6f, 0x20, 0x82, 0xa0, 0x90])), 'ERRO: não ção éáÉ');
  assert.equal(doConsole('já é texto'), 'já é texto');
});

// Admin "cliente" e um vendedor "outro" na sala frontend; robo/nf são os sockets das fontes.
function setup({ user = { admin: true }, robo = 'robo', sync = 'nf', exec } = {}) {
  const sessions = new Map(), handlers = {}, recebidos = { cliente: [], outro: [] }, enviados = [], auditados = [], fechados = [];
  const socket = (id, sessionId) => ({ id, sessionId, handshake: { address: '10.0.0.9' },
    on: (e, fn) => { if (id === 'cliente') handlers[e] = fn; }, emit: (e, d) => recebidos[id].push({ e, d }) });
  const cliente = socket('cliente', 's1'), outro = socket('outro', 's2');
  sessions.set('s1', JSON.stringify({ email: 'admin@example.test', expires: Date.now() + 100000, ...user }));
  sessions.set('s2', JSON.stringify({ email: 'vendedor@example.test', expires: Date.now() + 100000, admin: false }));
  const io = {
    to: id => ({ emit: (e, d) => enviados.push({ id, e, d }) }),
    sockets: { adapter: { rooms: new Map([['frontend', new Set(['cliente', 'outro'])]]) },
      sockets: new Map([['cliente', cliente], ['outro', outro]]) },
  };
  const execucoes = [];
  const sinc = criarSincronizacao({ sessoes: sessions, io, obterRobo: () => robo, obterSync: () => sync,
    registrar: d => { auditados.push(d); return { id: 'aud-' + auditados.length }; },
    fechar: (id, dados) => fechados.push({ id, dados }),
    executar: exec || ((cmd, args, op, cb) => { execucoes.push({ cmd, args }); cb(null, 'OK', ''); }) });
  sinc.conectar(cliente);
  const pedir = dados => handlers.solicitar_sincronizacao(dados);
  return { pedir, sinc, recebidos, enviados, auditados, fechados, execucoes };
}

test('não admin não dispara nada nem é auditado', () => {
  const s = setup({ user: { admin: false } });
  s.pedir({ servico: 'ciclo_coupa', requestId: 'r1', admin: true });
  assert.equal(s.enviados.length, 0);
  assert.equal(s.auditados.length, 0);
  assert.equal(s.recebidos.cliente.at(-1).d.codigo, 'SEM_PERMISSAO');
});

test('ciclo e backup vão para o gerenciador; NF e sync para o serviço de NF, com quem clicou', () => {
  const s = setup();
  for (const servico of ['ciclo_coupa', 'ciclo_vale', 'backup', 'nf_completo', 'sync_planilha']) s.pedir({ servico, requestId: 'r' });
  assert.deepEqual(s.enviados.map(x => [x.id, x.d.servico]),
    [['robo', 'ciclo_coupa'], ['robo', 'ciclo_vale'], ['robo', 'backup'], ['nf', 'nf_completo'], ['nf', 'sync_planilha']]);
  const cmd = s.enviados[0];
  assert.equal(cmd.e, 'comando_sincronizacao');
  assert.deepEqual(cmd.d, { servico: 'ciclo_coupa', clientId: 'cliente', audit_id: 'aud-1', usuario: 'admin@example.test' });
  assert.deepEqual(s.auditados[0], { email: 'admin@example.test', ip: '10.0.0.9', area: 'admin', acao: 'rodar_agora',
    alvo: 'Ciclo Coupa', detalhes: { servico: 'ciclo_coupa' } });
  // todos os admins veem que começou; o vendedor não recebe nada
  assert.ok(s.recebidos.cliente.some(m => m.e === 'progresso_sincronizacao' && m.d.servico === 'ciclo_coupa' && m.d.origem === 'portal'));
  assert.equal(s.recebidos.outro.length, 0);
});

test('serviço desconhecido é recusado sem auditar', () => {
  const s = setup();
  s.pedir({ servico: 'formatar_disco', requestId: 'r9' });
  const r = s.recebidos.cliente.at(-1);
  assert.equal(r.e, 'retorno_sincronizacao');
  assert.equal(r.d.sucesso, false);
  assert.equal(r.d.requestId, 'r9');
  assert.equal(s.auditados.length + s.enviados.length, 0);
});

test('fonte offline responde erro claro e fecha a auditoria como erro', () => {
  const s = setup({ robo: null });
  s.pedir({ servico: 'backup' });
  const r = s.recebidos.cliente.filter(m => m.e === 'retorno_sincronizacao').at(-1);
  assert.equal(r.d.sucesso, false);
  assert.match(r.d.erro, /gerenciador está offline/);
  assert.deepEqual(s.fechados, [{ id: 'aud-1', dados: { sucesso: false, erro: r.d.erro } }]);
});

test('só o socket certo responde por cada serviço; o resultado vai para os admins e fecha a auditoria', () => {
  const s = setup();
  const resposta = { servico: 'ciclo_coupa', sucesso: true, mensagem: 'Ciclo manual do Coupa terminou', audit_id: 'aud-7', clientId: 'cliente' };
  assert.equal(s.sinc.receber('retorno_sincronizacao', 'nf', resposta), true);       // o serviço de NF não fala pelo gerenciador
  assert.equal(s.fechados.length, 0);
  assert.equal(s.sinc.receber('retorno_sincronizacao', 'robo', resposta), true);
  assert.deepEqual(s.fechados, [{ id: 'aud-7', dados: { sucesso: true, mensagem: 'Ciclo manual do Coupa terminou' } }]);
  const r = s.recebidos.cliente.at(-1);
  assert.deepEqual(r, { e: 'retorno_sincronizacao', d: { servico: 'ciclo_coupa', sucesso: true, mensagem: 'Ciclo manual do Coupa terminou' } });
  assert.equal(s.recebidos.outro.length, 0);
  s.sinc.receber('progresso_sincronizacao', 'nf', { servico: 'nf_completo', mensagem: 'baixando do HSE' });
  assert.deepEqual(s.recebidos.cliente.at(-1).d, { servico: 'nf_completo', mensagem: 'baixando do HSE' });
  assert.equal(s.sinc.receber('retorno_eventos', 'robo', {}), false);                // não é deste módulo
});

test('atualizador roda a tarefa do Agendador e diz que só foi disparado', () => {
  const s = setup();
  s.pedir({ servico: 'atualizador' });
  assert.deepEqual(s.execucoes, [{ cmd: 'schtasks', args: ['/Run', '/TN', 'Maestro Atualizador'] }]);
  assert.equal(s.enviados.length, 0);
  const r = s.recebidos.cliente.filter(m => m.e === 'retorno_sincronizacao').at(-1);
  assert.equal(r.d.sucesso, true);
  assert.match(r.d.mensagem, /Atividade/);
  assert.equal(s.fechados[0].dados.sucesso, true);
});

test('atualizador sem permissão no Agendador mostra o erro do Windows', () => {
  const s = setup({ exec: (cmd, args, op, cb) => cb(new Error('falhou'), '', 'ERRO: Acesso negado.\r\n') });
  s.pedir({ servico: 'atualizador' });
  const r = s.recebidos.cliente.filter(m => m.e === 'retorno_sincronizacao').at(-1);
  assert.equal(r.d.sucesso, false);
  assert.match(r.d.erro, /Acesso negado/);
});

test('texto que vem das fontes é cortado e vira string', () => {
  const s = setup();
  s.sinc.receber('retorno_sincronizacao', 'robo', { servico: 'backup', sucesso: false, erro: 'x'.repeat(2000) });
  assert.equal(s.recebidos.cliente.at(-1).d.erro.length, 500);
  assert.deepEqual(Object.keys(SERVICOS), ['ciclo_coupa', 'ciclo_vale', 'nf_completo', 'sync_planilha', 'backup', 'atualizador']);
});
