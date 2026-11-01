// play: the levels and their interpolation, the human-like opponent (deterministic by seed, legal moves, book, terminal and invalid input), and its strength ladder.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let C;
let E;
let S;
let W;
let PLAY;
before(async () => {
    C = await import('../src/core/index.js');
    E = await import('../src/endgame/index.js');
    S = await import('../src/search/index.js');
    W = await import('../src/eval/index.js');
    PLAY = await import('../src/play/index.js');
});

const ANCHORS = [400, 800, 1200, 1600, 2000, 2400, 2800];

test('the levels: seven anchors with every parameter, and the interpolation between them', () => {
    const { LEVELS, levelFor } = PLAY;
    assert.deepEqual(
        LEVELS.map((l) => l.elo),
        ANCHORS,
    );
    for (const l of LEVELS) {
        assert.ok(l.nodes >= 1 && l.temperature > 0 && l.multipv >= 1, `elo ${l.elo}`);
        for (const k of ['backward', 'longDiagonal', 'quietWin']) assert.ok(l.blind[k] >= 0 && l.blind[k] <= 1, `blind.${k} of ${l.elo}`);
        assert.ok(Number.isInteger(l.blind.threatDepth) && l.blind.threatDepth >= 1);
        assert.ok(l.blunder.base >= 0 && l.blunder.complexity >= 0);
    }
    // the ladder: stronger levels search more, choose more sharply and hide less
    for (let i = 1; i < LEVELS.length; i++) {
        const [a, b] = [LEVELS[i - 1], LEVELS[i]];
        assert.ok(b.nodes >= a.nodes, `nodes at ${b.elo}`);
        assert.ok(b.temperature <= a.temperature, `temperature at ${b.elo}`);
        assert.ok(b.blunder.base <= a.blunder.base, `blunder base at ${b.elo}`);
        assert.ok(b.blind.threatDepth >= a.blind.threatDepth, `threat depth at ${b.elo}`);
    }
    // an anchor is itself; a point between two anchors lies between them; outside the ladder the ends hold
    assert.deepEqual(levelFor(1200), { ...LEVELS[2] });
    const mid = levelFor(1000);
    assert.ok(mid.nodes > LEVELS[1].nodes && mid.nodes < LEVELS[2].nodes);
    assert.ok(mid.temperature <= LEVELS[1].temperature && mid.temperature >= LEVELS[2].temperature); // equal on a plateau of the calibrated ladder
    assert.ok(Number.isInteger(mid.nodes) && Number.isInteger(mid.multipv));
    assert.equal(mid.elo, 1000);
    assert.equal(levelFor(100).nodes, LEVELS[0].nodes);
    assert.equal(levelFor(5000).nodes, LEVELS[6].nodes);
    for (const bad of [NaN, undefined, null, 'x', {}, Infinity]) assert.doesNotThrow(() => levelFor(bad));
});

test('createOpponent: same seed, same moves over 20 plies; another seed plays differently', () => {
    const play = (seed, elo = 1200) => {
        const game = new C.Game();
        const bot = PLAY.createOpponent({ elo, seed });
        const out = [];
        for (let i = 0; i < 20; i++) {
            const r = bot.move(game.position);
            assert.equal(r.ok, true);
            assert.equal(r.kind, 'move');
            assert.ok(
                game.legal().some((m) => m.uci === r.uci && m.san === r.san),
                `${r.uci} is legal`,
            );
            game.play(r.uci);
            out.push(r.uci);
        }
        return out;
    };
    assert.deepEqual(play(7), play(7));
    assert.deepEqual(play(1, 400), play(1, 400));
    const games = [1, 2, 3].map((s) => play(s, 400).join(' '));
    assert.ok(new Set(games).size > 1, 'the seed changes the game');
});

