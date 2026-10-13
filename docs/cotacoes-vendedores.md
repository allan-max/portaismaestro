# Cotações vendedores — versão para avaliação

## Funcionamento

- Acesse a Planilha Vale com seu login habitual e use a aba **Cotações vendedores**.
- A rota `/teste/` consulta o robô de planilha pelos eventos existentes do Maestro.
- A seleção é calculada com os dados recebidos: somente vendedores atribuídos a cotações com data válida igual ou posterior ao dia atual aparecem.
- Datas vencidas, inválidas e registros sem vendedor são excluídos. Vencimentos de hoje são incluídos. A coluna RESPOSTA não é usada para excluir registros: o critério desta versão é o prazo.
- Cada carteira abre sem limite de data final, em ordem crescente. Busca, período, consulta de todas, detalhes, impressão e Excel continuam disponíveis.
- Selecionar um vendedor não troca a conta autenticada. Ainda não há vínculo obrigatório entre e-mail e vendedor nesta versão de avaliação.
- Situação e anotações de acompanhamento ficam apenas no navegador. O botão **Marcar como respondida** grava `RESPOSTA: RESPONDIDO` no JSON do servidor, após confirmação do gerenciador. A sincronização com Excel continua a cargo dos serviços existentes do usuário.

## Arquivos necessários

- `public/teste/index.html`
- `public/teste/style.css`
- `public/teste/app.js`
- `public/planilha_vale.html`: acrescenta o acesso à nova tela.
- `server.js`: exige sessão autenticada na consulta da planilha.

As bibliotecas `public/vendor/exceljs-4.4.0.min.js` e `public/planilha-exportar.js` já fazem parte da main e são reutilizadas.

## Publicação depois da validação

Depois da revisão e do merge das PRs nos dois repositórios:

1. Conferir `git status` em cada instalação e salvar uma cópia do JSON de cotações antes do primeiro teste de gravação.
2. Atualizar primeiro o serviço do repositório `allan-max/gerenciador-maestro`, incluindo `gerenciador.py` e `resposta_cotacao.py`, e reiniciar o gerenciador. O comando antigo de edição continua disponível.
3. Atualizar o checkout da `main` que atende `maestro.ventura.inf.br` e reiniciar o processo Node do portal. Se houver alterações locais, resolvê-las antes de atualizar; evitar substituir toda a pasta por uma cópia antiga. O comando específico impede que um gerenciador antigo faça uma edição sem conferir a identidade completa da linha.
4. Abrir a Planilha Vale e atualizar com Ctrl+F5. A nova aba leva para `https://maestro.ventura.inf.br/teste/`.
5. Validar o login, seleção dos vendedores, período, atualização e exportação. Sem sessão, a tela deve pedir login e a consulta não deve enviar dados.
6. Usar uma cotação realmente respondida para validar o botão: conferir `RESPOSTA: RESPONDIDO` no JSON e aguardar o serviço existente atualizar o Excel. Não marcar uma cotação em aberto apenas para testar.

Para reverter a publicação, reverter os commits destas PRs e reiniciar os dois processos. Essa reversão do código não desfaz respostas já gravadas no JSON.

O Express já serve diretórios de `public/`; não é necessário cadastrar uma rota nova nem mudar o proxy para servir `/teste/`.

## Verificação local

`node --test tests/demo-vendedor.test.js tests/planilha-auth.test.js tests/cotacao-resposta.test.js tests/planilha-exportar.test.js tests/planilha-vencimento.test.js tests/sync-planilha.test.js`

Os testes cobrem datas, seleção dinâmica, filtros, autenticação, comando de resposta, exportação e preservação das funções anteriores. No repositório do gerenciador, executar `python -m unittest test_resposta_cotacao.py` para validar gravação em arquivos temporários, repetição, duplicatas e falhas. Nenhum registro de produção foi modificado nos testes.

A resposta é um registro manual de acompanhamento; o botão não envia a cotação para Vale/Coupa. A seleção de vendedor ainda é livre para usuários autenticados nesta avaliação. Não há confirmação de sincronização do Excel nesta tela; o serviço existente precisa ser validado separadamente. Os robôs existentes também podem atualizar `RESPOSTA` em suas próprias rotinas.
