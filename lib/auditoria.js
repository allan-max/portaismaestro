// Auditoria de ações dos usuários: um JSON por linha, um arquivo por mês (append-only).
// O fechamento (sucesso/erro) é uma linha nova com o mesmo id; ler() junta as duas.
// ponytail: leitura síncrona do mês inteiro; se o volume passar de ~100 mil linhas/mês, migrar para SQLite.
const fs = require('fs');
const path = require('path');

const PRAZO_RESPOSTA_MS = 10 * 60 * 1000;
const MAX_TEXTO = 200;
const MAX_DETALHES = 4000;

const cortar = (v) => v == null ? null : String(v).slice(0, MAX_TEXTO);

// detalhes grandes (ex.: novos_dados enorme) viram um resumo em texto para o log não crescer sem limite
function limitarDetalhes(detalhes) {
    const json = JSON.stringify(detalhes || {});
    return json.length <= MAX_DETALHES ? (detalhes || {}) : { truncado: true, resumo: json.slice(0, MAX_DETALHES - 40) };
}

// fuso: os dias do filtro são dias de Brasília (sem horário de verão desde 2019)
function criarAuditoria({ dir, agora = () => new Date(), uuid, fuso = '-03:00' }) {
    fs.mkdirSync(dir, { recursive: true });

    const arquivoDoMes = (data) => path.join(dir, `auditoria-${data.toISOString().slice(0, 7)}.jsonl`);
    const gravar = (obj) => fs.appendFileSync(arquivoDoMes(agora()), JSON.stringify(obj) + '\n');

    function registrar({ email = null, ip = null, area, acao, portal = null, alvo = null, detalhes = {}, status = 'pendente', erro = null }) {
        const reg = {
            id: uuid(), data_hora: agora().toISOString(), email: cortar(email), ip: cortar(ip),
            area, acao, portal: cortar(portal), alvo: cortar(alvo), detalhes: limitarDetalhes(detalhes), status, erro: cortar(erro)
        };
        gravar(reg);
        return reg;
    }

    function fechar(id, { status, erro = null, detalhes_extra = null } = {}) {
        if (!id) return null;
        const fecho = {
            id, fecha: true, data_hora: agora().toISOString(), status, erro: cortar(erro),
            detalhes_extra: detalhes_extra && limitarDetalhes(detalhes_extra)
        };
        gravar(fecho);
        return fecho;
    }

    // meses de dataInicio até o mês seguinte a dataFim (fechamentos podem cair no mês seguinte)
    function mesesDoPeriodo(dataInicio, dataFim) {
        const meses = [];
        const d = new Date(`${dataInicio.slice(0, 7)}-01T00:00:00Z`);
        const fim = new Date(`${dataFim.slice(0, 7)}-01T00:00:00Z`);
        fim.setUTCMonth(fim.getUTCMonth() + 1);
        while (d <= fim) {
            meses.push(d.toISOString().slice(0, 7));
            d.setUTCMonth(d.getUTCMonth() + 1);
        }
        return meses;
    }

    function lerLinhas(mes) {
        let texto;
        try { texto = fs.readFileSync(path.join(dir, `auditoria-${mes}.jsonl`), 'utf8'); }
        catch (e) { return []; }
        return texto.split('\n').flatMap(l => {
            if (!l.trim()) return [];
            try { return [JSON.parse(l)]; } catch (e) { return []; }
        });
    }

    function ler(dataInicio, dataFim) {
        const de = new Date(`${dataInicio}T00:00:00${fuso}`).getTime();
        const ate = new Date(`${dataFim}T23:59:59.999${fuso}`).getTime();
        const registros = new Map();
        const fechos = [];
        for (const mes of mesesDoPeriodo(dataInicio, dataFim)) {
            for (const l of lerLinhas(mes)) (l.fecha ? fechos.push(l) : registros.set(l.id, l));
        }
        for (const f of fechos) {
            const r = registros.get(f.id);
            if (!r) continue;
            registros.set(f.id, {
                ...r, status: f.status, erro: f.erro,
                detalhes: f.detalhes_extra ? { ...r.detalhes, ...f.detalhes_extra } : r.detalhes
            });
        }
        const limitePendente = agora().getTime() - PRAZO_RESPOSTA_MS;
        return [...registros.values()]
            .filter(r => { const t = Date.parse(r.data_hora); return t >= de && t <= ate; })
            .map(r => (r.status === 'pendente' && Date.parse(r.data_hora) < limitePendente) ? { ...r, status: 'sem_resposta' } : r)
            .sort((a, b) => b.data_hora.localeCompare(a.data_hora));
    }

    // Apelidos: arquivo do portal (o banco_usuarios.json é do gerenciador Python; aqui não disputamos escrita).
    const arquivoApelidos = path.join(dir, 'apelidos.json');
    const MAX_APELIDO = 40;

    function lerApelidos() {
        try {
            const dados = JSON.parse(fs.readFileSync(arquivoApelidos, 'utf8'));
            return Object.fromEntries(Object.entries(dados).filter(([, v]) => typeof v === 'string'));
        } catch (e) { return {}; }
    }

    function definirApelido(email, apelido) {
        const chave = String(email || '').trim().toLowerCase();
        if (!/^[^\s@]{1,100}@[^\s@]{1,100}$/.test(chave)) throw new Error('E-mail inválido.');
        const novo = String(apelido || '').trim().slice(0, MAX_APELIDO);
        const atuais = lerApelidos();
        const antes = atuais[chave] || null;
        const { [chave]: _, ...resto } = atuais;
        const proximos = novo ? { ...resto, [chave]: novo } : resto;
        const tmp = arquivoApelidos + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(proximos, null, 2));
        fs.renameSync(tmp, arquivoApelidos);   // troca atômica: nunca deixa o arquivo pela metade
        return { antes, depois: novo || null };
    }

    return { registrar, fechar, ler, lerApelidos, definirApelido };
}

module.exports = { criarAuditoria };
