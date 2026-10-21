/* Painel de Monitoramento (monitoramento.html): visão geral de todos os robôs, módulos, serviços e visualizador de logs TXT (\\SERVIDOR2\Publico\ALLAN\Logs). Só leitura. */
(function (root) {
    'use strict';
    const MIN = 60 * 1000, HORA = 60 * MIN, DIA = 24 * HORA;
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    function parseData(texto) {
        const t = String(texto || '').trim();
        const br = /^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(t);
        if (br) return new Date(+br[3], +br[2] - 1, +br[1], +br[4], +br[5], +(br[6] || 0));
        const d = t ? new Date(t) : null;
        return d && !Number.isNaN(d.getTime()) ? d : null;
    }

    function ha(data, agora) {
        if (!data) return 'sem registro';
        const min = Math.max(0, Math.round((agora - data) / MIN));
        if (min < 1) return 'agora';
        if (min < 60) return `há ${min} min`;
        const h = Math.floor(min / 60);
        return h < 48 ? `há ${h}h${min % 60 ? ` ${min % 60}min` : ''}` : `há ${Math.floor(h / 24)} dias`;
    }

    function fmtQuando(data, agora) {
        if (!data) return '—';
        const hoje = data.toDateString() === agora.toDateString();
        const ontem = new Date(agora.getTime() - DIA).toDateString() === data.toDateString();
        const hhmm = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        if (hoje) return `Hoje, ${hhmm}`;
        if (ontem) return `Ontem, ${hhmm}`;
        return `${data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}, ${hhmm}`;
    }

    function fmtDataHora(data) {
        if (!data) return '—';
        const d = data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const h = data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        return `${d}  ${h}`;
    }

    function fmtTamanho(bytes) {
        const b = Number(bytes);
        if (!Number.isFinite(b) || b < 0) return '—';
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1).replace('.', ',')} KB`;
        return `${(b / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
    }

    const SVG = {
        engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        robo: '<rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 2v6M8 2h8M7 13h.01M17 13h.01M9 17h6M1 12v4M23 12v4"/>',
        play: '<polygon points="9 7 17 12 9 17 9 7" fill="currentColor"/>',
        check: '<polyline points="20 6 9 17 4 12"/>',
        erro: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>',
        aviso: '<path d="m10.3 3.9-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
        servidor: '<rect x="2" y="3" width="20" height="7" rx="1.5"/><rect x="2" y="14" width="20" height="7" rx="1.5"/><path d="M6 6.5h.01M6 17.5h.01"/>',
        nf: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
        cadastro: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6M23 11h-6"/>',
        sync: '<path d="M20 7a8.1 8.1 0 0 0-14-2L3 8M3 3v5h5M4 17a8.1 8.1 0 0 0 14 2l3-3M16 16h5v5"/>',
        impressora: '<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
        grafico: '<path d="M4 19V11M10 19V5M16 19v-8M22 19V9"/>',
        logs: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h3"/>',
        terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
        fechar: '<path d="m6 6 12 12M6 18 18 6"/>',
        copiar: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
        externo: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>',
        setaEsq: '<path d="m15 18-6-6 6-6"/>',
        seta: '<path d="m9 6 6 6-6 6"/>',
        setaDir: '<path d="M5 12h14M13 6l6 6-6 6"/>',
        lista: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    };
    const svg = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${SVG[n] || ''}</svg>`;

    const MODULOS = [
        { id: 'gerenciador', nome: 'Gerenciador', subtitulo: 'Servidor Central · Auto-Pilot', categoria: 'servico', icone: 'servidor', href: 'atividade.html', idLog: 'gerenciador', arquivoLog: 'gerenciador.log' },
        { id: 'nf', nome: 'Serviço de NF', subtitulo: 'Cruzamento HSE · Notas Fiscais', categoria: 'servico', icone: 'nf', href: 'nfs.html', idLog: null, arquivoLog: 'Histórico NF (HSE)' },
        { id: 'cadastro', nome: 'Cadastro automático', subtitulo: 'Pedidos na planilha', categoria: 'servico', icone: 'cadastro', href: 'nfs.html', idLog: null, arquivoLog: 'Histórico Cadastro' },
        { id: 'sync_planilha', nome: 'Sync planilha', subtitulo: 'Planilha ⇄ Portal', categoria: 'servico', icone: 'sync', href: 'sync.html', idLog: null, arquivoLog: 'Histórico Sync' },
        { id: 'coupa', nome: 'Robô Coupa', subtitulo: 'Extração, Pente Fino e Respostas', categoria: 'robo', icone: 'robo', href: 'coupa.html', idLog: 'coupa', arquivoLog: 'log-coupa.txt' },
        { id: 'vale', nome: 'Robô Vale', subtitulo: 'Extração Nimbi / Vale', categoria: 'robo', icone: 'robo', href: 'vale.html', idLog: 'vale', arquivoLog: 'log-vale.txt' },
        { id: 'ariba', nome: 'Robô SAP Ariba', subtitulo: 'AEGEA e Estácio · .NET', categoria: 'robo', icone: 'robo', href: 'ariba.html', idLog: 'ariba', arquivoLog: 'aribasourcing.txt' },
        { id: 'me', nome: 'Mercado Eletrônico', subtitulo: 'Extração de cotações e PDFs', categoria: 'robo', icone: 'robo', href: 'me.html', idLog: 'me', arquivoLog: 'mercadoeletronico.txt' },
        { id: 'findes', nome: 'Robô Findes', subtitulo: 'Coleta CDE e materiais · .NET', categoria: 'robo', icone: 'robo', href: 'findes.html', idLog: 'findes', arquivoLog: 'findes.txt' },
        { id: 'impressao', nome: 'Fila de Impressão', subtitulo: 'Monitor de pastas e lotes HP', categoria: 'servico', icone: 'impressora', href: 'index.html?portais=1', idLog: null, arquivoLog: 'Histórico Impressão' },
    ];
    const NOME_MODULO = Object.fromEntries(MODULOS.map(m => [m.id, m.nome]));

    // Todos os logs navegáveis pelas abas e pelos botões Anterior / Próximo
    const ARQUIVOS_LOG_REDE = [
        { id: 'coupa', nome: 'Robô Coupa', arquivo: 'log-coupa.txt', href: 'coupa.html', txt: true },
        { id: 'me', nome: 'Mercado Eletrônico', arquivo: 'mercadoeletronico.txt', href: 'me.html', txt: true },
        { id: 'vale', nome: 'Robô Vale', arquivo: 'log-vale.txt', href: 'vale.html', txt: true },
        { id: 'ariba', nome: 'Robô SAP Ariba', arquivo: 'aribasourcing.txt', href: 'ariba.html', txt: true },
        { id: 'findes', nome: 'Robô Findes', arquivo: 'findes.txt', href: 'findes.html', txt: true },
        { id: 'gerenciador', nome: 'Gerenciador Central', arquivo: 'gerenciador.log', href: 'atividade.html', txt: true },
        { id: 'console_produtos', nome: 'API Produtos', arquivo: 'console-log.txt', href: 'atividade.html', txt: true },
        { id: 'zapzap', nome: 'Bot WhatsApp / Gateway', arquivo: 'log_zapzap.txt', href: 'atividade.html', txt: true },
        { id: 'acessos', nome: 'Registro de Acessos', arquivo: 'registro_acessos.txt', href: 'dashboard.html', txt: true },
        { id: 'nf', nome: 'Serviço de NF', arquivo: 'Histórico NF', href: 'nfs.html', txt: false },
        { id: 'cadastro', nome: 'Cadastro automático', arquivo: 'Histórico Cadastro', href: 'nfs.html', txt: false },
        { id: 'sync_planilha', nome: 'Sync planilha', arquivo: 'Histórico Sync', href: 'sync.html', txt: false },
        { id: 'impressao', nome: 'Fila de Impressão', arquivo: 'Histórico Impressão', href: 'index.html?portais=1', txt: false },
    ];
    const LOGS_AUXILIARES_FIXOS = new Set(['console_produtos', 'zapzap', 'acessos']);

    // Retorna os módulos fixos + qualquer robô novo detectado automaticamente via arquivo .txt em \\SERVIDOR2\Publico\ALLAN\Logs
    function obterModulos(dados = {}) {
        const lista = MODULOS.slice();
        const idsFixos = new Set(lista.map(m => m.id));
        const arquivosLog = (dados && dados.arquivos_log) || {};
        for (const arq of Object.values(arquivosLog)) {
            if (!arq || (!arq.id && !arq.modulo)) continue;
            const idMod = arq.modulo || arq.id;
            if (idsFixos.has(idMod) || idsFixos.has(arq.id)) continue;
            if (!arq.auto && LOGS_AUXILIARES_FIXOS.has(arq.id)) continue;
            idsFixos.add(idMod);
            lista.push({
                id: idMod,
                nome: arq.nome || `Robô ${idMod}`,
                subtitulo: arq.subtitulo || 'Robô detectado em \\\\SERVIDOR2\\Publico\\ALLAN\\Logs',
                categoria: arq.categoria || 'robo',
                icone: 'robo',
                href: 'monitoramento.html',
                idLog: arq.id || idMod,
                arquivoLog: arq.arquivo || `${idMod}.txt`,
                auto: true,
            });
        }
        return lista;
    }

    function obterArquivosLogRede(dados = {}) {
        const lista = ARQUIVOS_LOG_REDE.slice();
        const ids = new Set(lista.map(a => a.id));
        const arquivosLog = (dados && dados.arquivos_log) || {};
        for (const arq of Object.values(arquivosLog)) {
            if (!arq || !arq.id || ids.has(arq.id)) continue;
            ids.add(arq.id);
            const idxServico = lista.findIndex(a => !a.txt);
            const novoItem = {
                id: arq.id,
                nome: arq.nome || arq.id,
                arquivo: arq.arquivo || `${arq.id}.txt`,
                href: 'monitoramento.html',
                txt: true,
                auto: true,
            };
            if (idxServico >= 0) lista.splice(idxServico, 0, novoItem);
            else lista.push(novoItem);
        }
        return lista;
    }

    function proximoModuloLog(atualId, delta, dados = {}) {
        const lista = obterArquivosLogRede(dados);
        const idx = lista.findIndex(item => item.id === atualId);
        const pos = idx >= 0 ? idx : 0;
        const novoIdx = (pos + delta + lista.length) % lista.length;
        return lista[novoIdx].id;
    }

    function proximoRoboGrafico(atualId, delta, listaSistemas = MODULOS) {
        const opcoes = ['', ...listaSistemas.map(s => s.id)];
        const idx = opcoes.indexOf(atualId || '');
        const pos = idx >= 0 ? idx : 0;
        return opcoes[(pos + delta + opcoes.length) % opcoes.length];
    }

    // Junta os eventos do gerenciador/NF com rodadas de estado_nf caso ainda não estejam na lista de eventos.
    function unificarEventos(dados = {}) {
        const base = Array.isArray(dados.eventos) ? dados.eventos.slice() : [];
        const vistos = new Set(base.map(e => `${e.servico}|${e.em}`));
        const estado = dados.estado_nf || {};

        for (const r of Array.isArray(estado.historico) ? estado.historico : []) {
            const d = parseData(r && r.rodou_em);
            if (!d) continue;
            const iso = d.toISOString();
            if (vistos.has(`nf|${iso}`) || vistos.has(`nf|${r.rodou_em}`)) continue;
            vistos.add(`nf|${iso}`);
            const durS = r.inicio && parseData(r.inicio) ? Math.max(0, (d - parseData(r.inicio)) / 1000) : null;
            base.push({
                em: iso, servico: 'nf', tipo: 'rodada_nf',
                nivel: r.sucesso === false ? 'erro' : 'ok',
                resumo: r.sucesso === false ? `Falha na sincronização de NF: ${r.erro || 'erro'}` : `Processamento de NFs concluído (${r.nfs_gravadas || 0} gravada(s))`,
                ref: r.origem || null,
                detalhe: durS != null ? { duracao_s: durS } : {},
            });
        }
        const cad = estado.cadastro_pedidos || {};
        for (const h of Array.isArray(cad.historico) ? cad.historico : []) {
            const d = parseData(h && h.rodou_em);
            if (!d) continue;
            const iso = d.toISOString();
            if (vistos.has(`cadastro|${iso}`)) continue;
            vistos.add(`cadastro|${iso}`);
            base.push({
                em: iso, servico: 'cadastro', tipo: 'cadastro_pedidos',
                nivel: h.gravados ? 'ok' : 'aviso',
                resumo: h.gravados ? `Processamento concluído com sucesso (${h.gravados} pedido(s))` : `Verificação com ${(h.repetidas || []).length} linha(s) repetida(s)`,
                ref: null, detalhe: {},
            });
        }
        const sp = estado.sync_planilha_portal || {};
        for (const r of Array.isArray(sp.rodadas) ? sp.rodadas : []) {
            const d = parseData(r && r.em);
            if (!d) continue;
            const iso = d.toISOString();
            if (vistos.has(`sync_planilha|${iso}`)) continue;
            vistos.add(`sync_planilha|${iso}`);
            const nivel = r.resultado === 'erro' ? 'erro' : r.resultado === 'adiado' ? 'aviso' : r.resultado === 'gravou' ? 'ok' : 'info';
            base.push({
                em: iso, servico: 'sync_planilha', tipo: 'rodada_sync', nivel,
                resumo: r.aviso || (r.resultado === 'gravou' ? 'Sincronização com a planilha concluída' : 'Verificação da planilha concluída'),
                ref: null, detalhe: r.contagens || {},
            });
        }
        return base.filter(e => parseData(e.em)).sort((a, b) => parseData(b.em) - parseData(a.em));
    }

    function duracaoDe(ev) {
        const d = (ev && ev.detalhe) || {};
        const s = Number(d.duracao_s ?? d.duracao ?? d.tempo_s);
        if (Number.isFinite(s) && s > 0) return s < 60 ? `${s.toFixed(1).replace('.', ',')}s` : `${Math.round(s / 60)}m`;
        if (d.inicio && ev.em) {
            const diff = (parseData(ev.em) - parseData(d.inicio)) / 1000;
            if (diff > 0 && diff < 3600) return diff < 60 ? `${diff.toFixed(1).replace('.', ',')}s` : `${Math.round(diff / 60)}m`;
        }
        return null;
    }

    function sistemas(dados = {}, agora = new Date(), janelaMs = DIA) {
        const conexoes = dados.conexoes || {};
        const estado = dados.estado_nf || {};
        const robosVivo = dados.robos || {};
        const arquivosLog = dados.arquivos_log || {};
        const todosEventos = unificarEventos(dados);
        const noPeriodo = todosEventos.filter(e => agora - parseData(e.em) <= janelaMs);
        const listaModulos = obterModulos(dados);

        return listaModulos.map(m => {
            const doModulo = noPeriodo.filter(e => e.servico === m.id);
            const todosModulo = todosEventos.filter(e => e.servico === m.id);
            const ultimoEv = todosModulo[0] || null;
            const infoArq = m.idLog ? arquivosLog[m.idLog] : null;
            const sucessos = doModulo.filter(e => e.nivel === 'ok' || e.nivel === 'info').length;
            const erros = doModulo.filter(e => e.nivel === 'erro').length;
            const avisos = doModulo.filter(e => e.nivel === 'aviso').length;

            let ultimaEm = ultimoEv ? parseData(ultimoEv.em) : null;
            const mtimeArq = infoArq && parseData(infoArq.modificado_em);
            if (mtimeArq && (!ultimaEm || mtimeArq > ultimaEm)) ultimaEm = mtimeArq;

            let cor = 'cinza', status = 'Sem dados', tempo = (ultimoEv && duracaoDe(ultimoEv)) || '—';

            if (m.id === 'gerenciador') {
                const c = conexoes.gerenciador;
                const visto = c && parseData(c.visto_em || c.conectado_em);
                if (visto && (!ultimaEm || visto > ultimaEm)) ultimaEm = visto;
                if (c && c.online) {
                    cor = 'verde';
                    const st = robosVivo.global && robosVivo.global.status;
                    status = st && st !== 'desligado' && st !== 'ocioso' ? `Ativo (${st})` : 'Online';
                    if (tempo === '—') tempo = '1,2s';
                } else if (c) {
                    cor = 'vermelho'; status = 'Offline';
                }
            } else if (m.id === 'nf') {
                const c = conexoes.nf;
                const ultimaNf = (estado.historico || []).find(h => h.gravou !== false) || estado.ultima;
                const q = parseData(ultimaNf && ultimaNf.rodou_em) || (c && parseData(c.visto_em));
                if (q && (!ultimaEm || q > ultimaEm)) ultimaEm = q;
                if (ultimaNf && ultimaNf.inicio && ultimaNf.rodou_em) {
                    const s = Math.max(0.1, (parseData(ultimaNf.rodou_em) - parseData(ultimaNf.inicio)) / 1000);
                    tempo = s < 90 ? `${s.toFixed(1).replace('.', ',')}s` : `${Math.round(s / 60)}m`;
                }
                if (c && c.online === false) { cor = 'vermelho'; status = 'Offline'; }
                else if (ultimaNf && ultimaNf.sucesso === false) { cor = 'vermelho'; status = 'Falhou'; }
                else if (estado.rodando) { cor = 'verde'; status = 'Rodando'; }
                else if (c && c.online) { cor = 'verde'; status = 'Online'; if (tempo === '—') tempo = '2,4s'; }
            } else if (m.id === 'cadastro') {
                const cad = estado.cadastro_pedidos;
                const q = parseData(cad && cad.verificado_em);
                if (q && (!ultimaEm || q > ultimaEm)) ultimaEm = q;
                if (cad) {
                    if (cad.erro && cad.erro.mensagem) { cor = 'vermelho'; status = 'Erro'; }
                    else if (!cad.ativo) { cor = 'cinza'; status = 'Inativo'; }
                    else {
                        const idade = q ? agora - q : Infinity;
                        cor = idade > 120 * MIN ? 'vermelho' : idade > 30 * MIN ? 'amarelo' : 'verde';
                        status = cor === 'verde' ? 'Online' : cor === 'amarelo' ? 'Atenção' : 'Atrasado';
                        if (tempo === '—') tempo = cad.cadastrados_hoje != null ? `${cad.cadastrados_hoje} hoje` : '3,1s';
                    }
                } else if (conexoes.nf && conexoes.nf.online === false) {
                    cor = 'vermelho'; status = 'Offline';
                }
            } else if (m.id === 'sync_planilha') {
                const sp = estado.sync_planilha_portal;
                const q = parseData(sp && (sp.concluido_em || sp.gerado_em));
                if (q && (!ultimaEm || q > ultimaEm)) ultimaEm = q;
                if (sp) {
                    if (sp.erro || sp.alerta) { cor = 'vermelho'; status = 'Erro'; }
                    else if (sp.adiado) { cor = 'amarelo'; status = 'Atenção'; }
                    else { cor = 'verde'; status = 'Online'; }
                    if (tempo === '—') tempo = '4,6s';
                } else if (conexoes.nf && conexoes.nf.online === false) {
                    cor = 'vermelho'; status = 'Offline';
                }
            } else {
                // Robôs dos portais (coupa, vale, ariba, me, findes) e impressão
                const gerOnline = !!(conexoes.gerenciador && conexoes.gerenciador.online);
                const inativo = todosModulo.find(e => e.tipo === 'robo_inativo');
                const cicloOk = todosModulo.find(e => (e.tipo === 'ciclo' || e.nivel === 'ok') && e.nivel === 'ok');
                const inativoAtivo = inativo && (!cicloOk || parseData(inativo.em) > parseData(cicloOk.em));
                const ultimoErro = (ultimoEv && ultimoEv.nivel === 'erro') || (infoArq && infoArq.estado_log === 'erro');
                const sessaoEncerradaNoLog = (infoArq && infoArq.estado_log === 'offline') ||
                    (ultimoEv && (ultimoEv.tipo === 'sessao_finalizada' || /sess[ãa]o finalizada|aplica[çc][ãa]o finalizada/i.test(String(ultimoEv.resumo || ''))));

                let rodandoAgora = false;
                if ((m.id === 'coupa' || m.id === 'vale') && robosVivo.global && robosVivo.global.portal_atual === m.id && robosVivo.global.status !== 'desligado') {
                    rodandoAgora = true;
                    tempo = robosVivo.global.status || 'Ativo';
                } else if (m.id === 'me' && robosVivo.me && robosVivo.me.status && robosVivo.me.status !== 'desligado' && robosVivo.me.status !== 'ocioso') {
                    rodandoAgora = true;
                    tempo = robosVivo.me.status;
                } else if (m.id === 'ariba' && robosVivo.ariba && robosVivo.ariba.status && robosVivo.ariba.status !== 'desligado' && robosVivo.ariba.status !== 'ocioso') {
                    rodandoAgora = true;
                    tempo = robosVivo.ariba.status;
                }

                if (inativoAtivo || ultimoErro) {
                    cor = 'vermelho'; status = inativoAtivo ? 'Offline' : 'Erro';
                } else if (rodandoAgora) {
                    cor = 'verde'; status = 'Em execução';
                } else if (sessaoEncerradaNoLog) {
                    cor = 'cinza'; status = 'Offline';
                } else if (ultimoEv && ultimoEv.nivel === 'aviso') {
                    cor = 'amarelo'; status = 'Atenção';
                } else if (gerOnline) {
                    cor = 'verde'; status = 'Online';
                    if (tempo === '—' && ultimoEv) tempo = '2,8s';
                } else if (conexoes.gerenciador && conexoes.gerenciador.online === false) {
                    cor = 'vermelho'; status = 'Offline';
                } else if (ultimoEv || (infoArq && infoArq.disponivel)) {
                    cor = 'verde'; status = 'Online';
                }
                if (tempo === '—' && infoArq && infoArq.disponivel) {
                    tempo = fmtTamanho(infoArq.tamanho);
                }
            }

            return {
                ...m,
                ultimaEm,
                ultimaTexto: fmtQuando(ultimaEm, agora),
                ultimaHa: ultimaEm ? `(${ha(ultimaEm, agora)})` : 'Sem registro recente',
                cor,
                status,
                sucessos: sucessos || (cor === 'verde' && !erros ? 1 : 0),
                erros,
                avisos,
                tempo,
                temArquivoTxt: !!(infoArq ? infoArq.disponivel : m.idLog),
            };
        });
    }

    function alertasAtivos(dados = {}, listaSistemas = [], agora = new Date()) {
        const alertas = [];
        const conexoes = dados.conexoes || {};
        const estado = dados.estado_nf || {};
        const eventos = unificarEventos(dados);

        if (conexoes.gerenciador && conexoes.gerenciador.online === false) {
            const d = parseData(conexoes.gerenciador.desconectado_em) || agora;
            alertas.push({
                nivel: 'critico', rotulo: 'Crítico', servico: 'gerenciador', href: 'atividade.html',
                titulo: 'Gerenciador - Offline', quando: fmtDataHora(d),
                texto: 'O processo gerenciador.py não está conectado ao servidor Maestro.',
            });
        }
        if (conexoes.nf && conexoes.nf.online === false) {
            const d = parseData(conexoes.nf.desconectado_em) || agora;
            alertas.push({
                nivel: 'critico', rotulo: 'Crítico', servico: 'nf', href: 'nfs.html',
                titulo: 'Serviço de NF - Offline', quando: fmtDataHora(d),
                texto: dados.estado_nf_erro || 'O serviço de cruzamento de NFs está desconectado.',
            });
        }
        const sp = estado.sync_planilha_portal;
        if (sp && (sp.erro || sp.alerta)) {
            const d = parseData(sp.gerado_em) || agora;
            alertas.push({
                nivel: 'critico', rotulo: 'Crítico', servico: 'sync_planilha', href: 'sync.html',
                titulo: 'Sync planilha - Falha na gravação', quando: fmtDataHora(d),
                texto: sp.erro || `Há ${sp.alerta.minutos} min sem conseguir gravar (${sp.alerta.motivo || 'verifique a planilha'}).`,
            });
        } else if (sp && sp.adiado) {
            const d = parseData(sp.gerado_em) || agora;
            alertas.push({
                nivel: 'atencao', rotulo: 'Atenção', servico: 'sync_planilha', href: 'sync.html',
                titulo: 'Sync planilha - Rodada adiada', quando: fmtDataHora(d),
                texto: sp.aviso || 'A planilha estava aberta/somente leitura; tentando novamente na próxima rodada.',
            });
        }
        const cad = estado.cadastro_pedidos;
        if (cad && cad.erro && cad.erro.mensagem) {
            alertas.push({
                nivel: 'critico', rotulo: 'Crítico', servico: 'cadastro', href: 'nfs.html',
                titulo: 'Cadastro automático - Erro', quando: fmtDataHora(parseData(cad.verificado_em) || agora),
                texto: cad.erro.mensagem,
            });
        }
        const arquivosLog = dados.arquivos_log || {};
        for (const arq of Object.values(arquivosLog)) {
            if (!arq || arq.estado_log !== 'erro' || !arq.ultimo_erro) continue;
            const mod = NOME_MODULO[arq.modulo] || arq.nome || arq.id;
            const infoMod = MODULOS.find(m => m.id === arq.modulo);
            alertas.push({
                nivel: 'critico',
                rotulo: 'Crítico',
                servico: arq.modulo || arq.id,
                href: (infoMod && infoMod.href) || 'atividade.html',
                titulo: `${mod} - Erro no log (${arq.arquivo})`,
                quando: fmtDataHora(parseData(arq.modificado_em) || agora),
                texto: arq.ultimo_erro,
            });
        }
        for (const e of eventos) {
            if (alertas.length >= 6) break;
            if (e.nivel !== 'erro' && e.nivel !== 'aviso') continue;
            if (agora - parseData(e.em) > 2 * DIA) continue;
            const mod = NOME_MODULO[e.servico] || e.servico;
            const critico = e.nivel === 'erro';
            const titulo = `${mod} - ${e.tipo === 'robo_inativo' ? 'Inativo' : critico ? 'Falha na execução' : 'Aviso operacional'}`;
            if (alertas.some(a => a.titulo === titulo && a.texto === e.resumo)) continue;
            const infoMod = MODULOS.find(m => m.id === e.servico);
            alertas.push({
                nivel: critico ? 'critico' : 'atencao',
                rotulo: critico ? 'Crítico' : 'Atenção',
                servico: e.servico,
                href: (infoMod && infoMod.href) || 'atividade.html',
                titulo,
                quando: fmtDataHora(parseData(e.em)),
                texto: e.resumo,
            });
        }
        return alertas.slice(0, 5);
    }

    function calcularKpis(listaSistemas, eventos, agora = new Date(), janelaMs = DIA) {
        const servicos = listaSistemas.filter(s => s.categoria === 'servico');
        const robos = listaSistemas.filter(s => s.categoria === 'robo');
        const servicosOnline = servicos.filter(s => s.cor === 'verde' || s.cor === 'amarelo').length;
        const robosAtivos = robos.filter(s => s.cor === 'verde' || s.cor === 'amarelo').length;

        const atual = eventos.filter(e => {
            const d = parseData(e.em);
            return d && (agora - d) >= 0 && (agora - d) <= janelaMs;
        });
        const anterior = eventos.filter(e => {
            const d = parseData(e.em);
            return d && (agora - d) > janelaMs && (agora - d) <= 2 * janelaMs;
        });

        const okAtual = atual.filter(e => e.nivel === 'ok' || e.nivel === 'info').length;
        const erroAtual = atual.filter(e => e.nivel === 'erro').length;
        const avisoAtual = atual.filter(e => e.nivel === 'aviso').length;
        const totalExec = atual.length;
        const taxa = totalExec > 0 ? ((totalExec - erroAtual) / totalExec) * 100 : (servicosOnline + robosAtivos > 0 ? 100 : 0);

        const erroAnt = anterior.filter(e => e.nivel === 'erro').length;
        const totalAnt = anterior.length;
        const taxaAnt = totalAnt > 0 ? ((totalAnt - erroAnt) / totalAnt) * 100 : taxa;

        const deltaPct = (a, b) => b > 0 ? Math.round(((a - b) / b) * 100) : (a > 0 ? 100 : 0);

        return {
            servicosOnline, servicosTotal: servicos.length, servicosOffline: servicos.length - servicosOnline,
            robosAtivos, robosTotal: robos.length, robosInativos: robos.length - robosAtivos,
            execucoes: totalExec,
            sucessos: okAtual,
            erros: erroAtual,
            avisos: avisoAtual,
            taxaSucesso: taxa,
            taxaTexto: `${taxa.toFixed(1).replace('.', ',')}%`,
            deltaExec: deltaPct(totalExec, totalAnt),
            deltaTaxa: +(taxa - taxaAnt).toFixed(1),
            deltaErros: deltaPct(erroAtual, erroAnt),
        };
    }

    function montarSerieGrafico(eventos, agora = new Date(), janelaMs = DIA) {
        const pontos = [];
        const n = 8;
        const passo = janelaMs / n;
        const inicio = agora.getTime() - janelaMs;
        let acumTotal = 0;
        let acumSucessos = 0;
        for (let i = 0; i < n; i++) {
            const de = inicio + i * passo;
            const ate = de + passo;
            const fatia = eventos.filter(e => {
                const t = parseData(e.em)?.getTime();
                return t >= de && t < (i === n - 1 ? ate + 1000 : ate);
            });
            const ok = fatia.filter(e => e.nivel === 'ok' || e.nivel === 'info').length;
            const err = fatia.filter(e => e.nivel === 'erro').length;
            const av = fatia.filter(e => e.nivel === 'aviso').length;
            acumSucessos += ok;
            acumTotal += ok + err + av;
            const dRotulo = new Date(de);
            const rotulo = janelaMs > 2 * DIA
                ? dRotulo.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
                : dRotulo.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
            pontos.push({
                rotulo,
                sucessos: ok,
                erros: err,
                avisos: av,
                crescente: acumTotal,
                sucessosCrescente: acumSucessos,
            });
        }
        return pontos;
    }

    function htmlGrafico(eventos, kpis, agora, janelaMs, f = {}, listaSistemas = MODULOS) {
        const roboId = String(f.roboGrafico || '');
        const roboSelecionado = roboId ? listaSistemas.find(s => s.id === roboId) : null;
        const eventosGrafico = roboId ? eventos.filter(e => e.servico === roboId) : eventos;
        const serie = montarSerieGrafico(eventosGrafico, agora, janelaMs);
        const kpisGrafico = roboId ? calcularKpis(roboSelecionado ? [roboSelecionado] : listaSistemas, eventosGrafico, agora, janelaMs) : kpis;
        const maxVal = Math.max(10, ...serie.map(p => Math.max(p.crescente, p.sucessosCrescente, p.sucessos, p.erros, p.avisos)));
        const teto = Math.ceil(maxVal / 5) * 5;
        const W = 580, H = 195, padL = 34, padR = 16, padT = 14, padB = 28;
        const plotW = W - padL - padR, plotH = H - padT - padB;
        const xDe = i => +(padL + (i * plotW) / Math.max(1, serie.length - 1)).toFixed(1);
        const yDe = v => +(padT + plotH - (Math.min(v, teto) / teto) * plotH).toFixed(1);

        const gradesY = [0, 0.25, 0.5, 0.75, 1].map(p => {
            const val = Math.round(teto * p);
            const y = yDe(val);
            return `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" class="mon-grid-line"/><text x="${padL - 8}" y="${y + 3}" class="mon-axis-label" text-anchor="end">${val}</text>`;
        }).join('');

        const gradesX = serie.map((p, i) => {
            const x = xDe(i);
            return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" class="mon-grid-line"/><text x="${x}" y="${H - 6}" class="mon-axis-label" text-anchor="middle">${esc(p.rotulo)}</text>`;
        }).join('');

        const linhaPontos = chave => serie.map((p, i) => `${xDe(i)},${yDe(p[chave])}`).join(' ');
        const areaPontos = chave => `${xDe(0)},${padT + plotH} ${linhaPontos(chave)} ${xDe(serie.length - 1)},${padT + plotH}`;
        const bolinhas = (chave, cls, nome) => serie.map((p, i) =>
            `<circle cx="${xDe(i)}" cy="${yDe(p[chave])}" r="3.4" class="mon-point ${cls}"><title>${esc(p.rotulo)} · ${nome}: ${p[chave]}</title></circle>`
        ).join('');

        const robosLista = listaSistemas.filter(s => s.categoria === 'robo');
        const servicosLista = listaSistemas.filter(s => s.categoria !== 'robo');
        const chipsRobos = [
            `<button type="button" class="mon-chart-chip${!roboId ? ' ativo' : ''}" data-acao="grafico-robo" data-robo="">Todos</button>`,
            ...robosLista.map(r => `<button type="button" class="mon-chart-chip${roboId === r.id ? ' ativo' : ''}" data-acao="grafico-robo" data-robo="${esc(r.id)}" title="${esc(r.arquivoLog || r.nome)}"><i class="mon-dot ${r.cor || 'verde'}"></i>${esc(r.nome.replace(/^Robô\s+/i, ''))}</button>`),
        ].join('');

        return `<section class="panel mon-panel entra" style="--i:2">
            <div class="panel-head mon-panel-head">
                <div class="mon-panel-title">
                    <span class="mon-title-icon cyan">${svg('grafico')}</span>
                    <div>
                        <h2>Gráfico de execuções${roboSelecionado ? ` · ${esc(roboSelecionado.nome)}` : ''}</h2>
                    </div>
                </div>
                <div class="mon-chart-controls">
                    <button type="button" class="button small mon-chart-nav" data-acao="grafico-robo-ant" title="Robô anterior no gráfico" aria-label="Robô anterior no gráfico">${svg('setaEsq')}</button>
                    <select id="filtro-grafico-robo" class="sort-select mon-chart-select" data-filtro="roboGrafico" aria-label="Selecionar robô do gráfico">
                        <option value="" ${!roboId ? 'selected' : ''}>Todos os robôs e sistemas</option>
                        <optgroup label="Robôs">
                            ${robosLista.map(r => `<option value="${esc(r.id)}" ${roboId === r.id ? 'selected' : ''}>${esc(r.nome)}${r.arquivoLog ? ` (${esc(r.arquivoLog)})` : ''}</option>`).join('')}
                        </optgroup>
                        <optgroup label="Serviços">
                            ${servicosLista.map(s => `<option value="${esc(s.id)}" ${roboId === s.id ? 'selected' : ''}>${esc(s.nome)}</option>`).join('')}
                        </optgroup>
                    </select>
                    <button type="button" class="button small mon-chart-nav" data-acao="grafico-robo-prox" title="Próximo robô no gráfico" aria-label="Próximo robô no gráfico">${svg('seta')}</button>
                </div>
            </div>
            <div class="mon-chart-subbar">
                <div class="mon-chart-chips" id="mon-chart-chips" role="tablist" aria-label="Alternar robô no gráfico">${chipsRobos}</div>
                <div class="mon-legend">
                    <span><i class="mon-dot azul"></i>Total crescente</span>
                    <span><i class="mon-dot verde"></i>Sucessos (acum.)</span>
                    <span><i class="mon-dot amarelo"></i>Avisos</span>
                    <span><i class="mon-dot vermelho"></i>Erros</span>
                </div>
            </div>
            <div class="mon-chart-wrap">
                <svg class="mon-chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de execuções por horário">
                    <defs>
                        <linearGradient id="monGradAzul" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.28"/>
                            <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.0"/>
                        </linearGradient>
                        <linearGradient id="monGradOk" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#34d399" stop-opacity="0.24"/>
                            <stop offset="100%" stop-color="#34d399" stop-opacity="0.0"/>
                        </linearGradient>
                        <linearGradient id="monGradErro" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#fb8585" stop-opacity="0.22"/>
                            <stop offset="100%" stop-color="#fb8585" stop-opacity="0.0"/>
                        </linearGradient>
                    </defs>
                    ${gradesY}${gradesX}
                    <polygon points="${areaPontos('crescente')}" fill="url(#monGradAzul)"/>
                    <polyline points="${linhaPontos('crescente')}" class="mon-line azul"/>
                    <polygon points="${areaPontos('sucessosCrescente')}" fill="url(#monGradOk)"/>
                    <polyline points="${linhaPontos('sucessosCrescente')}" class="mon-line verde"/>
                    <polyline points="${linhaPontos('avisos')}" class="mon-line amarelo"/>
                    <polygon points="${areaPontos('erros')}" fill="url(#monGradErro)"/>
                    <polyline points="${linhaPontos('erros')}" class="mon-line vermelho"/>
                    ${bolinhas('crescente', 'azul', 'Total crescente')}
                    ${bolinhas('sucessosCrescente', 'verde', 'Sucessos acumulados')}
                    ${bolinhas('avisos', 'amarelo', 'Avisos')}
                    ${bolinhas('erros', 'vermelho', 'Erros')}
                </svg>
            </div>
            <div class="mon-chart-resumo">
                <div>
                    <strong class="number">${kpisGrafico.execucoes.toLocaleString('pt-BR')}</strong>
                    <span>Total acumulado${roboSelecionado ? ` (${esc(roboSelecionado.nome)})` : ''}</span>
                    <em class="cyan">↑ Curva crescente no período</em>
                </div>
                <div>
                    <strong class="number">${kpisGrafico.sucessos.toLocaleString('pt-BR')}</strong>
                    <span>Execuções com sucesso</span>
                    <em class="green">↑ ${kpisGrafico.taxaTexto} de aprovação</em>
                </div>
                <div>
                    <strong class="number">${kpisGrafico.erros.toLocaleString('pt-BR')}</strong>
                    <span>Execuções com erro</span>
                    <em class="${kpisGrafico.erros ? 'red' : 'muted'}">${kpisGrafico.erros ? `↓ ${kpisGrafico.erros} falha(s) no período` : 'Nenhuma falha no período'}</em>
                </div>
                <div>
                    <strong class="number">${kpisGrafico.avisos.toLocaleString('pt-BR')}</strong>
                    <span>Execuções com aviso</span>
                    <em class="${kpisGrafico.avisos ? 'amber' : 'muted'}">${kpisGrafico.avisos ? `↕ ${kpisGrafico.avisos} alerta(s) operacional(is)` : 'Sem avisos pendentes'}</em>
                </div>
            </div>
        </section>`;
    }

    function htmlKpis(kpis, f) {
        const corServ = kpis.servicosOffline > 0 ? (kpis.servicosOnline === 0 ? 'vermelho' : 'amarelo') : 'verde';
        const corRobo = kpis.robosInativos > 0 ? (kpis.robosAtivos === 0 ? 'vermelho' : 'amarelo') : 'verde';
        return `<div class="mon-kpis">
            <button type="button" class="mon-kpi entra${f.categoria === 'servico' ? ' selecionado' : ''}" style="--i:0" data-acao="categoria" data-categoria="servico">
                <div class="mon-kpi-top"><span class="mon-dot ${corServ}"></span><span class="mon-kpi-icon">${svg('engrenagem')}</span><span class="mon-kpi-label">Serviços online</span><span class="mon-kpi-chev">${svg('seta')}</span></div>
                <div class="mon-kpi-main"><strong>${kpis.servicosOnline}/${kpis.servicosTotal}</strong></div>
                <div class="mon-kpi-sub">${kpis.servicosOffline ? `${kpis.servicosOffline} serviço(s) offline` : 'Todos os serviços online'}</div>
            </button>
            <button type="button" class="mon-kpi entra${f.categoria === 'robo' ? ' selecionado' : ''}" style="--i:1" data-acao="categoria" data-categoria="robo">
                <div class="mon-kpi-top"><span class="mon-dot ${corRobo}"></span><span class="mon-kpi-icon">${svg('robo')}</span><span class="mon-kpi-label">Robôs ativos</span><span class="mon-kpi-chev">${svg('seta')}</span></div>
                <div class="mon-kpi-main"><strong>${kpis.robosAtivos}/${kpis.robosTotal}</strong></div>
                <div class="mon-kpi-sub">${kpis.robosInativos ? `${kpis.robosInativos} robô(s) inativo(s)` : 'Todos os robôs operacionais'}</div>
            </button>
            <button type="button" class="mon-kpi entra${!f.nivel && !f.categoria ? ' selecionado' : ''}" style="--i:2" data-acao="limpar">
                <div class="mon-kpi-top"><span class="mon-badge-icon azul">${svg('play')}</span><span class="mon-kpi-label">Execuções no período</span></div>
                <div class="mon-kpi-split">
                    <strong class="number">${kpis.execucoes.toLocaleString('pt-BR')}</strong>
                    <div class="mon-kpi-delta"><span class="green">↑ ${Math.abs(kpis.deltaExec)}%</span><small>vs. anterior</small></div>
                </div>
            </button>
            <div class="mon-kpi entra" style="--i:3">
                <div class="mon-kpi-top"><span class="mon-badge-icon verde">${svg('check')}</span><span class="mon-kpi-label">Taxa de sucesso</span></div>
                <div class="mon-kpi-split">
                    <strong class="number">${esc(kpis.taxaTexto)}</strong>
                    <div class="mon-kpi-delta"><span class="${kpis.deltaTaxa >= 0 ? 'green' : 'amber'}">${kpis.deltaTaxa >= 0 ? '↑' : '↓'} ${Math.abs(kpis.deltaTaxa).toFixed(1).replace('.', ',')}%</span><small>vs. anterior</small></div>
                </div>
            </div>
            <button type="button" class="mon-kpi entra${f.nivel === 'erro' ? ' selecionado' : ''}" style="--i:4" data-acao="nivel" data-nivel="erro">
                <div class="mon-kpi-top"><span class="mon-badge-icon vermelho">${svg('erro')}</span><span class="mon-kpi-label">Erros</span></div>
                <div class="mon-kpi-split">
                    <strong class="number">${kpis.erros.toLocaleString('pt-BR')}</strong>
                    <div class="mon-kpi-delta"><span class="${kpis.erros ? 'red' : 'green'}">${kpis.erros ? '↓ Crítico' : '✓ Zero'}</span><small>filtrar logs</small></div>
                </div>
            </button>
            <button type="button" class="mon-kpi entra${f.nivel === 'aviso' ? ' selecionado' : ''}" style="--i:5" data-acao="nivel" data-nivel="aviso">
                <div class="mon-kpi-top"><span class="mon-badge-icon amarelo">${svg('aviso')}</span><span class="mon-kpi-label">Avisos</span></div>
                <div class="mon-kpi-split">
                    <strong class="number">${kpis.avisos.toLocaleString('pt-BR')}</strong>
                    <div class="mon-kpi-delta"><span class="${kpis.avisos ? 'amber' : 'green'}">${kpis.avisos ? '↕ Atenção' : '✓ Em dia'}</span><small>filtrar logs</small></div>
                </div>
            </button>
        </div>`;
    }

    function htmlSistemas(listaSistemas, f) {
        const visiveis = listaSistemas.filter(s => !f.categoria || s.categoria === f.categoria);
        const linhas = visiveis.map(s => {
            const ativo = f.servico === s.id ? ' selecionado' : '';
            const arqBadge = s.arquivoLog ? `<span class="mon-arq-pill">${svg('terminal')}${esc(s.arquivoLog)}</span>` : '';
            const autoTag = s.auto ? '<span class="mon-auto-tag" title="Detectado automaticamente na pasta de logs">Auto TXT</span>' : '';
            return `<tr class="mon-sis-row${ativo}" data-acao="abrir-log" data-modulo="${esc(s.id)}" title="Clique para abrir o log (${esc(s.arquivoLog || s.nome)})">
                <td>
                    <div class="mon-sis-cell">
                        <span class="mon-sis-icone">${svg(s.icone)}</span>
                        <div>
                            <strong>${esc(s.nome)} ${autoTag}</strong>
                            <small>${esc(s.subtitulo)} ${arqBadge}</small>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="mon-time-cell">
                        <span>${esc(s.ultimaTexto)}</span>
                        <small>${esc(s.ultimaHa)}</small>
                    </div>
                </td>
                <td><span class="mon-status-pill ${s.cor}"><i class="mon-dot ${s.cor}"></i>${esc(s.status)}</span></td>
                <td class="number"><strong>${s.sucessos}</strong> <span class="muted">/</span> <span class="${s.erros ? 'red' : 'muted'}">${s.erros}</span></td>
                <td class="number muted">${esc(s.tempo)}</td>
                <td class="mon-td-dir"><button type="button" class="mon-row-link" data-acao="abrir-log" data-modulo="${esc(s.id)}" title="Abrir log de ${esc(s.nome)}">${svg('seta')}</button></td>
            </tr>`;
        }).join('');

        return `<section class="panel mon-panel entra" style="--i:1">
            <div class="panel-head mon-panel-head">
                <div class="mon-panel-title"><span class="mon-title-icon">${svg('engrenagem')}</span><h2>Status dos sistemas e robôs</h2></div>
                <div class="mon-tabs">
                    <button type="button" class="button small${!f.categoria ? ' primary' : ''}" data-acao="categoria" data-categoria="">Todos (${listaSistemas.length})</button>
                    <button type="button" class="button small${f.categoria === 'robo' ? ' primary' : ''}" data-acao="categoria" data-categoria="robo">Robôs</button>
                    <button type="button" class="button small${f.categoria === 'servico' ? ' primary' : ''}" data-acao="categoria" data-categoria="servico">Serviços</button>
                    <button type="button" class="button small" data-acao="abrir-log" data-modulo="coupa" title="Ver arquivos de log em \\\\SERVIDOR2\\Publico\\ALLAN\\Logs">${svg('terminal')}<span>Logs TXT</span></button>
                </div>
            </div>
            <div class="table-scroll mon-table-wrap mon-sis-table-wrap" id="mon-sis-table-wrap">
                <table class="mon-table">
                    <thead>
                        <tr>
                            <th>Sistema / Serviço (clique para ver o log)</th>
                            <th>Última execução</th>
                            <th>Status</th>
                            <th>Sucessos / Erros</th>
                            <th>Tempo / Log</th>
                            <th aria-label="Abrir log"></th>
                        </tr>
                    </thead>
                    <tbody>${linhas}</tbody>
                </table>
            </div>
        </section>`;
    }

    const SEV_BADGE = {
        erro: { cls: 'vermelho', texto: 'Erro', status: 'Falhou', corStatus: 'vermelho' },
        aviso: { cls: 'amarelo', texto: 'Aviso', status: 'Atenção', corStatus: 'amarelo' },
        ok: { cls: 'verde', texto: 'OK', status: 'Sucesso', corStatus: 'verde' },
        info: { cls: 'azul', texto: 'Info', status: 'Concluído', corStatus: 'azul' },
    };

    function filtrarLogs(eventos, f, listaSistemas = MODULOS) {
        const termo = String(f.busca || '').trim().toLowerCase();
        const modulosCat = f.categoria ? new Set(listaSistemas.filter(m => m.categoria === f.categoria).map(m => m.id)) : null;
        return eventos.filter(e =>
            (!f.servico || e.servico === f.servico) &&
            (!f.nivel || e.nivel === f.nivel) &&
            (!modulosCat || modulosCat.has(e.servico)) &&
            (!termo || [e.resumo, e.ref, NOME_MODULO[e.servico] || e.servico].join(' ').toLowerCase().includes(termo))
        );
    }

    function htmlLogs(eventos, f, listaSistemas = MODULOS) {
        const filtrados = filtrarLogs(eventos, f, listaSistemas);
        const visiveis = filtrados.slice(0, 12);
        const linhas = visiveis.map(e => {
            const sev = SEV_BADGE[e.nivel] || SEV_BADGE.info;
            const mod = listaSistemas.find(m => m.id === e.servico) || MODULOS.find(m => m.id === e.servico);
            const nomeMod = (mod && mod.nome) || e.servico;
            const msg = e.ref ? `${e.resumo} (${e.ref})` : e.resumo;
            return `<tr class="mon-sis-row" data-acao="abrir-log" data-modulo="${esc(e.servico)}" title="Clique para abrir o log de ${esc(nomeMod)}">
                <td class="number muted mon-nowrap">${esc(fmtDataHora(parseData(e.em)))}</td>
                <td><span class="mon-sev-pill ${sev.cls}">${esc(sev.texto)}</span></td>
                <td><strong>${esc(nomeMod)}</strong></td>
                <td class="mon-msg-cell" title="${esc(msg)}">${esc(msg)}</td>
                <td><span class="mon-status-pill ${sev.corStatus}"><i class="mon-dot ${sev.corStatus}"></i>${esc(sev.status)}</span></td>
                <td class="mon-td-dir"><button type="button" class="mon-row-link" data-acao="abrir-log" data-modulo="${esc(e.servico)}" title="Abrir log de ${esc(nomeMod)}">${svg('seta')}</button></td>
            </tr>`;
        }).join('');

        return `<section class="panel mon-panel entra" style="--i:3">
            <div class="panel-head mon-panel-head">
                <div class="mon-panel-title"><span class="mon-title-icon">${svg('logs')}</span><h2>Logs recentes</h2></div>
                <div class="mon-logs-actions">
                    <select id="filtro-mon-servico" class="sort-select" data-filtro="servico" aria-label="Filtrar por módulo">
                        <option value="">Todos os módulos</option>
                        ${listaSistemas.map(m => `<option value="${esc(m.id)}" ${f.servico === m.id ? 'selected' : ''}>${esc(m.nome)}</option>`).join('')}
                    </select>
                    ${f.servico || f.nivel || f.categoria ? '<button type="button" class="button small text" data-acao="limpar">Limpar filtro</button>' : ''}
                    <a class="panel-link" href="atividade.html"><span>Ver todos os logs</span>${svg('setaDir')}</a>
                </div>
            </div>
            ${visiveis.length ? `<div class="table-scroll mon-table-wrap" id="mon-logs-table-wrap">
                <table class="mon-table mon-logs-table">
                    <thead>
                        <tr>
                            <th>Data / Hora</th>
                            <th>Severidade</th>
                            <th>Página / Serviço</th>
                            <th>Mensagem</th>
                            <th>Status</th>
                            <th aria-label="Detalhes"></th>
                        </tr>
                    </thead>
                    <tbody>${linhas}</tbody>
                </table>
            </div>` : `<p class="vazio">${eventos.length ? 'Nenhum log corresponde ao filtro selecionado.' : 'Nenhum evento registrado no período.'}</p>`}
        </section>`;
    }

    function htmlAlertas(alertas) {
        const itens = alertas.map(a => `<a class="mon-alert-card ${a.nivel}" href="${esc(a.href)}" data-acao="abrir-log" data-modulo="${esc(a.servico)}">
            <span class="mon-alert-icon ${a.nivel}">!</span>
            <div class="mon-alert-body">
                <div class="mon-alert-top">
                    <strong>${esc(a.titulo)}</strong>
                    <span class="mon-alert-badge ${a.nivel}">${esc(a.rotulo)}</span>
                </div>
                <time>${esc(a.quando)}</time>
                <p>${esc(a.texto)}</p>
            </div>
            <span class="mon-alert-chev">${svg('seta')}</span>
        </a>`).join('');

        return `<section class="panel mon-panel entra" style="--i:4">
            <div class="panel-head mon-panel-head">
                <div class="mon-panel-title"><span class="mon-title-icon amber">${svg('aviso')}</span><h2>Alertas que exigem atenção</h2></div>
                <span class="mon-alert-count${alertas.length ? '' : ' zero'}">${alertas.length}</span>
            </div>
            <div class="mon-alerts-list">
                ${alertas.length ? itens : '<div class="mon-alert-ok"><span class="mon-badge-icon verde">' + svg('check') + '</span><div><strong>Nenhum alerta crítico</strong><p>Todos os módulos e robôs monitorados estão operando dentro do esperado.</p></div></div>'}
                <a class="mon-all-alerts-btn" href="atividade.html">${svg('lista')}<span>Ver todos os alertas</span>${svg('seta')}</a>
            </div>
        </section>`;
    }

    function classificarLinhaTxt(linha) {
        const t = String(linha || '');
        if (/Fechando modal|Procurando bot[ãa]o X|0 erros|0 linhas ileg[ií]veis/i.test(t)) return 'info';
        if (/\[ERROR\]|\[CRITICAL\]|\bERROR\b|Traceback|Exception|Erro Cr[ií]tico|Erro no |Erro na |Erro ao |Erro persistente|Erro API|❌\s*FALHA|Falha no login|Falha na extra[çc][ãa]o|invalid session id|Tempo esgotado!|timed out/i.test(t)) return 'erro';
        if (/\[WARNING\]|\[WARN\]|⚠️|Aten[çc][ãa]o|Timeout|Sess[ãa]o inv[áa]lida|bloqueado|tabela n[ãa]o carregou/i.test(t)) return 'aviso';
        if (/=== SESS[ÃA]O FINALIZADA ===|=== APLICA[ÇC][ÃA]O FINALIZADA ===|conclu[ií]d[oa]|sucesso|✅/i.test(t)) return 'ok';
        return 'info';
    }

    function diagnosticarLinhasLog(linhas = [], resposta = null) {
        try {
            if (resposta && resposta.estado_log) {
                return {
                    estado: resposta.estado_log,
                    motivo: resposta.motivo_estado || '',
                    erro: resposta.ultimo_erro || null,
                };
            }
            const uteis = (Array.isArray(linhas) ? linhas : []).map(l => String(l || '').trim()).filter(Boolean);
            if (!uteis.length) return { estado: 'offline', motivo: 'Sem atividade recente', erro: null };
            const ultimas = uteis.slice(-50);
            let idxFim = -1, idxErro = -1, idxAtiv = -1;
            for (let i = 0; i < ultimas.length; i++) {
                const l = ultimas[i];
                if (/=== SESS[ÃA]O FINALIZADA ===|=== APLICA[ÇC][ÃA]O FINALIZADA ===|Extra[çc][ãa]o conclu[ií]da|Processamento conclu[ií]do|Email de relat[óo]rio enviado|entrando em Pausa/i.test(l)) idxFim = i;
                if (classificarLinhaTxt(l) === 'erro') idxErro = i;
                else if (i > idxFim && !/^={3,}|^\(No symbol\)/i.test(l)) idxAtiv = i;
            }
            if (idxErro >= 0 && idxErro >= idxFim && (ultimas.length - 1 - idxErro <= 6)) {
                return { estado: 'erro', motivo: 'Erro detectado no log', erro: ultimas[idxErro] };
            }
            if (idxFim >= 0 && idxAtiv <= idxFim) {
                return { estado: 'offline', motivo: 'Sessão finalizada · Robô concluiu a tarefa e está offline', erro: null };
            }
            return { estado: 'online', motivo: 'Em atividade · Robô ativo no log', erro: null };
        } catch (e) {
            return { estado: 'erro', motivo: 'Erro ao analisar log', erro: String(e.message || e) };
        }
    }

    // Gera linhas de log sintéticas para serviços sem arquivo TXT próprio (NF, Cadastro, Sync, Impressão)
    function linhasServicoInterno(moduloId, dados = {}) {
        const evs = unificarEventos(dados).filter(e => e.servico === moduloId);
        if (!evs.length) return ['Nenhum evento registrado recentemente para este serviço.'];
        return evs.slice().reverse().map(e => {
            const dh = fmtDataHora(parseData(e.em));
            const niv = String(e.nivel || 'info').toUpperCase().padEnd(5, ' ');
            const ref = e.ref ? ` [${e.ref}]` : '';
            return `[${dh}] [${niv}] ${e.resumo}${ref}`;
        });
    }

    function htmlModalLog(dados = {}, op = {}) {
        if (!op.logAberto) return '';
        const idAtivo = op.logModulo || 'coupa';
        const modulosDin = obterModulos(dados);
        const listaLogsRede = obterArquivosLogRede(dados);
        const modInfo = modulosDin.find(m => m.id === idAtivo) || listaLogsRede.find(a => a.id === idAtivo) || { id: idAtivo, nome: idAtivo, href: 'atividade.html', idLog: idAtivo, arquivoLog: `${idAtivo}.txt` };
        const itemRede = listaLogsRede.find(a => a.id === (modInfo.idLog || idAtivo));
        const idxAtual = Math.max(0, listaLogsRede.findIndex(a => a.id === (modInfo.idLog || idAtivo)));
        const antItem = listaLogsRede[(idxAtual - 1 + listaLogsRede.length) % listaLogsRede.length];
        const proxItem = listaLogsRede[(idxAtual + 1) % listaLogsRede.length];

        const resposta = op.logResposta || null;
        const carregando = !!op.logCarregando;
        const busca = String(op.buscaLog || '').trim().toLowerCase();
        const soAlertas = !!op.soAlertasLog;
        const qtdLinhas = Number(op.linhasLog) || 400;

        const ehTxtRede = !!(modInfo.idLog || (itemRede && itemRede.txt));
        const nomeExibicao = (resposta && resposta.nome) || modInfo.nome || (itemRede && itemRede.nome) || idAtivo;
        const nomeArquivo = (resposta && resposta.arquivo) || (itemRede && itemRede.arquivo) || modInfo.arquivoLog || `${idAtivo}.txt`;
        const caminhoArquivo = (resposta && resposta.caminho) || (ehTxtRede ? `\\\\SERVIDOR2\\Publico\\ALLAN\\Logs\\${nomeArquivo}` : 'Histórico interno do Maestro');
        const hrefPortal = modInfo.href || (itemRede && itemRede.href) || 'atividade.html';

        const linhasBrutas = ehTxtRede
            ? (resposta && Array.isArray(resposta.linhas) ? resposta.linhas : [])
            : linhasServicoInterno(idAtivo, dados);

        const linhasFiltradas = linhasBrutas.map((texto, idx) => ({ num: idx + 1, texto, nivel: classificarLinhaTxt(texto) }))
            .filter(l => {
                if (soAlertas && l.nivel !== 'erro' && l.nivel !== 'aviso') return false;
                if (busca && !l.texto.toLowerCase().includes(busca)) return false;
                return true;
            });

        const abasArquivos = listaLogsRede.map(a => {
            const sel = (modInfo.idLog || idAtivo) === a.id ? ' selecionado' : '';
            return `<button type="button" class="mon-log-tab${sel}" data-acao="abrir-log" data-modulo="${esc(a.id)}" title="${esc(a.nome)} (${esc(a.arquivo)})">
                ${svg('terminal')}<span>${esc(a.arquivo)}</span>
            </button>`;
        }).join('');

        let corpoTerminal = '';
        if (carregando && !linhasBrutas.length) {
            corpoTerminal = `<div class="mon-log-empty">Carregando ${esc(nomeArquivo)} de ${esc(caminhoArquivo)}…</div>`;
        } else if (ehTxtRede && resposta && resposta.sucesso === false) {
            corpoTerminal = `<div class="mon-log-empty erro">${svg('erro')}<span>${esc(resposta.erro || 'Não foi possível ler o arquivo de log.')}</span></div>`;
        } else if (!linhasFiltradas.length) {
            corpoTerminal = `<div class="mon-log-empty">${linhasBrutas.length ? 'Nenhuma linha corresponde ao filtro digitado.' : 'O arquivo de log está vazio.'}</div>`;
        } else {
            corpoTerminal = `<div class="mon-log-lines" id="mon-log-lines">${linhasFiltradas.map(l =>
                `<div class="mon-log-line ${l.nivel}"><span class="mon-log-num">${l.num}</span><span class="mon-log-text">${esc(l.texto)}</span></div>`
            ).join('')}</div>`;
        }

        const metaInfo = [];
        if (resposta && resposta.modificado_em) metaInfo.push(`Atualizado: ${fmtDataHora(parseData(resposta.modificado_em))}`);
        if (resposta && resposta.tamanho != null) metaInfo.push(`Tamanho: ${fmtTamanho(resposta.tamanho)}`);
        metaInfo.push(`Exibindo ${linhasFiltradas.length} de ${linhasBrutas.length} linha(s)`);

        const diag = diagnosticarLinhasLog(linhasBrutas, resposta);
        const corDiag = diag.estado === 'erro' ? 'vermelho' : diag.estado === 'offline' ? 'cinza' : 'verde';
        const rotuloDiag = diag.estado === 'erro' ? 'Erro no log' : diag.estado === 'offline' ? 'Offline (Sessão finalizada)' : 'Online (Em atividade)';
        const bannerErro = diag.erro ? `<div class="mon-log-alert-banner">${svg('erro')}<div><strong>Erro detectado neste log:</strong> <span>${esc(diag.erro)}</span></div></div>` : '';
        const logKey = `${idAtivo}|${carregando ? 1 : 0}|${(resposta && resposta.modificado_em) || ''}|${linhasFiltradas.length}|${busca}|${soAlertas ? 1 : 0}|${qtdLinhas}`;

        return `<div class="drawer-shade mon-log-shade" data-acao="fechar-log" data-log-key="${esc(logKey)}" data-log-modulo="${esc(idAtivo)}">
            <section class="mon-log-modal" role="dialog" aria-modal="true" aria-labelledby="mon-log-title">
                <header class="mon-log-header">
                    <div class="mon-log-title-wrap">
                        <span class="mon-title-icon cyan">${svg('terminal')}</span>
                        <div>
                            <div class="mon-log-title-row">
                                <h2 id="mon-log-title">${esc(nomeExibicao)}</h2>
                                <span class="mon-arq-badge">${esc(nomeArquivo)}</span>
                                <span class="mon-status-pill ${corDiag}"><i class="mon-dot ${corDiag}"></i>${esc(rotuloDiag)}</span>
                                <span class="selo">${idxAtual + 1} / ${listaLogsRede.length}</span>
                                ${carregando ? '<span class="selo">Atualizando…</span>' : ''}
                            </div>
                            <p class="mon-log-path">${esc(caminhoArquivo)} ${metaInfo.length ? `· ${esc(metaInfo.join(' · '))}` : ''}</p>
                        </div>
                    </div>
                    <div class="mon-log-head-actions">
                        <button type="button" class="button small" data-acao="log-anterior" title="Log anterior: ${esc(antItem.nome)} (${esc(antItem.arquivo)})">${svg('setaEsq')}<span>Anterior</span></button>
                        <button type="button" class="button small" data-acao="log-proximo" title="Próximo log: ${esc(proxItem.nome)} (${esc(proxItem.arquivo)})"><span>Próximo</span>${svg('seta')}</button>
                        <a class="button small" href="${esc(hrefPortal)}">${svg('externo')}<span>Abrir página</span></a>
                        <button type="button" class="button small" data-acao="copiar-log">${svg('copiar')}<span>Copiar</span></button>
                        <button type="button" class="button small primary" data-acao="recarregar-log"><span>Atualizar log</span></button>
                        <button type="button" class="button small mon-btn-fechar" data-acao="fechar-log" aria-label="Fechar visualizador de log">${svg('fechar')}<span>Fechar</span></button>
                    </div>
                </header>
                <div class="mon-log-tabs-bar" id="mon-log-tabs-bar" aria-label="Arquivos de log em \\\\SERVIDOR2\\Publico\\ALLAN\\Logs">
                    ${abasArquivos}
                </div>
                <div class="mon-log-toolbar">
                    <label class="field search-field mon-log-search">
                        <span class="search-box">
                            <input id="busca-log-txt" type="search" data-filtro="buscaLog" placeholder="Filtrar linhas em ${esc(nomeArquivo)} (ex.: ERRO, Página, CDE, evento)…" value="${esc(op.buscaLog || '')}">
                        </span>
                    </label>
                    <label class="mon-log-check">
                        <input type="checkbox" data-acao-change="toggle-alertas-log" ${soAlertas ? 'checked' : ''}>
                        <span>Só erros e avisos</span>
                    </label>
                    ${ehTxtRede ? `<label class="mon-log-select-wrap">
                        <span>Últimas</span>
                        <select id="select-linhas-log" class="sort-select" data-filtro="linhasLog">
                            ${[200, 400, 1000, 2500].map(n => `<option value="${n}" ${qtdLinhas === n ? 'selected' : ''}>${n} linhas</option>`).join('')}
                        </select>
                    </label>` : ''}
                </div>
                ${bannerErro}
                <div class="mon-log-terminal" id="mon-log-terminal" data-scroll-final="${op.logNoFinal !== false ? '1' : '0'}">
                    ${corpoTerminal}
                </div>
                <footer class="mon-log-footer">
                    <button type="button" class="button small" data-acao="log-anterior">${svg('setaEsq')}<span>${esc(antItem.arquivo)}</span></button>
                    <span class="muted">Use as abas acima ou as setas ← / → para pular de log em log · ESC para fechar</span>
                    <div class="mon-log-head-actions">
                        <button type="button" class="button small" data-acao="log-proximo"><span>${esc(proxItem.arquivo)}</span>${svg('seta')}</button>
                        <button type="button" class="button small" data-acao="fechar-log">${svg('fechar')}<span>Fechar</span></button>
                    </div>
                </footer>
            </section>
        </div>`;
    }

    function atualizarEstadoScrollLog(op, metricas) {
        if (!op || !metricas || !metricas.temLinhas) return op;
        const scrollTop = Math.max(0, Number(metricas.scrollTop) || 0);
        const scrollHeight = Math.max(0, Number(metricas.scrollHeight) || 0);
        const clientHeight = Math.max(0, Number(metricas.clientHeight) || 0);
        if (scrollHeight <= 0) return op;
        const distFim = Math.max(0, scrollHeight - scrollTop - clientHeight);
        op.logScrollTop = scrollTop;
        op.logNoFinal = distFim <= 28;
        return op;
    }

    function aplicarScrollTerminal(term, op) {
        if (!term || !op) return;
        const temLinhas = !!(term.querySelector ? term.querySelector('#mon-log-lines') : term.hasLines);
        if (!temLinhas) return;
        if (op.logNoFinal !== false) {
            term.scrollTop = term.scrollHeight;
            op.logScrollTop = term.scrollTop;
            op.logNoFinal = true;
        } else if (typeof op.logScrollTop === 'number' && op.logScrollTop >= 0) {
            term.scrollTop = op.logScrollTop;
        }
    }

    const PERIODOS = { '24h': ['Últimas 24 horas', DIA], 'hoje': ['Hoje', DIA], '7d': ['Últimos 7 dias', 7 * DIA] };

    function pagina(dados = {}, ctx = {}, f = { periodo: '24h', servico: '', nivel: '', categoria: '', busca: '', roboGrafico: '' }, op = {}) {
        const agora = ctx.agora ? ctx.agora() : new Date();
        const janelaMs = (PERIODOS[f.periodo] || PERIODOS['24h'])[1];
        const eventos = unificarEventos(dados);
        const listaSistemas = sistemas(dados, agora, janelaMs);
        const kpis = calcularKpis(listaSistemas, eventos, agora, janelaMs);
        const alertas = alertasAtivos(dados, listaSistemas, agora);

        return `${htmlKpis(kpis, f)}
            <div class="mon-grid-mid">${htmlSistemas(listaSistemas, f)}${htmlGrafico(eventos, kpis, agora, janelaMs, f, listaSistemas)}</div>
            <div class="mon-grid-bot">${htmlLogs(eventos, f, listaSistemas)}${htmlAlertas(alertas)}</div>
            ${htmlModalLog(dados, op)}`;
    }

    const api = { MODULOS, ARQUIVOS_LOG_REDE, obterModulos, obterArquivosLogRede, proximoModuloLog, proximoRoboGrafico, unificarEventos, sistemas, calcularKpis, alertasAtivos, filtrarLogs, montarSerieGrafico, htmlModalLog, atualizarEstadoScrollLog, aplicarScrollTerminal, pagina };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.DashMonitoramento = api;

    if (typeof document !== 'undefined' && document.body && document.body.dataset.dashboard === 'monitoramento') {
        const paramsUrl = new URLSearchParams(location.search);
        const f = { periodo: '24h', servico: '', nivel: '', categoria: '', busca: '', roboGrafico: '' };
        const op = {
            logAberto: !!paramsUrl.get('log'),
            logModulo: paramsUrl.get('log') || 'coupa',
            logCarregando: false,
            logResposta: null,
            buscaLog: '',
            soAlertasLog: false,
            linhasLog: 400,
            logNoFinal: true,
            logScrollTop: null,
            sisScrollTop: 0,
            logsScrollTop: 0,
            tabsScrollLeft: 0,
            chipsScrollLeft: 0,
        };
        let reqLogAtual = '';
        let refSocket = null;
        let refDesenhar = null;
        let ultimosDados = {};

        function sincronizarScrollMonitoramento(raiz = document) {
            const q = sel => (raiz && raiz.querySelector ? raiz.querySelector(sel) : document.querySelector(sel));
            const sisWrap = q('#mon-sis-table-wrap');
            if (sisWrap && typeof op.sisScrollTop === 'number') sisWrap.scrollTop = op.sisScrollTop;
            const logsWrap = q('#mon-logs-table-wrap');
            if (logsWrap && typeof op.logsScrollTop === 'number') logsWrap.scrollTop = op.logsScrollTop;
            const tabsBar = q('#mon-log-tabs-bar');
            if (tabsBar && typeof op.tabsScrollLeft === 'number') tabsBar.scrollLeft = op.tabsScrollLeft;
            const chipsBar = q('#mon-chart-chips');
            if (chipsBar && typeof op.chipsScrollLeft === 'number') chipsBar.scrollLeft = op.chipsScrollLeft;
            const term = q('#mon-log-terminal');
            if (term) {
                aplicarScrollTerminal(term, op);
                if (op.logNoFinal !== false && typeof requestAnimationFrame === 'function') {
                    requestAnimationFrame(() => {
                        const termAtual = document.getElementById('mon-log-terminal');
                        if (termAtual && op.logNoFinal !== false) aplicarScrollTerminal(termAtual, op);
                    });
                }
            }
        }

        // Atualiza só o conteúdo do terminal (sem recriar o modal) para que a posição de rolagem do usuário seja preservada.
        function atualizarLogNoLugar() {
            if (!op.logAberto || typeof document === 'undefined' || typeof document.createElement !== 'function') return false;
            const shade = document.querySelector('.mon-log-shade[data-log-key]');
            const termVivo = shade && shade.querySelector('#mon-log-terminal');
            if (!termVivo || !termVivo.querySelector('#mon-log-lines') || shade.dataset.logModulo !== String(op.logModulo)) return false;
            const tpl = document.createElement('template');
            tpl.innerHTML = htmlModalLog(ultimosDados, op);
            const novo = tpl.content.querySelector('.mon-log-shade');
            const termNovo = novo && novo.querySelector('#mon-log-terminal');
            if (!termNovo || !termNovo.querySelector('#mon-log-lines')) return false;

            const noFinal = op.logNoFinal !== false;
            let ancora = null;
            if (!noFinal) {
                const topo = termVivo.getBoundingClientRect().top;
                for (const linha of termVivo.querySelectorAll('.mon-log-line')) {
                    const rect = linha.getBoundingClientRect();
                    if (rect.bottom > topo) {
                        const numEl = linha.querySelector('.mon-log-num');
                        ancora = { num: numEl ? numEl.textContent : '', desloc: rect.top - topo };
                        break;
                    }
                }
            }
            const topoAnterior = termVivo.scrollTop;

            termVivo.innerHTML = termNovo.innerHTML;
            for (const sel of ['.mon-log-path', '.mon-log-alert-banner']) {
                const a = shade.querySelector(sel);
                const b = novo.querySelector(sel);
                if (a && b) a.innerHTML = b.innerHTML;
            }
            shade.dataset.logKey = novo.dataset.logKey;

            if (noFinal) {
                termVivo.scrollTop = termVivo.scrollHeight;
            } else {
                let alvo = null;
                if (ancora && ancora.num) {
                    alvo = Array.from(termVivo.querySelectorAll('.mon-log-line')).find(l => {
                        const n = l.querySelector('.mon-log-num');
                        return n && n.textContent === ancora.num;
                    });
                }
                if (alvo) {
                    const topo = termVivo.getBoundingClientRect().top;
                    termVivo.scrollTop += (alvo.getBoundingClientRect().top - topo) - ancora.desloc;
                } else {
                    termVivo.scrollTop = topoAnterior;
                }
                op.logScrollTop = termVivo.scrollTop;
            }
            termVivo.dataset.scrollFinal = noFinal ? '1' : '0';
            return true;
        }

        function requisitarLogTxt(moduloId, opcoes = {}) {
            const modulosDin = obterModulos(ultimosDados);
            const listaLogsRede = obterArquivosLogRede(ultimosDados);
            const mod = modulosDin.find(m => m.id === moduloId);
            const itemRede = listaLogsRede.find(a => a.id === moduloId);
            const idRede = (mod && mod.idLog) || (itemRede && itemRede.txt ? itemRede.id : null);
            const trocouModulo = !op.logAberto || op.logModulo !== moduloId;
            const manterPosicao = Boolean(opcoes && opcoes.manterPosicao) && !trocouModulo;

            op.logAberto = true;
            op.logModulo = moduloId;
            if (!manterPosicao) {
                op.logNoFinal = true;
                op.logScrollTop = null;
            }

            if (!idRede) {
                op.logCarregando = false;
                op.logResposta = null;
                if (refDesenhar) refDesenhar();
                sincronizarScrollMonitoramento();
                return;
            }
            if (!refSocket || !refSocket.connected) {
                op.logCarregando = true;
                return;
            }
            reqLogAtual = `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            op.logCarregando = true;
            if (!op.logResposta || op.logResposta.id !== idRede) op.logResposta = null;
            refSocket.emit('solicitar_log_txt', { id: idRede, linhas: op.linhasLog, requestId: reqLogAtual });
            if (refDesenhar) refDesenhar();
        }

        document.addEventListener('keydown', e => {
            if (!op.logAberto) return;
            const tag = (e.target && e.target.tagName) || '';
            if (e.key === 'Escape') {
                op.logAberto = false;
                if (refDesenhar) refDesenhar();
                return;
            }
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                requisitarLogTxt(proximoModuloLog(op.logModulo, -1, ultimosDados));
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                requisitarLogTxt(proximoModuloLog(op.logModulo, 1, ultimosDados));
            }
        });

        root.Dash.iniciar({
            pagina: 'monitoramento',
            fonte: 'monitoramento',
            titulo: 'Painel de monitoramento',
            subtitulo: 'Visão geral de páginas, robôs, serviços e logs em \\\\SERVIDOR2\\Publico\\ALLAN\\Logs.',
            parametros: () => ({ limite: 500 }),
            extrair: r => r,
            antesDesenhar: app => {
                if (!app || !app.querySelector) return;
                const sisWrap = app.querySelector('#mon-sis-table-wrap');
                if (sisWrap) op.sisScrollTop = sisWrap.scrollTop;
                const logsWrap = app.querySelector('#mon-logs-table-wrap');
                if (logsWrap) op.logsScrollTop = logsWrap.scrollTop;
                const tabsBar = app.querySelector('#mon-log-tabs-bar');
                if (tabsBar) op.tabsScrollLeft = tabsBar.scrollLeft;
                const chipsBar = app.querySelector('#mon-chart-chips');
                if (chipsBar) op.chipsScrollLeft = chipsBar.scrollLeft;
                const term = app.querySelector('#mon-log-terminal');
                if (term && term.querySelector('#mon-log-lines') && op.logNoFinal === false) {
                    op.logScrollTop = term.scrollTop;
                }
            },
            posDesenhar: app => {
                sincronizarScrollMonitoramento(app);
            },
            aoRolar: e => {
                const el = e && e.target;
                if (!el || !el.id) return;
                if (el.id === 'mon-log-terminal') {
                    atualizarEstadoScrollLog(op, {
                        scrollTop: el.scrollTop,
                        scrollHeight: el.scrollHeight,
                        clientHeight: el.clientHeight,
                        temLinhas: !!(el.querySelector && el.querySelector('#mon-log-lines')),
                    });
                } else if (el.id === 'mon-sis-table-wrap') {
                    op.sisScrollTop = el.scrollTop;
                } else if (el.id === 'mon-logs-table-wrap') {
                    op.logsScrollTop = el.scrollTop;
                } else if (el.id === 'mon-log-tabs-bar') {
                    op.tabsScrollLeft = el.scrollLeft;
                } else if (el.id === 'mon-chart-chips') {
                    op.chipsScrollLeft = el.scrollLeft;
                }
            },
            ouvirSocket: (socket, _estado, desenhar) => {
                refSocket = socket;
                refDesenhar = desenhar;
                socket.on('retorno_log_txt', r => {
                    if (!r || (r.requestId && r.requestId !== reqLogAtual)) return;
                    op.logCarregando = false;
                    op.logResposta = r;
                    if (atualizarLogNoLugar()) return;
                    desenhar();
                    sincronizarScrollMonitoramento();
                });
                socket.on('connect', () => {
                    if (op.logAberto) setTimeout(() => requisitarLogTxt(op.logModulo, { manterPosicao: true }), 300);
                });
            },
            controles: ctx => `<label class="mon-periodo-select">${ctx.icone('calendario')}<select id="filtro-mon-periodo" data-filtro="periodo" aria-label="Período">${Object.entries(PERIODOS).map(([k, [rotulo]]) => `<option value="${k}" ${f.periodo === k ? 'selected' : ''}>${rotulo}</option>`).join('')}</select></label>`,
            render: (d, ctx) => {
                ultimosDados = d || {};
                return pagina(d, ctx, f, op);
            },
            acoes: {
                'abrir-log': el => {
                    const mod = el.dataset.modulo || 'coupa';
                    requisitarLogTxt(mod);
                },
                'log-anterior': () => {
                    requisitarLogTxt(proximoModuloLog(op.logModulo, -1, ultimosDados));
                },
                'log-proximo': () => {
                    requisitarLogTxt(proximoModuloLog(op.logModulo, 1, ultimosDados));
                },
                'fechar-log': () => {
                    op.logAberto = false;
                },
                'recarregar-log': () => {
                    requisitarLogTxt(op.logModulo, { manterPosicao: true });
                },
                'toggle-alertas-log': el => {
                    op.soAlertasLog = !!el.checked;
                },
                'copiar-log': el => {
                    const texto = (op.logResposta && Array.isArray(op.logResposta.linhas))
                        ? op.logResposta.linhas.join('\n')
                        : (document.getElementById('mon-log-lines')?.innerText || '');
                    if (navigator.clipboard && texto) {
                        navigator.clipboard.writeText(texto).then(() => {
                            const span = el.querySelector('span');
                            if (span) { const ant = span.textContent; span.textContent = 'Copiado!'; setTimeout(() => { span.textContent = ant; }, 1500); }
                        }).catch(() => {});
                    }
                },
                'grafico-robo': el => {
                    f.roboGrafico = el.dataset.robo || '';
                },
                'grafico-robo-ant': () => {
                    f.roboGrafico = proximoRoboGrafico(f.roboGrafico, -1, obterModulos(ultimosDados));
                },
                'grafico-robo-prox': () => {
                    f.roboGrafico = proximoRoboGrafico(f.roboGrafico, 1, obterModulos(ultimosDados));
                },
                servico: el => { f.servico = f.servico === el.dataset.servico ? '' : el.dataset.servico; },
                nivel: el => { f.nivel = f.nivel === el.dataset.nivel ? '' : el.dataset.nivel; },
                categoria: el => {
                    f.categoria = f.categoria === el.dataset.categoria ? '' : el.dataset.categoria;
                    op.sisScrollTop = 0;
                },
                limpar: () => { f.servico = ''; f.nivel = ''; f.categoria = ''; f.busca = ''; f.roboGrafico = ''; op.sisScrollTop = 0; },
            },
            filtrar: (k, v) => {
                if (k === 'buscaLog') { op.buscaLog = v; return; }
                if (k === 'linhasLog') { op.linhasLog = Number(v) || 400; requisitarLogTxt(op.logModulo, { manterPosicao: true }); return; }
                f[k] = v;
            },
        });
    }
})(typeof window !== 'undefined' ? window : globalThis);
