# Integração do dashboard — registro de trabalho

Base do portal: `935dbe6` (main consultada em 14/10/2026).
Desenho aprovado: opção A, navegação lateral, cartões C em Vendedores, substituição integral de `public/dashboard2.html` e logo enviada.
Regra confirmada pelo usuário: somente `admin === true`; `dashboard_access` não concede esta tela.

## Escopo e interfaces

- Backend: consulta administrativa autenticada → comando existente `comando_carregar_planilha_json` → resposta exclusiva ao solicitante. Revalidar sessão antes de entregar dados; nenhum comando de edição.
- Frontend: dashboard2.html + CSS/JS/dados/exportação em pasta própria; leitura Socket.IO, recorte único, estados de fonte, detalhes somente consulta.
- Entrada: botão Estatísticas confirmado pelo servidor, sem conceder acesso por flags do navegador; coluna de Estatísticas no Painel Admin indica regra exclusiva de admin.
- Exportação: ExcelJS já disponível; todos os registros filtrados e ordenados, cabeçalhos originais + informação administrativa, campos ausentes explícitos.
- Dados: datas da base são mistas BR/US. Datas inequívocas podem ser normalizadas; ambíguas devem ser sinalizadas ou interpretadas conforme escolha explícita de formato do administrador, sem regravar a fonte.
- Histórico: JSON atual não tem data/canal/modo/autor. Mostrar Não registrado. Não criar eventos de envio a partir da consulta.

## Decisões

- Usar worktree isolada: alterações anteriores staged na pasta principal foram preservadas.
- Segurança: o servidor atual aceitava identificação de robô e resultado de login sem comprovar origem. Corrigir esses pontos é necessário para que a autorização administrativa não possa ser forjada por eventos diretos.
- Compatibilidade: o gerenciador na main `469c7b6` ainda conecta sem enviar ROBO_SECRET. O ajuste correspondente deve partir dessa main e enviar o segredo no handshake. Nenhuma rotina de persistência será alterada.
- Segredo público padrão não é autenticação: configurar ROBO_SECRET igual nos dois processos é requisito da implantação protegida.
- Substituir dashboard2 no mesmo endereço; não alterar /teste nem outras telas de vendedores nesta entrega, preservando callers de operações existentes.
- A homologação local usa cópia real somente de leitura e robô isolado que não contém handlers de escrita. Não conectar gerenciador de produção ao servidor de desenvolvimento.

## Verificações

- Baseline: `node --test tests/*.test.js`: 25/25 passaram antes das alterações.
- Concluído: autorização, normalização/filtros, exportação, integração local, revisão desktop/mobile e prova de ausência de escrita nas cópias isoladas.
- Final: 39/39 testes Node; 19/19 testes Python. Bibliotecas/API do Socket.IO verificadas; integração também passou sem WebSocket nativo no processo de testes.
- Homologação visual: 1440×1000 e 390×844; Excel real de 18 linhas filtradas reaberto e conferido; fonte inválida manteve cache rotulado, bloqueou exportação e recuperou; conta comum recebeu zero registros.
- Ruling: gráficos nativos em CSS/SVG, com controles acessíveis, em vez de carregar Chart.js por CDN. Os gráficos necessários são simples e isso evita uma dependência remota adicional.
- Ruling: próximo horizonte inclui hoje até +7, com o intervalo explícito no indicador e no gráfico; não há diferença silenciosa de janela entre eles.
- Ruling: impressão representa a visualização atual; Excel é o relatório completo do recorte, independentemente de paginação.
- Revisão de compatibilidade: somente ROBO_SECRET é lido antecipadamente; a carga das outras opções mantém sua ordem legada. Isso evita ativar o modo de teste do Python ou mudar opções do Node/PM2 por causa de um .env antigo. A ordem também foi incluída no teste de autenticação Python.
- Commits e PRs autorizados pelo usuário em 14/10/2026; entrega preparada para revisão em duas branches. Merge, atualização e homologação no servidor ficam com o usuário.
