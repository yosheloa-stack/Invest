# Operação, histórico e tela cheia

## Fluxo exibido

O cartão Plano da operação mostra o ativo e a direção, a faixa válida para entrar,
o prazo de validade do sinal, a entrada paper registrada e seu horário. A saída
é por tempo: 5, 10 ou 15 minutos depois da entrada confirmada, conforme o sinal.
O horário previsto é conhecido após a entrada; o preço de saída só é conhecido
no vencimento. Se não houver cotação válida, o resultado continua sendo SEM COTAÇÃO,
e não uma vitória ou derrota inventada. O cartão sinaliza dados indisponíveis.

Os avisos existentes de entrada e resultado foram preservados; o aviso de entrada
registrada agora informa o horário de saída. Precisam ser habilitados pelo botão
e dependem da página aberta e das permissões do navegador. Não há envio de ordens
à corretora. Todos os resultados aqui são paper e usam a fonte Binance spot.

## Histórico

A página consulta até 500 registros persistidos em /api/signals, atualiza a cada
15 segundos e combina esses registros com os recebidos ao vivo, sem duplicar IDs.
Exibe data do sinal, ativo/direção, duração, preço/horário de entrada, saída prevista,
preço/horário de saída, resultado e motivo. Há filtros de ativo, duração e resultado,
e exportação JSON da seleção. A taxa mostrada usa WIN e LOSS; neutros e resultados
sem cotação ficam de fora. Uma falha na consulta é mostrada sem apagar os registros
já recebidos. O horário apresentado é o horário local do navegador.

## Uso dos resultados recentes

Antes de admitir um sinal, a aplicação verifica resultados da mesma estratégia
ou versão do modelo, ativo e prazo. Considera no máximo os últimos 50 resultados
WIN/LOSS dos últimos sete dias, dentro dos 500 sinais recentes carregados pelo
servidor. Desduplica IDs e rejeita resultados futuros ou não encerrados.

Com pelo menos 20 resultados, se o limite superior de Wilson de 95% para o acerto
ficar abaixo do equilíbrio calculado pelo payout configurado, novas entradas dessa
combinação são pausadas até uma hora após seu último resultado. Depois desse prazo,
a combinação pode ser reavaliada pelas regras normais; isso não significa que ela
se recuperou. Uma perda nova pode iniciar outra pausa. Não há martingale, aumento de
confiança ou promessa de recuperação. Não muda operações já abertas nem reescreve
os resultados. Três losses sozinhos não atingem a amostra mínima.

Esse bloqueio é uma proteção adicional da execução paper, não um modelo treinado
para garantir lucro. Não está incluído na simulação histórica OHLC do laboratório.
O desempenho real combinado precisa ser acompanhado com os resultados ao vivo.

## Tela cheia

O botão na barra do gráfico amplia a área da operação. Usa a API nativa quando
suportada e uma sobreposição da página como alternativa, inclusive no iPhone.
Esc ou o botão Sair da tela cheia retorna à visualização anterior. A área ampliada
preserva o plano e os resultados, tem rolagem própria, prende a navegação por Tab
nos controles visíveis e restaura o foco ao sair.

## Validação desta revisão

53 testes automatizados passaram, além dos typechecks do servidor e frontend e
do build. A regressão com Chromium passou em desktop e viewport móvel: troca de
pares/timeframes, recuperação de histórico vazio, avisos, plano de operação,
alternância/saída de tela cheia, filtros de histórico e ausência de transbordamento
horizontal na página móvel. Não houve medição de rentabilidade ou execução real.
