// motifs: the motif detectors — the dictionary, its messages, the hand-built fixtures, the position left untouched, no throw on random games, speed.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FIXTURES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'motifs.json'), 'utf8'));

const TACTICS = [
    'fork',
    'pin-absolute',
    'pin-relative',
    'skewer',
    'discovered-attack',
    'double-check',
    'deflection',
    'decoy',
    'overloading',
    'remove-defender',
    'interference',
    'x-ray',
    'zwischenzug',
    'desperado',
    'trapped-piece',
    'hanging-piece',
    'back-rank-weakness',
    'clearance',
    'promotion',
    'underpromotion',
    'sacrifice',
];
const MATES = [
    'mate-back-rank',
    'mate-smothered',
    'mate-anastasia',
    'mate-arabian',
    'mate-boden',
    'mate-legal',
    'mate-epaulette',
    'mate-greco',
    'mate-damiano',
    'mate-ladder',
    'mate-corridor',
];
const POSITIONAL = [
    'outpost',
    'weak-square',
    'open-file',
    'isolated-pawn',
    'passed-pawn-created',
    'minority-attack',
    'pawn-break',
    'prophylaxis',
    'piece-improvement',
    'king-activation',
    'opposition',
    'triangulation',
    'zugzwang',
    'fortress',
];
const ALL = [...TACTICS, ...MATES, ...POSITIONAL];

let C;
let X;
let EG;
let EV;
let RU;
let EN;
let S;
let I;
before(async () => {
    C = await import('../src/core/index.js');
    S = await import('../src/search/index.js');
    X = await import('../src/explain/index.js');
    I = await import('../src/i18n/index.js');
    EG = await import('../src/endgame/index.js');
    EV = await import('../src/eval/index.js');
    RU = (await import('../src/i18n/ru/index.js')).default;
    EN = (await import('../src/i18n/en/index.js')).default;
    await EG.preloadTables(['KPK']);
});

// a perfect search for king-and-pawn endings: the tablebase verdict, else the static evaluation (the tests inject it)
const oracle = (pos) => {
    const r = EG.probe(pos);
    return { score: r ? r.wdl * 1000 : EV.evaluate(pos) };
};

// the fixture's position, the move and the line as encoded moves (null when something does not parse)
function load(f) {
    const pos = C.Position.fromFen(f.fen);
    for (const s of f.pre ?? []) {
        const m = C.parseMove(pos, s);
        if (!m) return null;
        pos.make(m);
    }
    const work = pos.clone();
    const move = C.parseMove(work, f.move);
    if (!move) return null;
    work.make(move);
    const line = [];
    for (const s of f.line) {
        const m = C.parseMove(work, s);
        if (!m) return null;
        line.push(m);
        work.make(m);
    }
    return { pos, move, line };
}

const run = (f, p) => X.detectMotifs(p.pos, p.move, p.line, f.search === 'kpk' ? { search: oracle } : {});

test('the dictionary holds exactly the motifs of the spec, each with its kind', () => {
    assert.deepEqual(
        X.MOTIFS.map((m) => m.key),
        ALL,
    );
    for (const m of X.MOTIFS) {
        const kind = TACTICS.includes(m.key) ? 'tactic' : MATES.includes(m.key) ? 'mate' : 'positional';
        assert.equal(m.kind, kind, m.key);
        assert.equal(X.kindOf(m.key), kind);
    }
    assert.ok(Object.isFrozen(X.MOTIFS));
});

const SLOTS = [
    '%{piece}',
    '%{Piece}',
    '%{piece_acc}',
    '%{square}',
    '%{targets}',
    '%{targets_acc}',
    '%{targets_gen}',
    '%{first}',
    '%{first_acc}',
    '%{second}',
    '%{second_acc}',
];

