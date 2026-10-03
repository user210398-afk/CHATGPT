# Inventário das provas legadas

## Escopo e método

Inventário da Fase 1, obtido diretamente dos 17 HTMLs em `simulados/` na branch
`refactor/json-exam-engine`. A contagem foi feita avaliando somente as declarações
`objectiveQuestions` e `dissertativeQuestions`, e depois conferida contra `type`,
`num`, `options`, `correct`, `context` e `gabarito`. `index.html` é o hub, não uma
prova. Não há arquivos de imagem versionados nem tags `<img>` nos simulados;
tabelas e casos clínicos são HTML embutido em strings.

**Totais confirmados:** 17 provas, 485 questões (462 objetivas e 23
dissertativas), sendo 14 provas exclusivamente objetivas, 1 exclusivamente
dissertativa e 2 mistas. Todas as 462 objetivas possuem índice de gabarito
`correct` válido e explicação/comentário em `context`; todas as 23 dissertativas
possuem resposta-modelo em `gabarito`.

## Tabela completa

| # | Arquivo | Título/identificação observada | Disciplina | Ano | Divisão | Total | Obj. | Diss. | Tipo | Imagens | Explicação / gabarito | Particularidades e observações |
|---:|---|---|---|---:|---|---:|---:|---:|---|---|---|---|
| 1 | `simulados/farmaco-p2-Simulado-2023.html` | Plataforma de Avaliação — Farmacologia | Farmacologia | 2023 | P2 | 35 | 35 | 0 | Objetiva | Não | 35 `context`; 35 `correct` | Numeração 1–35; 9 questões com 4 alternativas e 26 com 5; letras já fazem parte do texto da alternativa. |
| 2 | `simulados/farmaco-p2-Simulado-2024.html` | Plataforma de Avaliação — Farmacologia | Farmacologia | 2024 | P2 | 34 | 34 | 0 | Objetiva | Não | 34 `context`; 34 `correct` | Numeração 1–34; 8 questões com 4 alternativas e 26 com 5. |
| 3 | `simulados/farmaco-p2-Simulado-2025.html` | Simulado de Farmacologia 2025 — Questões 04 a 45 | Farmacologia | 2025 | P2 | 42 | 42 | 0 | Objetiva | Não | 42 `context`; 42 `correct` | A prova começa em 4 e termina em 45 (questões 1–3 ausentes); 36 itens com 4 alternativas e 6 com 5. |
| 4 | `simulados/fisiologia-aula-m5- 1 - Introdução e Hipófise.html` | Fisiologia 2026 — Sistema Endócrino / Introdução e Hipófise | Fisiologia | 2026 | M5, aula 1 | 30 | 20 | 10 | Mista | Não | 20 `context`/`correct`; 10 `gabarito` | Dois módulos selecionáveis; numeração 1–20 e 1–10 reinicia por tipo; todas as objetivas têm 5 alternativas. |
| 5 | `simulados/fisiologia-aula-m5-2-Hormônios Pancreáticos.html` | Fisiologia — Hormônios Pancreáticos | Fisiologia | Não explícito no título | M5, aula 2 | 25 | 20 | 5 | Mista | Não | 20 `context`/`correct`; 5 `gabarito` | Dois módulos selecionáveis; numeração reinicia por tipo; objetivas com 5 alternativas. O hub/arquivo sugere a sequência de 2026, mas o HTML não declara o ano. |
| 6 | `simulados/fisiologia-m5-Endocrino em Grupo.html` | Fisiologia 2026 — Endocrinologia Médica | Fisiologia | 2026 | M5, trabalho em grupo | 8 | 0 | 8 | Dissertativa | Não | 8 respostas-modelo em `gabarito` | Casos clínicos ricos em HTML/tabelas; campos adicionais `id`, `mainNum` e `caseText`; 8 subitens agrupados em 3 questões/casos principais. |
| 7 | `simulados/imunologia-b4-Simulado 2022.html` | Plataforma de Avaliação — Imunologia Médica | Imunologia | 2022 | B4 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Numeração 1–30; 5 alternativas por item. |
| 8 | `simulados/imunologia-b4-Simulado 2023.html` | Imunologia Médica P4 (2023) | Imunologia | 2023 | Arquivo B4; título P4 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Divergência B4/P4 entre nome e título; 5 alternativas por item. |
| 9 | `simulados/imunologia-b4-Simulado 2024.html` | Microbiologia e Virologia — Prova 2024 | **Arquivo: Imunologia; conteúdo/título: Microbiologia e Virologia** | 2024 | B4 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Inconsistência forte de classificação: nome/catálogo dizem Imunologia, título e conteúdo dizem Microbiologia. Fonte Space Grotesk adicional; estrutura equivalente aos objetivos. |
| 10 | `simulados/imunologia-b4-Simulado 2025.html` | Plataforma de Avaliação — Imunologia Médica | Imunologia | 2025 | B4 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Numeração 1–30; 5 alternativas por item. |
| 11 | `simulados/micro-b4-Simulado 2023.html` | Microbiologia e Virologia Clínica | Microbiologia/Virologia | 2023 | B4 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Numeração 1–30; 5 alternativas por item. |
| 12 | `simulados/micro-b4-Simulado 2024.html` | Microbiologia e Virologia Clínica | Microbiologia/Virologia | 2024 | B4 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Numeração 1–30; 5 alternativas por item. |
| 13 | `simulados/micro-b4-Simulado 2025.html` | Microbiologia e Virologia | Microbiologia/Virologia | 2025 | B4 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Numeração 1–30; 5 alternativas por item. |
| 14 | `simulados/parasito-b4-Simulado 2025.html` | Parasitologia e Dermatozoonoses | Parasitologia | 2025 | B4 | 31 | 31 | 0 | Objetiva | Não | 31 `context`; 31 `correct` | Numeração 1–31; 5 alternativas; 30 categorias (uma repetida). O carregamento do estado chama `localStorage.setItem` em vez de `getItem`, fragilidade funcional, não acadêmica. |
| 15 | `simulados/patologia-b3-Simulado-2025.html` | Patologia e Imunologia Médica | Patologia/Imunologia | 2025 | B3 | 30 | 30 | 0 | Objetiva | Não | 30 `context`; 30 `correct` | Numeração 1–30; exatamente 4 alternativas em todos os itens. |
| 16 | `simulados/propedeu-p2-Simulado 2024.html` | Clínica Médica e Propedêutica | Propedêutica/Clínica Médica | 2024 | P2 | 20 | 20 | 0 | Objetiva | Não | 20 `context`; 20 `correct` | Numeração 1–20; exatamente 4 alternativas em todos os itens. |
| 17 | `simulados/propedeu-p2-Simulado 2025.html` | Propedêutica Médica | Propedêutica | 2025 | P2 | 20 | 20 | 0 | Objetiva | Não | 20 `context`; 20 `correct` | Numeração 1–20; exatamente 4 alternativas; 15 categorias. |
| **Total** | **17 HTMLs** |  |  |  |  | **485** | **462** | **23** | **14 obj. / 2 mistas / 1 diss.** | **0** | **462 explicações + 23 respostas-modelo** |  |

