# Instalação simples — versão 2 / SQLite

Não precisa contratar PostgreSQL. O banco é um arquivo criado automaticamente pela aplicação. Este pacote não usa better-sqlite3 e não exige compilação nativa. Requer Node 22.16+ ou 24+ (o log anterior mostrou Node 24.21).

1. Pare a aplicação antiga. Preserve/baixe qualquer arquivo de dados existente antes de substituir arquivos. Este ZIP é uma reconstrução a partir da versão original; alterações realizadas pela IA da Square não estão incluídas. Não apague data/ se tiver registros.
2. Envie o ZIP completo. squarecloud.app, package.json, square-start.mjs, dist/ e public/ devem estar na raiz, sem pasta externa. Substitua os arquivos de código e package-lock.json. Deixe a plataforma reinstalar as dependências. Não envie node_modules do computador.
3. Mantenha o subdomínio real da sua aplicação. O exemplo em squarecloud.app é yosh-crypto-scanner; disponibilidade não verificada. A configuração reserva 1024 MB, como a versão anterior: não aumenta o plano nem garante que sua conta tenha essa memória disponível.
4. Em Configurações → Variáveis de ambiente, preencha:

| Nome | Valor |
|---|---|
| DASHBOARD_USER | yosh (ou seu usuário) |
| DASHBOARD_PASSWORD | Uma senha exclusiva de pelo menos 16 caracteres |
| PUBLIC_ORIGIN | Endereço HTTPS real da aplicação, sem caminho; exemplo https://yosh-crypto-scanner.squareweb.app |
| MODE | PAPER |
| PAYOUT | Opcional. Padrão 0.9 (payout da Ebinex em BTC, ETH, SOL e outros); break-even 52,6%. Use 0.96 só se operar ativos que pagam 96%. |

SQLITE_PATH é opcional; padrão ./data/scanner.sqlite. Não configure DATABASE_URL, DATABASE_SSL ou certificado: esta versão não usa essas opções. Variáveis antigas de PostgreSQL são ignoradas e podem ser removidas. Não existe senha padrão embutida.

5. Reinicie. Tanto npm start quanto MAIN=square-start.mjs usam o mesmo inicializador. Ele valida o login e inicia na porta 80, em 0.0.0.0. Procure nos logs “SQLite inicializado”. “dashboard iniciado” sozinho não confirma conexão aos feeds.
6. Abra o endereço HTTPS. Entre com DASHBOARD_USER no campo e-mail e DASHBOARD_PASSWORD na senha (conta de administrador), ou crie uma conta nova na própria tela. Espere o histórico e o feed carregarem. Modelos e notícias ausentes aparecem explicitamente; não são fabricados sinais.

## Backup pelo celular

Já autenticado no painel, abra o mesmo endereço acrescentando /api/backup. Exemplo:
https://yosh-crypto-scanner.squareweb.app/api/backup

O download é um backup SQLite consistente. Faça antes de atualizar ou recriar a aplicação. Ele contém seus registros, não senhas de ambiente. O download fica indisponível se o coletor não terminou a inicialização.

Pelo terminal da aplicação também pode usar npm run backup. O arquivo será criado em backups/ e poderá ser baixado pelo gerenciador. Para restaurar: pare o scanner, envie o backup e execute npm run restore -- caminho/backup.sqlite --confirm. O script rejeita coletor concorrente e preserva uma cópia anterior antes de restaurar.

## Deploy pelo GitHub (repositório yosheloa-stack/Invest)

O repositório já contém dist/ e public/ compilados, então a Square Cloud não precisa rodar build. Na Square Cloud: Nova aplicação → GitHub → selecione o repositório e a branch main. A plataforma lê squarecloud.app na raiz, instala as dependências de produção e inicia square-start.mjs. Preencha as variáveis do passo 4 antes do primeiro start.

Ao alterar código em src/ ou web/, rode npm run build e faça commit de dist/ e public/ junto, senão a Square continuará servindo o build anterior.

## Robô IA (opcional)

O robô opera sozinho em SIMULAÇÃO (aba "Robô IA"): a cada candle de 1 minuto lê o mercado, entra quando um gatilho com histórico acima do equilíbrio dispara, e registra ganho/perda no vencimento. Nunca envia ordem à corretora.

Para ligar a análise do Claude, adicione em Variáveis de ambiente:

| Nome | Valor |
|---|---|
| ANTHROPIC_API_KEY | Sua chave da API (console.anthropic.com → API Keys) |

Opcionais: ROBOT_AI_MODEL (padrão claude-opus-5), ROBOT_AI_MAX_PER_HOUR (padrão 30 consultas por hora), ROBOT_STAKE (10), ROBOT_BANKROLL (1000), ROBOT_MAX_OPEN (3), ROBOT_MIN_TRADES (30), ROBOT_ENABLED (true). Sem a chave, o robô funciona só com as regras.

## Persistência e compatibilidade

O arquivo persiste em reinícios normais enquanto o disco da aplicação for preservado. A retenção pela Square Cloud em atualização/redeploy não foi verificada nesta conta; não presuma que recriar/excluir a aplicação preserve arquivos. Mantenha uma cópia de backup fora da hospedagem. Nunca inclua data/, backups/, .env ou senhas no ZIP compartilhado.

Se já existir um SQLite criado pela outra IA com schema desconhecido, o sistema recusa modificá-lo. Preserve-o e configure SQLITE_PATH=./data/scanner-v2.sqlite para começar uma base nova; dados antigos não são migrados automaticamente sem conhecer o schema.

Um único coletor por arquivo. Não escale réplicas. O banco cresce com snapshots; acompanhe disco e faça arquivamento. As chamadas SQLite são síncronas: expansão de ativos exige medir latência.

## O que esta entrega não configura

Não há integração validada com Ebinex. Os preços são Binance Spot, e expirações/preços da corretora podem diferir. Não executa ordens. Não inclui modelos calibrados nem credenciais de notícias/IA. Treinamento e validação seguem README.md.

## Código e testes

Node 24+, npm ci, npm run build, npm test. O ZIP já inclui dist/ e public/. Na produção, npm ci --omit=dev --ignore-scripts instala tudo que o runtime precisa; esbuild só é usado para gerar o painel no ambiente de desenvolvimento.

Node SQLite: https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html
