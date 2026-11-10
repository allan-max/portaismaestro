/* Central de E-mails: lógica pura do detalhe e das ações (sem DOM). Serve ao navegador (window.EmailsAcoes)
   e ao node --test: iniciais do avatar, datas por extenso e relativa, intervalo da seleção, lote em partes,
   largura do detalhe, linha do tempo do histórico e a frase do desfazer. */
(function (root) {
    'use strict';
    const F = typeof module !== 'undefined' && module.exports ? require('./formato.js') : root.EmailsFormato;
    const MAX_LOTE = 100;
    const MIN_DETALHE = 420, MIN_LISTA = 380, FRACAO_DETALHE = 0.6;

    const data = iso => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d : null; };
    const palavras = t => (typeof t === 'string' ? t.match(/[\p{L}\p{N}]+/gu) || [] : []);

    // primeira letra da primeira e da última palavra do nome (ou do endereço antes do @)
    function iniciais(nome, email) {
        let p = palavras(nome);
        if (!p.length) p = palavras(typeof email === 'string' ? email.split('@')[0] : '');
        if (!p.length) return '?';
        const letras = p.length > 1 ? p[0][0] + p[p.length - 1][0] : p[0][0];
        return letras.toLocaleUpperCase('pt-BR');
    }

    function relativa(iso, agora) {
        const d = data(iso);
        if (!d) return '';
        const s = ((agora || new Date()) - d) / 1000;
        if (s < -60 || s >= 7 * 86400) return '';
        if (s < 60) return 'agora há pouco';
        if (s < 3600) return 'há ' + Math.floor(s / 60) + ' min';
        if (s < 86400) return 'há ' + Math.floor(s / 3600) + ' h';
        const dias = Math.floor(s / 86400);
        return dias === 1 ? 'há 1 dia' : 'há ' + dias + ' dias';
    }
    function porExtenso(iso) {
        const d = data(iso);
        return d ? d.toLocaleString('pt-BR', { timeZone: F.FUSO, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
            hour: '2-digit', minute: '2-digit' }) : '';
    }

    // ids de `lista` entre a âncora (último marcado) e o clicado, inclusive
    function intervalo(lista, ancora, alvo) {
        const a = lista.indexOf(ancora), b = lista.indexOf(alvo);
        if (a < 0 || b < 0) return [alvo];
        return lista.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    function partes(lista, n) {
        const tam = n || MAX_LOTE, saida = [];
        for (let i = 0; i < lista.length; i += tam) saida.push(lista.slice(i, i + tam));
        return saida;
    }
    // largura do detalhe: entre 420 px e 60 % da Caixa, sem a lista ficar com menos de 380 px.
    // `ocupado` é o que não é lista nem detalhe (painel de filtros e espaços entre colunas).
    function largura(px, total, ocupado) {
        if (!Number.isFinite(px)) return null;
        const max = Math.max(MIN_DETALHE, Math.min(total * FRACAO_DETALHE, total - ocupado - MIN_LISTA));
        return Math.round(Math.min(max, Math.max(MIN_DETALHE, px)));
    }

    const valor = v => (v === null || v === undefined || v === '' ? '—' : String(v));
    const FRASES = {
        status: h => 'Status: ' + valor(h.antes) + ' para ' + valor(h.depois),
        categoria: h => 'Categoria: ' + valor(h.antes) + ' para ' + valor(h.depois),
        desfazer: h => 'Desfeito: ' + valor(h.antes) + ' voltou a ' + valor(h.depois),
    };
    // linha do tempo: recebimento e classificação vêm de campos do e-mail; o resto é a auditoria, mais antiga primeiro
    function historico(e) {
        const linhas = [{ em: e.data, texto: 'Recebido', quem: '' }];
        if (e.classificado_em) {
            const cat = e.categoria_original || e.categoria;
            linhas.push({ em: e.classificado_em, texto: cat ? 'Classificado como ' + cat : 'Classificado', quem: 'IA' });
        }
        for (const h of Array.isArray(e.historico) ? e.historico : []) {
            if (!h || typeof h !== 'object') continue;
            const frase = Object.prototype.hasOwnProperty.call(FRASES, h.acao) ? FRASES[h.acao](h)
                : valor(h.acao) + ': ' + valor(h.antes) + ' para ' + valor(h.depois);
            linhas.push({ em: h.em, texto: frase, quem: typeof h.usuario === 'string' ? h.usuario : '' });
        }
        return linhas;
    }

    const MOTIVO = 'o e-mail mudou depois ou o prazo passou.';
    function desfeito(feitos, recusados) {
        if (!recusados) return feitos === 1 ? 'Alteração desfeita.' : feitos + ' alterações desfeitas.';
        if (!feitos) return recusados === 1 ? 'Nada foi desfeito: ' + MOTIVO
            : 'Nada foi desfeito: ' + recusados + ' não puderam ser desfeitas. O ' + MOTIVO.slice(2);
        return feitos + ' desfeitas. ' + (recusados === 1 ? '1 não pôde ser desfeita: ' : recusados + ' não puderam ser desfeitas: ') + MOTIVO;
    }
    const percentual = c => (typeof c === 'number' && Number.isFinite(c) ? Math.round(100 * Math.min(1, Math.max(0, c))) : null);

    const api = { MAX_LOTE, iniciais, relativa, porExtenso, intervalo, partes, largura, historico, desfeito, percentual };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EmailsAcoes = api;
})(typeof window !== 'undefined' ? window : globalThis);
