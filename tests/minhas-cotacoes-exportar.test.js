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
    const elements = {
        'btn-exportar-excel': { style: {}, disabled: false, innerHTML: 'Exportar Excel', dataset: {} },
        'btn-top-exportar': { style: {}, disabled: false, innerHTML: 'Exportar Excel', dataset: {} },
        'btn-nav-planilha': { style: {} },
        'btn-nav-portais': { style: {} },
        'badge-vendedor': { innerText: '' },
        'avatar-vendedor': { innerText: '' },
        'tbody-cotacoes': { innerHTML: '' },
        'count-total': { innerText: '0' },
        'count-hoje': { innerText: '0' },
        'count-respondidas': { innerText: '0' },
        'input-busca': { value: '' },
        'select-ordem': { value: 'prioridade' },
        'btn-filtro-vencimento': {
            style: {},
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            },
            setAttribute(k, v) { this[k] = v; }
        },
        'menu-filtro-periodo': { style: { display: 'none' }, contains() { return false; } },
        'filtro-venc-inicio': { value: '' },
        'filtro-venc-fim': { value: '' },
        'chip-filtro-periodo': { style: { display: 'none' } },
        'texto-filtro-periodo': { innerText: '' },
        'th-vencimento': {
            getBoundingClientRect: () => ({ bottom: 100, left: 200 }),
            contains() { return false; }
        },
        'btn-filtro-localidade': {
            style: {},
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            },
            setAttribute(k, v) { this[k] = v; }
        },
        'menu-filtro-localidade': { style: { display: 'none' }, contains() { return false; } },
        'input-busca-localidade': { value: '' },
        'chk-todos-localidade': { checked: true },
        'contagem-opcoes-localidade': { innerText: '' },
        'lista-opcoes-localidade': { innerHTML: '' },
        'chip-filtro-localidade': { style: { display: 'none' } },
        'texto-filtro-localidade': { innerText: '' },
        'th-localidade': {
            getBoundingClientRect: () => ({ bottom: 100, left: 300 }),
            contains() { return false; }
        },
        'btn-filtro-marca': {
            style: {},
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); }
            },
            setAttribute(k, v) { this[k] = v; }
        },
        'menu-filtro-marca': { style: { display: 'none' }, contains() { return false; } },
        'input-busca-marca': { value: '' },
        'chk-todos-marca': { checked: true },
        'contagem-opcoes-marca': { innerText: '' },
        'lista-opcoes-marca': { innerHTML: '' },
        'chip-filtro-marca': { style: { display: 'none' } },
        'texto-filtro-marca': { innerText: '' },
        'th-marca': {
            getBoundingClientRect: () => ({ bottom: 100, left: 400 }),
            contains() { return false; }
        },
        'modal-detalhes': { style: { display: 'none' } },
        'modal-titulo': { innerText: '' },
        'modal-corpo': { innerHTML: '' },
        'btn-exportar-planilha-base': { style: {}, disabled: false, innerHTML: 'Exportar para Planilha Base', dataset: {} },
        'btn-exportar-modal-word': { style: {}, disabled: false, innerHTML: 'Exportar para Word', dataset: {} },
        _chkLocalidades: [],
        _chkMarcas: []
    };

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
                emit() {},
                on() {}
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

    return { context, elements, downloads, alerts, html };
}

test('minhas_cotacoes.html contém botão de exportação e inclui ExcelJS', () => {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="btn-exportar-excel"'), 'Deve conter botão #btn-exportar-excel');
    assert.ok(html.includes('id="btn-top-exportar"'), 'Deve conter botão #btn-top-exportar');
    assert.ok(html.includes('vendor/exceljs-4.4.0.min.js'), 'Deve carregar vendor/exceljs-4.4.0.min.js');
    assert.ok(html.includes('exportarMinhasCotacoesExcel'), 'Deve invocar exportarMinhasCotacoesExcel');
});

test('exportarMinhasCotacoesExcel gera arquivo .xlsx válido com status e colunas formatadas', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Carlos Alberto' });
    const { context, downloads } = env;

    context.window.cotacoesFiltradas = [
        {
            'COTAÇÃO': '800123',
            'VENCIMENTO': '16/10/2026',
            'LOCALIDADE': 'TUBARÃO',
            'ITEM': 'ROLAMENTO FIXO DE ESFERAS 6205',
            'QUANTIDADE': '10',
            'MODELOS': '6205-2RSH',
            'MARCAS ': 'SKF',
            'RESPOSTA': 'NÃO RESPONDIDO',
            'VENDEDOR': 'CARLOS ALBERTO',
            'OBSERVAÇÕES': 'Urgente para manutenção'
        },
        {
            'COTAÇÃO': '800456',
            'VENCIMENTO': '25/10/2026',
            'LOCALIDADE': 'VITÓRIA',
            'ITEM': 'PARAFUSO SEXTAVADO M12',
            'QUANTIDADE': '100',
            'MODELOS': 'M12X50',
            'MARCAS': 'BELENUS',
            'RESPOSTA': 'RESPONDIDO',
            'VENDEDOR': 'CARLOS ALBERTO'
        }
    ];

    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const dl = downloads[0];
    assert.match(dl.filename, /^cotacoes_carlos_alberto_\d{4}-\d{2}-\d{2}\.xlsx$/);

    const workbook = XLSX.read(dl.buffer, { type: 'buffer' });
    assert.ok(workbook.Sheets['Minhas Cotações'], 'Aba Minhas Cotações deve existir');

    const sheet = workbook.Sheets['Minhas Cotações'];
    const rows = XLSX.utils.sheet_to_json(sheet);

    assert.equal(rows.length, 2);
    assert.equal(rows[0]['COTAÇÃO'], '800123');
    assert.equal(rows[0]['STATUS'], 'Pendente (Vence Hoje)');
    assert.equal(rows[0]['LOCALIDADE'], 'TUBARÃO');
    assert.equal(rows[0]['OBSERVAÇÕES'], 'Urgente para manutenção');

    assert.equal(rows[1]['COTAÇÃO'], '800456');
    assert.equal(rows[1]['STATUS'], 'Respondida');
});

