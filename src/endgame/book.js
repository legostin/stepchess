// endgame/book — the opening book: the moves that continue named lines from a position, weighted by the number of lines.
import { Position, generateMoves, moveToUci } from '../core/index.js';
import { hashKey, openingIndex } from './openings.js';

const BUFFER = new Int32Array(256);

/**
 * The book moves of a position, heaviest first: [{move, weight}], where move is an encoded move legal in pos and weight
 * is the number of named lines that go on with it (transpositions count: positions are matched by hash). Empty out of
 * the book and for anything that is not a Position. The position is left as it was.
 */
export function bookMoves(pos) {
    if (!(pos instanceof Position)) return [];
    const counts = openingIndex().next.get(hashKey(pos));
    if (!counts) return [];
    const n = generateMoves(pos, BUFFER);
    const out = [];
    for (let i = 0; i < n; i++) {
        const uci = moveToUci(BUFFER[i]);
        const weight = counts.get(uci);
        if (weight) out.push({ move: BUFFER[i], weight, uci });
    }
    out.sort((a, b) => b.weight - a.weight || (a.uci < b.uci ? -1 : 1));
    return out.map(({ move, weight }) => ({ move, weight }));
}
