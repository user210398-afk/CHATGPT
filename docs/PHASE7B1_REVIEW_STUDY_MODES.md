# Fase 7B.1 — Modos de tentativa, revisão e limpeza visual

Implementação iniciada do zero na base `d1d9fc3fac7a99f6ad51ccf4153b25e263b07a93`,
branch `codex/phase7b1-review-study-modes`, worktree `/workspace/CHATGPT-phase7b1`.
O checkout original `/workspace/CHATGPT` estava e permanece limpo. A referência
remota foi confirmada pelo conector GitHub e, após habilitar a opção de rede
suportada pelo executor, também por `git fetch origin` e `git rev-parse origin/main`.
A falha inicial de conexão do sandbox não alterou arquivos do projeto.

Nenhum git add, commit, push, PR, merge ou Pages/deploy foi executado. A aplicação
continua client-side, sem serviço, dependência, conta, API externa ou telemetria nova.

> Registro histórico da implementação. A auditoria final pré-commit, com correções
> e estado atualizado, está na última seção deste documento.

## Contratos e leitura

| Registro         | Legado congelado                  | Nova escrita       |
| ---------------- | --------------------------------- | ------------------ |
| Current          | v1 (com history detalhado), v2    | v3                 |
| History compacto | v2, ou tentativas embutidas no v1 | v3                 |
| UI preferences   | v1                                | v2                 |
| Backup           | `medsim-backup` v1                | `medsim-backup` v2 |
| Review archive   | não existia                       | storageVersion 1   |

`legacyAttemptSchema`, `previousEnvelopeSchema`, `currentV2EnvelopeSchema`,
`historyEntryV2Schema`, `historyV2EnvelopeSchema`, `uiPreferencesV1Schema` e
`backupV1Schema` mantêm objetos estritos dos contratos anteriores. Os novos
schemas não são inseridos silenciosamente nos envelopes antigos.

As chaves continuam `chatgpt-exams:v1:<examId>:r<revision>` e `:history`.
Legacy sem modo normaliza em memória para `mode='exam'` e
`confirmedQuestionIds=[]`; history normaliza para Exam. O histórico v2/v3
isolado ou importado ao lado de current v1 continua legível. Nenhuma leitura
migra, cria, repara, remove ou grava registros. Uma ação natural pode gravar v3.
History mantém apenas id, início, conclusão, result e mode; não recebe respostas.

`AttemptRepository.read` retorna current null quando não há tentativa restaurável:
o chooser não chama createAttempt e não cria UUID antes da escolha. `load` permanece
como ponte de compatibilidade para consumidores internos que precisam de tentativa
Exam em memória. A UI utiliza `read`.

## Modo Prova e Modo Estudo

`createAttempt(exam, now?, id?, mode?)` mantém a compatibilidade das chamadas
internas anteriores. A interface sempre fornece o quarto argumento explicitamente.
Novas tentativas têm modo Exam ou Study e confirmações inicialmente vazias.
Não existe ação para trocar o modo de uma tentativa iniciada.

Modo Prova preserva seleção, troca de resposta, dissertativa, navegação e marcação.
Gabarito, explicação e resposta-modelo só são renderizados após finalizar. Study
salva um draft editável e libera feedback apenas após `confirm-answer`, sem avançar
sozinho. A renderização condicional elimina feedback da árvore DOM antes da
confirmação; não usa CSS para esconder respostas.

A confirmação rejeita modo Exam, conclusão anterior, questão inexistente,
resposta vazia ou confirmação repetida. Depois, o engine recusa novas ações
answer naquele ID, além do bloqueio de radio/textarea na interface. O mapa distingue
em branco, draft (…), confirmada (✓), marcada e atual, com nomes ARIA e legenda.
O progresso Study mostra Confirmadas X/Y e drafts pendentes.

Objetivas mostram correta/incorreta, alternativa escolhida, alternativa correta e
explicação. Dissertativas usam Confirmar e comparar, bloqueiam o textarea e mostram
Resposta confirmada, modelo e eventual explicação, sem nota ou correto/incorreto.

`pendingConfirmationIds` identifica respostas Study não vazias ainda não confirmadas.
Finish é no-op se houver qualquer uma; a UI informa a quantidade e oferece Ir para
primeira resposta pendente. Questões em branco podem ficar em branco. Não há confirmação
automática. `isCompatibleAttempt` rejeita Study concluído com draft, confirmações
duplicadas/inexistentes/sem resposta e Exam com qualquer confirmação.
`calculateResult` e question-behaviors continuam a única autoridade acadêmica;
a fórmula e as regras de correção foram preservadas byte a byte.

## Chooser e preferências

UI preferences v2, na mesma chave interna de antes, acrescenta
`attemptModePreference: 'ask' | 'exam' | 'study'`, default ask. V1 normaliza para
v2+ask em memória. Tema legado permanece intacto. A primeira escolha explícita
pode salvar v2, preservando tema, texto, contraste, densidade, movimento, foco e convite.

Configurações inclui Experiência da prova / Modo padrão para novas tentativas,
com Perguntar sempre, Modo Prova e Modo Estudo, e a ajuda sobre novas tentativas.
Ask mostra Como deseja fazer esta tentativa? e os dois botões explicativos;
abrir sem escolher tem zero writes e não marca o catálogo como Em andamento.
Preferências Exam/Study podem iniciar automaticamente. Current restaurado sempre
mantém seu próprio modo. Nova tentativa volta ao chooser se a preferência for ask,
sem substituir o current concluído antes de escolher.

## Arquivo detalhado e reinício

