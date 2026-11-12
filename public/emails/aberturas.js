/* Central de E-mails: visão Aberturas (#aberturas), só para administrador (seção 5). Carregada por tela.js depois de
   saude.js (tabelas) e exportar.js (planilha). O portal barra quem não é administrador e o serviço confere de novo. */
(function () {
    'use strict';
    const T = window.EmailsTela;
    const { $, el, botao, icone, pedir, avisoFlutuante } = T;
    const A = window.EmailsAcoes, F = window.EmailsFormato;
    const COLUNAS = ['Quando', 'Quem', 'Assunto', 'Remetente'];
    const milhar = n => n.toLocaleString('pt-BR');
    const c = {};
    let filtro = { quem: '', de: '', ate: '', email: '' }, pagina = 1, paginas = 1, exportando = false;

    function campo(rotulo, entrada, id) {
        const div = el('div', null, 'em-campo');
        entrada.id = id;
        entrada.className = 'em-entrada';
        const l = el('label', rotulo);
        l.htmlFor = id;
        div.append(l, entrada);
        return div;
    }
    function opcao(valor, texto) {
        const o = el('option', texto);
        o.value = valor;
        return o;
    }
    function montar() {
        // a CSP não deixa formulário enviar (form-action 'none'): o submit só serve para o Enter filtrar
        const form = el('form', null, 'em-ab-filtros');
        c.quem = el('select');
        c.quem.appendChild(opcao('', 'Todos'));
        c.de = el('input'); c.de.type = 'date';
        c.ate = el('input'); c.ate.type = 'date';
        c.email = el('input'); c.email.type = 'search'; c.email.maxLength = 120;
        const filtrar = botao('Filtrar', 'em-botao');
        filtrar.type = 'submit';
        c.exportar = botao(null, 'em-botao em-secundario');
        c.exportar.append(icone('exportar', 'em-ic-p'), el('span', 'Exportar planilha'));
        const acoes = el('div', null, 'em-ab-acoes');
        acoes.append(filtrar, c.exportar);
        form.append(campo('Usuário', c.quem, 'em-ab-quem'), campo('De', c.de, 'em-ab-de'), campo('Até', c.ate, 'em-ab-ate'),
            campo('E-mail (assunto ou remetente)', c.email, 'em-ab-email'), acoes);
        form.addEventListener('submit', ev => {
            ev.preventDefault();
            filtro = { quem: c.quem.value, de: c.de.value, ate: c.ate.value, email: c.email.value.trim() };
            pagina = 1;
            carregar();
        });
        c.exportar.addEventListener('click', exportar);
        c.tabela = el('div');
        c.tabela.id = 'em-ab-tabela';
        const nav = c.nav = el('div', null, 'em-ab-paginas');
        c.form = form;
        c.anterior = botao('Anterior', 'em-botao em-secundario');
        c.proxima = botao('Próxima', 'em-botao em-secundario');
        c.pagina = el('span', '', 'em-num');
        c.pagina.tabIndex = -1;
        nav.append(c.anterior, c.pagina, c.proxima);
        c.anterior.addEventListener('click', () => irPara(pagina - 1));
        c.proxima.addEventListener('click', () => irPara(pagina + 1));
    }
    async function irPara(n) {
        pagina = Math.max(1, Math.min(paginas, n));
        await carregar();
        c.pagina.focus({ preventScroll: true });   // o botão pode ter ficado desligado: o foco fica na página
    }
    function usuarios(lista) {
        const atual = c.quem.value;
        const logins = (Array.isArray(lista) ? lista : []).filter(u => u && typeof u.usuario === 'string');
        c.quem.replaceChildren(opcao('', 'Todos'), ...logins.map(u => opcao(u.usuario, A.autor(u))));
        c.quem.value = logins.some(u => u.usuario === atual) ? atual : '';
    }
    async function carregar() {
        $('em-aberturas-estado').textContent = 'Carregando…';
        const r = await pedir('aberturas', Object.assign({ pagina }, filtro));
        if (r.cancelado) return;
        if (!r.sucesso) { $('em-aberturas-estado').textContent = r.erro || 'Não foi possível carregar as aberturas.'; return; }
        const d = r.dados || {};
        usuarios(d.usuarios);
        const itens = (Array.isArray(d.itens) ? d.itens : []).filter(a => a && typeof a === 'object');
        const total = Number.isSafeInteger(d.total) ? d.total : itens.length;
        paginas = Number.isSafeInteger(d.paginas) && d.paginas > 0 ? d.paginas : 1;
        pagina = Number.isSafeInteger(d.pagina) ? d.pagina : pagina;
        $('em-aberturas-estado').textContent = total === 1 ? '1 abertura registrada.' : milhar(total) + ' aberturas registradas.';
        const painel = el('section', null, 'em-painel em-bloco');
        painel.setAttribute('aria-label', 'Aberturas');
        painel.appendChild(itens.length ? T.tabelaSimples(COLUNAS, itens.map(a => [F.dataHora(a.em), A.autor(a),
            a.assunto || '(sem assunto)', a.remetente || ''])) : el('p', 'Nenhuma abertura com esses filtros.', 'em-estado'));
        c.tabela.replaceChildren(painel);
        c.pagina.textContent = 'Página ' + pagina + ' de ' + paginas;
        c.anterior.disabled = pagina <= 1;
        c.proxima.disabled = pagina >= paginas;
    }
    // planilha do filtro atual, até 2.000 linhas, pelo mesmo caminho da exportação da lista
    async function exportar() {
        if (exportando) return;
        exportando = true;
        c.exportar.disabled = true;
        try {
            const linhas = [];
            let n = 1, ate = 1, total = 0;
            do {
                const r = await pedir('aberturas', Object.assign({}, filtro, { pagina: n }), 'exportar-aberturas');
                if (r.cancelado) { avisoFlutuante('A conexão caiu e a exportação parou. Tente de novo.', null, true); return; }
                if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível exportar as aberturas.', null, true); return; }
                const d = r.dados || {};
                for (const a of Array.isArray(d.itens) ? d.itens : []) if (a && linhas.length < A.MAX_EXPORTAR) linhas.push(A.linhaAbertura(a));
                ate = Number.isSafeInteger(d.paginas) ? d.paginas : 1;
                total = Number.isSafeInteger(d.total) ? d.total : linhas.length;
                $('em-aberturas-estado').textContent = 'Buscando aberturas: ' + milhar(linhas.length) + ' de ' + milhar(Math.min(total, A.MAX_EXPORTAR));
                n++;
            } while (n <= ate && linhas.length < A.MAX_EXPORTAR);
            if (!linhas.length) { avisoFlutuante('Nenhuma abertura para exportar com esses filtros.'); return; }
            if (!await T.baixarPlanilha('aberturas', 'Aberturas', A.COLUNAS_ABERTURAS, [17, 24, 32, 48, 32], linhas, () => false)) return;
            avisoFlutuante(total > A.MAX_EXPORTAR ? 'Planilha com as 2.000 aberturas mais novas de ' + milhar(total) + '. Refine o filtro para o resto.'
                : 'Planilha com ' + (linhas.length === 1 ? '1 abertura' : milhar(linhas.length) + ' aberturas') + ' baixada.');
        } catch (erro) {
            avisoFlutuante('Não foi possível montar a planilha. Tente de novo.', null, true);
        } finally {
            exportando = false;
            c.exportar.disabled = false;
            $('em-aberturas-estado').textContent = '';
            carregar();
        }
    }
    // a casca limpa o conteúdo quando o arquivo chega (e pode chamar duas vezes na partida): os nós voltam a cada chamada
    T.partes.aberturas = () => {
        if (!c.tabela) montar();
        $('em-aberturas-conteudo').replaceChildren(c.form, c.tabela, c.nav);
        carregar();
    };
})();
