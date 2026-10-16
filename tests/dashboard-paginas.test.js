const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../public/dashboard-comum/saude.js');
const N = require('../public/dashboard-comum/nfs.js');
const A = require('../public/dashboard-comum/atividade.js');

const AGORA = new Date(2026, 9, 15, 15, 0);   // quinta, 15/10/2026 15:00
const ctx = { agora: () => AGORA, icone: () => '', hora: v => String(v), data: S.hora, num: (n, c = '') => `<strong class="${c}">${n}</strong>` };
const cor = (itens, id) => itens.find(i => i.id === id).cor;

// -- saúde --------------------------------------------------------------------
const estadoNf = (extra = {}) => ({
  historico: [{ rodou_em: '2026-10-15T12:30:21', sucesso: true, origem: 'linha de comando' }],
  cadastro_pedidos: { ativo: true, verificado_em: '15/10/2026 14:52:01', cadastrados_hoje: 2 },
  sync_planilha_portal: { gerado_em: '15/10/2026 12:37:06' }, ...extra });
const saude = (conexoes, estado = estadoNf(), extra = {}) => ({ conexoes, estado_nf: estado, ...extra });
const online = { online: true, visto_em: new Date(AGORA - 3 * 60000).toISOString() };

test('saúde: tudo em dia fica verde e os números de cotações vêm do dados.js', () => {
  const itens = S.calcular(saude({ gerenciador: online, nf: online }), { today: 0, overdue: 12, next7: 4 }, AGORA);
  assert.deepEqual(itens.map(i => i.cor), ['verde', 'verde', 'verde', 'verde', 'verde', 'verde']);
  assert.match(itens[0].texto, /visto há 3 min/);
  assert.deepEqual(itens[5].cotas.map(c => [c.prazo, c.n]), [['today', 0], ['overdue', 12], ['next7', 4]]);
  assert.match(S.html(itens), /href="dashboard2\.html\?prazo=overdue"/);
});

test('saúde: serviço offline fica vermelho e a NF sem dados fica cinza (não verde, não zero)', () => {
  const itens = S.calcular(saude({ gerenciador: online, nf: { online: false, desconectado_em: '2026-10-15T14:10:00-03:00' } },
    null, { estado_nf_erro: 'O serviço de NF está offline.' }), null, AGORA);
  assert.equal(cor(itens, 'nf'), 'vermelho'); assert.match(itens[1].texto, /Offline desde/);
  assert.equal(cor(itens, 'nf_rodada'), 'cinza'); assert.match(itens[2].texto, /offline/);
  assert.equal(cor(itens, 'cadastro'), 'cinza'); assert.equal(cor(itens, 'sync'), 'cinza');
  assert.equal(cor(itens, 'cotacoes'), 'cinza');                                     // base ainda carregando
  assert.equal(S.calcular(null, null, AGORA)[0].cor, 'cinza');
});

test('saúde: falha da NF, rodada velha, cadastro parado, sync adiada e vencendo hoje', () => {
  const falhou = S.calcular(saude({}, estadoNf({ historico: [{ rodou_em: '2026-10-15T12:30:21', sucesso: false, erro: 'HSE fora' }] })), null, AGORA);
  assert.equal(cor(falhou, 'nf_rodada'), 'vermelho'); assert.match(falhou[2].texto, /HSE fora/);
  const velha = S.calcular(saude({}, estadoNf({ historico: [{ rodou_em: '2026-10-13T12:30:00', sucesso: true }] })), null, AGORA);
  assert.equal(cor(velha, 'nf_rodada'), 'amarelo');
  const segunda = new Date(2026, 9, 19, 9, 0);                                        // segunda cedo: sexta 12:30 ainda vale
  assert.equal(cor(S.calcular(saude({}, estadoNf({ historico: [{ rodou_em: '2026-10-16T12:30:00', sucesso: true }] })), null, segunda), 'nf_rodada'), 'verde');
  const cad = m => cor(S.calcular(saude({}, estadoNf({ cadastro_pedidos: { ativo: true, verificado_em: m } })), null, AGORA), 'cadastro');
  assert.equal(cad('15/10/2026 14:20:00'), 'amarelo'); assert.equal(cad('15/10/2026 12:00:00'), 'vermelho');
  assert.equal(cor(S.calcular(saude({}, estadoNf({ cadastro_pedidos: { ativo: true, erro: { mensagem: 'Planilha corrompida' } } })), null, AGORA), 'cadastro'), 'vermelho');
  assert.equal(cor(S.calcular(saude({}, estadoNf({ sync_planilha_portal: { adiado: true, aviso: 'Planilha aberta' } })), null, AGORA), 'sync'), 'amarelo');
  assert.equal(cor(S.calcular(saude({}, estadoNf({ sync_planilha_portal: { erro: 'Portal mudou' } })), null, AGORA), 'sync'), 'vermelho');
  assert.equal(cor(S.calcular(saude({}), { today: 3, overdue: 0, next7: 3 }, AGORA), 'cotacoes'), 'amarelo');
});

