// bench/eval-speed — evaluate() calls per second: on the leaves of depth-3 trees (make/unmake cost taken out) and on 50 fixed positions.
//
//   node bench/eval-speed.mjs            the tree leaves of kiwipete and an Italian middlegame, then the 50 positions of the eval test
//   node bench/eval-speed.mjs --runs 5   more runs per measure (the best one counts)
//
// The tree is walked twice, once calling evaluate at every leaf and once without; the difference is the time evaluate
// took, so the cost of making and taking back the moves stays out of the number. The target is 0.8 M calls/s on the leaves; the
// bench only reports (the numbers depend on the machine and its load), so it exits 0 even below the target.
import { Position, generateMoves, legalMoves, evaluate } from '../src/index.js';

const TREES = [
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'],
    ['italian', 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7'],
];
const DEPTH = 3;
const TARGET = 0.8;
const arg = process.argv.indexOf('--runs');
const RUNS = arg > 0 ? Number(process.argv[arg + 1]) : 3;

const buffers = Array.from({ length: DEPTH + 1 }, () => new Int32Array(256));
let sink = 0;
function walk(pos, d, withEval) {
    if (d === 0) {
        if (withEval) sink += evaluate(pos);
        return 1;
    }
    const out = buffers[d];
    const n = generateMoves(pos, out);
    let leaves = 0;
    for (let i = 0; i < n; i++) {
        pos.make(out[i]);
        leaves += walk(pos, d - 1, withEval);
        pos.unmake();
    }
    return leaves;
}
const time = (fn) => {
    const t0 = performance.now();
    fn();
    return performance.now() - t0;
};
const mcps = (calls, ms) => calls / ms / 1000;

let below = 0;
for (const [name, fen] of TREES) {
    const pos = Position.fromFen(fen);
    const leaves = walk(pos, DEPTH, true); // warm up both paths
    walk(pos, DEPTH, false);
    let best = 0;
    for (let r = 0; r < RUNS; r++) {
        const withEval = time(() => walk(pos, DEPTH, true));
        const without = time(() => walk(pos, DEPTH, false));
        best = Math.max(best, mcps(leaves, withEval - without));
    }
    if (best < TARGET) below++;
    console.log(
        `${best >= TARGET ? 'ok   ' : 'below'} ${name.padEnd(9)} d${DEPTH}: ${leaves.toLocaleString('en-US')} leaves, evaluate ${best.toFixed(2)} M calls/s (target ${TARGET})`,
    );
}

// the 50 positions of test/eval.test.cjs: the perft positions and every 7th ply of random games from seed 1
const PERFT = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
];
let x = 1;
const rand = (n) => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
};
const fens = [...PERFT];
while (fens.length < 50) {
    const p = Position.fromFen(Position.START_FEN);
    for (let ply = 1; ply <= 140 && fens.length < 50; ply++) {
        const moves = legalMoves(p);
        if (!moves.length || p.isInsufficientMaterial()) break;
        p.make(moves[rand(moves.length)]);
        if (ply % 7 === 0 && legalMoves(p).length) fens.push(p.fen());
    }
}
const positions = fens.map((f) => Position.fromFen(f));
const LOOPS = 20000;
for (let i = 0; i < 1000; i++) for (const p of positions) sink += evaluate(p);
let best = 0;
for (let r = 0; r < RUNS; r++) {
    const ms = time(() => {
        for (let i = 0; i < LOOPS; i++) for (let k = 0; k < 50; k++) sink += evaluate(positions[k]);
    });
    best = Math.max(best, mcps(LOOPS * 50, ms));
}
console.log(`     50 positions: ${(LOOPS * 50).toLocaleString('en-US')} calls a run, evaluate ${best.toFixed(2)} M calls/s  (checksum ${sink})`);
if (below) console.log(`note: ${below} of ${TREES.length} tree measures are below the target of ${TARGET} M calls/s (report only, the exit code stays 0)`);
