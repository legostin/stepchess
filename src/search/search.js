// search/search — the Searcher: iterative deepening with aspiration windows, PVS over a transposition table, quiescence, null move, LMR and pruning; multi-PV, limits, the result.
//
// Scores are centipawns for the side to move; a mate is MATE - ply (the side to move mates at that ply from the root)
// and a mate against it is -(MATE - ply). The search runs on a clone of the position, so the caller's position (with
// its game history: repetitions count from it) is never touched. Nothing is allocated below the root: the move lists,
// scores, principal variations, killers, history and counter-moves live in typed arrays made with the Searcher.
//
// Only depth and nodes limits (and no stop callback) make the result a function of the position and the table: time is
// read only when a time limit is given. Each search starts with fresh killers, history and counter-moves; the
// transposition table carries over between searches, so clear() it to reproduce a search from a clean state.
import { NO_MOVE, F_CAPTURE, KNIGHT, BISHOP, ROOK, QUEEN, MAX_PLY, generateMoves, see, seeGe } from '../core/index.js';
import { evaluate } from '../eval/index.js';
import { MAX_PIECES } from '../endgame/index.js';
import { TT, BOUND_UPPER, BOUND_LOWER, BOUND_EXACT, NO_EVAL } from './tt.js';
import { scoreMoves, pickNext, updateHistory, givesCheck, victimValue, SCORE_GOOD, SCORE_COUNTER } from './order.js';
import { allocate } from './time.js';

/** The score of a mate at the root: a mate at ply p is MATE - p. */
export const MATE = 32000;
/** Scores at least this far from 0 are mates (or table wins counted in plies). */
export const MATE_BOUND = MATE - 1000;
const INF = MATE + 1;
/** The deepest iteration. */
export const MAX_DEPTH = 64;
/** The deepest ply a search reaches (the extensions and quiescence included). */
export const MAX_SEARCH_PLY = 128;
/** The node budget of a search given no limit at all. */
export const DEFAULT_NODES = 1000000;

const EVAL_LIMIT = MATE_BOUND - 1;
const P = MAX_SEARCH_PLY + 4; // rows of the per-ply arrays
const QUIETS = 64; // quiet moves remembered per ply for the history malus

/**
 * Is the score a mate (for either side)?
 * @param {number} s
 * @returns {boolean}
 */
export const isMateScore = (s) => (s >= MATE_BOUND && s <= MATE) || (s <= -MATE_BOUND && s >= -MATE);

/**
 * The mate in moves a score means: +n the side to move mates in n, -n it is mated in n, 0 it is mated now; null for no mate.
 * @param {number} s
 * @returns {number | null}
 */
export function mateIn(s) {
    if (!isMateScore(s)) return null;
    return s > 0 ? (MATE - s + 1) >> 1 : -((MATE + s + 1) >> 1) || 0;
}

// mate scores in the table count from the node, not the root
const toTT = (s, ply) => (s >= MATE_BOUND ? s + ply : s <= -MATE_BOUND ? s - ply : s);
const fromTT = (s, ply) => (s >= MATE_BOUND ? s - ply : s <= -MATE_BOUND ? s + ply : s);

// reductions by depth and move number: 0.75 + ln d · ln n / 2.25
const LMR = new Int8Array(64 * 64);
for (let d = 1; d < 64; d++) for (let n = 1; n < 64; n++) LMR[d * 64 + n] = Math.floor(0.75 + (Math.log(d) * Math.log(n)) / 2.25);
// late move pruning: the quiet moves tried at depth d (≤ 4) before the rest are skipped, by [improving][d]
const LMP = [new Int32Array(5), new Int32Array(5)];
for (let d = 1; d <= 4; d++) {
    LMP[0][d] = Math.floor((3 + d * d) / 2);
    LMP[1][d] = 3 + d * d;
}
// futility margins by depth (≤ 3)
const FUTILITY = Int32Array.of(0, 200, 310, 420);

