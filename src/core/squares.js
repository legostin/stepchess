// core/squares — the 0x88 board: square indices, names, 64-square indices and the rank flip.
//
// A square is rank * 16 + file (rank 0 is rank 1, file 0 is the a-file); an index with a bit of 0x88 set lies off the
// board, so a step off any edge shows in one test.

const FILES = 'abcdefgh';

/** The square of a file and a rank (both 0..7). */
export const square = (file, rank) => rank * 16 + file;
/** The file of a square (0 is the a-file). */
export const fileOf = (sq) => sq & 7;
/** The rank of a square (0 is rank 1). */
export const rankOf = (sq) => sq >> 4;
/** Is the index on the board? */
export const onBoard = (sq) => (sq & 0x88) === 0;
/** The name of a square: 'e4'. */
export const sqName = (sq) => FILES[sq & 7] + ((sq >> 4) + 1);
/** The square named 'e4', or -1. */
export function parseSquare(name) {
    if (typeof name !== 'string' || name.length !== 2) return -1;
    const f = name.charCodeAt(0) - 97;
    const r = name.charCodeAt(1) - 49;
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 16 + f : -1;
}
/** The 0..63 index of a square (a1 = 0, h8 = 63). */
export const to64 = (sq) => (sq >> 4) * 8 + (sq & 7);
/** The square of a 0..63 index. */
export const from64 = (i) => (i >> 3) * 16 + (i & 7);
/** The same file on the mirrored rank: e2 ↔ e7. */
export const flipRank = (sq) => sq ^ 0x70;
/** The 64 squares, a1, b1, …, h8. */
export const ALL_SQUARES = Object.freeze(Array.from({ length: 64 }, (_, i) => from64(i)));
