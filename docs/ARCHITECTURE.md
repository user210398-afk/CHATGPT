# Arquitetura compartilhada — estado após as Fases 3 e 4

## Decisão e escopo

A base histórica da Fase 2 foi `origin/refactor/json-exam-engine`, commit
`8d90b35d38d0f4d36f7793ffa9b744262e40fe28`, do repositório
`user210398-afk/CHATGPT`. Ela implementou a aplicação estática e a POC real de
30 questões. A Fase 3 migrou as outras 16, totalizando **17 provas JSON / 485
questões / 462 objetivas / 23 dissertativas**, com 2.187 alternativas e três
grupos/casos. Os 17 HTMLs permanecem como acervo de comparação/rollback.
A Fase 4 parte de `b31295406ee800f0bb113282da7edfc27bfa511b` e prepara CI,
validação de `dist/` e Pages manual, sem cutover. As decisões abaixo permanecem.

**Vite + TypeScript estrito + React + Zod.** Vite produz arquivos estáticos,
resolve assets com `/CHATGPT/` e dispensa backend. TypeScript tipa contratos e
uniões discriminadas. React justifica-se pela composição de shell, renderers,
mapa de questões e resultados, atualização declarativa de estado e testes de
interação. Não há roteador, biblioteca de estado global, framework de servidor,
CSS por disciplina ou dependências de CDN. Zod fornece os mesmos contratos no
build e no carregamento. O lockfile fixa as versões efetivas.

O CSS evolui cards e hierarquia acadêmica do legado para uma identidade azul,
com leitura confortável, verde/vermelho/âmbar sem depender exclusivamente de cor.
Fontes locais do sistema evitam carregamentos externos.

## Organização

| Caminho | Responsabilidade |
|---|---|
| `app/index.html` | Única entrada HTML da aplicação nova; não representa uma prova |
| `src/app/` | Shell, catálogo, carregamento assíncrono, composição da sessão e tema |
| `src/components/common/` | Conteúdo textual estruturado e imagens |
| `src/components/exam/` | Página e mapa de navegação, sem banco de questões |
| `src/components/questions/` | Registro de renderers, objetiva e dissertativa |
| `src/components/results/` | Resultado objetivo, histórico e entrada para revisão |
| `src/engine/` | Loader, transições puras, regras por tipo e repositório de tentativas |
| `src/types/` | Tipos inferidos do schema, sem duplicação de contratos |
| `src/styles/` | Tokens e componentes visuais compartilhados |
| `src/utils/paths.ts` | Resolução de URLs usando `import.meta.env.BASE_URL` |
| `data/exams/` | Fonte acadêmica canônica, um JSON por prova |
| `schema/` | Zod e JSON Schema estrutural exportado |
| `scripts/` | Validação, catálogo, validação de dist e extração/migração/paridade histórica das 17 provas |
| `tests/` | Schema, engine, persistência, paridade e QA de catálogo/release em desktop/mobile |
| `public/media/` | Destino de imagens futuras; a POC e o legado atual não têm imagens |
| `public/generated/`, `public/legacy/`, `dist/` | Artefatos ignorados, regenerados no build |

O `index.html` original da raiz e todos os 17 HTMLs estão **intactos**. O root do
Vite é `app/`; o `dist/index.html` produzido é a homepage nova. Isso permite
comparar o legado e evita que o workflow antigo trate uma entrada nova na raiz
como se fosse outro simulado. Na Fase 2 o workflow existente permaneceu intacto;
na Fase 4 tornou-se manual e inerte, com lógica histórica preservada. O novo CI
é ativo e o pipeline oficial de Pages está preparado, restrito a dispatch em
main com confirmação explícita. Ver PHASE4_RELEASE_READINESS.md.

## Fluxo

```text
data/exams/*.json
  → readExamCatalog / parseExam (estrutura + integridade + assets)
  → public/generated/exam-index.json + exams/<id>.json
  → build estático (dist/)
  → Application / ?exam=<id>
  → ExamLoader (validação novamente)
  → ExamPage / ExamState
  → QuestionRenderer por type
  → componentes + Design System

Ações da interface → transition → Attempt → AttemptRepository → localStorage
```

