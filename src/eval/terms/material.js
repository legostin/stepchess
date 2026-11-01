// eval/terms/material — what the pieces are worth: material, the bishop pair, and the imbalances that shift with the pawns.
import { PAWN, KNIGHT, BISHOP, ROOK } from '../../core/index.js';
import { T, MAT_MG, MAT_EG, WMG, WEG, S } from '../params.js';

const MATERIAL = T.material;
const PAIR = T['bishop-pair'];
const IMBALANCE = T.imbalance;
const W_PAIR = S['bishop-pair'];
const W_KNIGHT_PAWN = S['imbalance.knightPawn'];
const W_ROOK_PAWN = S['imbalance.rookPawn'];

/**
 * Material from the piece counts; the bishop pair; and the imbalance: a knight gains with every pawn of its own side
 * above five and a rook loses (the knight wants a closed board with targets, the rook open lines).
 */
export function material(pos, t, ctx) {
    const counts = pos.counts;
    for (let c = 0; c < 2; c++) {
        const o = c << 3;
        let mg = 0;
        let eg = 0;
        for (let type = PAWN; type <= 5; type++) {
            const n = counts[o | type];
            mg += n * MAT_MG[type];
            eg += n * MAT_EG[type];
        }
        t.add(MATERIAL, c, mg, eg);
        if (counts[o | BISHOP] >= 2) {
            t.add(PAIR, c, WMG[W_PAIR], WEG[W_PAIR]);
            if (t.detail) markPieces(pos, t, ctx, PAIR, o | BISHOP);
        }
        const pawns = counts[o | PAWN] - 5;
        const knights = counts[o | KNIGHT];
        const rooks = counts[o | ROOK];
        if (pawns !== 0 && (knights || rooks)) {
            const mgv = pawns * (knights * WMG[W_KNIGHT_PAWN] + rooks * WMG[W_ROOK_PAWN]);
            const egv = pawns * (knights * WEG[W_KNIGHT_PAWN] + rooks * WEG[W_ROOK_PAWN]);
            if (mgv || egv) {
                t.add(IMBALANCE, c, mgv, egv);
                if (t.detail) {
                    markPieces(pos, t, ctx, IMBALANCE, o | KNIGHT);
                    markPieces(pos, t, ctx, IMBALANCE, o | ROOK);
                }
            }
        }
    }
}

// name the squares of every piece of one code (trace only)
function markPieces(pos, t, ctx, key, piece) {
    const b = pos.board;
    for (let i = 0; i < ctx.nAll; i++) {
        const sq = ctx.all[i];
        if (b[sq] === piece) t.mark(key, piece >> 3, sq);
    }
}
