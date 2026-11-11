/* Central de E-mails: Saúde das caixas (#saude) e as tabelas que o Dashboard também usa. Carregado por tela.js depois de graficos.js. */
(function () {
    'use strict';
    const T = window.EmailsTela;
    const { $, el, icone, pedir, contadores } = T;
    const F = window.EmailsFormato, G = window.EmailsGraficos;
    const dataHora = F.dataHora;

    // ----- tabelas e painéis comuns ao Dashboard e à Saúde das caixas -----
    function painel(titulo, id) {
        const p = el('section', null, 'em-painel em-bloco');
        const h = el('h3', titulo, 'em-secao');
        if (id) { h.id = id; h.tabIndex = -1; }
        p.appendChild(h);
        return p;
    }
    function tabelaSimples(cabecalho, linhas) {
        const rolagem = el('div', null, 'em-rolagem');
        const t = el('table', null, 'em-tabela');
        const tr = el('tr');
        cabecalho.forEach(c => tr.appendChild(el('th', c)));
        const thead = el('thead'); thead.appendChild(tr); t.appendChild(thead);
        const tbody = el('tbody');
        for (const l of linhas) {
            const r = el('tr');
            l.forEach((c, i) => { const td = el('td'); td.dataset.rotulo = cabecalho[i]; if (c instanceof Node) td.appendChild(c); else td.textContent = c; r.appendChild(td); });
            tbody.appendChild(r);
        }
        t.appendChild(tbody);
        rolagem.appendChild(t);
        return rolagem;
    }
    function tabela(titulo, cabecalho, linhas, id, vazio) {
        const p = painel(titulo, id);
        p.appendChild(linhas.length ? tabelaSimples(cabecalho, linhas) : el('p', vazio || 'Nada a mostrar.', 'em-estado'));
        return p;
    }
    function situacao(ok, textoOk, textoRuim) {
        const s = el('span', null, 'em-situacao ' + (ok ? 'em-ok' : 'em-ruim'));
        s.appendChild(icone(ok ? 'conferir' : 'alerta', 'em-ic-p'));
        s.appendChild(el('span', ok ? textoOk : textoRuim));
        return s;
    }
    function tabelaSaude(d) {
        return tabela('Saúde das caixas', ['Caixa', 'Leitura', 'Última leitura', 'Reconciliação', 'Erro'],
            (d.saude || []).map(s => [F.nomeCaixa(s.conta), situacao(!s.parada && !s.ultimo_erro, 'em dia', s.ultimo_erro ? 'com erro' : 'parada'),
                dataHora(s.ultima_leitura), s.reconciliacao == null ? '—' : (100 * s.reconciliacao).toFixed(1).replace('.', ',') + '%',
                s.ultimo_erro || (s.pastas_com_erro ? s.pastas_com_erro + ' pasta(s) com erro' : '')]), null, 'Nenhuma caixa configurada.');
    }
    // backup e disco, como o serviço registrou (o caminho do arquivo de backup não aparece)
    function tabelaManutencao(m) {
        const linhas = [];
        const b = m && m.backup, dc = m && m.disco, rt = m && m.retencao;
        if (b) linhas.push(['Backup', situacao(b.ok === true, 'ok', 'com erro'),
            dataHora(b.em) + (typeof b.tamanho_mb === 'number' ? ', ' + G.numero(b.tamanho_mb, 1) + ' MB' : '') + (b.erro ? ', ' + b.erro : '')]);
        if (dc) linhas.push(['Disco', situacao(!dc.alerta, 'espaço suficiente', 'pouco espaço'),
            G.numero(dc.livre_gb, 1) + ' GB livres de ' + G.numero(dc.total_gb, 1) + ' GB']);
        if (rt) linhas.push(['Retenção', situacao(true, rt.aplicado ? 'aplicada' : 'conferida', ''),
            G.numero(rt.emails) + (rt.aplicado ? ' e-mails antigos removidos' : ' e-mails além do limite')]);
        return tabela('Manutenção', ['Item', 'Situação', 'Detalhe'], linhas, null, 'Nenhuma manutenção registrada ainda.');
    }

    async function carregarSaude() {
        $('em-saude-estado').textContent = 'Carregando…';
        const r = await pedir('resumo', {});
        if (r.cancelado) return;
        const alvo = $('em-saude-conteudo');
        alvo.replaceChildren();
        if (!r.sucesso) { $('em-saude-estado').textContent = r.erro || 'Não foi possível carregar a saúde das caixas.'; return; }
        contadores(r.dados);
        if (!r.dados.saude) { $('em-saude-estado').textContent = 'A saúde das caixas é só para administrador.'; return; }
        $('em-saude-estado').textContent = 'Atualizado em ' + dataHora(r.dados.gerado_em);
        alvo.appendChild(tabelaSaude(r.dados));
        if (r.dados.manutencao) alvo.appendChild(tabelaManutencao(r.dados.manutencao));
    }
    Object.assign(T, { tabela, tabelaSimples, situacao, tabelaSaude });
    T.partes.saude = carregarSaude;
})();
