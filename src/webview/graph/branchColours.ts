/**
 * Hands out palette indexes to the tracks of one layout, reusing an index once its last track has
 * ended. A track that ended on row `r` gives up its index to tracks starting on row `r + 1` or
 * later, never to one starting on row `r` itself, so two tracks sharing a row never share a colour.
 *
 * The layout claims an index for each track, walks the track, and releases the index with the last
 * row it reached before claiming the next one. A claim is not a reservation: until the index is
 * released, another claim may return it too.
 */
export function createBranchColours(): {
  claim(startAt: number): number;
  release(colour: number, end: number): void;
} {
  // The last row each index was released at, by index. An index enters at row 0 when first handed
  // out. Indexes that were skipped by a release beyond the end are holes, and are never offered.
  const lastRows: Array<number> = [];

  return {
    /** The lowest index whose track ended above `startAt`, or else a new one. */
    claim(startAt: number): number {
      for (let colour = 0; colour < lastRows.length; colour++) {
        const lastRow = lastRows[colour];
        if (lastRow !== undefined && lastRow < startAt) {
          return colour;
        }
      }
      return lastRows.push(0) - 1;
    },

    /** Record that the track holding `colour` ended on row `end`, replacing any earlier record. */
    release(colour: number, end: number): void {
      lastRows[colour] = end;
    }
  };
}
