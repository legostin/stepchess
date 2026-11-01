// api: the public analysis API (analyze, position, parseGame, tablebase, openingName) against hostile input, terminal
// positions and determinism; the worker client in Node (queueing, stop, terminate).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let P; // the package
let I; // i18n

before(async () => {
    P = await import('../src/index.js');
    I = await import('../src/i18n/index.js');
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// every message in a tree is a Msg instance
function hasMsg(v, seen = new Set()) {
    if (v instanceof I.Msg) return true;
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    return Object.values(v).some((x) => hasMsg(x, seen));
}

const BAD_FENS = {
    'two white kings': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBKR w KQkq - 0 1',
    'no black king': 'rnbq1bnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQ - 0 1',
    'pawn on the first rank': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNP w Qkq - 0 1',
    'pawn on the last rank': 'rnbqkbnP/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQq - 0 1',
    'the side not to move is in check': '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1',
    'castling rights without a rook': '4k3/8/8/8/8/8/8/4K3 w KQkq - 0 1',
    'a rook off its square': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 w KQkq - 0 1',
    garbage: 'not a fen at all',
    'too few fields': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
    'a bad side': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
    'seven ranks': 'rnbqkbnr/pppppppp/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'a bad en passant square': 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq e9 0 1',
    empty: '',
    undefined: undefined,
    null: null,
    number: 42,
    object: { fen: START },
};

test('analyze: a hostile FEN is a typed invalid result with a message in both languages, never a throw', () => {
    for (const [name, fen] of Object.entries(BAD_FENS)) {
        const r = P.analyze(fen, { nodes: 1000 });
        assert.equal(r.ok, false, name);
        assert.equal(r.kind, 'invalid', name);
        assert.equal(r.code, 'fen', name);
        assert.ok(r.reason instanceof I.Msg, name);
        const ru = r.reason.ru;
        const en = r.reason.en;
        assert.ok(ru && en && ru !== en, name);
        assert.match(ru, /[А-Яа-яЁё]/, name);
        assert.ok(!/[А-Яа-яЁё]/.test(en), name);
        assert.ok(!hasMsg(I.localize(r, 'ru')), name);
        assert.ok(!hasMsg(I.localize(r, 'en')), name);
    }
});

test('position, tablebase and openingName answer a hostile FEN with an invalid result too', async () => {
    for (const [name, fen] of Object.entries(BAD_FENS)) {
        const p = P.position(fen);
        assert.deepEqual([p.ok, p.kind, p.code], [false, 'invalid', 'fen'], name);
        const t = await P.tablebase(fen);
        assert.equal(t.ok, false, name);
        assert.equal(t.kind, 'invalid', name);
    }
});

test('analyze: mated, stalemated, fifty-move and dead-material positions are terminal', () => {
    const cases = [
        ['rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3', 'checkmate', 'black'],
        ['7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'stalemate', undefined],
        ['8/8/8/4k3/8/8/4K2R/8 w - - 100 80', 'fifty', undefined],
        ['8/8/4k3/8/8/4K3/8/8 w - - 0 1', 'insufficient', undefined],
        ['8/8/4k3/8/8/4KB2/8/8 b - - 0 1', 'insufficient', undefined],
    ];
    for (const [fen, state, winner] of cases) {
        const r = P.analyze(fen, { nodes: 1000 });
        assert.equal(r.ok, true, fen);
        assert.equal(r.kind, 'terminal', fen);
        assert.equal(r.state, state, fen);
        assert.equal(r.winner, winner, fen);
        assert.ok(r.reason instanceof I.Msg, fen);
        assert.notEqual(r.reason.ru, r.reason.en, fen);
        assert.ok(!r.reason.en.startsWith('api.'), fen);
    }
});

test('analyze: a threefold repetition reached through the history is terminal; the history is real', () => {
    const moves = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'];
    const r = P.analyze(START, { moves, nodes: 1000 });
    assert.equal(r.kind, 'terminal');
    assert.equal(r.state, 'threefold');
    // the same position without the history is just the start position
    assert.equal(P.analyze(START, { nodes: 1000 }).kind, 'analysis');
});

test('analyze: moves that cannot be played are an invalid result with the core code', () => {
    for (const moves of [['e2e5'], ['zz'], [42], ['e2e4', 'e2e4']]) {
        const r = P.analyze(START, { moves, nodes: 1000 });
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'invalid');
        assert.equal(r.code, 'move');
        assert.ok(r.reason instanceof I.Msg);
    }
});

test('analyze: moves that are not an array are an invalid result with the code moves, in both languages', () => {
    for (const moves of ['e2e4', 42, null, { 0: 'e2e4' }, true]) {
        const r = P.analyze(START, { moves, nodes: 1000 });
        assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'moves'], String(moves));
        assert.ok(r.reason instanceof I.Msg);
        assert.equal(r.reason.key, 'api.error.moves');
        assert.ok(r.reason.ru.length > 0 && r.reason.en.length > 0 && r.reason.ru !== r.reason.en);
    }
    assert.equal(P.analyze(START, { moves: [], nodes: 1000 }).kind, 'analysis');
    assert.equal(P.analyze(START, { moves: undefined, nodes: 1000 }).kind, 'analysis');
});

