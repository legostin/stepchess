// scripts/tune — Texel tuning of the evaluation weights on datagen positions.
//
//   node scripts/tune.mjs --data ../stepchess-data/datagen/ --epochs 400 --out ../stepchess-data/tune/weights.candidate.js
//   node scripts/tune.mjs --data ../stepchess-data/datagen/ --max 200000 --epochs 100 --threads 8 --selftest
//
// --data PATH      a file or a directory of datagen files (`<fen> ; <cp> ; <result for White>`); always needed, also with --cache (the cache must match it)
// --max N          use at most N positions (every k-th line, so whole games stay mixed in)
// --epochs E       Adam steps over the whole set (default 400); --lr L starts at L centipawns a step (default 0.5), cosine to 5%
// --loss logistic|mse   the loss on win probability vs the result (default logistic, the cross entropy); both fit K the same way
// --min-support M  keep a weight as it is when fewer than M training positions use it (default 0: tune all)
// --no-keep-signs  let the weights of named terms change sign (by default a bonus stays a bonus, a penalty a penalty, a zero a zero)
// --keep-k         write the K the weights file already has, not the fitted one (K only scales the win chance shown; the search never reads it)
// --start FILE     begin from this weights module, not src/eval/weights.js (the hand-set weights, say)
// --no-anchor      leave the pawn's material to the tuner (by default it is held, and each piece's square table is centred on zero)
// --reg R          pull towards the starting weights: R · Σ (w − w0)² / positions (default 0)
// --threads T      workers for the feature pass (default 14)
// --cache FILE     keep the features there: read when present, else computed and written (a rerun skips the slow pass)
// --out FILE       the weights module to write (default ../stepchess-data/tune/weights.candidate.js); the repo's weights.js is not touched
// --selftest       check the feature vectors against the real evaluation before tuning (slow part of the pass: skip it for big runs)
//
// How it works. The evaluation is a sum over weights: tapered by the phase, scaled by the endgame factor, so for a position
// the score is  offset + Σ coef[i] · w[i]  over the weights that count. The trace tracer gives each term's value; the
// coefficient of a weight is how much the term's value moves when the weight moves by 64 (a finite difference of an exactly
// linear function), times the scale. Weights of different terms are probed in one pass (slot s of every term at once), the
// piece-square tables are read off the board. That is done once per position; K is fitted on the starting weights, then Adam
// runs on the coefficient vectors alone. The endgame knowledge (the scale factors of opposite bishops, wrong bishop and fortress, and the KBNK corner bonus) is not tuned: the self-play games do not play those endings well enough to label them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { Position } from '../src/index.js';
import { trace, W as SRC_W, T, flattenWeights, unflattenWeights, weightsModule } from '../src/eval/index.js';
import { applyWeights } from '../src/eval/params.js';
import { parseArgs, num, str } from '../bench/lib/args.mjs';

// --start FILE: begin from that weights module (default: src/eval/weights.js); the workers see the same argv
const startAt = process.argv.indexOf('--start');
const W = startAt > 0 ? (await import(pathToFileURL(path.resolve(process.argv[startAt + 1])).href)).W : SRC_W;
const ANCHOR = !process.argv.includes('--no-anchor');

const DELTA = 64;
const NOT_TUNED = new Set(['opposite-bishops', 'wrong-bishop', 'fortress', 'kbnk-corner']);
const PIECE_ROWS = 64;

// ---------------------------------------------------------------- the parameters

const flat = flattenWeights(W);
const NAMES = flat.names;
const START = Float64Array.from(flat.values);
const INFO = NAMES.map((name) => {
    const parts = name.split('.');
    const phase = parts.includes('mg') ? 0 : parts.includes('eg') ? 1 : -1;
    const term = parts[0];
    return { name, parts, term, phase, tuned: phase >= 0 && !NOT_TUNED.has(term) && term in T };
});

// pst.mg.<type>.<square> → the parameter index, for the direct coefficients
const PST_INDEX = [new Int32Array(7 * PIECE_ROWS).fill(-1), new Int32Array(7 * PIECE_ROWS).fill(-1)];
INFO.forEach((p, i) => {
    if (p.term === 'pst') PST_INDEX[p.phase][Number(p.parts[2]) * PIECE_ROWS + Number(p.parts[3])] = i;
});

