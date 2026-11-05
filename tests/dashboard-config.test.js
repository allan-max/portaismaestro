const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const credential = server.slice(server.indexOf('const arquivoEnvMaestro'), server.indexOf("const { criarDashboardCotacoes }"));

test('lê somente ROBO_SECRET do .env com BOM, preservando ambiente/PM2 e precedência', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-env-'));
  const file = path.join(directory, '.env'), secret = 'a'.repeat(64);
  fs.writeFileSync(file, '\ufeffROBO_SECRET=' + secret + '\nPORT=9999\nALLOWED_ORIGIN=https://invalid.example\n');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(directory); });
  const read = env => vm.runInNewContext(credential + '\nsegredoRoboConfigurado;', { fs, path, __dirname: directory, process: { env }, require });
  const env = { PORT: '8000' };
  assert.equal(read(env), secret);
  assert.deepEqual(env, { PORT: '8000' });
  assert.equal(read({ ROBO_SECRET: 'b'.repeat(64) }), 'b'.repeat(64));
  assert.equal(read({ ROBO_SECRET: '' }), '');
});
