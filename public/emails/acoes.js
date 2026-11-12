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
        phishing_removido: () => 'Categoria phishing removida: passou a spam',
        apagar_comentario: () => 'Comentário apagado',
    };
    // linha do tempo: recebimento e classificação vêm de campos do e-mail; o resto é a auditoria, mais antiga primeiro
    function historico(e) {
        const linhas = [{ em: e.data, texto: 'Recebido', quem: '' }];
        if (e.classificado_em) {
            const cat = e.categoria_original || e.categoria;
            linhas.push({ em: e.classificado_em, texto: cat ? 'Classificado como ' + F.categoria(cat).nome : 'Classificado', quem: 'IA' });
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

    // aviso do navegador: só a contagem, nunca assunto nem remetente; '' quando não há o que avisar
    const qtd = n => (Number.isSafeInteger(n) && n > 0 ? n : 0);
    function textoAviso(cotacoes, pedidos) {
        const c = qtd(cotacoes), p = qtd(pedidos);
        const tc = c === 1 ? '1 cotação' : c + ' cotações', tp = p === 1 ? '1 pedido' : p + ' pedidos';
        if (c && p) return tc + ' e ' + tp + ' novos';
        if (c) return tc + (c === 1 ? ' nova' : ' novas');
        if (p) return tp + (p === 1 ? ' novo' : ' novos');
        return '';
    }

    // planilha exportada: as colunas da seção 8, tudo como texto (o exceljs nunca vê fórmula) e sem o corpo do e-mail
    const MAX_EXPORTAR = 2000;
    const COLUNAS_PLANILHA = ['Data', 'Remetente', 'Nome', 'Assunto', 'Categoria', 'Status', 'Caixas', 'Urgência', 'Horas úteis de espera', 'Resumo'];
    const texto = v => (typeof v === 'string' ? v : '');
    function linhaPlanilha(e) {
        return [e.data ? F.dataHora(e.data) : '', texto(e.remetente), texto(e.remetente_nome), texto(e.assunto), F.categoria(e.categoria).nome,
            texto(e.status), (Array.isArray(e.caixas) ? e.caixas : []).map(F.nomeCaixa).join(', '), texto(e.urgencia),
            typeof e.horas_uteis === 'number' && Number.isFinite(e.horas_uteis) ? F.decimal(e.horas_uteis) : '', texto(e.resumo)];
    }

    // ----- quem abriu e comentários (seções 5 e 6) -----
    // "10:42" no mesmo dia de Brasília; "09/11 23:00" em outro dia
    function horaCurta(iso, agora) {
        const d = data(iso);
        if (!d) return '';
        const dia = x => x.toLocaleDateString('pt-BR', { timeZone: F.FUSO, day: '2-digit', month: '2-digit' });
        const h = d.toLocaleTimeString('pt-BR', { timeZone: F.FUSO, hour: '2-digit', minute: '2-digit' });
        return dia(d) === dia(agora || new Date()) ? h : dia(d) + ' ' + h;
    }
    // o portal põe `nome` (do cadastro); sem ele, o login
    const autor = x => texto(x && x.nome) || texto(x && x.usuario);
    function vistoPor(vistos, agora) {
        const nomes = (Array.isArray(vistos) ? vistos : []).filter(v => v && autor(v)).map(v => autor(v) + ' (' + horaCurta(v.em, agora) + ')');
        return nomes.length ? 'Visto por: ' + nomes.join(', ') + '.' : '';
    }
    const comentarioApagado = (c, agora) => 'Comentário apagado por ' + autor(c) + ', ' + horaCurta(c.apagado_em, agora);
    const COLUNAS_ABERTURAS = ['Quando', 'Nome', 'Usuário', 'Assunto', 'Remetente'];
    const linhaAbertura = a => [a.em ? F.dataHora(a.em) : '', autor(a), texto(a.usuario), texto(a.assunto), texto(a.remetente)];

    const api = { MAX_LOTE, MAX_EXPORTAR, COLUNAS_PLANILHA, COLUNAS_ABERTURAS, iniciais, relativa, porExtenso, intervalo, partes, largura,
        historico, desfeito, percentual, textoAviso, linhaPlanilha, linhaAbertura, horaCurta, autor, vistoPor, comentarioApagado };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EmailsAcoes = api;
})(typeof window !== 'undefined' ? window : globalThis);
