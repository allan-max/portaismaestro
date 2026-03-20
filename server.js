const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const nodemailer = require('nodemailer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Usamos memória em vez de disco, porque serviços cloud (como o Render) apagam ficheiros temporários
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// AGORA VOU COMEÇAR A BRINCADEIRA CONTRA O KAUAN
require('dotenv').config();
const { v4: uuidv4 } = require('uuid');

// ADICIONE ISTO: O nosso "Cofre" na memória RAM
const cofreSessoes = new Map();
console.log('🛡️ Cofre de Sessões em Memória RAM Ativado!');

require('dns').setDefaultResultOrder('ipv4first');

// FORÇAR O GMAIL A USAR IPV4
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com', // <-- MUDE DE 'service' PARA 'host'
    port: 465,              // <-- ADICIONE A PORTA
    secure: true,           // <-- FORCE CONEXÃO SEGURA
    auth: {
        user: "maestro.validacao@gmail.com", 
        pass: process.env.GMAIL_PASS || "Aaibumpjuhuhvhxfc"     
    },
    // Este parâmetro extra evita que a nuvem bloqueie o certificado SSL
    tls: {
        rejectUnauthorized: false
    }
});

// TESTE AUTOMÁTICO
transporter.verify(function(error, success) {
    if (error) {
        console.error("❌ ALERTA GMAIL:", error.message);
    } else {
        console.log("✅ GMAIL CONECTADO COM SUCESSO via IPv4! O Carteiro está pronto!");
    }
});
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// === GERENCIADOR DE ESTADO E FILA ===
// === GERENCIADOR DE ESTADO E FILA ===
let estado_global = {
    status: 'desligado',
    fila_pendente: [],
    tarefas_concluidas: [] 
};

// 👇 NOVA MEMÓRIA INDEPENDENTE PARA O ME 👇
let estado_me = { status: 'ocioso' };
let fila_respostas = [];
let bot_socket_id = null; // Guarda a ligação exclusiva do seu servidor Python local
let usuarios_logados = {};

function notificar_todos(mensagem = null) {
    estado_global.tamanho_fila = fila_respostas.length;
    // Avisa apenas os utilizadores com o site aberto (a "sala" do frontend)
    io.to('frontend').emit('sincronizar_estado', { estado: estado_global, mensagem: mensagem });
}

// === ROTA DE RECEÇÃO DE TAREFAS (COM PDFs) ===
app.post('/api/responder', upload.fields([{ name: 'datasheet' }, { name: 'dav' }]), async (req, res) => {
    try {
        // 👇 BLINDAGEM DA ROTA HTTP 👇
        const sessionId = req.body.sessionId;
        if (!sessionId) {
            return res.status(401).json({ status: "erro", mensagem: "Acesso Negado: Sem identificação." });
        }
        
        const fichaStr = cofreSessoes.get(sessionId);
        if (!fichaStr) {
            return res.status(401).json({ status: "erro", mensagem: "Acesso Negado: Sessão inválida." });
        }
        // 👆 FIM DA BLINDAGEM 👆

        if (!bot_socket_id) {
            return res.status(400).json({ status: "erro", mensagem: "O Robô local não está ligado!" });
        }

        const eventoId = req.body.evento;
        const precos = JSON.parse(req.body.precos || '[]');
        const prazos = JSON.parse(req.body.prazos || '[]');
        const origens = JSON.parse(req.body.origens || '[]'); 
        const icmsList = JSON.parse(req.body.icms || '[]');   
        
        // Converte os PDFs recebidos para Base64 para enviar via WebSocket
        const ds_files = (req.files['datasheet'] || []).map(f => ({
            nome: f.originalname,
            dados_base64: f.buffer.toString('base64')
        }));
        
        const dav_files = (req.files['dav'] || []).map(f => ({
            nome: f.originalname,
            dados_base64: f.buffer.toString('base64')
        }));

        const tarefa = {
            id_tarefa: Date.now().toString(),
            evento: eventoId,
            precos: precos,
            prazos: prazos,
            origens: origens,
            icms: icmsList,
            datasheets: ds_files,
            davs: dav_files
        };

        fila_respostas.push(tarefa);
        estado_global.fila_pendente.push(eventoId);
        
        notificar_todos(`Evento ${eventoId} adicionado à fila na nuvem!`);
        
        // Se o robô estiver livre, acorda-o e envia a primeira tarefa
        if (estado_global.status === 'ocioso') {
            processar_proxima_tarefa();
        }

        res.json({ status: "sucesso" });
    } catch (error) {
        console.error("Erro na API de resposta:", error);
        res.status(500).json({ status: "erro", mensagem: error.message });
    }
});

