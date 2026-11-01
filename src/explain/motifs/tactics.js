// explain/motifs/tactics — the tactical motifs: forks, pins, skewers, discoveries, deflections and the rest, each proved on the board.
//
// Every detector takes the context of one ply (motifs/context) and returns a motif or null. A threat counts only when it
// pays: along the line by the material it wins (motifs/context confirm), without a line when every reply loses. When the
// proof is missing the detector stays silent.
import {
    PAWN,
    KNIGHT,
    BISHOP,
    ROOK,
    QUEEN,
    KING,
    F_CAPTURE,
    F_EP,
    F_CASTLE,
    encodeMove,
    legalMoves,
    see,
    attackersOf,
    moveFrom,
    moveTo,
    moveFlags,
    movePromo,
} from '../../core/index.js';
import {
    VALUE,
    WIN,
    KING_STEPS,
    firstAlong,
    pieceAttacks,
    attacks,
    slidesAlong,
    slideDirs,
    stepBetween,
    isBetween,
    isCapture,
    isMate,
    bestCapture,
    movesOf,
    withNull,
    withMove,
    relRank,
    distance,
    found,
} from './util.js';
import { confirm, everyReplyLoses, hitsTarget } from './context.js';

const tactic = (ctx, key, parts) => found(ctx, key, 'tactic', parts);
const codes = (b, squares) => squares.map((s) => b[s]);
const typeAt = (b, s) => b[s] & 7;
const isOpp = (ctx, p) => p !== 0 && p >> 3 === ctx.opp;
const isSlider = (t) => t === BISHOP || t === ROOK || t === QUEEN;

/** Fork: the moved piece attacks two targets at once (the king, or pieces worth more than it or left unguarded) and wins one. */
function fork(ctx) {
    const b = ctx.pos.board;
    const actor = b[ctx.to];
    const value = VALUE[actor & 7];
    const targets = [];
    for (const s of pieceAttacks(b, ctx.to)) {
        const p = b[s];
        if (!isOpp(ctx, p) || (p & 7) === PAWN) continue;
        if ((p & 7) === KING || VALUE[p & 7] > value || ctx.maps.count[ctx.opp][s] === 0) targets.push(s);
    }
    if (targets.length < 2) return null;
    const prizes = targets.filter((s) => typeAt(b, s) !== KING);
    if (!prizes.length || !confirm(ctx, prizes)) return null;
    return tactic(ctx, 'fork', {
        pieces: [ctx.to, ...targets],
        squares: targets,
        arrows: targets.map((s) => ({ from: ctx.to, to: s, kind: 'attack' })),
        params: { piece: actor, square: ctx.to, targets: codes(b, targets) },
    });
}

// was the piece on p1 already pinned (or skewered) against p2 along the step, by a slider of the side, before the move?
function linedUpBefore(ctx, p1, p2, d) {
    const b = ctx.prev.board;
    const pb = ctx.pos.board;
    if (b[p1] !== pb[p1] || b[p2] !== pb[p2] || firstAlong(b, p1, d) !== p2) return false;
    const s = firstAlong(b, p1, -d);
    return s >= 0 && b[s] >> 3 === ctx.mover && slidesAlong(b[s] & 7, d);
}

// the line from the moved slider through an enemy piece to the enemy piece behind it: [{d, front, back}]
function lines(ctx) {
    const b = ctx.pos.board;
    const type = ctx.placed & 7;
    const out = [];
    if (!isSlider(type)) return out;
    for (const d of slideDirs(type)) {
        const front = firstAlong(b, ctx.to, d);
        if (front < 0 || !isOpp(ctx, b[front])) continue;
        const back = firstAlong(b, front, d);
        if (back < 0 || !isOpp(ctx, b[back])) continue;
        if (linedUpBefore(ctx, front, back, d)) continue;
        out.push({ d, front, back });
    }
    return out;
}

// can the piece on `front` simply take the slider on `to` along the line without losing?
const takesBack = (ctx, front, d) => slidesAlong(typeAt(ctx.pos.board, front), d) && see(ctx.pos, encodeMove(front, ctx.to, F_CAPTURE)) >= 0;

