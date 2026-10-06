> A interação de grifo/borracha foi atualizada localmente para ferramentas explícitas por gesto.
> Ver [ANNOTATION_GESTURE_TOOLS.md](ANNOTATION_GESTURE_TOOLS.md). As evidências abaixo
> documentam a baseline 8A anterior; a nova validação está no documento de gesto.

# Fase 8A — ferramentas de resolução ativa

## Contratos e arquitetura

Annotations são anotações pessoais persistentes do **statement** da questão. Não integram
Exam, Attempt, ReviewSession, resultados, flags, confirmações ou métricas. O renderer global
`RichContent` permanece intacto. Contextos, imagens, alternativas, explicações e respostas-modelo
não recebem marcações. Dashboard/Catalog continuam carregando somente resumos.

- `src/engine/statement-projection.ts`: `projectStatement` é a única projeção acadêmica.
- `src/engine/question-annotations.ts`: schema, limites, validação e álgebra de intervalos.
- `src/engine/question-annotations-storage.ts`: read e write defensivos.
- `src/engine/statement-selection.ts`: DOM Range → offsets acadêmicos.
- `src/app/useQuestionAnnotations.ts`: apresentação, last-known-good e storage events.
- `src/components/questions/AnnotatedStatement.tsx`: árvore React, fragments e controles.
- `src/engine/solver-scratch.ts` / `src/app/useSolverScratch.ts`: eliminações por scope.
- `src/engine/option-click-arbiter.ts`: árbitro e cancelamento dos timers.

### Projeção e offsets v1

`projectStatement` percorre RichText depth-first, na ordem dos arrays. Retém a árvore original
e fornece cada text leaf com caminho acadêmico, start/end, texto concatenado exato e comprimento.
Somente `type:"text"` contribui unidades. Elementos, blocos, listas, tabelas e `br` contribuem zero;
nenhum separador ou whitespace é inventado. A implementação não normaliza NFC/NFD.

A unidade persistente é **UTF-16 code unit**, compatível com String.length/slice e offsets de
DOM Text/Range. `validBoundary` impede cortes entre high/low surrogate, inclusive quando o par
atravessa leaves. Combining marks podem ter boundary intermediário: grapheme clusters não são
a unidade do contrato. Alterar essa semântica exige outra storageVersion e decisão de migração.

O renderer reconstrói os elementos originais e fragmenta exclusivamente texto. Cada fragmento
DOM Text é registrado por ref com caminho acadêmico e offsets locais. Não há substring search,
innerHTML, contenteditable, execCommand, HTML serializado ou textContent como autoridade.
O tradutor aceita endpoints Text ou Element, normaliza a direção pelo Range nativo, verifica que
ambos estão no statement atual, confere fragments contra o texto original e valida UTF-16.
Seleções vazias, externas, parcialmente externas, multirange ou DOM adulterado são rejeitadas.
Textos repetidos e até um objeto text reutilizado são distinguidos por caminho, não por conteúdo
ou identidade do objeto. Índices de children do DOM fragmentado não identificam leaves.

### Persistência e identidade

Chave de localStorage: `${storageKey(exam)}:annotations`, isto é,
`chatgpt-exams:v1:<examId>:r<revision>:annotations`. `storageKey()` não foi alterada.
Schema Zod estrito: storageVersion:1, examId, examRevision, questions.
Cada highlight contém id, start, end e color (yellow/green/blue). IDs são únicos no envelope.
Nenhum ID é criado em read/render. Mutações aceitam idFactory; produção usa crypto.randomUUID.
IDs inválidos/duplicados abortam; um split gera IDs novos para seus fragments.

Nova cor vence apenas na seleção. Um highlight amarelo [10,30), pintado verde em [15,20),
vira [10,15) amarelo + [15,20) verde + [20,30) amarelo. Borracha usa a mesma subtração de
intervalos. Remover por ID remove todos os marks daquele highlight lógico. Limpar questão
altera somente sua entrada. Ranges persistidos ficam ordenados, sem overlap.

Limites explícitos:

| Constante                   |                Valor | Justificativa                                      |
| --------------------------- | -------------------: | -------------------------------------------------- |
| MAX_HIGHLIGHTS_PER_QUESTION |                  200 | Limita fragmentação e controles em cada enunciado. |
| MAX_HIGHLIGHTS_PER_EXAM     |                 4000 | Limita envelope/validação da prova inteira.        |
| MAX_ANNOTATION_RAW_LENGTH   | 1000000 UTF-16 units | Limita parse/string allocation antes do JSON/Zod.  |
| MAX_SCRATCH_RAW_LENGTH      |  200000 UTF-16 units | Limita o estado transitório da sessão.             |

Read ausente, válido ou incompatível é zero-write. Não migra, trunca, repara nem sobrescreve raw
inválido/incompatível/oversized. UI acadêmica permanece operacional; edição pessoal é bloqueada
com aviso. Eventos inválidos preservam last-known-good na mesma identidade acadêmica, sem alegar
sincronização. Evento válido pode liberar o bloqueio. Falha/stale writer exige reabrir ou receber
snapshot válido; mutações futuras não substituem escritores concorrentes.

Antes de cada mutação, compara raw atual com raw esperado, valida esperado/proposta e usa
`writeTransaction` existente, que verifica antes/depois do write e faz rollback apenas quando
raw ainda é o próprio valor. localStorage não oferece CAS real: a pequena janela entre leitura
e escrita não pode ser eliminada; não há promessa de transação entre processos.
Storage event exige chave exata, storageArea localStorage, exam/revision válidos e raw atual igual
a newValue; eventos antigos/irrelevantes são ignorados. Nunca escuta sessionStorage.

Annotations compartilham a mesma revision entre tentativas, nova tentativa, histórico e
ReviewSession. Nova revision usa outra chave. O ReviewSession passa a prova **completa** como
`annotationExam`; sua prova derivada serve somente à apresentação/navegação. Assim, highlights
fora do subconjunto não são perdidos nem considerados corrupção. Leituras de records verificam
propriedades próprias, protegendo IDs acadêmicos válidos como `constructor`.

### Scratch e resposta acadêmica

Chave sessionStorage:
`${storageKey(exam)}:solver-scratch:<kind>:<encodeURIComponent(scopeId)>`.
kind é attempt ou review-session; scopeId é o ID da tentativa/sessão, nunca índice ou só examId.
Schema estrito próprio: storageVersion:1, kind, scopeId, examId, examRevision, questions com
listas de option IDs únicas e referências acadêmicas validadas. Nova sessão não herda scratch;
reload na mesma aba preserva. Não há sincronização entre abas nem garantia de herança de aba
nova (navegadores podem copiar sessionStorage ao duplicar uma aba).

Selecionar alternativa eliminada tenta removê-la antes de onAnswer. Falha de scratch nunca
bloqueia a resposta. A apresentação sempre exclui a opção selecionada das eliminações; toda
mutação bem-sucedida também remove opções selecionadas de todas as questões antes de salvar.
Se o navegador recusar a escrita, raw antigo/corrompido permanece preservado e pode conter a
eliminação antiga; ela não aparece como selected+eliminated na UI. Isso não autoriza sobrescrever
corrupção nem prometer que uma remoção que falhou foi persistida.

Eliminar uma opção já selecionada aborta, sem alterar answer, e informa para escolher outra.
Alternativas eliminadas permanecem legíveis, com line-through fino, radios ativos e botão real.
O botão anuncia Eliminar/Restaurar alternativa com posição legível, aria-pressed/aria-controls,
alvo mínimo 44px e stopPropagation. Tab/Enter/Espaço funcionam. Touch usa o botão, sem double-tap
obrigatório ou interferência no zoom nativo.

### Árbitro, foco e feedback