test('createOpponent: a FEN and a Position give the same answer, and the Position is left as it was', () => {
    const fen = 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4';
    const pos = C.Position.fromFen(fen);
    const a = PLAY.createOpponent({ elo: 1600, seed: 3 }).move(fen);
    const b = PLAY.createOpponent({ elo: 1600, seed: 3 }).move(pos);
    assert.equal(a.ok, true);
    assert.deepEqual(a, b);
    assert.equal(pos.fen(), fen);
    assert.equal(pos.ply, 0);
});

test('the defaults: elo 1500, seed 1', () => {
    const bot = PLAY.createOpponent();
    assert.equal(bot.elo, 1500);
    assert.equal(PLAY.createOpponent({ elo: 900 }).elo, 900);
    assert.doesNotThrow(() => PLAY.createOpponent(null));
    assert.doesNotThrow(() => PLAY.createOpponent({ elo: 'x', seed: {} }));
});

test('the book: the first moves of the opening come from the book, and the choice varies with the seed', () => {
    const book = E.bookMoves(C.Position.fromFen(C.Position.START_FEN)).map((m) => C.moveToUci(m.move));
    assert.ok(book.length >= 4);
    const seen = new Set();
    for (let seed = 1; seed <= 12; seed++) {
        const r = PLAY.createOpponent({ elo: 1800, seed }).move(C.Position.START_FEN);
        assert.ok(book.includes(r.uci), `${r.uci} is a book move`);
        seen.add(r.uci);
    }
    assert.ok(seen.size > 1, 'more than one book move is played');
});

test('terminal positions: a mate, a stalemate, the fifty-move rule and dead material', () => {
    const cases = [
        ['7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', 'checkmate', 'white'],
        ['7k/8/6QK/8/8/8/8/8 b - - 0 1', 'stalemate'],
        ['8/8/4k3/8/8/4K3/4R3/8 w - - 100 90', 'fifty'],
        ['8/8/4k3/8/8/4K3/8/8 w - - 0 50', 'insufficient'],
        ['4k3/8/8/8/8/8/8/4KB2 w - - 0 50', 'insufficient'],
    ];
    cases.push(['6k1/5ppp/8/8/8/8/5PPP/3R2K1 b - - 0 1', null]);
    for (const [fen, state, winner] of cases) {
        for (const r of [PLAY.createOpponent({ elo: 1000 }).move(fen), PLAY.opponentMove({ elo: 1000, seed: 1 }, fen)]) {
            if (state === null) {
                assert.equal(r.kind, 'move', fen);
                continue;
            }
            assert.equal(r.ok, true, fen);
            assert.equal(r.kind, 'terminal', fen);
            assert.equal(r.state, state);
            assert.equal(r.winner, winner);
            assert.ok(r.reason.en.length > 5 && r.reason.ru.length > 5);
            assert.equal(r.uci, undefined);
        }
    }
});

test('a threefold repetition in the history of a Position is terminal', () => {
    const game = new C.Game();
    for (const m of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) game.play(m);
    assert.equal(game.status().state, 'threefold');
    const r = PLAY.createOpponent().move(game.position);
    assert.equal(r.kind, 'terminal');
    assert.equal(r.state, 'threefold');
});

