const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const F = require('../public/emails/formato.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const PASTA = path.join(PUBLIC, 'emails');
const ler = nome => fs.readFileSync(path.join(PASTA, nome), 'utf8');
const arquivos = fs.readdirSync(PASTA);
const pagina = fs.readFileSync(path.join(PUBLIC, 'emails.html'), 'utf8');

test('rota: visão pelo endereço, com Caixa como padrão', () => {
    assert.deepEqual(F.rota(''), { visao: 'caixa', revisao: false, ver: '' });
    assert.deepEqual(F.rota('#caixa'), { visao: 'caixa', revisao: false, ver: '' });
    assert.deepEqual(F.rota('#dashboard'), { visao: 'dashboard', revisao: false, ver: '' });
    assert.deepEqual(F.rota('#saude'), { visao: 'saude', revisao: false, ver: '' });
    assert.deepEqual(F.rota('#filtros'), { visao: 'filtros', revisao: false, ver: '' });
    assert.deepEqual(F.rota('#qualquer'), { visao: 'caixa', revisao: false, ver: '' });
    assert.deepEqual(F.rota('#__proto__'), { visao: 'caixa', revisao: false, ver: '' });
});

test('rota: fila de revisão só na Caixa e atrasados só no Dashboard', () => {
    assert.deepEqual(F.rota('#caixa?revisao=1'), { visao: 'caixa', revisao: true, ver: '' });
    assert.deepEqual(F.rota('#dashboard?ver=atrasados'), { visao: 'dashboard', revisao: false, ver: 'atrasados' });
    assert.equal(F.rota('#dashboard?revisao=1').revisao, false);
    assert.equal(F.rota('#caixa?ver=atrasados').ver, '');
    assert.equal(F.rota('#dashboard?ver=outra').ver, '');
});

test('categoria: as 13 do serviço têm classe e ícone próprios', () => {
    const nomes = ['cotação', 'pedido', 'financeiro/NF', 'cadastro', 'informação', 'notificação Coupa', 'interno',
        'enviado', 'código de login', 'marketing', 'outros', 'spam', 'phishing'];
    const ids = new Set();
    for (const nome of nomes) {
        const c = F.categoria(nome);
        assert.equal(c.nome, nome);
        assert.equal(c.classe, 'em-cat-' + c.id);
        assert.equal(c.icone, 'cat-' + c.id);
        assert.match(c.id, /^[a-z]+$/);
        ids.add(c.id);
    }
    assert.equal(ids.size, 13);
});

test('categoria: vazia, desconhecida ou nome de propriedade vira "não classificado"', () => {
    for (const nome of [null, undefined, '', 'outra', '__proto__', 'constructor', 'toString', '(não classificado)']) {
        assert.deepEqual(F.categoria(nome), { id: 'indefinida', nome: 'não classificado', classe: 'em-cat-indefinida', icone: 'cat-indefinida' });
    }
});

test('categorias de correção manual são as 9 do serviço', () => {
    assert.deepEqual(F.CORRIGIVEIS, ['cotação', 'pedido', 'financeiro/NF', 'cadastro', 'informação', 'marketing', 'spam', 'phishing', 'outros']);
    for (const c of F.CORRIGIVEIS) assert.notEqual(F.categoria(c).id, 'indefinida');
});

test('todo ícone que o código pede existe em icones.svg', () => {
    const svg = ler('icones.svg');
    const simbolos = new Set([...svg.matchAll(/<symbol id="([a-z-]+)"/g)].map(m => m[1]));
    const pedidos = new Set([...pagina.matchAll(/icones\.svg#([a-z-]+)/g)].map(m => m[1]));
    for (const nome of arquivos.filter(a => a.endsWith('.js'))) {
        for (const m of ler(nome).matchAll(/icone\('([a-z-]+)'/g)) pedidos.add(m[1]);
    }
    for (const n of ['cotacao', 'pedido', 'financeiro', 'cadastro', 'informacao', 'coupa', 'interno', 'enviado', 'login',
        'marketing', 'outros', 'spam', 'phishing', 'indefinida']) pedidos.add('cat-' + n);
    assert.ok(pedidos.size > 20);
    for (const p of pedidos) assert.ok(simbolos.has(p), 'falta o símbolo ' + p);
});

test('formatos: data no fuso de Brasília, tamanho, caixa e horas', () => {
    assert.match(F.dataHora('2026-11-09T15:30:00Z'), /^09\/11\/2026,? 12:30$/);   // a vírgula depende da versão do ICU
    assert.equal(F.dataHora(''), '—');
    assert.equal(F.dataHora('não é data'), '—');
    assert.equal(F.tamanho(2048), '2 KB');
    assert.equal(F.tamanho(100), '1 KB');
    assert.equal(F.tamanho(3 * 1048576), '3,0 MB');
    assert.equal(F.tamanho(undefined), '');
    assert.equal(F.nomeCaixa('vendas@empresa.test'), 'vendas');
    assert.equal(F.nomeCaixa(null), '');
    assert.equal(F.decimal(4.5), '4,5');
});

test('página: CSP idêntica à de antes, sem script nem estilo inline', () => {
    const csp = "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
    assert.ok(pagina.includes(`<meta http-equiv="Content-Security-Policy" content="${csp}" />`));
    assert.doesNotMatch(pagina, /<script>|<script(?![^>]*\bsrc=)[^>]*>/);
    assert.doesNotMatch(pagina, /\sstyle=|<style/);
    assert.doesNotMatch(pagina, /\son[a-z]+=/i);
    assert.doesNotMatch(pagina, /dashboard-cotacoes\/style\.css/);
    assert.match(pagina, /<iframe id="em-html"[^>]* sandbox=""/);
});

test('tela: nada de HTML montado por texto nem eval', () => {
    for (const nome of arquivos.filter(a => a.endsWith('.js'))) {
        assert.doesNotMatch(ler(nome), /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\('style'/, nome);
    }
});

test('tela: nenhum emoji e nenhuma cor fora de tokens.css', () => {
    const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
    const cor = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;
    for (const nome of arquivos.filter(a => /\.(js|css|svg)$/.test(a))) {
        const texto = ler(nome);
        assert.doesNotMatch(texto, emoji, nome);
        if (nome !== 'tokens.css') {
            // tira as referências a símbolos (icones.svg#id) antes de procurar cor em hexadecimal
            assert.doesNotMatch(texto.replace(/icones\.svg#[a-z-]+/g, ''), cor, nome);
        }
    }
    assert.doesNotMatch(pagina, emoji);
});
