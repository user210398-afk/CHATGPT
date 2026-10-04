# Authoring seguro — Fase 6A

O MedSim já está em produção em https://user210398-afk.github.io/CHATGPT/.
A Fase 6A prepara criação, revisão e promoção local de **novas** provas. Não
cria prova acadêmica real, não chama IA/API, não lê PDF/PPTX/DOCX, não precisa
segredos e não executa merge ou deploy. Após `npm ci`, as ferramentas funcionam
offline. Nenhuma dependência foi adicionada.

## Candidate e produção

`data/exams/<id>.json` é a única fonte acadêmica pública. Um candidate usa
exatamente o mesmo Schema v1, validado pelo mesmo `parseExam`; não existe
conversão ou contrato acadêmico paralelo. Sua revisão é um documento separado:

```text
authoring/candidates/<id>.json  → conteúdo proposto
authoring/reviews/<id>.json     → fonte, requisitos e revisão humana
authoring/templates/           → exemplos neutros fictícios, não aprovados
```

Authoring não entra no catálogo, no runtime ou no dist. Templates ficam fora dos
diretórios de candidates/reviews; nomes `*.example.json` e `*.template.json`
são explicitamente ignorados na validação em lote. IDs devem ser kebab-case,
sem paths. `--id` resolve somente `<id>.json` em candidates/reviews e nunca
busca templates. Não copie os exemplos fictícios para produção.

## Fonte e proveniência

Calcule o SHA-256 do arquivo local original:

```sh
npm run author:hash -- --file "/caminho/Aula 03.pdf"
```

A ferramenta usa streaming com `node:crypto`, mostra somente basename e hash,
não copia, não armazena e não transmite o arquivo. Coloque o **basename**, sem
caminho absoluto, em `provenance.sourceFile` e `review.source.fileName`; coloque
o hash real em `provenance.sourceSha256` e `review.source.sha256`. A ferramenta
não extrai ou interpreta o conteúdo do arquivo. Não invente um commit Git para
uma fonte externa.

Schema v1 exige pelo menos um identificador: `sourceCommit` (40 hex) ou
`sourceSha256` (64 hex); ambos são permitidos. `sourceFile` e `notes` continuam
obrigatórios. Os 17 JSONs migrados conservam seus commits e bytes. **Novas provas
via authoring exigem SHA-256 externo**, coerente com o manifest. O hash identifica
a fonte; a cobertura e correção acadêmica dependem da revisão humana.

## Review manifest

`schema/authoring.ts` define um objeto estrito com `authoringVersion: 1`:

- `examId` e `status`: `draft`, `in-review` ou `approved`.
- `source`: `fileName` (basename) e `sha256` iguais à provenance do candidate.
- `generation`: `mode` manual ou ai-assisted, e `provider`, `model`,
  `promptVersion` como string ou null. O modo manual permite metadata null.
  Aprovação ai-assisted exige os três valores; nesta fase são apenas metadata,
  sem implementação de IA.
- `requirements`: números inteiros não negativos `objectiveCount`, `essayCount`,
  e `optionsPerObjective`: 4 ou 5 quando houver objetivas; pode ser null sem
  objetivas. Cada questão deve respeitar a mesma quantidade declarada.
- `checks`: `sourceCoverageReviewed`, `answerKeyReviewed`,
  `explanationsReviewed`, `duplicateCheckReviewed`.
- `reviewedBy`: identificação humana não vazia na aprovação; `notes`: notas
  explícitas sobre a revisão e decisões acadêmicas.

Antes de marcar approved, o revisor humano deve verificar cobertura da fonte,
cada gabarito, explicações/respostas-modelo e possíveis duplicações. Todos os
checks devem estar true e reviewedBy preenchido. IA nunca aprova seu próprio
conteúdo. O gate confere a evidência declarada no manifest; não autentica a
identidade do revisor nem substitui revisão acadêmica ou revisão humana do PR.

## Validar

```sh
npm run author:validate
npm run author:validate -- --id <exam-id>
```