test('exportarMinhasCotacoesExcel exibe aviso quando não há cotações', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads, alerts } = env;

    context.todasCotacoes = [];
    context.window.cotacoesFiltradas = [];

    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 0);
    assert.equal(alerts.length, 1);
    assert.match(alerts[0], /Nenhuma cotação/);
});

test('exportarMinhasCotacoesExcel utiliza fallback CSV com BOM quando ExcelJS não está carregado', async () => {
    const env = setupMinhasCotacoesEnv({ useExcelJS: false, vendedor: 'Bia' });
    const { context, downloads } = env;

    context.window.cotacoesFiltradas = [
        {
            'COTAÇÃO': '999888',
            'VENCIMENTO': '20/10/2026',
            'LOCALIDADE': 'SANTOS',
            'ITEM': 'CABO DE AÇO 3/8"',
            'QUANTIDADE': '50',
            'RESPOSTA': '',
            'VENDEDOR': 'BIA'
        }
    ];

    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const dl = downloads[0];
    assert.match(dl.filename, /^cotacoes_bia_\d{4}-\d{2}-\d{2}\.csv$/);

    const conteudo = dl.buffer.toString('utf8');
    assert.ok(conteudo.startsWith('\uFEFF'), 'CSV deve conter UTF-8 BOM');
    assert.ok(conteudo.includes('COTAÇÃO;STATUS;VENCIMENTO'));
    assert.ok(conteudo.includes('999888'));
    assert.ok(conteudo.includes('SANTOS'));
});

test('minhas_cotacoes.html contém elementos de filtro de vencimento na coluna e popover', () => {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="th-vencimento"'), 'Deve conter cabeçalho com id th-vencimento');
    assert.ok(html.includes('id="btn-filtro-vencimento"'), 'Deve conter botão de filtro no cabeçalho');
    assert.ok(html.includes('id="menu-filtro-periodo"'), 'Deve conter popover de filtro de período');
    assert.ok(html.includes('id="filtro-venc-inicio"'), 'Deve conter input de data inicial');
    assert.ok(html.includes('id="filtro-venc-fim"'), 'Deve conter input de data final');
    assert.ok(html.includes('id="chip-filtro-periodo"'), 'Deve conter chip de filtro ativo');
    assert.ok(html.includes('aplicarFiltroPeriodo'), 'Deve conter função aplicarFiltroPeriodo');
    assert.ok(html.includes('limparFiltroPeriodo'), 'Deve conter função limparFiltroPeriodo');
});

test('filtro de vencimento: aplicarFiltroPeriodo recorta cotações pelo intervalo de datas e reflete no Excel', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Lucas Vendas' });
    const { context, elements, downloads } = env;

    context.window.todasCotacoes = [
        { 'COTAÇÃO': '101', 'VENCIMENTO': '15/10/2026', 'ITEM': 'PARAFUSO A', 'VENDEDOR': 'LUCAS' },
        { 'COTAÇÃO': '102', 'VENCIMENTO': '18/10/2026', 'ITEM': 'PORCA B', 'VENDEDOR': 'LUCAS' },
        { 'COTAÇÃO': '103', 'VENCIMENTO': '22/10/2026', 'ITEM': 'ARRUELA C', 'VENDEDOR': 'LUCAS' },
        { 'COTAÇÃO': '104', 'VENCIMENTO': '30/10/2026', 'ITEM': 'CORREIA D', 'VENDEDOR': 'LUCAS' },
        { 'COTAÇÃO': '105', 'VENCIMENTO': '05/11/2026', 'ITEM': 'ENGRENAGEM E', 'VENDEDOR': 'LUCAS' }
    ];

    // Define período: 18/10/2026 até 25/10/2026
    elements['filtro-venc-inicio'].value = '2026-10-18';
    elements['filtro-venc-fim'].value = '2026-10-25';

    context.aplicarFiltroPeriodo();

    // Esperado: apenas as cotações 102 (18/10) e 103 (22/10)
    assert.equal(context.window.cotacoesFiltradas.length, 2);
    const cotas = context.window.cotacoesFiltradas.map(c => c['COTAÇÃO']);
    assert.deepEqual(cotas, ['102', '103']);
    assert.equal(elements['chip-filtro-periodo'].style.display, 'inline-flex');
    assert.ok(elements['texto-filtro-periodo'].innerText.includes('18/10/2026'));

    // Ao exportar, o Excel gerado deve conter apenas as 2 cotações filtradas
    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const wb = XLSX.read(downloads[0].buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Minhas Cotações']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]['COTAÇÃO'], '102');
    assert.equal(rows[1]['COTAÇÃO'], '103');
});

