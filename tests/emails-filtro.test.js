const assert = require('node:assert/strict');
const { test } = require('node:test');
const Q = require('../public/emails/filtro.js');

const RUIDO = ['marketing', 'spam', 'notificação Coupa', 'código de login'];
const HOJE = '2026-11-10';   // terça-feira

test('filtro novo: Sem ruído ligado e nada mais', () => {
    const f = Q.novo();
    assert.deepEqual(f, { categorias: [], contas: [], estados: [], de: '', ate: '', busca: '', remetente: '',
        revisao: false, anexo: false, atrasados: false, sem_ruido: true });
    assert.equal(Q.semRuidoAtivo(f), true);
    assert.deepEqual(Q.RUIDO, RUIDO);
    assert.ok(!Q.RUIDO.includes('phishing'));
});

test('params: listas novas, parâmetros antigos vazios e Sem ruído como excluir', () => {
    const f = Object.assign(Q.novo(), { categorias: ['cotação', 'pedido'], contas: ['a@x.test', 'b@x.test'],
        estados: ['pendente'], de: '2026-11-01', ate: HOJE, busca: ' cabos ', anexo: true });
    assert.deepEqual(Q.params(f), { categoria: '', conta: '', status: '', categorias: ['cotação', 'pedido'],
        contas: ['a@x.test', 'b@x.test'], estados: ['pendente'], excluir: RUIDO, de: '2026-11-01', ate: HOJE,
        busca: 'cabos', remetente: '', revisao: false, anexo: true, atrasados: false });
    assert.deepEqual(Q.params(Object.assign(Q.novo(), { sem_ruido: false })).excluir, []);
});

test('Sem ruído desliga sozinho quando o filtro pede uma categoria escondida', () => {
    const coupa = Object.assign(Q.novo(), { categorias: ['notificação Coupa'] });
    assert.equal(Q.semRuidoAtivo(coupa), false);
    assert.equal(Q.ruidoDesligadoPeloFiltro(coupa), true);
    assert.deepEqual(Q.params(coupa).excluir, []);
    const cot = Object.assign(Q.novo(), { categorias: ['cotação', 'phishing'] });   // phishing não é ruído
    assert.equal(Q.semRuidoAtivo(cot), true);
    assert.equal(Q.ruidoDesligadoPeloFiltro(cot), false);
    const desligado = Object.assign(Q.novo(), { sem_ruido: false, categorias: ['spam'] });
    assert.equal(Q.ruidoDesligadoPeloFiltro(desligado), false);   // quem desligou foi a pessoa, não o filtro
});

