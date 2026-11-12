const assert = require('node:assert/strict');
const { test } = require('node:test');
const G = require('../public/emails/graficos.js');

test('marcas do eixo: começam em zero, passo redondo (1, 2 ou 5 vezes 10^n) e cobrem o máximo', () => {
    assert.deepEqual(G.marcas(7), [0, 2, 4, 6, 8]);
    assert.deepEqual(G.marcas(100), [0, 50, 100]);
    assert.deepEqual(G.marcas(101), [0, 50, 100, 150]);
    assert.deepEqual(G.marcas(3), [0, 1, 2, 3]);
    assert.deepEqual(G.marcas(1), [0, 1]);
    assert.deepEqual(G.marcas(1234), [0, 500, 1000, 1500]);
    // sem dado: um eixo de 0 a 1, nunca divisão por zero
    assert.deepEqual(G.marcas(0), [0, 1]);
    assert.deepEqual(G.marcas(-5), [0, 1]);
    assert.deepEqual(G.marcas(NaN), [0, 1]);
    for (const max of [2, 9, 13, 48, 77, 333, 9999]) {
        const m = G.marcas(max);
        assert.ok(m[m.length - 1] >= max, 'cobre ' + max);
        assert.ok(m.length >= 2 && m.length <= 6, max + ': ' + m);
        const passo = m[1];
        assert.ok(m.every((v, i) => v === i * passo));
        assert.match(String(passo), /^[125]0*$/);
    }
});

test('escala: valor para pixels, proporcional ao topo, sem passar do tamanho', () => {
    assert.equal(G.escala(5, 10, 200), 100);
    assert.equal(G.escala(0, 10, 200), 0);
    assert.equal(G.escala(20, 10, 200), 200);
    assert.equal(G.escala(-3, 10, 200), 0);
    assert.equal(G.escala(5, 0, 200), 0);
    assert.equal(G.escala(null, 10, 200), 0);
});

const VOLUME = [
    { dia: '2026-11-09', por_categoria: { 'cotação': 5, pedido: 2, spam: 1, '(não classificado)': 1 } },
    { dia: '2026-11-10', por_categoria: { 'cotação': 3, marketing: 4, outros: 1, interno: 1, cadastro: 1, informação: 1, 'financeiro/NF': 2 } },
];

test('séries do volume: maiores primeiro, até o limite, e o resto junto em "demais"', () => {
    const s = G.seriesVolume(VOLUME, 4);
    assert.deepEqual(s.map(x => x.chave), ['cotação', 'marketing', 'financeiro/NF', 'pedido', 'demais']);
    assert.deepEqual(s[0].categorias, ['cotação']);
    // o resto, em ordem de nome, para o clique levar todas
    assert.deepEqual(s[4].categorias, ['(não classificado)', 'cadastro', 'informação', 'interno', 'outros', 'spam']);
    // cabendo todas, não há "demais"
    assert.equal(G.seriesVolume(VOLUME, 20).some(x => x.chave === 'demais'), false);
    assert.equal(G.seriesVolume(VOLUME, 20).length, 10);
    assert.deepEqual(G.seriesVolume([], 6), []);
    assert.deepEqual(G.seriesVolume(null, 6), []);
    // número que não é inteiro positivo não conta
    assert.deepEqual(G.seriesVolume([{ dia: 'x', por_categoria: { a: -1, b: 'x', c: 2 } }], 6).map(x => x.chave), ['c']);
});

test('empilhar: cada dia com as partes de baixo para cima, sem as séries escondidas', () => {
    const series = G.seriesVolume(VOLUME, 4);
    const pilhas = G.empilhar(VOLUME, series, new Set());
    assert.equal(pilhas.length, 2);
    assert.equal(pilhas[0].total, 9);
    assert.equal(pilhas[1].total, 13);
    assert.deepEqual(pilhas[0].partes.map(p => [p.chave, p.valor, p.y0, p.y1]),
        [['cotação', 5, 0, 5], ['pedido', 2, 5, 7], ['demais', 2, 7, 9]]);
    // série zerada no dia não vira parte
    assert.ok(pilhas[0].partes.every(p => p.valor > 0));
    const sem = G.empilhar(VOLUME, series, new Set(['cotação']));
    assert.equal(sem[0].total, 4);
    assert.deepEqual(sem[0].partes[0], { chave: 'pedido', valor: 2, y0: 0, y1: 2 });
    assert.deepEqual(G.empilhar(null, series, new Set()), []);
});

test('mapa de calor: nível pela intensidade, zero só para zero', () => {
    assert.equal(G.nivelCalor(0, 10), 0);
    assert.equal(G.nivelCalor(1, 10), 1);
    assert.equal(G.nivelCalor(2, 10), 1);
    assert.equal(G.nivelCalor(5, 10), 3);
    assert.equal(G.nivelCalor(10, 10), 5);
    assert.equal(G.nivelCalor(1, 1000), 1);   // um e-mail nunca some no fundo
    assert.equal(G.nivelCalor(3, 0), 0);
    assert.equal(G.nivelCalor(null, 10), 0);
    assert.equal(G.maximoMapa([[0, 3], [7, 1]]), 7);
    assert.equal(G.maximoMapa(null), 0);
});