O catálogo não importa bancos acadêmicos para o bundle. A aplicação busca apenas
o índice e a prova escolhida na mesma origem. Não há GitHub API, scraping,
iframe, banco de dados, autenticação, token ou backend no runtime novo.
`provenance.sourceFile` registra a origem para auditoria; nunca é requisitado
pelo loader.

## Schema v1

`schema/exam.ts` é a fonte de verdade, incluindo refinamentos semânticos.
`schema/exam.schema.json` é a exportação formal JSON Schema Draft 2020-12 para
editores e ferramentas. Ela cobre a estrutura; unicidade de IDs, referências,
texto não vazio em árvores e existência física de imagens também exigem o
validador TypeScript. Não validar uma migração apenas com o JSON Schema exportado.

Campos de prova:

- `schemaVersion: 1`: versão do contrato, rejeita versões desconhecidas.
- `revision`: versão acadêmica da prova; incrementar quando conteúdo, ordem,
  questões ou gabaritos mudarem. Não reutilizar estado de uma revisão incompatível.
- `id`: kebab-case estável, separado de título e caminho; arquivo `<id>.json`.
- `title`, `subject`, `year`, `division`, `description`, `tags`, `images`:
  metadados explícitos. `year` pode ser `null` quando a fonte não declara o ano;
  não inferir. Uma descrição sem fonte pode ser a string vazia.
- `settings`: ordem fixa e feedback após finalização nesta versão. Não anunciar
  configurações ainda não implementadas, como randomização.
- `sections`: identificação dos módulos originais, sem criar motores separados.
- `groups`: casos compartilhados com título, contexto rico e imagens.
- `provenance`: arquivo e commit de origem, além de notas de ambiguidade/migração.
- `questions`: sequência canônica não vazia, livre para intercalar tipos.

Toda questão tem `id`, `label` original, categoria, enunciado, explicação,
imagens e tags. `sectionId`, `groupId` e `context` são opcionais; referências
presentes devem existir. `label` é textual para números, lacunas e subitens.

`multiple-choice` acrescenta alternativas ordenadas `{ id, text }` (mínimo duas,
sem quantidade fixa) e `correctAnswer` apontando para um ID existente.
`essay` acrescenta `modelAnswer`; nenhum gabarito objetivo é aceito nesse tipo.
IDs de questões, alternativas, seções, grupos e provas são verificados quanto à
unicidade em seu escopo. Objetos são estritos: campos desconhecidos não são
silenciosamente descartados.

Os diagnósticos identificam `arquivo → questão → campo → problema`. Erros de
prova/grupo usam esse contexto em vez de uma questão inexistente. JSON inválido,
filename divergente e imagem ausente também bloqueiam a geração/build.

## Conteúdo rico e imagens

Enunciados, opções, explicações, modelos e casos são arrays de nós:

```json
[
  { "type": "text", "text": "Texto preservado " },
  { "type": "element", "tag": "b", "children": [
    { "type": "text", "text": "com ênfase" }
  ] }
]
```

A lista explícita de tags inclui ênfase, listas, sub/sobrescrito e tabelas.
Não existem atributos HTML, scripts, estilos inline, eventos ou URLs executáveis.
React cria elementos apenas dessas tags validadas; texto é escapado. Não se usa
`innerHTML`, `dangerouslySetInnerHTML` nem HTML arbitrário recebido do JSON.
Imagens são dados separados `{ src, alt, caption? }`, com `src` relativo a
`media/`, sem traversal, URL externa, base64 ou SVG executável. O build verifica
existência; o renderer aplica o base path e exibe legenda/alt.

O adaptador da POC usa Acorn para ler somente literais JS e parse5 para converter
marcações em árvore, sem executar o HTML legado. Tags/atributos desconhecidos
**falham explicitamente**, sem sanitização destrutiva silenciosa. Os prefixos de
alternativas e todo o conteúdo acadêmico permanecem preservados. Entidades HTML
são decodificadas para caracteres e reescapadas pelo renderer, preservando o DOM.

