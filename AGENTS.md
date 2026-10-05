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
16. Histórico: Fases 2/3 concluíram a migração; Fase 4 preparou CI/QA/Pages. O sistema já está em produção. Na Fase 6A, os 17 migrados são baseline individual congelado (485 questões / 462 objetivas / 23 dissertativas / 2.187 alternativas / 3 grupos); futuras adições aprovadas podem ampliar o catálogo sem alterar o baseline.
17. Novas provas nascem como candidates em `authoring/candidates/`, no mesmo Schema v1, com review separado em `authoring/reviews/`. Authoring nunca entra no runtime, catálogo ou dist.
18. Novas provas exigem provenance externa por basename e SHA-256 real da fonte. Não inventar sourceCommit. Os commits de proveniência legados continuam válidos.
19. Aprovação acadêmica é humana: IA nunca aprova seu próprio conteúdo. Approved exige checklist completo e revisor identificado.
20. Promoção exige comando local explícito e `--confirm PROMOVER`; suporta somente adição. Revisão/substituição de prova existente não é autorizada na 6A.
21. Nenhuma geração automática faz merge ou deploy. Promoção não faz git/PR/deploy. Manter Content Gate read-only e deploy manual separado.
22. A Fase 6A não chama IA/API, não adiciona serviço/segredo/dependência e não altera UI, engine, conteúdo acadêmico existente ou Pages. Ver `docs/CONTENT_AUTHORING.md`.
23. Fase 6B: IA gera candidate, nunca aprovação. Toda prova assistida exige revisão humana de fonte, gabaritos, explicações e respostas-modelo. JSON Schema válido não equivale à correção acadêmica; source anchors auxiliam auditoria, sem garantia factual.
24. Preservar a fonte acadêmica e rastrear a geração ao SHA-256 local. Não inventar conteúdo sem suporte, doses, valores ou diretrizes. Conhecimento externo exige permissão explícita na configuração e registro transparente.
25. `author:generate` usa export offline por padrão; mock é neutro/determinístico. OpenAI é opcional, exclusivamente OPENAI_API_KEY por ambiente, `--confirm ENVIAR`, store:false, sem tools/web search, zero retry e timeout. Não executar chamada live durante engenharia/testes nem em CI.
26. Reutilizar schema/validação/gate da 6A. Artefatos 6B usam `exam-generation-v1` e exigem generation record íntegro. Nenhuma geração promove, altera data/exams, engine/UI, abre PR de conteúdo, faz merge ou deploy. Não persistir source bruto, Base64, reasoning, resposta HTTP, caminhos absolutos ou segredos. Ver `docs/AI_GENERATION.md`.
27. Fase 6C: quando o usuário fornecer um novo arquivo de aula e pedir uma prova/questões, usar o fast path de `docs/AUTHORING_FAST_PATH.md`. Automatizar infraestrutura repetitiva com `author:flow`, preservando pré-revisão acadêmica assistida, aprovação humana explícita, promoção confirmada, Content Gate read-only, merge humano e deploy manual. A CLI usa somente export/import offline, sem API/rede ou leitura de OPENAI_API_KEY; não decide a aprovação acadêmica.
28. “Aprovo” é autorização para registrar aprovação e prosseguir até Draft PR, nunca autorização automática para merge/deploy. Usar reviewedBy="ChatGPT" quando não houver outro identificador fornecido, somente após declaração explícita do usuário. Antes disso, parar no resumo aguardando aprovação. Mudanças posteriores exigem revision incrementada e nova revisão/aprovação; preservar o generation record original.
29. Scratch `.authoring-work/` e `authoring/exports/` são locais/ignorados e ficam fora de commits de conteúdo. Após aprovação explícita, o commit de conteúdo contém somente candidate, review, generation record e production do novo ID. Geração nunca aprova, promove, modifica data/exams ou executa git/PR/merge/deploy. Preservar todos os JSONs acadêmicos existentes, os 17 históricos congelados e a prova posterior de anti-hipertensivos; não sobrescrever destinos ou untracked.
30. Fase 7A.2: dashboard usa resumos read-only do catálogo; Exams completos só entram ao abrir prova ou sob ação explícita de backup. Importação exige schema estrito, validação acadêmica de current, preview sem writes, confirmação, merge não destrutivo e rollback/concurrency; nunca aceitar chaves arbitrárias ou sobrescrever corrupção. Preservar a leitura read-only de history v2 ao lado de current v1 ou sem current. Ver `docs/PHASE7A2_DASHBOARD_BACKUP_SETTINGS.md`.
31. UI preferences usam `chatgpt-exams:v1:ui-preferences`; leitura não migra nem altera `chatgpt-exams:preferences:v1`. Preferências são globais por tokens/atributos. Manter foco de teclado com `:focus-visible` e respeitar movimento reduzido do sistema; correção de clique/tap nunca remove indiscriminadamente o foco.
32. Tentativas novas persistem current/history v3, com modo imutável exam/study; schemas v1/v2 e backup v1 permanecem congelados. Study confirma respostas por ação de domínio e bloqueia edição/finalização com drafts. calculateResult continua sendo a única autoridade acadêmica.
33. Review detalhado usa chave interna :review, schema estrito e retenção cronológica de 20. A revisão só permite alterar flagged; respostas, resultado, modo, confirmação e datas são imutáveis. Flags do current concluído e archive usam comparação raw, transação defensiva e rollback; falha nunca simula sucesso. Leitura, filtros e navegação não escrevem. Ver docs/PHASE7B1_REVIEW_STUDY_MODES.md.
34. UI preferences v2 acrescentam attemptModePreference (ask/exam/study). Leitura de v1 normaliza apenas em memória. Com ask e sem current restaurável, abrir prova não cria nem grava tentativa; a escolha explícita precede o início. Preferência global só afeta novas tentativas.
35. Agrupamento de matérias é metadado de apresentação/catálogo centralizado em `src/engine/subject-groups.ts`; nunca reescrever `Exam.subject` acadêmico. Subjects desconhecidos devem manter grupo próprio e rota determinística, sem ocultar provas. Hub e páginas de matéria usam apenas resumos, com leitura de progresso sem writes.
