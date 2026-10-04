import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { RichContent } from '../src/components/common/RichContent';
import type { Exam, RichText } from '../src/types/exam';
import type { readLegacy } from './legacy-data';

// Comparação independente: DOMParser/jsdom vs. renderer React real, sem usar
// convertRichText/parse5 para produzir o esperado. Nenhum script é executado.
const window = new JSDOM('').window;
const parser = new window.DOMParser();
function canonical(html: string) {
  const doc = parser.parseFromString(html, 'text/html');
  const node = (value: Node): unknown => ({
    name: value.nodeName,
    text: value.nodeType === 3 ? value.nodeValue : null,
    attributes:
      value.nodeType === 1
        ? Array.from((value as Element).attributes, (attr) => [attr.name, attr.value])
        : [],
    children: Array.from(value.childNodes, node),
  });
  return Array.from(doc.body.childNodes, node);
}
export function assertRichParity(original: string, content: RichText, location: string) {
  const rendered = renderToStaticMarkup(createElement(RichContent, { content }));
  // Retira apenas o div wrapper do componente compartilhado.
  assert.deepEqual(
    canonical(rendered.slice(rendered.indexOf('>') + 1, -6)),
    canonical(original),
    location,
  );
}
export function assertExamParity(legacy: Awaited<ReturnType<typeof readLegacy>>, exam: Exam) {
  const location = exam.provenance.sourceFile;
  const originals = [...legacy.objective, ...legacy.essay];
  assert.equal(exam.questions.length, originals.length, `${location}: total`);
  assert.equal(
    exam.questions.filter((q) => q.type === 'multiple-choice').length,
    legacy.objective.length,
  );
  assert.equal(exam.questions.filter((q) => q.type === 'essay').length, legacy.essay.length);
  assert.equal(new Set(exam.questions.map((q) => q.id)).size, originals.length);
  const expectedGroups = new Map<string, { title: string; context: string }>();
  originals.forEach((original, index) => {
    const q = exam.questions[index]!;
    const at = `${location} → ${q.id}`;
    const section = original.type === 'objective' ? 'objetivas' : 'dissertativas';
    const caseMatch = 'id' in original && original.id?.match(/^q(\d+)_([a-z]+)$/);
    assert.equal(
      q.id,
      `${exam.id}-${section}-${String(original.num).padStart(3, '0')}${caseMatch ? `-${original.id!.replaceAll('_', '-')}` : ''}`,
      `${at}: ID/ordem/num`,
    );
    assert.equal(q.sectionId, section, `${at}: módulo`);
    assert.equal(
      q.label,
      'mainNum' in original && original.mainNum !== undefined
        ? String(original.mainNum)
        : String(original.num),
      `${at}: label`,
    );
    assert.equal(q.category, original.category, `${at}: categoria`);
    assert.deepEqual(q.tags, [original.category], `${at}: tags`);
    assert.deepEqual(q.images, []);
    assertRichParity(original.statement, q.statement, `${at}: enunciado`);
    if (original.type === 'objective') {
      assert.equal(q.type, 'multiple-choice');
      if (q.type !== 'multiple-choice') throw new Error(at);
      assert.equal(q.options.length, original.options.length, `${at}: opções`);
      original.options.forEach((option, i) => {
        assert.equal(q.options[i]!.id, `option-${i + 1}`);
        assertRichParity(option, q.options[i]!.text, `${at}: opção ${i}`);
      });
      assert.equal(q.correctAnswer, q.options[original.correct]!.id, `${at}: gabarito zero-based`);
      assertRichParity(original.context, q.explanation, `${at}: explicação`);
    } else {
      assert.equal(q.type, 'essay');
      if (q.type !== 'essay') throw new Error(at);
      assertRichParity(original.gabarito, q.modelAnswer, `${at}: resposta-modelo`);
      assert.deepEqual(q.explanation, []);
      if (caseMatch) {
        const groupId = `${exam.id}-caso-${caseMatch[1]}`;
        assert.equal(q.groupId, groupId, `${at}: relação caso/subitem`);
        assert.ok(original.caseText && original.mainNum, `${at}: formato C completo`);
        if (!expectedGroups.has(groupId)) {
          assert.equal(caseMatch[2], 'a', `${at}: primeiro subitem`);
          expectedGroups.set(groupId, {
            title: String(original.mainNum).split(' - Item ')[0]!,
            context: original.caseText,
          });
          assert.equal(q.context, undefined, `${at}: contexto compartilhado`);
        } else {
          assertRichParity(original.caseText, q.context ?? [], `${at}: continuação`);
        }
      } else {
        assert.equal(q.groupId, undefined);
        assert.equal(q.context, undefined);
      }
    }
  });
  assert.deepEqual(
    exam.groups.map((g) => g.id),
    [...expectedGroups.keys()],
    `${location}: grupos/ordem`,
  );
  for (const group of exam.groups) {
    const original = expectedGroups.get(group.id)!;
    assert.equal(group.title, original.title);
    assertRichParity(original.context, group.context, `${location}: caso/tabela ${group.id}`);
    assert.deepEqual(group.images, []);
  }
  assert.deepEqual(exam.images, []);
}
