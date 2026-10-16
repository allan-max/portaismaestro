const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const handler = server.match(/socket\.on\('solicitar_planilha_json', (\(dados = \{\}\) => \{[\s\S]*?\n    \})\);/)[1];

function request(autenticado, bot) {
    const enviados = [];
    const context = { dados: { origem: 'todas' }, bot_socket_id: bot,
        socket: { autenticado, id: 'frontend-123', emit(evento, dados) { enviados.push({ destino: 'frontend', evento, dados }); } },
        io: { to(destino) { return { emit(evento, dados) { enviados.push({ destino, evento, dados }); } }; } }
    };
    vm.runInNewContext(`(${handler})(dados)`, context);
    return enviados;
}
test('requisição sem sessão não recebe planilha nem aciona o robô', () => {
    assert.deepEqual(request(false, 'bot-123'), [{ destino: 'frontend', evento: 'sessao_invalida', dados: undefined }]);
});
test('sessão válida recebe dados pelo robô com clientId correto', () => {
    assert.deepEqual(request(true, 'bot-123'), [{ destino: 'bot-123', evento: 'comando_carregar_planilha_json', dados: { origem: 'todas', clientId: 'frontend-123' } }]);
});
test('sessão válida recebe aviso quando o robô está offline', () => {
    const [resposta] = request(true, null);
    assert.equal(resposta.evento, 'retorno_planilha_json');
    assert.equal(resposta.dados.sucesso, false);
    assert.match(resposta.dados.erro, /offline/);
});
