const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarAtividade } = require('../lib/atividade-usuarios');

function setup(agora = 1000) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'atividade-'));
  const relogio = { agora };
  const atividade = criarAtividade({ arquivo: path.join(pasta, 'portal.estado'), agora: () => relogio.agora });
  const lido = () => JSON.parse(fs.readFileSync(path.join(pasta, 'portal.estado'), 'utf8'));
  return { atividade, relogio, lido };
}

test('ação de usuário fica registrada para o atualizador não reiniciar o site no meio', () => {
  const { atividade, relogio, lido } = setup(1000);
  atividade.registrar('solicitar_registro_vendedor_cotacao');
  relogio.agora = 9000;
  atividade.gravar();
  assert.deepEqual(lido(), { em: 9000, ultima_acao_em: 1000 });
});

test('site aberto sem ninguém mexendo não conta: pedidos automáticos da tela são ignorados', () => {
  const { atividade, lido } = setup(5000);
  for (const evento of ['solicitar_sync_nf_estado', 'pedir_estado_findes', 'solicitar_planilha_json', 'solicitar_dashboard_cotacoes',
    'pedir_dados_dashboard', 'sou_frontend']) atividade.registrar(evento);
  atividade.gravar();
  assert.equal(lido().ultima_acao_em, 0);
});

test('falha ao gravar o arquivo não derruba o portal', () => {
  const atividade = criarAtividade({ arquivo: path.join(os.tmpdir(), 'pasta-que-nao-existe-atividade', 'x', 'portal.estado') });
  atividade.marcar();
  assert.doesNotThrow(() => atividade.gravar());
});