test('combinação de filtro de vencimento com busca e status exporta exatamente o que está na tela', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Juliana' });
    const { context, elements, downloads } = env;

    context.window.todasCotacoes = [
        { 'COTAÇÃO': '201', 'VENCIMENTO': '20/10/2026', 'ITEM': 'VÁLVULA ESFERA 2 POL', 'RESPOSTA': 'NÃO', 'VENDEDOR': 'JULIANA' },
        { 'COTAÇÃO': '202', 'VENCIMENTO': '20/10/2026', 'ITEM': 'VÁLVULA GLOBO 3 POL', 'RESPOSTA': 'RESPONDIDO', 'VENDEDOR': 'JULIANA' },
        { 'COTAÇÃO': '203', 'VENCIMENTO': '20/10/2026', 'ITEM': 'TUBULAÇÃO DE COBRE', 'RESPOSTA': 'RESPONDIDO', 'VENDEDOR': 'JULIANA' },
        { 'COTAÇÃO': '204', 'VENCIMENTO': '05/11/2026', 'ITEM': 'VÁLVULA ESFERA 4 POL', 'RESPOSTA': 'RESPONDIDO', 'VENDEDOR': 'JULIANA' }
    ];

    // Filtro por data: até 25/10/2026
    elements['filtro-venc-inicio'].value = '';
    elements['filtro-venc-fim'].value = '2026-10-25';
    context.aplicarFiltroPeriodo();

    // Filtro por busca textual: "válvula"
    elements['input-busca'].value = 'válvula';

    // Filtro por status: apenas respondidas
    context.setFiltroStatus('respondidas');

    // Cotação 201: válvula, mas NÃO respondida (excluída)
    // Cotação 202: válvula, respondida, vencimento 20/10 (INCLUÍDA!)
    // Cotação 203: não é válvula (excluída)
    // Cotação 204: válvula, respondida, mas vencimento 05/11 fora do prazo (excluída)
    assert.equal(context.window.cotacoesFiltradas.length, 1);
    assert.equal(context.window.cotacoesFiltradas[0]['COTAÇÃO'], '202');

    // Exporta e garante que apenas a 202 está no arquivo
    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const wb = XLSX.read(downloads[0].buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Minhas Cotações']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['COTAÇÃO'], '202');
    assert.equal(rows[0]['STATUS'], 'Respondida');
});

test('limparFiltroPeriodo limpa inputs, esconde chip e reestabelece exportação de todas', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Mariana' });
    const { context, elements, downloads } = env;

    context.window.todasCotacoes = [
        { 'COTAÇÃO': '301', 'VENCIMENTO': '16/10/2026', 'ITEM': 'ITEM A', 'VENDEDOR': 'MARIANA' },
        { 'COTAÇÃO': '302', 'VENCIMENTO': '18/10/2026', 'ITEM': 'ITEM B', 'VENDEDOR': 'MARIANA' }
    ];

    // Aplica filtro que pega só uma
    elements['filtro-venc-inicio'].value = '2026-10-18';
    elements['filtro-venc-fim'].value = '2026-10-18';
    context.aplicarFiltroPeriodo();
    assert.equal(context.window.cotacoesFiltradas.length, 1);

    // Limpa o filtro
    context.limparFiltroPeriodo();

    assert.equal(elements['filtro-venc-inicio'].value, '');
    assert.equal(elements['filtro-venc-fim'].value, '');
    assert.equal(elements['chip-filtro-periodo'].style.display, 'none');
    assert.equal(context.window.cotacoesFiltradas.length, 2);

    // Exporta e garante que ambas voltaram para o Excel
    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const wb = XLSX.read(downloads[0].buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Minhas Cotações']);
    assert.equal(rows.length, 2);
});

test('presets de período preenchem os inputs e aplicam o filtro corretamente', () => {
    const env = setupMinhasCotacoesEnv();
    const { context, elements } = env;

    // Preset "hoje"
    context.setPresetPeriodo('hoje');
    const hoje = new Date();
    const y = hoje.getFullYear();
    const m = String(hoje.getMonth() + 1).padStart(2, '0');
    const d = String(hoje.getDate()).padStart(2, '0');
    const hojeStr = `${y}-${m}-${d}`;

    assert.equal(elements['filtro-venc-inicio'].value, hojeStr);
    assert.equal(elements['filtro-venc-fim'].value, hojeStr);

    // Preset "7dias"
    context.setPresetPeriodo('7dias');
    assert.equal(elements['filtro-venc-inicio'].value, hojeStr);
    assert.ok(elements['filtro-venc-fim'].value > hojeStr);
});

