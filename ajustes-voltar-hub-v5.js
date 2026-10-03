(function () {
  'use strict';

  /* ============================================================
     MEDSIM — VOLTAR AO HUB V5

     Comportamento:
     - No Hub: botão oculto
     - Abriu um simulado: botão aparece
     - Clicou "Voltar ao Hub": botão desaparece imediatamente
     - Abriu outro simulado: botão reaparece
     - Não cria barra ocupando a largura da página
     - Reutiliza o botão original
     ============================================================ */


  const STYLE_ID =
    'medsim-back-v5-style';

  const SLOT_CLASS =
    'medsim-back-v5-slot';

  const BUTTON_CLASS =
    'medsim-back-v5-button';

  const HIDDEN_CLASS =
    'medsim-back-v5-hidden';


  /*
   * Estado principal.
   *
   * true  = usuário está no Hub
   * false = usuário está em um simulado
   */
  let estaNoHub = true;



  /* ============================================================
     CSS
     ============================================================ */

  const CSS = `

    /* ----------------------------------------------------------
       PEQUENO ESPAÇO DO BOTÃO

       Não é uma barra.
       Ocupa somente o necessário para o botão.
       ---------------------------------------------------------- */

    .${SLOT_CLASS} {

      position:
        relative !important;

      display:
        inline-flex !important;

      align-items:
        center !important;

      justify-content:
        flex-start !important;


      width:
        fit-content !important;

      max-width:
        calc(100% - 24px) !important;


      height:
        auto !important;


      margin:
        12px 0 14px 12px !important;


      padding:
        0 !important;


      background:
        transparent !important;


      border:
        0 !important;


      box-shadow:
        none !important;


      z-index:
        30 !important;
    }



    /* ----------------------------------------------------------
       QUANDO ESTÁ NO HUB
       ---------------------------------------------------------- */

    .${SLOT_CLASS}.${HIDDEN_CLASS} {

      display:
        none !important;
    }



    /* ----------------------------------------------------------
       BOTÃO VOLTAR AO HUB
       ---------------------------------------------------------- */

    .${BUTTON_CLASS} {

      /*
       * Neutraliza position fixed/absolute
       * do estilo original.
       */

      position:
        static !important;


      inset:
        auto !important;


      top:
        auto !important;

      right:
        auto !important;

      bottom:
        auto !important;

      left:
        auto !important;


      float:
        none !important;



      /*
       * Estrutura.
       */

      display:
        inline-flex !important;


      align-items:
        center !important;


      justify-content:
        center !important;


      gap:
        7px !important;



      /*
       * Tamanho compacto.
       */

      width:
        auto !important;


      min-width:
        0 !important;


      max-width:
        100% !important;


      min-height:
        40px !important;


      margin:
        0 !important;


      padding:
        9px 14px !important;


      box-sizing:
        border-box !important;



      /*
       * Visual compatível com o MedSim.
       */

      background:

        linear-gradient(
          135deg,

          #4f46e5 0%,

          #7c3aed 100%

        ) !important;


      color:
        #ffffff !important;



      border:

        1px solid
        rgba(
          255,
          255,
          255,
          0.20
        )

        !important;


      border-radius:
        11px !important;



      /*
       * Tipografia.
       */

      font-family:
        inherit !important;


      font-size:
        13px !important;


      font-weight:
        700 !important;


      line-height:
        1.15 !important;


      letter-spacing:
        -0.01em !important;


      text-align:
        center !important;


      text-decoration:
        none !important;


      white-space:
        nowrap !important;



      /*
       * Interação.
       */

      cursor:
        pointer !important;


      opacity:
        1 !important;


      visibility:
        visible !important;


      pointer-events:
        auto !important;



      /*
       * Sombra.
       */

      box-shadow:

        0 5px 14px
        rgba(
          79,
          70,
          229,
          0.22
        ),

        0 2px 4px
        rgba(
          15,
          23,
          42,
          0.10
        )

        !important;



      transition:

        transform
        0.16s ease,

        box-shadow
        0.16s ease,

        filter
        0.16s ease

        !important;
    }



    /* ----------------------------------------------------------
       HOVER
       ---------------------------------------------------------- */

    .${BUTTON_CLASS}:hover {

      transform:
        translateY(-1px) !important;


      filter:
        brightness(1.06) !important;


      box-shadow:

        0 7px 18px
        rgba(
          79,
          70,
          229,
          0.28
        ),

        0 3px 6px
        rgba(
          15,
          23,
          42,
          0.12
        )

        !important;
    }



    /* ----------------------------------------------------------
       CLIQUE
       ---------------------------------------------------------- */

    .${BUTTON_CLASS}:active {

      transform:
        scale(0.98) !important;
    }



    /* ----------------------------------------------------------
       FOCO POR TECLADO
       ---------------------------------------------------------- */

    .${BUTTON_CLASS}:focus-visible {

      outline:

        3px solid
        rgba(
          99,
          102,
          241,
          0.28
        )

        !important;


      outline-offset:
        3px !important;
    }



    /* ----------------------------------------------------------
       CELULAR
       ---------------------------------------------------------- */

    @media (
      max-width:
      700px
    ) {

      .${SLOT_CLASS} {

        margin:
          8px 0 10px 8px !important;


        max-width:
          calc(100% - 16px) !important;
      }


      .${BUTTON_CLASS} {

        min-height:
          36px !important;


        padding:
          8px 11px !important;


        border-radius:
          9px !important;


        font-size:
          12px !important;
      }

    }



    /* ----------------------------------------------------------
       REDUÇÃO DE MOVIMENTO
       ---------------------------------------------------------- */

    @media (
      prefers-reduced-motion:
      reduce
    ) {

      .${BUTTON_CLASS} {

        transition:
          none !important;
      }


      .${BUTTON_CLASS}:hover {

        transform:
          none !important;
      }

    }

  `;



  /* ============================================================
     UTILIDADES
     ============================================================ */

  function normalizarTexto(valor) {

    return String(
      valor || ''
    )

      .normalize(
        'NFD'
      )

      .replace(
        /[\u0300-\u036f]/g,
        ''
      )

      /*
       * Remove símbolos de seta.
       */
      .replace(
        /[←↩⟵‹«]/g,
        ''
      )

      .replace(
        /\s+/g,
        ' '
      )

      .trim()

      .toLowerCase();
  }



  function textoElemento(elemento) {

    if (!elemento) {

      return '';
    }


    if (
      elemento.tagName ===
      'INPUT'
    ) {

      return (
        elemento.value ||
        ''
      );
    }


    return (

      elemento.textContent ||

      elemento.getAttribute(
        'aria-label'
      ) ||

      elemento.getAttribute(
        'title'
      ) ||

      ''

    );
  }



  /* ============================================================
     IDENTIFICA O BOTÃO VOLTAR AO HUB
     ============================================================ */

  function ehBotaoVoltar(
    elemento
  ) {

    if (
      !elemento ||
      elemento.nodeType !== 1
    ) {

      return false;
    }


    /*
     * ID já existente no projeto.
     */
    if (
      elemento.id ===
      'btn-back'
    ) {

      return true;
    }


    const texto =
      normalizarTexto(
        textoElemento(
          elemento
        )
      );


    return texto.includes(
      'voltar ao hub'
    );
  }



  /* ============================================================
     CSS
     ============================================================ */

  function injetarCSS(
    documento
  ) {

    if (
      !documento ||
      !documento.head
    ) {

      return;
    }


    if (
      documento.getElementById(
        STYLE_ID
      )
    ) {

      return;
    }


    const style =
      documento.createElement(
        'style'
      );


    style.id =
      STYLE_ID;


    style.textContent =
      CSS;


    documento.head.appendChild(
      style
    );
  }



  /* ============================================================
     ENCONTRAR BOTÃO
     ============================================================ */

  function encontrarBotoes(
    documento
  ) {

    const encontrados =
      new Set();


    /*
     * Primeiro tenta diretamente pelo ID.
     */
    const peloId =
      documento.getElementById(
        'btn-back'
      );


    if (
      peloId
    ) {

      encontrados.add(
        peloId
      );
    }


    /*
     * Depois procura pelo texto.
     */
    documento
      .querySelectorAll(`

        button,

        a,

        [role="button"],

        input[type="button"],

        input[type="submit"]

      `)

      .forEach(
        elemento => {

          if (
            ehBotaoVoltar(
              elemento
            )
          ) {

            encontrados.add(
              elemento
            );
          }

        }
      );


    return [
      ...encontrados
    ];
  }



  /* ============================================================
     CONTAINER DO SIMULADO
     ============================================================ */

  function encontrarContainer(
    botao,
    documento
  ) {

    return (

      botao.closest(`

        #tela-prova,

        #prova-container,

        #simulado-container,

        .tela-prova,

        .prova-container,

        .simulado-container,

        .exam-container,

        main,

        .container

      `)

      ||

      documento.body

    );
  }



  /* ============================================================
     ESCONDER / MOSTRAR
     ============================================================ */

  function sincronizarVisibilidade() {

    /*
     * Só controlamos os slots do documento principal.
     *
     * Se o botão estiver dentro do iframe,
     * o próprio iframe desaparece quando volta ao Hub.
     */

    document
      .querySelectorAll(
        '.' + SLOT_CLASS
      )

      .forEach(
        slot => {

          slot.classList.toggle(

            HIDDEN_CLASS,

            estaNoHub

          );

        }
      );
  }



  function definirHub(
    valor
  ) {

    estaNoHub =
      Boolean(
        valor
      );


    sincronizarVisibilidade();
  }



  /* ============================================================
     COLOCA O BOTÃO NO LOCAL CORRETO
     ============================================================ */

  function posicionarBotao(
    botao,
    documento
  ) {

    if (
      !botao ||
      !documento
    ) {

      return;
    }


    /*
     * Se já estiver dentro do slot da V5,
     * apenas atualiza a visibilidade.
     */
    if (
      botao.closest(
        '.' + SLOT_CLASS
      )
    ) {

      sincronizarVisibilidade();

      return;
    }


    const container =
      encontrarContainer(
        botao,
        documento
      );


    if (
      !container
    ) {

      return;
    }


    let slot =
      container.querySelector(

        ':scope > .' +
        SLOT_CLASS

      );


    /*
     * Cria SOMENTE o pequeno slot
     * do tamanho do botão.
     */
    if (
      !slot
    ) {

      slot =
        documento.createElement(
          'div'
        );


      slot.className =
        SLOT_CLASS;


      slot.setAttribute(
        'aria-label',
        'Retorno ao Hub'
      );


      container.insertBefore(

        slot,

        container.firstChild

      );
    }



    /*
     * Remove estilos/classes
     * das versões anteriores,
     * caso existam.
     */

    botao.classList.remove(
      'medsim-voltar-hub-button-v3'
    );


    botao.classList.remove(
      'medsim-back-v4-btn'
    );



    /*
     * Aplica V5.
     */

    botao.classList.add(
      BUTTON_CLASS
    );



    /*
     * MOVE o botão original.
     *
     * Nenhum novo botão é criado.
     */

    slot.appendChild(
      botao
    );



    /*
     * Quando o próprio botão for clicado,
     * já podemos ocultá-lo imediatamente.
     *
     * O onclick original continua funcionando.
     */

    if (
      botao.dataset
        .medsimBackV5Click !==
      '1'
    ) {

      botao.dataset
        .medsimBackV5Click =
        '1';


      botao.addEventListener(

        'click',

        function () {

          /*
           * Pequeno delay para permitir
           * que o onclick original seja executado.
           */

          setTimeout(
            function () {

              definirHub(
                true
              );

            },
            0
          );

        }

      );
    }


    sincronizarVisibilidade();
  }



  /* ============================================================
     PROCESSA DOCUMENTO
     ============================================================ */

  function processarDocumento(
    documento
  ) {

    if (
      !documento ||
      !documento.documentElement
    ) {

      return;
    }


    injetarCSS(
      documento
    );


    encontrarBotoes(
      documento
    )

      .forEach(
        botao => {

          posicionarBotao(
            botao,
            documento
          );

        }
      );


    /*
     * MutationObserver para elementos
     * inseridos depois.
     */
    if (
      documento.defaultView &&
      !documento.defaultView
        .__medsimBackV5Observer
    ) {

      const observer =
        new MutationObserver(
          function () {

            encontrarBotoes(
              documento
            )

              .forEach(
                botao => {

                  posicionarBotao(
                    botao,
                    documento
                  );

                }
              );


            procurarIframes(
              documento
            );
          }
        );


      observer.observe(

        documento.documentElement,

        {

          childList:
            true,

          subtree:
            true

        }

      );


      documento.defaultView
        .__medsimBackV5Observer =
        observer;
    }
  }



  /* ============================================================
     INTERCEPTA FUNÇÕES DO INDEX
     ============================================================ */

  function envolverFuncoesDoIndex() {

    /*
     * carregarSimulado()
     *
     * Quando esta função é chamada,
     * sabemos que o usuário saiu do Hub.
     */

    const carregarOriginal =
      window.carregarSimulado;


    if (
      typeof carregarOriginal ===
        'function' &&
      !carregarOriginal
        .__medsimBackV5
    ) {

      const carregarWrapper =
        function () {

          /*
           * Estamos entrando em um simulado.
           */

          definirHub(
            false
          );


          const resultado =
            carregarOriginal.apply(
              this,
              arguments
            );


          /*
           * Reprocessa depois que
           * a interface mudar.
           */

          setTimeout(
            function () {

              processarDocumento(
                document
              );


              procurarIframes(
                document
              );


              sincronizarVisibilidade();

            },
            50
          );


          return resultado;
        };


      carregarWrapper
        .__medsimBackV5 =
        true;


      window.carregarSimulado =
        carregarWrapper;
    }



    /*
     * fecharProva()
     *
     * Quando é chamada,
     * o usuário está voltando ao Hub.
     */

    const fecharOriginal =
      window.fecharProva;


    if (
      typeof fecharOriginal ===
        'function' &&
      !fecharOriginal
        .__medsimBackV5
    ) {

      const fecharWrapper =
        function () {

          /*
           * Oculta imediatamente.
           */

          definirHub(
            true
          );


          return fecharOriginal.apply(
            this,
            arguments
          );
        };


      fecharWrapper
        .__medsimBackV5 =
        true;


      window.fecharProva =
        fecharWrapper;
    }
  }



  /* ============================================================
     IFRAME
     ============================================================ */

  function executarIframe(
    iframe
  ) {

    try {

      const documentoInterno =
        iframe.contentDocument;


      if (
        documentoInterno
      ) {

        processarDocumento(
          documentoInterno
        );
      }

    } catch (erro) {

      console.warn(

        '[MedSim] Não foi possível acessar o iframe do simulado.',

        erro

      );
    }
  }



  function registrarIframe(
    iframe
  ) {

    if (
      iframe.dataset
        .medsimBackV5 !==
      '1'
    ) {

      iframe.dataset
        .medsimBackV5 =
        '1';


      iframe.addEventListener(

        'load',

        function () {

          const src =
            (
              iframe.getAttribute(
                'src'
              ) ||
              ''
            ).trim();


          /*
           * Se um simulado realmente carregou,
           * marcamos como fora do Hub.
           */

          if (
            src &&
            src !==
              'about:blank'
          ) {

            definirHub(
              false
            );
          }



          /*
           * Processa imediatamente
           * e depois novamente.
           */

          [
            0,
            120,
            500
          ]

            .forEach(
              delay => {

                setTimeout(
                  function () {

                    executarIframe(
                      iframe
                    );

                  },
                  delay
                );

              }
            );


          setTimeout(
            function () {

              processarDocumento(
                document
              );


              sincronizarVisibilidade();

            },
            50
          );

        }

      );
    }


    executarIframe(
      iframe
    );
  }



  function procurarIframes(
    documento
  ) {

    documento
      .querySelectorAll(
        'iframe'
      )

      .forEach(
        registrarIframe
      );
  }



  /* ============================================================
     CLIQUE GLOBAL

     É uma proteção extra caso o botão
     não passe pelas funções esperadas.
     ============================================================ */

  document.addEventListener(

    'click',

    function (event) {

      const alvo =
        event.target.closest(`

          #btn-back,

          .${BUTTON_CLASS}

        `);


      if (
        alvo &&
        ehBotaoVoltar(
          alvo
        )
      ) {

        /*
         * Usuário voltou ao Hub.
         */

        setTimeout(
          function () {

            definirHub(
              true
            );

          },
          0
        );
      }

    },

    true

  );



  /* ============================================================
     DETECÇÃO INICIAL
     ============================================================ */

  function detectarEstadoInicial() {

    /*
     * Se houver iframe realmente visível
     * e com src carregado, provavelmente
     * já estamos em um simulado.
     */

    const frames = [

      ...document.querySelectorAll(
        'iframe'
      )

    ];


    const existeSimuladoVisivel =
      frames.some(
        iframe => {

          const src =
            (
              iframe.getAttribute(
                'src'
              ) ||
              ''
            ).trim();


          if (
            !src ||
            src ===
              'about:blank'
          ) {

            return false;
          }


          const estilo =
            getComputedStyle(
              iframe
            );


          if (
            estilo.display ===
              'none' ||

            estilo.visibility ===
              'hidden'
          ) {

            return false;
          }


          const rect =
            iframe.getBoundingClientRect();


          return (
            rect.width > 0 &&
            rect.height > 0
          );
        }
      );


    estaNoHub =
      !existeSimuladoVisivel;
  }



  /* ============================================================
     INICIALIZAÇÃO
     ============================================================ */

  function iniciar() {

    detectarEstadoInicial();


    injetarCSS(
      document
    );


    envolverFuncoesDoIndex();


    processarDocumento(
      document
    );


    procurarIframes(
      document
    );


    sincronizarVisibilidade();



    /*
     * Tenta envolver as funções novamente,
     * caso algum outro script seja carregado
     * logo depois da V5.
     */

    [
      200,
      600,
      1500
    ]

      .forEach(
        delay => {

          setTimeout(
            function () {

              envolverFuncoesDoIndex();


              processarDocumento(
                document
              );


              procurarIframes(
                document
              );


              sincronizarVisibilidade();

            },
            delay
          );

        }
      );
  }



  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(

      'DOMContentLoaded',

      iniciar,

      {
        once: true
      }

    );

  } else {

    iniciar();
  }

})();
