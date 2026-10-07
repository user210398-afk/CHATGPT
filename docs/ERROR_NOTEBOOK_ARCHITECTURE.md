# Caderno de Erros — arquitetura proposta, sem implementação

Status: projeto para tarefa futura. Baseline inspecionado:
`8a3114f4ca36e2976156026ee9bb00345df23b33` (PR #18).
Esta tarefa cria somente este documento: não há rota, componente, engine, botão,
key, cache, migration, teste funcional ou integração com Dashboard do Caderno.

## 1. Decisão e fronteiras

O Caderno é uma visão derivada read-only das respostas objetivas incorretas em
Attempts oficiais **concluídas**, válidas e detalhadas que ainda estão disponíveis
neste navegador. Não é uma fonte de verdade de erros, nem um histórico vitalício.
Não gravar um domínio QuestionPerformance. Contadores e classificações são valores
em memória; nenhum campo é acrescentado a Exam, Attempt ou Result.

Não consumir ReviewSession, `sessionQuestionState`, scratch, eliminações, grifos,
annotations, previews, flags como outcome, navegação, backup como fonte paralela,
dados transitórios ou notas pessoais futuras. Um backup importado só influencia a
visão por seus registros oficiais já validados nos domínios existentes.

Abrir, ler, filtrar, ordenar, paginar, expandir histórico e navegar são ZERO WRITE:
nenhum setItem/removeItem, timestamp de abertura, migração, índice ou cache persistido.
Uma ação futura explícita de iniciar revisão pertence ao domínio ReviewSession e
é a única exceção aqui projetada; não ocorre ao abrir/navegar/selecionar itens.

## 2. Código e contratos reais que fundamentam o projeto

| Fonte existente                                     | Contrato relevante                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/exam-state.ts`                          | Attempt contém id, examId, examRevision, answers, flagged, currentIndex, startedAt, completedAt, result, mode, confirmedQuestionIds. Não há timestamp por resposta. `isCompatibleAttempt` valida IDs/respostas/revision e recalcula o resultado por `calculateResult`. |
| `src/engine/persistence.ts`                         | current v3 e v2; v1 embute current e history detalhado. `normalizeLegacyAttempt` fornece mode=exam e confirmações vazias em memória. `:history` v2/v3 contém **resumos**, sem answers/question outcomes. HISTORY_LIMIT=20.                                             |
| `src/engine/review-history.ts`                      | `:review` v1 contém snapshots oficiais completos, estritos, concluídos; REVIEW_LIMIT=20. `combineDetailedAttempts` deduplica current concluído/archive por Attempt.id e rejeita divergência acadêmica. Current pode ser o 21º snapshot disponível.                     |
| `src/engine/catalog-progress.ts`                    | `readExamProgress` lê resumos sem carregar Exam; consistência agregada não prova correctness por questão.                                                                                                                                                              |
| `src/engine/review-filters.ts`                      | `reviewQuestionStatus` já determina essay/unanswered/correct/incorrect usando `questionBehaviors`, a mesma autoridade de `calculateResult`. Reutilizar esta função para outcomes.                                                                                      |
| `src/engine/exam-loader.ts`                         | `loadExam(id)` carrega somente a revision publicada atual; não há loader/registry de conteúdo antigo.                                                                                                                                                                  |
| `src/engine/review-session.ts`                      | Sessão é separada de Attempt, uma prova/revision, uma source Attempt; questionIds congelados em ordem acadêmica. Seleções atuais: incorrect, flagged, filtered. Não representa conjunto arbitrário de erros de várias Attempts.                                        |
| `src/app/ReviewPage.tsx`                            | Hub lê `readReviewSummary` com catálogo; Exam completo somente na abertura explícita.                                                                                                                                                                                  |
| `src/app/useDashboardState.ts`, `DashboardPage.tsx` | Apenas resumos para métricas. Não adicionar fetch de todos os Exams.                                                                                                                                                                                                   |

`storageKey`: `chatgpt-exams:v1:<examId>:r<revision>`; sufixos oficiais
`:history` e `:review`. Não criar uma key `errors`. Não mudar esses contratos.

## 3. Quais Attempts entram

Conjunto elegível por identidade examId/revision:

1. current oficial concluído, proveniente de envelope current v3/v2 ou v1;
2. snapshots completos de `:review` v1;
3. history **detalhado embutido** em current v1, normalizado em memória com
   `normalizeLegacyAttempt`. Esse terceiro caso não é exposto integralmente por
   `readReviewSummary` hoje; um futuro reader read-only deve extraí-lo explicitamente
   via `previousEnvelopeSchema`, sem usar `AttemptRepository.load`, capture/save ou
   importar backup para obter os dados.

Para cada fonte: parse estrito, limites existentes, identidade exata,
`completedReviewAttemptSchema` após normalização e `isCompatibleAttempt` com o Exam
exato. Exigir completedAt/result não nulos, completedAt >= startedAt. Exam mode
entra concluído. Study entra concluído e todas as respostas preenchidas devem estar
confirmadas; Study em curso, mesmo com algumas confirmações, fica fora da v1.
Draft não confirmado nunca é outcome oficial do Caderno.

Current em curso pode coexistir com arquivo concluído válido; não o incluir.
Ausência de current não impede leitura de archive. History resumido isolado v2/v3
pode sinalizar histórico/limitação de cobertura, mas nunca fornecer respostas ou
atribuir seus `incorrect` a questionIds. Resultado agregado não identifica erros.
Não preencher lacunas de retenção nem assumir que todos os resumos têm snapshots.

### Deduplicação, conflito e corrupção

Snapshot de cada fonte é lido uma vez por atualização e validado com seu raw original
somente para detectar consistência de leitura. Nenhum write ou tentativa de reparo.
Deduplicar por examId + revision + Attempt.id antes de agregar perguntas.
Usar `sameAttemptAcademic` para comparar cópias: flagged/currentIndex não alteram
outcomes. Se cópias iguais, current é representação preferida, depois archive, depois
v1 embutido. Essas preferências não mudam desempenho. Se cópias diferem academicamente,
excluir aquela Attempt e avisar conflito; nunca escolher arbitrariamente um vencedor.
Um resumo de mesmo ID com datas/modo/Result divergentes também torna a Attempt
conflitante; resumo nunca substitui answers. Não deduplicar IDs entre provas/revisions.

Envelope inválido: excluir a fonte inteira e preservar raw; não salvar versões
parcialmente reparadas. Fontes independentes válidas podem continuar disponíveis,
com indicador de cobertura parcial. Não imitar automaticamente o salvage individual
do Dashboard; ele verifica totais e não pode validar answers. Erro ao acessar storage:
exibir indisponibilidade, sem alegar que zero questões equivale a zero erros.
Snapshots incompatíveis academicamente são excluídos. Se raw mudar durante leitura,
reler uma vez; se mudar novamente, indicar estado indisponível em vez de loop ilimitado.
Refresh/pageshow/storage event refaz derivação em memória, nunca escreve. Durante
refresh, não misturar contadores de snapshots antigos e novos. Em falha, eventual
último estado válido deve ser identificado como desatualizado e não iniciar sessões.

## 4. Identidade e revisões

A chave conceitual de questão é a tupla `(examId, examRevision, questionId)`.
Usar estrutura de tuplas/maps aninhados, não concatenar strings sem encoding.
Repeated question IDs em Exams distintos são independentes. Alterar revision nunca
herda desempenho antigo, mesmo que questionId ou texto sejam iguais.

- Current revision: coincide com catálogo e Exam carregado, validado; entrada acionável.
- Historical revision: nunca passar suas answers a `loadExam(id)` atual para corrigir.
  O loader atual não fornece versões antigas; v1 do Caderno não finge que as fornece.
- Se o conteúdo exato antigo já tiver um provedor versionado explicitamente aprovado
  no futuro, só validar/agregar contra ele, conferindo id/revision. Essa extensão não
  faz parte da primeira implementação.
- Sem conteúdo antigo: apresentar grupo histórico não acionável por exam/revision,
  com datas/resultados agregados disponíveis e aviso “Conteúdo desta versão indisponível”.
  Não gerar QuestionPerformance, wrongCount por questão, enunciado ou gabarito inferidos.
  IDs presentes em answers não provam quais estavam errados. Esses grupos ficam fora
  dos contadores de questões com erro/pendentes/recorrentes/superadas.

Para descobrir revisions antigas, a futura rota pode enumerar **em leitura** keys
oficiais reconhecidas com parser ancorado do namespace e validar identidade do
payload contra a key; ignorar annotations/review-session/scratch e keys desconhecidas.
Não executar JSON/código oriundo de key/payload. A enumeração não concede autorização
para deletes nem migrações. Provas removidas do catálogo recebem apenas identificação
histórica segura; não inventar subject/title. Sem provedor versionado, não carregar
Exam atual para elas. O primeiro escopo acionável continua sendo o catálogo atual.

## 5. Erro, autoridade acadêmica e tempo

Somente `multiple-choice` respondida e `reviewQuestionStatus(q, attempt) === 'incorrect'`
conta como erro. `unanswered` não incrementa answered/correct/wrong nem muda lastOutcome.
Essay fica fora, inclusive quando possui answer. Questão visitada, eliminada, marcada,
revisada ou destacada não ganha outcome. Reutilizar `reviewQuestionStatus` e o guard
`isCompatibleAttempt`/`calculateResult`; não implementar fórmula paralela comparando
correctAnswer em outro módulo.

Há apenas startedAt e completedAt da Attempt. Para cada outcome de uma questão,
usar **completedAt da Attempt que o contém**. UI deve dizer “Tentativa concluída em…”,
nunca “Você respondeu/errou em…”. startedAt não substitui hora individual da resposta.
Uma confirmação Study não possui timestamp individual disponível.

Ordenar outcomes de cada questão por `(Date.parse(completedAt), Attempt.id)` ascendente.
Comparar IDs por ordem lexical de code units (`a < b`/`a > b`), sem localeCompare.
Datas iguais não permitem inferir sequência real: desempate por ID serve apenas à
reprodutibilidade; sinalizar empate quando afeta interpretação de “depois/último”.
`lastOutcome` é o último **respondido** nessa ordem. Tentativa posterior em branco não
transforma acerto em pendência nem apaga erro anterior.

## 6. Agregação conceitual em memória

`QuestionPerformance` (proposta, não schema persistido):

```text
examId, examRevision, questionId
answeredCount: quantidade de Attempts elegíveis com outcome respondido
correctCount, wrongCount
firstAnsweredAttemptCompletedAt, lastAnsweredAttemptCompletedAt
firstWrongAttemptCompletedAt, lastWrongAttemptCompletedAt (null quando sem erro)
lastOutcome: correct | incorrect
lastAnsweredAttemptId
outcomes: [{ attemptId, mode, attemptStartedAt, attemptCompletedAt, outcome }]
chronologyTie: boolean
availability: actionable-current | actionable-historical (extensão futura)
```

answeredCount = correctCount + wrongCount. Datas first/last são calculadas sobre o
conjunto validado disponível, não o histórico de vida do usuário. Contadores não
incluem visitas, omissões, Study drafts ou sessões. Apenas registros wrongCount > 0
entram na lista principal, mas acertos anteriores/posteriores da mesma identidade
são necessários para calcular categorias. Não filtrar apenas Attempts cujo total
incorrect > 0: uma Attempt posterior com zero erros pode superar erros antigos.

Categorias sobre o conjunto disponível:

| Categoria                 | Regra                                       |
| ------------------------- | ------------------------------------------- |
| Nunca acertei             | wrongCount > 0 && correctCount === 0        |
| Recorrente                | wrongCount >= 2                             |
| Superada/corrigida depois | wrongCount > 0 && lastOutcome === correct   |
| Pendente                  | wrongCount > 0 && lastOutcome === incorrect |

Recorrente pode ser superada; nunca acertei é subconjunto de pendente. Pendentes e
superadas particionam a lista, porém os outros contadores sobrepõem-se. “Nunca acertei”
significa “nunca acertei nas tentativas detalhadas disponíveis”. Explicar a retenção
em ajuda curta; não sugerir memória vitalícia ou IA de prioridade.

Ordem padrão da lista, comparador total:

1. pendente primeiro (boolean descending);
2. nunca acertei primeiro;
3. wrongCount descending;
4. lastWrongAttemptCompletedAt descending por epoch;
5. examId lexical ascendente;
6. examRevision numérica ascendente;
7. questionId lexical ascendente.

Sem sort por enunciado/locale, sem aleatoriedade. Número amigável/label é somente
apresentação, não chave. Nenhuma categoria persiste uma decisão de aprendizado.

## 7. UX futura

Rota carregada sob navegação explícita via query string, coerente com Pages /CHATGPT/;
proposta `?view=error-notebook`, a ser adicionada somente em tarefa autorizada.
Heading “Caderno de Erros”, explicação de fonte/retenção e contadores derivados, por exemplo:
“42 questões com histórico de erro · 17 pendentes · 8 recorrentes · 25 superadas”.
São números ilustrativos, nunca fixture acadêmica/produto nesta tarefa.

Filtros: Todas, Pendentes, Recorrentes, Nunca acertei, Superadas; Matéria e Prova.
Matéria usa Exam.subject real; se agrupar visualmente, reutilizar subject-groups.
Categorias são alternativas de filtro, mas tags visuais podem se sobrepor.
Não alterar flags para representar “superada”. Estado de filtro/seleção é memória/UI,
sem preferência persistida nova.

Período: se oferecido, filtra **outcomes por completedAt**, intervalo inclusivo no
início/exclusivo no fim em UTC; data civil do cliente é convertida explicitamente
para esse intervalo. Recalcular contadores/categorias/ordem dentro do período e
rotular “Neste período”, evitando comparar “superada” no período com total vitalício.
Sem filtro, todo conjunto disponível. Nunca filtrar por data individual inexistente.

Entrada: prova/matéria/label amigável + questionId disponível, trecho read-only do
statement pelo renderer seguro, wrongCount/answeredCount, último outcome e data da
Attempt, tags e disponibilidade. Enunciado não inclui explicação/alternativa correta.
A lista NÃO revela automaticamente gabarito. Conteúdo histórico indisponível fica
em seção separada com limites explícitos e sem ação enganosa. Estado vazio diferencia
sem histórico, sem erros detectáveis, filtro vazio e cobertura indisponível/parcial.
UI futura exige teclado, foco, targets confortáveis, quatro temas, mobile sem overflow.

## 8. Ações futuras e compatibilidade com ReviewSession

- Abrir questão: navegar a visualização read-only identificada pela tupla; não iniciar
  Attempt por visitar. Abertura do Review existente pode revelar feedback somente
  após intenção explícita. A rota atual não possui deep link questionId: esse detalhe
  exige implementação futura com validação de identidade, não manipulação de answers.
- Ver histórico: mostrar outcomes disponíveis e links para Attempts detalhadas que
  ainda podem ser carregadas por ReviewRepository; não capturar snapshot na leitura.
- Revisar agora / selecionar conjunto: seleção de tuplas acionáveis em memória;
  checkbox ou filtro não grava nada.
- Revisar estes erros: início explícito reutiliza domínio e lifecycle ReviewSession.
  Congelar questionIds em ordem acadêmica por exam/revision no momento do início.
  Refresh de histórico altera apenas o Caderno; nunca rederiva sessão já iniciada.

### Limitação concreta e desenho da extensão necessária

Hoje `createReviewSession` exige uma única source Attempt e selection incorrect,
flagged ou filtered, que deriva IDs dessa source. Usá-lo para uma união de erros de
várias Attempts pode revisar conjunto diferente do escolhido. NÃO criar Attempt
sintética, falsificar sourceAttemptId, responder a prova oficial ou esconder isso
em flags para contornar o contrato.

Uma futura fase de ações do Caderno deverá evoluir **explicitamente** ReviewSession
para v2 na mesma key :review-session, preservando reader v1 zero-write. Proposta:
selection discriminada `kind: notebook` com questionIds explícitos congelados,
proveniência por questão (ID/data de uma Attempt oficial que testemunha erro), e
branch de origem notebook distinto do branch single-attempt. Não inventar source única.
Validar conjunto não vazio/único, bounds existentes, exam/revision exatos e ordem
acadêmica; validar testemunhas antes de iniciar, nunca a cada navegação. Continuar
com answers/confirmations/result isolados e `calculateSessionResult` existente.
Fonte desaparecer após início não altera questionIds/answers e não vira erro oficial.

Uma sessão continua pertencendo a **uma prova/revision**. Seleção em várias provas
é particionada e apresentada como grupos; iniciar uma por ação explícita, sem sessão
multi-Exam nem segunda espécie de Attempt. Não substituir sessão ativa silenciosamente:
reutilizar o fluxo explícito de conflito/substituição já existente. Uma sessão por
key de exam/revision, sem fila persistente nova.

Essa evolução requer outra tarefa autorizada, decisões de schema/backup/reset e
regressões do domínio ReviewSession. A primeira entrega futura pode lançar a visão
read-only e links de histórico antes dessas ações; nenhuma ação promete congelamento
arbitrário com o schema atual. `sourceAttemptId`/sourceCompletedAt de v1 continuam
congelados, sem reinterpretação.

## 9. Zero-write, reset e backup

Abrir/filtrar/ordenar/navegar/select/refresh: somente leitura de keys oficiais,
fetch GET de conteúdo e cálculo em memória. Nenhuma migration, cache persistido,
materialized view, timestamp, errors storage ou key a apagar. Testar setItem e
removeItem, comparar todos os raws antes/depois. Storage events também zero-write.

Backup da primeira versão read-only continua v3 sem novos campos; export/import
seguem contratos existentes. O Caderno lê apenas o estado oficial após import.
ZERAR do histórico existente torna a visão naturalmente vazia/refletida, sem novo
reset; annotations preservadas não geram erros. Revision antiga preservada por
política de reset existente não deve ser apagada pelo Caderno. Não anunciar remoção
de todos os registros antigos se o reset atua só sobre domínios reconhecidos.

A futura extensão de ReviewSession v2 necessita decisão separada de compatibilidade
com backup v3 (ou versão nova) e validação/reset da sessão. Não embutir isso na entrega
derivada inicial, não mudar backup preventivamente nesta tarefa.

## 10. Carregamento, performance e Dashboard

1. Página inicial/Dashboard mantêm catálogo e `readExamProgress`, sem engine/Exams do
   Caderno eager. Rota explicitamente escolhida carrega seu módulo futuro.
2. Na rota: catálogo + leitura read-only das fontes detalhadas conhecidas por prova,
   incluindo v1 embutido. `readReviewSummary` auxilia descoberta current/archive,
   mas não omitir fontes legadas nem usar incorreções resumidas como questões.
3. Só carregar Exam atual de provas com pelo menos uma Attempt detalhada concluída
   candidata, incluindo tentativas corretas necessárias à superação. Provas com
   somente resumo não precisam Exam; mostrar cobertura limitada.
4. Filas com no máximo dois fetches simultâneos; um load por exam/revision candidata
   por atualização; AbortSignal em saída da rota; não publicar respostas de geração
   anterior do loader. Não guardar Exams de todas as provas em cache global.
5. Reusar conteúdo já carregado seguro da mesma revision quando disponível; memoização
   somente em memória da rota. Cache persistido seria decisão arquitetural nova.
6. Aggregation O(outcomes) após indexar questões do Exam em memória. Archive limitado a
   20, current até +1, v1 embutido até 20; deduplicar antes da contagem, não cortar união
   silenciosamente para parecer igual ao resumo. Preservar o limite de cada envelope.
   UI pagina lista (proposta 50 entradas), sem revelar gabarito; limitar trechos.
7. Enumeração histórica não carrega conteúdo indisponível. Em catálogo grande, custo
   síncrono de localStorage/JSON e render são riscos; processar provas em lotes com
   progresso/cancelamento, sem writes. Definir limites de raw e número de registros
   no reader futuro e falhar com aviso, sem truncamento silencioso. Limites definitivos
   exigem medição antes da implementação; não declarar limites de annotations como
   se fossem limites existentes de history.

Cards futuros de Dashboard: pendentes, recorrentes, nunca acertei só podem mostrar
contagens corretas sem forçar todos os Exams na inicial. Não há contador por questão
nos resumos atuais. Portanto, adiados até alternativa explícita aprovada (por exemplo
card de acesso sem contagem; resultado somente da rota já visitada em memória com
indicação de atualização). NÃO inventar estimativa pelo total incorrect nem índice
persistido para fazê-los caber. Dashboard e métricas oficiais permanecem independentes.

## 11. Plano de testes futuro (não testes funcionais nesta tarefa)

| Caso                                    | Evidência exigida                                                                                                                                         |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero history                            | Estado vazio verdadeiro, zero Exam fetch, zero writes.                                                                                                    |
| Uma errada                              | Um registro, wrong=1/answered=1, pendente/nunca acertou.                                                                                                  |
| Erro → acerto                           | wrong=1/correct=1, superada, latest correto.                                                                                                              |
| Acerto → erro                           | latest incorreto, pendente, nunca-acertou=false.                                                                                                          |
| Múltiplos erros                         | Recorrente >=2, contagem deduplica ID em current/archive.                                                                                                 |
| Nunca acertou                           | wrong>0, correct=0 nos snapshots disponíveis.                                                                                                             |
| Não respondida/visitada                 | Não conta nem muda último outcome respondido.                                                                                                             |
| Essay                                   | Nenhuma classificação automática; respostas-modelo não dão grade.                                                                                         |
| Exam/Study confirmado concluído         | Ambos elegíveis, grade pela autoridade existente.                                                                                                         |
| Study draft/em curso                    | Nenhum outcome, mesmo confirmações parciais.                                                                                                              |
| ReviewSession                           | Responder/finalizar sessão não muda Caderno nem métricas.                                                                                                 |
| Scratch/eliminações/highlights/previews | Alterar/recarregar não cria outcome nem key errors.                                                                                                       |
| Revision atual                          | Mesmo id/revision, validação acadêmica exata.                                                                                                             |
| Revision antiga/indisponível            | Nunca compara com gabarito novo; grupo histórico fora dos contadores, ações desabilitadas.                                                                |
| IDs repetidos entre provas/revisions    | Tuplas distintas, nenhuma transferência de estado.                                                                                                        |
| Ordem                                   | Permutar ordem de fontes/keys dá saída idêntica; timestamps iguais usam Attempt.id e sinalizam empate.                                                    |
| Filtros/período                         | Contagens e categorias rederivadas com completedAt, bounds e timezone documentados; sem timestamp fictício.                                               |
| Zero-write                              | Espionar set/remove; raws de todos os domínios byte-identical em open/filter/sort/nav/storage event.                                                      |
| Reset                                   | Reflete deletes reconhecidos; annotations sobrevivem e não geram erros; nenhum novo domínio.                                                              |
| Backup                                  | V3 intacto; export/preview/import existentes; nenhuma view/materialização exportada.                                                                      |
| Corrupção/conflito                      | Excluir fonte/Attempt conflitante com aviso; outras fontes válidas preservadas; raw não reescrito.                                                        |
| Legado v1/v2/v3                         | Current v2 normaliza exam; v1 embutido completo entra; history v2/v3 somente resumo não inventa questão; sem migração.                                    |
| Retenção/cobertura                      | Mais resumos que snapshots gera aviso; números não alegam histórico vitalício.                                                                            |
| Performance                             | Load bounded: zero no catálogo/Dashboard, um por candidata na rota, max dois simultâneos, abort/no stale publication, sem fetch em filtro.                |
| Dashboard/métricas oficiais             | Attempt/Result/calculateResult/answeredCount inalterados, nenhuma gravação em navegação.                                                                  |
| UX                                      | Sem gabarito na lista, teclado/foco, 375/390/768/1024/1280, texto ampliado e quatro temas sem overflow.                                                   |
| Sessão futura congelada                 | Selection de várias fontes exige v2 aprovado; histórico muda depois sem alterar conjunto iniciado; fontes ausentes e conflitos não criam Attempt oficial. |

Possibilidade posterior: “Discursivas para revisar” como domínio conceitual separado,
sem autograding nem mistura com erros objetivos. Não desenhar notas pessoais persistidas
como parte desta v1.

## 12. Decisões ainda abertas para futuras autorizações

- Aprovação do schema ReviewSession v2, proveniência notebook e compatibilidade de
  backup/reset; não confundir essa extensão com a visão zero-write.
- Infraestrutura de conteúdo histórico versionado (ausente hoje); até lá, grupos
  antigos permanecem não acionáveis e não classificados por questão.
- Limites quantitativos de raw/lotes para um catálogo muito maior, após profiling.
- Aprovação de deep link read-only para questão e formato visual final da rota.
- Integração eventual de Dashboard sem carga eager, sem contagens inventadas.

Sem mudanças funcionais autorizadas por este documento. Implementação futura exige
nova tarefa e auditoria dos contratos; não ampliar a autorização desta rodada.
