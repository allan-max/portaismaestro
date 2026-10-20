const fs = require('fs');
const path = require('path');

const PASTA_LOGS_REDE = '\\\\SERVIDOR2\\Publico\\ALLAN\\Logs';
const PASTA_LOGS_LOCAL = path.join(__dirname, '..', '..', 'gerenciador', 'logs');

// Catálogo base de logs conhecidos; qualquer outro .txt na pasta de rede é detectado automaticamente!
const CATALOGO_LOGS = [
    {
        id: 'coupa',
        modulo: 'coupa',
        nome: 'Robô Coupa',
        subtitulo: 'Extração, Pente Fino e Respostas',
        arquivo: 'log-coupa.txt',
        caminhos: [path.join(PASTA_LOGS_REDE, 'log-coupa.txt')],
        auto: false,
    },
    {
        id: 'vale',
        modulo: 'vale',
        nome: 'Robô Vale',
        subtitulo: 'Extração Nimbi / Vale',
        arquivo: 'log-vale.txt',
        caminhos: [path.join(PASTA_LOGS_REDE, 'log-vale.txt')],
        auto: false,
    },
    {
        id: 'me',
        modulo: 'me',
        nome: 'Mercado Eletrônico',
        subtitulo: 'Extração de cotações e PDFs',
        arquivo: 'mercadoeletronico.txt',
        caminhos: [path.join(PASTA_LOGS_REDE, 'mercadoeletronico.txt')],
        auto: false,
    },
    {
        id: 'ariba',
        modulo: 'ariba',
        nome: 'Robô SAP Ariba',
        subtitulo: 'AEGEA e Estácio · .NET',
        arquivo: 'aribasourcing.txt',
        caminhos: [path.join(PASTA_LOGS_REDE, 'aribasourcing.txt')],
        auto: false,
    },
    {
        id: 'findes',
        modulo: 'findes',
        nome: 'Robô Findes',
        subtitulo: 'Coleta CDE e materiais · .NET',
        arquivo: 'findes.txt',
        caminhos: [
            path.join(PASTA_LOGS_REDE, 'findes.txt'),
            path.join(PASTA_LOGS_REDE, 'log-findes.txt'),
        ],
        auto: false,
    },
    {
        id: 'gerenciador',
        modulo: 'gerenciador',
        nome: 'Gerenciador Central',
        subtitulo: 'Servidor Central · Auto-Pilot',
        arquivo: 'gerenciador.log',
        caminhos: [
            path.join(PASTA_LOGS_LOCAL, 'gerenciador.log'),
        ],
        auto: false,
    },
];

// Nomes amigáveis opcionais para arquivos extras conhecidos na pasta de logs
const NOMES_AMIGAVEIS_EXTRAS = {
    'console-log.txt': { id: 'console_produtos', nome: 'Robô API Produtos', subtitulo: 'Cadastro automático de produtos · API' },
    'log_zapzap.txt': { id: 'zapzap', nome: 'Robô WhatsApp / Gateway', subtitulo: 'Bot WhatsApp · Datasheet e Produtos' },
    'registro_acessos.txt': { id: 'acessos', nome: 'Monitor de Acessos', subtitulo: 'Auditoria de login e tokens' },
    'log_ponto.txt': { id: 'log_ponto', nome: 'Robô Ponto', subtitulo: 'Automação detectada na pasta de logs' },
    'log_python_datasheet.txt': { id: 'log_python_datasheet', nome: 'Robô Datasheet Python', subtitulo: 'Processamento de datasheets' },
    'dellavolpe_api.log': { id: 'dellavolpe_api', nome: 'Robô Della Volpe API', subtitulo: 'Integração API Della Volpe' },
};

