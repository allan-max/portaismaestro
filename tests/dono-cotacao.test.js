// Dono da cotação pelo nome na coluna VENDEDOR. Mesmos casos de gerenciador/teste/test_donos_vendedor.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../lib/dono-cotacao');

const USUARIOS = {
    'cabral@x': { nome: 'Gustavo Cabral Calvi', vendedor: 'GUSTAVO' },
    'libni@x': { vendedor: 'libni' },
    'm1@x': { vendedor: 'MICHELI' },
    'm2@x': { vendedor: 'micheli' },
    'rita@x': { nome: 'Rita Souza', vendedor: '' },
    'bloq@x': { nome: 'Bloq Ueado', vendedor: 'BLOQ', bloqueado: true },
};
const donos = (celula, usuarios = USUARIOS) => [...D.donosDaCotacao(celula, D.contasVendedoras(usuarios))].sort();

test('um Gustavo só: recebe as antigas com o primeiro nome e as com nome completo', () => {
    for (const c of ['GUSTAVO', ' gustavo ', 'Gustavo Cabral', 'GUSTAVO CABRAL CALVI', 'Gustavo Calvi']) {
        assert.deepEqual(donos(c), ['cabral@x'], c);
    }
});

test('dois Gustavos: só o primeiro nome não vai para ninguém; nome completo separa', () => {
    const usuarios = { ...USUARIOS, 'santos@x': { nome: 'Gustavo Santos', vendedor: 'GUSTAVO' } };
    assert.deepEqual(donos('GUSTAVO', usuarios), []);
    assert.deepEqual(donos('Gustavo Cabral', usuarios), ['cabral@x']);
    assert.deepEqual(donos('Gustavo Santos', usuarios), ['santos@x']);
    assert.deepEqual(donos('Gustavo Silva', usuarios), []);
});

test('conta antiga sem nome e Gustavo novo são pessoas diferentes', () => {
    const usuarios = { 'velho@x': { vendedor: 'GUSTAVO' }, 'santos@x': { nome: 'Gustavo Santos', vendedor: 'GUSTAVO' } };
    assert.deepEqual(donos('GUSTAVO', usuarios), []);
    assert.deepEqual(donos('Gustavo Santos', usuarios), ['santos@x']);
});

test('mesma pessoa com duas contas vê nas duas; acento não importa', () => {
    assert.deepEqual(donos('MICHELI'), ['m1@x', 'm2@x']);
    assert.deepEqual(donos('Libní'), ['libni@x']);
});

test('célula com vários vendedores e textos que não são vendedor', () => {
    assert.deepEqual(donos('GUSTAVO / LIBNI'), ['cabral@x', 'libni@x']);
    for (const nada of ['', null, 'W', 'VENCIDA', 'Rita Souza', 'BLOQ', 'Cabral']) assert.deepEqual(donos(nada), [], String(nada));
});

test('servidor: Minhas Cotações filtra pelo e-mail da sessão e não manda a lista de contas ao navegador', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.match(src, /delete dados\.email_vendedor; delete dados\.email_excluir;/);
    assert.match(src, /dados\.email_vendedor = String\(user\.email\)/);
    assert.match(src, /delete dados\._contas_vendedores;[\s\S]{0,80}dashboardCotacoes\.receber/);
});
