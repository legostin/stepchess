// eval/evaluate — the evaluation: the shared data of a position, the terms in order, the pawn hash, the tapered and scaled score, and the trace.
//
// evaluate(pos) and trace(pos) run the same function over the same terms; only the tracer differs. evaluate keeps two
// sums and reads the pawn structure from the pawn hash; trace computes it afresh and keeps every term with its squares.
// The score tapers between the middlegame and endgame sums by the phase (24 with all the pieces, 0 with none) and is
// multiplied by the endgame scale. Nothing is allocated on the fast path: the shared data lives in typed arrays here.
import { Position, PAWN, KING } from '../core/index.js';
import { TERMS, PHASE, MAX_PHASE, SCALE_ONE, KING_ATTACK_MG, KING_ATTACK_EG, applyWeights } from './params.js';
import { W } from './weights.js';
import { FastTracer, TraceTracer } from './tracer.js';
import { material } from './terms/material.js';
import { pst, mobility, pieceFeatures } from './terms/pieces.js';
import { pawnStructure, passedPawns } from './terms/pawns.js';
import { kingSafety, kingActivity } from './terms/king.js';
import { threats } from './terms/threats.js';
import { centerControl, space } from './terms/space.js';
import { kbnkCorner, scaleOf } from './terms/endgame.js';

applyWeights(W);

const KNIGHT_STEPS = Int8Array.of(33, 31, 18, 14, -14, -18, -31, -33);
const KING_STEPS = Int8Array.of(16, -16, 1, -1, 17, 15, -15, -17);
// rook directions 0..3, bishop directions 4..7
const DIRS = Int8Array.of(16, -16, 1, -1, 17, 15, -15, -17);

// the king distance between two squares a and b, at [a - b + 119]: a 0x88 difference tells the file and rank steps apart
const DIST = new Int8Array(239);
for (let a = 0; a < 120; a++)
    for (let b = 0; b < 120; b++) if (!((a | b) & 0x88)) DIST[a - b + 119] = Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 4) - (b >> 4)));

/**
 * The data the terms share, built once per call by prepare. Squares are 0x88 indices; [color << 7 | sq] indexes the
 * per-square arrays.
 */
// the per-call counters live in one buffer, cleared with one fill
const COUNTERS = new Uint8Array(256 + 256 + 16 + 4);
const ctx = {
    /** The number of pieces of a color attacking each square (pawns, pieces and the king). */
    att: COUNTERS.subarray(0, 256),
    /** The number of pawns of a color attacking each square. */
    patt: COUNTERS.subarray(256, 512),
    /** The pawn files: [color * 8 + file], a bit per rank that holds a pawn of the color. */
    pf: COUNTERS.subarray(512, 528),
    /** Pawns fixed by an enemy piece or pawn right in front, by [color * 2 + square color (0 dark)]. */
    blocked: COUNTERS.subarray(528, 532),
    /** Every piece on the board: nAll squares. */
    all: new Int16Array(32),
    nAll: 0,
    /** The knights, bishops, rooks and queens: n squares, with the squares each reaches (mob) and the enemy pieces it hits. */
    list: new Int16Array(32),
    n: 0,
    mob: new Uint8Array(32),
    targets: new Int16Array(32 * 8),
    targetCount: new Uint8Array(32),
    /** Per color: how many of its pieces reach the enemy king's zone, their summed weights and their squares. */
    kingAttackers: new Int32Array(2),
    kingAttackMg: new Int32Array(2),
    kingAttackEg: new Int32Array(2),
    kingAttackSquares: new Int16Array(32),
    /** The passed pawns: per color 4 bits per file with the passer's rank (pawnStructure fills it, or the pawn hash). */
    passed: new Int32Array(2),
    /** The king distance table, at [a - b + 119]. */
    dist: DIST,
    /** The phase: 0 (no pieces) … 24. */
    phase: 0,
    /** The term that scaled the score, or -1 (scaleOf sets it). */
    scaleKey: -1,
};

