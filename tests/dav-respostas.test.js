const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
globalThis.WebSocket ??= require('ws');
const { io } = require('../node_modules/socket.io/client-dist/socket.io.js');
const { criarDavRespostas, mesclarNcms } = require('../lib/dav-respostas');

const root = path.join(__dirname, '..');
const pausa = ms => new Promise(resolve => setTimeout(resolve, ms));
function event(socket, name, timeout = 4000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { socket.off(name, handler); reject(new Error('Sem evento: ' + name)); }, timeout);
        function handler(data) { clearTimeout(timer); resolve(data); }
        socket.once(name, handler);
    });
}
async function portFree() {
    const listener = net.createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
    const port = listener.address().port; await new Promise(resolve => listener.close(resolve)); return port;
}
const ioFalso = () => {
    const emitidos = [];
    return { emitidos, to: () => ({ emit: (nome, dados) => emitidos.push({ nome, dados }) }) };
};

test('mesclarNcms: NCM do Cotafrete vale; sem ele fica o da grade', () => {
    const r = mesclarNcms(['8471.60.53', '', '84137090'], [
        { item: 1, ncm: '', origem: 'cadastro HSE' },
        { item: 2, ncm: '84716052', origem: 'IA' },
        { item: 3, ncm: null, origem: 'cadastro HSE' }]);
    assert.deepEqual(r.ncms, ['8471.60.53', '84716052', '84137090']);
    assert.deepEqual(r.origens, ['digitado', 'IA', 'digitado']);
    assert.deepEqual(mesclarNcms(undefined, [{ ncm: '123' }]).ncms, ['']);   // NCM que não tem 8 dígitos não entra
});

test('criarDavRespostas: grava, avisa a tela e acha pela cotação', () => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dav-'));
    const caminho = path.join(pasta, 'dav.json');
    const io = ioFalso();
    const dav = criarDavRespostas({ caminho, io });
    assert.equal(dav.salvarStatus('Evento 301015', { estado: 'inventado' }), null);
    dav.salvarStatus('Evento 301015', { estado: 'erro', mensagem: 'x', erros: ['Item 1: sem NCM'] });
    assert.equal(io.emitidos[0].nome, 'status_dav_atualizado');
    assert.equal(io.emitidos[0].dados.evento, '301015');
    const mapa = dav.paraCotacoes([{ 'COTAÇÃO': 'CQ-301015' }]);
    assert.deepEqual(mapa['301015'].erros, ['Item 1: sem NCM']);
    // sobrevive a reinício (arquivo)
    assert.equal(criarDavRespostas({ caminho, io: ioFalso() }).obter('301015').estado, 'erro');
    dav.aguardar('301015', { payload: { a: 1 } });
    assert.equal(dav.esperando('Evento 301015'), true);
    assert.deepEqual(dav.retirar('301015'), { payload: { a: 1 } });
    assert.equal(dav.retirar('301015'), null);
    dav.limparStatus('301015');
    assert.equal(dav.obter('301015'), null);
});

