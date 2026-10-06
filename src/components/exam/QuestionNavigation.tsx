import type { Exam } from '../../types/exam';
import type { QuestionState } from '../../engine/review-session';
import { answeredCount } from '../../engine/exam-state';
import { questionBehaviors } from '../../engine/question-behaviors';
export function QuestionNavigation({
  exam,
  attempt,
  onNavigate,
  indices,
  title = 'Mapa da prova',
  isReviewSession = false,
}: {
  indices?: number[];
  title?: string;
  isReviewSession?: boolean;
  exam: Exam;
  attempt: QuestionState;
  onNavigate: (index: number) => void;
}) {
  const study = attempt.mode === 'study';
  const count = study ? attempt.confirmedQuestionIds.length : answeredCount(exam, attempt);
  const pending = study ? answeredCount(exam, attempt) - count : 0;
  return (
    <aside className="card navigation-card">
      <p className="eyebrow">SEU PERCURSO</p>
      <h2>{title}</h2>
      <div className="progress-label">
        <span>{study ? 'Confirmadas' : 'Respondidas'}</span>
        <strong>
          {count}/{exam.questions.length}
        </strong>
      </div>
      <progress
        aria-label={study ? 'Questões confirmadas' : 'Questões respondidas'}
        value={count}
        max={exam.questions.length}
      />
      <nav className="question-grid" aria-label="Navegar pelas questões">
        {exam.questions.map((q, index) => {
          if (indices && !indices.includes(index)) return null;
          const confirmed = attempt.confirmedQuestionIds.includes(q.id);
          const answered = questionBehaviors[q.type].isAnswered(attempt.answers[q.id]);
          const flagged = attempt.flagged.includes(q.id);
          return (
            <button
              key={q.id}
              className={`question-number ${answered ? 'answered' : ''} ${flagged ? 'flagged' : ''} ${confirmed ? 'confirmed' : ''}`}
              aria-current={index === attempt.currentIndex ? 'step' : undefined}
              aria-label={`Ir para questão ${index + 1}${isReviewSession ? ' da sessão' : ''}${study ? (confirmed ? ', confirmada' : answered ? ', resposta selecionada, aguardando confirmação' : ', em branco') : answered ? ', respondida' : ''}${flagged ? ', marcada para revisão' : ''}`}
              onClick={() => onNavigate(index)}
            >
              {index + 1}
              {study && confirmed && <small aria-hidden="true">✓</small>}
              {study && answered && !confirmed && <small aria-hidden="true">…</small>}
              {flagged && <span aria-hidden="true">•</span>}
            </button>
          );
        })}
      </nav>
      <div className="legend">
        <span>{study ? '✓ Confirmada · … Draft · Em branco' : '● Respondida'}</span>
        <span className="attention">● Revisar</span>
      </div>
      {pending > 0 && <p role="status">{pending} respostas pendentes de confirmação</p>}
      <p className="muted small">
        {attempt.completedAt
          ? 'Respostas preservadas. Você pode alterar as marcações de revisão.'
          : study
            ? 'Você pode editar cada resposta até confirmá-la.'
            : 'Você pode mudar suas respostas até finalizar a tentativa.'}
      </p>
    </aside>
  );
}
