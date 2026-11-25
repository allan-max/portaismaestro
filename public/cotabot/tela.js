/* Tela do Cotabot (robô que cota na VM; o portal pede ao gerenciador, que fala com a VM).
   Aparece para admin ou para quem tem a permissão "Cotabot" (cotabot_access) na tela de Contas.
   API: POST /api/cotabot/cotar, GET /api/cotabot/estado, GET /api/cotabot/planilha/:id (sessão em x-session-id). */
(function () {
    'use strict';
    const MAX_ITENS = 24;   // a Planilha Base comporta 24 itens

    const sessao = localStorage.getItem('maestro_session');
    const pode = localStorage.getItem('maestro_admin') === 'true' || localStorage.getItem('maestro_cotabot') === 'true';
    if (!sessao) { window.location.replace('index.html'); return; }
    if (!pode) { window.location.replace('minhas_cotacoes.html'); return; }

    const $ = id => document.getElementById(id);
    const lista = $('cb-itens');

    function renumerar() {
        const linhas = lista.querySelectorAll('.cb-item');
        linhas.forEach((l, i) => {
            l.querySelector('.cb-n').textContent = i + 1;
            l.querySelector('.cb-desc').setAttribute('aria-label', `Descrição do item ${i + 1}`);
            l.querySelector('.cb-qtd').setAttribute('aria-label', `Quantidade do item ${i + 1}`);
            l.querySelector('.cb-remover').setAttribute('aria-label', `Remover item ${i + 1}`);
            l.querySelector('.cb-remover').disabled = linhas.length === 1;
        });
        $('cb-add').disabled = linhas.length >= MAX_ITENS;
        $('cb-contador').textContent = `${linhas.length} de ${MAX_ITENS} itens`;
    }

    function addItem(desc = '', qtd = 1) {
        if (lista.querySelectorAll('.cb-item').length >= MAX_ITENS) return;
        const linha = document.createElement('div');
        linha.className = 'cb-item';
        linha.setAttribute('role', 'listitem');
        linha.innerHTML = `<span class="cb-n"></span>
            <textarea class="cb-input cb-desc" rows="2" maxlength="3000" placeholder="Descrição do item (pode colar a do portal)"></textarea>
            <input class="cb-input cb-qtd" type="number" min="1" inputmode="numeric" title="Quantidade">
            <button type="button" class="icon-button cb-remover" title="Remover item">✕</button>`;
        linha.querySelector('.cb-desc').value = desc;
        linha.querySelector('.cb-qtd').value = qtd;
        linha.querySelector('.cb-remover').addEventListener('click', () => { linha.remove(); renumerar(); });
        lista.appendChild(linha);
        renumerar();
        return linha;
    }

    function itensPreenchidos() {
        return [...lista.querySelectorAll('.cb-item')]
            .map(l => ({ descricao: l.querySelector('.cb-desc').value.trim(), quantidade: l.querySelector('.cb-qtd').value }))
            .filter(i => i.descricao);
    }

    function aviso(texto, tipo) {
        const el = $('cb-aviso');
        el.textContent = texto;
        el.className = 'cb-aviso' + (tipo ? ' ' + tipo : '');
    }

    // ---------- conversa com o portal ----------
    async function api(caminho, opcoes = {}) {
        const resp = await fetch(caminho, { ...opcoes, headers: { 'x-session-id': sessao, ...(opcoes.headers || {}) } });
        if (resp.status === 401) { window.location.replace('index.html'); throw new Error('sessão expirada'); }
        return resp;
    }

    function el(tag, classe, conteudo) {
        const n = document.createElement(tag);
        if (classe) n.className = classe;
        if (conteudo !== undefined && conteudo !== null) n.textContent = conteudo;
        return n;
    }

    const linkSeguro = url => /^https?:\/\//i.test(String(url || '')) ? String(url) : null;
    const hora = iso => iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

    // ---------- uso do plano Claude (lido na VM) ----------
    function caixaUso(j) {
        const caixa = el('div', 'cb-uso');
        caixa.appendChild(el('small', '', j.nome));
        caixa.appendChild(el('b', '', j.usado_pct == null ? '—' : `${j.usado_pct}%`));
        const barra = el('div', 'cb-barra');
        const i = el('i');
        i.style.width = `${Math.min(100, j.usado_pct || 0)}%`;
        if (j.teto_pct < 100 && (j.usado_pct || 0) >= j.teto_pct) i.classList.add('cheia');
        barra.appendChild(i);
        if (j.teto_pct < 100) {
            const m = el('span', 'cb-teto');
            m.style.left = `${j.teto_pct}%`;
            m.title = `teto do robô: ${j.teto_pct}%`;
            barra.appendChild(m);
        }
        caixa.appendChild(barra);
        if (j.renova) caixa.appendChild(el('small', '', `renova ${j.renova}`));
        if (j.cabem_itens != null) {
            const faixa = j.cabem_min != null ? ` (entre ${j.cabem_min} e ${j.cabem_max == null ? '?' : j.cabem_max})` : '';
            caixa.appendChild(el('small', 'cb-estimativa', `cabem ≈ ${j.cabem_itens} itens até ${j.teto_pct}%${faixa}`));
            caixa.appendChild(el('small', '', `≈ ${j.media_por_item_pct}% por item · confiança ${j.confianca}`));
        } else {
            caixa.appendChild(el('small', '', 'estimativa: precisa cotar 1 item'));
        }
        return caixa;
    }

    function mostrarUso(estado) {
        const u = estado.uso || {};
        const robo = $('cb-robo');
        robo.className = 'cb-status' + (estado.robo_conectado && u.online ? '' : ' off');
        robo.lastElementChild.textContent = !estado.robo_conectado ? 'Gerenciador desconectado'
            : u.online ? 'Robô conectado' : u.online === false ? 'VM do robô fora do ar' : 'Verificando o robô...';
        const lido = $('cb-uso-lido');
        if (!u.uso || !u.uso.janelas) {
            lido.textContent = u.mensagem || '';
            return;
        }
        const caixas = $('cb-usos');
        caixas.replaceChildren();
        for (const chave of ['five_hour', 'seven_day']) {
            if (u.uso.janelas[chave]) caixas.appendChild(caixaUso(u.uso.janelas[chave]));
        }
        const media = el('div', 'cb-uso');
        media.appendChild(el('small', '', 'Média por item'));
        media.appendChild(el('b', '', u.uso.media_duracao_min != null ? `${u.uso.media_duracao_min} min` : '—'));
        media.appendChild(el('small', '', u.uso.itens_medidos
            ? `${u.uso.media_passos} passos · ${u.uso.itens_medidos} item(ns) medidos` : 'nenhum item medido'));
        caixas.appendChild(media);
        lido.textContent = (u.uso.lido_em ? `Uso da conta lido às ${u.uso.lido_em} (na VM).` : '')
            + (u.online ? '' : ' ' + (u.mensagem || ''));
    }

    // ---------- pedidos ----------
    const NOMES = { enviando: 'Enviando', fila: 'Na fila', cotando: 'Cotando', pronto: 'Pronto', erro: 'Erro' };

    function linhaItem(it, t) {
        const li = el('li', 'cb-pi ' + (t.status || 'fila'));
        const desc = it.descricao.length > 110 ? it.descricao.slice(0, 110) + '…' : it.descricao;
        li.appendChild(el('span', 'cb-pi-desc', `${desc} · qtd ${it.quantidade}`));
        if (t.status === 'pronto' && t.escolhido) {
            const info = el('span', 'cb-pi-info');
            info.appendChild(document.createTextNode(`escolhido: ${t.escolhido.fornecedor} · ${t.escolhido.preco} · `));
            const href = linkSeguro(t.escolhido.link);
            if (href) {
                const a = el('a', '', 'abrir');
                a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer';
                info.appendChild(a);
            }
            li.appendChild(info);
            return li;
        }
        let linha = '';
        if (t.status === 'cotando') linha = `cotando · ${t.passos} passos${t.passo_atual ? ' · ' + t.passo_atual : ''}`;
        else if (t.status === 'erro') linha = `erro: ${t.erro}`;
        else if (t.status === 'pronto') linha = t.nao_encontrado ? 'não encontrado' : `${t.anuncios} anúncio(s), nenhum escolhido`;
        if (linha) li.appendChild(el('span', 'cb-pi-info', linha));
        return li;
    }

    function cartaoPedido(p) {
        const c = el('div', 'cb-pedido ' + p.estado);
        const topo = el('div', 'cb-pedido-topo');
        topo.appendChild(el('b', '', p.evento ? `Evento ${p.evento}` : 'Sem evento'));
        topo.appendChild(el('span', 'cb-etiqueta ' + p.estado, NOMES[p.estado] || p.estado));
        topo.appendChild(el('small', 'muted', `${p.itens.length} item(ns) · ${hora(p.criado)}`));
        c.appendChild(topo);
        c.appendChild(el('div', 'cb-msg', p.mensagem));
        if (p.estado === 'pronto') {
            const b = el('button', 'button small primary', 'Baixar Planilha Base');
            b.type = 'button';
            b.addEventListener('click', () => baixar(p, b));
            c.appendChild(b);
        }
        const itensT = (p.tarefa && p.tarefa.itens) || [];
        const lista = el('ol', 'cb-pedido-itens');
        p.itens.forEach((it, i) => lista.appendChild(linhaItem(it, itensT[i] || {})));
        c.appendChild(lista);
        return c;
    }

    async function baixar(p, botao) {
        botao.disabled = true;
        try {
            const resp = await api(`/api/cotabot/planilha/${encodeURIComponent(p.id)}`);
            if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `HTTP ${resp.status}`);
            const url = URL.createObjectURL(await resp.blob());
            const a = el('a');
            a.href = url;
            a.download = `planilha_base_cotacao_${(p.evento || p.id).replace(/[^\w.-]+/g, '_')}.xlsx`;
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 10000);
        } catch (e) {
            aviso('Não deu para baixar a planilha: ' + e.message, 'erro');
        } finally {
            botao.disabled = false;
        }
    }

    let timer = null;
    async function atualizar() {
        clearTimeout(timer);
        let ativo = false;
        try {
            const resp = await api('/api/cotabot/estado');
            if (resp.status === 403) { window.location.replace('minhas_cotacoes.html'); return; }
            const estado = await resp.json();
            mostrarUso(estado);
            if (estado.pedidos && estado.pedidos.length) $('cb-pedidos').replaceChildren(...estado.pedidos.map(cartaoPedido));
            ativo = (estado.pedidos || []).some(p => ['enviando', 'fila', 'cotando'].includes(p.estado));
        } catch (e) {
            if (String(e.message) === 'sessão expirada') return;
            $('cb-uso-lido').textContent = 'Portal fora do ar: tentando de novo...';
        }
        // Com cotação andando, atualiza a cada 5 s; parado, a cada 20 s (também relê o uso).
        timer = setTimeout(atualizar, ativo ? 5000 : 20000);
    }

    $('cb-add').addEventListener('click', () => addItem().querySelector('.cb-desc').focus());
    $('cb-form').addEventListener('submit', async e => {
        e.preventDefault();
        const itens = itensPreenchidos();
        if (!itens.length) return aviso('Coloque a descrição de pelo menos um item.', 'erro');
        const botao = $('cb-enviar');
        botao.disabled = true;
        aviso('Enviando...', '');
        try {
            const resp = await api('/api/cotabot/cotar', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ evento: $('cb-evento').value.trim(), sites: $('cb-sites').value, itens })
            });
            const corpo = await resp.json().catch(() => ({}));
            if (!resp.ok) throw new Error(corpo.error || `HTTP ${resp.status}`);
            aviso('Enviado ao Cotabot. Acompanhe abaixo: cada item leva alguns minutos.', '');
            lista.replaceChildren();
            addItem();
            atualizar();
        } catch (err) {
            aviso(`Não enviado: ${err.message} Os itens continuam aqui.`, 'erro');
        } finally {
            botao.disabled = false;
        }
    });

    // Abrir pelo número do evento: cotabot.html?evento=310170
    const evento = new URLSearchParams(window.location.search).get('evento');
    if (evento) $('cb-evento').value = evento.slice(0, 40);
    addItem();
    atualizar();
})();
