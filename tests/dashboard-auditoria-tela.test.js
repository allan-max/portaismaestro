const { test } = require('node:test');
const assert = require('node:assert/strict');
const { filtrar, resumir, mudancas } = require('../public/dashboard-cotacoes/auditoria');

const f0 = { usuarios: [], area: '', status: '', card: '', busca: '' };
const regs = [
  { id: '1', data_hora: '2026-10-16T15:00:00Z', email: 'ana@x.com', area: 'planilha', acao: 'editar_linha', alvo: 'COT-123', status: 'sucesso' },
  { id: '2', data_hora: '2026-10-16T16:00:00Z', email: 'ana@x.com', area: 'portal', acao: 'responder_evento', alvo: '9001', portal: 'vale', status: 'erro' },
  { id: '3', data_hora: '2026-10-15T12:00:00Z', email: 'bia@x.com', area: 'planilha', acao: 'apagar_linha', alvo: 'COT-999', status: 'sucesso' },
  { id: '4', data_hora: '2026-10-15T13:00:00Z', email: null, area: 'conta', acao: 'login_falha', alvo: null, status: 'erro' }
];

test('resumo dos cards e do painel de atenção', () => {
  const m = resumir(regs);
  assert.equal(m.total, 4); assert.equal(m.usuarios, 2); assert.equal(m.planilha, 2);
  assert.equal(m.respostas, 1); assert.equal(m.erros, 2); assert.equal(m.apagadas, 1); assert.equal(m.falhasLogin, 1);
  assert.equal(m.porUsuario[0].email, 'ana@x.com'); assert.equal(m.porUsuario[0].ultima.id, '2');
});

test('filtros: usuário, card, status e busca por alvo, apelido ou ação', () => {
  const ids = f => filtrar(regs, { ...f0, ...f }, { 'bia@x.com': 'Beatriz' }).map(r => r.id);
  assert.deepEqual(ids({ usuarios: ['ana@x.com'] }), ['1', '2']);
  assert.deepEqual(ids({ card: 'planilha' }), ['1', '3']);
  assert.deepEqual(ids({ card: 'respostas' }), ['2']);
  assert.deepEqual(ids({ status: 'erro', area: 'conta' }), ['4']);
  assert.deepEqual(ids({ busca: ' cot-1 ' }), ['1']);
  assert.deepEqual(ids({ busca: 'beatriz' }), ['3']);
  assert.deepEqual(ids({ busca: 'apagou' }), ['3']);
});

test('o que mudou: antes → depois só quando o robô mandou o anterior', () => {
  assert.deepEqual(mudancas({ novos_dados: { VENDEDOR: 'BIA' }, antes: { VENDEDOR: 'ANA', MARCA: 'X' } }),
    [{ campo: 'VENDEDOR', antes: 'ANA', depois: 'BIA', temAntes: true }]);
  assert.equal(mudancas({ novos_dados: { VENDEDOR: 'BIA' } })[0].temAntes, false);
  assert.deepEqual(mudancas({ antes: null, depois: 'Ana' }), [{ campo: 'Valor', antes: null, depois: 'Ana', temAntes: true }]);
  assert.deepEqual(mudancas({ cotacoes: ['1'] }), []);
});

test('e-mail "__proto__" digitado no login não quebra o resumo', () => {
  const m = resumir([{ ...regs[0], email: '__proto__' }]);
  assert.equal(m.porUsuario[0].total, 1);
  assert.equal(({}).total, undefined);
});

test('e-mail "constructor" no log não vira apelido nem casa na busca', () => {
  const r = [{ ...regs[0], email: 'constructor' }];
  assert.deepEqual(filtrar(r, { ...f0, busca: 'function' }, {}), []);
  assert.equal(filtrar(r, { ...f0, busca: 'constructor' }, {}).length, 1);
});
