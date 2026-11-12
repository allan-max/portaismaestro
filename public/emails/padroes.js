/* Central de E-mails: visão Padrões (#padroes), só para administrador (seção 8.4). Carregada por tela.js na primeira vez.
   Rotular é para centenas em seguida: cada tecla manda o pedido na hora, o foco anda para o próximo e o aviso traz
   "Desfazer". O portal barra quem não é administrador e o serviço confere de novo. Texto de e-mail só por textContent. */
(function () {
    'use strict';
    const T = window.EmailsTela;
    const { $, el, botao, pedir, avisoFlutuante, etiqueta } = T;
    const F = window.EmailsFormato, A = window.EmailsAcoes;
    const CATS = F.CORRIGIVEIS;   // teclas 1 a 8, na ordem de classificador.CATEGORIAS
    const ESTADOS = [['aberto', 'Abertos'], ['rotulado', 'Rotulados'], ['misturado', 'Misturados'], ['pulado', 'Pulados'], ['', 'Todos']];
    const FRASE = { rotulado: 'Rotulado', misturado: 'Misturado: a IA decide um a um', pulado: 'Pulado', aberto: 'Sem rótulo' };
    const milhar = n => n.toLocaleString('pt-BR');
    const plural = (n, um, varios) => (n === 1 ? '1 ' + um : milhar(n) + ' ' + varios);
    const c = {}, desfeitos = [];   // desfeitos: ids de auditoria dos rótulos desta sessão, o mais novo no fim
    let aba = 'padroes', filtro = 'aberto', pagina = 1, paginas = 1, contagem = {};

    function segmentado(rotulo, opcoes, aoEscolher) {
        const g = el('div', null, 'em-segmentado');
        g.setAttribute('role', 'group');
        g.setAttribute('aria-label', rotulo);
        for (const [valor, texto] of opcoes) {
            const b = botao(texto);
            b.dataset.valor = valor;
            b.addEventListener('click', () => aoEscolher(valor));
            g.appendChild(b);
        }
        return g;
    }
    const marcar = (g, valor) => { for (const b of g.children) b.setAttribute('aria-pressed', String(b.dataset.valor === valor)); };

    function montar() {
        c.abas = segmentado('Aba', [['padroes', 'Padrões'], ['regras', 'Regras'], ['sugestoes', 'Sugestões']], v => { aba = v; pagina = 1; carregar(); });
        c.filtros = segmentado('Mostrar', ESTADOS, v => { filtro = v; pagina = 1; carregar(); });
        c.pct = el('p', '', 'em-pd-pct em-num');
        c.topo = el('div', null, 'em-pd-topo');
        c.topo.append(c.abas, c.pct, c.filtros);
        c.lista = el('ul', null, 'em-pd-lista');
        c.lista.setAttribute('aria-label', 'Padrões');
        c.mais = botao('Mais padrões', 'em-botao em-secundario');
        // em Abertos o que foi rotulado sai do filtro: a próxima leva começa de novo da primeira página
        c.mais.addEventListener('click', () => { if (aba === 'padroes' && filtro === 'aberto') carregar(false, true); else { pagina++; carregar(true); } });
        // botões de rótulo: um conjunto só, que vai para dentro do padrão em foco (com mouse, os mesmos das teclas)
        c.botoes = el('div', null, 'em-pd-botoes');
        CATS.forEach((cat, i) => {
            const b = botao(null, 'em-chip em-chip-cat ' + F.categoria(cat).classe);
            b.append(el('kbd', String(i + 1)), ' ', el('span', cat));
            b.addEventListener('click', ev => rotular(ev.target.closest('.em-pd-item'), 'rotulado', cat));
            c.botoes.appendChild(b);
        });
        for (const [estado, tecla, texto] of [['misturado', 'M', 'Misturado'], ['pulado', 'Espaço', 'Pular']]) {
            const b = botao(null, 'em-chip');
            b.append(el('kbd', tecla), ' ', el('span', texto));
            b.addEventListener('click', ev => rotular(ev.target.closest('.em-pd-item'), estado));
            c.botoes.appendChild(b);
        }
        c.lista.addEventListener('focusin', ev => {
            const li = ev.target.closest('.em-pd-item');
            if (!li || aba !== 'padroes') return;
            for (const o of c.lista.children) o.tabIndex = o === li ? 0 : -1;
            // só quando o foco cai no próprio padrão: mover os botões no clique de um exemplo de outro padrão
            // mudaria a altura do de cima no meio do clique
            if (ev.target === li && c.botoes.parentElement !== li) li.appendChild(c.botoes);
        });
        c.previa = el('section', null, 'em-painel em-pd-previa');
        c.previa.tabIndex = -1;
        c.previa.hidden = true;
    }

    function barra(p) {
        const b = el('div', null, 'em-pd-barra');
        b.setAttribute('aria-hidden', 'true');   // a legenda ao lado diz o mesmo em texto
        for (const [cat, n] of p.categorias) {
            const s = el('span', null, F.categoria(cat).classe);
            s.style.setProperty('--em-largura', (100 * n / Math.max(1, p.quantidade)) + '%');
            b.appendChild(s);
        }
        return b;
    }
    function linha(p) {
        const li = el('li', null, 'em-pd-item');
        li.dataset.chave = p.chave;
        li.tabIndex = -1;
        preencher(li, p);
        return li;
    }
    function preencher(li, p) {
        li.padrao = p;
        const topo = el('div', null, 'em-pd-linha');
        topo.append(el('strong', p.nome || p.modelo_assunto || '(sem assunto)', 'em-pd-nome'), el('span', plural(p.quantidade, 'e-mail', 'e-mails'), 'em-num em-pd-qtd'));
        if (p.misturado) topo.appendChild(etiqueta('misturado', 'em-pd-mist'));
        const st = el('span', p.estado === 'rotulado' ? 'Rotulado: ' + p.categoria : FRASE[p.estado] || '', 'em-pd-estado');
        if (p.estado !== 'aberto') st.classList.add('em-pd-feito');
        topo.appendChild(st);
        const legenda = p.categorias.map(([cat, n]) => cat + ' ' + milhar(n)).join(' · ') + (p.sugestao ? ' · Sugestão da IA: ' + p.sugestao : '');
        const ex = el('ul', null, 'em-pd-exemplos');
        for (const e of p.exemplos) {
            const b = botao(null, 'em-link');
            b.append(el('span', F.dataHora(e.data), 'em-num'), el('span', e.assunto || '(sem assunto)'));
            b.setAttribute('aria-label', 'Ver exemplo: ' + (e.assunto || 'sem assunto') + ', ' + (e.categoria || 'sem categoria'));
            b.addEventListener('click', () => verExemplo(e.id, b));
            const item = el('li');
            item.append(b, T.etiquetaCategoria(e.categoria));
            ex.appendChild(item);
        }
        li.setAttribute('aria-label', (p.nome || p.modelo_assunto || 'sem assunto') + ', ' + plural(p.quantidade, 'e-mail', 'e-mails') + ', ' + st.textContent);
        const manter = c.botoes.parentElement === li;
        li.replaceChildren(topo, el('p', p.remetente + ' · ' + p.modelo_assunto, 'em-pd-origem'), barra(p), el('p', legenda, 'em-pd-legenda'), ex);
        if (manter) li.appendChild(c.botoes);
    }

    function linhaRegra(p) {
        const li = el('li', null, 'em-pd-item em-pd-regra');
        li.dataset.chave = p.chave;
        li.padrao = p;
        const liga = el('input');
        liga.type = 'checkbox';
        liga.checked = p.ativo === 1;
        liga.setAttribute('role', 'switch');
        const rot = el('label', null, 'em-pd-liga');
        rot.append(liga, el('span', 'Regra ligada'));
        liga.addEventListener('change', async () => {
            liga.disabled = true;
            const r = await pedir('rotular_padrao', { chave: p.chave, ativo: liga.checked });
            liga.disabled = false;
            if (r.cancelado) return;
            if (!r.sucesso) { liga.checked = !liga.checked; avisoFlutuante(r.erro || 'Não foi possível mudar a regra.', null, true); return; }
            avisoFlutuante(liga.checked ? 'Regra ligada.' : 'Regra desligada: os próximos e-mails deste padrão vão para a IA.', null, 'neutro');
        });
        const desf = botao('Desfazer rótulo', 'em-botao em-secundario');
        desf.addEventListener('click', () => desfazer(p.auditoria));
        const topo = el('div', null, 'em-pd-linha');
        topo.append(el('strong', p.nome || p.modelo_assunto || '(sem assunto)', 'em-pd-nome'), T.etiquetaCategoria(p.categoria));
        li.append(topo, el('p', p.remetente + ' · ' + p.modelo_assunto, 'em-pd-origem'),
            el('p', 'Pegou ' + plural(p.aplicados || 0, 'e-mail novo', 'e-mails novos') + '. Rotulado por ' + A.autor({ usuario: p.rotulado_por }) +
                ' em ' + F.dataHora(p.rotulado_em) + '.', 'em-pd-legenda'), rot, desf);
        return li;
    }

    async function carregar(mais, focar) {
        marcar(c.abas, aba);
        marcar(c.filtros, filtro);
        c.filtros.hidden = c.pct.hidden = aba !== 'padroes';
        fecharExemplo();
        if (aba === 'sugestoes') {
            c.lista.replaceChildren(el('li', 'Nenhuma sugestão por enquanto.', 'em-estado'));
            c.mais.hidden = true;
            $('em-padroes-estado').textContent = '';
            return;
        }
        $('em-padroes-estado').textContent = 'Carregando…';
        const r = await pedir('padroes', { estado: aba === 'regras' ? 'rotulado' : filtro, pagina });
        if (r.cancelado) return;
        if (!r.sucesso) { $('em-padroes-estado').textContent = r.erro || 'Não foi possível carregar os padrões.'; return; }
        const d = r.dados || {};
        const lista = (Array.isArray(d.padroes) ? d.padroes : []).filter(p => p && typeof p.chave === 'string');
        for (const p of lista) {
            p.categorias = Array.isArray(p.categorias) ? p.categorias : [];
            p.exemplos = Array.isArray(p.exemplos) ? p.exemplos : [];
        }
        contagem = d.estados || {};
        paginas = Number.isSafeInteger(d.paginas) ? d.paginas : 1;
        for (const b of c.filtros.children) {
            const n = b.dataset.valor ? contagem[b.dataset.valor] : Object.values(contagem).reduce((a, x) => a + x, 0);
            b.textContent = ESTADOS.find(e => e[0] === b.dataset.valor)[1] + (Number.isSafeInteger(n) ? ' ' + milhar(n) : '');
        }
        c.pct.textContent = 'Rotulado: ' + F.decimal(Number(d.rotulado_pct) || 0) + '% dos e-mails';
        const nos = lista.map(aba === 'regras' ? linhaRegra : linha);
        if (mais) c.lista.append(...nos); else c.lista.replaceChildren(...nos);
        if (!c.lista.children.length) c.lista.appendChild(el('li', aba === 'regras' ? 'Nenhum padrão rotulado ainda.' : 'Nenhum padrão com esse filtro.', 'em-estado'));
        else if (aba === 'padroes' && !mais && c.lista.firstChild.classList.contains('em-pd-item')) c.lista.firstChild.tabIndex = 0;
        c.mais.hidden = pagina >= paginas;
        $('em-padroes-estado').textContent = plural(Number.isSafeInteger(d.total) ? d.total : lista.length, 'padrão', 'padrões') + '.';
        if ((mais || focar) && nos[0] && aba === 'padroes') nos[0].focus();
    }

    function proximo(li, passo) {
        let o = li;
        do { o = passo > 0 ? o.nextElementSibling : o.previousElementSibling; } while (o && !o.classList.contains('em-pd-item'));
        return o;
    }
    // manda o rótulo, mostra na hora e já leva o foco ao próximo; a resposta confirma ou desfaz na tela
    async function rotular(li, estado, categoria) {
        if (!li || !li.padrao) return;
        const p = li.padrao, antes = Object.assign({}, p);
        preencher(li, Object.assign({}, p, { estado, categoria: categoria || null }));
        li.setAttribute('aria-busy', 'true');
        const seguinte = proximo(li, 1);
        if (seguinte) seguinte.focus(); else if (!c.mais.hidden) c.mais.focus();
        const r = await pedir('rotular_padrao', estado === 'rotulado' ? { chave: p.chave, estado, categoria } : { chave: p.chave, estado });
        li.removeAttribute('aria-busy');
        if (r.cancelado) return;
        if (!r.sucesso || !r.dados || !r.dados.padrao) {
            preencher(li, antes);
            avisoFlutuante(r.erro || 'Não foi possível rotular o padrão.', null, true);
            return;
        }
        atualizar(li, r.dados.padrao);
        desfeitos.push(r.dados.auditoria);
        const n = r.dados.alterados || 0;
        avisoFlutuante(estado === 'rotulado' ? 'Rotulado como ' + categoria + ': ' + plural(n, 'e-mail mudou', 'e-mails mudaram') + '.'
            : FRASE[estado] + '.', () => desfazer(r.dados.auditoria), 'neutro');
    }
    function atualizar(li, p) {
        p.categorias = Array.isArray(p.categorias) ? p.categorias : [];
        p.exemplos = Array.isArray(p.exemplos) ? p.exemplos : [];
        preencher(li, p);
    }
    async function desfazer(auditoria) {
        if (!Number.isSafeInteger(auditoria)) return;
        const r = await pedir('rotular_padrao', { desfazer: auditoria });
        if (r.cancelado) return;
        if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível desfazer.', null, true); return; }
        const i = desfeitos.indexOf(auditoria);
        if (i >= 0) desfeitos.splice(i, 1);
        const p = r.dados && r.dados.padrao;
        const li = p && [...c.lista.children].find(o => o.dataset.chave === p.chave);
        avisoFlutuante('Rótulo desfeito: ' + plural(r.dados.desfeitos || 0, 'e-mail voltou', 'e-mails voltaram') + ' ao que era.', null, 'neutro');
        if (aba === 'regras') { carregar(); return; }
        if (li) { atualizar(li, p); li.focus(); }
    }

    // exemplo aberto com um clique, aqui mesmo: o texto do e-mail, sem sair da lista
    async function verExemplo(id, origem) {
        c.origem = origem;
        c.previa.hidden = false;
        c.previa.replaceChildren(el('p', 'Carregando…', 'em-estado'));
        origem.closest('.em-pd-item').after(c.previa);
        const r = await pedir('detalhe', { id }, 'padroes-exemplo');
        if (r.cancelado || c.origem !== origem) return;
        const e = r.sucesso && r.dados;
        const fechar = botao('Fechar', 'em-botao em-secundario');
        fechar.addEventListener('click', () => fecharExemplo(true));
        const topo = el('div', null, 'em-previa-topo');
        topo.append(el('strong', e ? e.assunto || '(sem assunto)' : 'Não foi possível abrir o exemplo.'), fechar);
        c.previa.replaceChildren(topo);
        if (e) {
            c.previa.setAttribute('aria-label', 'Exemplo: ' + (e.assunto || 'sem assunto'));
            c.previa.append(el('p', (e.remetente || '') + ' · ' + F.dataHora(e.data) + ' · ' + F.categoria(e.categoria).nome, 'em-pd-origem'),
                el('div', e.corpo_oculto ? 'Conteúdo oculto (código de acesso).' : (e.corpo_texto || '(sem texto)').slice(0, 3000), 'em-pd-corpo'));
        }
        c.previa.focus();
    }
    function fecharExemplo(voltar) {
        if (c.previa.hidden) return;
        c.previa.hidden = true;
        c.previa.remove();
        if (voltar && c.origem && c.origem.isConnected) c.origem.focus();
        c.origem = null;
    }

    document.addEventListener('keydown', ev => {
        if (T.estado.visao !== 'padroes' || ev.ctrlKey || ev.metaKey || ev.altKey || ev.defaultPrevented) return;
        if (ev.key === 'Escape' && !c.previa.hidden) { ev.preventDefault(); fecharExemplo(true); return; }
        const alvo = document.activeElement;
        if (aba !== 'padroes' || !alvo || alvo.closest('input, select, textarea, dialog')) return;
        const li = alvo.closest('.em-pd-item');
        const tecla = ev.key.toLowerCase();
        let feito = true;
        if (tecla === 'z') { if (desfeitos.length) desfazer(desfeitos[desfeitos.length - 1]); }
        else if (!li) { const o = (tecla === 'j' || tecla === 'k') && c.lista.querySelector('.em-pd-item'); if (o) o.focus(); else feito = false; }
        else if (/^[1-8]$/.test(ev.key)) rotular(li, 'rotulado', CATS[Number(ev.key) - 1]);
        else if (tecla === 'm') rotular(li, 'misturado');
        else if (ev.key === ' ' && alvo === li) rotular(li, 'pulado');
        else if (tecla === 'j' || tecla === 'k') { const o = proximo(li, tecla === 'j' ? 1 : -1); if (o) o.focus(); }
        else feito = false;
        if (feito) ev.preventDefault();
    });

    // a casca limpa o conteúdo quando o arquivo chega (e pode chamar duas vezes na partida): os nós voltam a cada chamada
    T.partes.padroes = () => {
        if (!c.lista) montar();
        $('em-padroes-conteudo').replaceChildren(c.topo, c.lista, c.mais);
        carregar();
    };
})();
