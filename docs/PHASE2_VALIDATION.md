# Evidências e limites da validação da Fase 2

## Base Git validada antes da implementação

Data: 03/10/2026. Repositório exclusivo: `user210398-afk/CHATGPT`.

1. `git remote -v` foi o primeiro comando de shell; `/workspace` não era um
   repositório. O checkout foi localizado em `/workspace/CHATGPT` e o comando
   repetido nele confirmou o origin HTTPS correto.
2. `git fetch origin --prune` foi executado com acesso de rede ao proxy do ambiente.
   O primeiro fetch foi bloqueado pela restrição local de rede, não por autenticação.
3. O refspec do clone era somente `+refs/heads/main:refs/remotes/origin/main`.
   Por isso o switch inicialmente não encontrou a referência local remota.
   `git ls-remote --exit-code --heads origin refs/heads/refactor/json-exam-engine`
   confirmou a branch no servidor; ela foi buscada explicitamente.
4. `git switch -C refactor/json-exam-engine origin/refactor/json-exam-engine`,
   `git status` e `git log -1 --oneline` confirmaram a base `8d90b35`, árvore limpa
   e os dois documentos obrigatórios presentes. Nenhuma implementação foi feita
   sobre main.
5. Ambos os documentos da Fase 1 foram lidos integralmente. A implementação foi
   isolada em `codex/phase2-json-exam-engine`, derivada dessa base, para futura PR
   em rascunho com destino `refactor/json-exam-engine`.

Não foi executado `git push`, não houve tentativa de corrigir autenticação nem
pedido de credenciais. A publicação deve seguir o fluxo de PR da interface.

## Conferência direta do legado

Inspecionados: hub/índice inline, `simulados.json`, workflow de organização,
scripts auxiliares, motores objetivos, mistos e dissertativos, persistência,
resultados, navegação, busca, tema e conteúdo rico com casos/tabelas.

`npm run audit:legacy` reconfirmou programaticamente:

| Item | Resultado |
|---|---:|
| HTMLs / entradas inline / simulados.json | 17 / 17 / 17, caminhos iguais |
| Questões | 485 |
| Objetivas / dissertativas | 462 / 23 |
| Provas objetivas / mistas / dissertativas | 14 / 2 / 1 |
| Gabaritos objetivos fora dos limites | 0 |
| Imagens acadêmicas no legado | 0 |

Uma passagem **em memória**, sem gerar JSONs adicionais, verificou os 3.165
campos textuais dos bancos (enunciados, alternativas, explicações, modelos e
casos) com a lista segura de tags. Nenhum exigiu tags/atributos além do contrato.
As 16 provas restantes não foram migradas.

### Discrepâncias da auditoria e achados confirmados

- **Scripts carregados:** a auditoria afirma que `backup-medsim.js` e
  `grifar-borracha.js` não são referenciados. O `index.html` atual, linhas
  1932–1933, carrega ambos. A implementação preserva esses scripts no legado e
  não os classifica como código morto. A inspeção confirma carregamento, não um
  teste funcional completo de todas as funções de backup/marca-texto.
- **Retomada da POC no legado é parcial:** `saveState` salva respostas, mas
  `loadState` restaura apenas preferências de layout/tema/sidebar; `startModule`
  reinicializa respostas e marcações. Portanto a descrição geral da Fase 1 não
  prova restauração de tentativa nessa prova. A arquitetura nova implementa e
  testa a retomada integral da tentativa.
- **Problemas já documentados confirmados:** Parasitologia usa `setItem` no
  carregamento; o hub consulta repo `Simulado`; Imunologia 2024 contém título de
  Microbiologia/Virologia; Imunologia 2023 tem divergência B4/P4; casos de Endócrino
  incluem tabelas, continuação e `mainNum` textual. Não foram corrigidos nem
  migrados silenciosamente.
- **POC:** não existe ordem global entre módulos; a concatenação é registrada em
  `provenance.notes` e `POC_MIGRATION.md`. Nenhum gabarito acadêmico foi alterado.

A entrada de desenvolvimento usa `app/main.ts` para importar o bootstrap de
`src/app/`, evitando que uma referência HTML para fora do root perca o base path.
O fluxo foi confirmado tanto no servidor de desenvolvimento quanto no build.