// --- the opponent

test('createOpponent: two opponents with the same seed play the same 10 moves; the result says its elo and seed', () => {
    const play = (seed) => {
        const o = P.createOpponent({ elo: 1200, seed });
        assert.deepEqual([o.ok, o.kind, o.elo, o.seed, typeof o.move], [true, 'opponent', 1200, seed, 'function']);
        const game = new P.Game();
        const moves = [];
        for (let i = 0; i < 10; i++) {
            const r = o.move(game.fen(), { wtime: 60000, btime: 60000 });
            assert.deepEqual([r.ok, r.kind], [true, 'move'], `ply ${i}`);
            assert.ok(['book', 'search'].includes(r.source));
            moves.push(r.uci);
            game.play(r.uci);
        }
        return moves;
    };
    const a = play(7);
    assert.deepEqual(play(7), a);
    assert.equal(a.length, 10);
    // the defaults: elo 1500, seed 1
    const d = P.createOpponent();
    assert.deepEqual([d.ok, d.elo, d.seed], [true, 1500, 1]);
    assert.deepEqual([P.createOpponent(null).ok, P.createOpponent({}).elo], [true, 1500]);
});

test('createOpponent: a bad elo, seed or options object is an invalid result, never a throw', () => {
    for (const elo of ['strong', NaN, Infinity, -Infinity, 399, 2801, null, {}, [1500]]) {
        const r = P.createOpponent({ elo, seed: 1 });
        assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'elo'], String(elo));
        assert.ok(r.reason.en.includes('400') && r.reason.en.includes('2800'), r.reason.en);
        assert.ok(r.reason.ru.length > 0);
    }
    for (const seed of ['x', NaN, Infinity, null, {}]) assert.equal(P.createOpponent({ elo: 1500, seed }).code, 'seed', String(seed));
    for (const options of ['x', 7, true]) assert.equal(P.createOpponent(options).code, 'options', String(options));
    const hostile = {
        get elo() {
            throw new Error('boom');
        },
    };
    assert.deepEqual([P.createOpponent(hostile).ok, P.createOpponent(hostile).code], [false, 'internal']);
    for (const elo of [400, 2800, 1234.5]) assert.equal(P.createOpponent({ elo }).ok, true, String(elo));
});

test('createOpponent: move answers terminal positions with their reason, and bad input with an invalid result', () => {
    const o = P.createOpponent({ elo: 1500, seed: 3 });
    const terminal = {
        'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3': ['checkmate', 'black'],
        '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1': ['stalemate', undefined],
        '8/8/4k3/8/8/4K3/8/8 w - - 0 1': ['insufficient', undefined],
        '4k3/8/8/8/8/8/R7/4K3 w - - 100 80': ['fifty', undefined],
    };
    for (const [fen, [state, winner]] of Object.entries(terminal)) {
        const r = o.move(fen);
        assert.deepEqual([r.ok, r.kind, r.state, r.winner], [true, 'terminal', state, winner], fen);
        assert.ok(r.reason instanceof I.Msg && r.reason.en.length > 0);
    }
    for (const bad of ['nonsense', undefined, null, 42]) {
        const r = o.move(bad);
        assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'fen'], String(bad));
    }
    // the same shapes as opponentMove
    const fen = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const mine = P.createOpponent({ elo: 1500, seed: 3 }).move(fen);
    const theirs = P.opponentMove({ elo: 1500, seed: 3 }, fen);
    assert.deepEqual(Object.keys(mine).sort(), Object.keys(theirs).sort());
    assert.equal(mine.uci, theirs.uci);
});

