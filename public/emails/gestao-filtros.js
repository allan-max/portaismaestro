/* Central de E-mails: gestão dos filtros salvos (#filtros). Carregado por tela.js na primeira vez que a visão abre. */
(function () {
    'use strict';
    const T = window.EmailsTela;
    const { $, el, botao, etiqueta, estado, admin, salvarPreferencias, filtrar, opcoesCor } = T;
    const Q = window.EmailsFiltro;

    // ----- gestão dos filtros salvos (#filtros); os da equipe só o administrador -----
    async function alterarSalvos(chave, mudar) {
        const lista = (estado.prefs[chave] || []).map(s => Object.assign({}, s));
        mudar(lista);
        if (await salvarPreferencias({ [chave]: lista }, 'em-gestao-estado')) desenharGestao();
    }
    function linhaGestao(s, chave, editavel) {
        const li = el('li', null, 'em-gestao-linha');
        const topo = el('div', null, 'em-gestao-topo');
        topo.appendChild(el('span', null, 'em-cor em-etq-' + s.cor));
        const nome = el('span', s.nome, 'em-gestao-nome');
        topo.appendChild(nome);
        if (s.fixado) topo.appendChild(etiqueta('fixado'));
        li.appendChild(topo);
        const resumo = Q.ativos(Q.deParams(s.filtro)).map(a => a.rotulo).join(', ');
        li.appendChild(el('p', resumo || 'Sem filtro: todos os e-mails.', 'em-dica-texto'));
        const acoes = el('div', null, 'em-gestao-acoes');
        const aplicar = botao('Aplicar', 'em-botao');
        aplicar.addEventListener('click', () => filtrar(Q.deParams(s.filtro)));
        acoes.appendChild(aplicar);
        if (editavel) {
            const renomear = botao('Renomear', 'em-botao em-secundario');
            renomear.addEventListener('click', () => {
                const campo = el('input', null, 'em-entrada em-gestao-campo');
                campo.type = 'text'; campo.maxLength = 40; campo.value = s.nome;
                campo.setAttribute('aria-label', 'Novo nome do filtro ' + s.nome);
                const gravar = () => {
                    const novo = campo.value.trim();
                    if (!novo) { $('em-gestao-estado').textContent = 'O nome não pode ficar vazio.'; return; }
                    alterarSalvos(chave, l => { l.find(x => x.id === s.id).nome = novo; });
                };
                campo.addEventListener('keydown', ev => {
                    if (ev.key === 'Enter') { ev.preventDefault(); gravar(); }
                    if (ev.key === 'Escape') desenharGestao();
                });
                const ok = botao('Salvar nome', 'em-botao');
                ok.addEventListener('click', gravar);
                nome.replaceWith(campo);
                renomear.replaceWith(ok);
                campo.focus();
                campo.select();
            });
            const cor = el('select', null, 'em-entrada em-gestao-cor');
            cor.setAttribute('aria-label', 'Cor do filtro ' + s.nome);
            opcoesCor(cor, s.cor);
            cor.addEventListener('change', () => alterarSalvos(chave, l => { l.find(x => x.id === s.id).cor = cor.value; }));
            const fixar = botao(s.fixado ? 'Desafixar' : 'Fixar no topo', 'em-botao em-secundario');
            fixar.addEventListener('click', () => alterarSalvos(chave, l => { const x = l.find(y => y.id === s.id); x.fixado = !x.fixado; }));
            // apagar pede um segundo clique (sem janela de confirmação do navegador)
            const apagar = botao('Apagar', 'em-botao em-secundario em-perigo');
            let armado = 0;
            apagar.addEventListener('click', () => {
                if (!armado) {
                    apagar.textContent = 'Confirmar: apagar';
                    armado = setTimeout(() => { armado = 0; apagar.textContent = 'Apagar'; }, 4000);
                    return;
                }
                clearTimeout(armado);
                alterarSalvos(chave, l => { l.splice(l.findIndex(x => x.id === s.id), 1); });
            });
            acoes.append(renomear, cor, fixar, apagar);
        }
        li.appendChild(acoes);
        return li;
    }
    function blocoGestao(titulo, lista, chave, editavel, vazio) {
        const p = el('section', null, 'em-painel em-bloco');
        p.appendChild(el('h3', titulo, 'em-secao'));
        if (!lista.length) { p.appendChild(el('p', vazio, 'em-estado')); return p; }
        const ul = el('ul', null, 'em-gestao-lista');
        lista.forEach(s => ul.appendChild(linhaGestao(s, chave, editavel)));
        p.appendChild(ul);
        return p;
    }
    function desenharGestao() {
        const p = estado.prefs;
        $('em-gestao').replaceChildren(
            blocoGestao('Meus filtros', p.filtros || [], 'filtros', true, 'Nenhum filtro salvo. Escolha os filtros na Caixa e use "Salvar filtro atual".'),
            blocoGestao('Filtros da equipe', p.equipe || [], 'equipe', admin,
                admin ? 'Nenhum filtro da equipe. Ao salvar um filtro na Caixa, marque "Publicar para a equipe".' : 'Nenhum filtro da equipe.'));
        if (!admin && (p.equipe || []).length) $('em-gestao').lastChild.appendChild(el('p', 'Só administrador edita os filtros da equipe.', 'em-dica-texto'));
    }
    T.partes.filtros = desenharGestao;
})();