Os documentos originais da Fase 1 permanecem intactos; esta página registra as
correções de interpretação com base no código real.

## Verificações executadas

| Comando/verificação | Resultado |
|---|---|
| `npm run audit:legacy` | Paridade e contagens confirmadas |
| `npm run validate` | Uma prova válida, 30 questões |
| `npm run typecheck` | Sem erros TypeScript/imports |
| `npm test` | 36 testes fundamentais passando em sete arquivos |
| `npm run build` | Vite gera artefato estático com `/CHATGPT/` |
| Smoke test de `npm run dev` em Chromium | Catálogo e POC abrem sob `/CHATGPT/`, sem erros |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser` | Dois percursos passando: desktop e mobile |
| Paridade independente do DOM | 30 enunciados, 100 alternativas, 20 gabaritos/explicações, 10 modelos |
| Diff de fontes legadas contra `8d90b35` | Sem alterações nos 17 HTMLs, hub, JSON antigo, scripts ou workflow |
| Busca de runtime novo | Sem `innerHTML`, `dangerouslySetInnerHTML`, iframe, API GitHub ou `/Simulados/` |

O legado não possuía testes automatizados existentes. A suíte desta fase cobre
schema, IDs/referências, alternativas variáveis, estrutura de dissertativa,
casos/tabelas, segurança de nós/imagens, geração do catálogo, loader e erros,
resposta/mudança, navegação, marcação, progresso, finalização, resultado,
persistência/restauração, histórico, estado inválido e storage indisponível.

As integrações testam a POC efetiva e `loader → state → renderer`. Os percursos
Chromium partem do catálogo gerado do build, respondem objetiva e dissertativa,
restauram após reload, persistem dark mode, finalizam, restauram resultado,
revisam e iniciam nova tentativa. Eles verificam ausência de erros de página,
respostas HTTP >=400, requests fora do base path e dependência de HTML legado.
O mobile também verifica ausência de overflow horizontal. Capturas de desktop
claro/mobile escuro foram inspecionadas; não há matriz completa de navegadores.

O Vitest define `BASE_URL` como `/` em seu ambiente; o setup dos testes usa o
`base` efetivo de `vite.config.ts`. O teste de navegador valida as URLs reais do
build, sem simular essa configuração.

## Contrato para a Fase 3

1. Migrar as **16 restantes**, sem criar novos motores, páginas HTML por prova ou
   CSS por disciplina. `data/exams/<id>.json` é a única fonte acadêmica nova.
2. Manter `schemaVersion: 1`, IDs estáveis e `revision` explícita. Não reaproveitar
   IDs por causa de número repetido; preservar `label`, seção e grupo.
3. Preservar ordem, enunciados, opções/prefixos, gabaritos posicionais, explicações,
   modelos, Unicode e contexto. Comparar campo a campo com a fonte e registrar
   proveniência/ambiguidades; nunca inventar questões ausentes nem corrigir
   gabaritos sem decisão explícita.
4. Representar os casos e subitens com `groups`, `groupId`, `context` e labels,
   preservando tabelas e textos de continuação. Não achatá-los nem introduzir HTML
   arbitrário ou estilos dos documentos de origem.
5. Para ano ausente, usar `null` e registrar a lacuna. Resolver classificação
   Imunologia 2024 e divisão B4/P4 de 2023 explicitamente, sem inferência silenciosa.
6. Usar somente caminhos de mídia locais permitidos, com alt e arquivo existente.
   Não inserir base path nos JSONs; ele é resolvido pela aplicação.
7. Não editar homepage, índice gerado ou `simulados.json` para cadastrar provas.
   Executar validação e build para gerar o catálogo automaticamente.
8. Não importar automaticamente históricos legados ambíguos. Alterações de
   conteúdo compatíveis com tentativa exigem política explícita de revisão;
   formatos futuros exigem versionamento, não heurísticas de restauração.
9. Repetir paridade acadêmica por prova, testes pertinentes, typecheck e build.
   Confirmar 17 provas/485 questões ao final da migração completa, respeitando
   os totais/tipos da auditoria e eventuais decisões documentadas.
10. Preservar legado, workflow e escopo das fases posteriores até autorização
    específica. Esta entrega não inclui publicação, CI/CD final, code review
    final, QA final nem remoção do acervo antigo.
