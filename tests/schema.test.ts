import { describe, expect, it } from 'vitest';
import { parseExam } from '../schema/exam';
import { poc } from './fixtures';

const clone = () => structuredClone(poc);
describe('schema versionado e refinamentos semânticos', () => {
  it('aceita a prova mista real', () => expect(parseExam(poc).questions).toHaveLength(30));
  it.each([
    ['schemaVersion', { schemaVersion: 2 }],
    ['id', { id: '../prova' }],
    ['title', { title: '   ' }],
    ['subject', { subject: '' }],
    ['year', { year: '2026' }],
    ['settings', { settings: {} }],
  ])('rejeita %s inválido com arquivo e campo', (field, patch) => {
    expect(() => parseExam({ ...poc, ...patch }, 'teste.json')).toThrow(
      new RegExp(`teste.json.*${field}`),
    );
  });
  it('rejeita IDs duplicados, inclusive alternativas', () => {
    const exam = clone();
    exam.questions[1]!.id = exam.questions[0]!.id;
    expect(() => parseExam(exam, 'poc.json')).toThrow(
      /poc.json → questão objetivas-001 → questions.1.id → ID duplicado/,
    );
    const other = clone();
    const q = other.questions[0]!;
    if (q.type !== 'multiple-choice') throw new Error('fixture');
    q.options[1]!.id = q.options[0]!.id;
    expect(() => parseExam(other)).toThrow(/options.1.id.*ID duplicado/);
  });
  it('aceita alternativas variáveis e verifica a referência do gabarito', () => {
    const exam = clone();
    const q = exam.questions[0]!;
    if (q.type !== 'multiple-choice') throw new Error('fixture');
    q.options = q.options.slice(0, 2);
    expect(parseExam(exam).questions[0]).toMatchObject({ options: q.options });
    q.correctAnswer = 'option-5';
    expect(() => parseExam(exam, 'prova.json')).toThrow(
      /questão objetivas-001 → questions.0.correctAnswer/,
    );
    q.options = q.options.slice(0, 1);
    expect(() => parseExam(exam)).toThrow(/options/);
  });
  it('rejeita tipo desconhecido e dissertativa sem modelo', () => {
    expect(() =>
      parseExam({ ...poc, questions: [{ ...poc.questions[0], type: 'unknown' }] }),
    ).toThrow(/type/);
    const essay = clone().questions.find((q) => q.type === 'essay')!;
    expect(() => parseExam({ ...poc, questions: [{ ...essay, modelAnswer: [] }] })).toThrow(
      /modelAnswer/,
    );
  });
  it('modela ano desconhecido, casos compartilhados, tabelas e subitens', () => {
    const essay = clone().questions.find((q) => q.type === 'essay')!;
    const exam = parseExam({
      ...poc,
      year: null,
      groups: [
        {
          id: 'caso-i',
          title: 'Caso I',
          images: [],
          context: [
            {
              type: 'element',
              tag: 'table',
              children: [
                {
                  type: 'element',
                  tag: 'tbody',
                  children: [
                    {
                      type: 'element',
                      tag: 'tr',
                      children: [
                        {
                          type: 'element',
                          tag: 'td',
                          children: [{ type: 'text', text: 'Exame < 2' }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      questions: [{ ...essay, label: 'I.a', groupId: 'caso-i' }],
    });
    expect(exam.questions[0]!.groupId).toBe('caso-i');
    expect(() => parseExam({ ...exam, groups: [] })).toThrow(/groupId.*Referência inexistente/);
  });
  it('rejeita conteúdo que seria perdido em uma quebra de linha', () => {
    const exam = clone();
    exam.questions[0]!.statement = [
      { type: 'element', tag: 'br', children: [{ type: 'text', text: 'Enunciado' }] },
    ];
    expect(() => parseExam(exam)).toThrow(/Quebra de linha não pode conter filhos/);
  });
  it('aceita imagens locais acessíveis e rejeita execução/HTML arbitrário', () => {
    const exam = clone();
    exam.questions[0]!.images = [
      { src: 'media/anatomia/figura-1.png', alt: 'Estrutura anatômica', caption: 'Figura 1' },
    ];
    expect(parseExam(exam).questions[0]!.images).toHaveLength(1);
    for (const src of [
      'javascript:alert(1)',
      'https://example.com/a.png',
      'data:image/png;base64,xxx',
      'media/../x.png',
      '/Simulados/a.png',
    ]) {
      expect(() => parseExam({ ...exam, images: [{ src, alt: 'Figura' }] })).toThrow(/images/);
    }
    expect(() => parseExam({ ...exam, images: [{ src: 'media/x.png', alt: '' }] })).toThrow(/alt/);
    expect(() =>
      parseExam({
        ...exam,
        questions: [
          { ...exam.questions[0], statement: [{ type: 'element', tag: 'script', children: [] }] },
        ],
      }),
    ).toThrow(/tag/);
    expect(() =>
      parseExam({
        ...exam,
        questions: [
          {
            ...exam.questions[0],
            statement: [
              {
                type: 'element',
                tag: 'b',
                children: [{ type: 'text', text: 'Texto' }],
                onclick: 'alert(1)',
              },
            ],
          },
        ],
      }),
    ).toThrow(/Unrecognized key/);
  });
});
