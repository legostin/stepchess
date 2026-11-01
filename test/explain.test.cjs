// explain: move classes, explainMove, reviewGame and hint — the classes and the accuracy formula, explanations built from the search and the trace, terminal positions, repetitions with the game's history, the worker.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const GAMES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'review.json'), 'utf8'));

let P; // the package
let X; // the explain unit
let I; // i18n
let M; // the board model (its annotation format)
before(async () => {
    P = await import('../src/index.js');
    X = await import('../src/explain/index.js');
    I = await import('../src/i18n/index.js');
    M = await import('../board/model.js');
});

const SCHOLAR = 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4';
// the queen takes on h7, where the rook on h8 guards the pawn
const HANGS = 'r3k2r/pp3ppp/2n5/7Q/8/2N5/PP3PPP/R5K1 w kq - 0 1';
// the white king castled long behind b2, c2, d2: stepping to d1 leaves its shelter
const CASTLED = 'r2q1rk1/ppp1bppp/2n1bn2/4p3/4P3/2N1BN2/PPPPQPPP/2K1RB1R w - - 0 10';
const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// the words that put another move above the one played
const BETTER = /Better was|Сильнее было/;
const FORK = 'r3k3/pp3ppp/8/1N6/8/8/PPP2PPP/6K1 w - - 0 1';
const MATED = 'rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3';
const STALEMATE = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
const FIFTY = '4k3/8/8/8/8/8/3R4/4K3 w - - 100 80';
const DEAD = '4k3/8/8/8/8/8/8/4KB2 w - - 0 1';
const N = 20000; // the node budget of the tests

const RULES = ['class', 'motif', 'term', 'refutation', 'best', 'answer'];
const cyr = /[А-Яа-яЁё]/;

function hasMsg(v, seen = new Set()) {
    if (v instanceof I.Msg) return true;
    if (!v || typeof v !== 'object' || seen.has(v)) return false;
    seen.add(v);
    return Object.values(v).some((x) => hasMsg(x, seen));
}

// a text renders in both languages: Russian in Cyrillic, English without it
function renders(text, where) {
    const ru = I.inLanguage(text, 'ru');
    const en = I.inLanguage(text, 'en');
    assert.ok(ru.length > 0 && en.length > 0, `${where}: empty`);
    assert.ok(!ru.includes('explain.') && !en.includes('explain.'), `${where}: a key instead of a text: ${en}`);
    assert.match(ru, cyr, `${where}: ${ru}`);
    assert.ok(!cyr.test(en), `${where}: ${en}`);
}

// every step has a title and a rule, renders in RU and EN, the last one is the final answer; annotations are in the board's format
function checkSteps(r, where) {
    assert.ok(Array.isArray(r.steps) && r.steps.length >= 1, where);
    r.steps.forEach((s, i) => {
        assert.ok(s.title, `${where} step ${i}: title`);
        assert.ok(RULES.includes(s.rule), `${where} step ${i}: rule ${s.rule}`);
        renders(s.title, `${where} step ${i} title`);
        if (s.text !== undefined) renders(s.text, `${where} step ${i} text`);
        if (s.line !== undefined) assert.ok(Array.isArray(s.line) && s.line.every((x) => typeof x === 'string'), `${where} step ${i} line`);
        if (s.annotations !== undefined) checkAnnotations(s.annotations, `${where} step ${i}`);
    });
    if (r.annotations !== undefined) checkAnnotations(r.annotations, `${where}: the result's annotations`);
    const last = r.steps[r.steps.length - 1];
    assert.equal(last.rule, 'answer', where);
    assert.equal(last.final, true, where);
    assert.equal(r.steps.filter((s) => s.final).length, 1, where);
    for (const lang of ['ru', 'en']) {
        const l = I.localize(r, lang);
        assert.ok(!hasMsg(l), `${where}: a Msg left after localize(${lang})`);
        assert.doesNotThrow(() => JSON.stringify(l));
    }
}

function checkAnnotations(a, where) {
    assert.deepEqual(Object.keys(a).sort(), ['arrows', 'badges', 'squares'], where);
    // the board takes them as they are: normalizeAnnotations drops nothing and changes nothing
    assert.deepEqual(M.normalizeAnnotations(a), a, where);
}

// --- classes and thresholds

test('classify: the thresholds are one constant, and the classes follow them', () => {
    assert.deepEqual({ ...X.CLASS_THRESHOLDS }, { best: 0.01, good: 0.05, inaccuracy: 0.1, mistake: 0.2 });
    assert.ok(Object.isFrozen(X.CLASS_THRESHOLDS));
    assert.equal(X.classify(0), 'best');
    assert.equal(X.classify(0.009), 'best');
    assert.equal(X.classify(0.01), 'good');
    assert.equal(X.classify(0.049), 'good');
    assert.equal(X.classify(0.05), 'inaccuracy');
    assert.equal(X.classify(0.099), 'inaccuracy');
    assert.equal(X.classify(0.1), 'mistake');
    assert.equal(X.classify(0.2), 'mistake');
    assert.equal(X.classify(0.21), 'blunder');
    assert.equal(X.classify(0.3, { isBest: true }), 'best');
    assert.equal(X.classify(0, { missedMate: true }), 'blunder');
    assert.equal(X.classify(0.02, { allowedMate: true }), 'blunder');
    assert.equal(X.classify(NaN), 'best');
    assert.equal(X.classify(-0.1), 'best');
});

test('accuracy: 103.1668 · e^(−0.04354 · loss%) − 3.1669, clamped to 0..100', () => {
    assert.ok(Math.abs(X.moveAccuracy(0) - 99.9999) < 1e-3);
    assert.ok(Math.abs(X.moveAccuracy(0.1) - (103.1668 * Math.exp(-0.4354) - 3.1669)) < 1e-9);
    assert.equal(X.moveAccuracy(1), 0);
    assert.equal(X.moveAccuracy(-0.5), 100);
});

// --- explainMove

