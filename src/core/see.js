// core/see — static exchange evaluation: what a move wins or loses once both sides trade on its target square.
//
// Both sides capture on the square with their least valuable attacker, in turn, and either may stop. Pieces taken
// reveal the sliders behind them (x-rays), a pawn that reaches the last rank promotes to a queen, and an en passant
// capture takes its pawn from beside the square, not from it. Pins and checks are ignored, except that a king can
// capture only when nothing recaptures (a king taken is the end of the exchange, never a gain). Nothing is allocated: the
// exchange runs on a scratch copy of the board, and its state lives in module variables.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from './pieces.js';
import { F_EP, F_CASTLE } from './move.js';
import { KNIGHT_STEPS, KING_STEPS, ROOK_DIRS, BISHOP_DIRS } from './position.js';

/** The value of a piece type in the exchange, in centipawns, indexed by type (0 is the empty square). */
export const SEE_VALUES = Object.freeze([0, 100, 320, 330, 500, 900, 20000]);
const V = new Int32Array(SEE_VALUES);
const PROMOTION_GAIN = V[QUEEN] - V[PAWN];

const KN = new Int8Array(KNIGHT_STEPS);
const KG = new Int8Array(KING_STEPS);
const RD = new Int8Array(ROOK_DIRS);
const BD = new Int8Array(BISHOP_DIRS);

const SCRATCH = new Int8Array(128); // the board the exchange is played on
const GAINS = new Int32Array(48); // what each capture of the exchange takes; at most 32 pieces can capture
let firstGain = 0; // what the move itself takes
let firstSide = 0; // the side that answers the move
let target = 0; // the square the exchange is on
let onSquare = 0; // the value of the piece standing on the target
let gained = 0; // what the last capture took

/**
 * Set the scratch board up after the move: the mover lifted and the victim removed. False when there is nothing to
 * evaluate (castling, a missing mover).
 */
function prepare(pos, m) {
    const flags = (m >> 17) & 15;
    if (flags & F_CASTLE) return false;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const promo = (m >> 14) & 7;
    const piece = pos.board[from];
    if (!piece) return false;
    SCRATCH.set(pos.board);
    const us = piece >> 3;
    let victim;
    if (flags & F_EP) {
        victim = PAWN;
        SCRATCH[us === 0 ? to - 16 : to + 16] = 0;
    } else victim = SCRATCH[to] & 7;
    SCRATCH[from] = 0;
    SCRATCH[to] = 0;
    firstGain = V[victim];
    if (promo) {
        firstGain += V[promo] - V[PAWN];
        onSquare = V[promo];
    } else onSquare = V[piece & 7];
    firstSide = us ^ 1;
    target = to;
    return true;
}

/**
 * The square of the least valuable piece of the side that attacks the target on the scratch board, or -1. Pawns first,
 * then knights, bishops, rooks, queens, and the king last.
 */
function leastAttacker(side) {
    const b = SCRATCH;
    const sq = target;
    const c = side << 3;
    const back = side === 0 ? -16 : 16;
    let s = sq + back - 1;
    if ((s & 0x88) === 0 && b[s] === (c | PAWN)) return s;
    s = sq + back + 1;
    if ((s & 0x88) === 0 && b[s] === (c | PAWN)) return s;
    for (let i = 0; i < 8; i++) {
        s = sq + KN[i];
        if ((s & 0x88) === 0 && b[s] === (c | KNIGHT)) return s;
    }
    let queen = -1;
    for (let i = 0; i < 4; i++) {
        const d = BD[i];
        for (s = sq + d; (s & 0x88) === 0; s += d) {
            const p = b[s];
            if (!p) continue;
            if (p === (c | BISHOP)) return s;
            if (p === (c | QUEEN)) queen = s;
            break;
        }
    }
    for (let i = 0; i < 4; i++) {
        const d = RD[i];
        for (s = sq + d; (s & 0x88) === 0; s += d) {
            const p = b[s];
            if (!p) continue;
            if (p === (c | ROOK)) return s;
            if (p === (c | QUEEN)) queen = s;
            break;
        }
    }
    if (queen >= 0) return queen;
    for (let i = 0; i < 8; i++) {
        s = sq + KG[i];
        if ((s & 0x88) === 0 && b[s] === (c | KING)) return s;
    }
    return -1;
}

// the square of the piece that captures next for the side, or -1: the least valuable attacker, except that a king
// captures only when the other side has nothing left to recapture with (the king lifted, so that a slider behind it counts)
function nextCapturer(side) {
    const s = leastAttacker(side);
    if (s < 0) return -1;
    const piece = SCRATCH[s];
    if ((piece & 7) !== KING) return s;
    SCRATCH[s] = 0;
    const recapture = leastAttacker(side ^ 1);
    SCRATCH[s] = piece;
    return recapture < 0 ? s : -1;
}

// the piece on s captures on the target: gained is what it takes (a pawn on the last rank also promotes), and the
// capturer, now a queen if it promoted, stands on the target
function capture(s) {
    const t = SCRATCH[s] & 7;
    gained = onSquare;
    if (t === PAWN && ((target & 0x70) === 0 || (target & 0x70) === 0x70)) {
        gained += PROMOTION_GAIN;
        onSquare = V[QUEEN];
    } else onSquare = V[t];
    SCRATCH[s] = 0;
}

/**
 * The static exchange value of the move in centipawns, for the side that makes it: what it takes, less what the
 * exchange on the target square costs it. A quiet move is valued by what it risks (0 or less); castling is 0. The
 * position is not changed.
 */
export function see(pos, m) {
    if (!prepare(pos, m)) return 0;
    GAINS[0] = firstGain;
    let n = 0;
    let side = firstSide;
    for (;;) {
        const s = nextCapturer(side);
        if (s < 0) break;
        capture(s);
        GAINS[++n] = gained;
        side ^= 1;
    }
    // each side captures again only when that is worth more than stopping
    let score = GAINS[n];
    for (let k = n - 1; k >= 0; k--) score = GAINS[k] - (score > 0 ? score : 0);
    return score;
}

/**
 * Is the static exchange value of the move at least the threshold? The same answer as see(pos, m) >= threshold, but
 * the exchange stops as soon as the outcome is settled.
 */
export function seeGe(pos, m, threshold) {
    if (!prepare(pos, m)) return threshold <= 0;
    let side = firstSide;
    // the side that made the last capture (took `taken`) needs the exchange from here to be worth at least `need` to it
    let need = threshold;
    let taken = firstGain;
    for (;;) {
        // the reply may cost it at most `room`; a negative room is lost already
        const room = taken - need;
        if (room < 0) return false;
        let s = nextCapturer(side);
        if (s < 0) return true;
        capture(s);
        side ^= 1;
        // the replier, having taken `gained`, is worth at most `room` to the other side; it must be recaptured for more than
        // gained - room to be a bad idea, and when that is no more than nothing the replier simply does not recapture
        need = gained - room;
        if (need <= 0) return true;
        s = nextCapturer(side);
        if (s < 0) return false;
        capture(s);
        side ^= 1;
        taken = gained;
    }
}
