# Fase 7B.2B — sessões direcionadas e reset seguro

Base obrigatória e HEAD: `8236b8736c7993b109a4da4aa855a6f7610e2829`. Comparação desta auditoria feita diretamente com o objeto Git local desse SHA.
Branch: `codex/phase7b2b-review-sessions`.
Worktree: `/workspace/phase7b2b-review-sessions`.

## Objetivo e arquitetura

Refazer questões erradas, marcadas ou o resultado exato dos filtros de uma tentativa concluída. Escolher explicitamente Prova/Estudo, restaurar progresso e apresentar resultado do subconjunto. Permitir apagar conclusões/históricos/sessões com confirmação forte, preservando progresso oficial, favoritos e preferências.

`ReviewSession` é domínio separado: schema, engine, repositório, hook, rota e chave próprios. Não há criação ou persistência de um `Attempt` oficial para estudar o subconjunto. Os componentes compartilhados recebem `QuestionState`, um `Pick` visual sem `id`, `examId`, `examRevision`, `startedAt` ou `result`, insuficiente para persistir uma tentativa oficial.

A autoridade acadêmica permanece `calculateResult`, cujo corpo não mudou. Apenas seu tipo de entrada e o de `answeredCount` foram ampliados para aceitar respostas isoladas. O teste de preservação normaliza exclusivamente essas duas assinaturas e continua comparando os corpos com a base histórica. `sessionExam` cria uma projeção em memória dos IDs selecionados na ordem original; não altera dados nem `Exam.subject`.

`AttemptRepository`, métricas de catálogo, agregação da Dashboard e atividade recente não recebem sessões. Criar/finalizar 1, 5 e 20 sessões é coberto por comparações de todos esses resultados, além do fluxo de navegador com métricas antes/depois.

## Contratos Zod e versões

A fonte exata é `src/engine/review-session.ts`. Contrato persistido:

```ts
type ReviewSession = {
  id: string;
  examId: string;
  examRevision: number;
  sourceAttemptId: string;
  sourceCompletedAt: string;
  selection:
    | { kind: 'incorrect' }
    | { kind: 'flagged' }
    | {
        kind: 'filtered';
        filters: {
          status: 'all' | 'correct' | 'incorrect' | 'unanswered' | 'essay';
          flaggedOnly: boolean;
          category: string;
          tag: string;
        };
      };
  questionIds: string[];
  mode: 'exam' | 'study';
  startedAt: string;
  completedAt: string | null;
  currentIndex: number;
  answers: Record<string, string>;
  confirmedQuestionIds: string[];
  result: ReviewSessionResult | null;
};
type ReviewSessionResult = {
  total: number;
  objectiveTotal: number;
  objectiveAnswered: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  percentage: number | null;
  essayTotal: number;
  essayAnswered: number;
};
```

Todos os objetos são estritos. IDs acadêmicos usam `identifier`. IDs de sessão/fonte têm 1–256 caracteres; IDs de questões e confirmações são únicos, até 2.000. A seleção é não vazia; `currentIndex` está dentro dela; respostas/confirmações pertencem ao subconjunto; resposta tem até 200.000 caracteres; categoria/tag têm até 2.000. Datas usam ISO datetime e respeitam fonte ≤ início ≤ conclusão. Conclusão e resultado devem existir juntos. O resultado tem contagens e percentual consistentes, total igual à seleção e cálculo conferido academicamente contra a prova completa na restauração/importação/exportação.

`isCompatibleReviewSession` confere prova/revisão, pertinência e ordem original dos IDs, alternativas válidas e resultado recalculado. Modo Prova não aceita confirmações; Estudo só confirma resposta preenchida e não conclui com drafts pendentes.

Persistência:

```text
chatgpt-exams:v1:<examId>:r<revision>:review-session
{ storageVersion: 1, session: ReviewSession }
```

Uma sessão por prova/revisão, ativa ou concluída. Criação congela seleção/filtros; save protege origem, modo, IDs, datas de origem e respostas já confirmadas. Sessão concluída é imutável academicamente. Leituras não criam sessão, não geram UUID, não reparam e não migraram storage. Raw incompatível fica preservado com erro explícito.