/** Pins: the moved slider holds an enemy piece in front of its king (absolute) or of a piece worth more (relative). */
function pin(ctx, absolute) {
    const b = ctx.pos.board;
    const own = VALUE[ctx.placed & 7];
    if (see(ctx.prev, ctx.move) < 0) return null;
    for (const { d, front, back } of lines(ctx)) {
        const ft = typeAt(b, front);
        const bt = typeAt(b, back);
        if (ft === KING || ft === PAWN) continue;
        if (absolute) {
            if (bt !== KING) continue;
        } else if (bt === KING || VALUE[bt] <= VALUE[ft] || !(VALUE[bt] > own || ctx.maps.count[ctx.opp][back] === 0)) continue;
        if (takesBack(ctx, front, d)) continue;
        return tactic(ctx, absolute ? 'pin-absolute' : 'pin-relative', {
            pieces: [ctx.to, front, back],
            squares: [front, back],
            arrows: [
                { from: ctx.to, to: front, kind: 'attack' },
                { from: front, to: back, kind: 'idea' },
            ],
            params: { piece: ctx.placed, square: ctx.to, targets: codes(b, [front, back]), pinned: front },
        });
    }
    return null;
}

/** Skewer: the moved slider hits a valuable piece (or the king) with a lesser one behind it, and takes the one behind. */
function skewer(ctx) {
    const b = ctx.pos.board;
    for (const { d, front, back } of lines(ctx)) {
        const ft = typeAt(b, front);
        const bt = typeAt(b, back);
        if (ft === PAWN || bt === PAWN || bt === KING) continue;
        if (ft !== KING && VALUE[ft] <= VALUE[bt]) continue;
        if (ft !== KING && takesBack(ctx, front, d)) continue;
        // a king in check that can simply take the skewering piece
        if (ft === KING && legalMoves(ctx.pos).some((m) => moveFrom(m) === front && moveTo(m) === ctx.to)) continue;
        if (!confirm(ctx, [back])) continue;
        return tactic(ctx, 'skewer', {
            pieces: [ctx.to, front, back],
            squares: [front, back],
            arrows: [
                { from: ctx.to, to: front, kind: 'attack' },
                { from: front, to: back, kind: 'attack' },
            ],
            params: { piece: ctx.placed, square: ctx.to, targets: codes(b, [front, back]) },
        });
    }
    return null;
}

/** Discovered attack: the moved piece steps off the line of a slider of its own, which now hits a target; the double threat wins. */
function discoveredAttack(ctx) {
    const b = ctx.pos.board;
    if (ctx.flags & F_CASTLE) return null;
    for (const d of KING_STEPS) {
        const back = firstAlong(b, ctx.from, -d);
        const front = firstAlong(b, ctx.from, d);
        if (back < 0 || front < 0 || back === ctx.to || front === ctx.to) continue;
        const slider = b[back];
        if (slider >> 3 !== ctx.mover || !slidesAlong(slider & 7, d)) continue;
        const target = b[front];
        if (!isOpp(ctx, target) || (target & 7) === PAWN) continue;
        const tt = target & 7;
        if (!(tt === KING || VALUE[tt] > VALUE[slider & 7] || ctx.maps.count[ctx.opp][front] === 0)) continue;
        // what the double threat aims at: the uncovered target and what the moved piece attacks
        const prizes = tt === KING ? [] : [front];
        for (const s of pieceAttacks(b, ctx.to)) if (isOpp(ctx, b[s]) && typeAt(b, s) !== KING && typeAt(b, s) !== PAWN && !prizes.includes(s)) prizes.push(s);
        const ok = prizes.length ? confirm(ctx, prizes) : tt === KING && VALUE[ctx.captured & 7] >= VALUE[KNIGHT] && confirm(ctx, null);
        if (!ok) continue;
        return tactic(ctx, 'discovered-attack', {
            pieces: [back, ctx.to, front],
            squares: [front],
            arrows: [
                { from: back, to: front, kind: 'attack' },
                { from: ctx.from, to: ctx.to, kind: 'idea' },
            ],
            params: { piece: ctx.placed, square: ctx.to, targets: [target], slider, line: [back, front] },
        });
    }
    return null;
}

