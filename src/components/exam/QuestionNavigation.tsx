import type { Exam } from '../../types/exam';
import type { Attempt } from '../../engine/exam-state';
import { answeredCount } from '../../engine/exam-state';
import { questionBehaviors } from '../../engine/question-behaviors';
export function QuestionNavigation({
  exam,
  attempt,
  onNavigate,
}: {
  exam: Exam;
  attempt: Attempt;
  onNavigate: (index: number) => void;
}) {
  const count = answeredCount(exam, attempt);
  return (
    <aside className="card navigation-card">
      <p className="eyebrow">SEU PERCURSO</p>
      <h2>Mapa da prova</h2>
      <div className="progress-label">
        <span>Respondidas</span>
        <strong>
          {count}/{exam.questions.length}
        </strong>
      </div>
      <progress aria-label="Questões respondidas" value={count} max={exam.questions.length} />
      <nav className="question-grid" aria-label="Navegar pelas questões">
        {exam.questions.map((q, index) => {
          const answered = questionBehaviors[q.type].isAnswered(attempt.answers[q.id]);
          const flagged = attempt.flagged.includes(q.id);
          return (
            <button
              key={q.id}
              className={`question-number ${answered ? 'answered' : ''} ${flagged ? 'flagged' : ''}`}
              aria-current={index === attempt.currentIndex ? 'step' : undefined}
              aria-label={`Ir para questão ${index + 1}${answered ? ', respondida' : ''}${flagged ? ', marcada para revisão' : ''}`}
              onClick={() => onNavigate(index)}
            >
              {index + 1}
              {flagged && <span aria-hidden="true">•</span>}
            </button>
          );
        })}
      </nav>
      <div className="legend">
        <span>● Respondida</span>
        <span className="attention">● Revisar</span>
      </div>
      <p className="muted small">Você pode mudar suas respostas até finalizar a tentativa.</p>
    </aside>
  );
}