// a table hit as a score: a win in n moves is a mate n moves away (ply + 2n - 1), a loss in n moves one at ply + 2n
function tableScore(v, ply) {
    if (!v || typeof v !== 'object') return null;
    const dtm = Number.isFinite(v.dtm) ? Math.abs(Math.trunc(v.dtm)) : 0;
    if (v.wdl > 0) return Math.max(MATE_BOUND, MATE - ply - 2 * Math.max(1, dtm) + 1);
    if (v.wdl < 0) return Math.min(-MATE_BOUND, -MATE + ply + 2 * dtm);
    if (v.wdl === 0) return 0;
    return null;
}

const clampEval = (v) => (v > EVAL_LIMIT ? EVAL_LIMIT : v < -EVAL_LIMIT ? -EVAL_LIMIT : v);

// a positive integer limit, or the fallback
const positive = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : fallback);

/**
 * @typedef {{move: number, score: number, mate: number | null, pv: number[]}} SearchLine
 * @typedef {'depth' | 'nodes' | 'time' | 'stop' | 'single' | 'terminal' | 'history'} StopReason
 *   Why the search ended: the depth limit (or the deepest iteration), the node budget, the clock, the stop callback,
 *   a single legal move on the clock, no legal (or no allowed) root move, or a game history too long to make any move
 *   (a static choice at depth 0).
 * @typedef {{best: number, score: number, mate: number | null, depth: number, seldepth: number, nodes: number,
 *   timeMs: number, pv: number[], lines: SearchLine[], reason: StopReason}} SearchResult
 * @typedef {Omit<SearchResult, 'reason'> & {multipv: number, hashfull: number}} SearchInfo
 * @typedef {{depth?: number, nodes?: number, movetime?: number, wtime?: number, btime?: number, winc?: number,
 *   binc?: number, movestogo?: number, multipv?: number, stop?: () => boolean, onInfo?: (info: SearchInfo) => void,
 *   probe?: (pos: import('../core/index.js').Position) => ({wdl: number, dtm: number} | null), exclude?: number[]}} SearchLimits
 *   probe is asked about positions of at most MAX_PIECES pieces (kings included) without castling rights, never the
 *   root. It receives the search's own live Position: it may make and unmake moves on it but must leave it exactly as
 *   it found it, and must not keep it.
 */

export class Searcher {
    /** @param {{hashMb?: number}} [options] */
    constructor({ hashMb = 16 } = {}) {
        this.tt = new TT(hashMb);
        this.moveBuf = new Int32Array(P * 256);
        this.scoreBuf = new Int32Array(P * 256);
        this.moveLists = [];
        this.scoreLists = [];
        for (let i = 0; i < P; i++) {
            this.moveLists.push(this.moveBuf.subarray(i * 256, i * 256 + 256));
            this.scoreLists.push(this.scoreBuf.subarray(i * 256, i * 256 + 256));
        }
        this.quiets = new Int32Array(P * QUIETS);
        this.pvTable = new Int32Array(P * P);
        this.pvLen = new Int32Array(P);
        this.evals = new Int32Array(P);
        this.played = new Int32Array(P); // the move made at each ply (NO_MOVE for a null move)
        this.killers = new Int32Array(P * 2);
        this.history = new Int32Array(2 << 14);
        this.counters = new Int32Array(16 * 128);
        this.pos = null;
        this.nodes = 0;
        this.seldepth = 0;
        this.stopped = false;
        this.canStop = false;
        this.nodeLimit = Infinity;
        this.hardMs = Infinity;
        this.startMs = 0;
        this.stopFn = null;
        this.probeFn = null;
        this.maxPly = MAX_SEARCH_PLY;
        this.rootDepth = 0;
        this.nullPly = 0; // the null move is banned below this ply (during a verification search)
        this.rootPly = 0; // the history index of the root position
        this.stopReason = null; // why this.stopped was set: 'nodes', 'stop' or 'time'
        /** Null-move verification searches run by the last search (a statistic for tests and benchmarks). */
        this.verifications = 0;
    }

    /** Forget what earlier searches learnt: the table, the history, the killers and counter-moves. */
    clear() {
        this.tt.clear();
        this.history.fill(0);
        this.counters.fill(0);
        this.killers.fill(0);
    }

