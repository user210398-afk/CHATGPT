# MedSim — continuidade operacional

**Verificado em:** 09/10/2026, após os merges das correções F01, F02 e F03.
**Fonte de verdade:** GitHub `main`, PRs, checks, `AGENTS.md` e documentos técnicos atuais; este resumo pode ficar desatualizado.
**Repositório:** https://github.com/user210398-afk/CHATGPT
**Site:** https://user210398-afk.github.io/CHATGPT/

> Este documento apresenta o **estado verificado**, não uma autorização de merge, deploy, geração ou promoção acadêmica. Ele foi introduzido porque não existia `MEDSIM_CONTINUIDADE.md` na raiz do repositório no commit-base. O relatório de auditoria de 09/10/2026 permanece referência histórica, mas suas classificações F01–F03 como pendentes foram superadas pelos merges abaixo.

## Estado atual verificado

| Item | Estado / evidência |
| --- | --- |
| `main` | `c7dd665d7ff95161c9dd2d96d21b1b79ccfc09eb` |
| CI após PR #30 | [run 37960907349](https://github.com/user210398-afk/CHATGPT/actions/runs/37960907349) — **success**, mesmo SHA |
| PRs abertos | **Nenhum**, na consulta de 09/10/2026 |
| Branch protection de `main` | `protected: false`; regras de repositório (`rulesets`) vazias na mesma consulta — **F04 pendente** |
| Último GitHub Pages manual localizado | [run 37934933508](https://github.com/user210398-afk/CHATGPT/actions/runs/37934933508) — **success**, commit `be05aa18155751bc675d78beb617bd17c6ff612f` (PR #27) |
| Publicação das F01–F03 | **NÃO executada**; `main` e Pages estão em commits diferentes |
| Conteúdo canônico de provas | **21 JSONs** em `data/exams/`, listagem confirmada na `main` |
| Total acadêmico registrado na auditoria | 21 provas / 562 questões (522 objetivas, 40 dissertativas); nenhuma correção F01–F03 alterou `data/exams/` |
| PWA | Instalabilidade online confirmada pelo usuário no Android (Chrome e Samsung Internet); validação em Safari/iPhone físico pendente; provas offline não são suportadas |

### Correções integradas

| Achado | PR | Merge na main | Verificação |
| --- | --- | --- | --- |
| **F01 — vínculo da aprovação** | [#28](https://github.com/user210398-afk/CHATGPT/pull/28) | `f67a281aa598bf2c254bbcdb8d2bbcc994d0fdbc` | [CI `main` 37953981328](https://github.com/user210398-afk/CHATGPT/actions/runs/37953981328), success |
| **F02 — leitura de histórico v3 com `mode`** | [#29](https://github.com/user210398-afk/CHATGPT/pull/29) | `155a03ebb64f96410b4373c3f4612466b2c04ac1` | [CI `main` 37957493292](https://github.com/user210398-afk/CHATGPT/actions/runs/37957493292), success |
| **F03 — rollback de backup legado** | [#30](https://github.com/user210398-afk/CHATGPT/pull/30) | `c7dd665d7ff95161c9dd2d96d21b1b79ccfc09eb` | [CI `main` 37960907349](https://github.com/user210398-afk/CHATGPT/actions/runs/37960907349), success |

- **F01:** novos reviews aprovados vinculam `approval.candidateSha256` ao JSON canônico via SHA-256; qualquer alteração posterior ao conteúdo invalida o vínculo até nova aprovação humana. Quatro conjuntos já aprovados antes dessa regra possuem **evidências históricas explicitamente fixadas** em `scripts/authoring/approval-binding.ts`; não são exceção aberta para novos IDs. Um hash de integridade **não** autentica quem aprovou.
- **F02:** `src/engine/catalog-progress.ts` exige `mode` por entrada de history v3 e mantém leitura v2 sem migração/escrita. Testes de regressão adicionados; proteções de escopo histórico preservadas com exceção exclusiva ao arquivo autorizado.
- **F03:** `backup-medsim.js` verifica todas as chaves/valores MedSim do snapshot após rollback. Falha ou divergência **não** produz mensagem enganosa de dados preservados. Casos de erro persistem no aviso. Testes de integração do script legado foram incluídos; guardas da Fase 3/PWA/Fase 4 preservam os demais arquivos.

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

## Pendências da auditoria

| Achado | Situação / ação proposta |
| --- | --- |
| **F04** | **Pendente**: proteção de `main` ausente. Priorizar antes de permitir ao futuro MedFactory qualquer fluxo que grave diretamente no GitHub. Configurar com cuidado para manter PRs e CI funcionando; requer autorização. |
| **F05** | **Pendente**: CDN de ícones no legado `index.html` sem versionamento/SRI. Manter como correção isolada. |
| **F06** | **Pendente**: teste de limpeza de spans depende de catálogo gerado no uso isolado. Investigar em PR específico. |
| **F07** | **Pendente**: `README.md` descreve 17 provas e contratos antigos. Atualizar em PR documental separado, com evidência do estado real. |

## MedSuite: decisão operacional para os próximos MVPs

O plano de evolução é estudar **MedFactory** (preparação e revisão de questões) e, posteriormente, **MedCards** (flashcards). Iniciar com **produtos independentes**, contratos de exportação/importação versionados e integração apenas quando comprovadamente necessária. Não reconstruir o MedSim nem migrá-lo para monorepo por antecipação.

- **MedFactory MVP:** fluxo **local/offline-first** de configuração da fonte, preparação de geração assistida, revisão e exportação de drafts; aproveitamento estrito dos validadores e do fast path 6C. **Não** aprova por IA, não altera dados oficiais, não promove nem publica no navegador.
- **MedCards MVP:** flashcards revisados, armazenamento, histórico e backup próprios; não reutilizar Attempts/ReviewSessions como eventos de repetição espaçada.
- **Não existe autorização de implementação, merge, deploy ou automação GitHub a partir deste planejamento.**
- Detalhes, milestones, critérios de aceitação e limites do primeiro MVP: [Plano do MedFactory](docs/MEDFACTORY_MVP_PLAN.md).

## Próximas etapas e liberações

1. **Publicar as correções F01–F03 somente após autorização específica de deploy.** Workflow [`deploy-pages.yml`](.github/workflows/deploy-pages.yml) é manual (`workflow_dispatch`), somente na `main`, confirmação literal `PUBLICAR`. Verificar build/deploy e commit publicado; validação manual no site segue separada.
2. Atualizar/conciliar o documento de continuidade sempre após fase/merge/deploy; não declarar um PR documental como parte da `main` até o merge efetivo.
3. Tratar F04 antes de incorporar escrita automatizada no GitHub. Nenhuma automação pode contornar controles de aprovação.
4. Decidir o escopo de implementação do MedFactory após revisar [seu plano](docs/MEDFACTORY_MVP_PLAN.md); iniciar isoladamente e com testes neutros, sem conteúdo acadêmico real ou nova dependência sem necessidade.
5. F05–F07 continuam em backlog; não são automaticamente incluídos nos PRs de MedFactory.

### Procedimento de trabalho

1. Verificar `main`, PRs, CI/Content Gate, Pages e `AGENTS.md` a cada operação.
2. Branch separada a partir do SHA confirmado; mudanças mínimas; nunca push direto na `main`, force-push ou desativar testes para aprovar PR.
3. Rodar, conforme escopo, `npm run audit:legacy`, `npm run audit:security`, `npm run validate`, `npm run typecheck`, `npm test`, `npm run build`, `npm run validate:dist`, `npm run test:browser`, gate de authoring e Content Gate.
4. Abrir Draft PR, revisar diff e resultados. **Ready for review / merge somente com autorização específica. Deploy requer autorização específica distinta.**
5. Reportar distintamente: implementação, commit, PR, CI, merge, Pages e validação manual.