/** Double check: two pieces give check at once; only a king move answers it. */
function doubleCheck(ctx) {
    if (!ctx.check) return null;
    const king = ctx.pos.kings[ctx.opp];
    const checkers = attackersOf(ctx.pos, king, ctx.mover);
    if (checkers.length < 2) return null;
    const b = ctx.pos.board;
    return tactic(ctx, 'double-check', {
        pieces: [...checkers, king],
        squares: [king],
        arrows: checkers.map((s) => ({ from: s, to: king, kind: 'attack' })),
        params: { piece: ctx.placed, square: ctx.to, targets: [b[king]] },
    });
}

// the follow-up move seq[i + 2] pays on its square: a mate, or a capture the exchange wins
function pays(ctx) {
    const m2 = ctx.mv(2);
    if (m2 === undefined) return false;
    return ctx.matedAt(3) || (isCapture(m2) && see(ctx.at(2), m2) > 0);
}

// was the follow-up already good before the move (same piece, same victim)?
function paidBefore(ctx) {
    const m2 = ctx.mv(2);
    const s0 = ctx.prev.board;
    const s2 = ctx.at(2).board;
    const f = moveFrom(m2);
    const t = moveTo(m2);
    if (s0[f] !== s2[f] || s0[t] !== s2[t] || s0[f] >> 3 !== ctx.mover) return false;
    if (!legalMoves(ctx.prev).includes(m2)) return false;
    return withMove(ctx.prev, m2, (p) => isMate(p)) || (isCapture(m2) && see(ctx.prev, m2) >= WIN);
}

const won = (ctx) => ctx.gain() >= WIN;

// the move takes an enemy piece and the reply takes back on that square: the shape of an overload
function recaptured(ctx) {
    const r1 = ctx.mv(1);
    return r1 !== undefined && isCapture(ctx.move) && !(ctx.flags & F_EP) && moveTo(r1) === ctx.to && isCapture(r1);
}

/** Deflection: a forcing move drags a defender off its post, and the square it guarded falls. */
function deflection(ctx) {
    const r1 = ctx.mv(1);
    const m2 = ctx.mv(2);
    if (r1 === undefined || m2 === undefined) return null;
    const d = moveFrom(r1);
    const e = moveTo(r1);
    const s1 = ctx.pos.board;
    const defender = s1[d];
    // forcing: a check, a piece the defender must take back, or a threat to a defender worth more than the attacker
    const chased = attacks(s1, ctx.to, d) && VALUE[defender & 7] > VALUE[ctx.placed & 7];
    if (!(ctx.check || (e === ctx.to && isCapture(r1)) || chased)) return null;
    if (overloading(ctx)) return null; // the defender had two jobs: that is overloading
    const x = moveTo(m2);
    // the follow-up comes from another piece (when the same piece strikes twice it is a double attack)
    if (x === e || x === ctx.to || x === d || moveFrom(m2) === ctx.to) return null;
    if (!attacks(s1, d, x)) return null;
    const s2 = ctx.at(2).board;
    if (s2[e] === defender && attacks(s2, e, x)) return null;
    if (!pays(ctx) || paidBefore(ctx) || !won(ctx)) return null;
    return tactic(ctx, 'deflection', {
        pieces: [ctx.to, d],
        squares: [x, d],
        arrows: [
            { from: d, to: e, kind: 'idea' },
            { from: moveFrom(m2), to: x, kind: 'attack' },
        ],
        params: { piece: ctx.placed, square: x, targets: [defender] },
    });
}

