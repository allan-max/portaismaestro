# Prompt de implementação — Auditoria (robô Python / gerenciador)

> Cole o texto abaixo numa sessão do Claude Code no repositório do gerenciador Python (o que conecta ao Node com `sou_o_robo`).

---

O servidor Node do Portal Maestro passou a registrar uma auditoria das ações dos usuários (veja `docs/auditoria/plano.md` no repositório `portaismaestro`). O Node agora envia um campo `audit_id` em alguns comandos e precisa recebê-lo de volta na resposta. Para edições e exclusões, precisa também do valor anterior.

## Mudanças

1. **Devolver `audit_id`** sem alteração em toda resposta destes comandos, junto com o `clientId` que já é devolvido:
   | Comando recebido | Resposta emitida |
   |---|---|
   | `comando_editar_linha` | `resposta_acao_linha` |
   | `comando_apagar_linha` | `resposta_acao_linha` |
   | `comando_marcar_cotacao_respondida` | `resposta_acao_linha` |
   | `comando_registrar_vendedor_cotacao` | `retorno_registro_vendedor_cotacao` |
   | `comando_registrar_cotacao_manual` | `retorno_registro_cotacao_manual` |
   | `solicitar_registro_pedido_manual` | `resposta_registro_pedido_manual` |

   O jeito mais simples é copiar `dados.get('audit_id')` para o dict de resposta em cada handler. A resposta de evento (`tarefa_concluida`) não precisa disso, porque o Node correlaciona pelo número do evento.

2. **`comando_editar_linha`:** antes de gravar, leia a linha atual (por `tipo` + `chave`) e inclua na resposta `antes: { campo: valor_antigo }`, **só com os campos presentes em `novos_dados`**.

3. **`comando_apagar_linha`:** antes de apagar, leia a linha inteira e inclua na resposta `linha_apagada: { coluna: valor, ... }`.

4. Os valores devem ser serializáveis em JSON. Converta datas para `DD/MM/AAAA`, como a planilha já exibe, e `NaN`/`None` para `null`.

5. Se a linha não existir, responda `sucesso: False` com `erro` claro e mantenha o `audit_id`.

## Testes

- Editar uma linha: a resposta traz `audit_id` igual ao recebido e `antes` com os valores antigos só dos campos editados.
- Apagar uma linha: a resposta traz `linha_apagada` com todas as colunas.
- Comando sem `audit_id` (Node antigo): continua funcionando e responde com `audit_id: None`.

Não mude nomes de eventos nem campos que já existem. O Node antigo precisa continuar funcionando.