test('analyze: the result of a position', () => {
    const r = P.analyze(START, { nodes: 5000 });
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'analysis');
    assert.equal(r.fen, START);
    assert.equal(r.side, 'white');
    assert.equal(r.scoreWhite, r.score);
    assert.ok(r.win > 0.3 && r.win < 0.7);
    assert.ok(r.depth >= 1 && r.nodes >= 1);
    assert.equal(r.lines.length, 1);
    assert.equal(r.lines[0].uci, r.lines[0].pv[0].uci);
    assert.equal(r.lines[0].san, r.lines[0].pv[0].san);
    assert.ok(r.trace && typeof r.trace.total === 'number' && Array.isArray(r.trace.terms));

    // black to move: score is the mover's, scoreWhite the opposite
    const b = P.analyze('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1', { nodes: 5000 });
    assert.equal(b.side, 'black');
    assert.equal(b.scoreWhite, -b.score);
});

test('analyze: a mate in one, a mate against, and win chance', () => {
    const r = P.analyze('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { depth: 4 });
    assert.equal(r.mate, 1);
    assert.equal(r.lines[0].uci, 'a1a8');
    assert.equal(r.lines[0].san, 'Ra8#');
    assert.ok(r.win > 0.99);
    // Black to move and mating: the mate is signed for the mover, the White score and win chance are the opposite
    const m = P.analyze('r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1', { depth: 4 });
    assert.equal(m.side, 'black');
    assert.equal(m.mate, 1);
    assert.equal(m.lines[0].uci, 'a8a1');
    assert.ok(m.score > 30000 && m.scoreWhite < -30000);
    assert.ok(m.win < 0.01);
});

test('analyze: the same FEN and options give the same answer, however often it is asked', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const a = P.analyze(fen, { nodes: 20000 });
    P.analyze(START, { nodes: 20000 }); // another search in between must not leave anything behind
    const b = P.analyze(fen, { nodes: 20000 });
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('analyze: multipv, depth, movetime, and the default budget', () => {
    const r = P.analyze(START, { depth: 3, multipv: 3 });
    assert.equal(r.lines.length, 3);
    assert.ok(r.lines[0].score >= r.lines[1].score && r.lines[1].score >= r.lines[2].score);
    assert.equal(r.depth, 3);
    const t = P.analyze(START, { movetime: 30 });
    assert.equal(t.kind, 'analysis');
    const d = P.analyze(START);
    assert.equal(d.kind, 'analysis');
    assert.ok(d.nodes >= 300000 && d.nodes < 400000, String(d.nodes));
});

test('analyze: sloppy options are ignored, not thrown at', () => {
    for (const opts of [null, undefined, 'x', 7, [], { depth: -3, nodes: 'a', multipv: {}, movetime: NaN, onInfo: 5 }]) {
        const r = P.analyze('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', opts);
        assert.equal(r.kind, 'analysis');
    }
});

test('analyze: onInfo reports every depth with results of the same shape; a throwing callback does not break it', () => {
    const seen = [];
    const r = P.analyze(START, {
        depth: 4,
        onInfo: (res, meta) => {
            seen.push([res, meta]);
            throw new Error('callback bug');
        },
    });
    assert.equal(r.kind, 'analysis');
    assert.deepEqual(
        seen.map(([res]) => res.depth),
        [1, 2, 3, 4],
    );
    for (const [res, meta] of seen) {
        assert.deepEqual(Object.keys(res).sort(), Object.keys(r).sort());
        assert.equal(meta.multipv, 1);
        assert.ok(meta.timeMs >= 0 && meta.seldepth >= res.depth);
        assert.equal(meta.line.uci, res.lines[0].uci);
    }
    assert.equal(seen[3][0].lines[0].uci, r.lines[0].uci);
});

test('analyze: a stop callback ends the search at a completed depth', () => {
    let calls = 0;
    const r = P.analyze(START, { depth: 30, stop: () => ++calls > 2 });
    assert.equal(r.kind, 'analysis');
    assert.ok(r.depth >= 1 && r.depth < 30);
});

test('analyze: a stop callback that throws is an invalid result, not a throw', () => {
    const r = P.analyze(START, {
        depth: 30,
        stop: () => {
            throw new Error('x');
        },
    });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'invalid');
    assert.equal(r.code, 'internal');
    assert.ok(r.reason.en && r.reason.ru);
});

test('analyze: tablebases that are loaded decide positions the search would only estimate', async () => {
    await P.preloadTables(['KQK']);
    const r = P.analyze('8/8/8/4k3/8/8/4K3/7Q w - - 0 1', { depth: 4 });
    assert.equal(r.kind, 'analysis');
    assert.ok(r.mate > 0);
});

test('position: the legal moves, status and check', () => {
    const p = P.position(START);
    assert.equal(p.ok, true);
    assert.equal(p.kind, 'position');
    assert.equal(p.side, 'white');
    assert.equal(p.legal.length, 20);
    assert.deepEqual(
        p.legal.find((m) => m.uci === 'g1f3'),
        { uci: 'g1f3', san: 'Nf3' },
    );
    assert.deepEqual(p.status, { state: 'ongoing' });
    assert.equal(p.inCheck, false);
    const c = P.position('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    assert.equal(c.inCheck, true);
    assert.deepEqual(c.status, { state: 'checkmate', winner: 'black' });
    assert.deepEqual(c.legal, []);
});

test('parseGame: PGN with comments, NAGs, variations and no headers', () => {
    const pgn = '1. e4 {the best} e5 $1 (1... c5 2. Nf3) 2. Nf3 ; a line comment\nNc6 3. Bb5 {pin} a6 1-0';
    const g = P.parseGame(pgn);
    assert.equal(g.ok, true);
    assert.equal(g.kind, 'game');
    assert.deepEqual(g.headers, {});
    assert.deepEqual(
        g.moves.map((m) => m.san),
        ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6'],
    );
    assert.equal(g.moves[0].uci, 'e2e4');
    assert.equal(g.moves[0].fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    assert.equal(g.result, '1-0');
});

test('parseGame: headers, a FEN start, and hostile text', () => {
    const g = P.parseGame('[Event "Test"]\n[White "A"]\n\n1. e4 e5 *');
    assert.equal(g.headers.Event, 'Test');
    assert.equal(g.result, '*');
    for (const text of ['1. e4 e5 2. Ke3', '1. e4 {unclosed', '1. Qxz9', undefined, null, 5, {}]) {
        const r = P.parseGame(text);
        assert.equal(r.ok, false, String(text));
        assert.equal(r.kind, 'invalid', String(text));
        assert.ok(r.reason instanceof I.Msg);
    }
});

test('tablebase and openingName are the safe wrappers; the package exports them once', async () => {
    const t = await P.tablebase('8/8/8/4k3/8/8/4K3/7Q w - - 0 1');
    assert.equal(t.ok, true);
    assert.equal(t.kind, 'tablebase');
    assert.equal(t.wdl, 1);
    const big = await P.tablebase(START);
    assert.deepEqual([big.ok, big.kind, big.code], [false, 'invalid', 'too-many-pieces']);
    const o = P.openingName('1. e4 e5 2. Nf3 Nc6 3. Bb5');
    assert.equal(o.ok, true);
    assert.equal(o.kind, 'opening');
    assert.equal(P.openingName(7).ok, false);
    assert.equal(typeof P.createEngine, 'function');
    assert.equal(typeof P.Searcher, 'function');
    assert.equal(P.unsupported('nothing').code, 'unsupported');
});

// --- the worker client, in Node

test('client: two calls issued together resolve in order, and no two run at once', async () => {
    const engine = P.createEngine();
    try {
        const order = [];
        const a = engine.analyze(START, { nodes: 30000 }).then((r) => (order.push('a'), r));
        const b = engine.analyze('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { depth: 4 }).then((r) => (order.push('b'), r));
        const [ra, rb] = await Promise.all([a, b]);
        assert.deepEqual(order, ['a', 'b']);
        assert.equal(ra.fen, START);
        assert.equal(rb.mate, 1);
        // the worker's answer is what the sync API says
        assert.deepEqual(ra, P.analyze(START, { nodes: 30000 }));
    } finally {
        engine.terminate();
    }
});

test('client: messages survive the worker, tablebase and openingName included', async () => {
    const engine = P.createEngine();
    try {
        const bad = await engine.analyze('nonsense');
        assert.equal(bad.kind, 'invalid');
        assert.ok(bad.reason instanceof I.Msg);
        assert.ok(bad.reason.ru.length > 0 && bad.reason.en.length > 0);
        assert.ok(!hasMsg(I.localize(bad, 'ru')));
        const t = await engine.tablebase('8/8/8/4k3/8/8/4K3/7Q w - - 0 1');
        assert.equal(t.kind, 'tablebase');
        assert.equal(t.wdl, 1);
        const o = await engine.openingName('1. e4 e5 2. Nf3 Nc6 3. Bb5');
        assert.equal(o.kind, 'opening');
        assert.ok(o.name instanceof I.Msg);
        assert.ok(o.name.en.length > 0);
        const progress = [];
        const t2 = await engine.tablebase('4k3/8/8/8/8/8/8/R3K3 w - - 0 1', { onProgress: (p) => progress.push(p) });
        assert.equal(t2.kind, 'tablebase');
    } finally {
        engine.terminate();
    }
});

test('worker: a method that does not exist is an unsupported result', async () => {
    const { Worker } = require('node:worker_threads');
    const w = new Worker(require('node:url').pathToFileURL(require('node:path').join(__dirname, '../src/worker/worker.js')));
    try {
        const r = await new Promise((resolve, reject) => {
            w.on('message', (m) => m.type === 'result' && resolve(m.value));
            w.on('error', reject);
            w.postMessage({ type: 'init', tbUrl: undefined, flag: null });
            w.postMessage({ type: 'call', id: 1, method: 'noSuchMethodEver', args: [], callbacks: [] });
        });
        assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'unsupported']);
        assert.equal(r.reason.$msg, 'api.error.unsupported');
    } finally {
        await w.terminate();
    }
});

test('worker: importing the script on the main thread starts nothing', () => {
    const { execFileSync } = require('node:child_process');
    const code = "const m = await import('./src/worker/worker.js'); console.log(JSON.stringify(Object.keys(m)), process.listenerCount('message'));";
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
        cwd: require('node:path').join(__dirname, '..'),
        timeout: 15000,
        encoding: 'utf8',
    });
    assert.equal(out.trim(), '[] 0'); // no exports, no listener, and the process ended by itself
});