Contratos oficiais continuam current/history v3, archive review v1 e UI preferences v2. Os schemas antigos de current/history, backup v1 e backup v2 não foram alterados.

## Seleção, modos, restauração e flags

No detalhe de uma tentativa no Review Hub:

- **Refazer erradas**: somente objetivas com status `incorrect`.
- **Refazer marcadas**: flags da fonte, incluindo dissertativas.
- **Iniciar sessão com filtros atuais**: resultado exato de `reviewQuestionIndices`, com AND de status, flaggedOnly, categoria e tag.

Cada ação mostra a contagem; zero desabilita criação. Abrir filtros e chooser não grava. O chooser sempre exige modo explícito, independentemente de `attemptModePreference`. Sessão ativa oferece continuar ou checkbox explícito de descarte antes de iniciar outra; a troca é uma única escrita transacional. Sessão concluída tem aviso explícito de substituição.

Em Prova, respostas são editáveis até finalizar; feedback só existe na UI após conclusão. Em Estudo, confirmar libera feedback/comparação, bloqueia edição e não avança automaticamente. Drafts preenchidos bloqueiam finalização. Dissertativas nunca recebem nota automática. Percentual usa todas as objetivas selecionadas, incluindo as em branco, conforme a convenção existente.

Resultado é identificado como **Resultado desta sessão de revisão**, com contagens do subconjunto e aviso: **Esta sessão não altera as estatísticas da prova nem da Dashboard.** Há revisão das respostas, acesso à fonte e retorno ao Hub.

Rota própria: `?view=review-session&reviewExam=<id>`. `?exam=<id>` continua prevalecendo se as queries forem combinadas, evitando transformar uma tentativa oficial em sessão. `area > view=all` continua preservado.

Respostas/confirmações/conclusão ficam na chave da sessão. Posição de navegação fica na URL por `history.replaceState`, sem storage writes. `reviewResume` acompanha os links internos entre sessão, Dashboard e Hub; cada posição é vinculada a examId/revision/sessionId e validada por Zod. Substituição de sessão não reutiliza uma posição antiga. Reload e voltar/avançar preservam as URLs. `currentIndex` também acompanha a próxima mutação explícita; uma URL limpa aberta externamente, sem metadados de navegação, usa essa última posição persistida. Navegar não migra nem repara localStorage.

Flags não são copiadas para um novo histórico de revisão: são metadados da fonte carregada por `ReviewRepository`. Marcar/desmarcar usa a transação entre current concluído e archive, com proteção de raw e concorrência. A auditoria corrigiu a gravação para preservar envelopes v1 com histórico embutido e alterar somente current.flagged dentro deles. V1 sem histórico e v2 mantêm a migração por ação explícita para v3 que já fazia parte da 7B.1; os campos acadêmicos normalizados permanecem idênticos. Fonte/resultado/respostas/datas acadêmicas permanecem intactos. Sessão não grava em sua chave por navegação ou flag. Sem fonte, a sessão continua respondível, alerta que a marcação original não pôde ser atualizada e não recria a fonte. Fonte alterada concorrentemente produz erro, sem simular sucesso visual.

Texto dissertativo usa debounce de 500 ms, com flush em confirmação/finalização, pagehide e unmount. Falha de storage mostra alerta e mantém draft em memória enquanto a página permanece aberta; não apresenta conclusão bem-sucedida quando a escrita falha.

## Reset na Dashboard

A seção **Dados e histórico** reutiliza a seção de backup existente, mostra conclusões, provas com histórico e progresso em andamento. Abrir a confirmação prepara um snapshot read-only das quatro chaves conhecidas de cada prova/revisão do catálogo, sem carregar JSONs completos.

Primeira etapa: região focável explica exatamente a remoção. Segunda: digitar **ZERAR**, exatamente. Caixa/letras/espaços diferentes não habilitam a confirmação. O botão recebe foco de volta ao cancelar/concluir. Resultado atualiza imediatamente métricas, matérias e atividade recente, sem reload obrigatório.

Remove:

- `:history`, inclusive raw incompatível;
- `:review`, inclusive raw incompatível;
- `:review-session`, inclusive raw incompatível;
- current oficial concluído.

Preserva:

