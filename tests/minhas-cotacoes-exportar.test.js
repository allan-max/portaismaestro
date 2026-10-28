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

test('minhas_cotacoes.html carrega ExcelJS e a tela nova, com exportação da lista no menu Exportar', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/minhas_cotacoes.html'), 'utf8');
    const tela = fs.readFileSync(path.join(__dirname, '../public/minhas-cotacoes/tela.js'), 'utf8');

    assert.ok(html.includes('vendor/exceljs-4.4.0.min.js'), 'Deve carregar vendor/exceljs-4.4.0.min.js');
    assert.ok(html.includes('src="minhas-cotacoes/tela.js"'), 'Deve carregar a tela nova');
    assert.ok(html.includes('href="minhas-cotacoes/tela.css"'), 'Deve carregar o CSS da tela nova');
    assert.ok(tela.includes('data-acao="exp-excel"') && tela.includes('data-acao="exp-word"'), 'Menu Exportar deve ter Excel e Word');
    assert.ok(tela.includes('exportarMinhasCotacoesExcel()') && tela.includes('exportarMinhasCotacoesWord()'), 'Menu deve usar as exportações da página');
});

test('exportarMinhasCotacoesExcel gera arquivo .xlsx válido com status e colunas formatadas', async () => {
    const env = setupMinhasCotacoesEnv({ vendedor: 'Carlos Alberto' });
    const { context, downloads } = env;

    context.window.cotacoesFiltradas = [
        {
            'COTAÇÃO': '800123',
            'VENCIMENTO': dataRel(0),
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

// datas relativas a hoje no formato da planilha (dd/mm/aaaa)
function dataRel(off) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + off);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function isoRel(off) {
    const [d, m, a] = dataRel(off).split('/');
    return `${a}-${m}-${d}`;
}

test('tela: status, vencimento, localidade, marca e busca combinados recortam a fila e o Excel exporta exatamente ela', async () => {
    const { context, downloads } = setupMinhasCotacoesEnv({ vendedor: 'Aline' });
    const Tela = context.window.Tela;

    Tela.receber([
        { 'COTAÇÃO': '701', 'LOCALIDADE': 'TUBARÃO', 'MARCAS ': 'SKF', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': dataRel(2), 'RESPOSTA': '' },
        { 'COTAÇÃO': '702', 'LOCALIDADE': 'TUBARÃO', 'MARCAS ': 'SKF', 'ITEM': 'RETENTOR SABÓ', 'VENCIMENTO': dataRel(2), 'RESPOSTA': '' },
        { 'COTAÇÃO': '703', 'LOCALIDADE': 'SANTOS', 'MARCAS ': 'SKF', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': dataRel(2), 'RESPOSTA': '' },
        { 'COTAÇÃO': '704', 'LOCALIDADE': 'TUBARÃO', 'MARCAS ': 'WEG', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': dataRel(2), 'RESPOSTA': '' },
        { 'COTAÇÃO': '705', 'LOCALIDADE': 'TUBARÃO', 'MARCAS ': 'SKF', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': dataRel(20), 'RESPOSTA': '' },
        { 'COTAÇÃO': '706', 'LOCALIDADE': 'TUBARÃO', 'MARCAS ': 'SKF', 'ITEM': 'ROLAMENTO 6205', 'VENCIMENTO': dataRel(2), 'RESPOSTA': 'RESPONDIDO' }
    ]);
    Object.assign(Tela.estado, { status: 'pendentes', prazo: '7', locais: ['TUBARÃO'], marcas: ['SKF'], busca: 'rolamento' });

    assert.deepEqual(Tela.filtradas().map(c => c['COTAÇÃO']), ['701']);

    await Tela.exportarLista('excel');

    assert.equal(downloads.length, 1);
    const wb = XLSX.read(downloads[0].buffer, { type: 'buffer' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Minhas Cotações']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]['COTAÇÃO'], '701');
    assert.equal(rows[0]['MARCAS'], 'SKF');
    assert.ok(!Object.keys(rows[0]).some(k => k.startsWith('_')), 'Controle interno da tela não pode virar coluna no Excel');
});

test('tela: período com datas e dia clicado no gráfico filtram pelo vencimento', () => {
    const { context } = setupMinhasCotacoesEnv();
    const Tela = context.window.Tela;

    Tela.receber([
        { 'COTAÇÃO': '101', 'VENCIMENTO': dataRel(0), 'ITEM': 'A' },
        { 'COTAÇÃO': '102', 'VENCIMENTO': dataRel(3), 'ITEM': 'B' },
        { 'COTAÇÃO': '103', 'VENCIMENTO': isoRel(5), 'ITEM': 'C' },
        { 'COTAÇÃO': '104', 'VENCIMENTO': dataRel(12), 'ITEM': 'D' }
    ]);
    Object.assign(Tela.estado, { status: 'todas', ordem: 'venc_asc', prazo: 'periodo', de: isoRel(3), ate: isoRel(5) });
    assert.deepEqual(Tela.filtradas().map(c => c['COTAÇÃO']), ['102', '103']);

    Object.assign(Tela.estado, { prazo: 'dia', dia: 0, de: '', ate: '' });
    assert.deepEqual(Tela.filtradas().map(c => c['COTAÇÃO']), ['101']);

    Object.assign(Tela.estado, { prazo: '', status: 'semana' });
    assert.deepEqual(Tela.filtradas().map(c => c['COTAÇÃO']), ['102', '103']);

    const n = Tela.contagem();
    assert.equal(n.todas, 4);
    assert.equal(n.hoje, 1);
    assert.equal(n.semana, 2);
});

test('tela: com cotações selecionadas, o Exportar gera só elas mesmo fora dos filtros', async () => {
    const { context, downloads } = setupMinhasCotacoesEnv({ vendedor: 'Bia' });
    const Tela = context.window.Tela;

    Tela.receber([
        { 'COTAÇÃO': '201', 'VENCIMENTO': dataRel(1), 'ITEM': 'VÁLVULA', 'RESPOSTA': '' },
        { 'COTAÇÃO': '202', 'VENCIMENTO': dataRel(1), 'ITEM': 'TUBO', 'RESPOSTA': 'RESPONDIDO' },
        { 'COTAÇÃO': '203', 'VENCIMENTO': dataRel(4), 'ITEM': 'CONEXÃO', 'RESPOSTA': '' }
    ]);
    Tela.estado.status = 'pendentes';
    const [c201, c202] = Tela.estado.lista;
    Tela.estado.selecionadas.add(Tela.id(c201));
    Tela.estado.selecionadas.add(Tela.id(c202));

    assert.deepEqual(Tela.alvoExportacao().map(c => c['COTAÇÃO']), ['201', '202']);

    await Tela.exportarLista('word');
    assert.equal(downloads.length, 1);
    assert.match(downloads[0].filename, /^cotacoes_bia_\d{4}-\d{2}-\d{2}\.docx$/);
    assert.deepEqual(context.window.cotacoesFiltradas.map(c => c['COTAÇÃO']), ['201', '202']);
});

test('tela: número da cotação sai limpo e os itens são lidos no formato da planilha', () => {
    const { context } = setupMinhasCotacoesEnv();
    const Tela = context.window.Tela;

    assert.deepEqual({ ...Tela.numero({ 'COTAÇÃO': 'COTAÇÃO/ES (EDIVIT) > PPG0241188' }) }, { num: 'PPG0241188', origem: 'EDIVIT' });
    assert.equal(Tela.numero({ 'COTAÇÃO': 'Cotação 171-548812' }).num, '171-548812');
    assert.equal(Tela.numero({ 'COTAÇÃO': '297402' }).num, '297402');

    const [headset] = Tela.itens({ 'ITEM': '13113728 || HEADSET C/FIO - PT || HEADSET; COR: PRETO', 'QUANTIDADE': '4 EA-cada', 'MARCAS ': 'PLANTRONICS' });
    assert.equal(headset.codigo, '13113728');
    assert.equal(headset.nome, 'HEADSET C/FIO');
    assert.equal(headset.desc, 'HEADSET; COR: PRETO');
    assert.equal(headset.qtd, '4 EA');
    assert.equal(headset.marca, 'PLANTRONICS');

    const multi = Tela.itens({
        'ITEM': '(Item 1) 35001117 || MADEIRA SERRADA - PT || TABUA PINUS 30CM X 3M\n(Item 2) 35001117 || MADEIRA SERRADA - PT || CAIBRO PINUS 5X5CM X 3M',
        'QUANTIDADE': '(Item 1) 300 PC-peca\n(Item 2) 120 PC-peca'
    });
    assert.equal(multi.length, 2);
    assert.equal(multi[0].nome, 'TABUA PINUS 30CM X 3M');
    assert.equal(multi[0].categoria, 'MADEIRA SERRADA');
    assert.equal(multi[1].qtd, '120 PC');

    assert.equal(Tela.itens({ 'ITEM': '' })[0].nome, 'Sem descrição na planilha');
});

test('tela: recarga do socket mantém o id da cotação e marca a que chegou como nova', () => {
    const { context } = setupMinhasCotacoesEnv();
    const Tela = context.window.Tela;
    const linha = n => ({ 'COTAÇÃO': n, 'LOCALIDADE': 'VITÓRIA', 'VENCIMENTO': dataRel(1), 'ITEM': 'ITEM ' + n });

    Tela.receber([linha('301'), linha('302')]);
    const id302 = Tela.id(Tela.estado.lista[1]);
    Tela.estado.selecionadas.add(id302);

    Tela.receber([linha('303'), linha('302')]);
    assert.equal(Tela.id(Tela.estado.lista[1]), id302, 'Mesma cotação mantém o id entre recargas');
    assert.ok(Tela.estado.novos.has(Tela.id(Tela.estado.lista[0])), 'Cotação que chegou fica marcada como nova');
    assert.ok(!Tela.estado.novos.has(id302));
    assert.deepEqual([...Tela.estado.selecionadas], [id302], 'Seleção sobrevive à recarga');
});

test('socket: vencidas ficam fora da tela e marcar como respondida envia a identidade da linha', () => {
    const { context, handlers, emitted } = setupMinhasCotacoesEnv();
    const Tela = context.window.Tela;

    handlers.retorno_planilha_json({
        sucesso: true,
        cotacoes: [
            { 'COTAÇÃO': '401', 'VENCIMENTO': dataRel(-1), 'ITEM': 'VENCIDA' },
            { 'COTAÇÃO': '402', 'VENCIMENTO': dataRel(0), 'ITEM': 'HOJE', 'VENDEDOR': 'ROBERTO', 'LOCALIDADE': 'SANTOS' }
        ]
    });
    assert.deepEqual(Tela.estado.lista.map(c => c['COTAÇÃO']), ['402']);
    assert.equal(Tela.estado.carregado, true);

    context.marcarComoRespondida(Tela.estado.lista[0]);
    const envio = emitted.find(e => e[0] === 'marcar_cotacao_respondida');
    assert.ok(envio, 'Deve emitir marcar_cotacao_respondida');
    assert.equal(envio[1].identidade['COTAÇÃO'], '402');
    assert.equal(envio[1].identidade['VENCIMENTO'], dataRel(0));

    handlers.retorno_planilha_json({ sucesso: false, erro: 'planilha indisponível' });
    assert.equal(Tela.estado.erro, 'planilha indisponível');
});

test('minhas_cotacoes.html inclui template_planilha_base.js e a tela exporta Word Coupa e Planilha Base por cotação', () => {
    const html = fs.readFileSync(path.join(__dirname, '../public/minhas_cotacoes.html'), 'utf8');
    const tela = fs.readFileSync(path.join(__dirname, '../public/minhas-cotacoes/tela.js'), 'utf8');

    assert.ok(html.includes('vendor/template_planilha_base.js'), 'Deve carregar vendor/template_planilha_base.js');
    assert.ok(html.includes('async function exportarCotacaoPlanilhaBase'), 'Deve definir exportarCotacaoPlanilhaBase');
    assert.ok(tela.includes('id="btn-exportar-planilha-base"'), 'Janela da cotação deve ter o botão Planilha Base');
    assert.ok(tela.includes('exportarCotacaoPlanilhaBase(c)') && tela.includes('exportarCotacaoWordCore(c, el)'), 'Ações por cotação devem usar as exportações da página');
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
    assert.deepEqual(sheetNames, ['ORÇAMENTO', 'COTAÇÃO', 'FRETE', 'LISTAS']);

    const ws = wb.getWorksheet('ORÇAMENTO');
    assert.ok(ws, 'Aba ORÇAMENTO deve existir');

    // Valida preenchimento dos campos requeridos
    assert.equal(ws.getCell('A2').value, 'CORREIA EM V B-52 DENTADA INDUSTRIAL');
    assert.equal(ws.getCell('B2').value, 6);

    // Valida fórmulas intactas na linha 2 e totais
    assert.equal(ws.getCell('H2').value?.formula, 'SUM(C2*B2+(D2+E2+F2))');
    assert.equal(ws.getCell('I2').value?.formula, 'SUM((C2*B2)+D2+E2+F2)*G2%+H2');
    assert.equal(ws.getCell('J2').value?.formula, 'SUM(I2/B2)');
    assert.equal(ws.getCell('I26').value?.formula, 'SUM(I2:I25)');
});

test('exportarCotacaoPlanilhaBase exibe aviso quando nenhuma cotação é passada', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, alerts, downloads } = env;

    await context.exportarCotacaoPlanilhaBase(null);

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
    assert.equal(ws.getCell('H2').value?.formula, 'SUM(C2*B2+(D2+E2+F2))');

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
    assert.deepEqual(wb.worksheets.map(w => w.name), ['ORÇAMENTO', 'COTAÇÃO', 'FRETE', 'LISTAS']);
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

test('exportarCotacaoWordCore (Word Coupa de uma cotação) dispara o download com nome de arquivo correto', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads } = env;

    const btn = { disabled: false, innerHTML: 'Word Coupa' };
    await context.exportarCotacaoWordCore({ 'COTAÇÃO': '887766', 'VENCIMENTO': '20/10/2026', 'LOCALIDADE': 'TUBARÃO', 'ITEM': 'PRODUTO X' }, btn);

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'Cotacao_887766.docx');
    assert.ok(downloads[0].buffer && downloads[0].buffer.length > 0, 'Buffer não deve estar vazio');
    assert.equal(btn.disabled, false, 'Botão volta ao normal depois de gerar');
    assert.equal(btn.innerHTML, 'Word Coupa');
});

test('minhas_cotacoes.html inclui fallback de CDN para JSZip quando vendor local não estiver disponível', () => {
    const htmlPath = path.join(__dirname, '../public/minhas_cotacoes.html');
    const html = fs.readFileSync(htmlPath, 'utf8');

    assert.ok(html.includes('https://cdnjs.cloudflare.com/ajax/libs/jszip/'), 'Deve conter fallback para cdnjs caso vendor local falhe');
    assert.ok(html.includes('obterJSZip'), 'Deve expor função obterJSZip');
});

test('gerarDocxCotacaoCoupaBlob funciona 100% sem JSZip usando gerador ZIP nativo puro', async () => {
    // Configura o ambiente SEM JSZip (simula servidor offline ou sem vendor/jszip.min.js)
    const env = setupMinhasCotacoesEnv({ useJSZip: false });
    const { context, downloads } = env;

    assert.equal(context.JSZip, undefined, 'JSZip não deve existir no contexto');
    assert.equal(context.window.JSZip, undefined, 'window.JSZip não deve existir');

    const cotacao = {
        'COTAÇÃO': '998877',
        'VENCIMENTO': '30/10/2026',
        'LOCALIDADE': 'SÃO PAULO',
        'MARCA': 'HONEYWELL',
        'ITEM': 'Coletor de Dados Honeywell EDA51'
    };

    // Gera buffer sem JSZip
    const buffer = await context.gerarDocxCotacaoCoupaBlob(cotacao, { type: 'nodebuffer' });
    assert.ok(Buffer.isBuffer(buffer), 'Deve retornar um Buffer');
    assert.ok(buffer.length > 500, 'Tamanho do buffer deve ser válido');

    // Valida que o ZIP gerado é 100% compatível com a especificação standard lendo com JSZip
    const JSZip = require('../public/vendor/jszip.min.js');
    const zip = await JSZip.loadAsync(buffer);

    assert.ok(zip.file('[Content_Types].xml'), 'Deve conter [Content_Types].xml');
    assert.ok(zip.file('_rels/.rels'), 'Deve conter _rels/.rels');
    assert.ok(zip.file('word/_rels/document.xml.rels'), 'Deve conter word/_rels/document.xml.rels');
    assert.ok(zip.file('word/styles.xml'), 'Deve conter word/styles.xml');
    assert.ok(zip.file('word/document.xml'), 'Deve conter word/document.xml');

    const docXml = await zip.file('word/document.xml').async('text');
    assert.ok(docXml.includes('COTAÇÃO: #998877'));
    assert.ok(docXml.includes('Coletor de Dados Honeywell EDA51'));
    assert.ok(docXml.includes('MARCA: HONEYWELL'));

    // Valida exportação completa pela tela sem JSZip
    await context.exportarCotacaoWordCore(cotacao, null);

    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].filename, 'Cotacao_998877.docx');
    assert.ok(downloads[0].buffer && downloads[0].buffer.length > 500);
});





test('parseItensCotacao, Word e Planilha Base não confundem código de modelo/material no início do item com quantidade', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads } = env;

    // Caso 1: Código de modelo no início do ITEM (padrão Vale/Coupa: "13091680 || MOUSE...")
    const cotacaoModeloInicio = {
        'COTAÇÃO': '310150',
        'VENCIMENTO': '25/10/2026',
        'LOCALIDADE': 'PARAUAPEBAS-PA',
        'ITEM': '13091680 || MOUSE C/FIO OPTICO 1000DPI USB PRETO; CONEXAO: USB; COR: PRETO',
        'QUANTIDADE': '10 EA-cada',
        'MODELOS': '13091680',
        'MARCA': 'LOGITECH'
    };

    const itens1 = context.parseItensCotacao(cotacaoModeloInicio);
    assert.equal(itens1.length, 1);
    assert.equal(itens1[0].quantidade, 10, 'Quantidade deve ser 10 e não o código do modelo 13091680');
    assert.ok(itens1[0].produto.includes('13091680 || MOUSE C/FIO OPTICO'), 'Código do modelo deve permanecer na descrição do produto');

    // Verifica no Word XML (formato: <w:t xml:space="preserve">QTD: </w:t></w:r><w:r><w:t>10 - LOCAL: ...)
    const xml1 = context.gerarDocxCotacaoCoupaXml(cotacaoModeloInicio);
    assert.ok(xml1.includes('10 - LOCAL: PARAUAPEBAS-PA'), 'Word deve exibir 10 no campo QTD');
    assert.ok(!xml1.includes('13091680 - LOCAL:'), 'Word não deve colocar o modelo no campo QTD');

    // Verifica na Planilha Base
    await context.exportarCotacaoPlanilhaBase(cotacaoModeloInicio);
    assert.equal(downloads.length, 1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(downloads[0].buffer);
    const ws = wb.getWorksheet('ORÇAMENTO');
    assert.equal(ws.getCell('B2').value, 10, 'Célula B2 (QTD) na Planilha Base deve ser 10 e não 13091680');
    assert.ok(String(ws.getCell('A2').value).includes('13091680 || MOUSE'), 'Célula A2 deve conter o produto completo');
});

test('parseItensCotacao, Word e Planilha Base associam quantidades empilhadas linha a linha (ex: 05 und.\\n10 und.) na ordem de cada item', async () => {
    const env = setupMinhasCotacoesEnv();
    const { context, downloads } = env;

    // Caso reportado pelo usuário: múltiplos itens com quantidades uma embaixo da outra ("05 und.\n10 und.")
    const cotacaoEmpilhada = {
        'COTAÇÃO': 'PPG0236196',
        'VENCIMENTO': '28/10/2026',
        'LOCALIDADE': 'RIO DE JANEIRO-RJ',
        'ITEM': 'ITEM 1 - Trilho Gancheira de 1M em inox para cortina pvc frigorífica \nITEM 2 - Cortina Frigorífica PVC Transparente 200mm',
        'QUANTIDADE': '05 und.\n10 und.',
        'MARCA': 'N/A'
    };

    const itens = context.parseItensCotacao(cotacaoEmpilhada);
    assert.equal(itens.length, 2, 'Deve extrair 2 itens');
    assert.equal(itens[0].produto, 'Trilho Gancheira de 1M em inox para cortina pvc frigorífica');
    assert.equal(itens[0].quantidade, 5);
    assert.equal(itens[1].produto, 'Cortina Frigorífica PVC Transparente 200mm');
    assert.equal(itens[1].quantidade, 10);

    // Verifica exportação para Word
    const xml = context.gerarDocxCotacaoCoupaXml(cotacaoEmpilhada);
    assert.ok(xml.includes('5 - LOCAL: RIO DE JANEIRO-RJ'), 'Item 1 no Word deve ter QTD 5');
    assert.ok(xml.includes('10 - LOCAL: RIO DE JANEIRO-RJ'), 'Item 2 no Word deve ter QTD 10');

    // Verifica exportação para Planilha Base
    await context.exportarCotacaoPlanilhaBase(cotacaoEmpilhada);
    assert.equal(downloads.length, 1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(downloads[0].buffer);
    const ws = wb.getWorksheet('ORÇAMENTO');
    assert.equal(ws.getCell('A2').value, 'Trilho Gancheira de 1M em inox para cortina pvc frigorífica');
    assert.equal(ws.getCell('B2').value, 5, 'Item 1 na Planilha Base (B2) deve ter quantidade 5');
    assert.equal(ws.getCell('A3').value, 'Cortina Frigorífica PVC Transparente 200mm');
    assert.equal(ws.getCell('B3').value, 10, 'Item 2 na Planilha Base (B3) deve ter quantidade 10');

    // Caso adicional: múltiplos itens com "(Item 1)" + código de modelo + quantidades empilhadas "(Item 1) 1 UN\n(Item 2) 4 UN"
    const cotacaoMultiComModelo = {
        'COTAÇÃO': '296196',
        'ITEM': '(Item 1) 15392756 || MOCHILA NOTEBOOK EXECUTIVA\n(Item 2) 13091680 || MOUSE OPTICO USB',
        'QUANTIDADE': '(Item 1) 1 UN-unidade\n(Item 2) 4 UN-unidade',
        'MODELOS': '(Item 1) 15392756\n(Item 2) 13091680'
    };

    const itensMultiModelo = context.parseItensCotacao(cotacaoMultiComModelo);
    assert.equal(itensMultiModelo.length, 2);
    assert.equal(itensMultiModelo[0].quantidade, 1, 'Item 1 deve ter quantidade 1 e não o modelo 15392756');
    assert.ok(itensMultiModelo[0].produto.startsWith('15392756 || MOCHILA'));
    assert.equal(itensMultiModelo[1].quantidade, 4, 'Item 2 deve ter quantidade 4 e não o modelo 13091680');
    assert.ok(itensMultiModelo[1].produto.startsWith('13091680 || MOUSE'));
});
