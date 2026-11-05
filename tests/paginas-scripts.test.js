const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Os <script> inline de uma página dividem o mesmo escopo global: um `const` repetido
// ou um marcador de conflito de merge derruba o script inteiro e a tela fica em "Carregando...".
const pasta = path.join(__dirname, '../public');
for (const nome of fs.readdirSync(pasta).filter(f => f.endsWith('.html') && !f.includes('backup'))) {
    test(`scripts de ${nome} compilam juntos`, () => {
        const html = fs.readFileSync(path.join(pasta, nome), 'utf8');
        assert.doesNotMatch(html, /^(<{7}|>{7}) /m, 'marcador de conflito de merge');
        const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
        assert.doesNotThrow(() => new vm.Script(scripts.join('\n;\n')));
    });
}
