/**
 * Run `worker` over every item with at most `limit` in flight.
 *
 * Repo enrichment fans out to a few hundred GitHub calls; firing them all at
 * once gets us secondary-rate-limited, and doing them one at a time is far too
 * slow for a page load.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async() => {
    while (cursor < items.length) {
      const index = cursor++;

      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);

  return results;
}