// what the board holds and what each piece attacks
function prepare(pos) {
    const b = pos.board;
    const att = ctx.att;
    const patt = ctx.patt;
    const pf = ctx.pf;
    const all = ctx.all;
    const list = ctx.list;
    const counts = pos.counts;
    const blocked = ctx.blocked;
    COUNTERS.fill(0);
    let n = 0;
    let nAll = 0;
    for (let sq = 0; sq < 120; sq++) {
        if (sq & 8) {
            sq += 7;
            continue;
        }
        const p = b[sq];
        if (!p) continue;
        all[nAll++] = sq;
        const c = p >> 3;
        const type = p & 7;
        const o = c << 7;
        if (type === PAWN) {
            pf[(c << 3) | (sq & 7)] |= 1 << (sq >> 4);
            const up = c ? sq - 16 : sq + 16;
            if (((up - 1) & 0x88) === 0) {
                patt[o + up - 1]++;
                att[o + up - 1]++;
            }
            if (((up + 1) & 0x88) === 0) {
                patt[o + up + 1]++;
                att[o + up + 1]++;
            }
            if (b[up] && b[up] >> 3 !== c) blocked[c * 2 + (((sq >> 4) + sq) & 1)]++;
        } else if (type === KING) {
            for (let d = 0; d < 8; d++) {
                const s = sq + KING_STEPS[d];
                if ((s & 0x88) === 0) att[o + s]++;
            }
        } else list[n++] = sq;
    }
    ctx.n = n;
    ctx.nAll = nAll;

    const ka = ctx.kingAttackers;
    const kaMg = ctx.kingAttackMg;
    const kaEg = ctx.kingAttackEg;
    ka[0] = ka[1] = kaMg[0] = kaMg[1] = kaEg[0] = kaEg[1] = 0;
    const targets = ctx.targets;
    const k0 = pos.kings[0];
    const k1 = pos.kings[1];
    for (let i = 0; i < n; i++) {
        const sq = list[i];
        const p = b[sq];
        const c = p >> 3;
        const type = p & 7;
        const o = c << 7;
        const eo = o ^ 128;
        const ek = (c ? k0 : k1) - 119;
        let mob = 0;
        let zone = 0;
        let nt = 0;
        const tb = i << 3;
        if (type === 2) {
            for (let d = 0; d < 8; d++) {
                const s = sq + KNIGHT_STEPS[d];
                if (s & 0x88) continue;
                att[o + s]++;
                if (DIST[s - ek] <= 1) zone++;
                const q = b[s];
                if (q === 0) {
                    if (!patt[eo + s]) mob++;
                } else if (q >> 3 !== c) {
                    if (!patt[eo + s]) mob++;
                    targets[tb + nt++] = s;
                }
            }
        } else {
            const d1 = type === 4 ? 4 : 8;
            for (let d = type === 3 ? 4 : 0; d < d1; d++) {
                const step = DIRS[d];
                for (let s = sq + step; (s & 0x88) === 0; s += step) {
                    att[o + s]++;
                    if (DIST[s - ek] <= 1) zone++;
                    const q = b[s];
                    if (q === 0) {
                        if (!patt[eo + s]) mob++;
                        continue;
                    }
                    if (q >> 3 !== c) {
                        if (!patt[eo + s]) mob++;
                        targets[tb + nt++] = s;
                    }
                    break;
                }
            }
        }
        ctx.mob[i] = mob;
        ctx.targetCount[i] = nt;
        if (zone) {
            ctx.kingAttackSquares[(c << 4) + ka[c]] = sq;
            ka[c]++;
            kaMg[c] += KING_ATTACK_MG[type];
            kaEg[c] += KING_ATTACK_EG[type];
        }
    }

    const phase =
        PHASE[2] * (counts[2] + counts[10]) + PHASE[3] * (counts[3] + counts[11]) + PHASE[4] * (counts[4] + counts[12]) + PHASE[5] * (counts[5] + counts[13]);
    ctx.phase = phase > MAX_PHASE ? MAX_PHASE : phase;
}

// ---------------------------------------------------------------- the pawn hash

const PAWN_HASH_SIZE = 1 << 14;
const PAWN_HASH_MASK = PAWN_HASH_SIZE - 1;
// an empty entry has the key 0:0 and holds zeros — exactly the pawn structure of a position without pawns
const phLo = new Int32Array(PAWN_HASH_SIZE);
const phHi = new Int32Array(PAWN_HASH_SIZE);
const phMg = new Int32Array(PAWN_HASH_SIZE);
const phEg = new Int32Array(PAWN_HASH_SIZE);
const phPassedW = new Int32Array(PAWN_HASH_SIZE);
const phPassedB = new Int32Array(PAWN_HASH_SIZE);

// the pawn structure through the cache (fast tracer only: the entry holds its net sums, not the terms)
function cachedPawns(pos, t) {
    const lo = pos.pawnHashLo;
    const hi = pos.pawnHashHi;
    const i = lo & PAWN_HASH_MASK;
    if (phLo[i] === lo && phHi[i] === hi) {
        t.mg += phMg[i];
        t.eg += phEg[i];
        ctx.passed[0] = phPassedW[i];
        ctx.passed[1] = phPassedB[i];
        return;
    }
    const mg = t.mg;
    const eg = t.eg;
    pawnStructure(pos, t, ctx);
    phLo[i] = lo;
    phHi[i] = hi;
    phMg[i] = t.mg - mg;
    phEg[i] = t.eg - eg;
    phPassedW[i] = ctx.passed[0];
    phPassedB[i] = ctx.passed[1];
}

