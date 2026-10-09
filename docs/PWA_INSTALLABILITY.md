# MedSim — PWA-1 e reforço de segurança

## Base e escopo

Base verificada: `main` em `5a15d4028dfecce458f8f701f0150642de0fb187`.
Branch: `codex/phase-pwa1-security-hardening`. Consulta de 08/10/2026
(America/Sao_Paulo): nenhum PR aberto; CI e Pages dessa main concluídos com
sucesso; Content Gate do PR de conteúdo anterior verde; Pages por workflow,
HTTPS obrigatório e homepage HTTP 200. O checkout original foi preservado;
o worktree da fase parte do SHA remoto confirmado, não da referência local antiga.

Acervo atual: **21 provas / 562 questões / 522 objetivas / 40 dissertativas**.
Não há alterações em `data/`, `authoring/`, schemas acadêmicos, engine,
gabaritos, renderer acadêmico, contratos de storage, backup ou HTML legado.
Nenhuma dependência, conta, backend, API de runtime, tracker, telemetria,
push, sincronização ou deploy automático foi acrescentado.

## Arquitetura

- A entrada oficial permanece `app/index.html`, com build Vite em `/CHATGPT/`.
- Manifest, PNGs e worker são arquivos locais de `public/`, copiados pelo Vite.
- `src/pwa/register.ts` registra somente no build de produção, em contexto
  seguro e com suporte; erro de registro não bloqueia o site.
- `usePwaInstall` pertence ao shell React: mantém uma referência ao evento,
  detecta standalone, controla instalação e dispensa sem tocar no engine.
- `PwaInstallPrompt` é reutilizado na Home e nas Configurações, com tokens,
  botões, details/summary e layout do Design System existente.
- `ConnectivityNotice` informa ausência indicada pelo navegador; `useResource`
  comunica falhas reais de carregamento sem substituir dados nem gravar storage.

O card fica depois do hub de matérias, no fluxo do documento. Aguarda uma decisão
no SetupPrompt; não aparece em provas, páginas de matéria/lista, revisão,
sessões ou tour. Não há modal automático, elemento fixo ou reload automático.
Configurações mantém a seção **MedSim no celular** (temporariamente fora da
apresentação do tour), inclusive depois da dispensa; em standalone mostra o estado
instalado e informações de internet/dados em vez de novo convite.

## Manifest e identidade

`public/manifest.webmanifest`: nome MedSim — Prática Médica; short_name MedSim;
pt-BR; display standalone; id/start_url/scope estáveis `/CHATGPT/`;
theme_color `#174ea6`, background_color `#f4f6fa`, conforme os tokens claros.
Todos os caminhos começam em `/CHATGPT/`. As query strings existentes continuam
sendo a navegação oficial, sem router, rewrites ou rotas virtuais.

PNGs reais: 192×192, 512×512, maskable 512×512 e Apple Touch Icon 180×180.
Usam fundo azul opaco e a letra M serifada da marca/favicon atual. O M maskable
está dentro da zona segura central; o fundo pode ser recortado. O favicon SVG
original permanece byte a byte igual. `generate-pwa-icons.mjs` rasteriza o motivo
com Canvas no Chromium local usando Playwright já existente; é uma ferramenta
explicitamente executada, não uma etapa de build/CI nem um recurso remoto.
Os PNGs ficam versionados. O validador confere assinatura, dimensões, canais,
chunks e dados PNG descomprimidos; Chromium também decodifica os arquivos.

## Instalação por navegador

A capacidade nativa vem de `beforeinstallprompt`, não do user-agent. O evento só
é retido se oferecer prompt e userChoice; o prompt é consumido uma vez e chamado
exclusivamente no clique de **Instalar MedSim**. Sem evento, não existe botão
nativo fictício: **Como instalar** oferece instruções. Recusa/falha permite
continuar pelo site. Accepted significa solicitação aceita; a UI só afirma
instalação confirmada com `appinstalled`. Não há armazenamento do evento.

