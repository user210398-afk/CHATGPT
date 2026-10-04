# Migração da Fase 3

Repositório exclusivo: user210398-afk/CHATGPT. Branch: codex/phase3-migrate-remaining-exams.
Base remota refactor/json-exam-engine confirmada por fetch e ls-remote: d029f44501e32f0358160a613ce262379dc26af1.
Checkout original work; switch para a base validada antes de qualquer edição, seguido da nova branch.
Documentos obrigatórios lidos integralmente, incluindo AGENTS.md. Main não utilizada.

## Lista e classificação antes da migração

As 16 entradas abaixo seguem EXAM_INVENTORY.md, excluindo a POC.
14 objetivas, uma mista e uma dissertativa com caso/subitem/tabela.
Todos os enunciados/categorias/opções/gabaritos/modelos permanecem na ordem original.

| Legado | JSON criado | Classificação | Total | Obj. | Diss. | Paridade |
|---|---|---|---:|---:|---:|---|
| `simulados/farmaco-p2-Simulado-2023.html` | `data/exams/farmaco-p2-2023.json` | objetiva simples; conteúdo rico | 35 | 35 | 0 | OK — schema + DOM integral |
| `simulados/farmaco-p2-Simulado-2024.html` | `data/exams/farmaco-p2-2024.json` | objetiva simples; conteúdo rico | 34 | 34 | 0 | OK — schema + DOM integral |
| `simulados/farmaco-p2-Simulado-2025.html` | `data/exams/farmaco-p2-2025.json` | objetiva simples; conteúdo rico | 42 | 42 | 0 | OK — schema + DOM integral |
| `simulados/fisiologia-aula-m5-2-Hormônios Pancreáticos.html` | `data/exams/fisiologia-m5-aula-2.json` | mista; conteúdo rico | 25 | 20 | 5 | OK — schema + DOM integral |
| `simulados/fisiologia-m5-Endocrino em Grupo.html` | `data/exams/fisiologia-m5-endocrino-em-grupo-2026.json` | dissertativa; caso/subitem; conteúdo rico/tabela | 8 | 0 | 8 | OK — schema + DOM integral |
| `simulados/imunologia-b4-Simulado 2022.html` | `data/exams/imunologia-b4-2022.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/imunologia-b4-Simulado 2023.html` | `data/exams/imunologia-b4-2023.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/imunologia-b4-Simulado 2024.html` | `data/exams/imunologia-b4-2024.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/imunologia-b4-Simulado 2025.html` | `data/exams/imunologia-b4-2025.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/micro-b4-Simulado 2023.html` | `data/exams/micro-b4-2023.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/micro-b4-Simulado 2024.html` | `data/exams/micro-b4-2024.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/micro-b4-Simulado 2025.html` | `data/exams/micro-b4-2025.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/parasito-b4-Simulado 2025.html` | `data/exams/parasito-b4-2025.json` | objetiva simples; conteúdo rico | 31 | 31 | 0 | OK — schema + DOM integral |
| `simulados/patologia-b3-Simulado-2025.html` | `data/exams/patologia-b3-2025.json` | objetiva simples; conteúdo rico | 30 | 30 | 0 | OK — schema + DOM integral |
| `simulados/propedeu-p2-Simulado 2024.html` | `data/exams/propedeu-p2-2024.json` | objetiva simples; conteúdo rico | 20 | 20 | 0 | OK — schema + DOM integral |
| `simulados/propedeu-p2-Simulado 2025.html` | `data/exams/propedeu-p2-2025.json` | objetiva simples; conteúdo rico | 20 | 20 | 0 | OK — schema + DOM integral |

## Particularidades e ambiguidades por prova

### farmaco-p2-2023

9 questões com quatro alternativas e 26 com cinco.

### farmaco-p2-2024

8 questões com quatro alternativas e 26 com cinco.

### farmaco-p2-2025

Numeração original 4–45; questões 1–3 ausentes na fonte, sem preenchimento. 36 questões com quatro alternativas e seis com cinco.

### fisiologia-m5-aula-2

Ano explicitamente declarado no HTML: hub “Edição 2026” (linha 1702) e badge “Fisiologia 2026” (linha 1783). Corrige a observação de ano ausente da auditoria; não inferido da sequência.

Módulos independentes: objetivas seguidas de dissertativas, preservando ordem interna e numeração reiniciada, conforme a decisão da POC.