Janela exata: **600 ms**, incluindo margem para o cenário adversarial de 450 ms (`OPTION_CLICK_WINDOW_MS`). Corpo não interativo agenda um único timer,
sem chamar onAnswer antecipadamente. O callback responde uma vez. Segundo click (detail=2)
cancela o timer e alterna eliminated; detail>=3 não responde nem alterna novamente.
Identidade contém scope + question + option. A→B substitui a intenção pendente A pela mais
recente B; A→double-B cancela A e alterna somente B. Um novo double após a janela pode restaurar.
Uma intenção da mesma gesture/window alterna no máximo uma vez. Não se promete compatibilidade
com configurações de double click do sistema que ultrapassem a janela de 600 ms.

Radios respondem diretamente por onChange, preservando teclado; seus click/double click nunca
entram no árbitro. Botões cancelam a interação pendente e não propagam o gesto. A exclusão de
controles cobre também links, labels, inputs, select, textarea, summary, contenteditable e roles
interativos/tabindex futuros. Um controle futuro não pode virar gesto do corpo.
O árbitro é descartado em troca de questão/scope, unmount e transição readOnly; callbacks usam
props atuais. Study confirmado mantém os mesmos radios e os desabilita. Exam concluído e
histórico exibem feedback acadêmico, sem scratch ativo. Highlights continuam editáveis.

Toolbar contextual fixa, com wrap, largura/altura limitadas à viewport e scroll vertical interno.
Cores têm tokens separados para light/dark/high/dark+high. Escape e fechar retornam foco ao
controle estável; remover/limpar também retornam foco. Clique no controle de foco preserva a
seleção capturada. Nenhum hover obrigatório, overflow-x:hidden, zoom ou scale.
Movimento reduzido e enhanced focus usam o Design System já existente.
Os controles são acessíveis por teclado **após uma seleção válida existir**. Não foi demonstrada
criação integral da seleção nativa apenas por teclado; não há caret ou tabindex invasivo.

### Reset, backup, preservação e infraestrutura

ZERAR continua tocando somente current/history/review/review-session conhecidos. Annotations
sobrevivem byte-identical; scratch de sessionStorage também fica fora do reset. Backup continua
medsim-backup v3, não exporta/importa ambos, preview é zero-write e import preserva annotations.
Não há clear() de storage, deleção por prefixo ou enumeração para apagar estados desconhecidos
nas features. Testes podem limpar seu storage isolado.

Schema acadêmico, Attempt/ReviewSession, calculateResult/answeredCount, flags, métricas,
preferences, Dashboard/Catalog, conteúdo acadêmico, packages, Vite e workflows permanecem
inalterados. O preservation guard recebeu somente seis paths exatos dos módulos de engine.
A regressão nova também verifica untracked acadêmicos e os módulos oficiais contra o baseline.

## Relatório da implementação local

### A–B. Base, isolamento e preflight remoto

Data: 06/10/2026, horário do cliente America/Sao_Paulo.
Baseline/HEAD local: `8dbdd359e0f7badebdbce45b64ef893a17dee6e2`.
Preflight remoto confirmado **externamente pelo supervisor/usuário em read-only**:
main nesse SHA; nenhum PR aberto; branch remota da fase inexistente;
PR #16 closed, merged=false, merged_at=null. Nenhuma implementação do PR #16 foi reaproveitada.

As consultas remotas iniciais deste executor falharam por acesso ao proxy; a declaração
explícita posterior do supervisor autorizou continuar. O relatório não apresenta essa
verificação externa como uma consulta GitHub executada localmente.

Checkout de origem `/workspace/CHATGPT`: branch `work`, HEAD no baseline e status inicial vazio.
Não havia branch/worktree da fase. Foi criado o worktree a partir do SHA exato, sem editar origem.
A identidade foi provada **antes da primeira edição**:

```text
git rev-parse --show-toplevel
/workspace/CHATGPT-phase8a-active-solving-tools

git rev-parse --git-dir
/workspace/CHATGPT/.git/worktrees/CHATGPT-phase8a-active-solving-tools

git rev-parse --git-common-dir
/workspace/CHATGPT/.git

git branch --show-current
codex/phase8a-active-solving-tools

git rev-parse HEAD
8dbdd359e0f7badebdbce45b64ef893a17dee6e2

git status --short
(vazio antes da primeira edição)
```

