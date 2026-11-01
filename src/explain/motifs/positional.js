// explain/motifs/positional — the positional motifs: outposts, holes, open files, pawn structure, prophylaxis, kings in the endgame, zugzwang, fortresses.
//
// They speak about the move itself (ply 0 of the sequence). The pawn structure is compared between the position before
// the move and the end of the line, the rest is read off the board right after the move, the fortress off the evaluation
// traces (before the move and at the end of the line), and zugzwang asks the search it is given: without one it is not
// detected.
import { WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_CASTLE, legalMoves, see, moveFrom, moveTo } from '../../core/index.js';
import {
    pieceAttacks,
    relRank,
    distance,
    centreDistance,
    isPassed,
    isIsolated,
    pawnsOf,
    phaseOf,
    kingsAndPawns,
    material,
    isCapture,
    firstAlong,
    slideDirs,
    withNull,
    found,
} from './util.js';
import { TACTIC_DETECTORS } from './tactics.js';
import { playOut, plyContext } from './context.js';

const positional = (ctx, key, parts) => found(ctx, key, 'positional', parts);
const fileOf = (s) => s & 7;
const isPawnMove = (ctx) => (ctx.piece & 7) === PAWN;
const quiet = (ctx) => !isCapture(ctx.move) && !ctx.check && !ctx.promo && !(ctx.flags & F_CASTLE);
// does the moved piece threaten a capture that wins? (then the move is an attack, not a quiet improvement)
const threatens = (ctx) => withNull(ctx.pos.clone(), (p) => legalMoves(p).some((m) => moveFrom(m) === ctx.to && isCapture(m) && see(p, m) > 0)) === true;

// a square no pawn of the color can ever attack again: no pawn of it on a neighbouring file behind the square
function beyondPawns(b, sq, color) {
    const own = (color << 3) | PAWN;
    const r = relRank(sq, color);
    for (const df of [-1, 1]) {
        const f = fileOf(sq) + df;
        if (f < 0 || f > 7) continue;
        for (let rank = 0; rank < 8; rank++) {
            const s = (rank << 4) | f;
            if (b[s] === own && relRank(s, color) < r) return false;
        }
    }
    return true;
}

// is the square an outpost for the color: in the enemy half (ranks 5–6 from its side), guarded by its pawn, out of reach of enemy pawns?
function isOutpost(b, sq, color) {
    const r = relRank(sq, color);
    if (r < 4 || r > 5) return false;
    const own = (color << 3) | PAWN;
    const back = color === WHITE ? -16 : 16;
    const guarded = [sq + back - 1, sq + back + 1].some((s) => (s & 0x88) === 0 && b[s] === own);
    return guarded && beyondPawns(b, sq, color ^ 1);
}

/** Outpost: a knight or bishop settles on a square in the enemy half that its pawn guards and no enemy pawn can attack. */
function outpost(ctx) {
    const t = ctx.placed & 7;
    if ((t !== KNIGHT && t !== BISHOP) || ctx.promo) return null;
    const b = ctx.pos.board;
    if (!isOutpost(b, ctx.to, ctx.mover) || isOutpost(ctx.prev.board, ctx.from, ctx.mover)) return null;
    if (see(ctx.prev, ctx.move) < 0) return null;
    const r1 = ctx.mv(1);
    if (r1 !== undefined && moveTo(r1) === ctx.to) return null;
    return positional(ctx, 'outpost', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'best' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [] },
    });
}

/** Weak square: a pawn move leaves a square of its own camp that no pawn can guard any more, and the enemy already eyes it. */
function weakSquare(ctx) {
    if (!isPawnMove(ctx)) return null;
    const before = ctx.prev.board;
    const b = ctx.pos.board;
    const files = new Set([fileOf(ctx.from) - 1, fileOf(ctx.from) + 1, fileOf(ctx.to) - 1, fileOf(ctx.to) + 1]);
    const king = ctx.pos.kings[ctx.mover];
    for (const f of [...files].sort()) {
        if (f < 0 || f > 7) continue;
        for (let r = 2; r <= 4; r++) {
            const sq = ctx.mover === WHITE ? (r << 4) | f : ((7 - r) << 4) | f;
            if ((b[sq] & 7) === PAWN && b[sq] >> 3 === ctx.mover) continue;
            if (beyondPawns(before, sq, ctx.mover) || !beyondPawns(b, sq, ctx.mover)) continue;
            if (!(f >= 2 && f <= 5) && Math.abs(f - fileOf(king)) > 2) continue;
            if (ctx.maps.count[ctx.opp][sq] <= ctx.maps.count[ctx.mover][sq]) continue;
            return positional(ctx, 'weak-square', {
                pieces: [ctx.to],
                squares: [sq],
                arrows: [],
                params: { piece: ctx.placed, square: sq, targets: [] },
            });
        }
    }
    return null;
}