Sem argumentos, valida todos os pares reais, rejeita candidates sem review e
reviews órfãos; zero candidates é válido. Valida schema, IDs, referências,
gabaritos, filename, proveniência, requisitos e revisão. Imagens devem usar os
assets locais seguros de `public/media/`; existência é conferida nas validações
do catálogo e na promoção. IDs novos não podem colidir com produção. Após
promoção, o par permanece como evidência e só valida se aprovado e semanticamente
igual ao JSON de produção.

Duplicações exatas de enunciados no candidate e de alternativas na mesma questão
são erros. A comparação é determinística: texto das árvores, lowercase, remoção
de diacríticos, pontuação e normalização de whitespace; limites de blocos/br
são preservados. Pode acusar repetição intencional: diferencie os enunciados na
proposta e peça revisão humana. Não há heurística de similaridade ou IA.

## Promover e abrir PR

```sh
npm run author:promote -- --id <exam-id> --confirm PROMOVER
```

O comando exige par válido, status approved, todos os checks, reviewedBy e
confirmação literal. Confere baseline e catálogo, copia bytes para
`data/exams/<id>.json` com operação exclusiva (nunca sobrescreve), valida novamente
o catálogo/assets e baseline. Se a validação após cópia falhar, remove somente
a cópia recém-criada. Somente adições são suportadas; revisão/substituição de
prova existente não é autorizada nesta fase.

A promoção não executa git add/commit/push, não abre PR e não faz merge/deploy.
Depois, execute auditoria, validate, author:validate, typecheck, testes, build,
validate:dist e Playwright. Revise o diff. Em uma branch, faça commit dos três
arquivos (candidate, review e production) e de eventuais assets locais, faça push
e abra Draft PR para main. A revisão/merge humano e o deploy manual controlado
continuam etapas separadas. Nenhuma geração automática faz merge ou deploy.

## Content Gate e baseline

`Content Gate` roda somente em PRs para main nos paths relevantes. Tem apenas
`contents: read`, checkout com histórico completo e credenciais não persistidas,
Node 24.19.0 e nenhum job de escrita/deploy. O base SHA vem do evento de PR via
environment, sem interpolar dados do evento em código shell.

Para reproduzir localmente **após commit**:

```sh
npm run author:gate -- --base <SHA-completo-do-base-do-PR>
```

O gate compara base com HEAD (`--no-renames`): aceita somente adições em
data/exams, exige ID ausente no base, candidate e review approved, checklist e
revisor, igualdade semântica candidate/production, source/hash, counts e checagem
de duplicatas. Alterações, exclusões e renames são rejeitados, inclusive de uma
prova adicionada anteriormente. Sem alterações em data/exams, ainda confere
baseline, catálogo e pares de authoring e pode passar.

O baseline individual é derivado da POC e `phase3-inventory`, sem duplicar a lista:
17 provas, 485 questões, 462 objetivas, 23 dissertativas, 2.187 alternativas,
3 grupos/casos (14 objetivas, 2 mistas, 1 dissertativa). Cada arquivo é comparado
byte a byte ao commit `edc645c78633e28b21c4dcf5722d347f095a7f9e`.
Futuras adições não mudam o baseline. `validate-dist` compara dinamicamente
o conjunto atual de produção, catálogo, payloads e assets sob `/CHATGPT/`,
preservando os 17 HTMLs históricos byte a byte. O histórico Git dessa base deve
estar disponível; clones shallow precisam obter esse commit antes de validar.

## Erros comuns e próxima fase

Hash inválido/divergente: recalcule sobre a fonte original e confira ambos os
JSONs. Filename/examId divergente: alinhe `<id>.json` e IDs, nunca um path.
Counts/alternativas divergentes: reveja os requisitos e o candidate.
Review ausente/draft/incompleto: conclua a revisão humana antes da promoção.
ID já existente: use um ID realmente novo; não sobrescreva uma prova.
Asset ausente: adicione o arquivo local seguro em public/media antes de promover.
Baseline alterado: restaure o arquivo exatamente da base e investigue o diff.

A futura Fase 6B poderá criar candidates a partir de arquivos-fonte, mantendo
este mesmo contrato, hash, revisão humana e promoção explícita. Upload, OCR,
parsing, prompts, LLMs, provedores e serviços externos continuam fora da 6A.