// a worker script of our own: dies on 'die', answers anything else
function fixtureWorker() {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stepchess-worker-'));
    const file = path.join(dir, 'worker.mjs');
    fs.writeFileSync(
        file,
        [
            "import { parentPort } from 'node:worker_threads';",
            "parentPort.on('message', (m) => {",
            "  if (m.type !== 'call') return;",
            "  if (m.args[0] === 'die') process.exit(3);",
            "  parentPort.postMessage({ type: 'result', id: m.id, value: { ok: true, kind: 'echo', input: m.args[0] } });",
            '});',
        ].join('\n'),
    );
    return { url: require('node:url').pathToFileURL(file), dir };
}

test('client: a worker that dies during a call rejects it as crashed, and the queue goes on with a new worker', async () => {
    const fx = fixtureWorker();
    const engine = P.createEngine({ workerUrl: fx.url });
    try {
        const settled = await Promise.allSettled([
            engine.openingName('die'),
            engine.openingName('fine'),
            engine.openingName('die'),
            engine.openingName('again'),
        ]);
        assert.deepEqual(
            settled.map((s) => s.status),
            ['rejected', 'fulfilled', 'rejected', 'fulfilled'],
        );
        assert.equal(settled[0].reason.code, 'crashed');
        assert.equal(settled[2].reason.code, 'crashed');
        assert.equal(settled[1].value.input, 'fine');
        assert.equal(settled[3].value.input, 'again');
    } finally {
        engine.terminate();
        require('node:fs').rmSync(fx.dir, { recursive: true, force: true });
    }
});

