# Auditoria completa da arquitetura legada — Fase 1

## 1. Escopo, confirmação e método

Auditoria documental do snapshot em `/workspace/CHATGPT`, preparado na branch
`refactor/json-exam-engine`. O ambiente entregue não contém remote Git; a
identidade foi corroborada pelo caminho solicitado e pelo `GITHUB_USER =
'user210398-afk'` do hub. Nenhum remote — em particular nenhum repositório
`Simulados` — foi acessado. O working tree estava limpo antes da documentação.

Foram examinados os **26 arquivos versionados**: 18 HTML (1 hub + 17 provas), 5
JavaScript externos, 1 JSON de catálogo, 1 workflow e o README. Também se
procuraram CSS externo, imagens, outros assets e configurações: não existem no
snapshot. Os CSS e motores de prova estão embutidos nos HTMLs. A extração
programática dos arrays foi confrontada com leitura das estruturas, busca de
referências/caminhos, inventário do Git e comparação de similaridade entre os
HTMLs. O inventário linha a linha está em [`EXAM_INVENTORY.md`](EXAM_INVENTORY.md).

Esta fase **não** define arquitetura definitiva, não altera conteúdo acadêmico,
não migra dados e não modifica publicação, frontend ou workflow.

## 2. Visão geral da arquitetura atual

### Componentes

| Componente | Estado atual |
|---|---|
| `index.html` | SPA sem framework, com CSS e JS inline. Implementa homepage/dashboard, matérias, divisões, catálogo, busca, calendário, configurações, dark mode, rascunho e o contêiner do `iframe`. |
| `simulados/*.html` | 17 aplicações autônomas completas. Cada arquivo repete CSS, layout, motor, dados acadêmicos e persistência. |
| `simulados.json` | Manifesto de 17 caminhos/títulos, gerado pelo workflow, mas não consumido pelo hub atual. |
| `desempenho-estatisticas.js` | Extensão carregada no hub: descobre chaves de histórico, captura resultados, agrega estatísticas, injeta painel e exporta CSV. |
| `ajustes-voltar-hub-v5.js` | Extensão carregada no hub: inspeciona DOM/iframe e injeta/reposiciona o retorno ao hub. |
| `branding-medsim.js` | Extensão carregada no hub: substitui textos/atributos/títulos no documento e iframe por observação do DOM. |
| `backup-medsim.js` | Implementação de backup/restauração/limpeza de dados locais; presente, porém não referenciada por `index.html` nem pelos simulados. |
| `grifar-borracha.js` | Implementação de marca-texto/borracha sobre documentos e iframe; presente, porém não carregada pelas páginas atuais. |
| `.github/workflows/atualizar-index.yml` | Em pushes de HTML, move HTMLs da raiz, reescreve lista inline e `simulados.json`, faz commit e `git push`. |
| `README.md` | Apenas `# Simulados`; não documenta instalação, publicação ou modelo de dados. |

Não há gerenciador de pacotes, build, testes, linter, service worker, backend,
CSS externo, arquivos JSON de questões ou arquivos de mídia locais. Fontes Google
e Phosphor Icons vêm de CDNs.

### Fluxo atual do usuário

1. `index.html` abre a tela de matérias e widgets do dashboard.
2. A lista é formada pela união de `MEUS_ARQUIVOS_MANUAIS` (17 entradas inline)
   com uma tentativa de consulta à API do GitHub. A consulta aponta para o repo
   hardcoded **`user210398-afk/Simulado`** (singular), não `CHATGPT`, e somente
   lista o diretório raiz; em falha, o catálogo manual continua funcionando.
3. O usuário escolhe matéria e divisão (B/P/M) inferidas exclusivamente por
   aliases e regex aplicados ao nome do arquivo, ou usa busca textual também pelo
   nome. Cards são montados via `innerHTML`/template strings.
4. Ao escolher um card, o hub salva o último acesso e abre o HTML relativo num
   `iframe`, acrescentando `?autostart=true`.
5. O simulado mostra seu hub interno ou inicia o módulo objetivo/dissertativo.
   Há navegação por questão, paleta/estados, marcação, notas, cronômetro,
   configurações e finalização.
6. Nas objetivas, `correct` (índice zero-based) corrige a opção e `context`
   fornece a explicação. Nas dissertativas, o aluno escreve, revela `gabarito` e
   se autoavalia.
7. A conclusão produz relatório, revisão por questão, estatísticas/categorias e
   histórico; há exportação textual em várias provas. Um `postMessage` informa a
   conclusão ao hub, que marca o arquivo em `simulados_concluidos`.
