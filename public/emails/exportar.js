/* Central de E-mails: exportação da lista para Excel. Carregado por tela.js no primeiro clique em Exportar. */
(function () {
    'use strict';
    const T = window.EmailsTela;
    const { $, el, estado, pedir, cancelarPedidos, avisoFlutuante, hoje } = T;
    const Q = window.EmailsFiltro, A = window.EmailsAcoes;

    // ----- exportar para Excel (seção 8): até 2.000 linhas, tudo texto, sem corpo -----
    // o exceljs (quase 1 MB) só carrega no primeiro clique, do próprio portal: a CSP não muda
    let excel = null, exportacao = null;
    function carregarExcel() {
        if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
        if (!excel) {
            excel = new Promise((ok, falha) => {
                const s = document.createElement('script');
                s.src = '/vendor/exceljs-4.4.0.min.js';
                s.onload = () => (window.ExcelJS ? ok(window.ExcelJS) : falha(new Error('exceljs')));
                s.onerror = () => { excel = null; s.remove(); falha(new Error('exceljs')); };
                document.head.appendChild(s);
            });
        }
        return excel;
    }
    const milhar = n => n.toLocaleString('pt-BR');
    function progresso(texto, feito) {
        $('em-exportar-texto').textContent = texto;
        $('em-exportar-barra').value = feito;
    }
    function fimExportar(minha) {
        if (exportacao !== minha) return;
        exportacao = null;
        $('em-exportando').hidden = true;
        $('em-exportar').disabled = !estado.itens;
    }
    async function exportar() {
        if (exportacao) return;
        const minha = exportacao = { cancelado: false };
        const filtro = Q.params(estado.filtro);
        $('em-exportando').hidden = false;
        $('em-exportar').disabled = true;
        progresso('Preparando a exportação…', 0);
        const carregando = carregarExcel();
        carregando.catch(() => {});   // a falha é tratada abaixo, quando a planilha for montada
        try {
            const linhas = [];
            let cursor = '', total = 0;
            do {
                // grupo próprio: buscar as páginas não cancela a lista que está na tela
                const r = await pedir('listar', Object.assign({}, filtro, { cursor }), 'exportar');
                if (minha.cancelado || r.cancelado) return;
                if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível exportar a lista.', null, true); return; }
                const d = r.dados || {};
                if (!cursor && Number.isFinite(d.total)) total = d.total;
                for (const e of Array.isArray(d.itens) ? d.itens : []) if (linhas.length < A.MAX_EXPORTAR) linhas.push(A.linhaPlanilha(e));
                cursor = d.proximo || '';
                total = Math.max(total, linhas.length);
                const alvo = Math.min(total, A.MAX_EXPORTAR);
                progresso(total > A.MAX_EXPORTAR ? 'Buscando os primeiros 2.000 de ' + milhar(total) + ' e-mails: ' + milhar(linhas.length)
                    : 'Buscando e-mails: ' + milhar(linhas.length) + ' de ' + milhar(alvo), alvo ? linhas.length / alvo : 1);
            } while (cursor && linhas.length < A.MAX_EXPORTAR);
            if (!linhas.length) { avisoFlutuante('Nenhum e-mail para exportar com esses filtros.'); return; }
            progresso('Montando a planilha…', 1);
            const ExcelJS = await carregando;
            if (minha.cancelado) return;
            const livro = new ExcelJS.Workbook();
            const folha = livro.addWorksheet('E-mails', { views: [{ state: 'frozen', ySplit: 1 }] });
            const larguras = [17, 32, 24, 48, 16, 12, 24, 10, 12, 60];
            folha.columns = A.COLUNAS_PLANILHA.map((titulo, i) => ({ header: titulo, width: larguras[i], style: { numFmt: '@' } }));
            folha.getRow(1).font = { bold: true };
            // valor como string: o exceljs só grava fórmula de { formula }
            for (const l of linhas) folha.addRow(l);
            const blob = new Blob([await livro.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            if (minha.cancelado) return;
            const url = URL.createObjectURL(blob);
            const a = el('a');
            a.href = url;
            a.download = 'emails-' + hoje() + '.xlsx';
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
            avisoFlutuante(total > A.MAX_EXPORTAR ? 'Planilha com os primeiros 2.000 de ' + milhar(total) + ' e-mails. Refine o filtro para exportar o resto.'
                : 'Planilha com ' + (linhas.length === 1 ? '1 e-mail' : milhar(linhas.length) + ' e-mails') + ' baixada.');
        } catch (erro) {
            if (!minha.cancelado) avisoFlutuante('Não foi possível montar a planilha. Tente de novo.', null, true);
        } finally {
            fimExportar(minha);
        }
    }
    $('em-exportar-cancelar').addEventListener('click', () => {
        const minha = exportacao;
        if (!minha) return;
        minha.cancelado = true;
        cancelarPedidos('exportar');
        fimExportar(minha);
        avisoFlutuante('Exportação cancelada.');
        $('em-exportar').focus();
    });
    T.partes.exportar = exportar;
})();
