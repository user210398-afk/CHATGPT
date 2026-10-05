# Fase 7A.2 — Dashboard, backup e configurações

## Objetivo e base

Branch `codex/phase7a2-dashboard-backup-settings`, worktree
`/workspace/CHATGPT-phase7a2`, base `origin/main` em
`03b9f450224deaa76b150f86c9a3ca70710c5c50`.

Aplicação inteiramente client-side. Nenhum backend, conta, banco remoto, serviço,
telemetria, credencial, dependência ou requisição externa de runtime foi adicionado.
A implementação deve ser auditada antes de qualquer commit, push, PR, merge ou
publicação; nenhum desses passos faz parte desta rodada.

## Arquitetura e navegação

- `dashboard-metrics.ts`: agregações puras, sem mutação dos arrays de entrada.
- `useDashboardState.ts`: snapshot dos resumos 7A.1; atualização em `pageshow`,
  montagem e recarga. Cálculos ficam fora do JSX.
- `DashboardPage` e componentes de dashboard: métricas, disciplinas e atividade.
- `backup.ts`: schemas estritos, normalização, validação acadêmica, merge puro,
  plano sem escrita e confirmação transacional.
- `backup-browser.ts`: File API, tamanho defensivo, Blob, download e revogação.
- `ui-preferences.ts`: contratos, leitura read-only, escrita explícita e atributos.
- `useUiPreferences.ts`: estado compartilhado pelo shell e reação ao sistema.
- `SettingsPage`, `PreferenceControls`, `BackupControls` e `SetupPrompt`: interface
  nativa, convite opcional e prévia acessível.

Rotas preservam o base `/CHATGPT/` e links reais, sem router ou rewrites:

| URL                        | Página         |
| -------------------------- | -------------- |
| `/CHATGPT/`                | Catálogo       |
| `/CHATGPT/?view=dashboard` | Meu desempenho |
| `/CHATGPT/?view=settings`  | Configurações  |
| `/CHATGPT/?exam=<id>`      | Prova          |

Um identificador de prova sintaticamente válido tem precedência sobre `view`.
O loader mantém seus erros para uma prova válida sintaticamente mas inexistente.
Sem esse identificador, `dashboard`/`settings` são reconhecidos; qualquer outra
view cai no catálogo. Navegação usa `aria-current="page"` somente na página
correspondente. Provas e acervo legado continuam acessíveis.

Na montagem normal de catálogo, dashboard e configurações, só o índice é buscado.
As provas completas são carregadas ao abrir uma prova ou, por ação explícita,
durante exportação/importação. Não há parsing repetido de storage por render.
As agregações fazem passagens lineares; a ordenação de disciplinas/atividade é
limitada pelo catálogo, atualmente com 19 provas.

## Métricas e disciplinas

Resumo global: provas disponíveis, concluídas, em andamento, não iniciadas,
soma das conclusões disponíveis (`attemptCount`), máximo real dos melhores,
último resultado objetivo e última atividade. Ausência de nota/data aparece
como `—`; não existe média geral do aluno.

`ExamProgressSummary.lastResultAt` identifica a conclusão mais recente com
percentual não-null. O dashboard compara essa data para encontrar o último
resultado, independentemente de um current aberto com atividade mais recente.
Histórico fora de ordem é ordenado em memória e a leitura não escreve migrações.
Datas são exibidas em pt-BR no fuso do navegador, sem textos relativos ao relógio.
`lastActivityAt` continua limitado a início/conclusão da tentativa e conclusões
do histórico; não há timestamp individual de respostas.

Agrupamento usa a string exata de `exam.subject`. Farmacologia e Farmacologia
Básica permanecem distintas. Ordem usa `Intl.Collator('pt-BR')`, com índice de
inserção como desempate explícito. Cada disciplina apresenta quantidade,
três status, tentativas, melhor, último e **Média dos melhores**:

```text
round(soma dos bestResultPercentage não-null / quantidade de provas com best não-null)
```

0% entra na média. Provas sem nota automática não entram no denominador.
Sem notas, mostra `—`. Não se chama média geral, nota média ou média da disciplina.

Atividade recente mostra até seis provas, da mais recente para a mais antiga,
com título/link, disciplina, status e data. A nota aparece somente no status
concluído; uma tentativa aberta não recebe a nota de uma conclusão anterior.
Empates mantêm explicitamente a ordem do catálogo. Ações incluem catálogo,
configurações e exportação/importação local.

