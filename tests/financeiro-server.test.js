const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const rota = server.slice(server.indexOf("app.post('/api/financeiro/enviar'"));
const blocoRota = rota.slice(0, rota.indexOf('\n});') + 4);

test('rota de envio do Financeiro existe e confere sessão e permissão', () => {
  assert.ok(server.includes("app.post('/api/financeiro/enviar'"));
  assert.match(blocoRota, /lerSessao\(cofreSessoes/);
  assert.match(blocoRota, /podeFinanceiro\(ficha\)/);
  assert.match(blocoRota, /status\(401\)/);
  assert.match(blocoRota, /status\(403\)/);
});

test('arquivo temporário do upload sai do disco em todos os caminhos', () => {
  assert.match(blocoRota, /finally\s*\{[^}]*fs\.unlink\(/);
});

test('só setor financeiro ou admin pode usar', () => {
  assert.match(server, /function podeFinanceiro\(ficha\)\s*\{\s*return !!ficha && \(ficha\.setor === 'financeiro' \|\| ficha\.admin === true\);/);
});

test('tela entra na sala financeiro e recebe o estado', () => {
  const i = server.indexOf("socket.on('pedir_financeiro_estado'");
  assert.ok(i > 0);
  const bloco = server.slice(i, i + 600);
  assert.match(bloco, /podeFinanceiro\(/);
  assert.match(bloco, /socket\.join\('financeiro'\)/);
  assert.match(bloco, /emit\('financeiro_estado'/);
});

test('conferência periódica das pastas avisa a sala quando muda', () => {
  assert.match(server, /if \(financeiro\.conferir\(\)\) io\.to\('financeiro'\)\.emit\('financeiro_estado', financeiro\.estado\(\)\)/);
  assert.match(server, /FINANCEIRO_DIR/);
});