test('client: a worker script that cannot be started rejects consecutive calls as crashed, each in turn', async () => {
    const engine = P.createEngine({ workerUrl: new URL('file:///definitely/not/here/worker.mjs') });
    try {
        const settled = await Promise.allSettled([engine.openingName('a'), engine.openingName('b'), engine.analyze(START, { depth: 2 })]);
        assert.equal(settled.length, 3);
        for (const s of settled) {
            assert.equal(s.status, 'rejected');
            assert.ok(['crashed', 'spawn'].includes(s.reason.code), s.reason.code);
            assert.ok(s.reason instanceof P.EngineError);
        }
    } finally {
        engine.terminate();
    }
});

test('analyze: calls nested in callbacks leave the outer analysis valid, however deep', () => {
    const other = '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1';
    const direct = P.analyze(START, { depth: 5 });
    const inner = [];
    const r = P.analyze(START, {
        depth: 5,
        onInfo: () => {
            inner.push(P.analyze(other, { depth: 3, onInfo: () => inner.push(P.analyze(START, { depth: 2 })) }));
        },
    });
    assert.equal(r.kind, 'analysis');
    assert.deepEqual(r, direct);
    assert.ok(inner.length > 5 && inner.every((x) => x.kind === 'analysis'));
    // the flag is back to idle: the next call reuses the shared searcher and still agrees
    assert.deepEqual(P.analyze(START, { depth: 5 }), direct);
    // a nested call from stop() too
    const stopper = P.analyze(START, { depth: 4, stop: () => P.analyze(other, { depth: 2 }).kind !== 'analysis' });
    assert.equal(stopper.kind, 'analysis');
});