## Formato do backup

JSON com schema Zod estrito em todos os objetos, `format: "medsim-backup"`,
`version: 1`, `exportedAt`, `exams`, `catalogPreferences` e `uiPreferences`
(esta última pode ser null em um backup importado).

Cada exam contém `examId`, `revision`, `current` canônico ou null e histórico
compacto de `{ id, startedAt, completedAt, result }`. Não inclui provas, questões,
alternativas, gabaritos, explicações, PDFs, cache ou chaves arbitrárias de storage.
Respostas da tentativa atual são progresso do usuário e fazem parte do backup.
Filtros, query, sort e view temporários não são exportados.

Limites: arquivo 10 MiB (bytes UTF-8), 200 provas, 20 histories por prova,
1.000 favoritos, IDs até 256 caracteres, até 2.000 respostas/marcações por
current e até 200.000 caracteres por resposta. IDs de provas obedecem ao
identificador acadêmico. Datas ISO, versões, objetos desconhecidos e duplicatas
em provas/histories/favoritos/marcações são validados.

### Exportação

Lê somente chaves conhecidas das revisions atuais do catálogo. Current v2 é
validado pelo Exam completo e `isCompatibleAttempt`; v1 também valida
academicamente os attempts históricos antes de convertê-los em resumos.
Somente as provas com current exigem Exam completo na exportação. Histórico
compacto isolado é validado pelo schema, datas e aritmética/metadados do catálogo.

Toda chave relevante inválida aborta a exportação e identifica a prova ou
preferência afetada. Não se produz um arquivo parcial silencioso. Não há writes
ou reparação; v1 é normalizado somente no arquivo. Um snapshot raw evita misturar
estados que mudem durante o carregamento assíncrono. Favoritos desconhecidos
existentes são preservados no arquivo, e preferências legadas válidas são
normalizadas em memória. Blob usa `application/json`, nome
`medsim-backup-YYYY-MM-DD.json` e object URL revogado após iniciar o download.

### Importação e prévia

File API local; rejeita `File.size > 10 MiB` antes de ler. Parse verifica bytes e
schema. Em seguida, cada item precisa corresponder exatamente a ID/revision do
catálogo atual. Current importado exige Exam completo e validação acadêmica,
incluindo opções, referências, posição, marcações e recálculo de resultado.
Histórico exige totais/percentual coerentes com o índice. Par current/history
com mesmo ID mas conclusões diferentes é rejeitado.

Formato/versão/schema inválidos rejeitam o arquivo inteiro. Provas desconhecidas,
revisions incompatíveis, itens academicamente inválidos e favoritos desconhecidos
são rejeitados individualmente e listados na prévia. Erro de carregamento é
tratado como item não validado. Não existe botão para substituir tudo.

A prévia mostra data, provas compatíveis, currents, conclusões, favoritos,
presença de UI preferences, conflitos e descartes. Dados locais corrompidos
são preservados e informados; nenhuma chave afetada é reparada automaticamente.
Antes de **Confirmar importação**, zero writes, inclusive em preferências.
Cancelar apenas descarta o plano em memória.

### Merge e conflitos

- Current ausente recebe o válido importado. Current local diferente ou mesmo ID
  com conteúdo diferente prevalece e gera conflito. Mesmo ID/conteúdo é no-op.
  Não se compara `startedAt` para adivinhar qual resposta é mais recente.
- History faz união por ID. Conteúdo idêntico é deduplicado; colisão divergente
  preserva o local. Ordena por conclusão decrescente, com desempate explícito,
  e somente depois aplica `HISTORY_LIMIT`, mantendo as 20 conclusões temporalmente
  mais recentes. O helper compartilhado `includeCurrent` usa a mesma retenção em
  load, save, restart e catálogo: current concluído prevalece no conteúdo do seu
  ID, mas não ganha prioridade artificial pela posição. Se for mais antigo que
  as 20 conclusões recentes, continua em `Session.current` sem ocupar uma vaga
  no histórico compacto. Empates mantêm a ordem de inserção dos IDs únicos.
  Descartes de conclusões importadas são reportados.