test('every motif has a name, an explanation and a sentence in Russian and English', () => {
    for (const [lang, cat] of [
        ['ru', RU],
        ['en', EN],
    ]) {
        for (const key of ALL) {
            const m = cat.explain?.motif?.[key];
            assert.ok(m, `${lang}: ${key}`);
            for (const part of ['name', 'about', 'say']) assert.equal(typeof m[part], 'string', `${lang}: ${key}.${part}`);
            assert.ok(m.name.length > 2 && m.about.length > 20 && m.say.length > 5, `${lang}: ${key}`);
            for (const slot of m.say.match(/%\{\w+\}/g) ?? []) assert.ok(SLOTS.includes(slot), `${lang}: ${key}: ${slot}`);
            // the sentence neither opens with the motif's name nor doubles its punctuation
            assert.ok(!m.say.toLowerCase().startsWith(m.name.toLowerCase()), `${lang}: ${key} repeats its name`);
            assert.ok(!/[:;,]\s*[^.!?]*:\s*[^.!?]*:/.test(m.say) && !/[:,;.]\s*[:,;]/.test(m.say), `${lang}: ${key}: ${m.say}`);
        }
    }
    // both languages fill the same slots
    const slots = (t) => [...new Set(t.match(/%\{\w+\}/g) ?? [])].sort().join();
    for (const key of ALL) assert.equal(slots(RU.explain.motif[key].say), slots(EN.explain.motif[key].say), key);
    assert.equal(String(X.motifName('fork')), String(X.motifName('fork')));
});

