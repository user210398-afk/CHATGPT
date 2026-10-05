# Fase 7B.2A — Hub de Matérias

## Objetivo e escopo

A Home passa a apresentar matérias. O fluxo principal é Home → matéria → simulados → prova. A ação secundária “Ver todos os simulados” mantém o catálogo global. Dashboard, Revisão, Configurações e o domínio de tentativas permanecem compatíveis. Sem novos tipos de tentativa, review sessions, backup v3, estatísticas ou persistência.

Base: `main` / `98605bab75f9626899e11eb595d2574e29438d2c`.
Branch: `codex/phase7b2a-subject-hub`.

## Autoridade do agrupamento

`src/engine/subject-groups.ts` define identidade, nome canônico, aliases, monograma decorativo, ordem, membership e métricas do Hub. Componentes não contêm condições de aliases. `groupCatalogExams` cria listas novas e preserva os objetos `CatalogExam` e seus campos acadêmicos. Apenas grupos com provas são exibidos.

| Matéria                   | Aliases acadêmicos                        | Simulados | Questões |
| ------------------------- | ----------------------------------------- | --------: | -------: |
| Farmacologia              | Farmacologia; Farmacologia Básica         |         5 |      148 |
| Fisiologia                | Fisiologia                                |         3 |       63 |
| Imunologia                | Imunologia                                |         3 |       90 |
| Microbiologia e Virologia | Microbiologia/Virologia                   |         4 |      120 |
| Parasitologia             | Parasitologia                             |         1 |       31 |
| Patologia                 | Patologia/Imunologia                      |         1 |       30 |
| Propedêutica              | Propedêutica; Propedêutica/Clínica Médica |         2 |       40 |
| **Total**                 |                                           |    **19** |  **522** |

`imunologia-b4-2024` pertence a Microbiologia e Virologia segundo seu subject original. Farmacologia inclui `farmaco-p2-2023`, `farmaco-p2-2024`, `farmaco-p2-2025`, `farmacologia-anti-hipertensivos-teste-2026` e `farmacologia-parassimpatoliticos`. Propedêutica inclui `propedeu-p2-2024` e `propedeu-p2-2025`.

## Fallback e estabilidade

Um subject desconhecido produz grupo próprio com o nome original. A identidade contém prefixo `custom-`, slug normalizado e sufixo injetivo formado pelos code points hexadecimais do subject original. Diferentes acentos, caixa, separadores e caracteres Unicode não colidem. A identidade independe da ordem do catálogo e da inclusão posterior de outras matérias; não depende de índice ou hash probabilístico. Grupos conhecidos vêm na ordem explícita; futuros vêm depois, ordenados por título pt-BR com desempate por identidade.

## Rotas e navegação

- Hub: `/CHATGPT/`.
- Matéria: `/CHATGPT/?area=farmacologia` (identidade via `encodeURIComponent`).
- Global: `/CHATGPT/?view=all`.
- Prova: `/CHATGPT/?exam=<id>` (contrato existente).

Links são âncoras reais, sem React Router ou dependências adicionais. Navegações remontam a página; back/forward e reload usam o histórico nativo. `pageshow` atualiza os resumos quando o navegador restaura bfcache. A prova oferece “← Simulados da matéria”, calculado pela mesma autoridade de agrupamento. `exam` válido mantém precedência sobre outros parâmetros, e dashboard/settings/review mantêm seus contratos.

Área inexistente, vazia ou título usado no lugar da identidade mostra “Matéria não encontrada.” e “Voltar para Matérias”, sem redirecionar. Catálogo vazio mostra estado explícito no Hub e no global.

## Filtros, favoritos e progresso

A página de matéria restringe primeiro o catálogo ao grupo e reutiliza `useCatalogState`, `CatalogFilters`, `selectCatalogItems` e `ExamCard`. Busca, ano, status, favoritos, tipo e ordenação mantêm as combinações por AND. `CatalogFilters.showSubject` oculta genericamente só Disciplina; o catálogo global mantém todos os controles e subjects acadêmicos originais.

Favoritos permanecem por prova e usam o repositório/chave existentes. ExamCard mantém status, nota, tentativas, progresso e CTAs. O Hub agrega somente questões, simulados e quantidades de concluídos/em andamento/não iniciados a partir de `ExamProgressSummary.status`. Não infere média, domínio ou desempenho agregado.

## Zero-write e network