- IDs de tentativas também colidem entre current e history em ambas as direções.
  Um history importado com ID do current local aberto é rejeitado como conflito;
  current permanece intacto. Para current concluído, só uma conclusão
  semanticamente equivalente deduplica. Local history divergente também impede
  aceitar um current importado de mesmo ID. Outros registros, favoritos e
  configurações compatíveis continuam importáveis.
- Favoritos fazem união e preservam favoritos locais desconhecidos.
- UI só é aplicada pelo checkbox explícito. Default desmarcado quando existe
  configuração nova válida ou uma escolha de tema legado; marcado apenas quando
  não há ambas. UI corrompida é preservada mesmo com seleção de preferências.

Importação de history junto a um current v1 escreve somente history v2, mantendo
raw current v1 intacto. A ponte read-only de `persistence.ts` combina esse history
na restauração da prova; assim o próximo save normal v2 não perde conclusões
importadas. History separado corrompido não impede restaurar o legado válido.
Um backup apenas com history também é restaurado ao abrir uma tentativa nova,
sem perder conclusões na primeira gravação. Um current importado que
colide com history local divergente é preservado como conflito e não substitui
essa conclusão. Correção, transições e o restante do repository permanecem preservados.

### Concorrência, rollback e resultado

O plano calcula alterações, captura bytes raw e inclui todas as chaves lidas
nas dependências. Imediatamente antes de escrever, compara-as novamente;
qualquer mudança/falha de leitura aborta antes da primeira write. Isso inclui
current preservado, favoritos, UI e tema legado relevante.

Writes são síncronas. Uma falha restaura em ordem inversa os bytes anteriores;
chaves originalmente ausentes usam `removeItem`. Também cobre um adapter que
altera antes de lançar. Tenta restaurar todas as chaves mesmo se uma restauração
falhar. Rollback incompleto gera erro explícito, sem mensagem de sucesso.
LocalStorage não oferece transação nativa nem trava entre abas; a comparação
prévia e rollback são defensivos, não sincronização multi-tab.

Após sucesso, relata provas alteradas, histories mesclados, conflitos, favoritos,
preferências aplicadas/preservadas e descartes. **Recarregar para aplicar** remonta
catálogo/dashboard/configurações usando os dados importados. Importar não aplica
preferências ao DOM antes dessa recarga.

## Aparência, acessibilidade e primeiro uso

Nova chave exclusiva: `chatgpt-exams:v1:ui-preferences`, `storageVersion: 1`.
Campos: theme system/light/dark; textSize normal/medium/large; contrast standard/high;
reduceMotion; density comfortable/compact; enhancedFocus; setupPrompt
pending/dismissed/completed. Chaves de attempts/history/favoritos continuam iguais.

`chatgpt-exams:preferences:v1` permanece intacta. Nova preferência válida tem
precedência. Se nova chave está ausente, legado light/dark inicializa a memória;
a leitura não grava migração. Nova UI corrompida usa defaults em memória e
preserva bytes; não permite sobrescrevê-la silenciosamente ao escolher um controle.

`applyInitialPreferences` aplica antes do primeiro render React. Theme system
acompanha `matchMedia` durante a sessão. Atalho do header escolhe explicitamente
o oposto do tema efetivo, inclusive saindo de system. Controles aplicam e salvam
na escolha; essa ação marca setup completed. Falha de storage mantém a escolha na
memória do documento e mostra **Aplicada nesta sessão, mas não pôde ser salva**.
Sem persistência, recarga retorna ao fallback normal; não há retry em loop.

Convite opcional no catálogo/dashboard nunca bloqueia uso. Configurar agora abre
settings sem escrever uma decisão. Agora não marca dismissed; se storage falha,
ainda oculta o banner na sessão do documento. Decisões válidas dismissed/completed
não reaparecem após recarga. Não há modal obrigatório.

Atributos em html aplicam tokens globalmente a catálogo, dashboard, settings,
provas e resultados. Texto usa a escala rem (16/18/20px na raiz), sem zoom.
Compacta reduz espaçamento/padding e mantém controles com pelo menos 44px.
O mapa de questões usa colunas responsivas `repeat(auto-fill, minmax(44px, 1fr))`
e cada botão tem largura e altura mínimas de 44px. A grade se ajusta ao espaço
da sidebar, sem overflow horizontal, em desktop, tablet e mobile, nos três
tamanhos de texto e nas duas densidades.
Alto contraste altera texto, muted, bordas, botões, foco e estados nos dois temas.
Os testes verificam contraste de texto/estados ≥ 4,5:1 e foco/bordas high ≥ 3:1.

