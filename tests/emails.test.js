const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarEmails, nomeSeguro } = require('../lib/emails');

function setup(user = { emails_access: true }, op = {}) {
  const sessoes = new Map(), handlers = {}, mensagens = [], enviados = [], salas = new Set();
  const socket = { id: 'cliente', sessionId: 'sessao', on: (e, fn) => { handlers[e] = fn; },
    emit: (e, d) => mensagens.push({ e, d }), join: s => salas.add(s), leave: s => salas.delete(s) };
  sessoes.set('sessao', JSON.stringify({ email: 'ana@example.test', expires: Date.now() + 100000, ...user }));
  let servico = 'servico' in op ? op.servico : 'servico';
  const emails = criarEmails({ sessoes,
    io: { to: id => ({ emit: (e, d) => enviados.push({ id, e, d }) }),
      sockets: { adapter: { rooms: new Map([['emails', new Set(['cliente'])]]) } } },
    obterServico: () => servico, obterSocket: id => (id === 'cliente' ? socket : null),
    timeoutMs: op.timeoutMs || 20000 });
  emails.conectar(socket);
  const pedir = (acao, params = {}, requestId = 'r1') => handlers.emails_pedir({ requestId, acao, params });
  return { sessoes, handlers, mensagens, enviados, emails, socket, pedir, salas, ultima: () => mensagens.at(-1),
    derrubar: () => { servico = null; } };
}

test('sessão inválida, vencida ou bloqueada recebe sessao_invalida e nada chega ao serviço', () => {
  for (const ajuste of [s => s.sessoes.clear(), s => s.sessoes.set('sessao', JSON.stringify({ emails_access: true, expires: Date.now() - 1 })),
    s => s.sessoes.set('sessao', JSON.stringify({ emails_access: true, bloqueado: true, expires: Date.now() + 1000 }))]) {
    const s = setup(); ajuste(s);
    s.pedir('listar');
    assert.equal(s.ultima().e, 'sessao_invalida'); assert.equal(s.enviados.length, 0); s.emails.fechar();
  }
});

test('sem emails_access e sem admin: SEM_PERMISSAO em toda ação; portais_access não libera', () => {
  for (const user of [{}, { portais_access: true }, { dashboard_access: true, planilha_access: true }, { dev: true }]) {
    for (const [acao, params] of [['listar', {}], ['detalhe', { id: 1 }], ['html', { id: 1 }], ['anexo', { id: 1, anexo: 2 }]]) {
      const s = setup(user); s.pedir(acao, params);
      assert.equal(s.ultima().d.codigo, 'SEM_PERMISSAO'); assert.equal(s.enviados.length, 0); s.emails.fechar();
    }
  }
  const admin = setup({ admin: true }); admin.pedir('listar'); assert.equal(admin.enviados.length, 1); admin.emails.fechar();
});

test('pedido vai ao serviço com id próprio e parâmetros saneados; resposta volta só do serviço', () => {
  const s = setup();
  s.pedir('listar', { busca: 'x'.repeat(500), de: '2026-11-01', ate: 'ontem', categoria: ['cotação'], extra: 'ignorado' });
  const pedido = s.enviados[0];
  assert.equal(pedido.id, 'servico'); assert.equal(pedido.e, 'emails_pedido');
  assert.match(pedido.d.id, /^emails:/);
  assert.equal(pedido.d.params.busca.length, 200); assert.equal(pedido.d.params.de, '2026-11-01');
  assert.equal(pedido.d.params.ate, ''); assert.equal(pedido.d.params.categoria, ''); assert.equal(pedido.d.params.extra, undefined);
  assert.equal(s.emails.receber('impostor', { id: pedido.d.id, sucesso: true, dados: { itens: [] } }), false);
  assert.equal(s.mensagens.length, 0);
  s.emails.receber('servico', { id: pedido.d.id, sucesso: true, dados: { itens: [{ id: 1 }] } });
  assert.deepEqual(s.ultima(), { e: 'emails_retorno', d: { sucesso: true, requestId: 'r1', acao: 'listar', dados: { itens: [{ id: 1 }] } } });
  s.emails.fechar();
});