8. O estado e históricos ficam no `localStorage`; ao retornar, cada motor tenta
   restaurar uma tentativa. O painel externo observa históricos e mantém sua
   própria camada de tentativas agregadas.

Não existe roteamento por URL: telas são alternadas por classes/`display`; refresh
no hub volta ao estado inicial e uma prova não tem URL de aplicação própria além
do arquivo HTML. Abrir diretamente um HTML funciona como aplicação isolada, mas
sem as extensões externas carregadas apenas pelo pai.

## 3. Estrutura e formatos das questões

### Formato A — objetiva padrão (462 itens; automaticamente migrável com validação)

```text
{ num, type: "objective", category, statement,
  options: ["a) ...", ...], correct: <índice zero-based>, context: "HTML..." }
```

- `statement` contém texto, quebras `\n` e ocasional HTML.
- `options` tem 4 ou 5 strings; a letra está duplicada no conteúdo e não é um
  campo semântico separado.
- `correct` é posição zero-based e todos os valores atuais estão dentro do array.
- `context` mistura mini-resumo, justificativa, comentário das alternativas e
  HTML (`<b>`, `<br>`, listas textuais).
- `num` geralmente é sequencial; Farmacologia 2025 usa 4–45.

Conversão mecânica é viável para os sete campos, mas precisa validar contagem,
índice, prefixos de alternativas, HTML e preservação Unicode. Não se deve inferir
gabarito a partir da letra escrita.

### Formato B — dissertativa simples (15 itens; migrável com regra própria)

```text
{ num, type: "dissertative", category, statement, gabarito: "HTML..." }
```

Usado nas duas aulas de Fisiologia. A resposta do estudante não faz parte do
banco: é estado de execução. Objetivas e dissertativas vivem em arrays distintos
e repetem `num`, então a identidade futura não pode ser somente o número.

### Formato C — dissertativa com caso/subitem (8 itens; tratamento especial)

```text
{ num, id, type: "dissertative", mainNum, category,
  caseText: "HTML/tabela...", statement, gabarito: "HTML..." }
```

Usado em “Endócrino em Grupo”. `id` identifica subitens (`q1_a`, etc.),
`mainNum` preserva a questão principal e `caseText` carrega caso clínico, tabelas
e referências “continuação”. Uma conversão que achate texto perderá agrupamento,
semântica e contexto compartilhado; exige modelo e revisão específicos.

### Dados operacionais, não acadêmicos

Cada HTML mantém globais como `currentModuleType`, `currentQuestions`,
`currentQIndex`, `userAnswers`, avaliações dissertativas, tempos, notas,
marcadores e configurações. Resultados derivam desses arrays e são gravados por
chaves específicas de disciplina em `localStorage`. O histórico agregado externo
tenta descobrir dinamicamente qual chave mudou, acoplando a camada de dashboard
ao formato interno de cada prova.

## 4. Inventário funcional e recomendação conceitual

| Funcionalidade | Classificação | Motivo para a Fase 2 |
|---|---|---|
| Catálogo por matéria/divisão e cards | **Preservar / melhorar** | Fluxo útil; substituir inferência por filename por metadados explícitos. |
| Busca global | **Preservar / melhorar** | Hoje busca só o nome; poderá usar metadados normalizados. |
| Carregamento via `iframe` | **Substituir** | Isola motores duplicados e obriga scripts a inspecionar DOM do frame. |
| Hub interno de cada prova | **Investigar / consolidar** | Duplica o hub externo, mas oferece seleção de módulo nas mistas. |
| Navegação anterior/próxima e paleta | **Preservar** | Recurso central, hoje replicado. |
| Estados respondida/correta/incorreta/marcada | **Preservar / unificar** | Semântica útil, implementação distribuída. |
| Correção e explicações objetivas | **Preservar** | Conteúdo completo em todas as objetivas. |
| Resposta, revelação do modelo e autoavaliação dissertativa | **Preservar / melhorar** | Necessita esquema próprio e regra clara de conclusão. |
| Notas/rascunho por questão | **Preservar** | Estado local útil; definir identidade estável da questão. |
| Cronômetro/tempo por questão | **Preservar / melhorar** | Alimenta relatórios, mas estado/restauração precisa ser centralizado. |
| Histórico e revisão | **Preservar / centralizar** | Chaves colidem entre anos e há duas camadas de agregação. |
| Dashboard/estatísticas e CSV | **Preservar / melhorar** | Atualmente depende de descoberta heurística de `localStorage`. |
| Retomada automática | **Preservar / corrigir** | Há risco de sobrescrita entre provas e um bug em Parasitologia. |
| Concluídos/último acesso | **Preservar / centralizar** | Hub identifica pela string do caminho, vulnerável a renomeações. |
| Dark mode e preferências visuais | **Preservar / unificar** | Tema existe no hub e em cada motor, sem fonte única. |
| Bento toggle, calendário e scratchpad | **Investigar** | São funcionalidades do dashboard sem relação direta com o motor; validar uso. |
| Exportação de relatório textual | **Preservar / padronizar** | Não está uniforme em todos os motores. |
| Backup/restauração (`backup-medsim.js`) | **Investigar** | Código substancial mas não carregado; decidir integração ou remoção futura. |
| Marca-texto/borracha (`grifar-borracha.js`) | **Investigar** | Código substancial mas não carregado; não assumir que funciona em produção. |
| Branding por substituição do DOM | **Substituir** | Pós-processamento frágil; identidade deve nascer nos templates/dados. |
| Botão “voltar” injetado por heurística | **Substituir** | Deve ser navegação explícita, não detecção textual/DOM. |

