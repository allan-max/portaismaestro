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

test('coupa.html mostra aviso quando o robô recusa o comando (ex.: modo resposta)', () => {
    // gerenciador manda tarefa_concluida { evento: 'Comando extrair_pedidos', sucesso: false, erro } e o servidor volta a tela para ocioso
    assert.match(html, /String\(dados\.evento \|\| ''\)\.startsWith\('Comando '\) && !dados\.sucesso\) \{\s*mostrarModal\('Comando recusado', dados\.erro/);
});
