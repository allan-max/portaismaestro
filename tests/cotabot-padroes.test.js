const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarPadroes } = require('../lib/cotabot-padroes');
const R = require('../public/cotabot/reconhecer');

const novoArquivo = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-padroes-')), 'padroes.json');

test('começa com os padrões do Base_Fornecedores e um geral', () => {
    const p = criarPadroes({ arquivo: novoArquivo() }).listar();
    assert.ok(p.length >= 10);
    assert.equal(p.filter(x => x.geral).length, 1);
    assert.ok(p.find(x => x.id === 'intelbras').fornecedores.includes('Linhavix'));
});

test('reconhece categoria e marca pela descrição (sem acento, palavra inteira)', () => {
    const padroes = criarPadroes({ arquivo: novoArquivo() }).listar();
    const ids = d => R.reconhecer(d, padroes).map(a => a.padrao.id);
    assert.deepEqual(ids('13507497 || AR CONDICIONADO SPLIT 12.000 BTUS || FABRICANTE/REFERENCIA: ELGIN'), ['ar-condicionado']);
    assert.deepEqual(ids('Câmera IP Intelbras VIP 1230'), ['intelbras']);
    assert.deepEqual(ids('Mouse sem fio Logitech M170'), ['logitech', 'informatica']);
    assert.deepEqual(ids('Sabão em pó 1kg'), ['limpeza']);
    assert.deepEqual(ids('TVBOX qualquer'), []);   // "tv" só como palavra inteira
    assert.deepEqual(ids('Smart TV 50 polegadas'), ['informatica']);
});

test('monta os lugares do item: marcados, extras e Google, sem repetir; regra só com fornecedor marcado', () => {
    const ar = { id: 'ar', fornecedores: ['Friovix', 'Martins'], regra: 'Conferir frete.' };
    const info = { id: 'info', fornecedores: ['Martins', 'Agis'], regra: 'Outra regra.' };
    const r = R.montarLugares([{ padrao: ar, marcados: ['Friovix', 'Martins'] }, { padrao: info, marcados: [] }],
        true, ['kabum.com.br', 'martins']);
    assert.deepEqual(r.sites, ['Friovix', 'Martins', 'kabum.com.br', 'google']);
    assert.deepEqual(r.regras, ['Conferir frete.']);
    assert.deepEqual(R.montarLugares([], false, []).sites, []);
});

test('criar, editar e apagar padrão; grava no arquivo e só um geral', () => {
    const arquivo = novoArquivo();
    const p = criarPadroes({ arquivo });
    assert.equal(p.salvar('', { nome: 'X', fornecedores: ['A'] }).status, 400);   // sem palavra-chave
    const r = p.salvar('', { nome: 'Câmeras Hikvision', palavras: ['hikvision', ' Hikvision '], fornecedores: 'Agis\n\nMazer\n' }, 'a@x');
    assert.equal(r.padrao.id, 'cameras-hikvision');
    assert.deepEqual(r.padrao.palavras, ['hikvision']);
    assert.deepEqual(r.padrao.fornecedores, ['Agis', 'Mazer']);
    assert.equal(r.padrao.alterado_por, 'a@x');
    assert.equal(p.salvar('cameras-hikvision', { nome: 'Hik', palavras: ['hik'], fornecedores: ['B'], geral: true }).padrao.id, 'cameras-hikvision');
    const salvos = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    assert.equal(salvos.filter(x => x.geral).length, 1);
    assert.equal(salvos.find(x => x.geral).id, 'cameras-hikvision');
    assert.ok(criarPadroes({ arquivo }).listar().some(x => x.nome === 'Hik'));   // relê do arquivo
    assert.equal(p.apagar('cameras-hikvision').ok, true);
    assert.equal(p.apagar('nao-existe').status, 404);
    assert.equal(p.salvar('nao-existe', { nome: 'a', palavras: ['a'], fornecedores: ['b'] }).status, 404);
});

test('nome repetido ganha id novo', () => {
    const p = criarPadroes({ arquivo: novoArquivo() });
    const a = p.salvar('', { nome: 'Intelbras', palavras: ['x'], fornecedores: ['y'] }).padrao;
    assert.equal(a.id, 'intelbras-2');
});
