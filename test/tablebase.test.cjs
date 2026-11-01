// tablebase: material keys, the index and its symmetries, the generator against Position, the shipped tables
// (known maxima, KPK, KNNK, consistency of DTM over random positions, colour flips), en passant and the API.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let E; // endgame
let G; // endgame/tb-generate (the direct-board generator, checked against Position)
let X; // endgame/tb-index
let C; // core
const SHIPPED = ['KQK', 'KRK', 'KBBK', 'KBNK', 'KNNK', 'KPK'];
const DATA = path.join(__dirname, '../data/tb');

before(async () => {
    E = await import('../src/endgame/index.js');
    G = await import('../src/endgame/tb-generate.js');
    X = await import('../src/endgame/tb-index.js');
    C = await import('../src/core/index.js');
    await E.preloadTables(SHIPPED);
});

const pos = (fen) => C.Position.fromFen(fen);

// a deterministic stream of numbers in [0, 1)
const rng = (seed) => () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x80000000;
};

// a random legal position of the pieces ('KRk' = white king and rook, black king) with the side to move, as a FEN
function randomFen(letters, side, rnd) {
    for (;;) {
        const board = new Array(64).fill('');
        let ok = true;
        for (const ch of letters) {
            const sq = Math.floor(rnd() * 64);
            if (board[sq] || ((ch === 'P' || ch === 'p') && (sq < 8 || sq >= 56))) {
                ok = false;
                break;
            }
            board[sq] = ch;
        }
        if (!ok) continue;
        const rows = [];
        for (let r = 7; r >= 0; r--) {
            let row = '';
            let run = 0;
            for (let f = 0; f < 8; f++) {
                const ch = board[r * 8 + f];
                if (!ch) run++;
                else {
                    if (run) row += run;
                    run = 0;
                    row += ch;
                }
            }
            if (run) row += run;
            rows.push(row);
        }
        const fen = `${rows.join('/')} ${side} - - 0 1`;
        try {
            pos(fen);
            return fen;
        } catch {
            // the side not to move is in check: draw again
        }
    }
}

// the colour flip of a FEN: ranks mirrored, colours and the side to move swapped
function flipFen(fen) {
    const [board, side, , ep] = fen.split(' ');
    const swap = (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());
    const rows = board
        .split('/')
        .reverse()
        .map((r) => [...r].map((ch) => (/\d/.test(ch) ? ch : swap(ch))).join(''));
    const epFlip = ep === '-' ? '-' : ep[0] + (9 - Number(ep[1]));
    return `${rows.join('/')} ${side === 'w' ? 'b' : 'w'} - ${epFlip} 0 1`;
}

test('material keys: the strong side first, pieces by value, a colour flip when Black is stronger', () => {
    assert.equal(E.materialKey(pos('k7/8/8/8/8/8/8/KQ6 w - - 0 1')), 'KQK');
    assert.equal(E.materialKey(pos('k7/8/8/8/8/8/8/Kq6 w - - 0 1')), 'KQK');
    assert.equal(E.materialKey(pos('k7/8/8/8/8/8/8/KQr5 b - - 0 1')), 'KQKR');
    assert.equal(E.materialKey(pos('k7/8/8/8/8/8/8/KRq5 b - - 0 1')), 'KQKR');
    assert.equal(E.materialKey(pos('k7/8/8/8/3P4/8/8/KR6 w - - 0 1')), 'KRPK');
    assert.equal(E.materialKey(pos('k7/8/8/8/3p4/8/8/KB6 w - - 0 1')), 'KBKP');
    assert.equal(E.materialKey(pos('k7/8/8/8/8/8/8/KNB5 w - - 0 1')), 'KBNK');
    assert.equal(E.materialKey(pos('k7/8/8/8/8/8/8/KBn5 w - - 0 1')), 'KBKN');
    assert.equal(E.materialKey(pos('k7/8/8/8/8/8/8/K7 w - - 0 1')), 'KK');
    assert.equal(E.materialKey(pos(C.Position.START_FEN)), null, 'more than four pieces have no key');
    assert.equal(X.keyInfo(pos('k7/8/8/8/8/8/8/Kq6 w - - 0 1')).flip, 1);
    assert.equal(X.keyInfo(pos('k7/8/8/8/8/8/8/KQ6 w - - 0 1')).flip, 0);
});

