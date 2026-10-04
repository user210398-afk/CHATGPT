# Geração assistida — Fase 6B

Um arquivo local → SHA-256 → configuração → conteúdo intermediário estrito →
mapper determinístico → candidate Schema v1 + review **draft** + generation record.
O mesmo `parseExam`, `validateCandidate`, `author:validate` e Content Gate da 6A
continuam sendo usados. A 6B não promove, aprova, abre PR de conteúdo, publica,
altera provas existentes ou executa merge/deploy. As 17 provas atuais continuam
congeladas (485 questões, 462 objetivas, 23 dissertativas, 2.187 alternativas,
3 grupos). Nenhum candidate médico real foi incluído nesta implementação.

## Configurar

Use Node **24.19.0**, `npm ci` e um JSON baseado em
[`generation-request.example.json`](../authoring/templates/generation-request.example.json):

```json
{
  "examId": "farmacologia-aula-3-2026",
  "subject": "Farmacologia",
  "year": 2026,
  "division": "M5 - Aula 3",
  "title": "Farmacologia — Aula 3",
  "language": "pt-BR",
  "objectiveCount": 20,
  "essayCount": 5,
  "optionsPerObjective": 5,
  "difficulty": { "easy": 0.2, "medium": 0.6, "hard": 0.2 },
  "focusTopics": [],
  "excludeTopics": [],
  "allowExternalKnowledge": false
}
```

Counts são inteiros não negativos, total entre 1 e 60; opções são 4 ou 5.
Difficulty soma 1, com tolerância 0.001; metas inteiras usam maiores restos,
com desempate easy → medium → hard. Essas metas ficam no record, não na prova.
Idioma aceita pt-BR (default), pt-PT, en e es. Conhecimento externo é false por
padrão, nunca deve ser complementado silenciosamente. `year` é obrigatório e
pode ser null; o código não infere ano. `examId` usa o identifier kebab-case da
6A, até 120 caracteres, sem paths. Configurações e saídas rejeitam campos extras.

## Export gratuito e import

O provider padrão é **export**: zero credenciais, zero rede e zero custo de API.

```sh
npm run author:generate -- --file "/caminho/aula.pdf" --config "/caminho/request.json"
```

Cria `authoring/exports/<id>/export-manifest.json`, `prompt.md` e `schema.json`.
O manifest inclui request normalizado, basename/SHA-256/tamanho da fonte,
provider export, promptVersion, detail (somente PDF), timestamp e hashes do
prompt, schema e manifest. O pacote **não contém a aula**, texto extraído ou
Base64. Escolha manualmente onde usar o prompt/schema e a fonte original,
considerando as condições de privacidade e eventual custo desse serviço.

Salve apenas o JSON estruturado retornado (sem cercas de markdown) e importe:

```sh
npm run author:import-generation -- \
  --result "/caminho/output.json" \
  --export "authoring/exports/farmacologia-aula-3-2026/export-manifest.json" \
  --file "/caminho/aula.pdf"
```

`--file` é obrigatório no import para recalcular o hash da fonte original;
nenhum caminho absoluto precisa ser persistido. Import confere fonte/hash/tamanho,
integridade do manifest, prompt/schema e sua correspondência à configuração e
versão instalada. Em seguida aplica o mesmo Zod e mapper de mock/OpenAI.
Os hashes detectam corrupção/inconsistência; não são assinatura de autoria nem
provam correção acadêmica. Proteja o pacote local e revise seu conteúdo.

## Mock determinístico

```sh
npm run author:generate -- \
  --file tests/fixtures/authoring/source.txt \
  --config authoring/templates/generation-request.example.json \
  --provider mock
```

Mock não usa IA, rede, segredo ou conteúdo médico real. Produz questões neutras
de infraestrutura, sem alegar cobertura acadêmica da fonte. Use diretório
temporário para testes; não comite os artefatos gerados por esse exemplo.

## OpenAI opcional e consentimento

Configure `OPENAI_API_KEY` exclusivamente no ambiente local. Nunca passe chave
pela CLI, grave no repo/log, gere `.env` automaticamente ou use uma chave em CI.
O programa falha claramente quando a chave está ausente.

```sh
npm run author:generate -- \
  --file "/caminho/Aula 03.pdf" \
  --config "/caminho/request.json" \
  --provider openai --model gpt-5.6-luna --detail low \
  --timeout-ms 300000 --confirm ENVIAR
```

Sem a confirmação literal `ENVIAR`, nenhum byte é enviado. Antes da chamada,
a CLI mostra `Este comando enviará <basename> ao provider externo.`
OpenAI é recusado quando `CI` está definido. Engenharia e testes desta fase
usam exclusivamente mock/export/fetch simulado: **zero chamadas live e zero
custo de API**. Isso não garante gratuidade para um uso futuro do provider.

Usa Node native fetch em `POST https://api.openai.com/v1/responses`,
`text.format.type=json_schema`, strict=true e schema intermediário próprio.
Modelo é configurável; default técnico `gpt-5.6-luna`. Disponibilidade, suporte
a arquivos/Structured Outputs, qualidade acadêmica e preços devem ser conferidos
no provider antes do uso. Não há benchmark pago nem promessa de preço fixo.

