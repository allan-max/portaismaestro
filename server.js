const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const cron = require('node-cron');
// Só a nova credencial vem do .env; as demais opções mantêm a configuração existente do processo/PM2.
const arquivoEnvMaestro = path.join(__dirname, '.env');
const segredoRoboConfigurado = process.env.ROBO_SECRET ?? (fs.existsSync(arquivoEnvMaestro)
    ? require('dotenv').parse(fs.readFileSync(arquivoEnvMaestro)).ROBO_SECRET : '');
const { criarDashboardCotacoes } = require('./lib/dashboard-cotacoes');
const { criarDashboardFontes } = require('./lib/dashboard-fontes');


// 🛡️ AIRBAG ANTI-CRASH (Impede o servidor de morrer por erros invisíveis)
process.on('uncaughtException', (err) => console.error('Erro Crítico (Não tratado):', err));
process.on('unhandledRejection', (err) => console.error('Promessa Rejeitada:', err));

const app = express();
const server = http.createServer(app);

//  O SONAR  👇
/*
app.use((req, res, next) => {
    console.log(`[SONAR] 🔎 Alguém está a tentar entrar: ${req.method} ${req.url}`);
    next(); // Passa a visita para a próxima etapa
});
*/

// 🛡️ CONFIGURAÇÃO DE SEGURANÇA GLOBAL
app.use(helmet({
    contentSecurityPolicy: false, 
}));
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*', 
    methods: ["GET", "POST"]
}));

const io = new Server(server, { maxHttpBufferSize: 1e8, 
    cors: { 
        origin: process.env.ALLOWED_ORIGIN || '*',
        methods: ["GET", "POST"]
    } 
});

// 🔐 MOTORES DE CRIPTOGRAFIA REAL (AES-256-GCM)
const MASTER_KEY = crypto.scryptSync(process.env.MASTER_SECRET || 'chave-padrao-temporaria-substitua-no-env', 'salt', 32);

function encrypt(text) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', MASTER_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(cipherText) {
    try {
        const [ivHex, authTagHex, encryptedHex] = cipherText.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', MASTER_KEY, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        return null;
    }
}

// 💾 NOVO SISTEMA: Salva no HD temporário em vez de explodir a RAM
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, os.tmpdir()); // Guarda na pasta oculta /tmp do servidor
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB por arquivo
});

const { v4: uuidv4 } = require('uuid');
const cofreSessoes = new Map();

require('dns').setDefaultResultOrder('ipv4first');


app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: 0,
    etag: true
}));
app.use(express.json());

let estado_global = { status: 'desligado', portal_atual: null, fila_pendente: [], tarefas_concluidas: [] };
let estado_me = { status: 'desligado' };
let estado_ariba = { status: 'desligado' };
let fila_respostas = [];
let bot_socket_id = null;
let sync_socket_id = null;   // serviço de NF (cruzar_nf/servico.py)
let usuarios_logados = {};
const dashboardCotacoes = criarDashboardCotacoes({
    sessoes: cofreSessoes, io, obterRobo: () => bot_socket_id,
    obterSocket: id => io.sockets.sockets.get(id)
});
// Faixa "Saúde dos serviços": quando cada serviço conectou e mandou a última mensagem (sem batimento extra).
const conexoes = {
    gerenciador: { online: false, conectado_em: null, visto_em: null, desconectado_em: null },
    nf: { online: false, conectado_em: null, visto_em: null, desconectado_em: null },
};
function marcarConexao(nome, online) {
    const agora = new Date().toISOString();
    Object.assign(conexoes[nome], online ? { online: true, conectado_em: agora, visto_em: agora }
        : { online: false, desconectado_em: agora });
}
const dashboardFontes = criarDashboardFontes({
    sessoes: cofreSessoes, io, obterSocket: id => io.sockets.sockets.get(id),
    obterRobo: () => bot_socket_id, obterSync: () => sync_socket_id,
    obterConexoes: () => JSON.parse(JSON.stringify(conexoes))
});

function notificar_todos(mensagem = null) {
    estado_global.tamanho_fila = fila_respostas.length;
    io.to('frontend').emit('sincronizar_estado', { estado: estado_global, mensagem: mensagem });
}

io.use((socket, next) => {
    const authData = socket.handshake.auth || {};
    const segredoRobo = segredoRoboConfigurado;
    if (typeof segredoRobo === 'string' && segredoRobo.length >= 32 &&
        typeof authData.robo_secret === 'string' &&
        Buffer.byteLength(authData.robo_secret) === Buffer.byteLength(segredoRobo) &&
        crypto.timingSafeEqual(Buffer.from(authData.robo_secret), Buffer.from(segredoRobo))) {
        socket.isBot = true;
        return next();
    }
    const sessionId = authData.sessionId;
    if (!sessionId) {
        socket.autenticado = false;
        return next();
    }
    const fichaStr = cofreSessoes.get(sessionId);
    if (!fichaStr) {
        socket.autenticado = false;
        return next();
    }
    const ficha = JSON.parse(fichaStr);
    if (Date.now() > ficha.expires) {
        cofreSessoes.delete(sessionId);
        socket.autenticado = false;
        return next();
    }
    socket.autenticado = true;
    socket.usuarioLogado = ficha;
    socket.sessionId = sessionId;
    next();
});