test('table sizes: 10 triangle squares for the strong king without pawns, its 32 squares of files a–d with pawns', () => {
    assert.equal(X.tbSize('KQK'), 10 * 64 * 64 * 2);
    assert.equal(X.tbSize('KQKR'), 10 * 64 * 64 * 64 * 2);
    assert.equal(X.tbSize('KPK'), 32 * 48 * 64 * 2);
    assert.equal(X.tbSize('KRPK'), 32 * 64 * 48 * 64 * 2);
    assert.equal(X.tbSize('KPKP'), 32 * 48 * 64 * 48 * 2);
    for (const bad of ['', 'KQ', 'QKK', 'KQQQKR', 'KXK', 'KPQK', 'kqk', null]) assert.equal(X.tbSize(bad), 0, String(bad));
});

test('the index: equal for the 8 symmetries without pawns and the file mirror with pawns, distinct otherwise', () => {
    const rnd = rng(7);
    const transforms = [
        (f, r) => [f, r],
        (f, r) => [7 - f, r],
        (f, r) => [f, 7 - r],
        (f, r) => [7 - f, 7 - r],
        (f, r) => [r, f],
        (f, r) => [7 - r, f],
        (f, r) => [r, 7 - f],
        (f, r) => [7 - r, 7 - f],
    ];
    const remap = (fen, t) => {
        const [board, ...rest] = fen.split(' ');
        const grid = Array.from({ length: 8 }, () => new Array(8).fill(''));
        board.split('/').forEach((row, i) => {
            let f = 0;
            for (const ch of row) {
                if (/\d/.test(ch)) f += Number(ch);
                else grid[7 - i][f++] = ch;
            }
        });
        const out = Array.from({ length: 8 }, () => new Array(8).fill(''));
        for (let r = 0; r < 8; r++)
            for (let f = 0; f < 8; f++) {
                const [f2, r2] = t(f, r);
                out[r2][f2] = grid[r][f];
            }
        const rows = [];
        for (let r = 7; r >= 0; r--)
            rows.push(
                out[r]
                    .map((ch) => ch || '1')
                    .join('')
                    .replace(/1+/g, (m) => String(m.length)),
            );
        return [rows.join('/'), ...rest].join(' ');
    };
    for (let i = 0; i < 300; i++) {
        const fen = randomFen('KRBk', rnd() < 0.5 ? 'w' : 'b', rnd);
        const idx = X.tbIndex('KRBK', pos(fen));
        assert.ok(idx >= 0 && idx < X.tbSize('KRBK'));
        for (const t of transforms) assert.equal(X.tbIndex('KRBK', pos(remap(fen, t))), idx, `${fen} → ${remap(fen, t)}`);
        const p = randomFen('KPkr', 'w', rnd);
        assert.equal(X.tbIndex('KRKP', pos(p)), X.tbIndex('KRKP', pos(flipFen(p))), 'a colour flip is the same entry');
        assert.equal(X.tbIndex('KRKP', pos(p)), X.tbIndex('KRKP', pos(remap(p, transforms[1]))), 'the file mirror is the same entry');
    }
    // two bishops: one entry for both ways of numbering them, under every symmetry
    for (let i = 0; i < 100; i++) {
        const fen = randomFen('KBBk', rnd() < 0.5 ? 'w' : 'b', rnd);
        const idx = X.tbIndex('KBBK', pos(fen));
        for (const t of transforms) assert.equal(X.tbIndex('KBBK', pos(remap(fen, t))), idx, fen);
    }
    // different positions: different entries
    const seen = new Map();
    for (let i = 0; i < 2000; i++) {
        const fen = randomFen('KQk', rnd() < 0.5 ? 'w' : 'b', rnd);
        const idx = X.tbIndex('KQK', pos(fen));
        const canon = [0, 1, 2, 3, 4, 5, 6, 7].map((t) => remap(fen, transforms[t])).sort()[0];
        if (seen.has(idx)) assert.equal(seen.get(idx), canon, 'one entry, one position up to symmetry');
        seen.set(idx, canon);
    }
});

