// uci: bin/uci.js speaks UCI on stdin/stdout: the handshake, positions, fixed-node and infinite searches with stop, clocks, errors, UCI_LimitStrength.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const BIN = path.join(__dirname, '../bin/uci.js');

// a running engine process: send lines, wait for a line that matches
function start() {
    const child = spawn(process.execPath, [BIN], { stdio: ['pipe', 'pipe', 'inherit'] });
    const lines = [];
    const waiters = [];
    let buf = '';
    let exited = false;
    const exit = new Promise((resolve) => child.on('exit', (code) => ((exited = true), resolve(code))));
    child.stdout.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            lines.push(buf.slice(0, i).replace(/\r$/, ''));
            buf = buf.slice(i + 1);
        }
        for (const w of waiters.slice()) w();
    });
    const send = (line) => child.stdin.write(`${line}\n`);
    // resolves with the first line from `from` on that matches; rejects after ms
    const waitFor = (re, { ms = 20000, from = 0 } = {}) =>
        new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                waiters.splice(waiters.indexOf(check), 1);
                reject(new Error(`no line matching ${re} within ${ms} ms; got:\n${lines.slice(from).join('\n')}`));
            }, ms);
            const check = () => {
                const hit = lines.slice(from).find((l) => re.test(l));
                if (hit === undefined) return;
                clearTimeout(timer);
                waiters.splice(waiters.indexOf(check), 1);
                resolve(hit);
            };
            waiters.push(check);
            check();
        });
    const quit = async () => {
        if (!exited) {
            send('quit');
            await Promise.race([exit, new Promise((r) => setTimeout(r, 5000))]);
            if (!exited) child.kill();
        }
    };
    return { child, lines, send, waitFor, quit, exit };
}

async function legalUci(fen) {
    const P = await import('../src/index.js');
    return P.position(fen).legal.map((m) => m.uci);
}

test('uci: the handshake lists the engine and its options', async () => {
    const e = start();
    try {
        e.send('uci');
        await e.waitFor(/^uciok$/);
        const text = e.lines.join('\n');
        assert.match(text, /^id name stepchess 0\.1\.0$/m);
        assert.match(text, /^id author legostin$/m);
        assert.match(text, /^option name Hash type spin default \d+ min 1 max 1024$/m);
        assert.match(text, /^option name MultiPV type spin default 1 min 1 max 10$/m);
        assert.match(text, /^option name UCI_LimitStrength type check default false$/m);
        assert.match(text, /^option name UCI_Elo type spin default \d+ min 400 max 2800$/m);
        e.send('isready');
        await e.waitFor(/^readyok$/);
    } finally {
        await e.quit();
    }
});

