import { expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readLegacy, pocSource } from '../scripts/legacy-data';
import { RichContent } from '../src/components/common/RichContent';
import type { RichText } from '../src/types/exam';
import { poc } from './fixtures';
// Comparação independente da conversão: DOM do texto original vs. DOM renderizado.
function canonical(html: string) {
  return new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
}
function render(content: RichText) {
  const html = renderToStaticMarkup(<RichContent content={content} />);
  const document = new DOMParser().parseFromString(html, 'text/html');
  return document.body.firstElementChild!.innerHTML;
}
it('preserva 30 enunciados, 100 alternativas, 20 gabaritos/explicações e 10 modelos, na ordem original', async () => {
  const legacy = await readLegacy(pocSource);
  expect(poc.questions).toHaveLength(legacy.objective.length + legacy.essay.length);
  legacy.objective.forEach((original, index) => {
    const q = poc.questions[index]!;
    if (q.type !== 'multiple-choice') throw new Error('Tipo alterado');
    expect(q.label).toBe(String(original.num));
    expect(q.category).toBe(original.category);
    expect(render(q.statement)).toBe(canonical(original.statement));
    expect(q.options).toHaveLength(original.options.length);
    original.options.forEach((option, i) =>
      expect(render(q.options[i]!.text)).toBe(canonical(option)),
    );
    expect(q.correctAnswer).toBe(q.options[original.correct]!.id);
    expect(render(q.explanation)).toBe(canonical(original.context));
    expect(q.images).toEqual([]);
  });
  legacy.essay.forEach((original, index) => {
    const q = poc.questions[legacy.objective.length + index]!;
    if (q.type !== 'essay') throw new Error('Tipo alterado');
    expect(q.label).toBe(String(original.num));
    expect(q.category).toBe(original.category);
    expect(render(q.statement)).toBe(canonical(original.statement));
    expect(render(q.modelAnswer)).toBe(canonical(original.gabarito));
    expect(q.images).toEqual([]);
  });
});
