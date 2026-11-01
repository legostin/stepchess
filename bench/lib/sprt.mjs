// bench/lib/sprt — the statistics of a match: score and Elo with an error bar, and the sequential probability ratio test.
//
// Games come in pairs (one opening, colours reversed), so the unit is the pair and the result is a pentanomial: how many
// pairs scored 0, 0.5, 1, 1.5 and 2 points for engine A. The Elo and its error come from the mean and variance of the
// pair scores; the SPRT is the generalised one used by fishtest, with the log-likelihood ratio approximated as
// N · (s1 − s0) · (2μ − s0 − s1) / (2σ²) over the pair scores.

const logistic = (elo) => 1 / (1 + Math.pow(10, -elo / 400));
export const eloOf = (score) => -400 * Math.log10(1 / score - 1);

// the standard normal CDF (Abramowitz and Stegun 26.2.17)
function phi(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
}

/**
 * The summary of a pentanomial [n0, n05, n1, n15, n2] (pairs by points for A, in half points: 0 … 2): pairs, games, the
 * score as a fraction, the Elo of A against B with a 95% error bar, the likelihood of superiority and the variance of
 * the pair score.
 */
export function summarize(penta) {
    const pairs = penta.reduce((a, b) => a + b, 0);
    const pts = [0, 0.25, 0.5, 0.75, 1]; // a pair's score as a fraction of its two games
    if (!pairs) return { pairs: 0, games: 0, score: 0.5, elo: 0, err: Infinity, los: 0.5, variance: 0 };
    let mean = 0;
    for (let i = 0; i < 5; i++) mean += (penta[i] / pairs) * pts[i];
    let variance = 0;
    for (let i = 0; i < 5; i++) variance += (penta[i] / pairs) * (pts[i] - mean) ** 2;
    const sd = Math.sqrt(variance / pairs);
    const clamp = (x) => Math.min(1 - 1e-9, Math.max(1e-9, x));
    const elo = eloOf(clamp(mean));
    const err = sd > 0 ? (eloOf(clamp(mean + 1.96 * sd)) - eloOf(clamp(mean - 1.96 * sd))) / 2 : Infinity;
    return {
        pairs,
        games: pairs * 2,
        score: mean,
        elo,
        err,
        los: sd > 0 ? phi((mean - 0.5) / sd) : mean > 0.5 ? 1 : mean < 0.5 ? 0 : 0.5,
        variance,
    };
}

/**
 * The state of the test of H0 (A is elo0 better than B) against H1 (elo1 better), error rates alpha and beta: {llr,
 * lower, upper, state}. state is 'H1' (accept: A is better), 'H0' (reject) or 'continue'.
 */
export function sprt(penta, { elo0, elo1, alpha = 0.05, beta = 0.05 }) {
    const lower = Math.log(beta / (1 - alpha));
    const upper = Math.log((1 - beta) / alpha);
    const s = summarize(penta);
    let llr = 0;
    if (s.pairs > 0 && s.variance > 0) {
        const s0 = logistic(elo0);
        const s1 = logistic(elo1);
        llr = (s.pairs * (s1 - s0) * (2 * s.score - s0 - s1)) / (2 * s.variance);
    }
    const state = llr >= upper ? 'H1' : llr <= lower ? 'H0' : 'continue';
    return { llr, lower, upper, state };
}

/** Parse "elo0=0,elo1=5" (alpha and beta optional); throws on anything malformed or on elo0 >= elo1. */
export function parseSprt(text) {
    const out = { elo0: 0, elo1: 5, alpha: 0.05, beta: 0.05 };
    for (const part of String(text).split(',')) {
        const [k, v, extra] = part.split('=');
        if (!(k in out) || v === undefined || extra !== undefined || v.trim() === '' || !Number.isFinite(Number(v)))
            throw new Error(`--sprt: "${part}" is not name=number with name elo0, elo1, alpha or beta`);
        out[k] = Number(v);
    }
    if (!(out.elo0 < out.elo1)) throw new Error('--sprt: elo0 must be below elo1');
    if (!(out.alpha > 0 && out.alpha < 1 && out.beta > 0 && out.beta < 1)) throw new Error('--sprt: alpha and beta must lie between 0 and 1');
    return out;
}
