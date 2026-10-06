import { identifier } from '../../schema/exam';
import { z } from 'zod';
import type { ReviewSession } from '../engine/review-session';

// Navigation state stays in browser URLs/history, never in domain storage.
// Bind positions to session identity so replacing/importing a session cannot reuse them.
const resumeSchema = z
  .array(
    z.strictObject({
      examId: identifier,
      examRevision: z.number().int().positive(),
      id: z.string().min(1).max(256),
      currentIndex: z.number().int().min(0).max(1999),
    }),
  )
  .max(200)
  .refine(
    (items) => new Set(items.map((s) => `${s.examId}:${s.examRevision}`)).size === items.length,
  );
type ResumeSession = Pick<ReviewSession, 'examId' | 'examRevision' | 'id' | 'currentIndex'>;
function readResume(search: string) {
  try {
    const raw = new URLSearchParams(search).get('reviewResume');
    if (!raw || raw.length > 100_000) return [];
    return resumeSchema.parse(JSON.parse(raw));
  } catch {
    return [];
  }
}
export function reviewResumePosition(session: ResumeSession, search: string): number {
  return (
    readResume(search).find(
      (s) =>
        s.examId === session.examId &&
        s.examRevision === session.examRevision &&
        s.id === session.id,
    )?.currentIndex ?? session.currentIndex
  );
}
export function rememberReviewPosition(session: ResumeSession) {
  const url = new URL(window.location.href);
  const positions = readResume(url.search)
    .filter((s) => s.examId !== session.examId || s.examRevision !== session.examRevision)
    .slice(-199);
  positions.push({
    examId: session.examId,
    examRevision: session.examRevision,
    id: session.id,
    currentIndex: session.currentIndex,
  });
  url.searchParams.set('reviewResume', JSON.stringify(resumeSchema.parse(positions)));
  url.searchParams.set('reviewPosition', String(session.currentIndex));
  window.history.replaceState(window.history.state, '', url);
}
export function withReviewResume(href: string): string {
  if (typeof window === 'undefined') return href;
  const positions = readResume(window.location.search);
  if (!positions.length) return href;
  const url = new URL(href, window.location.href);
  url.searchParams.set('reviewResume', JSON.stringify(positions));
  return `${url.pathname}${url.search}${url.hash}`;
}
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
  view: 'catalog' | 'dashboard' | 'settings' | 'review' | 'review-session' | 'exam';
  reviewExam?: string;
  attempt?: string;
  id?: string;
  area?: string;
  allExams?: boolean;
} {
  const params = new URLSearchParams(search),
    id = params.get('exam');
  if (id !== null && identifier.safeParse(id).success) return { view: 'exam', id };
  const view = params.get('view');
  if (view === 'review-session') {
    const reviewExam = params.get('reviewExam');
    return {
      view,
      ...(reviewExam && identifier.safeParse(reviewExam).success ? { reviewExam } : {}),
    };
  }
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
  if (view === 'dashboard' || view === 'settings') return { view };
  const area = params.get('area');
  return { view: 'catalog', ...(area !== null ? { area } : { allExams: view === 'all' }) };
}

export function reviewUrl(examId?: string, attemptId?: string): string {
  return `${sitePath('')}?view=review${examId && attemptId ? `&reviewExam=${encodeURIComponent(identifier.parse(examId))}&attempt=${encodeURIComponent(attemptId)}` : ''}`;
}

export function subjectUrl(id: string): string {
  return `${sitePath('')}?area=${encodeURIComponent(id)}`;
}

export function allExamsUrl(): string {
  return `${sitePath('')}?view=all`;
}

export function reviewSessionUrl(id: string): string {
  return withReviewResume(
    `${sitePath('')}?view=review-session&reviewExam=${encodeURIComponent(identifier.parse(id))}`,
  );
}
