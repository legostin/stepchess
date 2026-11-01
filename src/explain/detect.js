// explain/detect — detectMotifs: the motifs of a move and of every ply of the line that follows it, each with its proof on the board.
import { MOTIFS } from './motifs/registry.js';
import { TACTIC_DETECTORS } from './motifs/tactics.js';
import { MATE_DETECTORS } from './motifs/mates.js';
import { POSITIONAL_DETECTORS } from './motifs/positional.js';
import { playOut, plyContext } from './motifs/context.js';

const DETECTORS = { ...TACTIC_DETECTORS, ...MATE_DETECTORS, ...POSITIONAL_DETECTORS };
const kindKeys = (kind) => MOTIFS.filter((m) => m.kind === kind).map((m) => m.key);
const TACTIC_KEYS = kindKeys('tactic');
const MATE_KEYS = kindKeys('mate');
const POSITIONAL_KEYS = kindKeys('positional');
// a motif that a sharper one on the same ply already explains: the lure of a decoy also deflects, a discovery also clears
const SHADOWED = { deflection: ['decoy'], clearance: ['discovered-attack'] };
// a capture an earlier motif already tells, by the ply distance back to it, on one of that motif's squares: taking back
// a desperado, or collecting what a fork, a skewer or a pin won, is no hanging piece
const HARVEST = { desperado: 1, fork: 2, skewer: 2, 'pin-absolute': 2, 'pin-relative': 2, 'discovered-attack': 2, 'double-check': 2 };
const ANSWERED = { 'hanging-piece': HARVEST };

/**
 * @typedef {{from: number, to: number, kind: string}} MotifArrow
 * @typedef {{key: string, kind: 'tactic' | 'mate' | 'positional', side: number, ply: number, pieces: number[],
 *   squares: number[], arrows: MotifArrow[], params: Record<string, unknown>}} Motif
 */

/**
 * The motifs of a move and of the line after it. pos is the position before the move (left as it was), move an encoded
 * legal move, line the encoded moves that follow (a principal variation; it is cut at its first illegal move).
 *
 * Tactics and mates are looked for on every ply of [move, ...line]; positional motifs on the move only. A motif's ply
 * is its index in [move, ...line] and side the color that played it. pieces are the 0x88 squares of the pieces that
 * take part (the one that carries the motif first), squares the squares it is about, arrows what a board may draw.
 * params holds the words of its sentence: piece (a piece code), square (a 0x88 square) and targets (piece codes),
 * with a few details of the motif besides.
 *
 * Tactics that win something prove it along the line (the material won, the exchange pending at its end counted by SEE),
 * or, when the line is empty, by every reply losing. options.before and options.after are evaluation traces of the
 * position before the move and at the end of the line (computed when missing); options.search(pos, {depth}) → {score}
 * (centipawns, the side to move's view) lets zugzwang be detected, which it is not without one.
 * @param {import('../core/index.js').Position} pos
 * @param {number} move
 * @param {number[]} [line]
 * @param {{before?: object, after?: object, search?: (pos: object, opts: {depth: number}) => {score: number}}} [options]
 * @returns {Motif[]}
 */
export function detectMotifs(pos, move, line = [], options = {}) {
    const play = playOut(pos, move, line);
    if (!play) return [];
    const out = [];
    for (let i = 0; i < play.seq.length; i++) {
        const ctx = plyContext(play, i, options ?? {});
        const keys = i === 0 ? [...TACTIC_KEYS, ...MATE_KEYS, ...POSITIONAL_KEYS] : [...TACTIC_KEYS, ...MATE_KEYS];
        const here = [];
        for (const key of keys) {
            if (MATE_KEYS.includes(key) && !ctx.mate) continue;
            const m = DETECTORS[key](ctx);
            if (m) here.push(m);
        }
        const shown = here.filter(
            (m) =>
                !SHADOWED[m.key]?.some((k) => here.some((o) => o.key === k)) &&
                !out.some((o) => ANSWERED[m.key]?.[o.key] === i - o.ply && o.squares.includes(m.params.square)),
        );
        out.push(...shown);
    }
    return out;
}