- current oficial em andamento (v3 mantém bytes);
- favoritos/catalog preferences;
- UI preferences, tema, acessibilidade e preferência de modo;
- dados acadêmicos;
- chaves desconhecidas e revisões fora das chaves conhecidas do catálogo.

Current v1/v2 em andamento é normalizado para v3 **apenas dentro do reset explícito**, descartando histórico legado embutido. Respostas e demais campos da tentativa permanecem semanticamente iguais; v1/v2 recebem modo exam e confirmações vazias conforme a ponte já existente. Current incompatível/corrompido impede toda a operação: validação estrutural Zod, identidade/revisão, posição/contagens do catálogo, confirmação, cronologia e consistência de resultado. O reset não faz correção acadêmica ou validação de alternativas com requests; classificação de ciclo de vida usa os contratos e catálogo. Contagens de conclusões são as conclusões oficiais legíveis; raw histórico corrompido não tem contagem acadêmica inferida.

## Transações com deletes e concorrência

`StorageChange.after` agora é `string | null`: string usa `setItem`, null usa `removeItem`. Plano exige chaves únicas, snapshot presente e `before` consistente. Ausência de removeItem aborta deletes antes de qualquer mutação.

Uma chamada de `writeTransaction` aplica todo o reset. Compara todas as chaves do snapshot antes de cada mutação e ao final. Rollback inverso restaura valores anteriores ou remove chaves previamente ausentes. Registra a mutação antes da chamada para lidar com adaptador que altera e depois lança. Valores de outro escritor nunca são sobrescritos no rollback; falha de recuperação gera erro crítico explícito de rollback incompleto.

localStorage não possui transação nativa nem compare-and-swap: a garantia é defensiva/otimista e rollback quando possível, sem promessa de atomicidade diante de encerramento abrupto do processo ou da janela entre leitura e escrita em outra aba. Não há reset parcial silencioso.

## Backup v3

Novos exports: `format: medsim-backup`, `version: 3`; cada item acrescenta `reviewSession: ReviewSession | null`. Sessão isolada também inclui sua prova no backup mesmo sem current/history/archive. Export continua read-only, limitado a 10 MiB e conferido por snapshot contra concorrência. Carrega provas completas apenas sob a ação explícita de backup, com cache por prova.

Backups v1/v2 continuam legíveis por contratos congelados e normalizam somente em memória para v3 com `reviewSession: null`. V1 mantém a normalização oficial exam/sem confirmações e UI v2 da ponte existente.

Preview de importação valida a sessão academicamente e não escreve. Confirmação mescla estado oficial como antes; sessão local ausente recebe a sessão importada, conteúdo idêntico é no-op, qualquer conflito real preserva sessão local e reporta issue. Não sobrescreve corrupção nem recria Attempt a partir da sessão. Snapshot inclui a chave da sessão, logo concorrência antes da confirmação aborta a operação com as garantias existentes.

## Auditorias de rede, zero-write e acessibilidade

Testes de requests completos (`generated/exams/`): Home 0; página de matéria 0; todos os simulados 0; Dashboard em leitura 0; lista do Review Hub 0; abrir histórico 1; abrir/recarregar sessão 1. Nenhuma chamada externa, endpoint, telemetria ou sincronização foi adicionada.

Snapshots reais de localStorage comprovam zero-write nas páginas de leitura, filtros históricos, navegação histórica, chooser antes de início, restauração/navegação de sessão e preview de importação. Engine/repos adicionam testes read-only, corrupção, concorrência, rollback e isolamento das métricas.

Acessibilidade: labels explícitos, regiões de confirmação focáveis, foco em questão/resultado, retorno ao trigger do reset/chooser, aria-pressed das flags, aria-current no mapa e navegação principal, alerts para falha, status para feedback/salvamento. A interface respeita tema, contraste alto, density compacta, foco reforçado e movimento reduzido. Testes desktop/mobile abrangem larguras 375, 390, 768, 1024 e 1280, texto a 200% do tamanho padrão, sem overflow e alvos de ação ≥44 px. Navegação e topline das questões agora quebram linhas quando necessário.

## Preservação e limites intencionais

