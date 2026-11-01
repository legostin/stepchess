// core/movegen — legal move generation (pins and check evasions computed first, no make/test), legalMoves, perft.
//
// One pass from the king finds the checkers and the pinned pieces with their pin lines. A pinned piece moves only
// along its line; in check a move must take the checker or step between it and the king; in double check only the
// king moves. King steps are tested with the king lifted off the board, and en passant — the one move that can open
// a line through two pieces — is tried on the board. Nothing is allocated per call: the marks live in typed arrays
// stamped with a counter, so they need no clearing.
import { WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from './pieces.js';
import { F_CAPTURE, F_EP, F_CASTLE, F_DOUBLE } from './move.js';
import { WK, WQ, BK, BQ, attacked, KNIGHT_STEPS, KING_STEPS, ROOK_DIRS, BISHOP_DIRS } from './position.js';

const CAP = F_CAPTURE << 17;
const EP = (F_EP | F_CAPTURE) << 17;
const DOUBLE = F_DOUBLE << 17;
const CASTLE = F_CASTLE << 17;

const PIN = new Int32Array(128); // stamp: the piece on the square is pinned
const PIN_DIR = new Int8Array(128); // the direction from the king to the pinning piece
const TARGET = new Int32Array(128); // stamp: a square that answers the check
let stamp = 0;

const KN = new Int8Array(KNIGHT_STEPS);
const KG = new Int8Array(KING_STEPS);
const RD = new Int8Array(ROOK_DIRS);
const BD = new Int8Array(BISHOP_DIRS);

// the promotions of a pawn to `to`: the queen first; only the queen when only captures are asked for
function promotions(out, n, base, capturesOnly) {
    out[n++] = base | (QUEEN << 14);
    if (capturesOnly) return n;
    out[n++] = base | (KNIGHT << 14);
    out[n++] = base | (ROOK << 14);
    out[n++] = base | (BISHOP << 14);
    return n;
}

/**
 * The legal moves of the side to move, written to out (an Int32Array of 256); returns their number. With
 * capturesOnly: the captures (en passant included) and the promotions to a queen, nothing else.
 *
 * In check, capturesOnly drops the quiet evasions (king steps, blocks) too, so a quiescence search must generate all
 * moves when the side to move is in check. An en passant capture (F_EP, flagged F_CAPTURE as well) lands on an empty
 * square: board[to] is 0, and SEE or move ordering must take the victim (a pawn) from the flag, not from the board.
 */
export function generateMoves(pos, out, capturesOnly = false) {
    const b = pos.board;
    const us = pos.side;
    const them = us ^ 1;
    const ksq = pos.kings[us];
    if (++stamp === 0x7fffffff) {
        PIN.fill(0);
        TARGET.fill(0);
        stamp = 1;
    }
    const st = stamp;
    let n = 0;

    // checkers and pins, looking out from the king
    let checkers = 0;
    let checkSq = -1;
    let checkDir = 0;
    for (let i = 0; i < 8; i++) {
        const d = KG[i];
        const line = i < 4 ? ROOK : BISHOP;
        let s = ksq + d;
        let pinned = -1;
        while ((s & 0x88) === 0) {
            const p = b[s];
            if (p) {
                if (p >> 3 === us) {
                    if (pinned !== -1) break;
                    pinned = s;
                } else {
                    const t = p & 7;
                    if (t === QUEEN || t === line) {
                        if (pinned === -1) {
                            checkers++;
                            checkSq = s;
                            checkDir = d;
                        } else {
                            PIN[pinned] = st;
                            PIN_DIR[pinned] = d;
                        }
                    }
                    break;
                }
            }
            s += d;
        }
    }
    const theirKnight = (them << 3) | KNIGHT;
    for (let i = 0; i < 8; i++) {
        const s = ksq + KN[i];
        if ((s & 0x88) === 0 && b[s] === theirKnight) {
            checkers++;
            checkSq = s;
            checkDir = 0;
        }
    }
    const theirPawn = (them << 3) | PAWN;
    const fwd = us === WHITE ? 16 : -16;
    for (let s = ksq + fwd - 1, j = 0; j < 2; j++, s += 2)
        if ((s & 0x88) === 0 && b[s] === theirPawn) {
            checkers++;
            checkSq = s;
            checkDir = 0;
        }

    // the king, lifted off the board so that it does not shield the squares behind it
    const king = b[ksq];
    b[ksq] = 0;
    for (let i = 0; i < 8; i++) {
        const to = ksq + KG[i];
        if (to & 0x88) continue;
        const q = b[to];
        if (q) {
            if (q >> 3 === them && !attacked(b, to, them)) out[n++] = ksq | (to << 7) | CAP;
        } else if (!capturesOnly && !attacked(b, to, them)) out[n++] = ksq | (to << 7);
    }
    b[ksq] = king;
    if (checkers > 1) return n;

    const evade = checkers === 1;
    if (evade) {
        TARGET[checkSq] = st;
        if (checkDir) for (let s = ksq + checkDir; s !== checkSq; s += checkDir) TARGET[s] = st;
    } else if (!capturesOnly && pos.castling) {
        // the king is not in check; the squares it crosses must be empty and safe, the b-file one only empty
        if (us === WHITE) {
            if (pos.castling & WK && !b[0x05] && !b[0x06] && !attacked(b, 0x05, them) && !attacked(b, 0x06, them)) out[n++] = 0x04 | (0x06 << 7) | CASTLE;
            if (pos.castling & WQ && !b[0x03] && !b[0x02] && !b[0x01] && !attacked(b, 0x03, them) && !attacked(b, 0x02, them))
                out[n++] = 0x04 | (0x02 << 7) | CASTLE;
        } else {
            if (pos.castling & BK && !b[0x75] && !b[0x76] && !attacked(b, 0x75, them) && !attacked(b, 0x76, them)) out[n++] = 0x74 | (0x76 << 7) | CASTLE;
            if (pos.castling & BQ && !b[0x73] && !b[0x72] && !b[0x71] && !attacked(b, 0x73, them) && !attacked(b, 0x72, them))
                out[n++] = 0x74 | (0x72 << 7) | CASTLE;
        }
    }

    const startRank = us === WHITE ? 1 : 6;
    const lastRank = us === WHITE ? 7 : 0;
    const ep = pos.ep;
    for (let from = 0; from < 120; from++) {
        if (from & 0x88) {
            from += 7;
            continue;
        }
        const p = b[from];
        if (!p || p >> 3 !== us) continue;
        const t = p & 7;
        if (t === KING) continue;
        const pinDir = PIN[from] === st ? PIN_DIR[from] : 0;

        if (t === PAWN) {
            const to1 = from + fwd;
            if ((pinDir === 0 || pinDir === 16 || pinDir === -16) && !b[to1]) {
                if (to1 >> 4 === lastRank) {
                    if (!evade || TARGET[to1] === st) n = promotions(out, n, from | (to1 << 7), capturesOnly);
                } else if (!capturesOnly) {
                    if (!evade || TARGET[to1] === st) out[n++] = from | (to1 << 7);
                    if (from >> 4 === startRank) {
                        const to2 = to1 + fwd;
                        if (!b[to2] && (!evade || TARGET[to2] === st)) out[n++] = from | (to2 << 7) | DOUBLE;
                    }
                }
            }
            for (let c = fwd - 1, j = 0; j < 2; j++, c += 2) {
                if (pinDir !== 0 && c !== pinDir && c !== -pinDir) continue;
                const to = from + c;
                if (to & 0x88) continue;
                const q = b[to];
                if (q) {
                    if (q >> 3 === them && (!evade || TARGET[to] === st)) {
                        if (to >> 4 === lastRank) n = promotions(out, n, from | (to << 7) | CAP, capturesOnly);
                        else out[n++] = from | (to << 7) | CAP;
                    }
                } else if (to === ep) {
                    // try it on the board: it lifts two pawns off one line
                    const cs = to - fwd;
                    const taken = b[cs];
                    b[cs] = 0;
                    b[from] = 0;
                    b[to] = p;
                    const legal = !attacked(b, ksq, them);
                    b[to] = 0;
                    b[from] = p;
                    b[cs] = taken;
                    if (legal) out[n++] = from | (to << 7) | EP;
                }
            }
        } else if (t === KNIGHT) {
            if (pinDir !== 0) continue;
            for (let i = 0; i < 8; i++) {
                const to = from + KN[i];
                if (to & 0x88) continue;
                const q = b[to];
                if (q) {
                    if (q >> 3 === them && (!evade || TARGET[to] === st)) out[n++] = from | (to << 7) | CAP;
                } else if (!capturesOnly && (!evade || TARGET[to] === st)) out[n++] = from | (to << 7);
            }
        } else {
            const dirs = t === BISHOP ? BD : t === ROOK ? RD : KG;
            const count = dirs.length;
            for (let i = 0; i < count; i++) {
                const d = dirs[i];
                if (pinDir !== 0 && d !== pinDir && d !== -pinDir) continue;
                let to = from + d;
                while ((to & 0x88) === 0) {
                    const q = b[to];
                    if (q) {
                        if (q >> 3 === them && (!evade || TARGET[to] === st)) out[n++] = from | (to << 7) | CAP;
                        break;
                    }
                    if (!capturesOnly && (!evade || TARGET[to] === st)) out[n++] = from | (to << 7);
                    to += d;
                }
            }
        }
    }
    return n;
}

/** The legal moves as an array (for callers off the hot path). */
export function legalMoves(pos) {
    const out = new Int32Array(256);
    return Array.from(out.subarray(0, generateMoves(pos, out)));
}

const BUFFERS = [];

function count(pos, depth, level) {
    const out = (BUFFERS[level] ??= new Int32Array(256));
    const n = generateMoves(pos, out);
    if (depth === 1) return n;
    let total = 0;
    for (let i = 0; i < n; i++) {
        pos.make(out[i]);
        total += count(pos, depth - 1, level + 1);
        pos.unmake();
    }
    return total;
}

/** The number of leaf positions depth plies deep (the last ply is counted, not made). */
export function perft(pos, depth) {
    return depth <= 0 ? 1 : count(pos, depth, 0);
}
