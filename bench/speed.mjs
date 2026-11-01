// bench/speed — how fast the engine runs: search nodes per second, move generation (perft) and evaluation calls per second.
//
//   node bench/speed.mjs                       search every position for a second, then perft and the eval loop
//   node bench/speed.mjs --movetime 3000       longer searches (a steadier figure)
//   node bench/speed.mjs --nodes 1000000       a fixed node count per position (the time is what varies)
//   node bench/speed.mjs --hash 64 --runs 3    a bigger table; the best of 3 runs counts for perft and eval
//   node bench/speed.mjs --json                the figures as one JSON object
//
// One thread, a cleared Searcher for each position. Timed figures are noisy when other processes share the machine.
import { Position, perft, evaluate } from '../src/index.js';
import { Searcher } from '../src/search/index.js';
import { parseArgs, num } from './lib/args.mjs';

const POSITIONS = [
    ['start position', Position.START_FEN],
    ['kiwipete', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'],
    ['italian middlegame', 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2PP1N2/PP3PPP/RNBQ1RK1 w - - 0 7'],
    ['open middlegame', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10'],
    ['rook endgame', '8/5pk1/6p1/R6p/5P1P/6P1/r4K2/8 w - - 0 1'],
    ['pawn endgame', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'],
];

const args = parseArgs(process.argv.slice(2));
const hashMb = num(args, 'hash', 16);
const runs = num(args, 'runs', 3);
const limits = args.nodes ? { nodes: num(args, 'nodes', 500000) } : { movetime: num(args, 'movetime', 1000) };
const json = Boolean(args.json);
const log = json ? () => {} : console.log;

const searcher = new Searcher({ hashMb });
const out = { node: process.version, hashMb, limits, search: [], perft: null, eval: null };

// warm-up: let the JIT compile the search before anything is timed
searcher.search(Position.fromFen(POSITIONS[1][1]), { movetime: 500 });

log(`search, ${Object.entries(limits).map(([k, v]) => `${k} ${v}`)}, hash ${hashMb} MB`);
let nodes = 0;
let ms = 0;
for (const [name, fen] of POSITIONS) {
    searcher.clear();
    const r = searcher.search(Position.fromFen(fen), limits);
    const nps = Math.round((r.nodes * 1000) / Math.max(1, r.timeMs));
    nodes += r.nodes;
    ms += r.timeMs;
    out.search.push({ name, depth: r.depth, seldepth: r.seldepth, nodes: r.nodes, ms: r.timeMs, nps });
    log(
        `  ${name.padEnd(20)} depth ${String(r.depth).padStart(2)}/${String(r.seldepth).padEnd(2)} ${String(r.nodes).padStart(10)} nodes ${String(r.timeMs).padStart(6)} ms ${String(nps).padStart(9)} nps`,
    );
}
out.searchNps = Math.round((nodes * 1000) / Math.max(1, ms));
log(`  ${'total'.padEnd(20)} ${' '.repeat(8)} ${String(nodes).padStart(10)} nodes ${String(ms).padStart(6)} ms ${String(out.searchNps).padStart(9)} nps`);

// perft: legal moves counted on kiwipete (the leaves are counted in bulk, so this is generation plus make/unmake of the inner nodes)
{
    const pos = Position.fromFen(POSITIONS[1][1]);
    const depth = 4;
    let best = 0;
    let count = 0;
    for (let i = 0; i < runs; i++) {
        const t0 = performance.now();
        count = perft(pos, depth);
        best = Math.max(best, count / ((performance.now() - t0) / 1000));
    }
    out.perft = { depth, nodes: count, nps: Math.round(best) };
    log(`perft ${depth} kiwipete: ${count} nodes, ${Math.round(best / 1000)} k nodes/s (best of ${runs})`);
}

// evaluation: calls per second over the six positions
{
    const positions = POSITIONS.map(([, fen]) => Position.fromFen(fen));
    let sink = 0;
    for (let i = 0; i < 20000; i++) sink += evaluate(positions[i % positions.length]);
    const loops = 200000;
    let best = 0;
    for (let r = 0; r < runs; r++) {
        const t0 = performance.now();
        for (let i = 0; i < loops; i++) sink += evaluate(positions[i % positions.length]);
        best = Math.max(best, loops / ((performance.now() - t0) / 1000));
    }
    out.eval = { callsPerSecond: Math.round(best), checksum: sink };
    log(`evaluate: ${(best / 1e6).toFixed(2)} M calls/s (best of ${runs}; checksum ${sink})`);
}

if (json) console.log(JSON.stringify(out, null, 2));