## Foco e toque

`:focus-visible` mantém outline de teclado (3px; reforçado 5px) e offset.
Somente controles clicáveis com `:focus:not(:focus-visible)` ocultam outline de
ponteiro, preservando o foco DOM. Nunca se usa `*:focus { outline: none }`.
Tap highlight é transparente; `:active` muda fundo/borda sem scale ou movimento.
O indicador da questão atual usa borda, evitando confundir seleção com foco;
Tab/Shift+Tab continuam com outline próprio, inclusive no mapa de questões.

A preferência de movimentos reduzidos aplica `transition/animation: none` e
scroll automático. O media query do sistema continua prevalecendo mesmo com a
opção da aplicação desligada. Labels, headings, input de arquivo, mensagens
status/alert e confirmação são nativos/semânticos; nenhuma informação depende
somente de cor. Layout é verificado em 375px e 390px, inclusive texto grande.

## Limitações

Dados continuam locais; backup é manual e não há sync. Current conflitante não é
sobrescrito. Não existe updatedAt por resposta. Importação só aceita revisions
atuais do catálogo e rejeita formatos/versões desconhecidos ou futuros. Exportação
abrange apenas revisions presentes no catálogo atual, não chaves antigas fora
dele nem dados do acervo legado. Histórico compacto valida coerência, mas não
permite recalcular academicamente respostas que não fazem mais parte do resumo.

Não há múltiplos perfis, notas por questão, ranking, revisão espaçada, PWA,
service worker, analytics ou gráficos complexos. A verificação de toque cobre
Chromium emulado; não substitui teste físico em Android/iOS ou outros engines.

## Validação final e self-audit

### Correção focada dos achados F1, F2 e F3

Esta rodada altera somente retenção cronológica de history, colisões entre
tentativas e hit targets do mapa, com regressivos e documentação correspondentes.
O teste de preservação da Fase 4 reconhece exclusivamente a mudança autorizada
de `includeCurrent`; as demais funções continuam protegidas pela comparação
contra a base histórica.

- F1: regressivos do helper cobrem current antigo, recente e dentro do limite,
  igualdade/precedência por ID, desempates, history fora de ordem e não mutação.
  Integração cobre importação em destino vazio, current v1 e current v2,
  load read-only, save, restart, nova leitura e exportação. Vinte conclusões
  posteriores, incluindo 100%, sobrevivem ao current antigo de 0%; o melhor
  resultado do dashboard permanece 100%. Browser repete import/load/restart/save.
- F2: regressivos cobrem as quatro combinações current/history, equivalência e
  divergência; preview zero writes, conflito visível, current local intacto,
  rejeição da conclusão importada conflitante, merge de outros históricos,
  favoritos/configurações e exportação válida após finalizar e iniciar outra
  tentativa. Browser usa parser real, confirmação e download real.
- F3: browser mede todos os 30 botões em 1024/1280/390/375px, nas seis combinações
  de texto normal/medium/large e densidade comfortable/compact, incluindo padrão.
  Verifica ambas as dimensões ≥44px, navegação numérica, ausência de overflow,
  clique sem outline, Tab/Shift+Tab e foco reforçado em alto contraste.

Validação final desta correção: audit:legacy, validate, author:validate, typecheck,
595 Vitest, build, validate:dist, 70 Playwright, Prettier/check e git diff --check
passaram. As medições mínimas abaixo foram iguais nos projetos desktop e mobile;
todos os 30 botões passaram em todas as seis combinações, sem overflow:

| Viewport | Padrão (normal/comfortable) | Large/compact |
| -------- | --------------------------- | ------------- |
| 1024px   | 56 × 44px                   | 56 × 44px     |
| 1280px   | 47,50 × 44px                | 47 × 44px     |
| 390px    | 44,66 × 44px                | 49,59 × 44px  |
| 375px    | 52,19 × 44px                | 46,59 × 44px  |

Valores fracionários arredondados a duas casas; os asserts usam bounding boxes
originais e exigem largura/altura ≥44 sem tolerância inferior ao requisito.