function formatarNomeRoboDeArquivo(nomeArquivo) {
    const chave = String(nomeArquivo || '').toLowerCase();
    if (NOMES_AMIGAVEIS_EXTRAS[chave]) return NOMES_AMIGAVEIS_EXTRAS[chave];
    const semExt = String(nomeArquivo || '').replace(/\.(txt|log)$/i, '');
    const limpo = semExt
        .replace(/^(log[-_]?|robo[-_]?)/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
    const titulo = limpo
        ? limpo.split(/\s+/).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
        : semExt;
    const id = 'robo_' + semExt.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return {
        id,
        nome: /^rob[ôo]/i.test(titulo) ? titulo : `Robô ${titulo}`,
        subtitulo: `Detectado automaticamente em Logs (${nomeArquivo})`,
    };
}

// Retorna o catálogo base + todos os arquivos .txt/.log descobertos automaticamente na pasta de rede
function descobrirCatalogoLogs(pastaRede = PASTA_LOGS_REDE) {
    const lista = CATALOGO_LOGS.map(item => ({ ...item }));
    const arquivosJaMapeados = new Set();
    for (const item of CATALOGO_LOGS) {
        arquivosJaMapeados.add(item.arquivo.toLowerCase());
        for (const c of item.caminhos) arquivosJaMapeados.add(path.basename(c).toLowerCase());
    }

    try {
        const entradas = fs.readdirSync(pastaRede, { withFileTypes: true });
        for (const ent of entradas) {
            if (!ent.isFile()) continue;
            const nomeArq = ent.name;
            const lower = nomeArq.toLowerCase();
            if (!lower.endsWith('.txt') && !lower.endsWith('.log')) continue;
            if (arquivosJaMapeados.has(lower)) continue;

            const info = formatarNomeRoboDeArquivo(nomeArq);
            arquivosJaMapeados.add(lower);
            lista.push({
                id: info.id,
                modulo: info.id,
                nome: info.nome,
                subtitulo: info.subtitulo,
                arquivo: nomeArq,
                caminhos: [path.join(pastaRede, nomeArq)],
                auto: true,
            });
        }
    } catch {
        // Fallback caso a pasta de rede esteja temporariamente inacessível: mantém os extras conhecidos
        for (const [nomeArq, info] of Object.entries(NOMES_AMIGAVEIS_EXTRAS)) {
            if (arquivosJaMapeados.has(nomeArq)) continue;
            lista.push({
                id: info.id,
                modulo: info.id,
                nome: info.nome,
                subtitulo: info.subtitulo,
                arquivo: nomeArq,
                caminhos: [path.join(pastaRede, nomeArq)],
                auto: true,
            });
        }
    }

    return lista;
}

function decodificarLinha(slice) {
    const utf8 = slice.toString('utf8');
    if (!utf8.includes('\uFFFD')) return utf8;
    return slice.toString('latin1');
}

function decodificarBufferPorLinha(buf) {
    const linhas = [];
    let inicio = 0;
    for (let i = 0; i <= buf.length; i++) {
        if (i === buf.length || buf[i] === 0x0A) {
            const fim = i > inicio && buf[i - 1] === 0x0D ? i - 1 : i;
            linhas.push(decodificarLinha(buf.subarray(inicio, fim)));
            inicio = i + 1;
        }
    }
    return linhas;
}

function resolverCaminho(item, pastaRede = PASTA_LOGS_REDE) {
    const candidatos = item.caminhos.map(c =>
        pastaRede !== PASTA_LOGS_REDE && c.startsWith(PASTA_LOGS_REDE)
            ? path.join(pastaRede, path.basename(c))
            : c
    );
    let melhor = null;
    for (const c of candidatos) {
        try {
            const st = fs.statSync(c);
            if (st.isFile() && (!melhor || st.mtimeMs > melhor.st.mtimeMs)) {
                melhor = { caminho: c, st };
            }
        } catch {}
    }
    return melhor;
}

// Lê as últimas `maxLinhas` de um arquivo grande sem carregar o arquivo inteiro na memória.
function lerFinalArquivo(caminho, maxLinhas = 400, maxBytes = 512 * 1024) {
    const st = fs.statSync(caminho);
    const tamanho = st.size;
    if (tamanho === 0) {
        return { tamanho: 0, modificado_em: st.mtime.toISOString(), linhas: [], truncado: false };
    }
    const bytesParaLer = Math.min(tamanho, Math.max(32 * 1024, Math.min(maxBytes, maxLinhas * 320)));
    const offset = Math.max(0, tamanho - bytesParaLer);
    const fd = fs.openSync(caminho, 'r');
    try {
        const buf = Buffer.alloc(bytesParaLer);
        const lidos = fs.readSync(fd, buf, 0, bytesParaLer, offset);
        const bruto = decodificarBufferPorLinha(buf.subarray(0, lidos));
        if (offset > 0 && bruto.length > 1) bruto.shift();
        while (bruto.length && !bruto[bruto.length - 1].trim()) bruto.pop();
        const totalNoBloco = bruto.length;
        const linhas = bruto.slice(-maxLinhas);
        return {
            tamanho,
            modificado_em: st.mtime.toISOString(),
            linhas,
            truncado: offset > 0 || totalNoBloco > maxLinhas,
        };
    } finally {
        fs.closeSync(fd);
    }
}

function ehLinhaRuido(linha) {
    const t = String(linha || '').trim();
    if (!t) return true;
    if (/^={3,}$|^-{3,}$|^[{}[\],]+$/.test(t)) return true;
    if (/^\(No symbol\)\s*\[0x/i.test(t)) return true;
    if (/^BaseThreadInitThunk|^RtlUserThreadStart|^GetHandleVerifier/i.test(t)) return true;
    if (/^\(Session info:\s*chrome=/i.test(t)) return true;
    if (/^at\s+[\w.<>]+\(.*\)$/.test(t)) return true;
    return false;
}

function ehLinhaErro(linha) {
    const t = String(linha || '').trim();
    if (!t || ehLinhaRuido(t)) return false;
    if (/Fechando modal|Procurando bot[ãa]o X|0 erros|0 linhas ileg[ií]veis/i.test(t)) return false;
    return /\[ERROR\]|\[CRITICAL\]|\bERROR\b|Traceback|Exception|Erro Cr[ií]tico|Erro no |Erro na |Erro ao |Erro persistente|Erro API|❌\s*FALHA|Falha no login|Falha na extra[çc][ãa]o|invalid session id|Tempo esgotado!|timed out/i.test(t);
}

function ehLinhaAviso(linha) {
    const t = String(linha || '').trim();
    if (!t || ehLinhaRuido(t) || ehLinhaErro(t)) return false;
    if (/Evento encerrado\./i.test(t)) return false;
    return /\[WARNING\]|\[WARN\]|⚠️|Aten[çc][ãa]o|Timeout|Sess[ãa]o inv[áa]lida|bloqueado|tabela n[ãa]o carregou/i.test(t);
}

function ehLinhaFimSessao(linha) {
    const t = String(linha || '').trim();
    if (!t) return false;
    return /=== SESS[ÃA]O FINALIZADA ===|=== APLICA[ÇC][ÃA]O FINALIZADA ===|Paragem\/Extra[çc][ãa]o conclu[ií]da|Extra[çc][ãa]o conclu[ií]da!|Email de relat[óo]rio enviado com sucesso|Verifica[çc][ãa]o:\s*\d+\s*eventos lidos|Processamento conclu[ií]do com sucesso!|PROCESSAMENTO CONCLU[IÍ]DO!|Ciclo conclu[ií]do em|Fechando o navegador|Desligando rob[ôo]|entrando em Pausa|Pausa de 1\.5h|Pr[óo]ximo ciclo em:\s*\d+:\d+\s*segundos/i.test(t);
}

function ehLinhaAtividade(linha) {
    const t = String(linha || '').trim();
    if (!t || ehLinhaRuido(t) || ehLinhaFimSessao(t) || ehLinhaErro(t)) return false;
    return /Iniciando|Analisando P[áa]gina|Extraindo Evento|Verificando \d+ cota|Ordem recebida|Login conclu[ií]do|Aguardando login|Verificando status do login|Cota[çc][ãa]o identificada|Clicando para|Efetuando cadastro|Baixando|Página \d+:|LOTE CONCLU[IÍ]DO|Cadastrado com sucesso|PERMITIDO/i.test(t);
}

function classificarLinhaLog(linha) {
    if (ehLinhaErro(linha)) return 'erro';
    if (ehLinhaAviso(linha)) return 'aviso';
    if (ehLinhaFimSessao(linha) || /conclu[ií]d[oa]|sucesso|✅|PERMITIDO/i.test(String(linha || ''))) return 'ok';
    return 'info';
}

function limparPrefixoData(linha) {
    return String(linha || '')
        .replace(/^\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?\]\s*/, '')
        .replace(/^\[\d{2}\/\d{2}\/\d{4},?\s+\d{2}:\d{2}:\d{2}\]\s*/, '')
        .replace(/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2},\d+\s*(?:\[[^\]]+\]\s*)*/, '')
        .replace(/^\d{2}:\d{2}:\d{2}\s*\[[A-Z]+\]\s*/, '')
        .trim();
}

