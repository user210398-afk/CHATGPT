# Ferramentas explícitas de grifo e borracha

Implementação local sobre `a9ea0b1ba9048fec615f6c6a91a2d8784a9fb90e`.
Worktree: `/workspace/annotation-gesture-tools`; branch: `codex/annotation-gesture-tools`.
Sem staging, commit, push, PR, merge ou publicação.

## Identidade registrada antes da primeira edição

Checkout inicial, limpo:

```text
git rev-parse --show-toplevel → /workspace/CHATGPT
git rev-parse --git-dir → .git
git rev-parse --git-common-dir → .git
git branch --show-current → work
git rev-parse HEAD → a9ea0b1ba9048fec615f6c6a91a2d8784a9fb90e
git status --short → vazio
```

Não havia merge/rebase/cherry-pick/sequencer em andamento. Não existe main local;
origin/main local estava em `31e1ce2f093932720d587535f675a34e8b1ad6fc`.
A consulta remota foi abortada; o supervisor revalidou o main remoto e o usuário
instruiu usar o SHA presente, sem novas consultas/fetch/pull/reset/rebase.

Worktree novo, limpo, antes da primeira edição:

```text
git rev-parse --show-toplevel → /workspace/annotation-gesture-tools
git rev-parse --git-dir → /workspace/CHATGPT/.git/worktrees/annotation-gesture-tools
git rev-parse --git-common-dir → /workspace/CHATGPT/.git
git branch --show-current → codex/annotation-gesture-tools
git rev-parse HEAD → a9ea0b1ba9048fec615f6c6a91a2d8784a9fb90e
git status --short → vazio
```

## UX e gesto

Barra no fluxo do documento, acima do statement, disponível sem Selection.
Botões reais Grifar/Borracha, mutuamente exclusivos, e Amarelo/Verde/Azul com
aria-pressed; estado ativo também usa borda, peso e sublinhado visual. Cor padrão
amarela, somente em memória. Status curto anuncia mudanças de modo, não movimentos.
Escape ou clique na ferramenta ativa desliga. Keyboard ativa modos/cores e remove
ou limpa destaques; não há mecanismo de pintura por teclado nesta rodada.

Um único caminho Pointer Events para mouse, touch e pen. Aceita somente pointer
primary, botão principal pressionado; segundo pointer não interfere. Down resolve
boundary acadêmico e tenta capture. Move só atualiza preview. Up com boundary
válido executa uma única chamada à mutation existente. Há limiar de 3 CSS pixels
para descartar taps/jitter, além de exigir dois boundaries distintos. Não há
seleção automática de palavra.

Identidade transitória contém questionId, pointerId, ferramenta, cor, anchor e
origem espacial. Chave de remount inclui exam/revision/question/scope. Troca de
ferramenta/cor, Escape, question/scope, blocked, cancel, lost capture e unmount
cancelam. Capture/release são defensivos. Release zera stroke antes de liberar
capture. Pointer antigo não finaliza gesto novo.

## Scroll e seleção

Somente `.statement[data-annotation-tool="highlight"|"eraser"]` recebe
`touch-action:none`, `user-select:none`, `-webkit-user-select:none` e callout none.
Isso permite o statement assumir um gesto de um dedo enquanto a ferramenta está
ativa. O restante da página continua rolável; não há lock no body/html, bloqueio
global de zoom, listeners globais de touch, ou prevenção global de pointer events.
Off remove esse comportamento imediatamente e restaura scroll, copy, seleção e
zoom habituais. A pintura não escuta selectionchange.

## Hit-test e autoridade acadêmica

`coordinateToStatementOffset` usa caretPositionFromPoint quando disponível;
caretRangeFromPoint é o fallback quando a API Position não existe. API que retorna
null/ponto inseguro/erro falha fechada. Não tenta inventar posição.
`domPointToStatementOffset`, também usado pelo adaptador Selection legado, valida
Text nodes contra fragments/path da projeção. Valida continuidade/ordem/completude
dos fragments antes de mapear o ponto. Element boundary é normalizado por ordem de
DOM Range sobre records já validados, sem usar child index como path acadêmico.
DOM text serve somente à validação; não é a autoridade. Sem substring search,
innerHTML, identidade RichNode, normalização Unicode ou separadores inventados.

Contrato 8A permanece DFS determinístico, somente text, UTF-16 exato, br zero.
Boundary no meio de surrogate pair é rejeitado, sem snap. Combining marks conservam
seus offsets exatos, inclusive boundary entre base e marca combinante.
Coordenada fora do statement não mapeia: move mantém somente o último preview
válido; up fora cancela e escreve zero. Os intervalos são min/max entre anchor e
boundary final válido, inclusive reverse/multiline/multileaf e marks fragmentados.

## Preview, álgebra e persistência

Renderer divide fragments pelos boundaries dos highlights oficiais e do preview.
Preview usa spans, sem IDs; mantém IDs oficiais existentes e não gera IDs.
Grifo mostra a cor escolhida com opacidade; borracha mostra contorno tracejado sem
remover os highlights oficiais. Preview nunca entra em storage/Attempt/ReviewSession
ou métricas. Cancel/remove/clear eliminam preview antes de qualquer ação.

`mutateAnnotations`, storageVersion 1, storage keys, raw comparison, limites e
optimistic concurrency não mudaram. IDs só são gerados pela mutation existente.
Highlights 8A existentes são carregados e editados imediatamente. Corrupção e
conflito preservam raw e bloqueiam controles; storage events permanecem read-only.
Não há writes em down/move/cancel/tap/range inválido, nem domínio persistente de
ferramenta ou cor. Scratch e árbitro de 600 ms das alternativas permanecem separados.

