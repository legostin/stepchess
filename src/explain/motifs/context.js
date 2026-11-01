// explain/motifs/context — the move and its line played out once: a snapshot before every ply, the material, the end, the proofs of gain.
//
// A detector looks at one ply of the sequence [move, ...line]. Its context holds the position before that ply (prev) and
// after it (pos), the rest of the line, attack maps, and the two ways a motif proves that it wins something:
//   - along the line: the material the side gains from before its move to the end of the line, with the exchange still
//     pending at the end counted by SEE, and a mate at the end counted as a mate;
//   - statically, when the line is over: every legal reply of the opponent leaves the side a capture that wins.
// Snapshots are clones: detectors may make and unmake moves on them, as long as they put them back.
import { WHITE, F_CAPTURE, F_EP, legalMoves, see, attackMaps, moveFrom, moveTo, moveFlags, movePromo } from '../../core/index.js';
import { trace } from '../../eval/index.js';
import { material, isMate, mateInOne, bestCapture, changesMaterial, withMove, MATE_GAIN, WIN } from './util.js';

/**
 * The sequence played out from pos: {seq, snaps, mats, end} where snaps[k] is a copy of the position before seq[k]
 * (snaps[seq.length] the last), or null when the move is not legal. The line stops at its first illegal move.
 */
export function playOut(pos, move, line) {
    const work = pos.clone();
    if (!legalMoves(work).includes(move)) return null;
    const seq = [move];
    for (const m of Array.isArray(line) ? line : []) seq.push(m);
    const snaps = [work.clone()];
    let n = 0;
    for (; n < seq.length; n++) {
        if (n > 0 && !legalMoves(work).includes(seq[n])) break;
        work.make(seq[n]);
        snaps.push(work.clone());
    }
    seq.length = n;
    const last = snaps[n];
    const mated = isMate(last);
    // the side to move at the end may mate at once; its best capture counts only when it does not walk into a mate
    const mates = !mated && mateInOne(last) !== 0;
    let pending = mated || mates ? { see: 0, move: 0 } : bestCapture(last);
    if (pending.move && withMove(last, pending.move, (p) => mateInOne(p) !== 0)) pending = { see: 0, move: 0 };
    return { seq, snaps, mats: snaps.map(material), end: { side: last.side, mated, mates, pending } };
}

/** The context of ply i of a played-out sequence. */
export function plyContext(play, i, opts = {}) {
    const { seq, snaps } = play;
    const prev = snaps[i];
    const pos = snaps[i + 1];
    const move = seq[i];
    const from = moveFrom(move);
    const to = moveTo(move);
    const flags = moveFlags(move);
    const mover = prev.side;
    const opp = mover ^ 1;
    const piece = prev.board[from];
    const captured = flags & F_EP ? (opp << 3) | 1 : flags & F_CAPTURE ? prev.board[to] : 0;
    let maps = null;
    let prevMaps = null;
    let mate = null;
    const traces = {};
    const ctx = {
        play,
        i,
        ply: i,
        seq,
        prev,
        pos,
        move,
        from,
        to,
        flags,
        promo: movePromo(move),
        piece,
        placed: pos.board[to],
        captured,
        mover,
        opp,
        line: seq.slice(i + 1),
        check: pos.inCheck(),
        search: opts.search,
        get maps() {
            return (maps ??= attackMaps(pos));
        },
        get prevMaps() {
            return (prevMaps ??= attackMaps(prev));
        },
        get mate() {
            return (mate ??= ctx.check && legalMoves(pos).length === 0);
        },
        /** The position before seq[i + k] (k = 0 is prev, 1 is pos), or undefined past the end. */
        at: (k) => snaps[i + k],
        /** The move seq[i + k], or undefined past the end. */
        mv: (k) => seq[i + k],
        /** The last position of the line. */
        final: snaps[snaps.length - 1],
        /** Is the position after seq[i + k − 1] a mate (k = 1: after this move)? */
        matedAt: (k) => {
            const s = snaps[i + k];
            return s !== undefined && (i + k === seq.length ? play.end.mated : isMate(s));
        },
        /** The material the color gains from before this ply to the end of the line (a mate counts as MATE_GAIN). */
        gain: (color = mover) => gainFrom(play, i, color),
        /** Does the line end with the opponent of the side mated? */
        endsInMate: () => play.end.mated && play.end.side === opp,
        /** The evaluation traces: 'before' the move, 'after' it at the end of the line, 'now' right after the move. */
        trace: (which) =>
            (traces[which] ??= which === 'before' ? (opts.before ?? trace(snaps[0])) : which === 'after' ? (opts.after ?? trace(ctx.final)) : trace(pos)),
    };
    return ctx;
}

