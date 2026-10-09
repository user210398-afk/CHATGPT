# MedFactory — plano técnico do primeiro MVP

**Estado:** proposta de arquitetura e critérios de aceitação em 09/10/2026; **nenhum MVP implementado, integrado ou publicado** por este documento.
**Produto de origem:** [MedSim](../README.md). **Contrato acadêmico obrigatório:** [Fase 6C](AUTHORING_FAST_PATH.md), [6A](CONTENT_AUTHORING.md), [6B](AI_GENERATION.md) e [AGENTS.md](../AGENTS.md).
**Objetivo:** simplificar a preparação e a pré-revisão de questões médicas a partir de material de aula sem reduzir as garantias de proveniência, integridade ou aprovação humana do MedSim.

## 1. Delimitação do MVP

Um pequeno aplicativo **independente** do runtime de provas do MedSim, preferencialmente estático e local-first, para organizar quatro tarefas:

1. **Definir fonte e prova:** selecionar arquivo local, informar ID/assunto/título/divisão/ano quando disponível, quantidade e distribuição de dificuldades. Mostrar limites e requisitos, sem inferir dados acadêmicos inexistentes.
2. **Preparar geração assistida:** produzir pacote de instruções/contrato exportável para trabalhar com ChatGPT/Codex, usando o formato intermediário estrito já definido na Fase 6B. Não disparar API automaticamente.
3. **Inspecionar draft:** importar resultado intermediário, apresentar enunciados, alternativas, justificativas, respostas-modelo, temas, warnings de insuficiência e vínculos com source anchors para pré-revisão assistida.
4. **Exportar para pipeline oficial:** entregar os artefatos necessários para continuar a validação/importação **local** pela CLI 6C. Review inicialmente draft; sem aprovação automática.

**Configuração acadêmica padrão deste projeto quando aplicável:** 15 questões objetivas de cinco alternativas e 5 dissertativas, com resposta-modelo e critérios de correção. É um **preset editável** dentro dos limites da CLI (`objective+essay` entre 1 e 60; 4 ou 5 alternativas para objetiva), não uma regra universal para toda solicitação.

A geração tem **uma única correta por questão objetiva**, distratores plausíveis, explicações, fonte/proveniência e revisão de ambiguidades. As dissertativas seguem os contratos e padrões vigentes, não recebem pontuação objetiva automática.

## 2. Não objetivos explícitos

- Não substituir `src/engine/`, `data/exams/`, schemas oficiais, histórico ou armazenamentos do MedSim.
- Não criar questões em produção diretamente a partir de interface, IA ou JSON importado.
- Não executar `author:flow approve`, `promote`, commits, PRs, merge ou Pages automaticamente.
- Não armazenar documentos originais em Git, enviar PDFs sem consentimento ou prometer confidencialidade sem base técnica.
- Não usar a conta pessoal ChatGPT/Codex/Gemini como se fosse credencial de API. **Sem API, a geração por modelo não é totalmente automática no navegador**: exige ação explícita no ChatGPT/Codex e importação do resultado.
- Não adicionar backend, login, nuvem, banco remoto, serviço pago, OCR, bibliotecas de conversão ou dependências por antecipação.
- Não desenvolver o MedCards dentro deste aplicativo. A integração futura é por contrato versionado, não por compartilhamento de tentativas ou storage.

## 3. Contratos reais do MedSim a reutilizar

`docs/AUTHORING_FAST_PATH.md` define uma CLI Node existente:

```text
arquivo de aula -> author:flow init
  -> .authoring-work/<id>/request.json + authoring/exports/<id>/...
  -> criação assistida de result.json (export)
  -> author:flow import (recalcula SHA-256 do arquivo original)
  -> candidate + review draft + generation record
  -> pré-revisão acadêmica e apresentação ao usuário
  -> aprovação humana explícita
  -> author:flow approve --confirm APROVAR
  -> author:flow promote --confirm PROMOVER
  -> validações + Draft PR -> merge autorizado -> Pages manual
```