`review-history.ts` concentra schema, leitura, capture, dedup, colisões, ordenação,
retenção e flags. `reviewStorageKey(exam)` gera exclusivamente
`chatgpt-exams:v1:<examId>:r<revision>:review`. O envelope estrito tem
storageVersion 1 e até 20 tentativas concluídas, contendo id, examId, examRevision,
mode, confirmedQuestionIds, answers, flagged, startedAt, completedAt, result e
currentIndex. Nenhuma chave arbitrária é lida do usuário.

Captura só aceita conclusão com result, schema e compatibilidade acadêmica completa.
Depois de salvar current/history na finalização, tenta gravar o snapshot; falha mantém
o resultado principal e informa que o histórico detalhado não pôde ser salvo.
Antes de reiniciar, captura o current concluído, inclusive pré-7B; se falhar, não
substitui current nem abre nova tentativa. Captura repetida deduplica por ID;
conteúdo acadêmico divergente é conflito real e nunca é sobrescrito. Ordenação por
conclusão precede retenção; empates preservam explicitamente a ordem dos registros.
A captura de reinício exige que o current persistido continue sendo a tentativa
esperada, mesmo quando o snapshot já existe. A combinação em memória pode listar
21 registros (20 no archive mais um current concluído mais antigo). Se 20 snapshots
importados tiverem conclusões posteriores ao current, o Hub ainda permite revê-lo,
mas reinício e marcação que perderiam seu snapshot pelo limite abortam com aviso.
Exportação mantém o current completo e limita reviewAttempts aos 20 mais recentes.

## Hub, rotas e revisão compartilhada

Header: Catálogo, Dashboard, Revisão, Configurações. Dashboard inclui Revisar questões
e uma nota discreta de que as métricas incluem os dois modos; fórmulas permanecem iguais.
Resultados e histórico compacto exibem o modo, inclusive legado como Modo Prova.
Rotas reais e query strings preservam Pages `/CHATGPT/`, sem router ou rewrites:

- `?view=review`: hub global;
- `?view=review&reviewExam=<id>&attempt=<id>`: tentativa histórica;
- `?exam=<id>`: sessão atual, com a precedência anterior sobre view.

O hub usa apenas catálogo e storage conhecido. Combina em memória current concluído
com archive, deduplica por ID e mostra título, disciplina, quantidade, data, resultado,
modo, acertos, erros, em branco e marcadas. Não confunde history compacto com detalhes
nem carrega todos os 19 Exams. Abrir um registro carrega apenas o Exam escolhido e
valida conclusão, referências, revisão, respostas, resultado e confirmações. Registros
inválidos mostram erro seguro, sem reparação automática.

`ReviewView` e `QuestionCard` são compartilhados pela revisão imediata e histórica.
Filtros: Todos/Erradas/Acertadas/Em branco/Dissertativas, Todas/Somente marcadas,
categoria exata e tag exata, combinados por AND. Blancos objetivos são separados
de erros; essays sempre são dissertativas; flags sobrepõem todos os estados.
O resumo conta esses cinco grupos. Navegação e filtros são estado local e fazem
zero writes, sem gravar currentIndex. Ao desmarcar em Somente marcadas, mostra a
próxima questão restante pela ordem da prova (ou a primeira se não houver seguinte),
e estado vazio quando não sobrar nenhuma.

## Marcação pós-conclusão e transação

Answer, confirm e finish continuam bloqueados após concluir. Flag é a única
exceção de estudo. Os botões permanecem ativos nas duas revisões e nos dois modos.
Datas, respostas, result, modo e confirmações permanecem iguais; history compacto
não muda. Navegação histórica tampouco altera a tentativa persistida.

Se o ID ainda é current, a operação captura os raw de current e review, valida
os dois, constrói ambos com as mesmas flags, confere concorrência e grava current v3
e review v1. Se archive estiver ausente, a marcação explícita pode criá-lo. Se o ID
só estiver no archive, grava apenas review; current e history ficam byte-idênticos.
Diferença exclusiva de flags é reconciliável pela operação autorizada, com current
como fonte quando ele representa o mesmo ID. Diferença acadêmica em respostas,
resultado, modo, confirmações ou datas aborta. currentIndex é posição de interface,
não identidade acadêmica; seu valor válido é preservado do current na marcação.

`storage-transaction.ts` compara raw antes e entre writes e verifica o resultado.
Falha na segunda escrita tenta restaurar a primeira, inclusive adapters que alteram
antes de lançar; chave nova pode ser removida. Rollback é reverso e preserva mudanças
estranhas que não correspondam ao valor escrito pela operação. Falha de rollback é
explicitamente informada. A UI só assume novas flags após sucesso e mantém o estado
anterior com Não foi possível alterar a marcação de revisão em caso de falha.

## Backup v2 e compatibilidade v1

Exportação v2 inclui current, history e reviewAttempts por prova e UI preferences v2.
Lê chaves conhecidas em snapshot raw, valida detalhes com o Exam completo e aborta
o arquivo inteiro se houver arquivo detalhado incompatível, corrupção ou mudança
durante export. Current concluído detalhado também pode entrar na exportação em memória
sem gravar archive. Respostas, confirmações e flags atualizadas são preservadas.
Um cache por operação evita carregar repetidamente o mesmo Exam.