## Exam Engine e renderers

`exam-state.ts` contém criação de tentativa, transições imutáveis, progresso,
finalização e resultado. Não importa React, DOM, storage ou disciplina.
`question-behaviors.ts` registra aceitação de respostas, critério de respondida e
correção por tipo. Respostas referenciam IDs estáveis, nunca índices de navegação.

Uma tentativa armazena ID próprio, ID/revisão da prova, respostas, índice atual,
marcações, início, conclusão e resultado. Anterior/próxima não atravessam limites;
marcação alterna; respostas podem mudar antes da conclusão. Finalizar é idempotente
e bloqueia edição, mantendo navegação para revisão.

A pontuação é `acertos / total de objetivas`, incluindo objetivas em branco no
denominador. O relatório separa acertos, erros e questões em branco. Dissertativas
são contadas como respondidas se tiverem texto não vazio e não recebem pontuação.
Numa prova exclusivamente dissertativa, o percentual é `null`, nunca uma divisão
por zero. Os modelos ficam disponíveis após conclusão para comparação pelo aluno;
autoavaliação com botões/notas fica para fase futura.

O registro `QuestionRenderer` seleciona o componente pelo tipo. Conteúdo e estado
entram por props. Para um novo tipo, acrescentar contrato no schema, comportamento
no registro e renderer correspondente; não criar páginas ou um novo ciclo de
navegação/tentativa. A política de resultado deste escopo distingue itens de
correção objetiva e dissertativas; tipos com nova modalidade de pontuação exigirão
versionar explicitamente esse contrato de resultado.

## Persistência

Usa `localStorage` por ser suficiente para tentativas pequenas, sem mídia,
com restauração síncrona simples e ampla compatibilidade. `AttemptRepository`
recebe um adaptador substituível e concentra todas as operações de tentativa.
Uma evolução para IndexedDB não precisa alterar renderers nem transições.

- Envelope `storageVersion: 2` sob o namespace já existente
  `chatgpt-exams:v1:<examId>:r<revision>`. A chave principal guarda somente
  `current`; a chave `:history` guarda até 20 resumos concluídos (ID, início,
  conclusão e resultado). Respostas longas não são duplicadas no histórico.
- Digitação dissertativa atualiza a interface imediatamente e aguarda 500 ms de
  inatividade antes de gravar. Navegação, marcação, finalização e saída da página
  gravam a tentativa pendente imediatamente. O histórico só é regravado quando
  uma conclusão nova entra ou quando precisa ser migrado/reparado.
- Iniciar nova tentativa preserva os 20 resumos mais recentes. Uma falha entre
  as duas escritas pode deixar o histórico atrasado; a restauração recompõe o
  resumo da tentativa concluída a partir de `current` e tenta repará-lo na
  próxima gravação. O progresso é derivado das respostas persistidas.
- Envelopes v1 da própria Fase 2 são lidos e migrados na próxima escrita,
  preservando tentativa e histórico. Restauração valida estrutura, IDs, opções,
  limites, revisão e datas, e recalcula o resultado da tentativa atual. Um
  histórico separado corrompido não impede restaurar a tentativa atual. Dados
  incompatíveis abrem uma sessão nova com aviso, sem quebrar a aplicação.
- Falhas de leitura/quota/permissão mostram aviso e mantêm o uso em memória.
  Sem gravação, fechar/recarregar perde mudanças da sessão.
- Preferências têm chave separada `chatgpt-exams:preferences:v1`; tema segue o
  sistema na ausência de escolha válida e funciona mesmo sem storage.

Chaves legadas não são importadas, alteradas ou excluídas. A colisão de anos e a
retomada parcial no legado impedem uma importação automática confiável. Rollback
consiste em reabrir o acervo legado com seus próprios dados ainda preservados.
Os scripts antigos de backup e marca-texto continuam no acervo; não conhecem nem
manipulam o namespace novo. Sincronização entre abas e exportação/importação da
nova persistência não fazem parte do escopo atual; usar uma aba por tentativa.