test('the moves of the game count: ahead, the opponent avoids a claimable threefold; behind, it goes for one (I4)', () => {
    // K+R+N v K: from P0 the winning move is Ra5+; with this history Ra5+ would repeat the position a third time
    const P0 = '8/8/8/3k4/8/8/2N5/R3K3 w - - 0 40';
    const Q = '8/8/8/R2k4/8/8/2N5/4K3 b - - 1 40'; // P0 after Ra5+
    const S = '8/8/3k4/R7/8/8/2N5/4K3 w - - 2 41'; // Q after Kd6
    const toP0 = ['d5d6', 'a5a1', 'd6d5', 'a1a5', 'd5d6', 'a5a1', 'd6d5'];
    const toQ = ['a5a1', 'd6d5', 'a1a5', 'd5d6', 'a5a1', 'd6d5', 'a1a5'];
    const status = (fen, moves, played) => {
        const g = new C.Game(fen);
        for (const m of [...moves, played]) g.play(m);
        return g.status().state;
    };
    for (const seed of [1, 2, 3]) {
        // the same move without the history, as the check that the history is what changes it
        assert.equal(PLAY.opponentMove({ elo: 2800, seed }, P0).uci, 'a1a5', `seed ${seed}`);
        const ahead = PLAY.opponentMove({ elo: 2800, seed }, Q, toP0);
        assert.equal(ahead.kind, 'move');
        assert.notEqual(ahead.uci, 'a1a5', `seed ${seed}: the winning side repeats`);
        assert.equal(status(Q, toP0, ahead.uci), 'ongoing');
        // the same through createOpponent().move(fen, moves)
        assert.equal(PLAY.createOpponent({ elo: 2800, seed }).move(Q, toP0).uci, ahead.uci);
    }
    for (const [elo, seed] of [
        [2800, 1],
        [2800, 5],
        [1500, 1],
        [1500, 3],
    ]) {
        // the losing side, in check after Ra5+, plays Kd6 into the third repetition
        const behind = PLAY.opponentMove({ elo, seed }, S, toQ);
        assert.equal(behind.uci, 'd5d6', `elo ${elo} seed ${seed}`);
        assert.equal(status(S, toQ, behind.uci), 'threefold');
    }
    // without the history these levels and seeds do not all play Kd6
    assert.ok(
        [
            [2800, 5],
            [1500, 1],
            [1500, 3],
        ].some(([elo, seed]) => PLAY.opponentMove({ elo, seed }, Q).uci !== 'd5d6'),
    );
    // moves that are not a list, or cannot be played, are invalid results
    assert.equal(PLAY.opponentMove({}, Q, 'd5d6').code, 'moves');
    assert.equal(PLAY.opponentMove({}, Q, ['e2e4']).code, 'move');
});

test('hostile input gives a typed invalid result and never throws', () => {
    const bad = [
        undefined,
        null,
        42,
        {},
        [],
        '',
        'not a fen',
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
        'K6K/8/8/8/8/8/8/k7 w - - 0 1', // two white kings
        'P3k3/8/8/8/8/8/8/4K3 w - - 0 1', // a pawn on the eighth rank
        '4k3/8/8/8/8/8/8/4K2R w K - 0 1x',
        '4k3/8/8/8/8/8/8/4K3 b - - 0 1 extra junk',
        '8/8/8/8/8/8/8/8 w - - 0 1',
        'a'.repeat(100000),
        '4k3/8/8/8/8/8/4q3/4K3 b - - 0 1', // the side not to move is in check
    ];
    for (const input of bad) {
        for (const r of [PLAY.createOpponent({ elo: 800 }).move(input), PLAY.opponentMove({ elo: 800, seed: 1 }, input)]) {
            assert.equal(r.ok, false, String(input).slice(0, 30));
            assert.equal(r.kind, 'invalid');
            assert.equal(typeof r.code, 'string');
            assert.ok(r.reason && r.reason.en && r.reason.ru, 'the reason is a message');
        }
    }
    for (const opts of [null, undefined, 5, { elo: NaN, seed: NaN }, { elo: -5, seed: 'x' }]) {
        const r = PLAY.opponentMove(opts, C.Position.START_FEN);
        assert.equal(r.ok, true);
    }
});

test('options that throw when read (a getter, a revoked Proxy) give a typed invalid result, never a throw', () => {
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const hostile = [
        revoked.proxy,
        {
            get elo() {
                throw new Error('boom');
            },
        },
        {
            get seed() {
                throw new Error('boom');
            },
        },
        {
            get level() {
                throw new Error('boom');
            },
        },
    ];
    for (const options of hostile) {
        let bot;
        assert.doesNotThrow(() => (bot = PLAY.createOpponent(options)));
        const r = bot.move(C.Position.START_FEN);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'invalid');
        assert.ok(r.reason.en && r.reason.ru);
        // opponentMove reads only elo and seed: it answers, or says invalid, and does not throw
        assert.doesNotThrow(() => PLAY.opponentMove(options, C.Position.START_FEN));
    }
});