test('explainMove: Qxf7# in the Scholar position is best, wins outright and says mate', () => {
    const r = P.explainMove(SCHOLAR, 'Qxf7#', { nodes: N });
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'move');
    assert.deepEqual(r.move, { uci: 'h5f7', san: 'Qxf7#' });
    assert.equal(r.class, 'best');
    assert.ok(r.winAfter > 0.999, `winAfter ${r.winAfter}`);
    assert.equal(r.loss, 0);
    assert.equal(r.refutation, null);
    assert.equal(r.best.uci, 'h5f7');
    const mates = r.motifs.filter((m) => m.kind === 'mate');
    const said = r.steps.some((s) => s.data?.checkmate === true);
    assert.ok(mates.length > 0 || said, 'a mating pattern or a checkmate step');
    assert.match(I.inLanguage(r.steps[r.steps.length - 1].title, 'en'), /mate/i);
    assert.match(I.inLanguage(r.steps[r.steps.length - 1].title, 'ru'), /мат/i);
    assert.ok(r.annotations.badges.some((b) => b.sq === 'f7' && b.glyph === '#'));
    checkSteps(r, 'scholar');
});

test('explainMove: Qxh7 into the rook is a blunder refuted by the capture, with the better move and the material lost', () => {
    const r = P.explainMove(HANGS, 'Qxh7', { nodes: N });
    assert.equal(r.ok, true);
    assert.equal(r.class, 'blunder');
    assert.ok(r.loss > X.CLASS_THRESHOLDS.mistake);
    assert.ok(r.winBefore > r.winAfter);
    assert.equal(r.refutation.line[0], 'Rxh7');
    assert.ok(r.best && r.best.uci !== 'h5h7');
    assert.ok(r.best.line.length >= 1 && r.best.line[0] === r.best.san);
    // the trace says what was lost: the material term falls for the mover
    const material = r.terms.find((t) => t.key === 'material');
    assert.ok(material && material.delta < -500, JSON.stringify(r.terms));
    const rules = r.steps.map((s) => s.rule);
    for (const rule of ['class', 'term', 'refutation', 'best', 'answer']) assert.ok(rules.includes(rule), `${rule} in ${rules}`);
    const ref = r.steps.find((s) => s.rule === 'refutation');
    assert.deepEqual(ref.line, r.refutation.line);
    assert.ok(ref.annotations.arrows.some((a) => a.from === 'h8' && a.to === 'h7' && a.kind === 'threat'));
    assert.ok(r.annotations.badges.some((b) => b.sq === 'h7' && b.glyph === '??'));
    checkSteps(r, 'blunder');
});

test('explainMove: the king stepping out of its shelter shows the pawn-shield term falling', () => {
    const r = P.explainMove(CASTLED, 'Kd1', { nodes: N });
    assert.equal(r.ok, true);
    const shield = r.terms.find((t) => t.key === 'pawn-shield');
    assert.ok(shield, JSON.stringify(r.terms));
    assert.ok(shield.delta < 0);
    assert.ok(r.terms.length <= X.EXPLAIN_LEVELS.terms);
    for (const t of r.terms) assert.ok(Number.isInteger(t.delta) && Math.abs(t.delta) >= X.EXPLAIN_LEVELS.termMin);
    const step = r.steps.find((s) => s.rule === 'term' && s.data.key === 'pawn-shield');
    assert.ok(step);
    assert.equal(step.data.delta, shield.delta);
    // a term against the verdict is said as such: the price of a sound move, what a poor one gets in return
    const sound = ['best', 'good'].includes(r.class);
    assert.match(I.inLanguage(step.text, 'en'), sound ? /price/i : /against you/);
    assert.match(I.inLanguage(step.text, 'ru'), sound ? /Цена хода/ : /против вас/);
    checkSteps(r, 'shield');
});

test('explainMove: the engine’s own move (analyze at the same nodes) is the best one, and the first alternative, never scored below another', () => {
    // the review's samples: the start position (c4 +0.12 above e4 +0.29), the Italian (Bc4 +0.15 above d4 +0.21), KQK
    // (Kb2 below Qb5+), a rook ending (Rc5 below Rd1+)
    const fens = [
        START,
        'r1bqkb1r/1ppp1ppp/p1n2n2/4p3/B3P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1',
        HANGS,
        CASTLED,
        FORK,
        'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3',
        '8/8/8/3k4/8/8/1K6/6Q1 w - - 0 1',
        '8/8/4k3/2r5/8/8/5PPP/3R2K1 w - - 0 1',
    ];
    for (const nodes of [N, 60000]) {
        for (const fen of fens) {
            const a = P.analyze(fen, { nodes });
            const r = P.explainMove(fen, a.lines[0].uci, { nodes });
            assert.equal(r.kind, 'move', fen);
            assert.equal(r.class, 'best', fen);
            assert.equal(r.alternatives[0].uci, a.lines[0].uci, fen);
            if (r.best) assert.equal(r.best.uci, a.lines[0].uci, fen);
            assert.ok(r.alternatives.length >= 2 && r.alternatives.length <= 3, fen);
            assert.equal(new Set(r.alternatives.map((x) => x.uci)).size, r.alternatives.length, `${fen}: distinct`);
            for (const alt of r.alternatives) {
                assert.ok(
                    alt.score <= r.alternatives[0].score,
                    `${fen} at ${nodes}: ${alt.san} ${alt.score} above the engine’s ${r.alternatives[0].san} ${r.alternatives[0].score}`,
                );
                assert.equal(alt.scoreWhite, P.position(fen).side === 'white' ? alt.score : -alt.score);
            }
        }
    }
});

test('explainMove: a move as good as the engine’s own is never told that another was better', () => {
    for (const move of ['e4', 'd4', 'Nf3', 'c4', 'e3']) {
        const r = P.explainMove(START, move, { nodes: N });
        const isBest = r.best.uci === r.move.uci;
        const texts = r.steps.flatMap((s) => [s.title, s.text].filter(Boolean)).map((t) => I.inLanguage(t, 'en') + ' ' + I.inLanguage(t, 'ru'));
        if (['best', 'good'].includes(r.class)) assert.ok(!texts.some((t) => BETTER.test(t)), `${move}: ${texts.join(' | ')}`);
        if (r.class === 'best' && !isBest) {
            assert.ok(!r.steps.some((s) => s.rule === 'best'), move);
            assert.match(I.inLanguage(r.steps[0].title, 'en'), /as good as the best move/);
            assert.match(I.inLanguage(r.steps[r.steps.length - 1].title, 'en'), /as good as the engine’s choice/);
            assert.ok(!/is the best move/.test(texts.join(' ')), move);
        }
        if (r.class === 'good') assert.match(I.inLanguage(r.steps.find((s) => s.rule === 'best').title, 'en'), /The engine’s choice was/);
        if (isBest) assert.ok(!r.steps.some((s) => s.rule === 'best'), move);
        checkSteps(r, `start ${move}`);
    }
});

