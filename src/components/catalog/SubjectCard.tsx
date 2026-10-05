import type { SubjectGroup } from '../../engine/subject-groups';
import { subjectUrl } from '../../utils/paths';

export function SubjectCard({ group }: { group: SubjectGroup }) {
  const titleId = `subject-title-${group.id}`;
  return (
    <article className="card subject-card" aria-labelledby={titleId}>
      <span className="subject-monogram" aria-hidden="true">
        {group.monogram}
      </span>
      <h3 id={titleId}>{group.title}</h3>
      <p>
        {group.examCount} {group.examCount === 1 ? 'simulado' : 'simulados'} · {group.questionCount}{' '}
        questões
      </p>
      <p className="muted small subject-progress">
        {group.completedCount} {group.completedCount === 1 ? 'concluído' : 'concluídos'} ·{' '}
        {group.inProgressCount} em andamento · {group.notStartedCount}{' '}
        {group.notStartedCount === 1 ? 'não iniciado' : 'não iniciados'}
      </p>
      <a
        className="button subject-cta"
        href={subjectUrl(group.id)}
        aria-labelledby={`${titleId} subject-cta-${group.id}`}
      >
        <span id={`subject-cta-${group.id}`}>Abrir matéria →</span>
      </a>
    </article>
  );
}