Hub, matéria, global, filtros e pageshow não criam tentativas nem escrevem current/history/review/preferências. Seleção e rota ficam na URL/UI; nenhuma migração ou nova chave/versão de storage. Favoritar, alterar tema/configurações ou iniciar/responder uma prova continuam sendo ações explícitas de escrita.

O único recurso de conteúdo dessas páginas é `generated/exam-index.json`. Agrupamento ocorre em memória. Exams completos continuam sendo requisitados apenas pelo loader de prova ou ações explícitas existentes de backup. Playwright observa zero requests de `/generated/exams/` no Hub, matéria e global e um único JSON correspondente ao abrir uma prova.

## Apresentação, acessibilidade e responsividade

Cards de matéria usam títulos proeminentes, mais padding, monograma discreto com `aria-hidden=true`, CTA real com nome completo acessível e tokens compartilhados. Sem imagens externas, ícones de biblioteca ou animações novas. Breadcrumb usa nav nomeado, lista e `aria-current=page`; headings h1/h2/h3, navegação principal, skip link e focus-visible são preservados. Novos links interativos têm targets de pelo menos 44×44.

Grid usa `auto-fit`/`minmax` com mínimo de 320px limitado à largura disponível. Em fonte normal: 375/390px = uma coluna; 768/1024px = duas; 1280px = três. Fonte ampliada pode reduzir colunas para manter leitura. Cards não têm largura fixa. Claro/escuro, alto contraste, text size, density, reduced motion e enhanced focus seguem atributos e tokens existentes.

## Testes e auditoria

- `tests/subject-groups.test.ts`: cobertura única dos 19 IDs, aliases, membership, contagens de todas as matérias, fallback, colisões, estabilidade, ordenação, imutabilidade, métricas permitidas e rotas.
- `tests/subject-hub-render.test.tsx`: Hub, matéria/global, breadcrumb, filtros combinados, favoritos/progresso, pageshow, rota inválida, matéria futura, vazio e App zero-write/network.
- `tests/browser/phase7b2a.spec.ts`: navegação, back/forward, reload, prova, favoritos/progresso, storage, requests, teclado, fallback/colisões, vazio e cinco viewports nos dois temas e com preferências acessíveis; screenshots locais em test-results.
- Regressões antigas de catálogo passam a acessar `?view=all`; testes de retorno de prova usam a página da matéria. Asserções de domínio continuam presentes.

Executar `npm ci`, `audit:legacy`, `validate`, `author:validate`, `typecheck`, `npm test`, `build`, `validate:dist`, `test:browser` e `git diff --check`. A integridade esperada é 19 Exams / 522 questões / 492 objetivas / 30 dissertativas. Não editar data/exams, simulados, authoring ou schema/exam. Package, lock e workflows não precisam mudar.

## Limitações

Aliases conhecidos são exatos; novos subjects com grafia distinta recebem grupo próprio até uma decisão de catálogo explícita. Rotas de fallback são mais longas para assegurar identidade sem colisão. Links usam navegação completa e os filtros transitórios reiniciam ao abrir outra página, conforme o comportamento anterior do catálogo. Progresso conserva as limitações da leitura resumida existente. Nenhuma funcionalidade da 7B.2B foi implementada.

## Relatório de execução para auditoria