**Observação importante:** a interface estática não consegue invocar comandos Node no computador do usuário ou escrever arquivos no checkout do GitHub por si só. É necessário projetar um **adaptador de exportação/importação** separado (futuro trabalho) que mantenha compatibilidade com os arquivos de `init/import`, em vez de fingir que uma tela é equivalente ao fast path validado.

Contratos que não devem ser reinventados:

| Domínio | Fonte de verdade | Uso no MedFactory |
| --- | --- | --- |
| Exam, ID, revision, RichText, questão | `schema/exam.ts` + validador semântico | Visualizar/validar draft; sem reescrever contrato |
| Geração e output intermediário | `schema/generation.ts`, `scripts/authoring/generation-*.ts` | Conferir estrutura e mapear com ferramentas oficiais |
| Candidate e review | `schema/authoring.ts` | `draft` até aprovação humana; sem alterar review `approved` |
| Proveniência | source basename + SHA-256 real + source anchors | Associar arquivo original ao output; não inventar hash ou páginas |
| F01 | `scripts/authoring/approval-binding.ts` | Conteúdo alterado após aprovação invalida a aprovação; exceções históricas são fixas |
| Pipeline/Content Gate | `scripts/authoring/workflow.ts` e `gate.ts` | Única via para import/approve/promote; checks não são substituídos por UI |
| Site e dados acadêmicos | `data/exams/`, `src/engine/` | **Somente leitura**; no MVP não modificar |

O arquivo local aceito pelo `init` é PDF/DOCX/PPTX/TXT/MD, regular, não vazio, até 50 MiB. A CLI não extrai texto/OCR do arquivo; seu hash de proveniência é recalculado em `init` e `import`. Um futuro hashing no navegador deve ser conferido novamente pela CLI, não substituir a verificação oficial.

## 4. Fluxo de interface proposto

### Tela A — Preparar

- Escolher arquivo **local**, indicar nome, extensão e tamanho. Exibir alertas de privacidade e limites; sem upload automático.
- Formulário pequeno de metadados: ID sugerido editável, disciplina, título, divisão, ano informado ou `null`, idioma, foco/exclusões, 15/5 como preset, cinco alternativas e dificuldade 20/60/20 (configurável).
- Checagens sintáticas sem tentar atribuir conteúdo não extraído à fonte. Gerar configuração de trabalho e instruções compatíveis com 6B/6C.
- **Fonte fora de Git**; não salvar caminho absoluto em artefatos nem texto bruto no armazenamento persistente do navegador.

### Tela B — Gerar (assistido, offline-first)

- Mostrar prompt versionado e JSON Schema do export do repositório para uso pelo ChatGPT/Codex; não manter cópia divergente da especificação em dois projetos sem teste de compatibilidade.
- Usuário executa a geração assistida **explicitamente** fora do navegador e traz o output JSON. Marcar insuficiência se a fonte não sustentar a quantidade de questões.
- Checar versão/schema/limites e erros legíveis. Não interpretar texto da aula como comando. Ausência de fonte/anchors deve aparecer como falha, não ser preenchida automaticamente.
- Futuro provider remoto apenas em fase separada, com consentimento, custo/privacidade definidos e segredos fora do frontend público.

### Tela C — Revisar

- Exibir cada questão e seus elementos objetivos/dissertativos, rationale de alternativas e source anchors.
- Checklist de revisão **assistida**: fonte, gabarito, explicação, duplicidade e extrapolações; indicar inconsistências. Não atestar automaticamente nenhuma dessas dimensões.
- Se a edição posterior for implementada, invalidar aprovações anteriores, versionar revision e manter generation record original (diferenças devem ser justificadas; nunca reescrever registro histórico para ocultar mudanças).
- Exportar draft para execução validada pela CLI; **aprovação final permanece humana e externa ao MVP**.

### Tela D — Estado do trabalho

Distinguir sem ambiguidades: `not-started`, `awaiting-generation-result`, `awaiting-human-review`, `ready-to-promote`, `promoted`. Esses são estados descritos pela CLI 6C e **somente resultados reais de `author:flow status` podem ser anunciados como status oficial**; a interface pode exibir um estado preliminar local claramente rotulado.