/** Decoy: a sacrifice lures an enemy piece onto a square where it is struck next move. */
function decoy(ctx) {
    const r1 = ctx.mv(1);
    const m2 = ctx.mv(2);
    if (r1 === undefined || m2 === undefined || moveTo(r1) !== ctx.to || !isCapture(r1)) return null;
    if (see(ctx.prev, ctx.move) >= 0) return null;
    const s2 = ctx.at(2);
    const s3 = ctx.at(3);
    const lured = s2.board[ctx.to];
    if (lured >> 3 !== ctx.opp || ctx.prev.board[ctx.to] === lured) return null;
    const m2to = moveTo(m2);
    let hit;
    if (ctx.matedAt(3)) {
        // a mate: the king was drawn into it, or the lured piece takes a flight square of its own king
        hit = (lured & 7) === KING || (s3.board[ctx.to] === lured && distance(ctx.to, s3.kings[ctx.opp]) === 1);
    } else if ((lured & 7) === KING) {
        // the king is drawn into a check that is not a capture (a fork or a mating net comes next)
        hit = s3.inCheck() && !isCapture(m2);
    } else {
        // the lured piece is taken where it stands, at once or after the next check
        const m4 = ctx.mv(4);
        const s4 = ctx.at(4);
        hit = m2to === ctx.to || (m4 !== undefined && s4.board[ctx.to] === lured && moveTo(m4) === ctx.to && isCapture(m4));
    }
    if (!hit || !won(ctx)) return null;
    return tactic(ctx, 'decoy', {
        pieces: [ctx.to, moveFrom(r1)],
        squares: [ctx.to],
        arrows: [
            { from: moveFrom(r1), to: ctx.to, kind: 'idea' },
            { from: moveFrom(m2), to: m2to, kind: 'attack' },
        ],
        params: { piece: ctx.placed, square: ctx.to, targets: [lured] },
    });
}

/** Overloading: one defender guards two things; the move takes one, the defender recaptures, the other falls. */
function overloading(ctx) {
    if (!recaptured(ctx)) return null;
    const r1 = ctx.mv(1);
    const m2 = ctx.mv(2);
    if (m2 === undefined) return null;
    const d = moveFrom(r1);
    const s1 = ctx.pos;
    const defender = s1.board[d];
    const y = moveTo(m2);
    if (y === ctx.to || !attacks(ctx.prev.board, d, ctx.to)) return null;
    // the king does not count as a guard of a square the side hits twice
    const twice = attackersOf(s1, y, ctx.mover).length >= 2;
    const guards = attackersOf(s1, y, ctx.opp).filter((g) => !(twice && typeAt(s1.board, g) === KING));
    if (guards.length !== 1 || guards[0] !== d) return null;
    if (attacks(ctx.at(2).board, ctx.to, y)) return null;
    if (!pays(ctx) || !won(ctx)) return null;
    return tactic(ctx, 'overloading', {
        pieces: [d, ctx.to, y],
        squares: [ctx.to, y],
        arrows: [
            { from: d, to: ctx.to, kind: 'defend' },
            { from: d, to: y, kind: 'defend' },
        ],
        params: { piece: ctx.placed, square: y, targets: [defender] },
    });
}

/** Removing the defender: the move captures the piece that guarded something, and that something falls. */
function removeDefender(ctx) {
    if (!isCapture(ctx.move) || ctx.flags & F_EP) return null;
    const m2 = ctx.mv(2);
    if (m2 === undefined) return null;
    const defender = ctx.captured;
    if ((defender & 7) === KING) return null;
    if (see(ctx.prev, ctx.move) > WIN / 2) return null; // a capture that simply wins is not about the defender
    const y = moveTo(m2);
    if (y === ctx.to || !attacks(ctx.prev.board, ctx.to, y)) return null;
    if (!pays(ctx) || paidBefore(ctx) || !won(ctx)) return null;
    return tactic(ctx, 'remove-defender', {
        pieces: [ctx.to, y],
        squares: [ctx.to, y],
        arrows: [
            { from: ctx.from, to: ctx.to, kind: 'attack' },
            { from: moveFrom(m2), to: y, kind: 'attack' },
        ],
        params: { piece: ctx.placed, square: y, targets: [defender] },
    });
}