    /**
     * Search the position. Returns the best move and its score for the side to move, the depth reached, the
     * principal variation, and with multipv the best few root moves, best first. A position without legal moves
     * (or with all of them excluded) gives best NO_MOVE and no lines; its score is -MATE when checkmated, else 0.
     * @param {import('../core/index.js').Position} position
     * @param {SearchLimits} [limits]
     * @returns {SearchResult}
     */
    search(position, limits = {}) {
        const lim = limits && typeof limits === 'object' ? limits : {};
        this.startMs = Date.now();
        const pos = position.clone();
        this.pos = pos;
        this.nodes = 0;
        this.seldepth = 0;
        this.stopped = false;
        this.canStop = false;
        this.nullPly = 0;
        this.rootPly = pos.ply;
        this.stopReason = null;
        this.verifications = 0;
        this.history.fill(0);
        this.counters.fill(0);
        this.killers.fill(0);
        this.tt.newSearch();

        const maxDepthGiven = positive(lim.depth, 0);
        const nodesGiven = positive(lim.nodes, 0);
        this.stopFn = typeof lim.stop === 'function' ? lim.stop : null;
        this.probeFn = typeof lim.probe === 'function' ? lim.probe : null;
        const onInfo = typeof lim.onInfo === 'function' ? lim.onInfo : null;
        let softMs = Infinity;
        this.hardMs = Infinity;
        const movetime = positive(lim.movetime, 0);
        if (movetime) softMs = this.hardMs = movetime;
        else {
            const clock = allocate(lim, pos.side);
            if (clock) {
                softMs = clock.soft;
                this.hardMs = clock.hard;
            }
        }
        const timed = this.hardMs !== Infinity;
        this.nodeLimit = nodesGiven || (!maxDepthGiven && !timed && !this.stopFn ? DEFAULT_NODES : Infinity);
        // a node at ply p makes its moves (and the null move) at history index pos.ply + p, which must stay below
        // MAX_PLY; nodes at maxPly make none
        this.maxPly = Math.min(MAX_SEARCH_PLY, MAX_PLY - pos.ply);
        const maxDepth = Math.min(maxDepthGiven || MAX_DEPTH, this.maxPly - 1);

        // the root moves, the excluded ones left out
        const rootBuf = new Int32Array(256);
        const all = generateMoves(pos, rootBuf, false);
        const exclude = Array.isArray(lim.exclude) ? lim.exclude : [];
        const inCheck = pos.inCheck();
        const result = {
            best: NO_MOVE,
            score: all === 0 && inCheck ? -MATE : 0,
            mate: all === 0 && inCheck ? 0 : null,
            depth: 0,
            seldepth: 0,
            nodes: 0,
            timeMs: 0,
            pv: [],
            lines: [],
            reason: /** @type {StopReason} */ ('terminal'),
        };
        const roots = [];
        {
            const ttMove = this.tt.probe(pos.hashLo, pos.hashHi) ? this.tt.move : NO_MOVE;
            const scores = new Int32Array(256);
            scoreMoves(pos, rootBuf, scores, all, ttMove, 0, 0, 0, this.history);
            for (let i = 0; i < all; i++) {
                const m = rootBuf[i];
                if (!exclude.includes(m)) roots.push({ move: m, score: -INF, prev: -INF, order: scores[i], pv: [m] });
            }
            roots.sort((a, b) => b.order - a.order);
        }
        if (roots.length === 0) {
            result.timeMs = Date.now() - this.startMs;
            return result;
        }
        const multipv = Math.min(roots.length, positive(lim.multipv, 1));
        if (maxDepth < 1) {
            // the history is full: no move can be made, so the best-ordered move is played on a static estimate (the
            // eval, plus what a winning capture takes by SEE)
            const lines = [];
            for (let i = 0; i < multipv; i++) {
                const m = roots[i].move;
                const gain = (m >> 17) & F_CAPTURE || (m >> 14) & 7 ? see(pos, m) : 0;
                const score = inCheck ? 0 : clampEval(evaluate(pos) + (gain > 0 ? gain : 0));
                lines.push({ move: m, score, mate: null, pv: [m] });
            }
            lines.sort((a, b) => b.score - a.score);
            Object.assign(result, { best: lines[0].move, score: lines[0].score, pv: lines[0].pv.slice(), lines, reason: 'history' });
            result.timeMs = Date.now() - this.startMs;
            this.pos = null;
            return result;
        }
        this.roots = roots;

        let done = null; // the lines of the last completed depth
        /** @type {StopReason} */
        let reason = 'depth';
        for (let depth = 1; depth <= maxDepth; depth++) {
            this.rootDepth = depth;
            this.seldepth = 0;
            for (const r of roots) {
                r.prev = r.score;
                r.score = -INF;
            }
            for (let k = 0; k < multipv && !this.stopped; k++) {
                const prev = roots[k].prev;
                let delta = 25;
                let alpha = -INF;
                let beta = INF;
                if (depth >= 4 && prev > -MATE_BOUND && prev < MATE_BOUND) {
                    alpha = Math.max(-INF, prev - delta);
                    beta = Math.min(INF, prev + delta);
                }
                for (;;) {
                    // the moves not chosen yet start every pass of the line unscored: a score left by an earlier
                    // line's window, or by an earlier pass of this line's aspiration, must not sort above the best
                    // this pass completes (their order, from the last pass, is kept)
                    for (let i = k; i < roots.length; i++) roots[i].score = -INF;
                    const score = this.searchRoot(depth, alpha, beta, k);
                    sortFrom(roots, k);
                    if (this.stopped) break;
                    if (score <= alpha && alpha > -INF) {
                        beta = Math.min(INF, Math.floor((alpha + beta) / 2));
                        alpha = Math.max(-INF, score - delta);
                    } else if (score >= beta && beta < INF) {
                        beta = Math.min(INF, score + delta);
                    } else break;
                    delta *= 2;
                    if (delta > 1000) {
                        alpha = -INF;
                        beta = INF;
                    }
                }
                if (this.stopped) break;
                if (onInfo) {
                    const lines = snapshot(roots, k + 1);
                    lines.sort((a, b) => b.score - a.score);
                    onInfo(this.info(depth, roots[k], k + 1, lines));
                }
            }
            if (this.stopped) {
                reason = this.stopReason ?? 'stop';
                break;
            }
            // the lines best first (a later line may score above an earlier one by the search's instability)
            const top = roots.slice(0, multipv).sort((a, b) => b.score - a.score);
            for (let i = 0; i < multipv; i++) roots[i] = top[i];
            done = { depth, seldepth: this.seldepth, lines: snapshot(roots, multipv) };
            this.canStop = true;
            if (timed && Date.now() - this.startMs >= softMs) {
                reason = 'time';
                break;
            }
            if (timed && roots.length === 1) {
                reason = 'single';
                break;
            }
            if (this.nodes >= this.nodeLimit) {
                reason = 'nodes';
                break;
            }
        }

        // stopped by the hard time limit: a move of the unfinished iteration that already beat the previous best is
        // played instead (a root move gets a score only by being searched first or by raising alpha); the depth and
        // node limits and the stop callback keep the last completed depth
        if (this.stopReason === 'time' && multipv === 1 && roots[0].score > -INF && roots[0].move !== done.lines[0].move) done.lines = snapshot(roots, 1);
        const best = done.lines[0];
        result.best = best.move;
        result.score = best.score;
        result.mate = best.mate;
        result.pv = best.pv;
        result.lines = done.lines;
        result.depth = done.depth;
        result.seldepth = done.seldepth;
        result.nodes = this.nodes;
        result.timeMs = Date.now() - this.startMs;
        result.reason = reason;
        this.pos = null;
        this.roots = null;
        return result;
    }

