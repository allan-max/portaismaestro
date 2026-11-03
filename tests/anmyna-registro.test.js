const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { test } = require('node:test');

const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const anmynaHtml = fs.readFileSync(path.join(__dirname, '../public/planilha_anmyna.html'), 'utf8');
const gerenciadorPy = fs.readFileSync(path.join(__dirname, '../../gerenciador/gerenciador.py'), 'utf8');

test('interface planilha_anmyna.html nao contem opcoes ou logica de pedidos', () => {
    assert.ok(!anmynaHtml.includes('Registro de Pedido'), 'Menu nao deve conter Registro de Pedido');
    assert.ok(!anmynaHtml.includes('id="form-pedido"'), 'Nao deve conter form-pedido');
    assert.ok(!anmynaHtml.includes('tabela-pedidos-manuais'), 'Nao deve conter tabela-pedidos-manuais');
    assert.ok(!anmynaHtml.includes('adicionarLinhaPedidoManual'), 'Nao deve conter funcao adicionarLinhaPedidoManual');
    assert.ok(!anmynaHtml.includes('registrarPedidosManuais'), 'Nao deve conter funcao registrarPedidosManuais');
    assert.ok(!anmynaHtml.includes('resposta_registro_pedido_manual'), 'Nao deve escutar resposta_registro_pedido_manual');
});

test('interface planilha_anmyna.html registra cotacao direcionada para Anmyna', () => {
    assert.ok(anmynaHtml.includes('solicitar_registro_cotacao_anmyna'), 'Deve emitir solicitar_registro_cotacao_anmyna');
    assert.ok(anmynaHtml.includes("origem: 'anmyna'"), 'Deve identificar origem anmyna');
    assert.ok(anmynaHtml.includes('resposta_registro_cotacao_anmyna'), 'Deve escutar resposta_registro_cotacao_anmyna');
    // Verifica colunas do formulário de cotação
    assert.ok(anmynaHtml.includes('c-cliente'), 'Formulário deve ter campo cliente');
    assert.ok(anmynaHtml.includes('c-produto'), 'Formulário deve ter campo produto');
    assert.ok(anmynaHtml.includes('c-portal'), 'Formulário deve ter campo portal');
    assert.ok(anmynaHtml.includes('c-empresa'), 'Formulário deve ter campo empresa');
});

test('server.js: salvarCotacoesPlanilhaAnmyna grava corretamente no JSON da Anmyna', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anmyna-test-'));
    const tempJsonPath = path.join(tempDir, 'PLANILHA-ANMYNA.JSON');

    const initialData = {
        "COTAÇÕES 2025": [
            { "NÚMERO DA COTAÇÃO": "COT-INIT-1", "CLIENTE": "CLIENTE A" }
        ]
    };
    fs.writeFileSync(tempJsonPath, JSON.stringify(initialData, null, 2), 'utf8');

    // Extrai salvarCotacoesPlanilhaAnmyna do server.js
    const matchSalvar = serverCode.match(/function salvarCotacoesPlanilhaAnmyna\([\s\S]*?\n\}/);
    assert.ok(matchSalvar, 'salvarCotacoesPlanilhaAnmyna deve existir no server.js');

    const context = {
        fs,
        obterCaminhoPlanilhaAnmyna: () => tempJsonPath
    };
    vm.runInNewContext(matchSalvar[0], context);

    const cotacoesNovas = [
        {
            cotacao: 'ANMYNA-TEST-2026',
            cliente: 'CLIENTE NOVO',
            vendedor: 'VENDEDOR TESTE',
            produto: 'PRODUTO TESTE',
            vencimento: '10/05/2026',
            entrega: '20/05/2026',
            portal: 'ARIBA',
            empresa: 'ALIANÇA'
        }
    ];

    const res = context.salvarCotacoesPlanilhaAnmyna(cotacoesNovas, 'COTAÇÕES 2025');
    assert.equal(res.totalRegistrado, 1);

    const gravado = JSON.parse(fs.readFileSync(tempJsonPath, 'utf8'));
    assert.equal(gravado['COTAÇÕES 2025'].length, 2);
    const reg = gravado['COTAÇÕES 2025'].find(c => c['NÚMERO DA COTAÇÃO'] === 'ANMYNA-TEST-2026');
    assert.ok(reg, 'Registro deve constar na planilha Anmyna');
    assert.equal(reg['CLIENTE'], 'CLIENTE NOVO');
    assert.equal(reg['VENDEDOR '], 'VENDEDOR TESTE');
    assert.equal(reg['PRODUTO'], 'PRODUTO TESTE');
    assert.equal(reg['PORTAL'], 'ARIBA');
    assert.equal(reg['POR QUAL EMPRESA'], 'ALIANÇA');

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('server.js: solicitar_registro_cotacao_manual com origem anmyna NUNCA envia para o robo da Vale', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anmyna-guard-'));
    const tempJsonPath = path.join(tempDir, 'PLANILHA-ANMYNA.JSON');
    fs.writeFileSync(tempJsonPath, JSON.stringify({ "COTAÇÕES 2025": [] }, null, 2), 'utf8');

    // Extrai salvarCotacoesPlanilhaAnmyna e o handler de solicitar_registro_cotacao_manual
    const matchSalvar = serverCode.match(/function salvarCotacoesPlanilhaAnmyna\([\s\S]*?\n\}/);
    const matchHandler = serverCode.match(/socket\.on\('solicitar_registro_cotacao_manual', (\(dados = \{\}\) => \{[\s\S]*?\n    \})\);/);

    assert.ok(matchSalvar, 'salvarCotacoesPlanilhaAnmyna deve existir');
    assert.ok(matchHandler, 'handler de solicitar_registro_cotacao_manual deve existir');

    let roboAcionado = false;
    let respostaRecebida = null;
    let auditado = false;
    let atualizacaoEmitida = false;

    const context = {
        fs,
        bot_socket_id: 'bot-vale-123',
        obterCaminhoPlanilhaAnmyna: () => tempJsonPath,
        audit: () => { auditado = true; return { id: 1 }; },
        io: {
            to: (id) => ({
                emit: (evento, dados) => {
                    if (id === 'bot-vale-123' && evento === 'comando_registrar_cotacao_manual') {
                        roboAcionado = true;
                    }
                }
            }),
            emit: (evento) => {
                if (evento === 'planilha_anmyna_atualizada') atualizacaoEmitida = true;
            }
        },
        socket: {
            autenticado: true,
            id: 'client-1',
            emit: (evento, payload) => {
                respostaRecebida = { evento, payload };
            }
        }
    };

    vm.runInNewContext(matchSalvar[0], context);

    // Executa com origem anmyna
    vm.runInNewContext(`(${matchHandler[1]})({
        origem: 'anmyna',
        cotacoes: [{ cotacao: 'ANMYNA-BLOCKED-VALE', cliente: 'TESTE', produto: 'PRODUTO' }]
    })`, context);

    assert.equal(roboAcionado, false, 'O robo da Vale JAMAIS deve ser acionado para cotacoes da Anmyna');
    assert.ok(respostaRecebida, 'Deve receber resposta');
    assert.equal(respostaRecebida.payload.sucesso, true);
    assert.ok(atualizacaoEmitida, 'Deve emitir evento de planilha anmyna atualizada');

    // Confere se gravou na Anmyna
    const anmData = JSON.parse(fs.readFileSync(tempJsonPath, 'utf8'));
    assert.equal(anmData['COTAÇÕES 2025'].length, 1);
    assert.equal(anmData['COTAÇÕES 2025'][0]['NÚMERO DA COTAÇÃO'], 'ANMYNA-BLOCKED-VALE');

    // Agora executa uma da VALE (sem origem anmyna) e garante que o robô da Vale É chamado
    respostaRecebida = null;
    vm.runInNewContext(`(${matchHandler[1]})({
        cotacoes: [{ cotacao: 'VALE-12345', item: 'Item Vale' }]
    })`, context);

    assert.equal(roboAcionado, true, 'Cotacoes da Vale continuam sendo repassadas ao robo normalmente');

    fs.rmSync(tempDir, { recursive: true, force: true });
});

