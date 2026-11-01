// core: squares, pieces, moves, Zobrist keys, errors, the position and its FEN (parsing, validation, round trip).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let C;
before(async () => {
    C = await import('../src/core/index.js');
});

const FENS = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
];

// the reason a FEN is rejected with, or null when it is accepted
const reasonOf = (fen) => {
    try {
        C.Position.fromFen(fen);
        return null;
    } catch (e) {
        assert.ok(e instanceof C.ChessError, `${fen}: ${e}`);
        assert.equal(e.code, 'fen');
        return e.data.reason;
    }
};

test('squares: 0x88 indices, names, 64-square indices and the rank flip', () => {
    const e4 = C.square(4, 3);
    assert.equal(e4, 0x34);
    assert.equal(C.fileOf(e4), 4);
    assert.equal(C.rankOf(e4), 3);
    assert.equal(C.sqName(e4), 'e4');
    assert.equal(C.parseSquare('e4'), e4);
    assert.equal(C.parseSquare('a1'), 0);
    assert.equal(C.parseSquare('h8'), 0x77);
    for (const bad of ['', 'e9', 'i1', 'E4', 'e', 'e44', null, 5]) assert.equal(C.parseSquare(bad), -1, String(bad));
    assert.ok(C.onBoard(0x77) && !C.onBoard(0x78) && !C.onBoard(0x08) && !C.onBoard(-1 & 0xff));
    assert.equal(C.to64(e4), 28);
    assert.equal(C.from64(28), e4);
    assert.equal(C.flipRank(e4), C.parseSquare('e5'));
    assert.equal(C.ALL_SQUARES.length, 64);
    assert.equal(C.sqName(C.ALL_SQUARES[0]), 'a1');
    assert.equal(C.sqName(C.ALL_SQUARES[63]), 'h8');
    assert.deepEqual(C.ALL_SQUARES.map(C.to64), [...Array(64).keys()]);
});

test('pieces: codes, colors, types and FEN letters', () => {
    assert.deepEqual([C.WHITE, C.BLACK, C.EMPTY], [0, 1, 0]);
    assert.deepEqual([C.PAWN, C.KNIGHT, C.BISHOP, C.ROOK, C.QUEEN, C.KING], [1, 2, 3, 4, 5, 6]);
    const bn = C.makePiece(C.BLACK, C.KNIGHT);
    assert.equal(bn, 10);
    assert.equal(C.colorOf(bn), C.BLACK);
    assert.equal(C.typeOf(bn), C.KNIGHT);
    assert.equal(C.pieceFromFen('N'), C.makePiece(C.WHITE, C.KNIGHT));
    assert.equal(C.pieceFromFen('k'), C.makePiece(C.BLACK, C.KING));
    assert.equal(C.pieceFromFen('x'), C.EMPTY);
    for (const ch of 'PNBRQKpnbrqk') assert.equal(C.pieceToFen(C.pieceFromFen(ch)), ch);
});

test('moves: packing, flags and UCI', () => {
    const e7 = C.parseSquare('e7');
    const e8 = C.parseSquare('e8');
    const m = C.encodeMove(e7, e8, C.F_CAPTURE, C.QUEEN);
    assert.equal(m, e7 | (e8 << 7) | (C.QUEEN << 14) | (C.F_CAPTURE << 17));
    assert.equal(C.moveFrom(m), e7);
    assert.equal(C.moveTo(m), e8);
    assert.equal(C.movePromo(m), C.QUEEN);
    assert.equal(C.moveFlags(m), C.F_CAPTURE);
    assert.equal(C.moveToUci(m), 'e7e8q');
    assert.equal(C.moveToUci(C.encodeMove(C.parseSquare('g1'), C.parseSquare('f3'))), 'g1f3');
    assert.equal(C.moveToUci(C.encodeMove(e7, e8, 0, C.KNIGHT)), 'e7e8n');
    assert.deepEqual([C.F_CAPTURE, C.F_EP, C.F_CASTLE, C.F_DOUBLE, C.NO_MOVE], [1, 2, 4, 8, 0]);
});

test('Zobrist keys come from xorshift32 seeded with 0x9E3779B9 through a finalizer, pieces first', () => {
    let x = 0x9e3779b9 | 0;
    const next = () => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        let y = Math.imul(x ^ (x >>> 16), 0x7feb352d);
        y = Math.imul(y ^ (y >>> 15), 0x846ca68b);
        return (y ^ (y >>> 16)) | 0;
    };
    const first = [next(), next(), next(), next()];
    assert.deepEqual([...C.Z.piece.slice(0, 4)], first);
    assert.equal(C.Z.piece.length, 16 * 128 * 2);
    assert.ok(C.Z.piece instanceof Int32Array);
    assert.equal(C.Z.side.length, 2);
    assert.equal(C.Z.castle.length, 16 * 2);
    assert.equal(C.Z.ep.length, 8 * 2);
    // the keys the board uses are distinct
    const seen = new Set();
    for (let p = 1; p < 16; p++)
        for (const sq of C.ALL_SQUARES) {
            const i = (p * 128 + sq) * 2;
            seen.add(`${C.Z.piece[i]}:${C.Z.piece[i + 1]}`);
        }
    assert.equal(seen.size, 15 * 64);
});