Nenhum main foi criado, editado ou atualizado. A ref local `work` permanece no baseline;
o main remoto é o SHA verificado externamente. O HEAD da fase não mudou: nenhum commit.

### C. Arquivos e inventário

10 arquivos tracked modificados e 17 arquivos untracked; nenhum deleted/renamed/inesperado.
A lista integral está em X. Novos módulos são seis engine, dois hooks, um renderer, cinco
suites Vitest, uma fixture, uma suite Playwright e a documentação. As alterações tracked
integram Exam/ReviewSession/QuestionCard/MC/types, tokens/CSS compartilhado, guard exato,
um teste existente para aguardar o single click e uma regra durável no AGENTS.md.

### D–G. Annotations, projeção, Unicode e IDs

Arquitetura, schema e operações estão descritos acima. `projectStatement` sustenta todas as
validações, renderer e Selection→offsets: DFS determinístico, somente text, UTF-16 exato,
br=0, sem separador, normalização ou substring search. Texto repetido e leaves estruturalmente
iguais têm caminhos distintos. Surrogate cuts são rejeitados; combining boundaries são válidos.
IDs só surgem em paint/split, com idFactory determinística nos testes. Muitos marks podem
representar um ID; remove exclui o intervalo lógico inteiro. Overlap/recolor/eraser preservam
nonoverlap e limite, sem tocar o conteúdo original.

### H. UX

Amarelo/verde/azul; borracha por seleção; remover lógico via mark ou lista; limpar só a questão.
Toolbar limitada à viewport, wrap, keyboard focus e Escape; foco retorna ao controle estável,
inclusive após remove/clear. Clique no controle de foco não cancela seleção capturada.
Tokens light/dark/high/dark+high; targets 44px; reduced motion e foco ampliado preservados.

### I–L. Scratch, árbitro, radio e botão

Scratch sessionStorage próprio e estrito por Attempt.id ou ReviewSession.id, incluindo kind,
exam/revision/question/option. Reload preserva a mesma aba; scope novo não herda.
Janela exata **600 ms**: um timer pendente por cartão, identidade scope+question+option,
single responde uma vez na expiração; double cancela sem resposta intermediária; triple/higher
não agenda nem alterna novamente na gesture. A→B mantém intenção mais recente B;
A→double-B cancela A, alterna só B. Cancelamentos em navigate/question/scope/unmount/readOnly
foram testados com fake timers; browser testa comportamento real e slow double de 450ms.

Radio mantém onChange/teclado, cancelando pending e sem entrar no árbitro. Botão explícito
real, Eliminar/Restaurar, ordinal legível, aria-pressed/controls, stopPropagation, Enter/Espaço.
Controles interativos futuros, incluindo summary/contenteditable/roles, ficam fora do gesto.
Selected→eliminate aborta. Eliminated→select tenta restaurar; onAnswer prevalece mesmo em
falha de scratch; selected+eliminated nunca é exibido. Feedback domina em Study confirmado,
Exam concluído e histórico; respostas históricas continuam imutáveis.

### M–N. Limites e persistência

Valores exatos/justificativas na tabela de limites. Annotations compartilham mesma revision e
isolam novas revisions. Missing/read/render/navigation/review/storage event são zero-write.
Corrupção/oversized/incompatibilidade preserva raw, avisa e bloqueia writes. Last-known-good
fica somente na apresentação segura. Stale writer preserva raw divergente. Rollback não
sobrescreve concorrente. Eventos nativos em duas abas, eventos antigos/wrong-key/wrong-area e
recuperação por snapshot válido foram testados. sessionStorage não é tratado como sincronizado.

Namespace pesquisado em src/tests: `:annotations`, `solver-scratch`, `storageKey(`,
`sessionStorage`, `localStorage`; não havia colisão do novo domínio. Chaves exatas utilizadas
estão na arquitetura. `storageKey` inalterada, zero clear()/delete genérico em produção.

### O–P. Reset, backup e contratos oficiais

