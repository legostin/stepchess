// endgame/tb-index — material keys, the index of a position in its table (symmetries folded), the value byte, the file header.
//
// A table holds one material, the strong side as White ('KQK', 'KRPK', 'KQKR': the strong side's king and pieces by
// value, then the weak side's). A position where Black is the stronger side is read colour-flipped: ranks mirrored,
// colours and the side to move swapped. Equal material keeps the colours (both sides to move are in the table).
//
// The index, most significant first: the side to move, the weak king, the weak pieces, the strong pieces (each side's
// in reverse key order), the strong king (the order that deflate compresses best among those tried). Without pawns the strong king is folded into the 10-square triangle a1–d1–d4 by the 8 symmetries of
// the board; with pawns, into files a–d (32 squares) by the file mirror. A pawn takes 48 squares (ranks 2–7), any
// other piece 64. Positions equal up to a symmetry, or up to the numbering of two identical pieces, share the canonical
// (smallest) index; the other entries copy its value.
//
// The value byte (Int8), distances in moves (DTM), for the side to move:
//      0       a draw (stalemate included; the fifty-move rule is not modelled)
//     +n       the side to move mates in n moves (1 ≤ n ≤ 126)
//     −n       the side to move is mated in n moves (1 ≤ n ≤ 126)
//     −127     MATED: the side to move is checkmated now — "mated in 0", probed as {wdl: −1, dtm: 0}
//     −128     ILLEGAL: two pieces on one square, or the side not to move in check
// Castling rights and an en passant square are not part of a table: probe looks one move ahead for en passant and
// answers nothing when castling rights remain.
import { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from '../core/index.js';

export const MAX_PIECES = 4;
export const DRAW = 0;
export const MATED = -127;
export const ILLEGAL = -128;
export const MAX_DTM = 126;

const LETTER = ' PNBRQK';
// the order of pieces in a key, and their weight when deciding which side is the strong one
const ORDER = [QUEEN, ROOK, BISHOP, KNIGHT, PAWN];
const WEIGHT = [0, 100, 320, 330, 500, 900, 0];
const ORDER_AT = new Int8Array(8).fill(-1);
ORDER.forEach((t, i) => (ORDER_AT[t] = i));

// the 8 symmetries of the board on 0..63 squares: an optional diagonal swap, then file and rank mirrors
export const SYMMETRY = Array.from({ length: 8 }, (_, t) =>
    Int8Array.from({ length: 64 }, (_, sq) => {
        let f = sq & 7;
        let r = sq >> 3;
        if (t & 4) [f, r] = [r, f];
        if (t & 1) f = 7 - f;
        if (t & 2) r = 7 - r;
        return r * 8 + f;
    }),
);
// the triangle a1–d1–d4: a square's number in it (−1 outside), and the square of each number
const TRI = new Int8Array(64).fill(-1);
const TRI_SQ = [];
for (let sq = 0; sq < 64; sq++)
    if ((sq & 7) <= 3 && sq >> 3 <= (sq & 7)) {
        TRI[sq] = TRI_SQ.length;
        TRI_SQ.push(sq);
    }
// for each square, the symmetries that bring it into the triangle: one, or two on the a1–h8 diagonal
const TO_TRI = Array.from({ length: 64 }, (_, sq) => [0, 1, 2, 3, 4, 5, 6, 7].filter((t) => TRI[SYMMETRY[t][sq]] >= 0));
// the strong king with pawns: files a–d
const HALF = new Int8Array(64).fill(-1);
const HALF_SQ = [];
for (let sq = 0; sq < 64; sq++)
    if ((sq & 7) < 4) {
        HALF[sq] = HALF_SQ.length;
        HALF_SQ.push(sq);
    }

const TMP = new Int8Array(8);

/** The layout of one table: its pieces in index order, their ranges and the canonical index of a position. */
export class Layout {
    constructor(key, strong, weak) {
        this.key = key;
        const pieces = [[WHITE, KING], ...strong.map((t) => [WHITE, t]), [BLACK, KING], ...weak.map((t) => [BLACK, t])];
        this.n = pieces.length;
        this.color = Int8Array.from(pieces, (p) => p[0]);
        this.type = Int8Array.from(pieces, (p) => p[1]);
        this.pawns = this.type.includes(PAWN);
        this.kingSlot = [0, 1 + strong.length];
        this.range = Int32Array.from(pieces, (p, j) => (j === 0 ? (this.pawns ? 32 : 10) : p[1] === PAWN ? 48 : 64));
        // the digits of the index, least significant first: strong king, strong pieces, weak pieces, weak king
        const k = this.kingSlot[1];
        this.digits = Int8Array.from([...Array(this.n).keys()].filter((j) => j !== k).concat([k]));
        this.mult = new Int32Array(this.n);
        let m = 1;
        for (const j of this.digits) {
            this.mult[j] = m;
            m *= this.range[j];
        }
        this.per = m;
        this.size = 2 * m;
        // runs of identical pieces: their squares are sorted in the canonical index
        this.groups = [];
        for (let j = 1; j < this.n;) {
            let e = j + 1;
            while (e < this.n && this.color[e] === this.color[j] && this.type[e] === this.type[j]) e++;
            if (e - j > 1) this.groups.push([j, e]);
            j = e;
        }
    }

    // the index of squares that are already oriented (the strong king in its region), identical pieces not yet sorted
    encode(sqs, stm) {
        for (const [a, e] of this.groups)
            for (let i = a + 1; i < e; i++) {
                const v = sqs[i];
                let k = i - 1;
                while (k >= a && sqs[k] > v) {
                    sqs[k + 1] = sqs[k];
                    k--;
                }
                sqs[k + 1] = v;
            }
        let idx = (this.pawns ? HALF[sqs[0]] : TRI[sqs[0]]) * this.mult[0];
        for (let j = 1; j < this.n; j++) idx += (this.type[j] === PAWN ? sqs[j] - 8 : sqs[j]) * this.mult[j];
        return stm * this.per + idx;
    }

    /** The canonical index of the squares (0..63, in this layout's piece order; table colours) and the side to move. */
    canon(sqs, stm) {
        const n = this.n;
        if (this.pawns) {
            const m = (sqs[0] & 7) >= 4 ? 7 : 0;
            for (let j = 0; j < n; j++) TMP[j] = sqs[j] ^ m;
            return this.encode(TMP, stm);
        }
        const list = TO_TRI[sqs[0]];
        let best = -1;
        for (let i = 0; i < list.length; i++) {
            const map = SYMMETRY[list[i]];
            for (let j = 0; j < n; j++) TMP[j] = map[sqs[j]];
            const idx = this.encode(TMP, stm);
            if (best < 0 || idx < best) best = idx;
        }
        return best;
    }

    /** The squares of an index, written to sqs; returns the side to move. */
    decode(idx, sqs) {
        const stm = idx >= this.per ? 1 : 0;
        let rem = idx - stm * this.per;
        const digits = this.digits;
        for (let d = 0; d < this.n; d++) {
            const j = digits[d];
            const r = this.range[j];
            const c = rem % r;
            rem = (rem - c) / r;
            sqs[j] = j === 0 ? (this.pawns ? HALF_SQ[c] : TRI_SQ[c]) : this.type[j] === PAWN ? c + 8 : c;
        }
        return stm;
    }

    /**
     * The canonical index of pieces given in any order and in their real colours (n of them: colour, type, square
     * 0..63), with the side to move; flip is 1 when the table reads them colour-flipped. −1 when they do not fit.
     */
    indexOf(flip, cols, types, sqs, n, stm) {
        if (n !== this.n) return -1;
        const sq = SLOT_SQ;
        let used = 0;
        for (let j = 0; j < this.n; j++) {
            let k = 0;
            while (k < n && (used & (1 << k) || (cols[k] ^ flip) !== this.color[j] || types[k] !== this.type[j])) k++;
            if (k === n) return -1;
            used |= 1 << k;
            sq[j] = flip ? sqs[k] ^ 56 : sqs[k];
            if (this.type[j] === PAWN && (sq[j] < 8 || sq[j] >= 56)) return -1;
        }
        return this.canon(sq, stm ^ flip);
    }
}
const SLOT_SQ = new Int8Array(8);

// the letters of one side's pieces in key order
const sideLetters = (count) => ORDER.map((t) => LETTER[t].repeat(count[t])).join('');

// a cache of material: the signature (base-8 digits, one per colour and piece type) → its key, flip and layout
const BY_SIG = new Map();
const LAYOUTS = new Map();

function infoOfCounts(white, black) {
    let ws = 0;
    let bs = 0;
    let total = 2;
    for (const t of ORDER) {
        ws += WEIGHT[t] * white[t];
        bs += WEIGHT[t] * black[t];
        total += white[t] + black[t];
    }
    let flip = bs > ws ? 1 : 0;
    if (bs === ws) {
        // equal weight: the side with more of the higher pieces first (identical material keeps the colours)
        for (const t of ORDER)
            if (white[t] !== black[t]) {
                flip = black[t] > white[t] ? 1 : 0;
                break;
            }
    }
    const [s, w] = flip ? [black, white] : [white, black];
    const key = `K${sideLetters(s)}K${sideLetters(w)}`;
    return { key, flip, pieces: total, trivial: key === 'KK' || key === 'KBK' || key === 'KNK' };
}

/**
 * The material of pieces (colours, types; n of them): {key, flip, pieces, trivial, layout}; trivial for the
 * materials no side can mate with (KK, KBK, KNK), which need no table. Cached by material.
 */
export function materialOf(cols, types, n) {
    let sig = 0;
    for (let k = 0; k < n; k++) if (types[k] !== KING) sig += 1 << (3 * (cols[k] * 5 + ORDER_AT[types[k]]));
    let info = BY_SIG.get(sig);
    if (!info) {
        const white = new Int8Array(8);
        const black = new Int8Array(8);
        for (let k = 0; k < n; k++) if (types[k] !== KING) (cols[k] ? black : white)[types[k]]++;
        info = infoOfCounts(white, black);
        info.layout = info.pieces <= MAX_PIECES ? layoutOf(info.key) : null;
        BY_SIG.set(sig, info);
    }
    return info;
}

/** The layout of a key ('KQK', 'KRPK', …), or null for anything that is not a key of at most MAX_PIECES pieces. */
export function layoutOf(key) {
    if (typeof key !== 'string') return null;
    if (LAYOUTS.has(key)) return LAYOUTS.get(key);
    let layout = null;
    const m = /^K([QRBNP]*)K([QRBNP]*)$/.exec(key);
    if (m && m[1].length + m[2].length + 2 <= MAX_PIECES) {
        const strong = [...m[1]].map((ch) => LETTER.indexOf(ch));
        const weak = [...m[2]].map((ch) => LETTER.indexOf(ch));
        const white = new Int8Array(8);
        const black = new Int8Array(8);
        strong.forEach((t) => white[t]++);
        weak.forEach((t) => black[t]++);
        const info = infoOfCounts(white, black);
        if (info.key === key && info.flip === 0) layout = new Layout(key, strong, weak);
    }
    LAYOUTS.set(key, layout);
    return layout;
}

/** The entries of a table (0 for anything that is not a key). */
export const tbSize = (key) => layoutOf(key)?.size ?? 0;

// the pieces of a position, as arrays for materialOf and indexOf
const P_COL = new Int8Array(32);
const P_TYPE = new Int8Array(32);
const P_SQ = new Int8Array(32);
function piecesOf(pos) {
    const b = pos.board;
    let n = 0;
    for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88 || !b[sq]) continue;
        if (n === 32) return 33;
        P_COL[n] = b[sq] >> 3;
        P_TYPE[n] = b[sq] & 7;
        P_SQ[n] = (sq >> 4) * 8 + (sq & 7);
        n++;
    }
    return n;
}

