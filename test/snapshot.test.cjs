// snapshot: the golden-record tool itself (canonical JSON, a stable hash of one record, a broken hash is caught); the whole corpus is 'npm run snapshot:verify'.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const SCRIPT = path.join(__dirname, '../bench/snapshot.mjs');
let S;
before(async () => {
    S = await import(pathToFileURL(SCRIPT).href);
    S.useTables([]); // the tool's own tests need no tablebases: they load in seconds
});

// the CLI with no tablebases, in a temp dir
const run = (...args) => spawnSync(process.execPath, [SCRIPT, '--tables', 'none', '--jobs', '1', ...args], { encoding: 'utf8' });

test('canonical JSON ignores key order and wall-clock fields', () => {
    const a = { b: 1, a: { y: [1, { q: 2, p: 3 }], x: 'ru' }, timeMs: 12, nps: 99000 };
    const b = { a: { x: 'ru', y: [1, { p: 3, q: 2 }], timeMs: 5 }, nps: 1, b: 1 };
    assert.equal(S.canonical(a), S.canonical(b));
    assert.equal(S.hashOf(a), S.hashOf(b));
    assert.equal(S.canonical({ a: undefined, b: 1 }), '{"b":1}');
    assert.notEqual(S.hashOf({ a: 1 }), S.hashOf({ a: 2 }));
    assert.notEqual(S.hashOf([1, 2]), S.hashOf([2, 1]), 'the order of an array matters');
    assert.match(S.hashOf({}), /^[0-9a-f]{64}$/);
});

test('the corpus holds 60 records with distinct ids in the six groups, each with a move or a dash', () => {
    const corpus = S.loadCorpus();
    assert.equal(corpus.length, 60);
    const groups = {};
    for (const e of corpus) {
        const g = e.id.replace(/-\d+$/, '');
        groups[g] = (groups[g] ?? 0) + 1;
    }
    assert.equal(groups.open, 10);
    assert.equal(groups.tact, 15);
    assert.equal(groups.quiet, 10);
    assert.equal(groups.end, 10);
    assert.equal(groups.term, 5);
    assert.equal((groups.mate ?? 0) + (groups.sac ?? 0) + (groups.blun ?? 0), 10);
    assert.equal(corpus.filter((e) => e.move === null).length, 5, 'only the terminal positions ask no move');
});

test('one record gives the same hashes on every run, whatever ran before it', async () => {
    const corpus = S.loadCorpus();
    const pick = (id) => corpus.find((e) => e.id === id);
    const first = await S.runRecord(pick('mate-02'));
    await S.runRecord(pick('blun-02')); // another search between the two leaves its table behind
    const again = await S.runRecord(pick('mate-02'));
    assert.deepEqual(again.hash, first.hash);
    assert.deepEqual(S.differences(first, again), []);
    assert.match(first.hash.explain.ru, /^[0-9a-f]{64}$/);
    assert.notEqual(first.hash.explain.ru, first.hash.explain.en, 'the Russian and the English explanation are different texts');
    const other = await S.runRecord(pick('blun-02'));
    assert.notDeepEqual(other.hash, first.hash);
    assert.match(first.summary.explain, /Qg6 is best/);
});

test('--verify exits 0 on its own golden file and 1, naming the record, when a hash is broken', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
    try {
        const golden = path.join(dir, 'golden.json');
        const made = run('--update', golden, '--only', 'mate-02', '--scratch');
        assert.equal(made.status, 0, made.stderr);
        assert.match(made.stdout, /1 added/);

        const ok = run('--verify', golden, '--only', 'mate-02');
        assert.equal(ok.status, 0, ok.stderr);
        assert.match(ok.stdout, /OK, 1 records match/);

        const file = JSON.parse(fs.readFileSync(golden, 'utf8'));
        assert.equal(file.records.length, 1);
        assert.equal(file.records[0].id, 'mate-02');
        file.records[0].hash.explain.en = '0'.repeat(64);
        fs.writeFileSync(golden, JSON.stringify(file));
        const bad = run('--verify', golden, '--only', 'mate-02');
        assert.equal(bad.status, 1, bad.stdout + bad.stderr);
        assert.match(bad.stderr, /MISMATCH mate-02/);
        assert.match(bad.stderr, /differs in: explain en/);
        assert.match(bad.stderr, /2rr3k\/pp3pp1/, 'the FEN is printed');
        assert.match(bad.stderr, /Qg6 is best/, 'the summaries are printed');

        const fixed = run('--update', golden, '--only', 'mate-02', '--scratch');
        assert.match(fixed.stdout, /1 changed/);
        assert.equal(run('--verify', golden, '--only', 'mate-02').status, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a missing golden file, an unknown record and a missing mode are usage errors (exit 2)', () => {
    const none = path.join(os.tmpdir(), 'snapshot-does-not-exist.json');
    assert.equal(run('--verify', none).status, 2);
    assert.equal(run('--verify', none, '--only', 'no-such-record').status, 2);
    assert.equal(run().status, 2);
});

test('--jobs 2 writes the same file as --jobs 1', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
    try {
        const corpus = path.join(dir, 'three.epd');
        const lines = S.loadCorpus().filter((e) => ['open-02', 'mate-02', 'term-03'].includes(e.id));
        fs.writeFileSync(corpus, lines.map((e) => `${e.fen}; ${e.move ?? '-'}; ${e.id}`).join(os.EOL));
        const one = path.join(dir, 'one.json');
        const two = path.join(dir, 'two.json');
        assert.equal(run('--update', one, '--corpus', corpus, '--scratch', '--jobs', '1').status, 0);
        assert.equal(run('--update', two, '--corpus', corpus, '--scratch', '--jobs', '2').status, 0);
        assert.equal(JSON.parse(fs.readFileSync(one, 'utf8')).records.length, 3);
        assert.equal(fs.readFileSync(two, 'utf8'), fs.readFileSync(one, 'utf8'));
        assert.equal(run('--verify', one, '--corpus', corpus, '--jobs', '2').status, 0);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('a flag without its value, an unknown flag and a custom --update without --scratch are usage errors (exit 2)', () => {
    const golden = path.join(os.tmpdir(), 'snapshot-never-written.json');
    for (const args of [
        ['--verify', golden, '--only'],
        ['--verify', golden, '--onl', 'open-01'],
        ['--verify', golden, '--job', '1'],
        ['--verify', golden, 'stray'],
        ['--update', golden, '--only', 'open-01'], // --tables none from run() without --scratch
    ]) {
        const r = run(...args);
        assert.equal(r.status, 2, `${args.join(' ')}\n${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /snapshot: /);
    }
    assert.equal(fs.existsSync(golden), false);
});

test('--update --only refuses to merge into a golden file made with other settings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
    try {
        const golden = path.join(dir, 'golden.json');
        assert.equal(run('--update', golden, '--only', 'mate-02', '--scratch').status, 0);
        const file = JSON.parse(fs.readFileSync(golden, 'utf8'));
        file.tables = ['KQK'];
        fs.writeFileSync(golden, JSON.stringify(file));
        const r = run('--update', golden, '--only', 'open-02', '--scratch');
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, /other settings/);
        assert.equal(JSON.parse(fs.readFileSync(golden, 'utf8')).records.length, 1);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