test('createOpponent: an opponent that failed to build answers each call with a result object of its own', () => {
    const bot = PLAY.createOpponent({
        get seed() {
            throw new Error('boom');
        },
    });
    const a = bot.move(C.Position.START_FEN);
    const b = bot.move(C.Position.START_FEN);
    assert.notEqual(a, b);
    assert.notEqual(a.reason, undefined);
    assert.deepEqual(a, b);
    a.code = 'changed';
    a.extra = 1;
    const c = bot.move(C.Position.START_FEN);
    assert.equal(c.code, 'internal');
    assert.equal(c.extra, undefined);
    assert.equal(b.code, 'internal', 'the earlier results were not touched either');
});

test('calibrate: parseArgs rejects zero for --nodes, --scan and --per-level and a second games file', async () => {
    const { parseArgs } = await import('../scripts/calibrate.mjs');
    for (const flag of ['--nodes', '--scan', '--per-level']) {
        assert.throws(() => parseArgs(['games.pgn', flag, '0']), /above zero/, flag);
        assert.throws(() => parseArgs(['games.pgn', flag, '-1']), /non-negative/, flag);
        assert.throws(() => parseArgs(['games.pgn', flag, 'x']), /non-negative/, flag);
        assert.throws(() => parseArgs(['games.pgn', flag]), /needs a non-negative number/, flag);
        assert.equal(parseArgs(['games.pgn', flag, '1'])[{ '--nodes': 'nodes', '--scan': 'scan', '--per-level': 'perLevel' }[flag]], 1);
    }
    // the others may still be zero (a deadline of 0 minutes, no evaluation positions)
    assert.equal(parseArgs(['games.pgn', '--minutes', '0']).minutes, 0);
    assert.throws(() => parseArgs(['a.pgn', 'b.pgn']), /one games file/);
    assert.throws(() => parseArgs(['a.pgn', '--dry', 'b.pgn']), /one games file/);
    assert.equal(parseArgs(['a.pgn', '--nodes', '500', '--dry']).file, 'a.pgn');
    assert.equal(parseArgs([]).file, undefined);
});

test('calibrate: run as a script it starts main even when the path is spelled in another case', () => {
    const { spawnSync } = require('node:child_process');
    const path = require('node:path');
    const script = path.join(__dirname, '../scripts/calibrate.mjs');
    // on Windows the folders of the path may be in any case; the file name keeps its own
    const spelled = process.platform === 'win32' ? path.join(path.dirname(script).toUpperCase(), path.basename(script)) : script;
    const r = spawnSync(process.execPath, [spelled], { encoding: 'utf8' });
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /usage: node scripts\/calibrate\.mjs/);
});

test('calibrate: verify warns when the ladder is still not monotone after its five rounds', async () => {
    const { verify } = await import('../scripts/calibrate.mjs');
    const levels = PLAY.HAND_SET.map((l) => ({ ...l, nodes: 30, blind: { ...l.blind }, blunder: { ...l.blunder } }));
    const pool = [
        { fen: C.Position.START_FEN, phase: 'opening' },
        { fen: 'rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2', phase: 'opening' },
    ];
    // a judge under which every anchor loses more than the one below, whatever its parameters: the rounds cannot repair that
    let calls = 0;
    const warnings = [];
    const warn = console.warn;
    console.warn = (...a) => warnings.push(a.join(' '));
    let result;
    try {
        result = verify(levels, pool, { loss: () => ++calls / 100000 }, { seed: 1 });
    } finally {
        console.warn = warn;
    }
    assert.equal(result.rounds, 5);
    assert.equal(result.monotone, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /not monotone after 5 strengthening rounds/);
    // a judge under which the ladder already falls along the anchors gives no warning
    const quiet = [];
    console.warn = (...a) => quiet.push(a.join(' '));
    try {
        const fine = verify(levels, pool, { loss: () => 0 }, { seed: 1 });
        assert.equal(fine.monotone, true);
        assert.equal(fine.rounds, 0);
    } finally {
        console.warn = warn;
    }
    assert.deepEqual(quiet, []);
});