/** Interference: the moved piece stands in the line between an enemy slider and what it guarded, and that falls. */
function interference(ctx) {
    if (ctx.prev.board[ctx.to] || ctx.flags & F_CASTLE) return null;
    const s0 = ctx.prev.board;
    const s1 = ctx.pos.board;
    for (const d of KING_STEPS) {
        const guard = firstAlong(s1, ctx.to, -d);
        if (guard < 0 || !isOpp(ctx, s1[guard]) || !slidesAlong(s1[guard] & 7, d)) continue;
        // what the slider guarded through the square: the follow-up's square, or the piece behind (no line)
        let x;
        if (ctx.line.length) {
            const m2 = ctx.mv(2);
            if (m2 === undefined) continue;
            x = moveTo(m2);
            if (!isBetween(guard, ctx.to, x) || !attacks(s0, guard, x)) continue;
            const s2 = ctx.at(2).board;
            if (s2[guard] === s1[guard] && attacks(s2, guard, x)) continue;
            if (!pays(ctx) || paidBefore(ctx) || !won(ctx)) continue;
        } else {
            x = firstAlong(s1, ctx.to, d);
            if (x < 0 || !isOpp(ctx, s1[x]) || typeAt(s1, x) === KING || !attacks(s0, guard, x)) continue;
            if (bestCapture(ctx.prev, [x]).see > 0) continue;
            if (!confirm(ctx, [x])) continue;
        }
        return tactic(ctx, 'interference', {
            pieces: [ctx.to, guard],
            squares: [ctx.to, x],
            arrows: [{ from: guard, to: x, kind: 'defend' }],
            params: { piece: ctx.placed, square: ctx.to, targets: [s1[guard]] },
        });
    }
    return null;
}

/** X-ray: after a capture and the recapture, a slider that stood behind the recapturing piece takes back through it. */
function xray(ctx) {
    if (!recaptured(ctx)) return null;
    const r1 = ctx.mv(1);
    const m2 = ctx.mv(2);
    if (m2 === undefined || moveTo(m2) !== ctx.to || !isCapture(m2)) return null;
    const x = ctx.to;
    const via = moveFrom(r1);
    const from = moveFrom(m2);
    const s1 = ctx.pos.board;
    const slider = s1[from];
    const d = stepBetween(from, x);
    if (!slidesAlong(slider & 7, d) || !isBetween(from, via, x)) return null;
    if (firstAlong(s1, from, d) !== via || firstAlong(s1, via, d) !== x) return null;
    if (!won(ctx)) return null;
    return tactic(ctx, 'x-ray', {
        pieces: [from, via, x],
        squares: [x],
        arrows: [{ from, to: x, kind: 'attack' }],
        params: { piece: slider, square: x, targets: [s1[via]] },
    });
}

// the opponent's move just before this ply and the position before it: from the line, or from the position's history
function previousMove(ctx) {
    if (ctx.i > 0) {
        const before = ctx.play.snaps[ctx.i - 1];
        const m = ctx.seq[ctx.i - 1];
        const flags = moveFlags(m);
        return { move: m, captured: flags & F_EP ? (ctx.mover << 3) | PAWN : flags & F_CAPTURE ? before.board[moveTo(m)] : 0, before };
    }
    const p = ctx.prev;
    if (p.ply < 1 || p.uMove[p.ply - 1] === 0) return null;
    const before = p.clone();
    before.unmake();
    return { move: p.uMove[p.ply - 1], captured: p.uCap[p.ply - 1], before };
}