test('analyze: infinite only lifts the default budget when a stop callback is given', () => {
    const r = P.analyze(START, { infinite: true });
    assert.ok(r.nodes >= 300000 && r.nodes < 400000, String(r.nodes));
    let n = 0;
    const s = P.analyze(START, { infinite: true, stop: () => ++n > 400 });
    assert.ok(s.nodes > 300000, String(s.nodes));
});

test('client: a stop in respawn mode resolves with a depth that holds every requested line', async () => {
    const engine = P.createEngine({ sharedStop: false });
    try {
        let started;
        const gate = new Promise((r) => (started = r));
        const run = engine.analyze(START, { depth: 30, multipv: 3, onInfo: (res) => res.lines.length === 2 && started() });
        await gate; // in the middle of a depth: two of its three lines are reported
        await engine.stop();
        const r = await run;
        assert.equal(r.stopped, true);
        assert.equal(r.lines.length, 3);
    } finally {
        engine.terminate();
    }
});

for (const sharedStop of [true, false]) {
    test(`client: an infinite analysis runs until stop() (${sharedStop ? 'shared flag' : 'respawn'})`, async () => {
        const engine = P.createEngine({ sharedStop });
        try {
            // the 300,000-node default budget would end the search before it reports more than that; an infinite one goes on
            let passed;
            const beyond = new Promise((r) => (passed = r));
            const run = engine.analyze(START, { infinite: true, onInfo: (info) => info.nodes > 350000 && passed() });
            const ended = run.then(() => 'ended');
            assert.equal(await Promise.race([beyond.then(() => 'beyond'), ended]), 'beyond');
            await engine.stop();
            const r = await run;
            assert.equal(r.kind, 'analysis');
            assert.equal(r.stopped, true);
        } finally {
            engine.terminate();
        }
    });
}

for (const sharedStop of [true, false]) {
    test(`client: stop() during a deep analysis resolves with the last completed depth, stopped: true (${sharedStop ? 'shared flag' : 'respawn'})`, async () => {
        const engine = P.createEngine({ sharedStop });
        try {
            let infos = 0;
            let resolveFirst;
            const first = new Promise((r) => (resolveFirst = r));
            const run = engine.analyze(START, {
                depth: 30,
                onInfo: () => {
                    infos++;
                    resolveFirst();
                },
            });
            await first;
            await engine.stop();
            const r = await run;
            assert.equal(r.kind, 'analysis');
            assert.equal(r.stopped, true);
            assert.ok(r.depth >= 1 && r.depth < 30, String(r.depth));
            assert.ok(r.lines.length >= 1 && r.lines[0].uci);
            assert.ok(infos >= 1);
            // the engine is alive afterwards, and the flag does not leak into the next call
            const next = await engine.analyze('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', { depth: 3 });
            assert.equal(next.mate, 1);
            assert.equal(next.stopped, undefined);
        } finally {
            engine.terminate();
        }
    });
}

test('client: stop() before the worker has answered anything still ends the call; stop() with nothing running is a no-op', async () => {
    const engine = P.createEngine();
    try {
        await engine.stop();
        const run = engine.analyze(START, { depth: 30 });
        await engine.stop();
        const r = await run;
        assert.equal(r.stopped, true);
        assert.ok(r.depth >= 1);
    } finally {
        engine.terminate();
    }
});

test('client: a call queued behind a running one waits for it, and stop() ends only the running one', async () => {
    const engine = P.createEngine();
    try {
        let started;
        const gate = new Promise((r) => (started = r));
        const running = engine.analyze(START, { depth: 30, onInfo: () => started() });
        let secondStarted = false;
        const second = engine.analyze('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', {
            depth: 3,
            onInfo: () => (secondStarted = true),
        });
        await gate;
        assert.equal(secondStarted, false);
        await engine.stop();
        const r1 = await running;
        const r2 = await second;
        assert.equal(r1.stopped, true);
        assert.equal(r2.stopped, undefined);
        assert.equal(r2.mate, 1);
    } finally {
        engine.terminate();
    }
});