// Função que envia a tarefa da nuvem para o Windows Server
function processar_proxima_tarefa() {
    if (fila_respostas.length > 0 && bot_socket_id) {
        const tarefa = fila_respostas.shift();
        
        // Retira dos pendentes na interface
        estado_global.fila_pendente = estado_global.fila_pendente.filter(e => e !== tarefa.evento);
        estado_global.status = 'ocupado';
        
        notificar_todos(`A enviar evento ${tarefa.evento} para o robô local...`);
        
        // Envia a missão diretamente para o Python
        io.to(bot_socket_id).emit('missao_responder', tarefa);
    }
}

// MIDDLEWARE DE AUTENTICAÇÃO ESTADUAL (STATEFUL)
io.use((socket, next) => { // <-- Removido o 'async'
    // 1. Deixa o Robô Python passar
    if (socket.handshake.auth.robo_secret === "VEMKAUAN") { // <-- Já coloquei a senha em texto aqui pra não dar erro
        socket.isBot = true;
        return next();
    }

    const sessionId = socket.handshake.auth.sessionId;
    
    // 2. Se NÃO tem sessão (está no index.html querendo logar), entra no Lobby como Anônimo
    if (!sessionId) {
        socket.autenticado = false;
        return next();
    }

    // 3. Vai no cofre da Memória RAM (Substituiu o Redis)
    const fichaStr = cofreSessoes.get(sessionId); // <-- O ERRO FATAL ESTAVA AQUI!
    
    // 4. Se inventou uma sessão falsa ou a sessão expirou, entra como Anônimo
    if (!fichaStr) {
        socket.autenticado = false;
        return next();
    }

    // 5. Sessão verdadeira! Recebe o crachá e acesso total.
    socket.autenticado = true;
    socket.usuarioLogado = JSON.parse(fichaStr);
    socket.sessionId = sessionId;
    next();
});

