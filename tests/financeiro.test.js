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

test('nome gravado: sem acento, sem barra ou ponto, com data e hora no final', async () => {
  assert.equal(nomeGravado('Extrato Ação ../x.PDF', new Date(2026, 10, 19, 14, 30, 5)), 'Extrato_Acao_x_20261119_143005.pdf');
  assert.equal(nomeGravado('00911112026.pdf', new Date(2026, 0, 2, 3, 4, 5)), '00911112026_20260102_030405.pdf');
  assert.equal(nomeGravado('...pdf', new Date(2026, 0, 2, 3, 4, 5)), 'arquivo_20260102_030405.pdf');
});

test('nome gravado nunca passa de 80 caracteres antes da data', async () => {
  const nome = nomeGravado('a'.repeat(200) + '.pdf', new Date(2026, 0, 2, 3, 4, 5));
  assert.equal(nome, 'a'.repeat(80) + '_20260102_030405.pdf');
});

test('extrato vai para a pasta EXTRATO e fica como enviado', async () => {
  const { raiz, fin, origem } = setup();
  const envio = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'extrato.pdf', origem: origem(), email: 'a@x' });
  assert.equal(envio.arquivo, 'extrato_20261119_143005.pdf');
  assert.ok(fs.existsSync(path.join(raiz, 'EXTRATO', envio.arquivo)));
  assert.equal(fin.estado().extrato.status, 'enviado');
  assert.equal(fin.estado().extrato.original, 'extrato.pdf');
  assert.equal(fin.estado().cartao, null);
});

test('cartão vai para a pasta CARTAO', async () => {
  const { raiz, fin, origem } = setup();
  const envio = await fin.enviar({ tipo: 'cartao', nomeOriginal: 'fatura.pdf', origem: origem(), email: 'a@x' });
  assert.ok(fs.existsSync(path.join(raiz, 'CARTAO', envio.arquivo)));
  assert.equal(fin.estado().cartao.id, envio.id);
});

test('mesmo nome no mesmo segundo não sobrescreve: segundo ganha _2', async () => {
  const { fin, origem } = setup();
  const a = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  const b = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(a.arquivo, 'x_20261119_143005.pdf');
  assert.equal(b.arquivo, 'x_20261119_143005_2.pdf');
});

test('nome que já existe em JA PROCESSADOS também não é reaproveitado', async () => {
  const { raiz, fin, origem } = setup();
  fs.writeFileSync(path.join(raiz, 'EXTRATO', 'JA PROCESSADOS', 'x_20261119_143005.pdf'), PDF);
  const e = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(e.arquivo, 'x_20261119_143005_2.pdf');
});

test('arquivo que não é PDF é recusado e nada é gravado', async () => {
  const { raiz, fin, origem } = setup();
  await assert.rejects(() => fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem('oi'), email: 'a@x' }),
    e => e.codigo === 'NAO_PDF');
  assert.deepEqual(fs.readdirSync(path.join(raiz, 'EXTRATO')).sort(), ['ERROS_LEITURA', 'JA PROCESSADOS']);
});

