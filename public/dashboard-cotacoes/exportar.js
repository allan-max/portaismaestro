(function (root) {
    'use strict';
    const D = typeof module !== 'undefined' && module.exports ? require('./dados') : root.DashboardData;
    const unknown = value => value == null || value === '' ? 'Não registrado' : String(value);
    function criarWorkbook(ExcelJS, rows, filters = {}) {
        if (!ExcelJS?.Workbook) throw new Error('A biblioteca Excel não está disponível. Atualize a página.');
        if (!rows.length) throw new Error('Nenhum registro no recorte selecionado.');
        const workbook = new ExcelJS.Workbook(); workbook.creator = 'Maestro';
        const sheet = workbook.addWorksheet('Cotações', { views: [{ state: 'frozen', ySplit: 1 }] });
        const standard = [
            ['COTAÇÃO', 25], ['VENCIMENTO', 20], ['ITEM', 80, 'ITENS'], ['QUANTIDADE', 18, 'QTD'],
            ['LOCALIDADE', 30], ['VENDEDOR', 25], ['MODELOS', 30, 'MODELO'], ['MARCAS', 25, 'MARCA'], ['RESPOSTA', 25]
        ];
        const canonical = name => String(name).trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const rawKeys = [...new Set(rows.flatMap(row => Object.keys(row.original)))], used = new Set();
        const columns = standard.map(([name, width, ...aliases]) => {
            const keys = rawKeys.filter(k => [name, ...aliases].map(canonical).includes(canonical(k)));
            keys.forEach(k => used.add(k));
            return { name, width, value: row => { const key = keys.find(k => row.original[k] != null && row.original[k] !== ''); return key === undefined ? '' : row.original[key]; } };
        });
        rawKeys.filter(k => !used.has(k)).forEach(key => columns.push({ name: key, width: 28, value: row => row.original[key] ?? '' }));
        const deadlines = { overdue: 'Vencida', today: 'Vence hoje', week: 'Próximos 7 dias', later: 'No prazo', missing: 'Data não classificável' };
        columns.push(
            { name: 'VENCIMENTO NORMALIZADO', width: 24, value: row => row.due || (row.dateProblem === 'ambiguous' ? 'Data ambígua' : 'Não informado / inválido') },
            { name: 'SITUAÇÃO DO PRAZO', width: 26, value: row => deadlines[D.deadline(row)] },
            { name: 'CLASSIFICAÇÃO DA RESPOSTA', width: 32, value: row => D.STATUS[row.status].label },
            { name: 'RESPONDIDA EM', width: 30, value: row => unknown(row.respondedAt) },
            { name: 'CANAL DA RESPOSTA', width: 25, value: row => unknown(row.channel) },
            { name: 'MODO DE ENVIO', width: 22, value: row => unknown(row.mode) },
            { name: 'AUTOR DA RESPOSTA', width: 30, value: row => unknown(row.author) },
            { name: 'DETECTADA EM', width: 30, value: row => unknown(row.detectedAt) },
            { name: 'ORIGEM DA INFORMAÇÃO', width: 42, value: row => unknown(row.source) },
            { name: 'RESUMO DA RESPOSTA', width: 60, value: row => unknown(row.summary) }
        );
        sheet.columns = columns.map(c => ({ header: c.name, width: c.width }));
        rows.forEach(row => sheet.addRow(columns.map(c => {
            const value = c.value(row);
            // Objetos nunca viram fórmulas; identificadores e textos mantêm zeros e conteúdo literal.
            return typeof value === 'number' || typeof value === 'boolean' ? value : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
        })));
        sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: columns.length } };
        const summary = workbook.addWorksheet('Recorte');
        summary.columns = [{ header: 'CAMPO', width: 35 }, { header: 'VALOR', width: 90 }];
        summary.addRows([
            ['Fonte', 'COTAÇÕES.json'], ['Consulta confirmada em', unknown(filters.consultado_em)],
            ['Exportado em', new Date().toISOString()], ['Administrador', unknown(filters.responsavel)],
            ['Quantidade de registros', rows.length], ['Unidade', 'Cada linha representa um registro; números repetidos não foram mesclados.'],
            ['Vendedores', filters.sellers?.length ? filters.sellers.join(', ') : 'Todos'],
            ['Vencimento inicial', filters.from || 'Sem limite'], ['Vencimento final', filters.to || 'Sem limite'],
            ['Status', filters.status ? D.STATUS[filters.status]?.label || filters.status : 'Todos'],
            ['Prazo', filters.deadline || 'Todos'], ['Busca', filters.search || 'Sem busca'],
            ['Ordenação', filters.sort === 'desc' ? 'Vencimento decrescente' : 'Vencimento crescente'],
            ['Datas ambíguas', ({ safe: 'Sinalizadas para revisão', br: 'Interpretadas como dia/mês/ano', us: 'Interpretadas como mês/dia/ano' })[filters.dateMode] || 'Sinalizadas para revisão'],
            ['Histórico de resposta', 'Campos ausentes aparecem como Não registrado. O horário de consulta não é a data da resposta.']
        ]);
        const border = { style: 'thin', color: { argb: 'FFD5DBE3' } };
        for (const tab of workbook.worksheets) tab.eachRow((row, index) => {
            row.height = index === 1 ? 32 : 42;
            row.eachCell({ includeEmpty: true }, cell => {
                cell.font = { name: 'Calibri', size: 11, bold: index === 1 };
                cell.alignment = { vertical: 'middle', horizontal: index === 1 ? 'center' : 'left', wrapText: true };
                cell.border = { top: border, left: border, bottom: border, right: border };
                if (index === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } };
            });
        });
        return workbook;
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = { criarWorkbook };
    else root.DashboardExcel = { criarWorkbook };
})(typeof window !== 'undefined' ? window : globalThis);