Importação aceita os schemas estritos v1/v2, mantendo 10 MiB e os limites anteriores,
sem truncar essays. V1 real normaliza current/mode, history/mode, preferências+ask e
reviewAttempts vazio, sem inventar detalhes históricos. Valida referência de respostas,
opções, flags, modo, confirmações, conclusão, revisão, datas e result de cada snapshot.
A prévia tem zero writes. ID tem identidade compartilhada nos nove pares entre
current/history/review; conteúdo igual deduplica e divergência real preserva local.
Flags importadas divergentes seguem os metadados locais, sem alteração acadêmica.

Review key participa de expected raw, concorrência, writes e rollback de toda a
importação. Chaves são geradas pelos helpers internos. Preferências continuam opt-in
quando existe configuração local, corrupção é preservada e o botão Recarregar para
aplicar remonta a aplicação. Favoritos mantêm a política de união anterior.

## Limpeza visual e prova de preservação

Busca exaustiva em todos os arquivos rastreados encontrou somente estes seis arquivos:

| Arquivo                                    | Tokens removidos |
| ------------------------------------------ | ---------------: |
| data/exams/farmaco-p2-2025.json            |              166 |
| data/exams/imunologia-b4-2023.json         |              120 |
| data/exams/imunologia-b4-2024.json         |              182 |
| simulados/farmaco-p2-Simulado-2025.html    |              168 |
| simulados/imunologia-b4-Simulado 2023.html |              120 |
| simulados/imunologia-b4-Simulado 2024.html |              184 |
| Total                                      |              940 |

A regex autorizada remove somente `[span_N](start_span)` e `[span_N](end_span)`.
Não foram encontradas variantes com barras invertidas literais nem ocorrências em
registros imutáveis de authoring/generations, reviews ou provenance. Nenhuma revisão
foi incrementada. A limpeza dos HTMLs inclui também tokens fora das questões migradas,
explicando os totais ligeiramente diferentes dos JSONs.

`scripts/span-artifacts.ts` aplica exclusivamente essa remoção. `span-cleanup.test.ts`
compara cada arquivo com o commit obrigatório: novo byte = byte original menos tokens.
Confere os 19 JSONs, schemas, authoring, scripts de authoring, package/lock/workflows
e HTMLs, permitindo diferença apenas nos seis arquivos acima. Proteções das Fases 3/4
agora reconhecem essa exceção específica e continuam rejeitando qualquer outra mudança.
A proteção de release aceita bytes originais de fixtures históricas ou bytes com
exclusivamente a limpeza autorizada, preservando os testes de authoring.

Fontes canônicas e legados foram limpos diretamente; generated, public/legacy e dist
foram regenerados pelo fluxo normal, sem edição manual de dist. Testes e buscas reais
verificam zero marcadores nos conteúdos acadêmicos/runtime/legado e Exams publicados.
Dogfood abre explicações afetadas nas três provas e confere ausência visual.

## Limitações práticas

Dados permanecem locais e backup é manual. LocalStorage não oferece transação nativa
ou trava entre abas: comparação e rollback são defensivos; concorrência externa ou
rollback que também falhe gera aviso explícito, sem falsa garantia de sucesso.
Os resumos do hub/catálogo não conhecem IDs de questões/opções sem carregar um Exam;
a validação acadêmica integral acontece ao abrir detalhes, capturar, marcar ou exportar.
Arquivos detalhados retêm as 20 conclusões mais recentes por prova/revisão; históricos
compactos antigos sem respostas não viram detalhes inventados. Backup considera apenas
revisions atuais do catálogo. Engines Safari/Firefox e aparelhos físicos não foram
executados; Playwright usa Chromium desktop e mobile emulado.

Não há refazer erros/marcadas, sessões aleatórias, revisão espaçada, estatísticas
avançadas, backend ou 7C. Essas funcionalidades permanecem fora desta fase.

## Validação e inventário da rodada

Instalação limpa executada com `npm ci --cache /tmp/phase7b1-npm-cache`.
Nenhuma dependência, package ou lock foi alterado. As verificações finais usam
os arquivos desta worktree e a build normal sob `/CHATGPT/`.

| Verificação                                   | Resultado                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| npm ci                                        | instalação limpa concluída                                                               |
| npm run audit:legacy                          | 17 HTMLs / 485 questões legadas em paridade                                              |
| npm run validate                              | 19 provas / 522 questões                                                                 |
| npm run author:validate                       | 2 candidates reais válidos                                                               |
| npm run typecheck                             | sem erros                                                                                |
| npm test -- --maxWorkers=3                    | 689 testes passaram / 28 arquivos, execução isolada                                      |
| npm run build                                 | generate + typecheck + Vite concluídos                                                   |
| npm run validate:dist                         | 19 provas / 522 questões / 492 objetivas / 30 dissertativas                              |
| npm run test:browser -- --workers=2           | 94 testes passaram em Chromium desktop/mobile                                            |
| Prettier --check                              | todos os arquivos de código/testes/docs alterados e novos passaram                       |
| git -c core.whitespace=cr-at-eol diff --check | sem erros                                                                                |
| busca exaustiva de spans                      | zero tokens numéricos em arquivos rastreados; zero em conteúdo publicado                 |
| comparação byte a byte                        | só as 940 remoções autorizadas nos seis arquivos; demais bytes protegidos                |
| security/network                              | runtime interno, chaves geradas internamente, sem credenciais/telemetria/código dinâmico |

A suíte base tinha 595 testes Vitest; foram acrescentados 94, distribuídos entre
engine, storage, backup, render e preservação byte a byte. Os testes anteriores
mantêm a cobertura e atualizam apenas expectativas dos contratos novos, fixtures
legadas reais, ação do chooser e a exceção de spans expressamente autorizada.
Playwright preserva os 70 cenários anteriores e adiciona 24 (12 em cada perfil).

