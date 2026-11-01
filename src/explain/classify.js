// explain/classify — the class of a move by the win chance it gives away, the accuracy of a move, and every threshold of the explanations in one place.
//
// The loss is the drop in the mover's win chance (0..1) from the best move to the move played. The classes:
//   best        the best move, or a loss below 1%
//   good        below 5%
//   inaccuracy  5% up to 10%
//   mistake     10% up to and including 20%
//   blunder     above 20%, or a forced mate missed or allowed
// A course may show CLASS_THRESHOLDS as they are; nothing else in the engine holds these numbers.

/** The upper bounds of the classes, as losses of win chance. */
export const CLASS_THRESHOLDS = Object.freeze({ best: 0.01, good: 0.05, inaccuracy: 0.1, mistake: 0.2 });

/** The classes, from the best to the worst. */
export const CLASSES = Object.freeze(['best', 'good', 'inaccuracy', 'mistake', 'blunder']);

/** The glyph a board puts on the square of a move of each class (none for a good move). */
export const CLASS_GLYPHS = Object.freeze({ best: '!', good: null, inaccuracy: '?!', mistake: '?', blunder: '??' });

/**
 * The other levels of the explanations. A position is won for the mover from `winning` on; a key moment of a review is
 * a move that shifts White's chance by `swing` or more (at most `moments` of them, the largest). An explanation names
 * at most `terms` terms of the evaluation, each changed by `termMin` centipawns or more and by at least `termShare` of the
 * largest change, and at most `motifs` motifs of
 * the move, and shows lines of at most `linePlies` plies; a zugzwang check searches at most `zugzwangNodes` nodes. The opening of a review ends at its last book ply,
 * or at ply `openingPlies` when the game never follows the book; its endgame starts at the first position of phase
 * `endgamePhase` or less (see eval: 24 is the full set of pieces).
 */
export const EXPLAIN_LEVELS = Object.freeze({
    winning: 0.75,
    swing: CLASS_THRESHOLDS.inaccuracy,
    moments: 5,
    terms: 3,
    termMin: 15,
    termShare: 0.1,
    motifs: 3,
    linePlies: 8,
    zugzwangNodes: 20000,
    openingPlies: 20,
    endgamePhase: 6,
});

/**
 * The class of a move.
 * @param {number} loss the mover's loss of win chance, 0..1 (anything else counts as no loss)
 * @param {{missedMate?: boolean, allowedMate?: boolean, isBest?: boolean}} [flags] isBest: the move is the engine's
 *   best (always 'best'); missedMate: the mover had a forced mate and the move lets it go; allowedMate: the move lets
 *   the opponent mate by force where the best move did not
 * @returns {'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'}
 */
export function classify(loss, { missedMate = false, allowedMate = false, isBest = false } = {}) {
    if (isBest) return 'best';
    if (missedMate || allowedMate) return 'blunder';
    const l = typeof loss === 'number' && loss > 0 ? loss : 0;
    if (l < CLASS_THRESHOLDS.best) return 'best';
    if (l < CLASS_THRESHOLDS.good) return 'good';
    if (l < CLASS_THRESHOLDS.inaccuracy) return 'inaccuracy';
    if (l <= CLASS_THRESHOLDS.mistake) return 'mistake';
    return 'blunder';
}

/**
 * The accuracy of one move (0..100) from its loss of win chance (0..1): 103.1668 · e^(−0.04354 · loss%) − 3.1669,
 * clamped. No loss is (almost) 100, a loss of half the chances about 8.
 * @param {number} loss
 */
export function moveAccuracy(loss) {
    const pct = (typeof loss === 'number' && Number.isFinite(loss) ? loss : 0) * 100;
    const a = 103.1668 * Math.exp(-0.04354 * pct) - 3.1669;
    return a < 0 ? 0 : a > 100 ? 100 : a;
}
