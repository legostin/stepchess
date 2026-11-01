// bench/snapshot — the golden record: a hash of the analysis and the explanation of 60 positions, in Russian and English, that CI verifies.
//
//   node bench/snapshot.mjs --verify [bench/golden.json]   compare every record with the golden file; exit 1 and say what moved when one differs
//   node bench/snapshot.mjs --update [bench/golden.json]   write the golden file (all records, or only --only <id> merged into it)
//   options: --only <id>   one record;   --jobs N   worker threads (default: CPUs - 1, at most 8; the result does not depend on it)
//            --tables none|KQK,KRK,...   with --verify: the tablebases to load (the golden file records its own); --update refuses a set other than TABLES
//            --corpus <file>   another corpus file
//            --scratch   lets --update write a golden file with another set of tables or another corpus, for the unit test's temp files
//
// A record is one line of bench/suites/snapshot.epd: a FEN and the move explainMove is asked about. For it the public API runs analyze (NODES nodes) and
// explainMove (NODES nodes), the results are localized to RU and EN, and each of the four texts is hashed (SHA-256 of a canonical JSON without wall-clock
// fields). Every call clears the search table, and the tablebases it may probe are a fixed set loaded up front, so a record depends on its own input,
// the code and the weights only, never on the order the records run in.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { parseArgs, num } from './lib/args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GOLDEN = path.join(HERE, 'golden.json');
const CORPUS = path.join(HERE, 'suites', 'snapshot.epd');

/** The node budget of each search (analyze, and each search inside explainMove). */
export const NODES = 50000;
export const LANGUAGES = ['ru', 'en'];
/**
 * The tablebases loaded before any record runs: a fixed set, so that a table file added later does not move the hashes. All of it stays preloaded,
 * although the corpus probes only some of the tables directly: a search of 50 k nodes reaches the others by captures and promotions, and which
 * tables are reached depends on the weights and the search, so trimming the list to "what is used today" would let a later change to either
 * quietly change what a record sees. A table file that is not listed is never read, even when it is on disk.
 */
export const TABLES = ['KBBK', 'KBNK', 'KNNK', 'KPK', 'KQK', 'KQKB', 'KQKN', 'KQKP', 'KQKQ', 'KQKR', 'KRK', 'KRKB', 'KRKR'];
const FORMAT = 1;

// keys that hold wall-clock time or a rate: they differ from run to run and never enter a hash
const WALL_CLOCK = new Set(['timeMs', 'nps', 'time', 'elapsed', 'elapsedMs', 'ms']);

/**
 * The canonical JSON of a value: object keys sorted, wall-clock keys and undefined values dropped, so two equal results give one string.
 * @param {unknown} value
 * @returns {string}
 */
export function canonical(value) {
    const walk = (v) => {
        if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : walk(x)));
        if (v && typeof v === 'object') {
            const out = {};
            for (const k of Object.keys(v).sort()) if (!WALL_CLOCK.has(k) && v[k] !== undefined) out[k] = walk(v[k]);
            return out;
        }
        return v;
    };
    return JSON.stringify(walk(value));
}

/** The SHA-256 (hex) of the canonical JSON of a value. */
export const hashOf = (value) => createHash('sha256').update(canonical(value)).digest('hex');

/**
 * The positions of the corpus file: {id, fen, move (SAN, or null when none is asked), note}.
 * @param {string} [file]
 */
export function loadCorpus(file = CORPUS) {
    const out = [];
    const seen = new Set();
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const [fen, move, id, ...note] = line.split(';').map((s) => s.trim());
        if (!fen || !move || !id) throw new Error(`${file}: a line needs "fen; move; id": ${line}`);
        if (seen.has(id)) throw new Error(`${file}: the id ${id} is used twice`);
        seen.add(id);
        out.push({ id, fen, move: move === '-' ? null : move, note: note.join('; ') });
    }
    return out;
}

