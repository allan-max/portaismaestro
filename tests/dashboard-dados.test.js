const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../public/dashboard-cotacoes/dados');
const source = [
  { 'COTAÇÃO': '001', VENDEDOR: 'GUSTAVO', VENCIMENTO: '20/10/2026', RESPOSTA: 'NÃO RESPONDIDO', ITEM: 'A' },
  { 'COTAÇÃO': '001', VENDEDOR: 'MICHELI', VENCIMENTO: '10/21/2026', RESPOSTA: 'RESPONDIDO', ITEM: 'B' },
  { 'COTAÇÃO': '003', VENDEDOR: '', VENCIMENTO: '06/07/2026', RESPOSTA: '' },
  { 'COTAÇÃO': '004', VENDEDOR: 'LIBNI', VENCIMENTO: '', RESPOSTA: 'INST. VALE' }
];
test('normaliza sem mesclar números, inventar histórico ou alterar a origem', () => {
  const original = JSON.stringify(source), rows = D.normalizeRows(source);
  assert.equal(rows.length, 4); assert.notEqual(rows[0].id, rows[1].id);
  assert.equal(rows[0].status, 'pending'); assert.equal(rows[1].status, 'responded');
  assert.equal(rows[1].respondedAt, null); assert.equal(rows[1].channel, null); assert.equal(rows[1].detectedAt, null);
  assert.equal(rows[2].seller, 'Sem vendedor'); assert.equal(rows[2].dateProblem, 'ambiguous');
  assert.equal(rows[3].status, 'invalid'); assert.equal(rows[0].original, source[0]);
  assert.equal(JSON.stringify(source), original);
});
test('datas mistas: inequívocas são aceitas, ambíguas exigem escolha explícita', () => {
  assert.equal(D.parseDate('20/10/2026').iso, '2026-10-20');
  assert.equal(D.parseDate('10/21/2026').iso, '2026-10-21');
  assert.equal(D.parseDate('06/07/2026').problem, 'ambiguous');
  assert.equal(D.parseDate('06/07/2026', 'br').iso, '2026-07-06');
  assert.equal(D.parseDate('06/07/2026', 'us').iso, '2026-06-07');
  assert.equal(D.parseDate('31/02/2026').problem, 'invalid');
  assert.equal(D.parseDate('2026-10-14T10:00:00').iso, '2026-10-14');
});
test('classifica variantes negativas e desconhecidas de forma explícita', () => {
  assert.equal(D.normalize('NÃƒO RESPONDIDO'), 'pending');
  assert.equal(D.normalize('NÃO RESPONDIDO'), 'pending');
  assert.equal(D.normalize('RESPONDIDA'), 'responded');
  assert.equal(D.normalize('PETROBRAS'), 'invalid');
});
test('recorte combinado, indicadores e datas ausentes ao final', () => {
  const rows = D.normalizeRows(source), original = JSON.stringify(source);
  const selected = D.select(rows, { sellers: ['GUSTAVO', 'MICHELI'], from: '2026-10-14', to: '2026-10-20' });
  assert.equal(selected.length, 1); assert.equal(selected[0].number, '001');
  assert.equal(D.select(rows, { from: '2026-10-20', to: '2026-10-14' }).length, 0);
  for (const key of ['active', 'pendingActive', 'today', 'next7', 'overdue']) {
    assert.equal(D.select(rows, { deadline: key }).length, D.metrics(rows)[key]);
  }
  assert.equal(D.sortRows(rows).at(-1).due, '');
  assert.equal(D.sortRows(rows, 'desc')[0].due, '2026-10-21');
  assert.equal(JSON.stringify(source), original);
});
