import type { CatalogItem } from '../../engine/catalog-query';
import { examUrl } from '../../utils/paths';
const statusText = {
  'not-started': 'Não iniciada',
  'in-progress': 'Em andamento',
  completed: 'Concluída',
};
const actionText = {
  'not-started': 'Abrir prova',
  'in-progress': 'Continuar',
  completed: 'Ver prova',
};
export function ExamCard({
  item: { exam, progress, favorite },
  onFavorite,
}: {
  item: CatalogItem;
  onFavorite: (id: string) => void;
}) {
  const progressId = `catalog-progress-${exam.id}`;
  return (
    <article className="card exam-card" aria-labelledby={`catalog-title-${exam.id}`}>
      <div className="card-meta">
        <span className="badge">{exam.subject}</span>
        <span className="muted small">{exam.year ?? 'Ano não informado'}</span>
      </div>
      <div className="catalog-card-heading">
        <p className="eyebrow division">{exam.division}</p>
        <button
          className="favorite-button"
          aria-pressed={favorite}
          aria-label={`${favorite ? 'Remover' : 'Adicionar'} ${exam.title} ${favorite ? 'dos' : 'aos'} favoritos`}
          onClick={() => onFavorite(exam.id)}
        >
          <span aria-hidden="true">{favorite ? '★' : '☆'}</span>
        </button>
      </div>
      <h3 id={`catalog-title-${exam.id}`}>{exam.title}</h3>
      {exam.description && <p className="muted">{exam.description}</p>}
      <p className="muted small">
        {exam.objectiveCount} objetivas · {exam.essayCount} dissertativas
      </p>
      <div className="catalog-progress">
        <p className={`catalog-status catalog-status-${progress.status}`}>
          {statusText[progress.status]}
        </p>
        {progress.status === 'in-progress' && (
          <>
            <div className="progress-label" id={progressId}>
              <span>
                Respondidas {progress.answeredCount} de {progress.questionCount}
              </span>{' '}
              <span>{progress.progressPercentage}%</span>
            </div>
            <progress
              value={progress.answeredCount}
              max={progress.questionCount}
              aria-labelledby={progressId}
            />
          </>
        )}
        {progress.lastResultPercentage !== null && (
          <p className="small">Último resultado: {progress.lastResultPercentage}%</p>
        )}
        {progress.status === 'completed' && exam.objectiveCount === 0 && (
          <p className="small">Concluída · sem nota automática</p>
        )}
        {progress.attemptCount > 0 && (
          <p className="muted small">
            {progress.attemptCount}{' '}
            {progress.attemptCount === 1 ? 'tentativa concluída' : 'tentativas concluídas'}
          </p>
        )}
      </div>
      <div className="exam-card-footer">
        <span className="small">{exam.questionCount} questões</span>
        <a className="button primary" href={examUrl(exam.id)}>
          {actionText[progress.status]} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}
