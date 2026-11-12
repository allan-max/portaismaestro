const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarEmails, sanearListar, CSP_HTML_EMAIL, CSP_PREVIA, tipoPrevia } = require('../lib/emails');
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
    prefsDir: op.prefsDir || path.join(os.tmpdir(), `maestro-prefs-nao-usado-${process.pid}`),
    ...(op.anexoTtlMs ? { anexoTtlMs: op.anexoTtlMs } : {}), ...(op.nomeDe ? { nomeDe: op.nomeDe } : {}),
    ...(op.timeoutMs ? { timeoutMs: op.timeoutMs } : {}) });
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

test('detalhe e comentários: usuário da sessão; o que o navegador manda como usuário é descartado', () => {
  const s = setup();
  s.pedir('detalhe', { id: 7, usuario: 'forjado@example.test' });
  assert.deepEqual(s.enviados[0].d.params, { id: 7, usuario: 'Ana@Example.test' });
  s.pedir('comentar', { email_id: 7, texto: 'Liguei.\nVolto amanhã.', usuario: 'forjado@example.test', em: 'ontem' });
  assert.deepEqual(s.enviados[1].d.params, { email_id: 7, texto: 'Liguei.\nVolto amanhã.', usuario: 'Ana@Example.test' });
  s.pedir('apagar_comentario', { id: 3, usuario: 'forjado@example.test' });
  assert.deepEqual(s.enviados[2].d.params, { id: 3, usuario: 'Ana@Example.test' });
  s.pedir('comentar', { email_id: 7, texto: 'x'.repeat(2000) });
  assert.equal(s.enviados.length, 4);
  const ruins = [{ email_id: 7, texto: '' }, { email_id: 7, texto: '  \n ' }, { email_id: 7, texto: 'x'.repeat(2001) },
    { email_id: 7, texto: ['oi'] }, { email_id: 7 }, { email_id: '7', texto: 'oi' }, { texto: 'oi' }];
  for (const p of ruins) {
    s.pedir('comentar', p); assert.equal(s.ultima().d.codigo, 'PARAMETRO_INVALIDO', JSON.stringify(p).slice(0, 60));
  }
  s.pedir('apagar_comentario', { id: 'tudo' }); assert.equal(s.ultima().d.codigo, 'PARAMETRO_INVALIDO');
  assert.equal(s.enviados.length, 4);
  s.emails.fechar();
});

test('aberturas: só administrador, barrada no portal antes do serviço; admin vem da sessão', () => {
  for (const user of [{ emails_access: true }, { emails_access: true, admin: 'true' }]) {
    const v = setup(user);
    v.pedir('aberturas', { admin: true });
    assert.equal(v.ultima().d.codigo, 'SO_ADMIN'); assert.equal(v.enviados.length, 0);
    v.emails.fechar();
  }
  const a = setup({ admin: true });
  a.pedir('aberturas', { quem: 'joao@example.test', de: '2026-11-01', ate: 'ontem', email: 'x'.repeat(300), pagina: 2,
    admin: false, usuario: 'forjado@example.test' });
  assert.deepEqual(a.enviados[0].d.params, { quem: 'joao@example.test', de: '2026-11-01', ate: '', email: 'x'.repeat(120),
    pagina: 2, admin: true });
  a.pedir('aberturas', { pagina: -1 }); assert.equal(a.enviados[1].d.params.pagina, 1);
  a.emails.fechar();
});

