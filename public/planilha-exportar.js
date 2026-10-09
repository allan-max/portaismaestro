// ExcelJS 4.4.0: https://github.com/exceljs/exceljs (licença em vendor/).
async function exportarPlanilhaFiltrada() {
    const cotacoes = document.getElementById('view-cota').style.display !== 'none';
    const registros = (cotacoes ? window.filteredCotacoes : window.filteredPedidos) || [];
    if (!registros.length) {
        alert('Nenhum registro para exportar. Confira os filtros aplicados.');
        return;
    }

    const botao = document.getElementById('btn-exportar-excel');
    botao.disabled = true;
    try {
        const padrao = cotacoes ? [
            ['COTAÇÃO', 32], ['VENCIMENTO', 18], ['ITEM', 80, 'ITENS'],
            ['QUANTIDADE', 18, 'QTD'], ['LOCALIDADE', 28], ['VENDEDOR', 22],
            ['MODELOS', 28, 'MODELO'], ['MARCAS', 24, 'MARCA'], ['RESPOSTA', 24]
        ] : [
            ['CIDADE', 28], ['FRETE', 12], ['PEDIDO', 20], ['VALOR', 20],
            ['PRODUTO', 80], ['DATA DE ENTREGA', 22, 'DATA ENTREGA', 'ENTREGA'],
            ['NMR DA RFQ', 20, 'RFQ'], ['REQUISITANTE', 24],
            ['EMAIL REQUISITANTE', 38, 'EMAIL REQUISITAN', 'EMAIL REQUSITAN', 'EMAIL DO REQUISITANTE'],
            ['NF (MAESTRO)', 22, 'Nº NOTA FISCAL', 'NOTA FISCAL', 'NF']
        ];
        const normalizar = nome => nome.trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, '');
        const chaves = [...new Set(registros.flatMap(registro => Object.keys(registro)))];
        const usadas = new Set();
        const colunas = padrao.map(([nome, largura, ...aliases]) => {
            const nomes = [nome, ...aliases].map(normalizar);
            const campos = chaves.filter(chave => nomes.includes(normalizar(chave)));
            campos.forEach(chave => usadas.add(chave));
            return { nome, largura, campos };
        });
        chaves.filter(chave => !usadas.has(chave)).forEach(chave => {
            colunas.push({ nome: chave.trim().toUpperCase(), largura: 28, campos: [chave] });
        });

        const arquivo = new ExcelJS.Workbook();
        const planilha = arquivo.addWorksheet(cotacoes ? 'Cotações' : 'Pedidos', {
            views: [{ state: 'frozen', ySplit: 1 }]
        });
        planilha.columns = colunas.map(coluna => ({ header: coluna.nome, width: coluna.largura }));
        registros.forEach(registro => {
            planilha.addRow(colunas.map(coluna => {
                const chave = coluna.campos.find(campo => registro[campo] != null && registro[campo] !== '');
                const valor = chave === undefined ? '' : registro[chave];
                // Textos continuam textos, preservando zeros iniciais e impedindo fórmulas vindas dos dados.
                return typeof valor === 'number' || typeof valor === 'boolean' ? valor : String(valor);
            }));
        });
        const borda = { style: 'thin', color: { argb: 'FF000000' } };
        planilha.eachRow((linha, numero) => {
            linha.height = numero === 1 ? 32 : 42;
            linha.eachCell({ includeEmpty: true }, celula => {
                celula.font = { name: 'Calibri', size: 11, bold: numero === 1 };
                celula.alignment = { vertical: 'middle', horizontal: numero === 1 ? 'center' : 'left', wrapText: true };
                celula.border = { top: borda, left: borda, bottom: borda, right: borda };
                if (numero === 1) celula.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
            });
        });
        const valor = colunas.findIndex(coluna => coluna.nome === 'VALOR');
        if (valor !== -1) planilha.getColumn(valor + 1).numFmt = '"R$" #,##0.00';
        planilha.autoFilter = { from: { row: 1, column: 1 }, to: { row: registros.length + 1, column: colunas.length } };
        const buffer = await arquivo.xlsx.writeBuffer();
        const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `maestro_${cotacoes ? 'cotacoes' : 'pedidos'}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (erro) {
        console.error('Falha ao exportar planilha:', erro);
        alert('Não foi possível gerar o Excel. Atualize a página e tente novamente.');
    } finally {
        botao.disabled = false;
    }
}
