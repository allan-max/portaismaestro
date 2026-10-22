const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarDashboardFontes, juntarEventos } = require('../lib/dashboard-fontes');

function setup({ user = { admin: true }, robo = 'robo', sync = 'nf', timeoutMs = 1000 } = {}) {
  const sessions = new Map(), handlers = {}, messages = [], enviados = [];
  const socket = { id: 'cliente', sessionId: 'sessao', on: (e, fn) => handlers[e] = fn, emit: (e, d) => messages.push({ e, d }) };
  sessions.set('sessao', JSON.stringify({ email: 'admin@example.test', expires: Date.now() + 100000, ...user }));
  const conexoes = { gerenciador: { online: !!robo }, nf: { online: !!sync } };
  const fontes = criarDashboardFontes({ sessoes: sessions, timeoutMs,
    io: { to: id => ({ emit: (e, d) => enviados.push({ id, e, d }) }) },
    obterSocket: id => id === 'cliente' ? socket : null, obterRobo: () => robo, obterSync: () => sync,
    obterConexoes: () => conexoes });
  fontes.conectar(socket);
  return { sessions, handlers, messages, enviados, fontes };
}
const evento = (em, resumo, extra = {}) => ({ em, servico: 'nf', tipo: 'rodada', nivel: 'ok', resumo, ref: null, detalhe: {}, ...extra });

test('não admin, sessão vencida e flags do navegador não chegam às fontes', () => {
  for (const user of [{ admin: false }, { admin: false, dashboard_access: true }, { admin: false, dev: true }]) {
    const s = setup({ user });
    for (const d of ['sync', 'nfs', 'atividade', 'saude']) s.handlers[`solicitar_dashboard_${d}`]({ requestId: 'r', admin: true });
    assert.equal(s.enviados.length, 0);
    assert.ok(s.messages.every(m => m.d.codigo === 'SEM_PERMISSAO'));
    s.fontes.fechar();
  }
  const s = setup({ user: { expires: Date.now() - 1 } });
  s.handlers.solicitar_dashboard_nfs({ requestId: 'r' });
  assert.equal(s.enviados.length, 0); assert.equal(s.messages.at(-1).e, 'sessao_invalida'); s.fontes.fechar();
});

test('só o socket certo responde; resposta de outro socket é descartada', () => {
  const s = setup();
  s.handlers.solicitar_dashboard_nfs({ requestId: 'r1', clientId: 'forjado' });
  const pedido = s.enviados[0];
  assert.equal(pedido.id, 'nf'); assert.equal(pedido.e, 'comando_nf_painel'); assert.notEqual(pedido.d.clientId, 'forjado');
  const resposta = { sucesso: true, clientId: pedido.d.clientId, painel: { indicadores: { com_nf: 507 } } };
  assert.equal(s.fontes.receber('retorno_nf_painel', 'robo', resposta), true);     // o gerenciador não fala pelo serviço de NF
  assert.equal(s.fontes.receber('retorno_sync_planilha_painel', 'nf', resposta), true);   // evento trocado
  assert.equal(s.messages.length, 0);
  s.fontes.receber('retorno_nf_painel', 'nf', resposta);
  assert.equal(s.messages.at(-1).e, 'retorno_dashboard_nfs');
  assert.equal(s.messages.at(-1).d.requestId, 'r1');
  assert.deepEqual(s.messages.at(-1).d.painel, { indicadores: { com_nf: 507 } });
  assert.equal(s.fontes.receber('retorno_nf_painel', 'nf', resposta), true);       // segunda resposta: ignorada
  assert.equal(s.messages.length, 1);
  assert.equal(s.fontes.receber('retorno_planilha_json', 'nf', resposta), false);  // não é deste módulo
  s.fontes.fechar();
});

test('sessão que caiu antes da resposta não recebe os dados', () => {
  const s = setup();
  s.handlers.solicitar_dashboard_sync({ requestId: 'r1' });
  s.sessions.clear();
  s.fontes.receber('retorno_sync_planilha_painel', 'nf', { sucesso: true, clientId: s.enviados[0].d.clientId, painel: { totais: {} } });
  assert.equal(s.messages.at(-1).e, 'sessao_invalida');
  assert.ok(!s.messages.some(m => m.d?.painel));
  s.fontes.fechar();
});