test('the 64-bit Zobrist keys span all 64 dimensions over GF(2): the high half is not a function of the low half', () => {
    const all = [C.Z.piece, C.Z.side, C.Z.castle, C.Z.ep];
    const keys = [];
    for (const a of all) for (let i = 0; i < a.length; i += 2) keys.push((BigInt(a[i + 1] >>> 0) << 32n) | BigInt(a[i] >>> 0));
    assert.equal(keys.length, 2073);
    // Gaussian elimination: a basis indexed by the leading bit
    const basis = new Array(64).fill(0n);
    let rank = 0;
    for (let v of keys) {
        for (let bit = 63; bit >= 0 && v; bit--) {
            if (!((v >> BigInt(bit)) & 1n)) continue;
            if (!basis[bit]) {
                basis[bit] = v;
                rank++;
                break;
            }
            v ^= basis[bit];
        }
        if (rank === 64) break;
    }
    assert.equal(rank, 64);
    // and the halves taken alone span 32 dimensions each, so neither is degenerate
    const rank32 = (vals) => {
        const b = new Array(32).fill(0);
        let r = 0;
        for (let v of vals) {
            for (let bit = 31; bit >= 0 && v; bit--) {
                if (!((v >>> bit) & 1)) continue;
                if (!b[bit]) {
                    b[bit] = v;
                    r++;
                    break;
                }
                v = (v ^ b[bit]) >>> 0;
            }
        }
        return r;
    };
    assert.equal(rank32(keys.map((k) => Number(k & 0xffffffffn))), 32);
    assert.equal(rank32(keys.map((k) => Number(k >> 32n))), 32);
});

test('the start position and the perft positions survive a FEN round trip', () => {
    assert.equal(C.Position.START_FEN, FENS[0]);
    assert.equal(C.Position.fromFen(C.Position.START_FEN).fen(), C.Position.START_FEN);
    for (const fen of FENS) assert.equal(C.Position.fromFen(fen).fen(), fen);
});

test('new Position(fen) is the position of the FEN, new Position() the initial one; a bad FEN throws the fen ChessError', () => {
    assert.equal(new C.Position().fen(), C.Position.START_FEN);
    for (const fen of FENS) {
        const pos = new C.Position(fen);
        assert.equal(pos.fen(), fen);
        assert.deepEqual([pos.hashLo, pos.hashHi], [C.Position.fromFen(fen).hashLo, C.Position.fromFen(fen).hashHi]);
        assert.equal(pos.clone().fen(), fen);
    }
    for (const bad of ['not a fen', '', null, 42, '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1']) {
        assert.throws(
            () => new C.Position(bad),
            (e) => e instanceof C.ChessError && e.code === 'fen',
            String(bad),
        );
    }
});

test('the position holds the board, the side, rights, kings, counts and a hash', () => {
    const pos = C.Position.fromFen(FENS[0]);
    assert.ok(pos.board instanceof Int8Array && pos.board.length === 128);
    assert.equal(pos.board[C.parseSquare('e1')], C.makePiece(C.WHITE, C.KING));
    assert.equal(pos.board[C.parseSquare('d8')], C.makePiece(C.BLACK, C.QUEEN));
    assert.equal(pos.side, C.WHITE);
    assert.equal(pos.castling, C.WK | C.WQ | C.BK | C.BQ);
    assert.deepEqual([C.WK, C.WQ, C.BK, C.BQ], [1, 2, 4, 8]);
    assert.equal(pos.ep, -1);
    assert.equal(pos.halfmove, 0);
    assert.equal(pos.fullmove, 1);
    assert.ok(pos.kings instanceof Int16Array);
    assert.deepEqual([...pos.kings], [C.parseSquare('e1'), C.parseSquare('e8')]);
    assert.ok(pos.counts instanceof Uint8Array && pos.counts.length === 16);
    assert.equal(pos.counts[C.makePiece(C.WHITE, C.PAWN)], 8);
    assert.equal(pos.counts[C.makePiece(C.BLACK, C.KNIGHT)], 2);
    assert.equal(pos.counts[C.makePiece(C.BLACK, C.KING)], 1);
    assert.equal(typeof pos.hashLo, 'number');
    assert.equal(pos.hashLo | 0, pos.hashLo);
    assert.equal(pos.hashHi | 0, pos.hashHi);
});

