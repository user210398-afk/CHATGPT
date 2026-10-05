import { useState } from 'react';
import type { Exam } from '../../types/exam';
import type { Attempt } from '../../engine/exam-state';
import {
  defaultReviewFilters,
  reviewCounts,
  reviewQuestionIndices,
  type ReviewFilters,
  type ReviewStatus,
} from '../../engine/review-filters';
import { QuestionCard } from '../questions/QuestionCard';
import { QuestionNavigation } from '../exam/QuestionNavigation';
export function ReviewView({
  exam,
  attempt,
  onFlag,
}: {
  exam: Exam;
  attempt: Attempt;
  onFlag: (id: string) => void;
}) {
  const [filters, setFilters] = useState<ReviewFilters>({ ...defaultReviewFilters });
  const [selected, setSelected] = useState(attempt.currentIndex);
  const indices = reviewQuestionIndices(exam, attempt, filters);
  const index = indices.includes(selected)
    ? selected
    : (indices.find((index) => index >= selected) ?? indices[0]);
  const position = index === undefined ? -1 : indices.indexOf(index);
  const counts = reviewCounts(exam, attempt);
  const categories = [...new Set(exam.questions.map((q) => q.category))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
  const tags = [...new Set(exam.questions.flatMap((q) => q.tags))].sort((a, b) =>
    a.localeCompare(b, 'pt-BR'),
  );
  const patch = (value: Partial<ReviewFilters>) => {
    setFilters((previous) => ({ ...previous, ...value }));
    setSelected(0);
  };
  return (
    <div className="page-stack">
      <section className="card" aria-labelledby="review-filter-title">
        <h2 id="review-filter-title">Revisar questões</h2>
        <p>
          {counts.correct} Acertadas · {counts.incorrect} Erradas · {counts.unanswered} Em branco ·{' '}
          {counts.essay} Dissertativas · {counts.flagged} Marcadas
        </p>
        <div className="settings-grid">
          <div className="setting-field">
            <label className="field-label" htmlFor="review-status">
              Respostas
            </label>
            <select
              id="review-status"
              value={filters.status}
              onChange={(e) => patch({ status: e.target.value as ReviewStatus })}
            >
              {(
                [
                  ['all', 'Todos'],
                  ['incorrect', 'Erradas'],
                  ['correct', 'Acertadas'],
                  ['unanswered', 'Em branco'],
                  ['essay', 'Dissertativas'],
                ] as const
              ).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="setting-field">
            <label className="field-label" htmlFor="review-flags">
              Marcação
            </label>
            <select
              id="review-flags"
              value={filters.flaggedOnly ? 'flagged' : 'all'}
              onChange={(e) => patch({ flaggedOnly: e.target.value === 'flagged' })}
            >
              <option value="all">Todas</option>
              <option value="flagged">Somente marcadas</option>
            </select>
          </div>
          <div className="setting-field">
            <label className="field-label" htmlFor="review-category">
              Categoria
            </label>
            <select
              id="review-category"
              value={filters.category}
              onChange={(e) => patch({ category: e.target.value })}
            >
              <option value="">Todas as categorias</option>
              {categories.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <div className="setting-field">
            <label className="field-label" htmlFor="review-tag">
              Tópico/tag
            </label>
            <select
              id="review-tag"
              value={filters.tag}
              onChange={(e) => patch({ tag: e.target.value })}
            >
              <option value="">Todos os tópicos</option>
              {tags.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
        </div>
        <button
          onClick={() => {
            setFilters({ ...defaultReviewFilters });
            setSelected(0);
          }}
        >
          Limpar filtros
        </button>
        <p role="status">{indices.length} questão(ões) nesta revisão.</p>
      </section>
      {index === undefined ? (
        <p role="status" className="notice">
          Nenhuma questão corresponde aos filtros.
        </p>
      ) : (
        <div className="exam-layout">
          <QuestionCard
            exam={exam}
            attempt={attempt}
            index={index}
            feedback
            onFlag={() => onFlag(exam.questions[index]!.id)}
          >
            <div className="question-controls">
              <button disabled={position <= 0} onClick={() => setSelected(indices[position - 1]!)}>
                ← Anterior
              </button>
              <span className="muted small">
                {position + 1} / {indices.length}
              </span>
              <button
                className="primary"
                disabled={position === indices.length - 1}
                onClick={() => setSelected(indices[position + 1]!)}
              >
                Próxima →
              </button>
            </div>
          </QuestionCard>
          <QuestionNavigation
            exam={exam}
            attempt={{ ...attempt, currentIndex: index }}
            indices={indices}
            onNavigate={setSelected}
          />
        </div>
      )}
    </div>
  );
}
