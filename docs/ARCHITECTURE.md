# Arquitetura e decisões anteriores à implementação

Sistema de pesquisa e paper trading; nenhuma rota de execução de ordens.

1. Binance spot pública: REST bootstrap de 600 candles fechados 1m/5m/15m/1h; WebSocket aggTrade, bookTicker, depth20, candles. 1m é insumo de timing, nunca horizonte de operação.
2. Candles somente fechados, pivôs confirmados com atraso explícito. Tempo de evento e recebimento separados. Gaps, desconexão, heartbeat e relógio incerto bloqueiam análise. Reconexão refaz bootstrap.
3. Indicadores puros + features versionadas; horizontes 5/10/15 têm vetor e modelo próprios (por ativo). Snapshot por minuto é persistido mesmo sem modelo; não é sinal.
4. SQLite persistente: snapshots, candles, observações, sinais, notícias, reações e outbox. Falha de gravação bloqueia emissão. Um único processo coletor por banco (lock exclusivo em arquivo SQLite auxiliar).
5. News Intelligence independente: feed JSON normalizado configurável e adaptador LLM compatível com chat completions; embeddings opcionais para deduplicação semântica. Fonte ausente/erro são visíveis. Confiança do classificador nunca vira probabilidade de mercado.
6. Reação: baseline anterior à publicação somente se arquivado; horizontes 1/3/5/10/15 são medições, não operações. Resultados ausentes não são interpolados. Features de notícias usam availableAt (após classificação), nunca apenas publishedAt.
7. Pesquisa offline: observações prospectivas exportadas; split cronológico train/validation/test com purga por labelEnd; walk-forward; regressão logística multiclasses e temperature scaling em validação. Sem modelo pré-treinado fictício. Modelo JSON contém versão, cobertura, datas, parâmetros, métricas e validade.
8. Gates: qualidade do feed, modelo, notícias no SNIPER, confluência configurável, volatilidade, spread, cooldown. Scores são heurísticas declaradas; probabilidades exclusivamente do modelo.
9. Sinal persiste previsão e execução paper separadas. Entrada na próxima cotação observada dentro da faixa/validade; saída bid para compra / ask para venda no vencimento da execução. Sem cotação pontual => SEM DADOS, nunca WIN/LOSS fabricado.
10. React/Vite servido pelo backend, WebSocket somente leitura; API local por padrão no Compose. Não há credenciais de exchange. Escala inicial: 3 pares, sem Redis necessário. Distribuição posterior exige leader election e filas.

Dependências: Node 24, TypeScript, ws, express, node:sqlite, zod, pino; React/Vite e lucide-react; Python numpy/scipy/scikit-learn. Docker Compose opcional, sem serviço de banco separado. Testes usam dados sintéticos explicitamente apenas no diretório tests, nunca runtime.

Limites: book parcial de 20 níveis, não livro completo nem identificação de ordens iceberg; suporte/resistência, retest, liquidez e reversões são heurísticas, não fatos causais. A estatística de notícias é associação observada. Feed de notícias precisa de fornecedor e contrato descrito em API.md. Alertas externos são pontos de extensão, não envios ativados.

As operações SQLite são síncronas; esta versão destina-se a uma instância e poucos ativos. Meça latência sob crescimento do banco antes de ampliar. Backup usa API nativa de SQLite; transações de sinais/outbox não contêm awaits.