function extrairDataLinha(linha, dataBase) {
    const t = String(linha || '').trim();
    const iso = /^\[?(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2}):(\d{2})/.exec(t);
    if (iso) return new Date(+iso[1], +iso[2] - 1, +iso[3], +iso[4], +iso[5], +iso[6]);
    const br = /^\[?(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})\]?/.exec(t);
    if (br) return new Date(+br[3], +br[2] - 1, +br[1], +br[4], +br[5], +br[6]);
    const hhmm = /^(\d{2}):(\d{2}):(\d{2})\s+\[[A-Z]+\]/.exec(t);
    if (hhmm && dataBase instanceof Date && !Number.isNaN(dataBase.getTime())) {
        const d = new Date(dataBase.getTime());
        d.setHours(+hhmm[1], +hhmm[2], +hhmm[3], 0);
        if (d.getTime() > dataBase.getTime() + 5 * 60 * 1000) d.setDate(d.getDate() - 1);
        return d;
    }
    return null;
}

function analisarEstadoLog(linhas = [], mtimeDate = new Date(), item = {}) {
    try {
        const uteis = linhas.map(l => String(l || '').trim()).filter(l => !ehLinhaRuido(l));
        if (!uteis.length) {
            return { estado_log: 'offline', motivo_estado: 'Arquivo vazio · Sem atividade', ultima_linha: '', nivel_ultima: 'info', ultimo_erro: null, eventos: [] };
        }

        const janela = uteis.slice(-100);
        let idxFim = -1;
        let idxAtiv = -1;
        let idxErro = -1;
        let idxSucessoPosErro = -1;

        for (let i = 0; i < janela.length; i++) {
            const l = janela[i];
            if (ehLinhaFimSessao(l)) idxFim = i;
            if (ehLinhaErro(l)) idxErro = i;
            if (ehLinhaAtividade(l)) {
                idxAtiv = i;
                if (idxErro >= 0 && i > idxErro && /Login conclu[ií]do|Extra[çc][ãa]o conclu[ií]da|Processamento conclu[ií]do|sucesso/i.test(l)) {
                    idxSucessoPosErro = i;
                }
            }
        }

        const ultimaLinha = janela[janela.length - 1] || '';
        const idadeArqMin = Math.max(0, (Date.now() - mtimeDate.getTime()) / 60000);

        const temErroAtivo = idxErro >= 0 && idxErro >= idxFim && idxSucessoPosErro < idxErro && (janela.length - 1 - idxErro <= 6);
        const sessaoFinalizada = idxFim >= 0 && idxAtiv <= idxFim && !temErroAtivo;

        let estado_log = 'online';
        let motivo_estado = 'Em atividade no log';
        let nivel_ultima = classificarLinhaLog(ultimaLinha);
        let ultimo_erro = null;

        if (temErroAtivo) {
            estado_log = 'erro';
            ultimo_erro = limparPrefixoData(janela[idxErro]).slice(0, 220);
            motivo_estado = ultimo_erro || 'Erro detectado no log';
            nivel_ultima = 'erro';
        } else if (sessaoFinalizada) {
            estado_log = 'offline';
            motivo_estado = 'Sessão finalizada · Tarefa concluída';
            nivel_ultima = 'ok';
        } else if (idadeArqMin > 20) {
            estado_log = 'offline';
            motivo_estado = 'Inativo · Aguardando próximo ciclo';
        }

        // Extrai eventos do TXT (erros, avisos, conclusões e atividades com horário) para alimentar o gráfico individual de cada robô!
        const eventos = [];
        for (let i = 0; i < janela.length; i++) {
            const l = janela[i];
            const ehErr = ehLinhaErro(l);
            const ehAv = !ehErr && ehLinhaAviso(l);
            const ehFim = !ehErr && !ehAv && ehLinhaFimSessao(l) && !/^Pr[óo]ximo ciclo em:/i.test(l);
            const ehAtiv = !ehErr && !ehAv && !ehFim && ehLinhaAtividade(l);
            if (!ehErr && !ehAv && !ehFim && !ehAtiv && i !== janela.length - 1) continue;

            const dt = extrairDataLinha(l, mtimeDate) || new Date(mtimeDate.getTime() - (janela.length - 1 - i) * 15000);
            const nivel = ehErr ? 'erro' : ehAv ? 'aviso' : ehFim ? 'ok' : classificarLinhaLog(l);
            const resumoLimpo = limparPrefixoData(l).slice(0, 200);
            if (!resumoLimpo) continue;

            if (eventos.length && eventos[eventos.length - 1].resumo === resumoLimpo) continue;

            eventos.push({
                em: dt.toISOString(),
                servico: item.modulo || item.id,
                tipo: ehErr ? 'erro_log' : ehFim ? 'sessao_finalizada' : 'log_txt',
                nivel,
                resumo: resumoLimpo,
                ref: item.arquivo,
                detalhe: { arquivo: item.arquivo },
                fonte: 'log_txt',
            });
        }

        return {
            estado_log,
            motivo_estado,
            ultima_linha: limparPrefixoData(ultimaLinha).slice(0, 240),
            nivel_ultima,
            ultimo_erro,
            eventos: eventos.slice(-30),
        };
    } catch (e) {
        return {
            estado_log: 'erro',
            motivo_estado: `Falha ao analisar log: ${e.message}`,
            ultima_linha: '',
            nivel_ultima: 'erro',
            ultimo_erro: e.message,
            eventos: [],
        };
    }
}