test('motif sentences decline their pieces and list their targets', () => {
    const [N, B, R, Q, K] = [2, 3, 4, 5, 6];
    const fork = X.motifSay('fork', { piece: N, square: 'c7', targets: [K, R] });
    assert.equal(fork.ru, 'Конь с c7 нападает сразу на короля и ладью.');
    assert.equal(fork.en, 'The knight on c7 attacks the king and the rook at once.');
    const three = X.motifSay('fork', { piece: N, square: 'e5', targets: [K, Q, R] });
    assert.equal(three.ru, 'Конь с e5 нападает сразу на короля, ферзя и ладью.');
    assert.equal(three.en, 'The knight on e5 attacks the king, the queen, and the rook at once.');
    const trapped = X.motifSay('trapped-piece', { square: 'h5', targets: [B] });
    assert.equal(trapped.ru, 'У слона на h5 не осталось ни одного безопасного поля.');
    // a pin names the pinned piece in the accusative
    const pin = X.motifSay('pin-absolute', { piece: B, square: 'b5', targets: [N] });
    assert.equal(pin.ru, 'Слон с b5 связывает коня с королём: сойти с линии нельзя.');
    // pieces of one kind are said together, declined
    const rooks = X.motifSay('fork', { piece: N, square: 'f7', targets: [R, R] });
    assert.deepEqual([rooks.ru, rooks.en], ['Конь с f7 нападает сразу на обе ладьи.', 'The knight on f7 attacks both rooks at once.']);
    const knights = X.motifSay('fork', { piece: Q, square: 'd5', targets: [N, K, N] });
    assert.deepEqual(
        [knights.ru, knights.en],
        ['Ферзь с d5 нападает сразу на обоих коней и короля.', 'The queen on d5 attacks both knights and the king at once.'],
    );
    const pawns = X.motifSay('fork', { piece: Q, square: 'd5', targets: [1, 1, 1] });
    assert.deepEqual([pawns.ru, pawns.en], ['Ферзь с d5 нападает сразу на 3 пешки.', 'The queen on d5 attacks 3 pawns at once.']);
    const bishops = X.motifSay('trapped-piece', { square: 'a7', targets: [B, B] });
    assert.equal(bishops.ru, 'У обоих слонов на a7 не осталось ни одного безопасного поля.');
    const overloaded = X.motifSay('overloading', { square: 'f5', targets: [Q] });
    assert.equal(overloaded.ru, 'Теперь ферзь не может одновременно отыграть фигуру и удержать f5.');
    // the piece words of the explanation layer decline the same way
    const word = (l) => I.msg(`explain.piece.${l}`);
    const msgFork = X.motifSay('fork', { piece: word('n'), square: 'c7', targets: [word('k'), word('r')] });
    assert.deepEqual([msgFork.ru, msgFork.en], [fork.ru, fork.en]);
    // every sentence renders with no slot left over and no key leaking through
    for (const key of ALL) {
        const t = X.motifSay(key, { piece: Q, square: 'd5', targets: [R, B] });
        for (const text of [t.ru, t.en]) assert.ok(text && !/%\{|explain\./.test(text) && !/\s[.,:]/.test(text), `${key}: ${text}`);
    }
});

test('every motif has at least three positive fixtures and one negative', () => {
    for (const key of ALL) {
        const pos = FIXTURES.filter((f) => f.expect.includes(key)).length;
        const neg = FIXTURES.filter((f) => f.forbid.includes(key)).length;
        assert.ok(pos >= 3, `${key}: ${pos} positive`);
        assert.ok(neg >= 1, `${key}: ${neg} negative`);
    }
});

for (const [n, f] of FIXTURES.entries()) {
    test(`fixture ${n}: ${f.note}`, () => {
        const p = load(f);
        assert.ok(p, `the move or the line does not parse: ${f.move} ${f.line.join(' ')}`);
        const fen = p.pos.fen();
        const hash = [p.pos.hashLo, p.pos.hashHi];
        const found = run(f, p);
        assert.equal(p.pos.fen(), fen, 'the position is left as it was');
        assert.deepEqual([p.pos.hashLo, p.pos.hashHi], hash);
        const keys = found.map((m) => m.key);
        for (const k of f.expect) assert.ok(keys.includes(k), `expected ${k}, found ${keys.join(' ')}`);
        for (const k of f.forbid) assert.ok(!keys.includes(k), `did not expect ${k}, found ${keys.join(' ')}`);
        for (const m of found) {
            assert.ok(ALL.includes(m.key));
            assert.equal(m.kind, X.kindOf(m.key));
            assert.ok(m.side === 0 || m.side === 1);
            assert.ok(Number.isInteger(m.ply) && m.ply >= 0 && m.ply <= p.line.length);
            assert.ok(Array.isArray(m.pieces) && Array.isArray(m.squares) && Array.isArray(m.arrows));
            for (const s of [...m.pieces, ...m.squares]) assert.ok(C.onBoard(s), `${m.key}: square ${s}`);
            for (const a of m.arrows) assert.ok(C.onBoard(a.from) && C.onBoard(a.to) && typeof a.kind === 'string');
            assert.equal(typeof m.params, 'object');
        }
        // what the board draws and the words of the sentence, for the fixtures that pin them
        const name = (s) => C.sqName(s);
        for (const d of f.draw ?? []) {
            const m = found.find((x) => x.key === d.key && x.ply === d.ply);
            assert.ok(m, `no ${d.key}@${d.ply} to draw`);
            assert.equal(C.pieceToFen(m.params.piece), d.piece, `${d.key}: params.piece`);
            assert.equal(name(m.params.square), d.square, `${d.key}: params.square`);
            assert.equal((m.params.targets ?? []).map(C.pieceToFen).join(''), d.targets, `${d.key}: params.targets`);
            assert.deepEqual(m.pieces.map(name), d.pieces, `${d.key}: pieces`);
            assert.deepEqual(m.squares.map(name), d.squares, `${d.key}: squares`);
            assert.deepEqual(
                m.arrows.map((a) => `${name(a.from)}-${name(a.to)}:${a.kind}`),
                d.arrows,
                `${d.key}: arrows`,
            );
        }
    });
}

test('every motif has one fixture that pins what the board draws', () => {
    const drawn = new Set(FIXTURES.flatMap((f) => (f.draw ?? []).map((d) => d.key)));
    for (const key of ALL) assert.ok(drawn.has(key), key);
});

test('the line is cut at its first illegal move', () => {
    const pos = C.Position.fromFen('3r2k1/3r1ppp/8/Q7/8/8/5PPP/3R2K1 w - - 0 1');
    const work = pos.clone();
    const take = C.parseMove(work, 'Qxd8+');
    work.make(take);
    const back = C.parseMove(work, 'Rxd8');
    work.make(back);
    const mate = C.parseMove(work, 'Rxd8#');
    const illegal = C.encodeMove(0x00, 0x77);
    const show = (ms) => ms.map((m) => `${m.key}@${m.ply}`);
    const cut = X.detectMotifs(pos, take, [back, illegal, mate]);
    assert.deepEqual(show(cut), show(X.detectMotifs(pos, take, [back])));
    assert.ok(cut.every((m) => m.ply <= 1));
    // the full line finds the mate at ply 2; cut before it, it does not
    assert.ok(X.detectMotifs(pos, take, [back, mate]).some((m) => m.ply === 2));
    assert.ok(!X.detectMotifs(pos, take, [illegal, back, mate]).some((m) => m.ply > 0));
});

// White's material less Black's (kings left out)
const materialOf = (p) => {
    const V = [0, 100, 320, 330, 500, 900, 0];
    let v = 0;
    for (let t = 1; t <= 5; t++) v += V[t] * (p.counts[t] - p.counts[8 | t]);
    return v;
};
const mateInOne = (p) =>
    C.legalMoves(p).find((m) => {
        p.make(m);
        const mate = p.inCheck() && C.legalMoves(p).length === 0;
        p.unmake();
        return mate;
    });

// the tactics that need not win material at once (a pin holds, a doomed piece sells itself, a double check drives the king)
const NO_GAIN = ['pin-absolute', 'pin-relative', 'desperado', 'double-check'];

test('every positive tactic fixture is sound: the motif move does not lose, and the line does not walk into a mate', () => {
    const se = new S.Searcher({ hashMb: 8 });
    const score = (p) => {
        if (C.legalMoves(p).length === 0) return p.inCheck() ? -S.MATE : 0;
        se.clear();
        return se.search(p, { depth: 7, nodes: 600000 }).score;
    };
    const unsound = [];
    for (const [n, f] of FIXTURES.entries()) {
        const keys = f.expect.filter((k) => TACTICS.includes(k));
        if (!keys.length) continue;
        const p = load(f);
        const seq = [p.move, ...p.line];
        const found = run(f, p);
        const end = p.pos.clone();
        for (const m of seq) end.make(m);
        for (const key of keys) {
            const m = found.find((x) => x.key === key);
            const before = p.pos.clone();
            for (let j = 0; j < m.ply; j++) before.make(seq[j]);
            const sign = before.side === C.WHITE ? 1 : -1;
            const after = before.clone();
            after.make(seq[m.ply]);
            // the move's score for its side against the material before it, or against the best move when that is worse
            // (a desperado piece is lost whatever it does)
            const given = -score(after);
            const base = sign * materialOf(before);
            const floor = Math.min(base, score(before)) - 100;
            if (given < floor) unsound.push(`#${n} ${key}: ${given} < ${floor}`);
            // a motif that claims to win something must win at least half a pawn on the search's verdict
            if (!NO_GAIN.includes(key) && given < base + 50) unsound.push(`#${n} ${key} wins nothing: ${given} against ${base}`);
            if (end.side !== m.side && mateInOne(end)) unsound.push(`#${n} ${key}: the line ends in a mate in one for the loser`);
        }
    }
    assert.deepEqual(unsound, []);
});

test('an illegal move finds nothing, and zugzwang needs a search', () => {
    const pos = C.Position.fromFen('8/8/4k3/8/8/3KP3/8/8 w - - 0 1');
    assert.deepEqual(X.detectMotifs(pos, C.encodeMove(0x00, 0x77), []), []);
    const move = C.parseMove(pos, 'Ke4');
    assert.ok(!X.detectMotifs(pos, move, []).some((m) => m.key === 'zugzwang'));
    assert.ok(X.detectMotifs(pos, move, [], { search: oracle }).some((m) => m.key === 'zugzwang'));
});

// a small seeded generator, so that the random games are the same on every run
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

test('the detectors never throw on 500 positions of random games, and leave them untouched', () => {
    const rand = rng(9);
    let checked = 0;
    for (let game = 0; checked < 500 && game < 200; game++) {
        const pos = C.Position.fromFen(C.Position.START_FEN);
        for (let ply = 0; ply < 160 && checked < 500; ply++) {
            const moves = C.legalMoves(pos);
            if (!moves.length) break;
            const move = moves[Math.floor(rand() * moves.length)];
            // a short random line after the move
            const work = pos.clone();
            work.make(move);
            const line = [];
            for (let k = 0; k < 4; k++) {
                const ms = C.legalMoves(work);
                if (!ms.length) break;
                const m = ms[Math.floor(rand() * ms.length)];
                line.push(m);
                work.make(m);
            }
            const fen = pos.fen();
            const found = X.detectMotifs(pos, move, line);
            assert.equal(pos.fen(), fen);
            assert.ok(Array.isArray(found));
            checked++;
            pos.make(move);
        }
    }
    assert.equal(checked, 500);
});

test('a move and a ten-ply line take under 5 ms', () => {
    const games = [
        ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1'],
        ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7', 'e3', 'O-O', 'Nf3'],
        ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6', 'Be2'],
    ];
    const cases = [];
    for (const g of games) {
        const pos = C.Position.fromFen(C.Position.START_FEN);
        const work = pos.clone();
        const moves = g.map((s) => {
            const m = C.parseMove(work, s);
            work.make(m);
            return m;
        });
        cases.push([pos, moves[0], moves.slice(1)]);
    }
    for (const [pos, move, line] of cases) X.detectMotifs(pos, move, line); // warm up
    const times = [];
    for (let r = 0; r < 20; r++) {
        for (const [pos, move, line] of cases) {
            const t = performance.now();
            X.detectMotifs(pos, move, line);
            times.push(performance.now() - t);
        }
    }
    times.sort((a, b) => a - b);
    const median = times[times.length >> 1];
    assert.ok(median <= 5, `median ${median.toFixed(2)} ms`);
});