test('the direct-board generator agrees with Position: legal moves and the predecessors of the retrograde step', () => {
    const rnd = rng(11);
    for (const [key, letters] of [
        ['KRK', 'KRk'],
        ['KBNK', 'KBNk'],
        ['KPK', 'KPk'],
        ['KQKP', 'KQkp'],
        ['KPKP', 'KPkp'],
        ['KRPK', 'KRPk'],
    ]) {
        for (let i = 0; i < 150; i++) {
            const fen = randomFen(letters, rnd() < 0.5 ? 'w' : 'b', rnd);
            const p = pos(fen);
            const expected = C.legalMoves(p).map(C.moveToUci).sort();
            assert.deepEqual(G.boardMoves(fen).sort(), expected, `${key} ${fen}`);
            // every predecessor has a legal move into the position, and the in-table moves of a predecessor lead back
            for (const prev of G.boardPredecessors(fen)) {
                const q = pos(prev);
                const reached = C.legalMoves(q).some((m) => {
                    q.make(m);
                    const same = q.fen().split(' ').slice(0, 2).join(' ') === fen.split(' ').slice(0, 2).join(' ');
                    q.unmake();
                    return same;
                });
                assert.ok(reached, `${prev} does not reach ${fen}`);
            }
        }
    }
    // a pawn that has just made a double step with an enemy pawn beside it: en passant is the only way back to it
    assert.ok(G.boardPredecessors('4k3/8/8/8/3pP3/8/8/4K3 b - - 0 1').includes('4k3/8/8/8/3p4/8/4P3/4K3 w - - 0 1') === false);
    assert.ok(G.boardPredecessors('4k3/8/8/8/2p1P3/8/8/4K3 b - - 0 1').includes('4k3/8/8/8/2p5/8/4P3/4K3 w - - 0 1'));
});

test('generating a three-piece table reproduces the shipped one', () => {
    for (const key of ['KQK', 'KPK']) {
        const made = G.buildTable(key, (k) => E.getTable(k));
        const shipped = E.getTable(key);
        assert.equal(made.length, X.tbSize(key));
        let diff = 0;
        for (let i = 0; i < made.length; i++) if (made[i] !== shipped[i]) diff++;
        assert.equal(diff, 0, key);
    }
});

test('known maxima: KQK mates in 10, KRK in 16, KBNK in 33, KBBK in 19', () => {
    const max = (key) => {
        const t = E.getTable(key);
        let m = 0;
        let min = 0;
        for (let i = 0; i < t.length; i++) {
            if (t[i] > m) m = t[i];
            if (t[i] !== X.ILLEGAL && t[i] !== X.MATED && t[i] < min) min = t[i];
        }
        return [m, -min];
    };
    assert.deepEqual(max('KQK'), [10, 10]);
    assert.deepEqual(max('KRK'), [16, 16]);
    assert.deepEqual(max('KBNK'), [33, 33]);
    assert.deepEqual(max('KBBK'), [19, 19]);
});

test('KNNK: two knights never force mate — every position a draw unless the mate is already on the board', () => {
    // the only exceptions: the defender is checkmated (−0), or the knights mate at once (+1); the defender is never
    // driven into a mate, and the lone king wins nothing
    const t = E.getTable('KNNK');
    const counts = new Map();
    for (let i = 0; i < t.length; i++) if (t[i] !== X.ILLEGAL) counts.set(t[i], (counts.get(t[i]) ?? 0) + 1);
    const draws = counts.get(0);
    const decisive = [...counts].filter(([v]) => v !== 0).reduce((s, [, c]) => s + c, 0);
    assert.ok(decisive < draws / 1000, `decisive ${decisive} of ${draws}`);
    assert.deepEqual(
        [...counts.keys()].sort((a, b) => a - b),
        [X.MATED, 0, 1],
    );
    for (let i = 0; i < t.length; i++) if (t[i] === X.MATED || t[i] === 1) assert.ok(i < t.length / 2 === (t[i] === 1), 'mates by White only');
    // a mate on the board, a mate in one, and the usual case: a draw
    assert.deepEqual(E.probe(pos('7k/5K2/6N1/6N1/8/8/8/8 b - - 0 1')), { wdl: -1, dtm: 0 });
    assert.deepEqual(E.probe(pos('7k/5K2/8/4N1N1/8/8/8/8 w - - 0 1')), { wdl: 1, dtm: 1 });
    assert.deepEqual(E.probe(pos('8/8/8/3k4/8/8/2NN4/4K3 w - - 0 1')), { wdl: 0, dtm: 0 });
    assert.deepEqual(E.probe(pos('8/8/8/3k4/8/8/2NN4/4K3 b - - 0 1')), { wdl: 0, dtm: 0 });
});

