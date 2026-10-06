import { describe, expect, it } from 'vitest';
import { writeTransaction, type StorageChange } from '../src/engine/storage-transaction';
import { memory } from './phase7b2b-fixtures';
function plan(store: ReturnType<typeof memory>, changes: StorageChange[]) {
  return () => writeTransaction(store, new Map(changes.map((c) => [c.key, c.before])), changes);
}
describe('transaction writes and deletes', () => {
  it.each([
    [null, 'new'],
    ['old', 'new'],
    ['old', null],
    [null, null],
  ] as const)('red team: single transition %j -> %j', (before, after) => {
    const store = memory(before === null ? [] : [['a', before]]);
    plan(store, [{ key: 'a', before, after }])();
    expect(store.getItem('a')).toBe(after);
  });
  it.each(['write/write', 'delete/delete', 'write/delete', 'delete/write'])(
    'red team: success and rollback of %s',
    (kind) => {
      const after = kind.split('/').map((op) => (op === 'delete' ? null : 'new'));
      const changes = ['a', 'b'].map((key, i) => ({ key, before: 'old', after: after[i]! }));
      const store = memory([
        ['a', 'old'],
        ['b', 'old'],
      ]);
      plan(store, changes)();
      expect(store.getItem('a')).toBe(after[0]);
      expect(store.getItem('b')).toBe(after[1]);
      const failed = memory([
        ['a', 'old'],
        ['b', 'old'],
      ]);
      if (after[1] === null)
        failed.removeItem.mockImplementation((key) => {
          if (key === 'b') throw new Error('blocked');
          failed.values.delete(key);
        });
      else
        failed.setItem.mockImplementation((key, value) => {
          if (key === 'b' && value === 'new') throw new Error('blocked');
          failed.values.set(key, value);
        });
      expect(plan(failed, changes)).toThrow('restauradas');
      expect(failed.values).toEqual(
        new Map([
          ['a', 'old'],
          ['b', 'old'],
        ]),
      );
    },
  );
  it.each([false, true])(
    'red team: set failure (mutated=%s) rolls back existing strings',
    (mutate) => {
      const store = memory([['a', 'old']]);
      store.setItem.mockImplementationOnce((key, value) => {
        if (mutate) store.values.set(key, value);
        throw new Error('failed');
      });
      expect(plan(store, [{ key: 'a', before: 'old', after: 'new' }])).toThrow('restauradas');
      expect(store.values.get('a')).toBe('old');
    },
  );
  it('red team: concurrent update during rollback preserves another already-touched key', () => {
    const store = memory([
      ['a', 'old-a'],
      ['b', 'old-b'],
      ['c', 'old-c'],
    ]);
    store.setItem.mockImplementation((key, value) => {
      if (key === 'c') throw new Error('failed');
      store.values.set(key, value);
      if (key === 'b' && value === 'old-b') store.values.set('a', 'foreign-during-rollback');
    });
    expect(
      plan(
        store,
        ['a', 'b', 'c'].map((key) => ({ key, before: `old-${key}`, after: `new-${key}` })),
      ),
    ).toThrow('rollback ficou incompleto');
    expect(store.values).toEqual(
      new Map([
        ['a', 'foreign-during-rollback'],
        ['b', 'old-b'],
        ['c', 'old-c'],
      ]),
    );
  });
  it('deletes existing raw values', () => {
    const store = memory([['a', 'old']]);
    plan(store, [{ key: 'a', before: 'old', after: null }])();
    expect(store.getItem('a')).toBeNull();
  });
  it('sets and deletes in one transaction including before null', () => {
    const store = memory([['a', 'old']]);
    plan(store, [
      { key: 'a', before: 'old', after: null },
      { key: 'b', before: null, after: 'new' },
    ])();
    expect([...store.values]).toEqual([['b', 'new']]);
  });
  it('before-null deletion is valid', () => {
    const store = memory();
    plan(store, [{ key: 'a', before: null, after: null }])();
    expect([...store.values]).toEqual([]);
  });
  it('preexisting concurrency aborts all mutations', () => {
    const store = memory([['a', 'other']]);
    expect(plan(store, [{ key: 'a', before: 'old', after: null }])).toThrow('concorrência');
    expect(store.removeItem).not.toHaveBeenCalled();
  });
  it('middle concurrency restores own delete and preserves foreign write', () => {
    const store = memory([
      ['a', 'old'],
      ['b', 'before'],
    ]);
    store.removeItem.mockImplementationOnce((key) => {
      store.values.delete(key);
      store.values.set('b', 'foreign');
    });
    expect(
      plan(store, [
        { key: 'a', before: 'old', after: null },
        { key: 'b', before: 'before', after: 'next' },
      ]),
    ).toThrow('restauradas');
    expect([...store.values]).toEqual([
      ['b', 'foreign'],
      ['a', 'old'],
    ]);
  });
  it('concurrent change of touched key is never overwritten in rollback', () => {
    const store = memory([
      ['a', 'old'],
      ['b', 'before'],
    ]);
    store.setItem.mockImplementationOnce(() => {
      store.values.set('a', 'foreign');
      throw new Error('failed');
    });
    expect(
      plan(store, [
        { key: 'a', before: 'old', after: null },
        { key: 'b', before: 'before', after: 'next' },
      ]),
    ).toThrow('rollback ficou incompleto');
    expect(store.values.get('a')).toBe('foreign');
    expect(store.values.get('b')).toBe('before');
  });
  it('remove failure rolls back previous writes', () => {
    const store = memory([
      ['a', 'old'],
      ['b', 'before'],
    ]);
    store.removeItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(
      plan(store, [
        { key: 'a', before: 'old', after: 'new' },
        { key: 'b', before: 'before', after: null },
      ]),
    ).toThrow('restauradas');
    expect([...store.values]).toEqual([
      ['a', 'old'],
      ['b', 'before'],
    ]);
  });
  it('adapter removing then throwing is rolled back', () => {
    const store = memory([['a', 'old']]);
    store.removeItem.mockImplementationOnce((key) => {
      store.values.delete(key);
      throw new Error('failure');
    });
    expect(plan(store, [{ key: 'a', before: 'old', after: null }])).toThrow('restauradas');
    expect(store.values.get('a')).toBe('old');
  });
  it('set failure restores deleted and newly created keys', () => {
    const store = memory([['a', 'old']]);
    store.setItem.mockImplementationOnce((key, value) => {
      store.values.set(key, value);
      throw new Error('failure');
    });
    expect(
      plan(store, [
        { key: 'a', before: 'old', after: null },
        { key: 'b', before: null, after: 'new' },
      ]),
    ).toThrow('restauradas');
    expect([...store.values]).toEqual([['a', 'old']]);
  });
  it('rollback failure yields explicit critical error', () => {
    const store = memory([
      ['a', 'old'],
      ['b', 'before'],
    ]);
    store.removeItem.mockImplementationOnce((key) => {
      store.values.delete(key);
    });
    store.setItem.mockImplementation(() => {
      throw new Error('quota');
    });
    expect(
      plan(store, [
        { key: 'a', before: 'old', after: null },
        { key: 'b', before: 'before', after: 'next' },
      ]),
    ).toThrow('rollback ficou incompleto');
  });
  it('missing removeItem aborts delete before any write', () => {
    const store = memory([['a', 'old']]);
    expect(() =>
      writeTransaction(
        { getItem: store.getItem, setItem: store.setItem },
        new Map([['a', 'old']]),
        [{ key: 'a', before: 'old', after: null }],
      ),
    ).toThrow('removeItem indisponível');
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('missing removeItem reports incomplete rollback for a new write', () => {
    const store = memory();
    store.setItem.mockImplementation((key, value) => {
      store.values.set(key, value);
      throw new Error('failed after mutation');
    });
    expect(() =>
      writeTransaction({ getItem: store.getItem, setItem: store.setItem }, new Map([['a', null]]), [
        { key: 'a', before: null, after: 'new' },
      ]),
    ).toThrow('rollback ficou incompleto');
  });
  it('read failure before mutation aborts safely', () => {
    const store = memory();
    store.getItem.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(plan(store, [{ key: 'a', before: null, after: 'new' }])).toThrow(
      'concorrência ou falha de leitura',
    );
    expect(store.setItem).not.toHaveBeenCalled();
  });
  it('final verification catches silent failed remove and rolls back', () => {
    const store = memory([
      ['a', 'old'],
      ['b', 'old'],
    ]);
    store.removeItem.mockImplementationOnce(() => {});
    expect(
      plan(store, [
        { key: 'a', before: 'old', after: null },
        { key: 'b', before: 'old', after: 'next' },
      ]),
    ).toThrow('restauradas');
    expect([...store.values]).toEqual([
      ['a', 'old'],
      ['b', 'old'],
    ]);
  });
  it.each(
    [
      [{ key: 'a', before: 'wrong', after: null }],
      [{ key: 'unknown', before: null, after: 'new' }],
      [
        { key: 'a', before: 'old', after: null },
        { key: 'a', before: 'old', after: 'next' },
      ],
    ].map((changes) => ({ changes })),
  )('rejects inconsistent or duplicate transaction plan %#', ({ changes }) => {
    const store = memory([['a', 'old']]);
    expect(() => writeTransaction(store, new Map([['a', 'old']]), changes)).toThrow(
      'Plano transacional inválido',
    );
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.removeItem).not.toHaveBeenCalled();
  });
});