    // the info object of a line
    info(depth, root, multipv, lines) {
        return {
            best: root.move,
            score: root.score,
            mate: mateIn(root.score),
            depth,
            seldepth: this.seldepth,
            nodes: this.nodes,
            timeMs: Date.now() - this.startMs,
            pv: root.pv.slice(),
            lines,
            multipv,
            hashfull: this.tt.hashfull(),
        };
    }

    // stop on the node budget at every node, on the clock and the callback every 1024 nodes
    checkLimits() {
        if (!this.canStop) return;
        if (this.nodes >= this.nodeLimit) {
            this.stopped = true;
            this.stopReason = 'nodes';
        } else if ((this.nodes & 1023) === 0) {
            if (this.stopFn && this.stopFn()) {
                this.stopped = true;
                this.stopReason = 'stop';
            } else if (this.hardMs !== Infinity && Date.now() - this.startMs >= this.hardMs) {
                this.stopped = true;
                this.stopReason = 'time';
            }
        }
    }

    // the root moves from index first (earlier ones are the lines already found at this depth)
    searchRoot(depth, alpha, beta, first) {
        const pos = this.pos;
        const roots = this.roots;
        let best = -INF;
        for (let i = first; i < roots.length; i++) {
            const r = roots[i];
            const m = r.move;
            const check = givesCheck(pos, m);
            pos.make(m);
            this.played[0] = m;
            this.nodes++;
            const newDepth = depth - 1 + (check ? 1 : 0);
            let score;
            if (i === first) score = -this.negamax(newDepth, -beta, -alpha, 1, false);
            else {
                score = -this.negamax(newDepth, -alpha - 1, -alpha, 1, true);
                if (score > alpha && score < beta) score = -this.negamax(newDepth, -beta, -alpha, 1, false);
            }
            pos.unmake();
            if (this.stopped) return best;
            if (i === first || score > alpha) {
                r.score = score | 0; // never -0
                const pv = [m];
                for (let j = 1; j < this.pvLen[1]; j++) pv.push(this.pvTable[P + j]);
                r.pv = pv;
            }
            if (score > best) best = score;
            if (score > alpha) {
                alpha = score;
                if (score >= beta) break;
            }
        }
        return best;
    }