Os cenários novos verificam: chooser sem UUID/write; preferência só para futuras
tentativas; Prova sem feedback antecipado; Study draft, confirmação, resposta errada,
essay sem correção e finish guard; reload de drafts/confirmações; revisão histórica
lazy; filtros AND e navegação sem writes; desmarcação com ajuste da lista; flags
pós-conclusão em ambos os modos, transação e rollback; captura/reinício com falha,
concorrência e limite; roundtrip real de backup v2; contratos v1/v2 congelados;
todas as nove combinações de colisão; importação com arquivo inválido, concorrência,
rollback e limite de 10 MiB; ausência visual dos spans nas três provas afetadas;
tema, contraste, texto, movimento, foco, alvo de toque e overflow.

A execução com paralelismo automático e a rodada Vitest simultânea ao navegador
atingiram o timeout original de 5 segundos de uma fixture de authoring. A rodada
final passou separadamente com três workers (689 testes / 28 arquivos em 52,66 s),
sem relaxar timeout ou asserções.
O navegador completo terminou com 94 testes aprovados, sem falhas.

`git diff --check` padrão sinaliza 133 linhas por tratar o CRLF preservado dos HTMLs
acadêmicos como trailing whitespace. Conferência automatizada confirma que todos
os avisos são exclusivamente essas linhas terminadas em CRLF em `simulados/`.
A variante com `core.whitespace=cr-at-eol` passa. Normalizar esses finais de linha
violaria a exigência de preservação de todos os outros bytes.

A auditoria procurou `dangerouslySetInnerHTML`, `innerHTML`, `eval(`, `new Function`,
`XMLHttpRequest`, `WebSocket`, `localStorage.clear`, `sessionStorage.clear`, `fetch(`,
`setItem(` e `removeItem(` no runtime, além de URLs externas, credenciais e telemetria.
Nenhum sink dinâmico, clear global, credencial ou endpoint externo foi encontrado.
`exam-loader.ts` usa fetcher apenas com caminhos internos de catálogo/Exam validados.
Writes ficam nos repositórios de tentativa/favoritos/preferências e na transação;
removeItem fica exclusivamente no rollback de chave nova. Os testes de navegador
inspecionam requests e console, exigindo apenas origem local `/CHATGPT/` (ou blob de
backup), sem erros. Rede de engenharia foi usada para fetch/dependências, sem API
de geração ou novo acesso externo da aplicação.

### Inventário separado

- A — 26 arquivos de código/UX: `src/` (app, hooks, chooser, cartões, revisão,
  preferências, engine e estilos compartilhados) e `scripts/release-baseline.ts` /
  `scripts/span-artifacts.ts` (exceção exata de preservação).
- B — 28 arquivos de testes/docs: suítes/fixtures/browser, documentação 7B.1,
  nota histórica mínima da 7A.2 e três regras arquiteturais duráveis em AGENTS.
- C — 6 arquivos acadêmicos: os três JSONs e três HTMLs da tabela de spans;
  diferença limitada às 940 remoções de tokens, sem outro byte ou revision alterado.

Total: 60 arquivos, 41 modificados e 19 novos não rastreados. Nenhum staged.
O diff stat abaixo cobre os 41 rastreados; Git não inclui os 19 novos sem staging.
Os novos estão integralmente identificados no status e incluem a implementação
compartilhada da revisão e seus testes. O checkout original continua limpo.

### git status --short --untracked-files=all

```text
 M AGENTS.md
 M data/exams/farmaco-p2-2025.json
 M data/exams/imunologia-b4-2023.json
 M data/exams/imunologia-b4-2024.json
 M docs/PHASE7A2_DASHBOARD_BACKUP_SETTINGS.md
 M scripts/release-baseline.ts
 M simulados/farmaco-p2-Simulado-2025.html
 M "simulados/imunologia-b4-Simulado 2023.html"
 M "simulados/imunologia-b4-Simulado 2024.html"
 M src/app/App.tsx
 M src/app/DashboardPage.tsx
 M src/app/useExamSession.ts
 M src/app/useUiPreferences.ts
 M src/components/exam/ExamPage.tsx
 M src/components/exam/QuestionNavigation.tsx
 M src/components/questions/EssayQuestion.tsx
 M src/components/results/Results.tsx
 M src/components/settings/PreferenceControls.tsx
 M src/engine/backup.ts
 M src/engine/catalog-progress.ts
 M src/engine/exam-state.ts
 M src/engine/persistence.ts
 M src/engine/ui-preferences.ts
 M src/styles/components.css
 M src/utils/paths.ts
 M tests/backup.test.ts
 M tests/browser/phase3.spec.ts
 M tests/browser/phase4.spec.ts
 M tests/browser/phase7a1.spec.ts
 M tests/browser/phase7a2.spec.ts
 M tests/browser/poc.spec.ts
 M tests/catalog-progress.test.ts
 M tests/catalog-render.test.tsx
 M tests/dashboard-metrics.test.ts
 M tests/engine.test.ts
 M tests/persistence.test.ts
 M tests/phase3-global.test.ts
 M tests/phase4-preservation.test.ts
 M tests/phase7a2-render.test.tsx
 M tests/render.test.tsx
 M tests/ui-preferences.test.ts
?? docs/PHASE7B1_REVIEW_STUDY_MODES.md
?? scripts/span-artifacts.ts
?? src/app/ReviewPage.tsx
?? src/components/exam/ModeChooser.tsx
?? src/components/questions/QuestionCard.tsx
?? src/components/review/ReviewView.tsx
?? src/engine/content-equality.ts
?? src/engine/review-filters.ts
?? src/engine/review-history.ts
?? src/engine/storage-transaction.ts
?? tests/browser/attempt-helpers.ts
?? tests/browser/phase7b1.spec.ts
?? tests/legacy-fixtures.ts
?? tests/phase7b1-backup.test.ts
?? tests/phase7b1-engine.test.ts
?? tests/phase7b1-fixtures.ts
?? tests/phase7b1-render.test.tsx
?? tests/phase7b1-storage.test.ts
?? tests/span-cleanup.test.ts
```

