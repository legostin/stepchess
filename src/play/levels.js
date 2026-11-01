// play/levels — the strength ladder of the opponent: anchors at 400 … 2800 elo and the interpolation between them.
//
// Each anchor is {elo, nodes, temperature, multipv, blind: {backward, longDiagonal, quietWin, threatDepth}, blunder: {base, complexity}}:
//   nodes        the search budget of a move
//   temperature  the softmax temperature in centipawns: how evenly the candidates are chosen
//   multipv      how many candidate moves the search keeps
//   blind        the blind spots: the chance (0..1) that a backward move / a move along a diagonal longer than 4 / a quiet
//                move whose gain shows only beyond the depth is not seen at all; threatDepth is how many plies ahead the
//                opponent's threats are seen (a refutation deeper than that is missed)
//   blunder      the extra chance of playing the 2nd..4th candidate: base + complexity · (candidates within 50 cp of the best − 1)
//
// The block between the markers is written by scripts/calibrate.mjs, which fits it to the statistics of real games. HAND_SET,
// below it, keeps the anchors as they were set by hand: the calibration starts every run from them (so it can be run again,
// e.g. after the evaluation changes), and keeps them for the anchors the games say nothing about.

// <generated>
export const LEVELS = [
    {
        elo: 400,
        nodes: 300,
        temperature: 250,
        multipv: 6,
        blind: { backward: 0.5, longDiagonal: 0.5, quietWin: 0.6, threatDepth: 1 },
        blunder: { base: 0.25, complexity: 0.03 },
    },
    {
        elo: 800,
        nodes: 1600,
        temperature: 162.3,
        multipv: 6,
        blind: { backward: 0.35, longDiagonal: 0.35, quietWin: 0.45, threatDepth: 1 },
        blunder: { base: 0.24, complexity: 0.02 },
    },
    {
        elo: 1200,
        nodes: 4600,
        temperature: 138,
        multipv: 5,
        blind: { backward: 0.2, longDiagonal: 0.2, quietWin: 0.3, threatDepth: 2 },
        blunder: { base: 0.081, complexity: 0.015 },
    },
    {
        elo: 1600,
        nodes: 11000,
        temperature: 60,
        multipv: 5,
        blind: { backward: 0.1, longDiagonal: 0.1, quietWin: 0.18, threatDepth: 3 },
        blunder: { base: 0.071, complexity: 0.01 },
    },
    {
        elo: 2000,
        nodes: 15000,
        temperature: 35,
        multipv: 4,
        blind: { backward: 0.05, longDiagonal: 0.05, quietWin: 0.08, threatDepth: 4 },
        blunder: { base: 0.061, complexity: 0.006 },
    },
    {
        elo: 2400,
        nodes: 21000,
        temperature: 9.1,
        multipv: 4,
        blind: { backward: 0.01, longDiagonal: 0.01, quietWin: 0.02, threatDepth: 6 },
        blunder: { base: 0.051, complexity: 0.002 },
    },
    {
        elo: 2800,
        nodes: 30000,
        temperature: 5,
        multipv: 3,
        blind: { backward: 0, longDiagonal: 0, quietWin: 0, threatDepth: 10 },
        blunder: { base: 0, complexity: 0 },
    },
];
// </generated>

/** The anchors as set by hand, before any calibration: the starting point and the fallback of scripts/calibrate.mjs. */
export const HAND_SET = Object.freeze(
    [
        {
            elo: 400,
            nodes: 300,
            temperature: 250,
            multipv: 6,
            blind: { backward: 0.5, longDiagonal: 0.5, quietWin: 0.6, threatDepth: 1 },
            blunder: { base: 0.25, complexity: 0.03 },
        },
        {
            elo: 800,
            nodes: 700,
            temperature: 160,
            multipv: 6,
            blind: { backward: 0.35, longDiagonal: 0.35, quietWin: 0.45, threatDepth: 1 },
            blunder: { base: 0.15, complexity: 0.02 },
        },
        {
            elo: 1200,
            nodes: 2000,
            temperature: 100,
            multipv: 5,
            blind: { backward: 0.2, longDiagonal: 0.2, quietWin: 0.3, threatDepth: 2 },
            blunder: { base: 0.08, complexity: 0.015 },
        },
        {
            elo: 1600,
            nodes: 5000,
            temperature: 60,
            multipv: 5,
            blind: { backward: 0.1, longDiagonal: 0.1, quietWin: 0.18, threatDepth: 3 },
            blunder: { base: 0.04, complexity: 0.01 },
        },
        {
            elo: 2000,
            nodes: 12000,
            temperature: 35,
            multipv: 4,
            blind: { backward: 0.05, longDiagonal: 0.05, quietWin: 0.08, threatDepth: 4 },
            blunder: { base: 0.02, complexity: 0.006 },
        },
        {
            elo: 2400,
            nodes: 20000,
            temperature: 15,
            multipv: 4,
            blind: { backward: 0.01, longDiagonal: 0.01, quietWin: 0.02, threatDepth: 6 },
            blunder: { base: 0.005, complexity: 0.002 },
        },
        {
            elo: 2800,
            nodes: 30000,
            temperature: 5,
            multipv: 3,
            blind: { backward: 0, longDiagonal: 0, quietWin: 0, threatDepth: 10 },
            blunder: { base: 0, complexity: 0 },
        },
    ].map((l) => Object.freeze(l)),
);

/** The strength used when the elo given is not a number. */
export const DEFAULT_ELO = 1500;

const clone = (l) => ({ ...l, blind: { ...l.blind }, blunder: { ...l.blunder } });
const mix = (a, b, t) => a + (b - a) * t;
// geometric mixing for quantities that grow by factors (nodes, temperature)
const mixLog = (a, b, t) => Math.exp(mix(Math.log(a), Math.log(b), t));
const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * The level of an elo: the anchor itself, or a blend of the two anchors around it (nodes and temperature geometrically,
 * the rest linearly, counts rounded). Outside 400..2800 the end anchors hold; anything that is not a number gives 1500.
 */
export function levelFor(elo) {
    const e = typeof elo === 'number' && !Number.isNaN(elo) ? elo : DEFAULT_ELO;
    const first = LEVELS[0];
    const last = LEVELS[LEVELS.length - 1];
    if (e <= first.elo) return clone(first);
    if (e >= last.elo) return clone(last);
    let i = 1;
    while (LEVELS[i].elo < e) i++;
    const [a, b] = [LEVELS[i - 1], LEVELS[i]];
    const t = (e - a.elo) / (b.elo - a.elo);
    if (t === 1) return clone(b);
    const prob = (x, y) => round(mix(x, y, t), 4);
    return {
        elo: e,
        nodes: Math.round(mixLog(a.nodes, b.nodes, t)),
        temperature: round(mixLog(a.temperature, b.temperature, t), 2),
        multipv: Math.round(mix(a.multipv, b.multipv, t)),
        blind: {
            backward: prob(a.blind.backward, b.blind.backward),
            longDiagonal: prob(a.blind.longDiagonal, b.blind.longDiagonal),
            quietWin: prob(a.blind.quietWin, b.blind.quietWin),
            threatDepth: Math.round(mix(a.blind.threatDepth, b.blind.threatDepth, t)),
        },
        blunder: { base: prob(a.blunder.base, b.blunder.base), complexity: prob(a.blunder.complexity, b.blunder.complexity) },
    };
}