test('KPK: the defender in front of the pawn draws; the opposition decides; two squares ahead of the pawn always wins', () => {
    assert.equal(E.probe(pos('8/8/8/8/8/4k3/4P3/4K3 w - - 0 1')).wdl, 0);
    assert.equal(E.probe(pos('8/8/8/8/8/4k3/4P3/4K3 b - - 0 1')).wdl, 0);
    // Ke3, e2 against Ke5: with Black to move White has the opposition and wins; with White to move it is a draw
    // (the pawn cannot pass its own king to gain the tempo) — checked against an independent solver on Position
    assert.deepEqual(E.probe(pos('8/8/8/4k3/8/4K3/4P3/8 b - - 0 1')), { wdl: -1, dtm: -20 });
    assert.deepEqual(E.probe(pos('8/8/8/4k3/8/4K3/4P3/8 w - - 0 1')), { wdl: 0, dtm: 0 });
    // the king two squares in front of its pawn wins whoever is to move
    assert.deepEqual(E.probe(pos('8/8/4k3/8/4K3/8/4P3/8 w - - 0 1')), { wdl: 1, dtm: 19 });
    assert.deepEqual(E.probe(pos('8/8/4k3/8/4K3/8/4P3/8 b - - 0 1')), { wdl: -1, dtm: -18 });
    // KRKN is not shipped and nothing before this line loads or generates it (KQKR is shipped, so it would not do)
    assert.equal(E.hasTable('KRKN'), false, 'KRKN must not be in memory for this check');
    assert.equal(E.probe(pos('k7/8/1K6/8/8/8/8/1R4n1 w - - 0 1')), null, 'a table that is not loaded gives null');
    assert.equal(E.probe(pos('4k3/8/8/8/8/8/8/4K2R w K - 0 1')), null, 'castling rights are not in the tables');
    assert.deepEqual(E.probe(pos('8/8/8/8/8/8/7R/k1K5 b - - 0 1')), { wdl: 0, dtm: 0 }, 'stalemate is a draw');
    assert.deepEqual(E.probe(pos('k6R/8/1K6/8/8/8/8/8 b - - 0 1')), { wdl: -1, dtm: 0 }, 'checkmate is −0');
    assert.deepEqual(E.probe(pos('k7/8/1K6/8/8/8/8/7R w - - 0 1')), { wdl: 1, dtm: 1 });
});

test('consistency over 2000 random KRK positions: +n has a move to −(n−1) and none better; −n has only replies to ≤ +n', () => {
    const rnd = rng(2026);
    for (let i = 0; i < 2000; i++) {
        const p = pos(randomFen(rnd() < 0.5 ? 'KRk' : 'krK', rnd() < 0.5 ? 'w' : 'b', rnd));
        const v = E.probe(p);
        assert.ok(v, p.fen());
        const children = C.legalMoves(p).map((m) => {
            p.make(m);
            const c = E.probe(p);
            p.unmake();
            return c;
        });
        if (!children.length) {
            assert.equal(v.dtm, 0);
            assert.equal(v.wdl, p.inCheck() ? -1 : 0);
            continue;
        }
        if (v.wdl === 1) {
            assert.ok(
                children.some((c) => c.wdl === -1 && c.dtm === -(v.dtm - 1)),
                `${p.fen()}: no move to −${v.dtm - 1}`,
            );
            assert.ok(!children.some((c) => c.wdl === -1 && -c.dtm < v.dtm - 1), `${p.fen()}: a faster mate`);
        } else if (v.wdl === -1) {
            assert.ok(
                children.every((c) => c.wdl === 1 && c.dtm <= -v.dtm),
                `${p.fen()}: an escape`,
            );
            assert.ok(
                children.some((c) => c.dtm === -v.dtm),
                `${p.fen()}: mated sooner than the table says`,
            );
        } else assert.ok(children.every((c) => c.wdl !== -1) && children.some((c) => c.wdl === 0), p.fen());
        // the best moves the table gives keep the result and the distance
        const best = E.bestTbMoves(p);
        assert.ok(best.length > 0);
        for (const b of best) assert.equal(b.dtm, v.dtm, p.fen());
    }
});

test('a colour-flipped position probes the same as the original', () => {
    const rnd = rng(99);
    for (const letters of ['KQk', 'KRk', 'KBNk', 'KBBk', 'KPk', 'KNNk']) {
        for (let i = 0; i < 300; i++) {
            const fen = randomFen(letters, rnd() < 0.5 ? 'w' : 'b', rnd);
            assert.deepEqual(E.probe(pos(flipFen(fen))), E.probe(pos(fen)), fen);
        }
    }
});

