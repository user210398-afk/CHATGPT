# Fase 4 — Release readiness, CI/CD e Pages preparado

Data: 04/10/2026. Repositório exclusivo: `user210398-afk/CHATGPT`.
Branch: `codex/phase4-release-readiness-ci-pages`.
Destino do PR Draft: `refactor/json-exam-engine`; sem merge em main.

## Base confirmada antes de editar

- Branch remota: `refactor/json-exam-engine`.
- Commit: `b31295406ee800f0bb113282da7edfc27bfa511b` (merge do PR #3).
- Tree: `f39bb4f7c346057d15ae3c1feb8fa9bd29d14776`.
- Main observado: `31e1ce2f093932720d587535f675a34e8b1ad6fc`.

O checkout inicial era `work`, antigo e sem a Fase 3. Primeiro foi executado
fetch; como o clone tinha refspec limitado a main, buscou-se explicitamente
`refs/heads/refactor/json-exam-engine:refs/remotes/origin/refactor/json-exam-engine`.
O fetch usou permissão adicional de rede do Cloud, necessária para o proxy.
A referência também foi conferida pelo conector GitHub autenticado. `rev-parse`
confirmou commit/tree antes do switch para a nova branch. Não se implementou
sobre a cópia antiga, main ou diretamente na branch base.

Lidos integralmente: AGENTS, README, arquitetura, validação Fase 2, migração
Fase 3, workflow legado, package.json, Vite, Playwright e scripts de catálogo/build.

## Escopo e invariantes

Release engineering, QA e documentação. Sem alteração acadêmica, schema, engine,
persistência, bibliotecas ou migração de dados. A mudança compartilhada de
acessibilidade torna o destino do skip link explicitamente focável (`tabIndex=-1`).
A homepage explicita “17 provas disponíveis”. Um favicon local evita o 404
observado ao ampliar a captura de erros de console.

| Invariante                                |  Resultado |
| ----------------------------------------- | ---------: |
| Provas JSON / HTMLs legados               |    17 / 17 |
| Questões                                  |        485 |
| Objetivas / dissertativas                 |   462 / 23 |
| Alternativas / grupos-casos               |  2.187 / 3 |
| Provas objetivas / mistas / dissertativas | 14 / 2 / 1 |

`tests/phase4-preservation.test.ts` bloqueia mudanças em todos os JSONs, schema,
engine, lockfile e fontes/scripts históricos desde a base Fase 4. A proteção
anterior da Fase 3 continua para fontes/POC; a pasta de workflows foi retirada
apenas dessa comparação de imutabilidade porque sua alteração é o escopo autorizado.
Os testes acadêmicos de paridade continuam integralmente.

## Workflows e permissões

Todas as actions usadas são oficiais do namespace `actions/`. Nenhum secret foi
adicionado; não há scripts externos no pipeline. Checkout usa histórico completo
para comparações Git e `persist-credentials: false`. Instalação é `npm ci`, com
cache npm baseado em `package-lock.json`, no diretório raiz do repositório.

Os dois workflows usam **Node 24.19.0**, igual à versão local validada. O mínimo

> =22.12 do manifesto não basta para todo o lockfile: jsdom 30 exige ^22.22.2,
> ^24.15.0 ou >=26. Esta escolha resolve compatibilidade sem atualizar bibliotecas
> nem modificar package-lock.json. npm local: 11.9.0.

| Workflow/job       | Trigger/guarda                                         | Permissões                    |
| ------------------ | ------------------------------------------------------ | ----------------------------- |
| CI / validate      | PR para main/refactor e push em main/refactor/codex/** | contents: read                |
| Pages / build      | dispatch, repositório correto, main e PUBLICAR         | contents: read; pages: read   |
| Pages / deploy     | mesmas guardas, depende de build aprovado              | pages: write; id-token: write |
| Legado / organizar | dispatch, job sempre false                             | contents: read                |

### CI ativo

`.github/workflows/ci.yml` executa:

```text
npm ci
npm run audit:legacy
npm run validate
npm run typecheck
npm test
npm run build
npm run validate:dist
npx --no-install playwright install --with-deps chromium
npm run test:browser
```

Usa actions/checkout@v4 e actions/setup-node@v4, runner ubuntu-latest, timeout
20 minutos, concorrência por workflow/ref com cancelamento de execução superada.
Não há contents write, Pages write, id-token ou secrets no CI. `pull_request`
(não pull_request_target) evita executar código de PR com privilégios elevados.
Sem filtro de paths: documentação/workflows também recebem checks.

O Chromium no GitHub é instalado pelo Playwright do lockfile com dependências
oficiais; nenhum caminho `/usr/bin/chromium` é definido no CI.

### Pages preparado, sem publicação nesta fase

`.github/workflows/deploy-pages.yml` tem **somente workflow_dispatch**. O input
`confirmation` começa em `NAO`; só `PUBLICAR`, em `refs/heads/main`, no repositório
correto, permite build/deploy. Não há push, PR ou workflow_run. Dispatch nessa
branch de desenvolvimento continua bloqueado mesmo com PUBLICAR. Para aparecer
normalmente na UI de Actions, o workflow precisa existir na branch padrão.

Build repete todos os checks do CI. Depois usa actions/configure-pages@v5 com
`enablement: false`, actions/upload-pages-artifact@v3 com **dist/** e
actions/deploy-pages@v4 no job separado, environment `github-pages` com URL
retornada pelo deploy. A configuração existente é lida, não ativada pelo código.
O job de deploy recebe OIDC/Pages write somente após o build e a aprovação do
environment, quando essa proteção externa for configurada.
Concorrência `pages-production`, sem cancelar publicação em andamento.

Destino esperado: `https://user210398-afk.github.io/CHATGPT/`.
Vite continua `base: '/CHATGPT/'`. Artefato contém a nova homepage; o legado fica
em `/CHATGPT/legacy/`. Não foi executado dispatch/deploy nesta fase.

### Aposentadoria reversível do escritor legado

`.github/workflows/atualizar-index.yml` está nomeado LEGACY DEPRECATED, com
workflow_dispatch, `if: ${{ false }}` no job e contents read. Mesmo dispatch
manual não executa Python, escrita, commit ou push. Checkout não persiste token.
A lógica original de movimentação/reindexação/commit está preservada integralmente
para histórico, mas é inacessível. Não executar nem reativar no cutover JSON.

A mudança torna-se efetiva nas branches que receberem esta entrega; a cópia
antiga em main permanece intacta nesta fase. Não houve execução dessa automação
nem commits automáticos durante a tarefa. Reverter conscientemente o arquivo
recuperaria a configuração antiga, mas isso não é parte do rollback recomendado.

## Artefato e QA executado

`npm run validate:dist` (`scripts/validate-dist.ts`) verifica programaticamente:

- dist/index.html e bundles JS/CSS do Vite existentes;
- base /CHATGPT/ e referências src/link/CSS locais existentes;
- catálogo completo, com título, disciplina, ano, divisão, revisão e contagens;
- conjunto exato dos 17 JSONs, cada payload igual ao JSON canônico validado;
- invariantes 17/485/462/23 e ausência de API GitHub ou /simulados/ no bundle novo;
- hub, simulados.json, 17 HTMLs e cinco scripts legados byte a byte com as fontes;
- recursos locais referenciados pelo acervo existentes no dist/legacy/.

Testes negativos em cópia temporária do dist confirmaram bloqueio de JSON ausente,
bundle JS ausente e script legado ausente, sem alterar o artefato validado.

Os dez testes Playwright anteriores foram preservados. A suíte agora tem 16
percursos (oito desktop e oito mobile), incluindo:

- homepage com 17 provas; clique em cada link e conferência do título correspondente;
- metadados e contagens de todos os cards e catálogo/JSONs servidos iguais às fontes;
- cada uma das 17 provas nos dois temas, refresh/restauração com ?exam=<id>;
- objetiva, duas mistas (incluindo POC), dissertativa e três casos/tabelas;
- resposta objetiva/textual, finalização, resultado persistido e revisão bloqueada;
- ausência de overflow relevante em homepage e todas as provas nos dois temas;
- ausência de pageerror, console.error, HTTP >=400 e dependência de HTML legado/API;
- requests da nova aplicação sempre sob /CHATGPT/ na mesma origem.

Acessibilidade básica: teclado real (Tab/Enter/Space), skip link com foco no main,
foco visível e foco nas transições, h1, idioma pt-BR, search label, nomes dos
radios, textarea rotulado, estado “respondida” acessível e feedback textual.
Tokens de texto/estado atingem contraste >=4,5:1; foco >=3:1 nos dois temas.
`prefers-reduced-motion` elimina transições; tabelas usam overflow contido no
mobile e permanecem legíveis. Sem redesign ou alteração de cores/conteúdo.

A captura nova de console encontrou o favicon implícito /favicon.ico ausente;
foi substituído por favicon SVG local explícito, servido em /CHATGPT/favicon.svg.
A primeira implementação do teste de contraste presumiu hex de seis caracteres;
o teste foi corrigido para usar RGB computado, compatível com minificação Vite.
Nenhum erro foi ignorado para obter aprovação.

## Resultados finais

| Comando/check                                                              | Resultado                                                                   |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| npm ci --cache /tmp/phase4-npm-cache                                       | OK, lockfile existente, sem upgrades                                        |
| npm run audit:legacy                                                       | OK: 17 / 485 / 462 / 23                                                     |
| npm run validate                                                           | OK: 17 JSONs, 485 questões                                                  |
| npm run typecheck                                                          | OK                                                                          |
| npm test                                                                   | OK: 81 testes em 12 arquivos                                                |
| npm run build                                                              | OK: artefato dist/ com base /CHATGPT/                                       |
| npm run validate:dist                                                      | OK: JSONs, assets, metadados e legado integral                              |
| PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser | OK: 16 testes                                                               |
| YAML (PyYAML BaseLoader) e actionlint 1.7.7                                | OK: sintaxe, expressões, triggers, jobs/actions                             |
| Revisão de segurança dos workflows                                         | OK: permissões, Node/cache, diretório, artefato, environment e concorrência |
| git diff --check / preservação de fontes                                   | OK                                                                          |

Servidor local/Chromium requereram a mesma permissão adicional de rede do Cloud
usada nas fases anteriores. Isso não altera a configuração do runner GitHub.
Actionlint foi usado apenas em /tmp para validação local, sem dependência adicionada.

## Limitações e configurações externas futuras

Esta evidência é local sobre build de produção e Chromium em desktop/mobile.
Não certifica outros browsers, leitores de tela nem acessibilidade completa WCAG.
A execução remota real do CI e o deploy de Pages dependem do GitHub; não se presume
sucesso de deployment sem execução aprovada. Nenhum deploy foi realizado agora.

O legado preservado continua tendo fontes/ícones externos e referências antigas
incorretas a GitHub documentadas na Fase 2. Sua preservação não promete operação
offline completa nem corrige os bugs históricos. A aplicação nova é independente.
Não houve teste funcional completo dos scripts antigos de backup/marca-texto.

Somente após aprovação explícita do cutover, o usuário/administrador deverá:

1. Em Settings > Pages > Build and deployment, selecionar Source **GitHub Actions**.
   O workflow não muda essa configuração e falhará se ela for incompatível.
2. Configurar environment **github-pages**, restringindo deployment a main e,
   quando disponível no plano do GitHub, exigindo reviewer e impedindo autoaprovação.
3. Garantir Actions habilitado e as actions oficiais permitidas no repositório.
   Opcionalmente tornar CI / validate obrigatório nas regras de merge.

Nenhuma dessas configurações externas foi alterada nesta fase. A proteção
codificada main + dispatch + PUBLICAR continua válida mesmo sem reviewer externo.

## Passos exatos para o futuro cutover (não executados)

1. Revisar/aprovar o PR Draft para refactor/json-exam-engine e confirmar CI remoto.
   Preparar posteriormente uma promoção revisada para main; só então autorizar
   merge/cutover explicitamente. Não fazer merge em main nesta Fase 4.
2. Imediatamente antes da promoção, registrar o SHA real de main e o método de
   publicação atual; guardar uma cópia do artefato/site anterior e sua execução.
   O SHA observado nesta tarefa não substitui essa captura no dia do cutover.
3. Confirmar novamente invariantes, paridade, QA e disponibilidade de /legacy/;
   manter todas as fontes, scripts de migração/paridade e chaves de storage.
4. Após a aprovação explícita, promover a aplicação/workflows a main, incluindo
   a aposentadoria do escritor legado, e fazer as configurações externas acima.
5. Actions > “Pages — cutover manual aprovado” > Run workflow > branch main >
   confirmation **PUBLICAR**. Revisar SHA/artefato e aprovar o environment.
6. Validar na URL real a homepage, 17 links, refresh, assets, persistência,
   desktop/mobile, temas e acervo; registrar SHA, run e artefato aprovado.
7. Manter legado durante a transição. Decidir limpeza somente numa fase posterior
   após validação real e prazo de rollback acordado.

## Rollback sem reconstrução acadêmica

- Antes do cutover, preservar o commit/site anterior (main observado agora:
  `31e1ce2f093932720d587535f675a34e8b1ad6fc`) e guardar o artefato publicado anterior.
  Base JSON validada: `b31295406ee800f0bb113282da7edfc27bfa511b`.
- Preferir redeploy do último artefato comprovado. O workflow preparado nesta
  fase constrói o SHA selecionado de main; não tem seletor de artefato antigo.
  Se for necessário redeploy de artefato retido, usar procedimento aprovado
  baseado nas actions oficiais, com Pages write/OIDC e revisão do environment.
  Não tentar executar dispatch de um SHA antigo burlando a guarda de main.
- Alternativamente reverter, por PR revisado, a promoção problemática em main e
  publicar novamente o estado estável pelo método correspondente. Se voltar ao
  site legado da raiz, restaurar conscientemente o método externo de publicação
  anterior; manter o escritor automático legado inativo.
- Durante diagnóstico, orientar acesso temporário a `/CHATGPT/legacy/`; a cópia
  completa dos 17 HTMLs, hub, catálogo e scripts já está no artefato novo.
- Nenhum desses caminhos precisa reconstruir questões. Não apagar fontes nem
  importar/excluir storage legado. A nova persistência e a antiga permanecem
  separadas. Rollback e qualquer mudança externa exigem aprovação posterior.

## Documentação e entrega

README e arquitetura refletem as 17 provas e políticas de CI/Pages/legado.
AGENTS distingue a restrição histórica da POC do escopo autorizado da Fase 4.
PHASE2_VALIDATION ganhou aviso histórico, preservando resultados e decisões.
PHASE3_MIGRATION e os documentos originais de auditoria/inventário foram mantidos.

Commits separados para CI, Pages, aposentadoria legada, correção de Node,
QA/artefato/acessibilidade e documentação. A publicação deve preservar a tree
local validada. PR em Draft para refactor/json-exam-engine, sem merge.
Main e configurações externas de Pages intactas; site de produção não alterado;
cutover não iniciado; nenhuma limpeza destrutiva do legado.
