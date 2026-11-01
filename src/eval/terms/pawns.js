// eval/terms/pawns — the pawn structure (isolated, doubled, backward, connected, passed, chains) and what the pieces make of the passers.
//
// pawnStructure depends on the pawns alone, so the fast evaluation caches its sum by the pawn hash; passedPawns looks at
// the pieces and the kings as well and runs every time.
import { KNIGHT, BISHOP, ROOK, QUEEN } from '../../core/index.js';
import { T, WMG, WEG, S, PASSED_MG, PASSED_EG, FREE_MG, FREE_EG, CONNECTED_MG, CONNECTED_EG, CHAIN_MG, CHAIN_EG } from '../params.js';

const ISOLATED = T['isolated-pawn'];
const DOUBLED = T['doubled-pawn'];
const BACKWARD = T['backward-pawn'];
const CONNECTED = T['connected-pawn'];
const PASSED = T['passed-pawn'];
const CHAIN = T['pawn-chain'];
const W_ISOLATED = S['isolated-pawn'];
const W_DOUBLED = S['doubled-pawn'];
const W_BACKWARD = S['backward-pawn'];
const W_UNSTOPPABLE = S['passed-pawn.unstoppable'];

/**
 * The pawn structure from the pawn files (ctx.pf: for each color and file, a bit per rank holding a pawn). A pawn is
 * isolated with no pawn of its own on a neighbouring file; doubled when another of its own stands ahead of it on the file
 * (the rear one pays); in a chain when a pawn of its own guards it from behind; connected when one stands beside it;
 * passed when no enemy pawn stands ahead on its file or a neighbouring one (and no own pawn ahead); backward when all its
 * neighbours have gone ahead and an enemy pawn guards the square in front of it. Leaves the passers in ctx.passed: for
 * each color, 4 bits per file holding the rank of the passer (0 for none).
 */
export function pawnStructure(pos, t, ctx) {
    const pf = ctx.pf;
    for (let c = 0; c < 2; c++) {
        const o = c << 3;
        const eo = o ^ 8;
        let pack = 0;
        for (let f = 0; f < 8; f++) {
            let bits = pf[o + f];
            if (!bits) continue;
            const sides = (f > 0 ? pf[o + f - 1] : 0) | (f < 7 ? pf[o + f + 1] : 0);
            const enemySides = (f > 0 ? pf[eo + f - 1] : 0) | (f < 7 ? pf[eo + f + 1] : 0);
            const enemyNear = enemySides | pf[eo + f];
            while (bits) {
                const r = 31 - Math.clz32(bits & -bits);
                bits &= bits - 1;
                const sq = (r << 4) | f;
                const rr = c ? 7 - r : r;
                const ahead = c ? (1 << r) - 1 : (0xff << (r + 1)) & 0xff;
                if (!sides) t.add(ISOLATED, c, WMG[W_ISOLATED], WEG[W_ISOLATED], sq);
                const doubled = (pf[o + f] & ahead) !== 0;
                if (doubled) t.add(DOUBLED, c, WMG[W_DOUBLED], WEG[W_DOUBLED], sq);
                if (sides & (1 << (c ? r + 1 : r - 1))) t.add(CHAIN, c, CHAIN_MG[rr], CHAIN_EG[rr], sq);
                if (sides & (1 << r)) t.add(CONNECTED, c, CONNECTED_MG[rr], CONNECTED_EG[rr], sq);
                if (!doubled && (enemyNear & ahead) === 0) {
                    t.add(PASSED, c, PASSED_MG[rr], PASSED_EG[rr], sq);
                    pack |= r << (f << 2);
                } else if (sides) {
                    // every neighbour is ahead, and an enemy pawn two ranks up on a neighbouring file guards the stop square
                    const behindOrLevel = c ? (0xff << r) & 0xff : (2 << r) - 1;
                    const guard = c ? r - 2 : r + 2;
                    if ((sides & behindOrLevel) === 0 && guard >= 0 && guard <= 7 && enemySides & (1 << guard))
                        t.add(BACKWARD, c, WMG[W_BACKWARD], WEG[W_BACKWARD], sq);
                }
            }
        }
        ctx.passed[c] = pack;
    }
}

/**
 * The passers among the pieces: a bonus by rank when nothing stands on the way to the queening square, and in a pawn
 * ending a large one when the enemy king is outside the square of the pawn (it cannot catch it, the side to move counted).
 */
export function passedPawns(pos, t, ctx) {
    const b = pos.board;
    const counts = pos.counts;
    const dist = ctx.dist;
    for (let c = 0; c < 2; c++) {
        const pack = ctx.passed[c];
        if (!pack) continue;
        const e = c ^ 1;
        const eo = e << 3;
        const pieces = counts[eo | KNIGHT] + counts[eo | BISHOP] + counts[eo | ROOK] + counts[eo | QUEEN];
        const fwd = c ? -16 : 16;
        for (let f = 0; f < 8; f++) {
            const r = (pack >> (f << 2)) & 15;
            if (!r) continue;
            const sq = (r << 4) | f;
            const rr = c ? 7 - r : r;
            let free = true;
            for (let s = sq + fwd; (s & 0x88) === 0; s += fwd)
                if (b[s]) {
                    free = false;
                    break;
                }
            if (!free) continue;
            let mg = FREE_MG[rr];
            let eg = FREE_EG[rr];
            if (!pieces) {
                const queening = c ? f : 0x70 | f;
                const moves = rr === 1 ? 5 : 7 - rr;
                const reach = dist[pos.kings[e] - queening + 119] - (pos.side === e ? 1 : 0);
                if (reach > moves) {
                    mg += WMG[W_UNSTOPPABLE];
                    eg += WEG[W_UNSTOPPABLE];
                }
            }
            if (mg || eg) t.add(PASSED, c, mg, eg, sq);
        }
    }
}
