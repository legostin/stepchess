// explain/motifs/mates — the named mating patterns, read off the mated position: who gives check, who guards the flight squares, who blocks them.
//
// A mate detector fires only on the ply that mates. It looks at the king's neighbourhood: the squares its own pieces
// block, the squares the mating side covers (seen with the king lifted, so that a square behind the king on the line of
// check counts as covered) and the checking piece.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, attackersOf, moveTo } from '../../core/index.js';
import { KING_STEPS, attacks, attackersLifted, relRank, isOrtho, stepBetween, distance, found } from './util.js';

const typeAt = (b, s) => b[s] & 7;
const fileOf = (s) => s & 7;
const rankOf = (s) => s >> 4;
const isCorner = (s) => (fileOf(s) === 0 || fileOf(s) === 7) && (rankOf(s) === 0 || rankOf(s) === 7);
const squareColor = (s) => (rankOf(s) + fileOf(s)) & 1;

// the mated king and its surroundings (worked out once per context)
const NETS = new WeakMap();
function net(ctx) {
    if (!NETS.has(ctx)) NETS.set(ctx, ctx.mate ? surroundings(ctx) : null);
    return NETS.get(ctx);
}
function surroundings(ctx) {
    const pos = ctx.pos;
    const b = pos.board;
    const king = pos.kings[ctx.opp];
    const checkers = attackersOf(pos, king, ctx.mover);
    const around = [];
    for (const d of KING_STEPS) {
        const s = king + d;
        if (s & 0x88) continue;
        const p = b[s];
        const own = p !== 0 && p >> 3 === ctx.opp;
        around.push({ sq: s, own, cover: own ? [] : attackersLifted(pos, s, ctx.mover, king) });
    }
    // the main checker: the moved piece when it checks, else the first one
    const checker = checkers.includes(ctx.to) ? ctx.to : checkers[0];
    return { b, king, checkers, checker, around, free: around.filter((n) => !n.own) };
}

const mateMotif = (ctx, key, n, extra = [], params = {}) =>
    found(ctx, key, 'mate', {
        pieces: [n.checker, ...extra, n.king],
        squares: [n.king],
        arrows: [{ from: n.checker, to: n.king, kind: 'attack' }],
        params: { piece: n.b[n.checker], square: n.checker, targets: [n.b[n.king]], ...params },
    });

/** Back-rank mate: a rook or queen checks along the king's first rank; its own pawns in front of it take its air. */
function backRank(ctx) {
    const n = net(ctx);
    if (!n || relRank(n.king, ctx.opp) !== 0) return null;
    const c = n.checker;
    const t = typeAt(n.b, c);
    if ((t !== ROOK && t !== QUEEN) || rankOf(c) !== rankOf(n.king)) return null;
    const front = n.around.filter((a) => rankOf(a.sq) !== rankOf(n.king));
    const blocked = front.filter((a) => a.own).length;
    if (blocked < 2 || blocked < front.length - 1) return null;
    return mateMotif(ctx, 'mate-back-rank', n);
}

/** Smothered mate: a knight mates a king walled in on every side by its own pieces. */
function smothered(ctx) {
    const n = net(ctx);
    if (!n || n.checkers.some((s) => typeAt(n.b, s) !== KNIGHT) || n.free.length) return null;
    return mateMotif(ctx, 'mate-smothered', n);
}

/** Anastasia's mate: a knight covers the flight squares of a king on the edge file, and a rook or queen mates along it. */
function anastasia(ctx) {
    const n = net(ctx);
    if (!n) return null;
    const kf = fileOf(n.king);
    if (kf !== 0 && kf !== 7) return null;
    const c = n.checker;
    const t = typeAt(n.b, c);
    if ((t !== ROOK && t !== QUEEN) || fileOf(c) !== kf) return null;
    const inner = n.around.filter((a) => fileOf(a.sq) !== kf);
    const knights = new Set();
    let own = 0;
    for (const a of inner) {
        if (a.own) {
            own++;
            continue;
        }
        const k = a.cover.filter((s) => typeAt(n.b, s) === KNIGHT);
        if (!k.length) return null;
        k.forEach((s) => knights.add(s));
    }
    if (!own || !knights.size) return null;
    return mateMotif(ctx, 'mate-anastasia', n, [...knights]);
}