// ---- positions for the tests ----

// a seeded generator for the tests
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// positions of the middlegame, endlessly: random legal moves from the start, kept when quiet and balanced enough to be a game
function* randomPositions(seed) {
    const rand = rng(seed);
    const buf = new Int32Array(256);
    for (;;) {
        const pos = C.Position.fromFen(C.Position.START_FEN);
        const plies = 14 + Math.floor(rand() * 16);
        let alive = true;
        for (let i = 0; i < plies && alive; i++) {
            const n = C.generateMoves(pos, buf);
            if (n === 0) alive = false;
            else pos.make(buf[Math.floor(rand() * n)]);
        }
        if (!alive || C.generateMoves(pos, buf) === 0 || pos.inCheck()) continue;
        const pieces = pos.counts[2] + pos.counts[3] + pos.counts[4] + pos.counts[5] + pos.counts[10] + pos.counts[11] + pos.counts[12] + pos.counts[13];
        if (pieces < 7 || Math.abs(W.evaluate(pos)) > 300) continue;
        yield C.Position.fromFen(pos.fen());
    }
}

function middlegames(count, seed) {
    const out = [];
    for (const pos of randomPositions(seed)) {
        out.push(pos);
        if (out.length === count) break;
    }
    return out;
}

// ---- the mechanisms, one at a time, through the level option ----

// a level with every blind spot off and a sharp softmax; a test switches on the one it studies
const lv = ({ blind = {}, blunder = {}, ...rest } = {}) => ({
    nodes: 2500,
    temperature: 1,
    multipv: 12,
    ...rest,
    blind: { backward: 0, longDiagonal: 0, quietWin: 0, threatDepth: 12, ...blind },
    blunder: { base: 0, complexity: 0, ...blunder },
});
const playedBy = (fen, seed, level) => PLAY.createOpponent({ elo: 1500, seed, level }).move(fen).uci;

const isBackward = (pos, m) => {
    if (C.typeOf(pos.board[C.moveFrom(m)]) === C.PAWN) return false;
    const dr = C.rankOf(C.moveTo(m)) - C.rankOf(C.moveFrom(m));
    return pos.side === C.WHITE ? dr < 0 : dr > 0;
};
const isQuiet = (pos, m) => {
    if (C.movePromo(m) || C.moveFlags(m) & C.F_CAPTURE) return false;
    const p = pos.clone();
    p.make(m);
    return !p.inCheck();
};

// the first positions of the stream that a predicate of (position, full search, shallow search) accepts; both searches are
// made as the opponent makes them: the shallow view first (to the depth), then the full one on the warm table
function find(pred, { count = 2, seed = 99, side = null, depth = 1, tries = 6000 } = {}) {
    const s = new S.Searcher({ hashMb: 8 });
    const out = [];
    let n = 0;
    for (const pos of randomPositions(seed)) {
        if (++n > tries) break;
        if (side !== null && pos.side !== side) continue;
        s.clear();
        const shallow = s.search(pos, { multipv: 12, depth, nodes: 1250 });
        const full = s.search(pos, { multipv: 12, nodes: 2500 });
        if (full.lines.length > 1 && pred(pos, full, shallow)) out.push(pos);
        if (out.length === count) break;
    }
    assert.equal(out.length, count, 'the stream holds enough positions for the test');
    return out;
}
const scoreOf = (r, m) => r.lines.find((l) => l.move === m)?.score;

