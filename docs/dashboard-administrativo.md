# Gestão de cotações — implementação e atualização

## Entrega

`public/dashboard2.html` foi integralmente substituído. O botão **Estatísticas** continua abrindo o mesmo endereço, agora com a visão A, navegação lateral e cartões da proposta C na aba Vendedores. A logo enviada foi incluída como asset próprio, sem alterar outros logos do portal.

A tela usa uma consulta Socket.IO administrativa dedicada. O Node valida a sessão real, exige `admin === true`, encaminha somente o comando de leitura existente ao gerenciador e entrega as cotações apenas ao solicitante autorizado. `dashboard_access`, `dev` ou flags no localStorage não concedem acesso. A resposta é correlacionada a uma requisição do servidor, sua origem é validada e a autorização é conferida novamente antes da entrega.

O shell HTML pode ser baixado sem login; nenhum dado administrativo está embutido nele. Contas sem permissão veem Acesso restrito. A sessão expira conforme o cofre já usado no portal (8 horas); o painel limpa seus dados ao receber invalidação. As permissões continuam sendo emitidas pelo login do gerenciador. Alterações de papel seguem o ciclo de sessão do portal, não criam um novo sistema de contas.

## Funcionalidades

- Visão geral com seis indicadores, gráficos clicáveis, contagens por registro e carteira de toda a equipe.
- Vendedores dinâmicos, incluindo Sem vendedor; cartões ordenados por hoje, vencidas e próximos sete dias. O gráfico inicial mostra as oito maiores carteiras por volume e informa o total disponível na aba Vendedores.
- Filtros simultâneos de vendedores, vencimento, status, prazo e busca; crescente/decrescente; paginação e detalhes somente de consulta.
- O atalho **Pendentes no prazo** foca a operação atual. O estado inicial inclui o histórico e explicita esse período.
- Excel verdadeiro `.xlsx` com todas as linhas do recorte, na ordem selecionada, cabeçalhos, congelamento, autofiltro, campos originais e colunas administrativas. A aba Recorte registra filtros, fonte, quantidade e horário de consulta.
- Imprimir usa a visualização atual do navegador; a exportação Excel inclui o recorte completo, independentemente da página.
- Fonte offline, inválida ou sem confirmação: mensagem explícita; nenhum sucesso artificial com zeros. Se houver retrato anterior, ele fica identificado como desatualizado e a exportação é suspensa.
- Sem botão de responder, editar status ou gravar anotações nesta tela. Outras telas e seus comandos legítimos foram preservados.

### Datas da fonte

A base real mistura `dia/mês/ano` e `mês/dia/ano`. Valores inequívocos são reconhecidos. O padrão sinaliza valores ambíguos, como `06/07/2026`, em vez de atribuir silenciosamente um vencimento. O filtro **Datas ambíguas** permite escolher explicitamente sua interpretação; essa escolha aparece no Excel e não altera o JSON. Datas ausentes ou inválidas permanecem no recorte geral e aparecem ao final da ordenação.

O indicador Próximos 7 dias usa hoje até hoje + 7, inclusive. O gráfico usa a mesma janela, com hoje e os sete dias seguintes. Prazos usam America/Sao_Paulo.

### Histórico de respostas

A fotografia real consultada tinha 12.849 registros e 3.002 respostas registradas, sem campos de data/canal/modo/autor da resposta. Esses campos aparecem como **Não registrado**. O painel não usa vencimento, mtime, horário de consulta ou vendedor atribuído como prova de envio. Também não cria eventos de resposta a cada leitura.

A aba Histórico apresenta o estado disponível e sua cobertura; não representa um histórico retroativo reconstruído. A coleta persistente de eventos é uma etapa própria do planejamento, ainda não instalada. Se a fonte passar a fornecer campos explícitos como RESPONDIDA_EM, OBSERVADA_EM, CANAL_RESPOSTA, MODO_ENVIO, AUTOR_RESPOSTA, ORIGEM_EVIDENCIA e RESUMO_RESPOSTA, a leitura pode apresentá-los; timestamps devem ser ISO com fuso.