Arquivos alterados exclusivamente nesta rodada: persistence.ts, backup.ts,
components.css, tests/persistence.test.ts, tests/backup.test.ts,
tests/browser/phase7a2.spec.ts, tests/phase4-preservation.test.ts e os dois
PHASE7A*.md. Não foram adicionados ou excluídos arquivos nesta rodada.

As mudanças adicionais ao runtime são somente testes relacionados e o trecho
de retenção de `PHASE7A1_SMART_CATALOG.md`. Nenhuma dependência, rede externa,
credencial, conteúdo acadêmico ou infraestrutura é alterada. A rodada para sem
staging, commit, push, PR, merge ou deploy.

Classificação após correção focada: **APROVADO PARA COMMIT**. Nenhum commit executado.

| Verificação                                     | Resultado                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `git fetch origin` e base obrigatória           | origin/main = 03b9f450224deaa76b150f86c9a3ca70710c5c50            |
| `npm ci`                                        | PASS, lockfile preservado                                         |
| `npm run audit:legacy`                          | PASS, 17 HTMLs / 485 questões históricos intactos                 |
| `npm run validate`                              | PASS, 19 provas / 522 questões                                    |
| `npm run author:validate`                       | PASS, 2 candidates reais                                          |
| `npm run typecheck`                             | PASS                                                              |
| `npm test`                                      | PASS, 595 testes / 23 arquivos                                    |
| `npm run build`                                 | PASS                                                              |
| `npm run validate:dist`                         | PASS, 19 provas / 522 questões / 492 objetivas / 30 dissertativas |
| `npm run test:browser`                          | PASS, 70 testes em desktop/mobile Chromium                        |
| Prettier `--check` dos arquivos alterados/novos | PASS                                                              |
| `git diff --check`                              | PASS                                                              |
| Comparação byte a byte contra a base            | PASS, 49 arquivos protegidos                                      |

Novos testes da Fase 7A.2: **165 Vitest** e **44 Playwright**, além das baselines de 430/26.
Nesta correção focada foram adicionados **16 Vitest** e **12 Playwright**; todos os
579/58 testes anteriores passaram. Playwright terminou sem falhas, skips ou flaky tests.
Vitest cobre cálculos globais/disciplinas, tempo de resultado distinto da atividade,
ausência de notas/0%, empates explícitos, não mutação, schemas/limites, export v1/v2 sem writes,
validação acadêmica, merge, corrupção, concorrência, rollback e preferências/React.
As três expectativas existentes ajustadas preservam os contratos anteriores:
novo lastResultAt; gravação explícita de tema na nova chave com legado intacto;
proteção de persistência reconhecendo somente a ponte read-only autorizada.

Self-audit do backup tentou JSON adulterado, unknown keys (inclusive **proto**),
ID falso, revisão falsa, answer ID/option inválido, result impossível, histories
com ID duplicado, colisões de current/history, limites de arrays/strings, falhas
de storage na primeira e nas escritas intermediárias, mudanças após preview,
rollback de setItem/removeItem e rollback incompleto, arquivo maior que 10 MiB.
Resultados: rejeição/report apropriados, conflitos locais preservados, zero writes
antes de confirmar, rollback verificável e nenhuma falsa mensagem de sucesso.
Também cobre importação ao lado de current v1 e history-only, preservando os histories
na abertura e no save posterior. Colisão com uma conclusão local é preservada
inclusive quando o backup contém a versão ainda aberta do mesmo ID.

Self-audit de configurações cobriu legado light/dark intacto, reação de system ao
OS, três tamanhos, quatro combinações de tema/contraste, densidade com alvos 44px,
movimento do sistema prevalecendo, foco 3px/5px, storage bloqueado/corrompido,
convite opcional e decisões persistidas. Navegação normal não buscou Exams.

Playwright executou o dogfood de responder, voltar ao dashboard, concluir,
conferir disciplina/atividade, favoritar, personalizar, exportar, importar em
contexto limpo, verificar preview sem writes, confirmar, recarregar e conferir
current/history/favoritos/UI. Também verificou merge com current local diferente,
rollback, concorrência, mouse/teclado, Shift+Tab, tap highlight e ausência de
overflow em 375/390px. Screenshots locais de dashboard light e dark/high/texto
large foram inspecionados. Emulação de toque é a evidência disponível; dispositivos
físicos e engines Safari/Firefox não foram executados.