## 5. Arquitetura, segurança e custo

**Escolha inicial:** frontend estático desacoplado do MedSim, sem credenciais, sem chamadas de rede obrigatórias, sem mutação no repositório. Compartilhar contratos **versionados** por pacote/exportação/validação auditável, e decidir repo/domínio/URL em fase específica, sem converter MedSim em monorepo agora.

Divisões recomendadas do desenho:

- **UI:** componentes de formulário, apresentação do output e checklist; sem lógica acadêmica de correção.
- **Adapters:** ler arquivo via File API com consentimento, preparar arquivos de exportação, importar JSON sem executar scripts do output, conferir limites/versões.
- **Contracts/validation:** derivados dos schemas oficiais. Mudanças de contrato exigem teste bidirecional com a CLI; não copiar validadores por conveniência sem sincronização demonstrada.
- **CLI oficial do MedSim (fora do frontend):** `author:flow`, `author:validate`, `author:gate`, aprovação e promoção, sempre sob os controles existentes.
- **Persistência local:** inicialmente pode ser somente estado em memória + download explícito. Se existir salvamento de rascunho futuro, definir namespace, versão, export/backup próprio e limites/corrupção antes de implementar.

**Atenções:** prompt injection em PDF/prompt; vazamento de fonte ao colar em serviço externo; erros de arquivo; sobrescrita de ID; source anchors incorretos; conteúdo gerado com aparência de autoridade indevida; confusão entre draft e approved; exposição indevida de segredos em frontend estático.

## 6. Etapas propostas de implementação (ainda não autorizadas)

| Marco | Entrega | Critério de aceite |
| --- | --- | --- |
| MF-0 | Revisão deste plano e definição de local/repo para o MVP | Escopo acordado, nenhum arquivo acadêmico alterado |
| MF-1 | Protótipo estático das telas Preparar e Gerar | Metadados validados, exportação explícita, sem API/rede |
| MF-2 | Adapter testado de pacote/export para os contratos 6C | `init/import` oficial aceita fixtures neutras; SHA-256 recalculado na CLI |
| MF-3 | Visualização e pré-revisão do draft | Itens/racionales/anchors exibidos, insuficiência e invalidade legíveis |
| MF-4 | Testes de integridade e UX, documentação e Draft PR | Fluxo end-to-end com fixtures neutras, sem autoaprovação/promoção/GitHub writes |
| MF-5 | Teste assistido com nova fonte real após autorização acadêmica | Revisão humana e promoção **somente pelo processo oficial**, em tarefa separada |

**Validações mínimas por escopo:** lint/typecheck, testes unitários e de contratos, build, acessibilidade básica, testes de import inválido, corrupção/sobrescrita, proteção de arquivos/segredos; integração com `author:flow` mock/export e Content Gate read-only em caso de arquivos do MedSim. Executar no CI isolado, não burlar testes históricos. Nunca presumir sucesso antes do GitHub confirmar.

## 7. Relação com a auditoria

- F01, F02 e F03: **integradas e com CI da main aprovado**, em 09/10/2026; ainda não publicadas no Pages no momento deste planejamento.
- F04: `main` **sem branch protection/rulesets**. Antes de qualquer ideia de escritor GitHub no MedFactory, configurar e testar as proteções com autorização específica. O MVP proposto não escreve no GitHub.
- F05–F07 são tarefas independentes do legado/README, não fazem parte do escopo funcional do MVP.

## 8. Decisões pendentes antes do código

1. Repositório/URL definitivos do MedFactory separado do runtime MedSim.
2. Qual é o formato **exato** de intercâmbio gerado pela interface e aceito pela CLI; provar com fixture antes de construir fluxo completo.
3. Se haverá edição textual no MVP inicial ou apenas revisão/preview e nova importação do resultado.
4. Como apresentar ao usuário os passos externos necessários à geração com ChatGPT/Codex sem prometer automação em background nem crédito gratuito de API.

Nenhuma dessas decisões permite modificar o MedSim em produção sem PR, verificações e autorização de merge/deploy.
