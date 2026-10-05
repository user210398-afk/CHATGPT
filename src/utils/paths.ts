import { identifier } from '../../schema/exam';
export function sitePath(relative: string): string {
  return `${import.meta.env.BASE_URL}${relative}`;
}
export function examUrl(id: string): string {
  return `${sitePath('')}?exam=${encodeURIComponent(identifier.parse(id))}`;
}
export function dashboardUrl(): string {
  return `${sitePath('')}?view=dashboard`;
}
export function settingsUrl(): string {
  return `${sitePath('')}?view=settings`;
}
export function resolveRoute(search: string): {
  view: 'catalog' | 'dashboard' | 'settings' | 'review' | 'exam';
  reviewExam?: string;
  attempt?: string;
  id?: string;
} {
  const params = new URLSearchParams(search),
    id = params.get('exam');
  if (id !== null && identifier.safeParse(id).success) return { view: 'exam', id };
  const view = params.get('view');
  if (view === 'review') {
    const reviewExam = params.get('reviewExam'),
      attempt = params.get('attempt');
    return {
      view,
      ...(reviewExam && identifier.safeParse(reviewExam).success && attempt && attempt.length <= 256
        ? { reviewExam, attempt }
        : {}),
    };
  }
  return { view: view === 'dashboard' || view === 'settings' ? view : 'catalog' };
}

export function reviewUrl(examId?: string, attemptId?: string): string {
  return `${sitePath('')}?view=review${examId && attemptId ? `&reviewExam=${encodeURIComponent(identifier.parse(examId))}&attempt=${encodeURIComponent(attemptId)}` : ''}`;
}