test('uci: position startpos moves e2e4, go nodes 20000 gives a legal bestmove', async () => {
    const e = start();
    try {
        e.send('uci');
        e.send('isready');
        e.send('position startpos moves e2e4');
        e.send('go nodes 20000');
        const best = await e.waitFor(/^bestmove /);
        const move = best.split(' ')[1];
        const legal = await legalUci('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
        assert.ok(legal.includes(move), best);
        const info = e.lines.find((l) => /^info depth \d+ /.test(l));
        assert.ok(info, 'an info line before bestmove');
        assert.match(info, /score (cp -?\d+|mate -?\d+)/);
        assert.match(info, / nodes \d+/);
        assert.match(info, / pv [a-h][1-8][a-h][1-8]/);
    } finally {
        await e.quit();
    }
});

test('uci: go infinite, then stop within 500 ms gives a bestmove', async () => {
    const e = start();
    try {
        e.send('uci');
        e.send('isready');
        await e.waitFor(/^readyok$/);
        e.send('position startpos');
        e.send('go infinite');
        await e.waitFor(/^info depth 3 /); // it is searching
        const from = e.lines.length;
        const t0 = Date.now();
        e.send('stop');
        const best = await e.waitFor(/^bestmove /, { from, ms: 500 });
        assert.ok(Date.now() - t0 < 500);
        assert.ok((await legalUci('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1')).includes(best.split(' ')[1]), best);
        // and the engine goes on: a second search works
        e.send('go depth 3');
        await e.waitFor(/^bestmove /, { from: e.lines.length });
    } finally {
        await e.quit();
    }
});

test('uci: stop sent right after go, before the worker has started, still ends the search', async () => {
    const e = start();
    try {
        e.send('position startpos');
        e.send('go infinite');
        e.send('stop');
        await e.waitFor(/^bestmove /, { ms: 10000 });
    } finally {
        await e.quit();
    }
});

test('uci: fen positions, moves, clocks, movetime, depth and MultiPV', async () => {
    const e = start();
    try {
        e.send('setoption name MultiPV value 2');
        e.send('setoption name Hash value 8');
        e.send('position fen 6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
        e.send('go depth 4');
        let best = await e.waitFor(/^bestmove /);
        assert.equal(best.split(' ')[1], 'a1a8');
        assert.ok(
            e.lines.some((l) => /multipv 2 /.test(l)),
            'a second line',
        );
        assert.ok(
            e.lines.some((l) => /score mate 1 /.test(l)),
            'mate in 1',
        );

        let from = e.lines.length;
        e.send('setoption name MultiPV value 1');
        e.send('ucinewgame');
        e.send('position startpos moves e2e4 e7e5 g1f3');
        e.send('go wtime 5000 btime 5000 winc 0 binc 0 movestogo 40');
        best = await e.waitFor(/^bestmove /, { from });
        assert.ok((await legalUci('rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2')).includes(best.split(' ')[1]));

        from = e.lines.length;
        e.send('go movetime 100');
        best = await e.waitFor(/^bestmove /, { from });
        assert.ok(best.length > 9);
    } finally {
        await e.quit();
    }
});

test('uci: a finished game, a bad position and junk input do not crash the engine', async () => {
    const e = start();
    try {
        e.send('position fen 7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
        e.send('go depth 3');
        assert.equal(await e.waitFor(/^bestmove /), 'bestmove 0000');

        let from = e.lines.length;
        e.send('position fen this is not a fen');
        e.send('go depth 3');
        assert.equal(await e.waitFor(/^bestmove /, { from }), 'bestmove 0000');
        assert.ok(e.lines.slice(from).some((l) => /^info string /.test(l)));

        from = e.lines.length;
        e.send('position startpos moves e2e5');
        e.send('go depth 3');
        assert.equal(await e.waitFor(/^bestmove /, { from }), 'bestmove 0000');

        from = e.lines.length;
        e.send('nonsense command');
        e.send('');
        e.send('setoption name Nothing value 3');
        e.send('setoption');
        e.send('position startpos');
        e.send('go depth 2');
        const best = await e.waitFor(/^bestmove /, { from });
        assert.notEqual(best, 'bestmove 0000');
        e.send('isready');
        await e.waitFor(/^readyok$/, { from });
    } finally {
        await e.quit();
    }
});

test('uci: quit ends the process', async () => {
    const e = start();
    e.send('uci');
    await e.waitFor(/^uciok$/);
    e.send('quit');
    const code = await Promise.race([e.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    assert.equal(code, 0);
});

// a search that would never end by itself: end of input must stop it, answer, and exit
for (const go of ['go', 'go infinite', 'go mate 3', 'go ponder']) {
    test(`uci: end of input during "${go}" stops the search, answers and exits`, async () => {
        const e = start();
        e.send('position startpos');
        e.send(go);
        await e.waitFor(/^info depth 2 /);
        e.child.stdin.end();
        await e.waitFor(/^bestmove /, { ms: 5000 });
        const code = await Promise.race([e.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
        assert.equal(code, 0);
    });
}

test('uci: end of input finishes the search in progress and exits', async () => {
    const e = start();
    e.send('position startpos');
    e.send('go depth 3');
    e.child.stdin.end();
    await e.waitFor(/^bestmove /);
    const code = await Promise.race([e.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    assert.equal(code, 0);
});

// a second go that waits behind a search which never ends by itself must not keep the process alive
test('uci: quit with a second "go infinite" queued answers the first search and exits', async () => {
    const e = start();
    e.send('position startpos');
    e.send('go infinite');
    e.send('go infinite');
    await e.waitFor(/^info depth 2 /);
    e.send('quit');
    await e.waitFor(/^bestmove /, { ms: 5000 });
    const code = await Promise.race([e.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    if (code === 'timeout') e.child.kill();
    assert.equal(code, 0);
    assert.equal(e.lines.filter((l) => /^bestmove /.test(l)).length, 1, 'only the search that ran answers');
});

test('uci: end of input with several "go infinite" queued answers the first search and exits', async () => {
    const e = start();
    e.send('position startpos');
    e.send('go infinite');
    e.send('go infinite');
    e.send('go');
    await e.waitFor(/^info depth 2 /);
    e.child.stdin.end();
    await e.waitFor(/^bestmove /, { ms: 5000 });
    const code = await Promise.race([e.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    if (code === 'timeout') e.child.kill();
    assert.equal(code, 0);
    assert.equal(e.lines.filter((l) => /^bestmove /.test(l)).length, 1);
});

test('uci: lines after quit are ignored', async () => {
    const e = start();
    e.send('quit');
    e.send('uci');
    const code = await Promise.race([e.exit, new Promise((r) => setTimeout(() => r('timeout'), 5000))]);
    if (code === 'timeout') e.child.kill();
    assert.equal(code, 0);
    assert.equal(e.lines.includes('uciok'), false);
});

// UCI_LimitStrength: the engine plays the opponent's moves, the seed fixed per game
const LIMITED = ['setoption name UCI_LimitStrength value true', 'setoption name UCI_Elo value 1200'];

// the engine playing both sides for some plies of a new game: [{info, bestmove}]
async function limitedGame(e, plies) {
    const moves = [];
    const out = [];
    for (let i = 0; i < plies; i++) {
        const from = e.lines.length;
        e.send(`position startpos${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
        e.send(i % 2 ? 'go wtime 60000 btime 60000' : 'go movetime 100');
        const best = (await e.waitFor(/^bestmove /, { from })).split(' ')[1];
        const info = e.lines.slice(from).find((l) => /^info /.test(l));
        out.push({ info, best });
        moves.push(best);
    }
    return out;
}

test('uci: with UCI_LimitStrength go plays the moves of createOpponent({elo: UCI_Elo, seed: the number of the game}), the same in every run', async () => {
    const P = await import('../src/index.js');
    const PLIES = 14; // past the opening book (12 plies), so the search moves are compared too
    const bests = (game) => game.map((x) => x.best);
    // run 0: a ucinewgame before the first go (still game 1), a game, a ucinewgame (game 2) and another; a second
    // ucinewgame before any go starts no game of its own. run 1: no ucinewgame at all, so its one game is game 1
    const runs = [];
    for (let run = 0; run < 2; run++) {
        const e = start();
        try {
            for (const line of LIMITED) e.send(line);
            const games = [];
            if (run === 0) e.send('ucinewgame');
            games.push(await limitedGame(e, PLIES));
            if (run === 0) {
                e.send('ucinewgame');
                e.send('ucinewgame');
                games.push(await limitedGame(e, PLIES));
            }
            runs.push(games);
        } finally {
            await e.quit();
        }
    }
    for (const { info, best } of runs[0][0]) assert.match(info, new RegExp(`^info time \\d+ pv ${best}$`));
    const expected = (seed) => {
        const opponent = P.createOpponent({ elo: 1200, seed });
        const game = new P.Game();
        const moves = [];
        for (let i = 0; i < PLIES; i++) {
            const r = opponent.move(game.position);
            moves.push(r.uci);
            game.play(r.uci);
        }
        return moves;
    };
    const [one, two] = [expected(1), expected(2)];
    assert.notDeepEqual(one, two, 'the seeds 1 and 2 play different games, so the test tells them apart');
    assert.deepEqual(bests(runs[0][0]), one);
    assert.deepEqual(bests(runs[1][0]), one);
    assert.deepEqual(bests(runs[0][1]), two);
});

test('uci: UCI_LimitStrength holds the bestmove of go infinite until stop, answers a finished game with 0000, and false searches again', async () => {
    const e = start();
    try {
        for (const line of LIMITED) e.send(line);
        e.send('position fen 6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
        let from = e.lines.length;
        e.send('go infinite');
        await e.waitFor(/^info time \d+ pv d1d8$/, { from });
        await new Promise((r) => setTimeout(r, 300));
        assert.ok(!e.lines.slice(from).some((l) => /^bestmove /.test(l)), 'no bestmove before stop');
        e.send('stop');
        assert.equal(await e.waitFor(/^bestmove /, { from }), 'bestmove d1d8');

        from = e.lines.length;
        e.send('position fen 7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
        e.send('go depth 3');
        assert.equal(await e.waitFor(/^bestmove /, { from }), 'bestmove 0000');

        from = e.lines.length;
        e.send('position fen this is not a fen');
        e.send('go depth 3');
        assert.equal(await e.waitFor(/^bestmove /, { from }), 'bestmove 0000');
        assert.ok(e.lines.slice(from).some((l) => /^info string /.test(l)));

        from = e.lines.length;
        e.send('setoption name UCI_LimitStrength value false');
        e.send('position startpos');
        e.send('go depth 3');
        await e.waitFor(/^info depth 3 .* score cp /, { from });
        assert.notEqual(await e.waitFor(/^bestmove /, { from }), 'bestmove 0000');
    } finally {
        await e.quit();
    }
});