test('número: separador pt-BR, casas pedidas e traço sem valor', () => {
    assert.equal(G.numero(1234), '1.234');
    assert.equal(G.numero(4.25, 1), '4,3');
    assert.equal(G.numero(0), '0');
    assert.equal(G.numero(null), '—');
    assert.equal(G.numero(NaN), '—');
    assert.equal(G.dolar(12.5), 'US$ 12,50');
    assert.equal(G.dolar(null), '—');
});

test('variação contra o período anterior: percentual, pontos ou horas, com o sentido', () => {
    assert.deepEqual(G.variacao(120, 100), { texto: '+20%', sentido: 'sobe' });
    assert.deepEqual(G.variacao(75, 100), { texto: '-25%', sentido: 'desce' });
    assert.deepEqual(G.variacao(100, 100), { texto: '0%', sentido: 'igual' });
    assert.deepEqual(G.variacao(0, 0), { texto: '0%', sentido: 'igual' });
    // sem base não se inventa percentual
    assert.deepEqual(G.variacao(5, 0), { texto: 'sem base anterior', sentido: 'igual' });
    assert.deepEqual(G.variacao(82.5, 80, 'pp'), { texto: '+2,5 p.p.', sentido: 'sobe' });
    assert.deepEqual(G.variacao(3.1, 4.6, 'h'), { texto: '-1,5 h', sentido: 'desce' });
    assert.equal(G.variacao(null, 3), null);
    assert.equal(G.variacao(3, null), null);
});

test('tom da variação: depende de qual lado é bom', () => {
    assert.equal(G.tom('sobe', true), 'bom');
    assert.equal(G.tom('desce', true), 'ruim');
    assert.equal(G.tom('sobe', false), 'ruim');
    assert.equal(G.tom('desce', false), 'bom');
    assert.equal(G.tom('igual', true), 'neutro');
    assert.equal(G.tom('sobe', null), 'neutro');   // volume: subir não é bom nem ruim
});

test('dados insuficientes: só mostra número com suficiente verdadeiro e valor', () => {
    assert.equal(G.suficiente({ atual: 80, suficiente: true }), true);
    assert.equal(G.suficiente({ atual: 80, suficiente: false }), false);
    assert.equal(G.suficiente({ atual: null, suficiente: true }), false);
    assert.equal(G.suficiente({ recebidas: 9, suficiente: true }, 'recebidas'), true);
    assert.equal(G.suficiente({ recebidas: 9 }, 'recebidas'), false);
    assert.equal(G.suficiente(undefined), false);
    assert.equal(G.suficiente(null), false);
});

test('mini-gráfico: caminho que pula o dia sem dado e some com menos de dois pontos', () => {
    assert.equal(G.linhaMini([1, 3], 100, 20), 'M0 20L100 0');
    assert.equal(G.linhaMini([2, 2, 2], 100, 20), 'M0 10L50 10L100 10');
    // dia sem valor não parte a linha em pedaços: ela liga os dias que têm valor
    assert.equal(G.linhaMini([0, null, 4, 2], 90, 20), 'M0 20L60 0L90 10');
    assert.equal(G.linhaMini([5], 100, 20), '');
    assert.equal(G.linhaMini([null, 5, null], 100, 20), '');
    assert.equal(G.linhaMini(null, 100, 20), '');
});

test('datas do eixo: dia curto e dia da semana, sem fuso mexendo no dia', () => {
    assert.equal(G.diaCurto('2026-11-09'), '09/11');
    assert.equal(G.diaSemana('2026-11-09'), 'seg');
    assert.equal(G.diaSemana('2026-11-15'), 'dom');
    assert.equal(G.diaCurto('lixo'), '');
    assert.equal(G.diaSemana(''), '');
    assert.equal(G.DIAS.length, 7);
    assert.equal(G.DIAS[0], 'segunda');
    assert.equal(G.periodoTexto({ de: '2026-11-04', ate: '2026-11-10' }), '04/11 a 10/11');
    assert.equal(G.periodoTexto({ de: '2026-11-10', ate: '2026-11-10' }), '10/11');
    assert.equal(G.periodoTexto(null), '');
});

test('contagem do número: sai de zero, desacelera e termina exatamente no valor', () => {
    assert.equal(G.contagem(120, 0), 0);
    assert.equal(G.contagem(120, 1), 120);
    assert.equal(G.contagem(120, 2), 120);
    assert.equal(G.contagem(120, .5), 105);               // curva de saída: na metade do tempo já passou da metade
    assert.equal(G.contagem(43.5, .5, 1), 38.1);
    assert.equal(G.contagem(43.5, 1, 1), 43.5);
    assert.ok(G.contagem(7, .2) <= 7);
    assert.equal(G.contagem(NaN, .5), 0);
});