/** Arabian mate: in the corner, a rook next to the king mates, guarded by a knight. */
function arabian(ctx) {
    const n = net(ctx);
    if (!n || !isCorner(n.king)) return null;
    const c = n.checker;
    if (typeAt(n.b, c) !== ROOK || distance(c, n.king) !== 1 || !isOrtho(stepBetween(c, n.king))) return null;
    const knight = attackersOf(ctx.pos, c, ctx.mover).find((s) => typeAt(n.b, s) === KNIGHT);
    if (knight === undefined) return null;
    return mateMotif(ctx, 'mate-arabian', n, [knight]);
}

/** Boden's mate: two bishops on crossing diagonals mate a king boxed in by its own pieces. */
function boden(ctx) {
    const n = net(ctx);
    if (!n || typeAt(n.b, n.checker) !== BISHOP) return null;
    const bishops = new Set([n.checker]);
    for (const a of n.free) {
        const bs = a.cover.filter((s) => typeAt(n.b, s) === BISHOP);
        if (!bs.length) return null;
        bs.forEach((s) => bishops.add(s));
    }
    const colors = new Set([...bishops].map(squareColor));
    if (bishops.size < 2 || colors.size < 2) return null;
    return mateMotif(
        ctx,
        'mate-boden',
        n,
        [...bishops].filter((s) => s !== n.checker),
    );
}

/** Legal's mate: after the queen was given up, the minor pieces mate: a knight checks, knights and a bishop cover the rest. */
function legal(ctx) {
    const n = net(ctx);
    if (!n || typeAt(n.b, n.checker) !== KNIGHT || n.checkers.length !== 1) return null;
    const used = new Set([n.checker]);
    for (const a of n.free) {
        if (!a.cover.length || a.cover.some((s) => typeAt(n.b, s) !== KNIGHT && typeAt(n.b, s) !== BISHOP)) return null;
        a.cover.forEach((s) => used.add(s));
    }
    // a flight square held by the side's own piece counts too when that piece is guarded by a minor piece
    const types = [...used].map((s) => typeAt(n.b, s));
    if (types.filter((t) => t === KNIGHT).length < 2 || !types.includes(BISHOP)) return null;
    // the queen was given up earlier in the sequence
    const { seq, snaps } = ctx.play;
    const queen = (ctx.mover << 3) | QUEEN;
    let given = false;
    for (let j = ctx.i - 1; j >= 0; j -= 2) if (snaps[j].board[moveTo(seq[j])] === queen) given = true;
    if (!given) return null;
    return mateMotif(
        ctx,
        'mate-legal',
        n,
        [...used].filter((s) => s !== n.checker),
    );
}

/** Epaulette mate: the queen mates from the front a king whose own rooks stand on both sides of it. */
function epaulette(ctx) {
    const n = net(ctx);
    if (!n) return null;
    const k = n.king;
    if (fileOf(k) === 0 || fileOf(k) === 7) return null;
    const rook = (ctx.opp << 3) | ROOK;
    if (n.b[k - 1] !== rook || n.b[k + 1] !== rook) return null;
    const c = n.checker;
    if (typeAt(n.b, c) !== QUEEN || fileOf(c) !== fileOf(k) || distance(c, k) < 2) return null;
    return mateMotif(ctx, 'mate-epaulette', n, [k - 1, k + 1]);
}

/** Greco's mate: a king in the corner, a pawn of its own beside it, a bishop covering the last flight square, a rook or queen mating on the edge file. */
function greco(ctx) {
    const n = net(ctx);
    if (!n || !isCorner(n.king)) return null;
    const k = n.king;
    const c = n.checker;
    const t = typeAt(n.b, c);
    if ((t !== ROOK && t !== QUEEN) || fileOf(c) !== fileOf(k)) return null;
    const side = fileOf(k) === 0 ? 1 : -1;
    const up = rankOf(k) === 0 ? 16 : -16;
    const flight = k + side;
    const diag = k + side + up;
    if (n.b[diag] === 0 || n.b[diag] >> 3 !== ctx.opp) return null;
    if (n.b[flight] !== 0) return null;
    const bishop = attackersLifted(ctx.pos, flight, ctx.mover, k).find((s) => typeAt(n.b, s) === BISHOP);
    if (bishop === undefined) return null;
    return mateMotif(ctx, 'mate-greco', n, [bishop]);
}