// === GESTÃO DE WEBSOCKETS (FRONTEND vs ROBÔ) ===
io.on('connection', (socket) => {
    // === NOVA FUNÇÃO: O UTILIZADOR CLICOU EM REMOVER DA FILA ===
    socket.on('remover_da_fila', (dados) => {
        const eventoId = dados.evento;
        
        // Remove da visão geral
        estado_global.fila_pendente = estado_global.fila_pendente.filter(e => e !== eventoId);
        
        // Remove da memória profunda (onde estão os PDFs guardados)
        fila_respostas = fila_respostas.filter(tarefa => tarefa.evento !== eventoId);
        
        notificar_todos(`Evento ${eventoId} foi cancelado e removido da fila.`);
        io.emit('sincronizar_estado', { estado: estado_global }); // Atualiza a tela de todos na hora
    });
    
   // O Python deve emitir 'sou_o_robo' assim que ligar
    socket.on('sou_o_robo', () => {
        bot_socket_id = socket.id;
        estado_global.status = 'desligado'; // Ele conecta, mas espera você mandar Ligar!
        console.log("🤖 Robô Local Conectado ao Servidor Cloud! ID:", bot_socket_id);
        notificar_todos("Robô operacional e conectado! Aguardando o Início do Servidor.");
    });
    // O Python usa esta rota para relatar o progresso ao vivo (Coupa/Vale)
    socket.on('relatar_progresso', (dados) => {
        io.to('frontend').emit('relatar_progresso', dados);
    });

    // 👇 ADICIONE ESTAS 3 LINHAS PARA O FINDES E O M.E FUNCIONAREM 👇
    socket.on('relatar_progresso_me', (dados) => io.to('frontend').emit('relatar_progresso_me', dados));
    socket.on('relatar_progresso_findes', (dados) => io.to('frontend').emit('relatar_progresso_findes', dados));
    socket.on('findes_textos_gerados', (dados) => io.to('frontend').emit('findes_textos_gerados', dados));
    

    // Os utilizadores que abrirem o site emitem 'sou_frontend'
    socket.on('sou_frontend', (dados) => {
        // 🛡️ SE O USUÁRIO NÃO ESTIVER AUTENTICADO:
        if (!socket.autenticado) {
            // Se ele tentou entrar num painel enviando uma sessão velha/falsa, avisa o site para o expulsar!
            if (socket.handshake.auth.sessionId) {
                socket.emit('sessao_invalida');
            }
            return; // Bloqueia o acesso à sala "frontend" (Ele não vai ver os logs nem as imagens do Captcha)
        }

        socket.join('frontend'); // <-- Só chega aqui quem tem crachá válido do Redis
        
        if (dados && dados.usuario) {
            usuarios_logados[dados.usuario] = socket.id; 
            
            // 👇 CRIPTOGRAFA O AVISO DE 'Ficou Online' NO NODE.JS 👇
            const msg = `🔵 O usuário ${dados.usuario} abriu o portal e está ONLINE.`;
            const chave = "ventura2026";
            let cifrado = "";
            for(let i=0; i<msg.length; i++) {
                cifrado += String.fromCharCode(msg.charCodeAt(i) ^ chave.charCodeAt(i % chave.length));
            }
            const b64 = Buffer.from(cifrado, 'binary').toString('base64');
            io.emit('alerta_admin_cifrado', { mensagem: b64 });
        }
        
        socket.emit('sincronizar_estado', { estado: estado_global, mensagem: "Sincronizado com a Nuvem." });
        socket.emit('sincronizar_estado_me', estado_me); // <-- NOVA LINHA PARA ENVIAR O STATUS DO ME
    });

    // 👇 ROTA DE REPASSE DAS MENSAGENS SECRETAS 👇
    socket.on('alerta_admin_cifrado', (dados) => {
        io.emit('alerta_admin_cifrado', dados); 
    });

    // O Python envia as imagens do Captcha
    socket.on('imagem_captcha_do_robo', (dados) => {
        io.to('frontend').emit('nova_imagem', dados);
    });

    // O Frontend envia o clique no Captcha para a Nuvem, que repassa para o Python
    socket.on('clique_no_captcha', (dados) => {
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('executar_clique', dados);
            notificar_todos('A enviar clique para o servidor local...');
        }
    });

   socket.on('comando_direto', (dados) => {
        if (!socket.autenticado) return; // 🛡️ BLOQUEIA HACKERS
        if (bot_socket_id) {

            // 👇 1. BLINDAGEM DO MERCADO ELETRÔNICO E FINDES 👇
            if (dados.portal === 'me') {
                if (dados.modo === 'extrair') estado_me.status = 'extraindo';
                else if (dados.modo === 'solicitar_parada') estado_me.status = 'ocioso';
                
                io.emit('sincronizar_estado_me', estado_me); // Avisa todas as telas do novo estado!
                io.to(bot_socket_id).emit('comando_para_robo', dados);
                return; 
            }
            if (dados.portal === 'findes') {
                io.to(bot_socket_id).emit('comando_para_robo', dados);
                return; 
            }
            // 👆 ================================================== 👆

            if (dados.modo === 'ligar_robo') {
                estado_global.status = 'logando';
                notificar_todos("A iniciar navegador e autenticar...");
                
                // MÁGICA ATUALIZADA: Damos 60 segundos para você resolver o captcha com calma!
                setTimeout(() => {
                    if (estado_global.status === 'logando') {
                        estado_global.status = 'ocioso';
                        notificar_todos("Módulos operacionais liberados!");
                    }
                }, 60000); 
            } 
            else if (dados.modo === 'extrair' || dados.modo === 'verificar') {
                estado_global.status = dados.modo;
                notificar_todos(`A iniciar modo: ${dados.modo.toUpperCase()}...`);
            }
            else if (dados.modo === 'solicitar_parada') {
                estado_global.status = 'ocioso';
                notificar_todos("Processo interrompido. Módulos liberados.");
            }
            else if (dados.modo === 'desligar_robo') {
                estado_global.status = 'desligado';
                notificar_todos("Navegador fechado. Robô desligado.");
            }

            // Manda a ordem para o Python trabalhar (para Coupa e Vale)
            io.to(bot_socket_id).emit('comando_para_robo', dados);
        }
    });

    // === ROTA PARA O BOTÃO DE IMPRESSÃO ===
    socket.on('solicitar_impressao', (dados) => {
        if (!socket.autenticado) return;
        if (bot_socket_id) {
            estado_global.status = 'ocupado';
            notificar_todos("A processar fila de impressão e organização de ficheiros...");
            io.to(bot_socket_id).emit('comando_imprimir', dados);
        } else {
            socket.emit('sincronizar_estado', { estado: estado_global, mensagem: "Erro: Ligue o servidor do robô primeiro."});
        }
    });

    // === ROTAS DO DASHBOARD ADMIN ===
    socket.on('pedir_dados_dashboard', (dados) => {
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('pedir_dados_dashboard', { clientId: socket.id });
        } else {
            socket.emit('receber_dados_dashboard', { sucesso: false, erro: "O robô não está online para ler o Excel."});
        }
    });

    socket.on('resposta_dados_dashboard', (dados) => {
        io.to(dados.clientId).emit('receber_dados_dashboard', dados);
    });

    // === O ÚNICO GESTOR DE TAREFAS CONCLUÍDAS ===
    socket.on('tarefa_concluida', (dados) => {
        const { evento, sucesso, erro } = dados;

        // 1. Repassa o evento para TODOS os sites (para os alertas visuais do ME funcionarem)
        io.to('frontend').emit('tarefa_concluida', dados);

        // 2. BLINDAGEM: Se for um evento exclusivo do Mercado Eletrônico, NÃO mexe no status global
        if (evento === 'Lote de Extração' || evento === 'Impressão Lote') {
            if (evento === 'Lote de Extração') {
                estado_me.status = 'ocioso';
                io.emit('sincronizar_estado_me', estado_me);
            }
            return; // O código para aqui.
        }

        // 3. Se foi um evento real de Resposta (com números), guarda na lista verde de "FINALIZADOS"
        const numExtraido = String(evento).replace(/\D/g, ""); 
        if (numExtraido && !estado_global.tarefas_concluidas.includes(numExtraido)) {
            estado_global.tarefas_concluidas.push(numExtraido);
        }
        
        // 4. Lida com o Sucesso ou Erro para Coupa/Vale
        if (sucesso) {
            estado_global.status = 'ocioso'; 
            notificar_todos(`✔️ ${evento} concluído com sucesso!`);
        } else {
            if (evento === 'Login do Robô') {
                estado_global.status = 'desligado';
            } else {
                estado_global.status = 'ocioso';
            }
            notificar_todos(`❌ Erro no ${evento}: ${erro}`);
        }
        
        // 5. Puxa o próximo evento da fila automaticamente (se houver)
        if(typeof processar_proxima_tarefa === 'function') {
            processar_proxima_tarefa(); 
        }
    });

    // === NOVO: REMOVER EVENTO ESPECÍFICO DA FILA (VISUAL E MEMÓRIA) ===
    socket.on('remover_da_fila', (dados) => {
        if (!socket.autenticado) return;
        const eventoId = String(dados.evento);
        
        // 1. Tira do Visor (Tela do Site)
        const index = estado_global.fila_pendente.indexOf(eventoId);
        if (index !== -1) {
            estado_global.fila_pendente.splice(index, 1);
            estado_global.tamanho_fila = estado_global.fila_pendente.length;
        }

        // 2. O CORTE CIRÚRGICO: Tira da Memória Real de Processamento
        // (Nota: Se a sua variável de fila no server.js tiver outro nome, troque "fila_respostas" abaixo)
        try {
            const indexReal = fila_respostas.findIndex(pacote => String(pacote.evento) === eventoId);
            if (indexReal !== -1) {
                fila_respostas.splice(indexReal, 1); // Arranca o pacote e os PDFs da memória!
            }
        } catch(e) {
            console.log("Aviso: Falha ao expurgar pacote da memória profunda.");
        }
        
        console.log(`⚠️ Evento ${eventoId} CANCELADO e obliterado do servidor.`);
        notificar_todos(`Aviso: O Evento ${eventoId} foi removido da fila manualmente.`);
    });

    socket.on('disconnect', () => {
        // Tira o usuário da lista de Online se ele fechar a aba
        for (let email in usuarios_logados) {
            if (usuarios_logados[email] === socket.id) {
                delete usuarios_logados[email];
            }
        }

        if (socket.id === bot_socket_id) {
            bot_socket_id = null;
            estado_global.status = 'desligado';
            console.log("❌ Ligação com o Robô Local perdida.");
            notificar_todos("ALERTA: O robô local foi desconectado da nuvem!");
        }
    });
    // === SISTEMA DE AUTENTICAÇÃO E E-MAILS ===

    // === FUNÇÃO PARA PEGAR O IP VERDADEIRO DA REDE ===
    function extrairIP(socket) {
        let ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        if (ip.includes('::ffff:')) ip = ip.split('::ffff:')[1]; // Limpa o formato IPv6 para IPv4
        return ip;
    }

    // === ROTAS DE AUTENTICAÇÃO COM RASTREIO DE IP ===
    socket.on('solicitar_login', (dados) => {
        dados.ip_real = extrairIP(socket); 
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('validar_login', { ...dados, clientId: socket.id });
        } else {
            // Se o Robô Python estiver desligado, cancela o login na hora!
            socket.emit('resposta_login', { sucesso: false, erro: "O Servidor Central (Robô Python) está offline." });
        }
    });

    socket.on('registrar_usuario', (dados) => {
        dados.ip_real = extrairIP(socket); // Injeta o IP inviolável no pacote
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('registrar_usuario', { ...dados, clientId: socket.id });
        }
    });

    socket.on('resultado_login', async (dados) => { 
    if(dados.sucesso) {
        const sessionId = uuidv4(); 
        const fichaDoUsuario = JSON.stringify({ email: dados.user, admin: dados.isAdmin, dev: dados.isDev });
        
        // Salva a ficha no cofre do Redis (Expira em 8 horas)
        cofreSessoes.set(sessionId, fichaDoUsuario);
        setTimeout(() => { cofreSessoes.delete(sessionId); }, 28800 * 1000);
        usuarios_logados[dados.user] = dados.clientId; 
        
        // Devolve o sessionId e as flags visuais APENAS UMA VEZ
        io.to(dados.clientId).emit('resposta_login', { 
            sucesso: true, 
            sessionId: sessionId,
            admin: dados.isAdmin, 
            dev: dados.isDev      
        }); 
    } else {
        io.to(dados.clientId).emit('resposta_login', dados); 
    }
});

   // 🛡️ ROTAS DEV BLINDADAS
