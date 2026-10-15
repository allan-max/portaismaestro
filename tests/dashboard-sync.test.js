const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const P = require('../public/dashboard-comum/sync.js');
const ctx = { agora: () => new Date(2026, 9, 14, 13), icone: () => '', num: n => `<strong>${n}</strong>` };

const painel = (extra = {}) => ({
    gerado_em: '14/10/2026 13:37:02', totais: { acoes: 0, conflitos: 2, pendentes: 1, ambiguas: 0 },
    listas: {
        conflitos: [
            { chave: '4101038457|236960|ARCONDICIONADO', linha: 25, campo: 'VALOR', base: 23697.68, excel: 23697.68, portal: '39.589,12' },
            { chave: '4101028890|141325|ETIQUETA', linha: 3, campo: 'IDENTIDADE',
              valores_excel: { PEDIDO: 4101028890, 'NMR DA RFQ': 141325, PRODUTO: 'ETIQUETA' },
              valores_portal: { PEDIDO: 4101030648, 'NMR DA RFQ': 141325, PRODUTO: 'ETIQUETA' }, valores_base: {} },
        ],
        pendentes: [{ chave: '4515482993||HEADSET', linha: 70, lado: 'excel', erro: 'Data inválida: 19.09.2026' }],
        ambiguas: [], removidos: [], historico: [], acoes: [],
    },
    rodadas: [], ...extra,
});

test('conflito de campo mostra planilha, portal e o valor de antes', () => {
    const [valor] = P.itensParaRevisar(painel());
    assert.equal(valor.filtro, 'Conflito · VALOR');
    assert.equal(valor.excel, '23.697,68');
    assert.equal(valor.portal, '39.589,12');
    assert.match(valor.detalhe, /antes os dois eram "23.697,68"/);
});

test('conflito de identidade aponta só o campo diferente', () => {
    const ident = P.itensParaRevisar(painel())[1];
    assert.equal(ident.campo, 'PEDIDO');
    assert.match(ident.excel, /4101028890/);
    assert.match(ident.portal, /4101030648/);
});

test('data inválida diz a linha da planilha e o valor a trocar', () => {
    const data = P.itensParaRevisar(painel())[2];
    assert.equal(data.filtro, 'Data inválida');
    assert.match(data.detalhe, /"19.09.2026" na planilha, linha 70/);
});

test('busca e filtro por tipo', () => {
    const itens = P.itensParaRevisar(painel());
    assert.equal(P.filtrar(itens, '', '4515482993').length, 1);
    assert.equal(P.filtrar(itens, 'Conflito · VALOR', '').length, 1);
    assert.equal(P.filtrar(itens, 'Data inválida', '4101038457').length, 0);
});

test('conteúdo vindo da planilha é escapado', () => {
    const p = painel();
    p.listas.pendentes[0].erro = 'Data inválida: <img src=x onerror=alert(1)>';
    p.rodadas = [{ em: '14/10/2026 12:37:02', resultado: 'adiado', aviso: '<script>', contagens: {} }];
    p.listas.conflitos[0].chave = '<b>4101038457</b>|236960|AR';
    const html = P.pagina(p, ctx);
    assert.doesNotMatch(html, /<img|<script>|<b>4101/);
    assert.match(html, /&lt;img/);
});

test('página tem as 5 partes e o clique na barra filtra o grupo', () => {
    const html = P.pagina(painel(), ctx);
    for (const titulo of ['Situação', 'O que precisa de você', 'O que a sync faz sozinha', 'Histórico de 7 dias', 'Conferência geral'])
        assert.match(html, new RegExp(titulo));
    assert.match(html, /<details class="panel recolhido/);                       // conferência começa recolhida
    const so = P.pagina(painel(), ctx, { grupo: 'data', tipo: '', busca: '' });
    assert.match(so, /1 de 3 item/);
    assert.match(so, /Troque por uma única data/);
});

test('situação: alerta de 1 h sem gravar vence o adiamento simples', () => {
    const s = P.situacao(painel({ adiado: true, aviso: 'Planilha aberta',
        alerta: { desde: '14/10/2026 12:37:00', minutos: 70, motivo: 'Planilha aberta' } }));
    assert.equal(s.cor, 'vermelho');
    assert.match(s.titulo, /70 min/);
    assert.equal(P.situacao(painel({ adiado: true, aviso: 'Planilha aberta' })).cor, 'amarelo');
    assert.equal(P.situacao(painel({ erro: 'Portal mudou' })).cor, 'vermelho');
    assert.equal(P.situacao(null).cor, 'cinza');
});

test('próxima rodada segue a tarefa (dias úteis, 12:37–17:57, para depois de concluir)', () => {
    const qua = h => new Date(2026, 9, 14, ...h);   // 14/10/2026 é quarta
    assert.match(P.proximaRodada(painel(), qua([9, 0])).texto, /hoje às 12:37/);
    assert.match(P.proximaRodada(painel(), qua([13, 40])).texto, /hoje às 13:47/);
    assert.match(P.proximaRodada(painel(), qua([13, 47])).texto, /hoje às 13:47/);
    assert.match(P.proximaRodada(painel(), qua([18, 0])).texto, /quinta.*12:37/);
    assert.match(P.proximaRodada(painel({ concluido_em: '14/10/2026 13:37:40' }), qua([14, 0])).texto, /concluída; próxima quinta/);
    assert.match(P.proximaRodada(painel(), new Date(2026, 9, 16, 19, 0)).texto, /segunda/);   // sexta à noite
});

test('server.js: as respostas dos dashboards só passam pelo dashboard-fontes (admin, requestId, origem)', () => {
    const server = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    assert.doesNotMatch(server, /solicitar_sync_planilha_painel/);                  // o atalho antigo, sem requestId, não existe
    assert.match(server, /for \(const evento of \['retorno_sync_planilha_painel', 'retorno_nf_painel', 'retorno_eventos_nf', 'retorno_eventos'\]\)/);
    assert.match(server, /dashboardFontes\.receber\(evento, socket\.id, dados\)/);
    assert.match(server, /if \(dashboardFontes\.receber\('retorno_sync_nf_estado', socket\.id, dados\)\) return;/);
});
