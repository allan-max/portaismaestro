# Auditoria de ações dos usuários

Grupo **Controle** no menu lateral do `dashboard2.html` (só admin), com duas telas no mesmo estilo do dashboard de cotações:

- **Auditoria:** quem mudou o quê no Portal Maestro (planilha, portais, robô, usuários e acessos).
- **Usuários:** apelido de cada e-mail, quem está online e as ações no período.

## Decisões

| Tema | Decisão |
|---|---|
| O que entra | Só ações que **mudam dado ou estado**. Clique, navegação e consulta ficam de fora. O e-mail vem sempre da sessão, nunca do payload. |
| Autenticação | Ações de usuário que não checavam login passaram a exigir `socket.autenticado`: apagar/editar linha, vendedor, cotação e pedido manual, extração da fila, remover da fila. |
| Armazenamento | JSONL append-only, um arquivo por mês: `../auditoria/auditoria-AAAA-MM.jsonl` (fora da pasta servida). Retenção para sempre. A leitura só abre os meses do período. |
| Status | Nasce `pendente` e fecha com `sucesso`/`erro` quando o robô responde (`audit_id` ou `clientId`). Sem resposta em 10 min, aparece como `sem_resposta`. |
| Antes → depois | Edição mostra o valor anterior e exclusão mostra a linha apagada quando o robô os devolve (ver `prompt-python.md`). Até lá, só o "depois". |
| Acesso | Só admin. O servidor confere pela sessão (`autorizarAdmin`). |
| Apelidos | `../auditoria/apelidos.json`, gravado pelo Node com escrita atômica (tmp + rename). Não usa `banco_usuarios.json`, que é do robô Python. Só admin edita, ≤ 40 caracteres, vazio remove. A troca entra no log. O apelido não é gravado no log, é resolvido na exibição, e aparece só em Auditoria e Usuários. |
| Ao vivo | O admin entra na sala `auditoria` e recebe `auditoria_nova` / `auditoria_atualizada`. Botão Atualizar e "Atualizado às". |
| Limites | Textos com até 200 caracteres e detalhes com até 4000 (acima disso viram `{truncado, resumo}`). Período máximo de 366 dias. |

## Catálogo de ações

| Área | `acao` | Origem | Fecha em |
|---|---|---|---|
| planilha | `editar_linha` | `comando_editar_linha` | `resposta_acao_linha` (`antes`) |
| planilha | `apagar_linha` | `comando_apagar_linha` | `resposta_acao_linha` (`linha_apagada`) |
| planilha | `marcar_respondida` | `marcar_cotacao_respondida` | `resposta_acao_linha` |
| planilha | `atribuir_vendedor` | `solicitar_registro_vendedor_cotacao` | `retorno_registro_vendedor_cotacao` |
| planilha | `cotacao_manual` | `solicitar_registro_cotacao_manual` | `retorno_registro_cotacao_manual` |
| planilha | `pedido_manual` | `solicitar_registro_pedido_manual` | `resposta_registro_pedido_manual` |
| planilha | `sincronizar_nf` | `solicitar_sync_nf` | `retorno_sync_nf` |
| planilha | `gravar_nf_planilha` | `solicitar_nf_planilha` com `gravar: true` | `retorno_nf_planilha` |
| portal | `responder_evento` | `POST /api/responder` (só `qtd_itens`, `tem_datasheet`, `tem_dav`; **sem preços**) | `tarefa_concluida` |
| portal | `cancelar_evento` | `remover_da_fila` | imediato |
| portal | `robo_<modo>` | `comando_direto` (ligar/desligar, forçar troca, parada, extrair, verificar, mover anexos) | imediato |
| portal | `extracao_fila` / `imprimir` | `iniciar_extracao_fila` / `solicitar_impressao` | imediato |
| admin | `salvar_config` (só nomes das chaves) | evento de mesmo nome | imediato |
| admin | `acesso_<campo>` | `admin_alterar_acesso_dashboard` | `admin_resposta_acesso` |
| admin | `vincular_vendedor` | `admin_alterar_vendedor_usuario` | `admin_resposta_vendedor` |
| admin | `definir_apelido` | `admin_definir_apelido` | imediato |
| conta | `login` / `login_falha` / `cadastro` / `troca_senha` | respostas do robô | — |

Registro: `{id, data_hora, email, ip, area, acao, portal, alvo, detalhes, status, erro}`. O fechamento é uma linha nova `{id, fecha: true, status, erro, detalhes_extra}`, juntada na leitura.

## Protocolo Socket.IO

| Evento | Direção | Payload |
|---|---|---|
| `solicitar_dashboard_auditoria` | tela → server | `{requestId, de, ate}` (AAAA-MM-DD) |
| `retorno_dashboard_auditoria` | server → tela | `{requestId, sucesso, registros, apelidos, consultado_em}` |
| `auditoria_nova` / `auditoria_atualizada` | server → sala `auditoria` | registro / fechamento |
| `admin_definir_apelido` | tela → server | `{email, apelido}` |
| `admin_apelido_definido` | server → tela | `{sucesso, email, apelido, erro?}` |

## Arquivos

- `lib/auditoria.js`: gravação, fechamento, leitura por período e apelidos.
- `lib/dashboard-auditoria.js`: eventos de consulta e de apelido (só admin).
- `server.js`: pontos de registro e fechamento, guardas de login, `audit_id` repassado ao robô.
- `public/dashboard-cotacoes/auditoria.js`: telas Auditoria e Usuários (filtros, cards, barras, log, painel lateral, Excel).
- `public/dashboard-cotacoes/app.js`, `style.css`, `public/dashboard2.html`: integração no menu e estilos.
- `tests/auditoria.test.js`, `tests/dashboard-auditoria.test.js`, `tests/dashboard-auditoria-tela.test.js`.

## Riscos

- O `audit_id` precisa voltar intacto nas respostas do robô. Sem isso, a ação fica como `sem_resposta` depois de 10 min (o comando em si funciona).
- `fs.appendFileSync` de uma linha é seguro com um único processo Node. Com vários processos, migrar para SQLite.
- No login com falha, o e-mail é o digitado e pode não existir. A senha nunca é registrada.
