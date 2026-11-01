// puzzles/difficulty — how hard a puzzle is: the depth it takes to see, the forcing moves to choose among, and how quiet its moves are.
//
// rating = clamp(600 + 180·depth + 120·log2(candidates) + 250·quiet, 400, 3000), before calibration against real solvers.
//   depth       the search depth from which the first solver move stays the engine's choice and is seen to win (1 for a move any shallow look finds)
//   candidates  the forcing moves (captures, checks, promotions) the solver has to weigh at the first move, the solution counted
//   quiet       the share of the solver's moves that neither capture, promote nor give check (0..1)
import { F_CAPTURE, movePromo, moveFlags } from '../core/index.js';

export const RATING_MIN = 400;
export const RATING_MAX = 3000;

/** The rating of a puzzle from its three measures. */
export function ratingOf({ depth, candidates, quiet }) {
    const raw = 600 + 180 * depth + 120 * Math.log2(Math.max(1, candidates)) + 250 * quiet;
    return Math.round(Math.min(RATING_MAX, Math.max(RATING_MIN, raw)));
}

// a move that captures nothing, promotes nothing and gives no check (the position is left as it was)
function isQuiet(pos, m) {
    if (movePromo(m) || (moveFlags(m) & F_CAPTURE) !== 0) return false;
    pos.make(m);
    const check = pos.inCheck();
    pos.unmake();
    return !check;
}

/**
 * The depth from which the search sees the solution: the first depth after which every iteration has the target move as its best
 * and counts it as winning. iterations are [{depth, best, wins}] in order; a search that never settles gives the depth it ended at.
 */
export function stableDepth(iterations, target) {
    if (iterations.length === 0) return 1;
    const seen = (it) => it.best === target && it.wins;
    let i = iterations.length - 1;
    if (!seen(iterations[i])) return Math.max(1, iterations[i].depth);
    while (i > 0 && seen(iterations[i - 1])) i--;
    return Math.max(1, iterations[i].depth);
}

/**
 * The measures of a puzzle. pos is the start position (left as it was), moves the encoded moves of the whole line, iterations
 * the per-depth choices of the search at the first solver move.
 */
export function difficultyOf(pos, moves, iterations, legal) {
    const p = pos.clone();
    let quiet = 0;
    let solverMoves = 0;
    for (let i = 0; i < moves.length; i++) {
        if (i % 2 === 0) {
            solverMoves++;
            if (isQuiet(p, moves[i])) quiet++;
        }
        p.make(moves[i]);
    }
    const forcing = legal.filter((m) => !isQuiet(pos, m)).length;
    const candidates = Math.max(1, forcing + (isQuiet(pos, moves[0]) ? 1 : 0));
    const depth = stableDepth(iterations, moves[0]);
    const share = solverMoves ? Math.round((quiet / solverMoves) * 100) / 100 : 0;
    return { depth, candidates, quiet: share, rating: ratingOf({ depth, candidates, quiet: share }) };
}
