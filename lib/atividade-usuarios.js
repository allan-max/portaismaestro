// Última ação de usuário no site, gravada em portal.estado para o atualizador automático do gerenciador
// (scripts/atualizador.py): ele só faz "pm2 restart" com o site quieto, para não derrubar quem está no meio de
// salvar, registrar ou comandar um robô.
//
// Só ações contam. As telas pedem dados sozinhas a cada poucos segundos (dashboards, planilhas); se isso contasse,
// uma aba esquecida aberta seguraria a atualização para sempre. Evento que não está na lista não segura.
const fs = require('node:fs');

const ACOES = /^(comando_|salvar_|admin_alterar_|admin_definir_|solicitar_(registro_|impressao|sincronizacao|login|cadastro|recuperacao|sync_nf$)|iniciar_|remover_|marcar_|clique_|baixar_)/;

function criarAtividade({ arquivo, agora = Date.now }) {
  let ultima = 0;
  return {
    // evento do socket de um usuário (nunca do gerenciador ou dos serviços)
    registrar(evento) { if (ACOES.test(String(evento))) ultima = agora(); },
    // ação que não passa pelo socket (envio de arquivo por HTTP)
    marcar() { ultima = agora(); },
    gravar() {
      try {
        fs.writeFileSync(arquivo + '.tmp', JSON.stringify({ em: agora(), ultima_acao_em: ultima }));
        fs.renameSync(arquivo + '.tmp', arquivo);
      } catch { /* sem o arquivo o atualizador não espera; o site segue no ar */ }
    },
  };
}

module.exports = { criarAtividade, ACOES };
