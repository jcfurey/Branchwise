/**
 * Runs `createPromise` over `data` with at most `maxParallel` tasks pending, starting them in
 * index order, and fulfils with each task's value at its item's index. A limit below 1, or one
 * that is not a number, allows one task; a fractional limit rounds up.
 *
 * The first task to fail, by rejecting or by throwing, rejects the run with its own reason, and
 * no further task starts. Tasks already running are neither awaited nor cancelled. `data` is read
 * as the run goes, so items appended before it finishes are processed too.
 */
export async function evalPromises<X, Y>(
  data: X[],
  maxParallel: number,
  createPromise: (val: X) => Promise<Y>
): Promise<Y[]> {
  const lanes = Math.min(maxParallel >= 1 ? Math.ceil(maxParallel) : 1, data.length);
  const results: Y[] = [];
  let next = 0;
  let failed = false;

  // Each lane takes the lowest unstarted item whenever its previous task fulfils. The first
  // task of every lane starts before this function returns.
  const lane = async () => {
    while (!failed && next < data.length) {
      const index = next++;
      try {
        // eslint-disable-next-line no-await-in-loop -- A lane runs one task at a time.
        results[index] = await createPromise(data[index] as X);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };

  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