const KPKP_SHIPPED = fs.existsSync(path.join(DATA, 'KPKP.bin'));
test('en passant: a position with an en passant square takes the capture into account', { skip: !KPKP_SHIPPED && 'KPKP is not shipped' }, async () => {
    await E.preloadTables(['KPKP']);
    // KPKP: White has just played e2-e4, the d4 pawn may take en passant
    const fen = '8/8/8/8/3pP3/8/8/K6k b - e3 0 1';
    const withEp = pos(fen);
    assert.equal(withEp.ep, C.parseSquare('e3'));
    const v = E.probe(withEp);
    const children = C.legalMoves(withEp).map((m) => {
        withEp.make(m);
        const c = E.probe(withEp);
        withEp.unmake();
        return c.wdl === 0 ? 0 : c.wdl === 1 ? -1000 + c.dtm : 1000 - c.dtm;
    });
    const best = Math.max(...children);
    const mine = v.wdl === 0 ? 0 : v.wdl === 1 ? 1000 - v.dtm : -1000 - v.dtm;
    assert.equal(mine, best);
});

test('tablebase(fen): a failure that is not a ChessError is still a typed fen result, never a throw', async () => {
    const real = C.Position.fromFen;
    C.Position.fromFen = () => {
        throw new TypeError('something unexpected');
    };
    let r;
    try {
        r = await E.tablebase('8/8/8/3k4/8/8/8/KQ6 w - - 0 1');
    } finally {
        C.Position.fromFen = real;
    }
    assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'fen']);
    assert.ok(r.reason.en.length > 0 && r.reason.ru.length > 0);
    assert.equal(/unexpected/.test(r.reason.en), true, 'the message says what kind of failure it was');
});