Nada foi removido nesta fase.

## 5. Duplicação e oportunidades de centralização

- Os 17 simulados são documentos de aproximadamente 3.100–3.863 linhas e
  140–210 KB cada. Cada um copia o documento inteiro: tokens CSS, sidebar,
  cards, modais, tela de questão, relatório, histórico, configurações, dark mode,
  responsividade e motor JavaScript.
- Similaridade por linhas é normalmente superior a 0,90 entre várias provas;
  Farmacologia 2023/2024 chega a ~0,914 e as duas aulas de Fisiologia a ~0,945,
  mesmo incluindo bancos acadêmicos diferentes.
- Funções conceitualmente idênticas (início de módulo, renderização, seleção,
  marcação, navegação, relatório, histórico, estado, notas e exportação) aparecem
  copiadas com pequenas mudanças de chave, cor, texto ou suporte dissertativo.
- Handlers `onclick`/`oninput` inline aparecem no hub e simulados, exigindo
  funções globais e tornando componentes difíceis de testar ou reutilizar.
- Configurações e estados são globais em cada página. As chaves de storage são
  repetidas/copartilhadas por disciplina, não versionadas por exam ID.
- O catálogo existe duas vezes (`MEUS_ARQUIVOS_MANUAIS` e `simulados.json`) e o
  workflow mantém ambos; a classificação existe uma terceira vez em
  `mapaMaterias`/regex.
- Scripts externos novamente percorrem/injetam/observam DOM e iframe; branding,
  retorno e estatísticas compensam a ausência de contratos entre hub e motor.
- O glow de mouse e grandes blocos de CSS também são copiados em cada HTML.

Oportunidades futuras (não implementadas): uma fonte de dados por prova, motor
único, shell/navegação única, tokens/componentes únicos, persistência versionada,
manifesto canônico e adaptadores explícitos para objetiva/dissertativa.

## 6. Diferenças visuais entre provas

Há uma família visual predominante (Plus Jakarta Sans, roxo, cards arredondados,
sidebar, glass/mesh, modais e layouts responsivos), mas ela é uma cópia divergente,
não um sistema compartilhado.

- **Fontes:** todas carregam Plus Jakarta Sans; “Imunologia 2024” carrega também
  Space Grotesk e apresenta identidade de Microbiologia.
- **Cabeçalho/título:** textos de disciplina/ano e alguns badges variam ou estão
  incoerentes; não existem elementos `<h1>` acadêmicos canônicos, e o título é
  montado em containers/classes próprios.
- **Cards e entrada:** provas exclusivamente objetivas exibem um fluxo; as duas
  aulas mistas acrescentam cards separados para módulos; “Endócrino em Grupo”
  abre com foco dissertativo/casos.
- **Conteúdo:** objetivas renderizam opções clicáveis (4 ou 5); dissertativas usam
  `textarea`, revelação de gabarito e botões de autoavaliação.
- **Largura/espaçamento/tamanhos:** versões acumulam blocos CSS distintos; as
  diferenças no número/ordem de regras já tornam ajustes locais não propagáveis.
- **Resultados:** objetivas enfatizam pontuação/acertos; dissertativas usam
  avaliação autorreferida; mistas precisam alternar módulos. Relatórios e
  exportação não são rigorosamente uniformes.
- **Dark mode:** existe por variáveis/classes, mas fica replicado no hub e nos
  documentos, permitindo preferências e aparência divergirem.
- **Mobile:** existem media queries e adaptações de sidebar/cards/textarea em
  cada prova, porém copiadas; não há matriz de breakpoints nem teste automatizado.