    negamax(depth, alpha, beta, ply, cutNode) {
        if (depth <= 0) return this.qsearch(alpha, beta, ply, 0);
        const pos = this.pos;
        const pvNode = beta - alpha > 1;
        this.pvLen[ply] = ply;
        this.nodes++;
        this.checkLimits();
        if (this.stopped) return 0;
        if (ply > this.seldepth) this.seldepth = ply;

        // draws: a repetition, too little material, the fifty-move rule (unless this is checkmate)
        if (repeated(pos, this.rootPly) || pos.isInsufficientMaterial()) return 0;
        const inCheck = pos.inCheck();
        if (pos.halfmove >= 100) {
            if (!inCheck) return 0;
            return generateMoves(pos, this.moveLists[ply], false) === 0 ? -MATE + ply : 0;
        }
        if (ply >= this.maxPly) return inCheck ? 0 : clampEval(evaluate(pos));

        // mate distance pruning
        const mated = -MATE + ply;
        if (alpha < mated) alpha = mated;
        if (beta > MATE - ply - 1) beta = MATE - ply - 1;
        if (alpha >= beta) return alpha;

        // the table
        const tt = this.tt;
        const lo = pos.hashLo;
        const hi = pos.hashHi;
        let ttMove = NO_MOVE;
        let ttScore = 0;
        let ttBound = 0;
        let ttEval = NO_EVAL;
        if (tt.probe(lo, hi)) {
            ttMove = tt.move;
            ttScore = fromTT(tt.score, ply);
            ttBound = tt.bound;
            ttEval = tt.eval;
            if (!pvNode && tt.depth >= depth && pos.halfmove < 90) {
                if (ttBound === BOUND_EXACT || (ttBound === BOUND_LOWER && ttScore >= beta) || (ttBound === BOUND_UPPER && ttScore <= alpha)) return ttScore;
            }
        }

        // the endgame tables: an exact score
        if (this.probeFn !== null && pos.castling === 0 && pos.ply < MAX_PLY - 2 && pieceCount(pos) <= MAX_PIECES) {
            const v = tableScore(this.probeFn(pos), ply);
            if (v !== null) {
                tt.store(lo, hi, NO_MOVE, toTT(v, ply), Math.min(255, depth + 6), BOUND_EXACT, NO_EVAL);
                return v;
            }
        }

        // the static eval, and a better guess from the table's bound
        let staticEval = NO_EVAL;
        let est = 0;
        let improving = false;
        if (!inCheck) {
            staticEval = ttEval !== NO_EVAL ? ttEval : clampEval(evaluate(pos));
            est = staticEval;
            if (ttBound !== 0 && ttScore > -MATE_BOUND && ttScore < MATE_BOUND && ttBound & (ttScore > est ? BOUND_LOWER : BOUND_UPPER)) est = ttScore;
            improving = ply >= 2 && this.evals[ply - 2] !== NO_EVAL && staticEval > this.evals[ply - 2];
        }
        this.evals[ply] = staticEval;
        this.killers[(ply + 1) * 2] = NO_MOVE;
        this.killers[(ply + 1) * 2 + 1] = NO_MOVE;
        const us = pos.side;
        const pieces = hasPieces(pos, us);

        if (!pvNode && !inCheck) {
            // reverse futility: far enough above beta that a quiet move will not bring it down
            if (depth <= 6 && est - 80 * depth >= beta && est < MATE_BOUND) return est;
            // null move: passing still holds beta; never with only pawns, never twice running
            if (depth >= 2 && est >= beta && staticEval >= beta && pieces && ply >= this.nullPly && this.played[ply - 1] !== NO_MOVE && beta > -MATE_BOUND) {
                const R = 3 + ((depth / 6) | 0);
                pos.makeNull();
                this.played[ply] = NO_MOVE;
                let score = -this.negamax(depth - 1 - R, -beta, -beta + 1, ply + 1, !cutNode);
                pos.unmakeNull();
                if (this.stopped) return 0;
                if (score >= beta) {
                    if (score >= MATE_BOUND) score = beta;
                    if (depth < 10) return score;
                    // deep: verify without the null move near this node (zugzwang); a verification inside another
                    // keeps the outer ban where that reaches further, and the outer ban comes back afterwards
                    const saved = this.nullPly;
                    const ban = ply + (((depth - 1 - R) * 3) >> 2);
                    this.nullPly = ban > saved ? ban : saved;
                    this.verifications++;
                    const v = this.negamax(depth - 1 - R, beta - 1, beta, ply, false);
                    this.nullPly = saved;
                    if (this.stopped) return 0;
                    if (v >= beta) return score;
                }
            }
        }

        // no hash move where one is expected: search shallower (internal iterative reduction)
        if (depth >= 4 && ttMove === NO_MOVE && (pvNode || cutNode)) depth--;

        const moves = this.moveLists[ply];
        const scores = this.scoreLists[ply];
        const n = generateMoves(pos, moves, false);
        if (n === 0) return inCheck ? mated : 0;
        const prev = this.played[ply - 1];
        const prevTo = (prev >> 7) & 127;
        const counter = prev !== NO_MOVE ? this.counters[(pos.board[prevTo] << 7) | prevTo] : NO_MOVE;
        const k1 = this.killers[ply * 2];
        const k2 = this.killers[ply * 2 + 1];
        scoreMoves(pos, moves, scores, n, ttMove, k1, k2, counter, this.history);

        const origAlpha = alpha;
        let bestScore = -INF;
        let bestMove = NO_MOVE;
        let searched = 0;
        let quietCount = 0;
        let skipQuiets = false;
        const qBase = ply * QUIETS;
        const history = this.history;
        const sideIdx = us << 14;
        for (let i = 0; i < n; i++) {
            const m = pickNext(moves, scores, i, n);
            const capture = (m >> 17) & F_CAPTURE;
            const promo = (m >> 14) & 7;
            const quiet = !capture && !promo;
            const check = givesCheck(pos, m);
            const moveScore = scores[i];

            // pruning, once a move has been found that does not lose to a mate
            if (bestScore > -MATE_BOUND && pieces) {
                if (quiet) {
                    if (!check) {
                        if (skipQuiets) continue;
                        if (depth <= 4 && quietCount >= LMP[improving ? 1 : 0][depth]) {
                            skipQuiets = true;
                            continue;
                        }
                        if (depth <= 3 && !inCheck && staticEval + FUTILITY[depth] <= alpha) continue;
                        if (depth <= 6 && !seeGe(pos, m, -30 * depth * depth)) continue;
                    }
                } else if (depth <= 6 && !check && moveScore < SCORE_GOOD && !seeGe(pos, m, -100 * depth)) continue;
            }

            pos.make(m);
            this.played[ply] = m;
            searched++;
            const newDepth = depth - 1 + (check && ply < 2 * this.rootDepth ? 1 : 0);
            let score;
            if (searched === 1) score = -this.negamax(newDepth, -beta, -alpha, ply + 1, !pvNode && !cutNode);
            else {
                let r = 0;
                if (depth >= 3 && searched > (pvNode ? 2 : 1) && (quiet || moveScore < SCORE_GOOD)) {
                    r = LMR[(depth < 63 ? depth : 63) * 64 + (searched < 63 ? searched : 63)];
                    if (pvNode) r--;
                    if (check) r--;
                    if (moveScore >= SCORE_COUNTER) r--;
                    if (!improving) r++;
                    if (cutNode) r++;
                    if (quiet) r -= (history[sideIdx | (m & 16383)] / 6000) | 0;
                    if (r < 0) r = 0;
                    else if (r > newDepth - 1) r = newDepth > 1 ? newDepth - 1 : 0;
                }
                score = -this.negamax(newDepth - r, -alpha - 1, -alpha, ply + 1, true);
                if (score > alpha && r > 0) score = -this.negamax(newDepth, -alpha - 1, -alpha, ply + 1, !cutNode);
                if (pvNode && score > alpha && score < beta) score = -this.negamax(newDepth, -beta, -alpha, ply + 1, false);
            }
            pos.unmake();
            if (this.stopped) return 0;

            if (score > bestScore) {
                bestScore = score;
                if (score > alpha) {
                    bestMove = m;
                    if (pvNode) {
                        const row = ply * P;
                        const child = (ply + 1) * P;
                        const len = this.pvLen[ply + 1];
                        this.pvTable[row + ply] = m;
                        for (let j = ply + 1; j < len; j++) this.pvTable[row + j] = this.pvTable[child + j];
                        this.pvLen[ply] = len > ply + 1 ? len : ply + 1;
                    }
                    if (score >= beta) {
                        if (quiet) this.reward(m, ply, depth, prev, prevTo, quietCount, qBase);
                        break;
                    }
                    alpha = score;
                }
            }
            if (quiet && quietCount < QUIETS) this.quiets[qBase + quietCount++] = m;
        }

        const bound = bestScore >= beta ? BOUND_LOWER : bestScore > origAlpha ? BOUND_EXACT : BOUND_UPPER;
        tt.store(lo, hi, bestMove || ttMove, toTT(bestScore, ply), depth, bound, staticEval);
        return bestScore;
    }