Segurança: busca em todos os arquivos runtime alterados/novos encontrou zero
`dangerouslySetInnerHTML`, eval, new Function, XMLHttpRequest, WebSocket,
localStorage.clear, sessionStorage.clear ou nova chamada fetch. O loader existente
continua com fetch interno por paths sob BASE_URL. Monitores de navegador
confirmaram requests somente na origem local, sem telemetria/rede externa.
Chaves de importação são construídas pelo catálogo e pelos helpers constantes,
nunca extraídas como chaves arbitrárias do arquivo.

Preservação byte a byte inclui data/exams, candidates/reviews/generations,
schema/exam.ts, schema/exam.schema.json, package.json, package-lock.json,
correção/transições/loaders acadêmicos, scripts de authoring e workflows Pages.
19 provas / 522 questões permanecem 492 objetivas + 30 dissertativas.
Zero dependências novas e zero exclusões de arquivos.

Instalação usa o cache permitido em /tmp. Fetch, instalação e suites com
subprocessos/browser exigiram a opção de rede do executor: o sandbox padrão
impediu subprocessos Node e inicialmente não alcançou o proxy. Com a configuração
suportada, todos os comandos passaram. Não houve alteração de testes de authoring
para contornar falhas, chamada live de geração ou modificação de credenciais.

## Inventário final sem staging

**15 arquivos modificados, 20 novos, 0 excluídos.**
HEAD permanece no commit obrigatório; nenhuma alteração staged, commit do projeto,
push, PR, merge ou Pages/deploy. O checkout original ficou sem modificações.

Arquivos modificados, relativos à raiz do worktree:

- `AGENTS.md`
- `docs/PHASE7A1_SMART_CATALOG.md`
- `src/app/App.tsx`
- `src/app/main.tsx`
- `src/app/theme.ts`
- `src/engine/catalog-progress.ts`
- `src/engine/persistence.ts`
- `src/styles/components.css`
- `src/styles/global.css`
- `src/styles/tokens.css`
- `src/utils/paths.ts`
- `tests/catalog-progress.test.ts`
- `tests/persistence.test.ts`
- `tests/phase4-preservation.test.ts`
- `tests/render.test.tsx`

Arquivos novos:

- `docs/PHASE7A2_DASHBOARD_BACKUP_SETTINGS.md`
- `src/app/DashboardPage.tsx`
- `src/app/SettingsPage.tsx`
- `src/app/useDashboardState.ts`
- `src/app/useUiPreferences.ts`
- `src/components/common/SetupPrompt.tsx`
- `src/components/dashboard/Metrics.tsx`
- `src/components/dashboard/RecentActivity.tsx`
- `src/components/dashboard/SubjectCards.tsx`
- `src/components/settings/BackupControls.tsx`
- `src/components/settings/PreferenceControls.tsx`
- `src/engine/backup-browser.ts`
- `src/engine/backup.ts`
- `src/engine/dashboard-metrics.ts`
- `src/engine/ui-preferences.ts`
- `tests/backup.test.ts`
- `tests/browser/phase7a2.spec.ts`
- `tests/dashboard-metrics.test.ts`
- `tests/phase7a2-render.test.tsx`
- `tests/ui-preferences.test.ts`

Saída final de `git diff --stat`:

```text
 AGENTS.md                         |   2 +
 docs/PHASE7A1_SMART_CATALOG.md    |   4 +-
 src/app/App.tsx                   |  51 +++++++++++--
 src/app/main.tsx                  |   4 +-
 src/app/theme.ts                  |  42 +---------
 src/engine/catalog-progress.ts    |   4 +-
 src/engine/persistence.ts         |  49 ++++++++++--
 src/styles/components.css         | 156 ++++++++++++++++++++++++++++++++++++--
 src/styles/global.css             |  43 +++++++++++
 src/styles/tokens.css             |  56 ++++++++++++++
 src/utils/paths.ts                |  16 ++++
 tests/catalog-progress.test.ts    |   1 +
 tests/persistence.test.ts         |  72 +++++++++++++++++-
 tests/phase4-preservation.test.ts |  24 +++++-
 tests/render.test.tsx             |   3 +-
 15 files changed, 461 insertions(+), 66 deletions(-)
```

O stat acima cobre somente os arquivos já rastreados. Os 20 novos permanecem
untracked e estão listados explicitamente; nenhum git add foi utilizado.
