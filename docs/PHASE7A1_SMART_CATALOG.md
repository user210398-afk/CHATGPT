# Fase 7A.1 — Catálogo inteligente e progresso local

## Objetivo e escopo

O catálogo do MedSim passa a refletir o progresso salvo no navegador, com
favoritos, filtros combinados, ordenação e cards informativos. O índice gerado,
as provas, o schema acadêmico, a correção e os fluxos de authoring permanecem
inalterados. Não há dependência nova, API, telemetria ou requisição externa no
runtime.

## Arquitetura

- `src/engine/catalog-progress.ts`: leitor read-only de tentativa/histórico,
  usando metadados do índice e schemas compartilhados de `persistence.ts`.
- `src/engine/catalog-preferences.ts`: repository Zod dos favoritos, separado
  da persistência de tentativas e da preferência de tema.
- `src/engine/catalog-query.ts`: busca, filtros, opções derivadas e ordenação
  como funções puras; não modifica o array do catálogo.
- `src/app/useCatalogState.ts`: snapshot local na montagem, filtros em memória
  e alteração de favoritos. Links normais remontam o catálogo; `pageshow`
  atualiza o snapshot quando o navegador restaura a página pelo bfcache.
- `CatalogPage`, `CatalogFilters` e `ExamCard`: composição, controles nativos
  com labels e cards acessíveis. CSS usa os tokens e breakpoints existentes.

O catálogo lê somente duas chaves conhecidas por prova/revisão, sem enumerar
localStorage e sem baixar JSONs completos. Busca/filtros/renderização não repetem
o parsing do storage. O repository de tentativas mantém seu comportamento; a
refatoração apenas exporta contratos/helpers e permite que as funções de chave
recebam `{ id, revision }`.

## Status e derivação de progresso

- **Não iniciada**: não existe `current` estruturalmente válido e compatível
  com ID, revisão e limites do índice. Um histórico isolado pode ainda fornecer
  contagem de conclusões, resultado e atividade, sem inventar um current.
- **Em andamento**: current válido com `completedAt === null` e `result === null`,
  inclusive após apenas abrir a prova, com zero respostas. Uma nova tentativa
  prevalece sobre conclusões anteriores.
- **Concluída**: current válido com data de conclusão e resultado persistido válido.
  O CTA **Ver prova** abre o resultado existente, sem prometer revisão automática.

O schema compartilhado valida a estrutura. O leitor verifica ID/revisão,
limites de currentIndex, coerência de datas, unicidade de flagged e presença
conjunta de conclusão/resultado. A mesma validação aritmética atende current e
history v1/v2: totais objetivos/dissertativos iguais aos metadados do índice,
objectiveAnswered igual a correct + incorrect, essa soma mais unanswered igual
a objectiveTotal e essayAnswered limitado a essayTotal. Percentage deve ser
exatamente Math.round(correct / objectiveTotal * 100), ou null quando não há
objetivas.

Current concluído com resultado inconsistente é descartado em memória: o status
fica **Não iniciada**, sem progresso ou desempenho inventado. Conclusões válidas
do histórico ainda podem fornecer resultados e atividade. Nenhum dado é
sobrescrito. Flagged duplicado também invalida a tentativa para o catálogo.

O catálogo não conhece os IDs individuais das questões ou alternativas; pode
validar unicidade de flagged, mas não se cada ID de flagged ou key de answers
pertence ao Exam. A checagem aritmética não recalcula acertos a partir das
respostas: a validação acadêmica completa continua sendo responsabilidade da
engine ao abrir o JSON completo da prova.

`answeredCount` conta respostas persistidas não vazias após trim, para não
contar dissertativas apagadas, e fica entre zero e `questionCount`.
`progressPercentage` é o percentual arredondado dessa contagem, com proteção
para denominador inválido. O progresso representa respostas, não o percentual
de acertos.

O histórico aceita somente entradas válidas, deduplica por ID e usa
`includeCurrent` da persistência para incluir uma conclusão ainda não gravada
em history, respeitando o limite existente de 20. Entradas inválidas são
ignoradas em memória; nenhuma reparação é escrita. O current válido continua
legível mesmo que o histórico separado ou o histórico embutido v1 esteja
corrompido. Havendo registros v1 e history v2 do mesmo ID, o history v2 prevalece;
a conclusão do current prevalece sobre ambos.

`attemptCount` conta conclusões únicas disponíveis. Último resultado é o
percentual não-null da conclusão mais recente; melhor resultado é o maior
percentual não-null. Resultados somente dissertativos permanecem null, com
texto **sem nota automática**. Não há média ou nota geral.

`lastActivityAt` usa a data mais recente entre conclusão/início do current e
conclusão mais recente do histórico. Isso preserva a intenção de atividade mais
recente mesmo diante de registros fora de ordem. Não há timestamp de cada
resposta no contrato atual: continuar respondendo não atualiza essa data.

## Persistência e favoritos

As chaves de tentativas permanecem byte por byte:

