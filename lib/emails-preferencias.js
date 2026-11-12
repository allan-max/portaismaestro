// Preferências da tela de E-mails, por usuário (a chave é o e-mail da sessão, em minúsculas).
// Arquivo próprio do portal, fora do repositório; gravação em arquivo temporário e troca de nome.
// Premissa, a mesma dos outros arquivos de estado em dados/: um processo só do portal.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILTROS = 20;
const MAX_NOME = 40;
const MAX_CAIXAS = 50;
const MAX_POR_USUARIO = 64 * 1024;        // JSON das preferências de um usuário
const MAX_ARQUIVO = 4 * 1024 * 1024;      // arquivo inteiro
// Paleta neutra de etiquetas dos filtros salvos; a tela traduz o nome para a variável de cor.
const CORES = ['cinza', 'azul', 'verde', 'ambar', 'violeta', 'ciano', 'rosa', 'laranja'];
// ver_texto: o detalhe abre no texto puro em vez da versão formatada ("Ver como texto" lembrado)
const PADRAO = { minhas_caixas: [], filtros: [], sem_ruido: true, agrupar: false, notificar: false, som: false, ver_texto: false };
const EMAIL = /^[^\s@]{1,100}@[^\s@]{1,100}$/;

function erro(codigo, mensagem) {
    return Object.assign(new Error(mensagem), { codigo });
}

function criarPreferencias({ dir, sanearFiltro }) {
    const arquivo = path.join(dir, 'emails-preferencias.json');

    function chaveDe(email) {
        const chave = String(email || '').trim().toLowerCase();
        if (!EMAIL.test(chave)) throw erro('SEM_USUARIO', 'Sessão sem e-mail identificado.');
        return chave;
    }

    // Arquivo corrompido não derruba o portal: vai para o lado (cópia do arquivo ruim) e começa vazio.
    function lerArquivo() {
        let texto;
        try { texto = fs.readFileSync(arquivo, 'utf8'); } catch (e) { return { usuarios: {}, equipe: [] }; }
        try {
            const dados = JSON.parse(texto);
            if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('formato');
            const usuarios = dados.usuarios && typeof dados.usuarios === 'object' && !Array.isArray(dados.usuarios) ? dados.usuarios : {};
            return { usuarios, equipe: Array.isArray(dados.equipe) ? dados.equipe : [] };
        } catch (e) {
            try { fs.renameSync(arquivo, `${arquivo}.corrompido-${Date.now()}`); } catch (e2) { /* sem como guardar: segue vazio */ }
            return { usuarios: {}, equipe: [] };
        }
    }

    function gravar(dados) {
        const json = JSON.stringify(dados);
        if (Buffer.byteLength(json) > MAX_ARQUIVO) throw erro('PREFERENCIAS_GRANDES', 'O arquivo de preferências chegou ao limite.');
        fs.mkdirSync(dir, { recursive: true });
        const tmp = `${arquivo}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, json);
        fs.renameSync(tmp, arquivo);   // troca atômica: nunca deixa o arquivo pela metade
    }

    function filtros(lista) {
        if (!Array.isArray(lista)) return [];
        return lista.filter(f => f && typeof f === 'object' && !Array.isArray(f) && typeof f.nome === 'string' && f.nome.trim())
            .map(f => {
                const filtro = sanearFiltro(f.filtro) || {};
                delete filtro.cursor;   // salvar guarda o conjunto de filtros, não a posição na lista
                return {
                    id: typeof f.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(f.id) ? f.id : crypto.randomUUID(),
                    nome: f.nome.trim().slice(0, MAX_NOME),
                    cor: CORES.includes(f.cor) ? f.cor : CORES[0],
                    fixado: f.fixado === true,
                    filtro,
                };
            });
    }

    // Só as chaves permitidas, com o tipo e o tamanho certos. Vale para o que chega e para o que é lido do arquivo.
    function sanearUsuario(p) {
        p = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
        const caixas = Array.isArray(p.minhas_caixas) ? p.minhas_caixas : [];
        return {
            minhas_caixas: [...new Set(caixas.slice(0, MAX_CAIXAS).filter(c => typeof c === 'string' && c).map(c => c.slice(0, 120)))],
            filtros: filtros(p.filtros).slice(0, MAX_FILTROS),
            sem_ruido: typeof p.sem_ruido === 'boolean' ? p.sem_ruido : PADRAO.sem_ruido,
            agrupar: p.agrupar === true,
            notificar: p.notificar === true,
            som: p.som === true,
            ver_texto: p.ver_texto === true,
        };
    }

    function montar(dados, chave) {
        const proprio = Object.prototype.hasOwnProperty.call(dados.usuarios, chave) ? dados.usuarios[chave] : {};
        return { ...sanearUsuario(proprio), equipe: filtros(dados.equipe).slice(0, MAX_FILTROS) };
    }

    function obter(email) {
        return montar(lerArquivo(), chaveDe(email));
    }

    // Grava só as chaves que vieram. `equipe` só administrador grava. Quem é vem da sessão, nunca do navegador.
    function salvar(email, admin, novos) {
        const chave = chaveDe(email);
        novos = novos && typeof novos === 'object' && !Array.isArray(novos) ? novos : {};
        if ('equipe' in novos && admin !== true) throw erro('SEM_PERMISSAO', 'Só administrador publica filtros da equipe.');
        for (const k of ['filtros', 'equipe']) {
            if (k in novos && (!Array.isArray(novos[k]) || novos[k].length > MAX_FILTROS)) {
                throw erro('LIMITE_FILTROS', `São até ${MAX_FILTROS} filtros salvos.`);
            }
        }
        const dados = lerArquivo();
        const atual = montar(dados, chave);
        const permitidas = Object.keys(PADRAO).filter(k => k in novos);
        const usuario = sanearUsuario({ ...atual, ...Object.fromEntries(permitidas.map(k => [k, novos[k]])) });
        if (Buffer.byteLength(JSON.stringify(usuario)) > MAX_POR_USUARIO) {
            throw erro('PREFERENCIAS_GRANDES', 'As preferências passaram do tamanho máximo.');
        }
        const equipe = 'equipe' in novos ? filtros(novos.equipe) : filtros(dados.equipe).slice(0, MAX_FILTROS);
        gravar({ usuarios: { ...dados.usuarios, [chave]: usuario }, equipe });
        return { ...usuario, equipe };
    }

    return { obter, salvar };
}

module.exports = { criarPreferencias, CORES, MAX_FILTROS };
