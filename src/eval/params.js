// eval/params — the terms of the evaluation, the weights compiled into typed tables, and the weights as a flat vector for tuning.
//
// W (weights.js) is the readable form: an object keyed by term, each with {mg, eg} pairs, tables by rank or by count,
// and a few scale factors. The evaluation reads the compiled tables below instead: flat Int32Arrays filled from W by
// applyWeights, in place, so a term module can hold them as constants and the tuner can swap the weights at run time.
import { msg } from '../i18n/index.js';

/** The terms of the evaluation in their groups; the id of a term (what tracers take as the key) is its index here. */
export const TERMS = Object.freeze(
    [
        ['material', 'material'],
        ['bishop-pair', 'material'],
        ['imbalance', 'material'],
        ['pst', 'pieces'],
        ['mobility', 'pieces'],
        ['knight-outpost', 'pieces'],
        ['rook-open-file', 'pieces'],
        ['rook-semi-open-file', 'pieces'],
        ['rook-seventh', 'pieces'],
        ['bad-bishop', 'pieces'],
        ['trapped-piece', 'pieces'],
        ['isolated-pawn', 'pawns'],
        ['doubled-pawn', 'pawns'],
        ['backward-pawn', 'pawns'],
        ['connected-pawn', 'pawns'],
        ['passed-pawn', 'pawns'],
        ['pawn-chain', 'pawns'],
        ['pawn-shield', 'king'],
        ['pawn-storm', 'king'],
        ['king-attack', 'king'],
        ['king-open-file', 'king'],
        ['king-activity', 'king'],
        ['hanging-piece', 'threats'],
        ['pawn-threat', 'threats'],
        ['double-attack', 'threats'],
        ['center-control', 'space'],
        ['space', 'space'],
        ['kbnk-corner', 'endgame'],
        ['opposite-bishops', 'endgame'],
        ['wrong-bishop', 'endgame'],
        ['fortress', 'endgame'],
    ].map(([key, group]) => Object.freeze({ key, group })),
);

/** The id of each term by its key: T['isolated-pawn'] === 11. */
export const T = Object.freeze(Object.fromEntries(TERMS.map((t, i) => [t.key, i])));

/** The name of a term (a Msg in every language): "Isolated pawn" for 'isolated-pawn'. */
export const termName = (key) => msg(`eval.term.${key}.name`);
/** What a term means (a Msg), in a sentence or two. */
export const termAbout = (key) => msg(`eval.term.${key}.about`);

// ---------------------------------------------------------------- constants that are not tuned

/** The phase a piece type adds (knight and bishop 1, rook 2, queen 4): 24 is the full middlegame, 0 a pawn ending. */
export const PHASE = Int8Array.of(0, 0, 1, 1, 2, 4, 0);
export const MAX_PHASE = 24;
/** The scale factor that leaves the score as it is (a scale s multiplies the score by s / SCALE_ONE). */
export const SCALE_ONE = 64;
/** The share of the king attack that counts, out of 64, by the number of pieces attacking the king zone. */
export const KING_ATTACK_SHARE = Int32Array.of(0, 0, 32, 44, 54, 60, 64, 64);
/** How much the kings' distances to a passed pawn matter, by the pawn's rank (0 is its first rank). */
export const PASSER_KING_RANK = Int32Array.of(0, 0, 1, 2, 3, 5, 7, 0);
/** The most squares a piece can reach, by type (the length of its mobility table). */
export const MOBILITY_MAX = Object.freeze([0, 0, 8, 13, 14, 27, 0]);

// ---------------------------------------------------------------- the compiled tables

/** Material by piece type. */
export const MAT_MG = new Int32Array(7);
export const MAT_EG = new Int32Array(7);
/** Piece-square tables: [type * 64 + a1-based index] from White's side; Black reads the square with the rank flipped. */
export const PST_MG = new Int32Array(7 * 64);
export const PST_EG = new Int32Array(7 * 64);
/** Mobility: [type * 32 + squares reached]. */
export const MOB_MG = new Int32Array(7 * 32);
export const MOB_EG = new Int32Array(7 * 32);
/** Tables by the rank of a pawn counted from its own side (0..7). */
export const PASSED_MG = new Int32Array(8);
export const PASSED_EG = new Int32Array(8);
export const FREE_MG = new Int32Array(8);
export const FREE_EG = new Int32Array(8);
export const CONNECTED_MG = new Int32Array(8);
export const CONNECTED_EG = new Int32Array(8);
export const CHAIN_MG = new Int32Array(8);
export const CHAIN_EG = new Int32Array(8);
/** The storm by the rank of the storming pawn counted from the defender's side. */
export const STORM_MG = new Int32Array(8);
export const STORM_EG = new Int32Array(8);
/** The weight of a piece attacking the king zone, by type. */
export const KING_ATTACK_MG = new Int32Array(7);
export const KING_ATTACK_EG = new Int32Array(7);
/** The scale of a pure opposite-bishop ending by the difference in pawns (0, 1, 2, 3 or more), out of SCALE_ONE. */
export const OCB_SCALE = new Int32Array(4);