const openFile = (b, f) => {
    for (let r = 0; r < 8; r++) if ((b[(r << 4) | f] & 7) === PAWN) return false;
    return true;
};

// is there a pawn of either side on the board?
const anyPawn = (b) => {
    for (let sq = 0; sq < 128; sq++) if (!(sq & 0x88) && (b[sq] & 7) === PAWN) return true;
    return false;
};

/**
 * Open file: a rook takes a file free of pawns, or a pawn exchange opens the file of a rook. Never on a board without
 * pawns, where every file is open and taking one says nothing.
 */
function openFileMotif(ctx) {
    const b = ctx.pos.board;
    const before = ctx.prev.board;
    if (!anyPawn(b)) return null;
    const rook = (ctx.mover << 3) | ROOK;
    let sq = -1;
    if (ctx.placed === rook && !(ctx.flags & F_CASTLE)) {
        if (openFile(b, fileOf(ctx.to)) && !(fileOf(ctx.from) === fileOf(ctx.to) && openFile(before, fileOf(ctx.from))) && see(ctx.prev, ctx.move) >= 0)
            sq = ctx.to;
    } else if (isPawnMove(ctx) && fileOf(ctx.from) !== fileOf(ctx.to)) {
        const f = fileOf(ctx.from);
        const end = settled(ctx);
        if (!openFile(before, f) && openFile(end, f)) for (let r = 0; r < 8 && sq < 0; r++) if (end[(r << 4) | f] === rook) sq = (r << 4) | f;
    }
    if (sq < 0) return null;
    return positional(ctx, 'open-file', {
        pieces: [sq],
        squares: [sq],
        arrows: [],
        params: { piece: rook, square: sq, targets: [] },
    });
}

// the board once the move's own exchanges and pawn play are over: the line is followed while it captures or moves pawns
// (a long line changes the structure for reasons the move has nothing to do with)
function settled(ctx) {
    const { seq, snaps } = ctx.play;
    let j = ctx.i + 1;
    while (j < seq.length && (isCapture(seq[j]) || (snaps[j].board[moveFrom(seq[j])] & 7) === PAWN)) j++;
    return snaps[j].board;
}

const isolatedOf = (b, color) => pawnsOf(b, color).filter((s) => isIsolated(b, s, color));
const near = (ctx, sq) => Math.min(Math.abs(fileOf(sq) - fileOf(ctx.from)), Math.abs(fileOf(sq) - fileOf(ctx.to))) <= 2;

/** Isolated pawn: by the end of the line the move (a pawn move or a capture) has left a pawn with no neighbours, the enemy's or its own. */
function isolatedPawn(ctx) {
    if (!isPawnMove(ctx) && !isCapture(ctx.move)) return null;
    const before = ctx.prev.board;
    const end = settled(ctx);
    for (const color of [ctx.opp, ctx.mover]) {
        const was = isolatedOf(before, color);
        const now = isolatedOf(end, color);
        if (now.length <= was.length) continue;
        const fresh = now.find((s) => !was.includes(s) && near(ctx, s));
        if (fresh === undefined) continue;
        return positional(ctx, 'isolated-pawn', {
            pieces: [fresh],
            squares: [fresh],
            arrows: [],
            params: { piece: end[fresh], square: fresh, targets: [], owner: color === ctx.mover ? 'own' : 'enemy' },
        });
    }
    return null;
}

/** A passed pawn created: by the end of the line the side has a passer on a file where it had none. */
function passedPawnCreated(ctx) {
    if (!isPawnMove(ctx) && !isCapture(ctx.move)) return null;
    const before = ctx.prev.board;
    const end = settled(ctx);
    const had = new Set(
        pawnsOf(before, ctx.mover)
            .filter((s) => isPassed(before, s, ctx.mover))
            .map(fileOf),
    );
    // the new passed pawns, the one that moved first
    const all = pawnsOf(end, ctx.mover).filter((s) => isPassed(end, s, ctx.mover) && !had.has(fileOf(s)) && near(ctx, s));
    const fresh = all.includes(ctx.to) ? ctx.to : all[0];
    if (fresh === undefined) return null;
    return positional(ctx, 'passed-pawn-created', {
        pieces: [fresh],
        squares: [fresh],
        arrows: [],
        params: { piece: end[fresh], square: fresh, targets: [] },
    });
}

