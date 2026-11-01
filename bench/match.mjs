// bench/match — engine against engine: A against B from balanced openings, colours reversed, with Elo and an SPRT.
//
//   node bench/match.mjs --a ../stepchess-data/prev --b . --tc 10+0.1 --games 2000 --concurrency 14 --sprt elo0=0,elo1=5
//   node bench/match.mjs --a . --b "stockfish" --nodes 20000 --games 200       (any UCI command works as an engine)
//
// --a / --b      a directory holding a stepchess checkout (it runs bin/uci.js), or a UCI command line
// --tc S+I       seconds plus increment per game for each side (default 10+0.1); --movetime MS or --nodes N replace the clock:
//                a fixed time or a fixed node budget per move (nodes get a ±10% jitter per game so repeated openings differ)
// --games N      games to play (rounded up to whole pairs; a pair is one opening with the colours reversed)
// --concurrency  games in parallel (default 14), each with its own pair of engine processes
// --sprt SPEC    elo0=0,elo1=5[,alpha=0.05,beta=0.05]: stop as soon as the test decides; without it all games are played
// --hash MB      transposition table per engine (default 16)
// --option-a / --option-b  "Name=Value,Name=Value" UCI options for one engine
// --openings F   the opening file (default bench/suites/openings.epd), --seed S the shuffle of it, --pgn F the games
// --no-adjudicate  play every game out (by default a lasting 10-pawn lead, a lasting dead zero in a long game or a 400-ply game ends it)
//
// Prints the score as W/D/L of A (games), the pentanomial of the pairs, Elo ± 95% error, the likelihood of superiority and
// the SPRT state; the verdict is the 'SPRT:' line. Exit code: 0 after a match, 1 when no game completed or three pairs in a row
// went wrong, 2 for a bad option or an engine that does not answer uci.
import fs from 'node:fs';
import { Position, parseMove, legalMoves, toSan } from '../src/index.js';
import { UciEngine, resolveEngine } from './lib/uci.mjs';
import { loadOpenings } from './lib/openings.mjs';
import { summarize, sprt, parseSprt } from './lib/sprt.mjs';
import { parseArgs, num, str } from './lib/args.mjs';

const WIN_CP = 1000;
const WIN_PLIES = 6;
const DRAW_CP = 10;
const DRAW_PLIES = 12;
const DRAW_FROM = 100;
const MAX_PLIES = 400;

function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const parseOptions = (text) =>
    Object.fromEntries(
        String(text ?? '')
            .split(',')
            .filter(Boolean)
            .map((kv) => {
                const at = kv.indexOf('=');
                return [kv.slice(0, at).trim(), kv.slice(at + 1).trim()];
            }),
    );

/**
 * Play one game. white and black are UciEngines; limit says how a move is paid for: {kind: 'clock', base, inc} (ms),
 * {kind: 'movetime', ms} or {kind: 'nodes', n}. Returns {score (White's: 1, 0.5, 0), reason, moves (UCI), sans}.
 */
