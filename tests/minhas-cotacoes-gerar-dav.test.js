const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const XLSX = require('./vendor/xlsx-0.20.3.mini.min.js');
const ExcelJS = require('../public/vendor/exceljs-4.4.0.min.js');

function setupMinhasCotacoesEnv(options = {}) {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    const downloads = [];
    const alerts = [];
    const elements = {};
    const handlers = {};
    const emitted = [];

    let blobCaptured = null;

    const mockLocalStorage = {
        getItem(k) {
            if (k === 'maestro_session') return 'sess-123';
            if (k === 'maestro_vendedor') return options.vendedor || 'ROBERTO';
            if (k === 'maestro_admin') return 'false';
            return null;
        },
        setItem() {},
        clear() {},
        removeItem() {}
    };

    const context = vm.createContext({
        window: {
            location: { href: '' },
            addEventListener() {}
        },
        Buffer,
        atob: str => Buffer.from(str, 'base64').toString('binary'),
        document: {
            getElementById: id => elements[id] || null,
            querySelectorAll: selector => {
                if (selector === '.chk-filtro-localidade') return elements._chkLocalidades || [];
                if (selector === '.chk-filtro-marca') return elements._chkMarcas || [];
                return [];
            },
            addEventListener() {},
            body: { appendChild() {} },
            createElement(tag) {
                if (tag === 'a') {
                    return {
                        style: {},
                        remove() {},
                        click() {
                            downloads.push({
                                filename: this.download,
                                buffer: blobCaptured ? blobCaptured.buffer : null
                            });
                        }
                    };
                }
                return {};
            }
        },
        localStorage: mockLocalStorage,
        io() {
            return {
                emit: (...args) => emitted.push(args),
                on: (ev, fn) => { handlers[ev] = fn; }
            };
        },
        alert: msg => alerts.push(msg),
        confirm: () => true,
        console,
        setTimeout,
        clearTimeout,
        setImmediate,
        clearImmediate,
        Blob: class {
            constructor(parts, opts = {}) {
                this.parts = parts;
                this.type = opts.type;
                if (parts && parts.length) {
                    const bufs = parts.map(p => {
                        if (Buffer.isBuffer(p)) return p;
                        if (p instanceof ArrayBuffer) return Buffer.from(p);
                        if (ArrayBuffer.isView(p)) return Buffer.from(p.buffer, p.byteOffset, p.byteLength);
                        return Buffer.from(String(p || ''));
                    });
                    this.buffer = Buffer.concat(bufs);
                } else {
                    this.buffer = Buffer.alloc(0);
                }
                blobCaptured = this;
            }
        },
        URL: {
            createObjectURL(b) {
                blobCaptured = b;
                return 'blob:test-export';
            },
            revokeObjectURL() {}
        }
    });

    if (options.useJSZip !== false) {
        const jszipPath = path.join(__dirname, '../public/vendor/jszip.min.js');
        if (fs.existsSync(jszipPath)) {
            vm.runInContext(fs.readFileSync(jszipPath, 'utf8'), context);
            context.JSZip = context.window.JSZip;
        }
    }

    if (options.useExcelJS !== false) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/exceljs-4.4.0.min.js'), 'utf8'), context);
        context.ExcelJS = context.window.ExcelJS;
    }

    if (options.useTemplate !== false) {
        const tplPath = path.join(__dirname, '../public/vendor/template_planilha_base.js');
        if (fs.existsSync(tplPath)) {
            vm.runInContext(fs.readFileSync(tplPath, 'utf8'), context);
        }
    }

    const scriptMatch = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    const mainScript = scriptMatch.find(m => m[1].includes('exportarMinhasCotacoesExcel'))[1];

    vm.runInContext(mainScript, context);
    if (options.tela !== false) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/minhas-cotacoes/tela.js'), 'utf8'), context);
    }

    return { context, elements, downloads, alerts, html, handlers, emitted };
}


const V3 = path.join(__dirname, '../public/PLANILHA BASE.xlsx');

