// eval/terms/endgame — endgame knowledge: driving the king to the right corner with bishop and knight, and the material that cannot win.
//
// kbnkCorner is an ordinary term. scaleOf is not: it reads the material once the other terms have summed up, and when the
// side ahead cannot really win — opposite bishops, a bishop of the wrong colour for a rook pawn, a lone minor piece, a
// small edge without pawns — it returns the factor (out of SCALE_ONE) the whole score is multiplied by, and names the
// term that did it in ctx.scaleKey. The trace shows that term with what the scaling took away.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN } from '../../core/index.js';
import { T, WMG, WEG, S, MAT_MG, SCALE_ONE, OCB_SCALE, SCALES, SC_WRONG_BISHOP, SC_LONE_MINOR, SC_SMALL_EDGE } from '../params.js';

const KBNK = T['kbnk-corner'];
const OPPOSITE = T['opposite-bishops'];
const WRONG = T['wrong-bishop'];
const FORTRESS = T.fortress;
const W_EDGE = S['kbnk-corner.edge'];
const W_CORNER = S['kbnk-corner.corner'];
const W_NEAR = S['kbnk-corner.near'];

// the color of a square: 0 dark (a1), 1 light
const colorOf = (sq) => ((sq >> 4) + sq) & 1;
// the steps a king needs to the centre (0 on d4–e5, 6 in a corner) and between two squares along files and ranks
const centreDistance = (sq) => {
    const f = sq & 7;
    const r = sq >> 4;
    return (f < 4 ? 3 - f : f - 4) + (r < 4 ? 3 - r : r - 4);
};
const manhattan = (a, b) => Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 4) - (b >> 4));

// the square of the first piece of a code (−1 when there is none)
function find(pos, ctx, piece) {
    const b = pos.board;
    for (let i = 0; i < ctx.nAll; i++) if (b[ctx.all[i]] === piece) return ctx.all[i];
    return -1;
}

/**
 * King, bishop and knight against a bare king: the mate comes only in a corner of the bishop's colour. The strong side
 * gains as the defending king nears the edge, more as it nears such a corner, and as its own king comes closer.
 */
export function kbnkCorner(pos, t, ctx) {
    const counts = pos.counts;
    for (let c = 0; c < 2; c++) {
        const o = c << 3;
        const eo = o ^ 8;
        if (counts[o | BISHOP] !== 1 || counts[o | KNIGHT] !== 1 || counts[o | PAWN] || counts[o | ROOK] || counts[o | QUEEN]) continue;
        if (counts[eo | PAWN] || counts[eo | KNIGHT] || counts[eo | BISHOP] || counts[eo | ROOK] || counts[eo | QUEEN]) continue;
        const dark = colorOf(find(pos, ctx, o | BISHOP)) === 0;
        const weak = pos.kings[c ^ 1];
        const a = dark ? 0x00 : 0x07;
        const h = dark ? 0x77 : 0x70;
        const da = manhattan(weak, a);
        const dh = manhattan(weak, h);
        const corner = da <= dh ? a : h;
        const near = 7 - Math.min(7, da <= dh ? da : dh);
        const edge = centreDistance(weak);
        const close = 7 - ctx.dist[pos.kings[c] - weak + 119];
        t.add(
            KBNK,
            c,
            edge * WMG[W_EDGE] + near * WMG[W_CORNER] + close * WMG[W_NEAR],
            edge * WEG[W_EDGE] + near * WEG[W_CORNER] + close * WEG[W_NEAR],
            corner,
        );
    }
}

/** The scale of the score (out of SCALE_ONE) when the side ahead, `strong`, has drawish material; sets ctx.scaleKey. */
export function scaleOf(pos, ctx, strong) {
    const counts = pos.counts;
    const so = strong << 3;
    const wo = so ^ 8;
    const sp = counts[so | PAWN];
    const wp = counts[wo | PAWN];
    const sn = counts[so | KNIGHT];
    const sb = counts[so | BISHOP];
    const sHeavy = counts[so | ROOK] + counts[so | QUEEN];
    const wn = counts[wo | KNIGHT];
    const wb = counts[wo | BISHOP];
    const wHeavy = counts[wo | ROOK] + counts[wo | QUEEN];
    ctx.scaleKey = -1;
    // bishops of opposite colours and nothing else but pawns: by the difference in pawns
    if (sb === 1 && wb === 1 && !sn && !wn && !sHeavy && !wHeavy) {
        if (colorOf(find(pos, ctx, so | BISHOP)) !== colorOf(find(pos, ctx, wo | BISHOP))) {
            const diff = Math.abs(sp - wp);
            ctx.scaleKey = OPPOSITE;
            return OCB_SCALE[diff > 3 ? 3 : diff];
        }
    }
    // These are rules of thumb for the search and the explanations; the tablebases (endgame/) hold the exact truth of
    // every position with up to four pieces.
    if (!sp) {
        // without pawns a lone minor piece cannot mate by force, nor can two knights against the bare king (with enemy
        // pawns on the board they can: the Troitsky line, so that stays unscaled)
        const bare = !wp && !wn && !wb && !wHeavy;
        if (!sHeavy && (sn + sb <= 1 || (sn === 2 && !sb && bare))) {
            ctx.scaleKey = FORTRESS;
            return SCALES[SC_LONE_MINOR];
        }
        const mine = sn * MAT_MG[KNIGHT] + sb * MAT_MG[BISHOP] + counts[so | ROOK] * MAT_MG[ROOK] + counts[so | QUEEN] * MAT_MG[QUEEN];
        const theirs = wn * MAT_MG[KNIGHT] + wb * MAT_MG[BISHOP] + counts[wo | ROOK] * MAT_MG[ROOK] + counts[wo | QUEEN] * MAT_MG[QUEEN];
        // an edge smaller than a rook rarely wins — except two bishops against a knight, a known win
        const bishopsVersusKnight = sb === 2 && !sn && !sHeavy && wn === 1 && !wb && !wHeavy;
        if (mine - theirs < MAT_MG[ROOK] && !bishopsVersusKnight) {
            ctx.scaleKey = FORTRESS;
            return SCALES[SC_SMALL_EDGE];
        }
        return SCALE_ONE;
    }
    // a bishop and pawns on one rook file against the bare king that holds the queening corner of the other colour
    if (sb === 1 && !sn && !sHeavy && !wp && !wn && !wb && !wHeavy) {
        const pf = ctx.pf;
        const file = pf[(strong << 3) + 0] && !pf[(strong << 3) + 7] ? 0 : pf[(strong << 3) + 7] && !pf[(strong << 3) + 0] ? 7 : -1;
        if (file >= 0) {
            let others = 0;
            for (let f = 1; f < 7; f++) others |= pf[(strong << 3) + f];
            const queening = strong ? file : 0x70 | file;
            if (!others && colorOf(queening) !== colorOf(find(pos, ctx, so | BISHOP)) && ctx.dist[pos.kings[strong ^ 1] - queening + 119] <= 1) {
                ctx.scaleKey = WRONG;
                return SCALES[SC_WRONG_BISHOP];
            }
        }
    }
    return SCALE_ONE;
}
