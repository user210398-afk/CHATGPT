import type { CatalogExam, ExamProgressSummary } from './catalog-progress';

export type SubjectGroupDefinition = {
  readonly id: string;
  readonly title: string;
  readonly aliases: readonly string[];
  readonly monogram: string;
  readonly order: number;
};

// Presentation metadata only: never rewrite the academic Exam.subject.
export const subjectGroupDefinitions: readonly SubjectGroupDefinition[] = [
  {
    id: 'farmacologia',
    title: 'Farmacologia',
    aliases: ['Farmacologia', 'Farmacologia Básica'],
    monogram: 'F',
    order: 0,
  },
  { id: 'fisiologia', title: 'Fisiologia', aliases: ['Fisiologia'], monogram: 'FI', order: 1 },
  { id: 'imunologia', title: 'Imunologia', aliases: ['Imunologia'], monogram: 'I', order: 2 },
  {
    id: 'microbiologia-e-virologia',
    title: 'Microbiologia e Virologia',
    aliases: ['Microbiologia/Virologia'],
    monogram: 'MV',
    order: 3,
  },
  {
    id: 'parasitologia',
    title: 'Parasitologia',
    aliases: ['Parasitologia'],
    monogram: 'PA',
    order: 4,
  },
  {
    id: 'patologia',
    title: 'Patologia',
    aliases: ['Patologia/Imunologia'],
    monogram: 'PT',
    order: 5,
  },
  {
    id: 'propedeutica',
    title: 'Propedêutica',
    aliases: ['Propedêutica', 'Propedêutica/Clínica Médica'],
    monogram: 'PR',
    order: 6,
  },
];

export type SubjectGroup = SubjectGroupDefinition & {
  exams: CatalogExam[];
  examCount: number;
  questionCount: number;
  completedCount: number;
  inProgressCount: number;
  notStartedCount: number;
};

export function subjectGroupDefinition(subject: string): SubjectGroupDefinition {
  const known = subjectGroupDefinitions.find((group) => group.aliases.includes(subject));
  if (known) return known;
  const slug =
    subject
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'materia';
  // An injective suffix from the original name avoids hash/slug collisions and
  // stays stable even if another subject is added later. No catalog index/storage.
  const identity = Array.from(subject, (char) => char.codePointAt(0)!.toString(16)).join('-');
  return {
    id: `custom-${slug}--${identity}`,
    title: subject,
    aliases: [subject],
    monogram: subject
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => Array.from(word)[0])
      .join('')
      .toUpperCase(),
    order: subjectGroupDefinitions.length,
  };
}

export function groupCatalogExams(
  exams: readonly CatalogExam[],
  progress: ReadonlyMap<string, ExamProgressSummary> = new Map(),
): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  for (const exam of exams) {
    const definition = subjectGroupDefinition(exam.subject);
    let group = groups.get(definition.id);
    if (!group) {
      group = {
        ...definition,
        exams: [],
        examCount: 0,
        questionCount: 0,
        completedCount: 0,
        inProgressCount: 0,
        notStartedCount: 0,
      };
      groups.set(group.id, group);
    }
    group.exams.push(exam);
    group.examCount++;
    group.questionCount += exam.questionCount;
    const status = progress.get(exam.id)?.status ?? 'not-started';
    if (status === 'completed') group.completedCount++;
    else if (status === 'in-progress') group.inProgressCount++;
    else group.notStartedCount++;
  }
  // Explicit code-point tie-break keeps fallback ordering independent of input.
  const collator = new Intl.Collator('pt-BR');
  return [...groups.values()].sort(
    (a, b) =>
      a.order - b.order ||
      collator.compare(a.title, b.title) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

export function subjectHubTotals(groups: readonly SubjectGroup[]) {
  return groups.reduce(
    (total, group) => ({
      subjectCount: total.subjectCount + 1,
      examCount: total.examCount + group.examCount,
      questionCount: total.questionCount + group.questionCount,
    }),
    { subjectCount: 0, examCount: 0, questionCount: 0 },
  );
}
