import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { readExamCatalog } from './catalog';
import viteConfig from '../vite.config';

const directory = process.argv[2] ?? 'dist';
const base = '/CHATGPT/';
assert.equal(viteConfig.base, base, 'Base do Pages deve continuar /CHATGPT/');
const { exams, catalog } = await readExamCatalog();
const questions = exams.flatMap((exam) => exam.questions);
assert.deepEqual(
  [
    exams.length,
    questions.length,
    questions.filter((q) => q.type === 'multiple-choice').length,
    questions.filter((q) => q.type === 'essay').length,
  ],
  [17, 485, 462, 23],
  'Invariantes acadêmicos da release',
);
const read = (path: string) => readFile(join(directory, path));
const json = async (path: string) => JSON.parse((await read(path)).toString('utf8'));
assert.deepEqual(await json('generated/exam-index.json'), catalog, 'Catálogo/metadados do dist');
assert.deepEqual(
  (await readdir(join(directory, 'generated/exams'))).sort(),
  exams.map((exam) => `${exam.id}.json`).sort(),
  'Conjunto exato de 17 JSONs',
);
for (const exam of exams)
  assert.deepEqual(await json(`generated/exams/${exam.id}.json`), exam, exam.id);

async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? files(join(path, entry.name)) : [join(path, entry.name)],
      ),
    )
  ).flat();
}
async function asset(url: string, owner: string, legacy = false) {
  if (!url || url.startsWith('#')) return;
  if (legacy && /^(https?:|javascript:)/.test(url)) return; // dependências históricas preservadas
  const resolved = new URL(url, `https://release.invalid${base}${owner}`);
  const prefix = legacy ? `${base}legacy/` : base;
  assert.equal(resolved.origin, 'https://release.invalid', `${owner}: asset externo ${url}`);
  assert.ok(resolved.pathname.startsWith(prefix), `${owner}: path fora de ${prefix}: ${url}`);
  const path = decodeURIComponent(resolved.pathname.slice(base.length));
  assert.ok((await stat(join(directory, path || 'index.html'))).isFile(), `${owner}: ${url}`);
}
async function htmlAssets(path: string, legacy = false) {
  const document = parse((await read(path)).toString('utf8'));
  const walk = async (node: DefaultTreeAdapterMap['node']): Promise<void> => {
    if ('tagName' in node) {
      const attributes = Object.fromEntries(node.attrs.map((attr) => [attr.name, attr.value]));
      if (attributes.src) await asset(attributes.src, path, legacy);
      if (node.tagName === 'link' && attributes.href) await asset(attributes.href, path, legacy);
    }
    if ('childNodes' in node) for (const child of node.childNodes) await walk(child);
  };
  await walk(document);
}
await htmlAssets('index.html');
const assets = await files(join(directory, 'assets'));
assert.ok(
  assets.some((path) => path.endsWith('.js')),
  'Bundle Vite ausente',
);
assert.ok(
  assets.some((path) => path.endsWith('.css')),
  'CSS Vite ausente',
);
for (const path of assets) {
  const content = await readFile(path, 'utf8');
  assert.ok(!/api\.github\.com|\/simulados\//i.test(content), `${path}: dependência legada/API`);
  if (path.endsWith('.css')) {
    for (const match of content.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g))
      await asset(match[1]!, relative(directory, path));
  }
}

// Comparação byte a byte: hub, 17 HTMLs, catálogo e todos os scripts de rollback.
const legacySources = [
  'index.html',
  'simulados.json',
  'desempenho-estatisticas.js',
  'ajustes-voltar-hub-v5.js',
  'branding-medsim.js',
  'backup-medsim.js',
  'grifar-borracha.js',
  ...(await files('simulados')),
];
assert.equal(
  legacySources.filter((path) => path.startsWith('simulados/') && path.endsWith('.html')).length,
  17,
);
for (const path of legacySources) {
  assert.deepEqual(await read(`legacy/${path}`), await readFile(path), `Legado alterado: ${path}`);
  if (path.endsWith('.html')) await htmlAssets(`legacy/${path}`, true);
}
console.log(
  `dist OK: 17 provas / 485 questões / 462 objetivas / 23 dissertativas; catálogo e JSONs iguais à fonte, assets locais sob ${base}, legado integral byte a byte. Refresh e requests de runtime: npm run test:browser.`,
);