Regressão prova annotations raw byte-identical durante ZERAR, enquanto official current,
history, review e ReviewSession seguem o contrato; scratch também fica fora. Backup v3
não inclui annotations/scratch; export/preview são read-only e import preserva os raws.
Attempt, ReviewSession, calculateResult, answeredCount, flags, Dashboard, métricas, preferences,
academic schema/data e infraestrutura permanecem byte-identical contra o baseline pertinente.
O teste Git-aware adicional cobre também untracked acadêmicos. Guard usa seis paths exatos.

### Q. Novos testes

| Grupo                              |  Vitest |
| ---------------------------------- | ------: |
| Projeção/Unicode/tags              |      28 |
| Schema/IDs/álgebra de annotations  |      30 |
| Storage de annotations             |       9 |
| Scratch                            |      21 |
| Árbitro                            |      10 |
| DOM Selection/render fragmentado   |      17 |
| UI/modos/foco/interatividade       |      17 |
| Reset/backup/Git-aware/preservação |       4 |
| **Total novo**                     | **136** |

Playwright: 30 novos casos × 2 projetos = **60 execuções** novas. Inclui 20 combinações de
viewport/tema por projeto, lifecycle/storage/modos, rich Unicode e double click lento.
Não houve remoção, skip ou redução dos testes existentes. Baseline 971/176 → 1107/236 esperados.
Runs targeted com filtros deliberados foram usados apenas para provas antes da correção;
suas exclusões não equivalem a skips no estado final.

### R–S. Fonte e touch

Fonte CI-like real disponível: DejaVu Sans (`fc-match` → DejaVuSans.ttf Book), aplicada apenas
nos testes por style override. Produção conserva Segoe UI/system-ui e Georgia.
375/390 com texto ampliado (root 20px) estão incluídos nos quatro temas, assim como 768/1024/1280.
Cada caso mede `document.documentElement.scrollWidth <= document.documentElement.clientWidth`;
a toolbar também tem bounding box integralmente na viewport e botões com altura ≥44px.
Screenshots não substituem essas assertions.

**Controle explícito touch testado em viewport/pointer; seleção nativa por long-press/handles
requer validação manual em dispositivo real.** Projetos desktop/mobile são Chromium emulado.
Não se declara teste físico iOS/Android, nem criação integral de seleção nativa por teclado.

### T. Red-team e correções

1. **severity: P1 — double lento podia responder antes da eliminação.**
   - reprodução: single; avançar fake timer 450ms; segundo click detail=2; onAnswer já chamado.
   - causa: janela inicial de 400ms menor que o gesto adversarial.
   - regressão: `phase8a-scratch` slow450; prova antes: 1 chamada indevida; teste browser com down/up 1→2 separados por 450ms.
   - correção: janela 600ms; nenhuma resposta no segundo/higher detail; timer cancelado.
   - resultado: targeted pós-correção verde; teste incluso na suíte integral final.
2. **severity: P2 — ID constructor herdava propriedade de objeto.**
   - reprodução: questão acadêmica id=constructor com annotations/scratch vazios; paint/eliminate.
   - causa: lookup direto em record `{}` via prototype.
   - regressão: duas provas antes da correção: old.flatMap não é função; current não é iterable.
   - correção: Object.hasOwn em mutações e apresentação dos dois domínios.
   - resultado: ambas regressões e suites afetadas verdes.
3. **severity: P2 — foco da toolbar fechava a própria seleção.**
   - reprodução: selecionar; clique real/pointer no controle Focar ferramentas; Amarelo deixa de existir.
   - causa: listener outside tratava o trigger como área externa.
   - regressão: falha browser em 375/390 e demais larguras; userEvent click, Escape/return focus.
   - correção: trigger excluído do outside; pointer default preservado; seleção capturada mantida
     quando foco passa para controles e nova seleção válida continua sendo reconhecida.
   - resultado: targeted UI e matriz de 58 execuções pré-ajustes finais verdes; suite final rerodada.