let engine = null;
let tables = TABLES;

/** The package, with the tablebases loaded (once per thread; `keys` is the set, TABLES by default). */
async function load() {
    if (engine) return engine;
    const P = await import('../src/index.js');
    const { missing } = await P.preloadTables(tables);
    if (missing.length) throw new Error(`tablebase files are missing from data/tb: ${missing.join(', ')}`);
    engine = P;
    return P;
}

/** Choose the tablebases of this thread's records; call it before the first runRecord. */
export function useTables(keys) {
    if (engine && JSON.stringify(keys) !== JSON.stringify(tables)) throw new Error('the tablebases are chosen before the first record runs');
    tables = keys;
}

const signed = (n) => (n > 0 ? `+${n}` : String(n));

// one line that says what an analysis found
function analysisSummary(r) {
    if (r.kind === 'terminal') return `terminal: ${r.state}`;
    if (!r.ok) return `invalid: ${r.code}`;
    const score = r.mate !== null ? `mate ${signed(r.mate)}` : `${signed(r.scoreWhite)} cp`;
    return `${r.lines[0].san} ${score} (White's view), depth ${r.depth}`;
}

// one line that says what an explanation found: the class, the loss, the best move, the first motif and the English headline of its first step
// (`english` is the explanation localized to English), so that a change of wording alone still shows in a diff
function explanationSummary(r, english) {
    if (r.kind === 'terminal') return `terminal: ${r.state}`;
    if (!r.ok) return `invalid: ${r.code}`;
    const motif = r.motifs[0]?.key ?? 'none';
    return `${r.move.san} is ${r.class}, loses ${(r.loss * 100).toFixed(1)}% win chance, best ${r.best.san}; motif ${motif}; "${english.steps?.[0]?.title ?? ''}"`;
}

/**
 * Run one corpus position and describe it: the hashes of analyze and explainMove in each language and a short summary of both.
 * @param {{id: string, fen: string, move: string | null}} entry
 */
export async function runRecord(entry) {
    const P = await load();
    const analysis = P.analyze(entry.fen, { nodes: NODES });
    const explanation = P.explainMove(entry.fen, entry.move ?? '', { nodes: NODES });
    const over = analysis.kind === 'terminal';
    const bad = !analysis.ok || !explanation.ok || (over && explanation.kind !== 'terminal') || (!over && entry.move === null);
    const hash = { analyze: {}, explain: {} };
    const localized = {};
    for (const lang of LANGUAGES) {
        localized[lang] = P.localize(explanation, lang);
        hash.analyze[lang] = hashOf(P.localize(analysis, lang));
        hash.explain[lang] = hashOf(localized[lang]);
    }
    return {
        id: entry.id,
        fen: entry.fen,
        move: entry.move,
        summary: { analyze: analysisSummary(analysis), explain: explanationSummary(explanation, localized.en) },
        hash,
        bad,
    };
}

/**
 * Run records on `jobs` worker threads (inline for one job); the answers come back in the order of the entries.
 * @param {ReturnType<typeof loadCorpus>} entries
 * @param {number} jobs
 */
export async function runAll(entries, jobs, keys = TABLES) {
    useTables(keys);
    if (jobs <= 1 || entries.length <= 1) {
        const out = [];
        for (const e of entries) out.push(await runRecord(e));
        return out;
    }
    const results = new Array(entries.length);
    let next = 0;
    let failed = null;
    const file = fileURLToPath(import.meta.url);
    const workers = Array.from({ length: Math.min(jobs, entries.length) }, () => new Worker(file, { workerData: { snapshotWorker: true, tables: keys } }));
    // the first failure, of a record or of a worker itself, stops every worker
    const stop = (error) => {
        failed ??= error;
        for (const w of workers) w.terminate();
        return failed;
    };
    await Promise.all(
        workers.map(
            (worker) =>
                new Promise((resolve, reject) => {
                    const feed = () => {
                        if (failed || next >= entries.length) return worker.terminate().then(resolve, reject);
                        const index = next++;
                        worker.postMessage({ index, entry: entries[index] });
                    };
                    worker.on('message', (m) => {
                        if (m.error) return reject(stop(new Error(m.error)));
                        results[m.index] = m.record;
                        feed();
                    });
                    worker.on('error', (e) => reject(stop(e)));
                    feed();
                }),
        ),
    );
    return results;
}