test('padrões: só administrador, barrados no portal; usuário e admin vêm da sessão', () => {
  for (const user of [{ emails_access: true }, { emails_access: true, admin: 'true' }]) {
    const v = setup(user);
    v.pedir('padroes', { admin: true });
    assert.equal(v.ultima().d.codigo, 'SO_ADMIN');
    v.pedir('rotular_padrao', { admin: true, chave: '@a.example b #', estado: 'pulado' }, 'r2');
    assert.equal(v.ultima().d.codigo, 'SO_ADMIN'); assert.equal(v.enviados.length, 0);
    v.emails.fechar();
  }
  const a = setup({ admin: true });
  a.pedir('padroes', { estado: 'rotulado', pagina: 3, admin: false });
  assert.deepEqual(a.enviados[0].d.params, { estado: 'rotulado', pagina: 3, admin: true });
  a.pedir('padroes', { estado: 'apagado', pagina: 'x' });
  assert.deepEqual(a.enviados[1].d.params, { estado: '', pagina: 1, admin: true });
  const enviado = p => { a.pedir('rotular_padrao', p, 'r' + a.enviados.length); return a.enviados.at(-1).d.params; };
  assert.deepEqual(enviado({ chave: '@a.example b #', estado: 'rotulado', categoria: 'cotação', usuario: 'forjado@example.test' }),
    { chave: '@a.example b #', estado: 'rotulado', categoria: 'cotação', usuario: 'Ana@Example.test', admin: true });
  assert.deepEqual(enviado({ chave: '@a.example b #', estado: 'misturado', categoria: 'cotação' }),
    { chave: '@a.example b #', estado: 'misturado', usuario: 'Ana@Example.test', admin: true });
  assert.deepEqual(enviado({ chave: '@a.example b #', ativo: false, estado: 'pulado' }),
    { chave: '@a.example b #', ativo: false, usuario: 'Ana@Example.test', admin: true });
  assert.deepEqual(enviado({ desfazer: 42, chave: 'x' }), { desfazer: 42, usuario: 'Ana@Example.test', admin: true });
  const antes = a.enviados.length;
  for (const p of [{ chave: '', estado: 'pulado' }, { chave: 'x'.repeat(401), estado: 'pulado' }, { chave: 7, estado: 'pulado' },
    { chave: 'a', estado: 'apagado' }, { chave: 'a', estado: 'rotulado' }, { chave: 'a', ativo: 'false' }, { desfazer: -1 },
    { desfazer: '3' }]) {
    a.pedir('rotular_padrao', p, 'x');
    assert.equal(a.ultima().d.codigo, 'PARAMETRO_INVALIDO', JSON.stringify(p));
  }
  assert.equal(a.enviados.length, antes);
  a.emails.fechar();
});

test('listar: nao_aberto só passa se for true', () => {
  const s = setup();
  s.pedir('listar', { nao_aberto: 'true' }); assert.equal(s.enviados[0].d.params.nao_aberto, false);
  s.pedir('listar', { nao_aberto: true }); assert.equal(s.enviados[1].d.params.nao_aberto, true);
  s.emails.fechar();
});

test('nomes: o portal troca login por nome do cadastro em vistos, comentários e aberturas; sem nome, fica o login', () => {
  const nomes = { 'ana@example.test': 'Ana Souza', 'bia@example.test': '  ' };
  const s = setup({ admin: true }, { nomeDe: email => nomes[email] });
  const devolver = (acao, dados) => {
    s.pedir(acao, acao === 'aberturas' ? {} : { id: 1, status: 'arquivado' });
    s.emails.receber('servico', { id: s.enviados.at(-1).d.id, sucesso: true, dados });
    return s.ultima().d.dados;
  };
  const d = devolver('detalhe', { id: 1, vistos: [{ usuario: 'ana@example.test', em: 'x' }, { usuario: 'joao@example.test', em: 'y' }],
    comentarios: [{ id: 5, usuario: 'bia@example.test', texto: 'oi' }, null] });
  assert.deepEqual(d.vistos.map(v => v.nome), ['Ana Souza', 'joao@example.test']);
  assert.equal(d.vistos[0].usuario, 'ana@example.test');   // o login fica: a tela filtra por ele
  assert.deepEqual(d.comentarios, [{ id: 5, usuario: 'bia@example.test', texto: 'oi', nome: 'bia@example.test' }, null]);
  const st = devolver('status', { id: 1, comentarios: [{ usuario: 'ana@example.test' }] });
  assert.equal(st.comentarios[0].nome, 'Ana Souza');
  const ab = devolver('aberturas', { itens: [{ usuario: 'ana@example.test' }], usuarios: [{ usuario: 'joao@example.test' }] });
  assert.equal(ab.itens[0].nome, 'Ana Souza'); assert.equal(ab.usuarios[0].nome, 'joao@example.test');
  const antigo = devolver('detalhe', { id: 1 });   // serviço antigo: sem vistos nem comentários, nada é inventado
  assert.deepEqual(antigo, { id: 1 });
  s.emails.fechar();
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
      dados: { minhas_caixas: [], filtros: [], sem_ruido: true, agrupar: false, notificar: false, som: false, ver_texto: false,
        equipe: [] } });
    s.pedir('preferencias_salvar', { email: 'outra@example.test', usuario: 'outra@example.test', minhas_caixas: ['vendas@example.test'],
      sem_ruido: false, som: 'sim', desconhecida: 1 });
    assert.equal(s.ultima().d.sucesso, true);
    assert.deepEqual(s.ultima().d.dados.minhas_caixas, ['vendas@example.test']);
    assert.equal(s.ultima().d.dados.som, false); assert.equal(s.ultima().d.dados.desconhecida, undefined);
    // "Ver como texto" lembrado: só booleano verdadeiro liga
    s.pedir('preferencias_salvar', { ver_texto: true });
    assert.equal(s.ultima().d.dados.ver_texto, true);
    assert.deepEqual(s.ultima().d.dados.minhas_caixas, ['vendas@example.test']);   // grava só a chave que veio
    s.pedir('preferencias_salvar', { ver_texto: 'sim' });
    assert.equal(s.ultima().d.dados.ver_texto, false);
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
      notificar: false, som: false, ver_texto: false, equipe: [] });
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

