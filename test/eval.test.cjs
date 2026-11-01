// eval: the explainable evaluation — the fast score equals the trace, the terms add up, colours are symmetric, the terms fire where they should.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let C;
let E;
let P;
let RU;
let EN;
before(async () => {
    C = await import('../src/core/index.js');
    E = await import('../src/eval/index.js');
    P = await import('../src/index.js');
    RU = (await import('../src/i18n/ru/index.js')).default;
    EN = (await import('../src/i18n/en/index.js')).default;
});

const PERFT_FENS = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
];

const KEYS = [
    ['material', 'material'],
    ['bishop-pair', 'material'],
    ['imbalance', 'material'],
    ['pst', 'pieces'],
    ['mobility', 'pieces'],
    ['knight-outpost', 'pieces'],
    ['rook-open-file', 'pieces'],
    ['rook-semi-open-file', 'pieces'],
    ['rook-seventh', 'pieces'],
    ['bad-bishop', 'pieces'],
    ['trapped-piece', 'pieces'],
    ['isolated-pawn', 'pawns'],
    ['doubled-pawn', 'pawns'],
    ['backward-pawn', 'pawns'],
    ['connected-pawn', 'pawns'],
    ['passed-pawn', 'pawns'],
    ['pawn-chain', 'pawns'],
    ['pawn-shield', 'king'],
    ['pawn-storm', 'king'],
    ['king-attack', 'king'],
    ['king-open-file', 'king'],
    ['king-activity', 'king'],
    ['hanging-piece', 'threats'],
    ['pawn-threat', 'threats'],
    ['double-attack', 'threats'],
    ['center-control', 'space'],
    ['space', 'space'],
    ['kbnk-corner', 'endgame'],
    ['opposite-bishops', 'endgame'],
    ['wrong-bishop', 'endgame'],
    ['fortress', 'endgame'],
];

// a xorshift32 stream: the same games on every run
const rng = (seed) => {
    let x = seed | 0;
    return (n) => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        return (x >>> 0) % n;
    };
};

// the 50 positions: the perft ones and positions met in random legal games (seed 1), every 7th ply
let cachedFens;
const fifty = () => {
    if (cachedFens) return cachedFens;
    const out = [...PERFT_FENS];
    const rand = rng(1);
    while (out.length < 50) {
        const p = C.Position.fromFen(C.Position.START_FEN);
        for (let ply = 1; ply <= 140 && out.length < 50; ply++) {
            const moves = C.legalMoves(p);
            if (!moves.length || p.isInsufficientMaterial()) break;
            p.make(moves[rand(moves.length)]);
            if (ply % 7 === 0 && C.legalMoves(p).length) out.push(p.fen());
        }
    }
    cachedFens = out;
    return out;
};

const pos = (fen) => C.Position.fromFen(fen);
const sq = (name) => C.parseSquare(name);
const term = (tr, key) => tr.terms.find((t) => t.key === key);
const sideSign = (p) => (p.side === C.WHITE ? 1 : -1);
// the rounding of evaluate: half away from zero, so that a mirrored board rounds the same way
const round = (x) => Math.sign(x) * Math.round(Math.abs(x));

test('TERMS lists the terms of the evaluation by group, each with a name and an explanation in both languages', () => {
    assert.deepEqual(
        E.TERMS.map((t) => [t.key, t.group]),
        KEYS,
    );
    for (const { key } of E.TERMS)
        for (const cat of [RU, EN]) {
            const m = cat.eval.term[key];
            assert.ok(m && typeof m.name === 'string' && m.name.length > 2, `${key}.name`);
            assert.ok(typeof m.about === 'string' && m.about.length > 20, `${key}.about`);
        }
    assert.notEqual(RU.eval.term['isolated-pawn'].name, EN.eval.term['isolated-pawn'].name);
    assert.equal(E.termName('isolated-pawn').en, EN.eval.term['isolated-pawn'].name);
    assert.equal(E.termAbout('passed-pawn').ru, RU.eval.term['passed-pawn'].about);
});

