/* Cotabot: reconhece a categoria/marca do item pelas palavras-chave dos padrões e monta onde cotar.
   Sem DOM: roda no navegador (window.CotabotReconhecer) e nos testes do Node (require). */
(function (raiz) {
    'use strict';

    // "Ar-Condicionado 12.000 BTUs" -> "ar condicionado 12 000 btus"
    const normalizar = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

    // Palavra inteira (ou frase inteira): "tv" acha "Smart TV 50" mas não "TVBOX"
    function contem(descricao, palavra) {
        const p = normalizar(palavra);
        return !!p && (' ' + normalizar(descricao) + ' ').includes(' ' + p + ' ');
    }

    // Padrões reconhecidos na descrição: [{ padrao, palavra }] na ordem dos padrões.
    function reconhecer(descricao, padroes) {
        const achados = [];
        for (const p of padroes || []) {
            if (p.geral) continue;
            const palavra = (p.palavras || []).find(w => contem(descricao, w));
            if (palavra) achados.push({ padrao: p, palavra });
        }
        return achados;
    }

    const padraoGeral = padroes => (padroes || []).find(p => p.geral) || null;

    // grupos: [{ padrao, marcados: [nomes] }]; google: bool; extras: [textos]
    // -> { sites, regras } do item (sem repetição; regra só de padrão com algum fornecedor marcado)
    function montarLugares(grupos, google, extras) {
        const sites = [];
        const vistos = new Set();
        const por = t => {
            const v = String(t || '').trim();
            const k = v.toLowerCase();
            if (v && !vistos.has(k)) { vistos.add(k); sites.push(v); }
        };
        const regras = [];
        for (const g of grupos || []) {
            (g.marcados || []).forEach(por);
            const regra = String((g.padrao && g.padrao.regra) || '').trim();
            if (g.marcados && g.marcados.length && regra && !regras.includes(regra)) regras.push(regra);
        }
        (extras || []).forEach(por);
        if (google) por('google');
        return { sites, regras };
    }

    const api = { normalizar, contem, reconhecer, padraoGeral, montarLugares };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else raiz.CotabotReconhecer = api;
})(typeof window !== 'undefined' ? window : globalThis);
