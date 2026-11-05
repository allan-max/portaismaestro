const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const XLSX = require('./vendor/xlsx-0.20.3.mini.min.js');
const ExcelJS = require('../public/vendor/exceljs-4.4.0.min.js');

function page() {
    const elements = Object.fromEntries([
        'view-cota', 'global-search', 'total-count', 'filtro-data-inicio',
        'filtro-data-fim', 'filtro-ordem-vencimento', 'menu-filtro-periodo', 'btn-exportar-excel'
    ].map(id => [id, { style: {}, value: '' }]));
    const downloads = [];
    const alerts = [];
    let blob;
    const context = vm.createContext({
        window: {}, console,
        document: {
            getElementById: id => elements[id], addEventListener() {}, body: { appendChild() {} },
            createElement() { return { remove() {}, click() {
                downloads.push({ filename: this.download, buffer: blob.buffer, workbook: XLSX.read(blob.buffer, { type: 'buffer' }) });
            } }; }
        },
        alert: message => alerts.push(message),
        renderizarCotacoes() {}, renderizarPedidos() {},
        setTimeout, clearTimeout, setImmediate,
        Blob: class { constructor(parts) { this.buffer = Buffer.from(parts[0]); } },
        URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/exceljs-4.4.0.min.js'), 'utf8'), context);
    context.ExcelJS = context.window.ExcelJS;
    const html = fs.readFileSync(path.join(__dirname, '../public/planilha_vale.html'), 'utf8');
    const filterScript = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
        .find(match => match[1].includes('function aplicarFiltroGlobal()'))[1];
    vm.runInContext(filterScript, context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/planilha-exportar.js'), 'utf8'), context);
    context.window.dadosBanco = {
        cotacoes: [
            { 'COTAÇÃO': '001', VENCIMENTO: '16/10/2026', VENDEDOR: 'ANA', ITEM: 'Descrição com acentuação\ne quebra de linha' },
            { 'COTAÇÃO': '002', VENCIMENTO: '09/10/2026', VENDEDOR: 'ANA' },
            { 'COTAÇÃO': '003', VENCIMENTO: '12/10/2026', VENDEDOR: 'BIA' },
            { 'COTAÇÃO': '004', VENCIMENTO: '02/11/2026', VENDEDOR: 'ANA' }
        ], pedidos: [{ PEDIDO: '000123', 'Nº NOTA FISCAL': '000456', VALOR: 123.45 }]
    };
    const rows = () => XLSX.utils.sheet_to_json(downloads.at(-1).workbook.Sheets['Cotações']);
    return { context, elements, downloads, alerts, rows };
}

test('exporta XLSX real com período, vendedor e ambos juntos, mantendo a ordenação', async () => {
    const { context, elements, rows, downloads } = page();
    elements['filtro-ordem-vencimento'].value = '-1';
    elements['filtro-data-inicio'].value = '2026-10-09';
    elements['filtro-data-fim'].value = '2026-10-16';
    context.aplicarFiltroPeriodo();
    await context.exportarPlanilhaFiltrada();
    assert.deepEqual(rows().map(r => r['COTAÇÃO']), ['001', '003', '002']);
    assert.equal(Buffer.from(downloads[0].buffer.subarray(0, 2)).toString(), 'PK');
    assert.match(downloads[0].filename, /^maestro_cotacoes_\d{4}-\d{2}-\d{2}\.xlsx$/);
    context.window.vendedoresUnicos = ['ANA', 'BIA'];
    context.window.filtroVendedorAtivo.add('ANA');
    context.aplicarFiltroGlobal();
    await context.exportarPlanilhaFiltrada();
    assert.deepEqual(rows().map(r => r['COTAÇÃO']), ['001', '002']);
    context.limparFiltroPeriodo();
    await context.exportarPlanilhaFiltrada();
    assert.deepEqual(rows().map(r => r['COTAÇÃO']), ['001', '002', '004']);
    elements['global-search'].value = '001';
    context.aplicarFiltroGlobal();
    await context.exportarPlanilhaFiltrada();
    assert.equal(rows().length, 1);
    assert.equal(rows()[0].ITEM, 'Descrição com acentuação\ne quebra de linha');
});

test('exporta todos os resultados além dos 50 da página e preserva textos como texto', async () => {
    const { context, downloads, rows } = page();
    context.window.dadosBanco.cotacoes = Array.from({ length: 120 }, (_, i) => ({
        'COTAÇÃO': String(i).padStart(6, '0'),
        ITEM: i === 0 ? '=HYPERLINK("https://example.com")' : 'material',
        VALOR: i, ...(i === 119 ? { OBSERVAÇÃO: '@SUM(1,2)' } : {})
    }));
    context.aplicarFiltroGlobal();
    await context.exportarPlanilhaFiltrada();
    assert.equal(rows().length, 120);
    assert.equal(rows()[0]['COTAÇÃO'], '000000');
    assert.equal(rows()[119].OBSERVAÇÃO, '@SUM(1,2)');
    const sheet = downloads[0].workbook.Sheets['Cotações'];
    assert.equal(sheet.C2.t, 's');
    assert.equal(sheet.C2.f, undefined);
    assert.equal(sheet.J2.t, 'n');
    assert.ok(sheet['!autofilter']);
});

test('aba Pedidos exporta pedidos com NF e números sem incluir cotações', async () => {
    const { context, elements, downloads } = page();
    context.aplicarFiltroGlobal();
    elements['view-cota'].style.display = 'none';
    await context.exportarPlanilhaFiltrada();
    const download = downloads[0];
    assert.deepEqual(download.workbook.SheetNames, ['Pedidos']);
    const row = XLSX.utils.sheet_to_json(download.workbook.Sheets.Pedidos)[0];
    assert.equal(row.PEDIDO, '000123');
    assert.equal(row['NF (MAESTRO)'], '000456');
    assert.equal(row.VALOR, 123.45);
    assert.match(download.filename, /^maestro_pedidos_/);
});

test('lista vazia ou biblioteca indisponível não gera arquivo e informa o usuário', async () => {
    const { context, downloads, alerts } = page();
    await context.exportarPlanilhaFiltrada();
    assert.equal(downloads.length, 0);
    assert.match(alerts[0], /Nenhum registro/);
    context.aplicarFiltroGlobal();
    context.ExcelJS = undefined;
    context.console = { error() {} };
    await context.exportarPlanilhaFiltrada();
    assert.equal(downloads.length, 0);
    assert.match(alerts[1], /Não foi possível gerar/);
    assert.equal(context.document.getElementById('btn-exportar-excel').disabled, false);
});

test('organiza e formata cabeçalhos, mantendo nomes variantes e campos extras', async () => {
    const { context, downloads, elements } = page();
    elements['view-cota'].style.display = 'none';
    context.window.filteredPedidos = [{
        'EMAIL REQUSITAN': 'exemplo@example.com', 'VALOR ': 1500.50, 'REQUISITANTE ': 'ANA',
        PEDIDO: '000123', CIDADE: 'Vitória ES', FRETE: 'EXW', PRODUTO: 'Descrição\nem duas linhas',
        'DATA DE ENTREGA': '16/10/2026', RFQ: '001234', NF: '000987', OBSERVAÇÃO: 'Acompanhar'
    }];
    await context.exportarPlanilhaFiltrada();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(downloads[0].buffer);
    const sheet = workbook.getWorksheet('Pedidos');
    assert.deepEqual(sheet.getRow(1).values.slice(1), [
        'CIDADE', 'FRETE', 'PEDIDO', 'VALOR', 'PRODUTO', 'DATA DE ENTREGA',
        'NMR DA RFQ', 'REQUISITANTE', 'EMAIL REQUISITANTE', 'NF (MAESTRO)', 'OBSERVAÇÃO'
    ]);
    assert.equal(sheet.getCell('I2').value, 'exemplo@example.com');
    assert.equal(sheet.getCell('H2').value, 'ANA');
    assert.equal(sheet.getCell('D2').value, 1500.50);
    assert.equal(sheet.getCell('D2').numFmt, '"R$" #,##0.00');
    assert.equal(sheet.getCell('A1').font.bold, true);
    assert.equal(sheet.getCell('A1').fill.fgColor.argb, 'FFFCE4D6');
    assert.equal(sheet.getCell('A2').border.bottom.style, 'thin');
    assert.equal(sheet.getCell('E2').alignment.wrapText, true);
    assert.equal(sheet.getColumn(5).width, 80);
    assert.equal(sheet.views[0].ySplit, 1);
    assert.ok(sheet.autoFilter);
});
