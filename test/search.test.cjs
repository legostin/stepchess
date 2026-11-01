// search: mates are found and scored by distance, stalemate and draws are seen, the search is reproducible, multi-PV and exclude work, the tactics suite holds.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let C;
let S;
let P;
let T;
before(async () => {
    C = await import('../src/core/index.js');
    S = await import('../src/search/index.js');
    P = await import('../src/index.js');
    T = await import(pathToFileURL(path.join(__dirname, '../bench/tactics.mjs')).href);
});

const uci = (m) => C.moveToUci(m);
// an EPD-style position: the board, side, castling and en passant fields (the brief's mate in 2 has a full-move number of 0)
const epd = (fen) => fen.split(' ').slice(0, 4).join(' ');

test('the package exports the search', () => {
    assert.equal(typeof P.Searcher, 'function');
    assert.equal(P.MATE, 32000);
    assert.equal(typeof P.isMateScore, 'function');
    assert.equal(typeof P.mateIn, 'function');
});

test('mate scores: MATE - ply, mateIn in signed moves', () => {
    const { MATE, isMateScore, mateIn } = S;
    assert.equal(MATE, 32000);
    assert.equal(isMateScore(MATE - 1), true);
    assert.equal(isMateScore(-(MATE - 2)), true);
    assert.equal(isMateScore(250), false);
    assert.equal(mateIn(MATE - 1), 1);
    assert.equal(mateIn(MATE - 3), 2);
    assert.equal(mateIn(-(MATE - 2)), -1);
    assert.equal(mateIn(-(MATE - 4)), -2);
    assert.equal(mateIn(-MATE), 0);
    assert.equal(mateIn(120), null);
});