// the other tuned parameters grouped by term: probed slot by slot
const GROUPS = new Map();
INFO.forEach((p, i) => {
    if (!p.tuned || p.term === 'pst') return;
    if (!GROUPS.has(p.term)) GROUPS.set(p.term, []);
    GROUPS.get(p.term).push(i);
});
const GROUP_LIST = [...GROUPS].map(([term, params]) => ({ term, key: T[term], params }));
const SLOTS = Math.max(...GROUP_LIST.map((g) => g.params.length));

// ---------------------------------------------------------------- features of one position

// walk a path to its parent object and key
function slot(obj, parts) {
    let o = obj;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    return [o, parts[parts.length - 1]];
}

function makeExtractor() {
    const work = structuredClone(W);
    const cells = INFO.map((p) => (p.tuned && p.term !== 'pst' ? slot(work, p.parts) : null));
    const keys = Object.keys(T).length;
    const base = new Float64Array(keys);
    const vals = new Float64Array(keys);
    const valuesOf = (tr, out) => {
        out.fill(0);
        for (const t of tr.terms) out[T[t.key]] = t.value;
    };
    applyWeights(work);

    /** {idx: number[], coef: number[], offset} for the position; coefficients are for the White-minus-Black total in cp. */
    return function extract(pos) {
        const tr = trace(pos);
        const scale = tr.scale;
        const phase = tr.phase / 24;
        const idx = [];
        const coef = [];
        if (scale !== 0) {
            // piece-square tables, straight from the board
            const b = pos.board;
            for (let sq = 0; sq < 128; sq++) {
                if (sq & 0x88) continue;
                const p = b[sq];
                if (!p) continue;
                const i64 = ((sq >> 4) << 3) | (sq & 7);
                const type = p & 7;
                const white = p < 8;
                const cell = type * PIECE_ROWS + (white ? i64 : i64 ^ 56);
                const sign = white ? 1 : -1;
                idx.push(PST_INDEX[0][cell], PST_INDEX[1][cell]);
                coef.push(sign * scale * phase, sign * scale * (1 - phase));
            }
            // everything else: slot s of every term at once
            valuesOf(tr, base);
            for (let s = 0; s < SLOTS; s++) {
                for (const g of GROUP_LIST) if (s < g.params.length) cells[g.params[s]][0][cells[g.params[s]][1]] += DELTA;
                applyWeights(work);
                valuesOf(trace(pos), vals);
                for (const g of GROUP_LIST) {
                    if (s >= g.params.length) continue;
                    const i = g.params[s];
                    const d = vals[g.key] - base[g.key];
                    cells[i][0][cells[i][1]] -= DELTA;
                    if (d !== 0) {
                        idx.push(i);
                        coef.push((scale * d) / DELTA);
                    }
                }
            }
            applyWeights(work);
        }
        // the part no tuned weight explains (the starting weights' sum is taken off the true total)
        let sum = 0;
        for (let k = 0; k < idx.length; k++) sum += coef[k] * START[idx[k]];
        return { idx, coef, offset: tr.total - sum };
    };
}

// ---------------------------------------------------------------- the feature pass (workers)

function parseLine(line) {
    const f = line.split(';');
    if (f.length < 3) return null;
    const score = Number(f[1]);
    const result = Number(f[2]);
    if (!Number.isFinite(score) || ![0, 0.5, 1].includes(result)) return null;
    return { fen: f[0].trim(), score, result };
}

// a 32-bit hash of the first four fields of a FEN: two positions with the same one are the same position for the split
function fenHash(fen) {
    let h = 0x811c9dc5;
    let spaces = 0;
    for (let i = 0; i < fen.length; i++) {
        const c = fen.charCodeAt(i);
        if (c === 32 && ++spaces === 4) break;
        h = Math.imul(h ^ c, 0x01000193) >>> 0;
    }
    return h;
}

