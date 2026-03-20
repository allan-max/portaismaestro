// ==========================================
// MAESTRO - IA SUPPORT WIDGET GLOBAL
// ==========================================

// 1. O HTML do Chat que será injetado nas páginas
const chatHTML = `
    <div class="chat-widget">
        <div class="chat-window" id="chatWindow">
            <div class="chat-header">
                <h3><i class="fa-solid fa-robot"></i> Suporte MAESTRO</h3>
                <button class="btn-close-chat" onclick="toggleChat()"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div class="chat-body" id="chatBody">
                <div class="msg bot">Olá! Sou a IA de suporte do Maestro. Como posso ajudar você hoje?</div>
            </div>
            <span class="typing-indicator" id="typingIndicator">A IA está digitando...</span>
            <div class="chat-footer">
                <input type="text" id="chatInput" placeholder="Digite sua dúvida..." onkeypress="handleEnter(event)">
                <button onclick="sendMessage()"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
        </div>
        
        <button class="chat-btn" onclick="toggleChat()">
            <i class="fa-solid fa-message"></i>
        </button>
    </div>
`;

// 2. Injeta o HTML automaticamente assim que a página carrega
document.addEventListener("DOMContentLoaded", () => {
    document.body.insertAdjacentHTML('beforeend', chatHTML);
});

// 3. Funções de Lógica do Chat
window.toggleChat = function() {
    const chat = document.getElementById('chatWindow');
    chat.classList.toggle('active');
    if(chat.classList.contains('active')) {
        document.getElementById('chatInput').focus();
    }
}

window.handleEnter = function(e) {
    if(e.key === 'Enter') sendMessage();
}

window.sendMessage = async function() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    if (!message) return;

    // Adiciona a mensagem do Usuário
    appendMessage(message, 'user');
    input.value = '';
    
    // Mostra indicador de digitação
    document.getElementById('typingIndicator').style.display = 'block';

    try {
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: message })
        });

        const data = await response.json();
        
        // Esconde indicador e mostra resposta
        document.getElementById('typingIndicator').style.display = 'none';
        
        if (data.reply) {
            appendMessage(data.reply, 'bot');
        } else {
            appendMessage("Erro ao processar a resposta da IA.", 'bot');
        }
    } catch (error) {
        document.getElementById('typingIndicator').style.display = 'none';
        appendMessage("Erro de conexão com o servidor MAESTRO.", 'bot');
    }
}

function appendMessage(text, sender) {
    const body = document.getElementById('chatBody');
    const msgDiv = document.createElement('div');
    msgDiv.className = `msg ${sender}`;
    msgDiv.innerText = text;
    body.appendChild(msgDiv);
    
    // Rola para o final
    body.scrollTop = body.scrollHeight;
}