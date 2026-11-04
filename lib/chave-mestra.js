const crypto = require('node:crypto');

// Chave do AES-256-GCM do server.js. Antes, sem MASTER_SECRET no .env, ela
// caía numa senha escrita no código (igual em toda instalação e pública no
// GitHub). Hoje a chave só cifra o aviso "Usuário X Online", que ninguém
// decifra depois, então uma chave aleatória por processo não quebra nada —
// e recusar subir derrubaria o portal no próximo auto-update.
function chaveMestra(env = process.env) {
    const segredo = env.MASTER_SECRET;
    if (segredo) {
        return { chave: crypto.scryptSync(segredo, 'salt', 32), aleatoria: false };
    }
    return { chave: crypto.randomBytes(32), aleatoria: true };
}

module.exports = { chaveMestra };