test('minhas_cotacoes.html contém coluna de Marca e menus de filtro para Localidade e Marca', () => {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Localidade
    assert.ok(html.includes('id="th-localidade"'), 'Deve conter cabeçalho id th-localidade');
    assert.ok(html.includes('id="btn-filtro-localidade"'), 'Deve conter botão #btn-filtro-localidade');
    assert.ok(html.includes('id="menu-filtro-localidade"'), 'Deve conter popover #menu-filtro-localidade');
    assert.ok(html.includes('id="chip-filtro-localidade"'), 'Deve conter chip de filtro de localidade');
    assert.ok(html.includes('aplicarFiltroLocalidade'), 'Deve conter função aplicarFiltroLocalidade');
    assert.ok(html.includes('limparFiltroLocalidade'), 'Deve conter função limparFiltroLocalidade');

    // Marca
    assert.ok(html.includes('id="th-marca"'), 'Deve conter cabeçalho id th-marca');
    assert.ok(html.includes('id="btn-filtro-marca"'), 'Deve conter botão #btn-filtro-marca');
    assert.ok(html.includes('id="menu-filtro-marca"'), 'Deve conter popover #menu-filtro-marca');
    assert.ok(html.includes('id="chip-filtro-marca"'), 'Deve conter chip de filtro de marca');
    assert.ok(html.includes('aplicarFiltroMarca'), 'Deve conter função aplicarFiltroMarca');
    assert.ok(html.includes('limparFiltroMarca'), 'Deve conter função limparFiltroMarca');

    // CSS e Tabela
    assert.ok(html.includes('marca-text'), 'Deve conter classe CSS marca-text');
    assert.ok(html.includes('colspan="7"'), 'Deve atualizar colspan para 7 colunas');
});

test('filtro de localidade recorta cotações e exporta somente as localidades selecionadas', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Fernanda' });
    const { context, elements, downloads } = env;

    context.window.todasCotacoes = [
        { 'COTAÇÃO': '501', 'LOCALIDADE': 'TUBARÃO', 'MARCA': 'SKF', 'ITEM': 'ROLAMENTO', 'VENCIMENTO': '25/10/2026' },
        { 'COTAÇÃO': '502', 'LOCALIDADE': 'SANTOS', 'MARCA': 'TIMKEN', 'ITEM': 'CORREIA', 'VENCIMENTO': '25/10/2026' },
        { 'COTAÇÃO': '503', 'LOCALIDADE': 'VITÓRIA', 'MARCA': 'SKF', 'ITEM': 'RETENTOR', 'VENCIMENTO': '25/10/2026' }
    ];

    // Mock das opções de localidade com apenas TUBARÃO marcado
    elements._chkLocalidades = [
        { value: 'TUBARÃO', checked: true },
        { value: 'SANTOS', checked: false },
        { value: 'VITÓRIA', checked: false }
    ];

    context.extrairListasFiltrosUnicas();
    context.aplicarFiltroLocalidade();

    assert.equal(context.window.cotacoesFiltradas.length, 1);
    assert.equal(context.window.cotacoesFiltradas[0]['COTAÇÃO'], '501');
    assert.equal(elements['chip-filtro-localidade'].style.display, 'inline-flex');
    assert.equal(elements['texto-filtro-localidade'].innerText, 'TUBARÃO');

    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const wb = XLSX.read(downloads[0].buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Minhas Cotações']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['COTAÇÃO'], '501');
    assert.equal(rows[0]['LOCALIDADE'], 'TUBARÃO');
});

test('filtro de marca recorta cotações e exporta somente as marcas selecionadas', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Rodrigo' });
    const { context, elements, downloads } = env;

    context.window.todasCotacoes = [
        { 'COTAÇÃO': '601', 'LOCALIDADE': 'TUBARÃO', 'MARCA': 'WEG', 'ITEM': 'MOTOR 5CV', 'VENCIMENTO': '25/10/2026' },
        { 'COTAÇÃO': '602', 'LOCALIDADE': 'TUBARÃO', 'MARCAS': 'SKF', 'ITEM': 'ROLAMENTO', 'VENCIMENTO': '25/10/2026' },
        { 'COTAÇÃO': '603', 'LOCALIDADE': 'TUBARÃO', 'MARCA': 'BELENUS', 'ITEM': 'PARAFUSO', 'VENCIMENTO': '25/10/2026' }
    ];

    // Mock das opções de marca com apenas SKF e WEG marcados
    elements._chkMarcas = [
        { value: 'WEG', checked: true },
        { value: 'SKF', checked: true },
        { value: 'BELENUS', checked: false }
    ];

    context.extrairListasFiltrosUnicas();
    context.aplicarFiltroMarca();

    assert.equal(context.window.cotacoesFiltradas.length, 2);
    const cotas = context.window.cotacoesFiltradas.map(c => c['COTAÇÃO']);
    assert.deepEqual(cotas, ['601', '602']);
    assert.equal(elements['chip-filtro-marca'].style.display, 'inline-flex');

    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const wb = XLSX.read(downloads[0].buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Minhas Cotações']);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]['COTAÇÃO'], '601');
    assert.equal(rows[1]['COTAÇÃO'], '602');
});

