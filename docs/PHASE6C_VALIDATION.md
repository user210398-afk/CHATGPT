# Validação local da Fase 6C

Implementação em `/workspace/CHATGPT-phase6c`, branch
`codex/phase6c-authoring-fast-path`, criada de `origin/main` confirmado após
`git fetch origin` em `80da31b6f522b53fe3d26092100fc45dfbbbf947`.
O checkout anterior permaneceu na branch `work`, HEAD
`5843ad640a763c3e48accfdf4f230f7b059e3b77`, sem alterações de arquivos.
Não foram usados git clean/reset, commit, push, PR, merge ou deploy nesta worktree.

## Arquitetura

`author:flow` → `workflow-cli.ts` (argumentos, confirmações, resumo) →
`workflow.ts` (orquestração local) → funções 6A/6B existentes:

- init: generation request Zod, `readSource`, escrita scratch exclusiva/atômica e
  `generate` com provider export explícito e ambiente vazio;
- status: leitura/integridade do export compartilhada em `validateExport`,
  `loadCandidate`, `validateAll` e catálogo validado;
- import: `importGeneration` e seu mapper 6B, sem mapper paralelo;
- approve: decisão explícita, review validado, notas preservadas, lock por ID e
  snapshots byte a byte, checagens pré/pós-write e rollback atômico somente do review;
- promote: função original `promote`, baseline e COPYFILE_EXCL preservados.

`init` e `import` não aprovam ou promovem. Todos os comandos dispensam rede,
API keys e APIs externas; a geração acadêmica é feita pelo Codex durante a tarefa
conforme [AUTHORING_FAST_PATH.md](AUTHORING_FAST_PATH.md), antes da revisão humana.
Nenhum comando faz commit/push/PR/merge/deploy.

Arquivos novos:

- `scripts/authoring/workflow-cli.ts`
- `scripts/authoring/workflow.ts`
- `tests/workflow.test.ts`
- `tests/fixtures/authoring/workflow-neutral.pdf`
- `docs/AUTHORING_FAST_PATH.md`
- `docs/PHASE6C_VALIDATION.md`

Arquivos modificados: `package.json`, `.gitignore`, `AGENTS.md` e
`scripts/authoring/generation.ts` (extração da verificação read-only de export).
Nenhuma dependência adicionada; package-lock intacto.

## Resultados

Node 24.19.0; Chromium existente em `/usr/bin/chromium`.

