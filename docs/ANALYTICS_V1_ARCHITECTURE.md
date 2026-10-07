# Analytics v1 — desempenho local derivado

O Dashboard existente (`?view=dashboard`) reúne Panorama global, evolução filtrada,
médias por disciplina, ritmo de estudo e leituras descritivas. O header e as rotas
continuam usando os contratos existentes. A apresentação usa o Design System MedSim,
React, HTML, CSS e SVG nativo, sem bibliotecas de gráficos ou dependências novas.

## Fontes e fronteiras

`src/engine/analytics-reader.ts` lê apenas current e history oficiais de cada Exam
publicado no catálogo, nas chaves da revisão **atualmente publicada**. Aceita current
v2/v3 concluído, current v1 legado e histórico detalhado embedded v1, além do history
separado v2/v3. Reutiliza schemas de persistence/Attempt/Result,
`normalizeLegacyAttempt`, `summary` e `isCatalogResultConsistent`. Não carrega Exams
completos, não consulta gabaritos e não cria correctness por questão.

Current em andamento não contribui para resultados concluídos. A compatibilidade
adicional verifica identidade, modo, índice, confirmações de Estudo, relação
completedAt/result e ordem de datas. A consistência acadêmica agregada pertence ao
validador existente; não há fórmula alternativa de gabarito.

Nenhuma leitura de ReviewSession, review archive, annotations, scratch, preferências,
navegação ou Caderno de Erros participa do Analytics. O Caderno continua tendo seu
próprio reader e seus próprios critérios para identificar erros por questão. Seu
histórico detalhado não é necessário para gráficos agregados. Analytics não altera
Attempts, History, ReviewSession ou Caderno, não migra e não repara dados.

## Zero-write e atualização

Todos os AnalyticsAttempt, snapshots, filtros, seleções e agregações vivem em memória.
Não existe novo storage, migration, cache persistido ou materialized view. Abrir a
página, mudar filtros, focar/tocar um ponto, abrir dados ou selecionar uma disciplina
não chama setItem/removeItem de localStorage ou sessionStorage, nem faz fetch.

`useDashboardState` captura o snapshot e um `now` explícito por geração. Mantém o
refresh por pageshow e acompanha eventos de storage das chaves oficiais atuais
(current/history), além de clear global. Domínios pessoais são ignorados. Não existe
polling. Mudar um filtro não captura outro now nem relê o reader analítico.

## Identidade, validade e cobertura

A identidade é `(examId, examRevision, attemptId)`, codificada como tupla JSON para
não criar colisões por concatenação. Um Map deduplica a mesma identidade com conteúdo
acadêmico equivalente. O resumo completo compara startedAt, completedAt, modo e
**todos** os campos do Result. Quando há duas cópias detalhadas, respostas também são
comparadas semanticamente; flags e estado de navegação não são desempenho.

Cópias conflitantes excluem aquela identidade inteira e geram cobertura parcial.
Um Result estruturalmente legível, mas inconsistente, é evidência para conflito;
nunca se escolhe a outra cópia silenciosamente. Uma fonte JSON/schema inválida é
excluída sem alterar seu raw. Fontes independentes e entries válidas são preservadas
quando possível; no v1, current e embedded são validados separadamente. History v3
exige modo e não aceita uma entrada v2 disfarçada. Limites de histórico existentes
continuam ativos. Não há truncamento silencioso de um envelope acima do limite.

Exceção ao acessar o storage ou getItem torna a análise inteira indisponível, com
mensagem e `—`; os resultados já coletados não são apresentados como análise válida.
JSON inválido gera cobertura parcial, não indisponibilidade de acesso. A UI mostra
avisos explícitos quando a cobertura é parcial.

Attempts válidas são ordenadas por Date.parse(completedAt) ascendente, depois examId
e attemptId por code units. Empates não representam uma ordem temporal real; a UI
informa essa limitação. completedAt é a única origem temporal dos resultados.

## Filtros, estatísticas e fórmulas

Período: todo período, últimos 90, 30 ou 7 dias; disciplina: valores reais de
Exam.subject; modo: todos, Prova ou Estudo. Os filtros são combináveis, não entram
na URL e não alteram preferências. As funções puras recebem `now` em milissegundos.
Períodos limitados usam a janela inclusiva `[now - dias * 86400000, now]`; não incluem
resultados futuros. Todo período não limita o histórico retido.

Filtros afetam série, estatísticas analíticas, médias, ritmo e insights. Panorama,
cobertura global por disciplina e Atividade recente mantêm o significado global
existente. A média dos melhores de SubjectCards continua sendo uma métrica global
diferente da média das Attempts filtradas; a microcopy distingue ambas.

- Média: soma dos percentuais / número de Attempts pontuadas, peso 1 por Attempt.
  Nenhuma ponderação pelo número de questões. Sem nota, média é null e aparece `—`.
- Série: um ponto por Attempt com percentage não null, eixo Y fixo 0–100 e X
  proporcional ao timestamp real. Um único instante fica centralizado. Todos os
  pontos são mantidos, inclusive timestamps empatados.
- Média móvel: janela 3, começando no terceiro resultado pontuado; soma dos 3 últimos
  percentuais / 3. Linha tracejada discreta, apenas leitura visual, nunca nota.
