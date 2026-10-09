import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type RecoveryInput = {
  size: number;
  text: () => Promise<string>;
};

function fixture() {
  const original = [
    ['medsim_alpha', 'before-alpha'],
    ['medsim_beta', 'before-beta'],
    ['unrelated-key', 'untouched'],
  ] as const;
  const values = new Map<string, string>(original);
  const message = { textContent: '', dataset: { type: '', show: '' } };
  const error = vi.fn();
  const warn = vi.fn();
  const scheduled = vi.fn((_callback: () => void, _delay: number) => 1);
  const reload = vi.fn();
  const recovery = new Map<string, string>();
  const adapter = {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
  return {
    original,
    values,
    message,
    error,
    warn,
    scheduled,
    reload,
    recovery,
    adapter,
    async restore(data: Record<string, string>) {
      const source = await readFile('backup-medsim.js', 'utf8');
      const suffix = '})();';
      expect(source.trimEnd().endsWith(suffix)).toBe(true);
      const last = source.lastIndexOf(suffix);
      // Expose the *real* legacy function in this in-memory test only.
      // The committed runtime file remains an unmodified self-executing script.
      const instrumented =
        source.slice(0, last) +
        '\n  globalThis.__f03Test = { restoreFromFile };\n' +
        source.slice(last);
      const context: Record<string, unknown> = {
        console: { error, warn, info: vi.fn() },
        document: {
          readyState: 'loading',
          addEventListener: vi.fn(),
          getElementById: (id: string) =>
            id === 'medsim-backup-message' ? message : null,
        },
        window: { confirm: vi.fn(() => true) },
        location: { reload },
        localStorage: adapter,
        sessionStorage: {
          setItem: (key: string, value: string) => recovery.set(key, value),
        },
        setTimeout: scheduled,
        clearTimeout: vi.fn(),
      };
      runInNewContext(instrumented, context, { filename: 'backup-medsim.js' });
      const api = context.__f03Test as {
        restoreFromFile: (file: RecoveryInput) => Promise<void>;
      };
      await api.restoreFromFile({
        size: 256,
        text: async () =>
          JSON.stringify({ format: 'medsim-backup', version: 2, app: 'MedSim', data }),
      });
    },
  };
}

describe('F03: rollback do backup legado', () => {
  it('sucesso de restauração mantém o fluxo e não mexe em dados de outros sites', async () => {
    const f = fixture();
    await f.restore({ medsim_alpha: 'incoming', medsim_gamma: 'new' });
    expect([...f.values]).toEqual([
      ['unrelated-key', 'untouched'],
      ['medsim_alpha', 'incoming'],
      ['medsim_gamma', 'new'],
    ]);
    expect(f.message.dataset.type).toBe('success');
    expect(f.message.textContent).toContain('Backup restaurado');
    expect(f.scheduled).toHaveBeenCalledWith(expect.any(Function), 500);
    expect(f.reload).not.toHaveBeenCalled(); // only scheduled, never executed in test
  });

  it('falha na importação com rollback verificado informa recuperação, não sucesso da importação', async () => {
    const f = fixture();
    f.adapter.setItem.mockImplementation((key: string, value: string) => {
      f.values.set(key, value);
      if (value === 'incoming') throw new Error('Quota exceeded after partial write');
    });
    await f.restore({ medsim_alpha: 'incoming' });
    expect([...f.values].sort()).toEqual([...f.original].sort());
    expect(f.message.dataset.type).toBe('error');
    expect(f.message.textContent).toContain('recuperados e conferidos');
    expect(f.message.textContent).not.toContain('preservados');
    expect(f.scheduled).not.toHaveBeenCalledWith(expect.any(Function), 500);
    expect(f.recovery.has('medsim_backup_recovery_v1')).toBe(true);
    expect(JSON.parse(f.recovery.get('medsim_backup_recovery_v1')!).data).toMatchObject({
      medsim_alpha: 'before-alpha',
      medsim_beta: 'before-beta',
    });
  });

  it('rollback que lança erro nunca informa dados preservados e mantém aviso permanente', async () => {
    const f = fixture();
    f.adapter.setItem.mockImplementation((key: string, value: string) => {
      if (key === 'medsim_alpha' && value === 'before-alpha')
        throw new Error('Recovery write denied');
      f.values.set(key, value);
      if (value === 'incoming') throw new Error('Import failed');
    });
    await f.restore({ medsim_alpha: 'incoming' });
    expect(f.values.get('medsim_alpha')).toBeUndefined();
    expect(f.values.get('unrelated-key')).toBe('untouched');
    expect(f.message.dataset.type).toBe('error');
    expect(f.message.textContent).toContain('não foi confirmada');
    expect(f.message.textContent).toContain('Não recarregue');
    expect(f.error).toHaveBeenCalledWith(
      '[MedSim] Falha ao recuperar os dados anteriores.',
      expect.any(Error),
    );
    // An unsafe recovery must not be auto-dismissed or followed by reload.
    expect(f.scheduled).not.toHaveBeenCalled();
    expect(f.reload).not.toHaveBeenCalled();
  });

  it('rollback silenciosamente ignorado é identificado por comparação exata de bytes', async () => {
    const f = fixture();
    f.adapter.setItem.mockImplementation((key: string, value: string) => {
      if (key === 'medsim_alpha' && value === 'before-alpha') return;
      f.values.set(key, value);
      if (value === 'incoming') throw new Error('Import failed');
    });
    await f.restore({ medsim_alpha: 'incoming' });
    expect(f.values.get('medsim_alpha')).toBeUndefined();
    expect(f.message.textContent).toContain('não foi confirmada');
    expect(f.error).toHaveBeenCalledWith(expect.stringContaining('Recuperação incompleta'));
    expect(f.scheduled).not.toHaveBeenCalled();
  });

  it('falha em removeItem e rollback também não produz confirmação falsa', async () => {
    const f = fixture();
    f.adapter.removeItem.mockImplementation((key: string) => {
      f.values.delete(key);
      if (key === 'medsim_alpha') throw new Error('Partial remove');
    });
    await f.restore({ medsim_alpha: 'incoming' });
    expect(f.message.textContent).toContain('não foi confirmada');
    expect(f.message.dataset.show).toBe('true');
    expect(f.scheduled).not.toHaveBeenCalled();
  });
});