test('mate in 1: the back rank', () => {
    const r = new S.Searcher().search(C.Position.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1'), { depth: 4 });
    assert.equal(uci(r.best), 'a1a8');
    assert.equal(r.mate, 1);
    assert.equal(r.score, S.MATE - 1);
    assert.equal(uci(r.pv[0]), 'a1a8');
});

test("Scholar's mate: Qxf7", () => {
    const r = new S.Searcher().search(C.Position.fromFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4'), { depth: 4 });
    assert.equal(uci(r.best), 'h5f7');
    assert.equal(r.mate, 1);
});

test('mate in 2: Nf6+ gxf6 Bxf7#', () => {
    const r = new S.Searcher().search(C.Position.fromFen(epd('r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 0')), { depth: 6 });
    assert.equal(uci(r.best), 'd5f6');
    assert.equal(r.mate, 2);
    assert.equal(r.pv.length, 3);
    assert.equal(uci(r.pv[2]), 'c4f7');
});

test('the side that is mated sees it: mated in 1 is -1', () => {
    // Black's only move is Kb8, and Rh8 mates
    const lost = new S.Searcher().search(C.Position.fromFen('k7/8/1K6/8/8/8/8/7R b - - 0 1'), { depth: 5 });
    assert.equal(uci(lost.best), 'a8b8');
    assert.equal(lost.mate, -1);
    assert.equal(lost.score, -(S.MATE - 2));
});

test('the stalemate trap is avoided at depth 6', () => {
    const fen = 'k7/8/1Q6/8/8/8/8/7K w - - 0 1';
    const r = new S.Searcher().search(C.Position.fromFen(fen), { depth: 6 });
    const pos = C.Position.fromFen(fen);
    pos.make(r.best);
    const replies = C.legalMoves(pos).length;
    assert.ok(replies > 0 || pos.inCheck(), `${uci(r.best)} stalemates`);
    assert.ok(r.score > 500, `score ${r.score}`);
});

test('a stalemate and a checkmate at the root are terminal results', () => {
    const mated = new S.Searcher().search(C.Position.fromFen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'), { depth: 3 });
    assert.equal(mated.best, C.NO_MOVE);
    assert.equal(mated.score, -S.MATE);
    assert.equal(mated.mate, 0);
    assert.deepEqual(mated.lines, []);
    const stale = new S.Searcher().search(C.Position.fromFen('k7/8/1Q6/8/8/8/8/7K b - - 0 1'), { depth: 3 });
    assert.equal(stale.best, C.NO_MOVE);
    assert.equal(stale.score, 0);
    assert.equal(stale.mate, null);
});

test('the fifty-move rule scores 0', () => {
    // a queen up, but every white move is the hundredth reversible half-move and none of them mates
    const r = new S.Searcher().search(C.Position.fromFen('8/8/8/4k3/8/8/8/3QK3 w - - 99 100'), { depth: 5 });
    assert.equal(r.score, 0);
    // a mate on the hundredth half-move is still a mate
    const m = new S.Searcher().search(C.Position.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 99 100'), { depth: 3 });
    assert.equal(uci(m.best), 'a1a8');
    assert.equal(m.mate, 1);
});

// White has no queen; the g-knights go out and back. Played from the start position: S (the start, White to move),
// g1f3, g8f6, f3g1, then f6g8 gives S again
const NO_WHITE_QUEEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNB1KBNR w KQkq - 0 1';
function shuffled(moves) {
    const pos = C.Position.fromFen(NO_WHITE_QUEEN);
    for (const m of moves) pos.make(C.parseMove(pos, m));
    return pos;
}

test('a game position repeated once before the root is not a draw', () => {
    // S occurred once, at the start: Black's Ng8 makes it the second occurrence, which cannot be claimed
    const pos = shuffled(['g1f3', 'g8f6', 'f3g1']);
    const back = C.parseMove(pos, 'f6g8');
    const others = C.legalMoves(pos).filter((m) => m !== back);
    const r = new S.Searcher().search(pos, { depth: 6, exclude: others });
    assert.equal(r.best, back);
    // Black, a queen up, keeps its advantage: scored as an ordinary position, not 0
    assert.ok(r.score > 500, `score ${r.score}`);
});

test('a game position seen twice before is a draw the third time', () => {
    // S occurred at the start and after the first round trip: Ng8 makes it the third occurrence
    const pos = shuffled(['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1']);
    assert.equal(pos.repetitionCount(), 2);
    const back = C.parseMove(pos, 'f6g8');
    const others = C.legalMoves(pos).filter((m) => m !== back);
    const r = new S.Searcher().search(pos, { depth: 6, exclude: others });
    assert.equal(r.best, back);
    assert.equal(r.score, 0);
    // left free, Black, a queen up, does not repeat
    const free = new S.Searcher().search(pos, { depth: 6 });
    assert.notEqual(free.best, back);
    assert.ok(free.score > 500);
});

test('a repetition inside the search is a draw at once: the perpetual check', () => {
    // White, a queen and a rook down, checks forever: Qf6+ Kg8 Qg5+ Kh8 Qf6+ repeats the position after the first check
    const r = new S.Searcher().search(C.Position.fromFen('5r1k/5p1p/8/6Q1/8/8/q5PP/7K w - - 0 1'), { depth: 10 });
    assert.equal(uci(r.best), 'g5f6');
    assert.equal(r.score, 0);
});

test('the same node limit twice gives the same result', () => {
    const fen = 'r1bq1rk1/pp2bppp/2n2n2/2pp4/3P4/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 9';
    const a = new S.Searcher().search(C.Position.fromFen(fen), { nodes: 30000 });
    const b = new S.Searcher().search(C.Position.fromFen(fen), { nodes: 30000 });
    assert.equal(a.best, b.best);
    assert.equal(a.score, b.score);
    assert.deepEqual(a.pv, b.pv);
    assert.equal(a.depth, b.depth);
    // one searcher, cleared in between: the same again
    const s = new S.Searcher();
    const c = s.search(C.Position.fromFen(fen), { nodes: 30000 });
    s.clear();
    const d = s.search(C.Position.fromFen(fen), { nodes: 30000 });
    assert.deepEqual([c.best, c.score, c.pv], [a.best, a.score, a.pv]);
    assert.deepEqual([d.best, d.score, d.pv], [a.best, a.score, a.pv]);
    assert.ok(a.nodes >= 30000 && a.nodes < 31000, `nodes ${a.nodes}`);
});

// a position reached by `plies` half-moves: the g-knights go out and back, then two pawn moves, so that the side to move
// has a free pawn to take (exf5, or fxe4 and maybe Nxe4) and the last move is irreversible
function deepGame(plies) {
    const pos = C.Position.fromFen(C.Position.START_FEN);
    const shuffle = plies - 2;
    const out = [false, false];
    for (let i = 0; i < shuffle; i++) {
        const side = pos.side;
        const m = side === 0 ? (out[0] ? 'f3g1' : 'g1f3') : out[1] ? 'f6g8' : 'g8f6';
        out[side] = !out[side];
        pos.make(C.parseMove(pos, m));
    }
    const pushes = pos.side === 0 ? ['e2e4', 'f7f5'] : ['f7f5', 'e2e4'];
    for (const m of pushes) pos.make(C.parseMove(pos, m));
    assert.equal(pos.ply, plies);
    return pos;
}

test('a game history near the end of the stack: no throw, a legal move', () => {
    for (const plies of [1021, 1022, 1023]) {
        const pos = deepGame(plies);
        const legal = C.legalMoves(pos);
        const captures = legal.filter((m) => C.moveFlags(m) & C.F_CAPTURE);
        assert.ok(captures.length >= 1);
        for (const limits of [{ depth: 6 }, { nodes: 20000 }, { depth: 4, multipv: 3 }]) {
            let r;
            assert.doesNotThrow(() => (r = new S.Searcher().search(pos, limits)), `ply ${plies}`);
            assert.ok(legal.includes(r.best), `ply ${plies}: ${uci(r.best)}`);
            assert.equal(r.pv[0], r.best);
            assert.ok(r.lines.length >= 1);
            for (const l of r.lines) assert.ok(legal.includes(l.move));
        }
        const r = new S.Searcher().search(pos, { depth: 6 });
        // the free pawn is taken (by a pawn or the knight), searched or by the static choice
        assert.ok(captures.includes(r.best), `ply ${plies}: ${uci(r.best)}`);
        if (plies === 1023) {
            assert.equal(r.reason, 'history');
            assert.equal(r.depth, 0);
        } else assert.ok(r.depth >= 1);
        assert.equal(pos.ply, plies);
    }
});

test('a mate distance survives a reused searcher', () => {
    const fen = epd('r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 0');
    const s = new S.Searcher();
    const a = s.search(C.Position.fromFen(fen), { depth: 4 });
    assert.equal(uci(a.best), 'd5f6');
    assert.equal(a.mate, 2);
    // the table now holds the mate scores of the first search, stored relative to their nodes
    const b = s.search(C.Position.fromFen(fen), { depth: 6 });
    assert.equal(uci(b.best), 'd5f6');
    assert.equal(b.mate, 2);
    assert.equal(b.score, S.MATE - 3);
    // and from the position after the first move, Black is mated in 1 (Bxf7#), counted from that root
    const after = C.Position.fromFen(fen);
    after.make(a.best);
    const c = s.search(after, { depth: 5 });
    assert.equal(c.mate, -1);
});

test('the null move is verified deep down: a zugzwang is not passed over', () => {
    // White must offer the rook trade (Rf1): Black, out of moves, then loses its pawns; the null move would
    // pretend White can pass
    const s = new S.Searcher();
    const r = s.search(C.Position.fromFen('8/8/p1p5/1p5p/1P5p/8/PPP2K1p/4R1rk w - - 0 1'), { depth: 12 });
    assert.ok(s.verifications > 0, 'the verification search ran');
    assert.equal(uci(r.best), 'e1f1');
    assert.ok(r.score > 100, `score ${r.score}`);
});

test('the search leaves the position as it was', () => {
    const pos = C.Position.fromFen('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4');
    const before = pos.fen();
    new S.Searcher().search(pos, { depth: 5 });
    assert.equal(pos.fen(), before);
});

test('multipv 3 returns 3 distinct moves sorted by score', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    const infos = [];
    const r = new S.Searcher().search(C.Position.fromFen(fen), { depth: 6, multipv: 3, onInfo: (i) => infos.push(i) });
    assert.equal(r.lines.length, 3);
    const moves = r.lines.map((l) => l.move);
    assert.equal(new Set(moves).size, 3);
    for (let i = 1; i < 3; i++) assert.ok(r.lines[i - 1].score >= r.lines[i].score, 'sorted');
    assert.equal(r.best, r.lines[0].move);
    assert.equal(r.score, r.lines[0].score);
    for (const l of r.lines) assert.equal(l.pv[0], l.move);
    // an info per line and depth, the depths counting up
    assert.ok(infos.length >= 3 * 5);
    assert.deepEqual(
        infos.filter((i) => i.depth === 6).map((i) => i.multipv),
        [1, 2, 3],
    );
    for (const i of infos) for (const k of ['best', 'score', 'mate', 'depth', 'seldepth', 'nodes', 'timeMs', 'pv', 'lines']) assert.ok(k in i, k);
});

test('an aspiration re-search leaves no stale score: each line scores from its own completed search', () => {
    // a scripted root search with the real one's rules (the first move gets the full window and is recorded, a later
    // one only when it raises alpha, a fail high ends the pass): at depth 4, pass 1 has A at 30 and B failing high
    // at 60; pass 2 (the window widened) has B at 25 and A at 20, so A is never recorded in it. A's 30 is from the
    // narrower window of pass 1: the line must be B at 25, the score of the pass that completed.
    let A = null;
    let B = null;
    let pass = 0;
    class Scripted extends S.Searcher {
        searchRoot(depth, alpha, beta, first) {
            if (A === null) [A, B] = [this.roots[0].move, this.roots[1].move];
            if (depth === 4 && first === 0) pass++;
            const value = (m) => (m === A ? (depth < 4 ? 20 : pass === 1 ? 30 : 20) : m === B ? (depth < 4 ? 10 : pass === 1 ? 60 : 25) : -100);
            let best = -Infinity;
            for (let i = first; i < this.roots.length; i++) {
                const r = this.roots[i];
                const score = value(r.move);
                if (i === first || score > alpha) {
                    r.score = score;
                    r.pv = [r.move];
                }
                if (score > best) best = score;
                if (score > alpha) {
                    alpha = score;
                    if (score >= beta) break;
                }
            }
            return best;
        }
    }
    const pos = C.Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    for (const multipv of [1, 2]) {
        A = null;
        pass = 0;
        const r = new Scripted().search(pos, { depth: 4, multipv });
        assert.equal(pass, 2, 'the scripted fail high and re-search happened');
        assert.equal(r.best, B, `multipv ${multipv}: the best line is the one the completed pass found`);
        assert.equal(r.score, 25);
        assert.equal(r.lines[0].score, 25);
    }
});

test('exclude removes root moves', () => {
    const pos = C.Position.fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
    const mate = C.parseMove(pos, 'Ra8#');
    const r = new S.Searcher().search(pos, { depth: 4, exclude: [mate] });
    assert.notEqual(r.best, mate);
    assert.ok(!r.lines.some((l) => l.move === mate));
    const all = new S.Searcher().search(pos, { depth: 2, exclude: C.legalMoves(pos) });
    assert.equal(all.best, C.NO_MOVE);
    assert.deepEqual(all.lines, []);
});

test('stop() ends the search with the last completed depth', () => {
    let calls = 0;
    let last = null;
    const r = new S.Searcher().search(C.Position.fromFen(C.Position.START_FEN), { depth: 30, stop: () => ++calls > 3, onInfo: (i) => (last = i) });
    assert.ok(r.depth >= 1 && r.depth < 30);
    assert.ok(r.best !== C.NO_MOVE);
    assert.equal(r.pv[0], r.best);
    assert.equal(r.reason, 'stop');
    // exactly what the last completed depth reported, never a move of the unfinished iteration
    assert.equal(last.depth, r.depth);
    assert.equal(last.best, r.best);
    assert.equal(last.score, r.score);
    assert.deepEqual(last.pv, r.pv);
});

test('the result says why the search ended', () => {
    const start = () => C.Position.fromFen(C.Position.START_FEN);
    assert.equal(new S.Searcher().search(start(), { depth: 3 }).reason, 'depth');
    assert.equal(new S.Searcher().search(start(), { nodes: 5000 }).reason, 'nodes');
    assert.equal(new S.Searcher().search(start(), { movetime: 50 }).reason, 'time');
    assert.equal(new S.Searcher().search(C.Position.fromFen('R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1'), { depth: 3 }).reason, 'terminal');
    // one legal move on the clock: no need to think
    assert.equal(new S.Searcher().search(C.Position.fromFen('k7/8/1K6/8/8/8/8/7R b - - 0 1'), { movetime: 1000 }).reason, 'single');
});

test('a time limit is kept', () => {
    const t0 = Date.now();
    const r = new S.Searcher().search(C.Position.fromFen(C.Position.START_FEN), { movetime: 200 });
    const t = Date.now() - t0;
    // generous for a slow CI machine: the point is that the search stops near its limit, not at a depth
    assert.ok(t < 1500, `${t} ms`);
    assert.ok(r.depth >= 1);
    assert.ok(r.best !== C.NO_MOVE);
});

test('the time manager: soft and hard limits', () => {
    const { allocate } = S;
    const w = allocate({ wtime: 60000, btime: 30000, winc: 1000, binc: 0 }, 0);
    assert.equal(w.soft, Math.floor(60000 / 30 + 750));
    assert.equal(w.hard, Math.floor(Math.min(w.soft * 4, 60000 / 4)));
    const b = allocate({ wtime: 60000, btime: 3000, winc: 0, binc: 0 }, 1);
    assert.equal(b.soft, 100);
    assert.equal(b.hard, 400);
    assert.ok(b.soft <= b.hard);
    // little time left: the hard limit caps the soft one
    const low = allocate({ wtime: 400, winc: 2000 }, 0);
    assert.equal(low.hard, 100);
    assert.equal(low.soft, 100);
    assert.equal(allocate({}, 0), null);
});

test('the tablebase hook scores a win as a mate by its distance', () => {
    // a stub table: every position is lost in 5 for the side to move, except a real mate (0) or stalemate (a draw)
    let probes = 0;
    let root = 0;
    const probe = (p) => {
        probes++;
        if (p.ply === root) throw new Error('probed at the root');
        let n = 0;
        for (let i = 0; i < 16; i++) n += p.counts[i];
        assert.ok(n <= 4);
        if (C.legalMoves(p).length === 0) return p.inCheck() ? { wdl: -1, dtm: 0 } : { wdl: 0, dtm: 0 };
        return { wdl: -1, dtm: -5 };
    };
    // Qb8 or Qh7 mates at once: quicker than any table win
    const pos = C.Position.fromFen('7k/8/6K1/8/8/8/8/1Q6 w - - 0 1');
    root = pos.ply;
    const r = new S.Searcher().search(pos, { depth: 3, probe });
    assert.ok(probes > 0);
    assert.ok(['b1b8', 'b1h7'].includes(uci(r.best)), uci(r.best));
    assert.equal(r.mate, 1);
    // no mate in 1: every reply is Black lost in 5, so White mates in 6, at ply 11
    const r2 = new S.Searcher().search(C.Position.fromFen('8/8/8/3k4/8/8/8/Q3K3 w - - 0 1'), { depth: 3, probe });
    assert.equal(r2.score, S.MATE - 11);
    assert.equal(r2.mate, 6);
    // more than 4 pieces: never probed
    probes = 0;
    new S.Searcher().search(C.Position.fromFen('8/8/8/3k4/8/8/1P6/QR2K3 w - - 0 1'), { depth: 2, probe });
    assert.equal(probes, 0);
});

test('givesCheck agrees with making the move', async () => {
    const { givesCheck } = await import('../src/search/order.js');
    const fens = [
        'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
        '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
        'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
        'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
        '4k3/8/8/3pP3/8/8/8/R3K2R w KQ d6 0 1',
        '3k4/8/8/3N4/8/8/1B6/R2RK3 w - - 0 1',
        '8/8/8/8/k2K3R/8/8/8 w - - 0 1',
        '8/1P1k4/8/8/8/8/6p1/K6R b - - 0 1',
    ];
    let checked = 0;
    const walk = (pos, depth) => {
        for (const m of C.legalMoves(pos)) {
            pos.make(m);
            const real = pos.inCheck();
            pos.unmake();
            assert.equal(givesCheck(pos, m), real, `${pos.fen()} ${uci(m)}`);
            checked++;
            if (depth > 1) {
                pos.make(m);
                walk(pos, depth - 1);
                pos.unmake();
            }
        }
    };
    for (const fen of fens) walk(C.Position.fromFen(fen), 2);
    assert.ok(checked > 1000);
});

test('the tactics suites are normalised EPD with a source header', () => {
    for (const [name, min] of [
        ['wac', 290],
        ['ecm', 170],
    ]) {
        const suite = T.loadSuite(name);
        assert.ok(suite.length >= min, `${name}: ${suite.length}`);
        for (const p of suite) {
            const pos = C.Position.fromFen(p.fen);
            assert.ok(p.bm.length >= 1);
            for (const san of p.bm) assert.notEqual(C.parseMove(pos, san), C.NO_MOVE, `${p.id} ${san}`);
            assert.match(p.id, /^(WAC|ECM)\.\d+$/);
        }
    }
});

// the brief asks for 44; the engine solves 47 (bench/REPORT.md); the threshold rises with the strength
test('WAC: the first 50 at 100k nodes', () => {
    const suite = T.loadSuite('wac').slice(0, 50);
    const r = T.runSuite(suite, { nodes: 100000 });
    assert.ok(r.solved >= 46, `solved ${r.solved}/50, failed: ${r.failed.map((f) => f.id).join(' ')}`);
});