- **Modais/navegação/indicadores:** são visualmente aparentados, mas variam por
  geração do template e são ainda modificados por scripts de injeção do pai.

## 7. Dívida técnica, fragilidades e riscos

### Dados e persistência

- **Colisões graves:** Farmacologia 2023/2024/2025 usam
  `simulado_farma_state/history/settings`; Imunologia 2022 e 2025 compartilham
  `simulado_imuno_*`; Micro 2023 e 2025 compartilham `simulado_micro_*`;
  Propedêutica 2024/2025 compartilham `simulado_prope_*`. Abrir outro ano pode
  restaurar estado incompatível ou misturar/apagar histórico.
- Parasitologia contém `const saved = localStorage.setItem('simulado_para_state')`
  no carregamento, em vez de `getItem`; isso pode escrever `undefined`/lançar e
  impede retomada confiável.
- IDs dependem de caminho/nome, portanto renomear arquivo perde vínculo com
  concluídos, último acesso e estatísticas.
- Não há versionamento/schema/migração de storage; `JSON.parse` de dados locais
  inválidos pode interromper inicialização em pontos sem proteção.

### Catálogo, caminhos e publicação

- `GITHUB_REPO = 'Simulado'` contradiz o destino `CHATGPT`. A API consulta somente
  `/contents/` da raiz, enquanto as provas estão em `/simulados`; a descoberta
  remota tende a não encontrar os arquivos mesmo que o repo estivesse correto.
- O funcionamento real depende da lista inline relativa. Nomes têm espaços,
  acentos e até espaço antes de `1`, elevando risco de encoding/link/automação.
- Classificação por substring/regex do filename é arbitrária: já cataloga como
  Imunologia um HTML cujo título/conteúdo dizem Microbiologia.
- `simulados.json` não é consumido e pode divergir da lista inline.
- O workflow dispara apenas para `*.html` e `simulados/*.html`, ignora mudanças no
  próprio JSON/scripts/configuração, embute Python em YAML, faz `git add .` e
  `git push` na branch do evento. Isso pode criar commits inesperados, conflitos
  de concorrência e permissões difíceis de auditar.

### Manutenção, segurança e acessibilidade

- HTMLs monolíticos, funções globais e `innerHTML` tornam teste, evolução e
  isolamento de defeitos difíceis.
- Conteúdo acadêmico inclui HTML e é enviado a `innerHTML`. Hoje os dados são
  locais/confiáveis; JSON remoto ou edição futura exigirá sanitização para evitar
  XSS. Templates construídos com filenames/textos também merecem escaping.
- Dependências CDN não estão fixadas (`@phosphor-icons/web` sem versão) e fontes/
  ícones falham offline ou sob CSP/rede restrita.
- `javascript:void(0)`, anchors/botões por `onclick`, elementos clicáveis montados
  como `div`, modais customizados, ausência de headings semânticos e provável
  falta de foco/ARIA consistente são riscos de teclado e leitor de tela.
- Observadores, varreduras de DOM e listeners sobre documento/iframe aumentam
  custo e possibilidade de comportamento duplicado; o glow calcula geometria de
  múltiplos cards a cada movimento.
- `backup-medsim.js` e `grifar-borracha.js` aparentam código morto do ponto de
  vista das entradas atuais; confirmar intenção antes de remover.

## 8. Compatibilidade futura com GitHub Pages (`/CHATGPT/`)

- Os caminhos relativos atuais (`simulados/...` e scripts na raiz) funcionam ao
  abrir `https://user210398-afk.github.io/CHATGPT/`, mas qualquer futuro caminho
  iniciado por `/` apontará para a raiz do domínio, não `/CHATGPT/`.
- Não há roteador hoje. Se a V2 adotar history routing, refresh em rotas virtuais
  resultará em 404 no Pages sem estratégia explícita; hash routing ou artefatos
  estáticos devem ser avaliados na Fase 2.
- O base path deve ser configurável e usado em HTML, módulos, fetch de JSON,
  imagens, imports e links. Evitar codificar tanto `/Simulados/` quanto
  `/CHATGPT/` dentro dos dados.
- URLs com espaços/acentos funcionam quando corretamente codificadas, mas são
  frágeis para scripts e comparações de identidade. Separar ID estável de path.
- O `iframe` é same-origin quando servido no Pages e por isso os scripts atuais
  conseguem inspecioná-lo. Mudar origem ou headers quebraria branding/retorno;
  uma V2 não deve depender desse detalhe.
- Não há imagens atuais, mas o schema futuro deve resolver mídia relativamente ao
  base path/site ou à URL do JSON, e validar arquivos ausentes.
