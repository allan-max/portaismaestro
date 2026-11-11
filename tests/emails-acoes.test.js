const assert = require('node:assert/strict');
const { test } = require('node:test');
const A = require('../public/emails/acoes.js');
const F = require('../public/emails/formato.js');

const AGORA = new Date('2026-11-10T15:00:00Z');   // 12:00 em Brasília

test('iniciais: do nome, ou do endereço; nunca mais de duas letras', () => {
    assert.equal(A.iniciais('Irene Coutinho', 'irene@x.test'), 'IC');
    assert.equal(A.iniciais('  ana  maria de souza ', ''), 'AS');
    assert.equal(A.iniciais('Jonas', 'jonas@x.test'), 'J');
    assert.equal(A.iniciais('', 'compras.lab@x.test'), 'CL');
    assert.equal(A.iniciais('', 'compras@x.test'), 'C');
    assert.equal(A.iniciais('<script>window.__xss=2</script>', 'mal@hostil.example'), 'SS');   // só letras e números
    assert.equal(A.iniciais('', ''), '?');
    assert.equal(A.iniciais(null, undefined), '?');
    assert.equal(A.iniciais('élio ávila', ''), 'ÉÁ');
});

test('relativa: minutos, horas e dias; vazio para longe, futuro ou inválido', () => {
    assert.equal(A.relativa('2026-11-10T14:59:40Z', AGORA), 'agora há pouco');
    assert.equal(A.relativa('2026-11-10T14:55:00Z', AGORA), 'há 5 min');
    assert.equal(A.relativa('2026-11-10T12:00:00Z', AGORA), 'há 3 h');
    assert.equal(A.relativa('2026-11-09T14:00:00Z', AGORA), 'há 1 dia');
    assert.equal(A.relativa('2026-11-05T15:00:00Z', AGORA), 'há 5 dias');
    assert.equal(A.relativa('2026-10-01T15:00:00Z', AGORA), '');
    assert.equal(A.relativa('2026-11-11T15:00:00Z', AGORA), '');
    assert.equal(A.relativa('não é data', AGORA), '');
    assert.equal(A.relativa(null, AGORA), '');
});

test('porExtenso: dia da semana e data no fuso de Brasília', () => {
    assert.match(A.porExtenso('2026-11-10T02:30:00Z'), /^segunda-feira, 9 de novembro de 2026,? (às )?23:30$/);
    assert.equal(A.porExtenso(''), '');
});

test('intervalo: do último marcado até o clicado, nos dois sentidos', () => {
    const ids = [10, 9, 8, 7, 6];
    assert.deepEqual(A.intervalo(ids, 9, 7), [9, 8, 7]);
    assert.deepEqual(A.intervalo(ids, 6, 9), [9, 8, 7, 6]);
    assert.deepEqual(A.intervalo(ids, 8, 8), [8]);
    assert.deepEqual(A.intervalo(ids, 99, 7), [7]);   // âncora que saiu da lista: só o clicado
    assert.deepEqual(A.intervalo(ids, null, 10), [10]);
});

test('partes: lotes de no máximo 100, na ordem', () => {
    assert.deepEqual(A.partes([], 100), []);
    assert.deepEqual(A.partes([1, 2, 3], 2), [[1, 2], [3]]);
    const grandes = A.partes(Array.from({ length: 250 }, (_, i) => i));
    assert.deepEqual(grandes.map(p => p.length), [100, 100, 50]);
    assert.equal(grandes[2][0], 200);
});

test('largura do detalhe: 420 px a 60 %, sem apertar a lista abaixo de 380 px', () => {
    assert.equal(A.largura(600, 1800, 272), 600);
    assert.equal(A.largura(100, 1800, 272), 420);
    assert.equal(A.largura(5000, 1800, 272), 1080);              // 60 % de 1800
    assert.equal(A.largura(5000, 1200, 272), 548);               // 1200 - 272 - 380: a lista fica com 380
    assert.equal(A.largura(5000, 900, 272), 420);                // sem espaço: o mínimo vale
    assert.equal(A.largura(NaN, 1800, 272), null);
    assert.equal(A.largura(612.6, 1800, 272), 613);
});

