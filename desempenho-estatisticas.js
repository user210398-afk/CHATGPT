(function () {
  'use strict';

  /* ============================================================
     MEDSIM — DESEMPENHO & ESTATÍSTICAS V2

     - Não lê históricos antigos indiscriminadamente.
     - Começa com o painel zerado.
     - Identifica qual simulado foi aberto pelo index.
     - Identifica a matéria pelo nome do arquivo.
     - Descobre automaticamente qual localStorage o simulado usa.
     - Registra somente resultados feitos após a instalação.
     ============================================================ */

  const DB_KEY = 'medsim_stats_v2_attempts';
  const META_KEY = 'medsim_stats_v2_meta';
  const DEFAULT_META = 70;

  let tentativas = lerJSON(DB_KEY, []);
  let meta = Number(
    localStorage.getItem(META_KEY) || DEFAULT_META
  );

  let arquivoAtivo = null;
  let monitor = null;


  /* ============================================================
     FUNÇÕES BÁSICAS
     ============================================================ */

  function lerJSON(chave, fallback) {
    try {
      const valor = JSON.parse(
        localStorage.getItem(chave)
      );

      return valor ?? fallback;

    } catch {
      return fallback;
    }
  }


  function salvarTentativas() {
    localStorage.setItem(
      DB_KEY,
      JSON.stringify(tentativas)
    );
  }


  /* ============================================================
     IDENTIFICAÇÃO DA MATÉRIA
     ============================================================ */

  function materiaPeloArquivo(arquivo) {

    const nome = decodeURIComponent(
      String(arquivo || '')
    ).toLowerCase();


    if (nome.includes('farmaco')) {
      return 'Farmacologia';
    }


    /*
      Fisiologia vem antes de "endo".

      Dessa maneira arquivos como:
      fisiologia-m5-Endocrino em Grupo.html

      continuam aparecendo como Fisiologia.
    */

    if (
      nome.includes('fisiologia') ||
      nome.includes('fisio')
    ) {
      return 'Fisiologia';
    }


    if (
      nome.includes('imunologia') ||
      nome.includes('imuno')
    ) {
      return 'Imunologia';
    }


    if (
      nome.includes('microbiologia') ||
      nome.includes('micro')
    ) {
      return 'Microbiologia';
    }


    if (
      nome.includes('parasitologia') ||
      nome.includes('parasito')
    ) {
      return 'Parasitologia';
    }


    if (
      nome.includes('patologia') ||
      nome.includes('pato')
    ) {
      return 'Patologia';
    }


    if (
      nome.includes('propedeutica') ||
      nome.includes('propedêutica') ||
      nome.includes('propedeu')
    ) {
      return 'Propedêutica';
    }


    if (
      nome.includes('psicomed') ||
      nome.includes('psico')
    ) {
      return 'Psicomed';
    }


    if (
      nome.includes('vigilancia') ||
      nome.includes('vigilância') ||
      nome.includes('vigil')
    ) {
      return 'Vigilância em Saúde';
    }


    return 'Outra matéria';
  }


  /* ============================================================
     DESCOBRIR QUAL HISTÓRICO O SIMULADO USA
     ============================================================ */

  async function descobrirChaveHistorico(arquivo) {

    try {

      const resposta = await fetch(
        arquivo,
        {
          cache: 'no-store'
        }
      );


      if (!resposta.ok) {
        return null;
      }


      const html = await resposta.text();


      /*
        Procura dentro do HTML por chaves no formato:

        simulado_farma_history
        simulado_micro_history
        simulado_micro2024_history
        simulado_imuno_history
        simulado_endo_history
        etc.
      */

      const chaves = [
        ...new Set(
          html.match(
            /simulado_[A-Za-z0-9_]+_history/g
          ) || []
        )
      ];


      return chaves[0] || null;

    } catch (erro) {

      console.warn(
        '[MedSim Stats] Não foi possível ler o simulado:',
        arquivo,
        erro
      );

      return null;
    }
  }


  /* ============================================================
     SNAPSHOT DO HISTÓRICO
     ============================================================ */

  function snapshotHistorico(chave) {

    if (!chave) {
      return '[]';
    }

    return (
      localStorage.getItem(chave) ||
      '[]'
    );
  }


  function primeiroItemHistorico(chave) {

    if (!chave) {
      return null;
    }


    const historico = lerJSON(
      chave,
      []
    );


    if (
      Array.isArray(historico) &&
      historico.length
    ) {
      return historico[0];
    }


    return null;
  }


  /* ============================================================
     PREPARA O SIMULADO QUE FOI ABERTO
     ============================================================ */

  async function prepararArquivoAtivo(arquivo) {

    pararMonitor();


    const info = {

      arquivo: arquivo,

      materia:
        materiaPeloArquivo(arquivo),

      chaveHistorico:
        null,

      snapshotAntes:
        null,

      registrado:
        false
    };


    arquivoAtivo = info;


    /*
      Descobre automaticamente qual localStorage
      aquele HTML usa para salvar os resultados.
    */

    info.chaveHistorico =
      await descobrirChaveHistorico(
        arquivo
      );


    /*
      Se outro simulado foi aberto enquanto
      o fetch estava acontecendo, ignora este.
    */

    if (arquivoAtivo !== info) {
      return;
    }


    /*
      Guarda o estado ANTES da prova.

      Assim resultados antigos não são importados.
    */

    info.snapshotAntes =
      snapshotHistorico(
        info.chaveHistorico
      );


    /*
      A cada segundo verifica se surgiu
      um novo resultado.
    */

    monitor = setInterval(
      function () {
        capturarSeNovoResultado();
      },
      1000
    );
  }


  /* ============================================================
     CAPTURA RESULTADO NOVO
     ============================================================ */

  function capturarSeNovoResultado() {

    const ativo = arquivoAtivo;


    if (
      !ativo ||
      !ativo.chaveHistorico ||
      ativo.registrado
    ) {
      return false;
    }


    const agora =
      snapshotHistorico(
        ativo.chaveHistorico
      );


    /*
      Nada mudou desde a abertura da prova.
    */

    if (
      agora ===
      ativo.snapshotAntes
    ) {
      return false;
    }


    const resultado =
      primeiroItemHistorico(
        ativo.chaveHistorico
      );


    if (
      !resultado ||
      typeof resultado !== 'object'
    ) {
      return false;
    }


    const percentual = Number(

      resultado.pct ??

      resultado.percent ??

      resultado.percentage ??

      resultado.percentual
    );


    if (
      !Number.isFinite(
        percentual
      )
    ) {
      return false;
    }


    /*
      SALVA NO BANCO EXCLUSIVO DO PAINEL.

      A matéria NÃO vem da chave do localStorage.
      Ela vem do arquivo que foi realmente aberto.
    */

    tentativas.push({

      id:
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,

      arquivo:
        ativo.arquivo,

      materia:
        ativo.materia,

      chaveHistorico:
        ativo.chaveHistorico,

      data:
        resultado.date ||
        resultado.data ||
        new Date().toLocaleString(
          'pt-BR'
        ),

      edicao:
        resultado.edition ||
        resultado.edicao ||
        resultado.title ||
        resultado.titulo ||
        nomeAmigavel(
          ativo.arquivo
        ),

      pct:
        percentual,

      pontos:
        resultado.pts ??
        resultado.score ??
        resultado.pontos ??
        '',

      tempo:
        resultado.timeStr ||
        resultado.tempo ||
        '00:00',

      capturadoEm:
        Date.now()
    });


    salvarTentativas();


    /*
      Impede que a mesma abertura de prova
      seja registrada duas vezes.
    */

    ativo.registrado = true;


    renderizar();


    return true;
  }


  /* ============================================================
     ENCERRA MONITORAMENTO
     ============================================================ */

  function pararMonitor() {

    if (monitor) {
      clearInterval(monitor);
    }


    monitor = null;
  }


  /* ============================================================
     FORMATA NOME DO SIMULADO
     ============================================================ */

  function nomeAmigavel(arquivo) {

    return decodeURIComponent(
      String(arquivo || '')
        .split('/')
        .pop() ||
      'Simulado'
    )
      .replace(
        /\.html$/i,
        ''
      )
      .replace(
        /[-_]+/g,
        ' '
      );
  }


  /* ============================================================
     INTERCEPTA AS FUNÇÕES DO INDEX
     ============================================================ */

  function envolverFuncoesDoIndex() {

    /*
      Quando o index chama carregarSimulado(),
      registramos qual arquivo foi aberto.
    */

    const originalCarregar =
      window.carregarSimulado;


    if (
      typeof originalCarregar ===
        'function' &&
      !originalCarregar.__medsimStatsV2
    ) {

      const wrapper =
        function (
          arquivoEncoded,
          arquivoOriginal
        ) {

          prepararArquivoAtivo(
            arquivoOriginal ||
            arquivoEncoded
          );


          return originalCarregar.apply(
            this,
            arguments
          );
        };


      wrapper.__medsimStatsV2 =
        true;


      window.carregarSimulado =
        wrapper;
    }


    /*
      Quando fecha a prova, fazemos
      uma última tentativa de capturar
      o resultado.
    */

    const originalFechar =
      window.fecharProva;


    if (
      typeof originalFechar ===
        'function' &&
      !originalFechar.__medsimStatsV2
    ) {

      const wrapper =
        function () {

          capturarSeNovoResultado();

          pararMonitor();

          arquivoAtivo =
            null;


          return originalFechar.apply(
            this,
            arguments
          );
        };


      wrapper.__medsimStatsV2 =
        true;


      window.fecharProva =
        wrapper;
    }
  }


  /* ============================================================
     EVENTOS
     ============================================================ */

  /*
    Caso o localStorage seja alterado
    em outro contexto do mesmo domínio.
  */

  window.addEventListener(
    'storage',
    function (evento) {

      if (
        arquivoAtivo &&
        evento.key ===
          arquivoAtivo.chaveHistorico
      ) {

        setTimeout(
          capturarSeNovoResultado,
          50
        );
      }
    }
  );


  /*
    Seus simulados também usam postMessage
    para indicar conclusão.

    Aproveitamos esse evento.
  */

  window.addEventListener(
    'message',
    function (evento) {

      if (

        evento.data ===
          'simulados_concluido'

        ||

        (
          evento.data &&
          evento.data.type ===
            'simulados_concluido'
        )

      ) {

        setTimeout(
          capturarSeNovoResultado,
          100
        );
      }
    }
  );


  /* ============================================================
     CSS
     ============================================================ */

  function inserirCSS() {

    if (
      document.getElementById(
        'medsim-stats-v2-css'
      )
    ) {
      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      'medsim-stats-v2-css';


    style.textContent = `

      #medsim-stats-v2 {
        position: fixed;
        inset: 0;
        z-index: 999999;
        background:
          var(--bg-canvas, #f8fafc);
        color:
          var(--text-main, #0f172a);
        overflow: auto;
        display: none;
      }


      #medsim-stats-v2.open {
        display: block;
      }


      .ms2-wrap {
        width: min(1350px, 94%);
        margin: auto;
        padding: 32px 0 60px;
      }


      .ms2-head {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        align-items: flex-start;
        flex-wrap: wrap;
        margin-bottom: 24px;
      }


      .ms2-head h1 {
        margin: 3px 0 5px;
        font-size: 2rem;
      }


      .ms2-muted {
        color:
          var(--text-muted, #64748b);
      }


      .ms2-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }


      .ms2-btn {
        border:
          1px solid
          var(--border-color, #e2e8f0);

        background:
          var(--card-bg-solid, #ffffff);

        color:
          var(--text-main, #0f172a);

        padding:
          10px 14px;

        border-radius:
          10px;

        font-weight:
          700;

        font-size:
          .86rem;

        font-family:
          inherit;

        cursor:
          pointer;

        transition:
          .2s;
      }


      .ms2-btn:hover {
        transform:
          translateY(-1px);

        border-color:
          var(--purple-primary, #3b82f6);
      }


      .ms2-btn.primary {

        background:
          var(--purple-primary, #3b82f6);

        color:
          #ffffff;

        border-color:
          transparent;
      }


      .ms2-controls {

        display:
          flex;

        gap:
          12px;

        align-items:
          end;

        flex-wrap:
          wrap;

        background:
          var(--card-bg, #ffffff);

        border:
          1px solid
          var(--border-color, #e2e8f0);

        border-radius:
          15px;

        padding:
          15px;

        margin-bottom:
          18px;
      }


      .ms2-controls label {

        display:
          block;

        font-size:
          .72rem;

        font-weight:
          800;

        color:
          var(--text-muted, #64748b);

        margin-bottom:
          5px;
      }


      .ms2-controls select,
      .ms2-controls input {

        padding:
          9px;

        border-radius:
          8px;

        border:
          1px solid
          var(--border-color, #e2e8f0);

        background:
          var(--input-bg, #ffffff);

        color:
          var(--text-main, #0f172a);
      }


      .ms2-kpis {

        display:
          grid;

        grid-template-columns:
          repeat(
            auto-fit,
            minmax(180px, 1fr)
          );

        gap:
          13px;

        margin-bottom:
          18px;
      }


      .ms2-card {

        background:
          var(--card-bg, #ffffff);

        border:
          1px solid
          var(--border-color, #e2e8f0);

        border-radius:
          15px;

        padding:
          18px;
      }


      .ms2-kpi-label {

        font-size:
          .72rem;

        font-weight:
          800;

        text-transform:
          uppercase;

        color:
          var(--text-muted, #64748b);
      }


      .ms2-kpi-value {

        font-size:
          1.8rem;

        font-weight:
          800;

        margin-top:
          7px;
      }


      .ms2-grid {

        display:
          grid;

        grid-template-columns:
          1.2fr 1fr;

        gap:
          16px;

        margin-bottom:
          16px;
      }


      .ms2-chart {

        height:
          285px;
      }


      .ms2-chart svg {

        width:
          100%;

        height:
          100%;

        display:
          block;
      }


      .ms2-bars {

        display:
          flex;

        flex-direction:
          column;

        gap:
          12px;
      }


      .ms2-bar-row {

        display:
          grid;

        grid-template-columns:
          130px 1fr 52px;

        gap:
          10px;

        align-items:
          center;

        font-size:
          .82rem;
      }


      .ms2-track {

        height:
          12px;

        border-radius:
          999px;

        background:
          var(--border-color, #e2e8f0);

        overflow:
          hidden;
      }


      .ms2-fill {

        height:
          100%;

        background:
          var(--purple-primary, #3b82f6);

        border-radius:
          999px;
      }


      .ms2-tablewrap {

        overflow:
          auto;
      }


      .ms2-table {

        width:
          100%;

        border-collapse:
          collapse;
      }


      .ms2-table th,
      .ms2-table td {

        padding:
          11px;

        border-bottom:
          1px solid
          var(--border-color, #e2e8f0);

        text-align:
          left;

        font-size:
          .82rem;
      }


      .ms2-table th {

        font-size:
          .7rem;

        text-transform:
          uppercase;

        color:
          var(--text-muted, #64748b);
      }


      .ms2-empty {

        text-align:
          center;

        padding:
          55px 20px;
      }


      .ms2-note {

        font-size:
          .78rem;

        color:
          var(--text-muted, #64748b);

        margin-top:
          8px;
      }


      @media (max-width: 850px) {

        .ms2-grid {
          grid-template-columns:
            1fr;
        }


        .ms2-bar-row {

          grid-template-columns:
            105px 1fr 45px;
        }

      }

    `;


    document.head.appendChild(
      style
    );
  }


  /* ============================================================
     BOTÃO NA SIDEBAR
     ============================================================ */

  function inserirBotao() {

    if (
      document.getElementById(
        'medsim-btn-stats-v2'
      )
    ) {
      return;
    }


    const nav =
      document.querySelector(
        '.nav-menu'
      );


    if (!nav) {
      return;
    }


    const botao =
      document.createElement(
        'button'
      );


    botao.id =
      'medsim-btn-stats-v2';


    botao.className =
      'nav-item';


    botao.innerHTML = `
      <i class="ph-duotone ph-chart-line-up"></i>
      Desempenho & Estatísticas
    `;


    botao.onclick =
      abrirPainel;


    /*
      Coloca depois do botão Calendário.
    */

    const calendario = [
      ...nav.querySelectorAll(
        '.nav-item'
      )
    ].find(
      elemento =>
        elemento.textContent
          .toLowerCase()
          .includes('calend')
    );


    if (calendario) {

      calendario.insertAdjacentElement(
        'afterend',
        botao
      );

    } else {

      nav.appendChild(
        botao
      );
    }
  }


  /* ============================================================
     CRIAÇÃO DO PAINEL
     ============================================================ */

  function criarPainel() {

    if (
      document.getElementById(
        'medsim-stats-v2'
      )
    ) {
      return;
    }


    const painel =
      document.createElement(
        'div'
      );


    painel.id =
      'medsim-stats-v2';


    painel.innerHTML = `

      <div class="ms2-wrap">

        <div class="ms2-head">

          <div>

            <div
              class="ms2-muted"
              style="
                font-weight:800;
                font-size:.76rem;
              "
            >
              MEDSIM ANALYTICS
            </div>


            <h1>
              Desempenho & Estatísticas
            </h1>


            <div class="ms2-muted">

              Dados registrados apenas a partir
              dos simulados realmente realizados
              neste Hub.

            </div>

          </div>


          <div class="ms2-actions">

            <button
              class="ms2-btn"
              id="ms2-export"
            >
              Exportar CSV
            </button>


            <button
              class="ms2-btn"
              id="ms2-reset"
            >
              Zerar painel
            </button>


            <button
              class="ms2-btn primary"
              id="ms2-close"
            >
              Voltar
            </button>

          </div>

        </div>


        <div class="ms2-controls">

          <div>

            <label>
              Matéria
            </label>


            <select id="ms2-filter">

              <option value="TODAS">
                Todas
              </option>

            </select>

          </div>


          <div>

            <label>
              Meta (%)
            </label>


            <input
              id="ms2-meta"
              type="number"
              min="1"
              max="100"
              value="${meta}"
            >

          </div>


          <button
            class="ms2-btn"
            id="ms2-save-meta"
          >
            Salvar meta
          </button>

        </div>


        <div id="ms2-content"></div>

      </div>
    `;


    document.body.appendChild(
      painel
    );


    document.getElementById(
      'ms2-close'
    ).onclick =
      fecharPainel;


    document.getElementById(
      'ms2-reset'
    ).onclick =
      zerarPainel;


    document.getElementById(
      'ms2-export'
    ).onclick =
      exportarCSV;


    document.getElementById(
      'ms2-save-meta'
    ).onclick =
      function () {

        meta =
          Math.min(
            100,
            Math.max(
              1,
              Number(
                document.getElementById(
                  'ms2-meta'
                ).value
              ) ||
              DEFAULT_META
            )
          );


        localStorage.setItem(
          META_KEY,
          String(meta)
        );


        renderizar();
      };


    document.getElementById(
      'ms2-filter'
    ).onchange =
      renderizar;
  }


  /* ============================================================
     ABRIR / FECHAR
     ============================================================ */

  function abrirPainel() {

    document.getElementById(
      'medsim-stats-v2'
    ).classList.add(
      'open'
    );


    document.body.style.overflow =
      'hidden';


    atualizarFiltro();

    renderizar();
  }


  function fecharPainel() {

    document.getElementById(
      'medsim-stats-v2'
    ).classList.remove(
      'open'
    );


    document.body.style.overflow =
      '';
  }


  /* ============================================================
     ZERAR SOMENTE O PAINEL
     ============================================================ */

  function zerarPainel() {

    const confirmar =
      confirm(
        'Zerar apenas as estatísticas deste painel? ' +
        'Os históricos internos dos simulados não serão apagados.'
      );


    if (!confirmar) {
      return;
    }


    tentativas = [];


    salvarTentativas();


    atualizarFiltro();

    renderizar();
  }


  /* ============================================================
     FILTRO
     ============================================================ */

  function dadosFiltrados() {

    const filtro =
      document.getElementById(
        'ms2-filter'
      )?.value ||
      'TODAS';


    if (
      filtro ===
      'TODAS'
    ) {
      return [
        ...tentativas
      ];
    }


    return tentativas.filter(
      tentativa =>
        tentativa.materia ===
        filtro
    );
  }


  function atualizarFiltro() {

    const select =
      document.getElementById(
        'ms2-filter'
      );


    if (!select) {
      return;
    }


    const valorAtual =
      select.value;


    const materias = [
      ...new Set(
        tentativas.map(
          tentativa =>
            tentativa.materia
        )
      )
    ].sort();


    select.innerHTML = `

      <option value="TODAS">
        Todas
      </option>

      ${materias
        .map(
          materia => `
            <option value="${esc(materia)}">
              ${esc(materia)}
            </option>
          `
        )
        .join('')
      }

    `;


    const aindaExiste =
      [...select.options].some(
        opcao =>
          opcao.value ===
          valorAtual
      );


    if (aindaExiste) {
      select.value =
        valorAtual;
    }
  }


  /* ============================================================
     TEMPO
     ============================================================ */

  function segundos(tempo) {

    const partes =
      String(
        tempo || ''
      )
        .split(':')
        .map(Number);


    if (
      partes.some(
        Number.isNaN
      )
    ) {
      return 0;
    }


    if (
      partes.length === 2
    ) {

      return (
        partes[0] * 60 +
        partes[1]
      );
    }


    if (
      partes.length === 3
    ) {

      return (
        partes[0] * 3600 +
        partes[1] * 60 +
        partes[2]
      );
    }


    return 0;
  }


  function tempoHumano(totalSegundos) {

    const horas =
      Math.floor(
        totalSegundos / 3600
      );


    const minutos =
      Math.floor(
        (
          totalSegundos %
          3600
        ) / 60
      );


    if (horas) {
      return `${horas}h ${minutos}min`;
    }


    return `${minutos} min`;
  }


  /* ============================================================
     MATEMÁTICA
     ============================================================ */

  function media(lista) {

    if (!lista.length) {
      return 0;
    }


    return (
      lista.reduce(
        (a, b) =>
          a + b,
        0
      ) /
      lista.length
    );
  }


  function pct(numero) {

    return (
      `${Math.round(
        numero * 10
      ) / 10}%`
    );
  }


  /* ============================================================
     ESCAPE HTML
     ============================================================ */

  function esc(valor) {

    return String(
      valor ?? ''
    ).replace(
      /[&<>"']/g,
      caractere => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[caractere]
    );
  }


  /* ============================================================
     AGRUPAMENTO POR MATÉRIA
     ============================================================ */

  function gruposMateria(dados) {

    const grupos = {};


    dados.forEach(
      tentativa => {

        if (
          !grupos[
            tentativa.materia
          ]
        ) {

          grupos[
            tentativa.materia
          ] = [];
        }


        grupos[
          tentativa.materia
        ].push(
          tentativa
        );
      }
    );


    return Object.entries(
      grupos
    )
      .map(
        ([materia, lista]) => ({

          materia,

          media:
            media(
              lista.map(
                item =>
                  item.pct
              )
            ),

          tentativas:
            lista.length,

          melhor:
            Math.max(
              ...lista.map(
                item =>
                  item.pct
              )
            )

        })
      )
      .sort(
        (a, b) =>
          b.media -
          a.media
      );
  }


  /* ============================================================
     GRÁFICO DE EVOLUÇÃO
     ============================================================ */

  function graficoLinha(dados) {

    /*
      Últimas 15 tentativas.
    */

    const lista =
      dados.slice(-15);


    if (!lista.length) {

      return `
        <div class="ms2-empty">
          Sem dados.
        </div>
      `;
    }


    const W = 700;
    const H = 250;
    const P = 35;


    const pontos =
      lista.map(
        (item, indice) => {

          const x =
            lista.length === 1

              ? W / 2

              : P +
                indice *
                (
                  W -
                  2 * P
                ) /
                (
                  lista.length -
                  1
                );


          const percentual =
            Math.max(
              0,
              Math.min(
                100,
                item.pct
              )
            );


          const y =
            H -
            P -
            (
              percentual /
              100
            ) *
            (
              H -
              2 * P
            );


          return {

            x,

            y,

            valor:
              item.pct
          };
        }
      );


    const polilinha =
      pontos
        .map(
          ponto =>
            `${ponto.x},${ponto.y}`
        )
        .join(' ');


    const metaY =
      H -
      P -
      (
        meta /
        100
      ) *
      (
        H -
        2 * P
      );


    return `

      <svg
        viewBox="0 0 ${W} ${H}"
        preserveAspectRatio="none"
      >

        <line
          x1="${P}"
          y1="${metaY}"
          x2="${W - P}"
          y2="${metaY}"
          stroke="var(--accent-yellow,#d97706)"
          stroke-dasharray="7 6"
        />


        <polyline
          points="${polilinha}"
          fill="none"
          stroke="var(--purple-primary,#3b82f6)"
          stroke-width="4"
          vector-effect="non-scaling-stroke"
        />


        ${pontos
          .map(
            ponto => `

              <circle
                cx="${ponto.x}"
                cy="${ponto.y}"
                r="5"
                fill="${
                  ponto.valor >= meta

                    ? 'var(--green-primary,#10b981)'

                    : 'var(--incorrect-red,#ef4444)'
                }"
              />

            `
          )
          .join('')
        }


        <text
          x="${W - P - 65}"
          y="${metaY - 7}"
          fill="var(--accent-yellow,#d97706)"
          font-size="13"
        >
          Meta ${meta}%
        </text>

      </svg>
    `;
  }


  /* ============================================================
     RENDERIZAÇÃO
     ============================================================ */

  function renderizar() {

    const container =
      document.getElementById(
        'ms2-content'
      );


    if (!container) {
      return;
    }


    atualizarFiltro();


    const dados =
      dadosFiltrados();


    /*
      PAINEL TOTALMENTE ZERADO.
    */

    if (!dados.length) {

      container.innerHTML = `

        <div
          class="ms2-card ms2-empty"
        >

          <h2>
            Nenhum simulado registrado ainda
          </h2>


          <p class="ms2-muted">

            Este painel começa zerado e
            só registra resultados concluídos
            depois da instalação desta versão.

          </p>


          <div class="ms2-note">

            Históricos antigos e dados de
            outros projetos no mesmo navegador
            são ignorados.

          </div>

        </div>
      `;


      return;
    }


    const valores =
      dados.map(
        item =>
          item.pct
      );


    const mediaGeral =
      media(
        valores
      );


    const melhor =
      Math.max(
        ...valores
      );


    const atingiramMeta =
      dados.filter(
        item =>
          item.pct >=
          meta
      ).length;


    const totalSegundos =
      dados.reduce(
        (soma, item) =>
          soma +
          segundos(
            item.tempo
          ),
        0
      );


    const grupos =
      gruposMateria(
        dados
      );


    container.innerHTML = `

      <!-- KPIs -->

      <div class="ms2-kpis">

        ${kpi(
          'Média geral',
          pct(mediaGeral),
          'Resultado médio'
        )}


        ${kpi(
          'Tentativas',
          dados.length,
          'Simulados registrados'
        )}


        ${kpi(
          'Melhor resultado',
          pct(melhor),
          'Maior aproveitamento'
        )}


        ${kpi(
          'Meta atingida',

          pct(
            atingiramMeta /
            dados.length *
            100
          ),

          `${atingiramMeta} tentativa(s) ≥ ${meta}%`
        )}


        ${kpi(
          'Tempo registrado',

          tempoHumano(
            totalSegundos
          ),

          'Tempo acumulado'
        )}

      </div>


      <!-- GRÁFICOS -->

      <div class="ms2-grid">

        <div class="ms2-card">

          <h3>
            Evolução recente
          </h3>


          <div class="ms2-chart">

            ${graficoLinha(
              dados
            )}

          </div>

        </div>


        <div class="ms2-card">

          <h3>
            Média por matéria
          </h3>


          <div class="ms2-bars">

            ${grupos
              .map(
                grupo => `

                  <div class="ms2-bar-row">

                    <div>
                      ${esc(
                        grupo.materia
                      )}
                    </div>


                    <div class="ms2-track">

                      <div
                        class="ms2-fill"
                        style="
                          width:
                          ${Math.max(
                            0,
                            Math.min(
                              100,
                              grupo.media
                            )
                          )}%
                        "
                      ></div>

                    </div>


                    <strong>
                      ${pct(
                        grupo.media
                      )}
                    </strong>

                  </div>

                `
              )
              .join('')
            }

          </div>

        </div>

      </div>


      <!-- TABELA -->

      <div class="ms2-card">

        <h3>
          Tentativas recentes
        </h3>


        <div class="ms2-tablewrap">

          <table class="ms2-table">

            <thead>

              <tr>

                <th>
                  Matéria
                </th>

                <th>
                  Simulado
                </th>

                <th>
                  Data
                </th>

                <th>
                  Resultado
                </th>

                <th>
                  Pontos
                </th>

                <th>
                  Tempo
                </th>

              </tr>

            </thead>


            <tbody>

              ${[...dados]
                .reverse()
                .slice(
                  0,
                  15
                )
                .map(
                  tentativa => `

                    <tr>

                      <td>

                        <strong>
                          ${esc(
                            tentativa.materia
                          )}
                        </strong>

                      </td>


                      <td>

                        ${esc(
                          tentativa.edicao
                        )}

                      </td>


                      <td>

                        ${esc(
                          tentativa.data
                        )}

                      </td>


                      <td>

                        <strong>

                          ${pct(
                            tentativa.pct
                          )}

                        </strong>

                      </td>


                      <td>

                        ${esc(
                          tentativa.pontos
                        )}

                      </td>


                      <td>

                        ${esc(
                          tentativa.tempo
                        )}

                      </td>

                    </tr>

                  `
                )
                .join('')
              }

            </tbody>

          </table>

        </div>

      </div>
    `;
  }


  /* ============================================================
     CARD KPI
     ============================================================ */

  function kpi(
    titulo,
    valor,
    subtitulo
  ) {

    return `

      <div class="ms2-card">

        <div class="ms2-kpi-label">

          ${esc(
            titulo
          )}

        </div>


        <div class="ms2-kpi-value">

          ${esc(
            valor
          )}

        </div>


        <div
          class="ms2-muted"
          style="
            font-size:.78rem
          "
        >

          ${esc(
            subtitulo
          )}

        </div>

      </div>
    `;
  }


  /* ============================================================
     EXPORTAR CSV
     ============================================================ */

  function exportarCSV() {

    const dados =
      dadosFiltrados();


    if (!dados.length) {

      alert(
        'Não há dados para exportar.'
      );

      return;
    }


    const linhas = [

      [
        'Matéria',
        'Simulado',
        'Data',
        'Percentual',
        'Pontos',
        'Tempo',
        'Arquivo'
      ],

      ...dados.map(
        item => [

          item.materia,

          item.edicao,

          item.data,

          item.pct,

          item.pontos,

          item.tempo,

          item.arquivo

        ]
      )

    ];


    const csv =

      '\uFEFF' +

      linhas
        .map(
          linha =>
            linha
              .map(
                valor =>
                  `"${String(
                    valor ?? ''
                  ).replace(
                    /"/g,
                    '""'
                  )}"`
              )
              .join(';')
        )
        .join('\n');


    const blob =
      new Blob(
        [csv],
        {
          type:
            'text/csv;charset=utf-8'
        }
      );


    const url =
      URL.createObjectURL(
        blob
      );


    const link =
      document.createElement(
        'a'
      );


    link.href =
      url;


    link.download =
      'medsim-desempenho.csv';


    document.body.appendChild(
      link
    );


    link.click();


    link.remove();


    URL.revokeObjectURL(
      url
    );
  }


  /* ============================================================
     INICIALIZAÇÃO
     ============================================================ */

  function init() {

    inserirCSS();

    criarPainel();

    inserirBotao();

    /*
      É importante que desempenho-estatisticas.js
      seja carregado depois dos scripts do index.
    */

    envolverFuncoesDoIndex();


    renderizar();


    /*
      Proteção adicional caso algum outro script
      do index redefina carregarSimulado logo após.
    */

    setTimeout(
      envolverFuncoesDoIndex,
      500
    );
  }


  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      init
    );

  } else {

    init();
  }


  /* ============================================================
     API OPCIONAL
     ============================================================ */

  window.MedSimEstatisticas = {

    abrir:
      abrirPainel,

    fechar:
      fecharPainel,

    renderizar:
      renderizar,

    dados:
      function () {
        return [
          ...tentativas
        ];
      }

  };

})();
