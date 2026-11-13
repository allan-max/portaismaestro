const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

test('separacao de planilhas: planilha_vale.html nao recebe dados da Anmyna', () => {
    // Carrega trecho relevante do server.js
    const handlerSolicitar = server.match(/socket\.on\('solicitar_planilha_json', (\(dados = \{\}\) => \{[\s\S]*?\n    \})\);/)[1];
    const handlerRetorno = server.match(/socket\.on\('retorno_planilha_json', (\(dados\) => \{[\s\S]*?\n    \})\);/)[1];

    const pedidosPlanilhaPorCliente = new Map();
    const enviados = [];
    const botId = 'bot-socket-1';

    const cotacoesVale = [
        { 'COTAÇÃO': 'VALE-100', 'VENDEDOR': 'GUSTAVO', 'ITEM': 'Item Vale 1' },
        { 'COTAÇÃO': 'VALE-200', 'VENDEDOR': 'ALLAN', 'ITEM': 'Item Vale 2' }
    ];

    const cotacoesAnmynaMock = [
        { 'COTAÇÃO': 'ANMYNA-999', 'VENDEDOR': 'GUSTAVO', 'ITEM': 'Item Anmyna 1', 'ORIGEM_PLANILHA': 'anmyna' }
    ];

    const context = {
        pedidosPlanilhaPorCliente,
        bot_socket_id: botId,
        obterPrintsParaCotacoes: () => ({}),
        obterErrosParaCotacoes: () => ({}),
        davRespostas: { paraCotacoes: () => ({}) },
        dashboardCotacoes: { receber: () => false },
        obterCotacoesAnmynaFormatadas: (filtro) => {
            return filtro === 'GUSTAVO' ? cotacoesAnmynaMock : (filtro ? [] : cotacoesAnmynaMock);
        },
        io: {
            sockets: {
                sockets: new Map([
                    ['client-vale', { id: 'client-vale', usuarioLogado: { admin: true } }],
                    ['client-minhas', { id: 'client-minhas', usuarioLogado: { vendedor: 'GUSTAVO' } }]
                ])
            },
            to(destino) {
                return {
                    emit(evento, dados) {
                        enviados.push({ destino, evento, dados: JSON.parse(JSON.stringify(dados)) });
                    }
                };
            }
        }
    };

    // 1. Cliente da Planilha Vale solicita
    const socketVale = {
        autenticado: true,
        id: 'client-vale',
        usuarioLogado: { admin: true }
    };
    context.socket = socketVale;
    vm.runInNewContext(`(${handlerSolicitar})({ origem: 'todas', tela: 'planilha_vale' })`, context);

    // Bot responde para client-vale
    const socketBot = { id: botId };
    context.socket = socketBot;
    vm.runInNewContext(`(${handlerRetorno})({
        sucesso: true,
        clientId: 'client-vale',
        cotacoes: ${JSON.stringify(cotacoesVale)},
        pedidos: [{ 'PEDIDO': 'PED-1' }]
    })`, context);

    const envioVale = enviados.find(e => e.destino === 'client-vale' && e.evento === 'retorno_planilha_json');
    assert.ok(envioVale, 'Deve responder ao client-vale');
    assert.equal(envioVale.dados.cotacoes.length, 2, 'Planilha Vale deve ter apenas as 2 cotações da Vale');
    assert.ok(envioVale.dados.cotacoes.every(c => c.ORIGEM_PLANILHA !== 'anmyna'), 'Planilha Vale não pode conter dados da Anmyna');
    assert.equal(envioVale.dados.pedidos.length, 1, 'Planilha Vale deve conter os pedidos da Vale');

    // 2. Cliente de Minhas Cotações solicita
    const socketMinhas = {
        autenticado: true,
        id: 'client-minhas',
        usuarioLogado: { vendedor: 'GUSTAVO' }
    };
    context.socket = socketMinhas;
    vm.runInNewContext(`(${handlerSolicitar})({ origem: 'todas', apenas_meu_vendedor: true, tela: 'minhas_cotacoes' })`, context);

    // Bot responde para client-minhas (apenas Vale do Gustavo)
    context.socket = socketBot;
    vm.runInNewContext(`(${handlerRetorno})({
        sucesso: true,
        clientId: 'client-minhas',
        cotacoes: [{ 'COTAÇÃO': 'VALE-100', 'VENDEDOR': 'GUSTAVO', 'ITEM': 'Item Vale 1' }],
        pedidos: []
    })`, context);

    const envioMinhas = enviados.find(e => e.destino === 'client-minhas' && e.evento === 'retorno_planilha_json');
    assert.ok(envioMinhas, 'Deve responder ao client-minhas');
    assert.equal(envioMinhas.dados.cotacoes.length, 2, 'Minhas Cotações deve juntar 1 Vale + 1 Anmyna do Gustavo');
    assert.ok(envioMinhas.dados.cotacoes.some(c => c['COTAÇÃO'] === 'VALE-100'), 'Deve ter a cotação Vale');
    assert.ok(envioMinhas.dados.cotacoes.some(c => c['COTAÇÃO'] === 'ANMYNA-999'), 'Deve ter a cotação Anmyna');
});
