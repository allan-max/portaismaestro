const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../public/planilha_vale.html'), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter((match) => !/\bsrc=/.test(match[1]));

function page() {
    const elements = Object.fromEntries([
        'global-search', 'filtro-data-inicio', 'filtro-data-fim',
        'filtro-ordem-vencimento', 'menu-filtro-periodo', 'view-cota', 'total-count'
    ].map(id => [id, { value: '', style: {} }]));
    const context = vm.createContext({
        window: {},
        document: { getElementById: id => elements[id], addEventListener() {} },
        renderizarCotacoes() {}, renderizarPedidos() {}
    });
    const script = scripts.find(match => match[2].includes('function aplicarFiltroGlobal()'))[2];
    vm.runInContext(script, context);
    context.window.dadosBanco = {
        cotacoes: [
            { 'COTAÇÃO': '30', VENCIMENTO: '02/11/2026', VENDEDOR: 'ANA' },
            { 'COTAÇÃO': '20', VENCIMENTO: '09/10/2026', VENDEDOR: 'ANA' },
            { 'COTAÇÃO': '10', VENCIMENTO: '16/10/2026', VENDEDOR: 'BIA' },
            { 'COTAÇÃO': '40', VENCIMENTO: '-' },
            { 'COTAÇÃO': '50', VENCIMENTO: '31/02/2026' },
            { 'COTAÇÃO': '60' }
        ], pedidos: [{ PEDIDO: '123' }]
    };
    const ids = () => Array.from(context.window.filteredCotacoes, row => row['COTAÇÃO']);
    return { context, elements, ids };
}

test('scripts inline têm sintaxe válida', () => {
    scripts.forEach(match => new vm.Script(match[2]));
});

test('preserva menu, painel, robôs e coluna NF da versão boa 43b6c21', () => {
    const source = html.replace(/\r\n/g, '\n');
    // Blocos de 43b6c21; o terceiro inclui a conferência e o painel de sync novos.
    const blocks = [
        ['<body>', '    <div id="menu-filtro-periodo"', 'd9e3c23fc9521315b50a2ea5ea4bf17a6499bb30d046950d6204cf99e198128c'],
        ['    <div id="modal-sync-nf"', '    <script src=', 'bd4b84956e4f8194c6c8f43c5276dbdb781323bf3720486823cf27fe05d7a639'],
        ['        const sessionAtual =', '        window.filteredCotacoes = [];', '487ef5d11039c1378c5451a412d0b2a7692ca95fa48d1fe639ff651732153cd2'],
        ['        window.pageCota = 0;', '    // Add logic for global search', '1a61f28dadd760a25858e085bc5ec4dc67007b7468dc40b00ebfb5528df038fb']
    ];
    for (const [start, end, expected] of blocks) {
        const from = source.indexOf(start);
        const to = source.indexOf(end, from);
        assert.ok(from >= 0 && to > from, `Bloco ausente: ${start}`);
        assert.equal(createHash('sha256').update(source.slice(from, to)).digest('hex'), expected, start);
    }
});

test('ordena todas as datas, deixa ausentes/inválidas no fim e mantém a origem', () => {
    const { context, elements, ids } = page();
    elements['filtro-ordem-vencimento'].value = '1';
    context.aplicarFiltroPeriodo();
    assert.deepEqual(ids(), ['20', '10', '30', '40', '50', '60']);
    elements['filtro-ordem-vencimento'].value = '-1';
    context.aplicarFiltroPeriodo();
    assert.deepEqual(ids(), ['30', '10', '20', '40', '50', '60']);
    context.aplicarFiltroGlobal(); // A atualização dos dados usa esta mesma função.
    assert.deepEqual(ids(), ['30', '10', '20', '40', '50', '60']);
    assert.equal(context.window.dadosBanco.cotacoes[0]['COTAÇÃO'], '30');
    assert.equal(context.window.filteredPedidos[0].PEDIDO, '123');
    context.limparFiltroPeriodo();
    assert.deepEqual(ids(), ['30', '20', '10', '40', '50', '60']);
    assert.equal(elements['filtro-ordem-vencimento'].value, '0');
});

test('combina ordenação com período, busca e vendedor', () => {
    const { context, elements, ids } = page();
    elements['filtro-ordem-vencimento'].value = '1';
    elements['filtro-data-inicio'].value = '2026-10-09';
    elements['filtro-data-fim'].value = '2026-10-16';
    context.aplicarFiltroPeriodo();
    assert.deepEqual(ids(), ['20', '10']);
    elements['filtro-ordem-vencimento'].value = '-1';
    context.aplicarFiltroPeriodo();
    assert.deepEqual(ids(), ['10', '20']);
    elements['global-search'].value = 'ANA';
    context.aplicarFiltroGlobal();
    assert.deepEqual(ids(), ['20']);
    elements['global-search'].value = '';
    context.window.vendedoresUnicos = ['ANA', 'BIA'];
    context.window.filtroVendedorAtivo.add('BIA');
    context.aplicarFiltroGlobal();
    assert.deepEqual(ids(), ['10']);
});

test('padrão preserva a ordenação existente com período e parser valida datas', () => {
    const { context, elements, ids } = page();
    elements['filtro-ordem-vencimento'].value = '0';
    elements['filtro-data-inicio'].value = '2026-10-09';
    elements['filtro-data-fim'].value = '2026-10-16';
    context.aplicarFiltroPeriodo();
    assert.deepEqual(ids(), ['10', '20']);
    assert.equal(context.parseVencimento('31/02/2026'), null);
    assert.equal(context.parseVencimento('texto'), null);
    assert.equal(context.parseVencimento('10/16/2026'), context.parseVencimento('16/10/2026'));
    assert.notEqual(context.parseVencimento('29/02/2024'), null);
    assert.equal(context.parseVencimento('29/02/2026'), null);
});