function featureWorker() {
    const extract = makeExtractor();
    const rows = [];
    let nnz = 0;
    for (const line of workerData.lines) {
        const r = parseLine(line);
        if (!r) continue;
        let pos;
        try {
            pos = Position.fromFen(r.fen);
        } catch {
            continue;
        }
        const f = extract(pos);
        rows.push({ f, result: r.result, hash: fenHash(r.fen) });
        nnz += f.idx.length;
    }
    const len = new Uint32Array(rows.length);
    const idx = new Uint16Array(nnz);
    const coef = new Float32Array(nnz);
    const offset = new Float32Array(rows.length);
    const result = new Float32Array(rows.length);
    const hash = new Uint32Array(rows.length);
    let k = 0;
    rows.forEach((row, i) => {
        len[i] = row.f.idx.length;
        for (let j = 0; j < row.f.idx.length; j++, k++) {
            idx[k] = row.f.idx[j];
            coef[k] = row.f.coef[j];
        }
        offset[i] = row.f.offset;
        result[i] = row.result;
        hash[i] = row.hash;
    });
    parentPort.postMessage({ len, idx, coef, offset, result, hash }, [len.buffer, idx.buffer, coef.buffer, offset.buffer, result.buffer, hash.buffer]);
}

function listFiles(p) {
    const abs = path.resolve(p);
    if (fs.statSync(abs).isDirectory())
        return fs
            .readdirSync(abs)
            .filter((f) => f.endsWith('.txt'))
            .sort()
            .map((f) => path.join(abs, f));
    return [abs];
}

// the data lines of the files; a file that does not end with a newline was cut short, so its last line is left out
function readLines(files) {
    const lines = [];
    for (const f of files) {
        const parts = fs.readFileSync(f, 'utf8').split('\n');
        parts.pop(); // after the last newline: '' for a whole file, a cut line otherwise
        for (const l of parts) if (l.includes(';')) lines.push(l);
    }
    return lines;
}

async function computeFeatures(files, max, threads) {
    let lines = readLines(files);
    const total = lines.length;
    if (max && lines.length > max) {
        const stride = lines.length / max;
        lines = Array.from({ length: max }, (_, i) => lines[Math.floor(i * stride)]);
    }
    console.log(`${total} positions in ${files.length} files, using ${lines.length}; extracting features on ${threads} threads`);
    const chunk = Math.ceil(lines.length / (threads * 8));
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunk) chunks.push(lines.slice(i, i + chunk));
    const parts = new Array(chunks.length);
    let next = 0;
    let done = 0;
    const t0 = Date.now();
    await Promise.all(
        Array.from({ length: Math.min(threads, chunks.length) }, async () => {
            while (next < chunks.length) {
                const at = next++;
                parts[at] = await new Promise((resolve, reject) => {
                    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { lines: chunks[at] } });
                    w.on('message', resolve);
                    w.on('error', reject);
                });
                done++;
                if (done % Math.max(1, Math.floor(chunks.length / 10)) === 0)
                    console.log(`  ${done}/${chunks.length} chunks, ${Math.round((Date.now() - t0) / 1000)} s`);
            }
        }),
    );
    const n = parts.reduce((s, p) => s + p.len.length, 0);
    const nnz = parts.reduce((s, p) => s + p.idx.length, 0);
    const data = {
        n,
        nnz,
        start: new Float64Array(n + 1),
        idx: new Uint16Array(nnz),
        coef: new Float32Array(nnz),
        offset: new Float32Array(n),
        result: new Float32Array(n),
        hash: new Uint32Array(n),
    };
    let row = 0;
    let at = 0;
    for (const p of parts) {
        data.idx.set(p.idx, at);
        data.coef.set(p.coef, at);
        data.offset.set(p.offset, row);
        data.result.set(p.result, row);
        data.hash.set(p.hash, row);
        for (let i = 0; i < p.len.length; i++) {
            data.start[row] = at;
            at += p.len[i];
            row++;
        }
    }
    data.start[n] = at;
    {
        // for information: the K that fits the search scores of the same positions (what winChance is applied to in practice)
        const scores = [];
        const results = [];
        for (const line of lines) {
            const r = parseLine(line);
            if (r && Math.abs(r.score) < 3000) {
                scores.push(r.score);
                results.push(r.result);
            }
        }
        const rows = Int32Array.from(scores, (_, i) => i);
        console.log(
            `for information: K fitted to the 5000-node search scores of these positions is ${fitK(Float64Array.from(scores), Float32Array.from(results), rows, 'logistic').toFixed(8)}`,
        );
    }
    console.log(`features: ${n} positions, ${(nnz / n).toFixed(1)} weights each, ${Math.round((Date.now() - t0) / 1000)} s`);
    return data;
}

// what a cache was made from: the data files with their sizes, and --max
const sourceOf = (files, max) => ({ files: files.map((f) => ({ name: path.basename(f), size: fs.statSync(f).size })), max });