### git diff --stat

```text
 AGENTS.md                                      |   3 +
 data/exams/farmaco-p2-2025.json                | 166 +++++++--------
 data/exams/imunologia-b4-2023.json             | 120 +++++------
 data/exams/imunologia-b4-2024.json             | 178 ++++++++--------
 docs/PHASE7A2_DASHBOARD_BACKUP_SETTINGS.md     |   5 +
 scripts/release-baseline.ts                    |  11 +-
 simulados/farmaco-p2-Simulado-2025.html        |  86 ++++----
 simulados/imunologia-b4-Simulado 2023.html     |  60 +++---
 simulados/imunologia-b4-Simulado 2024.html     | 120 +++++------
 src/app/App.tsx                                |  20 +-
 src/app/DashboardPage.tsx                      |   8 +-
 src/app/useExamSession.ts                      | 130 +++++++++---
 src/app/useUiPreferences.ts                    |   2 +-
 src/components/exam/ExamPage.tsx               | 274 +++++++++++++------------
 src/components/exam/QuestionNavigation.tsx     |  33 ++-
 src/components/questions/EssayQuestion.tsx     |   3 +-
 src/components/results/Results.tsx             |   2 +
 src/components/settings/PreferenceControls.tsx |  15 +-
 src/engine/backup.ts                           | 253 ++++++++++++++++-------
 src/engine/catalog-progress.ts                 |  38 +++-
 src/engine/exam-state.ts                       |  56 ++++-
 src/engine/persistence.ts                      | 206 +++++++++----------
 src/engine/ui-preferences.ts                   |  21 +-
 src/styles/components.css                      |  16 ++
 src/utils/paths.ts                             |  18 +-
 tests/backup.test.ts                           |  81 +++++---
 tests/browser/phase3.spec.ts                   |   3 +
 tests/browser/phase4.spec.ts                   |   4 +
 tests/browser/phase7a1.spec.ts                 |  14 +-
 tests/browser/phase7a2.spec.ts                 |  35 +++-
 tests/browser/poc.spec.ts                      |   3 +
 tests/catalog-progress.test.ts                 |  17 +-
 tests/catalog-render.test.tsx                  |   8 +-
 tests/dashboard-metrics.test.ts                |   7 +-
 tests/engine.test.ts                           |   5 +-
 tests/persistence.test.ts                      |  15 +-
 tests/phase3-global.test.ts                    |  18 +-
 tests/phase4-preservation.test.ts              |  66 +++---
 tests/phase7a2-render.test.tsx                 |  17 +-
 tests/render.test.tsx                          |  13 +-
 tests/ui-preferences.test.ts                   |   2 +-
 41 files changed, 1295 insertions(+), 857 deletions(-)
```

Nenhum git add, commit, push, PR, merge ou deploy. Implementação permanece local
para auditoria, com os contratos acadêmicos preservados e as limitações acima.

Classificação final: **APROVADO PARA AUDITORIA**.

## Auditoria final pré-commit — 2026-10-05

Esta seção substitui a classificação e os números do registro de implementação
acima. Auditoria contra `d1d9fc3fac7a99f6ad51ccf4153b25e263b07a93`, na mesma branch e
worktree. O diff integral e os 19 arquivos originalmente novos foram lidos, incluindo
os seis diffs acadêmicos; as provas independentes abaixo complementam os testes.
Nenhuma funcionalidade nova ou refactor cosmético foi realizado nesta rodada.

### A. Findings

| Severidade | Arquivo                                                                                       | Causa e impacto                                                                                                                                                                                                                              | Correção realizada                                                                                                                                                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HIGH       | `src/app/useExamSession.ts`, `src/engine/persistence.ts`, `src/engine/review-history.ts`      | A verificação de concorrência terminava no capture. Uma alteração de current por outra aba entre capture e criação da nova tentativa era sobrescrita pelo save seguinte. Reproduzido interceptando UUID e escrevendo um current estrangeiro. | Capture retorna os raws esperados de current/history/review após a própria escrita. A substituição usa a mesma transação com nova conferência e rollback. Falha mantém a sessão concluída, bloqueia o restart e preserva o current estrangeiro. Testes cobrem concorrência e falha na segunda escrita ao preservar current legado. |
| MEDIUM     | `src/styles/components.css`                                                                   | Link de tentativa no Review Hub media 22 px de altura em 1024/1280, abaixo do alvo solicitado de 44 px.                                                                                                                                      | Link recebe inline-flex e mínimos de 44x44. Medições e teclado passam em 375/390/1024/1280.                                                                                                                                                                                                                                        |
| LOW        | `src/app/DashboardPage.tsx`, `src/app/useDashboardState.ts`, `src/engine/catalog-progress.ts` | Nota sobre ambos os modos aparecia mesmo no Dashboard vazio ou somente com Prova. Informação inexata.                                                                                                                                        | Exibir somente quando o snapshot validado contém Prova e Estudo. Cinco casos verificam vazio, somente Prova, somente Estudo e combinações em current/history; fórmulas acadêmicas não mudaram.                                                                                                                                     |
| LOW        | `.gitattributes`                                                                              | Git interpretava o CR de 133 linhas acadêmicas CRLF como trailing whitespace; o check padrão falhava.                                                                                                                                        | Atributo whitespace restrito aos três HTMLs reconhece cr-at-eol e conserva blank-at-eol, blank-at-eof e space-before-tab. Nenhum atributo de normalização de EOL, nenhum byte acadêmico alterado. Check padrão agora retorna 0.                                                                                                    |

