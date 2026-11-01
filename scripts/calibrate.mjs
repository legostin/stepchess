// scripts/calibrate — fits the opponent's levels to real games: how much win chance players of a rating lose per move, and the bot's parameters that lose the same.
//
//   node scripts/calibrate.mjs <games.pgn | games.pgn.zst> [--scan 200000] [--per-level 200] [--moves 2] [--nodes 50000]
//                              [--evals 14] [--minutes 35] [--workers 4] [--min-positions 60] [--seed 1] [--dry]
//
// 1. The games are read as a stream (a .zst through zlib's zstd, or the `zstd` command when Node has none): rated games
//    that are not bullet, with both ratings. Players are bucketed to the nearest anchor of the ladder (400 … 2800) within ±100
//    rating points; up to --per-level games per bucket, --moves positions of each (the player to move, ply 12 or later).
// 2. The engine (--nodes per search) measures the win-chance loss of each human move: the win chance of the best move minus
//    that of the move played. Per bucket: mean loss, the share of moves losing at least 5 % / 10 % and more than 20 %
//    (inaccuracy-or-worse, mistake-or-worse, blunder), by phase.
// 3. Per bucket a coordinate search fits the level (nodes, temperature, base blunder chance; the blind spots stay as set)
//    so that the bot, playing the same positions, loses as the people did. Buckets run on worker threads.
// 4. The fitted anchors are made monotone (pool adjacent violators over the ladder; anchors without data keep their
//    hand-set values as weak evidence), and written between the markers of src/play/levels.js, with a table in bench/REPORT.md.
//
// The file is data only: games are parsed, never executed. Nothing is downloaded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Position, parseMove, moveToUci, NO_MOVE, generateMoves } from '../src/core/index.js';
import { Searcher } from '../src/search/index.js';
import { winChance } from '../src/eval/index.js';
import { HAND_SET, createOpponent } from '../src/play/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const ANCHORS = HAND_SET.map((l) => l.elo);
const BAND = 100; // a player belongs to an anchor within this many rating points
const MIN_PLY = 12; // the positions sampled are after the book (the opponent uses its book before this)
const CLASSES = { inaccuracy: 0.05, mistake: 0.1, blunder: 0.2 }; // loss of win chance, as the move classes of the engine
const PHASES = ['opening', 'middlegame', 'endgame'];
const DECIDED = 1000; // positions where the best move scores more than this are dropped: nothing is left to lose

// ---- arguments ----

