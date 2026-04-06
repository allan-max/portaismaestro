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

const app = express();
const server = http.createServer(app);

// 🛡️ CONFIGURAÇÃO DE SEGURANÇA GLOBAL
app.use(helmet({
    contentSecurityPolicy: false, // Ajuste conforme necessário para seus scripts externos
}));
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || '*', // No Render, defina ALLOWED_ORIGIN com sua URL
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

// Usamos memória em vez de disco
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 } // Limite de 10MB para arquivos
});

const { v4: uuidv4 } = require('uuid');
const cofreSessoes = new Map();

require('dns').setDefaultResultOrder('ipv4first');

const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.GMAIL_USER || "maestro.validacao@gmail.com", 
        pass: process.env.GMAIL_PASS // REMOVIDO: Senha em texto limpo
    }
    // TLS: Rejeição ativada por padrão para segurança (removido rejectUnauthorized: false)
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// === GESTÃO DE ESTADO ===
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

// === MIDDLEWARE DE AUTENTICAÇÃO ===
io.use((socket, next) => {
    const authData = socket.handshake.auth;

    // 1. Robô Python (Segurança por segredo no ENV)
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

// === WEBSOCKETS ===
io.on('connection', (socket) => {
    
    // Auxiliar para validar permissões no servidor
    const checkRole = (role) => {
        if (!socket.autenticado) return false;
        if (role === 'admin' && !socket.usuarioLogado.admin) return false;
        if (role === 'dev' && !socket.usuarioLogado.dev) return false;
        return true;
    };

    socket.on('sou_o_robo', () => {
        bot_socket_id = socket.id;
        console.log("🤖 Robô Local Conectado.");
    });

    socket.on('sou_frontend', (dados) => {
        if (!socket.autenticado) {
            if (socket.handshake.auth.sessionId) socket.emit('sessao_invalida');
            return;
        }
        socket.join('frontend');
        if (dados && dados.usuario) {
            usuarios_logados[dados.usuario] = socket.id;
            // Alerta admin agora usa criptografia AES
            const alerta = encrypt(`🔵 Usuário ${dados.usuario} Online`);
            io.emit('alerta_admin_cifrado', { payload: alerta });
        }
        socket.emit('sincronizar_estado', { estado: estado_global, mensagem: "Conectado com segurança." });
    });

    // 🛡️ PROTEÇÃO DE COMANDOS DEV (SERVER-SIDE VALIDATION)
    socket.on('pedir_dados_dev_seguro', (dados) => {
        if (!checkRole('dev')) return;
        
        if (bot_socket_id) {
            // Repassa para o bot e aguarda resposta
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
        // O servidor limpa dados sensíveis (como senhas) se necessário antes de repassar, 
        // mas aqui mantemos o fluxo cifrado ponta-a-ponta com o Token Master do DEV.
        io.to(dados.clientId).emit('dados_dev_prontos_cifrados', dados.payload);
    });

    socket.on('promover_usuario', (dados) => {
        if (!checkRole('admin')) {
            console.warn(`🚨 TENTATIVA DE ESCALADA DE PRIVILÉGIO: ${socket.usuarioLogado?.email}`);
            return;
        }
        if (bot_socket_id) io.to(bot_socket_id).emit('comando_promover_usuario', { ...dados, clientId: socket.id });
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
            const expires = Date.now() + (28800 * 1000); // 8 horas
            cofreSessoes.set(sessionId, JSON.stringify({ 
                email: dados.user, 
                admin: dados.isAdmin, 
                dev: dados.isDev, 
                expires: expires 
            }));
            
            socket.emit('resposta_login', { 
                sucesso: true, 
                sessionId: sessionId,
                admin: dados.isAdmin, 
                dev: dados.isDev 
            });
        } else {
            socket.emit('resposta_login', dados);
        }
    });

    socket.on('solicitar_cadastro', (dados) => {
        if (bot_socket_id) io.to(bot_socket_id).emit('registrar_usuario', { ...dados, clientId: socket.id });
    });

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


// === GROQ IA (SEGURANÇA) ===
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        // Validação básica de input
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

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`🛡️ Servidor Protegido rodando na porta ${PORT}`);
});