/** Zwischenzug: instead of the expected recapture, a forcing move first; the recapture follows and the side ends up better. */
function zwischenzug(ctx) {
    const last = previousMove(ctx);
    if (!last || !last.captured || last.captured >> 3 !== ctx.mover) return null;
    const c = moveTo(last.move);
    if (ctx.to === c || !(ctx.check || isCapture(ctx.move))) return null;
    const recaptures = legalMoves(ctx.prev).filter((m) => moveTo(m) === c && isCapture(m));
    if (!recaptures.length) return null;
    const expected = Math.max(...recaptures.map((m) => see(ctx.prev, m)));
    if (expected < 0) return null;
    const m2 = ctx.mv(2);
    if (m2 === undefined || moveTo(m2) !== c || !isCapture(m2)) return null;
    if (ctx.gain() < expected + WIN) return null;
    return tactic(ctx, 'zwischenzug', {
        pieces: [ctx.to, c],
        squares: [c],
        arrows: [
            { from: ctx.from, to: ctx.to, kind: 'best' },
            { from: moveFrom(m2), to: c, kind: 'idea' },
        ],
        params: { piece: ctx.placed, square: ctx.to, targets: [ctx.at(2).board[c]] },
    });
}

// the side to move's piece on sq is lost where it stands (the opponent, given the move, wins it) and has no safe square
function doomed(pos, sq) {
    const lost = withNull(pos, (p) => bestCapture(p, [sq]).see > 0);
    if (!lost) return false;
    return movesOf(pos, sq)
        .filter((m) => !isCapture(m))
        .every((m) => see(pos, m) < 0);
}

/** Desperado: a piece that is lost anyway takes something on its way out. */
function desperado(ctx) {
    if (!isCapture(ctx.move) || ctx.promo) return null;
    const t = ctx.piece & 7;
    // a piece, not a pawn, and a capture that does not simply win (then it is no act of despair)
    if (t === KING || t === PAWN || see(ctx.prev, ctx.move) > 0) return null;
    const taken = VALUE[ctx.captured & 7];
    if (taken < VALUE[PAWN] || taken >= VALUE[t] + 50) return null;
    if (!doomed(ctx.prev, ctx.from)) return null;
    const r1 = ctx.mv(1);
    const lost = r1 !== undefined ? moveTo(r1) === ctx.to && isCapture(r1) : bestCapture(ctx.pos, [ctx.to]).see > 0;
    if (!lost) return null;
    return tactic(ctx, 'desperado', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'attack' }],
        params: { piece: ctx.piece, square: ctx.to, targets: [ctx.captured] },
    });
}

// with the opponent to move: its piece on sq is attacked, staying loses it, every move of it loses it, and it has a move
function trapped(pos, sq) {
    const moves = movesOf(pos, sq);
    if (!moves.length) return false;
    if (moves.some((m) => see(pos, m) >= 0)) return false;
    return withNull(pos, (p) => bestCapture(p, [sq]).see >= WIN) === true;
}

/** Trapped piece: the move leaves an enemy piece without a safe square, and it is won. */
function trappedPiece(ctx) {
    if (ctx.check) return null;
    const b = ctx.pos.board;
    for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88 || !isOpp(ctx, b[sq])) continue;
        const t = b[sq] & 7;
        if (t === PAWN || t === KING || !ctx.maps.count[ctx.mover][sq]) continue;
        if (!trapped(ctx.pos, sq)) continue;
        // it was not trapped already before the move
        if (ctx.prev.board[sq] === b[sq] && withNull(ctx.prev, (p) => trapped(p, sq))) continue;
        const target = [{ sq, piece: b[sq] }];
        const ok = ctx.line.length ? ctx.gain() >= WIN && hitsTarget(ctx, target, true) : confirm(ctx, [sq], { follow: true });
        if (!ok) continue;
        return tactic(ctx, 'trapped-piece', {
            pieces: [sq],
            squares: [sq],
            arrows: [{ from: ctx.from, to: ctx.to, kind: 'idea' }],
            params: { piece: ctx.placed, square: sq, targets: [b[sq]] },
        });
    }
    return null;
}