    // a quiet move refuted the opponent: it becomes a killer and the counter-move, its history rises, the others' falls
    reward(m, ply, depth, prev, prevTo, quietCount, qBase) {
        const k = ply * 2;
        if (this.killers[k] !== m) {
            this.killers[k + 1] = this.killers[k];
            this.killers[k] = m;
        }
        if (prev !== NO_MOVE) this.counters[(this.pos.board[prevTo] << 7) | prevTo] = m;
        const side = this.pos.side << 14;
        const bonus = Math.min(150 * depth - 100, 1600);
        updateHistory(this.history, side | (m & 16383), bonus);
        for (let i = 0; i < quietCount; i++) updateHistory(this.history, side | (this.quiets[qBase + i] & 16383), -bonus);
    }

    // captures and queen promotions (all moves in check), with checks at the first ply
    qsearch(alpha, beta, ply, qply) {
        const pos = this.pos;
        this.pvLen[ply] = ply;
        this.nodes++;
        this.checkLimits();
        if (this.stopped) return 0;
        if (ply > this.seldepth) this.seldepth = ply;
        if (qply < 2 && repeated(pos, this.rootPly)) return 0;
        const inCheck = pos.inCheck();
        if (pos.halfmove >= 100) {
            if (!inCheck) return 0;
            return generateMoves(pos, this.moveLists[ply], false) === 0 ? -MATE + ply : 0;
        }
        if (ply >= this.maxPly) return inCheck ? 0 : clampEval(evaluate(pos));

        const pvNode = beta - alpha > 1;
        const tt = this.tt;
        const lo = pos.hashLo;
        const hi = pos.hashHi;
        let ttMove = NO_MOVE;
        let ttEval = NO_EVAL;
        if (tt.probe(lo, hi)) {
            ttMove = tt.move;
            ttEval = tt.eval;
            const s = fromTT(tt.score, ply);
            const b = tt.bound;
            if (!pvNode && pos.halfmove < 90 && (b === BOUND_EXACT || (b === BOUND_LOWER && s >= beta) || (b === BOUND_UPPER && s <= alpha))) return s;
        }

        let best;
        let standPat = 0;
        const moves = this.moveLists[ply];
        const scores = this.scoreLists[ply];
        let n;
        if (inCheck) {
            best = -MATE + ply;
            n = generateMoves(pos, moves, false);
            if (n === 0) return best;
        } else {
            standPat = ttEval !== NO_EVAL ? ttEval : clampEval(evaluate(pos));
            if (standPat >= beta) {
                if (ttEval === NO_EVAL) tt.store(lo, hi, NO_MOVE, toTT(standPat, ply), 0, BOUND_LOWER, standPat);
                return standPat;
            }
            if (standPat > alpha) alpha = standPat;
            best = standPat;
            n = generateMoves(pos, moves, qply !== 0);
        }
        scoreMoves(pos, moves, scores, n, ttMove, 0, 0, 0, this.history);

        const origAlpha = alpha;
        let bestMove = NO_MOVE;
        for (let i = 0; i < n; i++) {
            const m = pickNext(moves, scores, i, n);
            if (!inCheck) {
                const capture = (m >> 17) & F_CAPTURE;
                const promo = (m >> 14) & 7;
                if (promo && promo !== QUEEN) continue;
                if (!capture && !promo) {
                    // a quiet check, at the first ply only
                    if (!givesCheck(pos, m) || !seeGe(pos, m, 0)) continue;
                } else {
                    if (scores[i] < SCORE_GOOD) continue;
                    if (!promo && standPat + victimValue(pos.board, m) + 200 <= alpha) continue;
                }
            }
            pos.make(m);
            this.played[ply] = m;
            const score = -this.qsearch(-beta, -alpha, ply + 1, qply + 1);
            pos.unmake();
            if (this.stopped) return 0;
            if (score > best) {
                best = score;
                if (score > alpha) {
                    bestMove = m;
                    if (score >= beta) break;
                    alpha = score;
                }
            }
        }
        const bound = best >= beta ? BOUND_LOWER : best > origAlpha ? BOUND_EXACT : BOUND_UPPER;
        tt.store(lo, hi, bestMove || ttMove, toTT(best, ply), 0, bound, inCheck ? NO_EVAL : standPat);
        return best;
    }
}

