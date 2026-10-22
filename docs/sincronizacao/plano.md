# Sincronização manual (dashboard do admin)

Botões para rodar na hora o que hoje só roda no horário: quem mexeu em algo
confere sem esperar a próxima rodada (ou o dia seguinte).

## Tela

Seção **"Sincronização"** no `dashboard2.html`, só para admin (checado no
servidor com `checkRole('admin')`, não só pelo `localStorage`). Um cartão por
serviço: botão, status (parado / rodando / ok / erro / offline), última
execução (quando, manual ou automática, quem disparou) e progresso ao vivo.
Todos os admins com a tela aberta veem o andamento. Todo clique vai para a
Auditoria.

| Cartão | O botão faz | Quem executa | Confirma? |
|---|---|---|---|
| Ciclo Coupa | liga → extrai → verifica → desliga | gerenciador | não |
| Ciclo Vale | liga → extrai → verifica (pede OTP) → desliga; conta como a verificação do dia | gerenciador | sim |
| NF completo | HSE → portal (sync NF) e, se deu certo, portal → coluna N "NF (MAESTRO)" do Excel dos estagiários | serviço de NF | não |
| Sync planilha ⇄ portal | `sync_planilha_portal` gravando, sem `--diario` (roda mesmo depois da rodada do dia) | serviço de NF | não |
| Backup | o mesmo `rotina_backup` das 07:00 | gerenciador | não |
| Procurar atualização | `schtasks /Run /TN "Maestro Atualizador"` | portal | sim |

## Regras

- Já rodando → o botão recusa e diz o que está rodando.
- O manual não mexe nos horários automáticos (o relógio de 1h30 do Auto-Pilot,
  o 07:00 do backup, o 07:30 da NF, o diário do sync).
- Auto-Pilot chega na vez de um portal com o ciclo manual dele rodando → espera
  o manual terminar (trava por portal).
- Sem prévia: os botões gravam (as prévias continuam na linha de comando e no
  "Só prévia" do `planilha_vale.html`).
- Fora da tela: cadastro de pedidos (roda a cada 10 min), limpeza de eventos,
  impressão agendada (não está ligada hoje).

## Entrega (3 PRs, nesta ordem)

1. **gerenciador**: `rodar_ciclo(portal, manual)` saindo do `loop_automacao`;
   trava por portal; comandos `ciclo_manual` e `backup_manual` com resposta em
   `retorno_sincronizacao`. Chega ao servidor pelo atualizador.
2. **cotafrete/cruzar_nf** (`maestro.py`): comandos `comando_nf_completo` e
   `comando_sync_planilha`, respondendo em `progresso_sincronizacao` /
   `retorno_sincronizacao`. Não se atualiza sozinho: copiar para
   `sync_nf\cruzar_nf` no servidor e rodar `ReiniciarServicoNF.bat`.
3. **portal**: evento `solicitar_sincronizacao { servico }` no `server.js`
   (admin + auditoria), repasse para gerenciador / serviço de NF / `schtasks`;
   cartões em `public/dashboard-sincronizacao.js`. Cartão sem resposta mostra
   "offline / ainda não suporta", então a ordem dos merges não quebra a tela.

## Antes de ligar o cartão do atualizador

No SERVIDOR2, com o usuário que roda o pm2: `schtasks /Run /TN "Maestro Atualizador"`.
Acesso negado → o portal mostra o erro no cartão; resolver a permissão da tarefa.

O cartão do atualizador só sabe "disparado"; o andamento aparece na Atividade
(os eventos do atualizador já chegam lá).