Todos os findings foram corrigidos e validados. Nenhum finding HIGH/MEDIUM/LOW
permanece pendente.

### B. Evidências obrigatórias

| Critério                    | Inspeção e evidência                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chooser zero-write          | O hook usa read, e createAttempt só ocorre em start. Ask sem current não chama UUID/save/capture. Spies e raw snapshots comprovam zero UUID e zero writes em current/history/review/preferences/progresso até escolha por teclado.                                                                                                                                                                                                                       |
| Restore                     | Current restaura mode, answers, confirmedQuestionIds, flagged e currentIndex. Preferência global não reexecuta start sobre current existente; reload dos dois modos coberto.                                                                                                                                                                                                                                                                             |
| Study lock                  | Transition recusa answer em ID confirmado; radio/textarea bloqueados após confirmação e reload. Exam com confirmações é incompatível; Study concluído com qualquer resposta não vazia não confirmada é incompatível. Em branco pode permanecer sem confirmação.                                                                                                                                                                                          |
| Feedback DOM                | QuestionCard monta o feedback somente na condição de confirmação/conclusão. Antes disso gabarito, explanation, modelAnswer e status correto/incorreto não estão na árvore React/DOM. Testes incluem objetiva e essay.                                                                                                                                                                                                                                    |
| Finish guard                | pendingConfirmationIds rege engine e UI: finish é no-op com draft, quantidade é anunciada e Ir para primeira resposta pendente navega ao primeiro ID. Nenhuma confirmação automática.                                                                                                                                                                                                                                                                    |
| Review zero-write           | ReviewView tem índice e filtros locais; dispatch navigate concluído é bloqueado no hook. Comparação raw de todas as chaves antes/depois de filtros/navegação nas duas revisões mostra identidade.                                                                                                                                                                                                                                                        |
| Flag transaction            | Snapshot raw, comparação antes/entre writes e após operação, atualização current+archive e rollback reverso se segunda escrita falhar. Testes simulam erro antes/depois de mutação, concorrência e rollback incompleto com aviso. No sucesso somente flagged difere; answers/result/mode/confirmedQuestionIds/startedAt/completedAt e history ficam iguais. Archive isolado escreve apenas review.                                                       |
| Flag + filtro               | Desmarcar atual em Somente marcadas escolhe próximo remanescente na ordem da prova, ou primeiro, ou estado vazio. Sem índice inválido, questão fora do filtro ou crash.                                                                                                                                                                                                                                                                                  |
| Capture/restart             | Conclusão é válida mesmo com falha no capture. Reinício exige preservar snapshot antes de substituir current. Current pré-7B restaurado é preservado; falha/concorrência bloqueiam substituição. Correção HIGH fecha também o intervalo após capture.                                                                                                                                                                                                    |
| Archive retention           | Schema máximo 20, IDs únicos, capture substitui pelo ID e ordena completedAt desc antes de slice. Empate preserva ordem de entrada explicitamente; prova independente z/a/m mantém z/a/m. Captura de registro novo não privilegia conclusão antiga. Current mais antigo fora dos 20 aparece em memória (21 registros), sem alterar archive; restart/flag que perderiam seu snapshot abortam.                                                             |
| Network Review Hub          | Medição independente na build: Hub 0 requests de Exam; detalhe 1 request, exclusivamente fisiologia-m5-aula-1-2026.json. Playwright repete a asserção em desktop/mobile, inclusive current legado e archive inválido sem writes.                                                                                                                                                                                                                         |
| Storage schemas             | Comparação independente de JSON Schema com fontes da base prova igualdade exata dos sete contratos: attempt antigo, current v1/v2, history entry/envelope v2, UI preferences v1 e backup v1. Leitura normaliza somente em memória, versões desconhecidas falham sem reparar. Novas escritas current/history v3, preferences v2, review v1.                                                                                                               |
| UI preferences              | V1 histórico exato; leitura produz V2 com ask sem write. Só mudança explícita grava V2; demais campos são preservados.                                                                                                                                                                                                                                                                                                                                   |
| Backup v1 real              | Fixture gerada pelo exportador e engine originais da base 7A.2, executados isoladamente em /tmp; não construída com tipos novos. Contém current v1 com history detalhado e current v2 aberto, objetiva, essay com acentos, flags, índice e todas as preferências antigas. Parse/preview/import: zero campos antigos perdidos, preview zero writes, mode exam, confirmed [], preference ask, reviewAttempts [].                                           |
| Backup v2                   | Export/parse/preview/merge/concurrency/rollback inspecionados. Suíte percorre matriz 3x3 current/history/review local versus incoming; conflito em conteúdo acadêmico conhecido preserva local, sem sobrescrita silenciosa. Review participa de expected raw e rollback. Preview não escreve; export não migra.                                                                                                                                          |
| Backup + flags              | Roundtrip de Study real após flag pós-conclusão, export v2 e import em novo browser context; flags, respostas, confirmações, resultado e datas preservados ao abrir revisão.                                                                                                                                                                                                                                                                             |
| Resultados/Dashboard        | answeredCount/calculateResult byte-idênticos à base; question-behaviors e dashboard-metrics também byte-idênticos. Study não altera correção acadêmica. Nota de ambos os modos somente com ambos presentes.                                                                                                                                                                                                                                              |
| Spans 940                   | Comparação independente de bytes: base menos exclusivamente a regex autorizada igual ao arquivo atual em todos os seis. Contagens 166/120/182/168/120/184. CRLF dos HTMLs idênticos (3541/3630/3510); revisions não incrementadas.                                                                                                                                                                                                                       |
| Spans residuais             | Busca literal exaustiva em todos os rastreados: zero matches. rg recursivo incluindo novos: somente regexes de testes e descrição da limpeza em docs, nenhum lixo em conteúdo destinado ao usuário. Mesma busca em dist: saída vazia, exit 1 (sem matches).                                                                                                                                                                                              |
| CRLF/133 avisos             | Comando original exatamente git diff --check, exit 2, stdout com 133 trailing whitespace: farmaco HTML 43, imunologia 2023 HTML 30, imunologia 2024 HTML 60. Todos por CRLF preservado, stderr vazio. Stdout completo e linhas exatas preservados nos artefatos externos abaixo. Após .gitattributes, comando padrão exit 0, stdout/stderr vazios, sem override de core.whitespace.                                                                      |
| Package/workflows/authoring | package.json, package-lock.json, schema/exam.ts, todos workflows e todos arquivos authoring/scripts de authoring byte-idênticos à base. Nenhuma alteração nesses caminhos.                                                                                                                                                                                                                                                                               |
| Security                    | Apenas linhas adicionadas e runtime novo inspecionados. Sem HTML dinâmico/eval/Function/XMLHttpRequest/WebSocket, segredo, telemetria, endpoint externo novo ou limpeza global. Fetch novo em ReviewPage usa loader interno preexistente. setItem novo só em transação e envelope atual; removeItem novo só rollback de chave ausente anteriormente. Fetch e writes anteriores distinguidos dos novos. Clear usado em preparação de teste não é runtime. |
| Acessibilidade              | Chooser, badge, confirmar/feedback, Hub, filtros e flags têm semântica/nome acessível. Badge é texto informativo, sem alvo interativo. Botões/selects/mapa/links têm >=44x44; teclado Enter/Tab/Shift+Tab e foco visível de 5 px com enhancedFocus verificados. Feedback usa status e filtros labels.                                                                                                                                                    |
| Responsividade              | 375/390/1024/1280 revalidados com chooser, objetiva/feedback, essay longa, revisão/filtros/navegação/flag e Hub, texto grande/contraste alto; sem overflow horizontal. Chromium desktop/mobile emulado, sem alegar aparelhos físicos/Safari/Firefox.                                                                                                                                                                                                     |