/**
 * Is the position a draw by repetition for the search? A position seen since the root (the root included) is a draw the
 * second time: the side that repeats it could repeat it again. A position seen only before the root, in the game,
 * is a draw only the third time, when it can be claimed; once before is an ordinary position. The history is read
 * back to the last irreversible move or null move.
 */
function repeated(pos, rootPly) {
    const lo = pos.hashLo;
    const hi = pos.hashHi;
    const ply = pos.ply;
    const n = Math.min(pos.halfmove, ply);
    const moves = pos.uMove;
    let before = 0;
    for (let k = 1; k <= n; k++) {
        const i = ply - k;
        if (moves[i] === NO_MOVE) return false;
        if ((k & 1) === 0 && pos.uLo[i] === lo && pos.uHi[i] === hi) {
            if (i >= rootPly) return true;
            if (++before === 2) return true;
        }
    }
    return false;
}

// the pieces on the board
function pieceCount(pos) {
    const c = pos.counts;
    let n = 0;
    for (let i = 1; i < 15; i++) n += c[i];
    return n;
}

// has the side a piece other than pawns and the king?
function hasPieces(pos, side) {
    const c = pos.counts;
    const s = side << 3;
    return c[s | KNIGHT] + c[s | BISHOP] + c[s | ROOK] + c[s | QUEEN] > 0;
}

// sort the root moves from index k by score, best first; a stable sort keeps the earlier order among the unsearched
function sortFrom(roots, k) {
    const tail = roots.slice(k).sort((a, b) => b.score - a.score);
    for (let i = 0; i < tail.length; i++) roots[k + i] = tail[i];
}

// the first count root moves as result lines
function snapshot(roots, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const r = roots[i];
        out.push({ move: r.move, score: r.score, mate: mateIn(r.score), pv: r.pv.slice() });
    }
    return out;
}
