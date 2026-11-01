// scripts/datagen — self-play data for the tuner: quiet positions with the result of the game they came from.
//
//   node scripts/datagen.mjs --games 40000 --nodes 5000 --threads 14 --out ../stepchess-data/datagen/
//   node scripts/datagen.mjs --positions 2000000 --max-minutes 90 --threads 8 --out ../stepchess-data/datagen/
//
// --games N        games to play (default 10000); --positions M stops once that many positions are written (whichever comes first);
//                  --max-minutes T stops after T minutes (games under way finish)
// --nodes N        nodes per move for both sides (default 5000)
// --threads T      worker threads, each with its own searcher and its own shard file (default 14)
// --out DIR        where the shards go (default ../stepchess-data/datagen/); a run adds files `run<yyyymmddhhmmss>-s<seed>-<thread>.txt`
// --seed S         the random seed of the run (default: the clock)
// --hash MB        transposition table per thread (default 8)
//
// A game opens with a few book moves (picked by how many named lines go on with each), then two to four random moves; a quick
// search must find the position within 250 cp, else the opening is drawn again. The game is then played at fixed nodes and
// ends by the rules, or is adjudicated: a mate score, five plies of 15 pawns or more for one side, or a long dead-level
// stretch. A position is kept when its ply (from the start of the game) is above 8, the side to move is not in check, the
// best move is not a capture, an en passant, a promotion, and the score is not a mate. A line:
//
//     <fen> ; <score in cp for White> ; <result for White: 1, 0.5 or 0>
//
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Position, legalMoves, moveFlags, movePromo, F_CAPTURE, F_EP } from '../src/index.js';
import { bookMoves } from '../src/endgame/index.js';
import { Searcher, isMateScore } from '../src/search/index.js';
import { parseArgs, num, str } from '../bench/lib/args.mjs';

const MIN_PLY = 8; // positions are kept above this ply
const MAX_PLIES = 400;
const SANE = 250; // an opening must score within this many cp after the random moves
const WIN_CP = 1500;
const WIN_PLIES = 5;
const DRAW_CP = 10;
const DRAW_PLIES = 12;
const DRAW_FROM = 100;

// stats: [gamesStarted, gamesDone, positions, stop, whiteWins, draws, blackWins]
const STARTED = 0;
const DONE = 1;
const POSITIONS = 2;
const STOP = 3;
const RESULT = 4; // + 0 white wins, 1 draws, 2 black wins

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

// the start of a game: book moves, then random ones, until a quick search finds the position balanced enough
function opening(rand, searcher) {
    for (;;) {
        const pos = Position.fromFen(Position.START_FEN);
        const bookPlies = 4 + Math.floor(rand() * 5); // 4 … 8
        for (let i = 0; i < bookPlies; i++) {
            const book = bookMoves(pos);
            if (!book.length) break;
            const total = book.reduce((s, b) => s + b.weight, 0);
            let pick = rand() * total;
            let chosen = book[0].move;
            for (const b of book) {
                pick -= b.weight;
                if (pick <= 0) {
                    chosen = b.move;
                    break;
                }
            }
            pos.make(chosen);
        }
        const randomPlies = 2 + Math.floor(rand() * 3); // 2 … 4
        let ok = true;
        for (let i = 0; i < randomPlies; i++) {
            const moves = legalMoves(pos);
            if (!moves.length) {
                ok = false;
                break;
            }
            pos.make(moves[Math.floor(rand() * moves.length)]);
        }
        if (!ok || !legalMoves(pos).length) continue;
        searcher.clear();
        const r = searcher.search(pos, { nodes: 3000 });
        if (Math.abs(r.score) <= SANE) return pos;
    }
}

