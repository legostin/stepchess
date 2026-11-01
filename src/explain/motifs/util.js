// explain/motifs/util — the board helpers the detectors share: piece values, the attacks of one piece, lines, material, mates, captures.
import {
    WHITE,
    PAWN,
    KNIGHT,
    BISHOP,
    ROOK,
    QUEEN,
    KING,
    SEE_VALUES,
    F_CAPTURE,
    legalMoves,
    see,
    attackersOf,
    moveTo,
    moveFrom,
    moveFlags,
    movePromo,
} from '../../core/index.js';

/** The value of a piece type in centipawns (the exchange values of core/see; the king is priceless). */
export const VALUE = SEE_VALUES;
/** What a mate is worth when gains are counted. */
export const MATE_GAIN = 100000;
/** The least gain that counts as winning material: most of a pawn, so that a knight for a bishop does not spoil it. */
export const WIN = 80;

export const KNIGHT_STEPS = Object.freeze([33, 31, 18, 14, -14, -18, -31, -33]);
export const KING_STEPS = Object.freeze([16, -16, 1, -1, 17, 15, -15, -17]);
export const ORTHO = Object.freeze([16, -16, 1, -1]);
export const DIAG = Object.freeze([17, 15, -15, -17]);

// DIR[b − a + 119]: the step that leads from a to b along a rank, a file or a diagonal; 0 when there is none
const DIR = new Int8Array(239);
for (const d of [...ORTHO, ...DIAG]) for (let k = 1; k < 8; k++) DIR[d * k + 119] = d;

/** The step from a to b when they share a line, else 0. */
export const stepBetween = (a, b) => (a === b ? 0 : DIR[b - a + 119]);
/** Is the step along a rank or a file? */
export const isOrtho = (d) => d === 1 || d === -1 || d === 16 || d === -16;
/** Does a piece of the type slide along the step (a rook along files and ranks, a bishop along diagonals, a queen both)? */
export const slidesAlong = (type, d) => type === QUEEN || (type === ROOK && isOrtho(d)) || (type === BISHOP && d !== 0 && !isOrtho(d));
/** The steps a slider moves along (none for the other pieces). */
export const slideDirs = (type) => (type === ROOK ? ORTHO : type === BISHOP ? DIAG : type === QUEEN ? KING_STEPS : []);
/** The king-step distance between two squares. */
export const distance = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));
/** The steps to the centre: 0 on d4, e4, d5, e5, 6 in a corner. */
export const centreDistance = (sq) => {
    const f = sq & 7;
    const r = sq >> 4;
    return (f < 4 ? 3 - f : f - 4) + (r < 4 ? 3 - r : r - 4);
};
/** The rank of a square seen from a color's side (0 its first rank). */
export const relRank = (sq, color) => (color === WHITE ? sq >> 4 : 7 - (sq >> 4));
/** The squares next to a square, on the board. */
export const neighbours = (sq) => KING_STEPS.map((d) => sq + d).filter((s) => (s & 0x88) === 0);

/** The first occupied square from sq (not included) along the step, or −1. */
export function firstAlong(b, sq, d) {
    for (let s = sq + d; (s & 0x88) === 0; s += d) if (b[s]) return s;
    return -1;
}

/** Is the square between a and b (exclusive) on their line? */
export function isBetween(a, s, b) {
    const d = stepBetween(a, b);
    return d !== 0 && s !== a && s !== b && stepBetween(a, s) === d && stepBetween(s, b) === d;
}

/** The squares the piece on sq attacks (a slider up to and with the first piece in each direction). */
export function pieceAttacks(b, sq) {
    const p = b[sq];
    const type = p & 7;
    const out = [];
    if (type === PAWN) {
        const up = p >> 3 ? -16 : 16;
        for (const s of [sq + up - 1, sq + up + 1]) if ((s & 0x88) === 0) out.push(s);
    } else if (type === KNIGHT || type === KING) {
        for (const d of type === KNIGHT ? KNIGHT_STEPS : KING_STEPS) if (((sq + d) & 0x88) === 0) out.push(sq + d);
    } else
        for (const d of slideDirs(type))
            for (let s = sq + d; (s & 0x88) === 0; s += d) {
                out.push(s);
                if (b[s]) break;
            }
    return out;
}

/** Does the piece on `from` attack `to` on this board? */
export function attacks(b, from, to) {
    const p = b[from];
    const type = p & 7;
    if (!p || from === to) return false;
    const diff = to - from;
    if (type === PAWN) {
        const up = p >> 3 ? -16 : 16;
        return diff === up - 1 || diff === up + 1;
    }
    if (type === KNIGHT) return KNIGHT_STEPS.includes(diff);
    if (type === KING) return KING_STEPS.includes(diff);
    const d = stepBetween(from, to);
    if (!slidesAlong(type, d)) return false;
    for (let s = from + d; s !== to; s += d) if (b[s]) return false;
    return true;
}