test('endereço: ida e volta preserva o filtro, e o padrão fica fora do endereço', () => {
    assert.equal(Q.paraHash(Q.novo()), '#caixa');
    const f = Object.assign(Q.novo(), { categorias: ['financeiro/NF', '(não classificado)'], contas: ['vendas@x.test'],
        estados: ['pendente', 'respondido'], de: '2026-11-01', ate: HOJE, busca: 'a&b=c #d', remetente: '@cliente.test',
        revisao: true, anexo: true, atrasados: true, sem_ruido: false });
    const hash = Q.paraHash(f);
    assert.match(hash, /^#caixa\?/);
    assert.deepEqual(Q.deHash(hash), f);
    assert.ok(Q.igual(Q.deHash(hash), f));
    assert.deepEqual(Q.deHash('#caixa?revisao=1'), Object.assign(Q.novo(), { revisao: true }));   // endereço antigo do trilho
    assert.deepEqual(Q.deHash('#caixa?atrasados=1'), Object.assign(Q.novo(), { atrasados: true }));
    assert.deepEqual(Q.deHash('#dashboard?cat=spam'), Q.novo());   // filtro só vale na Caixa
    assert.deepEqual(Q.deHash(''), Q.novo());
});

test('endereço: minhas caixas são o padrão; "todas" fica escrito', () => {
    const minhas = ['b@x.test', 'a@x.test'];
    assert.deepEqual(Q.deHash('#caixa', minhas).contas, minhas);
    assert.equal(Q.paraHash(Object.assign(Q.novo(), { contas: ['a@x.test', 'b@x.test'] }), minhas), '#caixa');
    const todas = Q.paraHash(Q.novo(), minhas);
    assert.equal(todas, '#caixa?todas=1');
    assert.deepEqual(Q.deHash(todas, minhas).contas, []);
    assert.deepEqual(Q.deHash('#caixa?caixa=c%40x.test', minhas).contas, ['c@x.test']);
});

test('endereço hostil: limites, status que não existe, data inválida e chave estranha são descartados', () => {
    const muitas = Array.from({ length: 80 }, (_, i) => 'caixa=c' + i).join('&');
    const f = Q.deHash('#caixa?' + muitas + '&status=apagado&status=pendente&de=2026-13-99&ate=ontem&revisao=true' +
        '&q=' + 'x'.repeat(500) + '&rem=' + 'y'.repeat(300) + '&__proto__=1&cat=' + 'z'.repeat(90));
    assert.equal(f.contas.length, 50);
    assert.deepEqual(f.estados, ['pendente']);
    assert.equal(f.de, ''); assert.equal(f.ate, '');
    assert.equal(f.revisao, false);   // só "1" liga
    assert.equal(f.busca.length, 200); assert.equal(f.remetente.length, 120);
    assert.deepEqual(f.categorias, ['z'.repeat(40)]);
    assert.equal(Object.getPrototypeOf(f), Object.prototype);
    assert.deepEqual(Object.keys(f).sort(), Object.keys(Q.novo()).sort());
    assert.deepEqual(Q.deHash('#caixa?cat=a&cat=a&cat=').categorias, ['a']);   // sem repetição nem vazio
    assert.deepEqual(Q.deHash('#caixa?%E0%A4%A').categorias, []);             // endereço quebrado não derruba
});

test('comparação de filtros ignora a ordem das listas', () => {
    const a = Object.assign(Q.novo(), { categorias: ['pedido', 'cotação'], contas: ['b', 'a'] });
    const b = Object.assign(Q.novo(), { categorias: ['cotação', 'pedido'], contas: ['a', 'b'] });
    assert.ok(Q.igual(a, b));
    assert.ok(!Q.igual(a, Object.assign({}, b, { anexo: true })));
    assert.ok(!Q.igual(a, Object.assign({}, b, { sem_ruido: false })));
});

test('alternar e remover devolvem filtro novo, sem mexer no de antes', () => {
    const f = Q.novo();
    const g = Q.alternar(f, 'categorias', 'cotação');
    assert.deepEqual(f.categorias, []);
    assert.deepEqual(g.categorias, ['cotação']);
    assert.deepEqual(Q.alternar(g, 'categorias', 'cotação').categorias, []);
    assert.deepEqual(Q.alternar(f, 'estados', 'pendente').estados, ['pendente']);
    const cheio = Object.assign(Q.novo(), { busca: 'x', de: HOJE, anexo: true, contas: ['a', 'b'] });
    assert.equal(Q.remover(cheio, 'busca').busca, '');
    assert.equal(Q.remover(cheio, 'de').de, '');
    assert.equal(Q.remover(cheio, 'anexo').anexo, false);
    assert.deepEqual(Q.remover(cheio, 'contas', 'a').contas, ['b']);
    assert.equal(Q.remover(cheio, 'sem_ruido').sem_ruido, false);
    assert.equal(cheio.busca, 'x');
});

test('filtros prontos são dados e mantêm as caixas escolhidas', () => {
    const nomes = Q.PRONTOS.map(p => p.nome);
    assert.deepEqual(nomes, ['Cotações pendentes', 'Atrasados', 'Pedidos pendentes', 'Hoje', 'Fila de revisão', 'Com anexo',
        'Financeiro/NF', 'Coupa', 'Ameaças', 'Não classificados', 'Sem ruído']);
    const atual = Object.assign(Q.novo(), { contas: ['a@x.test'], busca: 'antiga' });
    const cot = Q.pronto('cotacoes', atual, HOJE);
    assert.deepEqual(cot, Object.assign(Q.novo(), { contas: ['a@x.test'], categorias: ['cotação'], estados: ['pendente'] }));
    assert.deepEqual(Q.pronto('hoje', atual, HOJE).de, HOJE);
    assert.deepEqual(Q.pronto('ameacas', atual, HOJE).categorias, ['phishing', 'spam']);
    assert.equal(Q.semRuidoAtivo(Q.pronto('ameacas', atual, HOJE)), false);   // spam é ruído: desliga sozinho
    assert.equal(Q.semRuidoAtivo(Q.pronto('coupa', atual, HOJE)), false);
    assert.deepEqual(Q.pronto('nao-classificados', atual, HOJE).categorias, ['(não classificado)']);
    assert.equal(Q.prontoAtivo(cot, HOJE), 'cotacoes');
    assert.equal(Q.prontoAtivo(Q.novo(), HOJE), 'sem-ruido');
    assert.equal(Q.prontoAtivo(atual, HOJE), '');
    assert.equal(Q.pronto('nao-existe', atual, HOJE), null);
});

test('atalhos de período em dias de Brasília', () => {
    assert.deepEqual(Q.periodo('hoje', HOJE), { de: HOJE, ate: HOJE });
    assert.deepEqual(Q.periodo('7d', HOJE), { de: '2026-11-04', ate: HOJE });
    assert.deepEqual(Q.periodo('30d', '2026-03-01'), { de: '2026-01-31', ate: '2026-03-01' });
    assert.equal(Q.hojeBrasilia(new Date('2026-11-10T02:30:00Z')), '2026-11-09');   // 23h30 do dia 9 em Brasília
    assert.equal(Q.hojeBrasilia(new Date('2026-11-10T03:30:00Z')), '2026-11-10');
});

test('chips ativos: rótulo de cada filtro e o aviso de Sem ruído desligado', () => {
    const f = Object.assign(Q.novo(), { categorias: ['notificação Coupa', '(não classificado)'], contas: ['vendas@x.test'],
        estados: ['pendente'], de: '2026-11-01', ate: HOJE, busca: 'cabo', remetente: '@cliente.test', revisao: true });
    assert.deepEqual(Q.ativos(f).map(c => c.rotulo), ['Caixa: vendas', 'Categoria: notificação Coupa',
        'Categoria: não classificado', 'Status: pendente', 'Desde 01/11/2026', 'Até 10/11/2026', 'Busca: cabo',
        'Remetente: @cliente.test', 'Fila de revisão', 'Sem ruído desligado por este filtro']);
    const aviso = Q.ativos(f).at(-1);
    assert.equal(aviso.fixo, true);
    assert.deepEqual(Q.ativos(Q.novo()), [{ chave: 'sem_ruido', valor: '', rotulo: 'Sem ruído' }]);
    assert.deepEqual(Q.ativos(Object.assign(Q.novo(), { sem_ruido: false })), []);
});

test('filtro salvo: o objeto do listar volta a ser o filtro da tela', () => {
    const f = Object.assign(Q.novo(), { categorias: ['cotação'], contas: ['a@x.test'], estados: ['pendente'], anexo: true });
    assert.deepEqual(Q.deParams(Q.params(f)), f);
    const sem = Object.assign(Q.novo(), { sem_ruido: false, busca: 'x' });
    assert.deepEqual(Q.deParams(Q.params(sem)), sem);
    // filtro salvo com os parâmetros antigos ainda vale
    assert.deepEqual(Q.deParams({ categoria: 'pedido', conta: 'b@x.test', status: 'respondido' }),
        Object.assign(Q.novo(), { categorias: ['pedido'], contas: ['b@x.test'], estados: ['respondido'], sem_ruido: false }));
    assert.deepEqual(Q.deParams(null), Object.assign(Q.novo(), { sem_ruido: false }));
});

test('realce: partes de texto, sem HTML, sem diferença de acento nem de maiúscula', () => {
    assert.deepEqual(Q.realce('Cotação de CABOS', 'cotacao cabo'),
        [{ texto: 'Cotação', marca: true }, { texto: ' de ', marca: false }, { texto: 'CABO', marca: true }, { texto: 'S', marca: false }]);
    assert.deepEqual(Q.realce('<img src=x onerror=alert(1)>', 'img'),
        [{ texto: '<', marca: false }, { texto: 'img', marca: true }, { texto: ' src=x onerror=alert(1)>', marca: false }]);
    assert.deepEqual(Q.realce('sem termo', ''), [{ texto: 'sem termo', marca: false }]);
    // as palavras são as mesmas que o serviço procura (sem operador nenhum); letra solta não é realçada
    assert.deepEqual(Q.realce('a near b', '"cabos* -NEAR'), [{ texto: 'a ', marca: false }, { texto: 'near', marca: true }, { texto: ' b', marca: false }]);
    assert.deepEqual(Q.realce('', 'x'), []);
    assert.deepEqual(Q.termos('"Cabos* -NEAR fio a Ação'), ['cabos', 'near', 'fio', 'acao']);
});

test('dia da lista: Hoje, Ontem, Esta semana e a data por extenso', () => {
    const agora = new Date('2026-11-12T15:00:00Z');   // quinta-feira, 12h em Brasília
    assert.equal(Q.grupoDia('2026-11-12T10:00:00Z', agora), 'Hoje');
    assert.equal(Q.grupoDia('2026-11-12T02:00:00Z', agora), 'Ontem');   // 23h do dia 11 em Brasília
    assert.equal(Q.grupoDia('2026-11-10T15:00:00Z', agora), 'Esta semana');
    assert.equal(Q.grupoDia('2026-11-09T15:00:00Z', agora), 'Esta semana');   // segunda-feira
    assert.equal(Q.grupoDia('2026-11-08T15:00:00Z', agora), 'Domingo, 8 de novembro');
    assert.equal(Q.grupoDia('2025-12-31T15:00:00Z', agora), 'Quarta-feira, 31 de dezembro de 2025');
    assert.equal(Q.grupoDia('não é data', agora), 'Sem data');
});

test('cor do relógio de prazo', () => {
    assert.equal(Q.prazo({ horas_uteis: null }), '');
    assert.equal(Q.prazo({}), '');
    assert.equal(Q.prazo({ horas_uteis: 1.5, atrasado: false }), 'neutro');
    assert.equal(Q.prazo({ horas_uteis: 3, atrasado: false }), 'atencao');
    assert.equal(Q.prazo({ horas_uteis: 4.2, atrasado: true }), 'atrasado');
    assert.equal(Q.prazo({ horas_uteis: 9, atrasado: false }), 'atencao');   // o serviço decide o vermelho
});

test('versão do serviço e frases dos erros de preferências', () => {
    assert.equal(Q.v2({ versao: 2 }), true);
    assert.equal(Q.v2({ itens: [] }), false);
    assert.equal(Q.v2({ versao: '2' }), false);
    assert.equal(Q.v2(null), false);
    for (const c of ['SEM_USUARIO', 'SEM_PERMISSAO', 'LIMITE_FILTROS', 'PREFERENCIAS_GRANDES', 'ERRO_PREFERENCIAS']) {
        assert.ok(Q.erroPreferencias(c).length > 10, c);
        assert.doesNotMatch(Q.erroPreferencias(c), /!/);
    }
    assert.equal(Q.erroPreferencias('OUTRO', 'texto do servidor'), 'texto do servidor');
    assert.deepEqual(Q.CORES, ['cinza', 'azul', 'verde', 'ambar', 'violeta', 'ciano', 'rosa', 'laranja']);
});