1. **Branch/worktree/base:** `codex/phase7b2a-subject-hub`, worktree isolada `/workspace/phase7b2a-subject-hub`, HEAD `98605bab75f9626899e11eb595d2574e29438d2c`. Checkout original limpa no mesmo HEAD. `main` remota confirmada idêntica pelo conector GitHub (`compare_commits`, status `identical`, ahead/behind 0), após indisponibilidade da consulta Git via proxy. Nenhuma alteração anterior reutilizada.
2. **Arquivos modificados (16):** `AGENTS.md`; `src/app/App.tsx`; `src/app/CatalogPage.tsx`; `src/app/useCatalogState.ts`; `src/components/catalog/CatalogFilters.tsx`; `src/components/exam/ExamPage.tsx`; `src/styles/components.css`; `src/utils/paths.ts`; `tests/browser/phase3.spec.ts`; `tests/browser/phase4.spec.ts`; `tests/browser/phase7a1.spec.ts`; `tests/browser/phase7a2.spec.ts`; `tests/browser/poc.spec.ts`; `tests/catalog-render.test.tsx`; `tests/phase7a2-render.test.tsx`; `tests/render.test.tsx`.
3. **Arquivos novos (6):** este documento; `src/engine/subject-groups.ts`; `src/components/catalog/SubjectCard.tsx`; `tests/subject-groups.test.ts`; `tests/subject-hub-render.test.tsx`; `tests/browser/phase7b2a.spec.ts`.
4. **Arquitetura:** `subjectGroupDefinition`, `groupCatalogExams` e `subjectHubTotals` centralizam aliases, identidade, ordem, membership e agregações do Hub. Separação entre catálogo/UI e conteúdo acadêmico.
5. **Agrupamentos finais:** sete grupos, na ordem da tabela acima. Cada ID de prova aparece exatamente uma vez; aliases acadêmicos preservados.
6. **Contagens:** Farmacologia 5/148; Fisiologia 3/63; Imunologia 3/90; Microbiologia e Virologia 4/120; Parasitologia 1/31; Patologia 1/30; Propedêutica 2/40 (simulados/questões).
7. **Fallback:** nome original, grupo próprio, identidade injetiva e estável. Colisões de slug/acento/caixa/separador/Unicode testadas; inclusão posterior não muda rotas existentes.
8. **Rota:** `?area=<id>`; global `?view=all`; Home sem seleção. Query encoding, links diretos, back/forward, reload e área inválida cobertos.
9. **Hub:** sete SubjectCards; nenhum ExamCard inicial; resumo existente de status; ação secundária global.
10. **Matéria:** breadcrumb, heading, contagens e somente os ExamCards do grupo. Retorno da prova abre sua matéria.
11. **Todos os simulados:** acesso explícito aos 19, todos os filtros, sem ocupar a Home.
12. **Filtros:** busca/ano/status/favoritos/tipo/ordenação por AND; seleção de grupo precede filtros. Disciplina somente no global. `catalog-query` intacto.
13. **Favoritos:** por simulado, repositório e storage existentes; leitura imediata e atualização/remoção refletida no filtro sem reload.
14. **Progresso:** current e conclusões existentes; ExamCard conserva nota, contagem de tentativas, respondidas e CTA. Hub agrega somente status, sem métricas novas; pageshow atualiza bfcache.
15. **Zero-write:** spies de setItem/removeItem/clear e snapshots integrais confirmam navegação sem writes ou migração, inclusive preferências v1 e dados corrompidos preservados.
16. **Network:** zero Exams completos no Hub, matéria e global; um JSON correspondente ao abrir prova. Somente catálogo resumido para agrupamento.
17. **Acessibilidade:** teclado/Enter, focus-visible, CTA real com disciplina no nome acessível, monogramas aria-hidden, breadcrumb e aria-current; novos targets ≥44×44 e hierarquia h1/h2/h3.
18. **Responsividade:** 375/390px uma coluna, 768/1024px duas, 1280px três (fonte normal). Sem overflow; fonte grande mantém cards legíveis reduzindo colunas quando necessário. Screenshots e inspeção visual realizados.
19. **Preferências:** claro/escuro, alto contraste, texto grande, densidade compacta, reduced motion e enhanced focus preservados e exercitados; tokens existentes, sem CSS por disciplina.
20. **Testes novos:** 23 unitários de agrupamento/rotas/métricas e 16 de render/App, total 39 Vitest; 13 cenários Playwright em desktop/mobile, total 26 execuções novas. Regressões antigas adaptam somente o destino/label de navegação; asserções de domínio conservadas.
21. **Total Vitest:** 756 testes aprovados em 30 arquivos. As cinco falhas iniciais de CLI provinham da restrição de subprocessos tsx no sandbox; a execução com permissão de rede passou sem alterar esses testes ou CLIs.
22. **Total Playwright:** 130 testes aprovados na execução completa (desktop/mobile), incluindo 26 novos; zero falhas.
23. **Validadores:** npm ci (118 pacotes), audit:legacy, validate, author:validate, typecheck, npm test, build e validate:dist passaram. test:browser e git diff --check também passaram. Chromium do ambiente: `/usr/bin/chromium`; execução final com dois workers.
24. **Integridade:** 19 Exams, 522 questões, 492 objetivas, 30 dissertativas; contagem independente e validate:dist confirmados.
25. **Acadêmicos intactos:** comparação byte a byte com HEAD passou nos 55 arquivos protegidos, incluindo data/exams, simulados, authoring e schema/exam, além de package/lock/workflows. Dist mantém catálogo/JSONs iguais à fonte e legado byte a byte.
26. **Package/lock/workflows:** sem alterações, dependências ou versões novas. Nenhuma imagem externa, biblioteca de ícones ou endpoint adicional.
27. **Security:** novas linhas de runtime inspecionadas; zero ocorrências de dangerouslySetInnerHTML, innerHTML, eval, new Function, XMLHttpRequest, WebSocket, fetch, storage.clear/localStorage.clear ou URLs externas. Sem telemetria. Os testes apenas interceptam storage para provar a ausência de writes.
28. **Diff:** `git diff --check` limpo; formatting dos arquivos novos/centrais conferido. git diff --stat: 16 arquivos rastreados, 271 inserções e 73 remoções; os seis novos arquivos permanecem untracked e não entram nesse stat.
29. **Git:** 16 modificados e seis untracked, todos unstaged; índice vazio e HEAD inalterado. Sem stage, commit, push, PR, merge ou deploy no repositório. Worktree original permaneceu limpa.
30. **Limitações:** aliases exatos, rotas futuras mais longas e filtros transitórios sem persistência. Fase 7B.2B excluída. Dogfood no Chromium: Farmacologia 2025, retorno à matéria, Propedêutica/Clínica Médica 2024, global/filtros, mobile/tablet/desktop e claro/escuro sem erros; sem uso de dispositivos físicos.

