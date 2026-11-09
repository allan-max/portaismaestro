'use strict';
/* Dono de uma cotação pelo texto da coluna VENDEDOR (Minhas Cotações).
   Mesma regra de gerenciador/donos_vendedor.py (explicação completa lá):
   - a célula bate com a conta quando o primeiro nome é igual e os outros nomes da célula aparecem, na ordem,
     no nome completo da conta ("Gustavo Cabral" -> "Gustavo Cabral Calvi"; "GUSTAVO" -> qualquer Gustavo);
   - se bater com duas pessoas diferentes, a cotação não vai para ninguém;
   - contas da mesma pessoa (mesmo nome, ou contas antigas sem nome com o mesmo vendedor) contam como uma. */

const SEPARADORES_CELULA = /[/,;+]/;

function tokens(texto) {
    return String(texto || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

function subsequencia(curta, longa) {
    let i = 0;
    for (const t of curta) {
        while (i < longa.length && longa[i] !== t) i++;
        if (i >= longa.length) return false;
        i++;
    }
    return true;
}

function casa(tokensCelula, nomeConta) {
    const t = tokens(nomeConta);
    return !!(t.length && tokensCelula.length && tokensCelula[0] === t[0] && subsequencia(tokensCelula.slice(1), t.slice(1)));
}

/** Contas que recebem cotações (banco de usuários -> lista): com vendedor vinculado e não bloqueadas. */
function contasVendedoras(usuarios) {
    return Object.entries(usuarios && typeof usuarios === 'object' ? usuarios : {})
        .filter(([, d]) => d && typeof d === 'object' && String(d.vendedor || '').trim() && !d.bloqueado)
        .map(([email, d]) => ({ email, nome: String(d.nome || ''), vendedor: String(d.vendedor || '') }));
}

const pessoa = c => tokens(c.nome || c.vendedor).join(' ');

/** E-mails das contas donas da cotação (vazio se ninguém, ou se o nome for ambíguo). */
function donosDaCotacao(celula, contas) {
    const donos = new Set();
    for (const parte of String(celula || '').split(SEPARADORES_CELULA)) {
        const tk = tokens(parte);
        if (!tk.length) continue;
        const achadas = (contas || []).filter(c => casa(tk, c.nome) || casa(tk, c.vendedor));
        if (achadas.length && new Set(achadas.map(pessoa)).size === 1) achadas.forEach(c => donos.add(c.email));
    }
    return donos;
}

const ehDono = (celula, email, contas) => !!email && donosDaCotacao(celula, contas).has(email);

module.exports = { tokens, contasVendedoras, donosDaCotacao, ehDono };