## Arquivos

### Portal — branch `feat/dashboard-administrativo`

- `.gitignore`, `.env.example`.
- `server.js`, `lib/dashboard-cotacoes.js`.
- `public/dashboard2.html` (substituição integral).
- `public/dashboard-cotacoes/app.js`, `dados.js`, `exportar.js`, `style.css`.
- `public/img/logo-maestro-dashboard.png`.
- `public/index.html` (Estatísticas confirmado pelo servidor e IDs únicos).
- `public/dashboard.html` (Estatísticas é indicado como exclusivo de administrador, sem toggle de liberação por dashboard_access).
- `tests/dashboard-acesso.test.js`, `dashboard-config.test.js`, `dashboard-dados.test.js`, `dashboard-exportar.test.js`, `dashboard-integracao.test.js`.
- Este documento e `dashboard-administrativo-progresso.md`.

Pasta local: `C:\Users\vendas12\enzo\portaismaestro-admin-dashboard`.

### Gerenciador — branch `fix/autenticacao-dashboard`

- `gerenciador.py`: envia ROBO_SECRET no handshake; recusa segredo ausente/fraco antes de ler CONFIG/base ou iniciar serviços. Carrega .env com suporte a BOM do Windows.
- `test_autenticacao_robo.py`: valida esse contrato sem importar o gerenciador nem iniciar os seus serviços.

Pasta local: `C:\Users\vendas12\enzo\gerenciador-maestro-dashboard-auth`.

Nenhuma rotina de persistência de cotações, pedidos ou Excel foi modificada. A nova consulta reutiliza `comando_carregar_planilha_json`, cujo caminho de leitura foi conferido na main do gerenciador. O serviço de NF continua com seu próprio contrato SYNC_NF_TOKEN.

## Homologação local

Endereço preparado: http://127.0.0.1:8780/dashboard2.html . A aba administrativa foi autenticada no servidor local de validação. O adaptador isolado lê uma cópia real capturada em 14/10/2026; ele não é o gerenciador de produção e não implementa handlers de escrita ou envio comercial.

As evidências, a cópia e o adaptador ficam em `.local-dashboard/`, ignorado no git. Não publicar essa pasta. Se a sessão local expirar ou o processo for encerrado, a tela volta a exigir login; não conectar o gerenciador de produção ao servidor de desenvolvimento para contornar isso.

Resultados:

- 39 testes Node: autorização, origem do robô, sessões, correlação, leitura sem escrita, datas/status, filtros, Excel e testes anteriores de Planilha Vale/Pedidos/NF/conferência.
- 19 testes Python: persistência protegida, resposta e handshake; executados em arquivos temporários ou AST, sem iniciar o gerenciador.
- Excel pelo navegador: Gustavo + Micheli, 14–20/10/2026, decrescente: **18 registros na lista e 18 no arquivo**, além da página visível, com ordem idêntica. O arquivo baixado foi reaberto e conferido.
- Conta comum com dashboard_access e flags locais forjadas: sem indicadores, sem exportação, zero cotações recebidas; botão Estatísticas oculto.
- Falha de fonte, recuperação, busca vazia, leitura em andamento, ausência de histórico, escape de HTML, detalhes/teclado e layouts 1440×1000 e 390×844 verificados no navegador.
- SHA-256 da cópia permaneceu `6b5ffcac0a8c2c44bc571661760a5656c322b7d1c5b4373445b91ebb9d93341e` após as interações e exportação. Isso comprova o teste isolado; não atribui alterações de serviços externos em produção ao dashboard nem garante o funcionamento de serviços não executados.

## Atualização no servidor — somente após homologação e merge dos dois pacotes