Classificação: **APROVADO PARA AUDITORIA**.

Estado final de `git status --short`:

```text
 M AGENTS.md
 M src/app/App.tsx
 M src/app/CatalogPage.tsx
 M src/app/useCatalogState.ts
 M src/components/catalog/CatalogFilters.tsx
 M src/components/exam/ExamPage.tsx
 M src/styles/components.css
 M src/utils/paths.ts
 M tests/browser/phase3.spec.ts
 M tests/browser/phase4.spec.ts
 M tests/browser/phase7a1.spec.ts
 M tests/browser/phase7a2.spec.ts
 M tests/browser/poc.spec.ts
 M tests/catalog-render.test.tsx
 M tests/phase7a2-render.test.tsx
 M tests/render.test.tsx
?? docs/PHASE7B2A_SUBJECT_HUB.md
?? src/components/catalog/SubjectCard.tsx
?? src/engine/subject-groups.ts
?? tests/browser/phase7b2a.spec.ts
?? tests/subject-groups.test.ts
?? tests/subject-hub-render.test.tsx
```

Índice vazio (`git diff --cached --name-only`); nenhuma operação de versionamento/publicação realizada.

## Auditoria final pré-commit — 2026-10-05

Esta seção registra uma nova leitura integral do diff contra
`98605bab75f9626899e11eb595d2574e29438d2c` e dos seis arquivos novos. O relatório
de implementação acima é histórico. Auditoria na branch
`codex/phase7b2a-subject-hub`, worktree `/workspace/phase7b2a-subject-hub`, com HEAD
inalterado e índice vazio.

### Findings

Nenhum finding HIGH ou MEDIUM. Um finding LOW, corrigido:

- **Arquivo:** `src/app/CatalogPage.tsx`, cabeçalho de `ExamCatalog`.
- **Causa:** o React recalculava quantidade de provas/questões, duplicando a
  agregação que pertence ao engine de agrupamento.
- **Impacto:** duas autoridades para a mesma métrica de apresentação poderiam
  divergir em futuras alterações. As contagens atuais estavam corretas.
- **Correção:** cabeçalho consome o `SubjectGroup` recebido; no global, consome
  `subjectHubTotals(groupCatalogExams(...))`, memoizado. Nenhum comportamento de
  domínio ou persistência alterado. Asserções existentes de contagens da matéria
  e do global verificam o resultado.

Sem funcionalidades novas ou refactor cosmético. Os testes existentes da fase
foram ampliados para provar os casos pedidos; nenhum caso de teste foi removido.

### Evidências de arquitetura e dados

- Execução programática do engine: cobertura **19/19**, 19 IDs únicos, nenhuma
  prova sem grupo, **522 questões**. Contagens por matéria: Farmacologia 5/148;
  Fisiologia 3/63; Imunologia 3/90; Microbiologia e Virologia 4/120; Parasitologia
  1/31; Patologia 1/30; Propedêutica 2/40.
- Os quatro aliases obrigatórios resolvem exclusivamente para Farmacologia,
  Propedêutica, Microbiologia e Virologia e Patologia, respectivamente; testes de
  render provam ausência de cards independentes para esses aliases.
- Fallback exercita explicitamente `Clínica Médica`/`Clinica Medica`, `A/B`/`A B`
  e `Área X`/`Area X`, além de caixa, outros separadores, nomes reservados e emoji.
  Cada subject distinto tem grupo e rota próprios. Catálogo invertido e prova
  isolada mantêm IDs; Playwright repete reload com entrada invertida e abre cada
  rota futura. O sufixo por code points preserva a identidade original.
