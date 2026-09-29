# Hospedagem Square Cloud

Este pacote inclui uma versão compilada pronta para upload. Siga [SQUARE-CLOUD.md](SQUARE-CLOUD.md) para configurar o subdomínio e senha do painel. Não é necessário Docker na Square Cloud.

# YOSH — Crypto Market Intelligence

Scanner contínuo para BTC/USDT, ETH/USDT e SOL/USDT, com horizontes independentes de **5, 10 e 15 minutos**. Node/TypeScript, React e SQLite nativo do Node 24. Paper trading por padrão e por construção: **não existe execução de ordens**.

Preços vêm do mercado spot público da Binance. Não são cotações de uma plataforma de opções binárias. Não há preços, sinais, notícias ou modelos de demonstração no runtime.

## Iniciar com um comando

Requisitos: Docker Engine + Docker Compose **2.24 ou superior**, acesso HTTPS/WSS à Binance e aproximadamente 2 GB de RAM disponível.

```bash
docker compose up --build -d
```

Abra **http://localhost:8080**. O banco recebe migrações automaticamente. Volumes preservam dados entre reinícios. Para acompanhar: `docker compose logs -f scanner`. Para encerrar preservando dados: `docker compose down`.

Sem `.env`, os preços e candles públicos são coletados; notícias exibem **FONTE NÃO CONFIGURADA**. Não é preciso fornecer uma chave Binance. Para configurar, copie `.env.example` para `.env` e reinicie o serviço.

O bootstrap carrega 1m, 5m, 15m e 1h; o histórico de 1m cobre o dia UTC inteiro para VWAP. Há pelo menos 60 segundos de aquecimento da microestrutura; o tempo total depende da rede. 1m é exclusivamente insumo técnico, **nunca horizonte de operação**.

**Na primeira execução não haverá sinais nem porcentagens de confiança:** faltam modelos calibrados. Isso é intencional. São coletadas observações por minuto para cada ativo/horizonte, mesmo sem modelos. Valores desconhecidos aparecem como “—”. O modo SNIPER também exige notícias e IA operantes.

## O que está implementado

- REST com fila, timeout, retry, backoff e Retry-After; sincronização e incerteza do relógio.
- WebSocket aggTrade, bookTicker, depth20 e candles; heartbeat, reconexão, validação de payloads, gaps e deduplicação.
- EMA 9/21/50/200, RSI, MACD, ADX/DMI, ATR, VWAP UTC, Bollinger, Stochastic, Supertrend. Indicadores só usam candles fechados.
- Pivôs confirmados, HH/HL/LH/LL, suporte/resistência, breakout, falso rompimento, retest, rejeição, engulfing, doji, pullback, consolidação e continuação como heurísticas documentadas.
- Volume relativo, taker buy/sell em candles e trades, spread e desequilíbrio de livro parcial. “Liquidez” se refere somente às quantidades observadas nos 20 níveis, não a stop clusters ou iceberg.
- Features versionadas e distintas por horizonte; grupos de confluência com pesos configuráveis. Score heurístico não é probabilidade.
- News Intelligence com adaptadores HTTP e LLM, validação de JSON, deduplicação lexical/entidades/tempo e semântica via embeddings configurados.
- Baseline e reação a notícias em 1/3/5/10/15 min usando snapshots arquivados. Ausência de baseline/cotação vira NO_DATA. Agregação por ativo, categoria e horizonte.
- Modelos multiclasses independentes por ativo/horizonte, logits exportados e temperature scaling, expiração, schema e bloqueio fora da distribuição.
- Observações, todas as previsões (incluindo abstenções), resultados, sinais e outbox persistidos. Cooldown por ativo/horizonte, reinício seguro e execução paper com bid/ask observado.
- Dashboard responsivo, WebSocket, feed de notícias, gráficos de fechamentos reais, indicadores, histórico e segmentação de desempenho/calibração.
- Infraestrutura de treino cronológico, purga, walk-forward e replay com os mesmos motores de confluência e paper.

## Fluxo de pesquisa e calibração

1. Deixe o coletor observar o mercado real. A observação de cada minuto é um vetor point-in-time, não um sinal. As observações são rotuladas com trade observado entre vencimento e vencimento + 2s. Dados faltantes não recebem rótulo.
2. Exporte no ambiente de desenvolvimento (Node 24+, Python 3.11+):

