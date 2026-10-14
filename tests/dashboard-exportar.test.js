const { test } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('../public/vendor/exceljs-4.4.0.min');
const XLSX = require('./vendor/xlsx-0.20.3.mini.min');
const D = require('../public/dashboard-cotacoes/dados');
const { criarWorkbook } = require('../public/dashboard-cotacoes/exportar');
test('exporta todas as linhas do recorte ordenadas com cabeçalhos, metadados e tipos seguros', async () => {
  const original = Array.from({ length: 75 }, (_, i) => ({ 'COTAÇÃO': String(i).padStart(5, '0'),
    ITEM: i === 0 ? '=HYPERLINK("https://example.test")' : 'Descrição\ncom acentuação', VENCIMENTO: '20/10/2026',
    VENDEDOR: i % 2 ? 'GUSTAVO' : 'MICHELI', RESPOSTA: i % 3 ? 'NÃO RESPONDIDO' : 'RESPONDIDO',
    'MARCAS ': 'MARCA', EXTRA: '@SUM(1,2)' }));
  const snapshot = JSON.stringify(original), filters = { sellers: ['GUSTAVO'], from: '2026-10-14', to: '2026-10-20', sort: 'asc', dateMode: 'safe' };
  const selected = D.sortRows(D.select(D.normalizeRows(original), filters), filters.sort);
  const workbook = criarWorkbook(ExcelJS, selected, filters);
  const buffer = await workbook.xlsx.writeBuffer();
  const exported = XLSX.read(buffer, { type: 'buffer' }), sheet = exported.Sheets['Cotações'];
  const rows = XLSX.utils.sheet_to_json(sheet);
  assert.equal(rows.length, selected.length); assert.ok(rows.length > 12);
  assert.equal(rows[0]['COTAÇÃO'], selected[0].number); assert.equal(rows[0].MARCAS, 'MARCA');
  assert.equal(rows[0]['RESPONDIDA EM'], 'Não registrado'); assert.equal(rows[0]['CANAL DA RESPOSTA'], 'Não registrado');
  assert.equal(rows[0].EXTRA, '@SUM(1,2)'); assert.equal(rows[0]['VENCIMENTO NORMALIZADO'], '2026-10-20');
  assert.ok(exported.Sheets.Recorte); assert.ok(sheet['!autofilter']);
  assert.equal(workbook.worksheets[0].views[0].ySplit, 1);
  assert.equal(JSON.stringify(original), snapshot);
  const all = XLSX.read(await criarWorkbook(ExcelJS, D.normalizeRows(original), {}).xlsx.writeBuffer(), { type: 'buffer' });
  assert.equal(all.Sheets['Cotações'].C2.t, 's'); assert.equal(all.Sheets['Cotações'].C2.f, undefined);
  assert.equal(XLSX.utils.sheet_to_json(all.Sheets['Cotações']).length, 75);
});
test('recorte vazio e biblioteca ausente não geram arquivo', () => {
  assert.throws(() => criarWorkbook(ExcelJS, [], {}), /recorte/);
  assert.throws(() => criarWorkbook(null, [{ original: {} }], {}), /Excel/);
});
