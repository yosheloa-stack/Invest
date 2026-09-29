# Gráficos, entradas e resultados

## Fonte e atualização

O painel mostra Binance Spot. EURUSDT é um proxy EUR/USDT, não o livro EUR/USD de uma corretora. O preço de outra exchange, mercado de futuros ou opção binária pode diferir; não se promete paridade nem latência zero.

O servidor publica o candle em formação até dez vezes por segundo, usando o OHLC da exchange como base e negócios posteriores para atualizar o preço. O histórico fechado continua sendo reconciliado pela fonte. O gráfico não interpola preços. A idade da cotação é a diferença entre o relógio estimado do servidor e o timestamp do último negócio observado; não é uma medição certificada de latência ponta a ponta.

Trocar de par recria a instância do gráfico e cancela a consulta anterior. O histórico ainda vazio é tentado novamente a cada cinco segundos; após carregar, é reconciliado a cada trinta segundos. A janela visível é preservada na reconciliação. Candles de 1m são insumo; as expirações continuam 5, 10 e 15 minutos.

Backtests rodam em um worker separado para não bloquear os sockets com cálculo síncrono. A sincronização de relógio não fica atrás da fila de downloads de histórico.

## Entrada única e validade

Uma posição PENDING ou FILLED bloqueia novas entradas **do mesmo ativo em qualquer horizonte**. O cooldown também é compartilhado entre 5/10/15m e reconstruído dos sinais persistidos. Outros ativos continuam independentes. O motor de modelos é processado antes do laboratório, e os horizontes seguem a ordem 5, 10 e 15m; isso é prioridade operacional, não seleção do prazo com maior probabilidade.

O laboratório não autoriza entradas com validação vencida, erro, lacunas de histórico ou backtest de outra exchange. Os históricos alternativos podem ser consultados como pesquisa. As features são calculadas novamente no instante da decisão. Os testes históricos agora usam RETURN_THRESHOLD para neutros e exigem STRATEGY_MIN_TRADES resultados não neutros.

O backtest de OHLC usa fechamento para entrada/saída. O paper usa bid/ask, preenchimento posterior, limite de preço, validade e agora uma trava por ativo. Portanto, a taxa do backtest **não é a probabilidade de acerto de uma entrada nem a taxa paper**. Não houve validação de vantagem econômica com dados prospectivos nesta correção.

O botão Gatilhos mostra ocorrências históricas da estratégia selecionada. Começa desligado: esses pontos são pesquisa, não notificações de entradas emitidas. Entradas preenchidas e seus resultados são identificados pelo ID, sem duplicação entre HTTP e WebSocket.

## Avisos e resultados

Clique em Ligar avisos após abrir a página para liberar áudio. O navegador precisa permitir notificações; quando não permite, acompanhe o quadro da página. Não há serviço de push nem garantia de entrega com a página fechada, suspensa ou em segundo plano no celular.

Cada transição é consumida uma vez por sessão da página. Há aviso de entrada válida, de preenchimento paper quando o estado PENDING não foi observado, e de GREEN/RED/NEUTRO. INVALIDATED, EXPIRED e NO_DATA não são contados como RED. Snapshots repetidos não repetem avisos. Dados de conexão interrompida não produzem avisos de entrada.

Entradas e resultados mostra os seis registros recentes do ativo e os totais paper persistidos. A taxa é wins/(wins+losses), com neutros separados e tamanho da amostra visível. As métricas são atualizadas quando o sinal muda de estado, sem esperar a próxima virada de minuto. Resultados paper não confirmam execução na conta de uma corretora.

## Verificação e publicação

- `npm run build` recompila `dist/` e `public/` (necessários na Square Cloud).
- `npm run typecheck:web` verifica o frontend.
- `npm test` inclui regressões de deduplicação, avisos, trava por ativo, candle em formação, elegibilidade, threshold e worker.
- `node tests/browser-regression.mjs`, com Playwright instalado, serve fixtures sintéticas apenas no teste; verifica troca de par/prazo, recuperação de histórico vazio, avisos e layout 375px. `PLAYWRIGHT_MODULE` permite localizar uma instalação externa do Playwright; `CHROMIUM_MODULE` permite um Chromium empacotado.

Ao publicar, preserve o SQLite e as variáveis existentes. O build commitado deve ser implantado junto com o código-fonte. Não é necessário migrar o banco para estas mudanças.
