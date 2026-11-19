const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { criarFinanceiro, nomeGravado } = require('../lib/financeiro');

const PDF = '%PDF-1.4 conteudo de teste';

function setup(agora = new Date(2026, 10, 19, 14, 30, 5).getTime()) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'financeiro-'));
  const raiz = path.join(base, 'FINANCEIRO');
  for (const t of ['EXTRATO', 'CARTAO']) {
    for (const sub of ['JA PROCESSADOS', 'ERROS_LEITURA']) fs.mkdirSync(path.join(raiz, t, sub), { recursive: true });
  }
  const arquivoEstado = path.join(base, 'financeiro_envios.json');
  const relogio = { agora };
  const novo = () => criarFinanceiro({ raiz, arquivoEstado, agora: () => relogio.agora });
  const origem = (conteudo = PDF) => {
    const p = path.join(base, `up-${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(p, conteudo);
    return p;
  };
  return { base, raiz, arquivoEstado, relogio, fin: novo(), novo, origem };
}

test('nome gravado: sem acento, sem barra ou ponto, com data e hora no final', () => {
  assert.equal(nomeGravado('Extrato Ação ../x.PDF', new Date(2026, 10, 19, 14, 30, 5)), 'Extrato_Acao_x_20261119_143005.pdf');
  assert.equal(nomeGravado('00911112026.pdf', new Date(2026, 0, 2, 3, 4, 5)), '00911112026_20260102_030405.pdf');
  assert.equal(nomeGravado('...pdf', new Date(2026, 0, 2, 3, 4, 5)), 'arquivo_20260102_030405.pdf');
});

test('nome gravado nunca passa de 80 caracteres antes da data', () => {
  const nome = nomeGravado('a'.repeat(200) + '.pdf', new Date(2026, 0, 2, 3, 4, 5));
  assert.equal(nome, 'a'.repeat(80) + '_20260102_030405.pdf');
});

test('extrato vai para a pasta EXTRATO e fica como enviado', () => {
  const { raiz, fin, origem } = setup();
  const envio = fin.enviar({ tipo: 'extrato', nomeOriginal: 'extrato.pdf', origem: origem(), email: 'a@x' });
  assert.equal(envio.arquivo, 'extrato_20261119_143005.pdf');
  assert.ok(fs.existsSync(path.join(raiz, 'EXTRATO', envio.arquivo)));
  assert.equal(fin.estado().extrato.status, 'enviado');
  assert.equal(fin.estado().extrato.original, 'extrato.pdf');
  assert.equal(fin.estado().cartao, null);
});

test('cartão vai para a pasta CARTAO', () => {
  const { raiz, fin, origem } = setup();
  const envio = fin.enviar({ tipo: 'cartao', nomeOriginal: 'fatura.pdf', origem: origem(), email: 'a@x' });
  assert.ok(fs.existsSync(path.join(raiz, 'CARTAO', envio.arquivo)));
  assert.equal(fin.estado().cartao.id, envio.id);
});

test('mesmo nome no mesmo segundo não sobrescreve: segundo ganha _2', () => {
  const { fin, origem } = setup();
  const a = fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  const b = fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(a.arquivo, 'x_20261119_143005.pdf');
  assert.equal(b.arquivo, 'x_20261119_143005_2.pdf');
});

test('nome que já existe em JA PROCESSADOS também não é reaproveitado', () => {
  const { raiz, fin, origem } = setup();
  fs.writeFileSync(path.join(raiz, 'EXTRATO', 'JA PROCESSADOS', 'x_20261119_143005.pdf'), PDF);
  const e = fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(e.arquivo, 'x_20261119_143005_2.pdf');
});

test('arquivo que não é PDF é recusado e nada é gravado', () => {
  const { raiz, fin, origem } = setup();
  assert.throws(() => fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem('oi'), email: 'a@x' }),
    e => e.codigo === 'NAO_PDF');
  assert.deepEqual(fs.readdirSync(path.join(raiz, 'EXTRATO')).sort(), ['ERROS_LEITURA', 'JA PROCESSADOS']);
});

test('tipo desconhecido é recusado', () => {
  const { fin, origem } = setup();
  assert.throws(() => fin.enviar({ tipo: 'outro', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' }),
    e => e.codigo === 'TIPO_INVALIDO');
});

test('pasta do servidor fora do ar vira PASTA_INDISPONIVEL', () => {
  const { base, arquivoEstado, origem } = setup();
  const fin = criarFinanceiro({ raiz: path.join(base, 'nao-existe'), arquivoEstado });
  assert.throws(() => fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' }),
    e => e.codigo === 'PASTA_INDISPONIVEL');
});

test('robô moveu para JA PROCESSADOS: vira processado uma vez só', () => {
  const { raiz, fin, origem, relogio } = setup();
  const e = fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(fin.conferir(), false);
  fs.renameSync(path.join(raiz, 'EXTRATO', e.arquivo), path.join(raiz, 'EXTRATO', 'JA PROCESSADOS', e.arquivo));
  relogio.agora += 60000;
  assert.equal(fin.conferir(), true);
  assert.equal(fin.estado().extrato.status, 'processado');
  assert.equal(fin.estado().extrato.concluido_em, relogio.agora);
  assert.equal(fin.conferir(), false);
});

test('robô moveu para ERROS_LEITURA: vira erro', () => {
  const { raiz, fin, origem } = setup();
  const e = fin.enviar({ tipo: 'cartao', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  fs.renameSync(path.join(raiz, 'CARTAO', e.arquivo), path.join(raiz, 'CARTAO', 'ERROS_LEITURA', e.arquivo));
  assert.equal(fin.conferir(), true);
  assert.equal(fin.estado().cartao.status, 'erro');
});

test('robô tirou da entrada e ainda não pôs em lugar nenhum: processando', () => {
  const { raiz, fin, origem } = setup();
  const e = fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  fs.unlinkSync(path.join(raiz, 'EXTRATO', e.arquivo));
  assert.equal(fin.conferir(), true);
  assert.equal(fin.estado().extrato.status, 'processando');
});

test('servidor fora do ar na conferência: nada muda e não quebra', () => {
  const { raiz, base, fin, origem } = setup();
  fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  fs.renameSync(raiz, path.join(base, 'sumiu'));
  assert.equal(fin.conferir(), false);
  assert.equal(fin.estado().extrato.status, 'enviado');
});

test('envios sobrevivem a reiniciar o site', () => {
  const { fin, novo, origem } = setup();
  const e = fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(novo().estado().extrato.id, e.id);
});

test('arquivo de estado corrompido começa vazio', () => {
  const { arquivoEstado, novo } = setup();
  fs.writeFileSync(arquivoEstado, '{lixo');
  assert.deepEqual(novo().estado(), { extrato: null, cartao: null });
});

test('guarda só os 50 envios mais recentes', () => {
  const { fin, arquivoEstado, origem, relogio } = setup();
  for (let i = 0; i < 55; i++) { relogio.agora += 1000; fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' }); }
  const salvo = JSON.parse(fs.readFileSync(arquivoEstado, 'utf8'));
  assert.equal(salvo.envios.length, 50);
});