test('client: terminate() rejects pending calls with a typed error, and later calls too', async () => {
    const engine = P.createEngine();
    let started;
    const gate = new Promise((r) => (started = r));
    const running = engine.analyze(START, { depth: 30, onInfo: () => started() });
    const queued = engine.analyze(START, { depth: 3 });
    await gate;
    engine.terminate();
    await assert.rejects(running, { code: 'terminated' });
    await assert.rejects(queued, { code: 'terminated' });
    await assert.rejects(engine.analyze(START, { depth: 3 }), { code: 'terminated' });
    await engine.stop(); // nothing to stop, and it does not throw
    engine.terminate(); // twice is fine
});

test('worker: with a tbUrl it loads the shipped tables in the background, and a tbUrl that holds none breaks nothing', async () => {
    const path = require('node:path');
    const fs = require('node:fs');
    const { pathToFileURL } = require('node:url');
    const DATA = path.join(__dirname, '../data/tb');
    // the worker's list is the tables data/tb ships
    const source = fs.readFileSync(path.join(__dirname, '../src/worker/worker.js'), 'utf8');
    const listed = [...source.match(/const SHIPPED_TABLES = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
    const files = fs
        .readdirSync(DATA)
        .filter((f) => f.endsWith('.bin'))
        .map((f) => f.slice(0, -4));
    assert.deepEqual([...listed].sort(), files.sort());

    const KQK = '8/8/8/4k3/8/8/4K3/7Q w - - 0 1'; // a mate a depth-4 search finds only with the table
    const engine = P.createEngine({ tbUrl: pathToFileURL(DATA).href });
    const nowhere = P.createEngine({ tbUrl: pathToFileURL(path.join(DATA, 'not-here')).href });
    try {
        // the first call is answered whatever the loading is doing
        assert.equal((await engine.openingName('1. e4 e5')).kind, 'opening');
        let r;
        for (const until = Date.now() + 30000; Date.now() < until;) {
            r = await engine.analyze(KQK, { depth: 4 });
            if (r.mate !== null) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.equal(r.kind, 'analysis');
        assert.ok(r.mate > 0, 'the table reached the search');
        const lost = await nowhere.analyze(KQK, { depth: 4 });
        assert.deepEqual([lost.kind, lost.mate], ['analysis', null]);
    } finally {
        engine.terminate();
        nowhere.terminate();
    }
});

test('client: a relative tbUrl is resolved against the page, not against the worker script', async () => {
    const path = require('node:path');
    const { pathToFileURL } = require('node:url');
    const KQK = '8/8/8/4k3/8/8/4K3/7Q w - - 0 1';
    // a page in data/: 'tb/' is data/tb/ from there (from the worker script in src/worker/ it would be src/worker/tb/)
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    globalThis.document = { baseURI: pathToFileURL(path.join(__dirname, '../data/index.html')).href };
    let engine;
    try {
        engine = P.createEngine({ tbUrl: 'tb/' });
    } finally {
        if (!had) delete globalThis.document;
    }
    try {
        let r;
        for (const until = Date.now() + 30000; Date.now() < until;) {
            r = await engine.analyze(KQK, { depth: 4 });
            if (r.mate !== null) break;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        assert.ok(r.mate > 0, 'the tables were found next to the page');
    } finally {
        engine.terminate();
    }
});

test('verifyPuzzle, solveMate and findPuzzles are wired once into the package, safe on hostile input, and through the worker', async () => {
    const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1';
    const SCHOLAR_GAME = '1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0';
    const v = P.verifyPuzzle({ fen: BACK_RANK, moves: ['Rd8#'] }, { nodes: 5000 });
    assert.deepEqual([v.ok, v.kind, v.valid], [true, 'puzzle', true]);
    const s = P.solveMate(BACK_RANK, 1);
    assert.deepEqual([s.ok, s.kind, s.solutions], [true, 'mate', ['d1d8']]);
    const f = P.findPuzzles(SCHOLAR_GAME, { nodes: 3000 });
    assert.deepEqual([f.ok, f.kind], [true, 'puzzles']);
    assert.ok(f.puzzles.some((p) => p.moves[0] === 'h5f7'));
    for (const r of [P.verifyPuzzle(null), P.solveMate('x', 1), P.findPuzzles(42), P.verifyPuzzle({ fen: BACK_RANK, moves: ['Rd8#'] }, 'sloppy')]) {
        assert.equal(typeof r.ok, 'boolean');
        if (!r.ok) assert.equal(r.kind, 'invalid');
    }
    const engine = P.createEngine();
    try {
        const w = await engine.findPuzzles(SCHOLAR_GAME, { nodes: 3000 });
        assert.deepEqual(I.localize(w, 'en'), I.localize(f, 'en'));
        assert.equal((await engine.solveMate(BACK_RANK, 1)).kind, 'mate');
    } finally {
        engine.terminate();
    }
});

test('client: the moves of the game cross to the worker for explainMove, hint and opponentMove (I4)', async () => {
    // after Ra5+ with this history the position occurs for the third time
    const Q = '8/8/8/R2k4/8/8/2N5/4K3 b - - 1 40';
    const toP0 = ['d5d6', 'a5a1', 'd6d5', 'a1a5', 'd5d6', 'a5a1', 'd6d5'];
    const engine = P.createEngine();
    try {
        const e = await engine.explainMove(Q, 'Ra5+', { nodes: 20000, moves: toP0 });
        assert.equal(e.kind, 'move');
        assert.match(I.inLanguage(e.steps[0].text, 'en'), /third time/);
        assert.deepEqual(I.localize(e, 'en'), I.localize(P.explainMove(Q, 'Ra5+', { nodes: 20000, moves: toP0 }), 'en'));
        const h = await engine.hint(Q, 3, { nodes: 20000, moves: toP0 });
        assert.deepEqual(h.move, P.hint(Q, 3, { nodes: 20000, moves: toP0 }).move);
        const o = await engine.opponentMove({ elo: 2800, seed: 1 }, Q, toP0);
        assert.deepEqual(o, P.opponentMove({ elo: 2800, seed: 1 }, Q, toP0));
        assert.notEqual(o.uci, 'a1a5', 'the winning bot does not repeat');
        assert.equal((await engine.opponentMove({ elo: 1500 }, Q, 'd5d6')).code, 'moves');
        assert.equal((await engine.explainMove(Q, 'Kd6', { moves: 7 })).code, 'moves');
    } finally {
        engine.terminate();
    }
});

test('client: arguments it cannot read or copy resolve to an invalid result, never a throw (M3)', async () => {
    const engine = P.createEngine();
    const throwing = {
        get nodes() {
            throw new Error('boom');
        },
    };
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    try {
        for (const [what, call] of [
            ['analyze with a throwing getter', () => engine.analyze(START, throwing)],
            ['explainMove with a throwing getter', () => engine.explainMove(START, 'e4', throwing)],
            ['hint with a revoked Proxy', () => engine.hint(START, 1, revoked.proxy)],
            ['tablebase with a throwing getter', () => engine.tablebase('8/8/8/4k3/8/8/4K3/7Q w - - 0 1', throwing)],
        ]) {
            let p;
            assert.doesNotThrow(() => (p = call()), what);
            const r = await p;
            assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'options'], what);
            assert.ok(I.inLanguage(r.reason, 'ru').length > 0 && I.inLanguage(r.reason, 'en').length > 0);
        }
        for (const [what, call] of [
            ['a symbol among the moves', () => engine.analyze(START, { moves: [Symbol('e4')], nodes: 1000 })],
            ['a function inside a list', () => engine.explainMove(START, 'e4', { moves: [() => 'e4'] })],
            ['a symbol as the fen', () => engine.hint(Symbol('fen'), 1)],
        ]) {
            let p;
            assert.doesNotThrow(() => (p = call()), what);
            const r = await p;
            assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'clone'], what);
            assert.match(I.inLanguage(r.reason, 'en'), /cannot be copied/);
        }
        // the engine goes on after them
        assert.equal((await engine.analyze(START, { nodes: 1000 })).kind, 'analysis');
    } finally {
        engine.terminate();
    }
});

test('worker: in Node it loads the shipped tables from data/tb without a tbUrl; a tablebase draw is said to be one (M2)', async () => {
    const KPK = '8/3k4/8/3K4/3P4/8/8/8 w - - 0 1';
    const engine = P.createEngine();
    try {
        let r;
        for (const until = Date.now() + 60000; Date.now() < until;) {
            r = await engine.explainMove(KPK, 'Kc5', { nodes: 20000 });
            if (/tablebases/.test(I.inLanguage(r.steps[0].text, 'en'))) break;
            await new Promise((resolve) => setTimeout(resolve, 200));
        }
        assert.equal(I.inLanguage(r.steps[0].text, 'ru'), 'По таблицам эндшпиля позиция ничейная: ход сохраняет ничью.');
        assert.equal(r.winAfter, 0.5);
    } finally {
        engine.terminate();
    }
});