test('fonte offline, erro da fonte e tempo esgotado viram erro, nunca zeros', async () => {
  let s = setup({ sync: null });
  s.handlers.solicitar_dashboard_sync({ requestId: 'r' });
  assert.equal(s.messages.at(-1).d.codigo, 'FONTE_OFFLINE'); assert.equal(s.messages.at(-1).d.painel, undefined);
  s.fontes.fechar();
  s = setup();
  s.handlers.solicitar_dashboard_nfs({ requestId: 'r' });
  s.fontes.receber('retorno_nf_painel', 'nf', { sucesso: false, erro: 'disco cheio', clientId: s.enviados[0].d.clientId });
  assert.equal(s.messages.at(-1).d.codigo, 'FONTE_ERRO'); assert.equal(s.messages.at(-1).d.erro, 'disco cheio');
  s.handlers.solicitar_dashboard_nfs({ requestId: 'r2' });
  s.fontes.receber('retorno_nf_painel', 'nf', { sucesso: true, painel: [], clientId: s.enviados[1].d.clientId });
  assert.equal(s.messages.at(-1).d.codigo, 'FONTE_ERRO');                          // formato inválido
  s.fontes.fechar();
  s = setup({ timeoutMs: 20 });
  s.handlers.solicitar_dashboard_nfs({ requestId: 'lento' });
  await new Promise(r => setTimeout(r, 60));
  assert.equal(s.messages.at(-1).d.codigo, 'TEMPO_ESGOTADO'); assert.equal(s.messages.at(-1).d.requestId, 'lento');
  s.fontes.fechar();
});

test('novo pedido do mesmo painel cancela o anterior', () => {
  const s = setup();
  s.handlers.solicitar_dashboard_nfs({ requestId: 'velho' });
  s.handlers.solicitar_dashboard_nfs({ requestId: 'novo' });
  assert.equal(s.fontes.receber('retorno_nf_painel', 'nf', { sucesso: true, painel: {}, clientId: s.enviados[0].d.clientId }), true);
  assert.equal(s.messages.length, 0);
  s.fontes.receber('retorno_nf_painel', 'nf', { sucesso: true, painel: {}, clientId: s.enviados[1].d.clientId });
  assert.equal(s.messages.at(-1).d.requestId, 'novo'); s.fontes.fechar();
});

test('atividade junta as duas fontes, ordena e marca a que não respondeu', async () => {
  const s = setup({ timeoutMs: 30 });
  s.handlers.solicitar_dashboard_atividade({ requestId: 'a', limite: 3, desde: '2026-10-15T00:00:00-03:00' });
  const [ger, nf] = ['comando_eventos', 'comando_eventos_nf'].map(e => s.enviados.find(x => x.e === e));
  assert.equal(ger.id, 'robo'); assert.equal(nf.id, 'nf');
  assert.equal(ger.d.limite, 3); assert.equal(nf.d.desde, '2026-10-15T00:00:00-03:00');
  s.fontes.receber('retorno_eventos_nf', 'nf', { sucesso: true, clientId: nf.d.clientId, resultado: { eventos: [
    evento('2026-10-15T12:30:21-03:00', 'NF 12h30'), evento('2026-10-15T07:30:00-03:00', 'NF 07h30')], erros: { cadastro: 'x' } } });
  assert.equal(s.messages.length, 0);                                                 // espera o gerenciador
  await new Promise(r => setTimeout(r, 60));
  const r = s.messages.at(-1).d;
  assert.equal(r.sucesso, true);
  assert.equal(r.fontes.gerenciador.status, 'tempo'); assert.equal(r.fontes.nf.status, 'ok');
  assert.deepEqual(r.fontes.nf.erros, { cadastro: 'x' });
  assert.deepEqual(r.eventos.map(e => e.resumo), ['NF 12h30', 'NF 07h30']);
  s.fontes.fechar();
});

test('atividade sem nenhuma fonte é erro', () => {
  const s = setup({ robo: null, sync: null });
  s.handlers.solicitar_dashboard_atividade({ requestId: 'a' });
  assert.equal(s.messages.at(-1).d.sucesso, false); assert.equal(s.messages.at(-1).d.fontes.gerenciador.status, 'offline');
  s.fontes.fechar();
});

