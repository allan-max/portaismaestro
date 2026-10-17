const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const server = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
const handler = server.match(/socket\.on\('marcar_cotacao_respondida', (\(dados = \{\}\) => \{[\s\S]*?\n    \})\);/)[1];
function executar(autenticado, bot, dados) {
    const eventos = [];
    vm.runInNewContext(`(${handler})(dados)`, { dados, bot_socket_id: bot, audit: () => ({ id: 'aud-1' }),
        socket: { autenticado, id: 'usuario', emit: (e, d) => eventos.push({ e, d }) },
        io: { to: destino => ({ emit: (e, d) => eventos.push({ destino, e, d }) }) } });
    return eventos;
}
const identidade = { 'COTAÇÃO': '123', VENDEDOR: 'GUSTAVO', LOCALIDADE: 'Vitória', ITEM: 'Câmera', VENCIMENTO: '20/10/2026' };
test('resposta exige login, dados válidos e robô online', () => {
    assert.equal(executar(false, 'bot', { identidade })[0].e, 'sessao_invalida');
    assert.equal(executar(true, 'bot', {})[0].d.sucesso, false);
    assert.equal(executar(true, null, { identidade })[0].d.sucesso, false);
});
test('encaminha apenas RESPOSTA com identidade e clientId do socket', () => {
    const [r] = executar(true, 'bot', { identidade, clientId: 'outro', novos_dados: { VENDEDOR: 'outro' } });
    assert.equal(r.destino, 'bot');
    assert.equal(r.e, 'comando_marcar_cotacao_respondida');
    assert.equal(r.d.clientId, 'usuario');
    assert.equal(r.d.audit_id, 'aud-1');   // a auditoria fecha o registro quando o robô responder
    assert.deepEqual(JSON.parse(JSON.stringify(r.d.novos_dados)), { RESPOSTA: 'RESPONDIDO' });
    assert.deepEqual(JSON.parse(JSON.stringify(r.d.identidade)), identidade);
});
test('botão aguarda confirmação, informa falha e não salva acompanhamento local como resposta', () => {
    const elementos = new Map();
    const listeners = {};
    const enviados = [];
    let iniciar;
    const get = id => {
        if (!elementos.has(id)) elementos.set(id, { value: '', hidden: false, disabled: false,
            classList: { toggle() {} }, addEventListener(evento, fn) { listeners[`${id}:${evento}`] = fn; } });
        return elementos.get(id);
    };
    const context = vm.createContext({
        document: { addEventListener: (_, fn) => { iniciar = fn; }, getElementById: get },
        localStorage: { getItem: () => null }, window: { location: { origin: 'http://teste' }, addEventListener() {} },
        setTimeout: () => 1, clearTimeout() {}
    });
    const app = fs.readFileSync(require('node:path').join(__dirname, '../public/teste/app.js'), 'utf8');
    vm.runInContext(app, context);
    iniciar();
    const handlers = {};
    context.localStorage.getItem = () => 'sessao-teste';
    context.io = () => ({ connected: true, on: (evento, fn) => { handlers[evento] = fn; },
        emit: (evento, dados) => enviados.push({ evento, dados }) });
    vm.runInContext(`conectarPlanilha(); autenticado = true; itemAberto = { original: ${JSON.stringify(identidade)} };`, context);
    listeners['marcar-respondida:click']();
    assert.equal(enviados.at(-1).evento, 'marcar_cotacao_respondida');
    assert.equal(get('marcar-respondida').disabled, true);
    assert.match(get('estado-resposta').textContent, /Salvando/);
    handlers.resposta_acao_linha({ sucesso: false, erro: 'Cotação duplicada' });
    assert.equal(get('estado-resposta').textContent, 'Cotação duplicada');
    assert.equal(get('marcar-respondida').disabled, false);
    listeners['marcar-respondida:click']();
    handlers.resposta_acao_linha({ sucesso: true });
    assert.match(get('estado-resposta').textContent, /salva no JSON/);
    assert.equal(get('marcar-respondida').disabled, true);
    assert.equal(enviados.at(-1).evento, 'solicitar_planilha_json');
});