test('every term has its weights in W, and the weights flatten into named numbers and back', () => {
    for (const { key } of E.TERMS) assert.ok(E.W[key], `W['${key}']`);
    // the pawn anchors the scale (a clean extra pawn reads as about +1); the tuner holds it and the other pieces are sane ranges
    for (const [phase, pawn] of [
        ['mg', 82],
        ['eg', 94],
    ]) {
        const [, p, n, b, r, q] = E.W.material[phase];
        assert.equal(p, pawn, `pawn ${phase}`);
        // in pawns of 100 cp
        assert.ok(n >= 280 && n <= 420 && b >= 280 && b <= 420, `minors ${phase}: ${n} ${b}`);
        assert.ok(r >= 430 && r <= 600, `rook ${phase}: ${r}`);
        assert.ok(q >= 850 && q <= 1150, `queen ${phase}: ${q}`);
        assert.ok(p < n && n <= b + 60 && b + 60 < r && r < q, `order ${phase}: ${[p, n, b, r, q]}`);
    }
    assert.equal(E.W.K, 0.00368208);
    for (const phase of ['mg', 'eg']) {
        assert.equal(E.W.pst[phase].length, 7);
        for (let t = 1; t <= 6; t++) assert.equal(E.W.pst[phase][t].length, 64, `pst.${phase}[${t}]`);
    }
    const { names, values } = E.flattenWeights(E.W);
    assert.equal(names.length, values.length);
    assert.equal(new Set(names).size, names.length, 'each weight has its own name');
    assert.ok(names.includes('material.mg.1') && names.includes('pst.eg.6.63') && names.includes('isolated-pawn.mg'));
    assert.ok(!names.includes('K'), 'the win-chance slope is not an evaluation weight');
    const back = E.unflattenWeights(E.W, values);
    assert.deepEqual(back, E.W);
    // the module text the tuner writes reads back as the same weights
    const text = E.weightsModule(E.W);
    assert.ok(text.startsWith('// eval/weights — '));
    const W2 = new Function(`${text.replace('export const W =', 'return')}`)();
    assert.deepEqual(W2, JSON.parse(JSON.stringify(E.W)));
});

test('the start position is level', () => {
    const p = pos(C.Position.START_FEN);
    assert.ok(Math.abs(E.evaluate(p)) <= 30, `${E.evaluate(p)}`);
    const tr = E.trace(p);
    assert.equal(tr.phase, 24);
    assert.equal(tr.scale, 1);
    assert.ok(Math.abs(tr.total) <= 30);
});

test('50 positions: the fast score equals the trace, the terms add up to the total, a mirrored board negates it', () => {
    const fens = fifty();
    assert.equal(fens.length, 50);
    assert.equal(new Set(fens).size, 50, 'fifty different positions');
    const known = new Map(KEYS);
    for (const fen of fens) {
        const p = pos(fen);
        const tr = E.trace(p);
        const e = E.evaluate(p);
        assert.ok(Number.isInteger(e), fen);
        assert.ok(e === sideSign(p) * round(tr.total), `${fen}: evaluate ${e}, trace ${tr.total}`);
        // the second call reads the pawn hash and must not change a thing
        assert.ok(E.evaluate(p) === e, `${fen}: the pawn hash changes the score`);
        const sum = tr.terms.reduce((s, t) => s + t.value, 0);
        assert.ok(Math.abs(sum - tr.total) <= 1, `${fen}: terms ${sum} vs total ${tr.total}`);
        assert.ok(tr.phase >= 0 && tr.phase <= 24 && tr.scale >= 0 && tr.scale <= 1, fen);
        for (let i = 0; i < tr.terms.length; i++) {
            const t = tr.terms[i];
            assert.equal(known.get(t.key), t.group, `${t.key} in ${fen}`);
            assert.ok(Math.abs(t.value - (t.white - t.black)) < 1e-9, `${t.key}: value = white − black`);
            assert.ok(t.white !== 0 || t.black !== 0, `${t.key}: listed only with a contribution`);
            assert.ok(Array.isArray(t.squares) && t.squares.every((s) => (s & 0x88) === 0), `${t.key}: squares`);
            if (i) assert.ok(Math.abs(tr.terms[i - 1].value) >= Math.abs(t.value), `${fen}: sorted by |value|`);
        }
        const m = pos(C.mirrorFen(fen));
        const mt = E.trace(m);
        assert.ok(Math.abs(mt.total + tr.total) < 1e-9, `${fen}: mirrored ${mt.total} vs ${tr.total}`);
        assert.ok(E.evaluate(m) === e, `${fen}: the side to move sees the same score on the mirrored board`);
        // and every term swaps its colours
        for (const t of tr.terms) {
            const u = term(mt, t.key);
            assert.ok(u && Math.abs(u.white - t.black) < 1e-9 && Math.abs(u.black - t.white) < 1e-9, `${fen}: ${t.key} mirrored`);
        }
    }
});

