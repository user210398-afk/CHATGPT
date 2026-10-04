# MedSim — Exam Engine

Fase 2: arquitetura estática compartilhada e uma POC real de Fisiologia com
30 questões (20 objetivas + 10 dissertativas). As outras 16 provas continuam no
acervo legado. Base: `refactor/json-exam-engine`.

## Executar

Requer Node >=22.12 e npm. Dependências reproduzíveis em `package-lock.json`.

```sh
npm ci
npm run dev
```

Abrir `http://localhost:5173/CHATGPT/`. O catálogo é gerado antes de iniciar.
Após adicionar/alterar dados durante o desenvolvimento, reiniciar `npm run dev`.

## Validar e demonstrar o build

```sh
npm run audit:legacy
npm run validate
npm test
npm run build
npm run preview
```

Abrir `http://localhost:4173/CHATGPT/`. A POC está em
`/CHATGPT/?exam=fisiologia-m5-aula-1-2026`; o acervo antigo em
`/CHATGPT/legacy/index.html`.

Testes fundamentais de navegador (após build):

```sh
npx playwright install chromium
npm run test:browser
```

Se o ambiente já tiver Chromium, evitar download e informar seu executável:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser
```

`npm run build` valida dados, gera índice/JSON Schema, verifica TypeScript e produz
`dist/`. O artefato futuro do GitHub Pages é **dist**, com base `/CHATGPT/`.
A publicação e o workflow final não foram implementados nesta fase. Abrir o
`index.html` da raiz continua abrindo o hub legado preservado.

## Conteúdo e arquitetura

Adicionar `<id>.json` válido em `data/exams/` basta para aparecer após build;
não editar homepage ou índice gerado. Imagens futuras ficam em `public/media/`.
Não adicionar provas além da POC nesta fase.

- [Arquitetura e decisões](docs/ARCHITECTURE.md)
- [Migração e paridade da POC](docs/POC_MIGRATION.md)
- [Validação e discrepâncias da Fase 2](docs/PHASE2_VALIDATION.md)
- [Regras para agentes](AGENTS.md)
- [Auditoria original](docs/LEGACY_AUDIT.md)
- [Inventário original](docs/EXAM_INVENTORY.md)

O legado e suas chaves de storage não são removidos ou importados automaticamente.
Tentativas novas são locais a este navegador; dissertativas não recebem nota
automática. Nenhum backend, credencial ou API do GitHub é necessário em runtime.