// a worker thread: answers {index, entry} with {index, record}
if (!isMainThread && workerData?.snapshotWorker) {
    useTables(workerData.tables);
    parentPort.on('message', async ({ index, entry }) => {
        try {
            parentPort.postMessage({ index, record: await runRecord(entry) });
        } catch (e) {
            parentPort.postMessage({ error: String(e?.stack ?? e) });
        }
    });
}

const OPTIONS = ['verify', 'update', 'only', 'jobs', 'tables', 'corpus', 'scratch'];

const PARTS = [
    ['analyze', 'ru'],
    ['analyze', 'en'],
    ['explain', 'ru'],
    ['explain', 'en'],
];

/** The parts (analyze/explain x ru/en) in which two records' hashes differ. */
export const differences = (a, b) =>
    PARTS.filter(([kind, lang]) => a?.hash?.[kind]?.[lang] !== b?.hash?.[kind]?.[lang]).map(([kind, lang]) => `${kind} ${lang}`);

const stored = (r) => ({ id: r.id, fen: r.fen, move: r.move, summary: r.summary, hash: r.hash });

function readGolden(file) {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
}

// a usage or corpus error: main() reports it and the process ends with code 2
class Failure extends Error {}
const fail = (text) => {
    throw new Failure(text);
};

async function main() {
    const args = parseArgs(process.argv.slice(2));
    for (const name of Object.keys(args))
        if (name !== '_' && !OPTIONS.includes(name)) fail(`unknown option --${name} (known: ${OPTIONS.map((o) => `--${o}`).join(' ')})`);
    if (args._.length) fail(`unexpected argument "${args._[0]}": the golden file follows --verify or --update`);
    for (const name of ['only', 'jobs', 'tables', 'corpus']) if (args[name] === true) fail(`--${name} needs a value`);
    const verify = args.verify !== undefined;
    const update = args.update !== undefined;
    if (verify === update) fail('give exactly one of --verify and --update, e.g. node bench/snapshot.mjs --verify bench/golden.json');
    const given = verify ? args.verify : args.update;
    const goldenFile = typeof given === 'string' ? path.resolve(given) : DEFAULT_GOLDEN;
    const jobs = Math.max(1, Math.floor(num(args, 'jobs', Math.max(1, Math.min(8, availableParallelism() - 1)))));
    const corpus = loadCorpus(typeof args.corpus === 'string' ? path.resolve(args.corpus) : CORPUS);
    const only = typeof args.only === 'string' ? args.only : null;
    const scratch = args.scratch === true;
    const entries = only ? corpus.filter((e) => e.id === only) : corpus;
    if (!entries.length) fail(`no record "${only}" in the corpus`);

    const golden = readGolden(goldenFile);
    if (verify && !golden) fail(`${goldenFile} does not exist; make it with --update`);

    const started = Date.now();
    const keys = typeof args.tables === 'string' ? (args.tables === 'none' ? [] : args.tables.split(',').filter(Boolean)) : TABLES;
    if (update && !scratch && (canonical(keys) !== canonical(TABLES) || args.corpus !== undefined)) {
        fail('--update writes the golden record of the standard corpus and TABLES; another --tables or --corpus needs --scratch (and a file of its own)');
    }
    const records = await runAll(entries, jobs, keys);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const broken = records.filter((r) => r.bad);
    if (broken.length) fail(`the corpus holds positions the API rejects or answers oddly: ${broken.map((r) => r.id).join(', ')}`);

    const meta = { format: FORMAT, nodes: NODES, languages: LANGUAGES, tables: keys };
    const plural = `${jobs} job${jobs > 1 ? 's' : ''}`;

    if (update) {
        if (only && golden && canonical({ ...golden, records: 0 }) !== canonical({ ...meta, records: 0 })) {
            fail(
                `--only would merge one record into ${goldenFile}, which was made with other settings (format, nodes, languages or tables); run a full --update`,
            );
        }
        const old = new Map((golden?.records ?? []).map((r) => [r.id, r]));
        const fresh = new Map(records.map((r) => [r.id, stored(r)]));
        const changed = [];
        let added = 0;
        for (const [id, r] of fresh) {
            if (!old.has(id)) added++;
            else if (differences(old.get(id), r).length) changed.push(id);
        }
        // a full run rewrites the file in corpus order; --only merges one record into the records already there
        const order = only ? [...old.keys(), ...[...fresh.keys()].filter((id) => !old.has(id))] : corpus.map((e) => e.id);
        const merged = order.map((id) => fresh.get(id) ?? old.get(id));
        const removed = only ? 0 : [...old.keys()].filter((id) => !fresh.has(id)).length;
        writeFileSync(goldenFile, `${JSON.stringify({ ...meta, records: merged }, null, 2)}\n`);
        console.log(`snapshot: wrote ${merged.length} records to ${goldenFile} in ${seconds} s (${plural})`);
        console.log(`snapshot: ${changed.length} changed${changed.length ? ` (${changed.join(', ')})` : ''}, ${added} added, ${removed} removed`);
        return;
    }

    const problems = [];
    for (const k of ['format', 'nodes']) if (golden[k] !== meta[k]) problems.push(`the golden file has ${k} ${golden[k]}, this tool uses ${meta[k]}`);
    if (canonical(golden.tables) !== canonical(meta.tables))
        problems.push(`the golden file was made with the tablebases [${golden.tables}], this run has [${keys}]`);
    if (canonical(golden.languages) !== canonical(meta.languages)) problems.push('the golden file was made for other languages');
    const old = new Map((golden.records ?? []).map((r) => [r.id, r]));
    let mismatches = 0;
    for (const r of records) {
        const was = old.get(r.id);
        if (!was) {
            problems.push(`${r.id}: no such record in the golden file (${r.fen})`);
            continue;
        }
        const parts = differences(was, r);
        if (!parts.length) continue;
        mismatches++;
        const same = was.summary?.analyze === r.summary.analyze && was.summary?.explain === r.summary.explain;
        problems.push(
            [
                `MISMATCH ${r.id}: ${r.fen}${r.move ? `  move ${r.move}` : ''}`,
                `  differs in: ${parts.join(', ')}`,
                `  analyze: was "${was.summary?.analyze}"  now "${r.summary.analyze}"`,
                `  explain: was "${was.summary?.explain}"  now "${r.summary.explain}"`,
                ...(same ? ['  (the summaries agree: only the wording or the details of the results changed)'] : []),
            ].join('\n'),
        );
    }
    if (!only) for (const id of old.keys()) if (!records.some((r) => r.id === id)) problems.push(`${id}: in the golden file but no longer in the corpus`);
    if (problems.length) {
        console.error(problems.join('\n'));
        console.error(
            `snapshot: FAILED, ${mismatches} of ${records.length} records differ${problems.length > mismatches ? `, ${problems.length - mismatches} other problems` : ''}`,
        );
        console.error('snapshot: if the change is intended, run npm run snapshot:update and review the diff of bench/golden.json');
        process.exitCode = 1;
        return;
    }
    console.log(`snapshot: OK, ${records.length} records match ${goldenFile} in ${seconds} s (${plural})`);
}

if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
    main().catch((e) => {
        console.error(e instanceof Failure ? `snapshot: ${e.message}` : e);
        process.exitCode = 2;
    });
}
