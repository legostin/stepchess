// contract: every result of the public analysis and explanation API has exactly the documented fields and types, over a corpus of positions; every step renders in RU and EN.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let P;
let I;
before(async () => {
    P = await import('../src/index.js');
    I = await import('../src/i18n/index.js');
});

const CORPUS = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
    'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4',
    'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
    'rnbqkb1r/pp2pppp/3p1n2/8/3NP3/8/PPP2PPP/RNBQKB1R w KQkq - 0 5',
    'r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 6 8',
    'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1',
    'r4rk1/pp3ppp/2n1bn2/q1pp4/3P4/2PBPN2/PP1N1PPP/R2QK2R w KQ - 0 10',
    '2kr3r/ppp2ppp/2n5/3q4/8/2N2N2/PPP2PPP/R2QR1K1 w - - 0 14',
    '6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1',
    'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1',
    '8/8/8/4k3/8/8/4K3/7Q w - - 0 1',
    '8/8/8/8/8/4k3/4p3/4K3 b - - 0 1',
    '8/5k2/8/8/8/8/2K2P2/8 w - - 0 1',
    '8/8/8/8/3k4/8/3PK3/8 w - - 0 1',
    '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
    '8/2k5/8/8/8/8/1R6/1K6 w - - 0 1',
    '4k3/R7/4K3/8/8/8/8/8 b - - 0 1',
    '8/P7/8/8/8/k7/8/2K5 w - - 0 1',
    '4k3/1P6/8/8/8/8/8/4K3 w - - 0 1',
    'rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3',
    'rnbqk2r/pppp1ppp/5n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 5 4',
    'r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1BP2/PPPQ2PP/R3KB1R w KQ - 2 9',
    '3r2k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    '1k6/8/1K6/8/8/8/8/7R w - - 0 1',
    '7k/8/8/8/8/8/5q2/7K w - - 0 1',
    '8/8/1k6/8/8/8/1K6/NB6 w - - 0 1',
    '5rk1/pp3ppp/8/3q4/8/8/PP3PPP/3Q2K1 w - - 0 1',
    'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2',
    'r2qkb1r/pp1b1ppp/2n1pn2/2pp4/3P4/2P1PN2/PP1NBPPP/R1BQK2R w KQkq - 0 8',
];

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const sorted = (o) => Object.keys(o).sort();

function checkAnalysis(r, fen) {
    assert.deepEqual(
        sorted(r),
        sorted({ ok: 0, kind: 0, fen: 0, side: 0, score: 0, scoreWhite: 0, mate: 0, win: 0, depth: 0, nodes: 0, lines: 0, trace: 0 }),
        fen,
    );
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'analysis');
    assert.equal(typeof r.fen, 'string');
    assert.ok(r.side === 'white' || r.side === 'black');
    assert.ok(Number.isInteger(r.score) && Number.isInteger(r.scoreWhite));
    assert.equal(r.scoreWhite, r.side === 'white' ? r.score : -r.score);
    assert.ok(r.mate === null || Number.isInteger(r.mate), fen);
    assert.ok(num(r.win) && r.win >= 0 && r.win <= 1);
    assert.ok(Number.isInteger(r.depth) && r.depth >= 1);
    assert.ok(Number.isInteger(r.nodes) && r.nodes >= 1);
    assert.ok(Array.isArray(r.lines) && r.lines.length >= 1);
    for (const l of r.lines) {
        assert.deepEqual(sorted(l), ['mate', 'pv', 'san', 'score', 'uci']);
        assert.equal(typeof l.uci, 'string');
        assert.equal(typeof l.san, 'string');
        assert.ok(Number.isInteger(l.score));
        assert.ok(l.mate === null || Number.isInteger(l.mate));
        assert.ok(Array.isArray(l.pv) && l.pv.length >= 1);
        assert.deepEqual([l.pv[0].uci, l.pv[0].san], [l.uci, l.san]);
        for (const m of l.pv) {
            assert.deepEqual(sorted(m), ['san', 'uci']);
            assert.match(m.uci, /^[a-h][1-8][a-h][1-8][qrbn]?$/);
            assert.equal(typeof m.san, 'string');
        }
    }
    assert.equal(r.score, r.lines[0].score);
    assert.equal(r.mate, r.lines[0].mate);
    assert.deepEqual(sorted(r.trace), ['phase', 'scale', 'terms', 'total']);
    assert.ok(num(r.trace.total) && num(r.trace.phase) && num(r.trace.scale));
    for (const t of r.trace.terms) {
        assert.deepEqual(sorted(t), ['black', 'group', 'key', 'squares', 'value', 'white']);
        assert.ok(num(t.white) && num(t.black) && num(t.value));
        assert.ok(Array.isArray(t.squares));
    }
}

