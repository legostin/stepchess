// scripts/tablebases — generate the endgame tables by retrograde analysis and write the ones that fit the budget to data/tb.
//
//   node scripts/tablebases.mjs            every table of the plan, then data/tb/<KEY>.bin while the total stays ≤ 8 MB
//   node scripts/tablebases.mjs KQK KRK    only these keys (and what they depend on), written regardless of the budget
//
// A file is the header of tb-index (SCTB, version, key, entries) and the table compressed with zlib's deflate, which
// DecompressionStream('deflate') reads back; illegal entries are written as the value before them (packTable). The log gives each table's time, raw and compressed size.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { generateTable, getTable, tbDependencies, tbSize } from '../src/endgame/index.js';
import { writeHeader, packTable } from '../src/endgame/tb-index.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'tb');
const BUDGET = 8 * 1024 * 1024;

// always shipped, then the four-piece tables in the order of the plan, shipped while the budget holds
const ALWAYS = ['KQK', 'KRK', 'KBBK', 'KBNK', 'KNNK', 'KPK'];
const OPTIONAL = ['KQKQ', 'KQKR', 'KQKB', 'KQKN', 'KQKP', 'KRKR', 'KRKB', 'KRKN', 'KRKP', 'KBKP', 'KNKP', 'KPKP', 'KBPK', 'KRPK'];

const args = process.argv.slice(2);
const plan = args.length ? args : [...ALWAYS, ...OPTIONAL];

const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const log = (line) => console.log(line);

const files = new Map();
const times = new Map();
function make(key) {
    if (times.has(key) || !tbSize(key)) return;
    for (const dep of tbDependencies(key)) make(dep);
    const t0 = performance.now();
    let last = 0;
    generateTable(key, {
        onProgress: ({ key: k, phase, done, total }) => {
            const now = performance.now();
            if (k === key && now - last > 5000) {
                last = now;
                log(`  ${key} ${phase} ${phase === 'retro' ? `level ${done}, ${total} resolved` : `${done}/${total}`}`);
            }
        },
    });
    const seconds = (performance.now() - t0) / 1000;
    times.set(key, seconds);
    const table = getTable(key);
    const body = zlib.deflateSync(packTable(table), { level: 9, memLevel: 9 });
    const head = writeHeader(key);
    const file = new Uint8Array(head.length + body.length);
    file.set(head);
    file.set(body, head.length);
    files.set(key, file);
    log(`${key.padEnd(6)} ${seconds.toFixed(1).padStart(6)} s   raw ${mb(table.length).padStart(9)}   deflate ${mb(file.length).padStart(9)}`);
}

const start = performance.now();
for (const key of plan) make(key);
log(`generated ${times.size} tables in ${((performance.now() - start) / 1000).toFixed(1)} s`);

fs.mkdirSync(OUT, { recursive: true });
const ship = [];
if (args.length) for (const key of plan) ship.push(key);
else {
    for (const key of ALWAYS) ship.push(key);
    let total = ALWAYS.reduce((s, k) => s + files.get(k).length, 0);
    for (const key of OPTIONAL) {
        const size = files.get(key).length;
        if (total + size > BUDGET) {
            log(`not shipped: ${key} (${mb(size)}) — over the budget`);
            continue;
        }
        ship.push(key);
        total += size;
    }
    // what the plan does not list stays out of data/tb: it is generated on demand
    for (const f of fs.readdirSync(OUT)) if (f.endsWith('.bin') && !ship.includes(f.slice(0, -4))) fs.rmSync(path.join(OUT, f));
}
let total = 0;
for (const key of ship) {
    fs.writeFileSync(path.join(OUT, `${key}.bin`), files.get(key));
    total += files.get(key).length;
}
log(`data/tb: ${ship.join(' ')} — ${mb(total)}`);