/** Hanging piece: the move takes an enemy piece nobody guards. */
function hangingPiece(ctx) {
    if (!isCapture(ctx.move) || ctx.flags & F_EP) return null;
    const t = ctx.captured & 7;
    if (t === PAWN || t === KING) return null;
    // taking back on the square of the last capture is a recapture, not a piece left hanging, when that capture was a
    // fair exchange; a piece that grabbed something guarded and lost itself was hanging
    const last = previousMove(ctx);
    if (last && last.captured && moveTo(last.move) === ctx.to && last.before && see(last.before, last.move) > -WIN) return null;
    // an unguarded piece wins its whole value; a guarded one falls to a clearly lesser piece (not a knight for a bishop)
    // and still wins the difference
    const value = see(ctx.prev, ctx.move);
    const guarded = ctx.prevMaps.count[ctx.opp][ctx.to] > 0;
    const edge = VALUE[t] - VALUE[ctx.piece & 7];
    if (guarded ? edge < WIN || value < edge : value < VALUE[t]) return null;
    if (ctx.gain() < VALUE[t] / 2) return null;
    return tactic(ctx, 'hanging-piece', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'attack' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [ctx.captured] },
    });
}

// the enemy king of the side to move's opponent sits on its first rank behind a wall of its own: no square to step off
function boxedOnBackRank(pos, color, maps) {
    const k = pos.kings[color];
    if (relRank(k, color) !== 0) return false;
    const up = color === 0 ? 16 : -16;
    let own = 0;
    for (const df of [-1, 0, 1]) {
        const s = k + up + df;
        if (s & 0x88 || Math.abs((s & 7) - (k & 7)) > 1) continue;
        if (pos.board[s] && pos.board[s] >> 3 === color) own++;
        else if (!maps.count[color ^ 1][s]) return false;
    }
    return own >= 2;
}

/** Can the side to move mate at once with a rook or queen on the enemy first rank? */
export function backRankMate(pos) {
    const them = pos.side ^ 1;
    const rank = them === 0 ? 0 : 7;
    for (const m of legalMoves(pos)) {
        const t = typeAt(pos.board, moveFrom(m));
        if ((t !== ROOK && t !== QUEEN) || moveTo(m) >> 4 !== rank || movePromo(m)) continue;
        if (withMove(pos, m, (p) => isMate(p))) return true;
    }
    return false;
}

/** Back-rank weakness: the enemy king has no air, and the move wins because a capture or a defence would allow mate on the first rank. */
function backRankWeakness(ctx) {
    if (ctx.mate || !boxedOnBackRank(ctx.pos, ctx.opp, ctx.maps)) return null;
    const s1 = ctx.pos;
    // the move threatens mate on the back rank (it did not before)
    const threat = withNull(s1, (p) => backRankMate(p)) === true && !backRankMate(ctx.prev);
    // or taking the piece that moved would allow it
    const poisoned = legalMoves(s1).some((c) => moveTo(c) === ctx.to && isCapture(c) && see(s1, c) >= 0 && withMove(s1, c, (p) => backRankMate(p)));
    if (!threat && !poisoned) return null;
    const ok = ctx.line.length ? won(ctx) : everyReplyLoses(s1, ctx.mover, ctx.play.mats[ctx.i], WIN, null, backRankMate);
    if (!ok) return null;
    const king = s1.kings[ctx.opp];
    return tactic(ctx, 'back-rank-weakness', {
        pieces: [ctx.to, king],
        squares: [king],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'attack' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [s1.board[king]] },
    });
}

/** Clearance: a forcing move empties a square or a line, and another piece uses it at once. */
function clearance(ctx) {
    const m2 = ctx.mv(2);
    if (m2 === undefined || ctx.flags & F_CASTLE) return null;
    if (!(ctx.check || isCapture(ctx.move) || see(ctx.prev, ctx.move) < 0)) return null;
    const f2 = moveFrom(m2);
    const t2 = moveTo(m2);
    if (f2 === ctx.to) return null;
    const s2 = ctx.at(2).board;
    const s3 = ctx.at(3);
    // the follow-up lands on the emptied square, passes through it, or is backed by a slider that sees through it
    const through = (from, to, b) => isBetween(from, ctx.from, to) && slidesAlong(b[from] & 7, stepBetween(from, to));
    const backed = () => {
        for (let s = 0; s < 120; s++) {
            const p = s3.board[s];
            if (s & 0x88 || !p || p >> 3 !== ctx.mover || s === t2) continue;
            if (through(s, t2, s3.board) && attacks(s3.board, s, t2)) return true;
        }
        return false;
    };
    const vacated = t2 === ctx.from || through(f2, t2, s2) || backed();
    if (!vacated) return null;
    if (!(ctx.matedAt(3) || ((s3.inCheck() || isCapture(m2)) && won(ctx)))) return null;
    return tactic(ctx, 'clearance', {
        pieces: [ctx.to, f2],
        squares: [ctx.from],
        arrows: [
            { from: ctx.from, to: ctx.to, kind: 'idea' },
            { from: f2, to: t2, kind: 'attack' },
        ],
        params: { piece: ctx.piece, square: ctx.from, targets: [s2[f2]] },
    });
}

