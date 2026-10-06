import { useEffect, useRef } from 'react';
import type { Exam } from '../../types/exam';
import type { QuestionState } from '../../engine/review-session';
import { RichContent } from '../common/RichContent';
import { Images } from '../common/Images';
import { QuestionRenderer } from './QuestionRenderer';
export function QuestionCard({
  exam,
  attempt,
  index,
  feedback,
  onAnswer,
  onFlag,
  onConfirm,
  children,
  isReviewSession = false,
}: {
  exam: Exam;
  attempt: QuestionState;
  index: number;
  feedback: boolean;
  onAnswer?: (value: string) => void;
  onFlag: () => void;
  onConfirm?: () => void;
  children?: React.ReactNode;
  isReviewSession?: boolean;
}) {
  const question = exam.questions[index]!;
  const section = exam.sections.find((section) => section.id === question.sectionId);
  const group = exam.groups.find((group) => group.id === question.groupId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [index]);
  return (
    <section className="card question-card">
      <div className="question-topline">
        <span className="badge">
          {section?.title ?? (question.type === 'essay' ? 'Dissertativa' : 'Objetiva')} ·{' '}
          {isReviewSession ? `Questão original: ${question.label}` : question.label}
        </span>
        <button
          className="flag-button"
          aria-pressed={attempt.flagged.includes(question.id)}
          onClick={onFlag}
        >
          {attempt.flagged.includes(question.id)
            ? '⚑ Desmarcar da revisão'
            : '⚑ Marcar para revisão'}
        </button>
      </div>
      <h2 ref={heading} tabIndex={-1}>
        Questão {index + 1} de {exam.questions.length}
        {isReviewSession ? ' da sessão' : ''}
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
        answer={attempt.answers[question.id]}
        readOnly={feedback}
        onAnswer={onAnswer ?? (() => {})}
      />
      {!attempt.completedAt && attempt.mode === 'study' && (
        <div className="study-confirmation">
          {feedback ? (
            <p role="status" className="badge">
              {question.type === 'essay'
                ? 'Resposta confirmada'
                : attempt.answers[question.id] === question.correctAnswer
                  ? 'Resposta correta'
                  : 'Resposta incorreta'}
            </p>
          ) : (
            (question.type === 'essay' || Boolean(attempt.answers[question.id])) && (
              <button
                className="primary"
                disabled={!attempt.answers[question.id]?.trim()}
                onClick={onConfirm}
              >
                {question.type === 'essay' ? 'Confirmar e comparar' : 'Confirmar resposta'}
              </button>
            )
          )}
        </div>
      )}
      {children}
    </section>
  );
}
