# Financeiro: envio do PDF e acompanhamento das pastas — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela Financeiro envia o PDF para a pasta do robô no SERVIDOR2 e mostra quando ele aparece em `JA PROCESSADOS` ou `ERROS_LEITURA`.

**Architecture:** `lib/financeiro.js` faz tudo que mexe em arquivo (gravar, conferir pastas, guardar envios em JSON). `server.js` só liga a rota HTTP e o socket ao módulo. A tela chama a rota e escuta `financeiro_estado`.

**Tech Stack:** Node 16 (CommonJS), Express 5, multer, Socket.IO, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-19-financeiro-envio-pastas-design.md`

## Global Constraints
- Pastas: `\\SERVIDOR2\Publico\ALLAN\FINANCEIRO\EXTRATO` e `\\SERVIDOR2\Publico\ALLAN\FINANCEIRO\CARTAO`; subpastas `JA PROCESSADOS` e `ERROS_LEITURA`.
- Raiz configurável por `FINANCEIRO_DIR` (padrão `\\SERVIDOR2\Publico\ALLAN\FINANCEIRO`) para testes.
- Conferência a cada 10 s. Aviso de demora depois de 30 min.
- Permissão: sessão válida e (`setor === 'financeiro'` ou `admin === true`).
- Node 16: nada de `fs.cp`, `structuredClone`, `Array.prototype.at`.

## Review Focus
- Mesmo nome de PDF enviado duas vezes → nomes gravados diferentes (sufixo data/hora; se colidir no mesmo segundo, `_2`, `_3`).
- Arquivo `.pdf` que não é PDF (não começa com `%PDF`) → recusado com 400, nada gravado.
- SERVIDOR2 fora do ar na hora de conferir → status não muda, nada quebra; na hora de enviar → erro claro na tela.
- `dados/financeiro_envios.json` corrompido/ausente → começa vazio.
- Nome com `..\`, `/` ou acento → nome gravado limpo, sempre dentro da pasta.

---

### Task 1: `lib/financeiro.js`

**Files:**
- Create: `lib/financeiro.js`
- Test: `tests/financeiro.test.js`

**Interfaces:**
- Produces:
  - `TIPOS = { extrato: 'EXTRATO', cartao: 'CARTAO' }`
  - `nomeGravado(original: string, data: Date) -> string` — base sem extensão, sem acento, só `[A-Za-z0-9_-]` (resto vira `_`, máx 80), + `_AAAAMMDD_HHMMSS.pdf` (hora local).
  - `criarFinanceiro({ raiz, arquivoEstado, agora = Date.now }) -> { enviar, conferir, estado }`
    - `enviar({ tipo, nomeOriginal, origem, email }) -> envio` — valida tipo, confere `%PDF` nos 4 primeiros bytes de `origem`, copia para `raiz/TIPOS[tipo]/<nomeGravado>` (colisão → `_2`…), grava estado. Lança `Error` com `.codigo` = `'TIPO_INVALIDO' | 'NAO_PDF' | 'PASTA_INDISPONIVEL'`.
    - `envio = { id, tipo, arquivo, original, email, enviado_em, status: 'enviado'|'processando'|'processado'|'erro', concluido_em: number|null }`
    - `conferir() -> boolean` (true se algum status mudou). Para envios não concluídos: em `JA PROCESSADOS` → `processado`; em `ERROS_LEITURA` → `erro`; ausente da entrada e das duas → `processando`. Erro de leitura de pasta: ignora aquele envio.
    - `estado() -> { extrato: envio|null, cartao: envio|null }` — último envio de cada tipo.
  - Estado guarda no máximo os 50 envios mais recentes; escrita com `.tmp` + `rename`.

- [ ] **Step 1: testes** (`fs.mkdtempSync` como raiz, criar `EXTRATO`, `CARTAO` e subpastas):
  - `nomeGravado('Extrato Ação ../x.PDF', new Date(2026,10,19,14,30,5))` → `'Extrato_Acao_x_20261119_143005.pdf'` (pontos e barras viram `_`, `_` repetido colapsa, sem `_` nas pontas).
  - `enviar` de extrato grava em `raiz/EXTRATO/` e `estado().extrato.status === 'enviado'`.
  - dois envios com mesmo nome no mesmo instante → segundo termina em `_2.pdf`.
  - arquivo com conteúdo `'oi'` → lança `codigo === 'NAO_PDF'`, pasta vazia.
  - `tipo: 'outro'` → `codigo === 'TIPO_INVALIDO'`.
  - raiz inexistente → `codigo === 'PASTA_INDISPONIVEL'`.
  - mover arquivo para `JA PROCESSADOS` → `conferir() === true`, status `processado`, `concluido_em` preenchido; `conferir()` de novo → `false`.
  - mover para `ERROS_LEITURA` → `erro`.
  - apagar da entrada sem pôr em lugar nenhum → `processando`.
  - novo `criarFinanceiro` com o mesmo `arquivoEstado` lê os envios; `arquivoEstado` com `'{lixo'` → `estado()` = `{ extrato: null, cartao: null }`.
- [ ] **Step 2:** `node --test tests/financeiro.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `node --test tests/financeiro.test.js` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): módulo que grava o PDF na pasta do robô e confere o resultado`.

### Task 2: rota e socket em `server.js`

**Files:**
- Modify: `server.js` (perto de `/api/responder` e dentro de `io.on('connection')`)
- Test: `tests/financeiro-server.test.js` (lê o fonte, padrão de `tests/financeiro-portais.test.js`)

**Interfaces:**
- Consumes: `criarFinanceiro`, `TIPOS` (Task 1); `lerSessao(cofreSessoes, { sessionId })`; `upload` (multer existente).
- Produces:
  - `POST /api/financeiro/enviar` (multipart: `pdf` 1 arquivo, `tipo`, `sessionId`) → 200 `{ sucesso: true, envio }`; 401 sessão; 403 sem permissão; 400 `TIPO_INVALIDO`/`NAO_PDF`/sem arquivo; 503 `PASTA_INDISPONIVEL`. Arquivo temporário apagado em `finally`. Auditoria `registrarAuditoria({ area: 'financeiro', acao: 'enviar_pdf', ... })`.
  - Socket `pedir_financeiro_estado` → mesma permissão; entra na sala `financeiro`; emite `financeiro_estado` com `estado()`. Sem permissão: `sessao_invalida` se sessão ruim, senão ignora.
  - `setInterval(10000).unref()`: `if (financeiro.conferir()) io.to('financeiro').emit('financeiro_estado', financeiro.estado())`. Após envio também emite para a sala.
  - `podeFinanceiro(ficha)` = `ficha && (ficha.setor === 'financeiro' || ficha.admin === true)`.
  - `arquivoEstado`: `path.join(__dirname, 'dados', 'financeiro_envios.json')`.

- [ ] **Step 1: testes** de fonte: existe `app.post('/api/financeiro/enviar'`; usa `podeFinanceiro`; `socket.on('pedir_financeiro_estado'`; `join('financeiro')`; `unlink` do temporário dentro de `finally`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npm test` → PASS (suite inteira).
- [ ] **Step 5:** `.gitignore`: incluir `dados/financeiro_envios.json` se `dados/*.json` de estado já forem ignorados (conferir). Commit `feat(financeiro): rota de envio e aviso por socket`.

### Task 3: tela `public/financeiro.html`

**Files:**
- Modify: `public/financeiro.html`
- Test: `tests/financeiro-tela.test.js` (lê o HTML)

**Interfaces:**
- Consumes: rota e eventos da Task 2.
- Produces: trilha de 4 passos — `Anexado`, `Enviado`, `Processando`, `Resultado`. Pasta abaixo de cada passo: `''`, `\EXTRATO` ou `\CARTAO`, `robô`, `\JA PROCESSADOS · \ERROS_LEITURA`. Resultado verde "Concluído" (`processado`) ou vermelho "Erro na leitura" (`erro`).

- [ ] **Step 1: testes** do HTML: contém `/api/financeiro/enviar`, `pedir_financeiro_estado`, `financeiro_estado`, `JA PROCESSADOS`, `ERROS_LEITURA`, `Erro na leitura`; não contém mais `ainda não está disponível`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar:
  - Botão Enviar ativo quando há pelo menos um PDF anexado; envia cada arquivo anexado (`FormData`: `pdf`, `tipo`, `sessionId`), botão desligado durante o envio; erro mostra a mensagem da rota.
  - `connect` → `socket.emit('pedir_financeiro_estado')`. `financeiro_estado` redesenha as duas trilhas pelo último envio (nome original + hora). Arquivo anexado e ainda não enviado tem prioridade sobre o último envio na trilha.
  - `status` → passos feitos: `enviado` 2, `processando` 3, `processado`/`erro` 4 (erro com classe vermelha).
  - Não concluído há mais de 30 min (`Date.now() - enviado_em`): aviso "O robô ainda não pegou o arquivo. Continuo olhando." Relógio de 30 s redesenha.
  - Texto do rodapé: explica que o resultado aparece sozinho.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** verificar no navegador com `FINANCEIRO_DIR` apontando para pasta local de teste: enviar, mover arquivo à mão para `JA PROCESSADOS`, ver "Concluído"; idem `ERROS_LEITURA`.
- [ ] **Step 6:** commit `feat(financeiro): tela envia o PDF e acompanha o robô`.
