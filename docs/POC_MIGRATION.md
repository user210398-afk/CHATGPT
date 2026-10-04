# POC real — Fisiologia, Introdução e Hipófise

## Fonte e preservação

- Origem: `simulados/fisiologia-aula-m5- 1 - Introdução e Hipófise.html`.
- Commit de origem: `8d90b35d38d0f4d36f7793ffa9b744262e40fe28`.
- Destino: `data/exams/fisiologia-m5-aula-1-2026.json`.
- 30 questões: 20 objetivas (100 alternativas, cinco por questão), 10 dissertativas.
- 20 gabaritos e explicações; 10 respostas-modelo; nenhuma imagem no original.

Foi escolhida por exercitar ambos os renderers, estado de resposta textual,
numeração reiniciada, conteúdo com ênfase/quebras e separação da nota objetiva.
Não é necessário migrar outra prova para demonstrar o motor compartilhado.
Alternativas variáveis, casos/tabelas, imagens e tipos intercalados são exercitados
com fixtures pontuais em testes, sem criar novas provas reais no catálogo.

`npm run migrate:poc` é uma conversão determinística restrita a esse arquivo.
Lê arrays de literais com Acorn, rejeita expressões executáveis e converte conteúdo
rico com parse5. O build normal não executa a migração nem lê questões do HTML.
O JSON é a fonte canônica de execução após a migração. Reexecutar o adaptador
sobrescreve a POC; só fazer isso para reprodução da origem, nunca para apagar uma
alteração acadêmica autorizada posterior.

## Mapeamento

| Legado | Schema v1 |
|---|---|
| Módulo objetivo / dissertativo | `sections` e `sectionId`; uma sequência no mesmo motor |
| `num` | `label` literal + ID estável `objetivas-001` / `dissertativas-001` |
| `category` | `category` e tag preservadas |
| `statement` | `statement` em árvore de texto/ênfase |
| `options[i]` | `{ id: "option-<i+1>", text: ... }`, na mesma ordem |
| `correct` | ID da alternativa naquela posição, sem reinterpretar as letras |
| `context` | `explanation` integral |
| `gabarito` | `modelAnswer` integral; `explanation` vazia, sem duplicação |

Os prefixos `a)`, `b)` etc. permanecem no texto. Não se inventou nem se corrigiu
conteúdo acadêmico. Quebras, Unicode, listas textuais e ênfase são preservados no
DOM, apesar da mudança de representação de HTML para árvore.

## Ambiguidades e decisões explícitas

1. O legado tem dois módulos selecionáveis e nenhuma ordem global que intercale
   seus itens. A POC concatena 20 objetivas e 10 dissertativas, preservando a ordem
   interna de ambos. A numeração acadêmica reinicia, enquanto a navegação mostra
   posição 1–30; o badge identifica módulo/número original.
2. O título agrega os textos existentes “Fisiologia 2026 — Sistema Endócrino” e
   “Introdução e Hipófise”. Ano 2026 e divisão M5/aula 1 estão explícitos na fonte.
3. Não há descrição acadêmica canônica separada, então `description` fica vazia.
4. Não há imagens nesta POC. Não foram inventadas ilustrações nem alternativas.
5. Não foi detectada inconsistência de gabarito posicional nesta prova. Isso não
   constitui revisão acadêmica das respostas.
6. O legado oferece modos de estudo/prova e autoavaliação dissertativa; a POC adota
   feedback após finalização e comparação manual com modelo, sem nota textual.

O teste de paridade compara o DOM original com o conteúdo efetivamente renderizado
pelo componente, campo por campo; também compara gabaritos, opções, ordem,
categorias e numeração. A comparação não reutiliza a função de conversão para
calcular o resultado esperado.
