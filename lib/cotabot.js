const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Cotabot: robô que cota os itens na VM (Claude + Edge) e devolve a Planilha Base preenchida.
//
// Mesmo desenho do DAV (lib/dav-respostas.js): a tela fala só com o portal; o portal pede ao
// gerenciador (`cotabot_cotar`) e o gerenciador conversa com a VM (gerenciador/ponte_cotabot.py).
// O gerenciador devolve:
//   - `cotabot_status` { pedido, estado: enviando|fila|cotando|erro, mensagem, tarefa }
//   - `cotabot_pronto` { pedido, tarefa, planilha: { name, data base64 } }
//   - `cotabot_uso`    { online, uso, mensagem }   (resposta a `cotabot_uso_pedir`)
// Pedidos e planilhas ficam em dados/cotabot/ (sobrevivem a reinício do portal).

const ESTADOS = new Set(['enviando', 'fila', 'cotando', 'pronto', 'erro']);
const ATIVOS = new Set(['enviando', 'fila', 'cotando']);
const MAX_PEDIDOS = 200;
const MAX_ITENS = 24;
const USO_VALE_MS = 60 * 1000;           // pede o uso de novo à VM depois disto
const ID_VALIDO = /^[a-f0-9]{16}$/;

const texto = (v, max = 2000) => String(v ?? '').slice(0, max);

function limparTarefa(t) {
    if (!t || typeof t !== 'object') return null;
    const itens = (Array.isArray(t.itens) ? t.itens : []).slice(0, MAX_ITENS).map(i => {
        const e = i && i.escolhido;
        return {
            numero: Number(i && i.numero) || null,
            status: texto(i && i.status, 20),
            passos: Number(i && i.passos) || 0,
            passo_atual: texto(i && i.passo_atual, 160),
            erro: texto(i && i.erro, 300),
            anuncios: Number(i && i.anuncios) || 0,
            nao_encontrado: !!(i && i.nao_encontrado),
            duracao_s: Number(i && i.duracao_s) || null,
            escolhido: e ? { fornecedor: texto(e.fornecedor, 120), preco: texto(e.preco, 40), link: texto(e.link, 600) } : null
        };
    });
    return { status: texto(t.status, 20), posicao_fila: Number(t.posicao_fila) || 0, erro_planilha: texto(t.erro_planilha, 300), itens };
}