/** The key of a position and whether its table reads it colour-flipped: {key, flip, trivial}; null over MAX_PIECES. */
export function keyInfo(pos) {
    const n = piecesOf(pos);
    if (n > MAX_PIECES) return null;
    return materialOf(P_COL, P_TYPE, n);
}

/** The material key of a position ('KQK', 'KRPK', 'KK'), or null when more than MAX_PIECES pieces stand on the board. */
export const materialKey = (pos) => keyInfo(pos)?.key ?? null;

/** The canonical index of a position in the table of the key, or −1 when the position is not of that material. */
export function tbIndex(key, pos) {
    const n = piecesOf(pos);
    if (n > MAX_PIECES) return -1;
    const info = materialOf(P_COL, P_TYPE, n);
    if (info.key !== key || !info.layout) return -1;
    return info.layout.indexOf(info.flip, P_COL, P_TYPE, P_SQ, n, pos.side);
}

/** The value byte as {wdl, dtm} for the side to move (dtm signed, in moves), or null for ILLEGAL. */
export function decodeValue(v) {
    if (v === ILLEGAL) return null;
    if (v === MATED) return { wdl: -1, dtm: 0 };
    if (v === 0) return { wdl: 0, dtm: 0 };
    return { wdl: v > 0 ? 1 : -1, dtm: v };
}