test('html: vira endereço de uso único com documento fechado; nada de HTML pelo socket', () => {
  const s = setup();
  s.pedir('html', { id: 7 });
  const corpo = '<p style="color:#c00">Olá</p><script>window.__xss=1</script>';
  s.emails.receber('servico', { id: s.enviados[0].d.id, sucesso: true, dados: { html: corpo } });
  const r = s.ultima().d;
  assert.equal(r.sucesso, true);
  assert.deepEqual(Object.keys(r.dados), ['url']);                      // o HTML do e-mail não volta ao navegador pelo socket
  assert.match(r.dados.url, /^\/emails\/html\/[0-9a-f]{64}$/);
  const token = r.dados.url.split('/').pop();
  assert.equal(s.emails.retirarAnexo(token), null);                     // token de HTML não serve de anexo
  const doc = s.emails.retirarHtml(token);
  assert.match(doc, /^<!DOCTYPE html><html><head><meta charset="utf-8">/);
  assert.ok(doc.includes(corpo));                                       // quem barra o script é a CSP da rota e o sandbox
  assert.match(doc, /a,area\{pointer-events:none/);
  assert.equal(s.emails.retirarHtml(token), null);                      // uso único
  for (const t of ['', '../x', 'A'.repeat(64), token + '0', null, 7]) assert.equal(s.emails.retirarHtml(t), null);
  // a CSP que a rota usa: sem script, sem rede, só estilo inline e imagens e fontes data:
  assert.equal(CSP_HTML_EMAIL, "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; " +
    "form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox");
  s.emails.fechar();
});

test('html: vale 60 s, tamanho máximo, limite em memória e erro do serviço passa adiante', () => {
  const s = setup();
  s.pedir('html', { id: 1 });
  s.emails.receber('servico', { id: s.enviados[0].d.id, sucesso: true, dados: { html: 'x'.repeat(5 * 1024 * 1024 + 1) } });
  assert.equal(s.ultima().d.codigo, 'HTML_GRANDE');
  s.pedir('html', { id: 1 });
  s.emails.receber('servico', { id: s.enviados[1].d.id, sucesso: true, dados: { html: 42 } });
  assert.equal(s.ultima().d.sucesso, true);                             // não é texto: documento vazio, sem quebrar
  assert.ok(s.emails.retirarHtml(s.ultima().d.dados.url.split('/').pop()).endsWith('<body></body></html>'));
  s.pedir('html', { id: 1 });
  s.emails.receber('servico', { id: s.enviados[2].d.id, sucesso: false, codigo: 'CORPO_OCULTO', erro: 'Oculto' });
  assert.equal(s.ultima().d.codigo, 'CORPO_OCULTO');
  const urls = [];
  for (let i = 0; i < 9; i++) {
    s.pedir('html', { id: 1 }, 'h' + i);
    s.emails.receber('servico', { id: s.enviados.at(-1).d.id, sucesso: true, dados: { html: '<p>' + i + '</p>' } });
    urls.push(s.ultima().d);
  }
  assert.equal(urls.filter(d => d.sucesso).length, 8);
  assert.equal(urls.at(-1).codigo, 'OCUPADO');
  s.emails.fechar();
  // depois do prazo o endereço some
  const curto = setup({ emails_access: true }, { anexoTtlMs: 20 });
  curto.pedir('html', { id: 1 });
  curto.emails.receber('servico', { id: curto.enviados[0].d.id, sucesso: true, dados: { html: '<p>a</p>' } });
  const token = curto.ultima().d.dados.url.split('/').pop();
  return new Promise(res => setTimeout(() => { assert.equal(curto.emails.retirarHtml(token), null); curto.emails.fechar(); res(); }, 60));
});

// ---------- pré-visualização de anexo (seção 7.4) ----------
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< >>\nendobj\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(20)]);