function saveCache(file, d, source) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const head = Buffer.from(JSON.stringify({ n: d.n, nnz: d.nnz, params: NAMES.length, ...source }));
    const size = Buffer.alloc(4);
    size.writeUInt32LE(head.length);
    fs.writeFileSync(
        file,
        Buffer.concat([
            size,
            head,
            Buffer.from(d.start.buffer),
            Buffer.from(d.idx.buffer),
            Buffer.from(d.coef.buffer),
            Buffer.from(d.offset.buffer),
            Buffer.from(d.result.buffer),
            Buffer.from(d.hash.buffer),
        ]),
    );
}

function loadCache(file, source) {
    const buf = fs.readFileSync(file);
    const hl = buf.readUInt32LE(0);
    const head = JSON.parse(buf.subarray(4, 4 + hl).toString());
    if (head.params !== NAMES.length) throw new Error('the cache was made for other weights');
    if (JSON.stringify(head.files) !== JSON.stringify(source.files) || head.max !== source.max)
        throw new Error(`the cache ${file} was made from other data (files, sizes or --max differ): delete it to compute the features again`);
    let at = 4 + hl;
    const take = (Type, count) => {
        const bytes = count * Type.BYTES_PER_ELEMENT;
        const copy = buf.buffer.slice(buf.byteOffset + at, buf.byteOffset + at + bytes);
        at += bytes;
        return new Type(copy);
    };
    const start = take(Float64Array, head.n + 1);
    return {
        n: head.n,
        nnz: head.nnz,
        start,
        idx: take(Uint16Array, head.nnz),
        coef: take(Float32Array, head.nnz),
        offset: take(Float32Array, head.n),
        result: take(Float32Array, head.n),
        hash: take(Uint32Array, head.n),
    };
}

// ---------------------------------------------------------------- the fit

const sigmoid = (x) => 1 / (1 + Math.exp(-x));

// predictions (cp) of the rows in [lo, hi) for the weights w, into out
function predict(d, w, rows, out) {
    for (let r = 0; r < rows.length; r++) {
        const i = rows[r];
        let s = d.offset[i];
        for (let k = d.start[i]; k < d.start[i + 1]; k++) s += d.coef[k] * w[d.idx[k]];
        out[r] = s;
    }
}

function lossOf(pred, results, rows, K, kind) {
    let sum = 0;
    for (let r = 0; r < rows.length; r++) {
        const p = Math.min(1 - 1e-12, Math.max(1e-12, sigmoid(K * pred[r])));
        const R = results[rows[r]];
        sum += kind === 'mse' ? (R - p) ** 2 : -(R * Math.log(p) + (1 - R) * Math.log(1 - p));
    }
    return sum / rows.length;
}

// the K that minimises the loss of fixed predictions (golden section on a log scale)
function fitK(pred, results, rows, kind) {
    let lo = Math.log(0.0003);
    let hi = Math.log(0.02);
    const g = (Math.sqrt(5) - 1) / 2;
    let a = hi - g * (hi - lo);
    let b = lo + g * (hi - lo);
    let fa = lossOf(pred, results, rows, Math.exp(a), kind);
    let fb = lossOf(pred, results, rows, Math.exp(b), kind);
    for (let it = 0; it < 50; it++) {
        if (fa < fb) {
            hi = b;
            b = a;
            fb = fa;
            a = hi - g * (hi - lo);
            fa = lossOf(pred, results, rows, Math.exp(a), kind);
        } else {
            lo = a;
            a = b;
            fa = fb;
            b = lo + g * (hi - lo);
            fb = lossOf(pred, results, rows, Math.exp(b), kind);
        }
    }
    return Math.exp((lo + hi) / 2);
}

// Anchor the scale to the pawn: the pawn's material is held (not tuned), and each piece's square table is centred on zero. For
// a knight, bishop, rook or queen the mean moves into its material (the eval does not change: every piece of the type
// stands on exactly one square); for a pawn (ranks 2 to 7) the mean is simply taken out, so the average pawn is worth its
// material; for a king the mean cancels between the two kings. Material is then "what the piece is worth", the tables
// "where it likes to stand".
const MAT_AT = [[], []];
const PST_AT = [[], []];
for (let ph = 0; ph < 2; ph++)
    for (let t = 0; t <= 6; t++) {
        MAT_AT[ph][t] = NAMES.indexOf(`material.${ph ? 'eg' : 'mg'}.${t}`);
        PST_AT[ph][t] = Array.from({ length: 64 }, (_, sq) => NAMES.indexOf(`pst.${ph ? 'eg' : 'mg'}.${t}.${sq}`));
    }
