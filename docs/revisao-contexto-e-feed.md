# Revisão do contexto de entrada e das velas

## Achados confirmados no código

- O ativo EURUSDT da Binance era apresentado como EUR/USD. Euro/Tether no mercado spot não é o mesmo instrumento que Euro/Dólar Forex. Os nomes e a informação visível da fonte foram corrigidos; nenhuma fonte de Forex foi adicionada.
- A publicação de velas dependia de um negócio recente, mesmo quando a fonte enviava uma vela em formação mais nova. Agora a vela da fonte pode atualizar o gráfico sem um novo negócio. A idade do negócio continua bloqueando sinais quando os dados necessários estão atrasados.
- Clientes reconectados podiam esperar uma alteração de preço para receber um snapshot. Agora há envio periódico do snapshot inalterado, sem inventar movimento ou interpolar cotações.
- Estratégias de reversão eram avaliadas isoladamente e podiam contrariar a tendência atual. O catálogo agora exige contexto; o caminho de estratégias e o caminho de modelos também bloqueiam tendência/timeframe contrários na decisão ao vivo.
- NEUTRO era mostrado como Empate, mas o padrão RETURN_THRESHOLD=0.0005 significa uma faixa de retorno de +/-0,05%. O texto foi corrigido. A classificação histórica e o cálculo de resultado não foram reescritos; o resultado paper continua diferente do resultado contratado em uma corretora.

## Regras implementadas

O contexto usa somente candles fechados até a observação: janela de 80 candles de 1 minuto, pivôs estritos confirmados por dois candles de cada lado, EMA 9/21/50 e inclinação normalizada pelo ATR. Todas as famílias do catálogo usam o mesmo filtro no teste histórico e nos gatilhos ao vivo.

- LTA/LTB: dois pivôs crescentes/decrescentes, separação mínima, linha ainda válida e reteste com fechamento de rejeição.
- Zona lateral: médias sem tendência definida, amplitude delimitada e ao menos dois pivôs próximos de cada borda. Entradas somente nas bordas com rejeição; o centro não libera sinal.
- Fibonacci: impulso entre pivôs confirmados na ordem correta, amplitude mínima, retração entre 38,2% e 61,8% e fechamento de confirmação a favor da tendência.
- Sem contexto definido, candle sem volume ou amplitude de choque, não há entrada pelo catálogo. Os parâmetros são hipóteses de pesquisa, não percentuais garantidos de acerto.

As estratégias existentes recebem identificadores versionados ctx2. O laboratório é recalculado ao iniciar e continua exigindo aprovação fora da amostra antes de liberar estratégias. Os filtros de timeframe aplicados ao vivo podem reduzir ainda mais a quantidade de entradas; o backtest OHLC não reproduz execução bid/ask nem mede diretamente o resultado dessa seleção adicional.

## Verificação e limites

48 testes automatizados passaram, incluindo tendência contrária, lateralização, Fibonacci, LTA/LTB nas duas direções, ausência de uso de candles futuros e avanço da vela sem negócio novo. Typecheck do servidor e frontend e build de produção passaram. A tentativa de teste de navegador não pôde iniciar porque o executável Chromium não estava instalado neste ambiente.

Não houve medição de latência na hospedagem nem reconstrução das três operações do print a partir de logs. Não foi executada uma nova avaliação de rentabilidade com histórico real nesta revisão. Os testes usam dados sintéticos para conferir regras, não para demonstrar uma vantagem financeira. A documentação oficial da fonte diferencia os streams de negócios e de velas: https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams

O build compilado acompanha a alteração, pois square-start.mjs inicia dist/server.js. Após aplicar a revisão e atualizar/reiniciar na Square Cloud, conferir a idade dos dados do ativo, aguardar o laboratório terminar e comparar o gráfico com o mesmo par e a mesma fonte. O atraso real restante deve ser medido na hospedagem.
