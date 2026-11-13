const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Conta do setor financeiro com acesso a Portais (ou admin) cai no financeiro.html após o login e precisa de um caminho de volta ao portal
const html = fs.readFileSync(path.join(__dirname, '../public/financeiro.html'), 'utf8');

test('financeiro.html tem link escondido para index.html?portais=1', () => {
    assert.match(html, /<a id="link-portais"[^>]*href="index\.html\?portais=1"[^>]*hidden/);
});

test('financeiro.html mostra o link para admin ou quem tem Portais/Estatísticas', () => {
    assert.match(html, /maestro_admin'\) === 'true' \|\| localStorage\.getItem\('maestro_portais'\) === 'true' \|\| localStorage\.getItem\('maestro_dashboard'\) === 'true'/);
    assert.match(html, /getElementById\('link-portais'\)\.hidden = !temAcessoPortais/);
});
