# Financeiro: envio do PDF para a pasta do robô e acompanhamento

## Por quê
A tela `public/financeiro.html` era só visual. O robô financeiro já roda no SERVIDOR2 e lê os PDFs de pastas de rede.
A tela precisa colocar o PDF na pasta do robô e mostrar quando ele terminou (ou deu erro).

## Objetivo
- Extrato bancário: PDF vai para `\\SERVIDOR2\Publico\ALLAN\FINANCEIRO\EXTRATO`.
- Fatura do cartão: PDF vai para `\\SERVIDOR2\Publico\ALLAN\FINANCEIRO\CARTAO`.
- Depois, vigiar `JA PROCESSADOS` e `ERROS_LEITURA` da pasta usada. O arquivo aparecer em uma delas = resultado.

## Fora do escopo
- O robô do servidor (não está neste PC; não mexer).
- Baixar a planilha `CONFERENCIA_*.xlsx` pela tela.

## Restrições
- O site de produção (Node, `server.js`) roda na rede e acessa o `\\SERVIDOR2` (confirmado pelo Allan).
- Node 16 em produção.

## Abordagens
1. **Node grava e vigia (escolhida).** `server.js` recebe o PDF e copia para a pasta. A cada 10 s confere as duas subpastas.
   O `server.js` já lê arquivos do `\\SERVIDOR2`.
2. Passar pelo gerenciador Python. Descartada: só acrescenta um intermediário, sem ganho.

## Design
- Rota `POST /api/financeiro/enviar` (multer, 1 arquivo `pdf`, campo `tipo` = `extrato` | `cartao`, `sessionId`).
  - Sessão válida e conta do setor `financeiro` ou admin (decisão do Claude).
  - Só `.pdf` que começa com `%PDF`. Limite de 10 MB do multer já existente.
  - Nome gravado: `<nome original sem acento/caracteres estranhos>_AAAAMMDD_HHMMSS.pdf` (decisão do Claude),
    para um nome antigo já em `JA PROCESSADOS` não virar falso "concluído".
- Módulo `lib/financeiro.js`: guarda os envios em `dados/financeiro_envios.json`, confere as pastas e diz o status de cada envio:
  `enviado` → `processado` (achou em `JA PROCESSADOS`) | `erro` (achou em `ERROS_LEITURA`).
  Enquanto o arquivo ainda está na pasta de entrada = aguardando o robô. Some da entrada e não aparece em nenhuma = "processando".
- Socket: tela entra na sala `financeiro` com `pedir_financeiro_estado` (mesma checagem de permissão) e recebe `financeiro_estado`
  ao entrar e a cada mudança.
- Tela: trilha Anexado → Enviado → Processando → Concluído/Erro. Mostra o último envio de cada tipo ao reabrir.
  Mais de 30 min sem resultado: aviso "o robô ainda não pegou o arquivo", e continua olhando.

## Fica para quem constrói
Visual exato dos estados, textos dos avisos, nomes internos.