test('combinação total: localidade + marca + vencimento + busca exporta exatamente o cruzamento de filtros', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Aline' });
    const { context, elements, downloads } = env;

    context.window.todasCotacoes = [
        { 'COTAÇÃO': '701', 'LOCALIDADE': 'TUBARÃO', 'MARCA': 'SKF', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': '20/10/2026' },
        { 'COTAÇÃO': '702', 'LOCALIDADE': 'TUBARÃO', 'MARCA': 'SKF', 'ITEM': 'RETENTOR SABÓ', 'VENCIMENTO': '20/10/2026' },
        { 'COTAÇÃO': '703', 'LOCALIDADE': 'SANTOS', 'MARCA': 'SKF', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': '20/10/2026' },
        { 'COTAÇÃO': '704', 'LOCALIDADE': 'TUBARÃO', 'MARCA': 'WEG', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': '20/10/2026' },
        { 'COTAÇÃO': '705', 'LOCALIDADE': 'TUBARÃO', 'MARCA': 'SKF', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': '30/11/2026' }
    ];

    context.extrairListasFiltrosUnicas();

    // 1. Filtro Localidade = TUBARÃO
    elements._chkLocalidades = [
        { value: 'TUBARÃO', checked: true },
        { value: 'SANTOS', checked: false }
    ];
    context.aplicarFiltroLocalidade();

    // 2. Filtro Marca = SKF
    elements._chkMarcas = [
        { value: 'SKF', checked: true },
        { value: 'WEG', checked: false }
    ];
    context.aplicarFiltroMarca();

    // 3. Filtro Vencimento = até 31/10/2026
    elements['filtro-venc-fim'].value = '2026-10-31';
    context.aplicarFiltroPeriodo();

    // 4. Busca = "rolamento"
    elements['input-busca'].value = 'rolamento';
    context.aplicarFiltros();

    // Apenas cotação 701 atende a todos os 4 filtros simultaneamente
    assert.equal(context.window.cotacoesFiltradas.length, 1);
    assert.equal(context.window.cotacoesFiltradas[0]['COTAÇÃO'], '701');

    await context.exportarMinhasCotacoesExcel();

    assert.equal(downloads.length, 1);
    const wb = XLSX.read(downloads[0].buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Minhas Cotações']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['COTAÇÃO'], '701');
    assert.equal(rows[0]['MARCAS'], 'SKF');
    assert.equal(rows[0]['LOCALIDADE'], 'TUBARÃO');
});

test('minhas_cotacoes.html contém botão #btn-exportar-planilha-base no modal e inclui template_planilha_base.js', () => {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('id="btn-exportar-planilha-base"'), 'Deve conter botão #btn-exportar-planilha-base');
    assert.ok(html.includes('vendor/template_planilha_base.js'), 'Deve carregar vendor/template_planilha_base.js');
    assert.ok(html.includes('exportarCotacaoModalPlanilhaBase'), 'Deve vincular exportarCotacaoModalPlanilhaBase');
    assert.ok(html.includes('exportarCotacaoPlanilhaBase'), 'Deve definir exportarCotacaoPlanilhaBase');
});

test('abrirDetalhes define cotacaoModalAtual e exibe modal', () => {
    const env = setupMinhasCotacoesEnv();
    const { context, elements } = env;

    context.window.cotacoesFiltradas = [
        {
            'COTAÇÃO': '887766',
            'ITEM': 'ROLAMENTO DE ROLOS CONICOS',
            'QUANTIDADE': '4',
            'VENDEDOR': 'ROBERTO'
        }
    ];

    context.abrirDetalhes(0);

    assert.equal(elements['modal-detalhes'].style.display, 'flex');
    assert.ok(elements['modal-titulo'].innerText.includes('887766'));
    assert.ok(elements['modal-corpo'].innerHTML.includes('ROLAMENTO DE ROLOS CONICOS'));
    assert.equal(context.window.cotacaoModalAtual['COTAÇÃO'], '887766');
});

test('extrairQuantidadeNumero trata corretamente inteiros, decimais e unidades', () => {
    const env = setupMinhasCotacoesEnv();
    const { context } = env;
    const fn = context.window.extrairQuantidadeNumero;

    assert.equal(fn(10), 10);
    assert.equal(fn('10'), 10);
    assert.equal(fn('10,5'), 10.5);
    assert.equal(fn('1.500,50'), 1500.5);
    assert.equal(fn('1.000'), 1000);
    assert.equal(fn('5 UN'), 5);
    assert.equal(fn('3 pçs'), 3);
    assert.equal(fn(0), 1);
    assert.equal(fn(''), 1);
    assert.equal(fn(null), 1);
    assert.equal(fn(undefined), 1);
});

test('exportarCotacaoPlanilhaBase preenche produto em A2, quantidade em B2 e preserva fórmulas e abas', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads } = env;

    const cotacao = {
        'COTAÇÃO': '999888',
        'ITEM': 'CORREIA EM V B-52 DENTADA INDUSTRIAL',
        'QUANTIDADE': '6'
    };

    await context.exportarCotacaoPlanilhaBase(cotacao);

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'planilha_base_cotacao_999888.xlsx');
    assert.ok(downloads[0].buffer && downloads[0].buffer.length > 0);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(downloads[0].buffer);

    // Valida abas originais preservadas
    const sheetNames = wb.worksheets.map(w => w.name);
    assert.deepEqual(sheetNames, ['ORÇAMENTO', 'COTAÇÃO', 'FRETE']);

    const ws = wb.getWorksheet('ORÇAMENTO');
    assert.ok(ws, 'Aba ORÇAMENTO deve existir');

    // Valida preenchimento dos campos requeridos
    assert.equal(ws.getCell('A2').value, 'CORREIA EM V B-52 DENTADA INDUSTRIAL');
    assert.equal(ws.getCell('B2').value, 6);

    // Valida fórmulas intactas na linha 2 e totais
    assert.equal(ws.getCell('H2').value?.formula, '(C2+(D2/B2)+(E2/B2)+(F2))*B2');
    assert.equal(ws.getCell('I2').value?.formula, '(H2*G2/100)+H2');
    assert.equal(ws.getCell('J2').value?.formula, 'I2/B2');
    assert.equal(ws.getCell('I26').value?.formula, 'SUM(I2:I25)');
});