```bash
npm ci
# Use uma cópia de backup SQLite em ./data/scanner.sqlite.
npm run export -- research/dataset.json
python -m venv .venv
# Linux/macOS:
. .venv/bin/activate
pip install -r research/requirements.txt
python research/train.py research/dataset.json --out research/candidates
```

Para outro arquivo de banco, defina `SQLITE_PATH` no shell ou use `node --env-file=.env --import tsx scripts/export.ts research/dataset.json`. Scripts locais não carregam `.env` implicitamente.

3. Revise `research/candidates/report.json`: treino 60%, calibração 20%, teste final 20%, purga temporal nas fronteiras e duas janelas walk-forward dentro do período anterior ao teste final. Parâmetros do classificador não são ajustados ao teste. O dataset fica identificado por SHA-256. A validação exige pelo menos 1.500 observações por ativo/horizonte e 200 no teste; isso é um mínimo operacional, **não demonstra suficiência estatística nem vantagem econômica**. Deve abranger diferentes regimes e um período maior do que um único dia.
4. Avalie previsões e faça replay de confluência e execução:

```bash
python research/backtest.py research/candidates/BTCUSDT-5.predictions.jsonl --payout 0.8
npm run replay -- research/dataset.json research/candidates research/replay-report.json
```

O primeiro relatório mede somente previsões; não finge ser execução. O segundo reexecuta os motores TypeScript usando features registradas e snapshots reais de bid/ask. Replay não interpola intervalos sem dados. A resolução de snapshots é 1 segundo: diferenças com o paper prospectivo devem ser medidas. Não existe reconstrução fictícia de order flow/notícias históricas a partir de candles.

5. Após revisão, copie **somente os nove arquivos de modelo `ATIVO-HORIZONTE.json`** desejados de `research/candidates` para `models/`. Não copie `report.json`. O backend recarrega a cada minuto. Cada modelo cobre apenas seu par/horizonte. Modelos são rejeitados após 14 dias desde o fim do teste por padrão. Nenhum modelo é promovido automaticamente nem enviado pronto.
6. Compare resultados posteriores do paper com o teste/replay. Mudar pesos, threshold, cutoff ou estratégia depois de ver o teste invalida a independência desse teste: reserve um novo período futuro. Nunca reporte o mesmo teste reutilizado como evidência nova.

## Laboratório de estratégias (funciona sem modelo treinado)

Ao iniciar, o servidor baixa os últimos `STRATEGY_DAYS` (padrão 30) dias de candles reais de 1 minuto para cada ativo (Binance; se falhar, Bybit; depois OKX) e testa 62 variações de 9 famílias de estratégias (RSI, Bollinger, impulso, sequência de candles, pullback na EMA21, distância da VWAP, fluxo agressor, candle de exaustão e RSI+Bollinger), cada uma nos sentidos seguir e reverter, para 5, 10 e 15 minutos.

- Os parâmetros de cada família são escolhidos só nos primeiros 60% do histórico. A família é julgada uma única vez nos 40% finais, que ela nunca viu.
- O backtest respeita as mesmas regras do paper: entrada no fechamento do candle, saída h minutos depois, uma posição por ativo/horizonte e cooldown. Acerto = movimento a favor (regra de opção binária).
- Aprovação exige pelo menos `STRATEGY_MIN_TRADES` (padrão 100) operações fora da amostra, limite inferior de confiança (Wilson, `STRATEGY_Z` = 1,96) acima do break-even de 55,56% e as duas metades do teste acima do break-even. Em 30 passeios aleatórios de teste, nenhuma estratégia foi aprovada por acaso (720 testes).
- Só estratégias aprovadas emitem sinais paper, com o acerto medido fora da amostra no lugar da probabilidade. Sinais contraditórios se cancelam. A validação é refeita a cada `STRATEGY_REFRESH_HOURS` (padrão 6) com dados novos, então estratégias que perdem a vantagem são desligadas.
- Painel: aba **Estratégias**. API: `/api/strategies`. Fora do servidor: `npm run lab -- research/strategy-report.json`.

Se nenhuma estratégia passar, o sistema não inventa sinais: o painel mostra o acerto medido de cada uma e por que foi reprovada.

## Notícias e IA