| Verificação                                                                  | Resultado                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `npm ci --cache /tmp/phase6c-npm-cache`                                      | OK; 118 pacotes do lock existente                                  |
| `npm run audit:legacy`                                                       | OK; baseline 17 / 485 / 462 objetivas / 23 dissertativas           |
| `npm run validate`                                                           | OK; 18 provas / 497 questões; catálogo preservado                  |
| `npm run author:validate`                                                    | OK; 1 candidate preexistente, sem alterações                       |
| `npm run typecheck`                                                          | OK                                                                 |
| Suíte existente, excluindo os testes novos                                   | 197/197, 14 arquivos                                               |
| `npm test`                                                                   | 290/290, 15 arquivos; 93 testes novos (26 regressivos da correção) |
| `npm run build`                                                              | OK                                                                 |
| `npm run validate:dist`                                                      | OK; 18 / 497 / 472 objetivas / 25 dissertativas                    |
| `npm run author:gate -- --base 80da31b6f522b53fe3d26092100fc45dfbbbf947`     | OK; zero adições, baseline intacto                                 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser` | 16/16; 8 desktop e 8 mobile                                        |
| `git diff --check`                                                           | OK                                                                 |
| `pdftotext tests/fixtures/authoring/workflow-neutral.pdf -`                  | PDF válido, página neutra legível                                  |

Os testes cobrem os 23 requisitos pedidos: parâmetros/counts/defaults, fonte PDF,
paths com espaços, colisões em todas as saídas, publicação separada, estados
validados/read-only, mapper 6B, review draft, confirmações literais, preservação
byte a byte, promoção exclusiva, corrupção/órfãos, symlinks e concorrência.
Um teste interno e o teste CLI completo bloqueiam explicitamente fetch, leitura
de OPENAI_API_KEY e provider live; o teste CLI também bloqueia Socket.connect.

O sandbox sem permissão de rede bloqueou stdout assíncrono de processos Node
filhos, causando quatro falhas de captura na primeira execução da suíte existente.
Um caso mínimo de execFile confirmou a causa; as execuções finais usaram a
permissão do executor necessária para a captura, com os bloqueios de transporte
mantidos nos testes do fluxo. Não foi introduzido workaround no código do projeto.
A rede externa foi usada para o fetch e a instalação de dependências exigidos;
nenhum fluxo de authoring executou chamada de rede/IA live. Playwright usa o site local.

## Dogfood neutro

Executado em clone temporário local exclusivo, a partir da mesma base, com os
scripts 6C e dependências já instaladas. A CLI Node foi invocada diretamente
(equivalente ao script author:flow), com preloader que rejeita API key/fetch/sockets.
`result.json` foi produzido pelo mock determinístico já existente, não por IA.
Não houve geração médica nova. A aprovação/promoção fictícia está autorizada
pelo pedido de dogfood; não representa aprovação acadêmica real.

```text
status  → not-started
init    → dogfood-neutro-6c; 2 objetivas + 1 dissertativa; 5 alternativas
          difficulty = 0.2,0.6,0.2
          basename = Fonte neutra com espaços.txt
          SHA-256 = 74c810804db4a4eea3272ddd476ac851735f1dcc95afa4e3091c9299c4519f83
