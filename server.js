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

require('dotenv').config();

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

function notificar_todos(mensagem = null) {
    estado_global.tamanho_fila = fila_respostas.length;
    io.to('frontend').emit('sincronizar_estado', { estado: estado_global, mensagem: mensagem });
}

io.use((socket, next) => {
    const authData = socket.handshake.auth;
    if (authData.robo_secret === (process.env.ROBO_SECRET || "VEMKAUAN")) {
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
        bot_socket_id = socket.id;
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
        if (dados.sucesso) {
            const sessionId = uuidv4();
            const expires = Date.now() + (28800 * 1000); 
            cofreSessoes.set(sessionId, JSON.stringify({ 
                email: dados.user, 
                admin: dados.isAdmin, 
                dev: dados.isDev,
                dashboard_access: dados.hasDashboardAccess,
                expires: expires 
            }));
            
            // ✅ CORREÇÃO: Envia para o navegador (clientId) em vez de enviar para o robô
            io.to(dados.clientId).emit('resposta_login', { 
                sucesso: true, 
                sessionId: sessionId,
                admin: dados.isAdmin, 
                dev: dados.isDev,
                dashboard_access: dados.hasDashboardAccess
            });
        } else {
            // ✅ CORREÇÃO: Envia o erro para o navegador (clientId)
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
    });

    socket.on('resultado_verificacao_token', (dados) => {
        io.to(dados.clientId).emit('resposta_verificacao_token', dados);
    });

    socket.on('solicitar_recuperacao', (dados) => {
        if (bot_socket_id) io.to(bot_socket_id).emit('gerar_token_recuperacao', { ...dados, clientId: socket.id });
    });

    socket.on('resposta_recuperacao_solicitada', (dados) => {
        io.to(dados.clientId).emit('resposta_recuperacao_solicitada', dados);
    });

    socket.on('salvar_nova_senha', (dados) => {
        if (bot_socket_id) io.to(bot_socket_id).emit('processar_nova_senha', { ...dados, clientId: socket.id });
    });

    socket.on('resultado_nova_senha', (dados) => {
        io.to(dados.clientId).emit('resposta_nova_senha', dados);
    });

    socket.on('disconnect', () => {
        for (let email in usuarios_logados) {
            if (usuarios_logados[email] === socket.id) delete usuarios_logados[email];
        }
        if (socket.id === bot_socket_id) {
            bot_socket_id = null;
            console.log("❌ Ligação com o Robô Local perdida.");
        }
        if (socket.id === sync_socket_id) {
            sync_socket_id = null;
            console.log("❌ Serviço de NF desconectado.");
        }
    });

    // === PAINEL ADMIN (Controle de Acessos e Status) ===
    socket.on('admin_pedir_usuarios', () => {
        if (!checkRole('admin')) return;
        const dbPath = path.join(__dirname, '..', 'banco_usuarios.json');
        fs.readFile(dbPath, 'utf8', (err, data) => {
            if (err) return;
            try {
                const db = JSON.parse(data);
                const onlineUsers = Object.keys(usuarios_logados);
                for (let email in db) {
                    db[email].online = onlineUsers.includes(email);
                }
                socket.emit('admin_receber_usuarios', db);
            } catch(e) {}
        });
    });

    socket.on('admin_alterar_acesso_dashboard', (dados) => {
        if (!checkRole('admin')) return;
        const dbPath = path.join(__dirname, '..', 'banco_usuarios.json');
        fs.readFile(dbPath, 'utf8', (err, data) => {
            if (err) {
                socket.emit('admin_acesso_alterado', { sucesso: false, erro: "Erro ao ler banco de dados" });
                return;
            }
            try {
                const db = JSON.parse(data);
                if (db[dados.email]) {
                    db[dados.email].dashboard_access = dados.acesso;
                    fs.writeFile(dbPath, JSON.stringify(db, null, 4), () => {
                        socket.emit('admin_acesso_alterado', { sucesso: true, email: dados.email, acesso: dados.acesso });
                        
                        // Atualizar sessão em tempo real se o usuário estiver logado
                        const userSession = Array.from(cofreSessoes.values()).find(s => {
                            const parsed = JSON.parse(s);
                            return parsed.email === dados.email;
                        });
                        
                        // Enviar atualização silenciosa para o cliente (opcional)
                    });
                }
            } catch(e) {
                socket.emit('admin_acesso_alterado', { sucesso: false, erro: "Erro ao salvar banco de dados" });
            }
        });
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

    socket.on('resposta_acao_linha', (dados) => {
        if (dados.sucesso) io.emit('planilha_atualizada');
        if (dados.clientId) {
            io.to(dados.clientId).emit('resposta_acao_linha', dados);
        }
    });

    socket.on('solicitar_planilha_json', (dados = {}) => {
        if (bot_socket_id) {
            dados.clientId = socket.id;
            io.to(bot_socket_id).emit('comando_carregar_planilha_json', dados);
        } else {
            socket.emit('retorno_planilha_json', { sucesso: false, erro: "O Robô está offline." });
        }
    });

    // Python devolve os dados JSON
    socket.on('retorno_planilha_json', (dados) => {
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
        sync_socket_id = socket.id;
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

    socket.on('retorno_sync_nf_estado', (dados = {}) => {
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
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🛡️ Servidor Protegido rodando na porta ${PORT}`);
});
