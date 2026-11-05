/* Dashboard de Contas e Acessos (dashboard.html): gestão de usuários, vendedores vinculados,
   permissões de acesso (Planilha Geral / Portais) e variáveis do robô (CONFIG.json). */
(function (root) {
    'use strict';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function normalizarUsuarios(usuariosJson = {}) {
        if (!usuariosJson || typeof usuariosJson !== 'object') return [];
        return Object.entries(usuariosJson)
            .filter(([, d]) => d && typeof d === 'object')
            .map(([email, d]) => ({
                email: String(email),
                admin: !!d.admin,
                dev: !!d.dev,
                verificado: d.verificado !== false,
                dashboard_access: !!d.dashboard_access,
                portais_access: !!d.portais_access || !!d.dashboard_access,
                bloqueado: !!d.bloqueado,
                vendedor: String(d.vendedor || ''),
                online: !!d.online,
            }))
            .sort((a, b) => a.email.localeCompare(b.email));
    }

    function iniciaisDe(email) {
        const local = String(email || '').split('@')[0].replace(/[^a-zA-Z0-9]/g, '');
        return (local.slice(0, 2) || 'US').toUpperCase();
    }

    function filtrarUsuarios(lista, f = {}) {
        const termo = String(f.busca || '').trim().toLowerCase();
        return lista.filter(u => {
            if (f.grupo === 'admins' && !u.admin) return false;
            if (f.grupo === 'portais' && !(u.portais_access || u.dashboard_access || u.admin)) return false;
            if (f.grupo === 'estatisticas' && !(u.dashboard_access || u.admin)) return false;
            if (f.grupo === 'vendedores' && !u.vendedor.trim()) return false;
            if (f.grupo === 'pendentes' && u.verificado !== false) return false;
            if (termo && !`${u.email} ${u.vendedor}`.toLowerCase().includes(termo)) return false;
            return true;
        });
    }

    function kpisContas(lista) {
        return {
            total: lista.length,
            admins: lista.filter(u => u.admin).length,
            portais: lista.filter(u => u.portais_access || u.dashboard_access || u.admin).length,
            estatisticas: lista.filter(u => u.dashboard_access || u.admin).length,
            vendedores: lista.filter(u => u.vendedor.trim()).length,
        };
    }

    function htmlCards(lista, f, ctx) {
        const k = kpisContas(lista);
        const card = (grupo, rotulo, val, cls, nota, i) => `<button type="button" class="card-num entra${f.grupo === grupo ? ' selecionado' : ''}" style="--i:${i}" data-acao="grupo" data-grupo="${grupo}"><small>${esc(rotulo)}</small>${ctx.num(val, cls)}<em>${esc(nota)}</em></button>`;
        return `<div class="cards">
            ${card('', 'Contas cadastradas', k.total, '', 'total de usuários no sistema', 0)}
            ${card('admins', 'Administradores', k.admins, 'green', 'com acesso administrativo total', 1)}
            ${card('portais', 'Acesso aos portais', k.portais, 'blue', 'habilitados nos robôs', 2)}
            ${card('estatisticas', 'Estatísticas', k.estatisticas, 'amber', 'Gestão comercial no dashboard', 3)}
            ${card('vendedores', 'Com vendedor vinculado', k.vendedores, 'cyan', 'associados à planilha comercial', 4)}
        </div>`;
    }

    function htmlModalConfig(config, carregandoConfig, ctx) {
        const icone = ctx.icone || (() => '');
        const entradas = config && typeof config === 'object' ? Object.entries(config) : [];
        const corpo = carregandoConfig
            ? '<p class="vazio">Carregando variáveis do robô (CONFIG.json)…</p>'
            : entradas.length
                ? `<div class="contas-config-grid">${entradas.map(([chave, valor]) => `<label class="field"><span class="field-label">${esc(chave)}</span><input type="text" class="contas-config-input" data-config-key="${esc(chave)}" value="${esc(valor ?? '')}"></label>`).join('')}</div>`
                : '<p class="vazio">Nenhuma variável recebida. Verifique se o gerenciador está online.</p>';
        return `<div class="drawer-shade" data-acao="fechar-config">
            <section class="drawer contas-config-drawer" role="dialog" aria-modal="true" aria-labelledby="config-drawer-title">
                <header class="drawer-header">
                    <div class="drawer-header-top">
                        <span class="eyebrow">CONFIGURAÇÃO DO GERENCIADOR</span>
                        <button type="button" class="icon-button" data-acao="fechar-config" aria-label="Fechar configurações">${icone('fechar')}</button>
                    </div>
                    <h2 id="config-drawer-title">Variáveis do robô (CONFIG.json)</h2>
                    <p>Caminhos de rede, pastas de impressão e credenciais de envio do gerenciador local.</p>
                </header>
                <div class="drawer-body">${corpo}</div>
                <footer class="drawer-bottom contas-config-footer">
                    <button type="button" class="button" data-acao="fechar-config">Cancelar</button>
                    <button type="button" class="button primary" data-acao="salvar-config" ${!entradas.length ? 'disabled' : ''}>${icone('salvar')}<span>Salvar configurações no robô</span></button>
                </footer>
            </section>
        </div>`;
    }

    function pagina(dados = {}, ctx = {}, f = { grupo: '', busca: '' }, op = {}) {
        const todos = normalizarUsuarios(dados.usuarios);
        const lista = filtrarUsuarios(todos, f);
        const icone = ctx.icone || (() => '');

        const linhas = lista.map((u, idx) => {
            const hasPortais = u.portais_access || u.dashboard_access || u.admin;
            const hasStats = u.dashboard_access || u.admin;
            const disabledAttr = u.admin ? 'disabled title="Administradores sempre têm acesso total"' : '';
            const email = esc(u.email);
            const vend = esc(u.vendedor);
            const ini = esc(iniciaisDe(u.email));
            const inputId = `vend_${idx}`;

            return `<tr>
                <td>
                    <div class="seller-cell">
                        <span class="avatar" aria-hidden="true">${ini}</span>
                        <div class="aud-pessoa">
                            <div class="contas-email-row">
                                <b>${email}</b>
                                ${u.admin ? '<span class="tag azul">ADMIN</span>' : ''}
                                ${u.verificado === false ? '<span class="tag vermelho" title="Ainda não clicou no link de ativação">NÃO VERIFICADO</span>' : ''}
                            </div>
                            <small>${u.admin ? 'Administrador' : (u.vendedor ? 'Vendedor' : 'Usuário')} · <span class="aud-online${u.online ? ' on' : ''}">${u.online ? 'Online' : 'Offline'}</span></small>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="contas-vend-group">
                        <input type="text" id="${inputId}" class="contas-vend-input" value="${vend}" placeholder="Ex.: JOÃO (vazio = sem vínculo)">
                        <button type="button" class="button small primary" data-acao="salvar-vendedor" data-email="${email}" data-input="${inputId}">Salvar</button>
                    </div>
                </td>
                <td>
                    <label class="contas-switch">
                        <input type="checkbox" data-acao-change="toggle-acesso" data-email="${email}" data-campo="portais_access" ${hasPortais ? 'checked' : ''} ${disabledAttr}>
                        <span class="contas-slider"></span>
                    </label>
                </td>
                <td>
                    <label class="contas-switch">
                        <input type="checkbox" data-acao-change="toggle-acesso" data-email="${email}" data-campo="dashboard_access" ${hasStats ? 'checked' : ''} ${disabledAttr}>
                        <span class="contas-slider"></span>
                    </label>
                </td>
                <td>
                    <div class="contas-row-actions">
                        <button type="button" class="icon-button" data-acao="focar-vendedor" data-input="${inputId}" title="Editar vendedor vinculado">${icone('editar')}</button>
                        <button type="button" class="icon-button" data-acao="salvar-vendedor" data-email="${email}" data-input="${inputId}" title="Salvar vínculo do usuário">${icone('salvar')}</button>
                    </div>
                </td>
            </tr>`;
        }).join('');

        return `${htmlCards(todos, f, ctx)}
            <section class="panel table-panel bloco entra" style="--i:2">
                <div class="panel-head">
                    <div>
                        <div class="table-title"><h2>Contas e privilégios</h2><span class="counter number">${lista.length}</span></div>
                        <p>Vincule o vendedor e controle o acesso aos Portais de Robôs e às Estatísticas (Gestão comercial).</p>
                    </div>
                    <div class="actions">
                        ${f.grupo || f.busca ? '<button type="button" class="button small text" data-acao="limpar">Limpar filtro</button>' : ''}
                    </div>
                </div>
                <div class="filtros">
                    <label class="field">
                        <span class="field-label">Perfil</span>
                        <select id="filtro-contas-grupo" data-filtro="grupo">
                            <option value="" ${!f.grupo ? 'selected' : ''}>Todos (${todos.length})</option>
                            <option value="admins" ${f.grupo === 'admins' ? 'selected' : ''}>Administradores</option>
                            <option value="portais" ${f.grupo === 'portais' ? 'selected' : ''}>Com acesso aos portais</option>
                            <option value="estatisticas" ${f.grupo === 'estatisticas' ? 'selected' : ''}>Com acesso a estatísticas</option>
                            <option value="vendedores" ${f.grupo === 'vendedores' ? 'selected' : ''}>Com vendedor vinculado</option>
                            <option value="pendentes" ${f.grupo === 'pendentes' ? 'selected' : ''}>Não verificados</option>
                        </select>
                    </label>
                    <label class="field search-field">
                        <span class="field-label">Buscar usuário</span>
                        <span class="search-box">${icone('busca')}<input id="pesquisaUsuario" type="search" data-filtro="busca" placeholder="E-mail ou vendedor vinculado…" value="${esc(f.busca)}"></span>
                    </label>
                </div>
                ${lista.length ? `<div class="table-scroll">
                    <table class="quote-table contas-table">
                        <thead>
                            <tr>
                                <th>Usuário (E-mail)</th>
                                <th>Vendedor vinculado (Planilha)</th>
                                <th>Permissões · Portais (Robôs)</th>
                                <th>Permissões · Estatísticas (Comercial)</th>
                                <th>Ações</th>
                            </tr>
                        </thead>
                        <tbody id="usersTableBody">${linhas}</tbody>
                    </table>
                </div>` : `<p class="vazio">${todos.length ? 'Nenhum usuário corresponde ao filtro selecionado.' : 'Nenhum usuário encontrado.'}</p>`}
                <div class="table-footer">
                    <span>Mostrando ${lista.length} de ${todos.length} conta(s)</span>
                    <span class="muted">Administradores possuem acesso total automaticamente</span>
                </div>
            </section>
            ${op.configAberta ? htmlModalConfig(op.configDados, op.carregandoConfig, ctx) : ''}`;
    }

    const api = { normalizarUsuarios, filtrarUsuarios, kpisContas, pagina };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DashContas = api;

    if (typeof document !== 'undefined' && document.body && document.body.dataset.dashboard === 'contas') {
        const f = { grupo: '', busca: '' };
        const op = { configAberta: new URLSearchParams(location.search).get('config') === '1', configDados: null, carregandoConfig: false };
        let toastTimer;
        function mostrarToast(msg) {
            const el = document.getElementById('toast');
            if (!el) return;
            el.textContent = msg;
            el.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.classList.remove('show'), 4500);
        }

        const painel = root.Dash.iniciar({
            pagina: 'contas',
            breadcrumb: 'ADMINISTRAÇÃO · CONTROLE DE ACESSOS',
            titulo: 'Contas e acessos',
            subtitulo: 'Gerencie as contas cadastradas, vendedores vinculados e privilégios dos portais.',
            rodape: 'Painel de Controle Admin · alterações de acesso são auditadas',
            sidebarOpcoes: () => ({ configAberta: op.configAberta }),
            controles: ctx => `<button type="button" class="button" data-acao="abrir-config">${ctx.icone('config')}<span>Configurações (CONFIG.json)</span></button>`,
            pedirCustom: (socket, estado, desenhar) => {
                estado.carregando = true;
                socket.emit('admin_pedir_usuarios');
                if (op.configAberta && !op.configDados) {
                    op.carregandoConfig = true;
                    socket.emit('pedir_config_admin');
                }
                desenhar();
            },
            ouvirSocket: (socket, estado, desenhar) => {
                socket.on('admin_receber_usuarios', r => {
                    estado.carregando = false;
                    if (r && r.sucesso === false) {
                        estado.erro = r.erro || 'Erro ao carregar usuários.';
                        desenhar();
                        return;
                    }
                    const usuarios = (r && r.usuarios) ? r.usuarios : (r || {});
                    estado.dados = { usuarios };
                    estado.ok_em = new Date().toISOString();
                    estado.erro = null;
                    desenhar();
                });
                socket.on('admin_vendedor_alterado', r => {
                    if (r && r.sucesso) {
                        if (estado.dados && estado.dados.usuarios && estado.dados.usuarios[r.email]) {
                            estado.dados.usuarios[r.email].vendedor = r.vendedor;
                        }
                        mostrarToast(`Vendedor "${r.vendedor || 'Nenhum'}" vinculado a ${r.email}.`);
                        desenhar();
                    } else {
                        mostrarToast('Erro ao vincular vendedor: ' + ((r && r.erro) || 'falha desconhecida'));
                    }
                });
                socket.on('admin_acesso_alterado', r => {
                    if (r && r.sucesso) {
                        if (estado.dados && estado.dados.usuarios && estado.dados.usuarios[r.email]) {
                            const u = estado.dados.usuarios[r.email];
                            if (r.portais_access !== undefined) u.portais_access = r.portais_access;
                            if (r.dashboard_access !== undefined) u.dashboard_access = r.dashboard_access;
                            if (r.campo) u[r.campo] = r.acesso;
                            if (r.campo === 'dashboard_access' && r.acesso) u.portais_access = true;
                            if (r.campo === 'portais_access' && !r.acesso) u.dashboard_access = false;
                        }
                        mostrarToast(`Permissão atualizada para ${r.email}.`);
                        desenhar();
                    } else {
                        mostrarToast('Erro ao alterar acesso: ' + ((r && r.erro) || 'falha desconhecida'));
                        socket.emit('admin_pedir_usuarios');
                    }
                });
                socket.on('receber_config_admin', r => {
                    op.carregandoConfig = false;
                    if (r && r.sucesso) {
                        op.configDados = r.config || op.configDados;
                        op.configAberta = false;
                        mostrarToast('Configurações atualizadas no robô local com sucesso!');
                        desenhar();
                        return;
                    }
                    op.configDados = (r && r.config) ? r.config : (r || {});
                    desenhar();
                });
            },
            render: (d, ctx) => pagina(d, ctx, f, op),
            acoes: {
                grupo: el => { f.grupo = f.grupo === el.dataset.grupo ? '' : el.dataset.grupo; },
                limpar: () => { f.grupo = ''; f.busca = ''; },
                'focar-vendedor': el => {
                    setTimeout(() => {
                        const inp = document.getElementById(el.dataset.input);
                        if (inp) { inp.focus(); inp.select(); }
                    }, 20);
                },
                'salvar-vendedor': (el, ctx) => {
                    const inp = document.getElementById(el.dataset.input);
                    const socket = ctx.socket && ctx.socket();
                    if (!inp || !socket) return;
                    socket.emit('admin_alterar_vendedor_usuario', { email: el.dataset.email, vendedor: inp.value.trim() });
                },
                'toggle-acesso': (el, ctx) => {
                    const socket = ctx.socket && ctx.socket();
                    if (!socket) return;
                    const email = el.dataset.email;
                    const campo = el.dataset.campo;
                    const acesso = !!el.checked;
                    socket.emit('admin_alterar_acesso_dashboard', { email, campo, acesso });
                },
                'abrir-config': (el, ctx) => {
                    op.configAberta = true;
                    op.carregandoConfig = true;
                    const socket = ctx.socket && ctx.socket();
                    if (socket) socket.emit('pedir_config_admin');
                },
                'fechar-config': () => { op.configAberta = false; },
                'salvar-config': (el, ctx) => {
                    const socket = ctx.socket && ctx.socket();
                    if (!socket) return;
                    const novaConfig = {};
                    document.querySelectorAll('[data-config-key]').forEach(inp => {
                        novaConfig[inp.dataset.configKey] = inp.value;
                    });
                    socket.emit('salvar_config_admin', { config: novaConfig });
                },
            },
            filtrar: (k, v) => { f[k] = v; },
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
