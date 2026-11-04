const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { chaveMestra } = require('../lib/chave-mestra');

test('com MASTER_SECRET a chave é sempre a mesma', () => {
    const a = chaveMestra({ MASTER_SECRET: 'segredo-do-env' });
    const b = chaveMestra({ MASTER_SECRET: 'segredo-do-env' });
    assert.equal(a.chave.length, 32);
    assert.deepEqual(a.chave, b.chave);
    assert.equal(a.aleatoria, false);
});

test('sem MASTER_SECRET a chave é aleatória, nunca uma fixa do código', () => {
    const a = chaveMestra({});
    const b = chaveMestra({ MASTER_SECRET: '' });
    assert.equal(a.aleatoria, true);
    assert.equal(a.chave.length, 32);
    assert.notDeepEqual(a.chave, b.chave);
});

test('o server.js não tem mais a chave padrão escrita no código', () => {
    const fonte = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    assert.ok(!fonte.includes('chave-padrao-temporaria'));
});
