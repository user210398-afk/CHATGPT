import { useRef, useState } from 'react';
import type { Catalog } from '../../../schema/catalog';
import { confirmImport, exportBackup, prepareImport, type ImportPlan } from '../../engine/backup';
import { downloadBackup, readBackupFile } from '../../engine/backup-browser';
import { dateTime } from '../dashboard/Metrics';
export function BackupControls({ catalog }: { catalog: Catalog }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [applyPreferences, setApplyPreferences] = useState(false);
  const [report, setReport] = useState<ReturnType<typeof confirmImport> | null>(null);
  const generation = useRef(0);
  async function exportFile() {
    setBusy(true);
    setError(null);
    try {
      downloadBackup(await exportBackup(catalog));
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível exportar.');
    } finally {
      setBusy(false);
    }
  }
  async function importFile(file?: File) {
    const request = ++generation.current;
    setPlan(null);
    setReport(null);
    setError(null);
    if (!file) return;
    setBusy(true);
    try {
      const next = await prepareImport(await readBackupFile(file), catalog);
      if (generation.current !== request) return;
      setPlan(next);
      setApplyPreferences(next.applyPreferencesByDefault);
    } catch (error) {
      if (generation.current === request)
        setError(error instanceof Error ? error.message : 'Não foi possível ler o backup.');
    } finally {
      if (generation.current === request) setBusy(false);
    }
  }
  function confirm() {
    if (!plan) return;
    try {
      setReport(confirmImport(plan, applyPreferences));
      setPlan(null);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Não foi possível importar.');
      setPlan(null);
    }
  }
  return (
    <section className="card backup-controls" aria-labelledby="backup-title">
      <p className="eyebrow">PROTEÇÃO DOS SEUS DADOS</p>
      <h2 id="backup-title">Backup do progresso</h2>
      <p>
        Seus dados ficam neste navegador. Guarde uma cópia para recuperar seu progresso em outro
        dispositivo ou após limpar os dados locais.
      </p>
      <p className="muted">
        Backup v3; leitura de v1, v2 e v3. Arquivo JSON local, até 10 MiB. Nenhum dado é enviado. A
        importação mescla registros e preserva conflitos locais.
      </p>
      <div className="backup-actions">
        <div className="backup-action">
          <h3>Guardar uma cópia</h3>
          <p className="muted small">Baixe seu progresso em um arquivo local.</p>
          <button disabled={busy} onClick={() => void exportFile()}>
            Exportar progresso
          </button>
        </div>
        <div className="backup-action backup-file">
          <h3>Restaurar uma cópia</h3>
          <p className="muted small">Escolha um arquivo e confira a prévia antes de importar.</p>
          <label className="field-label" htmlFor="backup-file">
            Importar progresso
          </label>
          <input
            id="backup-file"
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void importFile(file);
            }}
          />
        </div>
      </div>
      <p className="muted small backup-format">
        JSON local · até 10 MiB · compatível com backups v1–v3 · zero upload
      </p>
      {busy && <p role="status">Validando progresso…</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {plan && (
        <section className="import-preview" aria-labelledby="preview-title">
          <h3 id="preview-title">Prévia da importação</h3>
          <dl className="preview-metrics">
            <div>
              <dt>Backup criado em</dt>
              <dd>{dateTime(plan.exportedAt)}</dd>
            </div>
            <div>
              <dt>Provas compatíveis</dt>
              <dd>{plan.compatibleExams}</dd>
            </div>
            <div>
              <dt>Tentativas atuais</dt>
              <dd>{plan.currents}</dd>
            </div>
            <div>
              <dt>Conclusões de histórico</dt>
              <dd>{plan.completions}</dd>
            </div>
            <div>
              <dt>Favoritos</dt>
              <dd>{plan.favorites}</dd>
            </div>
            <div>
              <dt>Preferências de interface</dt>
              <dd>{plan.hasUiPreferences ? 'sim' : 'não'}</dd>
            </div>
            <div>
              <dt>Conflitos preservados</dt>
              <dd>{plan.conflicts}</dd>
            </div>
          </dl>
          {plan.issues.length > 0 && (
            <ul>
              {plan.issues.map((issue, i) => (
                <li key={i}>{issue}</li>
              ))}
            </ul>
          )}
          {plan.preferenceChange && (
            <label className="setting-check">
              <input
                type="checkbox"
                checked={applyPreferences}
                onChange={(event) => setApplyPreferences(event.target.checked)}
              />
              Aplicar preferências de aparência e acessibilidade do backup
            </label>
          )}
          <p className="muted small">
            Nenhuma alteração foi gravada. Confirme para mesclar os dados compatíveis.
          </p>
          <div className="actions">
            <button className="primary" onClick={confirm}>
              Confirmar importação
            </button>
            <button onClick={() => setPlan(null)}>Cancelar</button>
          </div>
        </section>
      )}
      {report && (
        <div className="import-report">
          <p role="status">
            Importação concluída: {report.importedExams} provas importadas; {report.historiesMerged}{' '}
            conclusões mescladas; {report.conflicts} conflitos preservados; {report.favoritesAdded}{' '}
            favoritos adicionados. Preferências{' '}
            {report.preferencesApplied ? 'aplicadas' : 'preservadas'}. {report.discarded} conclusões
            descartadas pelo limite.
          </p>
          <button onClick={() => window.location.reload()}>Recarregar para aplicar</button>
        </div>
      )}
    </section>
  );
}
