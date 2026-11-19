const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../public/financeiro.html'), 'utf8');

test('tela envia o PDF para a rota do Financeiro', () => {
  assert.ok(html.includes("'/api/financeiro/enviar'"));
  assert.match(html, /fd\.append\('pdf'/);
  assert.match(html, /fd\.append\('tipo'/);
  assert.match(html, /fd\.append\('sessionId'/);
});

test('tela pede e escuta o estado das pastas', () => {
  assert.ok(html.includes("socket.emit('pedir_financeiro_estado')"));
  assert.ok(html.includes("socket.on('financeiro_estado'"));
});

test('trilha mostra as pastas do robô e o resultado', () => {
  for (const t of ['JA PROCESSADOS', 'ERROS_LEITURA', 'data-pasta="\\EXTRATO"', 'data-pasta="\\CARTAO"', 'Concluído', 'Erro na leitura']) {
    assert.ok(html.includes(t), t);
  }
});

test('aviso de demora depois de 30 minutos', () => {
  assert.match(html, /30 \* 60 \* 1000/);
  assert.ok(html.includes('O robô ainda não pegou o arquivo'));
});

test('não diz mais que o envio está indisponível', () => {
  assert.ok(!html.includes('ainda não está disponível'));
  assert.ok(!html.includes('<button class="btn" disabled>'));
});

test('erro fica 20 s na trilha e depois a linha volta ao começo', () => {
  assert.match(html, /ERRO_VISIVEL_MS = 20 \* 1000/);
  assert.ok(html.includes('estado.agora'));
});

test('painel de erros à direita com botão Limpar', () => {
  assert.ok(html.includes('id="painel-erros"'));
  assert.ok(html.includes("socket.emit('financeiro_limpar_erro'"));
  assert.ok(html.includes('>Limpar<'));
});
