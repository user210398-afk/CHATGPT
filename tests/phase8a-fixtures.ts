import { tiny as base } from './phase7b2b-fixtures';
import type { Exam, RichText } from '../src/types/exam';
export const statement: RichText = [
  { type: 'text', text: 'Igual á ' },
  { type: 'element', tag: 'strong', children: [{ type: 'text', text: 'Igual 😀' }] },
  { type: 'element', tag: 'br', children: [] },
  { type: 'element', tag: 'em', children: [{ type: 'text', text: ' e\u0301' }] },
  { type: 'element', tag: 'sub', children: [{ type: 'text', text: '𐐀' }] },
  { type: 'element', tag: 'sup', children: [{ type: 'text', text: ' fim' }] },
];
export const exam: Exam = { ...base, questions: base.questions.map((q) => ({ ...q, statement })) };
export const questionId = exam.questions[0]!.id;
export const scope = { kind: 'attempt' as const, id: 'attempt-8a' };
export function memory() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, raw: string) => {
      writes.push(key);
      values.set(key, raw);
    },
    removeItem: (key: string) => {
      writes.push(key);
      values.delete(key);
    },
  };
}
export function ids() {
  let index = 0;
  return () => `h-${++index}`;
}