## Catálogo e decisão sobre simulados.json

**Substituir como contrato da nova aplicação; preservar `simulados.json` como
insumo temporário de migração e comparação do legado.** Seus dois campos,
`arquivo` e `titulo_exibicao`, não descrevem disciplina, ano, tipos, revisão ou
quantidade de questões. Preservar esse formato imporia inferência por filenames
e dependência de HTMLs. A paridade atual não o torna um contrato adequado.

`npm run generate` valida todos os JSONs de `data/exams/`, confere imagens e
unicidade entre provas e gera o índice com metadados e contagens. Adicionar um JSON
válido é suficiente para aparecer **após build**; não se edita a homepage nem o
índice gerado. `npm run validate` faz as mesmas verificações sem escrever arquivos.
A aplicação nova nunca consome `simulados.json`.

## Design System

`tokens.css` centraliza cores semânticas, fontes, escala de espaçamento, radius,
sombras, transições, camadas e documentação dos dois breakpoints (48rem e 64rem).
Media queries repetem os valores literais porque CSS custom properties não são
aceitas nessa posição. `global.css` contém primitivas e acessibilidade;
`components.css` contém estilos compartilhados de aplicação/prova.

Light e dark usam os mesmos tokens e componentes. Radios, labels, textarea,
fieldset/legend, links e botões são nativos; há skip link, foco visível, indicação
de questão atual e respeito a movimento reduzido. O mapa usa cores mais texto e
ARIA. No mobile, as colunas viram uma sequência vertical, com alvos de toque e
largura fluida. Tabelas têm overflow contido.

## GitHub Pages e convivência

A publicação futura, preparada pelo workflow oficial de Pages, deve servir
**o conteúdo de `dist/`** em
`https://user210398-afk.github.io/CHATGPT/`. `base: '/CHATGPT/'` está definido no
Vite. Catálogo: `/CHATGPT/`; prova:
`/CHATGPT/?exam=fisiologia-m5-aula-1-2026`. Refresh funciona sem rewrites porque
não há rotas virtuais. Fetch, links, imagens e assets respeitam o mesmo base.

O build copia o hub e arquivos legados sem alteração para `dist/legacy/`, de modo
que links relativos continuam válidos. O link “Acervo legado” dá acesso às 17
provas originais. Essa cópia não é importada nem buscada para renderizar as 17 provas JSON.
As referências históricas incorretas ao GitHub no hub original permanecem apenas
na cópia preservada para comparação; a aplicação nova não utiliza essas referências.
Nenhuma referência `/Simulados/` existe no código da nova aplicação.

O CI da Fase 4 valida instalação pelo lockfile, auditoria, schema, TypeScript,
Vitest, build, artefato e Chromium instalado oficialmente pelo Playwright.
Pages usa somente dispatch manual em main com confirmação PUBLICAR; publicar
exige aprovação posterior e configuração externa documentada. O workflow legado
não escreve mais automaticamente. Nenhum cutover ocorreu na Fase 4.
Servir a raiz do repositório ainda abre o hub antigo; para demonstrar a versão
nova, usar `npm run dev` ou o preview de `dist/` conforme o README.

## Verificação e limites

Ver [PHASE2_VALIDATION.md](PHASE2_VALIDATION.md) para evidências históricas, discrepâncias,
comandos e critérios verificados. Ver [POC_MIGRATION.md](POC_MIGRATION.md) para
proveniência e decisão de ordenação da prova mista.

Na Fase 2, migração em massa, CI e QA final foram explicitamente adiados.
A migração foi concluída na [Fase 3](PHASE3_MIGRATION.md); CI, QA de release e
preparação do Pages estão na [Fase 4](PHASE4_RELEASE_READINESS.md).
Continuam futuros: cutover/publicação real, limpeza do legado, estatísticas
globais, cronômetros avançados, notas/marca-texto, backup novo e feedback imediato.
Conteúdo acadêmico permanece separado do shell e dos renderers.