function criarCotabot({ pasta, io, obterRobo, agora = Date.now }) {
    const arquivo = path.join(pasta, 'pedidos.json');
    let pedidos = {};
    try {
        if (fs.existsSync(arquivo)) pedidos = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
    } catch {
        pedidos = {};
    }
    let uso = { online: null, uso: null, mensagem: '', em: 0 };
    let usoPedidoEm = 0;

    function gravar() {
        try {
            const ids = Object.keys(pedidos).sort((a, b) => pedidos[b].criado.localeCompare(pedidos[a].criado));
            for (const id of ids.slice(MAX_PEDIDOS)) {
                fs.rmSync(path.join(pasta, id + '.xlsx'), { force: true });
                delete pedidos[id];
            }
            fs.mkdirSync(pasta, { recursive: true });
            fs.writeFileSync(arquivo, JSON.stringify(pedidos), 'utf8');
        } catch (e) {
            console.error('Aviso ao gravar cotabot/pedidos.json:', e.message);
        }
    }

    function avisar(p) {
        io.to('frontend').emit('cotabot_atualizado', { id: p.id, email: p.email });
    }

    // Valida o que a tela mandou. Devolve { erro } ou { pedido }.
    function pedir({ email, vendedor, evento, itens, sites }) {
        const robo = obterRobo();
        if (!robo) return { status: 503, erro: 'Gerenciador desconectado: não dá para cotar agora.' };
        const limpos = (Array.isArray(itens) ? itens : []).slice(0, 100).map(i => ({
            descricao: texto(i && i.descricao, 3000).trim(),
            quantidade: Math.max(1, Math.min(1e6, parseInt(i && i.quantidade, 10) || 1))
        })).filter(i => i.descricao);
        if (!limpos.length) return { status: 400, erro: 'Coloque a descrição de pelo menos um item.' };
        if (limpos.length > MAX_ITENS) return { status: 400, erro: `A Planilha Base comporta até ${MAX_ITENS} itens.` };
        const ev = texto(evento, 40).trim();
        if (ev && !/^[A-Za-z0-9][A-Za-z0-9._\/ -]*$/.test(ev)) return { status: 400, erro: 'Número do evento inválido.' };
        const id = crypto.randomBytes(8).toString('hex');
        const p = {
            id, email: texto(email, 200), evento: ev, criado: new Date(agora()).toISOString(),
            itens: limpos, sites: texto(sites, 4000),
            estado: 'enviando', mensagem: 'Enviando ao Cotabot...', tarefa: null, planilha: null, atualizado: new Date(agora()).toISOString()
        };
        pedidos[id] = p;
        gravar();
        io.to(robo).emit('cotabot_cotar', { pedido: id, evento: ev, vendedor: texto(vendedor, 80) || p.email, itens: limpos, sites: p.sites });
        return { pedido: p };
    }

    function status(dados) {
        const p = pedidos[String(dados && dados.pedido || '')];
        if (!p || !ESTADOS.has(dados.estado) || p.estado === 'pronto') return;
        p.estado = dados.estado;
        p.mensagem = texto(dados.mensagem, 500);
        if (dados.tarefa) p.tarefa = limparTarefa(dados.tarefa);
        p.atualizado = new Date(agora()).toISOString();
        gravar();
        avisar(p);
    }

    function pronto(dados) {
        const p = pedidos[String(dados && dados.pedido || '')];
        const planilha = dados && dados.planilha;
        if (!p || !planilha || typeof planilha.data !== 'string') return;
        try {
            fs.mkdirSync(pasta, { recursive: true });
            fs.writeFileSync(path.join(pasta, p.id + '.xlsx'), Buffer.from(planilha.data, 'base64'));
        } catch (e) {
            p.estado = 'erro';
            p.mensagem = 'Planilha recebida, mas não foi salva no portal: ' + e.message;
            gravar(); avisar(p);
            return;
        }
        p.estado = 'pronto';
        p.mensagem = 'Cotação pronta. Baixe a Planilha Base.';
        p.planilha = path.basename(texto(planilha.name, 120)).replace(/[^\w.\- ]+/g, '_') || `cotabot_${p.id}.xlsx`;
        if (dados.tarefa) p.tarefa = limparTarefa(dados.tarefa);
        p.atualizado = new Date(agora()).toISOString();
        gravar();
        avisar(p);
    }

    function receberUso(dados) {
        uso = { online: !!(dados && dados.online), uso: (dados && dados.uso) || null, mensagem: texto(dados && dados.mensagem, 300), em: agora() };
        io.to('frontend').emit('cotabot_uso', uso);
    }

    // Pede o uso à VM se a leitura está velha (no máximo 1 pedido por minuto).
    function talvezPedirUso() {
        const robo = obterRobo();
        if (!robo || agora() - Math.max(uso.em, usoPedidoEm) < USO_VALE_MS) return;
        usoPedidoEm = agora();
        io.to(robo).emit('cotabot_uso_pedir', {});
    }

    const podeVer = (p, ficha) => !!p && (ficha.admin === true || p.email === ficha.email);

    function estadoPara(ficha) {
        talvezPedirUso();
        const meus = Object.values(pedidos).filter(p => podeVer(p, ficha))
            .sort((a, b) => b.criado.localeCompare(a.criado)).slice(0, 20)
            .map(p => ({ ...p, itens: p.itens.map(i => ({ descricao: i.descricao.slice(0, 200), quantidade: i.quantidade })) }));
        return {
            robo_conectado: !!obterRobo(),
            uso: { ...uso, em: uso.em ? new Date(uso.em).toISOString() : null },
            pedidos: meus
        };
    }

    function planilhaPara(id, ficha) {
        if (!ID_VALIDO.test(String(id))) return null;
        const p = pedidos[id];
        if (!podeVer(p, ficha) || p.estado !== 'pronto') return null;
        const caminho = path.join(pasta, p.id + '.xlsx');
        return fs.existsSync(caminho) ? { caminho, nome: p.planilha || `cotabot_${p.id}.xlsx` } : null;
    }

    // Gerenciador caiu: as pontes dele morreram. Pedidos ativos viram erro (reenviar é seguro).
    function roboCaiu() {
        let mudou = false;
        for (const p of Object.values(pedidos)) {
            if (!ATIVOS.has(p.estado)) continue;
            p.estado = 'erro';
            p.mensagem = 'O gerenciador desconectou no meio da cotação. Se ele só reconectou, o andamento volta sozinho; se reiniciou, envie de novo.';
            p.atualizado = new Date(agora()).toISOString();
            mudou = true;
            avisar(p);
        }
        if (mudou) gravar();
    }

    return { pedir, status, pronto, receberUso, estadoPara, planilhaPara, roboCaiu };
}

module.exports = { criarCotabot, limparTarefa };
