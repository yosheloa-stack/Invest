# Contratos e APIs

Todas as rotas são somente leitura. Mesmo host do painel; WebSocket `/ws`. JSON; timestamps epoch em **milissegundos UTC**. Express serve o bundle React na porta 8080.

| Rota | Conteúdo |
| --- | --- |
| GET /api/health | ready/degraded, database, bloqueios por ativo, modelos e notícias; HTTP 200/503 |
| GET /api/state | Snapshot do painel; assets, forecasts, métricas, notícias e últimos sinais |
| GET /api/signals | Até 500 sinais persistidos, incluindo execução/resultado |
| GET /api/metrics | Total, pendentes, sem dados, invalidados, wins/losses/neutros, winRate, grupos, calibração |
| GET /api/news | Status, 50 eventos recentes, reações e estatísticas por categoria |
| GET /api/models | Modelos carregados, tamanho do teste e erros de validação |
| WS /ws | Estado completo inicial e atualização aproximadamente a cada segundo |

Não há POST de ordens ou endpoint para receber modelos não confiáveis. Modelos são arquivos locais administrados pelo operador.

## Feed de notícias (adaptador configurável)

`NEWS_URL` deve responder GET com array JSON de até 100 artigos; consulta a cada 30 segundos, timeout 15s. `NEWS_API_KEY`, se configurada, é enviada como Bearer. Cada artigo tem:

```ts
interface Article {
  title: string;       // 3..1000 caracteres
  content: string;     // até 30000 caracteres; texto editorial não confiável
  source: string;      // nome explícito do publicador
  url: string;         // URL original
  publishedAt: string;// ISO 8601 UTC, ex.: formato YYYY-MM-DDTHH:mm:ss.sssZ
}
```

URLs/timestamps inválidos rejeitam a resposta. Datas futuras (>1s) e artigos >24h são ignorados na coleta inicial. `receivedAt` e `availableAt` são gerados pelo coletor. Fontes que retornem outro contrato exigem adaptador na borda; não há identificação falsa de fonte implementada.

O adaptador LLM chama `LLM_BASE_URL + /chat/completions` com `response_format: {type:'json_object'}` e valida o objeto contra o schema em `src/news.ts`. Campo `confidence` [0,1] é exclusivamente confiança de classificação. `assets` usa BTC/ETH/SOL/MARKET. Event types: regulation, etf, exchange, stablecoin, hack, liquidations, rates, inflation, fed, macro, protocol, other. Embeddings opcionais via `/embeddings`, com modelo explicitamente configurado.

Sem embeddings, a deduplicação semântica não opera. Similaridade lexical e de entidades continua. Similaridade semântica usa cosseno >0,92 e interseção de entidades em janela de seis horas; deve ser avaliada com o modelo escolhido. Duplicatas não multiplicam o peso do evento. Deduplicação heurística pode unir eventos distintos ou deixar passar paráfrases; não é identidade editorial garantida.

## Features

Versão `market-v1`, ordem em `FEATURE_NAMES` (`src/features.ts`). Cada registro guarda nomes, valores, timestamp, horizonte, indicadores, grupos, IDs de notícias e detalhes estruturais. Features são congeladas na observação, nunca recalculadas com notícias posteriores.

| Horizonte | Micro | Local | Macro | Retorno retrospectivo |
| --- | --- | --- | --- | --- |
| 5 min | 1m | 1m | 15m | 5 candles 1m |
| 10 min | 1m | 5m | 15m | 10 candles 1m |
| 15 min | 1m | 5m | 1h | 15 candles 1m |

Pivôs exigem duas velas posteriores fechadas para confirmação. Bandas usam desvio populacional, RSI/ATR/DMI/ADX usam suavização Wilder e EMA usa seed SMA. VWAP = soma(preço típico × volume) / volume nos candles fechados do dia UTC; é VWAP baseado em candles, não VWAP exato por cada trade. Supertrend usa ATR14 e multiplicador3. BB20/2; RSI14; MACD12/26/9; Stochastic14/3; ADX14.

Preço de features vem do último trade contemporâneo. Volume agressor dos últimos 60s vem de `aggTrade.m`: buyer maker implica vendedor agressor. `depth20@100ms` é snapshot parcial completo a cada evento; não é delta de livro completo. A troca do snapshot evita inventar sincronização de depth diffs. BookTicker não carrega timestamp do evento: utiliza recebimento local com relógio sincronizado, e sua limitação é explícita.

## Modelos e sinais

Classes do modelo: 0 = retorno < -threshold, 1 = neutro, 2 = retorno > threshold. Softmax calibrado por temperatura. Score de confluência e fatores não são convertidos em probabilidade. Par/horizonte incompatível, schema errado, modelo expirado, pouca validação ou feature padronizada >12 desvios bloqueiam sinal.

Estados de decisão: COMPRA, VENDA, SEM ENTRADA, ANÁLISE INDISPONÍVEL. Estados persistidos de execução: PENDING, FILLED, INVALIDATED, EXPIRED, SETTLED, NO_DATA. O front detecta interrupção do WebSocket (>6s) e não mantém indicação válida no congelamento da página.

AlertAdapter: `send(signal, idempotencyKey): Promise<void>`. Outbox tem unique(signal_id, channel). Retries e rate limits de cada canal devem ser implementados ao instalar o adaptador correspondente. WebSocket do painel publica o estado persistido e clientes lentos são desconectados. Outbox não afirma que a pessoa recebeu a mensagem.

## Fontes técnicas consultadas

- https://developers.binance.com/en/docs/products/spot/faqs/market_data_only
- https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md
- https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market
- https://scikit-learn.org/stable/modules/calibration.html
- https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html

O pipeline usa splits explícitos com purga pelo timestamp final do rótulo e calibração por temperatura em holdout, não o CV aleatório padrão.

## Hospedagem SQLite

GET /healthz é público e indica apenas processo vivo. Os demais endpoints HTTP e o WebSocket exigem autenticação quando configurada. Na Square Cloud, credenciais são obrigatórias. GET /api/backup fornece download de backup SQLite consistente autenticado; só um backup por vez. O arquivo contém registros internos: guarde-o em local privado.