async function playGame(white, black, opening, limit, adjudicate, jitter) {
    const pos = Position.fromFen(opening.fen);
    const moves = [];
    const sans = [];
    const clock = [limit.base ?? 0, limit.base ?? 0];
    const scores = []; // White's point of view, per ply: centipawns (mates as ±10000)
    const finish = (score, reason) => ({ score, reason, moves, sans });
    for (;;) {
        const legal = legalMoves(pos);
        if (!legal.length) return pos.inCheck() ? finish(pos.side === 0 ? 0 : 1, 'checkmate') : finish(0.5, 'stalemate');
        if (pos.halfmove >= 100) return finish(0.5, 'fifty-move rule');
        if (pos.repetitionCount() >= 3) return finish(0.5, 'threefold repetition');
        if (pos.isInsufficientMaterial()) return finish(0.5, 'insufficient material');
        if (moves.length >= MAX_PLIES) return finish(0.5, 'move limit');
        if (adjudicate && scores.length >= WIN_PLIES) {
            const tail = scores.slice(-WIN_PLIES);
            if (tail.every((s) => s >= WIN_CP)) return finish(1, 'adjudicated win');
            if (tail.every((s) => s <= -WIN_CP)) return finish(0, 'adjudicated win');
        }
        if (adjudicate && moves.length >= DRAW_FROM && scores.length >= DRAW_PLIES && scores.slice(-DRAW_PLIES).every((s) => Math.abs(s) <= DRAW_CP))
            return finish(0.5, 'adjudicated draw');

        const side = pos.side;
        const engine = side === 0 ? white : black;
        let go;
        if (limit.kind === 'clock')
            go = `wtime ${Math.max(1, Math.round(clock[0]))} btime ${Math.max(1, Math.round(clock[1]))} winc ${limit.inc} binc ${limit.inc}`;
        else if (limit.kind === 'movetime') go = `movetime ${limit.ms}`;
        else go = `nodes ${Math.max(1, Math.round(limit.n * jitter))}`;
        let reply;
        try {
            reply = await engine.go(opening.fen, moves, go, limit.kind === 'clock' ? Math.max(5000, clock[side] + 5000) : 120000);
        } catch (e) {
            return finish(side === 0 ? 0 : 1, `${engine.spec.label} failed: ${e.message}`);
        }
        if (limit.kind === 'clock') {
            clock[side] -= reply.ms;
            if (clock[side] < 0) return finish(side === 0 ? 0 : 1, 'time forfeit');
            clock[side] += limit.inc;
        }
        let move = 0;
        try {
            if (reply.move) move = parseMove(pos, reply.move);
        } catch {
            move = 0;
        }
        if (!move || !legal.includes(move)) return finish(side === 0 ? 0 : 1, `illegal move ${reply.move} by ${engine.spec.label}`);
        sans.push(toSan(pos, move));
        pos.make(move);
        moves.push(reply.move);
        const cp = reply.mate !== null ? (reply.mate > 0 ? 10000 : -10000) : (reply.cp ?? 0);
        scores.push(side === 0 ? cp : -cp);
    }
}

function pgnOf(game, opening, whiteName, blackName, round) {
    const result = game.score === 1 ? '1-0' : game.score === 0 ? '0-1' : '1/2-1/2';
    const start = Position.fromFen(opening.fen);
    let n = start.fullmove;
    let black = start.side === 1;
    const parts = [];
    game.sans.forEach((san, i) => {
        if (!black) parts.push(`${n}.`);
        else if (i === 0) parts.push(`${n}...`);
        parts.push(san);
        if (black) n++;
        black = !black;
    });
    return [
        `[Event "stepchess match"]`,
        `[Round "${round}"]`,
        `[White "${whiteName}"]`,
        `[Black "${blackName}"]`,
        `[Result "${result}"]`,
        `[SetUp "1"]`,
        `[FEN "${opening.fen}"]`,
        `[Termination "${game.reason}"]`,
        '',
        `${parts.join(' ')} ${result}`,
        '',
    ].join('\n');
}

const USAGE = `usage: node bench/match.mjs --a <dir|uci command> --b <dir|uci command> [options]
  --tc S+I | --movetime MS | --nodes N    the budget of a move (default --tc 10+0.1)
  --games N          games to play, rounded up to whole pairs (default 200)
  --concurrency C    games in parallel (default 14)
  --sprt SPEC        elo0=0,elo1=5[,alpha=0.05,beta=0.05]: stop when the test decides
  --hash MB  --option-a "N=V,N=V"  --option-b "N=V,N=V"  --openings FILE  --seed S  --pgn FILE  --no-adjudicate  --help`;

