# Rascunho de Pull Request

**Título:** feat: establish shared exam architecture with a real mixed-exam POC

**Base:** `refactor/json-exam-engine`

**Head local:** `codex/phase2-json-exam-engine`

## Descrição

Os simulados legados duplicam conteúdo, motor e aparência em 17 HTMLs. Esta
mudança cria uma aplicação estática Vite/TypeScript/React com schema versionado,
catálogo gerado, motor e renderers compartilhados e persistência isolada por prova.
A URL `/CHATGPT/?exam=fisiologia-m5-aula-1-2026` carrega uma prova real de Fisiologia
(20 objetivas e 10 dissertativas) diretamente de JSON, com restauração, resultado
objetivo e revisão de modelos sem correção textual de dissertativas.

O Design System unifica temas claro/escuro e layout responsivo. O conteúdo rico
vira nós estruturados permitidos. A comparação independente do DOM confirma a
preservação do conteúdo acadêmico da POC. Os 17 HTMLs originais, o hub,
`simulados.json` e scripts/workflow antigos ficam preservados; a cópia para
`dist/legacy/` permite comparação. `simulados.json` passa a ser insumo temporário
de migração, sem uso pelo runtime novo.

A entrada nova está em `app/index.html`; o artefato de publicação futuro é
`dist/`. Esta PR não publica o site, não migra as 16 provas restantes e não
implementa CI/CD, revisão/QA finais ou remoção do legado.

## Validação

- Auditoria executável: 17 provas, 485 questões; paridade entre representações.
- Schema/geração, TypeScript e build aprovados.
- 47 testes unitários/de integração/paridade e dois percursos Chromium (desktop/mobile).
- Nenhum erro de página/requisição ou dependência do HTML legado no fluxo da POC.
- Discrepâncias da auditoria, decisões e contrato da Fase 3 em
  `docs/PHASE2_VALIDATION.md` e `docs/ARCHITECTURE.md`.

## Envio

Commits preparados localmente para o fluxo da interface do Codex. Criar como
**rascunho**, direcionar para a base acima e não fazer merge. Nenhum push pelo
shell foi realizado nem credencial solicitada.