function anchor(w) {
    for (let ph = 0; ph < 2; ph++)
        for (let t = 1; t <= 6; t++) {
            const cells = t === 1 ? PST_AT[ph][t].slice(8, 56) : PST_AT[ph][t];
            const mean = cells.reduce((sum, j) => sum + w[j], 0) / cells.length;
            for (const j of cells) w[j] -= mean;
            if (t >= 2 && t <= 5) w[MAT_AT[ph][t]] += mean;
        }
}

function main() {
    const args = parseArgs(process.argv.slice(2));
    if (typeof args.data !== 'string' && typeof args.cache !== 'string') {
        console.error('usage: node scripts/tune.mjs --data <file|dir> [--epochs 400] [--lr 0.5] [--max N] [--cache FILE] [--out FILE]');
        process.exit(2);
    }
    return run(args);
}

async function run(args) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const out = path.resolve(str(args, 'out', path.join(here, '..', '..', 'stepchess-data', 'tune', 'weights.candidate.js')));
    if (typeof args.data !== 'string') throw new Error('--data is required (a file or a directory of datagen files), also with --cache');
    const epochs = num(args, 'epochs', 400);
    const lr0 = num(args, 'lr', 0.5);
    const kind = str(args, 'loss', 'logistic');
    const reg = num(args, 'reg', 0);
    const threads = num(args, 'threads', 14);
    const max = num(args, 'max', 0);
    if (!Number.isInteger(epochs) || epochs < 1) throw new Error('--epochs must be a positive integer');
    if (!Number.isInteger(threads) || threads < 1) throw new Error('--threads must be a positive integer');
    if (!Number.isInteger(max) || max < 0) throw new Error('--max must be a whole number (0: all)');
    if (!(lr0 > 0) || reg < 0) throw new Error('--lr must be positive and --reg not negative');
    if (kind !== 'logistic' && kind !== 'mse') throw new Error('--loss is logistic or mse');
    const cache = typeof args.cache === 'string' ? path.resolve(args.cache) : null;
    const files = listFiles(args.data);
    if (!files.length) throw new Error(`no .txt data files in ${args.data}`);
    const source = sourceOf(files, max);

    if (args.selftest) await selfTest(args);

    let d;
    if (cache && fs.existsSync(cache)) {
        d = loadCache(cache, source);
        console.log(`features read from ${cache}: ${d.n} positions`);
    } else {
        d = await computeFeatures(files, max, threads);
        if (cache) saveCache(cache, d, source);
    }

    // a held-out part: blocks of consecutive lines (whole games stay together), one block in twenty
    const BLOCK = Math.max(50, Math.min(4000, Math.floor(d.n / 40)));
    const train = [];
    const valid = [];
    // a position whose score has a part that belongs to weights not tuned (the KBNK corner bonus is active) is left out
    let skipped = 0;
    for (let i = 0; i < d.n; i++) {
        let left = Math.abs(d.offset[i]) >= 1;
        for (let k = d.start[i]; k < d.start[i + 1] && !left; k++) left = NOT_TUNED.has(INFO[d.idx[k]].term);
        if (left) {
            skipped++;
            continue;
        }
        (Math.floor(i / BLOCK) % 20 === 7 ? valid : train).push(i);
    }
    // the same position in a different game (a book line plus the same random moves) must not sit on both sides
    const seen = new Set(train.map((i) => d.hash[i]));
    const selection = valid.filter((i) => !seen.has(d.hash[i]));
    const twins = valid.length - selection.length;
    const trainRows = Int32Array.from(train);
    const validRows = Int32Array.from(selection);
    console.log(
        `${trainRows.length} training positions, ${validRows.length} in the selection set (${twins} left out: also in training), ${skipped} left out (a part of their score belongs to weights that are not tuned)`,
    );

    // a weight seen in fewer training positions than --min-support (default 0) stays as it is: too little data to tell it apart
    const support = new Int32Array(INFO.length);
    for (let r = 0; r < trainRows.length; r++) {
        const i = trainRows[r];
        for (let k = d.start[i]; k < d.start[i + 1]; k++) support[d.idx[k]]++;
    }
    const minSupport = num(args, 'min-support', 0);
    // a named bonus stays a bonus and a penalty a penalty, so the terms the explanations name keep their meaning: the weights of the
    // terms (not the tables of material, piece squares and mobility) keep the sign they start with (and at least 1 in size, so no term vanishes from the explanations), and those that start at 0 stay 0
    const keepSigns = !args['no-keep-signs'];
    const TABLES = new Set(['pst', 'mobility', 'material']);
    const free = (p) => !keepSigns || TABLES.has(p.term);
    const lower = INFO.map((p, j) => (free(p) ? -Infinity : START[j] > 0 ? 1 : -Infinity));
    const upper = INFO.map((p, j) => (free(p) ? Infinity : START[j] < 0 ? -1 : Infinity));
    // with the anchor the pawn's material is held, but its feature is still extracted (the offset stays zero)
    const held = (p) => ANCHOR && p.term === 'material' && p.parts[2] === '1';
    const tuned = INFO.map((p, j) => p.tuned && !held(p) && support[j] >= minSupport && (free(p) || START[j] !== 0));
    console.log(
        `${tuned.filter(Boolean).length} weights are tuned (${INFO.filter((p) => p.tuned).length} could be; ${INFO.filter((p, j) => p.tuned && support[j] < minSupport).length} seen in fewer than ${minSupport} positions are kept)`,
    );
    const w = Float64Array.from(START);
    const pred = new Float64Array(trainRows.length);
    const predV = new Float64Array(validRows.length);
    predict(d, w, trainRows, pred);
    predict(d, w, validRows, predV);
    const K0 = W.K;
    const K = fitK(pred, d.result, trainRows, kind);
    console.log(`K: the file has ${K0}, the best fit on the starting weights is ${K.toFixed(8)}`);
    const report = (label, ww, KK) => {
        predict(d, ww, trainRows, pred);
        predict(d, ww, validRows, predV);
        const t = lossOf(pred, d.result, trainRows, KK, kind);
        const v = lossOf(predV, d.result, validRows, KK, kind);
        const tm = lossOf(pred, d.result, trainRows, KK, 'mse');
        const vm = lossOf(predV, d.result, validRows, KK, 'mse');
        console.log(`${label}: ${kind} train ${t.toFixed(6)} selection ${v.toFixed(6)}   (mse train ${tm.toFixed(6)} selection ${vm.toFixed(6)})`);
        return v;
    };
    report('start', w, K);
    if (ANCHOR) {
        anchor(w);
        report('start, anchored (pawn mg/eg fixed, tables centred)', w, K);
    }

    // Adam over the coefficient vectors
    const grad = new Float64Array(w.length);
    const m1 = new Float64Array(w.length);
    const m2 = new Float64Array(w.length);
    const b1 = 0.9;
    const b2 = 0.999;
    let best = Infinity;
    let bestW = Float64Array.from(w);
    const N = trainRows.length;
    const t0 = Date.now();
    for (let e = 1; e <= epochs; e++) {
        grad.fill(0);
        for (let r = 0; r < N; r++) {
            const i = trainRows[r];
            let s = d.offset[i];
            const lo = d.start[i];
            const hi = d.start[i + 1];
            for (let k = lo; k < hi; k++) s += d.coef[k] * w[d.idx[k]];
            const p = sigmoid(K * s);
            const R = d.result[i];
            // d loss / d s: the cross entropy gives K (p − R); the squared error 2 (p − R) p (1 − p) K
            const g = kind === 'mse' ? 2 * (p - R) * p * (1 - p) * K : K * (p - R);
            for (let k = lo; k < hi; k++) grad[d.idx[k]] += g * d.coef[k];
        }
        const lr = lr0 * (0.05 + 0.95 * 0.5 * (1 + Math.cos((Math.PI * (e - 1)) / epochs)));
        for (let j = 0; j < w.length; j++) {
            if (!tuned[j]) continue;
            const gj = grad[j] / N + (reg ? (2 * reg * (w[j] - START[j])) / N : 0);
            m1[j] = b1 * m1[j] + (1 - b1) * gj;
            m2[j] = b2 * m2[j] + (1 - b2) * gj * gj;
            const mh = m1[j] / (1 - Math.pow(b1, e));
            const vh = m2[j] / (1 - Math.pow(b2, e));
            w[j] = Math.min(upper[j], Math.max(lower[j], w[j] - (lr * mh) / (Math.sqrt(vh) + 1e-12)));
        }
        if (ANCHOR) anchor(w);
        if (e % 10 === 0 || e === epochs) {
            const v = report(`epoch ${e} (lr ${lr.toFixed(3)}, ${Math.round((Date.now() - t0) / 1000)} s)`, w, K);
            if (v < best) {
                best = v;
                bestW = Float64Array.from(w);
            }
        }
    }

    // the best epoch by loss on the selection set, rounded to whole numbers, and K fitted again on that
    const rounded = Float64Array.from(bestW, (x) => Math.round(x));
    predict(d, rounded, trainRows, pred);
    const Kfinal = fitK(pred, d.result, trainRows, kind);
    report('rounded', rounded, Kfinal);
    await checkLinear(files, rounded);
    const changed = rounded.reduce((s, x, j) => s + (x !== START[j] ? 1 : 0), 0);
    console.log(`${changed} of ${w.length} weights changed; K ${K0} → ${Kfinal.toFixed(8)}`);
    const weights = unflattenWeights(W, Array.from(rounded));
    // K is the slope of winChance, which the explanations show; it does not touch the search. --keep-k leaves the file's value
    weights.K = args['keep-k'] ? K0 : Number(Kfinal.toPrecision(6));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, weightsModule(weights));
    console.log(`wrote ${out}`);
}