### Validações finais

Todos os comandos terminaram com exit code 0:

- npm run typecheck
- npm test -- --maxWorkers=3: **696 Vitest, 28 arquivos**
- npm run build
- npm run validate:dist: **19 exams, 522 questions, 492 objective, 30 essay**
- npm run test:browser -- --workers=2: **104 Playwright**, Chromium desktop/mobile
- npm run audit:legacy: 17 HTMLs / 485 questões legadas em paridade
- npm run validate: 19 provas / 522 questões
- npm run author:validate: 2 candidates reais válidos

Aumento sobre 689/94: sete casos Vitest (dois restart e cinco Dashboard) e cinco
cenários Playwright em cada perfil (concorrência no restart e quatro larguras),
total dez. Nenhum teste anterior foi removido nem timeout relaxado. Execução final
sequencial; limites de workers evitam saturação da fixture de authoring.

### Artefatos de prova independentes

Arquivos locais externos ao diff, em `/tmp/phase7b1-audit/`:

- backup-v1-real.json, generate-v1.mts e backup-v1-evidence.json
- contracts.mts e contracts-evidence.json
- byte-evidence.json (940 tokens, CRLF e arquivos protegidos)
- network.mts e network-evidence.json (0/1 requests)
- restart-race-before.json e browser-before.json (reprodução pré-correção)
- security-added.json, span-search-source.txt e span-search-dist.txt
- crlf-before.json e git-diff-check-before.stdout.txt (stdout completo dos 133 avisos)
- git-diff-check-before.stderr.txt (vazio)
- typecheck.log, vitest-final.log, build-final.log, validate-dist.log, browser-final.log,
  audit-legacy.log, validate.log e author-validate.log
- git-status-final.txt, git-diff-stat-final.txt, git-diff-check-final.stdout.txt e
  git-diff-check-final.stderr.txt

### C. Estado final

42 arquivos rastreados modificados e 20 novos não rastreados; 62 arquivos no total.
Dos 19 novos originais, nenhum removido; acrescentado somente .gitattributes para
corrigir o check sem mudar EOL acadêmico. useDashboardState.ts passou a modificado
para a correção da nota. Nenhuma alteração staged; HEAD permanece na base.
O diff stat não inclui os 20 não rastreados.

#### git status --short