// one game: returns {result for White, lines: [fen ; score ; …] without the result yet}
function playGame(rand, searcher, nodes) {
    const pos = opening(rand, searcher);
    searcher.clear();
    const kept = []; // [fen, score for White]
    const whiteScores = [];
    let result;
    for (;;) {
        const moves = legalMoves(pos);
        if (!moves.length) {
            result = pos.inCheck() ? (pos.side === 0 ? 0 : 1) : 0.5;
            break;
        }
        if (pos.halfmove >= 100 || pos.repetitionCount() >= 3 || pos.isInsufficientMaterial() || pos.ply >= MAX_PLIES) {
            result = 0.5;
            break;
        }
        const tail = whiteScores.slice(-WIN_PLIES);
        if (tail.length === WIN_PLIES && tail.every((s) => s >= WIN_CP)) {
            result = 1;
            break;
        }
        if (tail.length === WIN_PLIES && tail.every((s) => s <= -WIN_CP)) {
            result = 0;
            break;
        }
        if (pos.ply >= DRAW_FROM && whiteScores.length >= DRAW_PLIES && whiteScores.slice(-DRAW_PLIES).every((s) => Math.abs(s) <= DRAW_CP)) {
            result = 0.5;
            break;
        }
        const check = pos.inCheck();
        const fen = pos.fen();
        const r = searcher.search(pos, { nodes });
        const white = pos.side === 0 ? r.score : -r.score;
        if (isMateScore(r.score)) {
            result = r.score > 0 ? (pos.side === 0 ? 1 : 0) : pos.side === 0 ? 0 : 1;
            break;
        }
        const flags = moveFlags(r.best);
        const quiet = !check && !(flags & (F_CAPTURE | F_EP)) && !movePromo(r.best);
        if (pos.ply > MIN_PLY && quiet) kept.push(`${fen} ; ${white}`);
        whiteScores.push(white);
        pos.make(r.best);
    }
    return { result, kept };
}

function worker() {
    const { stats: sab, thread, seed, games, positions, nodes, hash, file } = workerData;
    const stats = new Int32Array(sab);
    const rand = rng(seed * 1000003 + thread * 7919 + 17);
    const searcher = new Searcher({ hashMb: hash });
    while (!Atomics.load(stats, STOP)) {
        const n = Atomics.add(stats, STARTED, 1);
        if (n >= games || Atomics.load(stats, POSITIONS) >= positions) break;
        const { result, kept } = playGame(rand, searcher, nodes);
        if (kept.length) fs.appendFileSync(file, kept.map((l) => `${l} ; ${result}\n`).join(''));
        Atomics.add(stats, POSITIONS, kept.length);
        Atomics.add(stats, RESULT + (result === 1 ? 0 : result === 0.5 ? 1 : 2), 1);
        Atomics.add(stats, DONE, 1);
    }
    parentPort.postMessage('done');
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const threads = num(args, 'threads', 14);
    const games = num(args, 'games', 10000);
    const positions = num(args, 'positions', Infinity);
    const nodes = num(args, 'nodes', 5000);
    const hash = num(args, 'hash', 8);
    const maxMinutes = num(args, 'max-minutes', Infinity);
    const seed = num(args, 'seed', Date.now() % 1000003);
    const here = path.dirname(fileURLToPath(import.meta.url));
    const out = path.resolve(str(args, 'out', path.join(here, '..', '..', 'stepchess-data', 'datagen')));
    fs.mkdirSync(out, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const sab = new SharedArrayBuffer(4 * 8);
    const stats = new Int32Array(sab);
    console.log(
        `datagen: up to ${games} games${positions < Infinity ? `, ${positions} positions` : ''}, ${nodes} nodes, ${threads} threads, seed ${seed}, into ${out}`,
    );
    const t0 = Date.now();
    const pool = Array.from({ length: threads }, (_, thread) => {
        const file = path.join(out, `run${stamp}-s${seed}-${String(thread).padStart(2, '0')}.txt`);
        const w = new Worker(fileURLToPath(import.meta.url), { workerData: { stats: sab, thread, seed, games, positions, nodes, hash, file } });
        return new Promise((resolve, reject) => {
            w.on('message', resolve);
            w.on('error', reject);
            w.on('exit', resolve);
        });
    });
    const line = () => {
        const s = Atomics.load.bind(Atomics, stats);
        const sec = (Date.now() - t0) / 1000;
        return `${Math.round(sec)} s: ${s(DONE)} games (W ${s(RESULT)} D ${s(RESULT + 1)} B ${s(RESULT + 2)}), ${s(POSITIONS)} positions, ${(s(POSITIONS) / Math.max(1, sec)).toFixed(0)}/s`;
    };
    const timer = setInterval(() => {
        console.log(line());
        if ((Date.now() - t0) / 60000 >= maxMinutes && !Atomics.load(stats, STOP)) {
            console.log('time is up: stopping');
            Atomics.store(stats, STOP, 1);
        }
    }, 30000);
    await Promise.all(pool);
    clearInterval(timer);
    console.log(`finished — ${line()}`);
}

if (isMainThread) {
    if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((e) => (console.error(e), process.exit(1)));
} else worker();