function resumirArquivosLog(pastaRede = PASTA_LOGS_REDE) {
    const arquivos = {};
    const eventosRecentes = [];
    const catalogoCompleto = descobrirCatalogoLogs(pastaRede);

    for (const item of catalogoCompleto) {
        try {
            const achado = resolverCaminho(item, pastaRede);
            if (!achado) {
                arquivos[item.id] = {
                    id: item.id,
                    modulo: item.modulo,
                    nome: item.nome,
                    subtitulo: item.subtitulo || `Log (${item.arquivo})`,
                    arquivo: item.arquivo,
                    caminho: item.caminhos[0],
                    disponivel: false,
                    auto: !!item.auto,
                    estado_log: 'offline',
                    motivo_estado: 'Arquivo não encontrado',
                };
                continue;
            }

            const lido = lerFinalArquivo(achado.caminho, 150, 96 * 1024);
            const nomeArq = path.basename(achado.caminho);
            const analise = analisarEstadoLog(lido.linhas, achado.st.mtime, { ...item, arquivo: nomeArq });
            const modIso = achado.st.mtime.toISOString();

            arquivos[item.id] = {
                id: item.id,
                modulo: item.modulo,
                nome: item.nome,
                subtitulo: item.subtitulo || `Detectado em Logs (${nomeArq})`,
                arquivo: nomeArq,
                caminho: achado.caminho,
                disponivel: true,
                auto: !!item.auto,
                tamanho: achado.st.size,
                modificado_em: modIso,
                estado_log: analise.estado_log,
                motivo_estado: analise.motivo_estado,
                ultima_linha: analise.ultima_linha,
                nivel_ultima: analise.nivel_ultima,
                ultimo_erro: analise.ultimo_erro,
            };

            eventosRecentes.push(...analise.eventos);
        } catch (err) {
            arquivos[item.id] = {
                id: item.id,
                modulo: item.modulo,
                nome: item.nome,
                subtitulo: item.subtitulo || `Log (${item.arquivo})`,
                arquivo: item.arquivo,
                caminho: item.caminhos[0],
                disponivel: false,
                auto: !!item.auto,
                estado_log: 'erro',
                motivo_estado: `Erro ao ler log: ${err.message}`,
            };
        }
    }

    return { arquivos, eventosRecentes };
}

