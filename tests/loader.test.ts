import { expect, it, vi } from 'vitest';
import { loadCatalog, loadExam } from '../src/engine/exam-loader';
import { poc } from './fixtures';
it('carrega JSON validado pelo base path sem requisitar HTML legado', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(poc)));
  expect(await loadExam(poc.id, fetcher)).toEqual(poc);
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/CHATGPT/generated/exams/${poc.id}.json`, {
    signal: undefined,
  });
});
it('rejeita erro HTTP, JSON inválido, id divergente e traversal', async () => {
  await expect(
    loadExam(poc.id, vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 404 }))),
  ).rejects.toThrow('HTTP 404');
  await expect(
    loadExam(poc.id, vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'))),
  ).rejects.toThrow('schemaVersion');
  await expect(
    loadExam(
      'outro-id',
      vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(poc))),
    ),
  ).rejects.toThrow('identificador');
  const fetcher = vi.fn<typeof fetch>();
  await expect(loadExam('../secrets', fetcher)).rejects.toThrow('inválido');
  expect(fetcher).not.toHaveBeenCalled();
});
it('valida o catálogo em runtime', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response('{"schemaVersion":1,"exams":[]}'));
  expect(await loadCatalog(fetcher)).toEqual({ schemaVersion: 1, exams: [] });
});