test('explainMove: the same input gives the same answer; moves in any notation', () => {
    const a = P.explainMove(HANGS, 'Qxh7', { nodes: N });
    const b = P.explainMove(HANGS, 'h5h7', { nodes: N });
    const c = P.explainMove(HANGS, 'Фxh7', { nodes: N });
    assert.deepEqual(I.localize(a, 'en'), I.localize(b, 'en'));
    assert.deepEqual(I.localize(a, 'ru'), I.localize(c, 'ru'));
});

test('explainMove, hint: terminal positions are terminal results with the reason; bad input is invalid', () => {
    for (const [fen, state] of [
        [MATED, 'checkmate'],
        [STALEMATE, 'stalemate'],
        [FIFTY, 'fifty'],
        [DEAD, 'insufficient'],
    ]) {
        for (const r of [P.explainMove(fen, 'e4', { nodes: N }), P.hint(fen, 1, { nodes: N })]) {
            assert.deepEqual([r.ok, r.kind, r.state], [true, 'terminal', state], fen);
            assert.ok(r.reason instanceof I.Msg);
        }
    }
    assert.deepEqual([P.explainMove('nonsense', 'e4').kind, P.explainMove('nonsense', 'e4').code], ['invalid', 'fen']);
    const illegal = P.explainMove(SCHOLAR, 'Ke3');
    assert.deepEqual([illegal.ok, illegal.kind, illegal.code], [false, 'invalid', 'move']);
    for (const bad of [undefined, null, 42, {}, '']) assert.equal(P.explainMove(SCHOLAR, bad, { nodes: N }).kind, 'invalid');
    assert.doesNotThrow(() => P.explainMove(SCHOLAR, 'Qxf7#', 'sloppy options'));
    for (const step of [0, 4, 'two', null, 1.5]) {
        const r = P.hint(FORK, step, { nodes: N });
        assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'step'], String(step));
        renders(r.reason, 'step reason');
    }
    assert.equal(P.hint('x', 1).code, 'fen');
});

// --- hint

test('hint: step 1 names the piece and the area without the move, step 2 what to look for, step 3 the move', () => {
    const h1 = P.hint(FORK, 1, { nodes: N });
    const h2 = P.hint(FORK, 2, { nodes: N });
    const h3 = P.hint(FORK, 3, { nodes: N });
    for (const [h, step] of [
        [h1, 1],
        [h2, 2],
        [h3, 3],
    ]) {
        assert.deepEqual([h.ok, h.kind, h.step], [true, 'hint', step]);
        renders(h.text, `hint ${step}`);
        checkAnnotations(h.annotations, `hint ${step}`);
    }
    const en1 = I.inLanguage(h1.text, 'en');
    const ru1 = I.inLanguage(h1.text, 'ru');
    assert.match(en1, /knight/i);
    assert.match(ru1, /конь|коня|конём/i);
    for (const t of [en1, ru1]) assert.ok(!/c7|Nc7|Кc7/.test(t), t);
    assert.equal(h1.move, undefined);
    assert.equal(h2.move, undefined);
    assert.ok(!h1.annotations.arrows.length && !h2.annotations.arrows.length, 'no arrow gives the move away');
    assert.match(I.inLanguage(h2.text, 'en'), /fork/i);
    assert.match(I.inLanguage(h2.text, 'ru'), /вилк/i);
    assert.deepEqual(h3.move, { uci: 'b5c7', san: 'Nc7+' });
    assert.ok(I.inLanguage(h3.text, 'en').includes('Nc7+'));
    assert.ok(I.inLanguage(h3.text, 'ru').includes('Кc7+'));
    assert.ok(h3.annotations.arrows.some((a) => a.from === 'b5' && a.to === 'c7' && a.kind === 'best'));
});

// --- the final review's findings: decisive moves, refutations, threats, history, limits

// the texts of a result's steps in both languages, one string per step
const stepTexts = (r) => r.steps.map((s) => ['ru', 'en'].map((l) => `${I.inLanguage(s.title, l)} ${s.text ? I.inLanguage(s.text, l) : ''}`).join(' | '));
// the review's positions: the Scholar's-mate blunder, a missed mate in one, a back rank given away, a promotion
const SCHOLAR_THREAT = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
const BACK_RANK = '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1';
const GIVES_RANK = 'r5k1/5ppp/8/8/8/8/5PPP/4R1K1 b - - 0 1';
const PROMOTES = '8/4P3/8/8/8/2k5/8/4K3 w - - 0 1';
// Nf6+ gxf6 Bxf7#: a mate in 2
const MATE_IN_2 = 'r2qkb1r/pp2nppp/3p4/2pNN1B1/2BnP3/3P4/PPP2PPP/R2bK2R w KQkq - 1 1';

test('explainMove: a move that allows, misses or forces a mate has no term steps and no terms (I2)', () => {
    for (const [fen, move, what] of [
        [SCHOLAR_THREAT, 'Nf6', 'allows mate'],
        [GIVES_RANK, 'Ra2', 'allows mate'],
        [BACK_RANK, 'Kf1', 'misses a mate'],
        [MATE_IN_2, 'Nf6+', 'forces a mate'],
        [PROMOTES, 'e8=Q', 'forces a mate (seen at 300000 nodes)'],
        [SCHOLAR, 'Qxf7#', 'mates'],
    ]) {
        const r = P.explainMove(fen, move, { nodes: fen === PROMOTES ? 300000 : N });
        assert.equal(r.kind, 'move', `${move}: ${what}`);
        assert.deepEqual(r.terms, [], `${move}: ${what}`);
        assert.ok(!r.steps.some((s) => s.rule === 'term'), `${move} (${what}): ${stepTexts(r).join(' / ')}`);
        for (const t of stepTexts(r)) assert.ok(!/Кое-что взамен|Something in return|Цена хода|price of the move/.test(t), t);
        checkSteps(r, move);
    }
});