## Distribuição das alternativas

| Quantidade de alternativas | Questões |
|---:|---:|
| 4 | 123 |
| 5 | 339 |
| **Total de objetivas** | **462** |

Não foram encontrados itens com A/B/C/D/E em propriedades separadas: cada opção
é uma string no array `options` e normalmente inclui seu próprio prefixo (`a)`,
`b)`, etc.). Por isso, a migração deverá preservar o texto original e validar a
normalização da letra separadamente.

## Integridade acadêmica observável sem reinterpretar conteúdo

- Não há `correct` ausente ou fora do intervalo de `options`, nem `context` ou
  `gabarito` ausente nos bancos avaliados.
- Não se julgou se a alternativa marcada está academicamente correta; isso exige
  revisão humana especializada.
- As questões 1–3 não existem no arquivo de Farmacologia 2025; o próprio título
  declara “Questões 04 a 45”, portanto a lacuna foi preservada e não corrigida.
- A prova “Imunologia 2024” parece estar classificada pelo nome errado, pois
  título e conteúdo apontam Microbiologia/Virologia.
- “Imunologia 2023” alterna B4 (arquivo/catálogo) e P4 (título).
- Não há imagens a preservar no snapshot atual. Tabelas e marcação HTML dentro de
  `statement`, `context`, `caseText` e `gabarito` devem ser preservadas literalmente
  até existir uma política segura de sanitização/renderização.
