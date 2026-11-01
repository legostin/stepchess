// bench/tactics — the tactics suites (WAC, ECM): how many best moves the search finds at fixed nodes, depth or time, and its speed.
//
//   node bench/tactics.mjs --suite wac --nodes 200000      fixed nodes per position (reproducible)
//   node bench/tactics.mjs --suite ecm --movetime 1000     a second per position
//   node bench/tactics.mjs --suite wac --depth 8 --first 50 --hash 32 --verbose
//   node bench/tactics.mjs --normalize <dir>               rebuild bench/suites/*.epd from the Arasan files in <dir>
//
// The suites are the Arasan engine's test files (github.com/jdart1/arasan-chess, tests/: wacnew.epd, ecmgcp.epd; MIT
// license). Normalised, a line is `fen; bm <san> [<san> …]; [am <san> …;] id "…"`: the FEN's first four fields, the best
// moves in this engine's SAN. A position counts as solved when the search's move is one of bm and none of am.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Position, parseMove, toSan, moveToUci, NO_MOVE } from '../src/index.js';
import { Searcher } from '../src/search/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SUITES = path.join(HERE, 'suites');
const SOURCES = { wac: 'wacnew.epd', ecm: 'ecmgcp.epd' };

// the move a SAN names in the position, NO_MOVE when it names none or several
const BOOKS = { 'wacnew.epd': "Fred Reinfeld's Win at Chess (1958)", 'ecmgcp.epd': 'the Encyclopedia of Chess Middlegames (Chess Informant, 1980)' };

function moveOf(pos, san) {
    try {
        return parseMove(pos, san);
    } catch {
        return NO_MOVE;
    }
}

/** The positions of a normalised suite: [{fen, bm: [san], am: [san], id}]. */
export function loadSuite(name) {
    const text = fs.readFileSync(path.join(SUITES, `${name}.epd`), 'utf8');
    const out = [];
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const fields = line.split(';').map((f) => f.trim());
        const p = { fen: fields[0], bm: [], am: [], id: '' };
        for (const f of fields.slice(1)) {
            const sp = f.indexOf(' ');
            if (sp < 0) continue;
            const op = f.slice(0, sp);
            const arg = f.slice(sp + 1).trim();
            if (op === 'bm' || op === 'am') p[op] = arg.split(/\s+/);
            else if (op === 'id') p.id = arg.replace(/^"|"$/g, '');
        }
        out.push(p);
    }
    return out;
}

/**
 * Run the search on every position: {solved, total, failed: [{id, played, bm}], nodes, ms}. limits are the search's
 * (nodes, depth, movetime); each position gets a cleared searcher, so a fixed node count gives the same answer each run.
 */
export function runSuite(suite, limits, { hashMb = 16, onResult } = {}) {
    const searcher = new Searcher({ hashMb });
    let solved = 0;
    let nodes = 0;
    let ms = 0;
    const failed = [];
    for (const p of suite) {
        const pos = Position.fromFen(p.fen);
        const good = p.bm.map((s) => moveOf(pos, s));
        const bad = p.am.map((s) => moveOf(pos, s));
        searcher.clear();
        const r = searcher.search(pos, limits);
        nodes += r.nodes;
        ms += r.timeMs;
        const ok = good.includes(r.best) && !bad.includes(r.best);
        if (ok) solved++;
        else failed.push({ id: p.id, played: r.best === NO_MOVE ? '-' : toSan(pos, r.best), bm: p.bm });
        if (onResult) onResult(p, r, ok);
    }
    return { solved, total: suite.length, failed, nodes, ms };
}

