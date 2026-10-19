let VENDEDORES = [];
let COTACOES = [];
const SITUACOES = ['Não iniciada', 'Em análise', 'Aguardando retorno'];
const CHAVE_DEMO = 'maestro_vendedores_acompanhamento_v1';

function dataISO(data) {
    return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}
function dataComDias(dias) {
    const data = new Date();
    data.setHours(12, 0, 0, 0);
    data.setDate(data.getDate() + dias);
    return dataISO(data);
}
function dataBR(iso) { return iso.split('-').reverse().join('/'); }
function escapar(valor) { return String(valor).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function vencimentoISO(valor) {
    const texto = String(valor || '').trim();
    const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    const br = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
    if (!iso && !br) return null;
    const ano = Number(iso ? iso[1] : br[3]);
    const dia = Number(iso ? iso[3] : Number(br[2]) > 12 ? br[2] : br[1]);
    const mes = Number(iso ? iso[2] : Number(br[2]) > 12 ? br[1] : br[2]);
    const data = new Date(ano, mes - 1, dia, 12);
    if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) return null;
    return dataISO(data);
}
function campo(registro, nome) {
    const chave = Object.keys(registro).find(chave => chave.trim().toUpperCase() === nome);
    return chave === undefined ? '' : registro[chave] ?? '';
}
function normalizarCotacoes(registros, inicio = dataComDias(0)) {
    if (!Array.isArray(registros)) return [];
    return registros.flatMap((original, index) => {
        if (!original || typeof original !== 'object' || Array.isArray(original)) return [];
        const vencimento = vencimentoISO(campo(original, 'VENCIMENTO'));
        const vendedor = String(campo(original, 'VENDEDOR')).trim().replace(/\s+/g, ' ').toUpperCase();
        if (!vencimento || vencimento < inicio || !vendedor || ['-', 'SEM VENDEDOR', 'NÃO INFORMADO'].includes(vendedor)) return [];
        const numero = String(campo(original, 'COTAÇÃO') || 'Sem identificação');
        const descricao = String(campo(original, 'ITEM') || campo(original, 'ITENS'));
        const localidade = String(campo(original, 'LOCALIDADE'));
        return [{ id: String(index), chave: JSON.stringify([numero, vendedor, localidade, descricao]),
            numero, vendedor, vencimento, descricao, localidade, item: descricao.split('\n')[0] || 'Item não informado',
            quantidade: String(campo(original, 'QUANTIDADE') || campo(original, 'QTD')),
            modelos: String(campo(original, 'MODELOS')), marcas: String(campo(original, 'MARCAS')),
            resposta: String(campo(original, 'RESPOSTA')), situacao: 'Não iniciada', original }];
    });
}
function vendedoresAtivos(cotacoes) {
    return [...new Set(cotacoes.map(c => c.vendedor))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

function filtrarCotacoes(cotacoes, { vendedor, todas, inicio, fim, busca }) {
    if (inicio && fim && inicio > fim) return [];
    const termo = (busca || '').trim().toLocaleLowerCase('pt-BR');
    return cotacoes.filter(c => c.vencimento >= dataComDias(0) && (todas || c.vendedor === vendedor) &&
        (!inicio || c.vencimento >= inicio) && (!fim || c.vencimento <= fim) &&
        (!termo || [c.numero, c.item, c.descricao, c.localidade, c.vendedor].join(' ').toLocaleLowerCase('pt-BR').includes(termo)))
        .sort((a, b) => a.vencimento.localeCompare(b.vencimento) || a.numero.localeCompare(b.numero));
}

let perfil = null;
let verTodas = false;
let itemAberto = null;
let acompanhamentos = {};
let avisoTimer;
let socketVendedores;
let carregando = false;
let limiteCarregamento;
let autenticado = false;
let respostaPendente = false;
let limiteResposta;
const el = id => document.getElementById(id);

function avisar(texto) {
    clearTimeout(avisoTimer);
    el('aviso').textContent = texto;
    el('aviso').hidden = false;
    avisoTimer = setTimeout(() => { el('aviso').hidden = true; }, 4500);
}
function acompanhamento(c) {
    const salvo = acompanhamentos[c.chave] || {};
    return { situacao: SITUACOES.includes(salvo.situacao) ? salvo.situacao : c.situacao,
        anotacoes: typeof salvo.anotacoes === 'string' ? salvo.anotacoes.slice(0, 2000) : '' };
}
function resetarFiltros() {
    el('busca').value = '';
    el('data-inicio').value = dataComDias(0);
    el('data-fim').value = '';
    renderizar();
}
function entrar(nome) {
    if (!VENDEDORES.includes(nome)) return;
    perfil = nome;
    verTodas = false;
    el('tela-perfis').hidden = true;
    el('tela-carteira').hidden = false;
    el('trocar-perfil').hidden = false;
    const bonito = nome[0] + nome.slice(1).toLowerCase();
    el('saudacao').textContent = `Olá, ${bonito}.`;
    el('nome-perfil').textContent = bonito;
    el('avatar').textContent = nome.slice(0, 2);
    resetarFiltros();
    document.title = `${bonito} · Cotações vendedores · MAESTRO`;
    el('minhas').focus();
}
function renderizar() {
    const minhas = COTACOES.filter(c => c.vendedor === perfil && c.vencimento >= dataComDias(0));
    el('total-abertas').textContent = minhas.length;
    el('total-hoje').textContent = minhas.filter(c => c.vencimento === dataComDias(0)).length;
    el('total-semana').textContent = minhas.filter(c => c.vencimento <= dataComDias(7)).length;
    const inicio = el('data-inicio').value;
    const fim = el('data-fim').value;
    el('erro-periodo').hidden = !(inicio && fim && inicio > fim);
    const lista = filtrarCotacoes(COTACOES, { vendedor: perfil, todas: verTodas, inicio, fim, busca: el('busca').value });
    el('minhas').classList.toggle('active', !verTodas);
    el('todas').classList.toggle('active', verTodas);
    el('minhas').setAttribute('aria-pressed', String(!verTodas));
    el('todas').setAttribute('aria-pressed', String(verTodas));
    el('total-filtrado').textContent = lista.length;
    el('descricao-lista').textContent = verTodas ? 'cotações de todos os vendedores' : 'cotações na sua lista';
    el('tabela').hidden = lista.length === 0;
    el('vazio').hidden = lista.length !== 0;
    el('linhas').innerHTML = lista.map(c => {
        const status = c.resposta.trim().toUpperCase() === 'RESPONDIDO' ? 'Respondida' : acompanhamento(c).situacao;
        const classe = status === 'Em análise' ? 'analysis' : status === 'Aguardando retorno' ? 'waiting' : '';
        const dias = Math.round((Date.parse(c.vencimento) - Date.parse(dataComDias(0))) / 86400000);
        const prazo = dias === 0 ? 'Vence hoje' : dias === 1 ? 'Amanhã' : dias < 0 ? 'Prazo vencido' : `Em ${dias} dias`;
        return `<tr><td><div class="cell-content"><span class="doc-icon"><i class="fa-solid fa-file-lines" aria-hidden="true"></i></span><div><button class="quote-button" data-id="${c.id}">${escapar(c.numero)}</button><span class="item-preview">${escapar(c.item)}</span></div></div></td>
            <td><span class="date-pill ${dias === 0 ? 'date-today' : ''}">${dataBR(c.vencimento)}</span><span class="deadline-caption">${prazo}</span></td>
            <td><span class="seller-label">${escapar(c.vendedor)}</span></td><td>${escapar(c.localidade)}</td><td><span class="status ${classe}">${status}</span></td>
            <td><button class="details-button" data-id="${c.id}" aria-label="Abrir ${escapar(c.numero)}">↗</button></td></tr>`;
    }).join('');
    window.filteredCotacoes = lista.map(c => ({ ...c.original, ACOMPANHAMENTO: acompanhamento(c).situacao, ANOTAÇÕES: acompanhamento(c).anotacoes }));
    el('btn-exportar-excel').disabled = lista.length === 0;
}
function abrirDetalhes(id) {
    if (respostaPendente) return avisar('Aguarde a confirmação da resposta antes de abrir outra cotação.');
    const c = COTACOES.find(c => c.id === id);
    if (!c) return;
    itemAberto = c;
    const salvo = acompanhamento(c);
    el('titulo-detalhes').textContent = c.numero;
    el('conteudo-detalhes').innerHTML = `<dl class="detail-grid"><div><dt>Vencimento</dt><dd>${dataBR(c.vencimento)}</dd></div><div><dt>Vendedor</dt><dd>${escapar(c.vendedor)}</dd></div><div><dt>Localidade</dt><dd>${escapar(c.localidade)}</dd></div><div><dt>Quantidade</dt><dd>${escapar(c.quantidade || '-')}</dd></div><div><dt>Modelos / marcas</dt><dd>${escapar([c.modelos, c.marcas].filter(Boolean).join(' / ') || '-')}</dd></div><div><dt>Resposta na planilha</dt><dd>${escapar(c.resposta || '-')}</dd></div></dl><section class="dialog-items"><h3>Descrição dos itens</h3><p class="description">${escapar(c.descricao || 'Não informada')}</p></section>`;
    el('situacao').value = salvo.situacao;
    el('anotacoes').value = salvo.anotacoes;
    el('marcar-respondida').disabled = respostaPendente || c.resposta.trim().toUpperCase() === 'RESPONDIDO';
    el('estado-resposta').textContent = c.resposta.trim().toUpperCase() === 'RESPONDIDO' ? 'Cotação respondida na Planilha Vale.' : 'Atualiza o JSON da Planilha Vale. O Excel é atualizado pelo serviço de sincronização existente.';
    el('detalhes').showModal();
}

function renderizarVendedores() {
    VENDEDORES = vendedoresAtivos(COTACOES);
    el('perfis').innerHTML = VENDEDORES.map(nome => {
        const quantidade = COTACOES.filter(c => c.vendedor === nome).length;
        return `<button class="profile-card" data-perfil="${escapar(nome)}"><span class="avatar">${escapar(nome.slice(0, 2))}</span><span><strong>${escapar(nome[0] + nome.slice(1).toLowerCase())}</strong><small>${quantidade} ${quantidade === 1 ? 'cotação no prazo' : 'cotações no prazo'}</small></span><span class="profile-link">Ver cotações <span aria-hidden="true">→</span></span></button>`;
    }).join('');
    el('sem-vendedores').hidden = VENDEDORES.length !== 0;
}
function mostrarConexao(mensagem, erro = false) {
    el('mensagem-conexao').textContent = mensagem;
    el('estado-conexao').classList.toggle('connection-error', erro);
}
function solicitarDados() {
    if (!autenticado || !socketVendedores?.connected || carregando) return;
    carregando = true;
    el('atualizar-dados').disabled = true;
    mostrarConexao('Carregando cotações da Planilha Vale…');
    socketVendedores.emit('solicitar_planilha_json', { origem: 'todas' });
    clearTimeout(limiteCarregamento);
    limiteCarregamento = setTimeout(() => {
        carregando = false;
        el('atualizar-dados').disabled = false;
        mostrarConexao('A planilha ainda não respondeu. Clique em Atualizar para tentar novamente.', true);
    }, 25000);
}
function conectarPlanilha() {
    const sessionId = localStorage.getItem('maestro_session');
    if (!sessionId) {
        mostrarConexao('Entre no Maestro para consultar as cotações reais.', true);
        el('entrar-maestro').hidden = false;
        el('atualizar-dados').disabled = true;
        return;
    }
    if (typeof io !== 'function') {
        mostrarConexao('Não foi possível carregar a conexão. Atualize a página para tentar novamente.', true);
        return;
    }
    socketVendedores = io(window.location.origin, { auth: { sessionId }, transports: ['websocket'], upgrade: false });
    socketVendedores.on('connect', () => {
        autenticado = false;
        socketVendedores.emit('sou_frontend', { sessionId });
    });
    socketVendedores.on('sincronizar_estado', () => {
        if (autenticado) return;
        autenticado = true;
        solicitarDados();
    });
    socketVendedores.on('retorno_planilha_json', res => {
        clearTimeout(limiteCarregamento);
        carregando = false;
        el('atualizar-dados').disabled = false;
        if (!res?.sucesso || !Array.isArray(res.cotacoes)) {
            mostrarConexao(res?.erro || 'Não foi possível consultar a planilha. Tente Atualizar.', true);
            return;
        }
        COTACOES = normalizarCotacoes(res.cotacoes);
        renderizarVendedores();
        if (perfil) renderizar();
        mostrarConexao(`Atualizado às ${new Date().toLocaleTimeString('pt-BR')} · ${COTACOES.length} cotações no prazo · ${VENDEDORES.length} vendedores`);
    });
    socketVendedores.on('planilha_atualizada', solicitarDados);
    socketVendedores.on('resposta_acao_linha', res => {
        if (!respostaPendente) return;
        clearTimeout(limiteResposta);
        respostaPendente = false;
        el('marcar-respondida').disabled = false;
        el('estado-resposta').textContent = res?.sucesso
            ? 'Resposta salva no JSON. A atualização do Excel será feita pelo serviço existente.'
            : res?.erro || 'Não foi possível salvar a resposta.';
        if (res?.sucesso) {
            el('marcar-respondida').disabled = true;
            solicitarDados();
        }
    });
    socketVendedores.on('sessao_invalida', () => {
        clearTimeout(limiteCarregamento);
        autenticado = false;
        carregando = false;
        COTACOES = [];
        window.filteredCotacoes = [];
        renderizarVendedores();
        el('tela-carteira').hidden = true;
        el('tela-perfis').hidden = false;
        el('trocar-perfil').hidden = true;
        el('detalhes').close();
        perfil = null;
        localStorage.removeItem('maestro_session');
        socketVendedores.disconnect();
        mostrarConexao('Sua sessão expirou. Entre novamente no Maestro.', true);
        el('entrar-maestro').hidden = false;
        el('atualizar-dados').disabled = true;
    });
    const falhaConexao = () => {
        clearTimeout(limiteCarregamento);
        carregando = false;
        autenticado = false;
        el('atualizar-dados').disabled = false;
        mostrarConexao('Conexão interrompida. Os dados podem estar desatualizados. Clique em Atualizar.', true);
    };
    socketVendedores.on('connect_error', falhaConexao);
    socketVendedores.on('disconnect', falhaConexao);
    el('atualizar-dados').addEventListener('click', () => {
        if (socketVendedores.connected) solicitarDados();
        else socketVendedores.connect();
    });
    window.addEventListener('focus', solicitarDados);
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const salvo = JSON.parse(localStorage.getItem(CHAVE_DEMO) || '{}');
        if (salvo && typeof salvo === 'object' && !Array.isArray(salvo)) acompanhamentos = salvo;
    } catch { avisar('Não foi possível recuperar as anotações anteriores da demo.'); }
    el('perfis').addEventListener('click', e => { const botao = e.target.closest('[data-perfil]'); if (botao) entrar(botao.dataset.perfil); });
    el('trocar-perfil').addEventListener('click', () => {
        el('tela-carteira').hidden = true;
        el('tela-perfis').hidden = false;
        el('trocar-perfil').hidden = true;
        perfil = null;
        document.title = 'MAESTRO | Cotações vendedores';
        el('perfis').querySelector('button')?.focus();
    });
    el('minhas').addEventListener('click', () => { verTodas = false; renderizar(); });
    el('todas').addEventListener('click', () => { verTodas = true; renderizar(); });
    ['busca', 'data-inicio', 'data-fim'].forEach(id => el(id).addEventListener('input', renderizar));
    ['limpar', 'limpar-vazio'].forEach(id => el(id).addEventListener('click', resetarFiltros));
    el('imprimir').addEventListener('click', () => window.print());
    el('linhas').addEventListener('click', e => { const botao = e.target.closest('[data-id]'); if (botao) abrirDetalhes(botao.dataset.id); });
    el('fechar-detalhes').addEventListener('click', () => el('detalhes').close());
    el('marcar-respondida').addEventListener('click', () => {
        if (!itemAberto || respostaPendente) return;
        if (!autenticado || !socketVendedores?.connected) return avisar('Conecte-se ao Maestro antes de salvar.');
        respostaPendente = true;
        el('marcar-respondida').disabled = true;
        el('estado-resposta').textContent = 'Salvando resposta no JSON…';
        socketVendedores.emit('marcar_cotacao_respondida', { identidade: Object.fromEntries(
            ['COTAÇÃO', 'VENDEDOR', 'LOCALIDADE', 'ITEM', 'VENCIMENTO'].map(c => [c, String(campo(itemAberto.original, c))])) });
        limiteResposta = setTimeout(() => {
            respostaPendente = false;
            el('marcar-respondida').disabled = false;
            el('estado-resposta').textContent = 'Sem confirmação. Clique em Atualizar e confira a resposta antes de tentar novamente.';
        }, 25000);
    });
    el('detalhes').addEventListener('click', e => { if (e.target === el('detalhes')) {
        const r = el('detalhes').getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) el('detalhes').close();
    } });
    el('acompanhamento').addEventListener('submit', e => {
        e.preventDefault();
        if (!itemAberto) return;
        acompanhamentos[itemAberto.chave] = { situacao: el('situacao').value, anotacoes: el('anotacoes').value.trim() };
        try {
            localStorage.setItem(CHAVE_DEMO, JSON.stringify(acompanhamentos));
            renderizar();
            el('detalhes').close();
            avisar('Acompanhamento salvo neste navegador.');
        } catch { avisar('Não foi possível salvar. Copie suas anotações antes de fechar esta tela.'); }
    });
    conectarPlanilha();
});
