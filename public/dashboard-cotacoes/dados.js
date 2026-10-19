(function (root) {
    'use strict';
    const STATUS = {
        responded: { label: 'Resposta registrada', short: 'Resposta registrada', color: 'green' },
        pending: { label: 'Não respondida registrada', short: 'Não respondida', color: 'blue' },
        unknown: { label: 'Sem informação', short: 'Sem informação', color: 'muted' },
        invalid: { label: 'Status não reconhecido', short: 'Não reconhecido', color: 'amber' }
    };
    const canonical = value => String(value ?? '').trim().toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    function campo(row, ...names) {
        const keys = Object.keys(row);
        for (const name of names) {
            const key = keys.find(k => canonical(k) === canonical(name));
            if (key !== undefined && row[key] != null && row[key] !== '') return row[key];
        }
        return '';
    }
    function today(now = new Date()) {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo',
            year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(p => [p.type, p.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }
    function day(base, offset) {
        const date = new Date(base + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + offset);
        return date.toISOString().slice(0, 10);
    }
    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        const parsed = new Date(value + 'T12:00:00Z');
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }
    function parseDate(value, format = 'safe') {
        const text = String(value ?? '').trim();
        if (!text) return { iso: '', problem: 'missing' };
        const iso = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T\s].*)?$/);
        if (iso) return validDate(iso[1]) ? { iso: iso[1], problem: '' } : { iso: '', problem: 'invalid' };
        const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/);
        if (!slash) return { iso: '', problem: 'invalid' };
        const a = Number(slash[1]), b = Number(slash[2]);
        if (a < 1 || b < 1 || (a > 12 && b > 12)) return { iso: '', problem: 'invalid' };
        if (a <= 12 && b <= 12 && a !== b && !['br', 'us'].includes(format)) return { iso: '', problem: 'ambiguous' };
        const us = b > 12 || (a <= 12 && b <= 12 && format === 'us');
        const date = `${slash[3]}-${String(us ? a : b).padStart(2, '0')}-${String(us ? b : a).padStart(2, '0')}`;
        return validDate(date) ? { iso: date, problem: '' } : { iso: '', problem: 'invalid' };
    }
    function normalize(value) {
        const status = canonical(value);
        if (['RESPONDIDO', 'RESPONDIDA'].includes(status)) return 'responded';
        if (['NÃO RESPONDIDO', 'NÃO RESPONDIDA', 'NAO RESPONDIDO', 'NAO RESPONDIDA', 'NÃƒO RESPONDIDO', 'NÃƒO RESPONDIDA'].map(canonical).includes(status)) return 'pending';
        return status ? 'invalid' : 'unknown';
    }
    function explicitTimestamp(value) {
        const text = String(value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) return null;
        return validDate(text.slice(0, 10)) && !Number.isNaN(Date.parse(text)) ? text : null;
    }
    function normalizeRows(records, format = 'safe') {
        if (!Array.isArray(records)) throw new TypeError('A base de cotações não é uma lista.');
        return records.map((original, index) => {
            if (!original || typeof original !== 'object' || Array.isArray(original)) throw new TypeError('Registro de cotação inválido.');
            const parsed = parseDate(campo(original, 'VENCIMENTO'), format);
            let seller = String(campo(original, 'VENDEDOR')).trim().replace(/\s+/g, ' ').toUpperCase();
            if (!seller || ['-', 'SEM VENDEDOR', 'NAO INFORMADO'].includes(canonical(seller))) seller = 'Sem vendedor';
            const raw = String(campo(original, 'RESPOSTA'));
            return {
                // Identidade de exibição desta fotografia; nunca é usada para editar ou relacionar histórico persistido.
                id: String(index), original,
                number: String(campo(original, 'COTAÇÃO')) || 'Sem identificação',
                item: String(campo(original, 'ITEM', 'ITENS') || 'Item não informado'),
                city: String(campo(original, 'LOCALIDADE') || 'Não informado'),
                qty: String(campo(original, 'QUANTIDADE', 'QTD')) || 'Não registrado',
                brand: String(campo(original, 'MARCAS', 'MARCA') || 'Não registrado'),
                model: String(campo(original, 'MODELOS', 'MODELO') || 'Não registrado'),
                seller, due: parsed.iso, dateProblem: parsed.problem, dueRaw: String(campo(original, 'VENCIMENTO')),
                raw, status: normalize(raw),
                respondedAt: explicitTimestamp(campo(original, 'RESPONDIDA_EM', 'DATA_RESPOSTA')),
                detectedAt: explicitTimestamp(campo(original, 'OBSERVADA_EM', 'DATA_DETECCAO_RESPOSTA')),
                channel: String(campo(original, 'CANAL_RESPOSTA')) || null,
                mode: String(campo(original, 'MODO_ENVIO')) || null,
                author: String(campo(original, 'AUTOR_RESPOSTA')) || null,
                source: String(campo(original, 'ORIGEM_EVIDENCIA')) || 'Campo RESPOSTA da base de cotações',
                summary: String(campo(original, 'RESUMO_RESPOSTA')) || null
            };
        });
    }
    function deadline(row, now = today()) {
        if (!validDate(row.due)) return 'missing';
        if (row.due < now) return 'overdue';
        if (row.due === now) return 'today';
        return row.due <= day(now, 7) ? 'week' : 'later';
    }
    function select(data, filters = {}) {
        if (filters.from && filters.to && filters.from > filters.to) return [];
        const search = canonical(filters.search), now = today();
        return data.filter(row => {
            const d = deadline(row, now), pending = ['pending', 'unknown'].includes(row.status);
            const matchDeadline = !filters.deadline || (filters.deadline === 'active' ? ['today', 'week', 'later'].includes(d) :
                filters.deadline === 'pendingActive' ? ['today', 'week', 'later'].includes(d) && pending :
                filters.deadline === 'next7' ? ['today', 'week'].includes(d) && pending :
                ['today', 'overdue'].includes(filters.deadline) ? d === filters.deadline && pending : d === filters.deadline);
            return matchDeadline && (!filters.sellers?.length || filters.sellers.includes(row.seller)) &&
                (!filters.status || row.status === filters.status) &&
                (!filters.from || (validDate(row.due) && row.due >= filters.from)) &&
                (!filters.to || (validDate(row.due) && row.due <= filters.to)) &&
                (!search || canonical([row.number, row.item, row.city, row.seller].join(' ')).includes(search));
        });
    }
    function metrics(data) {
        const now = today();
        const m = { total: data.length, active: 0, pendingActive: 0, today: 0, next7: 0, overdue: 0,
            responded: 0, unknown: 0, invalid: 0, missing: 0, ambiguous: 0 };
        for (const row of data) {
            const d = deadline(row, now), pending = ['pending', 'unknown'].includes(row.status);
            if (['today', 'week', 'later'].includes(d)) { m.active++; if (pending) m.pendingActive++; }
            if (pending && d === 'today') m.today++;
            if (pending && ['today', 'week'].includes(d)) m.next7++;
            if (pending && d === 'overdue') m.overdue++;
            if (d === 'missing') m.missing++;
            if (row.dateProblem === 'ambiguous') m.ambiguous++;
            if (row.status === 'responded') m.responded++;
            if (row.status === 'unknown') m.unknown++;
            if (row.status === 'invalid') m.invalid++;
        }
        return m;
    }
    function sortRows(data, order = 'asc') {
        return [...data].sort((a, b) => {
            if (!validDate(a.due)) return validDate(b.due) ? 1 : Number(a.id) - Number(b.id);
            if (!validDate(b.due)) return -1;
            return (order === 'desc' ? -1 : 1) * a.due.localeCompare(b.due) || Number(a.id) - Number(b.id);
        });
    }
    const api = { STATUS, campo, today, day, validDate, parseDate, normalize, normalizeRows, deadline, select, metrics, sortRows, rows: [] };
    Object.defineProperty(api, 'TODAY', { get: today });
    Object.defineProperty(api, 'SELLERS', { get: () => [...new Set(api.rows.map(r => r.seller))].filter(s => s !== 'Sem vendedor').sort((a, b) => a.localeCompare(b, 'pt-BR')) });
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DashboardData = api;
})(typeof window !== 'undefined' ? window : globalThis);