// the pawns of a color on files lo..hi
const wingPawns = (b, color, lo, hi) => pawnsOf(b, color).filter((s) => fileOf(s) >= lo && fileOf(s) <= hi).length;
// does a pawn of the color on sq attack an enemy pawn?
const hitsPawn = (b, sq, color) => pieceAttacks(b, sq).some((s) => b[s] === (((color ^ 1) << 3) | PAWN));

/** Minority attack: in the middlegame, the side advances a pawn on the wing where it has fewer pawns, to break up the larger group. */
function minorityAttack(ctx) {
    if (!isPawnMove(ctx) || isCapture(ctx.move) || ctx.promo) return null;
    const f = fileOf(ctx.to);
    if (f >= 3 && f <= 4) return null;
    const [lo, hi] = f <= 2 ? [0, 2] : [5, 7];
    const b = ctx.pos.board;
    const mine = wingPawns(b, ctx.mover, lo, hi);
    const theirs = wingPawns(b, ctx.opp, lo, hi);
    if (mine < 1 || theirs < mine + 1 || phaseOf(ctx.pos) < 10) return null;
    if (relRank(ctx.to, ctx.mover) < 3) return null;
    const up = ctx.mover === WHITE ? 16 : -16;
    const stop = ctx.to + up;
    const enemyPawn = (ctx.opp << 3) | PAWN;
    const contested = (stop & 0x88) === 0 && [stop + up - 1, stop + up + 1].some((s) => (s & 0x88) === 0 && b[s] === enemyPawn);
    if (!hitsPawn(b, ctx.to, ctx.mover) && !contested) return null;
    if (see(ctx.prev, ctx.move) < 0) return null;
    return positional(ctx, 'minority-attack', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'idea' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [] },
    });
}