/**
 * The tables a table's moves lead into: one capture (of any piece but a king) or one promotion (to Q, R, B or N, with
 * or without taking a piece), without the materials that cannot mate. Keys, each once.
 */
export function tbDependencies(key) {
    const layout = layoutOf(key);
    if (!layout) return [];
    const out = new Set();
    const { n, color, type } = layout;
    const add = (cols, types) => {
        const info = materialOf(cols, types, cols.length);
        if (!info.trivial) out.add(info.key);
    };
    const without = (skip) => [[...color].filter((_, k) => k !== skip), [...type].filter((_, k) => k !== skip)];
    for (let j = 0; j < n; j++) {
        if (type[j] === KING) continue;
        add(...without(j));
        if (type[j] !== PAWN) continue;
        for (const promo of [QUEEN, ROOK, BISHOP, KNIGHT]) {
            const types = [...type];
            types[j] = promo;
            add([...color], types);
            // a capture on the last rank: of a piece, never of a pawn
            for (let k = 0; k < n; k++) {
                if (color[k] === color[j] || type[k] === KING || type[k] === PAWN) continue;
                add(
                    [...color].filter((_, i) => i !== k),
                    types.filter((_, i) => i !== k),
                );
            }
        }
    }
    return [...out];
}

// The file: 'SCTB', version, key length, key (ASCII), entries (uint32 LE), then the table compressed with deflate (zlib
// format). An ILLEGAL entry is written as the value before it (it compresses better: KNNK shrinks fifty-fold); the
// loader marks the illegal entries again (tb-generate markIllegal), so a loaded table equals the generated one.
export const MAGIC = 'SCTB';
export const VERSION = 1;