io.on('connection', (socket) => {
    dashboardCotacoes.conectar(socket);
    dashboardFontes.conectar(socket);
    socket.onAny(() => {
        const nome = socket.id === bot_socket_id ? 'gerenciador' : socket.id === sync_socket_id ? 'nf' : null;
        if (nome) conexoes[nome].visto_em = new Date().toISOString();
    });
    // Respostas das fontes para os dashboards (Sync, NFs, Atividade): só o socket certo é aceito.
    for (const evento of ['retorno_sync_planilha_painel', 'retorno_nf_painel', 'retorno_eventos_nf', 'retorno_eventos']) {
        socket.on(evento, (dados = {}) => dashboardFontes.receber(evento, socket.id, dados));
    }

    // Cancelar Evento da Fila
    socket.on('remover_da_fila', (dados) => {
        const eventoId = dados.evento;

        // Proteção: não cancela se já estiver a ser preenchido pelo robô
        if (fila_respostas.length > 0 && fila_respostas[0].id === eventoId && estado_global.status === 'respondendo') {
            return; // Já está no forno, não pode cancelar!
        }

        fila_respostas = fila_respostas.filter(e => e.id !== eventoId);
        if (estado_global.fila_pendente) {
            estado_global.fila_pendente = estado_global.fila_pendente.filter(e => e !== eventoId);
        }
        notificar_todos(`🚫 Evento ${eventoId} cancelado pelo utilizador.`);
    });
    
    const checkRole = (role) => {
        if (!socket.autenticado) return false;
        if (role === 'admin' && !socket.usuarioLogado.admin) return false;
        if (role === 'dev' && !socket.usuarioLogado.dev) return false;
        return true;
    };

    socket.on('sou_o_robo', () => {
        if (!socket.isBot) return socket.emit('robo_recusado', { erro: 'Identificação de serviço inválida.' });
        bot_socket_id = socket.id; marcarConexao('gerenciador', true);
        socket.autenticado = true; socket.join('backend');
        console.log("🤖 Robô Local Conectado.");
        io.emit('sincronizar_estado', { estado: estado_global, mensagem: "Robô operacional e conectado!" });
    });


    // === PONTES DE CAPTCHA (ROBÔ <-> SITE) ===
    socket.on('imagem_captcha_do_robo', (dados) => {
        // Envia a imagem do desafio para todos os navegadores na sala frontend
        io.to('frontend').emit('nova_imagem', dados);
    });

    socket.on('contagem_coupa_vale', (dados) => io.to('frontend').emit('atualizar_contagem_coupa_vale', dados));

    socket.on('clique_no_captcha', (dados) => {
        // Repassa o clique do usuário diretamente para o robô local
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('executar_clique', dados);
        }
    });

    // === PONTES DE RELATÓRIOS (ROBÔ -> SITES) ===
    socket.on('relatar_progresso', (dados) => io.to('frontend').emit('relatar_progresso', dados));
    socket.on('relatar_progresso_me', (dados) => io.to('frontend').emit('relatar_progresso_me', dados));
    socket.on('relatar_progresso_coupa', (dados) => io.to('frontend').emit('relatar_progresso_coupa', dados));
    socket.on('relatar_progresso_vale', (dados) => io.to('frontend').emit('relatar_progresso_vale', dados));
    socket.on('relatar_progresso_findes', (dados) => io.to('frontend').emit('relatar_progresso_findes', dados));
    socket.on('relatar_progresso_ariba', (dados) => io.to('frontend').emit('relatar_progresso_ariba', dados));

    socket.on('contagem_me', (dados) => io.to('frontend').emit('atualizar_contagem_me', dados));
    socket.on('contagem_ariba', (dados) => io.to('frontend').emit('atualizar_contagem_ariba', dados));
    
    socket.on('sincronizar_estado_me', (dados) => { estado_me = dados; io.to('frontend').emit('sincronizar_estado_me', dados); });
    socket.on('sincronizar_estado_ariba', (dados) => { estado_ariba = dados; io.to('frontend').emit('sincronizar_estado_ariba', dados); });

    socket.on('tarefa_concluida', (dados) => {
        // 👇 NOVA ROTINA PARA CONTROLE DE FILA (EVENTOS) 👇
        if (dados.evento && dados.evento.startsWith('Evento ')) {
            const eventoId = dados.evento.replace('Evento ', '');

            // 1. Remove da Fila Pendente
            fila_respostas = fila_respostas.filter(e => e.id !== eventoId);
            if (estado_global.fila_pendente) {
                estado_global.fila_pendente = estado_global.fila_pendente.filter(e => e !== eventoId);
            }

            // 2. Move para os Concluídos
            if (dados.sucesso) {
                if (!estado_global.tarefas_concluidas) estado_global.tarefas_concluidas = [];
                if (!estado_global.tarefas_concluidas.includes(eventoId)) {
                    estado_global.tarefas_concluidas.push(eventoId);
                }
            }

            // 3. PUXA O PRÓXIMO DA FILA
            processarProximoDaFila();
            notificar_todos();

        } else {
            // 👇 ROTINA ORIGINAL PARA AS OUTRAS TAREFAS 👇
            if (dados.portal === 'ariba') {
                if (estado_ariba.status !== 'desligado') estado_ariba.status = 'ocioso';
                io.to('frontend').emit('sincronizar_estado_ariba', estado_ariba);
            } else if (dados.portal === 'me') {
                if (estado_me.status !== 'desligado') estado_me.status = 'ocioso';
                io.to('frontend').emit('sincronizar_estado_me', estado_me);
            } else {
                if (dados.evento === 'Login do Robô') {
                    if (dados.sucesso) estado_global.status = 'ocioso';
                    else { estado_global.status = 'desligado'; estado_global.portal_atual = null; }
                } else {
                    if (estado_global.status !== 'desligado') {
                        estado_global.status = 'ocioso';
                    }
                }
                notificar_todos();
            }
            io.to('frontend').emit('tarefa_concluida', dados);
        }
    });

    socket.on('sou_frontend', (dados) => {
        if (!socket.autenticado) {
            if (socket.handshake.auth.sessionId) socket.emit('sessao_invalida');
            return;
        }
        socket.join('frontend');
        if (dados && dados.usuario) {
            usuarios_logados[dados.usuario] = socket.id;
            const alerta = encrypt(`🔵 Usuário ${dados.usuario} Online`);
            io.emit('alerta_admin_cifrado', { payload: alerta });
        }
        socket.emit('sincronizar_estado', { estado: estado_global, mensagem: "Conectado com segurança." });
        socket.emit('sincronizar_estado_me', estado_me);
        socket.emit('sincronizar_estado_ariba', estado_ariba);
    });

    socket.on('pedir_dados_dev_seguro', (dados) => {
        // Agora permite se for Dev OU Admin
        if (!checkRole('dev') && !checkRole('admin')) return; 
        
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('pedir_dados_dev_seguro', { 
                payload_cifrado: dados.payload_cifrado, 
                online_users: Object.keys(usuarios_logados),
                clientId: socket.id 
            });
        }
    });

    socket.on('comando_dev_acao_seguro', (dados) => {
        // Agora permite se for Dev OU Admin
        if (!checkRole('dev') && !checkRole('admin')) return; 
        
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('comando_dev_acao_seguro', { payload_cifrado: dados.payload_cifrado, clientId: socket.id });
        }
    });

    socket.on('resposta_painel_dev_cifrado', (dados) => {
        io.to(dados.clientId).emit('dados_dev_prontos_cifrados', dados.payload);
    });

    socket.on('promover_usuario', (dados) => {
        if (!checkRole('admin')) return;
        if (bot_socket_id) io.to(bot_socket_id).emit('comando_promover_usuario', { ...dados, clientId: socket.id });
    });

    socket.on('solicitar_impressao', (dados) => {
        if (!socket.autenticado) return;
        if (dados.portal === 'ariba') {
            estado_ariba.status = 'ocupado';
            io.to('frontend').emit('sincronizar_estado_ariba', estado_ariba);
        } else if (dados.portal === 'me') {
            estado_me.status = 'ocupado';
            io.to('frontend').emit('sincronizar_estado_me', estado_me);
        } else {
            estado_global.status = 'ocupado';
            notificar_todos();
        }
        if (bot_socket_id) io.to(bot_socket_id).emit('comando_imprimir', dados);
    });

    socket.on('comando_direto', (dados) => {
        if (!socket.autenticado) return;
        
        // Só altera o estado GLOBAL (travando a tela) se for Coupa ou Vale
        if (dados.portal === 'coupa' || dados.portal === 'vale') {
            if (dados.modo === 'ligar_robo') {
                estado_global.status = 'logando';
                estado_global.portal_atual = dados.portal;
            } else if (dados.modo === 'desligar_robo') {
                estado_global.status = 'desligado';
                estado_global.portal_atual = null;
            } else if (dados.modo === 'extrair') {
                estado_global.status = 'extraindo';
            } else if (dados.modo === 'verificar') {
                estado_global.status = 'verificando';
            } else if (dados.modo === 'solicitar_parada' || dados.modo === 'parar_extracao') {
                // 👇 A CHAVE MÁGICA PARA A INTERFACE NÃO PISCAR E VOLTAR AO NORMAL 👇
                estado_global.status = 'parando'; 
            }
            notificar_todos();
        }

        if (bot_socket_id) io.to(bot_socket_id).emit('comando_para_robo', dados);
    });

    // === SISTEMA DE LOGIN (PONTE FRONTEND -> ROBÔ) ===
    socket.on('solicitar_login', (dados) => {
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('validar_login', { ...dados, clientId: socket.id });
        } else {
            socket.emit('resposta_login', { sucesso: false, erro: "O Servidor Central (Robô) está offline." });
        }
    });

    socket.on('resultado_login', (dados) => {
        if (!socket.isBot || socket.id !== bot_socket_id) return;
        if (dados.sucesso) {
            const sessionId = uuidv4();
            const expires = Date.now() + (28800 * 1000); 
            cofreSessoes.set(sessionId, JSON.stringify({ 
                email: dados.user, 
                admin: dados.isAdmin, 
                dev: dados.isDev,
                dashboard_access: dados.hasDashboardAccess,
                planilha_access: dados.hasPlanilhaAccess, // <-- NOVO
                portais_access: dados.hasPortaisAccess,   // <-- NOVO
                vendedor: dados.vendedor || '',
                expires: expires 
            }));
            
            io.to(dados.clientId).emit('resposta_login', { 
                sucesso: true, 
                sessionId: sessionId,
                admin: dados.isAdmin, 
                dev: dados.isDev,
                dashboard_access: dados.hasDashboardAccess,
                planilha_access: dados.hasPlanilhaAccess, // <-- NOVO
                portais_access: dados.hasPortaisAccess,   // <-- NOVO
                vendedor: dados.vendedor || ''
            });
        } else {
            io.to(dados.clientId).emit('resposta_login', dados);
        }
    });

    socket.on('solicitar_cadastro', (dados) => {
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('registrar_usuario', { ...dados, clientId: socket.id });
        } else {
            // 🛑 Avisa o usuário que o robô local está desligado
            socket.emit('resposta_cadastro', { sucesso: false, erro: "O Servidor Central Maestro está offline." });
        }
    });

    // ✅ NOVO: Repassa a resposta do robô de volta para o frontend
    socket.on('resposta_cadastro', (dados) => {
        io.to(dados.clientId).emit('resposta_cadastro', dados);
    });



    socket.on('validar_token_email', (dados) => {
        if (bot_socket_id) io.to(bot_socket_id).emit('verificar_token_python', { ...dados, clientId: socket.id });
        else socket.emit('resposta_verificacao_token', { sucesso: false, erro: "O Servidor Central Maestro está offline." });
    });

    socket.on('resultado_verificacao_token', (dados) => {
        io.to(dados.clientId).emit('resposta_verificacao_token', dados);
    });

    socket.on('solicitar_recuperacao', (dados) => {
        if (bot_socket_id) io.to(bot_socket_id).emit('gerar_token_recuperacao', { ...dados, clientId: socket.id });
        else socket.emit('resposta_recuperacao_solicitada', { sucesso: false, erro: "O Servidor Central Maestro está offline." });
    });

    socket.on('resposta_recuperacao_solicitada', (dados) => {
        io.to(dados.clientId).emit('resposta_recuperacao_solicitada', dados);
    });

    socket.on('salvar_nova_senha', (dados) => {
        if (bot_socket_id) io.to(bot_socket_id).emit('processar_nova_senha', { ...dados, clientId: socket.id });
        else socket.emit('resposta_nova_senha', { sucesso: false, erro: "O Servidor Central Maestro está offline." });
    });

    socket.on('resultado_nova_senha', (dados) => {
        io.to(dados.clientId).emit('resposta_nova_senha', dados);
    });

    socket.on('disconnect', () => {
        for (let email in usuarios_logados) {
            if (usuarios_logados[email] === socket.id) delete usuarios_logados[email];
        }
        dashboardFontes.limparCliente(socket.id);
        if (socket.id === bot_socket_id) {
            bot_socket_id = null; marcarConexao('gerenciador', false);
            console.log("❌ Ligação com o Robô Local perdida.");
        }
        if (socket.id === sync_socket_id) {
            sync_socket_id = null; marcarConexao('nf', false);
            console.log("❌ Serviço de NF desconectado.");
        }
    });

    // === PAINEL ADMIN (Contas e Privilégios) ===
    function lerUsuariosLocais() {
        const possiveisCaminhos = [
            path.join(__dirname, '..', 'senhas gerenciador', 'banco_usuarios.json'),
            path.join(__dirname, '..', 'gerenciador', 'banco_usuarios.json')
        ];
        let db = null;
        for (const p of possiveisCaminhos) {
            if (fs.existsSync(p)) {
                try {
                    db = JSON.parse(fs.readFileSync(p, 'utf8'));
                    break;
                } catch(e) {}
            }
        }
        if (!db) return null;
        const onlineUsers = Object.keys(usuarios_logados);
        const lista = {};
        for (let email in db) {
            lista[email] = {
                verificado: db[email].verificado !== false,
                admin: !!db[email].admin,
                dev: !!db[email].dev,
                dashboard_access: !!db[email].dashboard_access,
                planilha_access: !!db[email].planilha_access,
                portais_access: !!db[email].portais_access,
                bloqueado: !!db[email].bloqueado,
                vendedor: db[email].vendedor || '',
                online: onlineUsers.includes(email)
            };
        }
        return lista;
    }

    const pedidosPendentes = new Set();

    socket.on('admin_pedir_usuarios', () => {
        if (!socket.autenticado) {
            socket.emit('sessao_invalida');
            return;
        }
        if (!checkRole('admin')) {
            socket.emit('admin_receber_usuarios', { 
                sucesso: false, 
                erro: "Sua conta não possui permissão de Administrador (admin: true) na sessão atual. Saia e faça login novamente." 
            });
            return;
        }
        if (bot_socket_id) {
            pedidosPendentes.add(socket.id);
            io.to(bot_socket_id).emit('admin_listar_usuarios', { clientId: socket.id });

            // Se o robô não responder em 2.5s, usa o fallback local para não travar a tela
            setTimeout(() => {
                if (pedidosPendentes.has(socket.id)) {
                    pedidosPendentes.delete(socket.id);
                    const locais = lerUsuariosLocais();
                    if (locais) {
                        socket.emit('admin_receber_usuarios', { sucesso: true, usuarios: locais });
                    }
                }
            }, 2500);
        } else {
            const locais = lerUsuariosLocais();
            if (locais) {
                socket.emit('admin_receber_usuarios', { sucesso: true, usuarios: locais });
            } else {
                socket.emit('admin_receber_usuarios', { 
                    sucesso: false, 
                    erro: "O Servidor Central Maestro (gerenciador.py) está desconectado e o banco local não foi encontrado." 
                });
            }
        }
    });

    socket.on('admin_resposta_usuarios', (dados) => {
        if (socket.id !== bot_socket_id) return; // só o gerenciador responde
        pedidosPendentes.delete(dados.clientId);
        if (dados.sucesso && dados.usuarios) {
            const onlineUsers = Object.keys(usuarios_logados);
            for (let email in dados.usuarios) dados.usuarios[email].online = onlineUsers.includes(email);
        }
        io.to(dados.clientId).emit('admin_receber_usuarios', dados);
    });

    socket.on('admin_alterar_acesso_dashboard', (dados) => {
        if (!checkRole('admin')) return;
        const campo = ['dashboard_access', 'planilha_access', 'portais_access'].includes(dados.campo)
            ? dados.campo
            : 'dashboard_access';

        if (bot_socket_id) {
            io.to(bot_socket_id).emit('admin_alterar_acesso_dashboard', { 
                email: dados.email, 
                campo: campo,
                acesso: dados.acesso, 
                clientId: socket.id 
            });
        } else {
            socket.emit('admin_acesso_alterado', { sucesso: false, erro: "O Servidor Central Maestro está offline." });
        }
    });

    socket.on('admin_resposta_acesso', (dados) => {
        if (socket.id !== bot_socket_id) return; // só o gerenciador responde
        io.to(dados.clientId).emit('admin_acesso_alterado', dados);
    });

    socket.on('admin_alterar_vendedor_usuario', (dados) => {
        if (!checkRole('admin')) return;
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('admin_alterar_vendedor_usuario', { 
                email: dados.email, 
                vendedor: dados.vendedor, 
                clientId: socket.id 
            });
        } else {
            socket.emit('admin_vendedor_alterado', { sucesso: false, erro: "O Robô está offline." });
        }
    });

    socket.on('admin_resposta_vendedor', (dados) => {
        if (socket.id !== bot_socket_id) return;
        io.to(dados.clientId).emit('admin_vendedor_alterado', dados);
    });

    socket.on('pedir_config_admin', () => {
        if (!checkRole('admin')) return;
        if (bot_socket_id) io.to(bot_socket_id).emit('pedir_config_admin', { clientId: socket.id });
    });

    socket.on('salvar_config_admin', (dados) => {
        if (!checkRole('admin')) return;
        if (bot_socket_id) io.to(bot_socket_id).emit('salvar_config_admin', { ...dados, clientId: socket.id });
    });

    socket.on('receber_config_admin', (dados) => {
        io.to(dados.clientId).emit('receber_config_admin', dados);
    });

    // Site pede os dados do Dashboard
    
    // Site pede para visualizar JSON
    
    socket.on('comando_apagar_linha', (dados = {}) => {
        if (bot_socket_id) {
            dados.clientId = socket.id;
            io.to(bot_socket_id).emit('comando_apagar_linha', dados);
        }
    });

    socket.on('comando_editar_linha', (dados = {}) => {
        if (bot_socket_id) {
            dados.clientId = socket.id;
            io.to(bot_socket_id).emit('comando_editar_linha', dados);
        }
    });

    socket.on('marcar_cotacao_respondida', (dados = {}) => {
        if (!socket.autenticado) return socket.emit('sessao_invalida');
        const campos = ['COTAÇÃO', 'VENDEDOR', 'LOCALIDADE', 'ITEM', 'VENCIMENTO'];
        const identidade = dados?.identidade;
        if (!identidade || !campos.every(c => typeof identidade[c] === 'string' && identidade[c].length <= 50000) ||
            !identidade['COTAÇÃO'].trim() || !identidade.VENDEDOR.trim()) {
            return socket.emit('resposta_acao_linha', { sucesso: false, erro: 'Cotação inválida.' });
        }
        if (!bot_socket_id) return socket.emit('resposta_acao_linha', { sucesso: false, erro: 'O Robô está offline.' });
        io.to(bot_socket_id).emit('comando_marcar_cotacao_respondida', {
            tipo: 'cotacoes', chave: identidade['COTAÇÃO'],
            identidade: Object.fromEntries(campos.map(c => [c, identidade[c]])),
            novos_dados: { RESPOSTA: 'RESPONDIDO' }, clientId: socket.id
        });
    });

    socket.on('resposta_acao_linha', (dados) => {
        if (socket.id !== bot_socket_id) return;
        if (dados.sucesso) io.emit('planilha_atualizada');
        if (dados.clientId) {
            io.to(dados.clientId).emit('resposta_acao_linha', dados);
        }
    });

    socket.on('solicitar_planilha_json', (dados = {}) => {
        if (!socket.autenticado) {
            socket.emit('sessao_invalida');
            return;
        }
        if (bot_socket_id) {
            dados.clientId = socket.id;
            const user = socket.usuarioLogado || {};
            const vendSessao = (user.vendedor || '').trim();
            const podeVerPlanilhaGeral = !!(user.admin || user.planilha_access);

            // Se pediu apenas o vendedor dele OU se não tem permissão de ver a Planilha Geral, trava no vendedor dele
            if (dados.apenas_meu_vendedor || (vendSessao && !podeVerPlanilhaGeral)) {
                dados.vendedor_filtro = vendSessao || '__NENHUM__';
            }
            io.to(bot_socket_id).emit('comando_carregar_planilha_json', dados);
        } else {
            socket.emit('retorno_planilha_json', { sucesso: false, erro: "O Robô está offline." });
        }
    });

    // Python devolve os dados JSON
    socket.on('retorno_planilha_json', (dados) => {
        if (socket.id !== bot_socket_id) return;
        if (dashboardCotacoes.receber(socket.id, dados)) return;
        if (dados.clientId) {
            io.to(dados.clientId).emit('retorno_planilha_json', dados);
        }
    });

    // SINCRONIZAÇÃO DE NF (HSE -> pedidos): tela -> serviço de NF -> tela
    // O serviço de NF é um processo separado do gerenciador (cruzar_nf/servico.py);
    // ele se identifica com o token SYNC_NF_TOKEN, configurado aqui e no .env do servidor.
    socket.on('sou_o_sync_nf', (dados = {}) => {
        const esperado = String(process.env.SYNC_NF_TOKEN || '');
        const recebido = String(dados.token || '');
        const ok = esperado.length > 0 && esperado.length === recebido.length &&
            crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(recebido));
        if (!ok) {
            console.log("⛔ Serviço de NF recusado (SYNC_NF_TOKEN ausente ou diferente).");
            socket.emit('sync_nf_recusado', {});
            return socket.disconnect(true);
        }
        sync_socket_id = socket.id; marcarConexao('nf', true);
        console.log("🧾 Serviço de NF conectado.");
    });

    socket.on('solicitar_sync_nf_estado', () => {
        if (!socket.rooms.has('frontend')) return;
        if (!sync_socket_id) return socket.emit('retorno_sync_nf_estado', { sucesso: false, erro: "O serviço de NF está offline." });
        io.to(sync_socket_id).emit('comando_sync_nf_estado', { clientId: socket.id });
    });

    socket.on('solicitar_sync_nf', (dados = {}) => {
        if (!socket.rooms.has('frontend')) return;
        if (!sync_socket_id) return socket.emit('retorno_sync_nf', { sucesso: false, erro: "O serviço de NF está offline." });
        io.to(sync_socket_id).emit('comando_sync_nf', {
            clientId: socket.id, de: dados.de || null, ate: dados.ate || null, gravar: dados.gravar !== false
        });
    });

    // NF NA PLANILHA DOS ESTAGIÁRIOS (botão "Gravar NF na planilha"): tela -> serviço de NF -> só quem pediu
    socket.on('solicitar_nf_planilha', (dados = {}) => {
        if (!socket.rooms.has('frontend')) return;
        if (!sync_socket_id) return socket.emit('retorno_nf_planilha', { sucesso: false, erro: "O serviço de NF está offline." });
        io.to(sync_socket_id).emit('comando_nf_planilha', { clientId: socket.id, gravar: dados.gravar === true });
    });
    socket.on('progresso_nf_planilha', (dados = {}) => {
        if (socket.id === sync_socket_id && dados.clientId) io.to(dados.clientId).emit('progresso_nf_planilha', dados);
    });
    socket.on('retorno_nf_planilha', (dados = {}) => {
        if (socket.id === sync_socket_id && dados.clientId) io.to(dados.clientId).emit('retorno_nf_planilha', dados);
    });

    socket.on('retorno_sync_nf_estado', (dados = {}) => {
        if (dashboardFontes.receber('retorno_sync_nf_estado', socket.id, dados)) return;   // faixa de saúde
        if (socket.id === sync_socket_id && dados.clientId) io.to(dados.clientId).emit('retorno_sync_nf_estado', dados);
    });

    // progresso e resultado vão para todas as telas: a rodada das 07:30 não tem clientId
    socket.on('progresso_sync_nf', (dados = {}) => {
        if (socket.id === sync_socket_id) io.to('frontend').emit('progresso_sync_nf', dados);
    });

    socket.on('retorno_sync_nf', (dados = {}) => {
        if (socket.id === sync_socket_id) io.to('frontend').emit('retorno_sync_nf', dados);
    });

    // O robô (Auto-Pilot) ou o serviço de NF avisam que a planilha mudou: as telas recarregam
    socket.on('planilha_atualizada', () => {
        if (socket.id === bot_socket_id || socket.id === sync_socket_id) io.to('frontend').emit('planilha_atualizada');
    });

    socket.on('pedir_dados_dashboard', (filtros) => {
        if (!dashboardCotacoes.administrador(socket)) {
            return socket.emit('receber_dados_dashboard', { sucesso: false, erro: 'Acesso exclusivo de administradores.' });
        }
        if (bot_socket_id) {
            // Repassa para o Python, enviando o ID e os filtros
            io.to(bot_socket_id).emit('comando_ler_excel_dashboard', { clientId: socket.id, filtros: filtros });
        } else {
            socket.emit('receber_dados_dashboard', { sucesso: false, erro: "O Robô (Gerenciador Python) está offline." });
        }
    });

    // Site pede para registrar vendedor na planilha
    socket.on('solicitar_registro_vendedor_cotacao', (dados) => {
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('comando_registrar_vendedor_cotacao', { clientId: socket.id, ...dados });
        } else {
            socket.emit('resposta_registro_vendedor_cotacao', { sucesso: false, erro: "O Robô (Gerenciador Python) está offline. Inicie o script no seu computador." });
        }
    });

    socket.on('retorno_registro_vendedor_cotacao', (dados) => {
        if (dados.sucesso) io.emit('planilha_atualizada');
        if (dados.clientId) {
            io.to(dados.clientId).emit('resposta_registro_vendedor_cotacao', dados);
        }
    });

    socket.on('status_registro_vendedor_cotacao', (dados) => {
        if (dados.clientId) {
            io.to(dados.clientId).emit('status_registro_vendedor', dados);
        }
    });

    // Site pede para registrar cotações manuais na planilha
    
    socket.on('solicitar_registro_pedido_manual', (dados) => {
        if (bot_socket_id) {
            dados.clientId = socket.id;
            io.to(bot_socket_id).emit('solicitar_registro_pedido_manual', dados);
        } else {
            socket.emit('resposta_registro_pedido_manual', { sucesso: false, erro: "Robô desconectado." });
        }
    });

    socket.on('resposta_registro_pedido_manual', (dados) => {
        if (dados.sucesso) io.emit('planilha_atualizada');
        if (dados.clientId) {
            io.to(dados.clientId).emit('resposta_registro_pedido_manual', dados);
        }
    });

    socket.on('solicitar_registro_cotacao_manual', (dados) => {
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('comando_registrar_cotacao_manual', { clientId: socket.id, ...dados });
        } else {
            socket.emit('resposta_registro_cotacao_manual', { sucesso: false, erro: "O Robô (Gerenciador Python) está offline." });
        }
    });

    socket.on('retorno_registro_cotacao_manual', (dados) => {
        if (dados.sucesso) io.emit('planilha_atualizada');
        if (dados.clientId) {
            io.to(dados.clientId).emit('resposta_registro_cotacao_manual', dados);
        }
    });

    // FILA EXTRAÇÃO
    socket.on('obter_fila_extracao', (dados) => io.to('backend').emit('obter_fila_extracao', dados));
    socket.on('iniciar_extracao_fila', (dados) => io.to('backend').emit('iniciar_extracao_fila', dados));
    socket.on('atualizar_fila_extracao', (dados) => {
        io.emit('atualizar_fila_extracao', dados);
    });
    socket.on('progresso_fila_extracao', (dados) => {
        io.emit('progresso_fila_extracao', dados);
    });

    // Python devolve os dados prontos, o Node envia de volta para a aba exata do site
    socket.on('retorno_dados_dashboard', (dados) => {
        if (socket.id !== bot_socket_id || !dashboardCotacoes.administrador(io.sockets.sockets.get(dados.clientId))) return;
        if (dados.clientId) {
            io.to(dados.clientId).emit('receber_dados_dashboard', dados);
        }
    });
});