Preservação acadêmica esperada/validada: **19 provas / 522 questões / 492 objetivas / 30 dissertativas**. Comparação de bytes/SHA-256 contra a base inclui todos os arquivos rastreados em `data/`, `simulados/` e `public/`.

A suíte completa mantém todas as regressões 7B.1 e 7B.2A: histórico 20, modos/chooser/confirmação/essay/restart/backup, 7 matérias e seus totais, Home sem ExamCards, all 19/522, query area/view, precedência, back/reload e subject desconhecido determinístico. Os testes de export antigos só tiveram versões/fixtures atualizadas; nenhum teste existente foi removido.

Sem sessões com múltiplas provas, histórico ilimitado, IA/authoring acadêmico, spaced repetition, flashcards, ranking, gamificação, login, cloud sync ou banco remoto. Uma sessão por prova/revisão; fonte pode ser indisponível por retenção ou remoção externa. Debounce e salvamento local não garantem retenção se o navegador fechar antes do flush ou bloquear storage.

## Auditoria adversarial pré-commit — findings reproduzidos e corrigidos

O relatório anterior de zero findings foi substituído por esta revisão do diff real inteiro e de todos os arquivos novos. Foram encontrados **2 HIGH, 2 MEDIUM e 3 LOW**. Os quatro problemas funcionais foram reproduzidos com testes que falharam antes das correções.

| ID | Severidade | Problema real | Correção e regressão |
| --- | --- | --- | --- |
| H1 | HIGH | Flag da fonte current v1 regravava envelope v3 e removia o histórico embutido; A migração por flag podia portanto apagar conclusões anteriores. | ReviewRepository mantém o envelope v1 com histórico e muda somente current.flagged nele. Migração explícita sem histórico mantém contrato 7B.1. Testes v1/v2, métricas e flag/unflag. |
| H2 | HIGH | Tentativa oficial aberta em outra aba podia regravar summaries apagados pelo reset a partir de seu histórico em memória, inclusive no legado v1. | AttemptRepository reconhece remoção de histórico conhecido/substituição do envelope legado, relê estado sem writes, compara current com último snapshot próprio, esvazia o histórico antigo e salva usando snapshot transacional. Regressões v3/v1, current concorrente/removido, retry de migração e fluxo real em duas abas. |
| M1 | MEDIUM | Navegar sem responder e voltar pelo Dashboard/Hub perdia a posição da sessão. | Posições pela URL acompanham links internos e são vinculadas à identidade da sessão; zero-write preservado. Testes de Dashboard/Hub/back/forward/reload e substituição. |
| M2 | MEDIUM | Input de linha única normalizava ZERAR\n para ZERAR, habilitando o botão destrutivo. | Textarea de uma linha preserva o texto exato. Regressão real desktop/mobile com espaços, caixa, quebra de linha e Enter. |
| L1 | LOW | Numeração do subconjunto não distinguia explicitamente posição da sessão e questão original. | Heading e aria identificam “da sessão”; badge identifica “Questão original”. |
| L2 | LOW | Cancelar confirmação de finish/discard podia deixar o foco no documento. | Retorno ao botão que abriu a confirmação; teste de teclado/foco. |
| L3 | LOW | A alteração repetia flex-wrap na topline. | Declaração duplicada removida; layout ampliado novamente verificado. |

Novas regressões também cobrem: todas as seleções em branco; fonte Study imutável durante sessão inteira; seis casos matemáticos de resultado; oito estados de reset; corrupção somente na última das 19 provas; todas as 76 chaves lidas antes da primeira mutação; transições string/null e ordens mistas; falha antes/depois de set; concorrência durante rollback; oito variantes de sessão no backup; backup v1/v2/v3 → reset → import; queries conflitantes; concorrência real entre abas; essay com debounce pendente no reload; Exam sem modelo/explicação; texto e layout ampliados a 200%.

O reset mantém o limite da infraestrutura existente: localStorage não oferece compare-and-swap nem transação nativa. Comparações detectam concorrência observável antes de cada operação e durante rollback, preservando valores divergentes e reportando rollback incompleto. Não se afirma atomicidade absoluta diante de encerramento abrupto ou da janela nativa entre leitura e escrita concorrente.

## Relatório final da auditoria adversarial (34 itens)

### 1. SHA base

