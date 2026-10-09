import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';

export async function validatePwa(directory: string) {
  const read = (path: string) => readFile(join(directory, path));
  const manifest = JSON.parse((await read('manifest.webmanifest')).toString());
  assert.equal(manifest.name, 'MedSim — Prática Médica');
  assert.equal(manifest.short_name, 'MedSim');
  assert.equal(manifest.lang, 'pt-BR');
  assert.equal(manifest.display, 'standalone');
  for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], '/CHATGPT/');
  assert.equal(manifest.theme_color, '#174ea6');
  assert.equal(manifest.background_color, '#f4f6fa');
  assert.deepEqual(
    manifest.icons.map((icon: { sizes: string }) => icon.sizes),
    ['192x192', '512x512', '512x512'],
  );
  assert.equal(manifest.icons[2].purpose, 'maskable');
  for (const icon of [
    ...manifest.icons,
    { src: '/CHATGPT/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
  ]) {
    assert.equal(icon.type, 'image/png');
    assert.match(icon.src, /^\/CHATGPT\/icons\/[a-z0-9-]+\.png$/);
    const png = await read(icon.src.slice('/CHATGPT/'.length));
    assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.readUInt32BE(16), width);
    assert.equal(png.readUInt32BE(20), height);
    assert.equal(png[24], 8, 'PNG real de 8 bits');
    assert.ok(png[25] === 2 || png[25] === 6, 'RGB/RGBA');
    const chunks = [];
    let ended = false;
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      const type = png.toString('ascii', offset + 4, offset + 8);
      assert.ok(offset + length + 12 <= png.length);
      if (type === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length));
      if (type === 'IEND') ended = true;
      offset += length + 12;
    }
    assert.ok(ended && chunks.length > 0);
    assert.equal(
      inflateSync(Buffer.concat(chunks)).length,
      (width * (png[25] === 6 ? 4 : 3) + 1) * height,
    );
  }
  const sw = (await read('sw.js')).toString();
  assert.ok(
    !/\bcaches\b|importScripts|\beval\s*\(|new Function|skipWaiting\s*\(|clients\.claim\s*\(/.test(
      sw,
    ),
  );
}