test('exportarCotacaoModalPlanilhaBase exporta a cotação ativa no modal', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads } = env;

    context.window.cotacoesFiltradas = [
        {
            'COTAÇÃO': '554433',
            'ITEM': 'FILTRO SEPARADOR DE AGUA',
            'QUANTIDADE': '2 UN'
        }
    ];

    context.abrirDetalhes(0);
    await context.exportarCotacaoModalPlanilhaBase();

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'planilha_base_cotacao_554433.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(downloads[0].buffer);
    const ws = wb.getWorksheet('ORÇAMENTO');

    assert.equal(ws.getCell('A2').value, 'FILTRO SEPARADOR DE AGUA');
    assert.equal(ws.getCell('B2').value, 2);
});

test('exportarCotacaoModalPlanilhaBase exibe aviso quando nenhuma cotação está selecionada', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, alerts, downloads } = env;

    context.window.cotacaoModalAtual = null;
    await context.exportarCotacaoModalPlanilhaBase();

    assert.equal(downloads.length, 0);
    assert.ok(alerts.some(a => a.includes('Nenhuma cotação selecionada')));
});

test('parseItensCotacao divide múltiplos itens com quantidades individuais', () => {
    const env = setupMinhasCotacoesEnv();
    const { context } = env;

    const cotacaoMulti = {
        'ITEM': `Item 01 : 01 unid. Impressora Zebra ZD230 USB + Ethernet
• Item 02 : 02 unid. Leitor código barras Zebra DS2208 Kit com suporte
• Item 03 : 01 unid. Etiqueta de Poliéster Industrial Rolo 50 x 25 mm (cerca de 3.000 etiquetas) Poliéster Prata Patrimonial
• Item 04 : 01 unid. Ribon Resina Ribon 110 mm x 300 m`,
        'QUANTIDADE': '4'
    };

    const itens = context.window.parseItensCotacao(cotacaoMulti);

    assert.equal(itens.length, 4);
    assert.equal(itens[0].produto, 'Impressora Zebra ZD230 USB + Ethernet');
    assert.equal(itens[0].quantidade, 1);

    assert.equal(itens[1].produto, 'Leitor código barras Zebra DS2208 Kit com suporte');
    assert.equal(itens[1].quantidade, 2);

    assert.equal(itens[2].produto, 'Etiqueta de Poliéster Industrial Rolo 50 x 25 mm (cerca de 3.000 etiquetas) Poliéster Prata Patrimonial');
    assert.equal(itens[2].quantidade, 1);

    assert.equal(itens[3].produto, 'Ribon Resina Ribon 110 mm x 300 m');
    assert.equal(itens[3].quantidade, 1);
});

test('exportarCotacaoPlanilhaBase exporta múltiplos itens para linhas sucessivas da planilha base', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads } = env;

    const cotacaoMulti = {
        'COTAÇÃO': '778899',
        'ITEM': `Item 01 : 01 unid. Impressora Zebra ZD230 USB + Ethernet
• Item 02 : 02 unid. Leitor código barras Zebra DS2208 Kit com suporte
• Item 03 : 01 unid. Etiqueta de Poliéster Industrial Rolo 50 x 25 mm (cerca de 3.000 etiquetas) Poliéster Prata Patrimonial
• Item 04 : 01 unid. Ribon Resina Ribon 110 mm x 300 m`
    };

    await context.exportarCotacaoPlanilhaBase(cotacaoMulti);

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'planilha_base_cotacao_778899.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(downloads[0].buffer);
    const ws = wb.getWorksheet('ORÇAMENTO');

    // Linha 2 (Item 1)
    assert.equal(ws.getCell('A2').value, 'Impressora Zebra ZD230 USB + Ethernet');
    assert.equal(ws.getCell('B2').value, 1);
    assert.equal(ws.getCell('H2').value?.formula, '(C2+(D2/B2)+(E2/B2)+(F2))*B2');

    // Linha 3 (Item 2)
    assert.equal(ws.getCell('A3').value, 'Leitor código barras Zebra DS2208 Kit com suporte');
    assert.equal(ws.getCell('B3').value, 2);

    // Linha 4 (Item 3)
    assert.equal(ws.getCell('A4').value, 'Etiqueta de Poliéster Industrial Rolo 50 x 25 mm (cerca de 3.000 etiquetas) Poliéster Prata Patrimonial');
    assert.equal(ws.getCell('B4').value, 1);

    // Linha 5 (Item 4)
    assert.equal(ws.getCell('A5').value, 'Ribon Resina Ribon 110 mm x 300 m');
    assert.equal(ws.getCell('B5').value, 1);

    // Fórmulas da soma total e abas
    assert.equal(ws.getCell('I26').value?.formula, 'SUM(I2:I25)');
    assert.deepEqual(wb.worksheets.map(w => w.name), ['ORÇAMENTO', 'COTAÇÃO', 'FRETE']);
});

