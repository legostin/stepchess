// eval/tracer — where the terms put their numbers: a fast tracer that keeps two sums, and a trace tracer that keeps every term.
//
// Every term function has the signature (pos, t, ctx) → void and reports through t.add(key, color, mg, eg, sq = -1): the
// term id (its index in TERMS), the color the number belongs to (a bonus is positive, a penalty negative), the
// middlegame and endgame values in whole centipawns, and optionally the square involved. t.mark(key, color, sq) names a
// square without a number. t.detail is true only for the trace tracer, so a term may skip work that only names squares.
// Both tracers keep the same two sums (White minus Black), so the score and the trace come from one code path.
import { TERMS } from './params.js';

const N = TERMS.length;

/** The tracer of the search: the middlegame and endgame sums from White's side, nothing else. */
export class FastTracer {
    constructor() {
        this.mg = 0;
        this.eg = 0;
        this.detail = false;
    }

    add(key, color, mg, eg, sq = -1) {
        if (color === 0) {
            this.mg += mg;
            this.eg += eg;
        } else {
            this.mg -= mg;
            this.eg -= eg;
        }
    }

    mark(key, color, sq) {}
}

/** The tracer of the explanations: the same sums, and for every term each color's values and the squares named. */
export class TraceTracer {
    constructor() {
        this.mg = 0;
        this.eg = 0;
        this.detail = true;
        // [key * 2 + color]
        this.termMg = new Int32Array(N * 2);
        this.termEg = new Int32Array(N * 2);
        this.squares = Array.from({ length: N }, () => new Set());
    }

    add(key, color, mg, eg, sq = -1) {
        if (color === 0) {
            this.mg += mg;
            this.eg += eg;
        } else {
            this.mg -= mg;
            this.eg -= eg;
        }
        this.termMg[key * 2 + color] += mg;
        this.termEg[key * 2 + color] += eg;
        if (sq >= 0) this.squares[key].add(sq);
    }

    mark(key, color, sq) {
        this.squares[key].add(sq);
    }

    /** Has the term a number of either color? */
    touched(key) {
        const i = key * 2;
        return this.termMg[i] !== 0 || this.termEg[i] !== 0 || this.termMg[i + 1] !== 0 || this.termEg[i + 1] !== 0;
    }
}