4. **severity: P2 — confirmação Study remontava controles.**
   - reprodução: guardar refs de radios, responder/confirmar, conferir disabled dos mesmos elementos.
   - causa: troca entre wrapper de scratch e renderer ao entrar readOnly.
   - regressão: teste existente `phase7b1-render` falhou; assertion mantida e repetida em 8A.
   - correção: wrapper estável; atualização readOnly preserva radios, retira controls e cancela arbiter.
   - resultado: testes antigo e novo verdes, sem relaxar assertions.
5. **severity: P2 — controles futuros entravam no árbitro.**
   - reprodução: summary, contenteditable vazio ou role=slider dentro do corpo; double.
   - causa: filtro de interatividade incompleto.
   - regressão: três provas antes da correção mostraram toggle indevido.
   - correção: filtro cobre controles nativos/roles/tabindex; cancela pending ao detectar controle.
   - resultado: três regressões passam; respostas/eliminações não propagam ao corpo.
6. **severity: P2 — leaves com objeto reutilizado mapeavam pela identidade errada.**
   - reprodução: o mesmo objeto text ocorre em duas posições; map node→leaf substitui a primeira.
   - causa: identidade JS insuficiente para caminho acadêmico.
   - regressão: selecionar [6,9) em duas ocorrências de "igual" exige offsets da segunda ocorrência.
   - correção: renderer mapeia por path da projeção. Foi corrigido durante inspeção, antes da
     primeira execução dessa regressão; não se alega uma prova de falha executada do código antigo.
   - resultado: targeted DOM e suite integral verdes.

Outros ataques cobertos: raw inválido/incompatível/oversized, IDs duplicados, surrogate cuts,
recolor/eraser cruzados, DOM adulterado/externo/invertido, post-reload/split, stale writer,
quota/write-then-throw/rollback com writer divergente, native storage event e source subset,
selected/eliminated, scope replacement e pending navigation/unmount/readOnly.

Incidentes de ambiente, sem relaxar testes: npm inicial sem permissão de rede falhou no proxy;
preview local EPERM e cinco CLI subprocess tests retornavam stdout vazio sob sandbox sem rede.
Com permissão de rede do comando, npm ci/localhost/IPC funcionaram; authoring targeted 101 testes
passaram sem editar esses módulos. Nenhuma configuração de infraestrutura foi alterada.
Uma assertion nova esperava seis marks para cinco leaves; a fixture foi corrigida para cinco,
com base na contagem canônica. Isso não foi classificado como bug de produção.

### U. Suíte integral final

| Comando                 | Resultado final                                                                                                 |
| ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| npm ci                  | exit 0; 118 packages instalados                                                                                 |
| npm run audit:legacy    | exit 0; 17 legados, 485 questões, 462 objetivas, 23 dissertativas; nota documental herdada sobre scripts do hub |
| npm run validate        | exit 0; 19 provas / 522 questões; catálogo validado                                                             |
| npm run author:validate | exit 0; 2 candidates reais válidos                                                                              |
| npm run typecheck       | exit 0; sem erros                                                                                               |
| npm test                | exit 0; **40 arquivos, 1107 testes passaram**, 0 falhas/skip; 97.04s                                            |
| npm run build           | exit 0; 19 provas validadas; typecheck e Vite verdes                                                            |
| npm run validate:dist   | exit 0; **19 / 522 / 492 / 30**, JSONs iguais à fonte, legado byte-identical                                    |
| npm run test:browser    | exit 0; **236 passaram**, 0 falhas/skip; 7.0m                                                                   |
| git diff --check        | exit 0; output vazio                                                                                            |