test('trace takes a FEN as well as a position, and leaves the position as it was', () => {
    const fen = PERFT_FENS[1];
    const p = pos(fen);
    const a = E.trace(p);
    assert.equal(p.fen(), fen);
    assert.deepEqual(E.trace(fen), a);
});

test('a passed pawn: white, on d2', () => {
    const tr = E.trace('8/8/8/3k4/8/8/3P4/3K4 w - - 0 1');
    const t = term(tr, 'passed-pawn');
    assert.ok(t, 'passed-pawn is in the trace');
    assert.ok(t.white > 0 && t.black === 0);
    assert.ok(t.squares.includes(sq('d2')));
});

test('an isolated pawn on d2', () => {
    const t = term(E.trace('4k3/8/8/8/8/8/PP1P4/4K3 w - - 0 1'), 'isolated-pawn');
    assert.ok(t, 'isolated-pawn is in the trace');
    assert.ok(t.white < 0 && t.black === 0);
    assert.deepEqual(t.squares, [sq('d2')]);
});

test('KBN v K: the defending king in the wrong corner is still worse for it than in the centre, the right corner worst', () => {
    // a dark-squared bishop mates in a1 or h8; a8 and h1 are the wrong corners
    const at = (k) => E.trace(`${k} w - - 0 1`);
    const wrong = at('k7/8/8/8/8/8/8/2B1KN2');
    const centre = at('8/8/8/4k3/8/8/8/2B1KN2');
    const right = at('8/8/8/8/8/8/8/k1B1KN2');
    assert.ok(wrong.total > centre.total, `wrong corner ${wrong.total} vs centre ${centre.total}`);
    assert.ok(right.total > wrong.total, `right corner ${right.total} vs wrong ${wrong.total}`);
    assert.ok(term(wrong, 'kbnk-corner').white > 0);
    assert.ok(term(right, 'kbnk-corner').squares.includes(sq('a1')));
});

test('drawish material scales toward 0, and the term that does it is in the trace', () => {
    const kbk = E.trace('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1');
    assert.equal(kbk.scale, 0);
    assert.equal(kbk.total, 0);
    assert.ok(term(kbk, 'fortress').value < 0, 'the fortress takes back what the bishop is worth');
    // a rook pawn and the bishop of the wrong colour: the king in the corner holds
    const wrong = E.trace('k7/8/8/8/8/8/P7/2B1K3 w - - 0 1');
    assert.equal(wrong.scale, 0);
    assert.ok(term(wrong, 'wrong-bishop').value < 0);
    // the right bishop wins
    const fine = E.trace('k7/8/8/8/8/8/P7/1B2K3 w - - 0 1');
    assert.equal(fine.scale, 1);
    assert.ok(fine.total > 200);
    // opposite bishops with a pawn more: much closer to a draw than the same bishops of one colour
    const ocb = E.trace('4k3/5b2/8/4p3/2P1P3/8/3B4/4K3 w - - 0 1');
    const same = E.trace('4k3/4b3/8/4p3/2P1P3/8/3B4/4K3 w - - 0 1');
    assert.ok(ocb.scale < 0.5, `scale ${ocb.scale}`);
    assert.equal(same.scale, 1);
    assert.ok(term(ocb, 'opposite-bishops').value < 0);
    assert.ok(ocb.total < same.total / 2);
});

