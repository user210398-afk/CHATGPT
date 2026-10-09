# MedSim — Exam Engine

Aplicação estática React + TypeScript + Vite + Zod com **21 provas JSON e 562
questões: 522 objetivas e 40 dissertativas** (inventário auditado em 09/10/2026).
As **17 provas históricas** (485 questões) permanecem protegidas por baseline
individual; quatro provas foram acrescentadas posteriormente com revisão e
proveniência. Produção:
https://user210398-afk.github.io/CHATGPT/.

O site oferece catálogo, dashboard, configurações, modos prova/estudo,
revisão detalhada, sessões de revisão e ferramentas de resolução. Tentativas,
históricos e backups são locais ao navegador; dissertativas não recebem nota
automática. Para decisões atuais, consultar [continuidade](MEDSIM_CONTINUIDADE.md).

A criação de provas novas usa o authoring das Fases 6A–6C: exportação offline,
mock determinístico e OpenAI opcional apenas com consentimento literal `ENVIAR`.
IA produz candidate com review draft, **nunca** aprovação acadêmica automática.
Veja [geração assistida](docs/AI_GENERATION.md) e o
[fast path da Fase 6C](docs/AUTHORING_FAST_PATH.md).

## Instalar e desenvolver

Use **Node 24.19.0** e npm, como nos workflows e na validação local. O manifesto
declara >=22.12.0, mas o jsdom do lockfile exige ^22.22.2 ou ^24.15.0 ou >=26;
Node 22.12.0 sozinho não satisfaz as dependências transitivas. O lockfile existente
permanece intacto, sem atualização de bibliotecas.

```sh
npm ci
npm run dev
```

Abrir `http://localhost:5173/CHATGPT/`. O catálogo é gerado antes de iniciar.
Após adicionar ou alterar dados durante o desenvolvimento, reiniciar o servidor.

## Validar, testar e gerar o artefato

```sh
npm run audit:legacy
npm run validate
npm run typecheck
npm test
npm run build
npm run validate:dist
npx --no-install playwright install --with-deps chromium
npm run test:browser
npm run preview
```

O Playwright instalado pelo lockfile baixa seu Chromium e instala dependências
no runner Linux. O CI usa esse procedimento oficial; não depende de um browser
pré-instalado. Para o ambiente Cloud com Chromium disponível:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

O preview abre `http://localhost:4173/CHATGPT/`; a prova usa
`/CHATGPT/?exam=<id>`. Os testes de browser exigem build anterior e iniciam o
preview automaticamente. Cobrem as provas do catálogo, desktop/mobile, temas, restauração,
finalização, revisão e acessibilidade básica. O acervo histórico de 17 provas
continua protegido por verificações de paridade.

