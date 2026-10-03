(function () {
  'use strict';

  const VERSION = 2;
  const STYLE_ID = 'medsim-grifo-borracha-v2-style';
  const MARK_CLASS = 'medsim-grifo-v2';
  const PAINTABLE_CLASS = 'medsim-grifo-v2-area';

  const BUTTON_SELECTOR =
    'button,a,[role="button"],[onclick]';

  const TEXT_SELECTORS = [
    '#q-statement',
    '.q-statement',

    '#question-statement',
    '.question-statement',

    '#question-text',
    '.question-text',

    '#enunciado',
    '.enunciado',

    '[data-question-statement]',
    '[data-role="question-statement"]',
    '[data-role="question-text"]',

    '[class*="question-statement"]',
    '[class*="question-text"]',
    '[class*="q-statement"]',

    '[class*="enunciado"]',
    '[class*="enunci"]',

    '[id*="question-statement"]',
    '[id*="question-text"]',
    '[id*="q-statement"]',

    '[id*="enunciado"]',
    '[id*="enunci"]'
  ].join(',');

  const frames = new WeakSet();
  const docs = new WeakMap();


  function norm(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }


  function buttonKind(control) {
    if (!control) return null;

    const icon =
      control.querySelector
        ? control.querySelector('i')
        : null;

    const text = norm([
      control.id,
      control.getAttribute &&
        control.getAttribute('title'),
      control.getAttribute &&
        control.getAttribute('aria-label'),
      control.textContent,
      control.className,
      icon && icon.className
    ].join(' '));

    if (
      control.id === 'btn-highlight' ||
      /\bgrifar\b|marca[ -]?texto|highlighter|ph-highlighter/.test(text)
    ) {
      return 'highlight';
    }

    if (
      control.id === 'btn-eraser' ||
      /\bborracha\b|apagar grifo|remover grifo|\beraser\b|ph-eraser/.test(text)
    ) {
      return 'eraser';
    }

    return null;
  }


  function injectStyle(doc) {
    if (
      !doc.head ||
      doc.getElementById(STYLE_ID)
    ) {
      return;
    }

    const style =
      doc.createElement('style');

    style.id =
      STYLE_ID;

    style.textContent = `

      .${PAINTABLE_CLASS} {
        -webkit-user-select: none !important;
        user-select: none !important;

        -webkit-touch-callout: none !important;

        touch-action: none !important;
      }


      .${MARK_CLASS},
      .${MARK_CLASS}.hl-word,
      .${MARK_CLASS}.marked {

        background: #fef08a !important;
        background-color: #fef08a !important;

        color: inherit !important;

        border-radius: 3px;

        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
      }

    `;

    doc.head.appendChild(style);
  }


  function isVisible(el) {
    if (
      !el ||
      el.nodeType !== 1
    ) {
      return false;
    }

    try {
      const win =
        el.ownerDocument.defaultView;

      const css =
        win.getComputedStyle(el);

      const rect =
        el.getBoundingClientRect();

      return (
        css.display !== 'none' &&
        css.visibility !== 'hidden' &&
        rect.width > 0 &&
        rect.height > 0
      );

    } catch (_) {
      return false;
    }
  }


  function forbidden(el) {
    if (
      !el ||
      !el.closest
    ) {
      return true;
    }

    return Boolean(
      el.closest(
        'button,' +
        'a,' +
        'input,' +
        'textarea,' +
        'select,' +
        'label,' +

        '.options-group,' +
        '[id*="options"],' +
        '[class*="options"],' +

        '[id*="alternativ"],' +
        '[class*="alternativ"],' +

        '[id*="option"],' +
        '[class*="option"],' +

        '.q-integrated-toolbar,' +
        '.tool-btn,' +
        '.q-nav-btn'
      )
    );
  }


  function collectPaintables(doc) {
    const out = [];
    const seen = new Set();

    function add(el) {
      if (
        !el ||
        seen.has(el) ||
        !isVisible(el) ||
        forbidden(el)
      ) {
        return;
      }

      const text =
        (el.textContent || '').trim();

      if (!text) return;

      seen.add(el);
      out.push(el);
    }


    try {
      doc
        .querySelectorAll(TEXT_SELECTORS)
        .forEach(add);

    } catch (_) {}


    /*
     * Fallback para simuladores
     * com estrutura diferente.
     */

    if (!out.length) {

      const roots = [
        ...doc.querySelectorAll(
          '#game-hud,' +
          '.game-hud,' +
          '.quiz-screen,' +
          '.question-screen,' +
          '.quiz-container,' +
          '.question-container,' +
          '.question-card,' +
          '.bento-q-card,' +
          '[data-question],' +
          '[data-questao]'
        )
      ].filter(isVisible);


      for (const root of roots) {

        const candidates =
          root.querySelectorAll(
            'p,div,span,h1,h2,h3,h4,h5,h6'
          );


        for (const el of candidates) {

          if (
            forbidden(el) ||
            !isVisible(el)
          ) {
            continue;
          }


          const text =
            (el.textContent || '').trim();


          if (
            text.length < 12
          ) {
            continue;
          }


          const childBlock =
            Array.from(
              el.children || []
            )
            .some(
              child => {

                try {
                  const d =
                    child
                      .ownerDocument
                      .defaultView
                      .getComputedStyle(child)
                      .display;

                  return (
                    d === 'block' ||
                    d === 'flex' ||
                    d === 'grid'
                  );

                } catch (_) {
                  return false;
                }
              }
            );


          if (!childBlock) {
            add(el);
          }
        }
      }
    }


    return out;
  }


  function refreshPaintables(
    doc,
    state
  ) {

    for (
      const el
      of state.paintables
    ) {

      try {
        el.classList.remove(
          PAINTABLE_CLASS
        );
      } catch (_) {}
    }


    state.paintables.clear();


    if (!state.mode) {
      return;
    }


    for (
      const el
      of collectPaintables(doc)
    ) {

      state.paintables.add(el);

      el.classList.add(
        PAINTABLE_CLASS
      );
    }
  }


  function targetForElement(
    state,
    el
  ) {

    if (
      !el ||
      !el.closest ||
      forbidden(el)
    ) {
      return null;
    }


    for (
      const target
      of state.paintables
    ) {

      if (
        target === el ||
        target.contains(el)
      ) {
        return target;
      }
    }


    return null;
  }


  function setMode(
    doc,
    state,
    mode
  ) {

    /*
     * Clicou novamente no mesmo botão:
     * desativa.
     */

    state.mode =
      state.mode === mode
        ? null
        : mode;


    state.painting = false;
    state.pointerId = null;

    state.lastX = null;
    state.lastY = null;


    refreshPaintables(
      doc,
      state
    );
  }


  function caretAtPoint(
    doc,
    x,
    y
  ) {

    try {

      if (
        doc.caretPositionFromPoint
      ) {

        const pos =
          doc.caretPositionFromPoint(
            x,
            y
          );


        if (pos) {

          return {
            node:
              pos.offsetNode,

            offset:
              pos.offset
          };
        }
      }

    } catch (_) {}


    try {

      if (
        doc.caretRangeFromPoint
      ) {

        const range =
          doc.caretRangeFromPoint(
            x,
            y
          );


        if (range) {

          return {
            node:
              range.startContainer,

            offset:
              range.startOffset
          };
        }
      }

    } catch (_) {}


    return null;
  }


  function normalizeCaret(caret) {
    if (
      !caret ||
      !caret.node
    ) {
      return null;
    }


    let node =
      caret.node;

    let offset =
      caret.offset || 0;


    if (
      node.nodeType === 3
    ) {

      return {
        node,
        offset
      };
    }


    if (
      node.nodeType === 1
    ) {

      const children =
        node.childNodes;


      const index =
        Math.min(
          offset,
          Math.max(
            0,
            children.length - 1
          )
        );


      const child =
        children[index];


      if (
        child &&
        child.nodeType === 3
      ) {

        return {
          node:
            child,

          offset:
            0
        };
      }


      const walker =
        node.ownerDocument
          .createTreeWalker(
            node,
            4
          );


      const textNode =
        walker.nextNode();


      if (textNode) {

        return {
          node:
            textNode,

          offset:
            0
        };
      }
    }


    return null;
  }


  function isWordChar(ch) {
    if (!ch) return false;

    try {

      return /[\p{L}\p{N}_’'\-]/u
        .test(ch);

    } catch (_) {

      return /[A-Za-zÀ-ÖØ-öø-ÿ0-9_’'\-]/
        .test(ch);
    }
  }


  function wordRangeAtPoint(
    doc,
    state,
    x,
    y
  ) {

    const raw =
      normalizeCaret(
        caretAtPoint(
          doc,
          x,
          y
        )
      );


    if (
      !raw ||
      !raw.node ||
      raw.node.nodeType !== 3
    ) {

      return null;
    }


    const node =
      raw.node;


    const parent =
      node.parentElement;


    const target =
      targetForElement(
        state,
        parent
      );


    if (!target) {
      return null;
    }


    const text =
      node.nodeValue || '';


    if (!text) {
      return null;
    }


    let i =
      Math.max(
        0,
        Math.min(
          raw.offset,
          text.length - 1
        )
      );


    /*
     * Se caiu exatamente depois
     * da palavra, tenta um caractere
     * para trás.
     */

    if (
      !isWordChar(text[i]) &&
      i > 0 &&
      isWordChar(text[i - 1])
    ) {

      i--;
    }


    /*
     * Tocou apenas em espaço/
     * pontuação.
     */

    if (
      !isWordChar(text[i])
    ) {

      return null;
    }


    let start = i;
    let end = i + 1;


    while (
      start > 0 &&
      isWordChar(
        text[start - 1]
      )
    ) {

      start--;
    }


    while (
      end < text.length &&
      isWordChar(
        text[end]
      )
    ) {

      end++;
    }


    return {
      node,
      start,
      end,
      target
    };
  }


  function alreadyMarked(node) {
    const parent =
      node &&
      node.parentElement;


    if (!parent) {
      return null;
    }


    return parent.closest(
      '.' + MARK_CLASS +
      ',.hl-word.marked' +
      ',.medsim-universal-highlight'
    );
  }


  function wrapWord(
    doc,
    info
  ) {

    if (
      !info ||
      !info.node ||
      info.start >= info.end
    ) {

      return false;
    }


    /*
     * Já está amarelo:
     * não cria outro grifo dentro.
     */

    if (
      alreadyMarked(
        info.node
      )
    ) {

      return false;
    }


    let selected =
      info.node;


    if (
      info.start > 0
    ) {

      selected =
        selected.splitText(
          info.start
        );
    }


    const len =
      info.end -
      info.start;


    if (
      len <
      selected.nodeValue.length
    ) {

      selected.splitText(
        len
      );
    }


    const mark =
      doc.createElement(
        'span'
      );


    /*
     * Mantém compatibilidade visual
     * com os simulados existentes.
     */

    mark.className =
      'hl-word marked ' +
      MARK_CLASS;


    mark.setAttribute(
      'data-medsim-grifo',
      '1'
    );


    selected.parentNode
      .insertBefore(
        mark,
        selected
      );


    mark.appendChild(
      selected
    );


    return true;
  }


  function unwrap(mark) {
    if (
      !mark ||
      !mark.parentNode
    ) {

      return false;
    }


    const parent =
      mark.parentNode;


    /*
     * Tira somente o amarelo.
     * O texto permanece exatamente
     * no mesmo lugar.
     */

    while (
      mark.firstChild
    ) {

      parent.insertBefore(
        mark.firstChild,
        mark
      );
    }


    parent.removeChild(
      mark
    );


    parent.normalize();


    return true;
  }


  function markAtPoint(
    doc,
    state,
    x,
    y
  ) {

    const info =
      wordRangeAtPoint(
        doc,
        state,
        x,
        y
      );


    if (!info) {
      return false;
    }


    return wrapWord(
      doc,
      info
    );
  }


  function eraseAtPoint(
    doc,
    state,
    x,
    y
  ) {

    let mark =
      null;


    /*
     * Primeiro tenta descobrir
     * diretamente qual span amarelo
     * está debaixo do dedo/mouse.
     */

    try {

      const stack =
        doc.elementsFromPoint(
          x,
          y
        ) || [];


      for (
        const el
        of stack
      ) {

        if (
          !el ||
          !el.closest
        ) {
          continue;
        }


        const candidate =
          el.closest(
            '.' + MARK_CLASS +
            ',.hl-word.marked' +
            ',.medsim-universal-highlight'
          );


        if (
          candidate &&
          targetForElement(
            state,
            candidate
          )
        ) {

          mark =
            candidate;

          break;
        }
      }

    } catch (_) {}


    /*
     * Fallback por posição do texto.
     */

    if (!mark) {

      const caret =
        normalizeCaret(
          caretAtPoint(
            doc,
            x,
            y
          )
        );


      if (
        caret &&
        caret.node &&
        caret.node.parentElement
      ) {

        const candidate =
          caret.node
            .parentElement
            .closest(
              '.' + MARK_CLASS +
              ',.hl-word.marked' +
              ',.medsim-universal-highlight'
            );


        if (
          candidate &&
          targetForElement(
            state,
            candidate
          )
        ) {

          mark =
            candidate;
        }
      }
    }


    return mark
      ? unwrap(mark)
      : false;
  }


  function paintPoint(
    doc,
    state,
    x,
    y
  ) {

    if (
      state.mode ===
      'highlight'
    ) {

      return markAtPoint(
        doc,
        state,
        x,
        y
      );
    }


    if (
      state.mode ===
      'eraser'
    ) {

      return eraseAtPoint(
        doc,
        state,
        x,
        y
      );
    }


    return false;
  }


  /*
   * Faz vários pontos intermediários
   * entre uma posição e outra.
   *
   * Isso evita "pular palavras" quando
   * o dedo é arrastado rapidamente.
   */

  function paintSegment(
    doc,
    state,
    x1,
    y1,
    x2,
    y2
  ) {

    if (
      x1 == null ||
      y1 == null
    ) {

      paintPoint(
        doc,
        state,
        x2,
        y2
      );

      return;
    }


    const dx =
      x2 - x1;

    const dy =
      y2 - y1;


    const distance =
      Math.hypot(
        dx,
        dy
      );


    const steps =
      Math.max(
        1,
        Math.ceil(
          distance / 7
        )
      );


    for (
      let i = 1;
      i <= steps;
      i++
    ) {

      const t =
        i / steps;


      paintPoint(
        doc,
        state,

        x1 + dx * t,
        y1 + dy * t
      );
    }
  }


  function looksLikeNavigation(
    control
  ) {

    if (!control) {
      return false;
    }


    const text =
      norm([
        control.id,
        control.className,

        control.getAttribute &&
          control.getAttribute(
            'title'
          ),

        control.getAttribute &&
          control.getAttribute(
            'aria-label'
          ),

        control.textContent
      ].join(' '));


    return (
      /proxim|anterior|prev|next|questao|question|nav-btn|finalizar|encerrar|corrigir|resultado|voltar|hub/
        .test(text)
    );
  }


  function syncFromNative(
    doc,
    state
  ) {

    const targets =
      collectPaintables(doc);


    const pen =
      targets.some(
        el =>
          el.classList.contains(
            'pen-active'
          )
      );


    const eraser =
      targets.some(
        el =>
          el.classList.contains(
            'eraser-active'
          )
      );


    if (pen) {

      state.mode =
        'highlight';

    } else if (eraser) {

      state.mode =
        'eraser';

    } else {

      state.mode =
        null;
    }


    refreshPaintables(
      doc,
      state
    );
  }


  function install(doc) {
    if (
      !doc ||
      !doc.documentElement ||
      !doc.body ||
      docs.has(doc)
    ) {

      return;
    }


    injectStyle(doc);


    const state = {
      mode:
        null,

      painting:
        false,

      pointerId:
        null,

      lastX:
        null,

      lastY:
        null,

      paintables:
        new Set()
    };


    docs.set(
      doc,
      state
    );


    /*
     * BOTÕES GRIFAR / BORRACHA
     */

    doc.addEventListener(
      'click',

      event => {

        const control =
          event.target &&
          event.target.closest

            ? event.target.closest(
                BUTTON_SELECTOR
              )

            : null;


        const kind =
          buttonKind(
            control
          );


        if (kind) {

          /*
           * Controlamos somente a ação.
           * O onclick original continua
           * funcionando e mantém a
           * estética do botão.
           */

          setMode(
            doc,
            state,
            kind
          );


          setTimeout(
            () => {

              refreshPaintables(
                doc,
                state
              );

            },
            0
          );


          return;
        }


        /*
         * Se trocou de questão/tela,
         * acompanha o estado visual
         * original do simulador.
         */

        if (
          control &&
          looksLikeNavigation(
            control
          )
        ) {

          setTimeout(
            () => {

              syncFromNative(
                doc,
                state
              );

            },
            0
          );
        }

      },

      true
    );


    /*
     * TOCOU / CLICOU NO TEXTO
     */

    doc.addEventListener(
      'pointerdown',

      event => {

        if (!state.mode) {
          return;
        }


        const target =
          targetForElement(
            state,
            event.target
          );


        if (!target) {
          return;
        }


        state.painting =
          true;


        state.pointerId =
          event.pointerId;


        state.lastX =
          event.clientX;


        state.lastY =
          event.clientY;


        try {

          target.setPointerCapture(
            event.pointerId
          );

        } catch (_) {}


        /*
         * Impede seleção azul,
         * menu de texto ou rolagem
         * enquanto está pintando.
         */

        event.preventDefault();


        /*
         * Um simples toque/click já
         * marca ou apaga uma palavra.
         */

        paintPoint(
          doc,
          state,
          event.clientX,
          event.clientY
        );

      },

      {
        capture:
          true,

        passive:
          false
      }
    );


    /*
     * ARRASTAR O DEDO / MOUSE
     */

    doc.addEventListener(
      'pointermove',

      event => {

        if (
          !state.mode ||
          !state.painting ||
          event.pointerId !==
            state.pointerId
        ) {

          return;
        }


        event.preventDefault();


        paintSegment(
          doc,
          state,

          state.lastX,
          state.lastY,

          event.clientX,
          event.clientY
        );


        state.lastX =
          event.clientX;


        state.lastY =
          event.clientY;

      },

      {
        capture:
          true,

        passive:
          false
      }
    );


    function finishPointer(
      event
    ) {

      if (
        !state.painting ||
        event.pointerId !==
          state.pointerId
      ) {

        return;
      }


      if (state.mode) {

        event.preventDefault();


        paintSegment(
          doc,
          state,

          state.lastX,
          state.lastY,

          event.clientX,
          event.clientY
        );
      }


      state.painting =
        false;


      state.pointerId =
        null;


      state.lastX =
        null;


      state.lastY =
        null;
    }


    doc.addEventListener(
      'pointerup',
      finishPointer,
      {
        capture:
          true,

        passive:
          false
      }
    );


    doc.addEventListener(
      'pointercancel',
      finishPointer,
      {
        capture:
          true,

        passive:
          false
      }
    );


    /*
     * A implementação antiga de alguns
     * simulados tenta selecionar texto.
     *
     * Enquanto nossa ferramenta estiver
     * ativa, bloqueamos essa seleção.
     */

    doc.addEventListener(
      'selectstart',

      event => {

        if (!state.mode) {
          return;
        }


        const target =
          targetForElement(
            state,
            event.target
          );


        if (target) {

          event.preventDefault();
        }

      },

      true
    );
  }


  function attachFrame(frame) {
    if (
      !frame ||
      frames.has(frame)
    ) {

      return;
    }


    frames.add(frame);


    frame.addEventListener(
      'load',

      () => {

        try {

          install(
            frame.contentDocument
          );

        } catch (_) {}

      }
    );


    try {

      if (
        frame.contentDocument &&
        frame.contentDocument
          .readyState !==
          'loading'
      ) {

        install(
          frame.contentDocument
        );
      }

    } catch (_) {}
  }


  function scan() {
    document
      .querySelectorAll(
        'iframe'
      )
      .forEach(
        attachFrame
      );
  }


  function start() {
    scan();


    setInterval(
      scan,
      1000
    );


    window.MedSimGrifoBorracha = {
      version:
        VERSION,

      rescan:
        scan
    };


    console.info(
      '[MedSim] Grifar/Borracha universal v2 ativo.'
    );
  }


  if (
    document.readyState ===
    'loading'
  ) {

    document.addEventListener(
      'DOMContentLoaded',
      start,
      {
        once:
          true
      }
    );

  } else {

    start();
  }

})();