/** Pawn break: a pawn steps up to hit an enemy pawn that holds the chain (guarded by a pawn, or locked against a pawn of the side). */
function pawnBreak(ctx) {
    if (!isPawnMove(ctx) || isCapture(ctx.move) || ctx.promo) return null;
    const b = ctx.pos.board;
    const enemy = (ctx.opp << 3) | PAWN;
    const own = (ctx.mover << 3) | PAWN;
    const down = ctx.opp === WHITE ? -16 : 16; // toward the enemy's own side
    const locked = (s) => ((s - down) & 0x88) === 0 && b[s - down] === own;
    const target = pieceAttacks(b, ctx.to).find((s) => {
        if (b[s] !== enemy) return false;
        const guarded = [s + down - 1, s + down + 1].some((g) => (g & 0x88) === 0 && b[g] === enemy);
        const holds = pieceAttacks(b, s).some((g) => b[g] === enemy && locked(g));
        return guarded || holds || locked(s);
    });
    if (target === undefined || see(ctx.prev, ctx.move) < 0) return null;
    return positional(ctx, 'pawn-break', {
        pieces: [ctx.to, target],
        squares: [target],
        arrows: [{ from: ctx.to, to: target, kind: 'attack' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [b[target]] },
    });
}

const THREATS = ['fork', 'pin-absolute', 'pin-relative', 'skewer'];

// the tactic the move would be for the side to move in pos (without a line), or null
function threatOf(pos, m) {
    const play = playOut(pos, m, []);
    if (!play) return null;
    const ctx = plyContext(play, 0);
    for (const key of THREATS) if (TACTIC_DETECTORS[key](ctx)) return key;
    return null;
}

// could the opponent's move be a fork, a pin or a skewer? (a cheap look before the real detectors)
function looksThreatening(pos, m) {
    pos.make(m);
    try {
        const b = pos.board;
        const to = moveTo(m);
        const me = b[to] >> 3;
        const hit = pieceAttacks(b, to).filter((s) => b[s] && b[s] >> 3 !== me && (b[s] & 7) !== PAWN);
        if (hit.length >= 2) return true;
        return slideDirs(b[to] & 7).some((d) => {
            const a = firstAlong(b, to, d);
            return a >= 0 && b[a] >> 3 !== me && firstAlong(b, a, d) >= 0 && b[firstAlong(b, a, d)] >> 3 !== me;
        });
    } finally {
        pos.unmake();
    }
}

/** Prophylaxis: a quiet move that takes away an enemy tactic (a fork, a pin, a skewer) that was there if the side had passed. */
function prophylaxis(ctx) {
    if (!quiet(ctx) || ctx.prev.inCheck() || threatens(ctx)) return null;
    const before = ctx.prev.clone();
    before.makeNull();
    const after = ctx.pos;
    const now = legalMoves(after);
    for (const m of legalMoves(before)) {
        if (!looksThreatening(before, m)) continue;
        const key = threatOf(before, m);
        if (!key) continue;
        if (now.includes(m) && threatOf(after, m)) continue;
        return positional(ctx, 'prophylaxis', {
            pieces: [ctx.to, moveFrom(m)],
            squares: [moveTo(m)],
            arrows: [
                { from: ctx.from, to: ctx.to, kind: 'best' },
                { from: moveFrom(m), to: moveTo(m), kind: 'threat' },
            ],
            params: { piece: ctx.placed, square: ctx.to, targets: [before.board[moveFrom(m)]], prevents: key, threat: [moveFrom(m), moveTo(m)] },
        });
    }
    return null;
}

// the squares a piece reaches that hold no piece of its own and no enemy pawn guards (the mobility of the evaluation)
function mobility(pos, sq) {
    const b = pos.board;
    const color = b[sq] >> 3;
    const enemyPawn = ((color ^ 1) << 3) | PAWN;
    const back = color === WHITE ? 16 : -16; // an enemy pawn guards s from s + back ± 1
    return pieceAttacks(b, sq).filter((s) => {
        if (b[s] && b[s] >> 3 === color) return false;
        return ![s + back - 1, s + back + 1].some((g) => (g & 0x88) === 0 && b[g] === enemyPawn);
    }).length;
}

// the squares pieces start on, from White's side
const HOME = { [KNIGHT]: [0x01, 0x06], [BISHOP]: [0x02, 0x05], [ROOK]: [0x00, 0x07], [QUEEN]: [0x03] };

/** Piece improvement: a quiet move that takes a cramped piece (not yet from its home square) to a square where it does far more. */
function pieceImprovement(ctx) {
    const t = ctx.piece & 7;
    if (!quiet(ctx) || !HOME[t]) return null;
    const rel = ctx.mover === WHITE ? ctx.from : ctx.from ^ 0x70;
    if (HOME[t].includes(rel)) return null;
    if (see(ctx.prev, ctx.move) < 0 || threatens(ctx)) return null;
    const r1 = ctx.mv(1);
    if (r1 !== undefined && moveTo(r1) === ctx.to) return null;
    const was = mobility(ctx.prev, ctx.from);
    const now = mobility(ctx.pos, ctx.to);
    if (now - was < 3 || now < 2 * was) return null;
    return positional(ctx, 'piece-improvement', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'best' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [], mobility: [was, now] },
    });
}

// the closest pawn to a square, by king steps (Infinity without pawns)
function nearestPawn(b, sq) {
    let best = Infinity;
    for (let s = 0; s < 120; s++) if ((s & 0x88) === 0 && (b[s] & 7) === PAWN) best = Math.min(best, distance(s, sq));
    return best;
}

/** King activation: in the endgame the king, not in check, walks toward the centre or toward the pawns. */
function kingActivation(ctx) {
    if ((ctx.piece & 7) !== KING || ctx.flags & F_CASTLE || ctx.prev.inCheck() || phaseOf(ctx.pos) > 6) return null;
    const central = centreDistance(ctx.to) < centreDistance(ctx.from);
    const b = ctx.pos.board;
    const closer = nearestPawn(b, ctx.to) < nearestPawn(ctx.prev.board, ctx.from) && nearestPawn(b, ctx.to) <= 2;
    if (!central && !closer) return null;
    return positional(ctx, 'king-activation', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'best' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [] },
    });
}

/** Opposition: in a pawn ending the king steps in front of the other one, an odd number of squares between them, the opponent to move. */
function opposition(ctx) {
    if ((ctx.piece & 7) !== KING || ctx.flags & F_CASTLE || !kingsAndPawns(ctx.pos)) return null;
    const b = ctx.pos.board;
    if (!pawnsOf(b, WHITE).length && !pawnsOf(b, 1).length) return null;
    const a = ctx.to;
    const k = ctx.pos.kings[ctx.opp];
    const df = Math.abs(fileOf(a) - fileOf(k));
    const dr = Math.abs((a >> 4) - (k >> 4));
    // direct opposition (one square between, on a line or a diagonal) or distant opposition on a file or a rank
    const straight = df === 0 || dr === 0;
    const gap = straight ? Math.max(df, dr) - 1 : df === dr ? df - 1 : -1;
    if (gap < 1 || gap % 2 === 0 || (!straight && gap !== 1)) return null;
    return positional(ctx, 'opposition', {
        pieces: [a, k],
        squares: [a, k],
        arrows: [],
        params: { piece: ctx.placed, square: a, targets: [b[k]], distance: gap, kind: df && dr ? 'diagonal' : gap === 1 ? 'direct' : 'distant' },
    });
}

