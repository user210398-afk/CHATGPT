import { parseExpressionAt, type AnyNode } from 'acorn';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { parseFragment, Tokenizer, type Token, type DefaultTreeAdapterMap } from 'parse5';
import { richTag, type RichNode, type RichText } from '../schema/exam';

// Extrai somente literais. Nunca avalia scripts dos HTMLs, nem usa eval/vm.
function literal(node: AnyNode): unknown {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'ArrayExpression':
      return node.elements.map((item) => {
        if (!item) throw new Error('Array esparso no legado');
        return literal(item);
      });
    case 'ObjectExpression': {
      const keys = new Set<string>();
      return Object.fromEntries(
        node.properties.map((property) => {
          if (
            property.type !== 'Property' ||
            property.computed ||
            property.kind !== 'init' ||
            property.method
          )
            throw new Error('Propriedade não literal');
          const key =
            property.key.type === 'Identifier' ? property.key.name : literal(property.key);
          if (typeof key !== 'string') throw new Error('Chave inválida');
          if (keys.has(key)) throw new Error(`Chave duplicada no legado: ${key}`);
          keys.add(key);
          return [key, literal(property.value)];
        }),
      );
    }
    default:
      throw new Error(`Expressão não permitida no banco legado: ${node.type}`);
  }
}
export function extractArray(html: string, name: string): unknown[] {
  const match = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*`).exec(html);
  if (!match) return [];
  const value = literal(
    parseExpressionAt(html, match.index + match[0].length, { ecmaVersion: 'latest' }),
  );
  if (!Array.isArray(value)) throw new Error(`${name}: array obrigatório`);
  return value;
}
const common = { num: z.number(), category: z.string(), statement: z.string() };
const objective = z.strictObject({
  ...common,
  type: z.literal('objective'),
  options: z.array(z.string()),
  correct: z.number().int(),
  context: z.string(),
});
const essay = z.strictObject({
  ...common,
  type: z.literal('dissertative'),
  gabarito: z.string(),
  id: z.string().optional(),
  mainNum: z.union([z.string(), z.number()]).optional(),
  caseText: z.string().optional(),
});
export async function readLegacy(file: string) {
  const html = await readFile(file, 'utf8');
  return {
    html,
    objective: z.array(objective).parse(extractArray(html, 'objectiveQuestions')),
    essay: z.array(essay).parse(extractArray(html, 'dissertativeQuestions')),
  };
}
export function convertRichText(html: string): RichText {
  // Validar também tokens que o parser de fragmentos poderia ignorar (html/body,
  // tags finais e atributos). Não permitir descarte silencioso antes da árvore.
  const checkTag = (token: Token.TagToken) => {
    richTag.parse(token.tagName);
    if (token.attrs.length) throw new Error(`Atributos exigem revisão explícita: ${token.tagName}`);
  };
  const unsupported = () => {
    throw new Error('Comentário/doctype não permitido no conteúdo acadêmico');
  };
  const ignoreText = () => {};
  new Tokenizer(
    {},
    {
      onStartTag: checkTag,
      onEndTag: checkTag,
      onComment: unsupported,
      onDoctype: unsupported,
      onCharacter: ignoreText,
      onWhitespaceCharacter: ignoreText,
      onNullCharacter: unsupported,
      onEof: ignoreText,
    },
  ).write(html, true);
  const convert = (node: DefaultTreeAdapterMap['childNode']): RichNode => {
    if (node.nodeName === '#text' && 'value' in node) return { type: 'text', text: node.value };
    if (!('tagName' in node)) throw new Error(`Nó não suportado: ${node.nodeName}`);
    const tag = richTag.parse(node.tagName);
    if (node.attrs.length) throw new Error(`Atributos exigem revisão explícita: ${node.tagName}`);
    return { type: 'element', tag, children: node.childNodes.map(convert) };
  };
  return parseFragment(html).childNodes.map(convert);
}
export const pocSource = 'simulados/fisiologia-aula-m5- 1 - Introdução e Hipófise.html';
export const pocId = 'fisiologia-m5-aula-1-2026';
