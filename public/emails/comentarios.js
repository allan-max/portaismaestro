/* Central de E-mails: comentários do e-mail aberto (seção 6). Carregado por tela.js na primeira vez que um e-mail abre.
   O texto do comentário entra sempre por textContent; as quebras de linha ficam pelo CSS (white-space: pre-wrap).
   Sem atualização ao vivo: recarrega ao abrir o e-mail e depois de comentar ou apagar. */
(function () {
    'use strict';
    const T = window.EmailsTela;
    const { $, el, botao, estado, pedir, avisoFlutuante, atualizarItem } = T;
    const A = window.EmailsAcoes;
    const MAX = 2000;

    // o formulário nasce uma vez e fica: trocar status com um rascunho aberto não apaga o rascunho
    const lista = el('ol', null, 'em-coments');
    const form = el('div', null, 'em-coment-form');
    const campo = el('textarea', null, 'em-entrada em-coment-campo');
    campo.id = 'em-coment-texto';
    campo.maxLength = MAX;
    campo.rows = 3;
    const rotulo = el('label', 'Novo comentário, visível para quem vê este e-mail');
    rotulo.htmlFor = campo.id;
    const rodape = el('div', null, 'em-coment-rodape');
    const conta = el('span', '', 'em-dica-texto em-num');
    conta.id = 'em-coment-conta';
    campo.setAttribute('aria-describedby', conta.id);
    const enviar = botao('Comentar', 'em-botao');
    rodape.append(conta, enviar);
    form.append(rotulo, campo, rodape);
    let doEmail = null, enviando = false;

    const restam = () => { const n = MAX - campo.value.length; conta.textContent = n < 200 ? 'Restam ' + n + ' caracteres.' : ''; };
    campo.addEventListener('input', restam);
    // Ctrl+Enter comenta, como em outros campos de mensagem
    campo.addEventListener('keydown', ev => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); comentar(); } });
    enviar.addEventListener('click', comentar);

    function item(c, agora) {
        const li = el('li', null, 'em-coment');
        if (c.apagado_em) {
            li.classList.add('em-coment-apagado');
            li.appendChild(el('p', A.comentarioApagado(c, agora)));
            return li;
        }
        const topo = el('p', null, 'em-coment-topo');
        topo.append(el('strong', A.autor(c)), el('span', A.horaCurta(c.em, agora), 'em-hist-sub em-num'));
        li.append(topo, el('p', c.texto || '', 'em-coment-texto'));
        if (c.proprio === true && Number.isSafeInteger(c.id)) {
            // apagar pede confirmação no próprio botão: o texto não volta
            const b = botao('Apagar', 'em-link em-coment-apagar');
            b.setAttribute('aria-label', 'Apagar o seu comentário');
            b.addEventListener('click', () => {
                if (b.dataset.confirmar) return apagar(c.id);
                b.dataset.confirmar = '1';
                b.textContent = 'Confirmar: apagar';
                setTimeout(() => { if (b.isConnected) { delete b.dataset.confirmar; b.textContent = 'Apagar'; } }, 5000);
            });
            topo.appendChild(b);
        }
        return li;
    }
    function mostrar(e) {
        if (doEmail !== e.id) { campo.value = ''; restam(); }
        doEmail = e.id;
        const comentarios = (Array.isArray(e.comentarios) ? e.comentarios : []).filter(c => c && typeof c === 'object');
        const agora = new Date();
        lista.replaceChildren(...comentarios.map(c => item(c, agora)));
        const alvo = $('em-comentarios');
        const vazio = comentarios.length ? [] : [el('p', 'Nenhum comentário ainda.', 'em-dica-texto')];
        alvo.replaceChildren(...vazio, lista, form);
    }
    // a volta de comentar ou apagar traz a lista nova: vale para o e-mail ainda aberto e para o número na lista
    function atualizar(pedido, d) {
        const id = Number.isSafeInteger(d && d.email_id) ? d.email_id : pedido;
        const comentarios = d && Array.isArray(d.comentarios) ? d.comentarios : [];
        const vivos = comentarios.filter(c => c && !c.apagado_em).length;
        atualizarItem(id, { comentarios: vivos });
        if (estado.aberto && estado.aberto.id === id) {
            estado.aberto.comentarios = comentarios;
            mostrar(estado.aberto);
        }
    }
    async function comentar() {
        const id = doEmail, texto = campo.value;
        if (enviando || id === null) return;
        if (!texto.trim()) { avisoFlutuante('Escreva o comentário antes de enviar.', null, true); campo.focus(); return; }
        enviando = true;
        enviar.disabled = true;
        const r = await pedir('comentar', { email_id: id, texto });
        enviando = false;
        enviar.disabled = false;
        if (r.cancelado) return;
        if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível comentar.', null, true); return; }
        if (doEmail === id) { campo.value = ''; restam(); }
        atualizar(id, r.dados);
        avisoFlutuante('Comentário publicado.');
    }
    async function apagar(cid) {
        const id = doEmail;
        const r = await pedir('apagar_comentario', { id: cid });
        if (r.cancelado) return;
        if (!r.sucesso) { avisoFlutuante(r.erro || 'Não foi possível apagar o comentário.', null, true); return; }
        atualizar(id, r.dados);
        avisoFlutuante('Comentário apagado.');
        if (doEmail === id) campo.focus({ preventScroll: true });   // o botão sumiu com a linha: o foco não fica perdido
    }
    T.partes.comentarios = mostrar;
})();