/** Promotion: a pawn becomes a queen, and keeps it (or what it wins). */
function promotion(ctx) {
    if (ctx.promo !== QUEEN) return null;
    const ok = ctx.line.length ? won(ctx) : see(ctx.prev, ctx.move) > 0 || ctx.mate;
    if (!ok) return null;
    return tactic(ctx, 'promotion', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'best' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [] },
    });
}

/** Underpromotion: a pawn becomes a knight, bishop or rook because a queen would not do: a knight check that wins, or a queen that stalemates. */
function underpromotion(ctx) {
    const promo = ctx.promo;
    if (!promo || promo === QUEEN) return null;
    let reason = null;
    if (promo === KNIGHT && ctx.check) {
        const b = ctx.pos.board;
        const hits = pieceAttacks(b, ctx.to).filter((s) => isOpp(ctx, b[s]) && VALUE[b[s] & 7] >= VALUE[ROOK] && (b[s] & 7) !== KING);
        if (ctx.mate || (hits.length && confirm(ctx, hits))) reason = 'check';
    }
    if (!reason) {
        const queen = encodeMove(ctx.from, ctx.to, moveFlags(ctx.move), QUEEN);
        const stalemates = withMove(ctx.prev, queen, (p) => !p.inCheck() && legalMoves(p).length === 0);
        const fine = !(!ctx.pos.inCheck() && legalMoves(ctx.pos).length === 0);
        if (stalemates && fine) reason = 'stalemate';
    }
    if (!reason) return null;
    return tactic(ctx, 'underpromotion', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'best' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [], reason },
    });
}

/** Sacrifice: the moved piece is given up (it is taken at once for less), and the line wins the material back or mates. */
function sacrifice(ctx) {
    const r1 = ctx.mv(1);
    if (r1 === undefined || moveTo(r1) !== ctx.to || !isCapture(r1) || ctx.flags & F_CASTLE) return null;
    // the move itself gives material away (a plain exchange is no sacrifice)
    if (see(ctx.prev, ctx.move) >= 0) return null;
    const { mats } = ctx.play;
    const sign = ctx.mover === 0 ? 1 : -1;
    const dip = sign * (mats[ctx.i + 2] - mats[ctx.i]);
    if (dip > -150) return null;
    if (ctx.gain() < 0) return null;
    return tactic(ctx, 'sacrifice', {
        pieces: [ctx.to],
        squares: [ctx.to],
        arrows: [{ from: ctx.from, to: ctx.to, kind: 'best' }],
        params: { piece: ctx.placed, square: ctx.to, targets: [], given: -dip },
    });
}

/** The tactical detectors by key, in the order of the dictionary. */
export const TACTIC_DETECTORS = {
    fork,
    'pin-absolute': (ctx) => pin(ctx, true),
    'pin-relative': (ctx) => pin(ctx, false),
    skewer,
    'discovered-attack': discoveredAttack,
    'double-check': doubleCheck,
    deflection,
    decoy,
    overloading,
    'remove-defender': removeDefender,
    interference,
    'x-ray': xray,
    zwischenzug,
    desperado,
    'trapped-piece': trappedPiece,
    'hanging-piece': hangingPiece,
    'back-rank-weakness': backRankWeakness,
    clearance,
    promotion,
    underpromotion,
    sacrifice,
};