/** The attackers of the color on sq with the piece on `lift` taken off the board (the king that would step there). */
export function attackersLifted(pos, sq, color, lift) {
    const b = pos.board;
    const p = b[lift];
    b[lift] = 0;
    try {
        return attackersOf(pos, sq, color);
    } finally {
        b[lift] = p;
    }
}

/** White's material less Black's, in centipawns (kings left out). */
export function material(pos) {
    const c = pos.counts;
    let v = 0;
    for (let t = PAWN; t <= QUEEN; t++) v += (c[t] - c[8 | t]) * VALUE[t];
    return v;
}

/** Has the side to move been mated? */
export const isMate = (pos) => pos.inCheck() && legalMoves(pos).length === 0;

/** A move that mates at once for the side to move, or 0. */
export function mateInOne(pos) {
    for (const m of legalMoves(pos)) {
        pos.make(m);
        const mate = pos.inCheck() && legalMoves(pos).length === 0;
        pos.unmake();
        if (mate) return m;
    }
    return 0;
}

/** Is the move a capture or a promotion (a move that changes the material)? */
export const isCapture = (m) => (moveFlags(m) & F_CAPTURE) !== 0;
export const changesMaterial = (m) => (moveFlags(m) & F_CAPTURE) !== 0 || movePromo(m) !== 0;

/**
 * The best exchange the side to move can start: {see, move} over its legal captures and promotions (only those landing on
 * `onto` when it is given); see is 0 and move 0 when nothing gains.
 */
export function bestCapture(pos, onto = null) {
    let best = 0;
    let move = 0;
    for (const m of legalMoves(pos)) {
        if (!changesMaterial(m)) continue;
        if (onto && !onto.includes(moveTo(m))) continue;
        const v = see(pos, m);
        if (v > best) {
            best = v;
            move = m;
        }
    }
    return { see: best, move };
}

/** The legal moves of the piece standing on sq (the side to move's). */
export const movesOf = (pos, sq) => legalMoves(pos).filter((m) => moveFrom(m) === sq);

/** Run fn on the position with the turn passed (null when the side to move is in check); the position is restored. */
export function withNull(pos, fn) {
    if (pos.inCheck()) return null;
    pos.makeNull();
    try {
        return fn(pos);
    } finally {
        pos.unmakeNull();
    }
}

/** Run fn on the position after the move; the position is restored. */
export function withMove(pos, m, fn) {
    pos.make(m);
    try {
        return fn(pos);
    } finally {
        pos.unmake();
    }
}

/** The pawns of a color, as squares. */
export function pawnsOf(b, color) {
    const out = [];
    const p = (color << 3) | PAWN;
    for (let sq = 0; sq < 120; sq++) if ((sq & 0x88) === 0 && b[sq] === p) out.push(sq);
    return out;
}

/** Is the pawn of the color on sq passed: no enemy pawn ahead on its file or a neighbouring one, no own pawn ahead? */
export function isPassed(b, sq, color) {
    const f = sq & 7;
    const enemy = ((color ^ 1) << 3) | PAWN;
    const own = (color << 3) | PAWN;
    const up = color === WHITE ? 16 : -16;
    for (let s = sq + up; (s & 0x88) === 0; s += up) {
        if (b[s] === own || b[s] === enemy) return false;
        if (f > 0 && b[s - 1] === enemy) return false;
        if (f < 7 && b[s + 1] === enemy) return false;
    }
    return true;
}

/** Is the pawn of the color on sq isolated: no own pawn on a neighbouring file? */
export function isIsolated(b, sq, color) {
    const own = (color << 3) | PAWN;
    const f = sq & 7;
    for (let r = 0; r < 8; r++) {
        if (f > 0 && b[(r << 4) | (f - 1)] === own) return false;
        if (f < 7 && b[(r << 4) | (f + 1)] === own) return false;
    }
    return true;
}

/** The game phase of a board: 1 for a knight or a bishop, 2 for a rook, 4 for a queen, both colors (24 at the start). */
export function phaseOf(pos) {
    const c = pos.counts;
    return c[KNIGHT] + c[8 | KNIGHT] + c[BISHOP] + c[8 | BISHOP] + 2 * (c[ROOK] + c[8 | ROOK]) + 4 * (c[QUEEN] + c[8 | QUEEN]);
}

/** Are there only kings and pawns on the board? */
export function kingsAndPawns(pos) {
    return phaseOf(pos) === 0;
}

/** Is the piece code a king? */
export const isKing = (p) => (p & 7) === KING;

/** A motif of the context's ply. */
export function found(ctx, key, kind, { pieces = [], squares = [], arrows = [], params = {} } = {}) {
    return { key, kind, side: ctx.mover, ply: ctx.ply, pieces, squares, arrows, params };
}
