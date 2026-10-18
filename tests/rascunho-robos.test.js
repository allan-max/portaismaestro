// Fase 5 do plano dos robôs (gerenciador-maestro docs/melhorias-bots): RASCUNHO no dashboard e painel Robôs na Atividade.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../public/dashboard-cotacoes/dados');
const A = require('../public/dashboard-comum/atividade');

const br = iso => `${iso.slice(8)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const daqui = dias => br(D.day(D.TODAY, dias));

test('RASCUNHO é um status próprio e conta como sem resposta (pendente)', () => {
  const rows = D.normalizeRows([
    { 'COTAÇÃO': '1', VENDEDOR: 'ANA', VENCIMENTO: daqui(3), RESPOSTA: 'RASCUNHO' },
    { 'COTAÇÃO': '2', VENDEDOR: 'ANA', VENCIMENTO: daqui(3), RESPOSTA: 'RESPONDIDO' },
    { 'COTAÇÃO': '3', VENDEDOR: 'ANA', VENCIMENTO: daqui(-2), RESPOSTA: 'rascunho' }
  ]);
  assert.deepEqual(rows.map(r => r.status), ['draft', 'responded', 'draft']);
  assert.equal(D.STATUS.draft.short, 'Rascunho');
  const m = D.metrics(rows);
  assert.equal(m.draft, 2);
  assert.equal(m.pendingActive, 1);          // o rascunho no prazo ainda não foi enviado
  assert.equal(m.overdue, 1);                // e o vencido conta como vencido sem resposta
  assert.equal(m.responded, 1);
  assert.deepEqual(D.select(rows, { status: 'draft' }).map(r => r.number), ['1', '3']);
  assert.deepEqual(D.select(rows, { deadline: 'pendingActive' }).map(r => r.number), ['1']);
});

const ev = (servico, tipo, nivel, em, extra = {}) => ({ servico, tipo, nivel, em, resumo: `${servico} ${tipo}`, ...extra });

test('painel Robôs: última verificação e alerta de inatividade que ainda vale', () => {
  const eventos = [
    ev('coupa', 'verificacao_concluida', 'ok', '2026-10-18T09:00:00-03:00', { detalhe: { encontradas: 40, total: 44, mudancas: 12 } }),
    ev('coupa', 'verificacao_concluida', 'ok', '2026-10-17T09:00:00-03:00', { detalhe: { encontradas: 1, total: 9, mudancas: 0 } }),
    ev('vale', 'robo_inativo', 'erro', '2026-10-18T08:00:00-03:00', { resumo: 'Robô vale sem extração concluída há 7 h' }),
    ev('coupa', 'robo_inativo', 'erro', '2026-10-17T05:00:00-03:00'),
    ev('coupa', 'ciclo', 'ok', '2026-10-17T07:00:00-03:00'),          // resolveu o alerta do Coupa
    ev('vale', 'ciclo', 'info', '2026-10-18T09:00:00-03:00')           // ciclo começou, não terminou: alerta da Vale continua
  ];
  const [coupa, vale] = A.robos(eventos);
  assert.equal(coupa.verificacao.detalhe.encontradas, 40);
  assert.equal(coupa.inativo, null);
  assert.equal(vale.verificacao, null);
  assert.match(vale.inativo.resumo, /7 h/);

  const html = A.pagina({ eventos, fontes: {} }, { agora: () => Date.parse('2026-10-18T10:00:00-03:00'), num: n => String(n) });
  assert.match(html, /Robôs/);
  assert.match(html, /40\/44 pendentes encontradas · 12 status alterados/);
  assert.match(html, /Nenhuma verificação nos últimos 7 dias/);
  assert.match(html, /class="tag vermelho">Robô vale sem extração/);
});

test('painel Robôs escapa o texto dos eventos', () => {
  const html = A.pagina({ eventos: [ev('vale', 'robo_inativo', 'erro', '2026-10-18T08:00:00Z', { resumo: '<img src=x onerror=1>' })], fontes: {} },
    { agora: () => Date.parse('2026-10-18T10:00:00Z'), num: n => String(n) });
  assert.ok(!html.includes('<img src=x'));
});