## Validação e limitações

Testes unitários usam caret APIs injetáveis e fragments reais; Playwright usa
mouse.move/down/move/up, eventos touch/pen, e entrada touch nativa via CDP Chromium.
CDP/Pixel emulado não equivale a gesto físico iOS/Android. Não foi validado em
hardware físico, Safari/iOS ou stylus real. Navegador sem ambas APIs caret não pinta,
pois não existe inferência alternativa. Sem capture disponível, up fora não grava;
a ferramenta não instala fallback global destrutivo.

## Red-team

Os cenários são exercitados por `tests/annotation-gesture.test.tsx`,
`tests/annotation-hit-test.test.tsx`, `tests/browser/annotation-gesture.spec.ts`,
`tests/browser/phase8a.spec.ts` e regressões 8A preservadas.

| Ataque/caso                                    | Política e evidência                                                                                      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1–2. Sair do statement e soltar fora           | Preview conserva último ponto seguro; up fora cancela zero-write. Mouse real com capture e eventos touch. |
| 3. pointercancel                               | Preview removido, zero-write; unitário e browser.                                                         |
| 4. capture perdido                             | lostpointercapture cancela; release real no Chromium e simulação; zero-write.                             |
| 5–7. Navegar/trocar ferramenta/questão/scope   | Cleanup/remount e cancel; modo off no novo contexto; pointer antigo não grava.                            |
| 8–9. Conflito/corrupção exatamente antes de up | Raw preservado byte a byte e write spy zero; mutation defensiva bloqueia.                                 |
| 10. Segundo dedo                               | pointerId diferente não altera/finaliza/cancela o primeiro; não-primary ignorado.                         |
| 11. Tap rápido                                 | Limiar espacial e boundaries distintos; zero-write.                                                       |
| 12–13. Marks fragmentados/reverse              | Repaint, partial erase e split; mouse real reverse multiline e testes rich/multileaf.                     |
| 14–15. Emoji/surrogate/combining               | Boundary de surrogate rejeitado; combining mantém offset exato; nada normalizado.                         |
| 16. Texto repetido e objeto reutilizado        | Paths distintos mapeiam offsets distintos; testes DOM, gesto e browser rich.                              |
| 17. Element boundary                           | DOM Range sobre records canônicos; br zero, offset normalizado deterministicamente.                       |
| 18. API Position ausente                       | Fallback Range unitário e em Chromium com Position desabilitada.                                          |
| 19. Scroll/seleção off                         | Mouse real seleciona; CDP swipe vertical rola; computed touch-action auto/user-select restaurado.         |
| 20. Scroll on                                  | CDP swipe vertical no statement não rola; somente statement tem touch-action none.                        |
| 21. Alternativas single/double                 | Suítes de rádio, timer 600ms, double lento 450ms, scratch, Study e Review preservadas.                    |

Finding de integridade corrigido, severidade média (defensivo): mover um Text node
registrado para outra posição no DOM mantinha cada fragment válido isoladamente,
mas a sequência visual deixava de corresponder à projeção. Causa: faltava validar
continuidade/ordem/completude dos records. Correção: validação completa em
`domPointToStatementOffset`, além de boundaries inteiros locais. Regressão
`reordered registered nodes and invalid fragment boundaries fail closed`; resultado:
rejeição segura. Não houve alteração da fonte/projeção acadêmica.

Falhas de infraestrutura/teste corrigidas:

- Npm usava cache padrão não gravável; cache em `/tmp/annotation-npm-cache`, sem
  mudança no manifest/lock. Instalação posterior completou.
- Teste de seleção reutilizava coordenadas anteriores à mudança de hint em largura
  móvel. Após recálculo, o helper ainda pressupunha Text único já fragmentado por
  mark. Correção: resolver coordenadas atuais atravessando todos os Text nodes.
  Mesma asserção de seleção não-vazia passou em desktop e mobile; 4 testes de
  regressão mouse/CDP passaram. Assertions não foram relaxadas.
- Fixture do ataque de reorder inicialmente movia um node sem mudar sua ordem
  textual. Corrigida para realmente antepor o último node; a asserção permanece
  null. Não houve mudança de produto para contornar essa falha de fixture.

Não restam findings de produto conhecidos. Riscos de dispositivos físicos e APIs
não disponíveis estão descritos acima, sem extrapolar evidência Chromium.

Finding de lifecycle corrigido, severidade média: trocar a tentativa histórica no
Review mantendo a mesma questão podia reutilizar a identidade genérica `review`
e conservar um stroke. Causa: a apresentação recebia QuestionState sem explicitar
o ID da tentativa existente na identidade transitória. Correção: QuestionCard
aceita o ID já existente como metadado opcional de apresentação e inclui-o em
`review:<attempt.id>`; Exam/ReviewSession continuam usando solverScope. Não há
alteração de schema/Attempt/Review nem persistência desse metadado. Regressão
`historical Review attempt switch with same question cancels the gesture and resets mode`;
resultado: preview removido, modo off, zero ghost write.

A inspeção visual em 375/390 com texto ampliado motivou redução de padding/font-size
apenas na barra; alvos continuam ≥44×44, font-size usa token escalável, layout quebra
linhas sem overflow. Capturas active/off light/dark-high em `/tmp/annotation-*.png`
foram inspecionadas. Matriz automatizada mantém 375/390/768/1024/1280 ×
light/dark/high/dark+high, com texto ampliado em ambos projetos Playwright.
