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

test('categoria: as 12 do serviço têm classe e ícone próprios', () => {
    const nomes = ['cotação', 'pedido', 'financeiro/NF', 'cadastro', 'informação', 'notificação Coupa', 'interno',
        'enviado', 'código de login', 'marketing', 'outros', 'spam'];
    const ids = new Set();
    for (const nome of nomes) {
        const c = F.categoria(nome);
        assert.equal(c.nome, nome);
        assert.equal(c.classe, 'em-cat-' + c.id);
        assert.equal(c.icone, 'cat-' + c.id);
        assert.match(c.id, /^[a-z]+$/);
        ids.add(c.id);
    }
    assert.equal(ids.size, 12);
});

test('categoria: phishing vindo do serviço antigo aparece como spam, sem cor nem ícone próprios', () => {
    assert.deepEqual(F.categoria('phishing'), F.categoria('spam'));
    assert.ok(!/phishing/.test(ler('tokens.css') + ler('componentes.css') + ler('icones.svg')));
});

test('categoria: vazia, desconhecida ou nome de propriedade vira "não classificado"', () => {
    for (const nome of [null, undefined, '', 'outra', '__proto__', 'constructor', 'toString', '(não classificado)']) {
        assert.deepEqual(F.categoria(nome), { id: 'indefinida', nome: 'não classificado', classe: 'em-cat-indefinida', icone: 'cat-indefinida' });
    }
});

test('categorias de correção manual são as 8 do serviço', () => {
    assert.deepEqual(F.CORRIGIVEIS, ['cotação', 'pedido', 'financeiro/NF', 'cadastro', 'informação', 'marketing', 'spam', 'outros']);
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
        'marketing', 'outros', 'spam', 'indefinida']) pedidos.add('cat-' + n);
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

test('animação: só transform e opacity, tempos de tokens.css, e tudo desligado com movimento reduzido', () => {
    const css = arquivos.filter(a => a.endsWith('.css')).map(ler).join('\n');
    const quadros = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g)];
    assert.ok(quadros.length >= 4);
    for (const [, corpo] of quadros) {
        for (const [, prop] of corpo.matchAll(/([a-z-]+)\s*:/g)) assert.ok(['transform', 'opacity'].includes(prop), 'keyframes mexe em ' + prop);
    }
    for (const [, valor] of css.matchAll(/(?:^|[;{\s])transition\s*:\s*([^;}]+)/g)) {
        if (/^none\b/.test(valor.trim())) continue;
        for (const parte of valor.split(/,(?![^(]*\))/)) {
            const prop = parte.trim().split(/\s+/)[0];
            assert.ok(['transform', 'opacity', 'background-color'].includes(prop), 'transição de ' + prop);
            assert.match(parte, /var\(--em-(rapido|medio|lento)\)/, 'duração fora de tokens.css: ' + parte);
        }
    }
    for (const [, valor] of css.matchAll(/(?:^|[;{\s])animation\s*:\s*([^;}]+)/g)) {
        if (/^none\b/.test(valor.trim())) continue;
        assert.match(valor, /var\(--em-[a-z-]+\)/, 'duração fora de tokens.css: ' + valor);
        assert.doesNotMatch(valor, /\d(ms|s)\b/, 'duração escrita à mão: ' + valor);
    }
    assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \*, \*::before, \*::after \{ transition: none !important; animation: none !important; \} \}/);
    // a contagem dos números é JS: também respeita o movimento reduzido
    assert.match(ler('tela.js'), /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
});

test('exportar: exceljs só no clique, nunca carregado pela página', () => {
    assert.doesNotMatch(pagina, /exceljs/);
    assert.match(ler('exportar.js'), /'\/vendor\/exceljs-4\.4\.0\.min\.js'/);
});

// Arquivos da tela: os que emails.html referencia (abrir a Caixa) e os que tela.js carrega sob demanda (PARTES).
// Mede como o repositório guarda (LF): no Windows o git baixa texto em CRLF, e o mesmo arquivo pesaria mais.
const peso = c => c.endsWith('.webp') ? fs.statSync(c).size
    : Buffer.byteLength(fs.readFileSync(c, 'utf8').replace(/\r\n/g, '\n'));
const naPagina = [...new Set([...pagina.matchAll(/(?:href|src)="((?:emails|img)\/[^"#?]+)/g)].map(m => m[1]))];
function lerPartes() {
    const m = ler('tela.js').match(/const PARTES = (\{[^}]*\});/);
    assert.ok(m, 'tela.js sem PARTES');
    return JSON.parse(m[1].replace(/'/g, '"').replace(/(\w+):/g, '"$1":'));
}

test('partes sob demanda: existem, não estão na página e nenhum arquivo da pasta fica de fora', () => {
    const partes = lerPartes();
    const sobDemanda = [...new Set(Object.values(partes).flat())].map(n => 'emails/' + n + '.js');
    assert.ok(naPagina.includes('emails/tela.js') && naPagina.includes('emails/icones.svg') && naPagina.includes('img/logo-maestro-emails.webp'));
    for (const a of sobDemanda) {
        assert.ok(fs.existsSync(path.join(PUBLIC, a)), 'falta ' + a);
        assert.ok(!naPagina.includes(a), a + ' não pode carregar com a página');
    }
    for (const a of arquivos) assert.ok(naPagina.includes('emails/' + a) || sobDemanda.includes('emails/' + a), a + ' não é carregado por ninguém');
    // a ordem importa: graficos.js antes de quem usa G, saude.js (tabelas) antes do Dashboard
    assert.deepEqual(partes.dashboard, ['graficos', 'saude', 'dashboard']);
    assert.deepEqual(partes.saude, ['graficos', 'saude']);
    // Aberturas usa as tabelas de saude.js e a planilha de exportar.js; comentários são uma parte só, fora da Caixa
    assert.deepEqual(partes.aberturas, ['saude', 'exportar', 'aberturas']);
    assert.deepEqual(partes.comentarios, ['comentarios']);
    assert.deepEqual(partes.padroes, ['padroes']);   // Padrões: só administrador, fora da Caixa
});

test('peso: abrir a Caixa até 250 KB e a tela inteira até 330 KB, sem compressão (seção 11; teto da etapa B, decisão 51)', () => {
    const inicial = peso(path.join(PUBLIC, 'emails.html')) + naPagina.reduce((t, a) => t + peso(path.join(PUBLIC, a)), 0);
    const total = peso(path.join(PUBLIC, 'emails.html')) + peso(path.join(PUBLIC, 'img', 'logo-maestro-emails.webp')) +
        arquivos.reduce((t, a) => t + peso(path.join(PASTA, a)), 0);
    assert.ok(inicial <= 250000, 'abrir a Caixa: ' + inicial + ' bytes');
    assert.ok(total <= 330000, 'tela inteira: ' + total + ' bytes');
});