Standalone usa `display-mode: standalone`, mudanças do media query, pageshow e
`navigator.standalone` do iOS. O user-agent/touchPoints serve somente para escolher
o texto do guia, incluindo iPad que se identifica como Macintosh.

- **Chrome Android:** menu ⋮, Instalar aplicativo ou Adicionar à tela inicial;
  se houver evento nativo, usa o prompt do navegador.
- **Samsung Internet:** menu próprio, Adicionar página a → Tela inicial ou
  Instalar aplicativo, com nomes/posição variáveis. Usa prompt nativo se disponível.
- **Safari iPhone/iPad:** abrir no Safari, Compartilhar, Adicionar à Tela de
  Início, ativar abertura como aplicativo da web quando oferecida, confirmar.
  Outro navegador no iPhone recebe orientação para abrir o endereço no Safari.
- **Outros:** procurar a opção no menu; quando não existir, continuar usando o
  site. Um atalho pode abrir no navegador; não se promete standalone universal.

A dispensa usa somente `medsim:pwa:v1:install-dismissed` com valor literal
`dismissed`. Reads são zero-write; valor inválido é preservado. Falha de storage
mantém dispensa em memória e informa que não foi salva. Storage events releem
o valor atual em vez de confiar no payload. Não há migração de preferências,
enumeração, clear ou deleção de dados. Se armazenamento estiver bloqueado,
persistência entre documentos não pode ser garantida.

## Service worker: rede e cache

URL `/CHATGPT/sw.js`, scope `/CHATGPT/`, `updateViaCache: none`.
O escopo inclui o legado pela topologia do site, mas o fetch handler aceita
**somente GET, mode navigate, mesma origem e pathname exato `/CHATGPT/` ou
`/CHATGPT/index.html`**. Query strings são preservadas. Todo outro request passa
pelo comportamento normal do navegador, incluindo catálogo/provas/JSONs,
assets, ícones, mídia, legado, backups, POST e origens externas.

**Cache Storage: zero entradas, zero caches próprios, zero precache.** Não há
cache-first ou network fallback de JSON. Navegação moderna usa a rede com
`cache: no-store`; erros HTTP continuam sendo erros HTTP, sem virar uma página
de sucesso. Somente rejeição da rede nessa navegação gera HTML informativo
embutido no próprio worker, status 503 e Cache-Control no-store. Não contém
conteúdo acadêmico ou pessoal, usa CSP de resposta `default-src 'none'` e não
precisa buscar um asset offline. O link para tentar de novo depende de ação do
usuário. A página é propositalmente simples e sem recursos de rede.

O cache HTTP normal do navegador/GitHub Pages continua sob suas políticas para
os requests que não são interceptados; sua eventual disponibilidade não é uma
garantia de suporte offline. Nenhuma semântica de fetch acadêmico foi alterada.
Sem worker já ativo/controlando, a primeira abertura offline mostra o erro do
próprio navegador. O modo offline dos simulados **não está implementado**.

## Instalação, ativação, atualização e remoção do worker

Não há install/activate handlers, importScripts, código dinâmico, mensagens,
skipWaiting, clients.claim, loop de update ou controllerchange que recarregue.

1. Registro inicial: o navegador baixa o arquivo local e instala/ativa com seu
   ciclo padrão; não passa a controlar à força o documento que já está aberto.
2. Navegação posterior sob scope: o worker ativo controla o novo documento.
3. Mudança dos bytes de sw.js: o navegador verifica e instala a atualização.
   Um novo worker aguarda todos os clientes controlados pelo anterior saírem,
   incluindo outras abas/standalone/legado sob esse scope. Fechar apenas uma aba
   pode não bastar. Uma recarga com outras abas abertas não força a ativação.
4. Falha inicial ou de atualização: site online continua disponível; um worker
   anterior válido permanece ativo. A falha não vira confirmação de instalação.
5. Atualização nunca chama reload nem modifica tentativas/drafts/storage. Os
   assets/HTML do site seguem a publicação e HTTP normais; não há shell antigo
   precacheado. Não existe promessa de upgrade imediato em todas as abas.
