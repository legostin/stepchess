// architecture: the layers of the engine and the rules between them, checked on the import graph.
//
// A unit is the first directory under src/ (core, eval, search, …) or a top-level file (api.js, index.js). Units form
// layers; a module imports only from its own unit or from a lower layer. Units in one layer do not import each other.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.join(__dirname, '../src');

// lowest first
const LAYERS = [
    ['i18n'], //                         words of every language
    ['core', 'client'], //               squares, pieces, positions, move generation, SAN, PGN; the worker client
    ['eval', 'endgame'], //              evaluation with a trace; tablebases, openings
    ['search'], //                       iterative-deepening alpha-beta
    ['explain'], //                      motifs, move classes, annotations, hints, game review
    ['play', 'puzzles'], //              opponent levels; puzzle search and verification
    ['api'], //                          the public contract (safe wrappers, result shapes)
    ['index'], //                        the package
    ['worker'], //                       the worker script: messages → api
];
const layerOf = new Map(LAYERS.flatMap((units, i) => units.map((u) => [u, i])));

const files = [];
const walk = (d) => {
    if (!fs.existsSync(d)) return;
    fs.readdirSync(d).forEach((f) => {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
    });
};
walk(SRC);

// the unit of a file: its first directory under src/; top-level files are units of their own (api, index)
const unitOf = (file) => path.relative(SRC, file).replace(/\.js$/, '').split(path.sep)[0];
const unitDir = (unit) => path.join(SRC, unit);
const hasIndex = (unit) => fs.existsSync(path.join(unitDir(unit), 'index.js'));

// file → [imported file]
const imports = new Map(
    files.map((f) => {
        const text = fs.readFileSync(f, 'utf8');
        const out = [];
        for (const m of text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) out.push(path.resolve(path.dirname(f), m[1]));
        return [f, out];
    }),
);
const rel = (f) => path.relative(SRC, f).split(path.sep).join('/');

test('the layers list every unit of the engine', () => {
    const expected = ['i18n', 'core', 'client', 'eval', 'endgame', 'search', 'explain', 'play', 'puzzles', 'api', 'index', 'worker'];
    assert.deepEqual([...layerOf.keys()].sort(), expected.sort());
});

test('the package has an index and an i18n unit', () => {
    assert.ok(fs.existsSync(path.join(SRC, 'index.js')), 'src/index.js');
    assert.ok(hasIndex('i18n'), 'src/i18n/index.js');
});

test('every unit has a layer', () => {
    const missing = [...new Set(files.map(unitOf))].filter((u) => !layerOf.has(u));
    assert.deepEqual(missing, [], 'units missing from LAYERS');
});

test('a module imports only its own unit or lower layers', () => {
    const bad = [];
    for (const [f, targets] of imports) {
        const a = unitOf(f);
        for (const t of targets) {
            const b = unitOf(t);
            if (a !== b && !(layerOf.get(b) < layerOf.get(a))) bad.push(`${rel(f)} → ${rel(t)} (${a} may not use ${b})`);
        }
    }
    assert.deepEqual(bad, []);
});

test('no import cycles, not even inside a unit', () => {
    const state = new Map();
    const cycles = [];
    const visit = (f, stack) => {
        state.set(f, 'open');
        stack.push(f);
        for (const t of imports.get(f) ?? []) {
            if (state.get(t) === 'open') cycles.push(stack.slice(stack.indexOf(t)).concat(t).map(rel).join(' → '));
            else if (!state.has(t)) visit(t, stack);
        }
        stack.pop();
        state.set(f, 'done');
    };
    for (const f of files) if (!state.has(f)) visit(f, []);
    assert.deepEqual(cycles, []);
});

test('another unit is entered through its index.js', () => {
    const bad = [];
    for (const [f, targets] of imports)
        for (const t of targets) {
            const b = unitOf(t);
            if (b === unitOf(f) || !hasIndex(b)) continue;
            if (t !== path.join(unitDir(b), 'index.js')) bad.push(`${rel(f)} → ${rel(t)}`);
        }
    assert.deepEqual(bad, []);
});

test('api.js is imported only by index.js, and index.js only by the worker', () => {
    const bad = [];
    for (const [f, targets] of imports)
        for (const t of targets) {
            if (t === path.join(SRC, 'index.js') && unitOf(f) !== 'worker') bad.push(`${rel(f)} imports the package index`);
            if (t === path.join(SRC, 'api.js') && rel(f) !== 'index.js') bad.push(`${rel(f)} imports api.js`);
        }
    assert.deepEqual(bad, []);
});

test('a module speaks from its own catalog domain', () => {
    // msg('explain.motifs.…') belongs in src/explain/; the api layer has the domain 'api'
    const bad = [];
    for (const f of files) {
        const unit = unitOf(f);
        if (unit === 'i18n') continue;
        const text = fs.readFileSync(f, 'utf8');
        for (const m of text.matchAll(/\bmsg\(\s*['`]([\w.]+?)(?:\$\{|['`])/g)) if (!`${m[1]}.`.startsWith(`${unit}.`)) bad.push(`${rel(f)}: ${m[1]}`);
    }
    assert.deepEqual(bad, []);
});

test('every module opens with its path and what it holds', () => {
    // «// core/movegen — legal move generation …»; a unit's index.js is named by its directory, src/index.js is «index»
    const bad = [];
    for (const f of files) {
        const name = rel(f)
            .replace(/\.js$/, '')
            .replace(/(.)\/index$/, '$1');
        const first = fs.readFileSync(f, 'utf8').split('\n', 1)[0];
        if (!first.startsWith(`// ${name} — `)) bad.push(`${rel(f)}: ${first.slice(0, 60)}`);
    }
    assert.deepEqual(bad, []);
});

test('every module loads', async () => {
    for (const f of files) await import(pathToFileURL(f).href);
});
