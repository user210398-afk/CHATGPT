# MedSim — Exam Engine

Aplicação estática React + TypeScript + Vite + Zod com **17 provas JSON e 485
questões: 462 objetivas e 23 dissertativas**. A Fase 3 concluiu a migração e a
paridade acadêmica. A Fase 4 prepara CI, QA e deployment seguro; o cutover de
produção depende de aprovação em fase posterior.

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
preview automaticamente. Cobrem as 17 provas, desktop/mobile, dois temas,
restauração, finalização, revisão e acessibilidade básica.

`npm run build` valida dados, gera catálogo/JSON Schema, verifica TypeScript e
produz **dist/**, o único artefato preparado para GitHub Pages.
`npm run validate:dist` confere os invariantes, metadados/JSONs, assets e a cópia
integral do legado. O refresh pela query string funciona sem rewrites.

## Arquitetura e futuras provas

`data/exams/` é a fonte acadêmica canônica; `schema/` define Schema v1; `src/engine/`
concentra regras e persistência v2; componentes e estilos são compartilhados.
O catálogo é gerado no build e o loader busca apenas JSONs da mesma origem.
Não há backend, credencial ou API do GitHub em runtime.

Para adicionar uma prova futuramente:

1. Criar `data/exams/<id>.json` com Schema v1, ID estável, `revision`, proveniência,
   metadados explícitos e questões ordenadas. Não inferir ano ou alterar gabaritos
   silenciosamente. Imagens locais ficam em `public/media/`, com alt.
2. Executar `npm run validate` e testes/paridade apropriados; registrar fonte e
   decisões acadêmicas. Alterações de conteúdo exigem política de revisão.
3. Gerar build e catálogo automaticamente, sem editar homepage ou índice gerado.
   Revisar os invariantes de release somente com autorização para mudar o acervo;
   a Fase 4 bloqueia totais diferentes de 17/485/462/23.

Tentativas são locais ao navegador. Dissertativas não recebem nota automática.
O estado legado não é importado automaticamente; suas chaves permanecem intactas.

## Legado e deploy

O hub `index.html` da raiz, `simulados.json`, os 17 HTMLs, scripts históricos e
ferramentas de migração/paridade permanecem preservados. O build os copia para
`/CHATGPT/legacy/`, acessível pelo link “Acervo legado”. A homepage nova é
`dist/index.html`; o acervo é independente do runtime novo e permite comparação
e rollback. Limpeza será decidida depois da publicação e validação real.

- `.github/workflows/ci.yml`: PRs para `refactor/json-exam-engine`/`main` e pushes
  em `main`, `refactor/json-exam-engine`, `codex/**`; somente `contents: read`.
- `.github/workflows/deploy-pages.yml`: somente `workflow_dispatch`, com guarda
  de repositório, branch **main** e confirmação **PUBLICAR**. Upload de `dist/` e
  deploy pelas actions oficiais. Sem deploy em push/PR; sem ativação externa
  automática de Pages. Permissões de publicação apenas no job de deploy.
- `.github/workflows/atualizar-index.yml`: deprecated, manual e inerte (`if: false`),
  sem permissão de escrita. A lógica histórica continua disponível.

O destino futuro continua `https://user210398-afk.github.io/CHATGPT/`, com Vite
`base: '/CHATGPT/'`. Nenhuma configuração externa ou site de produção é alterado
nesta fase. O procedimento de aprovação, configuração de Pages/environment,
cutover e rollback está em [Fase 4](docs/PHASE4_RELEASE_READINESS.md).

## Histórico e decisões

- [Arquitetura atual e decisões da Fase 2](docs/ARCHITECTURE.md)
- [Migração e paridade da POC](docs/POC_MIGRATION.md)
- [Validação histórica da Fase 2](docs/PHASE2_VALIDATION.md)
- [Migração das 17 provas — Fase 3](docs/PHASE3_MIGRATION.md)
- [Release readiness, QA e cutover futuro — Fase 4](docs/PHASE4_RELEASE_READINESS.md)
- [Regras para agentes](AGENTS.md)
- [Auditoria original](docs/LEGACY_AUDIT.md)
- [Inventário original](docs/EXAM_INVENTORY.md)