test('saúde: texto dos serviços é escapado', () => {
  const html = S.html(S.calcular(saude({}, estadoNf({ sync_planilha_portal: { erro: '<img src=x onerror=alert(1)>' } })), null, AGORA));
  assert.doesNotMatch(html, /<img/); assert.match(html, /&lt;img/);
});

// -- NFs ----------------------------------------------------------------------
const painelNf = (extra = {}) => ({
  indicadores: { com_nf: 507, total: 581, sem_nf: 74, divergencias: 8, ultima_sincronizacao: '2026-10-15T12:30:21', periodo: { de: '01/01/2025', ate: '15/10/2026' } },
  relatorio: { total_sem_nf: 4, sem_nf: [
    { pedido: '1', rfq: 'R1', produto: 'MONITOR <b>24</b>', cidade: 'ITABIRA', entrega: '01/06/2026', dias_desde_entrega: 136, motivo: 'Pedido não achado no HSE' },
    { pedido: '2', produto: 'MOUSE', entrega: '01/09/2026', dias_desde_entrega: 44, motivo: 'x' },
    { pedido: '3', produto: 'TECLADO', entrega: '10/10/2026', dias_desde_entrega: 5, motivo: 'x' },
    { pedido: '4', produto: 'CABO', entrega: '24-Jun', dias_desde_entrega: null, motivo: 'x' }],
    total_divergencias: 1, divergencias: [{ pedido: '9', nf_portal: '15730', nf_hse: '15730', motivo: 'Valor diferente: planilha 100.00 × HSE 90.00' }] },
  nf_so_no_portal: { total: 507, itens: null, gerado_em: 'x' },
  rodadas: [{ inicio: '2026-10-15T12:30:01', rodou_em: '2026-10-15T12:30:21', sucesso: true, gravou: true, nfs_gravadas: 2, origem: 'agendado' },
    { rodou_em: '2026-10-14T07:30:00', sucesso: false, erro: 'HSE <fora>' }],
  cadastro: { ativo: true, verificado_em: '15/10/2026 14:52:01', cadastrados_hoje: 0, historico: [] }, ...extra });

test('NFs: faixas de antiguidade e filtro pela faixa clicada', () => {
  assert.deepEqual([0, 7, 8, 30, 31, 90, 91, null, undefined].map(N.faixa),
    ['ate7', 'ate7', 'ate30', 'ate30', 'ate90', 'ate90', 'mais90', 'semdata', 'semdata']);
  const f = { lista: 'sem_nf', faixa: 'ate90', busca: '' };
  assert.deepEqual(N.itens(painelNf(), f).map(i => i.pedido), ['2']);
  assert.deepEqual(N.itens(painelNf(), { ...f, faixa: '', busca: 'cabo' }).map(i => i.pedido), ['4']);
  assert.equal(N.itens(painelNf(), { lista: 'divergencias', faixa: '', busca: '' }).length, 1);
});

test('NFs: página tem anel, listas, "o que é / o que fazer", botão para a Planilha Vale e escapa tudo', () => {
  const html = N.pagina(painelNf(), ctx);
  assert.match(html, /class="anel"/); assert.match(html, /507<\/strong>/); assert.match(html, /87\.3%/);
  assert.match(html, /<b>O que é<\/b>/); assert.match(html, /<b>O que fazer<\/b>/);
  assert.match(html, /href="planilha_vale\.html">Abrir ações de NF/);
  assert.match(html, /levou 20 s/);                                                   // início e fim da rodada
  assert.doesNotMatch(html, /<b>24<\/b>|<fora>/); assert.match(html, /&lt;b&gt;24/);
  const conf = N.pagina(painelNf(), ctx, { lista: 'portal_planilha', faixa: '', busca: '' });
  assert.match(conf, /507 pedido\(s\) nessa situação\. A lista detalhada aparece/);
});