test('minhas_cotacoes.html contém botão Exportar Word com estilo azul suave, inclusão de JSZip e cabeçalho atualizado', () => {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    // Verifica inclusão do script JSZip
    assert.ok(html.includes('src="vendor/jszip.min.js"'), 'Deve incluir vendor/jszip.min.js');

    // Verifica estilos do botão azul suave
    assert.ok(html.includes('.btn-exportar-word'), 'Deve conter a classe .btn-exportar-word');
    assert.ok(html.includes('rgba(56, 189, 248'), 'Deve conter cor azul clara com transparência suave');
    assert.ok(html.includes('#7dd3fc') || html.includes('#38bdf8'), 'Deve conter tom azul suave (#7dd3fc ou #38bdf8)');

    // Verifica cabeçalho da tabela
    assert.ok(html.includes('Exportar Word'), 'Cabeçalho da tabela deve conter a coluna "Exportar Word"');

    // Verifica botão no modal
    assert.ok(html.includes('id="btn-exportar-modal-word"'), 'Modal de detalhes deve conter o botão #btn-exportar-modal-word');
    assert.ok(html.includes('exportarCotacaoModalWord()'), 'Botão do modal deve chamar exportarCotacaoModalWord()');
});

test('renderizarTabela inclui o botão Exportar Word em cada linha da tabela', () => {
    const env = setupMinhasCotacoesEnv();
    const { context, elements } = env;

    const cotasExemplo = [
        { 'COTAÇÃO': '101', 'VENCIMENTO': '20/10/2026', 'LOCALIDADE': 'TUBARÃO', 'ITEM': 'IMPRESSORA ZEBRA', 'RESPOSTA': 'NÃO' },
        { 'COTAÇÃO': '102', 'VENCIMENTO': '22/10/2026', 'LOCALIDADE': 'SANTOS', 'ITEM': 'LEITOR CÓDIGO BARRAS', 'RESPOSTA': 'RESPONDIDO' }
    ];
    context.cotacoesFiltradas = cotasExemplo;
    context.window.cotacoesFiltradas = cotasExemplo;

    context.renderizarTabela();

    const tbodyHtml = elements['tbody-cotacoes'].innerHTML;
    assert.ok(tbodyHtml.includes('btn-exportar-word'), 'Tabela deve conter botões .btn-exportar-word');
    assert.ok(tbodyHtml.includes('exportarCotacaoWord(0)'), 'Primeira linha deve chamar exportarCotacaoWord(0)');
    assert.ok(tbodyHtml.includes('exportarCotacaoWord(1)'), 'Segunda linha deve chamar exportarCotacaoWord(1)');
    assert.ok(tbodyHtml.includes('fa-file-word'), 'Deve exibir ícone do Word');
});

test('gerarDocxCotacaoCoupaXml gera formato idêntico ao Coupa com margens, cabeçalho, assinaturas, frete e itens', () => {
    const env = setupMinhasCotacoesEnv();
    const { context } = env;

    const cotacao = {
        'COTAÇÃO': '800123',
        'VENCIMENTO': '20/10/2026',
        'LOCALIDADE': 'TUBARÃO',
        'FRETE': 'CIF - TUBARÃO',
        'ITEM': 'Impressora Zebra ZD230 USB + Ethernet',
        'QUANTIDADE': 1
    };

    const xml = context.gerarDocxCotacaoCoupaXml(cotacao);

    // Cabeçalho da cotação e vencimento
    assert.ok(xml.includes('COTAÇÃO: #800123'), 'Deve conter número da cotação');
    assert.ok(xml.includes('<w:tab/>'), 'Deve conter tab entre número e vencimento');
    assert.ok(xml.includes('VENCIMENTO:'), 'Deve conter label de vencimento');
    assert.ok(xml.includes('20/10/2026'), 'Deve conter data de vencimento');

    // Linha de assinaturas
    assert.ok(xml.includes('RESPONDIDO POR: ______________ CONFERIDO POR: ______________ PRECIFICADO POR:_____________'));

    // Linha de frete
    assert.ok(xml.includes('FRETE:'));
    assert.ok(xml.includes('CIF - TUBARÃO'));

    // Item e quantidade
    assert.ok(xml.includes('ITEM 1:'));
    assert.ok(xml.includes('Impressora Zebra ZD230 USB + Ethernet'));
    assert.ok(xml.includes('QTD:'));
    assert.ok(xml.includes('1 - LOCAL: TUBARÃO'));

    // Linha de precificação
    assert.ok(xml.includes('VALOR DE VENDA: R$ __________________ CUSTO UNIT: R$__________________'));

    // Margens de 1.0 cm (567 dxa)
    assert.ok(xml.includes('w:top="567" w:right="567" w:bottom="567" w:left="567"'));
});