O novo servidor deixa de aceitar identificação pública/forjada do robô e resultados de login enviados por navegadores. **O gerenciador e o portal precisam ser atualizados em conjunto**, com o mesmo ROBO_SECRET de pelo menos 32 caracteres. Um gerenciador antigo, que não envia o segredo, será recusado. Essa mudança de configuração é necessária para a autorização administrativa ser efetiva.

1. Termine as tarefas em andamento, pare o gerenciador com Ctrl+C e pare o portal com `pm2 stop Site-Maestro`. Preserve os backups e os arquivos de dados atuais. Não feche o gerenciador no meio de uma tarefa nem execute git pull mantendo uma instância antiga aberta.
2. Se já existir ROBO_SECRET próprio e forte, mantenha o mesmo valor nos dois processos. Caso contrário, gere um no PowerShell do servidor:

   ```powershell
   $segredoMaestro = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
   $segredoMaestro
   ```

3. Adicione `ROBO_SECRET=valor_gerado` ao `.env` de cada instalação, preservando todas as outras configurações:
   - `C:\Users\Administrator\Desktop\maestro\portaismaestro\.env`
   - `C:\Users\Administrator\Desktop\gerenciador-maestro\.env`

   O `.env` não deve ser commitado. Se o PM2 já tiver ROBO_SECRET no ambiente, atualize-o para o mesmo valor ao reiniciar: `$env:ROBO_SECRET = $segredoMaestro`. Se estiver mantendo um segredo existente, use esse valor em vez de gerar outro.

4. Em cada repositório, confira `git status --short`, preserve alterações locais e atualize a main após os merges:

   ```powershell
   cd C:\Users\Administrator\Desktop\maestro\portaismaestro
   git status --short
   git switch main
   git pull --ff-only
   npm ci --omit=dev
   $testesMaestro = (Get-ChildItem .\tests\*.test.js).FullName
   node --test $testesMaestro

   cd C:\Users\Administrator\Desktop\gerenciador-maestro
   git status --short
   git switch main
   git pull --ff-only
   python -m unittest test_autenticacao_robo.py test_planilha_persistencia.py test_resposta_cotacao.py
   ```

   Se houver alterações locais, erro no pull ou falha nos testes, resolva antes de reiniciar; não use reset/clean para forçar a atualização. O arquivo `.env` deve continuar presente nas duas pastas.

5. Reinicie o Node com `pm2 restart Site-Maestro --update-env` e inicie **uma única** instância do gerenciador pelo método habitual (`python gerenciador.py` na sua pasta). Confira que ele conectou sem recusa. O Node mantém a porta original 8000, salvo a configuração existente do servidor. Consulte `pm2 logs Site-Maestro --lines 50` e o console/log habitual do gerenciador se houver falha de conexão.
6. Entre novamente no Maestro: a reinicialização do Node invalida sessões do cofre em memória. Use Ctrl+F5, entre como admin e abra **Estatísticas**. Confira fonte, totais, filtros, detalhes e o Excel. Uma conta comum não deve ter o botão nem dados no acesso direto à nova tela.
7. Confira também Planilha Vale, Pedidos, NF e os serviços usados na instalação. Os testes locais anteriores passaram, mas execução comercial dos robôs e sincronização no servidor real ainda dependem desta verificação após a atualização.

### Reversão

Pare os dois processos e reverta o código para versões compatíveis entre si. Preserve .env, JSONs, Excel e backups atuais. Não restaure um JSON antigo como parte automática da reversão de interface. Reverter só o handshake do gerenciador enquanto mantém o Node novo provoca recusa de conexão.

## Estado de publicação

Implementação validada localmente e preparada para revisão por PR em cada repositório, conforme autorização do usuário em 14/10/2026. Os dois pacotes devem entrar na main antes da atualização coordenada. Merge, implantação e homologação no servidor ficam com o usuário; nenhum dado operacional faz parte dos commits.