function lerLogPorId(idOuArquivo, opcoes = {}) {
    const pastaRede = opcoes.pastaRede || PASTA_LOGS_REDE;
    const maxLinhas = Math.max(20, Math.min(Number(opcoes.linhas) || 400, 3000));
    const chave = String(idOuArquivo || '').trim().toLowerCase();
    const catalogoCompleto = descobrirCatalogoLogs(pastaRede);

    const item = catalogoCompleto.find(
        c => c.id.toLowerCase() === chave || c.modulo.toLowerCase() === chave || c.arquivo.toLowerCase() === chave
    );
    if (!item) {
        return { sucesso: false, erro: `Arquivo de log não mapeado para "${idOuArquivo}".` };
    }
    const achado = resolverCaminho(item, pastaRede);
    if (!achado) {
        return {
            sucesso: false,
            erro: `Arquivo ${item.arquivo} não encontrado em ${item.caminhos[0]}.`,
            id: item.id,
            modulo: item.modulo,
            nome: item.nome,
            arquivo: item.arquivo,
            caminho: item.caminhos[0],
        };
    }
    try {
        const res = lerFinalArquivo(achado.caminho, maxLinhas, maxLinhas * 400);
        const nomeArq = path.basename(achado.caminho);
        const analise = analisarEstadoLog(res.linhas, achado.st.mtime, { ...item, arquivo: nomeArq });
        return {
            sucesso: true,
            id: item.id,
            modulo: item.modulo,
            nome: item.nome,
            arquivo: nomeArq,
            caminho: achado.caminho,
            tamanho: res.tamanho,
            modificado_em: res.modificado_em,
            truncado: res.truncado,
            estado_log: analise.estado_log,
            motivo_estado: analise.motivo_estado,
            ultimo_erro: analise.ultimo_erro,
            linhas: res.linhas,
        };
    } catch (e) {
        return {
            sucesso: false,
            erro: `Erro ao ler ${achado.caminho}: ${e.message}`,
            id: item.id,
            modulo: item.modulo,
            nome: item.nome,
            arquivo: path.basename(achado.caminho),
            caminho: achado.caminho,
        };
    }
}

module.exports = {
    PASTA_LOGS_REDE,
    CATALOGO_LOGS,
    descobrirCatalogoLogs,
    formatarNomeRoboDeArquivo,
    lerLogPorId,
    resumirArquivosLog,
    analisarEstadoLog,
    ehLinhaErro,
    ehLinhaAviso,
    ehLinhaFimSessao,
    classificarLinhaLog,
    decodificarBufferPorLinha,
};