test('blind spot backward: with chance 1 a retreat is never played, by White or by Black; with 0 it is the move', { timeout: 120000 }, () => {
    // the best move is a retreat, and every move that is not one is at least 3 pawns worse
    const retreat = (pos, full) => {
        const best = full.lines[0];
        const other = full.lines.find((l) => !isBackward(pos, l.move));
        return isBackward(pos, best.move) && other && best.score - other.score >= 300 && Math.abs(best.score) < 2000;
    };
    for (const side of [C.WHITE, C.BLACK]) {
        for (const pos of find(retreat, { side })) {
            const fen = pos.fen();
            for (let seed = 1; seed <= 6; seed++) {
                const open = playedBy(fen, seed, lv());
                assert.ok(isBackward(pos, C.parseMove(pos, open)), `${fen}: ${open} is the retreat when nothing is hidden`);
                const blind = playedBy(fen, seed, lv({ blind: { backward: 1 } }));
                assert.ok(!isBackward(pos, C.parseMove(pos, blind)), `${fen}: ${blind} is a retreat although retreats are hidden`);
            }
        }
    }
});

test('blind spot longDiagonal: with chance 1 a bishop move along a long diagonal is hidden, for both colours', () => {
    const cases = [
        ['4k2q/8/8/8/8/8/8/B3K3 w - - 0 1', 'a1h8'],
        ['b3k3/8/8/8/8/8/8/4K2Q b - - 0 1', 'a8h1'],
    ];
    for (const [fen, capture] of cases) {
        for (let seed = 1; seed <= 6; seed++) {
            assert.equal(playedBy(fen, seed, lv()), capture, 'the long capture wins the queen');
            assert.notEqual(playedBy(fen, seed, lv({ blind: { longDiagonal: 1 } })), capture, 'and is not seen when hidden');
        }
    }
    // a capture along a short diagonal (4 squares) is still seen
    for (let seed = 1; seed <= 6; seed++) assert.equal(playedBy('4k3/8/8/8/4q3/8/8/1B2K3 w - - 0 1', seed, lv({ blind: { longDiagonal: 1 } })), 'b1e4');
});

test('blind spot quietWin: a quiet move whose gain shows only beyond the shallow view is hidden', { timeout: 120000 }, () => {
    const late = (pos, full, shallow) => {
        const best = full.lines[0];
        const floor = Math.min(...shallow.lines.map((l) => l.score));
        const seen = (l) => scoreOf(shallow, l.move) ?? floor;
        return (
            isQuiet(pos, best.move) &&
            Math.abs(best.score) < 2000 &&
            best.score - seen(best) >= 150 &&
            full.lines.slice(1).every((l) => l.score <= best.score - 150 && seen(l) - l.score <= 100)
        );
    };
    for (const pos of find(late, { count: 2 })) {
        const fen = pos.fen();
        for (let seed = 1; seed <= 6; seed++) {
            const control = playedBy(fen, seed, lv({ blind: { threatDepth: 1 } }));
            const hidden = playedBy(fen, seed, lv({ blind: { threatDepth: 1, quietWin: 1 } }));
            assert.notEqual(hidden, control, `${fen}: the quiet winning move ${control} is hidden`);
        }
    }
});

test('blind spot threatDepth: a move refuted beyond the depth is chosen more often than when the depth is long', () => {
    // Na7-b5 looks as good as the best move at a depth of 1 ply and is 3 pawns worse in the full search; at a depth of 12
    // (the shallow view then reaches nearly as far as the full one) the refutation is seen. Found by scanning random
    // positions for such a move; fixed here so that the test does not scan.
    const fen = 'rn1qk2r/N2p3p/b3p1pn/1pb2p2/1P6/P4PP1/2PPP2P/R1BQKBNR w KQkq - 0 12';
    const bad = 'a7b5';
    let near = 0;
    let far = 0;
    for (let seed = 1; seed <= 80; seed++) {
        if (playedBy(fen, seed, lv({ temperature: 60, blind: { threatDepth: 1 } })) === bad) near++;
        if (playedBy(fen, seed, lv({ temperature: 60, blind: { threatDepth: 12 } })) === bad) far++;
    }
    assert.ok(near >= far + 10, `the refuted move ${bad} is played ${near} times with a short sight and ${far} with a long one`);
});

