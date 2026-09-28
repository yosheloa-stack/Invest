# Validação da versão SQLite

Build TypeScript/React, typecheck e testes locais são executados antes do empacotamento. Os testes de persistência usam arquivos SQLite reais temporários. Incluem migration idempotente, gravação, apuração sem cotação tardia, notícias/reação, outbox, métricas/calibração, rollback, backup, reinício e bloqueio de outro coletor. Fixtures nunca são usadas como dados ao vivo.

A instalação de produção é verificada com npm ci --omit=dev --ignore-scripts. O runtime não precisa de esbuild, better-sqlite3, pg nem compilação nativa.

Não foi feito deploy na conta do usuário; persistência de arquivos em redeploys e disponibilidade externa de feeds precisam de verificação na Square Cloud. Docker não foi executado nesta entrega. O scanner ainda depende de modelos calibrados e de fontes de notícias configuradas; não há modelos prontos ou probabilidades artificiais.

Resultado desta entrega: 26 testes Node passaram; build e typecheck do painel passaram. Instalação limpa com apenas 90 dependências de produção e scripts bloqueados iniciou SQLite, serviu painel autenticado e retornou backup HTTP 200. Uma cotação Binance foi recebida no smoke test; feed permaneceu bloqueado por histórico/relógio/aquecimento, sem alegação de análise operacional completa. A porta 80 não pode ser vinculada neste ambiente de teste (EACCES); o teste HTTP usou 8080, mantendo o inicializador da Square em 80.
