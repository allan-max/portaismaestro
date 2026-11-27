const fs = require('node:fs');
const path = require('node:path');

// Padrões do Cotabot: para cada categoria ou marca, onde o robô cota (fornecedores) e a regra de compra.
// A tela reconhece o padrão pelas palavras-chave na descrição do item e mostra os fornecedores em caixinhas.
// Um só arquivo para a empresa toda (dados/cotabot/padroes.json); começa com lib/cotabot-padroes-iniciais.json.
// O padrão com `geral: true` vale quando nenhum outro é reconhecido.

const MAX_PADROES = 100;
const MAX_PALAVRAS = 60;
const MAX_FORNECEDORES = 60;
const INICIAIS = path.join(__dirname, 'cotabot-padroes-iniciais.json');

const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);

function lista(v, maxItens, maxTexto) {
    const itens = Array.isArray(v) ? v : String(v || '').split(/\r?\n/);
    const vistos = new Set();
    const saida = [];
    for (const i of itens) {
        const t = texto(i, maxTexto);
        const chave = t.toLowerCase();
        if (!t || vistos.has(chave)) continue;
        vistos.add(chave);
        saida.push(t);
        if (saida.length >= maxItens) break;
    }
    return saida;
}

function idDe(nome) {
    return texto(nome, 80).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'padrao';
}

// Valida o que veio da tela. Devolve { erro } ou { padrao }.
function limpar(dados, idExistente) {
    const nome = texto(dados && dados.nome, 80);
    if (!nome) return { erro: 'Dê um nome ao padrão.' };
    const fornecedores = lista(dados.fornecedores, MAX_FORNECEDORES, 120);
    if (!fornecedores.length) return { erro: 'Coloque pelo menos um fornecedor.' };
    const geral = dados.geral === true;
    const palavras = lista(dados.palavras, MAX_PALAVRAS, 60).map(p => p.toLowerCase());
    if (!geral && !palavras.length) return { erro: 'Coloque pelo menos uma palavra-chave (categoria ou marca).' };
    return { padrao: { id: idExistente || idDe(nome), nome, geral, palavras, fornecedores, regra: texto(dados.regra, 1000) } };
}

function criarPadroes({ arquivo, agora = Date.now }) {
    let padroes;
    try {
        padroes = JSON.parse(fs.readFileSync(fs.existsSync(arquivo) ? arquivo : INICIAIS, 'utf8'));
        if (!Array.isArray(padroes)) throw new Error('formato');
    } catch {
        padroes = JSON.parse(fs.readFileSync(INICIAIS, 'utf8'));
    }

    function gravar() {
        fs.mkdirSync(path.dirname(arquivo), { recursive: true });
        const tmp = arquivo + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(padroes, null, 2), 'utf8');
        fs.renameSync(tmp, arquivo);
    }

    function listar() {
        return padroes.map(p => ({ ...p }));
    }

    // id vazio = novo. Devolve { erro, status } ou { padrao }.
    function salvar(id, dados, email) {
        const existente = id ? padroes.find(p => p.id === id) : null;
        if (id && !existente) return { status: 404, erro: 'Padrão não encontrado.' };
        if (!existente && padroes.length >= MAX_PADROES) return { status: 400, erro: `Limite de ${MAX_PADROES} padrões.` };
        const r = limpar(dados, existente && existente.id);
        if (r.erro) return { status: 400, erro: r.erro };
        const p = r.padrao;
        if (!existente) {
            let base = p.id, n = 2;
            while (padroes.some(x => x.id === p.id)) p.id = `${base}-${n++}`;
        }
        if (p.geral) padroes.forEach(x => { if (x.id !== p.id) x.geral = false; });   // só um padrão geral
        p.alterado_por = texto(email, 200);
        p.alterado_em = new Date(agora()).toISOString();
        if (existente) padroes[padroes.indexOf(existente)] = p;
        else padroes.push(p);
        gravar();
        return { padrao: { ...p } };
    }

    function apagar(id) {
        const i = padroes.findIndex(p => p.id === id);
        if (i < 0) return { status: 404, erro: 'Padrão não encontrado.' };
        padroes.splice(i, 1);
        gravar();
        return { ok: true };
    }

    return { listar, salvar, apagar };
}

module.exports = { criarPadroes, limpar };
