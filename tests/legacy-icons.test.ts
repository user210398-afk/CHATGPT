import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const expectedIcons = [
  'bold/arrow-left', 'bold/arrow-right', 'bold/books', 'bold/caret-left',
  'bold/caret-right', 'bold/files', 'bold/magnifying-glass', 'bold/path', 'bold/x',
  'duotone/brain', 'duotone/bug', 'duotone/calendar-blank', 'duotone/calendar-check',
  'duotone/clipboard-text', 'duotone/file-text', 'duotone/first-aid',
  'duotone/heartbeat', 'duotone/info', 'duotone/microscope', 'duotone/note-pencil',
  'duotone/pill', 'duotone/question', 'duotone/shield-check',
  'duotone/sliders-horizontal', 'duotone/squares-four', 'duotone/virus',
  'fill/book-open', 'fill/calendar-star', 'fill/clock-counter-clockwise',
  'fill/stethoscope',
];

describe('F05: Phosphor no hub legado sem JavaScript de terceiros', () => {
  it('não carrega scripts de ícones de CDN nem quaisquer scripts HTTP externos', async () => {
    const html = await readFile('index.html', 'utf8');
    expect(html).not.toMatch(/unpkg\.com\/\@phosphor-icons|cdn\.jsdelivr\.net\/.*phosphor/i);
    const externalScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["'](https?:\/\/[^"']+)/gi)];
    expect(externalScripts).toHaveLength(0);
    expect(html).toMatch(/\.ph-local-svg\s*\{[^}]*width:\s*1em;[^}]*height:\s*1em;/);
  });

  it('preserva os 37 usos e 30 tipos originais, inclusive ícones de templates dinâmicos', async () => {
    const html = await readFile('index.html', 'utf8');
    const wrapped = [
      ...html.matchAll(
        /<i class="(ph-(?:bold|fill|duotone) ph-[a-z-]+(?: card-icon)?)"[^>]* aria-hidden="true">(<svg class="ph-local-svg"[\s\S]*?<\/svg>)<\/i>/g,
      ),
    ];
    expect(wrapped).toHaveLength(37);
    const names = wrapped.map((match) => {
      const [weight, icon] = match[1]!.split(' ');
      return `${weight!.slice(3)}/${icon!.slice(3)}`;
    });
    expect([...new Set(names)].sort()).toEqual(expectedIcons);
    // Calendar, widgets and visual shell all contain real SVGs, not empty font glyphs.
    for (const key of ['duotone/calendar-check', 'fill/calendar-star', 'fill/clock-counter-clockwise'])
      expect(names).toContain(key);
    expect(html).not.toMatch(/<i class="ph-(?:bold|fill|duotone)[^"]*"[^>]*><\/i>/);
  });

  it('somente SVG declarativo local: paths, currentColor e aria-hidden', async () => {
    const html = await readFile('index.html', 'utf8');
    const svgs = [...html.matchAll(/<svg class="ph-local-svg"[\s\S]*?<\/svg>/g)].map((m) => m[0]);
    expect(svgs).toHaveLength(37);
    for (const markup of svgs) {
      const doc = new JSDOM(markup).window.document;
      const svg = doc.querySelector('svg');
      expect(svg, 'ícone sem SVG').not.toBeNull();
      expect(svg!.getAttribute('viewBox')).toBe('0 0 256 256');
      expect(svg!.getAttribute('fill')).toBe('currentColor');
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      expect(svg!.querySelectorAll('path').length).toBeGreaterThan(0);
      expect(svg!.querySelectorAll('script, style, foreignObject, image, use')).toHaveLength(0);
      expect(markup).not.toMatch(/\bon[a-z]+\s*=|javascript:|\bhref\s*=/i);
    }
  });
});
