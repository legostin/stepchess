// perft: legal move generation counted against the published node counts; make/unmake, the hash and the game rules.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let C;
before(async () => {
    C = await import('../src/core/index.js');
});

const PERFT = [
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603]],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333]],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487]],
    ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890, 3894594]],
];

const pos = (fen) => C.Position.fromFen(fen);
const uci = (p) => C.legalMoves(p).map(C.moveToUci).sort();
const hashOf = (p) => [p.hashLo, p.hashHi];
const recomputed = (p) => {
    const h = C.computeHash(p);
    return [h.lo, h.hi];
};
// play UCI moves, each one found among the legal moves
const play = (p, moves) => {
    for (const u of moves) {
        const m = C.legalMoves(p).find((x) => C.moveToUci(x) === u);
        assert.ok(m, `${u} is legal in ${p.fen()}`);
        p.make(m);
    }
    return p;
};

for (const [fen, counts] of PERFT)
    test(`perft ${fen}`, () => {
        const p = pos(fen);
        assert.equal(C.perft(p, 0), 1);
        counts.forEach((n, i) => assert.equal(C.perft(p, i + 1), n, `depth ${i + 1}`));
        assert.equal(p.fen(), fen, 'perft leaves the position as it was');
    });

test('make and unmake restore the FEN and the hash; the incremental hash equals a recomputation after every move', () => {
    for (const [fen] of PERFT) {
        const p = pos(fen);
        const h0 = hashOf(p);
        for (const m1 of C.legalMoves(p)) {
            p.make(m1);
            assert.deepEqual(hashOf(p), recomputed(p), `${fen} ${C.moveToUci(m1)}`);
            const fen1 = p.fen();
            const h1 = hashOf(p);
            const counts1 = [...p.counts];
            for (const m2 of C.legalMoves(p)) {
                p.make(m2);
                assert.deepEqual(hashOf(p), recomputed(p), `${fen1} ${C.moveToUci(m2)}`);
                // the counts and the kings follow the board
                const fresh = pos(p.fen());
                assert.deepEqual([...p.counts], [...fresh.counts]);
                assert.deepEqual([...p.kings], [...fresh.kings]);
                p.unmake();
                assert.equal(p.fen(), fen1);
                assert.deepEqual(hashOf(p), h1);
            }
            assert.deepEqual([...p.counts], counts1);
            p.unmake();
            assert.equal(p.fen(), fen);
            assert.deepEqual(hashOf(p), h0);
        }
    }
});

test('a position reached by transposition has the same hash', () => {
    const a = play(pos(C.Position.START_FEN), ['g1f3', 'g8f6', 'b1c3']);
    const b = play(pos(C.Position.START_FEN), ['b1c3', 'g8f6', 'g1f3']);
    assert.equal(a.fen(), b.fen());
    assert.deepEqual(hashOf(a), hashOf(b));
    // a double step nobody can take sets no en passant square, so 1.e4 e5 2.d4 and 1.d4 e5 2.e4 meet too
    const c = play(pos(C.Position.START_FEN), ['e2e4', 'e7e5', 'd2d4']);
    const d = play(pos(C.Position.START_FEN), ['d2d4', 'e7e5', 'e2e4']);
    assert.deepEqual(hashOf(c), hashOf(d));
    // and the hash read from the FEN is the one the moves built
    assert.deepEqual(hashOf(pos(a.fen())), hashOf(a));
    assert.deepEqual(hashOf(pos(c.fen())), hashOf(c));
});

test('en passant: legal when it is, not when the capture exposes the king along the rank', () => {
    assert.ok(!uci(pos('8/8/8/K2pP2r/8/8/8/7k w - d6 0 1')).includes('e5d6'));
    assert.ok(uci(pos('8/8/8/K2pP3/8/8/8/7k w - d6 0 1')).includes('e5d6'));
    // pinned along a diagonal: the capture that leaves it is illegal, the one along it is fine
    assert.ok(!uci(pos('k6K/8/8/3pP3/8/8/8/b7 w - d6 0 1')).includes('e5d6'));
    assert.ok(uci(pos('1b5k/8/8/3pP3/8/8/7K/8 w - d6 0 1')).includes('e5d6'));
    // the capture removes a pawn that gives check
    assert.deepEqual(
        uci(pos('8/8/8/2k5/3Pp3/8/8/4K3 b - d3 0 1')).filter((m) => m.startsWith('e4')),
        ['e4d3'],
    );
    const p = pos('4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1');
    const ep = C.legalMoves(p).find((m) => C.moveToUci(m) === 'd5e6');
    assert.ok(C.moveFlags(ep) & C.F_EP);
    p.make(ep);
    assert.equal(p.fen(), '4k3/8/4P3/8/8/8/8/4K3 b - - 0 1');
    assert.deepEqual(hashOf(p), recomputed(p));
    p.unmake();
    assert.equal(p.fen(), '4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1');
});