status  → awaiting-generation-result
import  → Candidate criado. Revisão humana obrigatória.
status  → awaiting-human-review
approve → --confirm APROVAR; review aprovado, sem produção
status  → ready-to-promote
promote → --confirm PROMOVER; cópia exclusiva no clone temporário
status  → promoted
author:validate → OK; production e candidate com bytes idênticos
```

O diretório temporário exclusivo foi removido ao fim. O teste CLI automatizado
reproduz esse ciclo, incluindo a falha antes das confirmações obrigatórias.
Nenhum artefato fictício foi criado em data/exams ou authoring da worktree de
implementação. Logs locais de execução estão em `/tmp/phase6c-*.log`.

## Correção focada após a auditoria, antes do commit

A auditoria final encontrou um defeito real na primeira implementação: approve
validava candidate/review/generation, mas imediatamente antes do rename comparava
somente o review. Em clone temporário neutro, mudar o enunciado e a revision do
candidate de 1 para 2 após a leitura inicial terminou incorretamente com review
approved e estado ready-to-promote. Esse defeito existiu antes do commit, apesar
de os 264 testes anteriores passarem; não foi ocultado ou corrigido em produção.

A correção altera somente `scripts/authoring/workflow.ts`,
`tests/workflow.test.ts` e este relatório. Nenhuma regra de schema, provider,
mapper, SHA/provenance, promoção ou Content Gate foi alterada.

A estratégia mantém o lock cooperativo e acrescenta detecção otimista:

1. Capturar no início snapshots exatos de candidate e review regulares e do
   generation record opcional, distinguindo presente/ausente. Além de Buffer.equals
   byte a byte, conferir dispositivo/inode, tipo/permissões, tamanho, mtime/ctime
   em nanossegundos e número de links. O_NOFOLLOW/O_NONBLOCK e stat do descritor
   antes/depois da leitura impedem aceitar symlink, troca de tipo ou substituição
   durante a captura. A validação existente é seguida de confirmação de que os
   snapshots ainda correspondem aos arquivos validados.
2. Preparar o novo review e uma cópia exata do review anterior em staging local,
   sem tocar candidate/generation. Imediatamente antes do rename, reler e comparar
   os três artefatos, incluindo a ausência original do generation. Divergência
   aborta antes da escrita e preserva a edição concorrente, inclusive do review.
3. Após o rename atômico, reler candidate/generation e confirmar sua estabilidade;
   executar author validation e reconfirmar. Divergência ou falha de validação
   restaura atomicamente os bytes anteriores do review e retorna erro, sem apagar
   ou reverter mudanças externas em candidate/generation.
4. Se a restauração falhar, retornar erro explícito de **aprovação NÃO confirmada**,
   preservando backup original em staging e informando seu caminho para recuperação
   manual. Nunca reportar aprovação bem-sucedida nesse caso. O review pode ainda
   estar approved no disco se o filesystem impedir o rollback; o erro exige
   intervenção antes de qualquer continuidade. Na operação normal, staging e locks
   são limpos e somente o review muda permanentemente.

Os pontos internos `afterValidation` e `replaceReview` permitem intercalar
mutações determinísticas nos testes, sem sleeps ou opção insegura na CLI pública.
Foram adicionados **26 testes regressivos**: mudança de enunciado/revision,
generation e review; remoção; substituição com bytes idênticos; alteração só de
whitespace; troca por diretório/symlink; criação inesperada de record em 6A manual;
mutações de candidate/generation entre pré-check e escrita; remoção pós-write;
record que surge durante a escrita; fluxo manual normal sem record; falha explícita
de rollback com backup preservado. Os testes anteriores continuam comprovando
fluxo normal, mudança exclusiva do review, literal APROVAR e paths com espaços.

Resultado desta rodada: **264 → 290 testes**, todos passando; workflow específico
**93/93**. Typecheck, build, validate:dist, author:validate e diff --check passaram.
Playwright foi dispensado nesta correção de authoring; os 16/16 anteriores
continuam como evidência, e nenhuma UI/engine mudou.

O dogfood neutro completo foi reexecutado até promoted somente em clone temporário.
O cenário exato da auditoria também foi reexecutado com a mesma mutação no ponto
mkdtemp de staging: agora approve retorna erro, revision 2 permanece, review draft
original e generation ficam byte a byte intactos, e status continua
awaiting-human-review. Logs: `/tmp/phase6c-approval-*.log`.

Limitação residual: edições externas que ignoram locks são tratadas por detecção
**otimista**, não por lock global de filesystem ou transação entre os arquivos.
A verificação observa estabilidade até a última checagem; uma edição externa
posterior exige invalidar a aprovação/revisar novamente conforme o fast path.
Interrupção abrupta durante a janela de escrita pode exigir inspeção manual dos
artefatos/staging. Não há promessa de exclusão global de outros processos.

## Preservação e limites

Todos os arquivos versionados em `data/exams/`, `authoring/candidates/`,
`authoring/reviews/` e `authoring/generations/` foram comparados byte a byte com a
base: intactos, incluindo anti-hipertensivos. Schema, UI/Exam Engine, lockfile e
workflows não mudaram. Catálogo e dist continuam semanticamente iguais à fonte.
Nenhuma prova foi promovida nesta worktree; zero adições no Content Gate.
Antes de ignorar scratch/export, `git ls-files .authoring-work authoring/exports`
confirmou que esses paths não continham arquivos versionados. Nenhum segredo,
header, API key ou reasoning privado foi criado/persistido.

A CLI confia na declaração humana expressa pelo operador: não pode verificar a
conversa ou a qualidade acadêmica. Não realiza OCR/leitura visual ou validação
interna dos formatos; reutiliza a infraestrutura 6B. Status não relê a fonte
original; o SHA real é conferido em init/import. Approved é o status do review;
sem production, o estado principal é ready-to-promote. Locks são cooperativos e
não há transação única entre diretórios; interrupções abruptas podem requerer
inspeção de evidências/locks locais. Não há bloqueio restante para revisão local.
