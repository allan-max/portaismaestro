/* Central de E-mails: estado do filtro da Caixa (lógica pura, sem DOM).
   Filtro da tela <-> parâmetros do `listar` <-> endereço da página (#caixa?...). Serve ao navegador
   (window.EmailsFiltro) e ao node --test. O que vem do endereço é tratado como entrada hostil. */
(function (root) {
    'use strict';
    const F = typeof module !== 'undefined' && module.exports ? require('./formato.js') : root.EmailsFormato;
    const SEM_CLASSIFICACAO = '(não classificado)';
    // "Sem ruído" esconde estas
    const RUIDO = ['marketing', 'spam', 'notificação Coupa', 'código de login'];
    const ESTADOS = ['pendente', 'respondido', 'arquivado'];
    const CATEGORIAS = ['cotação', 'pedido', 'financeiro/NF', 'cadastro', 'informação', 'notificação Coupa', 'interno',
        'enviado', 'código de login', 'marketing', 'outros', 'spam', SEM_CLASSIFICACAO];
    const CORES = ['cinza', 'azul', 'verde', 'ambar', 'violeta', 'ciano', 'rosa', 'laranja'];
    const LISTAS = { categorias: [20, 40], contas: [50, 120], estados: [3, 20] };   // [itens, tamanho de cada]
    const TEXTOS = { busca: 200, remetente: 120 };
    const OPCOES = ['revisao', 'anexo', 'atrasados'];
    const DIA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    // nome no endereço -> chave do filtro
    const NO_ENDERECO = { cat: 'categorias', caixa: 'contas', status: 'estados' };
    const TEXTO_ENDERECO = { de: 'de', ate: 'ate', q: 'busca', rem: 'remetente' };

    function novo() {
        return { categorias: [], contas: [], estados: [], de: '', ate: '', busca: '', remetente: '',
            revisao: false, anexo: false, atrasados: false, sem_ruido: true };
    }
    const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
    function lista(v, [itens, max]) {
        const saida = [];
        for (const x of Array.isArray(v) ? v : []) {
            const t = texto(x, max);
            if (t && !saida.includes(t) && saida.length < itens) saida.push(t);
        }
        return saida;
    }
    // filtro completo e limpo, venha de onde vier
    function normalizar(f) {
        const o = f && typeof f === 'object' ? f : {};
        const n = novo();
        for (const k of Object.keys(LISTAS)) n[k] = lista(o[k], LISTAS[k]);
        n.estados = n.estados.filter(s => ESTADOS.includes(s));
        for (const k of Object.keys(TEXTOS)) n[k] = texto(o[k], TEXTOS[k]);
        n.de = DIA.test(o.de) ? o.de : '';
        n.ate = DIA.test(o.ate) ? o.ate : '';
        for (const k of OPCOES) n[k] = o[k] === true;
        n.sem_ruido = o.sem_ruido !== false;
        return n;
    }

    const ruidoDesligadoPeloFiltro = f => f.sem_ruido && f.categorias.some(c => RUIDO.includes(c));
    const semRuidoAtivo = f => f.sem_ruido && !ruidoDesligadoPeloFiltro(f);

    // o que vai ao `listar`: listas novas, antigos vazios (quando vêm os dois, vale o novo)
    function params(f) {
        const n = normalizar(f);
        return { categoria: '', conta: '', status: '', categorias: n.categorias, contas: n.contas, estados: n.estados,
            excluir: semRuidoAtivo(n) ? RUIDO.slice() : [], de: n.de, ate: n.ate, busca: n.busca, remetente: n.remetente,
            revisao: n.revisao, anexo: n.anexo, atrasados: n.atrasados };
    }
    // filtro salvo (objeto do `listar`) -> filtro da tela
    function deParams(p) {
        const o = p && typeof p === 'object' ? p : {};
        const um = v => (typeof v === 'string' && v ? [v] : []);
        const excluir = Array.isArray(o.excluir) ? o.excluir : [];
        return normalizar({
            categorias: Array.isArray(o.categorias) && o.categorias.length ? o.categorias : um(o.categoria),
            contas: Array.isArray(o.contas) && o.contas.length ? o.contas : um(o.conta),
            estados: Array.isArray(o.estados) && o.estados.length ? o.estados : um(o.status),
            de: o.de, ate: o.ate, busca: o.busca, remetente: o.remetente,
            revisao: o.revisao, anexo: o.anexo, atrasados: o.atrasados,
            sem_ruido: RUIDO.every(c => excluir.includes(c)),
        });
    }

    const ordenada = l => l.slice().sort();
    function mesmaLista(a, b) { return a.length === b.length && ordenada(a).every((x, i) => x === ordenada(b)[i]); }
    function igual(a, b) {
        const x = normalizar(a), y = normalizar(b);
        return Object.keys(x).every(k => (Array.isArray(x[k]) ? mesmaLista(x[k], y[k]) : x[k] === y[k]));
    }

    // filtro -> "#caixa?..." ; as caixas padrão (minhas caixas) ficam fora do endereço, e "todas" fica escrito.
    // `semRuido` é a preferência guardada: "ruido" só vai ao endereço quando o filtro é diferente dela.
    function paraHash(f, padrao, semRuido = true) {
        const n = normalizar(f), minhas = lista(padrao, LISTAS.contas), q = new URLSearchParams();
        for (const [nome, k] of Object.entries(NO_ENDERECO)) {
            if (k === 'contas' && mesmaLista(n.contas, minhas)) continue;
            for (const v of n[k]) q.append(nome, v);
        }
        if (minhas.length && !n.contas.length) q.append('todas', '1');
        for (const [nome, k] of Object.entries(TEXTO_ENDERECO)) if (n[k]) q.append(nome, n[k]);
        for (const k of OPCOES) if (n[k]) q.append(k, '1');
        if (n.sem_ruido !== (semRuido !== false)) q.append('ruido', n.sem_ruido ? '1' : '0');
        const s = q.toString();
        return '#caixa' + (s ? '?' + s : '');
    }
    function deHash(hash, padrao, semRuido = true) {
        const [nome, consulta] = String(hash || '').replace(/^#/, '').split('?');
        const n = novo();
        n.contas = lista(padrao, LISTAS.contas);
        n.sem_ruido = semRuido !== false;
        if (nome && nome !== 'caixa') return n;
        let q;
        try { q = new URLSearchParams(consulta || ''); } catch (e) { return n; }
        const bruto = {};
        for (const [nomeQ, k] of Object.entries(NO_ENDERECO)) bruto[k] = q.getAll(nomeQ);
        if (!bruto.contas.length) bruto.contas = q.get('todas') === '1' ? [] : n.contas;
        for (const [nomeQ, k] of Object.entries(TEXTO_ENDERECO)) bruto[k] = q.get(nomeQ) || '';
        for (const k of OPCOES) bruto[k] = q.get(k) === '1';
        bruto.sem_ruido = q.get('ruido') ? q.get('ruido') !== '0' : n.sem_ruido;
        return normalizar(bruto);
    }

    function alternar(f, chave, valor) {
        const n = normalizar(f);
        n[chave] = n[chave].includes(valor) ? n[chave].filter(v => v !== valor) : n[chave].concat(valor);
        return normalizar(n);
    }
    function remover(f, chave, valor) {
        const n = normalizar(f);
        if (Array.isArray(n[chave])) n[chave] = n[chave].filter(v => v !== valor);
        else if (typeof n[chave] === 'boolean') n[chave] = false;
        else if (chave in n) n[chave] = '';
        return n;
    }

    // ----- período -----
    function hojeBrasilia(data) {
        // en-CA escreve AAAA-MM-DD
        return (data || new Date()).toLocaleDateString('en-CA', { timeZone: F.FUSO });
    }
    function somarDias(dia, n) {
        const [a, m, d] = dia.split('-').map(Number);
        return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
    }
    function periodo(atalho, hoje) {
        const dias = { hoje: 0, '7d': 6, '30d': 29 }[atalho] || 0;
        return { de: somarDias(hoje, -dias), ate: hoje };
    }

    // ----- filtros prontos: dados; mantêm as caixas que estavam escolhidas -----
    const PRONTOS = [
        { id: 'cotacoes', nome: 'Cotações pendentes', filtro: () => ({ categorias: ['cotação'], estados: ['pendente'] }) },
        { id: 'atrasados', nome: 'Atrasados', filtro: () => ({ atrasados: true }) },
        { id: 'pedidos', nome: 'Pedidos pendentes', filtro: () => ({ categorias: ['pedido'], estados: ['pendente'] }) },
        { id: 'hoje', nome: 'Hoje', filtro: hoje => periodo('hoje', hoje) },
        { id: 'revisao', nome: 'Fila de revisão', filtro: () => ({ revisao: true }) },
        { id: 'anexo', nome: 'Com anexo', filtro: () => ({ anexo: true }) },
        { id: 'financeiro', nome: 'Financeiro/NF', filtro: () => ({ categorias: ['financeiro/NF'] }) },
        { id: 'coupa', nome: 'Coupa', filtro: () => ({ categorias: ['notificação Coupa'] }) },
        { id: 'spam', nome: 'Spam', filtro: () => ({ categorias: ['spam'] }) },
        { id: 'nao-classificados', nome: 'Não classificados', filtro: () => ({ categorias: [SEM_CLASSIFICACAO] }) },
        { id: 'sem-ruido', nome: 'Sem ruído', filtro: () => ({}) },
    ];
    function pronto(id, atual, hoje) {
        const p = PRONTOS.find(x => x.id === id);
        return p ? normalizar(Object.assign(novo(), p.filtro(hoje), { contas: normalizar(atual).contas })) : null;
    }
    function prontoAtivo(atual, hoje) {
        const p = PRONTOS.find(x => igual(atual, pronto(x.id, atual, hoje)));
        return p ? p.id : '';
    }

    // ----- chips dos filtros ativos -----
    const diaBr = d => d.split('-').reverse().join('/');
    function ativos(f) {
        const n = normalizar(f), saida = [];
        const chip = (chave, valor, rotulo) => saida.push({ chave, valor, rotulo });
        n.contas.forEach(c => chip('contas', c, 'Caixa: ' + F.nomeCaixa(c)));
        n.categorias.forEach(c => chip('categorias', c, 'Categoria: ' + (c === SEM_CLASSIFICACAO ? 'não classificado' : c)));
        n.estados.forEach(s => chip('estados', s, 'Status: ' + s));
        if (n.de) chip('de', '', 'Desde ' + diaBr(n.de));
        if (n.ate) chip('ate', '', 'Até ' + diaBr(n.ate));
        if (n.busca) chip('busca', '', 'Busca: ' + n.busca);
        if (n.remetente) chip('remetente', '', 'Remetente: ' + n.remetente);
        if (n.revisao) chip('revisao', '', 'Fila de revisão');
        if (n.anexo) chip('anexo', '', 'Com anexo');
        if (n.atrasados) chip('atrasados', '', 'Atrasados');
        if (semRuidoAtivo(n)) chip('sem_ruido', '', 'Sem ruído');
        if (ruidoDesligadoPeloFiltro(n)) saida.push({ chave: 'sem_ruido', valor: '', rotulo: 'Sem ruído desligado por este filtro', fixo: true });
        return saida;
    }

    // ----- realce da busca: devolve pedaços de texto; quem desenha cria <mark> com textContent -----
    // um caractere vira um caractere: sem acento e minúsculo, para os índices baterem com o texto original
    const dobrar = s => Array.from(s, c => Array.from(c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase())[0] || c).join('');
    function termos(busca) {
        // as mesmas palavras que o serviço procura (\w+, sem operador); letra solta não realça
        return (dobrar(String(busca || '')).match(/[\p{L}\p{N}_]+/gu) || []).filter(p => p.length > 1).slice(0, 12);
    }
    function realce(textoOriginal, busca) {
        const t = String(textoOriginal || '');
        if (!t) return [];
        const ps = termos(busca);
        const chars = Array.from(t), base = Array.from(dobrar(t));
        const marca = new Array(chars.length).fill(false);
        const juntoBase = base.join('');
        for (const p of ps) {
            let i = juntoBase.indexOf(p);
            while (i >= 0) {
                // índice em unidades de código -> índice em caracteres
                const ini = Array.from(juntoBase.slice(0, i)).length, tam = Array.from(p).length;
                for (let k = ini; k < ini + tam; k++) marca[k] = true;
                i = juntoBase.indexOf(p, i + p.length);
            }
        }
        const saida = [];
        chars.forEach((c, i) => {
            const ultimo = saida[saida.length - 1];
            if (ultimo && ultimo.marca === marca[i]) ultimo.texto += c;
            else saida.push({ texto: c, marca: marca[i] });
        });
        return saida;
    }

    // ----- separador de dia da lista -----
    function grupoDia(iso, agora) {
        const d = iso ? new Date(iso) : null;
        if (!d || isNaN(d)) return 'Sem data';
        const dia = hojeBrasilia(d), hoje = hojeBrasilia(agora || new Date());
        const diff = Math.round((Date.parse(hoje) - Date.parse(dia)) / 86400000);
        if (diff <= 0) return 'Hoje';
        if (diff === 1) return 'Ontem';
        const semana = (new Date(hoje + 'T12:00:00Z').getUTCDay() + 6) % 7;   // segunda = 0
        if (diff <= semana) return 'Esta semana';
        const op = { timeZone: F.FUSO, weekday: 'long', day: 'numeric', month: 'long' };
        if (dia.slice(0, 4) !== hoje.slice(0, 4)) op.year = 'numeric';
        const s = d.toLocaleDateString('pt-BR', op);
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // relógio de espera: âmbar a partir de 3 h úteis; o vermelho vem do `atrasado` do serviço (horas_alerta)
    function prazo(item) {
        const h = item && item.horas_uteis;
        if (typeof h !== 'number' || !Number.isFinite(h)) return '';
        if (item.atrasado === true) return 'atrasado';
        return h >= 3 ? 'atencao' : 'neutro';
    }

    const v2 = d => !!d && d.versao === 2;
    const ERROS_PREF = {
        SEM_USUARIO: 'Sua sessão não tem e-mail de usuário. Entre de novo no Maestro para salvar preferências.',
        SEM_PERMISSAO: 'Só administrador pode alterar os filtros da equipe.',
        LIMITE_FILTROS: 'O limite é de 20 filtros salvos. Apague um filtro para salvar outro.',
        PREFERENCIAS_GRANDES: 'As preferências passaram do tamanho permitido. Apague filtros que não usa mais.',
        ERRO_PREFERENCIAS: 'As preferências estão indisponíveis agora: vale o padrão. Tente de novo em instantes.',
    };
    const erroPreferencias = (codigo, reserva) => ERROS_PREF[codigo] || reserva || ERROS_PREF.ERRO_PREFERENCIAS;

    const api = { SEM_CLASSIFICACAO, RUIDO, ESTADOS, CATEGORIAS, CORES, PRONTOS, novo, normalizar, params, deParams, igual,
        paraHash, deHash, alternar, remover, semRuidoAtivo, ruidoDesligadoPeloFiltro, hojeBrasilia, periodo, pronto,
        prontoAtivo, ativos, termos, realce, grupoDia, prazo, v2, erroPreferencias };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EmailsFiltro = api;
})(typeof window !== 'undefined' ? window : globalThis);
