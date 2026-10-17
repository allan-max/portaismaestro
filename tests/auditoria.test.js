const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { criarAuditoria } = require('../lib/auditoria');

function montar(inicio, fuso = 'Z') {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
    let agora = new Date(inicio);
    let n = 0;
    const aud = criarAuditoria({ dir, agora: () => agora, uuid: () => `id-${++n}`, fuso });
    return { dir, aud, mudarHora: (iso) => { agora = new Date(iso); } };
}

test('registrar grava uma linha JSON no arquivo do mês', () => {
    const { dir, aud } = montar('2026-10-16T14:00:00Z');
    const reg = aud.registrar({ email: 'ana@x.com', area: 'planilha', acao: 'editar_linha', alvo: '123' });
    const linhas = fs.readFileSync(path.join(dir, 'auditoria-2026-10.jsonl'), 'utf8').trim().split('\n');
    assert.equal(linhas.length, 1);
    const gravado = JSON.parse(linhas[0]);
    assert.equal(gravado.id, 'id-1');
    assert.equal(gravado.email, 'ana@x.com');
    assert.equal(gravado.status, 'pendente');
    assert.equal(gravado.data_hora, '2026-10-16T14:00:00.000Z');
    assert.deepEqual(reg, gravado);
});

test('fechar no mês seguinte ainda fecha o registro na leitura', () => {
    const { aud, mudarHora } = montar('2026-10-31T23:59:00Z');
    const reg = aud.registrar({ email: 'a@x.com', area: 'planilha', acao: 'apagar_linha' });
    mudarHora('2026-11-01T00:01:00Z');
    aud.fechar(reg.id, { status: 'sucesso', detalhes_extra: { linha_apagada: { A: 1 } } });
    const [lido] = aud.ler('2026-10-01', '2026-10-31');
    assert.equal(lido.status, 'sucesso');
    assert.deepEqual(lido.detalhes.linha_apagada, { A: 1 });
});

test('ler ignora linha corrompida e mês sem arquivo', () => {
    const { dir, aud } = montar('2026-10-10T10:00:00Z');
    aud.registrar({ email: 'a@x.com', area: 'conta', acao: 'login', status: 'sucesso' });
    fs.appendFileSync(path.join(dir, 'auditoria-2026-10.jsonl'), '{quebrado\n');
    const lidos = aud.ler('2026-08-01', '2026-10-31');
    assert.equal(lidos.length, 1);
});

test('pendente antigo vira sem_resposta, recente continua pendente', () => {
    const { aud, mudarHora } = montar('2026-10-10T10:00:00Z');
    aud.registrar({ email: 'a@x.com', area: 'planilha', acao: 'editar_linha' });
    mudarHora('2026-10-10T10:06:00Z');
    aud.registrar({ email: 'b@x.com', area: 'planilha', acao: 'editar_linha' });
    mudarHora('2026-10-10T10:11:00Z');
    const lidos = aud.ler('2026-10-10', '2026-10-10');
    assert.equal(lidos.find(r => r.email === 'a@x.com').status, 'sem_resposta');
    assert.equal(lidos.find(r => r.email === 'b@x.com').status, 'pendente');
});

test('período inclui o último dia inteiro e ordena do mais recente', () => {
    const { aud, mudarHora } = montar('2026-10-01T00:00:00Z');
    aud.registrar({ email: 'fora@x.com', area: 'conta', acao: 'login', status: 'sucesso' });
    mudarHora('2026-10-05T08:00:00Z');
    aud.registrar({ email: 'cedo@x.com', area: 'conta', acao: 'login', status: 'sucesso' });
    mudarHora('2026-10-10T23:59:00Z');
    aud.registrar({ email: 'tarde@x.com', area: 'conta', acao: 'login', status: 'sucesso' });
    mudarHora('2026-10-11T00:00:01Z');
    aud.registrar({ email: 'depois@x.com', area: 'conta', acao: 'login', status: 'sucesso' });
    const lidos = aud.ler('2026-10-05', '2026-10-10');
    assert.deepEqual(lidos.map(r => r.email), ['tarde@x.com', 'cedo@x.com']);
});

test('dias do filtro seguem o fuso de Brasília (22h do dia 31 cai no dia 31)', () => {
    const { aud, mudarHora } = montar('2026-11-01T01:00:00Z', '-03:00');
    aud.registrar({ email: 'noite@x.com', area: 'conta', acao: 'login', status: 'sucesso' });
    mudarHora('2026-11-01T03:00:00Z');
    aud.registrar({ email: 'novembro@x.com', area: 'conta', acao: 'login', status: 'sucesso' });
    assert.deepEqual(aud.ler('2026-10-01', '2026-10-31').map(r => r.email), ['noite@x.com']);
    assert.deepEqual(aud.ler('2026-11-01', '2026-11-30').map(r => r.email), ['novembro@x.com']);
});

test('campos longos são cortados para o log não crescer sem limite', () => {
    const { aud } = montar('2026-10-10T10:00:00Z');
    const reg = aud.registrar({ email: 'a'.repeat(5000), area: 'planilha', acao: 'editar_linha', alvo: 'b'.repeat(5000),
        detalhes: { novos_dados: { CAMPO: 'c'.repeat(10000) } } });
    assert.equal(reg.email.length, 200);
    assert.equal(reg.alvo.length, 200);
    assert.ok(JSON.stringify(reg.detalhes).length <= 4100);
    assert.equal(reg.detalhes.truncado, true);
});

test('apelidos ficam no arquivo próprio e vazio remove', () => {
    const { dir, aud } = montar('2026-10-10T10:00:00Z');
    assert.deepEqual(aud.lerApelidos(), {});
    assert.deepEqual(aud.definirApelido('Ana@X.com ', '  Ana Souza  '), { antes: null, depois: 'Ana Souza' });
    assert.deepEqual(aud.lerApelidos(), { 'ana@x.com': 'Ana Souza' });
    assert.deepEqual(aud.definirApelido('ana@x.com', ''), { antes: 'Ana Souza', depois: null });
    assert.deepEqual(aud.lerApelidos(), {});
    assert.ok(fs.existsSync(path.join(dir, 'apelidos.json')));
});

test('apelido: e-mail inválido é recusado e "__proto__" não polui', () => {
    const { aud } = montar('2026-10-10T10:00:00Z');
    assert.throws(() => aud.definirApelido('sem-arroba', 'X'), /E-mail inválido/);
    assert.throws(() => aud.definirApelido('__proto__', 'X'), /E-mail inválido/);
    aud.definirApelido('b@x.com', 'B'.repeat(80));
    assert.equal(aud.lerApelidos()['b@x.com'].length, 40);
    assert.equal(({}).polluted, undefined);
});