`8236b8736c7993b109a4da4aa855a6f7610e2829`. HEAD permanece idêntico; comparação feita com o objeto Git desse SHA.

### 2. Branch e worktree

`codex/phase7b2b-review-sessions`; `/workspace/phase7b2b-review-sessions`.

### 3. Arquivos modificados

21 arquivos (19 originais + review-history.ts para H1 + persistence.ts para H2).

```text
AGENTS.md
src/app/App.tsx
src/app/DashboardPage.tsx
src/app/ReviewPage.tsx
src/app/useDashboardState.ts
src/components/exam/QuestionNavigation.tsx
src/components/questions/QuestionCard.tsx
src/components/review/ReviewView.tsx
src/components/settings/BackupControls.tsx
src/engine/backup.ts
src/engine/exam-state.ts
src/engine/persistence.ts
src/engine/review-history.ts
src/engine/storage-transaction.ts
src/styles/components.css
src/utils/paths.ts
tests/backup.test.ts
tests/browser/phase7a2.spec.ts
tests/browser/phase7b1.spec.ts
tests/phase4-preservation.test.ts
tests/phase7b1-backup.test.ts
```

### 4. Arquivos novos

15 arquivos, todos lidos e incluídos no patch de auditoria, sem staging.

```text
docs/PHASE7B2B_REVIEW_SESSIONS.md
src/app/ReviewSessionPage.tsx
src/app/useReviewSession.ts
src/components/dashboard/HistoryResetControls.tsx
src/components/review/ReviewSessionActions.tsx
src/engine/history-reset.ts
src/engine/review-session-storage.ts
src/engine/review-session.ts
tests/browser/phase7b2b.spec.ts
tests/phase7b2b-backup.test.ts
tests/phase7b2b-engine.test.ts
tests/phase7b2b-fixtures.ts
tests/phase7b2b-render.test.tsx
tests/phase7b2b-storage.test.ts
tests/phase7b2b-transaction.test.ts
```

### 5. Findings

Encontrados: **HIGH 2 / MEDIUM 2 / LOW 3**; todos corrigidos. Restantes identificados após revisão e validação: **0 / 0 / 0**. H1 perdeu histórico embutido por flags; H2 restaurava histórico apagado a partir de uma aba oficial aberta; M1 perdeu posição na retomada; M2 normalizou ZERAR com quebra de linha; L1 numeração ambígua; L2 retorno de foco; L3 CSS duplicado. Reprodução e correções na tabela anterior.

### 6. Correções nesta auditoria

Preservação do envelope v1 com histórico ao marcar; guarda de reset no salvamento oficial com snapshots próprios, bloqueio de retries após conflito e comparação transacional; posição acompanha URLs internas; confirmação multiline exata; nomenclatura/foco e limpeza CSS. Acrescentados 65 Vitest e 12 Playwright em relação ao estado reportado de 906/164. Nenhuma feature nova.

### 7. Isolamento das métricas

ReviewSessionRepository escreve exclusivamente :review-session. Não chama AttemptRepository, summary ou historyStorageKey; source só é lida por ReviewRepository. QuestionState visual não tem contrato de Attempt. Catalog-progress, dashboard-metrics e RecentActivity leem apenas current/history oficiais. Comparações antes/depois de 1, 5 e 20 sessões, fluxo real e backup/restauração confirmam attemptCount, best/last, completed, matérias e atividade oficial idênticos.

### 8. Source Attempt imutável

Sessões completas Exam/Study com fonte Study comparam todos os campos, respostas, resultado, datas, mode, confirmedQuestionIds, examId/revision e posição. Sem flags, raw da fonte permanece byte-idêntico; flags alteram somente flagged academicamente. Source atual/arquivada, colisões e concorrência são cobertos. H1 preserva o histórico embutido; v1 vazio/v2 mantêm a migração explícita da 7B.1.

### 9. Sessão começa em branco

createReviewSession define answers={}, confirmedQuestionIds=[] e result=null. Regressões executam erradas, marcadas e filtros em Exam/Study, incluindo essay respondida na fonte; nenhum conteúdo da fonte é copiado.

### 10. Exam sem feedback antecipado