test('the extra chance of the 2nd to 4th move rises with the number of near-equal candidates', { timeout: 120000 }, () => {
    const clear = '4k2q/8/8/8/8/8/8/B3K3 w - - 0 1'; // one move wins a queen, the rest are far behind
    const open = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 0 7'; // a quiet middlegame: several moves are within 50 cp
    const level = lv({ blunder: { base: 0, complexity: 0.2 } });
    const rate = (fen) => {
        const best = playedBy(fen, 1, lv());
        let off = 0;
        for (let seed = 1; seed <= 60; seed++) if (playedBy(fen, seed, level) !== best) off++;
        return off / 60;
    };
    assert.equal(rate(clear), 0);
    const quiet = rate(open);
    assert.ok(quiet >= 0.4, `a quiet position gives the other moves a chance (${quiet})`);
});

test('the book is weighted by the lines, and is not used from ply 12 on', () => {
    const book = E.bookMoves(C.Position.fromFen(C.Position.START_FEN));
    const total = book.reduce((s, b) => s + b.weight, 0);
    const counts = new Map();
    const N = 600;
    for (let seed = 1; seed <= N; seed++) {
        const r = PLAY.createOpponent({ elo: 1500, seed }).move(C.Position.START_FEN);
        assert.equal(r.source, 'book');
        counts.set(r.uci, (counts.get(r.uci) ?? 0) + 1);
    }
    for (const b of book) {
        const share = b.weight / total;
        const seen = (counts.get(C.moveToUci(b.move)) ?? 0) / N;
        assert.ok(Math.abs(seen - share) < 0.07, `${C.moveToUci(b.move)}: weight share ${share.toFixed(3)}, played ${seen.toFixed(3)}`);
    }
    // a position that is still in the book at ply 12 or later: the search plays, not the book
    const rand = rng(3);
    let late = null;
    for (let t = 0; t < 200 && !late; t++) {
        const pos = C.Position.fromFen(C.Position.START_FEN);
        for (let n = 0; n < 40; n++) {
            const b = E.bookMoves(pos);
            if (!b.length) break;
            if (pos.ply >= 12) {
                late = pos.fen();
                break;
            }
            pos.make(b[Math.floor(rand() * b.length)].move);
        }
    }
    assert.ok(late, 'a line of the book is at least 12 plies long');
    assert.ok(E.bookMoves(C.Position.fromFen(late)).length > 0);
    for (let seed = 1; seed <= 4; seed++) assert.equal(PLAY.createOpponent({ elo: 1500, seed }).move(late).source, 'search');
    // the move number of the FEN decides, not the history: the same position as the 3rd move is in the book
    assert.equal(PLAY.createOpponent({ elo: 400, seed: 1 }).move(late.replace(/ \d+ \d+$/, ' 0 3')).source, 'book');
});

test('a mate in 1 is always found, at elo 400 too', () => {
    const cases = [
        '6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1',
        '4k3/8/8/8/8/8/r4PPP/6K1 b - - 0 1',
        '6k1/5ppp/8/8/8/2Q5/8/4K3 w - - 0 1',
        '8/8/8/6q1/8/8/5k2/7K b - - 0 1',
    ];
    for (const fen of cases) {
        for (let seed = 1; seed <= 40; seed++) {
            const r = PLAY.createOpponent({ elo: 400, seed }).move(fen);
            assert.equal(r.kind, 'move');
            const game = new C.Game(fen);
            game.play(r.uci);
            assert.equal(game.status().state, 'checkmate', `${fen}: ${r.san} (seed ${seed}) does not mate`);
        }
    }
});