test('explainMove: a promotion never pays a price in the passed-pawn term; its fall is part of the material (I2)', () => {
    // queens with no forced mate in sight: the terms are weighed
    for (const [fen, move] of [
        ['k7/3P4/8/8/8/8/r5PP/6K1 w - - 0 1', 'd8=Q+'],
        ['1r4k1/P5pp/8/8/8/8/6PP/6K1 w - - 0 1', 'axb8=Q+'],
    ]) {
        const r = P.explainMove(fen, move, { nodes: N });
        assert.equal(r.kind, 'move', move);
        assert.ok(!r.terms.some((t) => t.key === 'passed-pawn' && t.delta < 0), `${move}: ${JSON.stringify(r.terms)}`);
        for (const s of r.steps.filter((x) => x.rule === 'term')) assert.ok(s.data.key !== 'passed-pawn' || s.data.delta > 0, move);
    }
});

test('explainMove: the refutation title is earned; a missed mate is the step of the mate, the rest the best answer (I5)', () => {
    // a missed mate in one, still winning: about the mate, never "refutes"
    const missed = P.explainMove(BACK_RANK, 'Kf1', { nodes: N });
    const step = missed.steps.find((s) => s.rule === 'refutation');
    assert.ok(step, 'a step for the reply');
    assert.equal(I.inLanguage(step.title, 'ru'), 'Мат в 1 ход упущен');
    assert.equal(I.inLanguage(step.title, 'en'), 'The mate in 1 move slips away');
    assert.equal(step.data.refutes, false);
    assert.ok(!stepTexts(missed).some((t) => /опровергает|refutes/.test(t)), stepTexts(missed).join(' / '));
    // a blunder is refuted
    const lost = P.explainMove(HANGS, 'Qxh7', { nodes: N });
    const r = lost.steps.find((x) => x.rule === 'refutation');
    assert.equal(I.inLanguage(r.title, 'ru'), 'Ответ Лxh7 опровергает ход');
    assert.equal(r.data.refutes, true);
    // the rule itself, on the classes a few positions give; at least one inaccuracy that keeps the position is only answered
    let answered = 0;
    for (const [fen, move] of [
        [START, 'a4'],
        [START, 'g4'],
        ['r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 2', 'Nd4'],
        [HANGS, 'Qe2+'],
        [HANGS, 'Kf1'],
        [HANGS, 'Qg4'],
    ]) {
        const x = P.explainMove(fen, move, { nodes: N });
        const s = x.steps.find((y) => y.rule === 'refutation');
        if (!s) continue;
        const earned = !x.steps[0].data.missedMate && (x.class === 'mistake' || x.class === 'blunder');
        assert.equal(s.data.refutes, earned, `${move}: ${x.class} ${x.winBefore} → ${x.winAfter}`);
        assert.equal(/опровергает/.test(I.inLanguage(s.title, 'ru')), earned, `${move}: ${I.inLanguage(s.title, 'ru')}`);
        if (!earned) {
            answered++;
            assert.match(I.inLanguage(s.title, 'ru'), /^Лучший ответ противника: /);
            assert.match(I.inLanguage(s.title, 'en'), /^The opponent’s best answer: /);
        }
    }
    assert.ok(answered >= 1, 'an inaccuracy that is only answered');
    // an inaccuracy that crosses 50% is still only answered: a loss of 6 or 7% refutes nothing
    for (const [fen, move] of [
        ['r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 3 2', 'Nd4'],
        ['rnbqkbnr/ppp2ppp/8/3pp3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3', 'Qh5'],
    ]) {
        const x = P.explainMove(fen, move, { nodes: 300000 });
        assert.equal(x.class, 'inaccuracy', move);
        assert.ok(x.winBefore >= 0.5 && x.winAfter < 0.5, `${move}: ${x.winBefore} → ${x.winAfter} crosses 50%`);
        const s = x.steps.find((y) => y.rule === 'refutation');
        assert.equal(s.data.refutes, false, move);
        assert.match(I.inLanguage(s.title, 'ru'), /^Лучший ответ противника: /, move);
        assert.match(I.inLanguage(s.title, 'en'), /^The opponent’s best answer: /, move);
    }
});