`npm run build` valida dados, gera catálogo/JSON Schema, verifica TypeScript e
produz **dist/**, o único artefato preparado para GitHub Pages.
`npm run validate:dist` confere os invariantes, metadados/JSONs, assets e a cópia
integral do legado. O refresh pela query string funciona sem rewrites.

## Arquitetura e futuras provas

`data/exams/` é a fonte acadêmica canônica; `schema/` define Schema v1; `src/engine/`
concentra regras e persistência atual v3, com leitura compatível de formatos
históricos conforme os documentos técnicos. Componentes e estilos são compartilhados.
O catálogo é gerado no build e o loader busca apenas JSONs da mesma origem.
Não há backend, credencial ou API do GitHub em runtime.

Novas provas começam em `authoring/candidates/`, usam o próprio Schema v1,
exigem SHA-256 real da fonte, source anchors, generation record e revisão humana
em `authoring/reviews/`. A aprovação de novos candidates é vinculada ao
conteúdo por SHA-256 canônico (F01); a promoção local exige `approved` válido
e confirmação literal `PROMOVER`. O catálogo pode crescer sem alterar as
17 provas migradas nem as quatro já adicionadas.

## Content authoring

Veja [CONTENT_AUTHORING.md](docs/CONTENT_AUTHORING.md) para hash local,
`author:validate`, `author:gate`, `author:promote`, checklist humano, templates,
Content Gate read-only e baseline. O fluxo recomendado é
`author:flow init → import → revisão humana → approve → promote`, com
aprovação e promoção **explícitas**, verificações e Draft PR antes de qualquer
merge. Geração não aprova, não publica e não usa automaticamente API paga.

Tentativas são locais ao navegador, e dados legados não são importados
automaticamente. Backup atual v3 conserva compatibilidade de leitura
documentada com formatos anteriores. Ver
[backup e configurações](docs/PHASE7A2_DASHBOARD_BACKUP_SETTINGS.md) e
[modos/revisão](docs/PHASE7B1_REVIEW_STUDY_MODES.md).

## Legado e deploy

O hub `index.html` da raiz, `simulados.json`, os 17 HTMLs, scripts históricos
(com correção pontual de segurança F03 no backup legado) e ferramentas de
migração/paridade permanecem preservados. O build os copia para
`/CHATGPT/legacy/`, acessível pelo link “Acervo legado”. A homepage nova é
`dist/index.html`; o acervo é independente do runtime novo e permite comparação
e rollback. Limpeza do legado depende de autorização futura.

- `.github/workflows/ci.yml`: PRs para `refactor/json-exam-engine`/`main` e pushes
  em `main`, `refactor/json-exam-engine`, `codex/**`; somente `contents: read`.
- `.github/workflows/deploy-pages.yml`: somente `workflow_dispatch`, com guarda
  de repositório, branch **main** e confirmação **PUBLICAR**. Upload de `dist/` e
  deploy pelas actions oficiais. Sem deploy em push/PR; sem ativação externa
  automática de Pages. Permissões de publicação apenas no job de deploy.
- `.github/workflows/atualizar-index.yml`: deprecated, manual e inerte (`if: false`),
  sem permissão de escrita. A lógica histórica continua disponível.

A produção está em `https://user210398-afk.github.io/CHATGPT/`, com Vite
`base: '/CHATGPT/'`. O deploy manual autorizado de 09/10/2026 concluiu com
sucesso para o commit `8357808`
([GitHub Actions #37965453809](https://github.com/user210398-afk/CHATGPT/actions/runs/37965453809)).
A branch `main` está protegida pelo ruleset `medsim-main-protection` (F04):
exige Pull Request e check `validate` aprovado; permite somente merge commit,
sem deploy automático. Novas publicações exigem autorização específica.
O procedimento histórico de cutover/rollback consta na
[Fase 4](docs/PHASE4_RELEASE_READINESS.md).

## Histórico e decisões

- [Arquitetura atual e decisões da Fase 2](docs/ARCHITECTURE.md)
- [Migração e paridade da POC](docs/POC_MIGRATION.md)
- [Validação histórica da Fase 2](docs/PHASE2_VALIDATION.md)
- [Migração das 17 provas — Fase 3](docs/PHASE3_MIGRATION.md)
- [Release readiness e plano histórico de cutover — Fase 4](docs/PHASE4_RELEASE_READINESS.md)
- [Regras para agentes](AGENTS.md)
- [Geração assistida de candidates — Fase 6B](docs/AI_GENERATION.md)
- [Auditoria original](docs/LEGACY_AUDIT.md)
- [Inventário original](docs/EXAM_INVENTORY.md)
- [Continuidade operacional](MEDSIM_CONTINUIDADE.md)
- [Fast path de authoring — Fase 6C](docs/AUTHORING_FAST_PATH.md)
- [Review, modos prova/estudo — Fase 7B.1](docs/PHASE7B1_REVIEW_STUDY_MODES.md)
- [Ferramentas de resolução — Fase 8A](docs/PHASE8A_ACTIVE_SOLVING_TOOLS.md)
- [Planejamento do MedFactory MVP](docs/MEDFACTORY_MVP_PLAN.md)
