const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Botão "Pedidos Novos": o robô do Coupa varre os pedidos do portal e manda por e-mail os que faltam na planilha
const html = fs.readFileSync(path.join(__dirname, '../public/coupa.html'), 'utf8');

test('coupa.html tem o botão Pedidos Novos que manda extrair_pedidos', () => {
    assert.match(html, /<button id="btn-pedidos"[^>]*onclick="executarTarefa\('extrair_pedidos'\)"/);
    assert.match(html, /modo === 'extrair_pedidos'/);
});

test('coupa.html acompanha o estado extraindo_pedidos e a conclusão Listagem de Pedidos', () => {
    assert.match(html, /estado\.status === 'extraindo_pedidos'/);
    assert.match(html, /dados\.evento === 'Listagem de Pedidos'/);
});
