const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const publico = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const S = require('../public/vendedores-cadastrados.js');

test('campos de vendedor das planilhas viram seletor (com "+"), sem campo de texto', () => {
    for (const pagina of ['planilha_vale.html', 'planilha_anmyna.html']) {
        const html = publico(pagina);
        assert.match(html, /<script src="vendedores-cadastrados\.js"><\/script>/, pagina);
        assert.match(html, /<div id="input-vendedor" class="vend-multi"/, pagina);                 // Atribuir Vendedor
        assert.match(html, /htmlSeletorVendedores\('c-vendedor', /, pagina);                       // registro de cotação
        assert.match(html, /vendedor: lerVendedores\(tr\.querySelector\('\.c-vendedor'\)\)/, pagina);
        assert.match(html, /const vendedor = lerVendedores\(document\.getElementById\('input-vendedor'\)\)/, pagina);
        assert.doesNotMatch(html, /<(input|select)[^>]*id="input-vendedor"/, pagina);
        assert.doesNotMatch(html, /criarTextareaAutoResize\('c-vendedor'/, pagina);
    }
    const anmyna = publico('planilha_anmyna.html');                                                 // edição do evento
    assert.match(anmyna, /<div id="edit-vendedor" class="vend-multi"/);
    assert.match(anmyna, /definirVendedores\(document\.getElementById\('edit-vendedor'\), item\.vendedor\)/);
    assert.match(anmyna, /'VENDEDOR ': lerVendedores\(document\.getElementById\('edit-vendedor'\)\)/);
});

// DOM mínimo: só o que lerVendedores usa
const caixa = valores => ({ querySelectorAll: () => valores.map(value => ({ value })) });

test('lerVendedores junta os escolhidos com " / ", sem vazios nem repetidos', () => {
    assert.equal(S.lerVendedores(caixa(['Gustavo Cabral Calvi'])), 'Gustavo Cabral Calvi');
    assert.equal(S.lerVendedores(caixa(['Gustavo Cabral Calvi', '', 'Libni Xavier', 'gustavo cabral calvi'])), 'Gustavo Cabral Calvi / Libni Xavier');
    assert.equal(S.lerVendedores(caixa([''])), '');
    assert.equal(S.lerVendedores(null), '');
});

test('seletor mostra o nome completo, tem "+" e mantém vendedor antigo que não está na lista', () => {
    S._definirLista([{ vendedor: 'Gustavo Cabral Calvi', nome: 'Gustavo Cabral Calvi' }, { vendedor: 'Libni <x>', nome: 'Libni <x>' }]);
    const html = S.htmlSeletorVendedores('c-vendedor', 'form-input', 'GUSTAVO / Libni <x>');
    const linhas = html.split('class="vend-multi-linha"').length - 1;
    assert.equal(linhas, 2, 'uma linha por vendedor da cotação dividida');
    assert.match(html, /data-vend-acao="mais"[^>]*>\+<\/button>/);
    assert.match(html, /data-vend-acao="tirar"/);
    assert.match(html, /<option value="GUSTAVO" selected>GUSTAVO \(não cadastrado\)<\/option>/);
    assert.match(html, /<option value="Libni &lt;x&gt;" selected>Libni &lt;x&gt;<\/option>/);
    assert.doesNotMatch(html, /<x>/);
    const vazio = S.htmlSeletorVendedores('', 'form-input', '');
    assert.equal(vazio.split('class="vend-multi-linha"').length - 1, 1);
    assert.match(vazio, /<option value="">Selecione o vendedor<\/option>/);
});

test('servidor só repassa a lista de vendedores para quem pode alterar planilhas', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
    const bloco = src.slice(src.indexOf("socket.on('pedir_vendedores_cadastrados'"), src.indexOf("socket.on('retorno_registro_vendedor_cotacao'"));
    assert.match(bloco, /!user\.admin && !user\.planilha_access/);
    assert.match(bloco, /if \(!doRobo\(\) \|\| !dados\.clientId\) return;/);
});
