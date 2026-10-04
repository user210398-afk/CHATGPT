# Regras da plataforma MedSim

1. Nunca criar HTML específico para uma prova.
2. Nunca colocar questões diretamente em componentes.
3. Toda prova deve ser definida por dados estruturados em `data/exams/`.
4. Não criar CSS específico por disciplina.
5. Alterações visuais devem ocorrer no Design System compartilhado em `src/styles/`.
6. Alterações de comportamento devem ocorrer no Exam Engine em `src/engine/`.
7. JSONs devem ser validados antes do build (`npm run validate`; o build também valida).
8. Preservar compatibilidade com GitHub Pages `/CHATGPT/`, sem rewrites, usando query string.
9. Nunca alterar gabaritos silenciosamente. Registrar fonte, discrepância e decisão explicitamente.
10. Preservar separação entre conteúdo, comportamento e apresentação.
11. Não executar HTML/JS vindo de dados; usar o documento estruturado e renderer permitido.
12. IDs são estáveis; conteúdo alterado exige incremento de `revision`. Não reutilizar chaves legadas de storage.
13. O código legado na raiz e em `simulados/` está preservado para comparação. Não removê-lo nesta fase.
14. O schema Zod é a fonte de verdade; exportar JSON Schema com `npm run generate`. Refinamentos semânticos requerem o validador TypeScript.
15. Antes de concluir mudanças, executar `npm run typecheck`, `npm test` e `npm run build`; para interface, os testes de navegador pertinentes.
16. Fase 2 migra somente a POC. Não ampliar migração, CI/CD ou QA final sem solicitação.