### fisiologia-m5-endocrino-em-grupo-2026

Três casos, oito subitens: q1_a–q1_c, q2_a–q2_b, q3_a–q3_c. mainNum integral em label, num em ID composto; caso completo compartilhado em groups e referências de continuação em context.

Preservados literalmente: “somatostatinahipotalâmica”, “endocitose do colo”, testosterona livre 1200 ng/dL versus referência 3,03 – 14,80 ng/dL e referências à paciente nos subitens de QUESTÃO III. Sem revisão ou correção acadêmica.

### imunologia-b4-2022

Cinco alternativas por item; numeração e conteúdo rico preservados. Nenhuma ambiguidade adicional observada.

### imunologia-b4-2023

Arquivo/catálogo legado B4, título e identificação da prova P4. division P4 segue a identificação explícita da prova; ID conserva origem B4, registrada em sourceFile. Nenhuma questão foi alterada.

### imunologia-b4-2024

Arquivo/catálogo legado Imunologia; título e conteúdo Microbiologia/Virologia. subject segue título/conteúdo, ID conserva identidade do arquivo para distinguir da outra prova Microbiologia 2024. Fonte legada intacta.

### imunologia-b4-2025

Cinco alternativas por item; numeração e conteúdo rico preservados. Nenhuma ambiguidade adicional observada.

### micro-b4-2023

Cinco alternativas por item; numeração e conteúdo rico preservados. Nenhuma ambiguidade adicional observada.

### micro-b4-2024

Cinco alternativas por item; numeração e conteúdo rico preservados. Nenhuma ambiguidade adicional observada.

### micro-b4-2025

Cinco alternativas por item; numeração e conteúdo rico preservados. Nenhuma ambiguidade adicional observada.

### parasito-b4-2025

30 categorias para 31 questões, uma repetida. Bug setItem do motor legado não transportado para dados.

### patologia-b3-2025

Quatro alternativas em cada questão.

### propedeu-p2-2024

Quatro alternativas em cada questão.

### propedeu-p2-2025

Quatro alternativas em cada questão; 15 categorias.

## Método e checkpoints

`scripts/migrate-exam.ts <id>` exige uma única prova, protege a POC e recusa sobrescrever arquivos.
Acorn extrai somente literais; Zod rejeita campos inesperados; parse5 converte nós permitidos sem executar scripts.
IDs novos combinam identidade da prova, módulo e num original; nos casos acrescentam id original normalizado.
Os IDs de alternativa são locais à questão, como exige o Schema v1. Referências a módulos/grupos são validadas pelo schema.
Cada conversão compara contagens do inventário e valida o schema antes da escrita. A paridade compara DOMParser/jsdom da fonte com o renderer React real, sem reutilizar o conversor para calcular o esperado.
Compara ordem, IDs, labels, tipos, categorias, textos/Unicode, nós HTML, opções/quantidades, correct zero-based, explicações, modelos, três casos/tabelas e cinco referências de continuação.
A paridade roda em memória, sobre a serialização JSON e sobre o arquivo salvo; qualquer divergência interrompe o checkpoint.
Não há nota automática dissertativa. Nenhuma alteração em schema, engine, renderers ou CSS foi necessária.

## Totais finais e preservação

| Conjunto | Provas | Questões | Objetivas | Dissertativas |
|---|---:|---:|---:|---:|
| Fase 3, novas migrações | 16 | 455 | 442 | 13 |
| POC da Fase 2 preservada | 1 | 30 | 20 | 10 |
| Total canônico/catalogado | **17** | **485** | **462** | **23** |

123 objetivas têm quatro alternativas e 339 têm cinco: 2.187 alternativas no total.
Paridade dos 3.165 campos ricos do acervo (3.005 novos + 160 da POC), incluindo
485 enunciados, 2.187 alternativas, 462 explicações, 23 modelos e oito textos de caso/continuação.
Três grupos preservam os três casos completos/tabelas; cinco contextos preservam as continuações.
A numeração de navegação não substitui label nem determina IDs.

`git diff --exit-code d029f44501e32f0358160a613ce262379dc26af1 -- simulados simulados.json index.html '*.js' .github/workflows data/exams/fisiologia-m5-aula-1-2026.json`
confirmou as fontes legadas, scripts, workflow e POC idênticos à base.
O teste global repete essa verificação. Schema v1, engine, renderer, persistência,
Design System, loader e gerador de catálogo não foram alterados.