/** Triangulation: in a pawn ending the king walks a triangle in three moves and the same position comes back with the other side to move. */
function triangulation(ctx) {
    const { seq, snaps } = ctx.play;
    if (seq.length < 5 || !kingsAndPawns(ctx.prev)) return null;
    const king = (ctx.mover << 3) | KING;
    const steps = [seq[0], seq[2], seq[4]];
    if (steps.some((m, j) => snaps[j * 2].board[moveFrom(m)] !== king)) return null;
    const [a, b, c] = steps.map(moveFrom);
    if (moveTo(steps[0]) !== b || moveTo(steps[1]) !== c || moveTo(steps[2]) !== a) return null;
    if (distance(a, b) !== 1 || distance(b, c) !== 1 || distance(a, c) !== 1) return null;
    const start = snaps[0].board;
    const back = snaps[5].board;
    for (let s = 0; s < 128; s++) if (start[s] !== back[s]) return null;
    return positional(ctx, 'triangulation', {
        pieces: [a],
        squares: [a, b, c],
        arrows: [
            { from: a, to: b, kind: 'idea' },
            { from: b, to: c, kind: 'idea' },
            { from: c, to: a, kind: 'idea' },
        ],
        params: { piece: king, square: a, targets: [] },
    });
}

/** Zugzwang: after the move, the opponent would be better off passing: the search finds its best move 1.5 pawns worse than a pass. */
function zugzwang(ctx) {
    const search = ctx.search;
    if (typeof search !== 'function' || ctx.check || ctx.mate) return null;
    const pos = ctx.pos.clone();
    if (!legalMoves(pos).length) return null;
    const best = search(pos.clone(), { depth: 6 }).score;
    pos.makeNull();
    const pass = -search(pos, { depth: 6 }).score;
    if (!(pass - best >= 150)) return null;
    return positional(ctx, 'zugzwang', {
        pieces: [ctx.to],
        squares: [ctx.pos.kings[ctx.opp]],
        arrows: [],
        params: { piece: ctx.placed, square: ctx.to, targets: [], loss: pass - best },
    });
}

const SCALERS = ['fortress', 'wrong-bishop'];
// a lone king, or a king and one minor piece, without pawns: no mate is possible, so there is no fortress to build
function cannotMate(pos, color) {
    const c = pos.counts;
    const o = color << 3;
    if (c[o | PAWN] || c[o | ROOK] || c[o | QUEEN]) return false;
    return c[o | KNIGHT] + c[o | BISHOP] <= 1;
}
const scaled = (trace) => trace.terms.find((t) => SCALERS.includes(t.key));

/** Fortress: the side that is behind in material reaches a set-up the stronger side cannot break (the evaluation scales its edge down). */
function fortress(ctx) {
    const sign = ctx.mover === WHITE ? 1 : -1;
    if (sign * material(ctx.prev) > -100 || phaseOf(ctx.final) > 4 || cannotMate(ctx.final, ctx.mover ^ 1)) return null;
    const before = ctx.trace('before');
    const after = ctx.trace('after');
    if (!(after.scale < 1) || scaled(before)) return null;
    const term = scaled(after);
    if (!term || sign * term.value <= 0) return null;
    const king = ctx.final.kings[ctx.mover];
    return positional(ctx, 'fortress', {
        pieces: [king],
        squares: term.squares.length ? term.squares : [king],
        arrows: [],
        params: { piece: (ctx.mover << 3) | KING, square: king, targets: [], term: term.key },
    });
}

/** The positional detectors by key, in the order of the dictionary. */
export const POSITIONAL_DETECTORS = {
    outpost,
    'weak-square': weakSquare,
    'open-file': openFileMotif,
    'isolated-pawn': isolatedPawn,
    'passed-pawn-created': passedPawnCreated,
    'minority-attack': minorityAttack,
    'pawn-break': pawnBreak,
    prophylaxis,
    'piece-improvement': pieceImprovement,
    'king-activation': kingActivation,
    opposition,
    triangulation,
    zugzwang,
    fortress,
};