/** Rebuild bench/suites/<name>.epd from the source files in dir; returns {name: {kept, dropped: [id]}}. */
export function normalize(dir) {
    const report = {};
    for (const [name, file] of Object.entries(SOURCES)) {
        const text = fs.readFileSync(path.join(dir, file), 'utf8');
        const lines = [
            `# ${name}.epd — ${name === 'wac' ? 'Win at Chess' : 'Encyclopedia of Chess Middlegames'}, normalised by bench/tactics.mjs --normalize.`,
            `# Source: the Arasan chess engine's test suites, github.com/jdart1/arasan-chess, tests/${file}, a repository under the MIT licence (Jon Dart).`,
            `# The positions come from ${BOOKS[file]}; they are used for testing only.`,
            '# A line: the FEN (four fields); bm, the best moves in SAN; am, moves to avoid; id. Positions whose bm or am this',
            "# engine's parseMove does not read as one legal move are dropped.",
        ];
        const dropped = [];
        let kept = 0;
        for (const raw of text.split('\n')) {
            const line = raw.trim();
            if (!line) continue;
            const m = /^(\S+ [wb] \S+ \S+)\s+(.*)$/.exec(line);
            const id = /id\s+"([^"]*)"/.exec(line)?.[1] ?? '?';
            if (!m) {
                dropped.push(id);
                continue;
            }
            let pos;
            try {
                pos = Position.fromFen(m[1]);
            } catch {
                dropped.push(id);
                continue;
            }
            const ops = {};
            for (const f of m[2].split(';')) {
                const t = f.trim();
                const sp = t.indexOf(' ');
                if (sp > 0) ops[t.slice(0, sp)] = t.slice(sp + 1).trim();
            }
            const parse = (field) => (field ? field.split(/\s+/).map((s) => moveOf(pos, s)) : []);
            const bm = parse(ops.bm);
            const am = parse(ops.am);
            if (!bm.length || bm.includes(NO_MOVE) || am.includes(NO_MOVE)) {
                dropped.push(id);
                continue;
            }
            const sans = (list) => list.map((mv) => toSan(pos, mv)).join(' ');
            lines.push(`${m[1]}; bm ${sans(bm)};${am.length ? ` am ${sans(am)};` : ''} id "${id}"`);
            kept++;
        }
        fs.mkdirSync(SUITES, { recursive: true });
        fs.writeFileSync(path.join(SUITES, `${name}.epd`), lines.join('\n') + '\n');
        report[name] = { kept, dropped };
    }
    return report;
}

function argOf(args, name) {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
}

function main(args) {
    const dir = argOf(args, 'normalize');
    if (dir !== undefined) {
        const report = normalize(dir);
        for (const [name, r] of Object.entries(report))
            console.log(`${name}: kept ${r.kept}, dropped ${r.dropped.length}${r.dropped.length ? ` (${r.dropped.join(', ')})` : ''}`);
        return;
    }
    const name = argOf(args, 'suite') ?? 'wac';
    const limits = {};
    for (const k of ['nodes', 'depth', 'movetime']) if (argOf(args, k) !== undefined) limits[k] = Number(argOf(args, k));
    if (!Object.keys(limits).length) limits.nodes = 200000;
    const first = Number(argOf(args, 'first') ?? Infinity);
    const hashMb = Number(argOf(args, 'hash') ?? 16);
    const verbose = args.includes('--verbose');
    const suite = loadSuite(name).slice(0, first);
    const t0 = Date.now();
    const r = runSuite(suite, limits, {
        hashMb,
        onResult: verbose
            ? (p, res, ok) =>
                  console.log(
                      `${ok ? 'ok  ' : 'FAIL'} ${p.id.padEnd(9)} ${moveToUci(res.best).padEnd(6)} bm ${p.bm.join(' ').padEnd(12)} d${res.depth} ${res.score} ${res.nodes} nodes ${res.timeMs} ms`,
                  )
            : undefined,
    });
    const wall = Date.now() - t0;
    const desc = Object.entries(limits)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
    console.log(
        `${name}: ${r.solved}/${r.total} solved (${desc}), ${r.nodes} nodes in ${r.ms} ms, ${Math.round(r.nodes / Math.max(1, r.ms / 1000))} nps; wall ${wall} ms`,
    );
    if (r.failed.length) console.log(`failed: ${r.failed.map((f) => `${f.id} (${f.played}, bm ${f.bm.join(' ')})`).join('; ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));
