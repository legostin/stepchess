// puzzles/mate — solveMate: an exact AND-OR proof search for a forced mate in n moves over every defence.
//
// The side to move (the attacker) wins when it has a move after which every legal reply of the defender leaves it a mate in
// one move fewer; a move that mates ends the proof. Nothing is pruned that could change the answer: the last attacker move
// is tried among the checks only (a mate is a check), every other move of the attacker and every reply of the defender is
// tried, a stalemate or a drawn position ends a line without a win. What speeds the proof up is only its order (checks
// first, the reply that refuted the last sibling first) and a table of positions whose answer is known for some n.
// A proof too large for its node budget is reported as such and never guessed. Two things are out of the proof's sight: the
// repetition of a position (a mate of at most 5 moves does not need one) and the half-move clock when a position is reached
// by two routes (the table is keyed by the position, not by its clock; the clock matters only within 5 moves of 100).
import { msg } from '../i18n/index.js';
import { Position, F_CAPTURE, generateMoves, moveFlags, moveToUci, toSan, NO_MOVE } from '../core/index.js';
import { invalid, failure, budgetOf } from './result.js';

/** The longest mate solveMate looks for, in moves of the attacker. */
export const MAX_MATE = 5;
/** The default budget: positions visited by one proof. */
export const MATE_NODES = 6000000;
/** The largest budget an option may ask for. */
export const MAX_MATE_NODES = 20000000;

const FIFTY = 100; // half-moves without a capture or a pawn move after which the game is drawn

// thrown inside the proof when the budget is spent
const BUDGET = Symbol('budget');

class Prover {
    constructor(pos, budget) {
        this.pos = pos;
        this.budget = budget;
        this.nodes = 0;
        // positions with a known result: their 64-bit hash, then bits 0-2 the least n that wins, bits 3-5 the greatest n that fails
        // (one slot per hash, the newer position replaces the older one; a slot is used only when both halves of the hash match)
        const bits = Math.min(22, Math.max(12, Math.ceil(Math.log2(budget)) + 1));
        this.mask = (1 << bits) - 1;
        this.keyLo = new Int32Array(1 << bits);
        this.keyHi = new Int32Array(1 << bits);
        this.known = new Uint8Array(1 << bits);
        this.gen = [];
        this.kind = [];
        this.killer = new Int32Array(MAX_MATE + 1); // the reply that refuted the last sibling, by moves left
    }

    buffers(level) {
        return (this.gen[level] ??= new Int32Array(256));
    }

    // can the side to move force mate within k of its own moves?
    attack(k, level) {
        if (++this.nodes > this.budget) throw BUDGET;
        const pos = this.pos;
        const slot = pos.hashLo & this.mask;
        const same = this.keyLo[slot] === pos.hashLo && this.keyHi[slot] === pos.hashHi;
        const known = same ? this.known[slot] : 0;
        const wins = known & 7;
        const fails = (known >> 3) & 7;
        if (wins && wins <= k) return true;
        if (k <= fails) return false;
        const ok = this.tryMoves(k, level);
        this.keyLo[slot] = pos.hashLo;
        this.keyHi[slot] = pos.hashHi;
        this.known[slot] = ok ? (!wins || k < wins ? k : wins) | (fails << 3) : wins | (Math.max(fails, k) << 3);
        return ok;
    }

    tryMoves(k, level) {
        const pos = this.pos;
        const moves = this.buffers(level);
        const n = generateMoves(pos, moves);
        const kind = (this.kind[level] ??= new Uint8Array(256)); // 0 gives check, 1 captures, 2 quiet
        for (let i = 0; i < n; i++) {
            pos.make(moves[i]);
            kind[i] = pos.inCheck() ? 0 : moveFlags(moves[i]) & F_CAPTURE ? 1 : 2;
            pos.unmake();
        }
        // the last move of the attacker has to be a check: nothing else mates
        for (let pass = 0; pass < (k === 1 ? 1 : 3); pass++) {
            for (let i = 0; i < n; i++) {
                if (kind[i] !== pass) continue;
                pos.make(moves[i]);
                const ok = this.reply(k, level + 1);
                pos.unmake();
                if (ok) return true;
            }
        }
        return false;
    }

    // after an attacker move with k moves left: has the defender no answer? (mated, or every reply loses to a mate in k - 1)
    reply(k, level) {
        if (++this.nodes > this.budget) throw BUDGET;
        const pos = this.pos;
        const moves = this.buffers(level);
        const n = generateMoves(pos, moves);
        if (n === 0) return pos.inCheck(); // checkmate wins, stalemate does not
        if (k === 1 || pos.halfmove >= FIFTY || pos.isInsufficientMaterial()) return false;
        // the reply that refuted the previous sibling first, then captures, then the rest
        const killer = this.killer[k];
        let seen = false;
        if (killer !== NO_MOVE) {
            for (let i = 0; i < n; i++) {
                if (moves[i] !== killer) continue;
                seen = true;
                if (!this.answer(moves[i], k, level)) return false;
                break;
            }
        }
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < n; i++) {
                const m = moves[i];
                if ((moveFlags(m) & F_CAPTURE ? 0 : 1) !== pass || (seen && m === killer)) continue;
                if (!this.answer(m, k, level)) return false;
            }
        }
        return true;
    }

    // does the attacker still mate within k - 1 after this reply? A reply that does not is remembered as the killer.
    answer(m, k, level) {
        const pos = this.pos;
        pos.make(m);
        const ok = this.attack(k - 1, level + 1);
        pos.unmake();
        if (!ok) this.killer[k] = m;
        return ok;
    }
}

