// eval/terms/threats — what is under attack: hanging pieces, pieces a pawn attacks, and one piece attacking two targets at once.
import { PAWN, KING } from '../../core/index.js';
import { T, WMG, WEG, S } from '../params.js';

const HANGING = T['hanging-piece'];
const PAWN_THREAT = T['pawn-threat'];
const DOUBLE = T['double-attack'];
const W_HANGING = S['hanging-piece'];
const W_PAWN_THREAT = S['pawn-threat'];
const W_DOUBLE = S['double-attack'];

// the rough worth of a piece type for "attacked by something cheaper": pawn 1, minor 3, rook 5, queen 9, king above all
const WORTH = Int8Array.of(0, 1, 3, 3, 5, 9, 100);

/**
 * The bonuses of the attacking side: an enemy knight, bishop, rook or queen that it attacks and nobody defends; one that
 * a pawn of it attacks; and a double attack — a piece or a pawn hitting two targets at once, each one the king, a piece
 * worth more than the attacker, or a piece nobody defends.
 */
export function threats(pos, t, ctx) {
    const b = pos.board;
    const att = ctx.att;
    const patt = ctx.patt;
    const list = ctx.list;
    const targets = ctx.targets;
    for (let i = 0; i < ctx.n; i++) {
        const sq = list[i];
        const p = b[sq];
        const c = p >> 3;
        const e = c ^ 1;
        const type = p & 7;
        if (att[(e << 7) + sq] && !att[(c << 7) + sq]) t.add(HANGING, e, WMG[W_HANGING], WEG[W_HANGING], sq);
        if (patt[(e << 7) + sq]) t.add(PAWN_THREAT, e, WMG[W_PAWN_THREAT], WEG[W_PAWN_THREAT], sq);
        const nt = ctx.targetCount[i];
        if (nt >= 2) {
            let hits = 0;
            for (let k = 0; k < nt; k++) {
                const s = targets[i * 8 + k];
                const victim = b[s] & 7;
                if (victim === KING || WORTH[victim] > WORTH[type] || !att[(e << 7) + s]) hits++;
            }
            if (hits >= 2) t.add(DOUBLE, c, WMG[W_DOUBLE], WEG[W_DOUBLE], sq);
        }
    }
    // a pawn fork: a pawn hitting two pieces
    const all = ctx.all;
    for (let i = 0; i < ctx.nAll; i++) {
        const sq = all[i];
        const p = b[sq];
        if ((p & 7) !== PAWN) continue;
        const c = p >> 3;
        const up = c ? sq - 16 : sq + 16;
        let hits = 0;
        for (let d = -1; d <= 1; d += 2) {
            const s = up + d;
            if (s & 0x88) continue;
            const q = b[s];
            if (q && q >> 3 !== c && (q & 7) !== PAWN) hits++;
        }
        if (hits === 2) t.add(DOUBLE, c, WMG[W_DOUBLE], WEG[W_DOUBLE], sq);
    }
}