test('gerarDocxCotacaoCoupaXml gera múltiplos itens divididos com quantidades e marcas no padrão Coupa', () => {
    const env = setupMinhasCotacoesEnv();
    const { context } = env;

    const cotacaoMulti = {
        'COTAÇÃO': '800456',
        'VENCIMENTO': '25/10/2026',
        'LOCALIDADE': 'TUBARÃO',
        'MARCA': 'ZEBRA',
        'ITEM': `Item 01 : 01 unid. Impressora Zebra ZD230 USB + Ethernet
• Item 02 : 02 unid. Leitor código barras Zebra DS2208 Kit com suporte
• Item 03 : 01 unid. Etiqueta de Poliéster Industrial Rolo 50 x 25 mm (cerca de 3.000 etiquetas) Poliéster Prata Patrimonial
• Item 04 : 01 unid. Ribon Resina Ribon 110 mm x 300 m`
    };

    const xml = context.gerarDocxCotacaoCoupaXml(cotacaoMulti);

    // Itens individuais
    assert.ok(xml.includes('ITEM 1:'), 'Deve conter ITEM 1');
    assert.ok(xml.includes('Impressora Zebra ZD230 USB + Ethernet'));
    assert.ok(xml.includes('1 - LOCAL: TUBARÃO'));

    assert.ok(xml.includes('ITEM 2:'), 'Deve conter ITEM 2');
    assert.ok(xml.includes('Leitor código barras Zebra DS2208 Kit com suporte'));
    assert.ok(xml.includes('2 - LOCAL: TUBARÃO'));

    assert.ok(xml.includes('ITEM 3:'), 'Deve conter ITEM 3');
    assert.ok(xml.includes('Etiqueta de Poliéster Industrial Rolo 50 x 25 mm'));

    assert.ok(xml.includes('ITEM 4:'), 'Deve conter ITEM 4');
    assert.ok(xml.includes('Ribon Resina Ribon 110 mm x 300 m'));

    // Marca
    assert.ok(xml.includes('MARCA: ZEBRA'));
});

test('gerarDocxCotacaoCoupaBlob gera zip docx válido com OpenXML e styles Arial 9pt', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context } = env;

    const cotacao = {
        'COTAÇÃO': '800123',
        'VENCIMENTO': '20/10/2026',
        'LOCALIDADE': 'TUBARÃO',
        'ITEM': 'Impressora Zebra ZD230'
    };

    const buffer = await context.gerarDocxCotacaoCoupaBlob(cotacao, { type: 'nodebuffer' });
    assert.ok(Buffer.isBuffer(buffer) && buffer.length > 500, 'Deve gerar buffer de tamanho válido');

    // Valida com JSZip
    const JSZip = require('../public/vendor/jszip.min.js');
    const zip = await JSZip.loadAsync(buffer);

    assert.ok(zip.file('[Content_Types].xml'), 'Deve conter [Content_Types].xml');
    assert.ok(zip.file('_rels/.rels'), 'Deve conter _rels/.rels');
    assert.ok(zip.file('word/_rels/document.xml.rels'), 'Deve conter word/_rels/document.xml.rels');
    assert.ok(zip.file('word/styles.xml'), 'Deve conter word/styles.xml');
    assert.ok(zip.file('word/document.xml'), 'Deve conter word/document.xml');

    const stylesXml = await zip.file('word/styles.xml').async('text');
    assert.ok(stylesXml.includes('Arial'), 'Styles deve especificar fonte Arial');
    assert.ok(stylesXml.includes('w:sz w:val="18"'), 'Styles deve especificar tamanho 9pt (18 half-points)');
});

test('exportarCotacaoWord e exportarCotacaoModalWord disparam o download com nome de arquivo correto', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads } = env;

    const cotasLinha = [
        { 'COTAÇÃO': '887766', 'VENCIMENTO': '20/10/2026', 'LOCALIDADE': 'TUBARÃO', 'ITEM': 'PRODUTO X' }
    ];
    context.cotacoesFiltradas = cotasLinha;
    context.window.cotacoesFiltradas = cotasLinha;

    // Exportação pela linha da tabela
    await context.exportarCotacaoWord(0);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'Cotacao_887766.docx');
    assert.ok(downloads[0].buffer && downloads[0].buffer.length > 0, 'Buffer não deve estar vazio');

    // Exportação pelo modal
    const cotasModal = { 'COTAÇÃO': '554433', 'VENCIMENTO': '22/10/2026', 'LOCALIDADE': 'SANTOS', 'ITEM': 'PRODUTO Y' };
    context.cotacaoModalAtual = cotasModal;
    context.window.cotacaoModalAtual = cotasModal;
    await context.exportarCotacaoModalWord();
    assert.equal(downloads.length, 2);
    assert.equal(downloads[1].filename, 'Cotacao_554433.docx');
    assert.ok(downloads[1].buffer && downloads[1].buffer.length > 0, 'Buffer não deve estar vazio');
});

test('minhas_cotacoes.html inclui fallback de CDN para JSZip quando vendor local não estiver disponível', () => {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('https://cdnjs.cloudflare.com/ajax/libs/jszip/'), 'Deve conter fallback para cdnjs caso vendor local falhe');
    assert.ok(html.includes('obterJSZip'), 'Deve expor função obterJSZip');
});