Chromium local: 151.0.7922.173 Debian 13, selecionado pela variável já suportada
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium`, sem alterar configuração do projeto.
A suite integral rodou depois de todas as correções de código/teste e formatação.
Baseline preservado: 971 + 136 = 1107 Vitest; 176 + 60 = 236 Playwright.
Não houve staging; `git diff --cached --name-status` vazio.

### V–W. Responsividade e preservação acadêmica

Responsividade: 375, 390, 768, 1024, 1280; texto ampliado, light/dark/high/dark+high;
viewport/pointer mobile e controles de teclado/foco. Assertions de overflow/toolbar/targets.
Preservação: **19 provas / 522 questões / 492 objetivas / 30 dissertativas**.
Os comandos abaixo têm output vazio, também verificados no teste Git-aware:

```bash
git diff 8dbdd359e0f7badebdbce45b64ef893a17dee6e2 -- data/exams/
git diff 8dbdd359e0f7badebdbce45b64ef893a17dee6e2 -- simulados/
```

### X. Git status final e side effects

```text
 M AGENTS.md
 M src/app/ReviewSessionPage.tsx
 M src/components/exam/ExamPage.tsx
 M src/components/questions/MultipleChoiceQuestion.tsx
 M src/components/questions/QuestionCard.tsx
 M src/components/questions/types.ts
 M src/styles/components.css
 M src/styles/tokens.css
 M tests/phase4-preservation.test.ts
 M tests/render.test.tsx
?? docs/PHASE8A_ACTIVE_SOLVING_TOOLS.md
?? src/app/useQuestionAnnotations.ts
?? src/app/useSolverScratch.ts
?? src/components/questions/AnnotatedStatement.tsx
?? src/engine/option-click-arbiter.ts
?? src/engine/question-annotations-storage.ts
?? src/engine/question-annotations.ts
?? src/engine/solver-scratch.ts
?? src/engine/statement-projection.ts
?? src/engine/statement-selection.ts
?? tests/browser/phase8a.spec.ts
?? tests/phase8a-annotations.test.ts
?? tests/phase8a-fixtures.ts
?? tests/phase8a-preservation.test.ts
?? tests/phase8a-render.test.tsx
?? tests/phase8a-scratch.test.ts
?? tests/phase8a-selection.test.tsx
```

`git diff --name-status`: os 10 paths M acima, sem deletions/renames.
`git diff --stat`: 10 tracked, 252 insertions, 22 deletions; untracked estão explicitamente acima.
`git diff --check`: output vazio, exit 0.

Checkpoints após npm ci, Vitest, build e browser têm status byte-identical entre si e ao
inventário final. Não houve novo path inesperado.
Saídas ignoradas inspecionadas: node_modules, public/generated (20 arquivos), public/legacy
(24), dist (48), test-results (112 PNGs previstos das suites existentes e .last-run.json
com status=passed/failedTests=[]).
public/generated/legacy e dist são saídas previstas de generate/build; validate:dist valida seus
JSONs/legado contra a fonte. Screenshots em test-results são explicitamente produzidos pelas
suites browser existentes (não criados pela nova suite); nenhum foi adicionado ao inventário.
Nenhum artefato foi removido manualmente para aparentar limpeza. playwright-report/coverage/
screenshots/traces externos a test-results estavam ausentes na inspeção.

### Y. Limitações e evidência final

- CAS real inexiste no localStorage; checks/rollback defensivos não eliminam a janela concorrente.
- Janela de single/double é 600ms; configurações de sistema com double click mais longo exigem
  avaliação específica. Resposta no corpo tem esse atraso deliberado; radio é imediato.
- Sem dispositivo físico para long-press/handles; sem comprovação integral de seleção por teclado.
- sessionStorage pode ser copiado ao duplicar abas pelo navegador; nenhum sync é prometido.
- Em falha de storage, raw antigo/corrompido é preservado. Uma eliminação antiga pode ficar no raw
  após uma resposta vencedora; apresentação nunca combina selected+eliminated e próxima mutação
  válida limpa opções selecionadas. Não se simula sucesso de persistência.
- Nenhuma validação local substitui futuros CI remoto/Content Gate/Pages/smoke. Nenhum desses
  gates foi atravessado.

Todos os resultados finais correspondem ao último estado de código/testes. Após correções
de red-team e formatação, regressões targeted e suite integral foram executadas novamente.
A atualização final deste relatório é documental, sem mudanças posteriores de código/teste.

### Z. Gate

**IMPLEMENTAÇÃO LOCAL CONCLUÍDA — SEM STAGING, SEM COMMIT, SEM PUSH, SEM PR. AGUARDANDO AUDITORIA HUMANA/RED-TEAM PRÉ-STAGING.**