test('servidor real: Planilha Base sem DAV pede o DAV ao gerenciador e só depois vai à fila', async t => {
    const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'dav-srv-'));
    const port = await portFree(), secret = crypto.randomBytes(32).toString('hex'), sockets = [];
    const child = spawn(process.env.NODE_DO_SERVIDOR || process.execPath, ['server.js'], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            ...process.env, HOST: '127.0.0.1', PORT: String(port), ROBO_SECRET: secret,
            MASTER_SECRET: crypto.randomBytes(32).toString('hex'),
            DAV_RESPOSTAS_FILE: path.join(pasta, 'dav.json'), ERROS_RESPOSTAS_FILE: path.join(pasta, 'erros.json'),
            PRINTS_RESPOSTAS_FILE: path.join(pasta, 'prints.json')
        }
    });
    t.after(() => { sockets.forEach(s => s.disconnect()); child.kill(); });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Servidor não iniciou.')), 10000);
        child.stdout.on('data', d => { if (String(d).includes('rodando na porta')) { clearTimeout(timer); resolve(); } });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('Servidor encerrou: ' + code)); });
    });
    async function client(auth = {}) {
        const socket = io(`http://127.0.0.1:${port}`, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
        sockets.push(socket); await event(socket, 'connect'); return socket;
    }
    const bot = await client({ robo_secret: secret });
    const pronto = event(bot, 'sincronizar_estado'); bot.emit('sou_o_robo'); await pronto;
    const doRobo = [];
    bot.onAny((nome, dados) => doRobo.push({ nome, dados }));
    bot.on('validar_login', d => bot.emit('resultado_login', { sucesso: true, user: d.user, clientId: d.clientId, vendedor: 'ANA', hasPlanilhaAccess: true, hasPortaisAccess: true }));
    const anonimo = await client(), resposta = event(anonimo, 'resposta_login');
    anonimo.emit('solicitar_login', { user: 'ana@example.test', pass: 'senha-de-teste' });
    const { sessionId } = await resposta; anonimo.disconnect();
    const tela = await client({ sessionId });
    const est = event(tela, 'sincronizar_estado'); tela.emit('sou_frontend', {}); await est;

    async function responder(campos, planilha) {
        const form = new FormData();
        for (const [k, v] of Object.entries({ sessionId, portal: 'coupa', precos: '["10","20"]', prazos: '["5","5"]', ncms: '["84137090",""]', ...campos })) form.append(k, v);
        if (planilha) form.append('planilha', new Blob([Buffer.from('xlsx-falso')]), planilha);
        const r = await fetch(`http://127.0.0.1:${port}/api/responder`, { method: 'POST', body: form });
        return { status: r.status, corpo: await r.json() };
    }

    // .xls não serve para gerar o DAV
    assert.equal((await responder({ evento: '301010' }, 'base.xls')).status, 400);

    // Pedido do DAV: vai ao gerenciador (gerar_dav), NÃO à fila do robô
    const pedido = event(bot, 'gerar_dav');
    const statusTela = event(tela, 'status_dav_atualizado');
    const r = await responder({ evento: '301015' }, 'base.xlsx');
    assert.equal(r.status, 200); assert.equal(r.corpo.gerando_dav, true);
    const g = await pedido;
    assert.equal(g.evento, '301015'); assert.equal(g.portal, 'coupa'); assert.equal(g.vendedor, 'ANA');
    assert.equal(Buffer.from(g.planilha.data, 'base64').toString(), 'xlsx-falso');
    assert.equal((await statusTela).status.estado, 'gerando');
    await pausa(150);
    assert.equal(doRobo.some(e => e.nome === 'comando_para_robo'), false);

    // Visitante não forja o dav_pronto
    const visitante = await client();
    visitante.emit('dav_pronto', { evento: '301015', davs: [{ name: 'x.pdf', data: 'AA==' }], itens: [] });
    await pausa(150);
    assert.equal(doRobo.some(e => e.nome === 'comando_para_robo'), false);

    // DAV pronto: a resposta entra na fila com o PDF e o NCM do Cotafrete
    const paraRobo = event(bot, 'comando_para_robo');
    bot.emit('dav_pronto', {
        evento: '301015', numero: '16700', avisos: ['Item 1: confira'],
        davs: [{ name: '../../DAV_16700.pdf', data: Buffer.from('%PDF').toString('base64') }],
        itens: [{ item: 1, ncm: '', origem: 'cadastro HSE' }, { item: 2, ncm: '84716052', origem: 'IA' }]
    });
    const cmd = await paraRobo;
    assert.equal(cmd.modo, 'responder'); assert.equal(cmd.evento, '301015');
    assert.deepEqual(cmd.davs, [{ name: 'DAV_16700.pdf', data: Buffer.from('%PDF').toString('base64') }]);
    assert.deepEqual(cmd.ncms, ['84137090', '84716052']);
    assert.deepEqual(cmd.ncms_origem, ['digitado', 'IA']);
    assert.equal(cmd.dav_numero, '16700');
    assert.equal(JSON.parse(fs.readFileSync(path.join(pasta, 'dav.json'), 'utf8'))['301015'].estado, 'pronto');

    // Erro no DAV: vira erro do evento e não vai ao robô
    const pedido2 = event(bot, 'gerar_dav');
    await responder({ evento: '301016' }, 'base.xlsx'); await pedido2;
    const erroTela = event(tela, 'erro_evento_atualizado');
    bot.emit('status_dav', { evento: '301016', estado: 'erro', mensagem: 'Item 1: código inativo', erros: ['Item 1: código inativo'] });
    assert.match((await erroTela).erro, /^DAV: Item 1: código inativo/);
    await pausa(150);
    assert.equal(doRobo.filter(e => e.nome === 'comando_para_robo').length, 1);
    // dav_pronto atrasado de um pedido que já deu erro: avisa, não responde
    bot.emit('dav_pronto', { evento: '301016', numero: '1', davs: [], itens: [] });
    await pausa(150);
    assert.equal(doRobo.filter(e => e.nome === 'comando_para_robo').length, 1);
    assert.match(JSON.parse(fs.readFileSync(path.join(pasta, 'dav.json'), 'utf8'))['301016'].mensagem, /resposta se perdeu/);

    // Com DAV anexado à mão, segue o caminho de sempre (sem gerar_dav)
    const form = new FormData();
    for (const [k, v] of Object.entries({ sessionId, portal: 'coupa', evento: '301017', precos: '["1"]' })) form.append(k, v);
    form.append('dav', new Blob([Buffer.from('%PDF manual')]), 'manual.pdf');
    form.append('planilha', new Blob([Buffer.from('xlsx')]), 'base.xlsx');
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/responder`, { method: 'POST', body: form })).status, 200);
    await pausa(200);
    assert.equal(doRobo.filter(e => e.nome === 'gerar_dav').length, 2);
});
