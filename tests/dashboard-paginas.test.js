const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../public/dashboard-comum/saude.js');
const N = require('../public/dashboard-comum/nfs.js');
const A = require('../public/dashboard-comum/atividade.js');
const M = require('../public/dashboard-comum/monitoramento.js');
const C = require('../public/dashboard-comum/contas.js');
const B = require('../public/dashboard-comum/base.js');
const L = require('../lib/logs-txt.js');

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
  for (const [arq, nome] of [['dashboard.html', 'contas'], ['sync.html', 'sync'], ['nfs.html', 'nfs'], ['atividade.html', 'atividade'], ['dashboard2.html', 'cotacoes'], ['monitoramento.html', 'monitoramento']]) {
    const html = pub(arq);
    assert.match(html, new RegExp(`data-dashboard="${nome}"`)); assert.match(html, /<div id="dash-topo"><\/div>/);
    assert.match(html, /dashboard-comum\/base\.js/); assert.match(html, /dashboard-comum\/comum\.css/);
    assert.doesNotMatch(html, /<script>/);                                             // nada inline
  }
  assert.match(pub('dashboard2.html'), /dashboard-cotacoes\/app\.js/);
  assert.match(pub('dashboard.html'), /dashboard-comum\/contas\.js/);
  const sb = B.sidebar('monitoramento');
  for (const href of ['dashboard2.html', 'sync.html', 'nfs.html', 'atividade.html', 'monitoramento.html', 'dashboard.html']) assert.match(sb, new RegExp(`href="${href}`));
  for (const sec of ['Gestão comercial', 'Operação e robôs', 'Pedidos e planilha', 'Controle e admin']) assert.match(sb, new RegExp(sec));
  const htmlContas = C.pagina({ usuarios: { 'ana@teste.com': { admin: true, vendedor: 'ANA', planilha_access: true, portais_access: true } } }, ctx, {}, { configAberta: true, configDados: { INTERVALO_VERIFICACAO: 300 } });
  assert.match(htmlContas, /Contas e privilégios/);
  assert.match(htmlContas, /ana@teste\.com/);
  assert.match(htmlContas, /Variáveis do robô \(CONFIG\.json\)/);
  assert.match(pub('dashboard-comum/comum.css'), /prefers-reduced-motion: reduce/);

  const dados = {
    conexoes: { gerenciador: online, nf: online },
    estado_nf: estadoNf({ sync_planilha_portal: { adiado: true, aviso: 'Planilha em modo somente leitura', gerado_em: '15/10/2026 14:30:00' } }),
    robos: { global: { status: 'extraindo', portal_atual: 'coupa' }, me: { status: 'ocioso' }, ariba: { status: 'ocioso' } },
    eventos: [
      ev(5, { servico: 'vale', tipo: 'robo_inativo', nivel: 'erro', resumo: 'Timeout na requisição - API <Vale>' }),
      ev(12, { servico: 'coupa', tipo: 'ciclo', nivel: 'ok', resumo: 'Cotação 4387 processada' }),
      ev(20, { servico: 'ariba', tipo: 'ciclo', nivel: 'ok', resumo: 'Extração AEGEA concluída' }),
      ev(25, { servico: 'me', tipo: 'ciclo', nivel: 'ok', resumo: 'Extração Mercado Eletrônico concluída' }),
      ev(30, { servico: 'findes', tipo: 'ciclo', nivel: 'ok', resumo: 'Coleta CDE Findes concluída' }),
    ],
  };
  const sis = M.sistemas(dados, AGORA);
  assert.equal(sis.length, 10);
  assert.equal(sis.find(s => s.id === 'coupa').status, 'Em execução');
  assert.equal(sis.find(s => s.id === 'vale').cor, 'vermelho');
  assert.equal(sis.find(s => s.id === 'sync_planilha').cor, 'amarelo');
  for (const id of ['gerenciador', 'nf', 'cadastro', 'ariba', 'me', 'findes', 'impressao']) {
    assert.equal(sis.find(s => s.id === id).cor, 'verde');
  }
  const html = M.pagina(dados, ctx);
  assert.match(html, /Status dos sistemas e robôs/);
  assert.match(html, /Gráfico de execuções/);
  assert.match(html, /Logs recentes/);
  assert.match(html, /Alertas que exigem atenção/);
  assert.match(html, /Robô SAP Ariba/);
  assert.match(html, /Mercado Eletrônico/);
  assert.match(html, /Robô Findes/);
  assert.doesNotMatch(html, /<Vale>/);
  assert.match(html, /&lt;Vale&gt;/);
  assert.match(html, /log-coupa\.txt/);
  assert.match(html, /mercadoeletronico\.txt/);
  const htmlComModal = M.pagina(dados, ctx, undefined, {
    logAberto: true,
    logModulo: 'coupa',
    logResposta: {
      sucesso: true, id: 'coupa', nome: 'Robô Coupa', arquivo: 'log-coupa.txt',
      caminho: '\\\\SERVIDOR2\\Publico\\ALLAN\\Logs\\log-coupa.txt',
      tamanho: 44239701, modificado_em: '2026-10-20T10:25:47',
      linhas: ['10:25:45 [INFO] Paragem/Extração concluída! <teste>'],
    },
  });
  assert.match(htmlComModal, /class="mon-log-modal"/);
  assert.match(htmlComModal, /\\\\SERVIDOR2\\Publico\\ALLAN\\Logs\\log-coupa\.txt/);
  assert.match(htmlComModal, /Paragem\/Extração concluída! &lt;teste&gt;/);
  assert.doesNotMatch(htmlComModal, /<teste>/);
  assert.doesNotMatch(htmlComModal, /stopPropagation/);
  assert.match(htmlComModal, /data-acao="log-anterior"/);
  assert.match(htmlComModal, /data-acao="log-proximo"/);
  assert.match(htmlComModal, /data-acao="fechar-log"/);
  assert.equal(M.proximoModuloLog('coupa', 1), 'me');
  assert.match(html, /Total crescente/);
  assert.match(html, /mon-line azul/);
  assert.match(html, /mon-line amarelo/);

  // Detecção de sessão finalizada (Offline), retomada (Online) e erros pelo arquivo TXT
  const estFim = L.analisarEstadoLog(['Processamento concluído com sucesso!', '=== SESSÃO FINALIZADA ==='], new Date(), { id: 'me', modulo: 'me', arquivo: 'mercadoeletronico.txt' });
  assert.equal(estFim.estado_log, 'offline');
  const estVoltou = L.analisarEstadoLog(['=== SESSÃO FINALIZADA ===', '11:02:26 [INFO] Iniciando Login Inteligente'], new Date(), { id: 'coupa', modulo: 'coupa', arquivo: 'log-coupa.txt' });
  assert.equal(estVoltou.estado_log, 'online');
  const estErro = L.analisarEstadoLog(['10:58:19 [INFO] Robo pausado', '11:01:20 [ERROR] Erro na verificação: Tempo esgotado! O código OTP não foi inserido.'], new Date(), { id: 'vale', modulo: 'vale', arquivo: 'log-vale.txt' });
  assert.equal(estErro.estado_log, 'erro');
  assert.match(estErro.ultimo_erro, /Tempo esgotado/);

  const sisComLogs = M.sistemas({
    conexoes: { gerenciador: online, nf: online },
    arquivos_log: {
      me: { id: 'me', modulo: 'me', arquivo: 'mercadoeletronico.txt', disponivel: true, modificado_em: AGORA.toISOString(), estado_log: 'offline' },
      findes: { id: 'findes', modulo: 'findes', arquivo: 'findes.txt', disponivel: true, modificado_em: AGORA.toISOString(), estado_log: 'online' },
      ariba: { id: 'ariba', modulo: 'ariba', arquivo: 'aribasourcing.txt', disponivel: true, modificado_em: AGORA.toISOString(), estado_log: 'erro', ultimo_erro: 'Falha no login na conta 2' },
    },
  }, AGORA);
  assert.equal(sisComLogs.find(s => s.id === 'me').status, 'Offline');
  assert.equal(sisComLogs.find(s => s.id === 'findes').status, 'Online');
  assert.equal(sisComLogs.find(s => s.id === 'ariba').status, 'Erro');
  const alertasLog = M.alertasAtivos({
    arquivos_log: {
      ariba: { id: 'ariba', modulo: 'ariba', arquivo: 'aribasourcing.txt', disponivel: true, modificado_em: AGORA.toISOString(), estado_log: 'erro', ultimo_erro: 'Falha no login na conta 2' },
    },
  }, sisComLogs, AGORA);
  assert.equal(alertasLog.some(a => /aribasourcing\.txt/.test(a.titulo) && /Falha no login/.test(a.texto)), true);
  assert.equal(L.formatarNomeRoboDeArquivo('log-petrobras.txt').nome, 'Robô Petrobras');
  const dadosComRoboNovo = {
    ...dados,
    arquivos_log: {
      robo_petrobras: {
        id: 'robo_petrobras', modulo: 'robo_petrobras', nome: 'Robô Petrobras',
        arquivo: 'log-petrobras.txt', disponivel: true, auto: true,
        modificado_em: AGORA.toISOString(), estado_log: 'online',
      },
    },
  };
  const sisAuto = M.sistemas(dadosComRoboNovo, AGORA);
  assert.equal(sisAuto.length, 11);
  assert.equal(sisAuto.some(s => s.id === 'robo_petrobras' && s.nome === 'Robô Petrobras' && s.auto), true);
  assert.equal(M.proximoRoboGrafico('', 1, sisAuto), 'gerenciador');
  const htmlGraficoCoupa = M.pagina(dadosComRoboNovo, ctx, { periodo: '24h', servico: '', nivel: '', categoria: '', busca: '', roboGrafico: 'coupa' });
  assert.match(htmlGraficoCoupa, /Gráfico de execuções · Robô Coupa/);
  assert.match(htmlGraficoCoupa, /data-acao="grafico-robo-ant"/);
  assert.match(htmlGraficoCoupa, /data-acao="grafico-robo-prox"/);
  assert.match(htmlGraficoCoupa, /log-petrobras\.txt/);
});


