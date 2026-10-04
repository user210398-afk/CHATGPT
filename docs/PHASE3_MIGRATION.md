# Migração da Fase 3

Repositório exclusivo: user210398-afk/CHATGPT. Branch: codex/phase3-migrate-remaining-exams.
Base remota refactor/json-exam-engine confirmada por fetch e ls-remote: d029f44501e32f0358160a613ce262379dc26af1.
Checkout original work; switch para a base validada antes de qualquer edição, seguido da nova branch.
Documentos obrigatórios lidos integralmente, incluindo AGENTS.md. Main não utilizada.

## Lista e classificação antes da migração

As 16 entradas abaixo seguem EXAM_INVENTORY.md, excluindo a POC.
14 objetivas, uma mista e uma dissertativa com caso/subitem/tabela.
Todos os enunciados/categorias/opções/gabaritos/modelos permanecem na ordem original.

| Legado | JSON previsto | Classificação | Total | Obj. | Diss. | Paridade |
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
| `simulados/propedeu-p2-Simulado 2024.html` | `data/exams/propedeu-p2-2024.json` | objetiva simples; conteúdo rico | 20 | 20 | 0 | Pendente |
| `simulados/propedeu-p2-Simulado 2025.html` | `data/exams/propedeu-p2-2025.json` | objetiva simples; conteúdo rico | 20 | 20 | 0 | Pendente |

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

Preservados literalmente: “somatostatinahipotalâmica”, “endocitose do colo”, testosterona livre 1200 ng/dL versus referência 3,03 – 14,80 ng/dL e paciente/pacienta com identificação variável. Sem revisão ou correção acadêmica.

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
Não há nota automática dissertativa. Nenhuma alteração em schema, engine, renderers ou CSS prevista/necessária.

## Validação final

Pendente.
