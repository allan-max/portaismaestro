const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const R = require('../public/dashboard-comum/sincronizar.js');
const B = require('../public/dashboard-comum/base.js');

const ctx = { esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  hora: v => `[${v}]`, icone: () => '' };
const ok = { status: 'ok' };
const dados = (extra = {}) => ({
  fontes: { gerenciador: ok, nf: ok },
  estado: {
    gerenciador: { rodando: [], ultimas: {
      ciclo_coupa: { em: '2026-10-21T14:30:00-03:00', nivel: 'ok', resumo: 'Ciclo automático do Coupa terminou', detalhe: { manual: false } },
      backup: { em: '2026-10-21T07:00:00-03:00', nivel: 'erro', resumo: 'Backup falhou: <rede>', detalhe: { manual: true, por: 'ana@x' } } } },
    nf: { rodando: ['sync_planilha'], ultimas: { nf_completo: { em: '2026-10-21T07:30:00', nivel: 'ok', resumo: '3 NF(s) gravada(s) no portal' } } },
  }, ...extra });

test('status de cada cartão: rodando, ok, erro, parado e offline', () => {
  const d = dados();
  assert.equal(R.status(R.cartao('ciclo_coupa'), d, {}).id, 'ok');
  assert.equal(R.status(R.cartao('backup'), d, {}).id, 'erro');
  assert.equal(R.status(R.cartao('sync_planilha'), d, {}).id, 'rodando');      // rodando pelo Agendador/outra tela
  assert.equal(R.status(R.cartao('ciclo_vale'), d, {}).id, 'parado');
  assert.equal(R.status(R.cartao('atualizador'), d, {}).id, 'parado');         // local: não depende das fontes
  const fora = dados({ fontes: { gerenciador: { status: 'offline', erro: 'O gerenciador está offline.' }, nf: ok } });
  const st = R.status(R.cartao('ciclo_coupa'), fora, {});
  assert.equal(st.id, 'offline'); assert.match(st.texto, /gerenciador está offline/);
  const velho = dados({ fontes: { gerenciador: ok, nf: { status: 'tempo', erro: 'O serviço de NF não respondeu a tempo.' } } });
  assert.match(R.status(R.cartao('nf_completo'), velho, {}).texto, /versão sem este botão/);
});

test('o que aconteceu nesta tela vale mais que a leitura antiga', () => {
  const d = dados();
  assert.equal(R.status(R.cartao('backup'), d, { backup: { rodando: true } }).id, 'rodando');
  assert.equal(R.status(R.cartao('backup'), d, { backup: { resultado: { sucesso: true, mensagem: 'Backup feito' } } }).id, 'ok');
  assert.equal(R.status(R.cartao('ciclo_coupa'), d, { ciclo_coupa: { resultado: { sucesso: false, erro: 'captcha' } } }).id, 'erro');
});

test('página: botão por serviço, desabilitado quando roda ou está offline, e tudo escapado', () => {
  const html = R.pagina(dados(), ctx, {});
  for (const c of R.CARTOES) assert.match(html, new RegExp(`data-servico="${c.id}"`));
  assert.match(html, /<button[^>]*data-servico="sync_planilha"[^>]*disabled/);
  assert.doesNotMatch(html, /<button[^>]*data-servico="ciclo_coupa"[^>]*disabled/);
  assert.match(html, /manual por ana@x/);
  assert.match(html, /Backup falhou: &lt;rede&gt;/);
  assert.doesNotMatch(html, /<rede>/);
  assert.match(html, /07:30/);                                                   // horário automático aparece
});

test('Vale e atualizador pedem confirmação na própria tela antes de disparar', () => {
  assert.ok(R.cartao('ciclo_vale').confirmar && R.cartao('atualizador').confirmar);
  assert.ok(!R.cartao('ciclo_coupa').confirmar && !R.cartao('backup').confirmar);
  const html = R.pagina(dados(), ctx, { ciclo_vale: { confirmando: true } });
  assert.match(html, /OTP/);
  assert.match(html, /data-acao="confirmar" data-servico="ciclo_vale"/);
  assert.match(html, /data-acao="cancelar" data-servico="ciclo_vale"/);
});

test('mensagens ao vivo: progresso, resultado e sem resposta do serviço', () => {
  let vivo = {};
  vivo = R.aoProgresso(vivo, { servico: 'nf_completo', mensagem: 'baixando do HSE' }, 1000);
  assert.deepEqual(vivo.nf_completo, { rodando: true, mensagem: 'baixando do HSE', resposta_em: 1000 });
  vivo = R.aoRetorno(vivo, { servico: 'nf_completo', sucesso: true, mensagem: 'ok' }, '2026-10-21T10:00:00Z');
  assert.equal(vivo.nf_completo.rodando, false);
  assert.equal(vivo.nf_completo.resultado.em, '2026-10-21T10:00:00Z');
  // só o "Disparado por" do portal e nada do serviço em 25 s: avisa que a versão pode não ter o botão
  vivo = R.aoProgresso({ backup: { rodando: true, pedido_em: 0 } }, { servico: 'backup', origem: 'portal', mensagem: 'Disparado' }, 100);
  assert.equal(vivo.backup.resposta_em, undefined);
  vivo = R.verificarSilencio(vivo, 26000);
  assert.equal(vivo.backup.rodando, false);
  assert.match(vivo.backup.resultado.erro, /não respondeu/);
  assert.equal(R.verificarSilencio({ x: { rodando: true, pedido_em: 0, resposta_em: 5 } }, 999999).x.rodando, true);   // já respondeu: ciclo longo segue
});

test('página registrada: html sem script inline, menu com "Rodar agora"', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/sincronizar.html'), 'utf8');
  assert.match(html, /data-dashboard="sincronizar"/);
  assert.match(html, /dashboard-comum\/base\.js/);
  assert.match(html, /dashboard-comum\/sincronizar\.js/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(B.sidebar('monitoramento'), /href="sincronizar\.html"[^>]*>.*Rodar agora/);
  assert.match(B.sidebar('sincronizar'), /href="sincronizar\.html" class="selected"/);
});
