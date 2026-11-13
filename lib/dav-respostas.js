const fs = require('node:fs');
const path = require('node:path');

// DAV gerado pelo Cotafrete na resposta do Coupa/Vale (INTEGRACAO_DAV_MAESTRO.md).
//
// O vendedor anexa só a Planilha Base. O portal pede o DAV ao gerenciador
// (`gerar_dav`); o gerenciador conversa com o Cotafrete e devolve:
//   - `status_dav`  { evento, estado: gerando|erro|pronto, mensagem, numero, avisos, erros }
//   - `dav_pronto`  { evento, numero, davs:[{name,data}], itens:[{item,ncm,origem}], avisos }
// Com o `dav_pronto`, a resposta guardada aqui entra na fila de sempre (modo responder).
//
// A resposta que espera o DAV fica só na memória: se o portal reiniciar no meio,
// o vendedor reenvia e o Cotafrete devolve o MESMO DAV (trava pelo hash), sem gerar outro.

const ESTADOS = new Set(['gerando', 'erro', 'pronto']);
const MAX_TEXTO = 2000;

const texto = (v, max = MAX_TEXTO) => String(v ?? '').slice(0, max);
const listaDeTextos = v => (Array.isArray(v) ? v.slice(0, 200).map(x => texto(x, 500)) : []);
const chaveDe = evento => String(evento || '').replace(/^Evento\s+/i, '').trim();
const so8Digitos = v => {
    const d = String(v ?? '').replace(/\D+/g, '');
    return d.length === 8 ? d : '';
};

// NCM do Cotafrete (cadastro HSE / planilha / IA) vale quando veio; senão fica o que o vendedor
// tinha na grade. Pareia pela posição: as duas listas seguem as linhas da Planilha Base.
function mesclarNcms(digitados, itens) {
    const base = Array.isArray(digitados) ? digitados.slice() : [];
    const doCotafrete = Array.isArray(itens) ? itens : [];
    const total = Math.min(500, Math.max(base.length, doCotafrete.length));
    const ncms = [];
    const origens = [];
    for (let i = 0; i < total; i++) {
        const cf = so8Digitos(doCotafrete[i] && doCotafrete[i].ncm);
        if (cf) {
            ncms.push(cf);
            origens.push(texto(doCotafrete[i].origem, 30));
        } else {
            ncms.push(base[i] ?? '');
            origens.push(base[i] ? 'digitado' : '');
        }
    }
    return { ncms, origens };
}

function criarDavRespostas({ caminho, io }) {
    let status = {};
    try {
        if (fs.existsSync(caminho)) status = JSON.parse(fs.readFileSync(caminho, 'utf8')) || {};
    } catch {
        status = {};
    }
    const aguardando = new Map();   // evento -> { payload, audit_id }

    function gravar() {
        try {
            fs.mkdirSync(path.dirname(caminho), { recursive: true });
            fs.writeFileSync(caminho, JSON.stringify(status), 'utf8');
        } catch (e) {
            console.error('Aviso ao gravar dav_respostas.json:', e.message);
        }
    }

    function salvarStatus(evento, dados) {
        const chave = chaveDe(evento);
        if (!chave || !ESTADOS.has(dados && dados.estado)) return null;
        const registro = {
            estado: dados.estado,
            mensagem: texto(dados.mensagem),
            numero: dados.numero ? texto(dados.numero, 30) : null,
            avisos: listaDeTextos(dados.avisos),
            erros: listaDeTextos(dados.erros),
            em: new Date().toISOString()
        };
        status[chave] = registro;
        gravar();
        io.to('frontend').emit('status_dav_atualizado', { evento: chave, status: registro });
        return registro;
    }

    function limparStatus(evento) {
        const chave = chaveDe(evento);
        if (!chave || !(chave in status)) return;
        delete status[chave];
        gravar();
        io.to('frontend').emit('status_dav_atualizado', { evento: chave, status: null });
    }

    // Mesmo formato do erros_robo: chave = número da cotação como está e só com os dígitos.
    function paraCotacoes(cotacoes) {
        const mapa = {};
        if (!Array.isArray(cotacoes)) return mapa;
        for (const c of cotacoes) {
            const bruto = String((c && c['COTAÇÃO']) || '').trim();
            const limpo = bruto.replace(/\D+/g, '') || bruto;
            const achado = status[bruto] || status[limpo];
            if (achado) {
                mapa[bruto] = achado;
                if (limpo) mapa[limpo] = achado;
            }
        }
        return mapa;
    }

    return {
        aguardar: (evento, item) => aguardando.set(chaveDe(evento), item),
        retirar: evento => {
            const chave = chaveDe(evento);
            const item = aguardando.get(chave);
            aguardando.delete(chave);
            return item || null;
        },
        esperando: evento => aguardando.has(chaveDe(evento)),
        salvarStatus,
        limparStatus,
        paraCotacoes,
        obter: evento => status[chaveDe(evento)] || null
    };
}

module.exports = { criarDavRespostas, mesclarNcms, chaveDe };
