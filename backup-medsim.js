(function () {
  'use strict';

  /* ============================================================
     MEDSIM — BACKUP DOS MEUS DADOS v2

     Funções:
     1. Exportar backup
     2. Restaurar backup
     3. Ver último backup
     4. Limpar meus dados

     Esta versão mantém a lógica de segurança da V1 e aproxima
     a interface visual do restante do Hub MedSim.
     ============================================================ */

  const VERSION = 2;
  const FORMAT = 'medsim-backup';

  const LAST_EXPORT_KEY = 'medsim_backup_last_export_v1';
  const RECOVERY_KEY = 'medsim_backup_recovery_v1';

  const BUTTON_ID = 'medsim-backup-button';
  const MODAL_ID = 'medsim-backup-modal';
  const STYLE_ID = 'medsim-backup-style-v2';
  const FILE_INPUT_ID = 'medsim-backup-file';

  const INTERNAL_KEYS = new Set([
    LAST_EXPORT_KEY
  ]);

  const EXACT_KEYS = new Set([
    'simulados_concluidos',
    'ultimo_acesso_simulado'
  ]);


  /* ============================================================
     IDENTIFICA DADOS DO MEDSIM
     ============================================================ */

  function isMedSimKey(key) {

    if (!key || INTERNAL_KEYS.has(key)) {
      return false;
    }

    return (
      /^medsim_/i.test(key) ||
      /^simulado_/i.test(key) ||
      EXACT_KEYS.has(key)
    );
  }


  function listMedSimKeys() {

    const keys = [];

    for (let i = 0; i < localStorage.length; i++) {

      const key =
        localStorage.key(i);

      if (isMedSimKey(key)) {
        keys.push(key);
      }
    }

    return keys.sort();
  }


  function collectData() {

    const data = {};

    listMedSimKeys().forEach(key => {

      const value =
        localStorage.getItem(key);

      if (value !== null) {
        data[key] = value;
      }

    });

    return data;
  }


  /* ============================================================
     SNAPSHOT
     ============================================================ */

  function makeSnapshot(reason) {

    return {

      format:
        FORMAT,

      version:
        VERSION,

      app:
        'MedSim',

      reason:
        reason || 'manual',

      createdAt:
        new Date().toISOString(),

      data:
        collectData()

    };
  }


  function saveRecovery(reason) {

    try {

      sessionStorage.setItem(

        RECOVERY_KEY,

        JSON.stringify(
          makeSnapshot(reason)
        )

      );

    } catch (error) {

      console.warn(
        '[MedSim] Não foi possível criar recuperação temporária.',
        error
      );
    }
  }


  function clearTrackedData() {

    listMedSimKeys().forEach(key => {

      localStorage.removeItem(key);

    });
  }


  function restoreSnapshot(snapshot) {

    clearTrackedData();

    Object.entries(
      snapshot.data || {}
    )
    .forEach(([key, value]) => {

      if (
        isMedSimKey(key) &&
        typeof value === 'string'
      ) {

        localStorage.setItem(
          key,
          value
        );
      }

    });
  }


  /* ============================================================
     NOME DO ARQUIVO
     ============================================================ */

  function filenameDate(date) {

    const pad =
      number =>
        String(number)
          .padStart(2, '0');

    return [

      date.getFullYear(),

      '-',

      pad(
        date.getMonth() + 1
      ),

      '-',

      pad(
        date.getDate()
      ),

      '_',

      pad(
        date.getHours()
      ),

      '-',

      pad(
        date.getMinutes()
      )

    ].join('');
  }


  /* ============================================================
     DOWNLOAD
     ============================================================ */

  function downloadJSON(payload) {

    const blob =
      new Blob(

        [
          JSON.stringify(
            payload,
            null,
            2
          )
        ],

        {
          type:
            'application/json;charset=utf-8'
        }

      );


    const url =
      URL.createObjectURL(blob);


    const link =
      document.createElement('a');


    link.href =
      url;


    link.download =

      `medsim-backup-${

        filenameDate(
          new Date()
        )

      }.json`;


    document.body
      .appendChild(link);


    link.click();


    link.remove();


    setTimeout(
      function () {

        URL.revokeObjectURL(url);

      },
      1000
    );
  }


  /* ============================================================
     EXPORTAR
     ============================================================ */

  function exportBackup() {

    const snapshot =
      makeSnapshot('export');


    const payload = {

      ...snapshot,

      origin:
        location.origin,

      path:
        location.pathname,

      summary: {

        keys:

          Object
            .keys(
              snapshot.data
            )
            .length

      }

    };


    downloadJSON(payload);


    localStorage.setItem(

      LAST_EXPORT_KEY,

      payload.createdAt

    );


    updateStatus();


    showMessage(

      'Backup exportado com sucesso.',

      'success'

    );
  }


  /* ============================================================
     DATA
     ============================================================ */

  function formatDate(iso) {

    if (!iso) {

      return 'Nenhum backup exportado ainda';
    }


    const date =
      new Date(iso);


    if (
      Number.isNaN(
        date.getTime()
      )
    ) {

      return 'Nenhum backup exportado ainda';
    }


    return date.toLocaleString(

      'pt-BR',

      {

        dateStyle:
          'short',

        timeStyle:
          'short'

      }

    );
  }


  /* ============================================================
     VALIDAR BACKUP
     ============================================================ */

  function validateBackup(raw) {

    if (
      !raw ||
      typeof raw !== 'object'
    ) {

      throw new Error(
        'Arquivo inválido.'
      );
    }


    if (
      raw.format !== FORMAT ||
      raw.app !== 'MedSim'
    ) {

      throw new Error(

        'Este arquivo não é um backup reconhecido do MedSim.'

      );
    }


    if (

      !raw.data ||

      typeof raw.data !==
        'object' ||

      Array.isArray(
        raw.data
      )

    ) {

      throw new Error(

        'O backup não contém dados restauráveis.'

      );
    }


    const data = {};


    Object.entries(
      raw.data
    )
    .forEach(([key, value]) => {

      if (

        isMedSimKey(key)

        &&

        typeof value ===
          'string'

      ) {

        data[key] = value;
      }

    });


    if (
      !Object
        .keys(data)
        .length
    ) {

      throw new Error(

        'Nenhum dado válido do MedSim foi encontrado no arquivo.'

      );
    }


    return {

      format:
        FORMAT,

      version:
        Number(
          raw.version
        ) || 1,

      app:
        'MedSim',

      createdAt:
        raw.createdAt || null,

      data

    };
  }


  /* ============================================================
     RESTAURAR
     ============================================================ */

  async function restoreFromFile(file) {

    if (!file) {
      return;
    }


    if (
      file.size >
      10 * 1024 * 1024
    ) {

      showMessage(

        'O arquivo é grande demais para um backup do MedSim.',

        'error'

      );

      return;
    }


    let parsed;


    try {

      parsed =
        JSON.parse(
          await file.text()
        );

    } catch (_) {

      showMessage(

        'Não foi possível ler esse arquivo JSON.',

        'error'

      );

      return;
    }


    let backup;


    try {

      backup =
        validateBackup(parsed);

    } catch (error) {

      showMessage(
        error.message,
        'error'
      );

      return;
    }


    const count =

      Object
        .keys(
          backup.data
        )
        .length;


    const date =

      backup.createdAt

        ? formatDate(
            backup.createdAt
          )

        : 'data não informada';


    const ok =
      window.confirm(

        `Restaurar este backup?\n\n`

        +

        `Backup: ${date}\n`

        +

        `Itens: ${count}\n\n`

        +

        `Os dados atuais do MedSim serão substituídos pelos dados deste arquivo.\n\n`

        +

        `Outros dados do navegador não serão alterados.`

      );


    if (!ok) {
      return;
    }


    const current =
      makeSnapshot(
        'before-restore'
      );


    saveRecovery(
      'before-restore'
    );


    try {

      restoreSnapshot(
        backup
      );


      showMessage(

        'Backup restaurado. Recarregando o MedSim...',

        'success'

      );


      setTimeout(
        function () {

          location.reload();

        },
        500
      );


    } catch (error) {

      console.error(
        '[MedSim] Falha na restauração.',
        error
      );


      let recovered = false;

      try {

        restoreSnapshot(
          current
        );

        // A storage adapter may silently ignore a write. Verify the exact
        // tracked snapshot before claiming that rollback succeeded.
        const after = collectData();
        const previousKeys = Object.keys(current.data);

        recovered =
          Object.keys(after).length === previousKeys.length &&
          previousKeys.every(key => after[key] === current.data[key]);

        if (!recovered) {
          console.error('[MedSim] Recuperação incompleta: dados diferentes do snapshot anterior.');
        }

      } catch (rollbackError) {

        console.error('[MedSim] Falha ao recuperar os dados anteriores.', rollbackError);
      }


      showMessage(

        recovered
          ? 'A restauração falhou, mas os dados anteriores foram recuperados e conferidos.'
          : 'A restauração falhou e a recuperação dos dados anteriores não foi confirmada. Não recarregue nem limpe os dados. Utilize seu backup original ou a recuperação temporária, se disponível.',

        'error',

        !recovered

      );
    }
  }


  /* ============================================================
     LIMPAR DADOS
     ============================================================ */

  function clearMyData() {

    const count =
      listMedSimKeys()
        .length;


    if (!count) {

      showMessage(

        'Não há dados do MedSim para limpar neste navegador.',

        'info'

      );

      return;
    }


    const first =
      window.confirm(

        `Limpar meus dados do MedSim neste navegador?\n\n`

        +

        `Serão removidos histórico, progresso, simulados concluídos, `

        +

        `estatísticas, rascunhos, preferências e outros dados locais do MedSim.\n\n`

        +

        `Os arquivos dos simulados e outros sites não serão afetados.`

      );


    if (!first) {
      return;
    }


    const second =
      window.confirm(

        `Última confirmação:\n\n`

        +

        `Deseja apagar ${count} item(ns) de dados do MedSim?`

      );


    if (!second) {
      return;
    }


    saveRecovery(
      'before-clear'
    );


    try {

      clearTrackedData();


      showMessage(

        'Seus dados locais do MedSim foram limpos.',

        'success'

      );


      closeModal();


      setTimeout(
        function () {

          location.reload();

        },
        500
      );


    } catch (error) {

      console.error(

        '[MedSim] Falha ao limpar dados.',

        error

      );


      showMessage(

        'Não foi possível limpar todos os dados.',

        'error'

      );
    }
  }


  /* ============================================================
     ESTILOS
     ============================================================ */

  function injectStyle() {

    if (
      document.getElementById(
        STYLE_ID
      )
    ) {

      return;
    }


    const style =
      document.createElement(
        'style'
      );


    style.id =
      STYLE_ID;


    style.textContent = `

      /* ======================================================
         ITEM DO MENU
         ====================================================== */

      #${BUTTON_ID} {

        width:
          100%;

        display:
          flex;

        align-items:
          center;

        gap:
          11px;


        min-height:
          44px;


        padding:
          10px 12px;


        margin:
          2px 0;


        box-sizing:
          border-box;


        border:
          1px solid transparent;


        border-radius:
          11px;


        background:
          transparent;


        color:

          var(
            --text-secondary,
            #64748b
          );


        font:
          inherit;


        font-size:
          .88rem;


        font-weight:
          650;


        text-align:
          left;


        cursor:
          pointer;


        transition:

          background .16s ease,
          color .16s ease,
          border-color .16s ease,
          transform .16s ease;
      }


      #${BUTTON_ID}:hover {

        background:

          rgba(
            99,
            102,
            241,
            .08
          );


        border-color:

          rgba(
            99,
            102,
            241,
            .10
          );


        color:

          var(
            --purple-primary,
            #6366f1
          );
      }


      #${BUTTON_ID}:active {

        transform:
          scale(.99);
      }


      #${BUTTON_ID}
      .medsim-backup-menu-icon {

        flex:
          0 0 auto;


        display:
          inline-flex;

        align-items:
          center;

        justify-content:
          center;


        width:
          30px;

        height:
          30px;


        border-radius:
          9px;


        color:

          var(
            --purple-primary,
            #6366f1
          );


        background:

          rgba(
            99,
            102,
            241,
            .09
          );
      }


      #${BUTTON_ID}
      .medsim-backup-menu-text {

        overflow:
          hidden;

        text-overflow:
          ellipsis;

        white-space:
          nowrap;
      }


      /* ======================================================
         FALLBACK
         ====================================================== */

      #${BUTTON_ID}.medsim-backup-fallback {

        position:
          fixed;

        left:
          14px;

        bottom:
          14px;

        z-index:
          2147481000;


        width:
          auto;


        padding-right:
          16px;


        background:

          var(
            --card-bg,
            #ffffff
          );


        border:

          1px solid
          var(
            --border-color,
            rgba(148,163,184,.24)
          );


        box-shadow:

          0 10px 28px
          rgba(
            15,
            23,
            42,
            .12
          );
      }


      /* ======================================================
         FUNDO DO MODAL
         ====================================================== */

      #${MODAL_ID} {

        position:
          fixed;

        inset:
          0;


        z-index:
          2147482000;


        display:
          none;


        align-items:
          center;

        justify-content:
          center;


        padding:
          20px;


        box-sizing:
          border-box;


        background:

          rgba(
            15,
            23,
            42,
            .42
          );


        backdrop-filter:
          blur(6px);

        -webkit-backdrop-filter:
          blur(6px);
      }


      #${MODAL_ID}[
        data-open="true"
      ] {

        display:
          flex;
      }


      /* ======================================================
         CARD PRINCIPAL
         ====================================================== */

      #${MODAL_ID}
      .medsim-backup-card {

        width:

          min(
            540px,
            100%
          );


        max-height:
          calc(100vh - 40px);


        overflow:
          auto;


        box-sizing:
          border-box;


        padding:
          20px;


        border:

          1px solid
          var(
            --border-color,
            rgba(148,163,184,.22)
          );


        border-radius:
          18px;


        background:

          var(
            --card-bg,
            #ffffff
          );


        color:

          var(
            --text-primary,
            #0f172a
          );


        box-shadow:

          0 24px 70px
          rgba(
            15,
            23,
            42,
            .22
          );
      }


      /* ======================================================
         CABEÇALHO
         ====================================================== */

      #${MODAL_ID}
      .medsim-backup-head {

        display:
          flex;

        align-items:
          flex-start;

        justify-content:
          space-between;

        gap:
          14px;


        margin-bottom:
          18px;
      }


      #${MODAL_ID}
      .medsim-backup-heading {

        display:
          flex;

        align-items:
          center;

        gap:
          12px;


        min-width:
          0;
      }


      #${MODAL_ID}
      .medsim-backup-heading-icon {

        flex:
          0 0 auto;


        display:
          inline-flex;

        align-items:
          center;

        justify-content:
          center;


        width:
          42px;

        height:
          42px;


        border-radius:
          12px;


        color:
          #ffffff;


        background:

          linear-gradient(
            135deg,
            #4f46e5,
            #7c3aed
          );


        box-shadow:

          0 6px 16px
          rgba(
            79,
            70,
            229,
            .22
          );
      }


      #${MODAL_ID}
      .medsim-backup-title {

        font-size:
          1.02rem;


        line-height:
          1.25;


        font-weight:
          800;
      }


      #${MODAL_ID}
      .medsim-backup-subtitle {

        margin-top:
          3px;


        color:

          var(
            --text-secondary,
            #64748b
          );


        font-size:
          .78rem;


        line-height:
          1.35;
      }


      #${MODAL_ID}
      .medsim-backup-close {

        flex:
          0 0 auto;


        display:
          inline-flex;

        align-items:
          center;

        justify-content:
          center;


        width:
          34px;

        height:
          34px;


        padding:
          0;


        border:
          0;


        border-radius:
          10px;


        background:

          rgba(
            148,
            163,
            184,
            .08
          );


        color:

          var(
            --text-secondary,
            #64748b
          );


        font:
          inherit;


        font-size:
          21px;


        cursor:
          pointer;
      }


      #${MODAL_ID}
      .medsim-backup-close:hover {

        background:

          rgba(
            148,
            163,
            184,
            .16
          );
      }


      /* ======================================================
         STATUS
         ====================================================== */

      #${MODAL_ID}
      .medsim-backup-status {

        display:
          flex;

        align-items:
          center;

        gap:
          10px;


        padding:
          11px 12px;


        margin-bottom:
          18px;


        border:

          1px solid
          rgba(
            99,
            102,
            241,
            .14
          );


        border-radius:
          12px;


        background:

          rgba(
            99,
            102,
            241,
            .055
          );
      }


      #${MODAL_ID}
      .medsim-backup-status-icon {

        flex:
          0 0 auto;


        display:
          flex;

        align-items:
          center;

        justify-content:
          center;


        width:
          28px;

        height:
          28px;


        border-radius:
          50%;


        background:

          rgba(
            99,
            102,
            241,
            .11
          );


        color:

          var(
            --purple-primary,
            #6366f1
          );


        font-size:
          .78rem;


        font-weight:
          900;
      }


      #${MODAL_ID}
      .medsim-backup-status
      strong {

        display:
          block;


        margin-bottom:
          2px;


        font-size:
          .76rem;


        font-weight:
          750;
      }


      #${MODAL_ID}
      .medsim-backup-status
      span {

        color:

          var(
            --text-secondary,
            #64748b
          );


        font-size:
          .76rem;
      }


      /* ======================================================
         TÍTULO DA SEÇÃO
         ====================================================== */

      #${MODAL_ID}
      .medsim-backup-section-title {

        margin-bottom:
          8px;


        color:

          var(
            --text-secondary,
            #64748b
          );


        font-size:
          .72rem;


        font-weight:
          800;


        letter-spacing:
          .04em;


        text-transform:
          uppercase;
      }


      /* ======================================================
         AÇÕES
         ====================================================== */

      #${MODAL_ID}
      .medsim-backup-grid {

        display:
          grid;


        grid-template-columns:
          1fr 1fr;


        gap:
          9px;
      }


      #${MODAL_ID}
      .medsim-backup-action {

        display:
          flex;

        align-items:
          center;

        gap:
          10px;


        min-height:
          64px;


        padding:
          10px 12px;


        box-sizing:
          border-box;


        border:

          1px solid
          var(
            --border-color,
            rgba(148,163,184,.22)
          );


        border-radius:
          12px;


        background:

          var(
            --card-bg,
            #ffffff
          );


        color:

          var(
            --text-primary,
            #0f172a
          );


        font:
          inherit;


        text-align:
          left;


        cursor:
          pointer;


        transition:

          transform .16s ease,
          border-color .16s ease,
          box-shadow .16s ease,
          background .16s ease;
      }


      #${MODAL_ID}
      .medsim-backup-action:hover {

        transform:
          translateY(-1px);


        border-color:

          rgba(
            99,
            102,
            241,
            .26
          );


        box-shadow:

          0 5px 14px
          rgba(
            15,
            23,
            42,
            .07
          );
      }


      #${MODAL_ID}
      .medsim-backup-action
      .medsim-action-icon {

        flex:
          0 0 auto;


        display:
          flex;

        align-items:
          center;

        justify-content:
          center;


        width:
          31px;

        height:
          31px;


        border-radius:
          9px;


        background:

          rgba(
            99,
            102,
            241,
            .08
          );


        color:

          var(
            --purple-primary,
            #6366f1
          );


        font-size:
          1rem;


        font-weight:
          800;
      }


      #${MODAL_ID}
      .medsim-backup-action
      strong {

        display:
          block;


        font-size:
          .78rem;


        font-weight:
          750;


        line-height:
          1.25;
      }


      #${MODAL_ID}
      .medsim-backup-action
      small {

        display:
          block;


        margin-top:
          2px;


        color:

          var(
            --text-secondary,
            #64748b
          );


        font-size:
          .68rem;


        line-height:
          1.25;
      }


      /* Ação principal */

      #${MODAL_ID}
      .medsim-backup-action.primary {

        border-color:

          rgba(
            99,
            102,
            241,
            .20
          );


        background:

          rgba(
            99,
            102,
            241,
            .055
          );
      }


      #${MODAL_ID}
      .medsim-backup-action.primary
      .medsim-action-icon {

        color:
          #ffffff;


        background:

          linear-gradient(
            135deg,
            #4f46e5,
            #7c3aed
          );
      }


      /* Ação destrutiva */

      #${MODAL_ID}
      .medsim-backup-action.danger {

        border-color:

          rgba(
            220,
            38,
            38,
            .14
          );
      }


      #${MODAL_ID}
      .medsim-backup-action.danger
      .medsim-action-icon {

        color:
          #dc2626;


        background:

          rgba(
            220,
            38,
            38,
            .08
          );
      }


      #${MODAL_ID}
      .medsim-backup-action.danger:hover {

        border-color:

          rgba(
            220,
            38,
            38,
            .28
          );
      }


      /* ======================================================
         PRIVACIDADE
         ====================================================== */

      #${MODAL_ID}
      .medsim-backup-privacy {

        display:
          flex;

        align-items:
          flex-start;

        gap:
          8px;


        margin-top:
          14px;


        padding:
          10px 11px;


        border-radius:
          10px;


        background:

          rgba(
            148,
            163,
            184,
            .065
          );


        color:

          var(
            --text-secondary,
            #64748b
          );


        font-size:
          .70rem;


        line-height:
          1.45;
      }


      /* ======================================================
         MENSAGENS
         ====================================================== */

      #medsim-backup-message {

        display:
          none;


        margin-top:
          12px;


        padding:
          9px 11px;


        border-radius:
          10px;


        font-size:
          .76rem;


        line-height:
          1.4;
      }


      #medsim-backup-message[
        data-show="true"
      ] {

        display:
          block;
      }


      #medsim-backup-message[
        data-type="success"
      ] {

        background:

          rgba(
            22,
            163,
            74,
            .08
          );


        color:
          #15803d;
      }


      #medsim-backup-message[
        data-type="error"
      ] {

        background:

          rgba(
            220,
            38,
            38,
            .08
          );


        color:
          #b91c1c;
      }


      #medsim-backup-message[
        data-type="info"
      ] {

        background:

          rgba(
            99,
            102,
            241,
            .08
          );


        color:

          var(
            --purple-primary,
            #4f46e5
          );
      }


      /* ======================================================
         CELULAR
         ====================================================== */

      @media (
        max-width:
        560px
      ) {

        #${MODAL_ID} {

          padding:
            12px;
        }


        #${MODAL_ID}
        .medsim-backup-card {

          padding:
            16px;


          border-radius:
            15px;
        }


        #${MODAL_ID}
        .medsim-backup-grid {

          grid-template-columns:
            1fr;
        }


        #${MODAL_ID}
        .medsim-backup-action {

          min-height:
            58px;
        }

      }

    `;


    document.head
      .appendChild(style);
  }


  /* ============================================================
     INTERFACE
     ============================================================ */

  function buildUI() {

    injectStyle();


    if (
      !document.getElementById(
        MODAL_ID
      )
    ) {

      const modal =
        document.createElement(
          'div'
        );


      modal.id =
        MODAL_ID;


      modal.dataset.open =
        'false';


      modal.innerHTML = `

        <div
          class="medsim-backup-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="medsim-backup-title">


          <div class="medsim-backup-head">

            <div class="medsim-backup-heading">


              <div
                class="medsim-backup-heading-icon"
                aria-hidden="true">

                <svg
                  viewBox="0 0 24 24"
                  width="21"
                  height="21"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round">

                  <path d="M12 3v12"></path>
                  <path d="m7 10 5 5 5-5"></path>
                  <path d="M5 21h14"></path>

                </svg>

              </div>


              <div>

                <div
                  id="medsim-backup-title"
                  class="medsim-backup-title">

                  Backup dos meus dados

                </div>


                <div class="medsim-backup-subtitle">

                  Proteja e transfira seu progresso no MedSim

                </div>

              </div>

            </div>


            <button
              type="button"
              class="medsim-backup-close"
              aria-label="Fechar">

              ×

            </button>

          </div>



          <div class="medsim-backup-status">

            <div class="medsim-backup-status-icon">
              ✓
            </div>


            <div>

              <strong>
                Último backup exportado
              </strong>


              <span id="medsim-backup-last">

                Nenhum backup exportado ainda

              </span>

            </div>

          </div>



          <div class="medsim-backup-section-title">

            Gerenciar meus dados

          </div>



          <div class="medsim-backup-grid">


            <button
              type="button"
              class="medsim-backup-action primary"
              data-action="export">

              <span class="medsim-action-icon">
                ↓
              </span>


              <span>

                <strong>
                  Exportar backup
                </strong>

                <small>
                  Salvar meus dados
                </small>

              </span>

            </button>



            <button
              type="button"
              class="medsim-backup-action"
              data-action="restore">

              <span class="medsim-action-icon">
                ↑
              </span>


              <span>

                <strong>
                  Restaurar backup
                </strong>

                <small>
                  Importar arquivo salvo
                </small>

              </span>

            </button>



            <button
              type="button"
              class="medsim-backup-action"
              data-action="refresh">

              <span class="medsim-action-icon">
                ↻
              </span>


              <span>

                <strong>
                  Ver último backup
                </strong>

                <small>
                  Atualizar informação
                </small>

              </span>

            </button>



            <button
              type="button"
              class="medsim-backup-action danger"
              data-action="clear">

              <span class="medsim-action-icon">
                ×
              </span>


              <span>

                <strong>
                  Limpar meus dados
                </strong>

                <small>
                  Apagar dados deste navegador
                </small>

              </span>

            </button>


          </div>



          <div class="medsim-backup-privacy">

            <span aria-hidden="true">
              ◉
            </span>


            <span>

              Seus dados ficam armazenados neste navegador.
              O MedSim não envia seu histórico para um servidor.

            </span>

          </div>



          <div
            id="medsim-backup-message"
            data-show="false"
            data-type="info">

          </div>



          <input
            id="${FILE_INPUT_ID}"
            type="file"
            accept=".json,application/json"
            hidden>


        </div>

      `;


      document.body
        .appendChild(modal);


      modal
        .querySelector(
          '.medsim-backup-close'
        )
        .addEventListener(
          'click',
          closeModal
        );


      modal.addEventListener(

        'pointerdown',

        function (event) {

          if (
            event.target ===
            modal
          ) {

            closeModal();
          }

        }

      );


      modal
        .querySelector(
          '[data-action="export"]'
        )
        .addEventListener(
          'click',
          exportBackup
        );


      modal
        .querySelector(
          '[data-action="restore"]'
        )
        .addEventListener(

          'click',

          function () {

            const input =
              document.getElementById(
                FILE_INPUT_ID
              );


            input.value =
              '';


            input.click();

          }

        );


      modal
        .querySelector(
          '[data-action="refresh"]'
        )
        .addEventListener(

          'click',

          function () {

            updateStatus();


            showMessage(

              'Informação do último backup atualizada.',

              'info'

            );

          }

        );


      modal
        .querySelector(
          '[data-action="clear"]'
        )
        .addEventListener(
          'click',
          clearMyData
        );


      document
        .getElementById(
          FILE_INPUT_ID
        )
        .addEventListener(

          'change',

          function (event) {

            restoreFromFile(

              event.target.files &&
              event.target.files[0]

            );

          }

        );
    }


    ensureButton();

    updateStatus();
  }


  /* ============================================================
     BOTÃO DO HUB
     ============================================================ */

  function ensureButton() {

    let button =
      document.getElementById(
        BUTTON_ID
      );


    if (!button) {

      button =
        document.createElement(
          'button'
        );


      button.id =
        BUTTON_ID;


      button.type =
        'button';


      button.innerHTML = `

        <span
          class="medsim-backup-menu-icon"
          aria-hidden="true">

          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round">

            <path d="M12 3v12"></path>
            <path d="m7 10 5 5 5-5"></path>
            <path d="M5 21h14"></path>

          </svg>

        </span>


        <span class="medsim-backup-menu-text">

          Backup dos meus dados

        </span>

      `;


      button.addEventListener(
        'click',
        openModal
      );
    }


    const nav =
      document.querySelector(
        '.nav-menu'
      );


    const sidebar =
      document.querySelector(
        '.sidebar'
      );


    if (nav) {

      if (
        button.parentElement !==
        nav
      ) {

        nav.appendChild(
          button
        );
      }


      button.classList.remove(
        'medsim-backup-fallback'
      );


    } else if (sidebar) {

      if (
        button.parentElement !==
        sidebar
      ) {

        sidebar.appendChild(
          button
        );
      }


      button.classList.remove(
        'medsim-backup-fallback'
      );


    } else if (
      !button.isConnected
    ) {

      document.body
        .appendChild(button);


      button.classList.add(
        'medsim-backup-fallback'
      );
    }
  }


  /* ============================================================
     ABRIR / FECHAR
     ============================================================ */

  function openModal() {

    const modal =
      document.getElementById(
        MODAL_ID
      );


    if (!modal) {
      return;
    }


    updateStatus();


    modal.dataset.open =
      'true';
  }


  function closeModal() {

    const modal =
      document.getElementById(
        MODAL_ID
      );


    if (modal) {

      modal.dataset.open =
        'false';
    }
  }


  /* ============================================================
     STATUS
     ============================================================ */

  function updateStatus() {

    const target =
      document.getElementById(
        'medsim-backup-last'
      );


    if (!target) {
      return;
    }


    const last =
      localStorage.getItem(
        LAST_EXPORT_KEY
      );


    const count =
      listMedSimKeys()
        .length;


    target.textContent =

      `${formatDate(last)} · `

      +

      `${count} item(ns) locais atualmente`;
  }


  /* ============================================================
     MENSAGENS
     ============================================================ */

  function showMessage(
    message,
    type,
    persistent
  ) {

    const box =
      document.getElementById(
        'medsim-backup-message'
      );


    if (!box) {
      return;
    }


    box.textContent =
      message;


    box.dataset.type =
      type || 'info';


    box.dataset.show =
      'true';


    clearTimeout(
      showMessage._timer
    );


    // Keep critical rollback failure visible until the user closes the modal.
    if (persistent) {
      showMessage._timer = null;
      return;
    }


    showMessage._timer =
      setTimeout(

        function () {

          box.dataset.show =
            'false';

        },
        5000

      );
  }


  /* ============================================================
     DETECTAR SIMULADO ABERTO
     ============================================================ */

  function simulatorOpen() {

    return [

      ...document.querySelectorAll(
        'iframe'
      )

    ].some(
      frame => {

        const src =
          (
            frame.getAttribute(
              'src'
            ) || ''
          ).trim();


        if (
          !src ||
          src === 'about:blank'
        ) {

          return false;
        }


        const style =
          getComputedStyle(
            frame
          );


        if (
          style.display === 'none' ||
          style.visibility === 'hidden'
        ) {

          return false;
        }


        const rect =
          frame.getBoundingClientRect();


        return (
          rect.width > 0 &&
          rect.height > 0
        );
      }
    );
  }


  /* ============================================================
     MOSTRAR SOMENTE NO HUB
     ============================================================ */

  function syncHubVisibility() {

    ensureButton();


    const button =
      document.getElementById(
        BUTTON_ID
      );


    if (!button) {
      return;
    }


    const open =
      simulatorOpen();


    button.style.display =
      open
        ? 'none'
        : '';


    if (open) {

      closeModal();
    }
  }


  /* ============================================================
     INICIALIZAÇÃO
     ============================================================ */

  function start() {

    buildUI();


    syncHubVisibility();


    document.addEventListener(

      'keydown',

      function (event) {

        if (
          event.key === 'Escape'
        ) {

          closeModal();
        }

      }

    );


    const observer =
      new MutationObserver(

        function () {

          ensureButton();

          syncHubVisibility();

        }

      );


    observer.observe(

      document.body,

      {

        childList:
          true,

        subtree:
          true

      }

    );


    setInterval(

      syncHubVisibility,

      700

    );


    console.info(

      '[MedSim] Backup dos meus dados v2 ativo.'

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
        once: true
      }

    );

  } else {

    start();
  }

})();
