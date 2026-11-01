// eval/terms/pieces — where the pieces stand and what they do: the square tables, mobility, outposts, rooks on files, bad and trapped pieces.
import { PAWN, KNIGHT, BISHOP, ROOK, WK, WQ, BK, BQ } from '../../core/index.js';
import { T, PST_MG, PST_EG, MOB_MG, MOB_EG, WMG, WEG, S } from '../params.js';

const PST = T.pst;
const MOBILITY = T.mobility;
const OUTPOST = T['knight-outpost'];
const OPEN = T['rook-open-file'];
const SEMI = T['rook-semi-open-file'];
const SEVENTH = T['rook-seventh'];
const BAD = T['bad-bishop'];
const TRAPPED = T['trapped-piece'];
const W_OUTPOST = S['knight-outpost'];
const W_OPEN = S['rook-open-file'];
const W_SEMI = S['rook-semi-open-file'];
const W_SEVENTH = S['rook-seventh'];
const W_BAD = S['bad-bishop'];
const W_TRAPPED_BISHOP = S['trapped-piece.bishop'];
const W_TRAPPED_ROOK = S['trapped-piece.rook'];

// a bishop on one of these squares (White's side) is shut in by an enemy pawn on the paired square: a7/b6, h7/g6, a6/b5, h6/g5
const TRAP_BISHOP = Int16Array.of(0x60, 0x51, 0x67, 0x56, 0x50, 0x41, 0x57, 0x46);

/** The piece-square tables: every piece, the kings and pawns too, by its square seen from its own side. */
export function pst(pos, t, ctx) {
    const b = pos.board;
    const all = ctx.all;
    let wmg = 0;
    let weg = 0;
    let bmg = 0;
    let beg = 0;
    const detail = t.detail;
    for (let i = 0; i < ctx.nAll; i++) {
        const sq = all[i];
        const p = b[sq];
        const i64 = ((sq >> 4) << 3) | (sq & 7);
        if (p < 8) {
            const k = (p << 6) | i64;
            wmg += PST_MG[k];
            weg += PST_EG[k];
        } else {
            const k = ((p & 7) << 6) | (i64 ^ 56);
            bmg += PST_MG[k];
            beg += PST_EG[k];
        }
        if (detail) t.mark(PST, p >> 3, sq);
    }
    t.add(PST, 0, wmg, weg);
    t.add(PST, 1, bmg, beg);
}

/** Mobility: the squares a knight, bishop, rook or queen reaches that hold no piece of its own and no enemy pawn guards. */
export function mobility(pos, t, ctx) {
    const b = pos.board;
    const list = ctx.list;
    const mob = ctx.mob;
    let wmg = 0;
    let weg = 0;
    let bmg = 0;
    let beg = 0;
    const detail = t.detail;
    for (let i = 0; i < ctx.n; i++) {
        const sq = list[i];
        const p = b[sq];
        const k = ((p & 7) << 5) | mob[i];
        if (p < 8) {
            wmg += MOB_MG[k];
            weg += MOB_EG[k];
        } else {
            bmg += MOB_MG[k];
            beg += MOB_EG[k];
        }
        if (detail) t.mark(MOBILITY, p >> 3, sq);
    }
    t.add(MOBILITY, 0, wmg, weg);
    t.add(MOBILITY, 1, bmg, beg);
}

/**
 * Knight outposts (ranks 4–6, guarded by a pawn, out of reach of enemy pawns); rooks on open and half-open files and on
 * the seventh rank; bishops hemmed in by their own pawns fixed on the bishop's colour; a bishop shut in on a7 or h7, a rook boxed in by its
 * own king that can no longer castle.
 */
export function pieceFeatures(pos, t, ctx) {
    const b = pos.board;
    const list = ctx.list;
    const pf = ctx.pf;
    const patt = ctx.patt;
    for (let i = 0; i < ctx.n; i++) {
        const sq = list[i];
        const p = b[sq];
        const type = p & 7;
        const c = p >> 3;
        const f = sq & 7;
        const r = sq >> 4;
        const rr = c ? 7 - r : r;
        if (type === KNIGHT) {
            if (rr >= 3 && rr <= 5 && patt[(c << 7) + sq]) {
                // no enemy pawn on a neighbouring file stands ahead of the knight, so none can ever chase it away
                const ahead = c ? (1 << r) - 1 : (0xff << (r + 1)) & 0xff;
                const eo = (c ^ 1) << 3;
                const near = (f > 0 ? pf[eo + f - 1] : 0) | (f < 7 ? pf[eo + f + 1] : 0);
                if ((near & ahead) === 0) t.add(OUTPOST, c, WMG[W_OUTPOST], WEG[W_OUTPOST], sq);
            }
        } else if (type === BISHOP) {
            const blocked = ctx.blocked[c * 2 + ((r + f) & 1)];
            if (blocked) t.add(BAD, c, blocked * WMG[W_BAD], blocked * WEG[W_BAD], sq);
            const rel = c ? sq ^ 0x70 : sq;
            const enemyPawn = ((c ^ 1) << 3) | PAWN;
            for (let k = 0; k < 8; k += 2)
                if (rel === TRAP_BISHOP[k] && b[c ? TRAP_BISHOP[k + 1] ^ 0x70 : TRAP_BISHOP[k + 1]] === enemyPawn)
                    t.add(TRAPPED, c, WMG[W_TRAPPED_BISHOP], WEG[W_TRAPPED_BISHOP], sq);
        } else if (type === ROOK) {
            const own = pf[(c << 3) + f];
            if (!own) {
                if (pf[((c ^ 1) << 3) + f]) t.add(SEMI, c, WMG[W_SEMI], WEG[W_SEMI], sq);
                else t.add(OPEN, c, WMG[W_OPEN], WEG[W_OPEN], sq);
            }
            if (rr === 6) {
                // the seventh counts when the enemy king is on the eighth or enemy pawns are still on the seventh
                const ek = pos.kings[c ^ 1];
                let pawns = 0;
                const eo = (c ^ 1) << 3;
                for (let g = 0; g < 8; g++) pawns |= pf[eo + g];
                if (ek >> 4 === (c ? 0 : 7) || pawns & (1 << r)) t.add(SEVENTH, c, WMG[W_SEVENTH], WEG[W_SEVENTH], sq);
            }
            if (rr === 0 && ctx.mob[i] <= 3) {
                const k = pos.kings[c];
                const kf = k & 7;
                if (k >> 4 === r && ((kf >= 4 && f > kf) || (kf <= 3 && f < kf))) {
                    const right = f > kf ? (c ? BK : WK) : c ? BQ : WQ;
                    if (!(pos.castling & right)) t.add(TRAPPED, c, WMG[W_TRAPPED_ROOK], WEG[W_TRAPPED_ROOK], sq);
                }
            }
        }
    }
}