- Imutabilidade: catálogo clonado e congelado recursivamente, incluindo arrays e
  tags; summaries de progresso congelados; serializações do catálogo original,
  clone e entradas do mapa de progresso permanecem idênticas depois do agrupamento.
- Aliases, nomes, ordem, monogramas, IDs, membership e agregações permanecem
  exclusivamente em `src/engine/subject-groups.ts`. React apenas consome os grupos.

### Precedência de rotas e navegação

Precedência explícita: **exam válido → review/dashboard/settings → area → view=all
→ Hub**. A presença de `area`, inclusive vazia, representa seleção explícita;
área inválida mostra erro, sem escolher outra matéria.

| Query | Resultado |
| --- | --- |
| `?area=farmacologia` | Farmacologia |
| `?view=all` | Todos os simulados |
| `?exam=<id válido>` | Prova |
| `?view=dashboard` | Dashboard |
| `?view=review` | Revisão |
| `?view=settings` | Configurações |
| `?view=dashboard&area=farmacologia` | Dashboard |
| `?view=review&area=farmacologia` | Revisão |
| `?view=settings&area=farmacologia` | Configurações |
| `?view=all&area=farmacologia` | Farmacologia |
| `?exam=<id válido>&area=farmacologia` | Prova |
| `?exam=<id válido>&view=dashboard&area=farmacologia` | Prova |
| `?area=inexistente` | Matéria não encontrada, com link real para Matérias |

Testes explícitos verificam as combinações. Uma checagem adicional no navegador
abriu cinco URLs ambíguas (Dashboard, Review, Settings, Todos+area e Exam+area),
confirmando heading correto e localStorage vazio/inalterado em todas.
Links nativos preservam back/forward.
Playwright verifica Hub → Farmacologia → back, Hub → Todos → back/forward, URLs
diretas e reload de matéria/global. Breadcrumb nomeado contém link Matérias e
`aria-current=page`; existe um único h1. Hub monta sete SubjectCards e zero
ExamCards no DOM.

### Storage, network, filtros, favoritos e progresso

- Snapshot de **todas as chaves e valores raw** de localStorage, com spies de
  `setItem`/`removeItem`/`clear`: Hub, matéria, back, global, filtros locais, limpar,
  reload da matéria e área inválida preservam bytes e não chamam writes. Inclui
  current legado, history/review corrompidos e preferências v1. Sem migração.
- Network instrumentado: **0/0/0/1** requests de `generated/exams/*.json` em
  Hub/Farmacologia/Todos/abrir prova. O único request final corresponde à prova
  aberta. Sem prefetch, endpoint externo ou request adicional de agrupamento.
- Favorito existente aparece na matéria; remover/adicionar persiste e reflete em
  Todos e na volta à matéria. Favorito de Fisiologia permanece intacto. Só ações
  explícitas de favorito escrevem CatalogPreferences.
- Fixtures incluem Prova e Estudo em andamento/concluídos, mais prova não
  iniciada: Farmacologia agrega **2 concluídos / 2 em andamento / 1 não iniciado**.
  ExamCards mantêm respondidas, últimas notas, tentativas e links Continuar.
  Nenhuma nota/média/percentual de matéria é calculado.
- Seleção de grupo precede filtros/ordenação. Teste com tag coincidente em todas
  as matérias continua mostrando exclusivamente os cinco de Farmacologia.
  Busca, ano, status, favoritos, tipo e ordenação combinam por AND; limpar restaura
  o catálogo da matéria. Disciplina ausente na matéria e presente no global.
- Global mantém 19 provas com filtros limpos e comportamento anterior. Trocar
  Farmacologia → Todos (com filtro de Fisiologia) → Propedêutica → Farmacologia
  restaura filtros previsíveis, sem disciplina oculta ou vazamento. Filtros são
  transitórios; não persistem entre páginas/reloads. Back via bfcache pode restaurar
  o estado transitório daquela própria página, sem gravar preferências.

### Acessibilidade e inspeção visual

CTAs são âncoras reais com nome completo; nenhum card simula link por onClick.
Monogramas são decorativos (`aria-hidden`), hierarquia h1/h2/h3 preservada,
breadcrumb e navegação principal identificam contexto. Tab/Enter, focus-visible
e targets mínimos 44×44 verificados. Todos os estilos novos usam tokens existentes.