```text
 M AGENTS.md
 M data/exams/farmaco-p2-2025.json
 M data/exams/imunologia-b4-2023.json
 M data/exams/imunologia-b4-2024.json
 M docs/PHASE7A2_DASHBOARD_BACKUP_SETTINGS.md
 M scripts/release-baseline.ts
 M simulados/farmaco-p2-Simulado-2025.html
 M "simulados/imunologia-b4-Simulado 2023.html"
 M "simulados/imunologia-b4-Simulado 2024.html"
 M src/app/App.tsx
 M src/app/DashboardPage.tsx
 M src/app/useDashboardState.ts
 M src/app/useExamSession.ts
 M src/app/useUiPreferences.ts
 M src/components/exam/ExamPage.tsx
 M src/components/exam/QuestionNavigation.tsx
 M src/components/questions/EssayQuestion.tsx
 M src/components/results/Results.tsx
 M src/components/settings/PreferenceControls.tsx
 M src/engine/backup.ts
 M src/engine/catalog-progress.ts
 M src/engine/exam-state.ts
 M src/engine/persistence.ts
 M src/engine/ui-preferences.ts
 M src/styles/components.css
 M src/utils/paths.ts
 M tests/backup.test.ts
 M tests/browser/phase3.spec.ts
 M tests/browser/phase4.spec.ts
 M tests/browser/phase7a1.spec.ts
 M tests/browser/phase7a2.spec.ts
 M tests/browser/poc.spec.ts
 M tests/catalog-progress.test.ts
 M tests/catalog-render.test.tsx
 M tests/dashboard-metrics.test.ts
 M tests/engine.test.ts
 M tests/persistence.test.ts
 M tests/phase3-global.test.ts
 M tests/phase4-preservation.test.ts
 M tests/phase7a2-render.test.tsx
 M tests/render.test.tsx
 M tests/ui-preferences.test.ts
?? .gitattributes
?? docs/PHASE7B1_REVIEW_STUDY_MODES.md
?? scripts/span-artifacts.ts
?? src/app/ReviewPage.tsx
?? src/components/exam/ModeChooser.tsx
?? src/components/questions/QuestionCard.tsx
?? src/components/review/
?? src/engine/content-equality.ts
?? src/engine/review-filters.ts
?? src/engine/review-history.ts
?? src/engine/storage-transaction.ts
?? tests/browser/attempt-helpers.ts
?? tests/browser/phase7b1.spec.ts
?? tests/legacy-fixtures.ts
?? tests/phase7b1-backup.test.ts
?? tests/phase7b1-engine.test.ts
?? tests/phase7b1-fixtures.ts
?? tests/phase7b1-render.test.tsx
?? tests/phase7b1-storage.test.ts
?? tests/span-cleanup.test.ts
```

#### git diff --stat

```text
 AGENTS.md                                      |   3 +
 data/exams/farmaco-p2-2025.json                | 166 +++++++--------
 data/exams/imunologia-b4-2023.json             | 120 +++++------
 data/exams/imunologia-b4-2024.json             | 178 ++++++++--------
 docs/PHASE7A2_DASHBOARD_BACKUP_SETTINGS.md     |   5 +
 scripts/release-baseline.ts                    |  11 +-
 simulados/farmaco-p2-Simulado-2025.html        |  86 ++++----
 simulados/imunologia-b4-Simulado 2023.html     |  60 +++---
 simulados/imunologia-b4-Simulado 2024.html     | 120 +++++------
 src/app/App.tsx                                |  20 +-
 src/app/DashboardPage.tsx                      |  10 +-
 src/app/useDashboardState.ts                   |   2 +
 src/app/useExamSession.ts                      | 142 ++++++++++---
 src/app/useUiPreferences.ts                    |   2 +-
 src/components/exam/ExamPage.tsx               | 274 +++++++++++++------------
 src/components/exam/QuestionNavigation.tsx     |  33 ++-
 src/components/questions/EssayQuestion.tsx     |   3 +-
 src/components/results/Results.tsx             |   2 +
 src/components/settings/PreferenceControls.tsx |  15 +-
 src/engine/backup.ts                           | 253 ++++++++++++++++-------
 src/engine/catalog-progress.ts                 |  47 ++++-
 src/engine/exam-state.ts                       |  56 ++++-
 src/engine/persistence.ts                      | 237 +++++++++++----------
 src/engine/ui-preferences.ts                   |  21 +-
 src/styles/components.css                      |  22 ++
 src/utils/paths.ts                             |  18 +-
 tests/backup.test.ts                           |  81 +++++---
 tests/browser/phase3.spec.ts                   |   3 +
 tests/browser/phase4.spec.ts                   |   4 +
 tests/browser/phase7a1.spec.ts                 |  14 +-
 tests/browser/phase7a2.spec.ts                 |  35 +++-
 tests/browser/poc.spec.ts                      |   3 +
 tests/catalog-progress.test.ts                 |  17 +-
 tests/catalog-render.test.tsx                  |   8 +-
 tests/dashboard-metrics.test.ts                |   7 +-
 tests/engine.test.ts                           |   5 +-
 tests/persistence.test.ts                      |  15 +-
 tests/phase3-global.test.ts                    |  18 +-
 tests/phase4-preservation.test.ts              |  66 +++---
 tests/phase7a2-render.test.tsx                 |  17 +-
 tests/render.test.tsx                          |  13 +-
 tests/ui-preferences.test.ts                   |   2 +-
 42 files changed, 1355 insertions(+), 859 deletions(-)
```

#### git diff --check

Comando padrão, sem -c/override: **exit code 0; stdout vazio; stderr vazio**.
Checkout original /workspace/CHATGPT limpo; index desta worktree vazio.

### D. Classificação final

**APROVADO PARA COMMIT**.

Auditoria concluída, correções limitadas aos quatro findings acima. Nenhum git add,
commit, push, PR, merge ou deploy executado. Trabalho encerrado para revisão do usuário.