socket.on('pedir_dados_dev_seguro', (dados) => {
    // Se não for DEV, o servidor ignora o pedido silenciosamente
    if (!socket.usuarioLogado || socket.usuarioLogado.dev !== true) return; 

    if (bot_socket_id) {
        io.to(bot_socket_id).emit('pedir_dados_dev_seguro', { 
            payload_cifrado: dados.payload_cifrado, 
            online_users: Object.keys(usuarios_logados),
            clientId: socket.id 
        });
    }
});

socket.on('comando_dev_acao_seguro', (dados) => { 
    // Se não for DEV, ignora
    if (!socket.usuarioLogado || socket.usuarioLogado.dev !== true) return;

    if (bot_socket_id) {
        io.to(bot_socket_id).emit('comando_dev_acao_seguro', { payload_cifrado: dados.payload_cifrado, clientId: socket.id }); 
    }
});

    socket.on('resposta_painel_dev_cifrado', (dados) => {
        // Devolve o pacote trancado do Python direto pro Navegador do DEV
        io.to(dados.clientId).emit('dados_dev_prontos_cifrados', dados.payload);
    });
    
    socket.on('resposta_dev_acao', (dados) => { 
        io.to(dados.clientId).emit('resposta_dev_acao', dados); 
    });

    // CÓDIGO CORRIGIDO (Zero Trust)
    socket.on('promover_usuario', (dados) => { 
    // 🛡️ BLINDAGEM DE PRIVILÉGIO (RBAC)
    if (!socket.usuarioLogado || socket.usuarioLogado.admin !== true) {
        console.warn(`🚨 INVASÃO BLOQUEADA: ${socket.usuarioLogado?.email} tentou usar privilégios de Admin.`);
        socket.emit('resposta_promocao', { sucesso: false, erro: "Acesso Negado: Você não é Administrador." });
        return; // A execução morre aqui!
    }

    if (bot_socket_id) {
        io.to(bot_socket_id).emit('comando_promover_usuario', { ...dados, clientId: socket.id }); 
    } else {
        socket.emit('resposta_promocao', { sucesso: false, erro: "Ligue o servidor local primeiro." });
    }
    });
    
    socket.on('resultado_promocao', (dados) => { 
        io.to(dados.clientId).emit('resposta_promocao', dados); 
    });

    socket.on('solicitar_cadastro', (dados) => { io.emit('registrar_usuario', { ...dados, clientId: socket.id }); });
    
    socket.on('disparar_email_verificacao', async (dados) => {
        console.log(`[NODE] 📩 Recebi ordem do Python para enviar e-mail a: ${dados.email}`);
        const link = `https://portaismaestro-ved1.onrender.com/index.html?action=verify&token=${dados.token}`;
        
        try {
            console.log("[NODE] ⏳ A tentar entregar a mensagem ao Gmail...");
            let info = await transporter.sendMail({
                from: '"Maestro Suporte" <maestro.validacao@gmail.com>',
                to: dados.email,
                subject: 'MAESTRO - Confirme o seu E-mail',
                html: `<div style="font-family: Arial; padding: 20px; background: #0f1115; color: #fff; text-align: center; border-radius: 8px;">
                        <h2 style="color: #2E8B57;">MAESTRO CORE</h2>
                        <p>Você solicitou acesso ao sistema Maestro. Clique no link para ativar a sua conta:</p>
                        <a href="${link}" style="background: #2E8B57; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 15px; font-weight: bold;">ATIVAR A MINHA CONTA</a>
                      </div>`
            });
            console.log(`[NODE] ✅ E-mail ENVIADO com sucesso! ID: ${info.messageId}`);
            io.to(dados.clientId).emit('resposta_cadastro', { sucesso: true });
            
        } catch(e) {
            console.error("❌ [NODE] Falha brutal no envio do e-mail:", e.message);
            io.to(dados.clientId).emit('resposta_cadastro', { sucesso: false, erro: 'Falha na conexão com o Gmail. Olhe o log do Render.' });
        }
    });

    socket.on('validar_token_email', (dados) => { io.emit('verificar_token_python', { ...dados, clientId: socket.id }); });
    socket.on('resultado_verificacao_token', (dados) => { io.to(dados.clientId).emit('resposta_verificacao_token', dados); });

    socket.on('solicitar_recuperacao', (dados) => { io.emit('gerar_token_recuperacao', { ...dados, clientId: socket.id }); });
    
    socket.on('disparar_email_recuperacao', async (dados) => {
        const link = `https://portaismaestro.onrender.com/index.html?action=reset&token=${dados.token}`;
        try {
            await transporter.sendMail({
                from: '"Maestro Suporte" <maestro.validacao@gmail.com>',
                to: dados.email,
                subject: 'MAESTRO - Redefinição de Senha',
                html: `<div style="font-family: Arial; padding: 20px; background: #0f1115; color: #fff; text-align: center; border-radius: 8px;">
                        <h2 style="color: #ff6b9d;">MAESTRO CORE</h2>
                        <p>Clique no link abaixo para criar uma nova senha:</p>
                        <a href="${link}" style="background: #ff6b9d; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 15px; font-weight: bold;">REDEFINIR SENHA</a>
                      </div>`
            });
            io.to(dados.clientId).emit('resposta_recuperacao_solicitada', { sucesso: true });
        } catch(e) { 
            console.error("❌ Erro fatal no Nodemailer (Recuperação):", e);
            io.to(dados.clientId).emit('resposta_recuperacao_solicitada', { sucesso: false }); 
        }
    });

    socket.on('salvar_nova_senha', (dados) => { io.emit('processar_nova_senha', { ...dados, clientId: socket.id }); });
    socket.on('resultado_nova_senha', (dados) => { io.to(dados.clientId).emit('resposta_nova_senha', dados); });

    // ==========================================
    // 🔐 SISTEMA DE OTP (VERIFICAÇÃO VALE)
    // ==========================================
    
    // 1. O Robô Python avisa que precisa do código OTP
    socket.on('pedir_otp_usuario', () => {
        notificar_todos("Aguardando inserção do código OTP de segurança...");
        io.emit('mostrar_popup_otp'); // Manda o site abrir a caixa para o usuário
    });

    // 2. O Usuário digita no site e envia de volta para o Robô
    socket.on('enviar_otp_para_robo', (dados) => {
        if (bot_socket_id) {
            io.to(bot_socket_id).emit('receber_otp_frontend', dados);
            notificar_todos("Código OTP enviado para o Robô. A verificar...");
        }
    });

});