QuestionCard libera feedback apenas por completedAt ou confirmação de Study. Renderer só cria classes corretas, gabarito, explicação e modelo quando readOnly/feedback. DOM real verifica ausência antes de finish, inclusive essay e reload; respostas continuam editáveis; feedback próprio aparece após finish.

### 11. Study confirmation

Resposta preenchida exige confirmação explícita; feedback aparece depois dela, resposta fica readonly, sem auto-advance. Essay exige texto não vazio, confirma/compara, flush imediato. Drafts bloqueiam finish; IDs de respostas/confirmações fora do subset são rejeitados; confirmações sobrevivem à restauração.

### 12. Subset e resultado corretos

Seleção usa exatamente reviewQuestionIndices: incorrect objetiva; flags incluem essay; filtros status/flag/category/tag usam AND. Ordem original, IDs únicos/existentes e subset congelado. Navegação usa posições da projeção, sem sair dela. Seis casos de resultado conferem 100%, 0%, parcial, essay-only, mixed e single; objectiveAnswered=correct+incorrect, +unanswered=objectiveTotal; essay não entra no percentual; objectiveTotal=0 gera null. UI diz “Resultado desta sessão de revisão” e que não altera Dashboard.

### 13. Restore/resume

Leitura estrita restaura seleção, ordem, respostas, confirmações e mode; raw corrompido é preservado. Testes cobrem início/meio/confirmação/essay pendente/finish, pagehide, Dashboard→Hub→session, back/forward e reload. Posição de navegação acompanha URL/history, vinculada a exam/revision/sessionId; não escreve storage nem migra em reads. URL limpa aberta externamente usa a última posição persistida por uma mutação explícita.

### 14. Reset e Dashboard

Oito estados independentes, múltiplas provas e fluxos reais: remove completed currents, history, archive e sessions; mantém ongoing. Corrupt/incompatible current ou leitura bloqueada aborta antes de mutar. Sem current: not-started, attemptCount=0, best/last=null; ongoing: in-progress com notas históricas nulas. Dashboard atualiza no mesmo documento. ZERAR exato habilita; caixa, espaços, newline e Enter acidental são testados desktop/mobile.

### 15. Reset atômico

Teste comprova leitura das 76 chaves conhecidas antes da primeira mutação. Corrupção somente na última das 19 provas deixa as anteriores e storage inteiro byte-idênticos, com zero set/remove. Uma única transação compara o snapshot completo antes de cada operação e ao final. Aba oficial já aberta não restaura conclusões removidas ao responder/finalizar.

### 16. Legacy reset

v1/v2 ongoing normalizam exclusivamente durante reset para envelope v3 com current semanticamente igual (mode Exam/sem confirmações dos contratos antigos); history embutido desaparece. Completed legacy é removido. Envelope não classificável aborta tudo, zero writes. Reset não migra durante leitura.

### 17. Transaction delete/rollback

Revisão integral de storage-transaction.ts e callers. Matriz null/string, múltiplos writes/deletes e ambas as ordens mistas; throws antes/depois de set/remove, get falho, concorrência antes/entre operações/durante rollback. Rollback compara raw, restaura apenas valores ainda atribuíveis à operação e mantém divergências de outro writer; recuperação incompleta gera erro crítico. Callers anteriores continuam passando. Limite: localStorage não oferece CAS/transação nativa; a janela entre leitura/escrita e encerramento abrupto não têm atomicidade absoluta.

### 18. Current, favoritos e settings preservados

Snapshots exatos confirmam ongoing v3 inteiro, answers, flags, startedAt, mode, confirmedQuestionIds, favoritos, UI preferences, theme, accessibility, attemptModePreference e unknown keys. Legacy preservado semanticamente. Conflitos posteriores de current abortam inclusive retries, sem substituir respostas de outro writer.

### 19. Backup v3

Export novo v3 inclui session-only, active/completed, Study/Exam, essay/mixed; validação acadêmica, 10 MiB, corrupção aborta export completo e concorrência é detectada. Export zero-write. Import ausente recebe session; igual é no-op; conflito/corrupção preserva local; incompatibilidade de exam/revision/questions é rejeitada. Sessão importada nunca vira Attempt.

### 20. Compatibilidade v1/v2

