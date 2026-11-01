// eval/terms/space — the centre and the room behind the pawns.
import { PAWN } from '../../core/index.js';
import { T, WMG, WEG, S } from '../params.js';

const CENTER = T['center-control'];
const SPACE = T.space;
const W_CENTER = S['center-control'];
const W_SPACE = S.space;

// d4, e4, d5, e5
const CENTER_SQUARES = Int16Array.of(0x33, 0x34, 0x43, 0x44);
// the space area of each color: c–f on its second to fourth ranks, White's 12 squares then Black's
const AREA = new Int16Array(24);
for (let c = 0, k = 0; c < 2; c++) for (let rel = 1; rel <= 3; rel++) for (let f = 2; f <= 5; f++) AREA[k++] = ((c ? 7 - rel : rel) << 4) | f;

/** Control of the centre: the attacks of each side on d4, e4, d5 and e5, up to two on a square. */
export function centerControl(pos, t, ctx) {
    const att = ctx.att;
    for (let c = 0; c < 2; c++) {
        const o = c << 7;
        let n = 0;
        for (let k = 0; k < 4; k++) {
            const a = att[o + CENTER_SQUARES[k]];
            if (!a) continue;
            n += a > 2 ? 2 : a;
            if (t.detail) t.mark(CENTER, c, CENTER_SQUARES[k]);
        }
        if (n) t.add(CENTER, c, n * WMG[W_CENTER], n * WEG[W_CENTER]);
    }
}

/**
 * Space: the squares of the c–f files on a side's second to fourth ranks that hold no pawn of its own and that no enemy
 * pawn attacks — room for the pieces to stand and regroup.
 */
export function space(pos, t, ctx) {
    const b = pos.board;
    const patt = ctx.patt;
    for (let c = 0; c < 2; c++) {
        const e = (c ^ 1) << 7;
        const own = (c << 3) | PAWN;
        let n = 0;
        for (let k = c * 12; k < c * 12 + 12; k++) {
            const sq = AREA[k];
            if (b[sq] === own || patt[e + sq]) continue;
            n++;
            if (t.detail) t.mark(SPACE, c, sq);
        }
        if (n) t.add(SPACE, c, n * WMG[W_SPACE], n * WEG[W_SPACE]);
    }
}
