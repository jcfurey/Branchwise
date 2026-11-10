import { describe, expect, it } from "vitest";

import { ALL_COLUMNS } from "@/webview/constants";
import { crowdedCells, DESCRIPTION_ROOM } from "@/webview/utils/columns";

// Cells by index: 0 graph, 1 description, 2 date, 3 author, 4 commit ID.
const WIDTHS: Record<number, number> = { 2: 130, 3: 90, 4: 70 };
const widthOf = (cell: number) => WIDTHS[cell] ?? 0;

/** The cells left out of `chosen` when the description is `room` wide and `crowded` are out. */
const fit = (room: number, crowded: number[] = [], chosen: readonly number[] = ALL_COLUMNS) =>
  crowdedCells(chosen, crowded, room, widthOf);

describe("a table too narrow for its columns", () => {
  it("leaves every column while the description has its room", () => {
    expect(fit(DESCRIPTION_ROOM)).toStrictEqual([]);
    expect(fit(900)).toStrictEqual([]);
  });

  it("leaves out the ID first, then the author, then the date, only as far as needed", () => {
    // 70 more is enough; 160 more is enough; nothing but all three is.
    expect(fit(150)).toStrictEqual([4]);
    expect(fit(100)).toStrictEqual([3, 4]);
    expect(fit(20)).toStrictEqual([2, 3, 4]);
    expect(fit(-150)).toStrictEqual([2, 3, 4]);
  });

  it("counts what the cells already left out gave back", () => {
    // With the ID out the description is 180 wide: the author goes too, and no further.
    expect(fit(180, [4])).toStrictEqual([3, 4]);
    expect(fit(205, [4])).toStrictEqual([4]);
  });

  it("never leaves out a column the user hid, nor counts its width", () => {
    const withoutAuthor = [0, 1, 2, 4];
    expect(fit(150, [], withoutAuthor)).toStrictEqual([4]);
    expect(fit(100, [], withoutAuthor)).toStrictEqual([2, 4]);
    // A cell left out earlier that the user has hidden since is forgotten.
    expect(fit(900, [3], withoutAuthor)).toStrictEqual([]);
  });
});

describe("a table with room again", () => {
  it("brings columns back in the reverse order: date, author, ID", () => {
    const all = [2, 3, 4];
    // The date needs its 130 and the room with 48 to spare: 378.
    expect(fit(377, all)).toStrictEqual([2, 3, 4]);
    expect(fit(378, all)).toStrictEqual([3, 4]);
    // The author after it needs 90 more, the ID 70 more still.
    expect(fit(468, all)).toStrictEqual([4]);
    expect(fit(538, all)).toStrictEqual([]);
  });

  it("does not bring the ID back before the author", () => {
    // Room for the ID alone, but the author is still out.
    expect(fit(330, [3, 4])).toStrictEqual([3, 4]);
  });

  it("holds its choice between the two limits, so a width near one does not flicker", () => {
    // 199 leaves the ID out and gives 269; coming back needs 318.
    expect(fit(199)).toStrictEqual([4]);
    for (const room of [269, 280, 317]) {
      expect(fit(room, [4])).toStrictEqual([4]);
    }
    expect(fit(318, [4])).toStrictEqual([]);
    // Back in, the description is 248 wide, well clear of leaving it out again.
    expect(fit(248)).toStrictEqual([]);
  });
});