- percentage null: conta atividade e conclusões, mas não entra na série, médias,
  tendência ou destaque por nota. Nunca vira 0%. Uma Attempt com nota real 0 é válida.
- Disciplina com menos de 3 resultados pontuados indica amostra pequena.

## Ritmo e buckets

Últimos 7 dias: sete intervalos de 24 horas a partir do cutoff capturado.
Últimos 30/90 dias: intervalos de 7 dias a partir do cutoff, com último intervalo
parcial (5 ou 13 buckets). Há buckets vazios. Limites internos são `[start, end)`;
o último inclui now, evitando dupla contagem. Os labels de datas usam UTC,
explicitamente informado na UI, tornando os buckets independentes de DST/localidade.

Todo período: meses do calendário UTC **com atividade**, sem meses vazios entre
atividades distantes. Os buckets são ordenados pelo início e exibem contagens de
Prova/Estudo, incluindo Attempts sem nota. Barras são relativas ao maior volume do
recorte. Texto e legenda tornam essa contagem acessível independentemente da cor.

## Leituras determinísticas, sem IA

Não há API, LLM, texto probabilístico ou predição. As regras são descritivas:

- Tendência precisa de pelo menos 6 resultados pontuados. Compara média dos 3 últimos
  com a dos 3 imediatamente anteriores. Delta >= +8 pontos percentuais: tendência
  positiva; delta <= -8: atenção; entre esses limites: estável. Informa as duas médias,
  delta e ausência de previsão futura. Menos de 6: dados insuficientes.
  O delta é calculado pela diferença das somas / 3, equivalente à diferença das
  médias, evitando erro de representação binária nos limiares exatos de ±8.
- Maior média exige ao menos 2 disciplinas elegíveis, cada uma com >=3 resultados.
  Empates usam subject por code units, critério determinístico documentado.
- Atenção por disciplina exige >=3 resultados e média <70%, ou média pelo menos 8
  pontos percentuais abaixo da média global filtrada. Se mais de uma é elegível,
  mostra a menor média; empate por subject em code units. Sem fundamento, informa
  que não existe um ponto de atenção claro. Não classifica disciplina como fraca/ruim.

## Acessibilidade e apresentação

Filtros têm fieldset/legend, aria-pressed, select nativo e alvos de pelo menos 44px.
Pontos usam botões HTML com alvos de 44px sobre SVG decorativo. Há um ponto na ordem
Tab, com setas, Home e End para percorrer todos os resultados mantendo foco visível.
Hover, foco e toque mostram os mesmos campos: prova, disciplina, percentual, modo e
data/hora de conclusão. Um select nativo e botões anterior/próximo permitem selecionar
inclusive pontos sobrepostos no touch. Um details oferece tabela com todos os dados;
o SVG não é a única representação. Não há truncamento da série em volumes altos.

Linha real sólida, média móvel tracejada, modo Prova sólido e Estudo com borda
tracejada distinguem séries sem depender apenas de cor. Labels e contagens permanecem
visíveis. Usa apenas tokens existentes, suporta light/dark/high contrast, texto
ampliado e densidade compacta. Não introduz animação obrigatória ou sistema de motion.
Tabelas quebram texto e podem rolar internamente sem overflow da página.

## Backup e Dados/histórico

Backup mantém handlers, schemas v3, leitura v1/v2/v3, arquivo JSON local até 10 MiB,
zero upload, preview, conflicts, preferências, transação e reload. A mudança é de
markup/CSS: guardar/restaurar uma cópia e prévia organizada. Engines backup e
backup-browser permanecem intactos.

Dados/histórico mantém cálculo de quantidades, prepare/confirm, transação, mensagens,
foco, cancelamento e literal **ZERAR**. Indicadores aparecem antes da Zona de cuidado.
Favoritos, configurações e current em andamento continuam preservados pelo domínio
existente. Preparar/cancelar não escreve. O engine history-reset permanece intacto.

## Limitações e deferred

Dados são locais a este navegador e limitados pela retenção oficial atual. Revisões
históricas não são projetadas nem agregadas silenciosamente na revisão atual. Não é
um histórico vitalício. Dissertativas não recebem nota automática. Poucas amostras
não sustentam comparações. Timestamps empatados usam desempate de identidade, não
uma suposta sequência real. Não há resultado por questão nem novas autoridades
acadêmicas. O Panorama mantém seus readers/contratos globais anteriores.

Deferred explícito: predição de nota, IA generativa, ranking, comparação entre usuários,
cloud sync, login, contas, metas, plano de estudo, Simulado Personalizado, analytics
de revisões históricas e histórico vitalício remoto.

## Verificação

`tests/analytics.test.ts` verifica fontes e versões, consistência, identidade,
dedup/conflitos, invalidez, acesso bloqueado, null, ordenação, filtros/boundaries,
moving average, médias, buckets, thresholds e zero-write. `tests/analytics-render.test.tsx`
verifica hierarquia, filtros, alternativa textual, seleção/foco, amostras, unavailable,
partial e manutenção de ações de Backup/reset. `tests/browser/analytics.spec.ts`
exercita os temas, larguras, texto/densidade, touch/teclado, volume e raws imutáveis.
Screenshots/logs de execução ficam em `/tmp`, fora do repositório.