6. Remoção técnica: unregister **apenas** a registration cuja scope e scriptURL
   correspondam ao MedSim em DevTools/Application. Fechar clientes controlados
   libera o controle antigo. Não usar “clear site data”: isso apagaria progresso.
   Remover o ícone pela UI do sistema é decisão do usuário; pode remover o
   armazenamento do ambiente instalado. Exportar backup antes.

Como esta versão nunca cria caches próprios, não há limpeza de caches obsoletos
a executar. Ela não enumera/apaga caches de terceiros. Se uma fase futura criar
caches, deverá nomeá-los/versioná-los e limpar exclusivamente os seus caches,
com plano de rollback e atualização sem perda de estado.

## Conectividade e dados locais

`navigator.onLine` é auxiliar. Offline informa a limitação; online apenas remove
essa indicação, não prova acesso ao servidor nem afirma recuperação de dados.
TypeError de request também informa falha quando onLine=true. HTTP/JSON/schema
continuam sendo validados pelo loader existente, com erros e sem sucesso fictício.
Não há retries, substituição por dados antigos ou reload automático.

Uma prova em memória continua montada; o aviso não bloqueia respostas nem
altera estados acadêmicos. Isso protege progresso existente e não constitui
suporte oficial offline. Salvamento continua local com as mensagens/garantias
do repository atual; nenhum salvamento remoto foi introduzido.

localStorage não é criptografado nem um banco autenticado. A instalação não cria
conta ou transmite histórico. Navegador e app instalado podem ter ambientes de
storage diferentes, principalmente no iOS; não existe sync. Antes da troca,
exportar backup em Configurações → Dados, guardar o arquivo e importar no destino
com a prévia/confirmação existentes. O backup v3 atual não inclui annotations ou
eliminações temporárias; o aviso explicita esse limite. Não apagar o ambiente
original confiando que esses dados foram transferidos. Contratos, snapshot raw,
validação acadêmica, merge, rollback e detecção de conflitos permanecem intactos.

## CSP efetiva e XSS

A meta CSP é a primeira política da entrada moderna, após charset e antes dos
recursos. Produção:

```text
default-src 'none'; script-src 'self'; script-src-attr 'none';
style-src 'self'; style-src-attr 'none'; img-src 'self'; font-src 'self';
connect-src 'self'; worker-src 'self'; manifest-src 'self';
object-src 'none'; base-uri 'none'; form-action 'none'
```

Sem unsafe-inline/unsafe-eval, CDN, Google Fonts, endpoints ou schemas executáveis.
Scripts e CSS Vite são externos/locais. React atualiza propriedades CSS pelo
CSSOM para gráficos/tour; isso não exige liberar style tags ou atributos HTML
arbitrários. A suíte existente verifica esses fluxos com a CSP de produção.
Somente `vite serve` remove a meta para HMR de desenvolvimento; preview e build
mantêm a política. Não se usa nonce estático ou hash fictício.

GitHub Pages não aplica `_headers`. CSP por meta **não equivale** a HTTP header:
só protege o documento moderno depois da meta, não as respostas de JSON/worker,
nem o HTML histórico. frame-ancestors, sandbox e reporting por meta não fornecem
as mesmas garantias de header. Não há alegação de proteção contra embedding ou
clickjacking. Não se acrescentou frame-ancestors ineficaz. Headers como
frame-ancestors, X-Content-Type-Options e políticas de resposta exigiriam no
futuro hospedagem/configuração que permita headers; nenhum serviço foi adicionado.
Scripts da própria origem continuam confiáveis: CSP não elimina comprometimento
da origem nem substitui validação/revisão de código.

Componentes novos usam somente texto React e guias constantes, sem HTML recebido,
dangerouslySetInnerHTML, eval, links dinâmicos ou execução de payload de navegador.
O resultado de userChoice é interpretado por valores conhecidos, nunca exibido
como HTML. O renderer acadêmico e a allowlist/schema atuais continuam intactos.
Testes existentes de tags/URLs maliciosas e backups inválidos permanecem ativos;
teste Chromium comprova violações CSP de script inline, event handler e connect
externo com código malicioso não executado. Worker tem origem/paths/método
explicitamente limitados. Não há scripts remotos ou armazenamento pessoal nele.