test('tipo desconhecido é recusado', async () => {
  const { fin, origem } = setup();
  await assert.rejects(() => fin.enviar({ tipo: 'outro', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' }),
    e => e.codigo === 'TIPO_INVALIDO');
});

test('pasta do servidor fora do ar vira PASTA_INDISPONIVEL', async () => {
  const { base, arquivoEstado, origem } = setup();
  const fin = criarFinanceiro({ raiz: path.join(base, 'nao-existe'), arquivoEstado });
  await assert.rejects(() => fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' }),
    e => e.codigo === 'PASTA_INDISPONIVEL');
});

test('robô moveu para JA PROCESSADOS: vira processado uma vez só', async () => {
  const { raiz, fin, origem, relogio } = setup();
  const e = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(await fin.conferir(), false);
  fs.renameSync(path.join(raiz, 'EXTRATO', e.arquivo), path.join(raiz, 'EXTRATO', 'JA PROCESSADOS', e.arquivo));
  relogio.agora += 60000;
  assert.equal(await fin.conferir(), true);
  assert.equal(fin.estado().extrato.status, 'processado');
  assert.equal(fin.estado().extrato.concluido_em, relogio.agora);
  assert.equal(await fin.conferir(), false);
});

test('robô moveu para ERROS_LEITURA: vira erro', async () => {
  const { raiz, fin, origem } = setup();
  const e = await fin.enviar({ tipo: 'cartao', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  fs.renameSync(path.join(raiz, 'CARTAO', e.arquivo), path.join(raiz, 'CARTAO', 'ERROS_LEITURA', e.arquivo));
  assert.equal(await fin.conferir(), true);
  assert.equal(fin.estado().cartao.status, 'erro');
});

test('robô tirou da entrada e ainda não pôs em lugar nenhum: processando', async () => {
  const { raiz, fin, origem } = setup();
  const e = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  fs.unlinkSync(path.join(raiz, 'EXTRATO', e.arquivo));
  assert.equal(await fin.conferir(), true);
  assert.equal(fin.estado().extrato.status, 'processando');
});

test('servidor fora do ar na conferência: nada muda e não quebra', async () => {
  const { raiz, base, fin, origem } = setup();
  await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  fs.renameSync(raiz, path.join(base, 'sumiu'));
  assert.equal(await fin.conferir(), false);
  assert.equal(fin.estado().extrato.status, 'enviado');
});

test('envios sobrevivem a reiniciar o site', async () => {
  const { fin, novo, origem } = setup();
  const e = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.equal(novo().estado().extrato.id, e.id);
});

test('arquivo de estado corrompido começa vazio', async () => {
  const { arquivoEstado, novo } = setup();
  fs.writeFileSync(arquivoEstado, '{lixo');
  const est = novo().estado();
  assert.equal(est.extrato, null);
  assert.equal(est.cartao, null);
  assert.deepEqual(est.erros, []);
});

test('guarda só os 50 envios mais recentes', async () => {
  const { fin, arquivoEstado, origem, relogio } = setup();
  for (let i = 0; i < 55; i++) { relogio.agora += 1000; await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' }); }
  const salvo = JSON.parse(fs.readFileSync(arquivoEstado, 'utf8'));
  assert.equal(salvo.envios.length, 50);
});

test('achado 1: enviar e conferir não travam o site (devolvem Promise)', async () => {
  const { fin, origem } = setup();
  const p = fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  assert.ok(p instanceof Promise);
  await p;
  const c = fin.conferir();
  assert.ok(c instanceof Promise);
  await c;
});

test('achado 1: duas conferências ao mesmo tempo não rodam em dobro', async () => {
  const { raiz, fin, origem } = setup();
  const e = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  fs.renameSync(path.join(raiz, 'EXTRATO', e.arquivo), path.join(raiz, 'EXTRATO', 'JA PROCESSADOS', e.arquivo));
  const [a, b] = await Promise.all([fin.conferir(), fin.conferir()]);
  assert.deepEqual([a, b].sort(), [false, true]);
});

test('achado 2: envio parado há mais de 7 dias deixa de ser conferido', async () => {
  const { raiz, fin, origem, relogio } = setup();
  const e = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' });
  relogio.agora += 8 * 24 * 60 * 60 * 1000;
  fs.unlinkSync(path.join(raiz, 'EXTRATO', e.arquivo));
  assert.equal(await fin.conferir(), false);
  assert.equal(fin.estado().extrato.status, 'enviado');
});

test('achado 3: cópia vai primeiro para .part e só vira .pdf inteira', async () => {
  const { raiz, fin, origem } = setup();
  const original = fs.promises.copyFile;
  const destinos = [];
  fs.promises.copyFile = (de, para, modo) => { destinos.push(path.basename(para)); return original(de, para, modo); };
  try { await fin.enviar({ tipo: 'extrato', nomeOriginal: 'x.pdf', origem: origem(), email: 'a@x' }); }
  finally { fs.promises.copyFile = original; }
  assert.deepEqual(destinos, ['x_20261119_143005.pdf.part']);
  assert.deepEqual(fs.readdirSync(path.join(raiz, 'EXTRATO')).filter(n => n.endsWith('.part')), []);
  assert.ok(fs.existsSync(path.join(raiz, 'EXTRATO', 'x_20261119_143005.pdf')));
});

test('erros: estado lista os erros não limpos, mais novo primeiro, e manda a hora do servidor', async () => {
  const { raiz, fin, origem, relogio } = setup();
  const a = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'a.pdf', origem: origem(), email: 'a@x' });
  relogio.agora += 1000;
  const b = await fin.enviar({ tipo: 'cartao', nomeOriginal: 'b.pdf', origem: origem(), email: 'a@x' });
  fs.renameSync(path.join(raiz, 'EXTRATO', a.arquivo), path.join(raiz, 'EXTRATO', 'ERROS_LEITURA', a.arquivo));
  fs.renameSync(path.join(raiz, 'CARTAO', b.arquivo), path.join(raiz, 'CARTAO', 'ERROS_LEITURA', b.arquivo));
  await fin.conferir();
  const est = fin.estado();
  assert.deepEqual(est.erros.map(e => e.id), [b.id, a.id]);
  assert.equal(est.agora, relogio.agora);
});

test('erros: limpar tira o erro da lista e sobrevive a reiniciar o site', async () => {
  const { raiz, fin, novo, origem } = setup();
  const a = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'a.pdf', origem: origem(), email: 'a@x' });
  fs.renameSync(path.join(raiz, 'EXTRATO', a.arquivo), path.join(raiz, 'EXTRATO', 'ERROS_LEITURA', a.arquivo));
  await fin.conferir();
  assert.equal(fin.limparErro(a.id), true);
  assert.deepEqual(fin.estado().erros, []);
  assert.deepEqual(novo().estado().erros, []);
  assert.equal(fin.estado().extrato.status, 'erro');
});

test('erros: limpar id desconhecido ou envio sem erro não faz nada', async () => {
  const { fin, origem } = setup();
  const a = await fin.enviar({ tipo: 'extrato', nomeOriginal: 'a.pdf', origem: origem(), email: 'a@x' });
  assert.equal(fin.limparErro('nao-existe'), false);
  assert.equal(fin.limparErro(a.id), false);
});
