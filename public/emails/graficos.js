/* Central de E-mails: lógica pura dos gráficos do Dashboard (sem DOM). Serve ao navegador (window.EmailsGraficos)
   e ao node --test. Escalas, marcas de eixo, empilhamento, intensidade do mapa de calor, números e variações. */
(function (root) {
    'use strict';
    const DIAS = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
    const CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];   // na ordem de getUTCDay
    const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
    const inteiro = v => Number.isSafeInteger(v) && v > 0;

    // marcas do eixo: de zero até cobrir o máximo, com passo 1, 2 ou 5 vezes 10^n (contagens: passo mínimo 1)
    function marcas(max, alvo) {
        if (!(max > 0)) return [0, 1];
        const bruto = max / (alvo || 4);
        const ordem = Math.pow(10, Math.floor(Math.log10(bruto)));
        const passo = Math.max(1, Math.round([1, 2, 5, 10].find(m => m * ordem >= bruto) * ordem));
        const saida = [];
        for (let v = 0; v < max + passo; v += passo) saida.push(v);
        return saida;
    }
    function escala(valor, topo, tamanho) {
        if (!(topo > 0) || !(valor > 0)) return 0;
        return Math.min(tamanho, valor / topo * tamanho);
    }

    // séries do volume por dia: as `limite` categorias com mais e-mails no período e o resto junto em "demais"
    function seriesVolume(volume, limite) {
        const total = new Map();
        for (const d of Array.isArray(volume) ? volume : []) {
            for (const [cat, n] of Object.entries((d && d.por_categoria) || {})) if (inteiro(n)) total.set(cat, (total.get(cat) || 0) + n);
        }
        const ordem = [...total.keys()].sort((a, b) => total.get(b) - total.get(a) || (a < b ? -1 : 1));
        if (ordem.length <= limite) return ordem.map(c => ({ chave: c, categorias: [c] }));
        return ordem.slice(0, limite).map(c => ({ chave: c, categorias: [c] }))
            .concat({ chave: 'demais', categorias: ordem.slice(limite).sort() });
    }
    // uma pilha por dia, de baixo para cima na ordem das séries; série escondida ou zerada não entra
    function empilhar(volume, series, ocultas) {
        return (Array.isArray(volume) ? volume : []).map(d => {
            const pc = (d && d.por_categoria) || {};
            const partes = [];
            let y = 0;
            for (const s of series) {
                if (ocultas.has(s.chave)) continue;
                const valor = s.categorias.reduce((t, c) => t + (inteiro(pc[c]) ? pc[c] : 0), 0);
                if (!valor) continue;
                partes.push({ chave: s.chave, valor, y0: y, y1: y + valor });
                y += valor;
            }
            return { dia: d && d.dia, total: y, partes };
        });
    }

    // mapa de calor: nível 1 a `niveis` pela proporção do maior valor; zero só quando não chegou nada
    function nivelCalor(v, max, niveis) {
        const n = niveis || 5;
        if (!(v > 0) || !(max > 0)) return 0;
        return Math.min(n, Math.max(1, Math.ceil(v / max * n)));
    }
    const maximoMapa = mapa => Math.max(0, ...(Array.isArray(mapa) ? mapa : []).flat().filter(Number.isFinite));

    function numero(n, casas) {
        if (typeof n !== 'number' || !Number.isFinite(n)) return '—';
        return n.toLocaleString('pt-BR', { minimumFractionDigits: casas || 0, maximumFractionDigits: casas || 0 });
    }
    const dolar = n => (typeof n === 'number' && Number.isFinite(n) ? 'US$ ' + numero(n, 2) : '—');

    // variação contra o período anterior: '%' (relativa), 'pp' (pontos percentuais) ou 'h' (horas)
    function variacao(atual, anterior, unidade) {
        if (typeof atual !== 'number' || typeof anterior !== 'number') return null;
        let d, texto;
        if (unidade === 'pp' || unidade === 'h') {
            d = Math.round((atual - anterior) * 10) / 10;
            texto = numero(Math.abs(d), 1) + (unidade === 'pp' ? ' p.p.' : ' h');
        } else {
            if (anterior === 0) return atual === 0 ? { texto: '0%', sentido: 'igual' } : { texto: 'sem base anterior', sentido: 'igual' };
            d = Math.round((atual - anterior) / anterior * 100);
            texto = numero(Math.abs(d)) + '%';
        }
        return { texto: (d > 0 ? '+' : d < 0 ? '-' : '') + texto, sentido: d > 0 ? 'sobe' : d < 0 ? 'desce' : 'igual' };
    }
    // a cor da variação diz se é bom ou ruim; quando nenhum lado é melhor (volume), fica neutra
    function tom(sentido, maiorMelhor) {
        if (sentido === 'igual' || typeof maiorMelhor !== 'boolean') return 'neutro';
        return (sentido === 'sobe') === maiorMelhor ? 'bom' : 'ruim';
    }
    // regra de "dados insuficientes": o serviço diz `suficiente` e o número precisa existir
    const suficiente = (o, chave) => !!o && o.suficiente === true && typeof o[chave || 'atual'] === 'number';

    // mini-gráfico: caminho SVG; o dia sem dado (null) interrompe a linha; menos de dois pontos não desenha
    function linhaMini(serie, largura, altura) {
        const s = Array.isArray(serie) ? serie : [];
        const nums = s.filter(v => typeof v === 'number' && Number.isFinite(v));
        if (nums.length < 2) return '';
        const min = Math.min(...nums), max = Math.max(...nums);
        const r = v => String(Math.round(v * 10) / 10);
        let d = '';
        s.forEach((v, i) => {
            if (typeof v !== 'number' || !Number.isFinite(v)) return;   // dia sem valor: a linha segue até o próximo
            const x = s.length > 1 ? i * largura / (s.length - 1) : 0;
            const y = max === min ? altura / 2 : altura - (v - min) / (max - min) * altura;
            d += (d ? 'L' : 'M') + r(x) + ' ' + r(y);
        });
        return d;
    }

    function diaCurto(iso) {
        const m = DIA.exec(String(iso || ''));
        return m ? m[3] + '/' + m[2] : '';
    }
    function diaSemana(iso) {
        const m = DIA.exec(String(iso || ''));
        return m ? CURTO[new Date(Date.UTC(+m[1], m[2] - 1, +m[3])).getUTCDay()] : '';
    }
    function periodoTexto(p) {
        if (!p) return '';
        return p.de === p.ate ? diaCurto(p.ate) : diaCurto(p.de) + ' a ' + diaCurto(p.ate);
    }

    // número contando até o valor: curva de saída (cúbica), arredondado nas casas do indicador; t vai de 0 a 1
    function contagem(final, t, casas) {
        if (typeof final !== 'number' || !Number.isFinite(final)) return 0;
        if (!(t < 1)) return final;
        const f = Math.pow(10, casas || 0);
        return Math.round(final * (1 - Math.pow(1 - Math.max(0, t), 3)) * f) / f;
    }

    const api = { DIAS, marcas, escala, seriesVolume, empilhar, nivelCalor, maximoMapa, numero, dolar, variacao, tom,
        suficiente, linhaMini, diaCurto, diaSemana, periodoTexto, contagem };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.EmailsGraficos = api;
})(typeof window !== 'undefined' ? window : globalThis);