// ---- the strength ladder ----

// the judge searches at least twice the nodes of the strongest bot it judges
const REFERENCE = () => ({ nodes: 2 * Math.max(...PLAY.LEVELS.map((l) => l.nodes)), multipv: 10 });

// the loss of a move in win chance, measured by one fixed reference search
function lossOf(searcher, pos, lines, move) {
    const best = W.winChance(lines[0].score);
    const hit = lines.find((l) => l.move === move);
    let score;
    if (hit) score = hit.score;
    else {
        const next = pos.clone();
        next.make(move);
        searcher.clear();
        score = -searcher.search(next, { nodes: REFERENCE().nodes }).score;
    }
    return Math.max(0, best - W.winChance(score));
}

test('the ladder: weaker levels lose win chance more often, and the rates fall along all seven anchors', { timeout: 1800000 }, () => {
    const sample = process.env.PLAY_SLOW ? 2000 : 200;
    const positions = middlegames(sample, 12345);
    const searcher = new S.Searcher({ hashMb: 16 });
    const judge = REFERENCE();
    const rates = ANCHORS.map(() => 0);
    const means = rates.slice();
    const bots = ANCHORS.map((elo) => PLAY.createOpponent({ elo, seed: elo }));
    for (const pos of positions) {
        searcher.clear();
        const lines = searcher.search(pos, judge).lines;
        bots.forEach((bot, i) => {
            const r = bot.move(pos);
            assert.equal(r.kind, 'move');
            const loss = lossOf(searcher, pos, lines, C.parseMove(pos, r.uci));
            if (loss > 0.2) rates[i]++;
            means[i] += loss;
        });
    }
    const rate = rates.map((n) => n / positions.length);
    const mean = means.map((n) => n / positions.length);
    console.log(
        `# judge ${judge.nodes} nodes, ${positions.length} positions; loss > 20% per anchor ${ANCHORS.join('/')}: ${rate.map((r) => (r * 100).toFixed(1)).join(' ')} %; mean loss ${mean.map((r) => (r * 100).toFixed(1)).join(' ')} %`,
    );
    assert.ok(rate[0] >= rate[5] + 0.08, `400 blunders markedly more often than 2400 (${rate[0]} vs ${rate[5]})`);
    assert.ok(rate[0] >= rate[5] * 2, 'at least twice as often');
    for (let i = 1; i < rate.length; i++) assert.ok(rate[i] <= rate[i - 1] + 0.01, `rates fall along the anchors: ${rate.join(', ')}`);
    for (let i = 1; i < mean.length; i++) assert.ok(mean[i] <= mean[i - 1] + 0.01, `mean losses fall along the anchors: ${mean.join(', ')}`);
});

test('elo 2800 plays the search best on the first 20 positions of WAC', { timeout: 300000 }, () => {
    const lines = fs
        .readFileSync(path.join(__dirname, '../bench/suites/wac.epd'), 'utf8')
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('#'));
    const level = PLAY.levelFor(2800);
    const searcher = new S.Searcher({ hashMb: 16 });
    let same = 0;
    for (const line of lines.slice(0, 20)) {
        const pos = C.Position.fromFen(line.split(';')[0].trim());
        searcher.clear();
        const best = searcher.search(pos, { nodes: level.nodes }).best;
        const r = PLAY.createOpponent({ elo: 2800, seed: 5 }).move(pos);
        assert.equal(r.kind, 'move');
        if (C.parseMove(pos, r.uci) === best) same++;
    }
    console.log(`# elo 2800 equals the search best on ${same} of 20 positions of WAC`);
    assert.ok(same >= 15, `${same} of 20 equal the search best`);
});

test('the opponent module draws no random numbers but its own', () => {
    const text = fs.readFileSync(path.join(__dirname, '../src/play/opponent.js'), 'utf8');
    assert.ok(!/Math\.random/.test(text));
});
