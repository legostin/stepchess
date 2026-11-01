// bench/perft — perft to depth 5 on the six standard positions: the counts must match, and the speed is reported.
//
//   node bench/perft.mjs            depth 5 everywhere (the last ply counted, not made), then a run that makes every leaf
//   node bench/perft.mjs --depth 4  a shallower run
//
// The counts are the published ones (chessprogramming.org, "Perft Results"). Exits with 1 when a count is off.
import { Position, generateMoves, perft } from '../src/index.js';

const POSITIONS = [
    ['start', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281, 4865609]],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862, 4085603, 193690690]],
    ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238, 674624]],
    ['position 4', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467, 422333, 15833292]],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379, 2103487, 89941194]],
    ['position 6', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890, 3894594, 164075551]],
];

const arg = process.argv.indexOf('--depth');
const depth = arg > 0 ? Number(process.argv[arg + 1]) : 5;
const fmt = (n) => n.toLocaleString('en-US');
const mnps = (nodes, ms) => `${(nodes / ms / 1000).toFixed(1)} M nps`;

let bad = 0;
let nodes = 0;
let ms = 0;
for (const [name, fen, counts] of POSITIONS) {
    const pos = Position.fromFen(fen);
    const t0 = performance.now();
    const n = perft(pos, depth);
    const t = performance.now() - t0;
    const ok = n === counts[depth - 1];
    if (!ok) bad++;
    nodes += n;
    ms += t;
    console.log(
        `${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(11)} d${depth} ${fmt(n).padStart(12)} (want ${fmt(counts[depth - 1])})  ${t.toFixed(0).padStart(6)} ms  ${mnps(n, t)}`,
    );
}
console.log(`total: ${fmt(nodes)} nodes in ${ms.toFixed(0)} ms, ${mnps(nodes, ms)} (leaves counted from the generator)`);

// the same tree with every leaf made and taken back: the cost of make/unmake as well
const buffers = Array.from({ length: 16 }, () => new Int32Array(256));
function made(pos, d, level) {
    if (d === 0) return 1;
    const out = buffers[level];
    const n = generateMoves(pos, out);
    let total = 0;
    for (let i = 0; i < n; i++) {
        pos.make(out[i]);
        total += made(pos, d - 1, level + 1);
        pos.unmake();
    }
    return total;
}
{
    const [name, fen, counts] = POSITIONS[0];
    const pos = Position.fromFen(fen);
    const t0 = performance.now();
    const n = made(pos, depth, 0);
    const t = performance.now() - t0;
    if (n !== counts[depth - 1]) bad++;
    console.log(`${n === counts[depth - 1] ? 'ok  ' : 'FAIL'} ${name} d${depth}, every leaf made: ${fmt(n)} in ${t.toFixed(0)} ms, ${mnps(n, t)}`);
}

if (bad) {
    console.log(`${bad} count(s) off`);
    process.exit(1);
}
