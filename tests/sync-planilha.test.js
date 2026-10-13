const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '../public/planilha_vale.html'), 'utf8');
const inicio = html.indexOf('        function mostrarConferencia(c)');
const fim = html.indexOf('        // ---------- AVISOS DOS ROBÔS', inicio);
const painel = () => {
    const elementos = {'conferencia-planilha': {after(el) { elementos[el.id] = el; }}};
    const contexto = vm.createContext({
        document: {getElementById: id => elementos[id], createElement: () => ({style: {}})},
        escHtml: s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    });
    vm.runInContext(html.slice(inicio, fim), contexto);
    return {contexto, elementos};
};

test('divergência em campo ou ambiguidade impede mensagem de igualdade', () => {
    for (const campo of ['campos_divergentes', 'ambiguas', 'nf_so_no_portal']) {
        const {contexto, elementos} = painel();
        contexto.mostrarConferencia({[campo]: 1, listas: {}});
        assert.doesNotMatch(elementos['conferencia-planilha'].innerHTML, /Planilha e portal batem/);
    }
});

test('relatório antigo permanece compatível', () => {
    const {contexto, elementos} = painel();
    contexto.mostrarConferencia({gerado_em: 'hoje', listas: {}, nf_so_no_portal: 0});
    assert.match(elementos['conferencia-planilha'].innerHTML, /Planilha e portal batem/);
});

test('conflitos e erros aparecem com conteúdo escapado', () => {
    const {contexto, elementos} = painel();
    contexto.mostrarSyncPlanilha({conflitos: 1, adiado: true, aviso: '<script>',
        listas: {conflitos: [{chave: '<img>', campo: 'STATUS', excel: '<svg>', portal: 'ENTREGUE'}]}});
    const texto = elementos['sync-planilha-portal'].innerHTML;
    assert.match(texto, /Conflitos/);
    assert.match(texto, /&lt;svg&gt;/);
    assert.doesNotMatch(texto, /<script>|<img>|<svg>/);
});