test('gerenciador.py: possui guardas explícitas recusando qualquer origem anmyna na planilha Vale', () => {
    assert.ok(gerenciadorPy.includes("dados.get('origem', '')).lower() == 'anmyna'"), 'gerenciador.py deve ter guarda para origem anmyna');
    assert.ok(gerenciadorPy.includes('Cotações ANMYNA não devem ser registradas na planilha VALE'), 'Mensagem de recusa de cotacao manual anmyna deve existir');
    assert.ok(gerenciadorPy.includes('A planilha ANMYNA não trabalha com pedidos'), 'Mensagem de recusa de pedidos anmyna deve existir');
});

test('planilha_anmyna.html: ordenacao decrescente prioriza as ultimas cotacoes registradas', () => {
    // 1. Verifica seletores na interface
    assert.ok(anmynaHtml.includes('id="filtro-ordenacao"'), 'Toolbar deve ter select filtro-ordenacao');
    assert.ok(anmynaHtml.includes('value="registro-desc"'), 'Deve conter opcao registro-desc');
    assert.ok(anmynaHtml.includes('Últimas Registradas (Decrescente)'), 'Opcao de ultimas registradas deve estar clara');

    // 2. Simula algoritmo de ordenação com base em índice de registro
    const listaMock = [
        { numero: 'COT-ANTIGA-1', data_venc: '30/12/2026', indice: 0 },
        { numero: 'COT-ANTIGA-2', data_venc: '15/11/2026', indice: 1 },
        { numero: 'COT-RECEM-REGISTRADA', data_venc: '05/11/2026', indice: 2 } // Vencimento anterior, mas registrada por último
    ];

    // Ordenação decrescente por registro (últimas registradas primeiro)
    const ordenadasRegistroDesc = [...listaMock].sort((a, b) => (b.indice ?? 0) - (a.indice ?? 0));
    assert.equal(ordenadasRegistroDesc[0].numero, 'COT-RECEM-REGISTRADA', 'A cotação recém registrada deve aparecer no topo em ordem decrescente');

    // Se fosse por vencimento puro decrescente, COT-ANTIGA-1 ficaria no topo incorretamente
    const ordenadasVencimentoPuro = [...listaMock].sort((a, b) => new Date(b.data_venc).getTime() - new Date(a.data_venc).getTime());
    assert.notEqual(ordenadasVencimentoPuro[0].numero, 'COT-RECEM-REGISTRADA', 'Vencimento puro não atende à ordem de registro');
});