/** Empty the pawn hash (after the weights change). */
export function clearPawnHash() {
    for (const a of [phLo, phHi, phMg, phEg, phPassedW, phPassedB]) a.fill(0);
}

/** Evaluate with other weights from now on (the tuner): fills the compiled tables and empties the pawn hash. */
export function setWeights(w) {
    applyWeights(w);
    clearPawnHash();
}

// ---------------------------------------------------------------- the score

// every term, in order; the pawn structure from the cache or afresh
function run(pos, t, cached) {
    prepare(pos);
    material(pos, t, ctx);
    pst(pos, t, ctx);
    mobility(pos, t, ctx);
    pieceFeatures(pos, t, ctx);
    if (cached) cachedPawns(pos, t);
    else pawnStructure(pos, t, ctx);
    passedPawns(pos, t, ctx);
    kingSafety(pos, t, ctx);
    kingActivity(pos, t, ctx);
    threats(pos, t, ctx);
    centerControl(pos, t, ctx);
    space(pos, t, ctx);
    kbnkCorner(pos, t, ctx);
}

const FAST = new FastTracer();
const PHASE_SCALE = MAX_PHASE * SCALE_ONE;

// the end of every evaluation, fast or traced: the tapered sum, the endgame scale, and the total from White's side
const RESULT = { tapered: 0, scale: SCALE_ONE, total: 0 };
function finish(pos, t) {
    const phase = ctx.phase;
    const tapered = t.mg * phase + t.eg * (MAX_PHASE - phase);
    const scale = scaleOf(pos, ctx, tapered >= 0 ? 0 : 1);
    RESULT.tapered = tapered;
    RESULT.scale = scale;
    RESULT.total = (tapered * scale) / PHASE_SCALE;
    return RESULT;
}

/** The evaluation in centipawns from the side to move's point of view: the trace's total rounded half away from zero. */
export function evaluate(pos) {
    const t = FAST;
    t.mg = 0;
    t.eg = 0;
    run(pos, t, true);
    // half away from zero, so that the mirrored board gets the same score
    const x = finish(pos, t).total;
    const v = x < 0 ? -Math.round(-x) : Math.round(x);
    return pos.side === 0 ? v | 0 : -v | 0;
}

/**
 * @typedef {{key: string, group: string, white: number, black: number, value: number, squares: number[]}} TraceTerm
 * @typedef {{total: number, phase: number, scale: number, terms: TraceTerm[]}} Trace
 */

/**
 * The evaluation explained, from White's point of view: the total in centipawns (evaluate is its rounding, with the sign
 * of the side to move), the phase (0..24), the endgame scale (0..1), and the terms that have a number for either color,
 * the largest |value| first. white and black are each color's tapered contribution (a bonus positive, a penalty
 * negative), value = white − black, and squares the 0x88 squares involved. The terms add up to the total: when the
 * scale is below 1, the endgame term that set it (opposite-bishops, wrong-bishop, fortress) holds what the scaling took
 * away, against the side that was ahead. Takes a Position or a FEN.
 * @param {Position | string} pos
 * @returns {Trace}
 */
export function trace(pos) {
    if (typeof pos === 'string') pos = Position.fromFen(pos);
    const t = new TraceTracer();
    run(pos, t, false);
    const { tapered, scale, total } = finish(pos, t);
    const phase = ctx.phase;
    const rest = MAX_PHASE - phase;
    const terms = [];
    for (let k = 0; k < TERMS.length; k++) {
        let white = 0;
        let black = 0;
        if (t.touched(k)) {
            white = (t.termMg[k * 2] * phase + t.termEg[k * 2] * rest) / MAX_PHASE;
            black = (t.termMg[k * 2 + 1] * phase + t.termEg[k * 2 + 1] * rest) / MAX_PHASE;
        }
        if (k === ctx.scaleKey && scale !== SCALE_ONE) {
            const lost = total - tapered / MAX_PHASE;
            if (lost < 0) black -= lost;
            else white += lost;
        }
        if (white === 0 && black === 0) continue;
        const squares = [...t.squares[k]].sort((a, b) => a - b);
        terms.push({ key: TERMS[k].key, group: TERMS[k].group, white, black, value: white - black, squares });
    }
    terms.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return { total, phase, scale: scale / SCALE_ONE, terms };
}