// 🛠️ GESTOR DE FILA MAESTRO 🛠️
function processarProximoDaFila() {
    if (fila_respostas.length === 0) {
        if (estado_global.status === 'respondendo') {
            estado_global.status = 'ocioso';
            notificar_todos("Todas as respostas na fila foram concluídas.");
        }
        return;
    }

    // Pega o 1º da fila, mas não o apaga já
    const proximo = fila_respostas[0]; 
    estado_global.status = 'respondendo';

    if (bot_socket_id) {
        io.to(bot_socket_id).emit('comando_para_robo', proximo.payload);
        notificar_todos(`🤖 A iniciar o processamento do evento ${proximo.id}...`);
    } else {
        notificar_todos("⚠️ Aguardando robô conectar para processar a fila...");
    }
}

// =======================================================
// ROTA: RECEBER EVENTOS DO COUPA E MANDAR PARA O ROBÔ
// =======================================================
app.post('/api/responder', upload.fields([{ name: 'datasheet' }, { name: 'dav' }]), (req, res) => {
    try {
        const sessionId = req.body.sessionId;
        if (!cofreSessoes.has(sessionId)) return res.status(401).json({ error: "Sessão inválida" });

        const evento = req.body.evento;
        const precos = JSON.parse(req.body.precos || '[]');
        const prazos = JSON.parse(req.body.prazos || '[]');
        const origens = JSON.parse(req.body.origens || '[]');
        const icms = JSON.parse(req.body.icms || '[]');

        // FUNÇÃO NOVA: Lê do Disco HD, converte e apaga a prova do crime
        const processarArquivos = (filesArray) => {
            const result = [];
            if (filesArray) {
                filesArray.forEach(file => {
                    try {
                        // 1. Lê o arquivo direto do HD
                        const fileData = fs.readFileSync(file.path);
                        // 2. Transforma em Base64 para o Python
                        result.push({ name: file.originalname, data: fileData.toString('base64') });
                        
                        // 3. Apaga o arquivo do HD para manter o servidor limpo!
                        fs.unlinkSync(file.path);
                    } catch (err) {
                        console.error(`Erro ao processar arquivo ${file.originalname}:`, err);
                    }
                });
            }
            return result;
        };

        // Transforma os Datasheets e DAVs usando a nova função (MANTIDO INTACTO)
        const datasheets = processarArquivos(req.files['datasheet']);
        const davs = processarArquivos(req.files['dav']);

        // 👇 AQUI: Extrai o portal que vem do site (se não vier, assume coupa por segurança)
        const portal_origem = req.body.portal || 'coupa';

        // 1. Cria o pacote com todos os dados
        const payload = {
            modo: 'responder', 
            portal: portal_origem, // 👈 Usa a variável dinâmica aqui!
            evento: evento,
            precos: precos, 
            prazos: prazos, 
            origens: origens,
            icms: icms, 
            datasheets: datasheets, 
            davs: davs
        };

        // 2. Adiciona à fila real de trabalho do servidor
        fila_respostas.push({ id: evento, payload: payload });
        
        // 3. Adiciona à fila visual para aparecer no site
        if (!estado_global.fila_pendente) estado_global.fila_pendente = [];
        estado_global.fila_pendente.push(evento);

        // 4. Responde ao site IMEDIATAMENTE dizendo que deu certo (libera a interface do utilizador)
        res.json({ sucesso: true, mensagem: "Evento adicionado à fila." });

        // 5. O GESTOR DE FILA ENTRA EM AÇÃO:
        // Se o robô estiver parado (ocioso), acorda-o para começar a fila.
        // Se já estiver a trabalhar, apenas avisa na tela que entrou na espera.
        if (estado_global.status !== 'respondendo') {
            processarProximoDaFila();
        } else {
            notificar_todos(`📥 Evento ${evento} entrou na fila de espera.`);
        }

    } catch (error) {
        console.error("Erro no /api/responder:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// === GROQ IA (SEGURANÇA) ===
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: "tirei a api" });

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        if (!userMessage || userMessage.length > 500) return res.status(400).json({ error: "Mensagem inválida." });

        const prompt = `Você é a MAESTRO IA, o assistente virtual exclusivo do portal MAESTRO. 
Sua função é guiar os usuários no uso dos módulos do site (Coupa, Vale, Findes, Ariba, Mercado Eletrônico (ME) e Planilha Vale).
Informações essenciais do sistema:
- Todos os robôs/módulos precisam que o usuário clique em "Ligar" primeiro para funcionarem.
- A exceção é o SAP Ariba, onde o usuário precisa obrigatoriamente selecionar as empresas ANTES de clicar em ligar.
- A página "Planilha Vale" serve para registrar o vendedor para cotações específicas diretamente na planilha da rede, suportando separação por vírgula ou espaço e verificando bloqueios caso a planilha esteja aberta.
Regras rígidas:
1. Se o usuário tiver um problema que você não sabe resolver, peça para ele enviar um email para: suporte@venturainformatica.com.br
2. NÃO FUJA DO ASSUNTO. Responda apenas sobre o portal Maestro.
3. NUNCA mostre ou explique trechos de código, não fale de programação ou arquitetura.`;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: prompt },
                { role: "user", content: userMessage }
            ],
            model: "openai/gpt-oss-120b",
            temperature: 0.5,
        });
        res.json({ reply: chatCompletion.choices[0].message.content });
    } catch (error) {
        console.error("Erro no chat:", error);
        res.status(500).json({ error: "Falha na comunicação com IA." });
    }
});

// === ROTA DE SAÚDE EXCLUSIVA PARA O RENDER ===
// O Render fica acessando essa rota para saber se o seu servidor não travou!
app.get('/health', (req, res) => {
    res.status(200).send("MAESTRO Cloud Server OK!");
});

const PORT = process.env.PORT || 8000;

// 👇 O '0.0.0.0' AQUI É A CHAVE MÁGICA PARA O RENDER FUNCIONAR 👇
server.listen(PORT, process.env.HOST || '0.0.0.0', () => {
    console.log(`🛡️ Servidor Protegido rodando na porta ${PORT}`);
});