// ==========================================
// ROTA DO CHAT DE SUPORTE (MAESTRO IA) E GROQ FICAM DE FORA
// ==========================================
const Groq = require('groq-sdk');
// Cole a sua chave real do Groq no lugar do texto abaixo, mantendo as aspas!
const groq = new Groq({ apiKey: "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" });

// ==========================================
// ROTA DO CHAT DE SUPORTE (MAESTRO IA)
// ==========================================
app.post('/api/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;

        const chatCompletion = await groq.chat.completions.create({
            messages: [
                { 
                    role: "system", 
                    content: `Você é a MAESTRO IA, assistente virtual oficial do MAESTRO – Módulo de Automação Específico de Sites e Tratamento de Recursos Online, um sistema centralizado de orquestração e automação de portais corporativos.

Sua função é orientar exclusivamente sobre o uso da plataforma MAESTRO e seus módulos integrados, como:
Coupa (Vale),Findes, Ariba, Mercado Eletrônico

🎯 Objetivo
Ajudar o usuário a operar corretamente os módulos do MAESTRO, com foco em: Extração de informações, Envio de respostas, Monitoramento de processos, Resolução de erros operacionais

📌 Regras Obrigatórias de Resposta

Seja direta e objetiva. Responda em no máximo 5–8 linhas. Não fuja do contexto do MAESTRO. Não responda perguntas fora do escopo do sistema. Não explique conceitos genéricos de programação ou internet.

⚙️ Regras Operacionais – Módulo Coupa

Para qualquer ação (extrair, verificar, responder):

1️ Iniciar Servidor
O usuário deve clicar em "Iniciar Servidor" antes de qualquer operação.
Sem isso, o robô local não executa ações.

2️ Cancelar Evento
Se enviou algo errado:
Acesse Monitor de Processos → clique no botão vermelho "X" para remover o evento da memória.

3️ Envio em Lote
A tela de resposta permite adicionar múltiplos eventos (gavetas/acordeão) e enviar todos de uma vez.

4️ Anexos
Aceita apenas arquivos em PDF (Datasheets e DAVs).

5 Captcha
A tela de segurança espelha o captcha ao vivo.
O usuário deve clicar na imagem para resolver.

caso não consiga responder alguma pergunta ou se o usuario relatar problemas, fale para ele entrar em contato com o suporte: maestro.suporte@proton.me` 
                },
                { 
                    role: "user", 
                    content: userMessage 
                }
            ],
            model: "llama-3.1-8b-instant", 
            temperature: 0.5,
        });

        res.json({ reply: chatCompletion.choices[0].message.content });
    } catch (error) {
        console.error("Erro na comunicação com a API do Groq:", error);
        res.status(500).json({ error: "Desculpe, a conexão com meus núcleos de processamento falhou no momento." });
    }
});
const PORT = process.env.PORT || 8000;
server.listen(PORT, () => {
    console.log(`☁️ Servidor Cloud a rodar na porta ${PORT}`);
});
