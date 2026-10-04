import { useEffect, useRef, useState } from 'react';
import type { Exam } from '../../types/exam';
import { useExamSession } from '../../app/useExamSession';
import { answeredCount } from '../../engine/exam-state';
import { sitePath } from '../../utils/paths';
import { RichContent } from '../common/RichContent';
import { Images } from '../common/Images';
import { QuestionRenderer } from '../questions/QuestionRenderer';
import { Results } from '../results/Results';
import { QuestionNavigation } from './QuestionNavigation';
export function ExamPage({ exam }: { exam: Exam }) {
  const { current, history, restored, warning, dispatch, restart } = useExamSession(exam);
  const [review, setReview] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const question = exam.questions[current.currentIndex]!;
  const section = exam.sections.find((section) => section.id === question.sectionId);
  const group = exam.groups.find((group) => group.id === question.groupId);
  const finished = Boolean(current.completedAt);
  const showResult = finished && !review;
  const count = answeredCount(exam, current);
  useEffect(() => {
    heading.current?.focus();
  }, [current.currentIndex, review, showResult]);
  return (
    <>
      <a className="back-link" href={sitePath('')}>
        ← Catálogo de provas
      </a>
      <header className="page-heading">
        <p className="eyebrow">
          {exam.subject} / {exam.division} / {exam.year ?? 'Ano não informado'}
        </p>
        <h1>{exam.title}</h1>
        {exam.description && <p className="muted">{exam.description}</p>}
      </header>
      <Images images={exam.images} />
      {warning && (
        <p role="alert" className="notice">
          {warning}
        </p>
      )}
      {restored && <p className="save-status">✓ Tentativa restaurada neste navegador.</p>}
      {showResult ? (
        <Results
          attempt={current}
          history={history}
          onReview={() => setReview(true)}
          onRestart={() => {
            restart();
            setReview(false);
          }}
        />
      ) : (
        <>
          {review && (
            <div className="notice actions">
              <span>Revisão · respostas e resultado preservados.</span>
              <button onClick={() => setReview(false)}>Voltar ao resultado</button>
            </div>
          )}
          <div className="exam-layout">
            <section className="card question-card">
              <div className="question-topline">
                <span className="badge">
                  {section?.title ?? (question.type === 'essay' ? 'Dissertativa' : 'Objetiva')} ·{' '}
                  {question.label}
                </span>
                <button
                  className="flag-button"
                  disabled={finished}
                  aria-pressed={current.flagged.includes(question.id)}
                  onClick={() => dispatch({ type: 'flag', questionId: question.id })}
                >
                  {current.flagged.includes(question.id)
                    ? '⚑ Marcada para revisão'
                    : '⚑ Marcar para revisão'}
                </button>
              </div>
              <h2 ref={heading} tabIndex={-1}>
                Questão {current.currentIndex + 1} de {exam.questions.length}
              </h2>
              <p className="category">{question.category}</p>
              {group && (
                <section className="case-context">
                  <h3>{group.title}</h3>
                  <RichContent content={group.context} />
                  <Images images={group.images} />
                </section>
              )}
              {question.context && (
                <section className="case-context">
                  <RichContent content={question.context} />
                </section>
              )}
              <div className="statement">
                <RichContent content={question.statement} />
              </div>
              <Images images={question.images} />
              <QuestionRenderer
                question={question}
                answer={current.answers[question.id]}
                readOnly={finished}
                onAnswer={(value) => dispatch({ type: 'answer', questionId: question.id, value })}
              />
              <div className="question-controls">
                <button
                  disabled={current.currentIndex === 0}
                  onClick={() => dispatch({ type: 'navigate', index: current.currentIndex - 1 })}
                >
                  ← Anterior
                </button>
                <span className="muted small">
                  {current.currentIndex + 1} / {exam.questions.length}
                </span>
                <button
                  className="primary"
                  disabled={current.currentIndex === exam.questions.length - 1}
                  onClick={() => dispatch({ type: 'navigate', index: current.currentIndex + 1 })}
                >
                  Próxima →
                </button>
              </div>
            </section>
            <div className="exam-sidebar">
              <QuestionNavigation
                exam={exam}
                attempt={current}
                onNavigate={(index) => dispatch({ type: 'navigate', index })}
              />
              {!finished && (
                <section className="card finish-card">
                  <p className="save-status">
                    {warning
                      ? 'Salvamento local indisponível'
                      : '✓ Progresso salvo neste navegador'}
                  </p>
                  {confirmFinish ? (
                    <div role="region" aria-label="Confirmar finalização">
                      <h3>Finalizar tentativa?</h3>
                      <p>
                        {exam.questions.length - count} questão(ões) sem resposta. Após finalizar,
                        as respostas ficam disponíveis para revisão.
                      </p>
                      <div className="stack">
                        <button
                          className="primary"
                          onClick={() => {
                            dispatch({ type: 'finish', now: new Date().toISOString() });
                            setConfirmFinish(false);
                          }}
                        >
                          Confirmar finalização
                        </button>
                        <button onClick={() => setConfirmFinish(false)}>
                          Continuar respondendo
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button className="full-width" onClick={() => setConfirmFinish(true)}>
                      Finalizar tentativa
                    </button>
                  )}
                </section>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
