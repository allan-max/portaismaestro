/* Seletor de vendedores das planilhas (Vale e Anmyna): Atribuir Vendedor, registro de cotação e edição de evento.
   - Lista o nome completo das contas com vendedor vinculado (vem do robô: pedir_vendedores_cadastrados).
   - O "+" acrescenta outro vendedor: a cotação dividida fica "Gustavo Cabral Calvi / Libni Xavier" na coluna VENDEDOR
     e aparece no Minhas Cotações dos dois (lib/dono-cotacao.js separa por "/").
   - Valor antigo que não está na lista (ex.: "GUSTAVO") continua selecionado, marcado como "não cadastrado".
   Uso: htmlSeletorVendedores('c-vendedor', 'form-input') monta um seletor; lerVendedores(el) / definirVendedores(el, v). */
(function (root) {
    'use strict';
    const SEPARADOR = ' / ';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let lista = null;      // [{vendedor, nome}] ou null enquanto carrega
    let erro = '';

    const separar = valor => String(valor || '').split(/[/,;+]/).map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const mesmo = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

    function opcoesHtml(selecionado) {
        if (!lista) return `<option value="">${erro ? 'Não foi possível carregar os vendedores' : 'Carregando vendedores…'}</option>`;
        const sel = String(selecionado || '');
        let achou = !sel;
        const ops = lista.filter(v => v && v.vendedor).map(v => {
            const marcado = sel && mesmo(v.vendedor, sel);
            if (marcado) achou = true;
            return `<option value="${esc(v.vendedor)}"${marcado ? ' selected' : ''}>${esc(v.nome || v.vendedor)}</option>`;
        });
        const antigo = achou ? '' : `<option value="${esc(sel)}" selected>${esc(sel)} (não cadastrado)</option>`;
        return `<option value="">${lista.length ? 'Selecione o vendedor' : 'Nenhum vendedor cadastrado'}</option>${antigo}${ops.join('')}`;
    }

    function linhaHtml(classeCampo, valor, primeira) {
        const botao = primeira
            ? '<button type="button" class="vend-multi-btn vend-multi-mais" data-vend-acao="mais" title="Adicionar outro vendedor (cotação dividida)" aria-label="Adicionar outro vendedor">+</button>'
            : '<button type="button" class="vend-multi-btn vend-multi-tirar" data-vend-acao="tirar" title="Tirar este vendedor" aria-label="Tirar este vendedor">×</button>';
        return `<div class="vend-multi-linha"><select class="vend-multi-sel ${esc(classeCampo)}" data-valor="${esc(valor)}">${opcoesHtml(valor)}</select>${botao}</div>`;
    }

    /** HTML de um seletor (string). 'classe' fica no contêiner (para achar na linha da tabela); 'classeCampo' no select. */
    function htmlSeletorVendedores(classe = '', classeCampo = '', valor = '') {
        const partes = separar(valor);
        const linhas = (partes.length ? partes : ['']).map((v, i) => linhaHtml(classeCampo, v, i === 0)).join('');
        return `<div class="vend-multi ${esc(classe)}" data-classe-campo="${esc(classeCampo)}">${linhas}</div>`;
    }

    /** Nomes escolhidos, sem repetidos, juntos com " / " (o que vai para a coluna VENDEDOR). */
    function lerVendedores(el) {
        if (!el) return '';
        const vistos = [];
        el.querySelectorAll('select.vend-multi-sel').forEach(s => {
            const v = s.value.trim();
            if (v && !vistos.some(x => mesmo(x, v))) vistos.push(v);
        });
        return vistos.join(SEPARADOR);
    }

    function definirVendedores(el, valor) {
        if (!el) return;
        const partes = separar(valor);
        const classeCampo = el.dataset.classeCampo || '';
        el.innerHTML = (partes.length ? partes : ['']).map((v, i) => linhaHtml(classeCampo, v, i === 0)).join('');
    }

    /** Transforma um elemento vazio (ex.: <div id="input-vendedor" class="vend-multi" data-classe-campo="...">) em seletor. */
    function montarSeletor(el, valor = '') {
        if (!el) return;
        el.classList.add('vend-multi');
        definirVendedores(el, valor);
    }

    function redesenharTodos() {
        root.document.querySelectorAll('select.vend-multi-sel').forEach(s => {
            const valor = s.value || s.dataset.valor || '';
            s.innerHTML = opcoesHtml(valor);
        });
    }

    if (root.document) root.document.addEventListener('click', e => {
        const btn = e.target.closest && e.target.closest('[data-vend-acao]');
        if (!btn) return;
        e.preventDefault();
        const caixa = btn.closest('.vend-multi');
        if (btn.dataset.vendAcao === 'mais') caixa.insertAdjacentHTML('beforeend', linhaHtml(caixa.dataset.classeCampo || '', '', false));
        else btn.closest('.vend-multi-linha').remove();
    });
    if (root.document) root.document.addEventListener('change', e => {
        if (e.target.classList && e.target.classList.contains('vend-multi-sel')) e.target.dataset.valor = e.target.value;
    });

    function ligarSeletorVendedores(socket) {
        const pedir = () => socket.emit('pedir_vendedores_cadastrados');
        socket.on('resposta_vendedores_cadastrados', res => {
            if (res && res.sucesso) { lista = Array.isArray(res.vendedores) ? res.vendedores : []; erro = ''; }
            else if (!lista) erro = (res && res.erro) || 'erro';
            redesenharTodos();
        });
        socket.on('connect', pedir);
        if (socket.connected) pedir();
        return pedir;
    }

    // Estilo próprio (as duas planilhas usam o tema escuro); o select herda a classe de campo da página
    if (root.document && !root.document.getElementById('vend-multi-estilo')) {
        const st = root.document.createElement('style');
        st.id = 'vend-multi-estilo';
        st.textContent = `
            .vend-multi { display: flex; flex-direction: column; gap: 6px; min-width: 170px; }
            .vend-multi-linha { display: flex; align-items: center; gap: 6px; }
            .vend-multi-sel { flex: 1; min-width: 0; cursor: pointer; }
            .vend-multi-sel option { background: #22272e; color: #cdd9e5; }
            .vend-multi-btn { flex: none; width: 30px; height: 30px; border-radius: 50%; border: 1px solid #444c56;
                background: #2d333b; color: #adbac7; font-size: 18px; line-height: 1; cursor: pointer; display: inline-flex;
                align-items: center; justify-content: center; padding: 0; transition: background .15s, border-color .15s, color .15s; }
            .vend-multi-mais { color: #57ab5a; border-color: rgba(87, 171, 90, .55); background: rgba(87, 171, 90, .12); }
            .vend-multi-mais:hover { background: rgba(87, 171, 90, .25); border-color: #57ab5a; }
            .vend-multi-tirar:hover { color: #e5534b; border-color: #e5534b; background: rgba(229, 83, 75, .12); }`;
        root.document.head.appendChild(st);
    }

    Object.assign(root, { ligarSeletorVendedores, htmlSeletorVendedores, lerVendedores, definirVendedores, montarSeletor });
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { ligarSeletorVendedores, htmlSeletorVendedores, lerVendedores, definirVendedores, montarSeletor,
            _definirLista: l => { lista = l; } };
    }
})(typeof window !== 'undefined' ? window : globalThis);
