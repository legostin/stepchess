// search/order — move ordering: the scores that put the hash move, good captures, promotions, killers, the counter-move, history and bad captures in turn; the pick; givesCheck.
//
// Every move gets one integer; the bands keep the classes apart and the numbers inside a band sort within it:
//   hash move · good captures (MVV-LVA, SEE ≥ 0) and queen promotions · killers · counter-move · quiet moves by history
//   · bad captures · under-promotions.
// The search picks the best remaining move each time (a selection sort that usually stops after a few picks).
import { F_CAPTURE, F_EP, F_CASTLE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, SEE_VALUES, seeGe } from '../core/index.js';

export const SCORE_TT = 1 << 30;
export const SCORE_GOOD = 1 << 28;
export const SCORE_KILLER1 = (1 << 27) + 2;
export const SCORE_KILLER2 = (1 << 27) + 1;
export const SCORE_COUNTER = 1 << 27;
export const SCORE_BAD = -(1 << 28);
export const SCORE_UNDER = -(1 << 29);

/** The history scores stay within ±HISTORY_MAX (the gravity formula pulls them back). */
export const HISTORY_MAX = 16384;

const V = new Int32Array(SEE_VALUES);

/** The value of a move's victim (a pawn for en passant, 0 for a quiet move). */
export const victimValue = (board, m) => ((m >> 17) & F_EP ? V[PAWN] : V[board[(m >> 7) & 127] & 7]);

/** The history index of a move for the side: side, from and to. */
export const historyIndex = (side, m) => (side << 14) | (m & 16383);

/**
 * Score n moves for the side to move. killers and counter are moves (0 for none); history is indexed by historyIndex.
 * SEE is consulted only for a capture whose victim is worth less than its attacker.
 */
export function scoreMoves(pos, moves, scores, n, ttMove, killer1, killer2, counter, history) {
    const b = pos.board;
    const side = pos.side << 14;
    for (let i = 0; i < n; i++) {
        const m = moves[i];
        if (m === ttMove) {
            scores[i] = SCORE_TT;
            continue;
        }
        const flags = (m >> 17) & 15;
        const promo = (m >> 14) & 7;
        if (promo && promo !== QUEEN) {
            scores[i] = SCORE_UNDER + promo;
            continue;
        }
        if (flags & F_CAPTURE || promo) {
            const victim = flags & F_EP ? V[PAWN] : V[b[(m >> 7) & 127] & 7];
            const attacker = b[m & 127] & 7;
            const mvvlva = victim * 8 + (promo ? V[QUEEN] : 0) - attacker;
            const good = (victim >= V[attacker] && !promo) || seeGe(pos, m, 0);
            scores[i] = (good ? SCORE_GOOD : SCORE_BAD) + mvvlva;
            continue;
        }
        if (m === killer1) scores[i] = SCORE_KILLER1;
        else if (m === killer2) scores[i] = SCORE_KILLER2;
        else if (m === counter) scores[i] = SCORE_COUNTER;
        else scores[i] = history[side | (m & 16383)];
    }
}

/** Bring the best-scored move of [start, n) to start and return it. */
export function pickNext(moves, scores, start, n) {
    let best = start;
    let bs = scores[start];
    for (let i = start + 1; i < n; i++) {
        if (scores[i] > bs) {
            bs = scores[i];
            best = i;
        }
    }
    if (best !== start) {
        const m = moves[best];
        moves[best] = moves[start];
        moves[start] = m;
        scores[best] = scores[start];
        scores[start] = bs;
    }
    return moves[start];
}

/** Add a bonus (negative: a malus) to a history entry, pulled toward 0 the larger it is. */
export function updateHistory(history, index, bonus) {
    const h = history[index];
    const abs = bonus < 0 ? -bonus : bonus;
    history[index] = (h + bonus - (h * abs) / HISTORY_MAX) | 0;
}

// ---------------------------------------------------------------- givesCheck

// at [b - a + 119] for two squares a, b on a line: the step from a toward b, and the line (1 a rank or file, 2 a diagonal)
const STEP = new Int8Array(240);
const LINE = new Uint8Array(240);
const KNIGHT_HIT = new Uint8Array(240);
for (let a = 0; a < 120; a++) {
    if (a & 0x88) continue;
    for (let b = 0; b < 120; b++) {
        if (b & 0x88 || a === b) continue;
        const df = (b & 7) - (a & 7);
        const dr = (b >> 4) - (a >> 4);
        const k = b - a + 119;
        if (df === 0 || dr === 0 || Math.abs(df) === Math.abs(dr)) {
            STEP[k] = Math.sign(dr) * 16 + Math.sign(df);
            LINE[k] = df === 0 || dr === 0 ? 1 : 2;
        }
        if ((Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1)) KNIGHT_HIT[k] = 1;
    }
}

/**
 * Does the legal move give check? Direct checks by the moved (or promoted) piece and discovered checks are read off
 * the board; castling and en passant, rare and tricky, are made and tested.
 */
export function givesCheck(pos, m) {
    const flags = (m >> 17) & 15;
    if (flags & (F_CASTLE | F_EP)) {
        pos.make(m);
        const check = pos.inCheck();
        pos.unmake();
        return check;
    }
    const b = pos.board;
    const from = m & 127;
    const to = (m >> 7) & 127;
    const promo = (m >> 14) & 7;
    const us = pos.side;
    const ksq = pos.kings[us ^ 1];
    const t = promo || b[from] & 7;
    // direct
    if (t === PAWN) {
        const ahead = to + (us === 0 ? 16 : -16);
        if (ksq === ahead - 1 || ksq === ahead + 1) return true;
    } else if (t === KNIGHT) {
        if (KNIGHT_HIT[ksq - to + 119]) return true;
    } else if (t !== KING) {
        const k = ksq - to + 119;
        const line = LINE[k];
        if (line !== 0 && (t === QUEEN || (t === ROOK && line === 1) || (t === BISHOP && line === 2))) {
            const d = STEP[k];
            let s = to + d;
            while (s !== ksq && (b[s] === 0 || s === from)) s += d;
            if (s === ksq) return true;
        }
    }
    // discovered: the piece leaves a line between the enemy king and a slider of ours
    const k = from - ksq + 119;
    const line = LINE[k];
    if (line === 0) return false;
    const d = STEP[k];
    if (STEP[to - ksq + 119] === d) return false;
    let s = ksq + d;
    while (s !== from) {
        if (b[s]) return false;
        s += d;
    }
    for (s += d; (s & 0x88) === 0; s += d) {
        const q = b[s];
        if (q) {
            const qt = q & 7;
            return q >> 3 === us && (qt === QUEEN || qt === (line === 1 ? ROOK : BISHOP));
        }
    }
    return false;
}
