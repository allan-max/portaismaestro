const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarEmails, sanearListar } = require('../lib/emails');
const { criarPreferencias } = require('../lib/emails-preferencias');

// Sem t.after (não existe no Node 16.20.2 do servidor): cada teste limpa o que criou.
function pasta() { return fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-prefs-')); }
function apagar(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function setup(user = { emails_access: true }, op = {}) {
  const sessoes = new Map(), handlers = {}, mensagens = [], enviados = [];
  const socket = { id: 'cliente', sessionId: 'sessao', on: (e, fn) => { handlers[e] = fn; },
    emit: (e, d) => mensagens.push({ e, d }), join() {}, leave() {} };
  sessoes.set('sessao', JSON.stringify({ email: 'Ana@Example.test', expires: Date.now() + 100000, ...user }));
  const servico = 'servico' in op ? op.servico : 'servico';
  const emails = criarEmails({ sessoes,
    io: { to: id => ({ emit: (e, d) => enviados.push({ id, e, d }) }),
      sockets: { adapter: { rooms: new Map([['emails', new Set(['cliente'])]]) } } },
    obterServico: () => servico, obterSocket: id => (id === 'cliente' ? socket : null),
    // Sem prefsDir, um caminho que nunca é criado: só salvar preferências cria a pasta, e esses testes não salvam.
    prefsDir: op.prefsDir || path.join(os.tmpdir(), `maestro-prefs-nao-usado-${process.pid}`) });
  emails.conectar(socket);
  const pedir = (acao, params = {}, requestId = 'r1') => handlers.emails_pedir({ requestId, acao, params });
  const trocarUsuario = u => sessoes.set('sessao', JSON.stringify({ expires: Date.now() + 100000, emails_access: true, ...u }));
  return { mensagens, enviados, emails, pedir, ultima: () => mensagens.at(-1), trocarUsuario };
}

test('listar v2: listas com limite de itens e de tamanho, só texto; booleanos só se forem true', () => {
  const s = setup();
  s.pedir('listar', { categorias: ['cotação', 7, null, { a: 1 }, 'x'.repeat(100)], excluir: 'marketing',
    contas: Array.from({ length: 10000 }, (_, i) => `c${i}@example.test`), estados: ['pendente', 'apagado', 'arquivado', 'respondido'],
    anexo: 'true', atrasados: 1, remetente: '@' + 'd'.repeat(300), revisao: true, extra: 'fora' });
  const p = s.enviados[0].d.params;
  assert.deepEqual(p.categorias, ['cotação', 'x'.repeat(40)]);
  assert.deepEqual(p.excluir, []);
  assert.equal(p.contas.length, 50);
  assert.deepEqual(p.estados, ['pendente', 'arquivado']);            // só 3 itens olhados, e só status que existe
  assert.equal(p.anexo, false); assert.equal(p.atrasados, false); assert.equal(p.revisao, true);
  assert.equal(p.remetente.length, 120); assert.equal(p.extra, undefined);
  assert.equal(sanearListar({ categorias: Array(25).fill('a') }).categorias.length, 20);
  assert.equal(sanearListar({ excluir: Array(25).fill('a') }).excluir.length, 20);
  assert.deepEqual(sanearListar({ estados: ['pendente', 'pendente', 'pendente', 'arquivado'] }).estados, ['pendente', 'pendente', 'pendente']);
  s.emails.fechar();
});

test('listar v2: os parâmetros que a tela de hoje manda continuam passando iguais', () => {
  const s = setup();
  const antigos = { categoria: 'cotação', conta: 'vendas@example.test', status: 'pendente', de: '2026-11-01', ate: '2026-11-09',
    busca: '"cabos* -NEAR', cursor: '2026-11-09T12:00:00+00:00|42', revisao: false };
  s.pedir('listar', antigos);
  const p = s.enviados[0].d.params;
  for (const [k, v] of Object.entries(antigos)) assert.deepEqual(p[k], v, k);
  assert.deepEqual([p.categorias, p.excluir, p.contas, p.estados, p.anexo, p.atrasados, p.remetente], [[], [], [], [], false, false, '']);
  s.emails.fechar();
});

test('resumo: admin vem só da sessão; o que o navegador manda é descartado', () => {
  const vendedor = setup();
  vendedor.pedir('resumo', { admin: true, periodo: '30d', contas: ['vendas@example.test', 3], gasto: true });
  assert.deepEqual(vendedor.enviados[0].d.params, { periodo: '30d', contas: ['vendas@example.test'], admin: false });
  vendedor.pedir('resumo', { periodo: '1 OR 1' });
  assert.deepEqual(vendedor.enviados[1].d.params, { periodo: 'hoje', contas: [], admin: false });
  vendedor.emails.fechar();
  const admin = setup({ admin: true });
  admin.pedir('resumo', { admin: false, periodo: '7d' });
  assert.deepEqual(admin.enviados[0].d.params, { periodo: '7d', contas: [], admin: true });
  admin.emails.fechar();
  const truthy = setup({ emails_access: true, admin: 'true' });   // só o booleano true na sessão conta
  truthy.pedir('resumo', {}); assert.equal(truthy.enviados[0].d.params.admin, false); truthy.emails.fechar();
});

test('lote e desfazer: usuário da sessão, 1 a 100 itens, item inválido recusa o pedido sem ir ao serviço', () => {
  const s = setup();
  s.pedir('lote', { usuario: 'forjado@example.test', itens: [{ id: 3, status: 'respondido', extra: 1 }, { id: 4, status: 'arquivado' }] });
  assert.deepEqual(s.enviados[0].d.params, { itens: [{ id: 3, status: 'respondido' }, { id: 4, status: 'arquivado' }],
    usuario: 'Ana@Example.test' });
  s.pedir('desfazer', { auditoria: [10, 11], usuario: 'forjado@example.test', estado: { status: 'pendente' } });
  assert.deepEqual(s.enviados[1].d.params, { auditoria: [10, 11], usuario: 'Ana@Example.test' });
  const ruins = [['lote', { itens: [] }], ['lote', { itens: Array(101).fill({ id: 1, status: 'arquivado' }) }],
    ['lote', { itens: Array(10000).fill({ id: 1, status: 'arquivado' }) }], ['lote', { itens: 'todos' }],
    ['lote', { itens: [{ id: 1, status: 'apagado' }] }], ['lote', { itens: [{ id: '1 OR 1=1', status: 'arquivado' }] }],
    ['lote', { itens: [null] }], ['desfazer', { auditoria: [] }], ['desfazer', { auditoria: Array(101).fill(1) }],
    ['desfazer', { auditoria: ['1'] }], ['desfazer', { auditoria: [0] }], ['desfazer', {}]];
  for (const [acao, params] of ruins) {
    s.pedir(acao, params); assert.equal(s.ultima().d.codigo, 'PARAMETRO_INVALIDO', JSON.stringify(params).slice(0, 80));
  }
  assert.equal(s.enviados.length, 2);
  s.pedir('lote', { itens: Array(100).fill({ id: 1, status: 'arquivado' }) }); assert.equal(s.enviados.length, 3);
  s.emails.fechar();
  const sem = setup({ portais_access: true }); sem.pedir('lote', { itens: [{ id: 1, status: 'arquivado' }] });
  assert.equal(sem.ultima().d.codigo, 'SEM_PERMISSAO'); assert.equal(sem.enviados.length, 0); sem.emails.fechar();
});

test('novidade repassa cotacoes e pedidos só quando são inteiros', () => {
  const s = setup();
  s.emails.novidade('servico', { novos: 2, atrasados: 1, cotacoes: 3, pedidos: 0 });
  assert.deepEqual(s.ultima().d, { novos: 2, atrasados: 1, cotacoes: 3, pedidos: 0 });
  s.emails.novidade('servico', { novos: 1, cotacoes: '3', pedidos: 1.5, assunto: 'segredo' });
  assert.deepEqual(s.ultima().d, { novos: 1, atrasados: null });
  s.emails.fechar();
});

test('preferências: tratadas no portal, com o serviço offline, pela chave do usuário da sessão', () => {
  const dir = pasta();
  try {
    const s = setup({ emails_access: true }, { servico: null, prefsDir: dir });
    s.pedir('preferencias');
    assert.deepEqual(s.ultima().d, { sucesso: true, requestId: 'r1', acao: 'preferencias',
      dados: { minhas_caixas: [], filtros: [], sem_ruido: true, agrupar: false, notificar: false, som: false, equipe: [] } });
    s.pedir('preferencias_salvar', { email: 'outra@example.test', usuario: 'outra@example.test', minhas_caixas: ['vendas@example.test'],
      sem_ruido: false, som: 'sim', desconhecida: 1 });
    assert.equal(s.ultima().d.sucesso, true);
    assert.deepEqual(s.ultima().d.dados.minhas_caixas, ['vendas@example.test']);
    assert.equal(s.ultima().d.dados.som, false); assert.equal(s.ultima().d.dados.desconhecida, undefined);
    const arquivo = JSON.parse(fs.readFileSync(path.join(dir, 'emails-preferencias.json'), 'utf8'));
    assert.deepEqual(Object.keys(arquivo.usuarios), ['ana@example.test']);   // minúsculas, da sessão
    assert.equal(s.enviados.length, 0);
    s.trocarUsuario({ email: 'bia@example.test' });
    s.pedir('preferencias'); assert.deepEqual(s.ultima().d.dados.minhas_caixas, []);   // cada um vê só as suas
    s.trocarUsuario({ email: '' });
    s.pedir('preferencias'); assert.equal(s.ultima().d.codigo, 'SEM_USUARIO');
    s.trocarUsuario({ email: 'semacesso@example.test', emails_access: false });
    s.pedir('preferencias'); assert.equal(s.ultima().d.codigo, 'SEM_PERMISSAO');
    s.emails.fechar();
  } finally { apagar(dir); }
});

const filtro = (n, extra = {}) => ({ id: `f${n}`, nome: `Filtro ${n}`, cor: 'azul', fixado: n === 0, filtro: { categorias: ['cotação'] }, ...extra });

test('preferências: limite de 20 filtros, filtro saneado como o listar, equipe só por administrador', () => {
  const dir = pasta();
  try {
    const prefs = criarPreferencias({ dir, sanearFiltro: sanearListar });
    assert.throws(() => prefs.salvar('ana@example.test', false, { filtros: Array.from({ length: 21 }, (_, i) => filtro(i)) }),
      e => e.codigo === 'LIMITE_FILTROS');
    const salvo = prefs.salvar('ana@example.test', false, { filtros: [filtro(0, {
      nome: '  ' + 'N'.repeat(60), cor: 'url(javascript:1)', id: '../x', fixado: 'sim',
      filtro: { categorias: Array(30).fill('pedido'), cursor: '2026|1', busca: 'b'.repeat(500), admin: true, extra: 1 } }),
      { nome: '', filtro: {} }, 'texto', null] });
    assert.equal(salvo.filtros.length, 1);
    const f = salvo.filtros[0];
    assert.equal(f.nome.length, 40); assert.equal(f.cor, 'cinza'); assert.match(f.id, /^[0-9a-f-]{36}$/); assert.equal(f.fixado, false);
    assert.equal(f.filtro.categorias.length, 20); assert.equal(f.filtro.busca.length, 200);
    assert.equal('cursor' in f.filtro, false); assert.equal('admin' in f.filtro, false); assert.equal('extra' in f.filtro, false);
    assert.throws(() => prefs.salvar('ana@example.test', false, { equipe: [filtro(1)] }), e => e.codigo === 'SEM_PERMISSAO');
    assert.throws(() => prefs.salvar('admin@example.test', true, { equipe: Array.from({ length: 21 }, (_, i) => filtro(i)) }),
      e => e.codigo === 'LIMITE_FILTROS');
    prefs.salvar('admin@example.test', true, { equipe: [filtro(1)] });
    assert.deepEqual(prefs.obter('ana@example.test').equipe.map(x => x.nome), ['Filtro 1']);   // aparece para todos
    prefs.salvar('ana@example.test', false, { som: true });                                      // não apaga a equipe
    assert.equal(prefs.obter('bia@example.test').equipe.length, 1);
    assert.equal(prefs.obter('ana@example.test').filtros.length, 1);                            // salvar parcial mantém o resto
  } finally { apagar(dir); }
});

test('preferências: arquivo corrompido não derruba e fica guardado; gravação atômica; tamanho máximo', () => {
  const dir = pasta();
  try {
    const arquivo = path.join(dir, 'emails-preferencias.json');
    fs.writeFileSync(arquivo, '{"usuarios": {"ana@example.test": ');
    const prefs = criarPreferencias({ dir, sanearFiltro: sanearListar });
    assert.deepEqual(prefs.obter('ana@example.test').filtros, []);
    const copias = fs.readdirSync(dir).filter(n => n.startsWith('emails-preferencias.json.corrompido-'));
    assert.equal(copias.length, 1);
    assert.equal(fs.readFileSync(path.join(dir, copias[0]), 'utf8'), '{"usuarios": {"ana@example.test": ');
    fs.writeFileSync(arquivo, JSON.stringify({ usuarios: { 'ana@example.test': { filtros: 'x', som: 'sim', minhas_caixas: [1, 'a'] } }, equipe: {} }));
    assert.deepEqual(prefs.obter('ana@example.test'), { minhas_caixas: ['a'], filtros: [], sem_ruido: true, agrupar: false,
      notificar: false, som: false, equipe: [] });
    prefs.salvar('ana@example.test', false, { notificar: true });
    assert.deepEqual(fs.readdirSync(dir).filter(n => n.endsWith('.tmp')), []);
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).usuarios['ana@example.test'].notificar, true);
    // um usuário não passa de 64 KB: 20 filtros com 50 caixas longas cada
    const grande = Array.from({ length: 20 }, (_, i) => filtro(i, { filtro: { contas: Array.from({ length: 50 }, (_, j) => `${j}`.padEnd(120, 'c')) } }));
    assert.throws(() => prefs.salvar('ana@example.test', false, { filtros: grande }), e => e.codigo === 'PREFERENCIAS_GRANDES');
    // o arquivo inteiro não passa de 4 MB
    const usuarios = {};
    for (let i = 0; i < 85; i++) {
      usuarios[`u${i}@example.test`] = { minhas_caixas: Array.from({ length: 50 }, (_, j) => `${i}-${j}`.padEnd(120, 'x')), filtros: grande.slice(0, 7) };
    }
    fs.writeFileSync(arquivo, JSON.stringify({ usuarios, equipe: [] }));
    assert.ok(fs.statSync(arquivo).size > 4 * 1024 * 1024 - 200 * 1024);
    assert.throws(() => prefs.salvar('nova@example.test', false, { filtros: grande.slice(0, 7), minhas_caixas: usuarios['u0@example.test'].minhas_caixas }),
      e => e.codigo === 'PREFERENCIAS_GRANDES');
    assert.equal(JSON.parse(fs.readFileSync(arquivo, 'utf8')).usuarios['nova@example.test'], undefined);   // nada gravado
  } finally { apagar(dir); }
});