Configure `NEWS_URL` com feed JSON no contrato de [docs/API.md](docs/API.md), além de `LLM_BASE_URL`, `LLM_API_KEY` e `LLM_MODEL`. A base deve aceitar `/chat/completions` e JSON object response format. Provedores incompatíveis precisam de adaptação explícita. Não há fonte gratuita inventada ou scraping oculto.

`EMBEDDING_MODEL` ativa `/embeddings`. Sem ele há deduplicação lexical/entidades/tempo; **deduplicação semântica fica indisponível** e não é simulada. `NEWS_REQUIRED=true` bloqueia o modo normal sem notícias; SNIPER já faz isso. Ausência de fonte de notícia reduz a cobertura do modo normal e aparece no painel.

O timestamp disponível para features é posterior ao recebimento e à classificação. Notícias antigas recebidas hoje não são inseridas retrospectivamente em features antigas. A confiança da IA é confiança de classificação, não probabilidade de retorno. O impacto 0–10 é estimado pelo classificador, não impacto medido. Reações são associações observadas, não prova de causalidade.

## Execução paper e métricas

Sinal: faixa = preço analisado ± 0,15 ATR; validade = 30s; fill na próxima cotação válida dentro da faixa. Fora da faixa, desconexão ou atraso invalidam a entrada. Compra entra no ask e sai no bid; venda entra no bid e sai no ask. O horizonte de execução começa no fill, enquanto o rótulo estatístico começa na observação.

WIN/LOSS/NEUTRO usam `RETURN_THRESHOLD` sobre o retorno direcional. Zero custos adicionais; spread incluído. Não há short real, taxas, slippage, funding ou garantia de preenchimento. `NO_DATA`, sinais expirados e invalidados não entram em win rate, mas seus números são apresentados na API de métricas. Win rate = wins / (wins + losses); neutros separados. Calibração prospectiva compara probabilidade com rótulo da previsão, não com a execução.

Para payout 0,8, break-even = 1 / 1,8 = **55,56%** entre resultados não neutros, assumindo perda de uma unidade, ganho de 0,8 e reembolso dos neutros. O threshold deste scanner não é necessariamente a regra de empate de uma corretora. Resultado teórico não garante lucro futuro.

## Desenvolvimento e testes

```bash
npm ci
cp .env.example .env
npm run dev
# Em outro terminal, para hot reload do painel:
npm run dev:web
# Abra http://localhost:5173
npm test
npm run typecheck
npm run typecheck:web
python tests/research_test.py
npm run build
npm run start:local
```

Os testes usam SQLite real em arquivos temporários, incluindo persistência, bloqueio entre coletores e backup. Fixtures sintéticas ficam apenas em tests, nunca no runtime.

## Operação e segurança

- Compose expõe o backend apenas em 127.0.0.1. Na Square Cloud, login e PUBLIC_ORIGIN HTTPS são obrigatórios; veja SQUARE-CLOUD.md.
- SQLite grava em data/scanner.sqlite. Não há PostgreSQL nem better-sqlite3. O banco não é incluído no ZIP.
- Adicione pares em `SYMBOLS`. O adaptador inicial aceita pares USDT spot; confirme existência e liquidez na exchange.
- `MODE` aceita somente PAPER. Alertas externos estão desativados; `AlertAdapter` e outbox definem o contrato para Telegram/WhatsApp/Discord/Push. Implementar dispatcher com idempotência antes de ativar.
- Um arquivo SQLite separado mantém um bloqueio exclusivo do coletor, liberado pelo sistema ao encerrar o processo. Failures de banco impedem emissão. Candle write queue não ignora erros. Reconexões refazem bootstrap; trades durante aquecimento não geram sinais.
- `HTTP_PROXY`/`HTTPS_PROXY` são respeitados para egress. Nunca registre chaves. `.env` não entra no Git ou na imagem.
- `/api/health` dá 503 quando o feed/banco não estão prontos; ausência de modelo aparece separadamente. Health do Docker é operacional, não prova de rentabilidade.
- Sem retenção automática: snapshots de três ativos geram até 259.200 linhas/dia. Monitore disco, faça backup e planeje arquivamento antes de operação longa. Não apague snapshots ainda necessários a rótulos/replay/notícias.
- Planejado para um coletor e poucos pares. A arquitetura modular permite separar serviços; não há alegação de alta disponibilidade distribuída nesta versão.

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md) e [docs/VALIDATION.md](docs/VALIDATION.md).