- O workflow atual não é um pipeline de Pages e não há configuração Pages/Jekyll
  (`_config.yml`, `.nojekyll`) no snapshot. Não se deve alterá-lo nesta fase;
  primeiro definir fonte/artefato de publicação e permissões na Fase 2.

## 9. Avaliação preliminar da migração HTML → JSON

Sem fixar arquitetura, os dados observados indicam a necessidade de representar:

- identidade estável e versão da prova; título de exibição; disciplina; ano;
  divisão/tipo/número; descrição e ordem;
- módulos e tipo de cada módulo (objetivo/dissertativo), inclusive numeração que
  reinicia e agrupamento de subitens;
- questão: ID estável, número/label original, categoria, enunciado e tipo;
- objetiva: opções ordenadas, letra/label quando aplicável, índice/ID correto e
  explicação/comentário/justificativa preservados;
- dissertativa: resposta-modelo e critérios/autoavaliação, sem confundir a
  resposta do estudante com conteúdo da prova;
- contexto/caso/texto auxiliar (`caseText`), relação entre itens e HTML/tabelas;
- mídia futura com alt text/crédito/path, embora o legado atual não tenha imagem;
- metadados de proveniência e sinalizadores de revisão humana.

### Automação possível

1. Extrair os arrays JS balanceando colchetes/strings (regex isolada não basta).
2. Mapear Formato A e B diretamente e Formato C com adaptador dedicado.
3. Validar presença/tipos, IDs únicos compostos, sequência declarada, 4/5 opções,
   `correct` dentro do intervalo e igualdade de contagens antes/depois.
4. Gerar relatório por prova com hash/texto normalizado para comprovar que nenhum
   conteúdo acadêmico mudou.
5. Detectar prefixos A–E sem removê-los automaticamente; apenas sugerir revisão.
6. Validar HTML permitido e links/mídias, sem sanitização destrutiva silenciosa.

### Exige validação/revisão humana

- classificação Imunologia 2024 versus Microbiologia e B4 versus P4 em 2023;
- ano não explícito da aula de Hormônios Pancreáticos;
- agrupamento e repetição de `caseText` nos subitens de Endócrino em Grupo;
- opção correta do ponto de vista acadêmico (a auditoria só validou índices);
- distinção entre explicação, mini-resumo, justificativa e comentários hoje
  concatenados em `context`/`gabarito`;
- decisão sobre preservar letras dentro do texto ou convertê-las em metadado;
- lacuna intencional 1–3 de Farmacologia 2025.

## 10. Pontos obrigatórios para a Fase 2

1. Definir identificadores estáveis para prova, módulo, questão e tentativa antes
   de desenhar persistência ou URLs.
2. Tratar os três formatos sem perder HTML, tabelas, casos, numeração e respostas.
3. Planejar migração/versionamento do `localStorage`, sobretudo colisões entre
   anos, com backup e rollback; não reutilizar automaticamente as chaves atuais.
4. Escolher um catálogo canônico com metadados explícitos; filenames não podem
   continuar sendo banco de dados.
5. Definir contrato seguro de rich text/sanitização e política de assets/base path
   compatível com `/CHATGPT/`.
6. Decidir o destino das funcionalidades hoje inativas (backup e marca-texto) com
   evidência de uso, sem removê-las por suposição.
7. Mapear paridade funcional e visual antes de trocar o `iframe`/motor; incluir
   teclado, foco, mobile, dark mode, retomada, relatório e dissertativas nos
   critérios de aceitação.
8. Corrigir identidade do repositório e estratégia de Pages/workflow somente na
   fase apropriada, evitando qualquer dependência de `Simulado` ou `/Simulados/`.

## 11. Validação e conclusão da Fase 1

- Todos os 18 HTMLs foram classificados: 1 página auxiliar (hub) e 17 provas.
- As 17 entradas do catálogo inline coincidem com os 17 HTMLs e com as 17 entradas
  de `simulados.json`.
- A soma por arquivo fecha em 485 = 462 objetivas + 23 dissertativas.
- Tipos por prova fecham em 14 objetivas + 2 mistas + 1 dissertativa.
- Todas as questões têm seus campos essenciais observados; nenhum índice de
  resposta está fora de faixa e nenhuma imagem/asset acadêmico foi encontrado.
- Formatos especiais (mistas, dissertativa simples, casos/subitens e contagem de
  4/5 alternativas) estão registrados.

O snapshot está suficientemente inventariado para subsidiar a Fase 2, mas as
inconsistências de classificação e a estratégia de preservação/migração do estado
devem ser resolvidas antes de qualquer conversão em massa.
