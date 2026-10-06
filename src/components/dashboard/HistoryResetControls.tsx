import { useEffect, useRef, useState } from 'react';
import type { Catalog } from '../../../schema/catalog';
import {
  confirmHistoryReset,
  prepareHistoryReset,
  type ResetPlan,
} from '../../engine/history-reset';
import { readExamProgress } from '../../engine/catalog-progress';
export function HistoryResetControls({
  catalog,
  onReset,
}: {
  catalog: Catalog;
  onReset: () => void;
}) {
  const [plan, setPlan] = useState<ResetPlan | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ReturnType<typeof confirmHistoryReset> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (plan) heading.current?.focus();
  }, [plan]);
  const progress = catalog.exams.map((exam) => readExamProgress(exam).progress);
  return (
    <section className="card history-reset" aria-labelledby="reset-title">
      <h2 id="reset-title">Dados e histórico</h2>
      <p>
        {progress.reduce((count, item) => count + item.attemptCount, 0)} tentativas concluídas
        registradas · {progress.filter((item) => item.attemptCount).length} provas com histórico ·{' '}
        {progress.filter((item) => item.status === 'in-progress').length} tentativas oficiais em
        andamento.
      </p>
      <p>
        Serão removidas as tentativas concluídas, seus históricos detalhados e sessões de revisão
        neste navegador. Exporte seu progresso na seção de backup antes de continuar.
      </p>
      <button
        ref={trigger}
        className="danger"
        onClick={() => {
          setError(null);
          setReport(null);
          setConfirmation('');
          try {
            setPlan(prepareHistoryReset(catalog));
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Não foi possível preparar o reset.');
          }
        }}
      >
        Zerar histórico e estatísticas
      </button>
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {plan && (
        <section
          className="confirmation-region"
          role="region"
          aria-labelledby="reset-confirm-title"
        >
          <h3 id="reset-confirm-title" ref={heading} tabIndex={-1}>
            Confirmar remoção do histórico
          </h3>
          <p>
            Esta ação apagará permanentemente as tentativas concluídas, seus históricos detalhados e
            sessões de revisão neste navegador. Favoritos, configurações e tentativas oficiais em
            andamento serão preservados.
          </p>
          <p>
            {plan.completed} conclusões registradas · {plan.sessions} sessões de revisão ·{' '}
            {plan.preserved} tentativas em andamento preservadas · {plan.affectedExams} provas
            afetadas.
          </p>
          <label className="field-label" htmlFor="reset-confirmation">
            Digite ZERAR para confirmar
          </label>
          <textarea
            id="reset-confirmation"
            rows={1}
            autoComplete="off"
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
          />
          <div className="actions">
            <button
              className="danger"
              disabled={confirmation !== 'ZERAR'}
              onClick={() => {
                try {
                  setReport(confirmHistoryReset(plan, confirmation));
                  setPlan(null);
                  setConfirmation('');
                  onReset();
                  trigger.current?.focus();
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Reset falhou.');
                  setPlan(null);
                  trigger.current?.focus();
                }
              }}
            >
              Confirmar reset do histórico
            </button>
            <button
              onClick={() => {
                setPlan(null);
                setConfirmation('');
                trigger.current?.focus();
              }}
            >
              Cancelar reset
            </button>
          </div>
        </section>
      )}
      {report && (
        <p role="status">
          Histórico zerado com sucesso. {report.completed} tentativas concluídas removidas;{' '}
          {report.sessions} sessões de revisão removidas; {report.preserved} tentativas em andamento
          preservadas.
        </p>
      )}
    </section>
  );
}
