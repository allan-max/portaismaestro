# Portais Maestro

Portal web da Ventura que centraliza o trabalho com portais de compras de clientes (Coupa, Vale, Ariba, ME, Findes, Compras.gov, ArcelorMittal e outros). Pelo navegador, a equipe acompanha cotações, comanda os robôs de extração e resposta, gera DAVs, consulta e-mails e vê dashboards administrativos.

O portal é o ponto central: ele não executa as automações sozinho, e sim conversa em tempo real (Socket.IO) com os serviços externos, como o gerenciador de robôs (`allan-max/gerenciador-maestro`), o serviço de NF e o serviço de e-mails.

## Principais recursos

- **Portais de compras**: telas para Coupa, Vale, Ariba, ME, Findes, Compras.gov e ArcelorMittal, com progresso dos robôs ao vivo, captcha e contagem de pedidos.
- **Respostas de cotação**: o vendedor anexa a Planilha Base e o portal pede o DAV ao gerenciador, que o gera pelo Cotafrete antes de responder.
- **Planilhas e Minhas Cotações**: Planilha Vale, Anmyna e a carteira de cada vendedor, com exportação para Excel.
- **Central de E-mails**: leitura de e-mails pelo serviço Python, sem guardar conteúdo no portal.
- **Dashboards**: cotações, financeiro, NFs, monitoramento, auditoria de ações e sincronização manual (só admin).
- **Segurança**: sessões validadas no servidor, Helmet, auditoria append-only por mês e tokens próprios para robô e serviços.

## Estrutura

```
server.js          Servidor Express + Socket.IO (rotas, eventos e cron)
lib/               Módulos do servidor (auditoria, dashboards, e-mails, DAV, sincronização…)
public/            Front-end (páginas HTML, CSS, JS e bibliotecas em vendor/)
tests/             Testes automatizados (node:test)
docs/              Documentação e planos das funcionalidades
dados/             Arquivos JSON de estado usados pelo portal
.github/workflows/ CI: testes no Windows (Node 16) e Ubuntu (Node 22)
```

## Requisitos

- Node.js 16.20.2 ou superior (produção roda em Windows Server com Node 16; os testes usam Node 18+)
- npm

## Instalação

```bash
npm ci
cp .env.example .env   # preencha os segredos
npm start
```

O servidor sobe em `http://0.0.0.0:8000` por padrão. Em produção roda com PM2 e é atualizado automaticamente pelo atualizador do gerenciador, que só reinicia o site quando não há usuários agindo.

## Configuração

Os segredos ficam no `.env` (nunca versione o arquivo real):

| Variável | Uso |
|---|---|
| `ROBO_SECRET` | Identifica o gerenciador de robôs (mínimo 32 caracteres, igual ao do gerenciador). Vazio bloqueia o robô. |
| `EMAILS_TOKEN` | Token do serviço da Central de E-mails (mínimo 32 caracteres). Vazio recusa o serviço. |
| `MASTER_SECRET` | Chave da criptografia AES-256-GCM. Sem ela, usa uma chave aleatória por processo. |

Opções do ambiente do processo:

| Variável | Padrão | Uso |
|---|---|---|
| `PORT` | `8000` | Porta HTTP |
| `HOST` | `0.0.0.0` | Interface de escuta |
| `ALLOWED_ORIGIN` | `*` | Origem permitida no CORS e no Socket.IO |
| `SYNC_NF_TOKEN` | — | Token do serviço de NF |
| `AUDITORIA_DIR` | — | Pasta dos logs de auditoria |

## Testes

```bash
npm test
```

O CI (`.github/workflows/testes.yml`) roda os testes no Windows com o servidor em Node 16.20.2 e no Ubuntu com Node 22, além de `npm audit`.

## Documentação

Detalhes de cada funcionalidade estão em [`docs/`](docs/), por exemplo a [sincronização manual](docs/sincronizacao/plano.md), as [cotações dos vendedores](docs/cotacoes-vendedores.md) e o [dashboard administrativo](docs/dashboard-administrativo.md).