// the single {mg, eg} weights: their paths in W, and the slot each fills in WMG / WEG
const SINGLE = [
    'bishop-pair',
    'imbalance.knightPawn',
    'imbalance.rookPawn',
    'knight-outpost',
    'rook-open-file',
    'rook-semi-open-file',
    'rook-seventh',
    'bad-bishop',
    'trapped-piece.bishop',
    'trapped-piece.rook',
    'isolated-pawn',
    'doubled-pawn',
    'backward-pawn',
    'passed-pawn.unstoppable',
    'pawn-shield.rank2',
    'pawn-shield.rank3',
    'pawn-storm.blocked',
    'king-open-file.open',
    'king-open-file.semiOpen',
    'king-activity.own',
    'king-activity.their',
    'hanging-piece',
    'pawn-threat',
    'double-attack',
    'center-control',
    'space',
    'kbnk-corner.edge',
    'kbnk-corner.corner',
    'kbnk-corner.near',
];
/** The slot of each single weight: WMG[S['isolated-pawn']]. */
export const S = Object.freeze(Object.fromEntries(SINGLE.map((p, i) => [p, i])));
export const WMG = new Int32Array(SINGLE.length);
export const WEG = new Int32Array(SINGLE.length);
/** The plain scale factors, out of SCALE_ONE: [wrong bishop, a lone minor or two knights, a small edge without pawns]. */
export const SCALES = new Int32Array(3);
export const SC_WRONG_BISHOP = 0;
export const SC_LONE_MINOR = 1;
export const SC_SMALL_EDGE = 2;

const at = (w, path) => path.split('.').reduce((o, k) => o[k], w);

/** Fill the compiled tables from a weights object shaped like W. */
export function applyWeights(w) {
    MAT_MG.set(w.material.mg);
    MAT_EG.set(w.material.eg);
    for (let t = 1; t <= 6; t++) {
        PST_MG.set(w.pst.mg[t], t * 64);
        PST_EG.set(w.pst.eg[t], t * 64);
    }
    MOB_MG.fill(0);
    MOB_EG.fill(0);
    for (let t = 2; t <= 5; t++) {
        MOB_MG.set(w.mobility.mg[t], t * 32);
        MOB_EG.set(w.mobility.eg[t], t * 32);
    }
    const pair = (mg, eg, v) => {
        mg.set(v.mg);
        eg.set(v.eg);
    };
    pair(PASSED_MG, PASSED_EG, w['passed-pawn']);
    pair(FREE_MG, FREE_EG, w['passed-pawn'].free);
    pair(CONNECTED_MG, CONNECTED_EG, w['connected-pawn']);
    pair(CHAIN_MG, CHAIN_EG, w['pawn-chain']);
    pair(STORM_MG, STORM_EG, w['pawn-storm']);
    pair(KING_ATTACK_MG, KING_ATTACK_EG, w['king-attack']);
    SINGLE.forEach((path, i) => {
        const v = at(w, path);
        WMG[i] = v.mg;
        WEG[i] = v.eg;
    });
    OCB_SCALE.set(w['opposite-bishops'].pure);
    SCALES[SC_WRONG_BISHOP] = w['wrong-bishop'].scale;
    SCALES[SC_LONE_MINOR] = w.fortress.loneMinor;
    SCALES[SC_SMALL_EDGE] = w.fortress.smallEdge;
}

// ---------------------------------------------------------------- weights as a vector, and as a module

/**
 * Every number of the weights with its path: {names: ['material.mg.1', …], values: [82, …]}, in a fixed order. The
 * win-chance slope K is left out: it is fitted on its own, not as an evaluation weight.
 */
export function flattenWeights(w) {
    const names = [];
    const values = [];
    const walk = (v, path) => {
        if (typeof v === 'number') {
            names.push(path);
            values.push(v);
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`));
        else for (const k of Object.keys(v)) if (!(path === '' && k === 'K')) walk(v[k], path ? `${path}.${k}` : k);
    };
    walk(w, '');
    return { names, values };
}

/** A copy of the weights with the numbers of a vector put back in flattenWeights order (rounded to whole numbers). */
export function unflattenWeights(w, values) {
    let i = 0;
    const walk = (v, top) => {
        if (typeof v === 'number') return Math.round(values[i++]);
        if (Array.isArray(v)) return v.map((x) => walk(x, false));
        const out = {};
        for (const k of Object.keys(v)) out[k] = top && k === 'K' ? v[k] : walk(v[k], false);
        return out;
    };
    return walk(w, true);
}

// a key as JavaScript writes it: bare when it can be
const keyText = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`);

/** The text of weights.js for a weights object: what the tuner writes. Tables of 64 squares come 8 to a line, a1 … h1 first. */
export function weightsModule(w) {
    const lines = [];
    const write = (v, indent) => {
        const pad = '    '.repeat(indent);
        if (typeof v === 'number') return String(v);
        if (Array.isArray(v)) {
            if (v.every((x) => typeof x === 'number')) {
                if (v.length !== 64) return `[${v.join(', ')}]`;
                const rows = [];
                for (let r = 0; r < 8; r++) rows.push(`${pad}    ${v.slice(r * 8, r * 8 + 8).join(', ')},`);
                return `[\n${rows.join('\n')}\n${pad}]`;
            }
            return `[\n${v.map((x) => `${pad}    ${write(x, indent + 1)},`).join('\n')}\n${pad}]`;
        }
        const keys = Object.keys(v);
        if (keys.every((k) => typeof v[k] === 'number')) return `{ ${keys.map((k) => `${keyText(k)}: ${v[k]}`).join(', ')} }`;
        const entries = keys.map((k) => `${pad}    ${keyText(k)}: ${write(v[k], indent + 1)},`);
        return `{\n${entries.join('\n')}\n${pad}}`;
    };
    lines.push('// eval/weights — the weights of the evaluation: {mg, eg} pairs by term, piece-square and mobility tables, scale factors.');
    lines.push('//');
    lines.push('// Generated: the hand-set start, then rewritten by the tuner (weightsModule in eval/params). A piece-square table lists');
    lines.push("// a1 … h1 on its first line and a8 … h8 on its last, from White's side; scale factors are out of 64.");
    lines.push('// prettier-ignore');
    lines.push(`export const W = ${write(w, 0)};`);
    return `${lines.join('\n')}\n`;
}