function pedirVer(s, conteudo, nome = 'proposta.pdf', ver = true) {
  s.pedir('anexo', { id: 3, anexo: 9, ver }, 'v' + s.enviados.length);
  const pedido = s.enviados.at(-1).d;
  s.emails.receber('servico', { id: pedido.id, sucesso: true,
    dados: { nome, tipo: 'application/octet-stream', conteudo: Buffer.from(conteudo).toString('base64') } });
  return { pedido, r: s.ultima().d };
}

test('pré-visualização: PDF e imagem por endereço próprio, de uso único, com o tipo pelos primeiros bytes', () => {
  const s = setup();
  const { pedido, r } = pedirVer(s, PDF);
  assert.deepEqual(pedido.params, { id: 3, anexo: 9 });                 // `ver` não vai ao serviço
  assert.equal(r.sucesso, true);
  assert.match(r.dados.url, /^\/emails\/ver\/[0-9a-f]{64}$/);
  assert.equal(r.dados.tipo, 'application/pdf');
  const token = r.dados.url.split('/').pop();
  assert.equal(s.emails.retirarAnexo(token), null);                     // não é o token do download
  assert.equal(s.emails.retirarHtml(token), null);
  const v = s.emails.retirarVista(token);
  assert.deepEqual([v.nome, v.tipo, v.conteudo.equals(PDF)], ['proposta.pdf', 'application/pdf', true]);
  assert.equal(s.emails.retirarVista(token), null);                     // uso único
  for (const t of ['', '../x', 'A'.repeat(64), null]) assert.equal(s.emails.retirarVista(t), null);
  const img = pedirVer(s, PNG, 'foto.png').r;
  assert.equal(img.dados.tipo, 'image/png');
  // sem `ver`, o mesmo anexo continua indo para o download
  const baixar = pedirVer(s, PDF, 'proposta.pdf', false).r;
  assert.match(baixar.dados.url, /^\/emails\/anexo\/[0-9a-f]{64}$/);
  assert.equal(CSP_PREVIA, "default-src 'none'; frame-ancestors 'none'; sandbox");
  s.emails.fechar();
});

test('html e anexo têm o triplo do tempo dos outros pedidos (o serviço pode ir à caixa buscar imagens)', async () => {
  const s = setup({ emails_access: true }, { timeoutMs: 30 });
  const esgotou = acao => s.mensagens.some(m => m.d.acao === acao && m.d.codigo === 'TEMPO_ESGOTADO');
  s.pedir('detalhe', { id: 1 }, 'a'); s.pedir('html', { id: 1 }, 'b'); s.pedir('anexo', { id: 1, anexo: 2 }, 'c');
  await new Promise(res => setTimeout(res, 60));
  assert.deepEqual([esgotou('detalhe'), esgotou('html'), esgotou('anexo')], [true, false, false]);
  await new Promise(res => setTimeout(res, 60));
  assert.deepEqual([esgotou('html'), esgotou('anexo')], [true, true]);
  s.emails.fechar();
});

test('pré-visualização: recusa o que não é PDF ou imagem pelos bytes e o que passa de 10 MB', () => {
  const s = setup();
  for (const conteudo of ['<html><script>x()</script></html>', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'PK\u0003\u0004planilha']) {
    const { r } = pedirVer(s, conteudo, 'disfarçado.pdf');
    assert.equal(r.sucesso, false); assert.equal(r.codigo, 'SEM_PREVIA');
  }
  const grande = Buffer.concat([PDF, Buffer.alloc(10 * 1024 * 1024)]);
  assert.equal(pedirVer(s, grande).r.codigo, 'SEM_PREVIA');
  s.emails.fechar();
  const curto = setup({ emails_access: true }, { anexoTtlMs: 20 });
  const token = pedirVer(curto, PDF).r.dados.url.split('/').pop();
  return new Promise(res => setTimeout(() => { assert.equal(curto.emails.retirarVista(token), null); curto.emails.fechar(); res(); }, 60));
});

test('tipoPrevia: só os primeiros bytes contam', () => {
  assert.equal(tipoPrevia(PDF), 'application/pdf');
  assert.equal(tipoPrevia(PNG), 'image/png');
  assert.equal(tipoPrevia(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), 'image/jpeg');
  assert.equal(tipoPrevia(Buffer.from('GIF89a......')), 'image/gif');
  assert.equal(tipoPrevia(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ')), 'image/webp');
  for (const x of [' %PDF-1.4', '<svg/>', '', 'GIF8']) assert.equal(tipoPrevia(Buffer.from(x)), null);
  assert.equal(tipoPrevia('%PDF-1.4'), null);
});