test('monitoramento: log inicia no final ao abrir e preserva scroll quando o usuário sobe ou rola Status dos sistemas e robôs', () => {
  const opModal = {
    logAberto: true,
    logModulo: 'coupa',
    logNoFinal: true,
    logResposta: {
      sucesso: true, id: 'coupa', nome: 'Robô Coupa', arquivo: 'log-coupa.txt',
      caminho: '\\\\SERVIDOR2\\Publico\\ALLAN\\Logs\\log-coupa.txt',
      linhas: ['Linha 1', 'Linha 2', 'Linha final'],
    },
  };
  const html = M.pagina({}, ctx, undefined, opModal);
  assert.match(html, /id="mon-sis-table-wrap"/);
  assert.match(html, /id="mon-log-tabs-bar"/);
  assert.match(html, /id="mon-chart-chips"/);
  assert.match(html, /data-log-key="coupa\|0\|\|3\|\|0\|400"/);
  assert.match(html, /data-scroll-final="1"/);

  // Ao abrir o log, começa no final (scrollTop = scrollHeight)
  const estadoScroll = { logNoFinal: true, logScrollTop: null };
  const fakeTerm = { scrollTop: 0, scrollHeight: 5000, clientHeight: 500, hasLines: true };
  M.aplicarScrollTerminal(fakeTerm, estadoScroll);
  assert.equal(fakeTerm.scrollTop, 5000, 'Ao entrar no log deve posicionar direto no final');
  assert.equal(estadoScroll.logNoFinal, true);

  // Usuário rola para cima (ex: scrollTop = 1200)
  M.atualizarEstadoScrollLog(estadoScroll, { scrollTop: 1200, scrollHeight: 5000, clientHeight: 500, temLinhas: true });
  assert.equal(estadoScroll.logNoFinal, false, 'Ao subir no log, desativa auto-scroll para o final');
  assert.equal(estadoScroll.logScrollTop, 1200);

  // Mesmo após novo render (onde novo elemento começaria em 0), aplica a posição salva (1200) sem voltar ao topo nem pular para o fim
  const fakeTermReRender = { scrollTop: 0, scrollHeight: 5200, clientHeight: 500, hasLines: true };
  M.aplicarScrollTerminal(fakeTermReRender, estadoScroll);
  assert.equal(fakeTermReRender.scrollTop, 1200, 'Não deve resetar para o topo (0) nem forçar para o final quando o usuário subiu');

  // Se o usuário rolar de volta até o final, volta a acompanhar o final automaticamente
  M.atualizarEstadoScrollLog(estadoScroll, { scrollTop: 4700, scrollHeight: 5200, clientHeight: 500, temLinhas: true });
  assert.equal(estadoScroll.logNoFinal, true);
});