## Dependências, CI e cadeia de publicação

Auditoria do lockfile via `npm audit --json` (produção **e** desenvolvimento), em
08/10/2026: **0 info / 0 low / 0 moderate / 0 high / 0 critical**; 185 dependências
reportadas pelo npm, incluindo variantes opcionais (5 prod e 181 dev reportadas,
categorias não são disjuntas). Nenhum pacote afetado ou correção necessária foi
identificado nessa consulta. Não foram atualizadas versões nem alterado o lockfile.
React/React DOM/Zod são runtime; Playwright/Vite/Vitest/tsx/TypeScript/parser e
ferramentas são desenvolvimento/build/authoring. Ausência de advisories conhecidos
nesta data não é garantia de ausência de vulnerabilidades.

`npm run audit:security` executa a mesma auditoria integral, imprime severidade,
direta/transitiva (isDirect), nodes/via e fixAvailable quando houver findings.
Low/moderate são relatados e exigem triagem documentada de uso dev/runtime,
explorabilidade e patch compatível. High/critical falham; falha de rede/registry
também falha, sem converter auditoria incompleta em verde. Runtime grave
explorável é bloqueador. Baseline zero evita permitir silenciosamente problemas
antigos; eventual exceção futura precisará decisão revisada, prazo e justificativa.
Sem audit fix --force, upgrade major automático ou allowlist oculta.

A etapa foi adicionada **somente ao CI read-only**. CI e Content Gate mantêm
contents: read, checkout sem persist-credentials e npm ci. Pages mantém dispatch
manual em main com PUBLICAR, build read-only, deploy com pages:write/id-token:write
somente no job dedicado. Legado/manual, gatilhos de publicação, gates, npm lockfile
e separação CI/Content Gate/Pages não mudaram. Actions continuam nas versões por
tag já utilizadas; pinning SHA/revisão de updates pode ser avaliado depois, sem
alegar imutabilidade de tags. Não há download/execução de shell remoto, novos
segredos ou credenciais no runtime. Validação do bundle rejeita formatos comuns
de chaves/tokens e recursos externos; esse check não substitui revisão humana.

## Validações e evidência

Vitest integral final: **51 arquivos / 1.525 testes passaram**, sem skips/falhas
(1.502 existentes + 23 PWA/segurança). `npm ci`, `audit:legacy`, `validate`,
`author:validate` (4 candidates reais), `typecheck`, `audit:security`, `build`,
`validate:dist`, `author:gate` (0 adições) e `git diff --check` passaram.
Playwright integral: **442 execuções passaram**, sem skips/falhas (414 existentes
e 28 PWA/segurança, desktop e mobile). Os 132 testes dos guards/PWA também passaram
após staging, incluindo todos os arquivos novos na comparação Git. Smoke de
desenvolvimento/HMR: catálogo renderizado sem erros, CSP removida somente no dev.
Após o refinamento final de diagnóstico HTTP com onLine=false, o build e
validate:dist foram repetidos; os **28 testes PWA/segurança de navegador** passaram
novamente no artefato final. A suíte Vitest integral já inclui esse refinamento.

Testes novos: manifest/PNG/paths, registro, disponibilidade, accepted/
recusa/falha, confirmação, standalone, guias, storage bloqueado/corrompido,
integridade acadêmica, infra, policy de fetch e erro de rede/HTTP. Chromium
desktop/mobile: CSP real, fluxo com eventos simulados, perfil não privado com
CDP getAppManifest/getInstallabilityErrors, responsividade 375/390/768/1280,
tema/high contrast/large/compact/reduced motion, foco/teclado e targets ≥44px,
modo instalado simulado iOS, tour, fallback offline e restauração online.

