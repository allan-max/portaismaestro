/* Central de E-mails: lógica pura da tela (sem DOM). Serve ao navegador (window.EmailsFormato) e ao node --test. */
(function (root) {
    'use strict';
    const FUSO = 'America/Sao_Paulo';
    // nome que o serviço grava -> id usado na classe (em-cat-<id>) e no ícone (cat-<id>)
    const CATEGORIAS = new Map([
        ['cotação', 'cotacao'], ['pedido', 'pedido'], ['financeiro/NF', 'financeiro'], ['cadastro', 'cadastro'],
        ['informação', 'informacao'], ['notificação Coupa', 'coupa'], ['interno', 'interno'], ['enviado', 'enviado'],
        ['código de login', 'login'], ['marketing', 'marketing'], ['outros', 'outros'], ['spam', 'spam'],
    ]);
    // as que o serviço aceita em correção manual (classificador.CATEGORIAS)
    const CORRIGIVEIS = ['cotação', 'pedido', 'financeiro/NF', 'cadastro', 'informação', 'marketing', 'spam', 'outros'];
    const VISOES = ['caixa', 'dashboard', 'saude', 'filtros', 'aberturas'];

    function categoria(nome) {
        if (nome === 'phishing') nome = 'spam';   // serviço antigo: phishing deixou de ser categoria e aparece como spam
        const id = typeof nome === 'string' ? CATEGORIAS.get(nome) : undefined;
        if (!id) return { id: 'indefinida', nome: 'não classificado', classe: 'em-cat-indefinida', icone: 'cat-indefinida' };
        return { id, nome, classe: 'em-cat-' + id, icone: 'cat-' + id };
    }

    // "#visao?chave=valor" -> { visao, revisao, ver }
    function rota(hash) {
        const [nome, consulta] = String(hash || '').replace(/^#/, '').split('?');
        const visao = VISOES.includes(nome) ? nome : 'caixa';
        const p = new URLSearchParams(consulta || '');
        return {
            visao,
            revisao: visao === 'caixa' && p.get('revisao') === '1',
            ver: visao === 'dashboard' && p.get('ver') === 'atrasados' ? 'atrasados' : '',
        };
    }

    function dataHora(iso) {
        const d = iso ? new Date(iso) : null;
        return d && !isNaN(d) ? d.toLocaleString('pt-BR', { timeZone: FUSO, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
    }
    function tamanho(n) {
        if (!Number.isFinite(n)) return '';
        return n > 1048576 ? (n / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
    }
    const nomeCaixa = conta => (conta == null ? '' : String(conta).split('@')[0]);
    const decimal = n => String(n).replace('.', ',');

    const api = { FUSO, CORRIGIVEIS, categoria, rota, dataHora, tamanho, nomeCaixa, decimal };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EmailsFormato = api;
})(typeof window !== 'undefined' ? window : globalThis);