/**
 * The material the color gains from snaps[i] to the end of the line, the pending exchange counted. A mate is MATE_GAIN,
 * and so is a mate in one left to the side to move at the end (a line that walks into it is lost).
 */
export function gainFrom(play, i, color) {
    const { end, mats } = play;
    if (end.mated) return end.side === color ? -MATE_GAIN : MATE_GAIN;
    if (end.mates) return end.side === color ? MATE_GAIN : -MATE_GAIN;
    const sign = color === WHITE ? 1 : -1;
    const pend = end.pending.see;
    return sign * (mats[mats.length - 1] - mats[i]) + (end.side === color ? pend : -pend);
}

/**
 * Does every legal reply in pos (the opponent of color to move) leave color a gain of at least `need` since `base` (White's
 * material then)? The gain after a reply is the material change plus color's best capture, on the target squares only
 * when targets(pos, reply) gives them. wins(pos) may declare a reply lost outright (a mate it allows). False when there is
 * no reply at all.
 */
export function everyReplyLoses(pos, color, base, need = WIN, targets = null, wins = null) {
    const replies = legalMoves(pos);
    if (!replies.length) return false;
    const sign = color === WHITE ? 1 : -1;
    for (const r of replies) {
        pos.make(r);
        let ok;
        try {
            if (wins && wins(pos)) ok = true;
            else {
                const onto = targets ? targets(pos, r) : null;
                const best = onto && !onto.length ? { see: 0, move: 0 } : bestCapture(pos, onto);
                ok = sign * (material(pos) - base) + best.see >= need;
                // a capture that walks into a mate in one wins nothing
                if (ok && best.move && withMove(pos, best.move, (p) => mateInOne(p) !== 0)) ok = false;
            }
        } finally {
            pos.unmake();
        }
        if (!ok) return false;
    }
    return true;
}

/**
 * Targets that stay put: given [{sq, piece}], the squares that still hold their piece after a reply. With follow, a
 * target that moves is followed to its new square.
 */
export function targetsOf(list, follow = false) {
    return (pos, reply) =>
        list
            .map((t) => (follow && moveFrom(reply) === t.sq ? { sq: moveTo(reply), piece: t.piece } : t))
            .filter((t) => pos.board[t.sq] === t.piece)
            .map((t) => t.sq);
}

/**
 * Does the side of ply i capture one of the targets ([{sq, piece}]) with one of its next two moves of the line, the
 * target still in place (followed when it moves, with follow)? When the line stops before, the pending capture at its end
 * counts.
 */
export function hitsTarget(ctx, list, follow = false) {
    const { play, i } = ctx;
    const n = play.seq.length;
    let cur = list.map((t) => ({ ...t }));
    for (let k = 1; k <= 4; k++) {
        const j = i + k;
        if (j > n) break;
        const state = play.snaps[j];
        cur = cur.filter((t) => state.board[t.sq] === t.piece);
        if (!cur.length) return false;
        const side = k % 2 === 0;
        if (j === n) {
            if (!side) return false;
            const m = play.end.pending.move;
            return m !== 0 && play.end.pending.see > 0 && cur.some((t) => t.sq === moveTo(m));
        }
        const m = play.seq[j];
        if (side) {
            if (changesMaterial(m) && cur.some((t) => t.sq === moveTo(m))) return true;
        } else if (follow) cur = cur.map((t) => (moveFrom(m) === t.sq ? { sq: moveTo(m), piece: t.piece } : t));
    }
    return false;
}

/**
 * The proof that a threat wins: along the line, a gain of at least `need` and one of the targets taken (or a mate at the
 * end, when anyGain); without a line, every reply loses. targets null: any gain will do.
 */
export function confirm(ctx, targets, { need = WIN, follow = false, wins = null } = {}) {
    const list = targets ? targets.map((sq) => ({ sq, piece: ctx.pos.board[sq] })) : null;
    if (!ctx.line.length) return everyReplyLoses(ctx.pos, ctx.mover, ctx.play.mats[ctx.i], need, list ? targetsOf(list, follow) : null, wins);
    if (ctx.gain() < need) return false;
    if (!list) return true;
    return hitsTarget(ctx, list, follow);
}

/** The static exchange value of a move in a position (0 for a missing move). */
export const seeOf = (pos, m) => (m ? see(pos, m) : 0);
