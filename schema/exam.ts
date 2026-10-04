import { z } from 'zod';

export const identifier = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use um ID estável em kebab-case');
const nonempty = z.string().refine((value) => value.trim().length > 0, 'Texto obrigatório');
// Somente caminhos locais, relativos ao site; sem URL, escape, query ou traversal.
export const assetPath = z
  .string()
  .regex(
    /^media\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpg|jpeg|webp|gif|avif)$/,
    'Imagem deve apontar para media/ e um arquivo raster local',
  );
export const imageSchema = z.strictObject({
  src: assetPath,
  alt: nonempty,
  caption: z.string().optional(),
});
export const richTag = z.enum([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'sub',
  'sup',
  'br',
  'p',
  'div',
  'span',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
]);
export const richNode = z
  .discriminatedUnion('type', [
    z.strictObject({ type: z.literal('text'), text: z.string() }),
    z.strictObject({
      type: z.literal('element'),
      tag: richTag,
      get children(): z.ZodArray<typeof richNode> {
        return z.array(richNode);
      },
    }),
  ])
  .superRefine((node, ctx) => {
    if (node.type === 'element' && node.tag === 'br' && node.children.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['children'],
        message: 'Quebra de linha não pode conter filhos',
      });
    }
  });
export const richText = z.array(richNode);
const requiredRichText = richText.refine((nodes) => hasText(nodes), 'Conteúdo textual obrigatório');
export type RichNode = z.infer<typeof richNode>;
export type RichText = z.infer<typeof richText>;
function hasText(nodes: RichText): boolean {
  return nodes.some((node) =>
    node.type === 'text' ? node.text.trim().length > 0 : hasText(node.children),
  );
}
const questionBase = {
  id: identifier,
  label: nonempty,
  sectionId: identifier.optional(),
  groupId: identifier.optional(),
  category: nonempty,
  statement: requiredRichText,
  context: richText.optional(),
  explanation: richText,
  images: z.array(imageSchema),
  tags: z.array(nonempty),
};
export const questionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...questionBase,
    type: z.literal('multiple-choice'),
    options: z.array(z.strictObject({ id: identifier, text: requiredRichText })).min(2),
    correctAnswer: identifier,
  }),
  z.strictObject({ ...questionBase, type: z.literal('essay'), modelAnswer: requiredRichText }),
]);
export const examStructure = z.strictObject({
  schemaVersion: z.literal(1),
  revision: z.number().int().positive(),
  id: identifier,
  title: nonempty,
  subject: nonempty,
  year: z.number().int().min(1900).max(2200).nullable(),
  division: nonempty,
  description: z.string(),
  tags: z.array(nonempty),
  images: z.array(imageSchema),
  settings: z.strictObject({
    questionOrder: z.literal('fixed'),
    feedback: z.literal('after-finish'),
  }),
  sections: z.array(z.strictObject({ id: identifier, title: nonempty })),
  groups: z.array(
    z.strictObject({
      id: identifier,
      title: nonempty,
      context: requiredRichText,
      images: z.array(imageSchema),
    }),
  ),
  provenance: z.strictObject({
    sourceFile: nonempty,
    sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
    notes: z.array(nonempty),
  }),
  questions: z.array(questionSchema).min(1),
});
export const examSchema = examStructure.superRefine((exam, ctx) => {
  const unique = (items: { id: string }[], path: (string | number)[]) => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      if (seen.has(item.id))
        ctx.addIssue({
          code: 'custom',
          path: [...path, i, 'id'],
          message: `ID duplicado: ${item.id}`,
        });
      seen.add(item.id);
    });
  };
  unique(exam.questions, ['questions']);
  unique(exam.sections, ['sections']);
  unique(exam.groups, ['groups']);
  exam.questions.forEach((q, i) => {
    for (const [field, items] of [
      ['sectionId', exam.sections],
      ['groupId', exam.groups],
    ] as const) {
      if (q[field] && !items.some((item) => item.id === q[field]))
        ctx.addIssue({
          code: 'custom',
          path: ['questions', i, field],
          message: 'Referência inexistente',
        });
    }
    if (q.type === 'multiple-choice') {
      unique(q.options, ['questions', i, 'options']);
      if (!q.options.some((option) => option.id === q.correctAnswer))
        ctx.addIssue({
          code: 'custom',
          path: ['questions', i, 'correctAnswer'],
          message: 'Gabarito não referencia uma alternativa existente',
        });
    }
  });
});

export function parseExam(input: unknown, file = 'prova'): z.infer<typeof examSchema> {
  const result = examSchema.safeParse(input);
  if (result.success) return result.data;
  const raw = input as { questions?: { id?: string }[] } | null;
  throw new Error(
    result.error.issues
      .map((issue) => {
        const position =
          issue.path[0] === 'questions' && typeof issue.path[1] === 'number'
            ? issue.path[1]
            : undefined;
        const question =
          position === undefined
            ? 'prova'
            : `questão ${raw?.questions?.[position]?.id ?? position + 1}`;
        return `${file} → ${question} → ${issue.path.join('.')} → ${issue.message}`;
      })
      .join('\n'),
  );
}