```text
chatgpt-exams:v1:<examId>:r<revision>
chatgpt-exams:v1:<examId>:r<revision>:history
```

O leitor aceita current v2 e envelope v1, sem migrar ou gravar. Cada revisão é
isolada. A leitura do catálogo nunca chama `AttemptRepository.load`, evitando
criar sessões ou recalcular resultados para listar os cards.

Favoritos usam exclusivamente:

```text
chatgpt-exams:v1:catalog-preferences
```

```json
{ "storageVersion": 1, "favorites": ["exam-id"] }
```

Zod exige envelope estrito, versão conhecida, strings não vazias e IDs únicos.
IDs desconhecidos permanecem preservados, inclusive ao adicionar/remover outros
IDs; não são normalizados nem apagados. O envelope nunca contém respostas.

A UI muda **após escrita bem-sucedida**, no próprio clique. Falha de escrita
mantém o estado anterior e mostra aviso discreto de que o favorito não foi
alterado. Preferências corrompidas ou inacessíveis bloqueiam a escrita; o registro
original não é substituído. Não há recuperação destrutiva automática nem loops
de retry. O botão continua acessível e pode comunicar a indisponibilidade.

## Filtros, ordenação e apresentação

Busca sem acentos em título, disciplina, divisão, ano e tags. Filtros por
disciplina, ano (incluindo não informado quando presente), status, favoritos e
tipo derivado das contagens (objetiva, mista, dissertativa) combinam-se por AND.
Disciplinas são únicas e ordenadas em pt-BR; anos são únicos e decrescentes.

Ordenações: padrão (ordem exata do índice), A–Z pt-BR, ano mais recente,
atividade recente, melhor desempenho e menor desempenho. Menor desempenho
usa o melhor resultado de cada prova em ordem crescente. Valores null vêm
por último; todas as ordenações não-default usam o índice original como
desempate explícito, sem depender da estabilidade nativa de Array.sort.
Default mantém a ordem do índice sem chamar sort. Limpar filtros restaura busca,
cinco filtros e ordenação, sem navegar ou recarregar a página.

Cards mostram metadados, composição, total, status textual, progresso nativo
rotulado, último resultado e conclusões com singular/plural. CTAs: Abrir prova,
Continuar e Ver prova. Favorito usa button com aria-pressed, nome específico e
símbolos distintos. A contagem é anunciada com aria-live; empty state e avisos
usam role=status. Layout empilha os controles no breakpoint mobile existente,
com alvos de pelo menos 44px, tema claro/escuro e foco visível preservados.

## Falhas e limites

Storage ausente/bloqueado/SecurityError não derruba o catálogo: todas as provas
continuam disponíveis, os links abrem provas e busca/filtros independentes de
progresso funcionam. Progresso ilegível cai para não iniciada; histórico válido
pode continuar legível. JSON corrompido nunca é sobrescrito pelo leitor. Avisos
são globais, sem mensagens técnicas em cada card.

- Dados continuam presos ao navegador/dispositivo; limpar os dados do navegador
  remove progresso e favoritos.
- Não há login, sincronização entre dispositivos ou entre abas.
- Busca/filtros/ordenação não persistem entre navegações nesta fase.
- Só as 20 conclusões disponíveis por prova/revisão alimentam os resumos.
- O catálogo valida estrutura e metadados, sem validar referências acadêmicas
  que exigiriam baixar todas as provas.
- Sem dashboard, gráficos, estatísticas por categoria, backup/export/import,
  revisão de erros, sessões personalizadas, backend, banco remoto, PWA/service
  worker, n8n ou analytics. Dashboard/backup ficam para a Fase 7A.2.

## Verificação

Testes novos cobrem progresso v1/v2, deduplicação, revisão, falhas/corrupção e
leitura sem escrita; favoritos versionados com falhas honestas e preservação;
filtros AND e sorts estáveis; componentes e acessibilidade. Playwright executa
os mesmos cenários em desktop/mobile, inclusive armazenamento sintético,
storage bloqueado, corrupção, reload dos favoritos, ausência de fetch das
provas no catálogo e dogfood de duas respostas → conclusão → nova tentativa
com histórico preservado. Os testes não modificam conteúdo acadêmico.

Regressivos cobrem resultados aritmeticamente impossíveis e percentuais
inconsistentes em current/history v1/v2, provas somente dissertativas, flagged
duplicado e preservação do storage. Empates são exercitados também com uma
ordenação de teste que inverte empates sem desempate explícito.

O teste de release existente aceita Abrir prova/Continuar ao revisitar uma
prova já aberta; todas as suas verificações de tema, paths, conteúdo, restauração
e teclado continuam presentes. Testes antigos de persistência/correção mantêm
suas expectativas originais.

A proteção de preservação da Fase 4 permite os três módulos novos do catálogo e
normaliza somente os exports e as assinaturas de chave autorizados em
`persistence.ts`; compara o restante desse arquivo byte a byte com a base
histórica. Correção, transições e scripts legados continuam protegidos.