test('hint: a mate threat is named with its move and the defence follows, never "no tactic here" (I3)', () => {
    const h2 = P.hint(SCHOLAR_THREAT, 2, { nodes: N });
    const h3 = P.hint(SCHOLAR_THREAT, 3, { nodes: N });
    assert.equal(I.inLanguage(h2.text, 'ru'), 'Противник угрожает поставить мат ходом Фxf7#: ищите защиту.');
    assert.equal(I.inLanguage(h2.text, 'en'), 'Your opponent threatens mate with Qxf7#: look for a defence.');
    assert.ok(
        h2.annotations.arrows.some((a) => a.from === 'h5' && a.to === 'f7' && a.kind === 'threat'),
        'the threat is drawn',
    );
    assert.match(I.inLanguage(h3.text, 'ru'), /Он отражает угрозу Фxf7#\./);
    assert.match(I.inLanguage(h3.text, 'en'), /It meets the threat of Qxf7#\./);
    // after the defence there is no mate
    const after = P.explainMove(SCHOLAR_THREAT, h3.move.uci, { nodes: N });
    assert.ok(!after.steps[0].data.allowedMate, h3.move.san);
    // a threat to win a piece: named with the piece
    const piece = 'rnbqkb1r/pppp1ppp/5n2/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3';
    const t2 = P.hint(piece, 2, { nodes: N });
    assert.equal(I.inLanguage(t2.text, 'ru'), 'Противник угрожает ходом exf6 выиграть коня: ищите защиту.');
    assert.equal(I.inLanguage(t2.text, 'en'), 'Your opponent threatens to win the knight with exf6: look for a defence.');
    assert.match(I.inLanguage(P.hint(piece, 3, { nodes: N }).text, 'ru'), /Он отражает угрозу exf6\./);
    for (const fen of [SCHOLAR_THREAT, piece]) assert.ok(!/Тактики здесь нет/.test(I.inLanguage(P.hint(fen, 2, { nodes: N }).text, 'ru')));
});

test('hint: a positional idea is not sold as a tactic, the names are quoted, a pawn is not a «фигура», a mate has no plan (I2, I3, M1)', () => {
    // a king walk in a pawn ending: a positional motif leads
    const h = P.hint('8/5k2/8/8/3P4/8/8/K7 w - - 0 1', 2, { nodes: N });
    assert.match(I.inLanguage(h.text, 'ru'), /^Подумайте о позиционной идее: «Активизация короля»\./);
    assert.match(I.inLanguage(h.text, 'en'), /^Think of a positional idea: “King activation”\./);
    assert.ok(!/тактический приём|tactic/.test(I.inLanguage(h.text, 'ru') + I.inLanguage(h.text, 'en')));
    // a tactic is a tactic, its name in quotes
    assert.match(I.inLanguage(P.hint(FORK, 2, { nodes: N }).text, 'ru'), /^Ищите тактический приём: «Вилка»\./);
    // step 1 of a pawn move: no «фигура» for a pawn
    const p1 = P.hint(START, 1, { nodes: N });
    assert.match(I.inLanguage(p1.text, 'ru'), /^Присмотритесь: пешка на [a-h]2\. Где искать: /);
    assert.ok(!/фигур/.test(I.inLanguage(p1.text, 'ru')));
    // a term the best move improves, its name quoted
    assert.match(I.inLanguage(P.hint(START, 2, { nodes: N }).text, 'ru'), /^Подумайте о слагаемом оценки «[^»]+»: лучший ход его улучшает\.$/);
    // a mate in one: the move and the mate, no term of the evaluation
    const m3 = P.hint(SCHOLAR, 3, { nodes: N });
    assert.equal(I.inLanguage(m3.text, 'ru'), 'Ход: Фxf7#. Он матует в 1 ход.');
    assert.equal(I.inLanguage(m3.text, 'en'), 'The move: Qxf7#. It mates in 1 move.');
    // a pawnless ending: no open file, and its check is not called a quiet move
    const k2 = P.hint('8/8/8/4k3/8/8/2N5/R3K3 w - - 0 1', 2, { nodes: N });
    const k3 = P.hint('8/8/8/4k3/8/8/2N5/R3K3 w - - 0 1', 3, { nodes: N });
    assert.ok(!/Открытая линия/.test(I.inLanguage(k2.text, 'ru')), I.inLanguage(k2.text, 'ru'));
    if (k3.move.san.endsWith('+')) assert.ok(!/спокойный ход/.test(I.inLanguage(k2.text, 'ru')), I.inLanguage(k2.text, 'ru'));
});

test('explainMove, hint, alternatives: the length of a mate is the same everywhere (M2)', () => {
    for (const [fen, move, nodes] of [
        [BACK_RANK, 'Re8#', N],
        [MATE_IN_2, 'Nf6+', N],
        [PROMOTES, 'e8=Q', 300000],
    ]) {
        const r = P.explainMove(fen, move, { nodes });
        const h = P.hint(fen, 2, { nodes });
        const said = /(?:форсирует мат|матует) в (\d+)|мат: партия/.exec(I.inLanguage(r.steps[0].text, 'ru'));
        assert.ok(said, `${move}: ${I.inLanguage(r.steps[0].text, 'ru')}`);
        const n = said[1] ? Number(said[1]) : 1;
        assert.equal(r.alternatives[0].mate, n, `${move}: the first alternative`);
        const hinted = /мат в (\d+)/.exec(I.inLanguage(h.text, 'ru'));
        if (hinted) assert.equal(Number(hinted[1]), n, `${move}: the hint`);
    }
});

test('explainMove: a position the tables call drawn is said to be a draw, not 50% (M2)', async () => {
    await P.preloadTables(['KPK']);
    const kept = P.explainMove('8/3k4/8/3K4/3P4/8/8/8 w - - 0 1', 'Kc5', { nodes: N });
    assert.equal(I.inLanguage(kept.steps[0].text, 'ru'), 'По таблицам эндшпиля позиция ничейная: ход сохраняет ничью.');
    assert.equal(I.inLanguage(kept.steps[0].text, 'en'), 'By the endgame tablebases the position is a draw, and the move keeps the draw.');
    const lost = P.explainMove('4k3/8/4K3/4P3/8/8/8/8 w - - 0 1', 'Kf5', { nodes: N });
    assert.equal(lost.class, 'blunder');
    const ru = I.inLanguage(lost.steps[0].text, 'ru');
    assert.match(ru, /^Ваши шансы на победу: 100% при лучшем ходе, а после этого хода позиция по таблицам эндшпиля ничейная\./);
    assert.ok(!/50%/.test(ru.split('.')[0]), ru);
});

test('explainMove, hint: the game history counts, the third repetition is said; bad moves are invalid (I4)', () => {
    // after Ra5+ with this history the position occurs for the third time
    const Q = '8/8/8/R2k4/8/8/2N5/4K3 b - - 1 40';
    const P0 = '8/8/8/3k4/8/8/2N5/R3K3 w - - 0 40';
    const toP0 = ['d5d6', 'a5a1', 'd6d5', 'a1a5', 'd5d6', 'a5a1', 'd6d5'];
    const r = P.explainMove(Q, 'Ra5+', { nodes: N, moves: toP0 });
    assert.equal(r.kind, 'move');
    assert.equal(I.inLanguage(r.steps[0].text, 'ru'), 'Позиция повторяется в третий раз: любой из игроков может потребовать ничью.');
    assert.equal(I.inLanguage(r.steps[0].text, 'en'), 'The position occurs for the third time: either player can claim a draw.');
    assert.equal(r.winAfter, 0.5);
    assert.notEqual(r.class, 'best', 'the repetition throws the win away');
    // without the history the same move is the engine's own and wins
    const plain = P.explainMove(P0, 'Ra5+', { nodes: N });
    assert.ok(plain.winAfter > 0.9);
    // the hint sees the history as well: the winning side is not sent into the repetition
    const h = P.hint(Q, 3, { nodes: N, moves: toP0 });
    assert.notEqual(h.move.uci, 'a1a5');
    for (const bad of ['e2e4', 42, { a: 1 }, null]) {
        for (const x of [P.explainMove(Q, 'Kd6', { nodes: N, moves: bad }), P.hint(Q, 1, { nodes: N, moves: bad })]) {
            assert.deepEqual([x.ok, x.kind, x.code], [false, 'invalid', 'moves'], String(bad));
            renders(x.reason, 'moves reason');
        }
    }
    // a move of the history that cannot be played is the move error, with its cause
    const wrong = P.explainMove(Q, 'Kd6', { nodes: N, moves: ['Ke1'] });
    assert.deepEqual([wrong.kind, wrong.code, wrong.cause], ['invalid', 'move', 'illegal']);
    // a game the history ends is a terminal result
    const over = P.hint(P0, 1, { moves: ['a1a5', ...toP0] });
    assert.deepEqual([over.kind, over.state], ['terminal', 'threefold']);
});

test('explainMove, hint: nodes are capped at EXPLAIN_MAX_NODES and movetime bounds every search (M5)', () => {
    const seen = [];
    class Spy extends P.Searcher {
        search(pos, limits) {
            seen.push({ nodes: limits.nodes, movetime: limits.movetime });
            return super.search(pos, { ...limits, nodes: Math.min(limits.nodes, 3000) });
        }
    }
    const spy = new Spy();
    const pos = P.Position.fromFen(START);
    X.explainMove(pos, P.parseMove(pos, 'e4'), { nodes: 1e12, movetime: 40, searcher: spy });
    X.hint(pos, 3, { nodes: 1e12, movetime: 40, searcher: spy });
    assert.ok(seen.length >= 5, `${seen.length} searches`);
    assert.equal(X.EXPLAIN_MAX_NODES, 5000000);
    for (const l of seen) assert.ok(l.nodes <= X.EXPLAIN_MAX_NODES, `${l.nodes}`);
    // every search at the full budget is capped and timed (the zugzwang probes are small by themselves)
    const full = seen.filter((l) => l.nodes > 50000);
    assert.ok(
        full.every((l) => l.movetime === 40),
        JSON.stringify(seen),
    );
    assert.ok(full.filter((l) => l.nodes === X.EXPLAIN_MAX_NODES).length >= 5, JSON.stringify(seen));
    // through the API: a huge budget with a time limit ends quickly
    const t0 = Date.now();
    const r = P.explainMove(START, 'e4', { nodes: 1e9, movetime: 30 });
    const h = P.hint(START, 3, { nodes: 1e9, movetime: 30 });
    assert.deepEqual([r.kind, h.kind], ['move', 'hint']);
    assert.ok(Date.now() - t0 < 10000, `${Date.now() - t0} ms`);
});

test('the API keeps no searcher of another size than the default between calls (M12)', async () => {
    const A = await import('../src/api.js');
    P.analyze(START, { nodes: 2000 });
    assert.deepEqual(A.sharedSearcher(), { hashMb: 16 });
    P.analyze(START, { nodes: 2000, hashMb: 64 });
    assert.equal(A.sharedSearcher(), null);
    P.explainMove(START, 'e4', { nodes: 2000, hashMb: 32 });
    assert.equal(A.sharedSearcher(), null);
    P.hint(START, 1, { nodes: 2000 });
    assert.deepEqual(A.sharedSearcher(), { hashMb: 16 });
});

test('an invalid move says why: cause syntax, ambiguous or illegal; the ambiguity in each language’s SAN (L156, M7)', () => {
    const two = '4k3/8/8/8/8/8/8/1N2KN2 w - - 0 1';
    const amb = P.explainMove(two, 'Nd2', { nodes: N });
    assert.deepEqual([amb.code, amb.cause], ['move', 'ambiguous']);
    assert.equal(I.inLanguage(amb.reason, 'ru'), 'Ход «Nd2» подходит нескольким фигурам: Кbd2, Кfd2.');
    assert.equal(I.inLanguage(amb.reason, 'en'), 'The move “Nd2” fits several pieces: Nbd2, Nfd2.');
    assert.equal(P.explainMove(two, 'Nd5', { nodes: N }).cause, 'illegal');
    assert.equal(P.explainMove(two, 'zz9', { nodes: N }).cause, 'syntax');
    assert.equal(P.analyze(two, { moves: ['Nd2'] }).cause, 'ambiguous');
    assert.equal(P.explainMove('x', 'e4').cause, undefined);
});

// --- reviewGame

test('reviewGame: the 40-move fixture marks the known blunder, accuracy is the mean of the formula, phases and opening', () => {
    const g = GAMES.blunder;
    const r = P.reviewGame(g.pgn, { nodesPerMove: 8000 });
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'review');
    assert.equal(r.headers.Event, 'stepchess fixture: a blunder at ply 42');
    assert.equal(r.moves.length, 80);
    const m = r.moves[g.ply - 1];
    assert.deepEqual([m.ply, m.san, m.class], [g.ply, g.san, 'blunder']);
    assert.ok(m.best && m.best.uci !== m.uci);
    r.moves.forEach((x, i) => {
        assert.equal(x.ply, i + 1);
        assert.ok(['best', 'good', 'inaccuracy', 'mistake', 'blunder'].includes(x.class));
        assert.ok(x.loss >= 0 && x.loss <= 1 && x.win >= 0 && x.win <= 1);
        assert.ok(Array.isArray(x.motifs) && x.motifs.every((k) => typeof k === 'string'));
    });
    for (const side of ['white', 'black']) {
        const a = r.accuracy[side];
        assert.ok(a >= 0 && a <= 100, `${side} ${a}`);
        const own = r.moves.filter((x) => (x.ply % 2 === 1) === (side === 'white'));
        const mean = own.reduce((s, x) => s + X.moveAccuracy(x.loss), 0) / own.length;
        assert.ok(Math.abs(a - mean) <= 0.05, `${side}: ${a} vs ${mean}`);
    }
    assert.ok(r.keyMoments.includes(g.ply), `key moments ${r.keyMoments}`);
    assert.ok(r.keyMoments.every((p, i, a) => i === 0 || a[i - 1] < p));
    assert.ok(Array.isArray(r.missedWins));
    assert.equal(r.opening.eco[0], 'D');
    assert.ok(r.opening.name instanceof I.Msg);
    assert.ok(r.opening.ply >= 2);
    const { opening, middlegame } = r.phases;
    assert.equal(opening.from, 1);
    assert.ok(opening.to >= 2 && opening.to <= 20, `opening ends at ${opening.to}`);
    assert.equal(middlegame.from, opening.to + 1);
    for (const ph of Object.values(r.phases)) if (ph) assert.ok(ph.white === null || (ph.white >= 0 && ph.white <= 100));
    // the stages are named by their first and last moves, so neighbours never share a boundary: '5. a3' then '5... Be7'
    const stageText = I.inLanguage(r.steps.find((s) => s.data?.phases).text, 'en');
    const label = (ply) => `${Math.ceil(ply / 2)}${ply % 2 ? '.' : '...'} ${r.moves[ply - 1].san}`;
    for (const p of [opening.from, opening.to, middlegame.from]) assert.ok(stageText.includes(label(p)), `${label(p)} in ${stageText}`);
    checkMoments(r, 'review');
    checkSteps(r, 'review');
});

// a key moment is a drop of the mover's own chances: never the engine's own move, and only an error is told "Better was"
function checkMoments(r, where) {
    for (const p of r.keyMoments) {
        const m = r.moves[p - 1];
        assert.ok(m.best === null || m.best.uci !== m.uci, `${where}: key moment ${p} is the engine's own move`);
        // a large drop, or a blunder about a mate (whose drop may be small)
        assert.ok(m.loss >= X.EXPLAIN_LEVELS.swing || m.class === 'blunder', `${where}: key moment ${p} loses ${m.loss}`);
    }
    for (const m of r.moves) if (m.best && m.best.uci === m.uci) assert.equal(m.loss, 0, `${where}: the engine's move at ${m.ply} loses`);
    for (const s of r.steps.filter((x) => x.rule === 'best')) {
        const m = r.moves[s.data.ply - 1];
        const text = `${I.inLanguage(s.text, 'en')} ${I.inLanguage(s.text, 'ru')}`;
        if (['best', 'good'].includes(m.class)) assert.ok(!BETTER.test(text), `${where}: ${text}`);
    }
}

test('reviewGame: a won position thrown away is a missed win; a game from a set-up position has no opening without the book', () => {
    const r = P.reviewGame(`[FEN "${HANGS}"]\n\n1. Qxh7 Rxh7 2. Re1+ Kf8 *`, { nodesPerMove: 6000 });
    assert.equal(r.ok, true);
    assert.deepEqual(r.missedWins, [1]);
    assert.deepEqual(r.keyMoments, [1]);
    assert.equal(r.moves[0].class, 'blunder');
    assert.equal(r.opening, null);
    assert.equal(r.phases.opening, null);
    assert.equal(r.phases.middlegame.from, 1);
    checkMoments(r, 'missed win');
    checkSteps(r, 'missed win');
});

test('reviewGame: repetitions count with the game history — the move that lets the opponent repeat throws the win away', () => {
    // White is a queen up; the kings walk e1-e2 and e8-e7, and every return gives Black the repetition
    const pgn = '[FEN "4k3/pp6/8/8/8/8/PP6/Q3K3 w - - 0 1"]\n\n1. Ke2 Ke7 2. Ke1 Ke8 3. Ke2 Ke7 4. Ke1 Ke8 *';
    const r = P.reviewGame(pgn, { nodesPerMove: 6000 });
    assert.equal(r.ok, true);
    const last = r.moves[r.moves.length - 1];
    assert.equal(last.win, 0.5, 'the third repetition is a draw');
    const white = r.moves.filter((x) => x.ply % 2 === 1 && x.ply >= 3);
    assert.ok(
        white.some((x) => x.class === 'blunder'),
        white.map((x) => `${x.san}:${x.class}`),
    );
    // without the history the same move from the same FEN loses nothing
    const alone = P.explainMove('4k3/pp6/8/8/8/8/PP6/Q3K3 w - - 0 1', 'Ke2', { nodes: 6000 });
    assert.ok(['best', 'good'].includes(alone.class), alone.class);
});

test('reviewGame: a 220-ply game completes with 5000 nodes per move and reports progress monotonically', () => {
    const seen = [];
    const t0 = Date.now();
    const r = P.reviewGame(GAMES.long.pgn, { nodesPerMove: 5000, onProgress: (p) => seen.push(p) });
    const ms = Date.now() - t0;
    assert.equal(r.ok, true);
    assert.equal(r.moves.length, 220);
    assert.ok(seen.length >= 220, `${seen.length} reports`);
    for (let i = 0; i < seen.length; i++) {
        assert.equal(seen[i].total, 220);
        if (i) assert.ok(seen[i].done > seen[i - 1].done);
    }
    assert.equal(seen[seen.length - 1].done, 220);
    const stages = Object.values(r.phases).filter(Boolean);
    assert.equal(stages[0].from, 1);
    assert.equal(stages[stages.length - 1].to, 220);
    for (let i = 1; i < stages.length; i++) assert.equal(stages[i].from, stages[i - 1].to + 1);
    assert.ok(ms < 30000, `${ms} ms`);
    checkMoments(r, 'long review');
    checkSteps(r, 'long review');
});

test('reviewGame: a blunder that allows a mate is a key moment however small its drop, and says the mate (M11)', () => {
    const OPERA =
        '1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0';
    const r = P.reviewGame(OPERA, { nodesPerMove: N });
    const m = r.moves[29];
    assert.equal(m.san, 'Nxd7');
    assert.equal(m.class, 'blunder');
    assert.ok(m.loss < X.EXPLAIN_LEVELS.swing, `a small drop: ${m.loss}`);
    assert.ok(r.keyMoments.includes(30), `${r.keyMoments}`);
    const step = r.steps.find((s) => s.data?.ply === 30);
    assert.match(I.inLanguage(step.text, 'ru'), /Теперь противник форсированно матует в 2 хода\./);
    assert.match(I.inLanguage(step.text, 'en'), /Now the opponent mates by force in 2 moves\./);
    // every blunder the summary counts can be found among the key moments
    for (const x of r.moves) if (x.class === 'blunder') assert.ok(r.keyMoments.includes(x.ply), `${x.ply} ${x.san}`);
    checkMoments(r, 'opera');
});

test('reviewGame: a game longer than 600 plies is the invalid code limit, at once (M6)', () => {
    let pgn = '';
    for (let i = 1; i <= 301; i++) pgn += `${i}. ${i % 2 ? 'Nf3 Nf6' : 'Ng1 Ng8'} `;
    const t0 = Date.now();
    const r = P.reviewGame(`${pgn}*`, { nodesPerMove: 150000 });
    assert.deepEqual([r.ok, r.kind, r.code], [false, 'invalid', 'limit']);
    assert.equal(I.inLanguage(r.reason, 'ru'), 'Партия слишком длинная: разбираются партии не длиннее 600 полуходов.');
    assert.ok(Date.now() - t0 < 2000, `${Date.now() - t0} ms`);
    // 600 plies are still reviewed
    const ok = P.reviewGame(`${pgn.split(' 301. ')[0]} *`, { nodesPerMove: 200 });
    assert.equal(ok.kind, 'review');
    assert.equal(ok.moves.length, 600);
});

test('reviewGame: hostile PGN is invalid, a game that ends in mate reviews, a throwing onProgress does not stop it', () => {
    for (const bad of [undefined, 42, '1. e4 e5 2. Ke3', '[Event "x"', '']) {
        const r = P.reviewGame(bad, { nodesPerMove: 1000 });
        assert.deepEqual([r.ok, r.kind], [false, 'invalid'], String(bad));
        assert.ok(r.reason instanceof I.Msg);
    }
    const r = P.reviewGame('1. f3 e5 2. g4 Qh4# 0-1', {
        nodesPerMove: 2000,
        onProgress: () => {
            throw new Error('a bad callback');
        },
    });
    assert.equal(r.ok, true);
    assert.equal(r.moves.length, 4);
    assert.equal(r.moves[3].win, 0);
    assert.equal(r.moves[3].class, 'best');
    assert.equal(r.moves[2].class, 'blunder');
    checkSteps(r, 'fool');
});

// --- the package and the worker

test('opponentMove is wired once into the package', () => {
    const r = P.opponentMove({ elo: 1500, seed: 3 }, 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
    assert.deepEqual([r.ok, r.kind], [true, 'move']);
    assert.equal(P.opponentMove({ elo: 1500 }, MATED).kind, 'terminal');
    assert.equal(P.opponentMove({ elo: 1500 }, 'x').kind, 'invalid');
});

test('client: explainMove, reviewGame (with onProgress) and hint work through the worker', async () => {
    const engine = P.createEngine();
    try {
        const e = await engine.explainMove(HANGS, 'Qxh7', { nodes: N });
        assert.equal(e.class, 'blunder');
        assert.deepEqual(I.localize(e, 'en'), I.localize(P.explainMove(HANGS, 'Qxh7', { nodes: N }), 'en'));
        const seen = [];
        const r = await engine.reviewGame('1. e4 e5 2. Nf3 Nc6 *', { nodesPerMove: 2000, onProgress: (p) => seen.push(p.done) });
        assert.equal(r.kind, 'review');
        assert.deepEqual(seen, [1, 2, 3, 4]);
        const h = await engine.hint(FORK, 3, { nodes: N });
        assert.equal(h.move.san, 'Nc7+');
        assert.ok(h.text instanceof I.Msg);
    } finally {
        engine.terminate();
    }
});

test('the English relative pin says the piece behind comes under attack, not that it is lost (M10)', async () => {
    const { default: en } = await import('../src/i18n/en/explain.js');
    const { default: ru } = await import('../src/i18n/ru/explain.js');
    const pin = en.motif['pin-relative'];
    for (const text of [pin.say, pin.about]) {
        assert.match(text, /comes under attack/);
        assert.doesNotMatch(text, /is lost|falls/);
    }
    assert.match(ru.motif['pin-relative'].say, /под боем/);
});

test('a hint that says there is material to win names the material at step 3', async () => {
    const P = await import('../src/index.js');
    const fen = 'rnbqkbnr/ppp2ppp/8/3pp3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 3'; // exd5 wins a pawn
    const two = P.localize(P.hint(fen, 2, { nodes: 100000 }), 'en');
    assert.equal(two.text, 'There is material to win.');
    const three = P.localize(P.hint(fen, 3, { nodes: 100000 }), 'en');
    assert.match(three.text, /^The move: exd5\. It improves the “Material” term of the evaluation: \+\d/);
});

test('explainMove: a position the tables know has no evaluation-term steps, the table decides', async () => {
    // a pawn ending converts to a queen ending: load both, as a page with the shipped tables has them; at the end of the
    // file, so the tests above run without these tables
    await P.preloadTables(['KPK', 'KQK']);
    // d6 keeps a draw the tables know: before, the pst, king-activity and passed-pawn terms were said after it
    for (const [fen, move] of [
        ['8/5k2/8/3P4/8/8/5K2/8 w - - 0 1', 'd6'],
        ['8/3k4/8/3K4/3P4/8/8/8 w - - 0 1', 'Kc5'],
        ['8/8/4k3/8/3K4/3P4/8/8 w - - 0 1', 'Kc5'],
    ]) {
        const x = P.explainMove(fen, move, { nodes: N });
        assert.equal(x.kind, 'move', move);
        assert.deepEqual(x.terms, [], `${fen} ${move}`);
        assert.ok(!x.steps.some((y) => y.rule === 'term'), `${fen} ${move}: ${stepTexts(x).join(' / ')}`);
    }
});

test('hint: step 3 claims a defence only when the move meets the threat; a threat it leaves is said plainly (N1)', async () => {
    const P = await import('../src/index.js');
    // Nxf8 wins the exchange, and Nfxe3 is still Black's best answer: the move does not meet that threat
    const fen = 'r2q1rk1/pppbppbN/6p1/2Pp4/3P2nB/4P1P1/PP3PBP/R2Q1nK1 w - - 0 1';
    const h = P.hint(fen, 3, { nodes: 300000 });
    assert.equal(h.move.san, 'Nxf8');
    const ru = P.localize(h.text, 'ru');
    const en = P.localize(h.text, 'en');
    assert.doesNotMatch(ru, /отражает угрозу/, ru);
    assert.doesNotMatch(en, /meets the threat/, en);
    assert.match(ru, /Угроза Кfxe3 остаётся, но этот ход сильнее защиты\./, ru);
    assert.match(en, /The threat of Nfxe3 remains, but this move is stronger than a defence\./, en);
    const two = P.localize(P.hint(fen, 2, { nodes: 300000 }).text, 'ru');
    assert.doesNotMatch(two, /ищите защиту/, two);
    // a move that does meet its threat still says so
    const met = P.localize(P.hint('rnbqkb1r/pppp1ppp/5n2/4P3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 3', 3, { nodes: 300000 }).text, 'ru');
    assert.match(met, /Он отражает угрозу exf6\./, met);
});