// the linear model against the real evaluation at the final weights: about 2,000 positions spread over the files
async function checkLinear(files, final) {
    const lines = readLines(files);
    const step = Math.max(1, Math.floor(lines.length / 2000));
    const extract = makeExtractor(); // coefficients at the starting weights
    const changed = unflattenWeights(W, Array.from(final));
    let sum = 0;
    let worst = 0;
    let count = 0;
    for (let i = 0; i < lines.length; i += step) {
        const r = parseLine(lines[i]);
        if (!r) continue;
        const pos = Position.fromFen(r.fen);
        const f = extract(pos);
        let predicted = f.offset;
        for (let k = 0; k < f.idx.length; k++) predicted += f.coef[k] * final[f.idx[k]];
        applyWeights(changed);
        const real = trace(pos).total;
        applyWeights(W);
        const err = Math.abs(real - predicted);
        sum += err;
        worst = Math.max(worst, err);
        count++;
    }
    console.log(
        `linear model against the real evaluation at the final weights: ${count} positions, off by ${(sum / count).toFixed(3)} cp on average, ${worst.toFixed(2)} at most`,
    );
}

// ---------------------------------------------------------------- self test of the features

async function selfTest(args) {
    const files = listFiles(args.data);
    const lines = fs
        .readFileSync(files[0], 'utf8')
        .split('\n')
        .filter((l) => l.includes(';'))
        .slice(0, 300);
    const extract = makeExtractor();
    const rand = (() => {
        let a = 12345;
        return () => (a = (Math.imul(a, 1103515245) + 12345) >>> 0) / 4294967296;
    })();
    // a random change of every tuned weight by up to ±6, applied to the real evaluation
    const delta = INFO.map((p) => (p.tuned ? Math.round((rand() - 0.5) * 12) : 0));
    const changed = unflattenWeights(
        W,
        START.map((v, i) => v + delta[i]),
    );
    let worst = 0;
    let sum = 0;
    let count = 0;
    let offsetMax = 0;
    for (const line of lines) {
        const r = parseLine(line);
        const pos = Position.fromFen(r.fen);
        const f = extract(pos);
        applyWeights(W);
        let predicted = f.offset;
        for (let k = 0; k < f.idx.length; k++) predicted += f.coef[k] * (START[f.idx[k]] + delta[f.idx[k]]);
        applyWeights(changed);
        const real = trace(pos).total;
        applyWeights(W);
        const err = Math.abs(real - predicted);
        worst = Math.max(worst, err);
        sum += err;
        count++;
        offsetMax = Math.max(offsetMax, Math.abs(f.offset));
    }
    console.log(
        `selftest: ${count} positions, after a random change of every weight the linear model is off by ${(sum / count).toFixed(3)} cp on average, ${worst.toFixed(2)} at most (max offset ${offsetMax.toFixed(1)})`,
    );
}

if (isMainThread) {
    if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
        main().catch((e) => (console.error(e instanceof Error ? e.message : e), process.exit(2)));
} else featureWorker();