/** The entries of a table as they are written to a file: each ILLEGAL entry holds the value before it. */
export function packTable(table) {
    const out = new Int8Array(table.length);
    let prev = 0;
    for (let i = 0; i < table.length; i++) {
        const v = table[i];
        if (v !== ILLEGAL) prev = v;
        out[i] = prev;
    }
    return new Uint8Array(out.buffer);
}

/** The header of a table file for the key. */
export function writeHeader(key) {
    const out = new Uint8Array(4 + 1 + 1 + key.length + 4);
    for (let i = 0; i < 4; i++) out[i] = MAGIC.charCodeAt(i);
    out[4] = VERSION;
    out[5] = key.length;
    for (let i = 0; i < key.length; i++) out[6 + i] = key.charCodeAt(i);
    const size = tbSize(key);
    const at = 6 + key.length;
    out[at] = size & 255;
    out[at + 1] = (size >>> 8) & 255;
    out[at + 2] = (size >>> 16) & 255;
    out[at + 3] = (size >>> 24) & 255;
    return out;
}

/** The header of a table file: {version, key, size, offset} (offset: where the deflate stream starts), or null. */
export function readHeader(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 10) return null;
    for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) return null;
    const version = bytes[4];
    const len = bytes[5];
    if (version !== VERSION || bytes.length < 10 + len) return null;
    let key = '';
    for (let i = 0; i < len; i++) key += String.fromCharCode(bytes[6 + i]);
    const at = 6 + len;
    const size = (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
    if (!layoutOf(key) || size !== tbSize(key)) return null;
    return { version, key, size, offset: at + 4 };
}