// the legal moves of a position as an array
function legal(pos) {
    const out = new Int32Array(256);
    return Array.from(out.subarray(0, generateMoves(pos, out)));
}

// the shortest mate (in attacker moves, at most max) from the position after a move of the attacker; 0 when there is none
function distanceAfter(prover, m, max) {
    const pos = prover.pos;
    pos.make(m);
    let d = 0;
    for (let k = 1; k <= max && !d; k++) if (prover.reply(k, 1)) d = k;
    pos.unmake();
    return d;
}

// the best line from the first move: the defender delays the mate as long as it can, the attacker mates as fast as it can
function lineFrom(prover, first, distance) {
    const pos = prover.pos;
    const moves = [first];
    pos.make(first);
    let left = distance - 1; // moves the attacker still has
    for (;;) {
        const replies = legal(pos);
        if (replies.length === 0) break;
        // the reply after which the mate is farthest away (ties: the first by its UCI text)
        let far = null;
        for (const r of replies) {
            pos.make(r);
            let d = 0;
            for (let k = 1; k <= left && !d; k++) if (prover.attack(k, 1)) d = k;
            pos.unmake();
            if (far === null || d > far.d || (d === far.d && moveToUci(r) < moveToUci(far.m))) far = { m: r, d };
        }
        moves.push(far.m);
        pos.make(far.m);
        // the fastest mate of the attacker
        let fast = null;
        for (const a of legal(pos)) {
            const d = distanceAfter(prover, a, far.d);
            if (d && (fast === null || d < fast.d || (d === fast.d && moveToUci(a) < moveToUci(fast.m)))) fast = { m: a, d };
        }
        moves.push(fast.m);
        pos.make(fast.m);
        left = fast.d - 1;
    }
    for (let i = 0; i < moves.length; i++) pos.unmake();
    return moves;
}

/**
 * The first moves that force mate within n moves of a position (left as it was): [{move, distance}] by distance, then by UCI text,
 * where distance is the length of the move's own forced mate. Throws nothing on the budget: null means the proof did not fit.
 * @param {Position} position
 * @param {number} n 1..MAX_MATE
 * @param {number} budget positions the proof may visit
 */
export function mateKeys(position, n, budget) {
    const pos = position.clone(); // the proof works on its own copy: a spent budget leaves it deep in a line
    const prover = new Prover(pos, budget);
    try {
        const keys = [];
        for (const m of legal(pos)) {
            pos.make(m);
            const ok = prover.reply(n, 1);
            pos.unmake();
            if (ok) keys.push({ move: m, distance: distanceAfter(prover, m, n) });
        }
        keys.sort((a, b) => a.distance - b.distance || (moveToUci(a.move) < moveToUci(b.move) ? -1 : 1));
        return { keys, prover };
    } catch (e) {
        if (e === BUDGET) return null;
        throw e;
    }
}

/**
 * Every first move that forces mate within n moves, found by an exhaustive search over all defences.
 * n is a whole number from 1 to 5. The result lists the first moves (UCI) by the length of their mate, then by text, with the
 * same moves in SAN as solutionsSan and the length of each mate in moves of the attacker as distances, and the line of best play
 * for the shortest one: the defender delays the mate as long as it can and the attacker mates as fast as it can; distance is the
 * length of that mate. No mate within n moves (also a position with no legal move) gives {ok: true, kind: 'none'}. options.nodes
 * caps the proof (positions visited, at most 20 million); a proof that does not fit is reported as
 * {ok: false, kind: 'invalid', code: 'limit'}.
 * @param {string} fen
 * @param {number} n
 * @param {{nodes?: number}} [options]
 * @returns {{ok: true, kind: 'mate', n: number, distance: number, solutions: string[], solutionsSan: string[], distances: number[],
 *   line: string[], lineSan: string[]} | {ok: true, kind: 'none'} | {ok: false, kind: 'invalid', code: string, reason: import('../i18n/index.js').Msg}}
 */
export function solveMate(fen, n, options = {}) {
    try {
        if (!Number.isInteger(n) || n < 1) return invalid('arg', msg('puzzles.mate.n'));
        if (n > MAX_MATE) return invalid('limit', msg('puzzles.mate.max', { max: MAX_MATE }));
        const budget = budgetOf(options?.nodes, MATE_NODES, MAX_MATE_NODES);
        const pos = Position.fromFen(fen);
        const proof = mateKeys(pos, n, budget);
        if (proof === null) return invalid('limit', msg('puzzles.mate.budget', { nodes: budget }));
        const { keys, prover } = proof;
        if (keys.length === 0) return { ok: true, kind: 'none' };
        let line;
        try {
            line = lineFrom(prover, keys[0].move, keys[0].distance);
        } catch (e) {
            if (e === BUDGET) return invalid('limit', msg('puzzles.mate.budget', { nodes: budget }));
            throw e;
        }
        const copy = pos.clone();
        const lineSan = line.map((m) => {
            const text = toSan(copy, m);
            copy.make(m);
            return text;
        });
        return {
            ok: true,
            kind: 'mate',
            n,
            distance: keys[0].distance,
            solutions: keys.map((k) => moveToUci(k.move)),
            solutionsSan: keys.map((k) => toSan(pos, k.move)),
            distances: keys.map((k) => k.distance),
            line: line.map((m) => moveToUci(m)),
            lineSan,
        };
    } catch (e) {
        return failure(e, msg('puzzles.mate.internal'));
    }
}