Inspeção visual dos cinco viewports **375/390/768/1024/1280**, Hub e matéria,
incluindo Microbiologia e Virologia, métricas, CTAs, breadcrumb e filtros:
sem overflow horizontal ou recorte. Grid normal: **1/1/2/2/3 colunas**.
Playwright exercita claro/escuro, texto grande, alto contraste, densidades compacta
e confortável, foco reforçado e movimento reduzido. Uma verificação adicional de
20 combinações (cinco larguras × dois temas × dois contrastes) mediu contraste
mínimo **5,94:1** para títulos, métricas, progresso e CTA dos SubjectCards, com
zero overflow no Hub e na matéria. Screenshots locais foram inspecionadas.
Checagem adicional com zoom CSS de 200% em 768/1280px, Hub, Microbiologia e
Virologia e Todos, confirmou reflow sem overflow (seis combinações).

### Integridade, segurança e regressões

- **49 arquivos acadêmicos protegidos byte-idênticos** à base: `data/exams/**`,
  `simulados/**`, `authoring/**`, `schema/exam.ts`. Contagem independente:
  **19 Exams / 522 questões / 492 objetivas / 30 dissertativas**.
- Package, lock, workflows, schemas/repos de Attempt/History/Review/Backup,
  UiPreferences e CatalogPreferences intactos. Nenhuma versão, chave ou migração
  nova; nenhuma dependência, imagem externa ou biblioteca de ícones.
- Linhas novas/modificadas de runtime sem `dangerouslySetInnerHTML`, `innerHTML`,
  `eval`, `new Function`, XMLHttpRequest, WebSocket, fetch ou limpeza global de
  storage. Loaders internos existentes permanecem iguais. Sem endpoint externo,
  telemetria ou segredo novo.
- Chooser Prova/Estudo, confirmação/feedback/finish guard de Study, Review Hub e
  filtros, flags pós-conclusão, backup v1/v2, Dashboard e Configurações preservados
  por inspeção do diff e suíte completa. Testes da 7B.1 não foram alterados.
- Os 16 arquivos modificados têm escopo definido: AGENTS registra regra durável;
  App/CatalogPage/useCatalogState organizam navegação e resumos; CatalogFilters
  oculta apenas disciplina; ExamPage altera apenas o backlink; CSS/paths atendem
  apresentação/rotas; oito arquivos de testes existentes adaptam destino/label
  sem retirar asserções de domínio. Os seis novos são engine, SubjectCard,
  documentação e três arquivos de testes. Nenhum engine de tentativa/backup/review
  ou arquivo acadêmico mudou.

### Validações e estado final

`npm ci` passou, com 118 pacotes. `audit:legacy`, `validate`, `author:validate`,
`typecheck`, `npm test`, `build` e `validate:dist` passaram.
Vitest: **756 testes / 30 arquivos**, delta exato **+39** sobre baseline 717.
Playwright: **130 testes aprovados** em desktop/mobile, delta exato **+26** sobre
baseline 104. Suíte completa com dois workers e Chromium `/usr/bin/chromium`.
Baseline conferida em cópia temporária do commit base: build e **717 Vitest
aprovados em 28 arquivos**; listagem Playwright **104 testes em seis arquivos**.
As primeiras execuções exploratórias da cópia tiveram pré-requisitos ausentes
(repositório Git/gerados) e timeouts sob carga concorrente; a execução final em
cópia Git com build passou sem alterar testes da base. Isso não afetou a execução
dos 756 testes da worktree auditada, que passou integralmente.
As ampliações da auditoria mantêm os mesmos 23 unitários + 16 render e 13 cenários
de navegador em dois projetos. Não adicionam casos à contagem.

Git: **16 modificados + 6 novos untracked**, todos unstaged. `git diff --stat`
dos rastreados: **274 inserções / 73 remoções**; novos untracked não entram nesse
stat. A lista de `git status --short` continua a mesma do relatório de execução.
Índice vazio; HEAD/base inalterado. `git diff --check` limpo. Sem stage, commit,
push, PR, merge ou deploy.

Limitações: validação em Chromium desktop/mobile emulado, sem dispositivos
físicos ou outros engines de navegador; aliases exatos e rotas futuras longas;
filtros transitórios, com restauração nativa de bfcache quando disponível. Nenhuma
funcionalidade da 7B.2B incluída.

Classificação de auditoria: **APROVADO PARA COMMIT**. Não versionar nesta rodada.
