const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// O painel (dashboard.html) pede a lista de contas num socket e o robô responde em outro. Se o Set de pedidos
// pendentes for criado dentro de io.on('connection'), a resposta do robô limpa o Set errado e, 2,5 s depois,
// o fallback do arquivo local sobrescreve a lista: a conta recém-cadastrada aparecia e sumia.
test('pedidos de lista de contas ficam fora da conexão, compartilhados entre painel e robô', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const declaracao = src.indexOf('const pedidosPendentes = new Set()');
    const conexao = src.indexOf("io.on('connection'");
    assert.ok(declaracao >= 0, 'pedidosPendentes declarado');
    assert.ok(declaracao < conexao, 'declarado antes de io.on(connection)');
    assert.equal(src.split('const pedidosPendentes').length - 1, 1, 'uma declaração só');
});
