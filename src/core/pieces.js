// core/pieces — piece codes: a color and a type in one small integer, and their FEN letters.

export const WHITE = 0;
export const BLACK = 1;

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;

/** The code of a piece: (color << 3) | type; white pieces are 1..6, black ones 9..14. */
export const makePiece = (color, type) => (color << 3) | type;
/** The color of a piece code. */
export const colorOf = (p) => p >> 3;
/** The type of a piece code. */
export const typeOf = (p) => p & 7;

const LETTERS = ' pnbrqk';

/** The piece of a FEN letter ('N' a white knight, 'q' a black queen), EMPTY for anything else. */
export function pieceFromFen(ch) {
    if (typeof ch !== 'string' || ch.length !== 1) return EMPTY;
    const lower = ch.toLowerCase();
    const type = LETTERS.indexOf(lower);
    if (type < 1) return EMPTY;
    return makePiece(ch === lower ? BLACK : WHITE, type);
}

/** The FEN letter of a piece code ('' for EMPTY). */
export function pieceToFen(p) {
    const ch = LETTERS[p & 7] ?? ' ';
    if (ch === ' ') return '';
    return p >> 3 ? ch : ch.toUpperCase();
}
