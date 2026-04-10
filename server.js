const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');
const helmet = require('helmet');
const cors = require('cors');
const crypto = require('crypto');

require('dotenv').config();

// 🛡️ AIRBAG ANTI-CRASH (Impede o servidor de morrer por erros invisíveis)
process.on('uncaughtException', (err) => console.error('Erro Crítico (Não tratado):', err));
process.on('unhandledRejection', (err) => console.error('Promessa Rejeitada:', err));

const app = express();
const server = http.createServer(app);

// 🛡️ CONFIGURAÇÃO DE SEGURANÇA GLOBAL
app.use(helmet({
    contentSecurityPolicy: false, 
}));
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*', 
    methods: ["GET", "POST"]
}));

const io = new Server(server, { 
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

const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } 
});

const { v4: uuidv4 } = require('uuid');
const cofreSessoes = new Map();

require('dns').setDefaultResultOrder('ipv4first');


app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

let estado_global = { status: 'desligado', portal_atual: null, fila_pendente: [], tarefas_concluidas: [] };
let estado_me = { status: 'desligado' };
let estado_ariba = { status: 'desligado' };
let fila_respostas = [];
let bot_socket_id = null;
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
    
    const checkRole = (role) => {
        if (!socket.autenticado) return false;
        if (role === 'admin' && !socket.usuarioLogado.admin) return false;
        if (role === 'dev' && !socket.usuarioLogado.dev) return false;
        return true;
    };

    socket.on('sou_o_robo', () => {
        bot_socket_id = socket.id;
        console.log("🤖 Robô Local Conectado.");
        io.to('frontend').emit('sincronizar_estado', { estado: estado_global, mensagem: "Robô operacional e conectado!" });
    });

    // Dentro de io.on('connection', (socket) => { ... })
socket.on('comando_ponto', (dados) => {
    if (bot_socket_id) {
        io.to(bot_socket_id).emit('comando_ponto_robo', dados);
    }
});

socket.on('log_ponto', (dados) => {
    io.to('frontend').emit('atualizar_log_ponto', dados);
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
        if (dados.evento === 'Login do Robô') {
            if (dados.sucesso) estado_global.status = 'ocioso';
            else { estado_global.status = 'desligado'; estado_global.portal_atual = null; }
        } else {
            // 👇 O SEGREDO AQUI: O fantasma não pode ressuscitar o status! 👇
            if (estado_global.status !== 'desligado') {
                estado_global.status = 'ocioso';
            }
        }
        io.to('frontend').emit('tarefa_concluida', dados);
        notificar_todos();
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
        if (!checkRole('dev')) return;
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('pedir_dados_dev_seguro', { 
                payload_cifrado: dados.payload_cifrado, 
                online_users: Object.keys(usuarios_logados),
                clientId: socket.id 
            });
        }
    });

    socket.on('comando_dev_acao_seguro', (dados) => {
        if (!checkRole('dev')) return;
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
        estado_global.status = 'ocupado';
        notificar_todos();
        if (bot_socket_id) io.to(bot_socket_id).emit('comando_imprimir', dados);
    });

    socket.on('comando_direto', (dados) => {
        if (!socket.autenticado) return;
        
        // 👇 Só altera o estado GLOBAL (travando a tela) se for Coupa ou Vale 👇
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
            } else if (dados.modo === 'solicitar_parada') {
                estado_global.status = 'parando'; // 👇 CORRIGIDO
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
                expires: expires 
            }));
            
            // ✅ CORREÇÃO: Envia para o navegador (clientId) em vez de enviar para o robô
            io.to(dados.clientId).emit('resposta_login', { 
                sucesso: true, 
                sessionId: sessionId,
                admin: dados.isAdmin, 
                dev: dados.isDev 
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
    });
});

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

        // Converte os Datasheets recebidos para Base64 (Para viajar via Socket.io)
        const datasheets = [];
        if (req.files && req.files['datasheet']) {
            req.files['datasheet'].forEach(file => {
                datasheets.push({ name: file.originalname, data: file.buffer.toString('base64') });
            });
        }

        // Converte os DAVs recebidos para Base64
        const davs = [];
        if (req.files && req.files['dav']) {
            req.files['dav'].forEach(file => {
                davs.push({ name: file.originalname, data: file.buffer.toString('base64') });
            });
        }

        // Atualiza a tela de todo mundo dizendo que o robô entrou em modo de resposta (Ocupado)
        estado_global.status = 'respondendo';
        io.to('frontend').emit('sincronizar_estado', { estado: estado_global, mensagem: `Evento ${evento} enviado para a fila!` });

        // Manda o pacote completo pro Gerenciador Python local
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('comando_para_robo', {
                modo: 'responder',
                portal: 'coupa',
                evento: evento,
                precos: precos,
                prazos: prazos,
                origens: origens,
                icms: icms,
                datasheets: datasheets,
                davs: davs
            });
            res.json({ sucesso: true, mensagem: "Evento transmitido para o robô." });
        } else {
            res.status(503).json({ error: "Robô offline." });
        }
    } catch (error) {
        console.error("Erro no /api/responder:", error);
        res.status(500).json({ error: "Erro interno no servidor." });
    }
});

// === GROQ IA (SEGURANÇA) ===
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        if (!userMessage || userMessage.length > 500) return res.status(400).json({ error: "Mensagem inválida." });

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { role: "system", content: "Você é a MAESTRO IA..." },
                { role: "user", content: userMessage }
            ],
            model: "llama-3.1-8b-instant",
            temperature: 0.5,
        });
        res.json({ reply: chatCompletion.choices[0].message.content });
    } catch (error) {
        res.status(500).json({ error: "Falha na comunicação com IA." });
    }
});

// === ROTA DE SAÚDE (HEALTH CHECK) PARA O RENDER ===
// O Render fica acessando essa rota para saber se o seu servidor não travou!
app.get('/', (req, res) => {
    res.status(200).send("MAESTRO Cloud Server OK!");
});

// === ROTA DE SAÚDE EXCLUSIVA PARA O RENDER ===
app.get('/health', (req, res) => {
    res.status(200).send("OK");
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🛡️ Servidor Cloud a rodar na porta ${PORT}`);
});