test('castling: not through, into or out of an attacked square; the b-file square may be attacked', () => {
    const through = uci(pos('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1'));
    assert.ok(!through.includes('e1g1'));
    assert.ok(through.includes('e1c1'));
    const into = uci(pos('4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1'));
    assert.ok(!into.includes('e1g1'));
    assert.ok(into.includes('e1c1'));
    const outOf = uci(pos('4k3/8/8/8/8/8/4r3/R3K2R w KQ - 0 1'));
    assert.ok(!outOf.includes('e1g1') && !outOf.includes('e1c1'));
    const bFile = uci(pos('4k3/8/8/8/8/8/1r6/R3K2R w KQ - 0 1'));
    assert.ok(bFile.includes('e1c1') && bFile.includes('e1g1'));
    const blocked = uci(pos('4k3/8/8/8/8/8/8/RN2K1NR w KQ - 0 1'));
    assert.ok(!blocked.includes('e1g1') && !blocked.includes('e1c1'));
    const black = uci(pos('r3k2r/8/8/8/8/8/8/4K3 b kq - 0 1'));
    assert.ok(black.includes('e8g8') && black.includes('e8c8'));
    // castling moves the rook, and the rights go
    const p = pos('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    p.make(C.legalMoves(p).find((m) => C.moveToUci(m) === 'e1g1'));
    assert.equal(p.fen(), 'r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1');
    p.make(C.legalMoves(p).find((m) => C.moveToUci(m) === 'a8a1'));
    assert.equal(p.fen(), '4k2r/8/8/8/8/8/8/r4RK1 w k - 0 2');
    p.unmake();
    p.unmake();
    assert.equal(p.fen(), 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
});

test('promotions: four pieces each, with and without a capture', () => {
    const moves = uci(pos('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1')).filter((m) => m.startsWith('a7'));
    assert.deepEqual(moves, ['a7a8b', 'a7a8n', 'a7a8q', 'a7a8r', 'a7b8b', 'a7b8n', 'a7b8q', 'a7b8r']);
    const p = pos('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    p.make(C.legalMoves(p).find((m) => C.moveToUci(m) === 'a7b8n'));
    assert.equal(p.fen(), '1N2k3/8/8/8/8/8/8/4K3 b - - 0 1');
    assert.equal(p.counts[C.makePiece(C.WHITE, C.PAWN)], 0);
    assert.equal(p.counts[C.makePiece(C.WHITE, C.KNIGHT)], 1);
    assert.equal(p.counts[C.makePiece(C.BLACK, C.KNIGHT)], 0);
    p.unmake();
    assert.equal(p.fen(), '1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
});

test('captures only: the captures and the queen promotions, in every position of depth 2', () => {
    const out = new Int32Array(256);
    const check = (p) => {
        const all = C.legalMoves(p);
        const want = all.filter((m) => C.movePromo(m) === C.QUEEN || (!C.movePromo(m) && C.moveFlags(m) & C.F_CAPTURE)).sort();
        const n = C.generateMoves(p, out, true);
        assert.deepEqual([...out.slice(0, n)].sort(), want, p.fen());
        // the flags tell a capture: the target holds a piece, or it is en passant (flagged as both)
        for (const m of all) assert.equal(!!(C.moveFlags(m) & C.F_CAPTURE), p.board[C.moveTo(m)] !== 0 || !!(C.moveFlags(m) & C.F_EP));
    };
    for (const [fen] of [...PERFT, ['1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1']]) {
        const p = pos(fen);
        check(p);
        for (const m of C.legalMoves(p)) {
            p.make(m);
            check(p);
            p.unmake();
        }
    }
});

test('check, mate and stalemate', () => {
    const mate = play(pos(C.Position.START_FEN), ['f2f3', 'e7e5', 'g2g4', 'd8h4']);
    assert.ok(mate.inCheck());
    assert.equal(C.legalMoves(mate).length, 0);
    const stalemate = pos('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.ok(!stalemate.inCheck());
    assert.equal(C.legalMoves(stalemate).length, 0);
    // double check: only the king moves
    const dbl = pos('3qk3/8/5N2/1B6/8/8/8/6K1 b - - 0 1');
    assert.ok(dbl.inCheck());
    assert.ok(C.legalMoves(dbl).every((m) => C.moveFrom(m) === dbl.kings[C.BLACK]));
    const start = pos(C.Position.START_FEN);
    assert.ok(!start.inCheck());
    assert.ok(start.isAttacked(C.parseSquare('f3'), C.WHITE));
    assert.ok(!start.isAttacked(C.parseSquare('e4'), C.WHITE));
    assert.ok(start.isAttacked(C.parseSquare('f6'), C.BLACK));
});

test('repetitions: since the last irreversible move, counted for the game', () => {
    const p = pos(C.Position.START_FEN);
    assert.equal(p.repetitionCount(), 1);
    assert.ok(!p.isRepetition());
    play(p, ['g1f3', 'g8f6', 'f3g1']);
    assert.ok(!p.isRepetition());
    play(p, ['f6g8']);
    assert.ok(p.isRepetition());
    assert.equal(p.repetitionCount(), 2);
    play(p, ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
    assert.equal(p.repetitionCount(), 3);
    // a pawn move cuts the history
    play(p, ['e2e4', 'e7e5', 'g1f3', 'g8f6', 'f3g1', 'f6g8']);
    assert.equal(p.repetitionCount(), 2);
    play(p, ['e1e2', 'e8e7', 'e2e1', 'e7e8']);
    // the same placement without the castling rights is another position
    assert.equal(p.repetitionCount(), 1);
    assert.ok(!p.isRepetition());
    // a null move cuts the search history
    const q = play(pos(C.Position.START_FEN), ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
    q.makeNull();
    q.makeNull();
    assert.ok(!q.isRepetition());
    q.unmakeNull();
    q.unmakeNull();
    assert.ok(q.isRepetition());
});

test('a null move passes the turn and comes back', () => {
    const p = pos('4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1');
    const fen = p.fen();
    p.makeNull();
    assert.equal(p.side, C.BLACK);
    assert.equal(p.ep, -1);
    assert.deepEqual(hashOf(p), recomputed(p));
    p.unmakeNull();
    assert.equal(p.fen(), fen);
    assert.deepEqual(hashOf(p), recomputed(p));
});

test('insufficient material', () => {
    const yes = ['4k3/8/8/8/8/8/8/4K3 w - - 0 1', '4k3/8/8/8/8/8/8/4KN2 w - - 0 1', '4kb2/8/8/8/8/8/8/4K3 w - - 0 1', '4kb2/8/8/8/8/8/8/2B1K3 w - - 0 1'];
    const no = [
        '4k3/8/8/8/8/8/8/4KNN1 w - - 0 1',
        '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
        '4kb2/8/8/8/8/8/8/3BK3 w - - 0 1',
        '4kn2/8/8/8/8/8/8/2B1K3 w - - 0 1',
        '4k3/8/8/8/8/8/8/R3K3 w - - 0 1',
        C.Position.START_FEN,
    ];
    for (const f of yes) assert.ok(pos(f).isInsufficientMaterial(), f);
    for (const f of no) assert.ok(!pos(f).isInsufficientMaterial(), f);
});

test('clone keeps the history: a repetition is still seen', () => {
    const p = play(pos(C.Position.START_FEN), ['g1f3', 'g8f6', 'f3g1', 'f6g8']);
    const q = p.clone();
    assert.ok(q.isRepetition());
    q.unmake();
    assert.equal(q.fen(), 'rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 3 2');
    assert.ok(p.isRepetition(), 'the original is untouched');
});

test('the package exports the move generator', async () => {
    const P = await import('../src/index.js');
    for (const name of ['generateMoves', 'legalMoves', 'perft']) assert.equal(typeof P[name], 'function', name);
});

test('random games with null moves: hash, FEN and moves agree with a fresh parse after every step, and the takebacks walk back to the start', () => {
    let seed = 12345;
    const rand = (n) => {
        seed ^= seed << 13;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        return (seed >>> 0) % n;
    };
    for (let game = 0; game < 60; game++) {
        const p = pos(C.Position.START_FEN);
        const fens = [p.fen()];
        const nulls = [false];
        let nullCount = 0;
        for (let ply = 0; ply < 300; ply++) {
            const moves = C.legalMoves(p);
            if (!moves.length || p.halfmove >= 100 || p.isInsufficientMaterial()) break;
            // now and then a null move (never in check, never two in a row)
            const isNull = !p.inCheck() && !nulls[nulls.length - 1] && rand(6) === 0;
            if (isNull) {
                p.makeNull();
                nullCount++;
            } else p.make(moves[rand(moves.length)]);
            nulls.push(isNull);
            const fen = p.fen();
            const fresh = pos(fen);
            assert.deepEqual(hashOf(p), recomputed(p), fen);
            assert.deepEqual(hashOf(p), hashOf(fresh), fen);
            assert.deepEqual(uci(p), uci(fresh), fen);
            assert.equal(p.inCheck(), fresh.inCheck());
            fens.push(fen);
        }
        assert.ok(nullCount > 0, 'the game holds null moves');
        while (fens.length > 1) {
            fens.pop();
            if (nulls.pop()) p.unmakeNull();
            else p.unmake();
            assert.equal(p.fen(), fens[fens.length - 1]);
            assert.deepEqual(hashOf(p), recomputed(p));
        }
        assert.equal(p.ply, 0);
    }
});

test('the move history holds MAX_PLY plies; one more is a ChessError, not a silent overwrite', () => {
    const p = pos(C.Position.START_FEN);
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8'];
    for (let i = 0; i < C.MAX_PLY; i++) play(p, [shuffle[i % 4]]);
    assert.equal(p.ply, C.MAX_PLY);
    const m = C.legalMoves(p)[0];
    assert.throws(
        () => p.make(m),
        (e) => e instanceof C.ChessError && e.code === 'move' && e.data.reason === 'history' && e.text.en !== e.message,
    );
    assert.throws(() => p.makeNull(), C.ChessError);
    assert.equal(p.ply, C.MAX_PLY);
    assert.equal(p.fen(), C.Position.START_FEN.replace(' 0 1', ` ${C.MAX_PLY} ${C.MAX_PLY / 2 + 1}`));
});