const fail = (text) => {
    console.error(text);
    process.exit(2);
};

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(USAGE);
        process.exit(0);
    }
    if (typeof args.a !== 'string' || typeof args.b !== 'string') fail(USAGE);
    let specA;
    let specB;
    let test = null;
    try {
        specA = resolveEngine(args.a);
        specB = resolveEngine(args.b);
        if (args.sprt) test = parseSprt(args.sprt === true ? 'elo0=0,elo1=5' : args.sprt);
    } catch (e) {
        fail(e.message);
    }
    const hash = num(args, 'hash', 16);
    const games = num(args, 'games', 200);
    if (!Number.isInteger(games) || games < 1) fail(`--games: "${args.games}" is not a positive integer`);
    const concurrency = Math.max(1, Math.floor(num(args, 'concurrency', 14)));
    const adjudicate = !args['no-adjudicate'];
    const seed = num(args, 'seed', 1);
    let limit;
    if (args.nodes) limit = { kind: 'nodes', n: num(args, 'nodes', 20000) };
    else if (args.movetime) limit = { kind: 'movetime', ms: num(args, 'movetime', 100) };
    else {
        const [base, inc = '0'] = str(args, 'tc', '10+0.1').split('+');
        limit = { kind: 'clock', base: Number(base) * 1000, inc: Number(inc) * 1000 };
        if (!(limit.base > 0) || !Number.isFinite(limit.inc) || limit.inc < 0) fail(`--tc: "${args.tc}" is not seconds+increment`);
    }
    const optsA = { Hash: hash, ...parseOptions(args['option-a']) };
    const optsB = { Hash: hash, ...parseOptions(args['option-b']) };
    const openings = loadOpenings(str(args, 'openings', undefined));
    if (!openings.length) fail('the openings file holds no position');
    // both engines must answer the handshake before any game is counted
    for (const [spec, opts] of [
        [specA, optsA],
        [specB, optsB],
    ]) {
        const probe = new UciEngine(spec);
        try {
            await probe.init(opts);
        } catch (e) {
            probe.kill();
            fail(`the engine ${spec.label} does not answer uci: ${e.message}`);
        }
        probe.quit();
    }
    const rand = rng(seed);
    const order = [];
    const totalPairs = Math.ceil(games / 2);
    while (order.length < totalPairs) {
        const pass = openings.map((_, i) => i);
        for (let i = pass.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [pass[i], pass[j]] = [pass[j], pass[i]];
        }
        order.push(...pass);
    }
    const pgnFile = typeof args.pgn === 'string' ? args.pgn : null;
    if (pgnFile) fs.writeFileSync(pgnFile, '');

    const desc =
        limit.kind === 'clock'
            ? `${limit.base / 1000}+${limit.inc / 1000} s`
            : limit.kind === 'nodes'
              ? `${limit.n} nodes per move`
              : `${limit.ms} ms per move`;
    console.log(
        `A: ${specA.label}\nB: ${specB.label}\n${totalPairs * 2} games (${totalPairs} pairs) from ${openings.length} openings, ${desc}, hash ${hash} MB, concurrency ${concurrency}`,
    );
    if (test) console.log(`SPRT: elo0=${test.elo0} elo1=${test.elo1} alpha=${test.alpha} beta=${test.beta}`);

    const wdl = [0, 0, 0]; // games: A wins, draws, A losses
    const penta = [0, 0, 0, 0, 0];
    const reasons = new Map();
    let nextPair = 0;
    let stopped = false;
    let verdict = null;
    let troubles = 0; // pairs in a row with an engine failure
    let fatal = false;
    const engines = [];
    const startedAt = Date.now();

    const report = (final) => {
        const s = summarize(penta);
        const t = test ? sprt(penta, test) : null;
        const line = `${String(wdl[0] + wdl[1] + wdl[2]).padStart(5)} games  +${wdl[0]} =${wdl[1]} -${wdl[2]}  score ${(s.score * 100).toFixed(1)}%  Elo ${s.elo >= 0 ? '+' : ''}${s.elo.toFixed(1)} ± ${Number.isFinite(s.err) ? s.err.toFixed(1) : '?'}${t ? `  LLR ${t.llr.toFixed(2)} [${t.lower.toFixed(2)}, ${t.upper.toFixed(2)}]` : ''}  ${Math.round((Date.now() - startedAt) / 1000)} s`;
        console.log(line);
        if (final) {
            console.log(`pentanomial (pairs scoring 0, 0.5, 1, 1.5, 2 for A): ${penta.join(' ')}`);
            console.log(
                `Elo of A against B: ${s.elo >= 0 ? '+' : ''}${s.elo.toFixed(1)} ± ${Number.isFinite(s.err) ? s.err.toFixed(1) : '?'} (95%), LOS ${(s.los * 100).toFixed(1)}%`,
            );
            console.log(`ends: ${[...reasons].map(([k, v]) => `${k.replace(/ failed:.*/, ' failed')} ${v}`).join(', ')}`);
            if (t)
                console.log(
                    `SPRT: ${t.state === 'H1' ? 'accepted H1 (A is better by about elo1)' : t.state === 'H0' ? 'accepted H0 (A is not better by elo1)' : 'not decided'} — LLR ${t.llr.toFixed(2)} in [${t.lower.toFixed(2)}, ${t.upper.toFixed(2)}] after ${s.games} games`,
                );
        }
    };

    const stopAll = () => {
        stopped = true;
        for (const e of engines) e.kill();
    };
    process.on('SIGINT', () => {
        stopAll();
    });

    async function slot(id) {
        let ea = null;
        let eb = null;
        const open = async () => {
            if (!ea || ea.dead) {
                ea = new UciEngine(specA);
                engines.push(ea);
                await ea.init(optsA);
            }
            if (!eb || eb.dead) {
                eb = new UciEngine(specB);
                engines.push(eb);
                await eb.init(optsB);
            }
        };
        while (!stopped) {
            const k = nextPair++;
            if (k >= totalPairs) break;
            const opening = openings[order[k]];
            const jitter = limit.kind === 'nodes' ? 0.9 + rng(seed * 7919 + k)() * 0.2 : 1;
            const results = [];
            const ends = [];
            const records = [];
            let trouble = false;
            try {
                for (const aWhite of [true, false]) {
                    if (stopped) break;
                    await open();
                    await ea.newGame();
                    await eb.newGame();
                    const g = aWhite ? await playGame(ea, eb, opening, limit, adjudicate, jitter) : await playGame(eb, ea, opening, limit, adjudicate, jitter);
                    // a game that ended because the test stopped (its engines were killed) counts for nothing
                    if (stopped) break;
                    results.push(aWhite ? g.score : 1 - g.score);
                    ends.push(g.reason);
                    if (pgnFile) records.push(pgnOf(g, opening, aWhite ? 'A' : 'B', aWhite ? 'B' : 'A', `${k + 1}.${aWhite ? 1 : 2}`));
                    if (g.reason.includes('failed')) {
                        console.log(`engine trouble in pair ${k + 1}: ${g.reason}`);
                        trouble = true;
                        ea.kill();
                        eb.kill();
                    }
                }
            } catch (e) {
                if (stopped) return;
                console.log(`slot ${id}: ${e.message}`);
                ea?.kill();
                eb?.kill();
                trouble = true;
            }
            if (stopped) return;
            if (trouble) {
                if (++troubles >= 3) {
                    console.error('three pairs in a row went wrong: stopping');
                    fatal = true;
                    stopAll();
                    return;
                }
            } else troubles = 0;
            if (results.length < 2) continue;
            for (const r of results) wdl[r === 1 ? 0 : r === 0.5 ? 1 : 2]++;
            for (const reason of ends) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
            if (pgnFile) fs.appendFileSync(pgnFile, records.join('\n') + '\n');
            penta[Math.round((results[0] + results[1]) * 2)]++;
            const pairs = penta.reduce((x, y) => x + y, 0);
            if (pairs % Math.max(1, Math.min(25, Math.floor(totalPairs / 20))) === 0) report(false);
            if (test) {
                const t = sprt(penta, test);
                if (t.state !== 'continue' && !verdict) {
                    verdict = t.state;
                    stopAll();
                }
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, totalPairs) }, (_, i) => slot(i)));
    for (const e of engines) e.quit();
    report(true);
    const none = wdl[0] + wdl[1] + wdl[2] === 0;
    if (none) console.error('no game was completed');
    setTimeout(() => process.exit(fatal || none ? 1 : 0), 500).unref();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