test('the hash of a parsed position equals a recomputation, and differs with the side or the rights', () => {
    const hashes = new Set();
    for (const fen of FENS) {
        const pos = C.Position.fromFen(fen);
        const h = C.computeHash(pos);
        assert.deepEqual([pos.hashLo, pos.hashHi], [h.lo, h.hi], fen);
        hashes.add(`${pos.hashLo}:${pos.hashHi}`);
    }
    assert.equal(hashes.size, FENS.length);
    const a = C.Position.fromFen('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
    const b = C.Position.fromFen('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const c = C.Position.fromFen('4k3/8/8/8/8/8/8/R3K3 b Q - 0 1');
    assert.notDeepEqual([a.hashLo, a.hashHi], [b.hashLo, b.hashHi]);
    assert.notDeepEqual([a.hashLo, a.hashHi], [c.hashLo, c.hashHi]);
    // the counters do not enter the hash
    const d = C.Position.fromFen('4k3/8/8/8/8/8/8/R3K3 w Q - 7 30');
    assert.deepEqual([a.hashLo, a.hashHi], [d.hashLo, d.hashHi]);
});

test('a FEN of four fields gets the counters 0 and 1; spaces around and between fields are fine', () => {
    assert.equal(C.Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -').fen(), FENS[0]);
    assert.equal(C.Position.fromFen('  rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR   w KQkq -  0   1 \n').fen(), FENS[0]);
    assert.equal(C.Position.fromFen('4k3/8/8/8/8/8/8/4K3 b - - 12').fen(), '4k3/8/8/8/8/8/8/4K3 b - - 12 1');
});

test('en passant: kept when a pawn can take, dropped when none stands beside the pawn that moved', () => {
    assert.equal(C.Position.fromFen('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1').fen(), '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
    assert.equal(C.Position.fromFen('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1').ep, C.parseSquare('e3'));
    const opened = C.Position.fromFen('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    assert.equal(opened.ep, -1);
    assert.equal(opened.fen(), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    const h = C.computeHash(opened);
    assert.deepEqual([opened.hashLo, opened.hashHi], [h.lo, h.hi]);
    const withEp = C.Position.fromFen('4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1');
    const withoutEp = C.Position.fromFen('4k3/8/8/3Pp3/8/8/8/4K3 w - - 0 1');
    assert.notDeepEqual([withEp.hashLo, withEp.hashHi], [withoutEp.hashLo, withoutEp.hashHi]);
    const h2 = C.computeHash(withEp);
    assert.deepEqual([withEp.hashLo, withEp.hashHi], [h2.lo, h2.hi]);
});

test('an invalid FEN throws a ChessError with the reason', () => {
    const cases = [
        ['8/8/8/8/8/8/8/8', 'fields'],
        ['', 'fields'],
        ['4k3/8/8/8/8/8/8/4K3 w - - 0 1 extra', 'fields'],
        [42, 'fields'],
        [null, 'fields'],
        ['4k3/8/8/8/8/8/8/4K2 w - - 0 1', 'board'],
        ['4k3/8/8/8/8/8/4K3 w - - 0 1', 'board'],
        ['4k3/8/8/8/8/8/8/4K3X w - - 0 1', 'board'],
        ['4k3/8/8/8/8/8/8/4K12 w - - 0 1', 'board'],
        ['4k3/8/8/8/8/8/8/44 w - - 0 1', 'board'],
        ['4k3/8/8/8/8/8/8/4K3 x - - 0 1', 'side'],
        ['4k3/8/8/8/8/8/8/4K3 w X - 0 1', 'castling'],
        ['4k3/8/8/8/8/8/8/4K3 w KQkqKQkqKQkqKQkqKQkq - 0 1', 'castling'],
        ['4k3/8/8/8/8/8/8/4K3 w KK - 0 1', 'castling'],
        ['4k3/8/8/8/8/8/8/4K3 w - e9 0 1', 'ep'],
        ['4k3/8/8/8/8/8/8/4K3 w - - -1 1', 'counters'],
        ['4k3/8/8/8/8/8/8/4K3 w - - 0 0', 'counters'],
        ['4k3/8/8/8/8/8/8/4K3 w - - a 1', 'counters'],
        ['4k3/8/8/8/8/8/8/4K3 w - - 1.5 1', 'counters'],
        ['4k3/8/8/8/8/8/8/3KK3 w - - 0 1', 'kings'],
        ['8/8/8/8/8/8/8/4K3 w - - 0 1', 'kings'],
        ['4k3/8/8/8/P7/8/PPPPPPPP/4K3 w - - 0 1', 'pieces'],
        ['P3k3/8/8/8/8/8/8/4K3 w - - 0 1', 'pawn-rank'],
        ['4k3/8/8/8/8/8/8/p3K3 w - - 0 1', 'pawn-rank'],
        ['4k3/4R3/8/8/8/8/8/4K3 w - - 0 1', 'opponent-in-check'],
        ['8/8/8/8/8/8/3k4/4K3 w - - 0 1', 'opponent-in-check'],
        ['r3k2r/8/8/8/8/8/8/4K3 w KQkq - 0 1', 'castling'],
        ['r3k2r/8/8/8/8/8/8/3K3R w K - 0 1', 'castling'],
        ['4k3/8/8/8/8/8/8/4K3 w - e6 0 1', 'ep'],
        ['4k3/8/8/4p3/8/8/8/4K3 w - e3 0 1', 'ep'],
        ['4k3/8/8/4p3/8/8/8/4K3 b - e6 0 1', 'ep'],
        ['4k3/4p3/8/4p3/8/8/8/4K3 w - e6 0 1', 'ep'],
    ];
    for (const [fen, reason] of cases) assert.equal(reasonOf(fen), reason, String(fen));
    assert.equal(reasonOf('4k3/8/8/8/8/8/4R3/4K3 b - - 0 1'), null, 'the side to move may be in check');
    assert.equal(reasonOf('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1'), null);
});

test('a ChessError carries its code, the data and a message in every language', () => {
    let err;
    try {
        C.Position.fromFen('8/8/8/8/8/8/8/8');
    } catch (e) {
        err = e;
    }
    assert.ok(err instanceof Error);
    assert.equal(err.name, 'ChessError');
    assert.equal(err.code, 'fen');
    assert.equal(err.data.reason, 'fields');
    assert.equal(err.data.count, 1);
    assert.equal(err.message, 'core.fen.fields');
    assert.equal(typeof err.text.en, 'string');
    assert.equal(typeof err.text.ru, 'string');
    assert.ok(err.text.en.includes('1') && err.text.ru.includes('1'));
    assert.notEqual(err.text.en, err.text.ru);
    // every reason a FEN can be rejected with has a message
    for (const fen of ['4k3/8/8/8/8/8/8/3KK3 w - - 0 1', '4k3/8/8/8/8/8/8/4K3 w - e6 0 1', 'P3k3/8/8/8/8/8/8/4K3 w - - 0 1']) {
        try {
            C.Position.fromFen(fen);
        } catch (e) {
            assert.notEqual(e.text.en, e.message);
            assert.notEqual(e.text.ru, e.message);
        }
    }
});

test('the user text a FEN error echoes is cut to 16 characters and an ellipsis', () => {
    const long = 'x'.repeat(40);
    for (const fen of [`4k3/8/8/8/8/8/8/4K3 ${long} - - 0 1`, `4k3/8/8/8/8/8/8/4K3 w ${long} - 0 1`, `4k3/8/8/8/8/8/8/4K3 w - ${long} 0 1`]) {
        let err;
        try {
            C.Position.fromFen(fen);
        } catch (e) {
            err = e;
        }
        assert.ok(err instanceof C.ChessError, fen);
        assert.equal(err.data.text, `${'x'.repeat(16)}…`);
        assert.ok(err.text.en.includes(`${'x'.repeat(16)}…`) && !err.text.en.includes('x'.repeat(17)));
        assert.ok(err.text.ru.includes(`${'x'.repeat(16)}…`) && !err.text.ru.includes('x'.repeat(17)));
    }
    let short;
    try {
        C.Position.fromFen('4k3/8/8/8/8/8/8/4K3 q - - 0 1');
    } catch (e) {
        short = e;
    }
    assert.equal(short.data.text, 'q', 'a short text is kept as it is');
});

test('clone gives an independent copy', () => {
    const pos = C.Position.fromFen(FENS[1]);
    const copy = pos.clone();
    assert.equal(copy.fen(), pos.fen());
    assert.deepEqual([copy.hashLo, copy.hashHi], [pos.hashLo, pos.hashHi]);
    copy.board[0] = 0;
    copy.kings[0] = 0;
    copy.counts[1] = 0;
    assert.notEqual(pos.board[0], 0);
    assert.notEqual(pos.kings[0], 0);
    assert.notEqual(pos.counts[1], 0);
});

test('the package exports the core surface', async () => {
    const P = await import('../src/index.js');
    for (const name of [
        'Position',
        'ChessError',
        'computeHash',
        'square',
        'sqName',
        'parseSquare',
        'makePiece',
        'pieceToFen',
        'encodeMove',
        'moveToUci',
        'WHITE',
        'KING',
    ])
        assert.ok(name in P, name);
});