test('juntarEventos ordena, limita, descarta lixo e só deixa o contrato', () => {
  const lista = juntarEventos({
    gerenciador: [evento('2026-10-15T15:39:24-03:00', 'B', { servico: 'gerenciador', extra: '<script>' }), { em: 'lixo' }, null],
    nf: [evento('2026-10-15T16:00:00-03:00', 'C'), evento('2026-10-14T10:00:00-03:00', 'A')],
  }, 2);
  assert.deepEqual(lista.map(e => e.resumo), ['C', 'B']);
  assert.equal(lista[1].fonte, 'gerenciador'); assert.equal(lista[1].extra, undefined);
  assert.equal(juntarEventos({ nf: Array.from({ length: 900 }, (_, i) => evento(`2026-10-15T10:00:${String(i % 60).padStart(2, '0')}-03:00`, 'x')) }, 9999).length, 500);
});

test('saúde junta o estado dos sockets e o estado do serviço de NF', () => {
  let s = setup();
  s.handlers.solicitar_dashboard_saude({ requestId: 's' });
  assert.equal(s.enviados[0].e, 'comando_sync_nf_estado');
  s.fontes.receber('retorno_sync_nf_estado', 'nf', { sucesso: true, clientId: s.enviados[0].d.clientId, estado: { ultima: { rodou_em: 'x' } } });
  let r = s.messages.at(-1).d;
  assert.equal(r.sucesso, true); assert.equal(r.conexoes.nf.online, true); assert.deepEqual(r.estado_nf, { ultima: { rodou_em: 'x' } });
  s.fontes.fechar();
  s = setup({ sync: null });
  s.handlers.solicitar_dashboard_saude({ requestId: 's' });
  r = s.messages.at(-1).d;
  assert.equal(r.sucesso, true); assert.equal(r.estado_nf, null); assert.match(r.estado_nf_erro, /offline/);
  s.fontes.fechar();
});

test('sincronizar: pede o estado ao gerenciador e ao serviço de NF; cada um só responde pela sua parte', () => {
  const s = setup();
  s.handlers.solicitar_dashboard_sincronizar({ requestId: 'k' });
  assert.deepEqual(s.enviados.map(x => [x.id, x.e]), [['robo', 'comando_sincronizacao_estado'], ['nf', 'comando_sincronizacao_estado']]);
  const [robo, nf] = s.enviados.map(x => x.d.clientId);
  const estadoRobo = { rodando: ['ciclo_coupa'], ultimas: {} };
  s.fontes.receber('retorno_sincronizacao_estado', 'nf', { sucesso: true, clientId: robo, estado: { rodando: ['forjado'] } });
  assert.equal(s.messages.length, 0);                                       // o serviço de NF não responde pelo gerenciador
  s.fontes.receber('retorno_sincronizacao_estado', 'robo', { sucesso: true, clientId: robo, estado: estadoRobo });
  s.fontes.receber('retorno_sincronizacao_estado', 'nf', { sucesso: false, clientId: nf, erro: 'pasta de dados fora' });
  const r = s.messages.at(-1);
  assert.equal(r.e, 'retorno_dashboard_sincronizar');
  assert.equal(r.d.sucesso, true);
  assert.deepEqual(r.d.estado, { gerenciador: estadoRobo, nf: null });
  assert.deepEqual(r.d.fontes, { gerenciador: { status: 'ok' }, nf: { status: 'erro', erro: 'pasta de dados fora' } });
  s.fontes.fechar();
});

test('sincronizar com as duas fontes fora ainda responde (os cartões mostram offline)', () => {
  const s = setup({ robo: null, sync: null });
  s.handlers.solicitar_dashboard_sincronizar({ requestId: 'k' });
  const r = s.messages.at(-1).d;
  assert.equal(r.sucesso, true);
  assert.match(r.fontes.gerenciador.erro, /gerenciador está offline/);
  assert.match(r.fontes.nf.erro, /serviço de NF está offline/);
  s.fontes.fechar();
});
