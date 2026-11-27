/* Cotabot: janela de configurações (botão no canto superior esquerdo).
   Lista os padrões (categoria/marca -> fornecedores e regra de compra); edita, cria e apaga.
   Os padrões valem para a empresa toda (servidor: lib/cotabot-padroes.js). */
(function () {
    'use strict';

    function el(tag, classe, conteudo) {
        const n = document.createElement(tag);
        if (classe) n.className = classe;
        if (conteudo !== undefined && conteudo !== null) n.textContent = conteudo;
        return n;
    }

    function campo(rotulo, controle, ajuda) {
        const id = 'cbc-' + Math.random().toString(36).slice(2, 9);
        controle.id = id;
        const caixa = el('div', 'cbc-campo');
        const label = el('label', 'cb-rotulo', rotulo);
        label.htmlFor = id;
        caixa.append(label, controle);
        if (ajuda) caixa.appendChild(el('small', 'muted', ajuda));
        return caixa;
    }

    function iniciar({ api, aoMudar }) {
        const botao = document.getElementById('cb-config');
        const dialogo = document.getElementById('cb-dialogo');
        let padroes = [];
        let atual = null;   // id em edição; '' = novo

        // ---- montagem ----
        const listaEl = el('div', 'cbc-lista');
        listaEl.setAttribute('role', 'list');
        const novo = el('button', 'button small', '+ Novo padrão');
        novo.type = 'button';
        const nome = el('input', 'cb-input');
        nome.maxLength = 80;
        const palavras = el('textarea', 'cb-input');
        palavras.rows = 4;
        const fornecedores = el('textarea', 'cb-input');
        fornecedores.rows = 7;
        const regra = el('textarea', 'cb-input');
        regra.rows = 3;
        regra.maxLength = 1000;
        const geral = el('input');
        geral.type = 'checkbox';
        const geralRotulo = el('label', 'cb-chip cbc-geral');
        geralRotulo.append(geral, el('span', '', 'Usar quando nenhuma categoria for reconhecida (padrão geral)'));
        const salvar = el('button', 'button primary', 'Salvar');
        salvar.type = 'submit';
        const apagar = el('button', 'button cbc-apagar', 'Excluir');
        apagar.type = 'button';
        const msg = el('div', 'cb-aviso');
        msg.setAttribute('role', 'status');
        const titulo = el('h3', 'cbc-titulo');

        const form = el('form', 'cbc-form');
        form.noValidate = true;
        const acoes = el('div', 'cbc-acoes');
        acoes.append(salvar, apagar, msg);
        form.append(titulo,
            campo('Nome', nome),
            campo('Palavras-chave (uma por linha)', palavras, 'Categoria ou marca que aparece na descrição do item. Ex.: split, intelbras, vassoura.'),
            campo('Fornecedores (um por linha)', fornecedores, 'Nome ou site. Observação entre parênteses, ex.: Reis Office (foco em Okidata).'),
            campo('Regra de compra (opcional)', regra, 'Vai para o robô junto com o item.'),
            geralRotulo, acoes);

        const cabecalho = el('div', 'cbc-cabecalho');
        const fechar = el('button', 'icon-button', '✕');
        fechar.type = 'button';
        fechar.setAttribute('aria-label', 'Fechar configurações');
        cabecalho.append(el('h2', '', 'Padrões de fornecedores'), fechar);
        const lado = el('div', 'cbc-lado');
        lado.append(novo, listaEl);
        const corpo = el('div', 'cbc-corpo');
        corpo.append(lado, form);
        dialogo.append(cabecalho,
            el('p', 'muted cbc-intro', 'Quando a descrição do item tem uma palavra-chave, a tela mostra os fornecedores do padrão já marcados. Vale para todos que usam o Cotabot.'),
            corpo);

        const avisar = (t, tipo) => { msg.textContent = t; msg.className = 'cb-aviso' + (tipo ? ' ' + tipo : ''); };

        // ---- comportamento ----
        function desenharLista() {
            listaEl.replaceChildren(...padroes.map(p => {
                const b = el('button', 'cbc-item' + (p.id === atual ? ' ativo' : ''));
                b.type = 'button';
                b.setAttribute('role', 'listitem');
                b.append(el('b', '', p.nome), el('small', 'muted', p.geral ? 'padrão geral' : (p.palavras || []).slice(0, 4).join(', ')));
                b.addEventListener('click', () => editar(p.id));
                return b;
            }));
        }

        function editar(id) {
            atual = id;
            const p = padroes.find(x => x.id === id) || { nome: '', palavras: [], fornecedores: [], regra: '', geral: false };
            titulo.textContent = id ? 'Editar padrão' : 'Novo padrão';
            nome.value = p.nome;
            palavras.value = (p.palavras || []).join('\n');
            fornecedores.value = (p.fornecedores || []).join('\n');
            regra.value = p.regra || '';
            geral.checked = !!p.geral;
            apagar.hidden = !id;
            avisar(p.alterado_em ? `Última alteração: ${p.alterado_por || '?'} em ${new Date(p.alterado_em).toLocaleString('pt-BR')}` : '');
            desenharLista();
            nome.focus();
        }

        async function carregar(manterId) {
            const resp = await api('/api/cotabot/padroes');
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            padroes = (await resp.json()).padroes || [];
            const id = manterId !== undefined ? manterId : (padroes[0] && padroes[0].id) || '';
            editar(padroes.some(p => p.id === id) ? id : '');
        }

        form.addEventListener('submit', async e => {
            e.preventDefault();
            salvar.disabled = true;
            avisar('Salvando...');
            try {
                const resp = await api('/api/cotabot/padroes' + (atual ? '/' + encodeURIComponent(atual) : ''), {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ nome: nome.value, palavras: palavras.value.split('\n'),
                        fornecedores: fornecedores.value.split('\n'), regra: regra.value, geral: geral.checked })
                });
                const corpoResp = await resp.json().catch(() => ({}));
                if (!resp.ok) throw new Error(corpoResp.error || `HTTP ${resp.status}`);
                await carregar(corpoResp.padrao.id);
                avisar('Salvo.', '');
                aoMudar();
            } catch (err) {
                avisar('Não salvou: ' + err.message, 'erro');
            } finally {
                salvar.disabled = false;
            }
        });

        apagar.addEventListener('click', async () => {
            const p = padroes.find(x => x.id === atual);
            if (!p || !window.confirm(`Excluir o padrão "${p.nome}"? Isso vale para todos que usam o Cotabot.`)) return;
            try {
                const resp = await api(`/api/cotabot/padroes/${encodeURIComponent(p.id)}/apagar`, { method: 'POST' });
                if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
                await carregar();
                aoMudar();
            } catch (err) {
                avisar('Não excluiu: ' + err.message, 'erro');
            }
        });

        novo.addEventListener('click', () => editar(''));
        fechar.addEventListener('click', () => dialogo.close());
        botao.addEventListener('click', async () => {
            dialogo.showModal();
            try {
                await carregar(atual || undefined);
            } catch (err) {
                avisar('Não deu para carregar os padrões: ' + err.message, 'erro');
            }
        });
    }

    window.CotabotConfig = { iniciar };
})();