/** Damiano's mate: the queen mates on the edge file beside the king, on its second rank, guarded by a pawn. */
function damiano(ctx) {
    const n = net(ctx);
    if (!n || relRank(n.king, ctx.opp) !== 0) return null;
    const k = n.king;
    const c = n.checker;
    if (typeAt(n.b, c) !== QUEEN || distance(c, k) !== 1 || relRank(c, ctx.opp) !== 1) return null;
    if (fileOf(c) !== 0 && fileOf(c) !== 7) return null;
    if (fileOf(k) !== (fileOf(c) === 0 ? 1 : 6)) return null;
    const pawn = attackersOf(ctx.pos, c, ctx.mover).find((s) => typeAt(n.b, s) === PAWN);
    if (pawn === undefined) return null;
    return mateMotif(ctx, 'mate-damiano', n, [pawn]);
}

/** Ladder mate: on the edge, one rook or queen checks along it and another holds the next line. */
function ladder(ctx) {
    const n = net(ctx);
    if (!n) return null;
    const k = n.king;
    const c = n.checker;
    const t = typeAt(n.b, c);
    if (t !== ROOK && t !== QUEEN) return null;
    const edges = [];
    if (rankOf(k) === 0 || rankOf(k) === 7) edges.push({ on: (s) => rankOf(s) === rankOf(k), inner: (s) => rankOf(s) === (rankOf(k) === 0 ? 1 : 6) });
    if (fileOf(k) === 0 || fileOf(k) === 7) edges.push({ on: (s) => fileOf(s) === fileOf(k), inner: (s) => fileOf(s) === (fileOf(k) === 0 ? 1 : 6) });
    for (const e of edges) {
        if (!e.on(c)) continue;
        const inner = n.around.filter((a) => e.inner(a.sq));
        if (inner.filter((a) => a.own).length > 1) continue;
        const holders = new Set();
        let ok = true;
        for (const a of inner) {
            if (a.own) continue;
            const h = a.cover.filter((s) => s !== c && e.inner(s) && (typeAt(n.b, s) === ROOK || typeAt(n.b, s) === QUEEN));
            if (!h.length) ok = false;
            h.forEach((s) => holders.add(s));
        }
        if (!ok || !holders.size) continue;
        return mateMotif(ctx, 'mate-ladder', n, [...holders]);
    }
    return null;
}

/** Corridor mate: a rook or queen mates along a line, the king walled in on both sides of it by its own pieces (not on its first rank: that is the back-rank mate). */
function corridor(ctx) {
    const n = net(ctx);
    if (!n) return null;
    const k = n.king;
    const c = n.checker;
    const t = typeAt(n.b, c);
    const d = stepBetween(c, k);
    if ((t !== ROOK && t !== QUEEN) || !isOrtho(d) || !attacks(n.b, c, k)) return null;
    const alongRank = d === 1 || d === -1;
    if (alongRank && relRank(k, ctx.opp) === 0) return null;
    const off = n.around.filter((a) => (alongRank ? rankOf(a.sq) !== rankOf(k) : fileOf(a.sq) !== fileOf(k)));
    if (off.length < 2 || off.some((a) => !a.own)) return null;
    return mateMotif(ctx, 'mate-corridor', n);
}

/** The mate detectors by key, in the order of the dictionary. */
export const MATE_DETECTORS = {
    'mate-back-rank': backRank,
    'mate-smothered': smothered,
    'mate-anastasia': anastasia,
    'mate-arabian': arabian,
    'mate-boden': boden,
    'mate-legal': legal,
    'mate-epaulette': epaulette,
    'mate-greco': greco,
    'mate-damiano': damiano,
    'mate-ladder': ladder,
    'mate-corridor': corridor,
};