export function parseArgs(argv) {
    const o = {
        scan: 200000,
        perLevel: 200,
        moves: 2,
        nodes: 50000,
        evals: 14,
        minutes: 35,
        workers: 4,
        minPositions: 60,
        seed: 1,
        evalPositions: 240,
        dry: false,
    };
    const files = [];
    const positive = new Set(['scan', 'perLevel', 'nodes']); // a count of games, games or nodes: zero would measure nothing
    const names = {
        '--scan': 'scan',
        '--per-level': 'perLevel',
        '--moves': 'moves',
        '--nodes': 'nodes',
        '--evals': 'evals',
        '--minutes': 'minutes',
        '--workers': 'workers',
        '--min-positions': 'minPositions',
        '--seed': 'seed',
        '--eval-positions': 'evalPositions',
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--dry') o.dry = true;
        else if (a === '--report' || a === '--levels' || a === '--out') {
            const v = argv[++i];
            if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a file name`);
            o[a.slice(2)] = v;
        } else if (names[a]) {
            const v = argv[++i];
            const n = v === undefined || v.trim() === '' ? NaN : Number(v);
            if (!Number.isFinite(n) || n < 0) throw new Error(`${a} needs a non-negative number, got ${v === undefined ? 'nothing' : JSON.stringify(v)}`);
            if (n === 0 && positive.has(names[a])) throw new Error(`${a} needs a number above zero, got 0`);
            o[names[a]] = n;
        } else if (a.startsWith('--')) throw new Error(`unknown option ${a}`);
        else files.push(a);
    }
    if (files.length > 1) throw new Error(`one games file is read, got ${files.length}: ${files.map((f) => JSON.stringify(f)).join(', ')}`);
    o.file = files[0];
    return o;
}

// ---- reading games ----

const MAX_SKIPPABLE = 256 * 1024 * 1024; // the largest skippable frame payload (or frame size it announces) accepted
const MAX_FRAME = MAX_SKIPPABLE;
const SKIPPABLE = (magic) => magic >= 0x184d2a50 && magic <= 0x184d2a5f;

// bytes of the file read in full
function readAt(fd, length, position) {
    const buf = Buffer.alloc(length);
    let got = 0;
    while (got < length) {
        const n = fs.readSync(fd, buf, got, length - got, position + got);
        if (n <= 0) break;
        got += n;
    }
    return buf.subarray(0, got);
}

// Node's zstd stream stops at a skippable frame, and pzstd (which Lichess uses) writes one before every frame, holding the
// size of the frame that follows: [skippable: size][frame][skippable: size][frame] … So each frame is read and decoded on
// its own; a file that is not laid out like this is decoded as one stream from where the framing ends.
async function* zstdChunks(file) {
    const fd = fs.openSync(file, 'r');
    const total = fs.fstatSync(fd).size;
    const inflate = (buf) => new Promise((resolve, reject) => zlib.zstdDecompress(buf, (e, out) => (e ? reject(e) : resolve(out))));
    try {
        let pos = 0;
        while (pos + 8 <= total) {
            const head = readAt(fd, 8, pos);
            if (!SKIPPABLE(head.readUInt32LE(0))) break;
            const payload = head.readUInt32LE(4);
            if (payload > MAX_SKIPPABLE)
                throw new Error(
                    `${file}: a skippable frame of ${payload} bytes at offset ${pos} (more than ${MAX_SKIPPABLE}): not a file this reader understands`,
                );
            const frame = payload === 4 ? readAt(fd, 4, pos + 8).readUInt32LE(0) : 0;
            if (frame > MAX_FRAME) throw new Error(`${file}: a frame of ${frame} bytes at offset ${pos} (more than ${MAX_FRAME})`);
            pos += 8 + payload;
            if (frame) {
                yield await inflate(readAt(fd, frame, pos));
                pos += frame;
            }
        }
        if (pos < total) {
            const src = fs.createReadStream(file, { start: pos });
            const dec = zlib.createZstdDecompress();
            src.on('error', (e) => dec.destroy(e));
            src.pipe(dec);
            try {
                yield* dec;
            } finally {
                src.destroy();
                dec.destroy();
            }
        }
    } finally {
        fs.closeSync(fd);
    }
}

// text chunks of the file: plain, or decompressed by zlib's zstd, or by the zstd command
async function* chunks(file) {
    const decoder = new StringDecoder('utf8');
    let stream;
    let child = null;
    if (!file.endsWith('.zst')) stream = fs.createReadStream(file);
    else if (typeof zlib.createZstdDecompress === 'function') stream = zstdChunks(file);
    else {
        child = spawn('zstd', ['-dc', file], { stdio: ['ignore', 'pipe', 'inherit'] });
        stream = child.stdout;
    }
    try {
        for await (const c of stream) yield decoder.write(c);
        yield decoder.end();
    } finally {
        if (child) child.kill();
    }
}

// the games of the file, one record each: {headers, sans}
async function* games(file) {
    let rest = '';
    for await (const text of chunks(file)) {
        rest += text;
        const parts = rest.split(/\n\n(?=\[Event )/);
        rest = parts.pop();
        for (const p of parts) {
            const g = parseGame(p);
            if (g) yield g;
        }
    }
    const g = rest.trim() ? parseGame(rest) : null;
    if (g) yield g;
}

function parseGame(text) {
    const headers = {};
    let end = 0;
    for (const m of text.matchAll(/^\[(\w+) "([^"]*)"\]\s*$/gm)) {
        headers[m[1]] = m[2];
        end = m.index + m[0].length;
    }
    const sans = [];
    for (const raw of text
        .slice(end)
        .replace(/\{[^}]*\}/g, ' ')
        .split(/\s+/)) {
        const t = raw.replace(/^\d+\.+/, '');
        if (!t || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) continue;
        sans.push(t);
    }
    return { headers, sans };
}

// a rated game worth sampling: not bullet, with both ratings, a result, and enough moves
function usable({ headers: h, sans }) {
    if (/bullet/i.test(h.Event ?? '') || !/^(1-0|0-1|1\/2-1\/2)$/.test(h.Result ?? '')) return false;
    const tc = /^(\d+)\+(\d+)$/.exec(h.TimeControl ?? '');
    if (!tc || Number(tc[1]) < 180) return false;
    return sans.length >= 24 && /^\d+$/.test(h.WhiteElo ?? '') && /^\d+$/.test(h.BlackElo ?? '');
}

const bucketOf = (rating) => ANCHORS.find((a) => Math.abs(rating - a) <= BAND) ?? null;

// ---- positions ----

function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// opening before ply 20; endgame when the pieces left (both sides) are worth at most 20 (knight 3, rook 5, queen 9)
function phaseOf(pos) {
    if (pos.ply < 20) return 'opening';
    const c = pos.counts;
    const material = 3 * (c[2] + c[3] + c[10] + c[11]) + 5 * (c[4] + c[12]) + 9 * (c[5] + c[13]);
    return material <= 20 ? 'endgame' : 'middlegame';
}

// the positions in which the player (a colour) moved from ply MIN_PLY on: {fen, uci, ply, phase}; null if the game does not replay
function playerPositions(sans, color) {
    const pos = Position.fromFen(Position.START_FEN);
    const out = [];
    const buf = new Int32Array(256);
    for (let i = 0; i < sans.length; i++) {
        let m;
        try {
            m = parseMove(pos, sans[i]);
        } catch {
            return null;
        }
        if (m === NO_MOVE) return null;
        if (pos.side === color && i >= MIN_PLY && generateMoves(pos, buf) > 1) out.push({ fen: pos.fen(), uci: moveToUci(m), ply: i, phase: phaseOf(pos) });
        pos.make(m);
    }
    return out;
}

// scan the file: per anchor, the positions of up to perLevel games
async function sample(opts) {
    const rand = rng(opts.seed);
    const buckets = new Map(ANCHORS.map((a) => [a, { elo: a, games: 0, positions: [] }]));
    let scanned = 0;
    let kept = 0;
    for await (const g of games(opts.file)) {
        if (++scanned > opts.scan) break;
        if (!usable(g)) continue;
        kept++;
        for (const [color, tag] of [
            [0, 'WhiteElo'],
            [1, 'BlackElo'],
        ]) {
            const b = buckets.get(bucketOf(Number(g.headers[tag])));
            if (!b || b.games >= opts.perLevel) continue;
            const all = playerPositions(g.sans, color);
            if (!all || !all.length) continue;
            b.games++;
            for (let k = 0; k < opts.moves && all.length; k++) b.positions.push(all.splice(Math.floor(rand() * all.length), 1)[0]);
        }
        if ([...buckets.values()].every((b) => b.games >= opts.perLevel)) break;
    }
    return { scanned: Math.min(scanned, opts.scan), usable: kept, buckets: [...buckets.values()] };
}

// ---- measuring loss ----

class Analyzer {
    constructor(nodes) {
        this.nodes = nodes;
        this.searcher = new Searcher({ hashMb: 32 });
        this.bests = new Map();
        this.afters = new Map();
    }

    search(fen) {
        this.searcher.clear();
        return this.searcher.search(Position.fromFen(fen), { nodes: this.nodes });
    }

    // the best move of a position and its score for the side to move
    best(fen) {
        let b = this.bests.get(fen);
        if (!b) {
            const r = this.search(fen);
            b = { score: r.score, uci: moveToUci(r.best) };
            this.bests.set(fen, b);
        }
        return b;
    }

    // the score for the side that made the move
    after(fen, uci) {
        const key = `${fen} ${uci}`;
        let s = this.afters.get(key);
        if (s === undefined) {
            const pos = Position.fromFen(fen);
            pos.make(parseMove(pos, uci));
            s = -this.search(pos.fen()).score;
            this.afters.set(key, s);
        }
        return s;
    }

    /** The win chance the move gives up (0..1). */
    loss(fen, uci) {
        const b = this.best(fen);
        if (uci === b.uci) return 0;
        return Math.max(0, winChance(b.score) - winChance(this.after(fen, uci)));
    }
}

// statistics of a list of {loss, phase}
function stats(rows) {
    const part = (list) => {
        const n = list.length;
        const share = (f) => (n ? list.filter(f).length / n : 0);
        return {
            n,
            mean: n ? list.reduce((s, r) => s + r.loss, 0) / n : 0,
            inaccuracy: share((r) => r.loss >= CLASSES.inaccuracy),
            mistake: share((r) => r.loss >= CLASSES.mistake),
            blunder: share((r) => r.loss > CLASSES.blunder),
        };
    };
    const out = part(rows);
    out.phases = Object.fromEntries(PHASES.map((p) => [p, part(rows.filter((r) => r.phase === p))]));
    return out;
}

// how far the bot's statistics are from the people's (relative, so that small rates count as much as large ones)
function distance(bot, human) {
    let d = 0;
    for (const k of ['mean', 'inaccuracy', 'mistake', 'blunder']) d += ((bot[k] - human[k]) / (human[k] + 0.02)) ** 2;
    return d;
}

// ---- fitting one bucket (runs on a worker thread) ----

const clampTo = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function fitBucket({ elo, positions, opts, deadline }) {
    const log = (...a) => console.log(`[${elo}]`, ...a);
    const analyzer = new Analyzer(opts.nodes);
    const t0 = Date.now();
    // the people's moves; decided positions are dropped
    const kept = [];
    const human = [];
    for (const p of positions) {
        if (Math.abs(analyzer.best(p.fen).score) > DECIDED) continue;
        kept.push(p);
        human.push({ loss: analyzer.loss(p.fen, p.uci), phase: p.phase });
    }
    const humanStats = stats(human);
    // the objective compares the bot with the people on the very positions the bot plays
    const subset = kept.slice(0, opts.evalPositions);
    const humanSubset = stats(human.slice(0, subset.length));
    log(
        `human: ${kept.length}/${positions.length} positions, mean ${(humanStats.mean * 100).toFixed(1)} %, blunders ${(humanStats.blunder * 100).toFixed(1)} %  (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
    );
    const result = { elo, positions: kept.length, human: humanStats, fitted: null, bot: null, evals: 0, partial: false, distance: null, baseline: null };
    if (kept.length < opts.minPositions) {
        result.skipped = `only ${kept.length} positions`;
        return result;
    }

    const anchor = HAND_SET.find((l) => l.elo === elo);
    const play = (params, list) =>
        list.map((p, i) => {
            const bot = createOpponent({ elo, seed: opts.seed * 1000 + i + 1, level: params });
            const r = bot.move(p.fen);
            return { loss: r.kind === 'move' ? analyzer.loss(p.fen, r.uci) : 0, phase: p.phase };
        });
    const evaluate = (x) => {
        result.evals++;
        return distance(stats(play(toLevel(x), subset)), humanSubset);
    };
    // every other parameter (candidates, blind spots) is the hand-set anchor's, whatever levels.js holds now
    const toLevel = (x) => ({
        ...anchor,
        nodes: Math.round(2 ** x.nodes),
        temperature: Math.exp(x.temperature),
        blind: { ...anchor.blind },
        blunder: { ...anchor.blunder, base: x.base },
    });

    let x = { nodes: Math.log2(anchor.nodes), temperature: Math.log(anchor.temperature), base: anchor.blunder.base };
    let best = evaluate(x);
    result.baseline = best;
    log(`anchor: distance ${best.toFixed(3)}`);
    const steps = { nodes: 1.2, temperature: 0.5, base: 0.05 };
    const bounds = { nodes: [Math.log2(60), Math.log2(400000)], temperature: [Math.log(2), Math.log(800)], base: [0, 0.6] };
    search: for (let round = 0; round < 6; round++) {
        let improved = false;
        for (const key of Object.keys(steps)) {
            for (const dir of [1, -1]) {
                if (result.evals >= opts.evals || Date.now() > deadline) {
                    result.partial = result.evals < opts.evals;
                    break search;
                }
                const trial = { ...x, [key]: clampTo(x[key] + dir * steps[key], ...bounds[key]) };
                if (trial[key] === x[key]) continue;
                const d = evaluate(trial);
                if (d < best) {
                    best = d;
                    x = trial;
                    improved = true;
                    log(`eval ${result.evals}: ${key} ${dir > 0 ? '+' : '-'} -> distance ${d.toFixed(3)} (${JSON.stringify(toLevel(x))})`);
                    break; // keep moving in the direction found
                }
            }
        }
        if (!improved) for (const k of Object.keys(steps)) steps[k] /= 2;
    }
    result.fitted = toLevel(x);
    result.distance = best;
    result.bot = stats(play(result.fitted, kept)); // the fitted bot on all positions, for the report (the people's statistics are on the same ones)
    result.used = kept.map((p) => ({ fen: p.fen, uci: p.uci, phase: p.phase }));
    log(`fitted ${JSON.stringify(result.fitted)} distance ${best.toFixed(3)} after ${result.evals} evals (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    return result;
}

// ---- making the ladder ----

// weighted isotonic regression (pool adjacent violators): the closest non-decreasing sequence
function isotonic(values, weights) {
    const blocks = [];
    values.forEach((v, i) => {
        blocks.push({ sum: v * weights[i], w: weights[i], n: 1 });
        while (blocks.length > 1 && blocks[blocks.length - 2].sum / blocks[blocks.length - 2].w > blocks[blocks.length - 1].sum / blocks[blocks.length - 1].w) {
            const b = blocks.pop();
            const a = blocks.pop();
            blocks.push({ sum: a.sum + b.sum, w: a.w + b.w, n: a.n + b.n });
        }
    });
    return blocks.flatMap((b) => Array(b.n).fill(b.sum / b.w));
}

const sig = (n) => {
    const digits = 2 - Math.ceil(Math.log10(n));
    return Math.round(n * 10 ** digits) / 10 ** digits;
};
const STEP = { nodes: 1.4, temperature: 0.85, base: 0.01 }; // the least a stronger anchor differs from the one below
const MAX_NODES = 100000;

// the anchors with the fitted values in (the hand-set ones where the games say nothing), ordered along the ladder by parameters
function ladder(results) {
    const by = new Map(results.map((r) => [r.elo, r]));
    const fit = HAND_SET.map((l) => by.get(l.elo)?.fitted ?? null);
    const weight = HAND_SET.map((l, i) => (fit[i] ? by.get(l.elo).positions : 1));
    const nodes = isotonic(
        HAND_SET.map((l, i) => Math.log2(fit[i]?.nodes ?? l.nodes)),
        weight,
    );
    const temp = isotonic(
        HAND_SET.map((l, i) => -Math.log(fit[i]?.temperature ?? l.temperature)),
        weight,
    );
    const base = isotonic(
        HAND_SET.map((l, i) => -(fit[i]?.blunder.base ?? l.blunder.base)),
        weight,
    );
    return HAND_SET.map((l, i) => ({
        ...l,
        nodes: Math.max(1, Math.round(sig(2 ** nodes[i]))),
        temperature: Math.round(Math.exp(-temp[i]) * 10) / 10,
        blind: { ...l.blind },
        blunder: { ...l.blunder, base: Math.round(-base[i] * 1000) / 1000 },
    }));
}

// Pooling makes parameters equal where the data cannot tell two anchors apart, and equal parameters are equal strength:
// the test of a ladder is the outcome. So every anchor is made to differ from the one below by at least a step ...
function separate(list) {
    const out = list.map((l) => ({ ...l, blind: { ...l.blind }, blunder: { ...l.blunder } }));
    for (let i = 1; i < out.length; i++) {
        const [a, b] = [out[i - 1], out[i]];
        b.nodes = Math.min(MAX_NODES, Math.max(b.nodes, sig(Math.round(a.nodes * STEP.nodes))));
        b.temperature = Math.min(b.temperature, Math.round(a.temperature * STEP.temperature * 10) / 10);
        b.blunder.base = Math.min(b.blunder.base, Math.max(0, Math.round((a.blunder.base - STEP.base) * 1000) / 1000));
    }
    return out;
}

// ... and then measured: every anchor plays the same positions, and one that loses more win chance per move, or blunders
// more often, than the anchor below is made stronger (and the steps restored) until the ladder falls along the anchors.
export function verify(list, pool, analyzer, opts) {
    const measure = (levels) =>
        levels.map((l) =>
            stats(
                pool.map((p, i) => {
                    const r = createOpponent({ elo: l.elo, seed: opts.seed * 7 + i + 1, level: l }).move(p.fen);
                    return { loss: r.kind === 'move' ? analyzer.loss(p.fen, r.uci) : 0, phase: p.phase };
                }),
            ),
        );
    let levels = separate(list);
    let measured = measure(levels);
    let rounds = 0;
    for (; rounds < 5; rounds++) {
        const bad = measured.map((m, i) => i > 0 && (m.mean > measured[i - 1].mean || m.blunder > measured[i - 1].blunder));
        if (!bad.some(Boolean)) break;
        levels = separate(
            levels.map((l, i) =>
                bad[i]
                    ? {
                          ...l,
                          nodes: Math.min(MAX_NODES, sig(Math.round(l.nodes * STEP.nodes))),
                          temperature: Math.round(l.temperature * STEP.temperature * 10) / 10,
                          blunder: { ...l.blunder, base: Math.round(l.blunder.base * 0.7 * 1000) / 1000 },
                      }
                    : l,
            ),
        );
        measured = measure(levels);
    }
    // five rounds may not be enough: say so, and the report says it too
    const monotone = !measured.some((m, i) => i > 0 && (m.mean > measured[i - 1].mean || m.blunder > measured[i - 1].blunder));
    if (!monotone) {
        const worse = measured.map((m, i) => i > 0 && (m.mean > measured[i - 1].mean || m.blunder > measured[i - 1].blunder) && levels[i].elo).filter(Boolean);
        console.warn(
            `warning: the ladder is still not monotone after ${rounds} strengthening rounds (anchors that lose more than the one below: ${worse.join(', ')}); the levels are written as they are`,
        );
    }
    return { levels, measured, rounds, monotone };
}

// the generated block of levels.js
function levelsBlock(list) {
    const rows = list.map(
        (l) =>
            `    ${JSON.stringify(l)
                .replace(/"(\w+)":/g, '$1: ')
                .replace(/,/g, ', ')
                .replace(/: {/g, ': { ')
                .replace(/}/g, ' }')},`,
    );
    return `// <generated>\nexport const LEVELS = [\n${rows.join('\n')}\n];\n// </generated>`;
}

function writeLevels(file, list) {
    const text = fs.readFileSync(file, 'utf8');
    const next = text.replace(/\/\/ <generated>[\s\S]*?\/\/ <\/generated>/, () => levelsBlock(list));
    if (next === text) return false;
    fs.writeFileSync(file, next);
    spawnSync('npx', ['prettier', '--write', file], { cwd: ROOT, shell: true, stdio: 'ignore' });
    return true;
}

// ---- the report ----

const pct = (x, d = 1) => `${(x * 100).toFixed(d)}`;
const BEGIN = '<!-- play-calibration:begin -->';
const END = '<!-- play-calibration:end -->';

function reportSection(info, results, final, opts, pooled, verified) {
    const lines = [];
    lines.push(BEGIN, '', '## Human-like opponent calibration', '');
    lines.push(
        `Run on ${new Date().toISOString().slice(0, 10)} from \`${path.basename(opts.file)}\` (Lichess standard rated games, January 2014): ${info.scanned} games scanned, ${info.usable} usable (rated, not bullet, both ratings, at least 24 plies).`,
        `Players were bucketed to the nearest anchor within ±${BAND} rating points; up to ${opts.perLevel} games and ${opts.moves} positions per game and bucket (the player to move, ply ${MIN_PLY} or later, best move within ±${DECIDED} cp).`,
        `The engine measured every move at ${opts.nodes.toLocaleString('en')} nodes; the loss is the win chance of the best move minus that of the move played (blunder: more than 20 %, mistake: 10 % or more, inaccuracy: 5 % or more).`,
        `The fit started from the hand-set anchors (HAND_SET in levels.js) and moved \`nodes\`, \`temperature\` and \`blunder.base\` of each level by a coordinate search (at most ${opts.evals} bot evaluations per level, the bot playing the sampled positions); the blind spots stay as set.`,
        '',
    );
    lines.push(
        '| Anchor | Games | Positions | People: mean loss % | ≥ 5 % | ≥ 10 % | > 20 % | Bot: mean loss % | ≥ 5 % | ≥ 10 % | > 20 % | Evals | Result |',
        '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const b of info.buckets) {
        const r = results.find((x) => x.elo === b.elo);
        if (!r || !r.human.n) {
            lines.push(`| ${b.elo} | ${b.games} | 0 | — | — | — | — | — | — | — | — | 0 | no data: hand-set anchor kept |`);
            continue;
        }
        const h = r.human;
        const bt = r.bot;
        const note = r.skipped ? `${r.skipped}: hand-set anchor kept` : r.partial ? 'partial fit' : 'fitted';
        lines.push(
            `| ${b.elo} | ${b.games} | ${r.positions} | ${pct(h.mean)} | ${pct(h.inaccuracy)} | ${pct(h.mistake)} | ${pct(h.blunder)} | ${bt ? pct(bt.mean) : '—'} | ${bt ? pct(bt.inaccuracy) : '—'} | ${bt ? pct(bt.mistake) : '—'} | ${bt ? pct(bt.blunder) : '—'} | ${r.evals} | ${note} |`,
        );
    }
    lines.push('', 'Blunder and mistake rates by phase (people → bot, %; positions in brackets):', '');
    lines.push(
        '| Anchor | Opening mistake | Opening blunder | Middlegame mistake | Middlegame blunder | Endgame mistake | Endgame blunder |',
        '|---|---|---|---|---|---|---|',
    );
    for (const r of results) {
        if (!r.human.n) continue;
        const cell = (p, k) => `${pct(r.human.phases[p][k])} → ${r.bot ? pct(r.bot.phases[p][k]) : '—'} (${r.human.phases[p].n})`;
        lines.push(`| ${r.elo} | ${PHASES.map((p) => `${cell(p, 'mistake')} | ${cell(p, 'blunder')}`).join(' | ')} |`);
    }
    lines.push(
        '',
        'The ladder written to `src/play/levels.js` (monotone along the anchors):',
        '',
        '| Anchor | Nodes | Temperature | Candidates | Blind: backward / diagonal / quiet / threat depth | Blunder: base / complexity |',
        '|---|---|---|---|---|---|',
    );
    for (const l of final) {
        lines.push(
            `| ${l.elo} | ${l.nodes.toLocaleString('en')} | ${l.temperature} | ${l.multipv} | ${l.blind.backward} / ${l.blind.longDiagonal} / ${l.blind.quietWin} / ${l.blind.threatDepth} | ${l.blunder.base} / ${l.blunder.complexity} |`,
        );
    }
    // what the monotone pass and the steps changed
    const changed = [];
    for (const r of results) {
        if (!r.fitted) continue;
        const p = pooled.find((l) => l.elo === r.elo);
        const f = final.find((l) => l.elo === r.elo);
        const diffs = [];
        if (p.nodes !== sig(r.fitted.nodes)) diffs.push(`nodes ${sig(r.fitted.nodes)} -> ${p.nodes}`);
        if (Math.abs(p.temperature - r.fitted.temperature) > 0.5) diffs.push(`temperature ${Math.round(r.fitted.temperature * 10) / 10} -> ${p.temperature}`);
        if (Math.abs(p.blunder.base - r.fitted.blunder.base) > 0.001)
            diffs.push(`blunder.base ${Math.round(r.fitted.blunder.base * 1000) / 1000} -> ${p.blunder.base}`);
        if (diffs.length) changed.push(`- ${r.elo}: pooled with its neighbours by the monotone pass (${diffs.join(', ')}).`);
        if (f.nodes !== p.nodes || f.temperature !== p.temperature || f.blunder.base !== p.blunder.base) {
            changed.push(
                `- ${r.elo}: moved by the separation steps and the check below (nodes ${p.nodes} -> ${f.nodes}, temperature ${p.temperature} -> ${f.temperature}, blunder.base ${p.blunder.base} -> ${f.blunder.base}).`,
            );
        }
    }
    for (const l of final)
        if (!results.find((r) => r.elo === l.elo)?.fitted)
            changed.push(`- ${l.elo}: no usable games, so the hand-set anchor is kept (separation steps may apply).`);
    lines.push(
        '',
        'Plateaus and pooled anchors: the fits of neighbouring anchors cannot be told apart by the games (about 3 % loss per move at 1600-2400), so the monotone pass pools them. Equal parameters would mean equal strength, so every anchor is then made to differ from the one below by at least a factor 1.4 in nodes, 0.85 in temperature and 0.01 in blunder.base, and the ladder is measured:',
        '',
        ...changed,
    );
    if (verified) {
        if (!verified.monotone)
            lines.push('', '**Warning: the measured ladder was still not monotone after the strengthening rounds; re-run with more games or nodes.**');
        lines.push(
            '',
            `The ladder measured on ${verified.positions} shared positions (the same moves for every anchor, ${opts.nodes.toLocaleString('en')}-node judge; ${verified.rounds} strengthening rounds were needed):`,
            '',
            '| Anchor | Mean loss % | ≥ 5 % | ≥ 10 % | > 20 % |',
            '|---|---|---|---|---|',
        );
        final.forEach((l, i) =>
            lines.push(
                `| ${l.elo} | ${pct(verified.measured[i].mean)} | ${pct(verified.measured[i].inaccuracy)} | ${pct(verified.measured[i].mistake)} | ${pct(verified.measured[i].blunder)} |`,
            ),
        );
    }
    lines.push(
        '',
        'To reproduce: `node scripts/calibrate.mjs <pgn.zst> --per-level 200 --moves 2 --nodes 50000` (add `--dry` to leave the files alone).',
        '',
        END,
    );
    return lines.join('\n');
}

function writeReport(file, section) {
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Benchmark report\n';
    const re = new RegExp(`${BEGIN}[\\s\\S]*?${END}`);
    const next = re.test(text) ? text.replace(re, () => section) : `${text.replace(/\s*$/, '')}\n\n${section}\n`;
    fs.writeFileSync(file, next);
}

// ---- main ----

async function main() {
    let opts;
    try {
        opts = parseArgs(process.argv.slice(2));
    } catch (e) {
        console.error(e.message);
        process.exit(2);
    }
    if (!opts.file || !fs.existsSync(opts.file)) {
        console.error('usage: node scripts/calibrate.mjs <games.pgn | games.pgn.zst> [options]');
        process.exit(2);
    }
    const started = Date.now();
    const deadline = started + opts.minutes * 60000;
    console.log(`reading ${opts.file}`);
    const info = await sample(opts);
    console.log(
        `scanned ${info.scanned} games, ${info.usable} usable; per anchor: ${info.buckets.map((b) => `${b.elo}: ${b.games} games, ${b.positions.length} positions`).join('; ')}`,
    );

    // buckets with enough positions run on worker threads
    const todo = info.buckets.filter((b) => b.positions.length >= opts.minPositions);
    const results = [];
    const workers = Math.max(1, Math.min(opts.workers, todo.length, os.cpus().length));
    await new Promise((resolve, reject) => {
        let next = 0;
        let running = 0;
        const launch = () => {
            while (running < workers && next < todo.length) {
                const b = todo[next++];
                running++;
                const w = new Worker(fileURLToPath(import.meta.url), { workerData: { elo: b.elo, positions: b.positions, opts, deadline } });
                w.on('message', (r) => results.push(r));
                w.on('error', reject);
                w.on('exit', () => {
                    running--;
                    if (next >= todo.length && running === 0) resolve();
                    else launch();
                });
            }
            if (todo.length === 0) resolve();
        };
        launch();
    });
    results.sort((a, b) => a.elo - b.elo);
    for (const b of info.buckets)
        if (!results.some((r) => r.elo === b.elo))
            results.push({ elo: b.elo, positions: 0, human: stats([]), fitted: null, bot: null, evals: 0, skipped: 'no data' });
    results.sort((a, b) => a.elo - b.elo);

    const pooled = ladder(results);
    // the same positions for every anchor: those the fits used, at most evalPositions of them, spread over the buckets
    const used = results.filter((r) => r.fitted).flatMap((r) => r.used ?? []);
    for (const r of results) delete r.used;
    let final;
    let verified = null;
    if (used.length >= opts.minPositions && Date.now() < deadline) {
        const step = Math.max(1, Math.ceil(used.length / opts.evalPositions));
        const pool = used.filter((_, i) => i % step === 0);
        verified = verify(pooled, pool, new Analyzer(opts.nodes), opts);
        verified.positions = pool.length;
        final = verified.levels;
        console.log(`ladder verified on ${pool.length} positions after ${verified.rounds} strengthening rounds`);
    } else final = separate(pooled);
    const out = opts.out ?? path.join(path.dirname(opts.file), 'calibration.json');
    fs.writeFileSync(
        out,
        JSON.stringify(
            {
                date: new Date().toISOString(),
                opts,
                info: { ...info, buckets: info.buckets.map((b) => ({ elo: b.elo, games: b.games, positions: b.positions.length })) },
                results,
                final,
            },
            null,
            2,
        ),
    );
    console.log(`results saved to ${out}`);
    const section = reportSection(info, results, final, opts, pooled, verified);
    if (opts.dry) console.log(section, '\n', levelsBlock(final));
    else {
        const levelsFile = opts.levels ?? path.join(ROOT, 'src/play/levels.js');
        console.log(writeLevels(levelsFile, final) ? `wrote ${levelsFile}` : 'levels.js unchanged');
        const reportFile = opts.report ?? path.join(ROOT, 'bench/REPORT.md');
        writeReport(reportFile, section);
        console.log(`wrote ${reportFile}`);
    }
    console.log(`done in ${((Date.now() - started) / 60000).toFixed(1)} min${results.some((r) => r.partial) ? ' (some fits are partial)' : ''}`);
}

// is this file the one node was started with? The real paths are compared (a symlink, or a drive letter or folder in another case
// on Windows, still counts); where a path cannot be resolved the script is taken to be the entry point only if nothing else says so
function isEntryPoint() {
    if (!process.argv[1]) return false;
    try {
        return fs.realpathSync.native(path.resolve(process.argv[1])) === fs.realpathSync.native(fileURLToPath(import.meta.url));
    } catch {
        return path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
    }
}

if (isMainThread) {
    // run as a script (not when a test imports parseArgs and verify)
    if (isEntryPoint()) {
        main().catch((e) => {
            console.error(e);
            process.exit(1);
        });
    }
} else {
    parentPort.postMessage(fitBucket(workerData));
}
