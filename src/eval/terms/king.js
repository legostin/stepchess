// eval/terms/king — the king: its pawn shield, the enemy pawn storm, pieces aiming at it, open files beside it, and its part in the endgame.
import { PAWN, ROOK, QUEEN } from '../../core/index.js';
import { T, WMG, WEG, S, STORM_MG, STORM_EG, KING_ATTACK_SHARE, PASSER_KING_RANK } from '../params.js';

const SHIELD = T['pawn-shield'];
const STORM = T['pawn-storm'];
const ATTACK = T['king-attack'];
const OPEN_FILE = T['king-open-file'];
const ACTIVITY = T['king-activity'];
const W_RANK2 = S['pawn-shield.rank2'];
const W_RANK3 = S['pawn-shield.rank3'];
const W_BLOCKED = S['pawn-storm.blocked'];
const W_OPEN = S['king-open-file.open'];
const W_SEMI = S['king-open-file.semiOpen'];
const W_OWN = S['king-activity.own'];
const W_THEIR = S['king-activity.their'];

/**
 * King safety on the king's file and its two neighbours (a king on the edge counts the three files nearest it). For a
 * king on its first two ranks and on a wing (files a–c or f–h): its pawns on the second or third rank shield it, and an enemy pawn on the third or fourth
 * rank (counted from the king's side) storms it — less when one of the king's pawns blocks it. For every king: a file
 * there without a pawn of its own is open (no pawns at all) or half-open for the enemy rooks, when the enemy has a rook
 * or a queen. The attack: knights, bishops, rooks and queens that reach the squares around the king, weighted by type,
 * counting more as more pieces join (a lone attacker counts nothing).
 */
export function kingSafety(pos, t, ctx) {
    const b = pos.board;
    const pf = ctx.pf;
    const counts = pos.counts;
    for (let c = 0; c < 2; c++) {
        const e = c ^ 1;
        const o = c << 3;
        const eo = e << 3;
        const ksq = pos.kings[c];
        const kf = ksq & 7;
        const rk = c ? 7 - (ksq >> 4) : ksq >> 4;
        const first = (kf < 1 ? 1 : kf > 6 ? 6 : kf) - 1;
        const heavy = counts[eo | ROOK] + counts[eo | QUEEN];
        const ownPawn = o | PAWN;
        // shield and storm belong to a king tucked away on a wing (a–c or f–h); a king still on d or e has neither
        const sheltered = rk <= 1 && (kf <= 2 || kf >= 5);
        for (let f = first; f < first + 3; f++) {
            const own = pf[o + f];
            const opp = pf[eo + f];
            if (sheltered) {
                const r2 = c ? 6 : 1;
                const r3 = c ? 5 : 2;
                if (own & (1 << r2)) t.add(SHIELD, c, WMG[W_RANK2], WEG[W_RANK2], (r2 << 4) | f);
                else if (own & (1 << r3)) t.add(SHIELD, c, WMG[W_RANK3], WEG[W_RANK3], (r3 << 4) | f);
                if (opp) {
                    // the enemy pawn of the file nearest to the king
                    const r = c ? 31 - Math.clz32(opp) : 31 - Math.clz32(opp & -opp);
                    const rel = c ? 7 - r : r;
                    if (rel >= 2 && rel <= 3) {
                        const sq = (r << 4) | f;
                        if (b[c ? sq + 16 : sq - 16] === ownPawn) t.add(STORM, e, WMG[W_BLOCKED], WEG[W_BLOCKED], sq);
                        else t.add(STORM, e, STORM_MG[rel], STORM_EG[rel], sq);
                    }
                }
            }
            if (!own && heavy) {
                if (opp) t.add(OPEN_FILE, c, WMG[W_SEMI], WEG[W_SEMI], ksq);
                else t.add(OPEN_FILE, c, WMG[W_OPEN], WEG[W_OPEN], ksq);
            }
        }
        const n = ctx.kingAttackers[c];
        if (n) {
            const share = KING_ATTACK_SHARE[n > 7 ? 7 : n];
            const mg = (ctx.kingAttackMg[c] * share) >> 6;
            const eg = (ctx.kingAttackEg[c] * share) >> 6;
            if (mg || eg) {
                t.add(ATTACK, c, mg, eg);
                if (t.detail) for (let k = 0; k < n; k++) t.mark(ATTACK, c, ctx.kingAttackSquares[c * 16 + k]);
            }
        }
    }
}

/**
 * The kings and the passed pawns: for each passer, its own king near the square in front of it is good, the enemy king
 * near it is bad for the passer's side, and more so the further the pawn has gone.
 */
export function kingActivity(pos, t, ctx) {
    const dist = ctx.dist;
    for (let c = 0; c < 2; c++) {
        const pack = ctx.passed[c];
        if (!pack) continue;
        const own = pos.kings[c];
        const their = pos.kings[c ^ 1];
        let mg = 0;
        let eg = 0;
        for (let f = 0; f < 8; f++) {
            const r = (pack >> (f << 2)) & 15;
            if (!r) continue;
            const rr = c ? 7 - r : r;
            const weight = PASSER_KING_RANK[rr];
            if (!weight) continue;
            const stop = ((c ? r - 1 : r + 1) << 4) | f;
            const near = dist[own - stop + 119];
            const far = dist[their - stop + 119];
            mg += weight * (WMG[W_THEIR] * far - WMG[W_OWN] * near);
            eg += weight * (WEG[W_THEIR] * far - WEG[W_OWN] * near);
        }
        if (mg || eg) t.add(ACTIVITY, c, mg, eg, own);
    }
}
