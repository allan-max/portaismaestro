const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarCotabot } = require('../lib/cotabot');

function montar({ robo = 'robo-1' } = {}) {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'cotabot-'));
    const emitidos = [];
    const io = { to: alvo => ({ emit: (nome, dados) => emitidos.push({ alvo, nome, dados }) }) };
    let agora = Date.parse('2026-11-25T10:00:00Z');
    const cb = criarCotabot({ pasta, io, obterRobo: () => robo, agora: () => agora });
    return { cb, pasta, emitidos, passar: ms => { agora += ms; } };
}

const ALLAN = { email: 'allan@x', admin: false, cotabot_access: true };
const OUTRO = { email: 'outro@x', admin: false, cotabot_access: true };
const ADMIN = { email: 'adm@x', admin: true };

test('pedir manda cotabot_cotar ao gerenciador só com itens válidos', () => {
    const { cb, emitidos } = montar();
    const r = cb.pedir({ email: ALLAN.email, vendedor: 'Allan', evento: '310170', sites: 'google',
        itens: [{ descricao: ' Geladeira ', quantidade: '2', sites: ['Martins', 'Martins', ' ', 'google'], regras: ['Conferir frete.'] },
            { descricao: '   ' }] });
    assert.ok(r.pedido);
    const env = emitidos.find(e => e.nome === 'cotabot_cotar');
    assert.equal(env.alvo, 'robo-1');
    assert.deepEqual(env.dados.itens, [{ descricao: 'Geladeira', quantidade: 2, sites: ['Martins', 'google'], regras: ['Conferir frete.'] }]);
    assert.equal(env.dados.pedido, r.pedido.id);
});

test('pedir recusa sem gerenciador, sem itens, itens demais e evento estranho', () => {
    assert.equal(montar({ robo: null }).cb.pedir({ email: 'a', itens: [{ descricao: 'x' }] }).status, 503);
    const { cb } = montar();
    assert.equal(cb.pedir({ email: 'a', itens: [] }).status, 400);
    assert.equal(cb.pedir({ email: 'a', itens: Array.from({ length: 25 }, () => ({ descricao: 'x' })) }).status, 400);
    assert.equal(cb.pedir({ email: 'a', evento: '<script>', itens: [{ descricao: 'x' }] }).status, 400);
});

test('status e pronto atualizam o pedido; planilha só para o dono ou admin', () => {
    const { cb, pasta } = montar();
    const { pedido } = cb.pedir({ email: ALLAN.email, evento: '310170', itens: [{ descricao: 'TV 75' }] });
    cb.status({ pedido: pedido.id, estado: 'cotando', mensagem: 'Cotando item 1 de 1.',
        tarefa: { status: 'cotando', itens: [{ numero: 1, status: 'cotando', passos: 7, passo_atual: 'Google' }] } });
    let meu = cb.estadoPara(ALLAN).pedidos[0];
    assert.equal(meu.estado, 'cotando');
    assert.equal(meu.tarefa.itens[0].passos, 7);
    assert.equal(cb.planilhaPara(pedido.id, ALLAN), null);   // ainda não pronto

    cb.pronto({ pedido: pedido.id, planilha: { name: '../../planilha_base_cotacao_310170.xlsx', data: Buffer.from('XLSX').toString('base64') } });
    meu = cb.estadoPara(ALLAN).pedidos[0];
    assert.equal(meu.estado, 'pronto');
    const arq = cb.planilhaPara(pedido.id, ALLAN);
    assert.equal(fs.readFileSync(arq.caminho, 'utf8'), 'XLSX');
    assert.equal(arq.nome, 'planilha_base_cotacao_310170.xlsx');
    assert.equal(path.dirname(arq.caminho), pasta);
    assert.equal(cb.planilhaPara(pedido.id, OUTRO), null);
    assert.ok(cb.planilhaPara(pedido.id, ADMIN));
    assert.equal(cb.estadoPara(OUTRO).pedidos.length, 0);
    assert.equal(cb.planilhaPara('../x', ADMIN), null);

    cb.status({ pedido: pedido.id, estado: 'erro', mensagem: 'atrasado' });   // pronto é final
    assert.equal(cb.estadoPara(ALLAN).pedidos[0].estado, 'pronto');
});

test('pedidos sobrevivem a reinício do portal', () => {
    const { cb, pasta } = montar();
    const { pedido } = cb.pedir({ email: ALLAN.email, itens: [{ descricao: 'x' }] });
    const io = { to: () => ({ emit() {} }) };
    const de_novo = criarCotabot({ pasta, io, obterRobo: () => 'r' });
    assert.equal(de_novo.estadoPara(ALLAN).pedidos[0].id, pedido.id);
});

test('gerenciador caiu: pedido ativo vira erro, mas volta se a ponte continuar', () => {
    const { cb } = montar();
    const { pedido } = cb.pedir({ email: ALLAN.email, itens: [{ descricao: 'x' }] });
    cb.roboCaiu();
    assert.equal(cb.estadoPara(ALLAN).pedidos[0].estado, 'erro');
    cb.status({ pedido: pedido.id, estado: 'cotando', mensagem: 'Cotando item 1 de 1.' });
    assert.equal(cb.estadoPara(ALLAN).pedidos[0].estado, 'cotando');
});

test('uso: pede à VM no máximo uma vez por minuto', () => {
    const { cb, emitidos, passar } = montar();
    cb.estadoPara(ALLAN);
    cb.estadoPara(ALLAN);
    assert.equal(emitidos.filter(e => e.nome === 'cotabot_uso_pedir').length, 1);
    cb.receberUso({ online: true, uso: { janelas: {} } });
    assert.equal(cb.estadoPara(ALLAN).uso.online, true);
    passar(61000);
    cb.estadoPara(ALLAN);
    assert.equal(emitidos.filter(e => e.nome === 'cotabot_uso_pedir').length, 2);
});