test('tb.js reads files through a variable specifier marked @vite-ignore, as the client does', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/endgame/tb.js'), 'utf8');
    assert.equal(/import\(\s*['"]node:/.test(source), false, 'no import() of a literal node: specifier');
    assert.equal(/import\(\s*\/\*\s*@vite-ignore\s*\*\/\s*[A-Z_]+\s*\)/.test(source), true);
});

test('generateTable: an Int8Array in the documented encoding, dependencies first', () => {
    const seen = [];
    const t = E.generateTable('KRK', { onProgress: (p) => seen.push(p.phase) });
    assert.ok(seen.includes('init') && seen.includes('retro') && seen.at(-1) === 'done');
    assert.ok(t instanceof Int8Array);
    assert.equal(t.length, X.tbSize('KRK'));
    assert.ok(t.includes(X.ILLEGAL) && t.includes(X.MATED) && t.includes(0) && t.includes(16) && t.includes(-16));
    assert.deepEqual(X.decodeValue(X.MATED), { wdl: -1, dtm: 0 });
    assert.deepEqual(X.decodeValue(0), { wdl: 0, dtm: 0 });
    assert.deepEqual(X.decodeValue(5), { wdl: 1, dtm: 5 });
    assert.deepEqual(X.decodeValue(-5), { wdl: -1, dtm: -5 });
    assert.equal(X.decodeValue(X.ILLEGAL), null);
    assert.deepEqual(X.tbDependencies('KPK').sort(), ['KQK', 'KRK']);
    assert.deepEqual(X.tbDependencies('KRPK').sort(), ['KPK', 'KQRK', 'KRBK', 'KRK', 'KRNK', 'KRRK']);
    assert.deepEqual(X.tbDependencies('KPKP').sort(), ['KBKP', 'KNKP', 'KPK', 'KQKP', 'KRKP']);
    assert.deepEqual(X.tbDependencies('KNNK'), []);
});

test('the shipped files: header, deflate, the size budget', () => {
    const files = fs.readdirSync(DATA).filter((f) => f.endsWith('.bin'));
    for (const key of SHIPPED) assert.ok(files.includes(`${key}.bin`), key);
    let total = 0;
    for (const f of files) {
        const bytes = fs.readFileSync(path.join(DATA, f));
        total += bytes.length;
        assert.equal(bytes.subarray(0, 4).toString('latin1'), 'SCTB');
        const head = X.readHeader(new Uint8Array(bytes));
        assert.equal(head.key, f.replace('.bin', ''));
        assert.equal(head.size, X.tbSize(head.key));
    }
    assert.ok(total <= 8 * 1024 * 1024, `data/tb holds ${total} bytes`);
});

test('tablebase(fen): typed failures, the result with ranked moves', async () => {
    const bad = await E.tablebase('not a fen');
    assert.equal(bad.ok, false);
    assert.equal(bad.kind, 'invalid');
    assert.equal(bad.code, 'fen');
    assert.ok(bad.reason.en && bad.reason.ru);
    const many = await E.tablebase(C.Position.START_FEN);
    assert.deepEqual([many.ok, many.kind, many.code], [false, 'invalid', 'too-many-pieces']);
    assert.ok(many.reason.en.length > 0);
    const castle = await E.tablebase('4k3/8/8/8/8/8/8/R3K3 w Q - 0 1');
    assert.deepEqual([castle.ok, castle.code], [false, 'castling']);
    assert.equal((await E.tablebase(null)).code, 'fen');
    assert.equal((await E.tablebase(undefined)).code, 'fen');
    assert.equal((await E.tablebase({})).code, 'fen');
    const r = await E.tablebase('8/8/8/3k4/8/8/8/KQ6 w - - 0 1');
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'tablebase');
    assert.equal(r.key, 'KQK');
    assert.equal(r.wdl, 1);
    assert.ok(r.dtm > 0);
    assert.ok(r.moves.length > 0);
    assert.equal(r.moves[0].dtm, r.dtm);
    assert.ok(typeof r.moves[0].uci === 'string' && typeof r.moves[0].san === 'string');
    // the king takes the queen: Kxb1 draws; the list is ranked best first, for the side to move
    const blk = await E.tablebase('8/8/8/8/8/3K4/1k6/1Q6 b - - 0 1');
    assert.equal(blk.wdl, 0);
    assert.equal(blk.moves[0].san, 'Kxb1');
    const mate = await E.tablebase('k7/8/1K6/8/8/8/8/7R w - - 0 1');
    assert.equal(mate.moves[0].san, 'Rh8#');
    assert.equal(mate.moves[0].dtm, 1);
});

// A KPKP position with an en passant square, built the way it arises: one side has just made a double step beside an enemy pawn.
function epFen(rnd, whiteDoubled) {
    for (;;) {
        const file = Math.floor(rnd() * 8);
        const beside = file + (rnd() < 0.5 ? -1 : 1);
        if (beside < 0 || beside > 7) continue;
        const rows = new Array(8).fill(null).map(() => new Array(8).fill(''));
        const taken = new Set();
        const put = (r, f, ch) => {
            if (taken.has(r * 8 + f)) return false;
            taken.add(r * 8 + f);
            rows[r][f] = ch;
            return true;
        };
        // White doubled: pawn on rank 4 (index 3), the square behind it is rank 3 (index 2); Black doubled: rank 5 (index 4), behind it rank 6 (index 5)
        const [doubler, taker, rank, behind, origin] = whiteDoubled ? ['P', 'p', 3, 2, 1] : ['p', 'P', 4, 5, 6];
        put(rank, file, doubler);
        put(rank, beside, taker);
        taken.add(behind * 8 + file);
        taken.add(origin * 8 + file);
        const king = () => [Math.floor(rnd() * 8), Math.floor(rnd() * 8)];
        let [r, f] = king();
        if (!put(r, f, 'K')) continue;
        [r, f] = king();
        if (!put(r, f, 'k')) continue;
        const board = rows
            .map((row) => {
                let out = '';
                let run = 0;
                for (const ch of row) {
                    if (!ch) run++;
                    else {
                        if (run) out += run;
                        run = 0;
                        out += ch;
                    }
                }
                return out + (run || '');
            })
            .reverse()
            .join('/');
        const ep = `${'abcdefgh'[file]}${behind + 1}`;
        const side = whiteDoubled ? 'b' : 'w';
        return { fen: `${board} ${side} - ${ep} 0 1`, plain: `${board} ${side} - - 0 1` };
    }
}

test(
    'KPKP generated on demand: the en passant probe is a one-ply look-ahead whose value matches a brute force',
    { skip: !process.env.TB_SLOW && 'set TB_SLOW=1: generating KPKP and the tables below it takes minutes', timeout: 30 * 60 * 1000 },
    () => {
        assert.equal(E.hasTable('KPKP'), false, 'KPKP is not shipped');
        const seen = new Set();
        const table = E.generateTable('KPKP', { onProgress: (p) => seen.add(p.key) });
        assert.ok(table instanceof Int8Array && table.length === X.tbSize('KPKP'));
        assert.equal(E.hasTable('KPKP'), true);
        for (const dep of X.tbDependencies('KPKP')) assert.equal(E.hasTable(dep), true, dep);

        const rnd = rng(7);
        let matter = 0;
        let epIsBest = 0;
        const total = 600;
        for (let i = 0; i < total; i++) {
            const { fen, plain } = epFen(rnd, i % 2 === 0);
            let p;
            try {
                p = pos(fen);
            } catch {
                continue;
            }
            assert.notEqual(p.ep, -1, fen);
            const v = E.probe(p);
            assert.ok(v, fen);
            // brute force: try every legal move and take the best, valuing the child by its table entry (the child has no en passant square)
            let best = null;
            let bestIsEp = false;
            for (const m of C.legalMoves(p)) {
                p.make(m);
                const c = E.probe(p);
                p.unmake();
                assert.ok(c, `${fen}: child unreadable`);
                // for the mover: wdl and distance in moves of the child seen from the other side
                const mine = c.wdl === 0 ? { wdl: 0, dtm: 0 } : c.wdl < 0 ? { wdl: 1, dtm: 1 - c.dtm } : { wdl: -1, dtm: -c.dtm };
                const score = mine.wdl === 0 ? 0 : mine.wdl > 0 ? 1000 - mine.dtm : -1000 - mine.dtm;
                if (best === null || score > best.score) {
                    best = { score, ...mine };
                    bestIsEp = (C.moveFlags(m) & C.F_EP) !== 0;
                }
            }
            if (best === null) best = { score: 0, wdl: 0, dtm: 0 }; // no legal move: stalemate (a mate has no en passant square here)
            assert.deepEqual(v, { wdl: best.wdl, dtm: best.dtm }, fen);
            // the same position with the en passant square dropped reads straight from the table; it differs when the capture matters
            const without = E.probe(pos(plain));
            if (without.wdl !== v.wdl || without.dtm !== v.dtm) matter++;
            if (bestIsEp) epIsBest++;
        }
        assert.ok(matter > 0, 'the en passant capture changed the value of at least one sampled position');
        assert.ok(epIsBest > 0, 'the en passant capture was the best move of at least one sampled position');
        assert.ok(seen.has('KPKP'));
    },
);

test('a table fetch has a 30 s timeout and a stream that inflates past its size is refused early (M4)', { timeout: 20000 }, async () => {
    const TB = await import('../src/endgame/tb.js');
    const zlib = require('node:zlib');
    assert.equal(TB.FETCH_TIMEOUT_MS, 30000);
    // the inflate: the exact size is accepted, a shorter stream or a bomb is not, and the bomb is not inflated whole
    const raw = new Uint8Array(1000).map((_, i) => i & 0xff);
    assert.deepEqual(await TB.inflateExactly(zlib.deflateSync(raw), 1000), raw);
    assert.equal(await TB.inflateExactly(zlib.deflateSync(raw), 1001), null);
    const bomb = zlib.deflateSync(Buffer.alloc(64 * 1024 * 1024));
    const t0 = Date.now();
    assert.equal(await TB.inflateExactly(bomb, 1000), null);
    assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms: the bomb was inflated whole`);
    assert.equal(await TB.inflateExactly(new Uint8Array([1, 2, 3]), 3), null);
    // the fetch: it gets a signal of FETCH_TIMEOUT_MS, and when the signal ends it the table is missing
    const saved = { fetch: globalThis.fetch, timeout: AbortSignal.timeout };
    const asked = [];
    AbortSignal.timeout = (ms) => {
        asked.push(ms);
        return AbortSignal.abort();
    };
    globalThis.fetch = (url, init) =>
        new Promise((resolve, reject) => {
            // a server that never answers: only the signal ends the wait
            if (init?.signal?.aborted) reject(new Error('aborted'));
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        });
    try {
        const r = await TB.preloadTables(['KRKN'], { tbUrl: 'https://stepchess.invalid/tb/' });
        assert.deepEqual(r, { loaded: [], missing: ['KRKN'] });
        assert.deepEqual(asked, [30000]);
    } finally {
        globalThis.fetch = saved.fetch;
        AbortSignal.timeout = saved.timeout;
    }
});
