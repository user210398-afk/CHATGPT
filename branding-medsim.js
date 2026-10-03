(function () {
  'use strict';

  /* ============================================================
     MEDSIM — PADRONIZAÇÃO DE MARCA

     Troca visualmente "MedHub" por "MedSim"
     dentro dos simulados carregados.

     Não altera permanentemente os arquivos HTML.
     ============================================================ */

  const TEXTO_ANTIGO = 'MedHub';
  const TEXTO_NOVO = 'MedSim';


  /* ============================================================
     TROCAR TEXTO
     ============================================================ */

  function substituirTexto(texto) {

    if (
      typeof texto !== 'string' ||
      !texto.includes(TEXTO_ANTIGO)
    ) {
      return texto;
    }

    return texto.replaceAll(
      TEXTO_ANTIGO,
      TEXTO_NOVO
    );
  }


  /* ============================================================
     PROCESSAR NÓS DE TEXTO
     ============================================================ */

  function processarTextos(documento) {

    if (!documento || !documento.body) {
      return;
    }


    const walker =
      documento.createTreeWalker(

        documento.body,

        NodeFilter.SHOW_TEXT,

        {
          acceptNode(node) {

            /*
             * Não mexer dentro de scripts,
             * estilos ou código.
             */

            const pai =
              node.parentElement;


            if (!pai) {
              return NodeFilter.FILTER_REJECT;
            }


            const tag =
              pai.tagName;


            if (
              tag === 'SCRIPT' ||
              tag === 'STYLE' ||
              tag === 'CODE' ||
              tag === 'PRE'
            ) {

              return NodeFilter.FILTER_REJECT;
            }


            if (
              node.nodeValue &&
              node.nodeValue.includes(
                TEXTO_ANTIGO
              )
            ) {

              return NodeFilter.FILTER_ACCEPT;
            }


            return NodeFilter.FILTER_REJECT;
          }
        }

      );


    const encontrados = [];

    let node;


    while (
      (
        node =
          walker.nextNode()
      )
    ) {

      encontrados.push(
        node
      );
    }


    encontrados.forEach(
      textoNode => {

        textoNode.nodeValue =
          substituirTexto(
            textoNode.nodeValue
          );

      }
    );
  }


  /* ============================================================
     PROCESSAR ATRIBUTOS VISÍVEIS
     ============================================================ */

  function processarAtributos(documento) {

    if (!documento) {
      return;
    }


    const atributos = [

      'title',
      'aria-label',
      'placeholder',
      'alt',
      'value'

    ];


    documento
      .querySelectorAll('*')
      .forEach(
        elemento => {

          atributos.forEach(
            atributo => {

              if (
                !elemento.hasAttribute(
                  atributo
                )
              ) {
                return;
              }


              const atual =
                elemento.getAttribute(
                  atributo
                );


              if (
                atual &&
                atual.includes(
                  TEXTO_ANTIGO
                )
              ) {

                elemento.setAttribute(

                  atributo,

                  substituirTexto(
                    atual
                  )

                );
              }

            }
          );

        }
      );
  }


  /* ============================================================
     TITLE DA ABA
     ============================================================ */

  function processarTitle(
    documento
  ) {

    if (
      documento.title &&
      documento.title.includes(
        TEXTO_ANTIGO
      )
    ) {

      documento.title =
        substituirTexto(
          documento.title
        );
    }
  }


  /* ============================================================
     PROCESSAR DOCUMENTO COMPLETO
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


    processarTitle(
      documento
    );


    processarTextos(
      documento
    );


    processarAtributos(
      documento
    );


    /*
     * Observa alterações feitas posteriormente
     * pelo JavaScript do próprio simulado.
     */

    if (
      documento.defaultView &&
      !documento.defaultView
        .__medsimBrandingObserver
    ) {

      const observer =
        new MutationObserver(
          function () {

            processarTitle(
              documento
            );


            processarTextos(
              documento
            );


            processarAtributos(
              documento
            );

          }
        );


      observer.observe(

        documento.documentElement,

        {
          childList: true,
          subtree: true,
          characterData: true
        }

      );


      documento.defaultView
        .__medsimBrandingObserver =
        observer;
    }
  }


  /* ============================================================
     IFRAME
     ============================================================ */

  function executarIframe(
    iframe
  ) {

    try {

      if (
        iframe.contentDocument
      ) {

        processarDocumento(
          iframe.contentDocument
        );
      }

    } catch (erro) {

      console.warn(
        '[MedSim] Não foi possível aplicar a marca ao iframe.',
        erro
      );
    }
  }


  function registrarIframe(
    iframe
  ) {

    if (
      iframe.dataset
        .medsimBranding !==
      '1'
    ) {

      iframe.dataset
        .medsimBranding =
        '1';


      iframe.addEventListener(

        'load',

        function () {

          /*
           * Processa várias vezes porque alguns
           * simulados criam elementos depois
           * do carregamento inicial.
           */

          [
            0,
            100,
            400
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

        }

      );
    }


    executarIframe(
      iframe
    );
  }


  /* ============================================================
     BUSCAR IFRAMES
     ============================================================ */

  function procurarIframes() {

    document
      .querySelectorAll(
        'iframe'
      )

      .forEach(
        registrarIframe
      );
  }


  /* ============================================================
     OBSERVAR O INDEX
     ============================================================ */

  function observarIndex() {

    const observer =
      new MutationObserver(
        function () {

          procurarIframes();

        }
      );


    observer.observe(

      document.documentElement,

      {
        childList: true,
        subtree: true
      }

    );
  }


  /* ============================================================
     INICIALIZAÇÃO
     ============================================================ */

  function iniciar() {

    /*
     * Não troco o texto no próprio index.
     *
     * Apenas nos simulados carregados.
     */

    procurarIframes();

    observarIndex();


    /*
     * Varreduras adicionais.
     */

    [
      300,
      1000,
      2000
    ]

      .forEach(
        delay => {

          setTimeout(
            procurarIframes,
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