Comparação textual das declarações congeladas contra SHA base passou: v1/v2 do backup idênticos após normalizar somente o nome exportado de v2; schemas oficiais de current/history idênticos. readableBackup transforma em memória, sem regravar arquivo antigo. Roundtrips v1/v2 após reset e regressões 7B.1 passaram.

### 21. Import preview zero-write

Mapas completos de raw storage antes/depois de prepareImport e preview real permanecem idênticos: zero set/remove, migração ou repair. Corrupção local preservada; confirmação usa expected snapshots.

### 22. Network audit

Requests reais observados em desktop/mobile: Home 0; Subject 0; All 0; Dashboard 0; Review Hub list 0; Settings read-only 0; historical attempt 1; ReviewSession 1; reload ReviewSession 1. Contagem de full Exams em generated/exams; nenhum carregamento de 19 provas nas páginas de leitura. Export/import explícitos podem carregar provas necessárias à validação, com cache.

### 23. Zero-write audit

Diferença exata dos snapshots: **{}** em Home, Subject, All, Dashboard, Review Hub, histórico, filtros/navegação histórica, chooser sem start, consent checkbox sem start, restauração/navegação de session e import preview. Mode button é o próprio start explícito; não há preseleção gravada. Flags/respostas/confirmação/finish/start/discard/import/reset são ações de escrita.

### 24. Routing audit

resolveRoute: exam válido prevalece; depois view explícita review-session/review/dashboard/settings; depois area prevalece sobre view=all. Duplicados usam primeiro parâmetro; extras são ignorados. IDs inválidos e queries conflitantes têm regressões. Helper da session usa reviewExam, não exam; rota da session instancia exclusivamente ReviewSessionPage.

### 25. Academic byte preservation

217 arquivos da base comparados por bytes/SHA-256: 196 idênticos e somente os 21 autorizados modificados. Recorte acadêmico e de suporte: **44 arquivos idênticos** (19 JSON, 17 HTML, favicon, index.html, simulados.json, 5 scripts JS raiz); inclui os 37 do recorte original data/simulados/public. Totais **19/522/492/30**. Corpo do cálculo idêntico após normalização das duas assinaturas de tipo. Package/lock/workflows/deploy/schema/scripts sem diff; nenhum debug/snapshot temporário na entrega. Artefatos de build/teste são ignorados pelo Git.

### 26. Regressão 7B.1

Suíte integral: modos oficiais Exam/Study, chooser/preference, pending confirmations/essay, flags pós-conclusão, restart/archive, Review Hub, current/history v3, review archive v1, UI prefs v2, retenção 20, backups antigos e Dashboard. O teste original de migração explícita legado foi mantido; nenhum teste foi removido para passar.

### 27. Regressão 7B.2A

7 matérias, Home sem ExamCards, all 19/522; Farmacologia 5/148, Fisiologia 3/63, Imunologia 3/90, Microbiologia e Virologia 4/120, Parasitologia 1/31, Patologia 1/30, Propedêutica 2/40. Precedence, fallback de subject desconhecido, back/reload e no eager load passaram.

### 28. Acessibilidade/mobile

375/390/768/1024/1280; texto a 200% em todas, layout com CSS zoom 200% em 1024/1280; session e reset sem overflow. Alvos ≥44px, teclado, foco de questão/confirmação/resultado e retorno ao trigger, labels, aria-current/pressed, status/alerts. Dark/high contrast/reduced motion/enhanced focus. Capturas de teste inspecionadas; não se afirma ensaio com leitor de tela físico.

### 29. Vitest final

**971/971**, 35 arquivos; **+215 vs 756**, **+65 vs 906**. Repetição integral após último ajuste de retry também passou, sem skips ou remoções.

### 30. Playwright final

**176/176**, desktop e mobile; **+46 vs 130**, **+12 vs 164**. Sem skips ou remoções.

### 31. Todos os comandos finais

Todos os dez comandos da rodada final retornaram exit 0. Rechecks posteriores de typecheck/Vitest e whitespace de novos arquivos também foram realizados.

