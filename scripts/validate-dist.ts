import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { readExamCatalog } from './catalog';
import { assertReleaseBaseline, examCounts, migratedBaseline } from './release-baseline';
import viteConfig from '../vite.config';
import { validatePwa } from './validate-pwa';

const directory = process.argv[2] ?? 'dist';
const base = '/CHATGPT/';
assert.equal(viteConfig.base, base, 'Base do Pages deve continuar /CHATGPT/');
const { exams, catalog } = await readExamCatalog();
await assertReleaseBaseline();
assert.deepEqual(examCounts(migratedBaseline(exams)), {
  exams: 17,
  questions: 485,
  objective: 462,
  essay: 23,
  options: 2187,
  groups: 3,
});
const counts = examCounts(exams);
const read = (path: string) => readFile(join(directory, path));
const json = async (path: string) => JSON.parse((await read(path)).toString('utf8'));
assert.deepEqual(await json('generated/exam-index.json'), catalog, 'Catálogo/metadados do dist');
assert.deepEqual(
  (await readdir(join(directory, 'generated/exams'))).sort(),
  exams.map((exam) => `${exam.id}.json`).sort(),
  'Conjunto exato de JSONs do catálogo atual',
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
await validatePwa(directory);
const modernHtml = (await read('index.html')).toString();
assert.match(modernHtml, /http-equiv="Content-Security-Policy"/);
assert.ok(modernHtml.indexOf('Content-Security-Policy') < modernHtml.indexOf('<script'));
for (const directive of [
  "script-src 'self'",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
])
  assert.ok(modernHtml.includes(directive), `CSP: ${directive}`);
assert.ok(!/unsafe-inline|unsafe-eval|frame-ancestors/.test(modernHtml));
assert.match(modernHtml, /rel="manifest" href="\/CHATGPT\/manifest.webmanifest"/);
assert.ok(!(await readdir(directory)).includes('authoring'), 'Authoring não pertence ao dist');
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
  assert.ok(
    !/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bAKIA[A-Z0-9]{16}\b/.test(
      content,
    ),
    `${path}: formato de segredo no bundle`,
  );
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
  `dist OK: ${counts.exams} provas / ${counts.questions} questões / ${counts.objective} objetivas / ${counts.essay} dissertativas; catálogo e JSONs iguais à fonte, assets locais sob ${base}, legado integral byte a byte. Refresh e requests de runtime: npm run test:browser.`,
);