Timeout default de cinco minutos, configurável entre 1 ms e 30 minutos, aborta
com AbortController. 401/403, 429, 5xx, falha de rede, timeout, refusal, incomplete,
output ausente, JSON inválido ou schema inválido falham sem segunda chamada.
**Zero retry automático**. Um timeout pode ocorrer após processamento pelo
provider e não garante ausência de cobrança; verifique antes de tentar novamente.

## Formatos e PDF detail

Aceita um único arquivo PDF, DOCX, PPTX, TXT ou MD, regular e não vazio,
até **50 MiB (50 × 1024 × 1024 bytes)**. Symlinks e outras extensões são
rejeitados. O hash é calculado localmente sobre os mesmos bytes antes da chamada.
TXT/MD entram como input_text; documentos binários usam input_file com file_data
Base64 inline, sem Files API. Não há extração local de Office, OCR ou conversão.

`--detail low|high|auto`, default low, é incluído somente no input_file PDF.
Use high para diagramas, gráficos, imagens anatomopatológicas, tabelas pequenas
ou esquemas visuais. PDF tende a preservar melhor o contexto visual; converta
PPTX/DOCX para PDF manualmente quando figuras/gráficos forem importantes.
Limites e interpretação dos formatos também dependem do modelo/provider.

## Privacidade, conteúdo e auditoria

Responses usa **store:false**, sem Conversations, previous_response_id,
background, tools ou web search. Cada geração é stateless. Isso controla o
armazenamento da resposta na API, não substitui a política de retenção do provider.
O código não persiste source bruto, texto completo, Base64, request HTTP,
resposta HTTP completa, reasoning, headers ou chave. Bytes ficam em memória
somente durante a operação. Artefatos derivados contêm conteúdo da prova e
anchors curtos explicitamente destinados à revisão, além da configuração.

```text
authoring/candidates/<id>.json   Schema v1, revision 1
authoring/reviews/<id>.json      draft, checks false, reviewedBy null
authoring/generations/<id>.json  generationVersion 1, registro estrito
```

O record contém examId; source {fileName, sha256, sizeBytes}; request completo;
provider {name, model, promptVersion, detail}; response {id, usage} (null quando
indisponível); coverage {topicsDetected, topicsUsed, topicsSkipped}; insufficiency
{detected, reason}; difficultyCounts; questions [{questionId, sourceAnchors}];
createdAt. Não contém a saída intermediária bruta. Racionales de todas as opções
entram na explicação; pontos esperados das essays entram na resposta-modelo.
Source anchors ficam somente no record, fora do candidate de produção.

O mapper controla schemaVersion, revision, IDs, settings, provenance e paths;
correctIndex zero-based vira option-N. Não executa JSON, HTML ou código do modelo.
Conteúdo é texto simples convertido em RichText de nós text; markup, handlers e
URLs externas são rejeitados. O prompt versionado trata instruções no arquivo
como dados não confiáveis, separadas da mensagem de sistema. Esse desenho e os
testes verificam a defesa explícita, sem prometer resistência semântica absoluta.

Se faltarem questões sustentadas, o output deve marcar insufficiency com motivo.
O review usa counts **gerados**, enquanto o record conserva a intenção original
e o motivo. Zero questões não gera candidate. Schema válido não prova qualidade:
fonte, gabaritos, racionales e respostas-modelo precisam de revisão humana.

## Validação, escrita e revisão humana

```sh
npm run author:generate -- --file "/caminho/aula.pdf" --config "/caminho/request.json" --dry-run
npm run author:validate
npm run author:validate -- --id farmacologia-aula-3-2026
```

Dry-run imprime somente basename, tamanho, SHA-256, provider/model/detail,
examId, counts e destinos relativos. Não precisa de chave ou ENVIAR, não usa
rede e não grava artefatos. Export e mock também dispensam consentimento.

Valida todos os documentos e o par da 6A antes de escrever. IDs existentes em
produção ou candidates/reviews/generations causam falha; exports existentes não
são substituídos. Use novo ID ou remoção manual após conferir a evidência.
Um lock local por ID serializa gerações; publicação de cada JSON usa arquivo
temporário e hard link atômico/exclusivo. Falhas normais limpam links próprios e
temporários. Os três diretórios não constituem uma única transação de filesystem:
um encerramento abrupto pode deixar lock/evidência parcial; `author:validate`
rejeita esses estados. Inspecione antes de remover manualmente ou reexecutar.

`author:validate`, promoção explícita e Content Gate exigem record íntegro para
o prompt 6B `exam-generation-v1`, rejeitam divergências e records órfãos.
Manifests manuais/anteriores da 6A continuam compatíveis. O gate mantém somente
adições, approved humano, igualdade candidate/production e baseline intacto.
Uma futura promoção deve conservar candidate, review, record e production.
Os artefatos de authoring continuam fora do catálogo/runtime/dist.

Depois da revisão, siga [CONTENT_AUTHORING.md](CONTENT_AUTHORING.md). Aprovação,
`author:promote --confirm PROMOVER`, PR, merge humano e publicação são etapas
separadas; nenhuma delas é executada pelo gerador.