test('permissão removida vale na hora: resposta não chega ao navegador', () => {
  const s = setup(); s.pedir('detalhe', { id: 5 });
  s.sessoes.set('sessao', JSON.stringify({ email: 'ana@example.test', expires: Date.now() + 1000, emails_access: false }));
  s.emails.receber('servico', { id: s.enviados[0].d.id, sucesso: true, dados: { corpo: 'segredo' } });
  assert.equal(s.ultima().d.codigo, 'SEM_PERMISSAO'); assert.equal(JSON.stringify(s.mensagens).includes('segredo'), false);
  s.emails.fechar();
});

test('serviço offline devolve FONTE_OFFLINE, nunca lista vazia; queda com pedido pendente também avisa', () => {
  const s = setup({ emails_access: true }, { servico: null }); s.pedir('listar');
  assert.equal(s.ultima().d.codigo, 'FONTE_OFFLINE'); assert.equal(s.ultima().d.dados, undefined); s.emails.fechar();
  const q = setup(); q.pedir('listar'); q.emails.servicoCaiu();
  assert.equal(q.ultima().d.codigo, 'FONTE_OFFLINE'); q.emails.fechar();
});

test('tempo esgotado avisa o navegador', async () => {
  const s = setup({ emails_access: true }, { timeoutMs: 10 }); s.pedir('listar');
  await new Promise(r => setTimeout(r, 30));
  assert.equal(s.ultima().d.codigo, 'TEMPO_ESGOTADO'); s.emails.fechar();
});

test('ação e parâmetros inválidos são recusados sem ir ao serviço', () => {
  const s = setup();
  s.pedir('apagar'); assert.equal(s.ultima().d.codigo, 'ACAO_INVALIDA');
  s.pedir('detalhe', { id: '1 OR 1=1' }); assert.equal(s.ultima().d.codigo, 'PARAMETRO_INVALIDO');
  s.pedir('anexo', { id: 1 }); assert.equal(s.ultima().d.codigo, 'PARAMETRO_INVALIDO');
  assert.equal(s.enviados.length, 0); s.emails.fechar();
});

test('erro do serviço passa adiante sem virar sucesso', () => {
  const s = setup(); s.pedir('listar');
  s.emails.receber('servico', { id: s.enviados[0].d.id, sucesso: true, dados: [] });
  assert.equal(s.ultima().d.sucesso, false); assert.equal(s.ultima().d.codigo, 'ERRO_SERVICO');
  s.pedir('anexo', { id: 1, anexo: 2 });
  s.emails.receber('servico', { id: s.enviados[1].d.id, sucesso: false, codigo: 'ANEXO_BLOQUEADO', erro: 'Bloqueado' });
  assert.equal(s.ultima().d.codigo, 'ANEXO_BLOQUEADO'); s.emails.fechar();
});

test('anexo vira token de uso único com nome seguro', () => {
  const s = setup(); s.pedir('anexo', { id: 1, anexo: 2 });
  s.emails.receber('servico', { id: s.enviados[0].d.id, sucesso: true,
    dados: { nome: '../../<script>.pdf', conteudo: Buffer.from('PDF').toString('base64') } });
  const r = s.ultima().d;
  assert.equal(r.sucesso, true); assert.match(r.dados.url, /^\/emails\/anexo\/[0-9a-f]{64}$/);
  const token = r.dados.url.split('/').pop();
  const a = s.emails.retirarAnexo(token);
  assert.equal(a.conteudo.toString(), 'PDF'); assert.equal(a.nome.includes('/'), false); assert.equal(a.nome.includes('<'), false);
  assert.equal(s.emails.retirarAnexo(token), null);
  assert.equal(s.emails.retirarAnexo('../x'), null);
  assert.equal(nomeSeguro(''), 'anexo');
  s.emails.fechar();
});

test('novidade só para quem ainda tem permissão', () => {
  const s = setup(); s.handlers.emails_entrar(); assert.equal(s.salas.has('emails'), true);
  s.emails.novidade('impostor', { novos: 3 }); assert.equal(s.mensagens.length, 0);
  s.emails.novidade('servico', { novos: 3 }); assert.deepEqual(s.ultima(), { e: 'emails_novidade', d: { novos: 3 } });
  s.sessoes.set('sessao', JSON.stringify({ expires: Date.now() + 1000 }));
  s.emails.novidade('servico', { novos: 1 }); assert.equal(s.salas.has('emails'), false);
  s.emails.fechar();
});
