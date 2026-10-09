# MedSim — continuidade operacional

**Verificado em:** 09/10/2026, após merges #33–#35, #37 e #38, CI verde do commit `25469ff`, publicação manual Pages do mesmo commit, confirmação visual dos ícones do legado pelo usuário e encerramento da issue #36. A proteção F04 segue ativa.
**Fonte de verdade:** GitHub `main`, PRs, checks, `AGENTS.md` e documentos técnicos atuais; este resumo pode ficar desatualizado.
**Repositório:** https://github.com/user210398-afk/CHATGPT
**Site:** https://user210398-afk.github.io/CHATGPT/

> Este documento apresenta o **estado verificado**, não uma autorização de merge, deploy, geração ou promoção acadêmica. Ele foi introduzido porque não existia `MEDSIM_CONTINUIDADE.md` na raiz do repositório no commit-base. O relatório de auditoria de 09/10/2026 permanece referência histórica, mas suas classificações F01–F03 como pendentes foram superadas pelos merges abaixo.

## Estado atual verificado

| Item | Estado / evidência |
| --- | --- |
| `main` | `25469ffe97b8ab0dca3fcfbc843979ba0c55d7eb` (PR #38, fechamento documental anterior à publicação) |
| CI da `main` | [run 37979447962](https://github.com/user210398-afk/CHATGPT/actions/runs/37979447962) — **success**, SHA `25469ff` após #38; o CI da F05 antes disso também passou ([run 37976792139](https://github.com/user210398-afk/CHATGPT/actions/runs/37976792139)). |
| PRs abertos | **Nenhum** na conferência imediatamente anterior à criação deste PR documental de encerramento; conferir novamente ao retomar. |
| Branch protection de `main` | **F04 configurada**: `protected: true`, ruleset [medsim-main-protection](https://github.com/user210398-afk/CHATGPT/rules/24804795), `active`, target default branch, sem bypass, PR obrigatório, `validate` obrigatório (GitHub Actions), bloqueios de exclusão e force-push, somente merge commit |
| Último GitHub Pages manual confirmado | [run 37983028312](https://github.com/user210398-afk/CHATGPT/actions/runs/37983028312) — **success**, commit `25469ffe97b8ab0dca3fcfbc843979ba0c55d7eb`; jobs **build** e **deploy** aprovados |
| Publicação de F01–F07 | **Auditoria encerrada**: F01–F03 já estavam publicadas no commit `8357808`; F05–F07 estão no Pages `25469ff`; F04 é uma proteção de `main` ativa no GitHub. A confirmação visual do legado foi **reportada pelo usuário**, sem inspeção independente pelo agente. |
| Conteúdo canônico de provas | **21 JSONs** em `data/exams/`, listagem confirmada na `main` |
| Total acadêmico registrado na auditoria | 21 provas / 562 questões (522 objetivas, 40 dissertativas); nenhuma correção F01–F03 alterou `data/exams/` |
| PWA | Instalabilidade online confirmada pelo usuário no Android (Chrome e Samsung Internet); validação em Safari/iPhone físico pendente; provas offline não são suportadas |

### Correções integradas

| Achado | PR | Merge na main | Verificação |
| --- | --- | --- | --- |
| **F01 — vínculo da aprovação** | [#28](https://github.com/user210398-afk/CHATGPT/pull/28) | `f67a281aa598bf2c254bbcdb8d2bbcc994d0fdbc` | [CI `main` 37953981328](https://github.com/user210398-afk/CHATGPT/actions/runs/37953981328), success |
| **F02 — leitura de histórico v3 com `mode`** | [#29](https://github.com/user210398-afk/CHATGPT/pull/29) | `155a03ebb64f96410b4373c3f4612466b2c04ac1` | [CI `main` 37957493292](https://github.com/user210398-afk/CHATGPT/actions/runs/37957493292), success |
| **F03 — rollback de backup legado** | [#30](https://github.com/user210398-afk/CHATGPT/pull/30) | `c7dd665d7ff95161c9dd2d96d21b1b79ccfc09eb` | [CI `main` 37960907349](https://github.com/user210398-afk/CHATGPT/actions/runs/37960907349), success |
| **F05 — ícones locais no legado** | [#37](https://github.com/user210398-afk/CHATGPT/pull/37) | `989b2e0c4e6e2c2fb883db1c784a0ad140e2e5b4` | [CI `main` 37976792139](https://github.com/user210398-afk/CHATGPT/actions/runs/37976792139), success; Pages `25469ff` |
| **F06 — independência do teste de spans** | [#34](https://github.com/user210398-afk/CHATGPT/pull/34) | `9d3fb1109c33a869405d754be99bf5955bfd1122` | [CI `main` 37972469918](https://github.com/user210398-afk/CHATGPT/actions/runs/37972469918), success, após F07 |
| **F07 — README e fast path 6C** | [#35](https://github.com/user210398-afk/CHATGPT/pull/35) | `1612dd977353d7df4112cfd07dc3c735fda90366` | [CI `main` 37972469918](https://github.com/user210398-afk/CHATGPT/actions/runs/37972469918), success |

- **F01:** novos reviews aprovados vinculam `approval.candidateSha256` ao JSON canônico via SHA-256; qualquer alteração posterior ao conteúdo invalida o vínculo até nova aprovação humana. Quatro conjuntos já aprovados antes dessa regra possuem **evidências históricas explicitamente fixadas** em `scripts/authoring/approval-binding.ts`; não são exceção aberta para novos IDs. Um hash de integridade **não** autentica quem aprovou.
- **F02:** `src/engine/catalog-progress.ts` exige `mode` por entrada de history v3 e mantém leitura v2 sem migração/escrita. Testes de regressão adicionados; proteções de escopo histórico preservadas com exceção exclusiva ao arquivo autorizado.
- **F03:** `backup-medsim.js` verifica todas as chaves/valores MedSim do snapshot após rollback. Falha ou divergência **não** produz mensagem enganosa de dados preservados. Casos de erro persistem no aviso. Testes de integração do script legado foram incluídos; guardas da Fase 3/PWA/Fase 4 preservam os demais arquivos.
- **F05:** o `index.html` legado usa SVGs Phosphor declarativos incorporados, originados de commit fixo do projeto upstream; nenhum script CDN de ícones é executado. Licença e origem em [ícones legados](docs/LEGACY_PHOSPHOR_ICONS.md). Testes verificam estrutura e ausência de script remoto; **após o deploy Pages `25469ff`, o usuário confirmou que os ícones estão corretos**. Essa confirmação é uma observação do usuário, não teste visual independente do agente.

A aprovação pelo CI valida as verificações executadas, mas **não equivale a um teste manual da publicação** ou a garantia de perfeição acadêmica.

## Arquitetura e controles que permanecem válidos

- Aplicação React + TypeScript + Vite + Zod, compilada estaticamente; GitHub Pages com base `/CHATGPT/` e rotas por query string, sem rewrites. Legado preservado.
- `data/exams/` é canônico; `schema/` determina contratos; `src/engine/` determina comportamento; `src/styles/` determina design system; `authoring/` é **fora do runtime**.
- Baseline imutável das 17 provas migradas (485 questões); as quatro provas subsequentes são conteúdo acadêmico aprovado e também não podem ser editadas silenciosamente.
- Tentativas/históricos oficiais, sessões de revisão, annotations, favoritos, preferências e backups são domínios separados. Não migrar, substituir ou limpar chaves dos usuários sem autorização e transação defensiva.
- Questões novas requerem **fonte primária**, proveniência real com SHA-256, generation record, source anchors, candidata em draft, revisão humana completa e aprovação explícita. Não inventar gabaritos, fontes, anchors ou certificação acadêmica.
- Reutilizar [Fast path da Fase 6C](docs/AUTHORING_FAST_PATH.md): `author:flow init` → geração/export offline → `import` → pré-revisão → **aprovação humana** → `approve` → `promote` → testes → PR. Nenhuma etapa automática faz merge/deploy.
- Preferência editorial atual: **15 objetivas e 5 dissertativas**, cinco alternativas por objetiva, quando esta é a configuração solicitada para novas provas. Para dissertativas, observar o modelo e os critérios existentes.
- Sem chamada live de IA/API durante desenvolvimento ou CI, sem custos adicionais ou segredos novos sem necessidade e autorização.

## Encerramento da auditoria F01–F07

| Achado | Situação / ação proposta |
| --- | --- |
| **F04** | **Concluída e verificada remotamente**: [ruleset #24804795](https://github.com/user210398-afk/CHATGPT/rules/24804795) ativo e `protected: true`. PR obrigatório com 0 aprovações GitHub (não dispensa revisão acadêmica), check `validate`, sem bypass, sem force-push ou exclusão, somente merge commit. [Issue #32](https://github.com/user210398-afk/CHATGPT/issues/32). Antes de automatizar escrita pelo MedFactory, avaliar permissões e controles do próprio app. |
| **F05** | **Concluída e publicada**: [PR #37](https://github.com/user210398-afk/CHATGPT/pull/37), merge `989b2e0`, 37 ícones em SVG e nenhum script remoto Phosphor. CI/Content Gate aprovados; [Pages #37983028312](https://github.com/user210398-afk/CHATGPT/actions/runs/37983028312), SHA `25469ff`, success. **Usuário confirmou visualmente o legado**; [issue #36](https://github.com/user210398-afk/CHATGPT/issues/36) **closed/completed**. |
| **F06** | **Integrada**: [PR #34](https://github.com/user210398-afk/CHATGPT/pull/34), merge `9d3fb1109c33a869405d754be99bf5955bfd1122`; CI final de `main` após #35 aprovado em `1612dd9`. |
| **F07** | **Integrada**: [PR #35](https://github.com/user210398-afk/CHATGPT/pull/35), merge `1612dd977353d7df4112cfd07dc3c735fda90366`; CI da `main` success ([run 37972469918](https://github.com/user210398-afk/CHATGPT/actions/runs/37972469918)). |

**Critério de encerramento:** integração na `main` confirmada, checks pertinentes aprovados, deploy Pages `25469ff` concluído e verificação visual dos ícones confirmada pelo usuário. **A auditoria F01–F07 não é uma certificação geral de ausência de defeitos nem substitui revisão acadêmica ou testes manuais abrangentes.**

## MedSuite: decisão operacional para os próximos MVPs

O plano de evolução é estudar **MedFactory** (preparação e revisão de questões) e, posteriormente, **MedCards** (flashcards). Iniciar com **produtos independentes**, contratos de exportação/importação versionados e integração apenas quando comprovadamente necessária. Não reconstruir o MedSim nem migrá-lo para monorepo por antecipação.

- **MedFactory MVP:** fluxo **local/offline-first** de configuração da fonte, preparação de geração assistida, revisão e exportação de drafts; aproveitamento estrito dos validadores e do fast path 6C. **Não** aprova por IA, não altera dados oficiais, não promove nem publica no navegador.
- **MedCards MVP:** flashcards revisados, armazenamento, histórico e backup próprios; não reutilizar Attempts/ReviewSessions como eventos de repetição espaçada.
- **Não existe autorização de implementação, merge, deploy ou automação GitHub a partir deste planejamento.**
- Detalhes, milestones, critérios de aceitação e limites do primeiro MVP: [Plano do MedFactory](docs/MEDFACTORY_MVP_PLAN.md).

## Próximas etapas e liberações

1. **Deploy consolidado F05–F07 concluído e confirmado**: Pages [run 37983028312](https://github.com/user210398-afk/CHATGPT/actions/runs/37983028312), SHA `25469ff`, jobs build/deploy success. As F01–F03 já estavam publicadas; F04 segue protegendo `main`. Próximos deploys exigem autorização específica via [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) e `PUBLICAR`. Confirmação visual do legado pelo usuário foi registrada; verificações manuais de armazenamento, import/export, rotas e PWA permanecem independentes quando aplicáveis.
2. Atualizar/conciliar o documento de continuidade sempre após fase/merge/deploy; não declarar um PR documental como parte da `main` até o merge efetivo.
3. **F04 concluída.** Preservar ruleset ativo e verificar o requisito `validate` em PR de teste. Antes de incorporar escrita automatizada no GitHub, avaliar as permissões do app e os controles adicionais; nenhuma automação pode contornar revisão e aprovação.
4. Decidir o escopo de implementação do MedFactory após revisar [seu plano](docs/MEDFACTORY_MVP_PLAN.md); iniciar isoladamente e com testes neutros, sem conteúdo acadêmico real ou nova dependência sem necessidade.
5. **Auditoria F01–F07 encerrada**: CI da `main` e Pages no SHA `25469ff` aprovados; usuário confirmou a visualização correta dos ícones e a [issue #36](https://github.com/user210398-afk/CHATGPT/issues/36) foi fechada como `completed`. Não inferir garantia acadêmica nem auditoria visual independente; manter as proteções vigentes. MedFactory/MedCards seguem **planejados, não implementados**; novo escopo requer decisão própria.

### Procedimento de trabalho

1. Verificar `main`, PRs, CI/Content Gate, Pages e `AGENTS.md` a cada operação.
2. Branch separada a partir do SHA confirmado; mudanças mínimas; nunca push direto na `main`, force-push ou desativar testes para aprovar PR.
3. Rodar, conforme escopo, `npm run audit:legacy`, `npm run audit:security`, `npm run validate`, `npm run typecheck`, `npm test`, `npm run build`, `npm run validate:dist`, `npm run test:browser`, gate de authoring e Content Gate.
4. Abrir Draft PR, revisar diff e resultados. **Ready for review / merge somente com autorização específica. Deploy requer autorização específica distinta.**
5. Reportar distintamente: implementação, commit, PR, CI, merge, Pages e validação manual.
