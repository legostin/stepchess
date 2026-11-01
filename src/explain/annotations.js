// explain/annotations — what an explanation draws on a board: arrows, marked squares and badges, with algebraic squares, built from moves and motifs.
//
// The format is the board's: {arrows: [{from, to, kind}], squares: [{sq, kind}], badges: [{sq, glyph}]} with squares as
// 'e4', a kind out of ANNOTATION_KINDS and a glyph out of BADGE_GLYPHS. Every builder here keeps to it, so a board takes
// the annotations as they are; duplicates are dropped, the first one wins.
import { sqName, moveFrom, moveTo } from '../core/index.js';

/** What an arrow or a square means. */
export const ANNOTATION_KINDS = Object.freeze(['best', 'threat', 'bad', 'idea', 'attack', 'defend']);
/** The glyphs of a badge. */
export const BADGE_GLYPHS = Object.freeze(['!!', '!', '!?', '?!', '?', '??', '#', '+']);

/**
 * @typedef {{arrows: {from: string, to: string, kind: string}[], squares: {sq: string, kind: string}[],
 *   badges: {sq: string, glyph: string}[]}} Annotations
 */

/** No annotations. @returns {Annotations} */
export const noAnnotations = () => ({ arrows: [], squares: [], badges: [] });

const kindIn = (k) => (ANNOTATION_KINDS.includes(k) ? k : 'idea');
// a 0x88 square as its name, or null off the board
const nameOf = (sq) => (Number.isInteger(sq) && sq >= 0 && (sq & 0x88) === 0 ? sqName(sq) : null);

/** Annotations merged in order: an arrow, a square or a badge already there is not repeated. @returns {Annotations} */
export function mergeAnnotations(...list) {
    const out = noAnnotations();
    const seen = new Set();
    for (const a of list) {
        if (!a) continue;
        for (const x of a.arrows ?? []) {
            const key = `a${x.from}${x.to}`;
            if (seen.has(key) || x.from === x.to) continue;
            seen.add(key);
            out.arrows.push({ from: x.from, to: x.to, kind: kindIn(x.kind) });
        }
        for (const x of a.squares ?? []) {
            const key = `s${x.sq}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.squares.push({ sq: x.sq, kind: kindIn(x.kind) });
        }
        for (const x of a.badges ?? []) {
            const key = `b${x.sq}`;
            if (seen.has(key) || !BADGE_GLYPHS.includes(x.glyph)) continue;
            seen.add(key);
            out.badges.push({ sq: x.sq, glyph: x.glyph });
        }
    }
    return out;
}

/** The arrow of an encoded move. @returns {Annotations} */
export function moveArrow(move, kind) {
    const a = noAnnotations();
    const from = nameOf(moveFrom(move));
    const to = nameOf(moveTo(move));
    if (from && to && from !== to) a.arrows.push({ from, to, kind: kindIn(kind) });
    return a;
}

/** A badge on a 0x88 square (nothing for a missing glyph). @returns {Annotations} */
export function badgeOn(sq, glyph) {
    const a = noAnnotations();
    const name = nameOf(sq);
    if (name && BADGE_GLYPHS.includes(glyph)) a.badges.push({ sq: name, glyph });
    return a;
}

/** Marked 0x88 squares of one kind. @returns {Annotations} */
export function squaresOf(list, kind) {
    const a = noAnnotations();
    for (const sq of list ?? []) {
        const name = nameOf(sq);
        if (name) a.squares.push({ sq: name, kind: kindIn(kind) });
    }
    return mergeAnnotations(a);
}

/**
 * What a motif draws: its own arrows, and its squares marked as `kind` (by default an attack for a tactic or a mate,
 * an idea for a positional motif). withArrows false leaves the arrows out (a hint must not show the move).
 * @param {{kind: string, squares: number[], arrows: {from: number, to: number, kind: string}[]}} motif
 * @param {{kind?: string, withArrows?: boolean}} [opts]
 * @returns {Annotations}
 */
export function motifAnnotations(motif, { kind, withArrows = true } = {}) {
    const a = noAnnotations();
    if (withArrows)
        for (const x of motif.arrows ?? []) {
            const from = nameOf(x.from);
            const to = nameOf(x.to);
            if (from && to && from !== to) a.arrows.push({ from, to, kind: kindIn(x.kind) });
        }
    return mergeAnnotations(a, squaresOf(motif.squares, kind ?? (motif.kind === 'positional' ? 'idea' : 'attack')));
}