test('histórico: recebido, classificado e cada alteração manual, com quem e quando', () => {
    const e = { data: '2026-11-10T10:00:00Z', classificado_em: '2026-11-10T10:01:00Z', categoria: 'pedido', categoria_original: 'cotação',
        historico: [
            { usuario: 'ana@x.test', acao: 'status', antes: 'pendente', depois: 'respondido', em: '2026-11-10T11:00:00Z' },
            { usuario: 'ana@x.test', acao: 'categoria', antes: 'cotação', depois: 'pedido', em: '2026-11-10T11:01:00Z' },
            { usuario: 'ana@x.test', acao: 'desfazer', antes: 'pedido', depois: 'cotação', em: '2026-11-10T11:02:00Z' },
            { usuario: '', acao: 'outra', antes: null, depois: 'x', em: 'ruim' }] };
    const h = A.historico(e);
    assert.deepEqual(h.map(x => x.texto), ['Recebido', 'Classificado como cotação', 'Status: pendente para respondido',
        'Categoria: cotação para pedido', 'Desfeito: pedido voltou a cotação', 'outra: — para x']);
    assert.deepEqual(h.map(x => x.quem), ['', 'IA', 'ana@x.test', 'ana@x.test', 'ana@x.test', '']);
    assert.equal(h[0].em, e.data);
    assert.deepEqual(A.historico({ data: e.data, classificado_em: null, historico: 'x' }).map(x => x.texto), ['Recebido']);
    assert.deepEqual(A.historico({ data: e.data, classificado_em: e.data, categoria: null }).map(x => x.texto), ['Recebido', 'Classificado']);
});

test('desfeito: frase com quantos voltaram e quantos o serviço recusou', () => {
    assert.equal(A.desfeito(1, 0), 'Alteração desfeita.');
    assert.equal(A.desfeito(3, 0), '3 alterações desfeitas.');
    assert.equal(A.desfeito(2, 1), '2 desfeitas. 1 não pôde ser desfeita: o e-mail mudou depois ou o prazo passou.');
    assert.equal(A.desfeito(0, 3), 'Nada foi desfeito: 3 não puderam ser desfeitas. O e-mail mudou depois ou o prazo passou.');
    assert.equal(A.desfeito(0, 1), 'Nada foi desfeito: o e-mail mudou depois ou o prazo passou.');
});

test('confiança em percentual inteiro, entre 0 e 100', () => {
    assert.equal(A.percentual(0.873), 87);
    assert.equal(A.percentual(1), 100);
    assert.equal(A.percentual(1.7), 100);
    assert.equal(A.percentual(-1), 0);
    assert.equal(A.percentual(null), null);
    assert.equal(A.percentual('0,5'), null);
});

test('aviso de cotação e pedido novos: só a contagem, e nada quando é zero ou não veio', () => {
    assert.equal(A.textoAviso(0, 0), '');
    assert.equal(A.textoAviso(undefined, null), '');   // serviço antigo: o evento não traz as contagens
    assert.equal(A.textoAviso(-2, 1.5), '');
    assert.equal(A.textoAviso('3', {}), '');
    assert.equal(A.textoAviso(1, 0), '1 cotação nova');
    assert.equal(A.textoAviso(3, undefined), '3 cotações novas');
    assert.equal(A.textoAviso(0, 1), '1 pedido novo');
    assert.equal(A.textoAviso(null, 2), '2 pedidos novos');
    assert.equal(A.textoAviso(2, 1), '2 cotações e 1 pedido novos');
    assert.equal(A.textoAviso(1, 1), '1 cotação e 1 pedido novos');
});

test('planilha: colunas da seção 8, todo valor como texto e nunca o corpo do e-mail', () => {
    assert.deepEqual(A.COLUNAS_PLANILHA, ['Data', 'Remetente', 'Nome', 'Assunto', 'Categoria', 'Status', 'Caixas', 'Urgência',
        'Horas úteis de espera', 'Resumo']);
    assert.equal(A.MAX_EXPORTAR, 2000);
    const e = { data: '2026-11-10T15:00:00Z', remetente: 'ana@cliente.test', remetente_nome: 'Ana', assunto: '=HYPERLINK("http://x.example")',
        categoria: 'cotação', status: 'pendente', caixas: ['vendas@empresa.test', 'compras@empresa.test'], urgencia: 'alta', horas_uteis: 4.5,
        resumo: 'Pede preço de cabos.', corpo_texto: 'texto do corpo' };
    const linha = A.linhaPlanilha(e);
    assert.deepEqual(linha, [F.dataHora(e.data), 'ana@cliente.test', 'Ana', '=HYPERLINK("http://x.example")', 'cotação', 'pendente',
        'vendas, compras', 'alta', '4,5', 'Pede preço de cabos.']);
    for (const v of linha) assert.equal(typeof v, 'string');
    assert.ok(!linha.includes('texto do corpo'));
    const vazia = A.linhaPlanilha({ id: 7, horas_uteis: null, caixas: 'x' });
    assert.equal(vazia.length, A.COLUNAS_PLANILHA.length);
    for (const v of vazia) assert.equal(typeof v, 'string');
    assert.equal(vazia[0], '');
    assert.equal(vazia[4], 'não classificado');
    assert.equal(vazia[8], '');
});