test('NFs: parte que falhou mostra o erro e "indisponível", nunca zero', () => {
  const html = N.pagina(painelNf({ indicadores: { erro: 'Ainda não gerado.' }, relatorio: { erro: 'Erro ao ler: disco' } }), ctx);
  assert.match(html, /indisponível/); assert.match(html, /Erro ao ler: disco/);
  assert.doesNotMatch(html, /Pedidos sem NF<\/small><strong[^>]*>0</);
  assert.equal(N.falhou({ erro: 'x' }), true); assert.equal(N.falhou({ erro: null, total: 3 }), false);
});

// -- Atividade -----------------------------------------------------------------
const ev = (min, extra = {}) => ({ em: new Date(AGORA - min * 60000).toISOString(), servico: 'gerenciador', tipo: 'resposta', nivel: 'info',
  resumo: 'Status de resposta mudou em 1 cotação(ões)', ref: String(min), detalhe: { mudancas: [`${min}: RESPONDIDO`] }, fonte: 'gerenciador', ...extra });

test('atividade: eventos iguais em sequência viram um item; tipo diferente quebra o grupo', () => {
  const lista = [ev(1), ev(2), ev(3), ev(4, { servico: 'coupa', tipo: 'ciclo', nivel: 'ok', resumo: 'Ciclo automático do Coupa terminou' }), ev(30), ev(31)];
  assert.deepEqual(A.agrupar(lista).map(g => g.itens.length), [3, 1, 2]);
  assert.deepEqual(A.agrupar([ev(1), ev(20)]).map(g => g.itens.length), [1, 1]);   // mais de 10 min: separa
  const html = A.pagina({ eventos: lista, fontes: { gerenciador: { status: 'ok' }, nf: { status: 'ok' } } }, ctx);
  assert.match(html, /3× Status de resposta mudou/);
});

test('atividade: filtro por serviço, nível e busca; erros no topo; fonte que caiu é avisada', () => {
  const lista = [ev(1, { nivel: 'erro', servico: 'nf', resumo: 'Sincronização de NF falhou: <b>HSE</b>' }), ev(2), ev(3, { servico: 'vale', resumo: 'nova da Vale', tipo: 'cotacao_nova' })];
  assert.deepEqual(A.filtrar(lista, { servico: 'vale' }).map(e => e.servico), ['vale']);
  assert.equal(A.filtrar(lista, { nivel: 'erro' }).length, 1);
  assert.equal(A.filtrar(lista, { busca: '2: respondido' }).length, 1);              // busca no detalhe
  const html = A.pagina({ eventos: lista, fontes: { gerenciador: { status: 'tempo', erro: 'O gerenciador não respondeu a tempo.' }, nf: { status: 'ok', erros: { cadastro: 'JSON quebrado' } } } }, ctx);
  assert.match(html, /class="erros-topo/); assert.match(html, /1 erro\(s\) nas últimas 24 h/);
  assert.match(html, /O gerenciador não respondeu a tempo/); assert.match(html, /Cadastro: JSON quebrado/);
  assert.doesNotMatch(html, /<b>HSE/); assert.match(html, /&lt;b&gt;HSE/);
  const muitos = Array.from({ length: 200 }, (_, i) => ev(i * 20));
  assert.match(A.pagina({ eventos: muitos, fontes: {} }, ctx, {}, 200), /data-acao="mais"/);
  assert.doesNotMatch(A.pagina({ eventos: muitos.slice(0, 50), fontes: {} }, ctx, {}, 200), /data-acao="mais"/);
});

// -- páginas ------------------------------------------------------------------------
test('as 4 páginas têm a barra, a faixa e só scripts locais; dashboard2 mudou o mínimo', () => {
  const pub = p => fs.readFileSync(path.join(__dirname, '../public', p), 'utf8');
  for (const [arq, nome] of [['sync.html', 'sync'], ['nfs.html', 'nfs'], ['atividade.html', 'atividade'], ['dashboard2.html', 'cotacoes']]) {
    const html = pub(arq);
    assert.match(html, new RegExp(`data-dashboard="${nome}"`)); assert.match(html, /<div id="dash-topo"><\/div>/);
    assert.match(html, /dashboard-comum\/base\.js/); assert.match(html, /dashboard-comum\/comum\.css/);
    assert.doesNotMatch(html, /<script>/);                                             // nada inline
  }
  assert.match(pub('dashboard2.html'), /dashboard-cotacoes\/app\.js/);
  for (const href of ['dashboard2.html', 'sync.html', 'nfs.html', 'atividade.html']) assert.match(pub('dashboard.html'), new RegExp(`href="${href}"`));
  assert.match(pub('dashboard-comum/comum.css'), /prefers-reduced-motion: reduce/);
});
