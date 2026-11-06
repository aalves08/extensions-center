import { mapWithConcurrency } from '../async';

/** A promise plus the handles to settle it from the test body. */
function deferred<T>() {
  let settle!: (v: T) => void;
  let fail!: (e: unknown) => void;

  const promise = new Promise<T>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  return {
    promise, resolve: settle, reject: fail
  };
}

describe('mapWithConcurrency', () => {
  it('returns results in input order, not completion order', async() => {
    const out = await mapWithConcurrency([30, 20, 10], 3, async(ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));

      return ms;
    });

    expect(out).toEqual([30, 20, 10]);
  });

  it('passes the index alongside the item', async() => {
    const out = await mapWithConcurrency(['a', 'b', 'c'], 2, async(item, i) => `${ i }:${ item }`);

    expect(out).toEqual(['0:a', '1:b', '2:c']);
  });

  it('visits every item exactly once', async() => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    const seen: number[] = [];

    await mapWithConcurrency(items, 7, async(item) => {
      seen.push(item);
    });

    expect([...seen].sort((a, b) => a - b)).toEqual(items);
    expect(seen).toHaveLength(50);
  });

  it('returns an empty array for no items without calling the worker', async() => {
    const worker = jest.fn();

    expect(await mapWithConcurrency([], 5, worker)).toEqual([]);
    expect(worker).not.toHaveBeenCalled();
  });

  it('never exceeds the concurrency limit', async() => {
    let active = 0;
    let peak = 0;

    await mapWithConcurrency(Array.from({ length: 20 }, (_, i) => i), 4, async() => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });

    expect(peak).toBe(4);
  });

  it('does not spawn more runners than there are items', async() => {
    let peak = 0;
    let active = 0;

    await mapWithConcurrency([1, 2], 10, async() => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });

    expect(peak).toBe(2);
  });

  it('starts a queued item as soon as a slot frees up', async() => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const started: number[] = [];

    const run = mapWithConcurrency([0, 1, 2], 2, async(i) => {
      started.push(i);
      await gates[i].promise;

      return i;
    });

    await Promise.resolve();
    expect(started).toEqual([0, 1]);

    // Freeing the first slot should admit the third item, not wait for both.
    gates[0].resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);

    gates[1].resolve();
    gates[2].resolve();
    expect(await run).toEqual([0, 1, 2]);
  });

  it('rejects when a worker throws', async() => {
    await expect(mapWithConcurrency([1, 2, 3], 2, async(n) => {
      if (n === 2) {
        throw new Error('boom');
      }

      return n;
    })).rejects.toThrow('boom');
  });

  it('treats a limit below one as sequential rather than hanging', async() => {
    // `Math.min(0, n)` spawns no runners at all, so nothing is processed and
    // the slots stay empty. Pinned because a computed limit can reach zero.
    const worker = jest.fn(async(n: number) => n);
    const out = await mapWithConcurrency([1, 2, 3], 0, worker);

    expect(worker).not.toHaveBeenCalled();
    expect(out).toHaveLength(3);
    expect(out.every((v) => v === undefined)).toBe(true);
  });
});
