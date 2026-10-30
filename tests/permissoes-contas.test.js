const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../public/dashboard-comum/contas.js');
const B = require('../public/dashboard-comum/base.js');
const { autorizarAdmin, autorizarEstatisticas } = require('../lib/dashboard-cotacoes.js');

test('contas: normalizarUsuarios, kpis e filtros refletem portais e estatisticas', () => {
    const usuarios = {
        'admin@teste.com': { admin: true, vendedor: 'ADMIN' },
        'vend_portais@teste.com': { portais_access: true, vendedor: 'JOAO' },
        'vend_stats@teste.com': { dashboard_access: true, vendedor: 'MARIA' },
        'vend_sem_nada@teste.com': { vendedor: 'PEDRO' },
    };

    const norm = C.normalizarUsuarios(usuarios);
    const maria = norm.find(u => u.email === 'vend_stats@teste.com');
    assert.equal(maria.dashboard_access, true);
    assert.equal(maria.portais_access, true, 'Quem tem estatisticas automaticamente tem portais');

    const kpis = C.kpisContas(norm);
    assert.equal(kpis.total, 4);
    assert.equal(kpis.admins, 1);
    assert.equal(kpis.portais, 3, 'admin, vend_portais e vend_stats tem portais');
    assert.equal(kpis.estatisticas, 2, 'admin e vend_stats tem estatisticas');

    const fPortais = C.filtrarUsuarios(norm, { grupo: 'portais' });
    assert.equal(fPortais.length, 3);
    const fStats = C.filtrarUsuarios(norm, { grupo: 'estatisticas' });
    assert.equal(fStats.length, 2);
});

test('contas: tabela nao contem coluna de Planilha Geral e contem Portais e Estatisticas', () => {
    const usuarios = {
        'vend@teste.com': { portais_access: true, dashboard_access: false, vendedor: 'VENDEDOR' }
    };
    const ctx = { icone: () => '', num: v => v };
    const html = C.pagina({ usuarios }, ctx, { grupo: '', busca: '' });

    assert.doesNotMatch(html, /Permissões · Planilha Geral/);
    assert.match(html, /Permissões · Portais \(Robôs\)/);
    assert.match(html, /Permissões · Estatísticas \(Comercial\)/);
    assert.match(html, /data-campo="portais_access"/);
    assert.match(html, /data-campo="dashboard_access"/);
});

test('base: sidebar de nao-admin exibe APENAS Gestao comercial e esconde todas as outras secoes', () => {
    const sbRestrita = B.sidebar('cotacoes', { isAdmin: false });

    assert.match(sbRestrita, /Gestão comercial/);
    assert.match(sbRestrita, /data-view="overview"/);
    assert.match(sbRestrita, /data-view="vendors"/);
    assert.match(sbRestrita, /data-view="quotes"/);
    assert.match(sbRestrita, /data-view="history"/);

    assert.doesNotMatch(sbRestrita, /Operação e robôs/);
    assert.doesNotMatch(sbRestrita, /Pedidos e planilha/);
    assert.doesNotMatch(sbRestrita, /Controle e admin/);
    assert.doesNotMatch(sbRestrita, /monitoramento\.html/);
    assert.doesNotMatch(sbRestrita, /sync\.html/);
    assert.doesNotMatch(sbRestrita, /dashboard\.html/);

    const sbAdmin = B.sidebar('cotacoes', { isAdmin: true });
    assert.match(sbAdmin, /Gestão comercial/);
    assert.match(sbAdmin, /Operação e robôs/);
    assert.match(sbAdmin, /Pedidos e planilha/);
    assert.match(sbAdmin, /Controle e admin/);
});

test('backend: autorizarEstatisticas aceita dashboard_access e autorizarAdmin rejeita', () => {
    const sessoes = new Map();
    sessoes.set('sessao_stats', JSON.stringify({ email: 'stats@teste.com', dashboard_access: true, expires: Date.now() + 60000 }));
    sessoes.set('sessao_user', JSON.stringify({ email: 'user@teste.com', expires: Date.now() + 60000 }));
    sessoes.set('sessao_admin', JSON.stringify({ email: 'admin@teste.com', admin: true, expires: Date.now() + 60000 }));

    let emitido = null;
    const socketStats = { sessionId: 'sessao_stats', emit: (ev, d) => { emitido = { ev, d }; } };
    const socketUser = { sessionId: 'sessao_user', emit: (ev, d) => { emitido = { ev, d }; } };
    const socketAdmin = { sessionId: 'sessao_admin', emit: (ev, d) => { emitido = { ev, d }; } };

    // Usuário com dashboard_access
    const autStats = autorizarEstatisticas(sessoes, socketStats, 'teste');
    assert.ok(autStats);
    assert.equal(autStats.email, 'stats@teste.com');

    // Admin
    const autAdm = autorizarEstatisticas(sessoes, socketAdmin, 'teste');
    assert.ok(autAdm);

    // Usuário comum sem permissão
    emitido = null;
    const autComum = autorizarEstatisticas(sessoes, socketUser, 'teste');
    assert.equal(autComum, null);
    assert.equal(emitido.d.codigo, 'SEM_PERMISSAO');

    // autorizarAdmin rejeita usuario com apenas dashboard_access
    emitido = null;
    const autAdminRejeita = autorizarAdmin(sessoes, socketStats, 'teste');
    assert.equal(autAdminRejeita, null);
    assert.equal(emitido.d.codigo, 'SEM_PERMISSAO');
});