// no Msg anywhere in a localized tree, and nothing but plain JSON-able data in a result
function plain(v, path = 'r') {
    if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return;
    assert.ok(typeof v === 'object', `${path} is a ${typeof v}`);
    assert.ok(!(v instanceof I.Msg), `${path} is a Msg`);
    const proto = Object.getPrototypeOf(v);
    assert.ok(proto === Object.prototype || proto === Array.prototype, `${path} is a class instance`);
    for (const [k, x] of Object.entries(v)) plain(x, `${path}.${k}`);
}

test('contract: 30 positions give analysis results with exactly the documented fields and types', () => {
    assert.equal(CORPUS.length, 30);
    const analysed = [];
    for (const fen of CORPUS) {
        const r = P.analyze(fen, { nodes: 4000 });
        if (r.kind === 'terminal') continue; // checked below
        analysed.push(fen);
        checkAnalysis(r, fen);
        plain(r);
        plain(I.localize(r, 'ru'));
    }
    assert.ok(analysed.length >= 28, `${analysed.length} of the corpus are not terminal`);
});

test('contract: terminal and invalid results have exactly their fields', () => {
    const t = P.analyze('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3');
    assert.deepEqual(sorted(t), ['kind', 'ok', 'reason', 'state', 'winner']);
    assert.equal(t.winner, 'black');
    const s = P.analyze('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    assert.deepEqual(sorted(s), ['kind', 'ok', 'reason', 'state']);
    for (const r of [t, s]) {
        assert.ok(r.reason instanceof I.Msg);
        assert.ok(!hasMsgIn(I.localize(r, 'ru')));
        assert.ok(!hasMsgIn(I.localize(r, 'en')));
    }
    const bad = P.analyze('x');
    assert.deepEqual(sorted(bad), ['code', 'kind', 'ok', 'reason']);
    assert.equal(bad.ok, false);
    assert.equal(bad.kind, 'invalid');
    assert.equal(typeof bad.code, 'string');
    assert.ok(!hasMsgIn(I.localize(bad, 'ru')));
});

test('contract: position and parseGame results have exactly their fields', () => {
    const p = P.position('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    assert.deepEqual(sorted(p), ['fen', 'inCheck', 'kind', 'legal', 'ok', 'side', 'status']);
    assert.equal(typeof p.fen, 'string');
    assert.equal(typeof p.inCheck, 'boolean');
    for (const m of p.legal) assert.deepEqual(sorted(m), ['san', 'uci']);
    const g = P.parseGame('1. e4 e5 2. Nf3 *');
    assert.deepEqual(sorted(g), ['headers', 'kind', 'moves', 'ok', 'result']);
    for (const m of g.moves) assert.deepEqual(sorted(m), ['fen', 'san', 'uci']);
    plain(p);
    plain(g);
});

function hasMsgIn(v) {
    if (v instanceof I.Msg) return true;
    return v && typeof v === 'object' && Object.values(v).some(hasMsgIn);
}

// --- explanations: explainMove, hint and reviewGame

const RULES = ['class', 'motif', 'term', 'refutation', 'best', 'answer'];
const cyr = /[А-Яа-яЁё]/;
const KINDS = ['best', 'threat', 'bad', 'idea', 'attack', 'defend'];
const GLYPHS = ['!!', '!', '!?', '?!', '?', '??', '#', '+'];
const SQ = /^[a-h][1-8]$/;

// a text renders in both languages: Russian in Cyrillic, English without it
function checkText(t, where) {
    const ru = I.inLanguage(t, 'ru');
    const en = I.inLanguage(t, 'en');
    assert.ok(ru.length > 0 && en.length > 0, where);
    assert.match(ru, cyr, `${where}: ${ru}`);
    assert.ok(!cyr.test(en), `${where}: ${en}`);
}

function checkAnnotations(a, where) {
    assert.deepEqual(sorted(a), ['arrows', 'badges', 'squares'], where);
    for (const x of a.arrows) {
        assert.deepEqual(sorted(x), ['from', 'kind', 'to'], where);
        assert.ok(SQ.test(x.from) && SQ.test(x.to) && x.from !== x.to && KINDS.includes(x.kind), where);
    }
    for (const x of a.squares) assert.ok(SQ.test(x.sq) && KINDS.includes(x.kind) && sorted(x).join() === 'kind,sq', where);
    for (const x of a.badges) assert.ok(SQ.test(x.sq) && GLYPHS.includes(x.glyph) && sorted(x).join() === 'glyph,sq', where);
}

// every step has a title and a rule, renders in RU and EN; the last one, and only it, is the final answer
function checkSteps(steps, where) {
    assert.ok(Array.isArray(steps) && steps.length >= 1, where);
    steps.forEach((s, i) => {
        const w = `${where} step ${i}`;
        for (const k of Object.keys(s)) assert.ok(['title', 'text', 'line', 'annotations', 'rule', 'data', 'final'].includes(k), `${w}: ${k}`);
        assert.ok(RULES.includes(s.rule), `${w}: ${s.rule}`);
        checkText(s.title, `${w} title`);
        if ('text' in s) checkText(s.text, `${w} text`);
        if ('line' in s)
            assert.ok(
                s.line.every((x) => typeof x === 'string'),
                w,
            );
        if ('annotations' in s) checkAnnotations(s.annotations, w);
        assert.equal(s.final === true, i === steps.length - 1, w);
    });
    assert.equal(steps[steps.length - 1].rule, 'answer', where);
}

const MOTIF_FIELDS = ['arrows', 'key', 'kind', 'params', 'pieces', 'ply', 'side', 'squares'];

function checkExplanation(r, where) {
    assert.deepEqual(
        sorted(r),
        ['alternatives', 'annotations', 'best', 'class', 'kind', 'loss', 'motifs', 'move', 'ok', 'refutation', 'steps', 'terms', 'winAfter', 'winBefore'],
        where,
    );
    assert.deepEqual([r.ok, r.kind], [true, 'move']);
    assert.deepEqual(sorted(r.move), ['san', 'uci']);
    assert.ok(['best', 'good', 'inaccuracy', 'mistake', 'blunder'].includes(r.class));
    for (const k of ['winBefore', 'winAfter', 'loss']) assert.ok(num(r[k]) && r[k] >= 0 && r[k] <= 1, `${where} ${k}`);
    assert.ok(Math.abs(r.loss - Math.max(0, r.winBefore - r.winAfter)) < 1e-3, where);
    if (r.best !== null) {
        assert.deepEqual(sorted(r.best), ['line', 'motifs', 'san', 'uci']);
        assert.equal(r.best.line[0], r.best.san);
    }
    // the top lines of the search before the move (multi-PV 3), best first; the first is the best move
    assert.ok(Array.isArray(r.alternatives) && r.alternatives.length >= 1 && r.alternatives.length <= 3, where);
    for (const a of r.alternatives) {
        assert.deepEqual(sorted(a), 'mate' in a ? ['mate', 'san', 'score', 'scoreWhite', 'uci'] : ['san', 'score', 'scoreWhite', 'uci'], where);
        assert.ok(Number.isInteger(a.score) && Math.abs(a.scoreWhite) === Math.abs(a.score), where);
        if ('mate' in a) assert.ok(Number.isInteger(a.mate) && a.mate !== 0, where);
    }
    // the others come from one search without the best move, best first (the best move's score is from another search)
    for (let i = 2; i < r.alternatives.length; i++) assert.ok(r.alternatives[i - 1].score >= r.alternatives[i].score, where);
    assert.ok(!r.alternatives.slice(1).some((a) => a.uci === r.alternatives[0].uci), where);
    if (r.best !== null) assert.deepEqual([r.alternatives[0].uci, r.alternatives[0].san], [r.best.uci, r.best.san], where);
    for (const m of [...r.motifs, ...(r.best?.motifs ?? []), ...(r.refutation?.motifs ?? [])]) assert.deepEqual(sorted(m), MOTIF_FIELDS, where);
    for (const t of r.terms) assert.ok(sorted(t).join() === 'delta,key' && Number.isInteger(t.delta), where);
    if (r.refutation !== null) assert.deepEqual(sorted(r.refutation), ['line', 'motifs']);
    checkAnnotations(r.annotations, where);
    checkSteps(r.steps, where);
}

test('contract: explainMove of the best and of the first legal move in 12 positions; hints of all three steps', () => {
    let explained = 0;
    for (const fen of CORPUS.filter((_, i) => i % 5 === 0 || i % 5 === 2)) {
        const p = P.position(fen);
        if (p.status.state !== 'ongoing') continue;
        const best = P.analyze(fen, { nodes: 2000 }).lines[0].uci;
        for (const move of new Set([best, p.legal[0].uci])) {
            const r = P.explainMove(fen, move, { nodes: 3000 });
            checkExplanation(r, `${fen} ${move}`);
            plain(I.localize(r, 'ru'));
            plain(I.localize(r, 'en'));
            explained++;
        }
        for (const step of [1, 2, 3]) {
            const h = P.hint(fen, step, { nodes: 3000 });
            assert.deepEqual(
                sorted(h),
                step === 3 ? ['annotations', 'kind', 'move', 'ok', 'step', 'text'] : ['annotations', 'kind', 'ok', 'step', 'text'],
                fen,
            );
            checkText(h.text, `${fen} hint ${step}`);
            checkAnnotations(h.annotations, `${fen} hint ${step}`);
            plain(I.localize(h, 'en'));
        }
    }
    assert.ok(explained >= 12, `${explained} explained`);
});

test('contract: a review has exactly its fields, its moves and stages theirs, and steps that render', () => {
    const r = P.reviewGame('[White "A"]\n[Black "B"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 *', { nodesPerMove: 2000 });
    assert.deepEqual(sorted(r), ['accuracy', 'headers', 'keyMoments', 'kind', 'missedWins', 'moves', 'ok', 'opening', 'phases', 'steps']);
    assert.deepEqual([r.ok, r.kind], [true, 'review']);
    assert.deepEqual(r.headers, { White: 'A', Black: 'B' });
    for (const m of r.moves) {
        assert.deepEqual(sorted(m), ['best', 'class', 'loss', 'motifs', 'ply', 'san', 'uci', 'win']);
        assert.ok(m.best === null || sorted(m.best).join() === 'san,uci');
    }
    assert.deepEqual(sorted(r.accuracy), ['black', 'white']);
    assert.deepEqual(sorted(r.opening), ['eco', 'name', 'ply']);
    assert.deepEqual(sorted(r.phases), ['endgame', 'middlegame', 'opening']);
    for (const ph of Object.values(r.phases)) if (ph) assert.deepEqual(sorted(ph), ['black', 'from', 'to', 'white']);
    assert.ok(r.keyMoments.every(Number.isInteger) && r.missedWins.every(Number.isInteger));
    checkSteps(r.steps, 'review');
    plain(I.localize(r, 'ru'));
    plain(I.localize(r, 'en'));
});
