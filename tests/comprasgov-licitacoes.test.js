const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const serverCode = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');

// Só as funções das licitações do ComprasGOV, lendo um JSON temporário no lugar do \\SERVIDOR2
function carregar(caminhoJson) {
    const ini = serverCode.indexOf('// "17/11/2026 08:00"');
    const fim = serverCode.indexOf('function salvarCotacoesPlanilhaAnmyna');
    const ctx = { fs, Date, obterCaminhoLicitacoesComprasGov: () => caminhoJson };
    vm.runInNewContext(serverCode.slice(ini, fim), ctx);
    return ctx;
}

const AGORA = Date.parse('2026-11-10T10:00:00-03:00');

function item(numero, prazo, status = 'baixado') {
    return { Numero: numero, Objeto: 'x', Status: status, PrazoProposta: prazo,
             DataProcessamento: '2026-11-06T11:00:00-03:00', UrlPncp: 'https://pncp.gov.br/a' };
}

test('prazo dd/mm/aaaa hh:mm vira horário de Brasília', () => {
    const { prazoPropostaEmMs } = carregar('');
    assert.equal(prazoPropostaEmMs('17/11/2026 08:00'), Date.parse('2026-11-17T08:00:00-03:00'));
    assert.equal(prazoPropostaEmMs('17/11/2026'), Date.parse('2026-11-17T23:59:00-03:00'));
    assert.equal(prazoPropostaEmMs(''), null);
    assert.equal(prazoPropostaEmMs('amanhã'), null);
});

test('licitações vencidas não aparecem; sem prazo legível continuam', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'licit-'));
    const arq = path.join(dir, 'licitacoes_processadas.json');
    fs.writeFileSync(arq, JSON.stringify({ Versao: 2, Itens: [
        item('1/2026', '09/11/2026 08:00'),          // venceu ontem
        item('2/2026', '10/11/2026 09:59'),          // venceu há 1 min
        item('3/2026', '10/11/2026 10:01'),          // ainda aberta
        item('4/2026', '17/11/2026 08:00'),          // aberta
        item('5/2026', ''),                          // sem prazo: mantém
        item('6/2026', '20/11/2026 08:00', 'rejeitado'),
    ] }));
    try {
        const { lerLicitacoesBaixadas } = carregar(arq);
        const numeros = Array.from(lerLicitacoesBaixadas(AGORA), l => l.numero).sort();   // array do vm -> array daqui
        assert.deepEqual(numeros, ['3/2026', '4/2026', '5/2026']);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
