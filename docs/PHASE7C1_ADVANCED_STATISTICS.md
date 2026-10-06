# Fase 7C.1 — estatísticas avançadas read-only

Base: `8dbdd359e0f7badebdbce45b64ef893a17dee6e2`.
Branch: `codex/phase7c1-advanced-statistics`.

## Objetivo

Evoluir o Dashboard sem alterar o modelo acadêmico, a persistência ou o custo de carregamento.
A fase acrescenta indicadores avançados derivados exclusivamente dos resumos oficiais já lidos no
catálogo e consolida o desempenho por matéria com a mesma autoridade de agrupamento da 7B.2A.

## Contratos

- Nenhuma nova chave de storage, schema, versão, migração ou dependência.
- Nenhum Exam completo é carregado para montar o Dashboard.
- Review Sessions continuam fora de todas as métricas oficiais.
- `Exam.subject` é acadêmico e permanece byte-intacto; aliases visuais usam somente
  `src/engine/subject-groups.ts`.
- As funções são puras e não alteram arrays, provas ou resumos recebidos.

## Indicadores

A seção **Visão avançada** mostra:

- **Cobertura prática**: percentual de provas com ao menos uma tentativa concluída ou uma tentativa
  oficial em andamento.
- **Média dos melhores**: média arredondada do melhor percentual de cada prova que possui nota
  automática.
- **Melhor matéria praticada**: maior média dos melhores entre os grupos com nota.
- **Menor média praticada**: menor média dos melhores entre os grupos com nota.

Empates preservam a ordem determinística dos grupos do Hub. Ausência de denominador ou de notas usa
`null` no engine e **—** na interface; não se inventa zero acadêmico.

## Agrupamento por matéria

O Dashboard passa a usar `aggregateSubjectGroups`, que resolve cada `Exam.subject` por
`subjectGroupDefinition`. Assim, por exemplo, Farmacologia/Farmacologia Básica e
Propedêutica/Propedêutica Clínica Médica seguem a mesma organização visual do Hub, sem tocar no JSON
acadêmico. Subjects futuros continuam recebendo o fallback injetivo e determinístico existente.

`aggregateSubjects` é preservado para compatibilidade das funções antigas e testes de semântica
acadêmica bruta; a UI usa somente os grupos de apresentação.

## Segurança e privacidade

A feature não adiciona fetch, telemetria, API, login, sincronização ou escrita automática. O
Dashboard continua local-first e read-only. Backup/reset permanecem com os contratos da 7B.2B.

## Testes

Cobrir:

- aliases consolidados sem mutação de `Exam.subject`;
- cobertura com tentativa concluída, em andamento e histórico existente;
- média global e extremos por matéria;
- catálogo vazio, ausência de notas e 0% válido;
- imutabilidade das entradas;
- render da seção nova;
- browser com zero requests de Exams completos e zero writes no Dashboard vazio.

Validação esperada: `npm run audit:legacy`, `npm run validate`, `npm run typecheck`,
`npm test`, `npm run build`, `npm run validate:dist` e `npm run test:browser`.