Teste de lifecycle serve o **mesmo worker de dist** em origem localhost isolada:
update inválido, versão válida esperando duas abas, nenhum reload do solver,
resposta/storage preservados, cache alheio preservado na ativação e unregister.
Não usa skipWaiting ou claim para acelerar o teste. O CDP em perfil privado
retornou in-incognito na primeira rodada; foi corrigido o ambiente do teste para
perfil temporário não privado, sem relaxar a assertion de instalabilidade.

Fixtures históricas de dist receberam os novos arquivos/meta. Os guards antigos
mantêm as assertions acadêmicas; as exceções são paths exatos de CI/package/Vite
e worker autorizados nesta fase, com guard novo para a única etapa/script e
configuração permitidos. A assertion do SetupPrompt foi delimitada ao próprio
componente para não confundir o botão Agora não do PWA. Não há remoção/skip de
testes acadêmicos ou uso de dados modificados para fazer validação passar.

## Checklist manual obrigatório antes de publicar

**Pendente, sem evidência de testes físicos nesta entrega.** Chromium/CDP,
user-agent simulado e viewports não equivalem a Safari/Samsung/Android reais.
Registrar modelo, versão do OS/browser, data, resultado e evidências por item.

| Item                                                                        | Chrome Android | Samsung Internet Android | Safari iPhone                    |
| --------------------------------------------------------------------------- | -------------- | ------------------------ | -------------------------------- |
| Abrir release candidata por HTTPS sob /CHATGPT/                             | Pendente       | Pendente                 | Pendente                         |
| Manifest/ícone/nome e aparência ao instalar                                 | Pendente       | Pendente                 | Pendente                         |
| Fluxo nativo quando oferecido; recusa sem bloqueio                          | Pendente       | Pendente                 | Não aplicável ao prompt Chromium |
| Menu específico; Compartilhar/Tela de Início/abrir como web app no iOS      | Pendente       | Pendente                 | Pendente                         |
| Abrir ícone em standalone quando suportado; convite oculto                  | Pendente       | Pendente                 | Pendente                         |
| Avisos internet, armazenamento local e backup compreensíveis                | Pendente       | Pendente                 | Pendente                         |
| Export/import no novo ambiente; diferenças de storage                       | Pendente       | Pendente                 | Pendente                         |
| Offline antes/depois de carregar; sem prova/JSON antigo servido pelo worker | Pendente       | Pendente                 | Pendente                         |
| Reconectar por ação explícita; tentativas existentes restauráveis           | Pendente       | Pendente                 | Pendente                         |
| Duas abas + app aberto: update espera, sem reload/perda de resposta         | Pendente       | Pendente                 | Pendente                         |
| Claro/escuro/alto contraste/texto grande/compacta/rotação/toque             | Pendente       | Pendente                 | Pendente                         |
| TalkBack/VoiceOver, foco/teclado e movimento reduzido                       | Pendente       | Pendente                 | Pendente                         |
| Prova/revisão/tour não recebem convite sobreposto                           | Pendente       | Pendente                 | Pendente                         |

Não publicar esta fase sem revisão humana e teste real do fluxo de cada plataforma.
A execução desses testes pode usar um artefato em ambiente de QA aprovado;
não foi criado servidor de produção ou deploy nesta fase. Stop point: Draft PR.

## Futuras fases e continuidade

Offline exige decisão separada sobre conteúdo autorizado, revisão/gabarito,
versionamento, download explícito, integridade, espaço/eviction, atualização
transacional, múltiplas abas, backup e experiência de conflitos. Esta primeira
fase não reserva caches de conteúdo nem altera contratos para antecipar isso.
Segurança com headers, pinning das Actions e detecção/UX de update podem ser
reavaliados conforme infraestrutura e evidências, sem forçar reload no solver.

Para atualizar posteriormente MEDSIM_CONTINUIDADE.md: registrar link do Draft PR,
branch/commit final, 21/562/522/40 preservados, PWA instalável online, zero Cache
Storage, CSP meta com limitações, auditoria zero, resultados finais e checklist
físico pendente. O arquivo de continuidade não foi modificado automaticamente.