test('tela: link GERAR DAV abre o Cotafrete em nova aba, no topo da tela', () => {
    const tela = fs.readFileSync(path.join(__dirname, '../public/minhas-cotacoes/tela.js'), 'utf8');
    assert.match(tela, /<a [^>]*href="https:\/\/cotafrete\.ventura\.inf\.br\/dav"[^>]*target="_blank"[^>]*rel="noopener"[^>]*>[^<]*GERAR DAV/);
});

test('PLANILHA BASE.xlsx e o template embutido sao a v3 (mesmo conteudo)', async () => {
    const { context } = setupMinhasCotacoesEnv();
    const emb = Buffer.from(context.window.__TEMPLATE_PLANILHA_BASE_BASE64, 'base64');
    for (const buf of [emb, fs.readFileSync(V3)]) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buf);
        assert.equal(wb.worksheets[0].name, 'ORÇAMENTO');
        assert.equal(wb.worksheets[0].getCell('K1').value, 'CÓDIGO HSE');
    }
});

test('exportar cotacao de 2 itens: v3 com itens em A2:A3, K1, A33 e aba LISTAS; validacoes de B33 registradas', async () => {
    const { context, downloads, alerts } = setupMinhasCotacoesEnv();
    await context.exportarCotacaoPlanilhaBase({
        'COTAÇÃO': '5551',
        'ITEM': 'Item 01 : 01 unid. Parafuso M12\n• Item 02 : 02 unid. Porca M12',
        'OBSERVAÇÕES': 'entregar cedo'
    });
    assert.equal(downloads.length, 1);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(downloads[0].buffer);
    const ws = wb.getWorksheet('ORÇAMENTO');
    assert.equal(ws.getCell('K1').value, 'CÓDIGO HSE');
    assert.equal(ws.getCell('A33').value, 'VENDEDOR');
    assert.equal(ws.getCell('A2').value, 'Parafuso M12');
    assert.equal(ws.getCell('A3').value, 'Porca M12');
    assert.equal(ws.getCell('B3').value, 2);
    assert.equal(ws.getCell('B26').value, 'entregar cedo');
    assert.ok(ws.getCell('H2').value.formula, 'H mantem formula v3');
    assert.equal(ws.getCell('I26').value.formula, 'SUM(I2:I25)');
    for (const c of ['K2', 'L2', 'Q2', 'B30', 'B33', 'B37']) assert.equal(ws.getCell(c).value, null, c + ' nao e escrita');
    assert.ok(wb.getWorksheet('LISTAS'), 'aba LISTAS existe');
    // ExcelJS 4.4 descarta as validacoes x14 (listas suspensas) da v3: registrado aqui; se mudar, o aviso some
    assert.equal(ws.getCell('B33').dataValidation, undefined, 'B33 sem lista suspensa no arquivo exportado');
    assert.ok(alerts.some(a => a.includes('As listas de seleção (vendedor, pagamento…) não vêm no arquivo exportado: use o modelo do Gerar DAV se precisar delas.')));
});

test('exportar mais de 24 itens: so 24 vao e a tela avisa, sem sobrescrever as linhas 26+', async () => {
    const { context, downloads, alerts } = setupMinhasCotacoesEnv();
    const itens = Array.from({ length: 30 }, (_, i) => 'Item ' + String(i + 1).padStart(2, '0') + ' : 01 unid. Peca ' + (i + 1)).join('\n');
    await context.exportarCotacaoPlanilhaBase({ 'COTAÇÃO': '5552', 'ITEM': itens });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(downloads[0].buffer);
    const ws = wb.getWorksheet('ORÇAMENTO');
    assert.equal(ws.getCell('A25').value, 'Peca 24');
    assert.equal(ws.getCell('A26').value, 'OBSERVAÇÕES:');
    assert.equal(ws.getCell('A29').value, 'INFORMAÇÕES ESSENCIAIS');
    assert.ok(alerts.some(a => /24 itens/.test(a) && /30/.test(a)));
});