| Comando | Exit | Resultado |
| --- | --- | --- |
| npm ci | 0 | 118 pacotes do lockfile |
| npm run audit:legacy | 0 | 17 HTMLs; 485/462/23; divergência documental preexistente sobre dois scripts no hub |
| npm run validate | 0 | 19/522 |
| npm run author:validate | 0 | 2 candidates reais |
| npm run typecheck | 0 | Sem erros |
| npm test | 0 | 971 testes / 35 arquivos |
| npm run build | 0 | Generate + typecheck + Vite |
| npm run validate:dist | 0 | 19/522/492/30 e paridade byte a byte |
| npm run test:browser | 0 | 176 aprovados |
| git diff --check | 0 | Sem erros |

Logs em /tmp/phase7b2b-redteam-verified-validation/. Testes de reprodução falharam antes das correções; a primeira rodada revelou a expectativa de migração 7B.1, que foi preservada. O patch completo auditado inclui arquivos untracked, sem git add.

### 32. git status --short

```text
 M AGENTS.md
 M src/app/App.tsx
 M src/app/DashboardPage.tsx
 M src/app/ReviewPage.tsx
 M src/app/useDashboardState.ts
 M src/components/exam/QuestionNavigation.tsx
 M src/components/questions/QuestionCard.tsx
 M src/components/review/ReviewView.tsx
 M src/components/settings/BackupControls.tsx
 M src/engine/backup.ts
 M src/engine/exam-state.ts
 M src/engine/persistence.ts
 M src/engine/review-history.ts
 M src/engine/storage-transaction.ts
 M src/styles/components.css
 M src/utils/paths.ts
 M tests/backup.test.ts
 M tests/browser/phase7a2.spec.ts
 M tests/browser/phase7b1.spec.ts
 M tests/phase4-preservation.test.ts
 M tests/phase7b1-backup.test.ts
?? docs/PHASE7B2B_REVIEW_SESSIONS.md
?? src/app/ReviewSessionPage.tsx
?? src/app/useReviewSession.ts
?? src/components/dashboard/HistoryResetControls.tsx
?? src/components/review/ReviewSessionActions.tsx
?? src/engine/history-reset.ts
?? src/engine/review-session-storage.ts
?? src/engine/review-session.ts
?? tests/browser/phase7b2b.spec.ts
?? tests/phase7b2b-backup.test.ts
?? tests/phase7b2b-engine.test.ts
?? tests/phase7b2b-fixtures.ts
?? tests/phase7b2b-render.test.tsx
?? tests/phase7b2b-storage.test.ts
?? tests/phase7b2b-transaction.test.ts
```

### 33. git diff --stat

Somente arquivos rastreados; os 15 novos permanecem untracked.

```text
 AGENTS.md                                  |  2 +
 src/app/App.tsx                            | 74 +++++++++++++++++++++++++----
 src/app/DashboardPage.tsx                  |  2 +
 src/app/ReviewPage.tsx                     | 45 +++++++++++++-----
 src/app/useDashboardState.ts               |  3 +-
 src/components/exam/QuestionNavigation.tsx | 12 +++--
 src/components/questions/QuestionCard.tsx  |  9 ++--
 src/components/review/ReviewView.tsx       |  4 ++
 src/components/settings/BackupControls.tsx |  4 +-
 src/engine/backup.ts                       | 58 +++++++++++++++++++++--
 src/engine/exam-state.ts                   |  4 +-
 src/engine/persistence.ts                  | 68 +++++++++++++++++++++++++-
 src/engine/review-history.ts               |  9 +++-
 src/engine/storage-transaction.ts          | 14 +++++-
 src/styles/components.css                  | 20 ++++++++
 src/utils/paths.ts                         | 76 +++++++++++++++++++++++++++++-
 tests/backup.test.ts                       | 17 +++++--
 tests/browser/phase7a2.spec.ts             |  4 +-
 tests/browser/phase7b1.spec.ts             |  2 +-
 tests/phase4-preservation.test.ts          | 20 ++++++--
 tests/phase7b1-backup.test.ts              |  5 +-
 21 files changed, 394 insertions(+), 58 deletions(-)
```

### 34. Encerramento

**Sem commit; sem push; sem PR; sem merge; sem deploy.** HEAD permanece no SHA base. Trabalho encerrado nesta auditoria local, conforme solicitado.