test('two knights: no win against the bare king, but against pawns (Troitsky) they are not scaled; two bishops beat a knight', () => {
    const bare = E.trace('4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1');
    assert.equal(bare.scale, 0);
    assert.ok(term(bare, 'fortress').value < 0);
    const troitsky = E.trace('7k/8/8/p7/P7/8/8/1N2KN2 w - - 0 1');
    assert.equal(troitsky.scale, 1);
    assert.ok(!term(troitsky, 'fortress'));
    assert.ok(troitsky.total > 300);
    const bbn = E.trace('4k3/8/8/3n4/8/8/8/2B1KB2 w - - 0 1');
    assert.equal(bbn.scale, 1, 'KBB v KN is a win');
    assert.ok(!term(bbn, 'fortress'));
    // two bishops against a bishop stay drawish
    assert.ok(E.trace('4k3/8/8/3b4/8/8/8/2B1KB2 w - - 0 1').scale < 1);
});

test('the pawn shield and storm belong to a king on a wing, not to one still on d or e', () => {
    // 1.e4: neither king has castled, so nothing is shielded or stormed
    const e4 = E.trace('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    assert.ok(!term(e4, 'pawn-shield') && !term(e4, 'pawn-storm'));
    // kiwipete: the d5 pawn does not storm the king on e8
    const kiwi = E.trace('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    assert.ok(!term(kiwi, 'pawn-storm'));
    assert.ok(!term(kiwi, 'pawn-shield'));
    // castled short, the same pawns shield
    const castled = term(E.trace('rnbq1rk1/ppppppbp/5np1/8/8/5NP1/PPPPPPBP/RNBQ1RK1 w - - 0 5'), 'pawn-shield');
    assert.ok(castled && castled.white > 0 && castled.black > 0);
    // a king on c1 is on the queen's wing
    assert.ok(term(E.trace('4k3/8/8/8/8/8/PPP5/2KR4 w - - 0 1'), 'pawn-shield').white > 0);
});

test('the weights give sane first moves: 1.e4 and 1.d4 a little better for White, 1.a4 about level', () => {
    const after = (fen) => E.trace(fen).total;
    const e4 = after('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    const d4 = after('rnbqkbnr/pppppppp/8/8/3P4/8/PPP1PPPP/RNBQKBNR b KQkq - 0 1');
    const a4 = after('rnbqkbnr/pppppppp/8/8/P7/8/1PPPPPPP/RNBQKBNR b KQkq - 0 1');
    for (const v of [e4, d4]) assert.ok(v >= 15 && v <= 40, `${v}`);
    assert.ok(Math.abs(a4) < 15 && a4 < e4, `${a4}`);
    // four free moves for a castled fianchetto stay far below +148
    assert.ok(after('rnbqkbnr/pppppppp/8/8/8/5NP1/PPPPPPBP/RNBQ1RK1 b kq - 3 4') < 148);
});

// a term of one colour on one square, from a position built for it: [key, fen, colour, sign of its contribution, square]
const CASES = [
    ['bishop-pair', '4k3/8/8/8/8/8/8/2B1KB2 w - - 0 1', 'white', 1, null],
    ['doubled-pawn', '4k3/8/8/8/8/4P3/4P3/4K3 w - - 0 1', 'white', -1, 'e2'],
    ['backward-pawn', '4k3/8/3p4/2p5/2P5/8/8/4K3 b - - 0 1', 'black', -1, 'd6'],
    ['connected-pawn', '4k3/8/8/3PP3/8/8/8/4K3 w - - 0 1', 'white', 1, 'e5'],
    ['pawn-chain', '4k3/8/8/4P3/3P4/8/8/4K3 w - - 0 1', 'white', 1, 'e5'],
    ['knight-outpost', 'r3k3/pp6/3p4/3N4/4P3/8/8/4K3 w - - 0 1', 'white', 1, 'd5'],
    ['rook-open-file', '4k3/pp3ppp/8/8/8/8/PP3PPP/3RK3 w - - 0 1', 'white', 1, 'd1'],
    ['rook-semi-open-file', '4k3/pp1p1ppp/8/8/8/8/PP3PPP/3RK3 w - - 0 1', 'white', 1, 'd1'],
    ['rook-seventh', '6k1/1R3ppp/8/8/8/8/5PPP/6K1 w - - 0 1', 'white', 1, 'b7'],
    ['bad-bishop', '4k3/8/2p1p3/2P1P3/1P1P4/8/3B4/4K3 w - - 0 1', 'white', -1, 'd2'],
    ['trapped-piece', 'r3k3/Bp6/1p6/8/8/8/8/4K3 w - - 0 1', 'white', -1, 'a7'],
    ['pawn-shield', 'r5k1/8/8/8/8/8/5PPP/R5K1 w - - 0 1', 'white', 1, 'g2'],
    ['pawn-storm', 'r5k1/5ppp/6P1/8/8/8/8/R5K1 w - - 0 1', 'white', 1, 'g6'],
    ['king-attack', '6k1/5ppp/8/6NQ/8/8/8/6K1 w - - 0 1', 'white', 1, 'g5'],
    ['king-open-file', '6k1/5p1p/8/8/8/8/5PPP/3R2K1 w - - 0 1', 'black', -1, 'g8'],
    ['hanging-piece', '4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'white', 1, 'd5'],
    ['pawn-threat', '4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1', 'white', 1, 'd5'],
    ['double-attack', '4k3/8/1r1q4/8/2N5/8/8/4K3 w - - 0 1', 'white', 1, 'c4'],
    ['center-control', 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', 'white', 1, 'd5'],
    ['space', 'rnbqkbnr/ppp2ppp/3p4/3Pp3/2P1P3/8/PP3PPP/RNBQKBNR w KQkq - 0 1', 'white', 1, null],
    ['king-activity', '8/k7/8/8/3P4/3K4/8/8 w - - 0 1', 'white', 1, 'd3'],
    ['mobility', '4k3/8/8/8/3Q4/8/8/4K3 w - - 0 1', 'white', 1, 'd4'],
    ['imbalance', '4k3/pppppppp/8/8/8/8/8/1N2K3 w - - 0 1', 'white', -1, null],
];

for (const [key, fen, color, sign, square] of CASES)
    test(`${key}: ${sign > 0 ? 'a bonus' : 'a penalty'} for ${color}${square ? ` on ${square}` : ''} in ${fen}`, () => {
        const t = term(E.trace(fen), key);
        assert.ok(t, `${key} is in the trace`);
        assert.equal(Math.sign(t[color]), sign, `${key}: ${color} has ${t[color]}`);
        // and it moves the balance that way: value is White's side minus Black's
        assert.equal(Math.sign(t.value), color === 'white' ? sign : -sign, `${key}: value ${t.value}`);
        if (square) assert.ok(t.squares.includes(sq(square)), `${key}: ${square} among ${t.squares.map(C.sqName)}`);
    });

test('a hanging piece, a pawn threat and a fork count for the side that attacks', () => {
    assert.ok(term(E.trace('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1'), 'hanging-piece').white > 0);
    assert.ok(term(E.trace('4k3/8/8/3n4/4P3/8/8/4K3 w - - 0 1'), 'pawn-threat').white > 0);
    assert.ok(term(E.trace('4k3/8/1r1q4/8/2N5/8/8/4K3 w - - 0 1'), 'double-attack').white > 0);
    // a defended piece hangs no more
    assert.ok(!term(E.trace('4k3/8/4p3/3n4/8/8/8/3RK3 w - - 0 1'), 'hanging-piece'));
});

test('the passed pawn outside the square of the king is worth much more in a pawn ending', () => {
    const outside = term(E.trace('7k/8/8/8/1P6/8/8/4K3 w - - 0 1'), 'passed-pawn').white;
    const inside = term(E.trace('8/8/2k5/8/1P6/8/8/4K3 w - - 0 1'), 'passed-pawn').white;
    assert.ok(outside > inside + 100, `${outside} vs ${inside}`);
});

test('winChance: 50% at 0, symmetric, rising; winChanceWhite reads a trace', () => {
    assert.equal(E.winChance(0), 0.5);
    assert.ok(Math.abs(E.winChance(300) + E.winChance(-300) - 1) < 1e-12);
    assert.ok(E.winChance(100) > 0.5 && E.winChance(400) > E.winChance(100));
    assert.ok(Math.abs(E.winChance(100) - 1 / (1 + Math.exp(-0.00368208 * 100))) < 1e-12);
    const tr = E.trace('4k3/8/8/8/8/8/8/Q3K3 w - - 0 1');
    assert.equal(E.winChanceWhite(tr), E.winChance(tr.total));
    assert.ok(E.winChanceWhite(tr) > 0.9);
});

test('the pawn hash: incremental in make/unmake, equal to a recomputation in random games, restored by takebacks', () => {
    const ph = (p) => [p.pawnHashLo, p.pawnHashHi];
    const fresh = (p) => {
        const h = C.computePawnHash(p);
        return [h.lo, h.hi];
    };
    const start = pos(C.Position.START_FEN);
    assert.deepEqual(ph(start), fresh(start));
    assert.notDeepEqual(ph(start), [0, 0]);
    assert.deepEqual(ph(pos('4k3/8/8/8/8/8/8/4K3 w - - 0 1')), [0, 0], 'no pawns, no pawn hash');
    // pieces do not change it, pawns do
    const a = pos('4k3/pp6/8/8/8/8/PP6/R3K3 w - - 0 1');
    const b = pos('4k3/pp6/8/8/8/8/PP6/4K2R w - - 0 1');
    assert.deepEqual(ph(a), ph(b));
    assert.notDeepEqual(ph(a), ph(pos('4k3/pp6/8/8/8/P7/1P6/R3K3 w - - 0 1')));
    const rand = rng(7);
    let promotions = 0;
    let enPassant = 0;
    for (let game = 0; game < 40; game++) {
        const p = pos(C.Position.START_FEN);
        const trail = [ph(p)];
        for (let ply = 0; ply < 250; ply++) {
            const moves = C.legalMoves(p);
            if (!moves.length || p.halfmove >= 100) break;
            // en passant is rare in random play: take it when it is there
            const ep = moves.find((x) => C.moveFlags(x) & C.F_EP);
            const m = ep && rand(2) ? ep : moves[rand(moves.length)];
            if (C.movePromo(m)) promotions++;
            if (C.moveFlags(m) & C.F_EP) enPassant++;
            p.make(m);
            assert.deepEqual(ph(p), fresh(p), p.fen());
            assert.deepEqual(ph(p.clone()), ph(p));
            trail.push(ph(p));
        }
        while (trail.length > 1) {
            trail.pop();
            p.unmake();
            assert.deepEqual(ph(p), trail[trail.length - 1]);
        }
    }
    assert.ok(promotions > 0 && enPassant > 0, `the games hold promotions (${promotions}) and en passant (${enPassant})`);
});

test('a null move leaves the pawn hash as it is, and so does taking it back', () => {
    const p = pos('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const before = [p.pawnHashLo, p.pawnHashHi];
    p.makeNull();
    assert.deepEqual([p.pawnHashLo, p.pawnHashHi], before);
    const h = C.computePawnHash(p);
    assert.deepEqual([h.lo, h.hi], before);
    p.makeNull();
    p.unmakeNull();
    p.unmakeNull();
    assert.deepEqual([p.pawnHashLo, p.pawnHashHi], before);
    // a pawn move after a null move, taken back, restores it too
    p.makeNull();
    const m = C.legalMoves(p).find((x) => C.moveToUci(x) === 'b4b3');
    p.make(m);
    assert.notDeepEqual([p.pawnHashLo, p.pawnHashHi], before);
    p.unmake();
    p.unmakeNull();
    assert.deepEqual([p.pawnHashLo, p.pawnHashHi], before);
});

test('mirrorFen: colours swap, ranks flip, the side and the rights follow; twice is the same position', () => {
    assert.equal(C.mirrorFen('4k3/8/8/3Pp3/8/8/8/4K3 w - e6 0 1'), '4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
    assert.equal(C.mirrorFen('r3k2r/8/8/8/8/8/8/R3K2R w Kq - 3 9'), 'r3k2r/8/8/8/8/8/8/R3K2R b Qk - 3 9');
    assert.equal(C.mirrorFen(C.Position.START_FEN), 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1');
    for (const fen of PERFT_FENS) assert.equal(C.mirrorFen(C.mirrorFen(fen)), pos(fen).fen());
    assert.throws(() => C.mirrorFen('not a fen'), C.ChessError);
});

test('the package exports the evaluation', () => {
    for (const name of ['evaluate', 'trace', 'TERMS', 'winChance', 'winChanceWhite', 'termName', 'termAbout', 'mirrorFen', 'computePawnHash'])
        assert.ok(name in P, name);
});