O único ajuste compartilhado foi no extrator de migração: rejeita propriedades
JS duplicadas e verifica tokens HTML antes do parsing de fragmentos, incluindo
tags/atributos que o parser poderia ignorar. Há regressões para esses casos.
`@types/jsdom` foi adicionado apenas como dependência de desenvolvimento para a
comparação independente do DOM em TypeScript; lockfile atualizado.

## Validação final

| Comando | Resultado |
|---|---|
| `npm run audit:legacy` | OK: 17 HTMLs = hub = simulados.json; 485 = 462 + 23 |
| `npm run validate` | OK: 17 JSONs, 485 questões, referências/IDs/assets válidos |
| `npm run typecheck` | OK |
| `npm test` | OK: 80 testes em 11 arquivos, incluindo 16 paridades parametrizadas e a POC existente |
| `npm run build` | OK: Vite, base path /CHATGPT/, catálogo automático |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser` | OK: 10 testes, cinco desktop e cinco mobile |

Instalação via `npm ci --cache /tmp/phase3-npm-cache` para respeitar os diretórios
escrevíveis do ambiente; manifesto/versões de runtime da Fase 2 mantidos.
O servidor local do Playwright não abriu na sandbox sem rede. O mesmo comando
passou com permissão adicional de rede para servidor local/Chromium, conforme Fase 2.
A primeira execução encontrou um seletor novo incorreto para a continuação: texto
junto do título no mesmo bloco. Corrigido para verificar o bloco de contexto e sua
frase integral, sem modificar conteúdo, renderer ou remover qualquer teste.

A verificação de navegador abre todos os 17 JSONs pelo loader real, compara os
payloads servidos e o catálogo com os dados, rejeita requests ao HTML legado/API
GitHub e verifica todos os caminhos sob /CHATGPT/.
Percursos completos representativos: Farmacologia 2025 (objetiva), Hormônios
Pancreáticos (mista), Endócrino em Grupo (dissertativa, três casos/tabelas) e POC.
Cobertura: desktop/mobile, claro/escuro, seleção/texto, reload/restauração,
finalização, resultado persistido e revisão com respostas bloqueadas/modelos.
Não há overflow horizontal nos percursos verificados, inclusive caso com tabela.
Capturas inspecionadas: objetiva desktop claro, dissertativa mista mobile escuro,
caso/tabela mobile claro e revisão de caso desktop escuro, em `test-results/`.

## Entrega e limites

16 commits individuais de dados, cada um acompanhado do checkpoint na tabela.
Um commit inicial prepara inventário, conversor e testes; um commit final reúne
validação global/navegador e evidências. As SHAs locais da migração estão abaixo.
A publicação deve preservar exatamente a árvore validada e a sequência auditável.
PR em rascunho para refactor/json-exam-engine, sem merge.
Main não foi usada nem alterada. Fase 4 não iniciada: sem remoção do legado,
publicação do site, CI/CD final ou importação de persistência antiga.


| Commit local | Mensagem |
|---|---|
| fd5f5ce | test: add strict per-exam migration checkpoints and independent parity |
| 393cbc4 | data: migrate Farmacologia 2023 to exam schema |
| 6a3510e | data: migrate Farmacologia 2024 to exam schema |
| 378730e | data: migrate Farmacologia 2025 to exam schema |
| 283eb78 | data: migrate Fisiologia Hormônios Pancreáticos to exam schema |
| aa97743 | data: migrate Fisiologia Endócrino em Grupo to exam schema |
| 5b64203 | data: migrate Imunologia 2022 to exam schema |
| 93be6ba | data: migrate Imunologia P4 2023 to exam schema |
| dc48f03 | data: migrate Microbiologia e Virologia 2024 (origem imunologia) to exam schema |
| 528bce7 | data: migrate Imunologia 2025 to exam schema |
| 66d16c8 | data: migrate Microbiologia 2023 to exam schema |
| 5cc37bf | data: migrate Microbiologia 2024 to exam schema |
| 5662e82 | data: migrate Microbiologia 2025 to exam schema |
| 8db0f47 | data: migrate Parasitologia 2025 to exam schema |
| b414d3c | data: migrate Patologia 2025 to exam schema |
| 373e065 | data: migrate Propedêutica 2024 to exam schema |
| 2719eb2 | data: migrate Propedêutica 2025 to exam schema |
