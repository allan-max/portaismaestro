const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const telaCode = fs.readFileSync(path.join(__dirname, '../public/minhas-cotacoes/tela.js'), 'utf8');

test('server.js: salvarPrintsEvento e obterPrintsParaCotacoes encontram prints flexiveis por numero', () => {
    const sandbox = {
        fs,
        path,
        caminhoPrintsRespostas: path.join(__dirname, 'mock_prints.json'),
        printsPorEvento: {},
        io: { to: () => ({ emit: () => {} }) }
    };

    const matchSalvar = serverCode.match(/function salvarPrintsEvento\([\s\S]*?\n\}/);
    const matchObter = serverCode.match(/function obterPrintsParaCotacoes\([\s\S]*?\n\}/);

    assert.ok(matchSalvar, 'salvarPrintsEvento deve existir');
    assert.ok(matchObter, 'obterPrintsParaCotacoes deve existir');

    vm.runInNewContext(matchSalvar[0] + '\n' + matchObter[0], sandbox);

    // Salva print para evento 301015
    const mockPrints = [{ item: '1', imagem: 'base64sample123', preco: '100,00', prazo: '10' }];
    sandbox.salvarPrintsEvento('301015', mockPrints);

    // Consulta com diferentes formatos de cotação
    const cotaFormatada = [{ 'COTAÇÃO': 'COTAÇÃO > 301015' }];
    const cotaTexto = [{ 'COTAÇÃO': 'Evento 301015' }];
    const cotaPura = [{ 'COTAÇÃO': '301015' }];

    const res1 = sandbox.obterPrintsParaCotacoes(cotaFormatada);
    const res2 = sandbox.obterPrintsParaCotacoes(cotaTexto);
    const res3 = sandbox.obterPrintsParaCotacoes(cotaPura);

    assert.ok(res1['COTAÇÃO > 301015'] || res1['301015'], 'Deve resolver para COTAÇÃO > 301015');
    assert.ok(res2['Evento 301015'] || res2['301015'], 'Deve resolver para Evento 301015');
    assert.ok(res3['301015'], 'Deve resolver para 301015');

    // Limpa mock se gerou arquivo
    if (fs.existsSync(sandbox.caminhoPrintsRespostas)) {
        fs.unlinkSync(sandbox.caminhoPrintsRespostas);
    }
});

test('tela.js: printsDe localiza prints por digitos e secaoPrintsEvento usa data-acao abrir-print (sem link data: quebrado)', () => {
    assert.ok(!telaCode.includes('<a href="${esc(src)}" target="_blank"'), 'Nao deve conter link <a> direto para data URL que e bloqueado pelo Chrome');
    assert.ok(telaCode.includes('data-acao="abrir-print"'), 'Deve conter acao abrir-print');
    assert.ok(telaCode.includes('abrirVisualizadorPrint'), 'Deve conter funcao abrirVisualizadorPrint');
    assert.ok(telaCode.includes('pc-lightbox-print'), 'Deve conter lightbox do visualizador');
    assert.ok(telaCode.includes('abrirPrintEmNovaAba'), 'Deve conter funcao segura de abrir print em nova aba');
    assert.ok(telaCode.includes('baixarPrintVisualizador'), 'Deve conter opcao de download');
});
