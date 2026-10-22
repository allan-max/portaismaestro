const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const context = vm.createContext({ document: { addEventListener() {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/teste/app.js'), 'utf8'), context);
const run = script => JSON.parse(vm.runInContext(`JSON.stringify(${script})`, context));
vm.runInContext(`const fixture = [
    { 'COTAÇÃO': '001', VENCIMENTO: dataBR(dataComDias(0)), ITEM: 'Câmera digital', VENDEDOR: ' Gustavo ', LOCALIDADE: 'Vitória' },
    { 'COTAÇÃO': '002', VENCIMENTO: dataBR(dataComDias(2)), ITEM: 'Ferramentas', VENDEDOR: 'GUSTAVO', QUANTIDADE: '2 UND' },
    { 'COTAÇÃO': '003', VENCIMENTO: dataBR(dataComDias(20)), ITEM: 'Mesa auxiliar', VENDEDOR: 'ARTHUR' },
    { 'COTAÇÃO': '004', VENCIMENTO: dataBR(dataComDias(-1)), ITEM: 'Material antigo', VENDEDOR: 'MICHELI' },
    { 'COTAÇÃO': '005', VENCIMENTO: '31/02/2026', VENDEDOR: 'LIBNI' },
    { 'COTAÇÃO': '006', VENCIMENTO: dataBR(dataComDias(1)), VENDEDOR: '' },
    { 'COTAÇÃO': '007', VENCIMENTO: dataBR(dataComDias(1)), VENDEDOR: '-' },
    { 'COTAÇÃO': '008', VENCIMENTO: dataBR(dataComDias(1)), VENDEDOR: 'SEM VENDEDOR' }
]; COTACOES = normalizarCotacoes(fixture); VENDEDORES = vendedoresAtivos(COTACOES);`, context);

test('seleção inclui só vendedores com data válida a partir de hoje, sem nomes fixos', () => {
    assert.deepEqual(run('VENDEDORES'), ['ARTHUR', 'GUSTAVO']);
    assert.equal(run('COTACOES.length'), 3);
    assert.ok(run('COTACOES.every(c => c.vencimento >= dataComDias(0))'));
    assert.deepEqual(run('normalizarCotacoes(null)'), []);
    assert.deepEqual(run('normalizarCotacoes([null, [], 123])'), []);
});
test('minhas cotações e todas respeitam período, busca e ordem crescente', () => {
    const minhas = run("filtrarCotacoes(COTACOES, { vendedor: 'GUSTAVO' })");
    assert.deepEqual(minhas.map(c => c.numero), ['001', '002']);
    const todas = run('filtrarCotacoes(COTACOES, { todas: true, inicio: dataComDias(0), fim: dataComDias(7) })');
    assert.deepEqual(todas.map(c => c.numero), ['001', '002']);
    assert.equal(run("filtrarCotacoes(COTACOES, { vendedor: 'ARTHUR' }).length"), 1);
    assert.equal(run("filtrarCotacoes(COTACOES, { todas: true, busca: 'câmera' }).length"), 1);
    assert.deepEqual(run('filtrarCotacoes(COTACOES, { todas: true, inicio: dataComDias(7), fim: dataComDias(0) })'), []);
    assert.deepEqual(run("filtrarCotacoes(COTACOES, { todas: true, busca: 'inexistente' })"), []);
});
test('datas brasileiras, americanas e ISO são validadas sem inventar vencimentos', () => {
    assert.equal(run("vencimentoISO('21/10/2026')"), '2026-10-21');
    assert.equal(run("vencimentoISO('10/21/2026')"), '2026-10-21');
    assert.equal(run("vencimentoISO('2026-10-21T15:00:00')"), '2026-10-21');
    assert.equal(run("vencimentoISO('29/02/2024')"), '2024-02-29');
    for (const valor of ['31/02/2026', '29/02/2026', '-', '', '13/13/2026', 'sem data']) {
        assert.equal(run(`vencimentoISO(${JSON.stringify(valor)})`), null);
    }
});
test('datas de hoje são inclusivas e limpar o início nunca traz cotações vencidas', () => {
    assert.equal(run("filtrarCotacoes(COTACOES, { vendedor: 'GUSTAVO', fim: dataComDias(0) }).length"), 1);
    assert.equal(run("filtrarCotacoes([{ vencimento: dataComDias(-1), numero: '9' }], { todas: true }).length"), 0);
});
test('normalização preserva campos originais, espaços nos cabeçalhos e chave estável das notas', () => {
    assert.equal(run("COTACOES[0].original.VENDEDOR"), ' Gustavo ');
    assert.equal(run("COTACOES[1].quantidade"), '2 UND');
    assert.equal(run("normalizarCotacoes([{ 'COTAÇÃO': '42', 'VENDEDOR ': 'Micheli', VENCIMENTO: dataComDias(3), 'MARCAS ': 'Marca exemplo' }])[0].marcas"), 'Marca exemplo');
    assert.equal(run('normalizarCotacoes([fixture[2], fixture[0]])[1].chave'), run('COTACOES[0].chave'));
    assert.equal(run(`escapar('<script>"&')`), '&lt;script&gt;&quot;&amp;');
});
test('a consulta aguarda confirmação da sessão e a escrita usa apenas o comando de resposta', () => {
    const source = fs.readFileSync(path.join(__dirname, '../public/teste/app.js'), 'utf8');
    assert.ok(source.includes("socketVendedores.on('sincronizar_estado'"));
    const events = [...source.matchAll(/socketVendedores\.emit\('([^']+)'/g)].map(match => match[1]);
    assert.deepEqual(events.sort(), ['marcar_cotacao_respondida', 'solicitar_planilha_json', 'sou_frontend']);
    // b34566a tirou da planilha o link para teste/ (a página continua acessível pelo endereço)
});
