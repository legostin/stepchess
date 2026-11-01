// puzzles: verifyPuzzle (valid puzzles, the issues it names and where), solveMate (exhaustive, with a cook) and findPuzzles (a blunder and its tactic), plus hostile input.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const FX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'puzzles.json'), 'utf8'));
const NODES = 60000; // enough for the shallow tactics here, and quick

let P;
let C;
let S;
let V;
let EV;
let M;
before(async () => {
    V = await import('../src/puzzles/verify.js');
    M = await import('../src/puzzles/mate.js');
    EV = await import('../src/eval/index.js');
    P = await import('../src/puzzles/index.js');
    C = await import('../src/core/index.js');
    S = await import('../src/search/index.js');
});

const codes = (r) => r.issues.map((i) => `${i.ply}:${i.code}`);
const isInvalid = (r) => r.ok === false && r.kind === 'invalid' && typeof r.code === 'string' && r.reason && typeof r.reason.en === 'string';
const uci = (m) => C.moveToUci(m);

test('the unit exports verifyPuzzle, solveMate and findPuzzles', () => {
    for (const name of ['verifyPuzzle', 'solveMate', 'findPuzzles']) assert.equal(typeof P[name], 'function', name);
});

test('verifyPuzzle: a back-rank mate in 2 is valid, with mate themes and a rating', () => {
    const r = P.verifyPuzzle(FX.backRank, { nodes: NODES });
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'puzzle');
    assert.deepEqual(r.issues, []);
    assert.equal(r.valid, true);
    assert.ok(r.themes.includes('mate') && r.themes.includes('mateIn2'), r.themes.join());
    assert.ok(r.themes.includes('mate-back-rank'), r.themes.join());
    const d = r.difficulty;
    for (const k of ['depth', 'candidates', 'quiet', 'rating']) assert.equal(typeof d[k], 'number', k);
    assert.ok(d.rating >= 400 && d.rating <= 3000);
    assert.ok(d.depth >= 1 && d.candidates >= 1 && d.quiet >= 0 && d.quiet <= 1);
});

test('verifyPuzzle: a knight fork is valid and named a fork', () => {
    const r = P.verifyPuzzle(FX.fork, { nodes: NODES });
    assert.deepEqual(r.issues, []);
    assert.equal(r.valid, true);
    assert.ok(r.themes.includes('fork'), r.themes.join());
    assert.ok(!r.themes.includes('mate'));
});

test('verifyPuzzle: the rating follows the formula before calibration', () => {
    const { depth, candidates, quiet, rating } = P.verifyPuzzle(FX.fork, { nodes: NODES }).difficulty;
    const expected = Math.min(3000, Math.max(400, Math.round(600 + 180 * depth + 120 * Math.log2(candidates) + 250 * quiet)));
    assert.equal(rating, expected);
    assert.equal(P.ratingOf({ depth: 100, candidates: 1000, quiet: 1 }), 3000);
    assert.equal(P.ratingOf({ depth: 0, candidates: 1, quiet: 0 }), 600);
    assert.equal(P.ratingOf({ depth: -10, candidates: 1, quiet: 0 }), 400);
});

test('verifyPuzzle: a second winning move is an alternative at the ply where it exists', () => {
    const r = P.verifyPuzzle(FX.forkWithRook, { nodes: NODES });
    assert.equal(r.valid, false);
    const alt = r.issues.find((i) => i.code === 'alternative');
    assert.ok(alt, codes(r).join());
    assert.equal(alt.ply, 0);
    assert.ok(alt.moves.includes(FX.forkWithRook.alternative), JSON.stringify(alt));
});

test('verifyPuzzle: an alternative at a later ply is reported at that ply', () => {
    const r = P.verifyPuzzle(FX.lateAlternative, { nodes: NODES });
    assert.equal(r.valid, false);
    // the key is unique (a longer mate at ply 0 is only noted); the second move has a twin
    const real = r.issues.filter((i) => i.code !== 'longer-mate');
    assert.deepEqual(
        real.map((i) => `${i.ply}:${i.code}`),
        [`${FX.lateAlternative.ply}:alternative`],
    );
    assert.ok(real[0].moves.length >= 1);
});

// the rule on its own, with lines made up from win chances: the thresholds 0.25 and 0.7, and the mates
const atChance = (move, p) => ({ move, score: Math.round(Math.log(p / (1 - p)) / EV.W.K), mate: null, pv: [move] });
const mateLine = (move, mate) => ({ move, score: Math.sign(mate) * (32000 - 2 * Math.abs(mate)), mate, pv: [move] });
const rule = (best, second, mine = best, mateMode = false) => V.solverIssues(best, second, mine, mateMode).map((i) => i.code);

test('the uniqueness rule: the second move must trail by 0.25, the best must reach 0.7, a mate is always enough', () => {
    assert.equal(V.UNIQUE_GAP, 0.25);
    assert.equal(V.WIN_MIN, 0.7);
    assert.deepEqual(rule(atChance(1, 0.9), atChance(2, 0.6)), []);
    assert.deepEqual(rule(atChance(1, 0.9), atChance(2, 0.7)), ['alternative']);
    assert.deepEqual(rule(atChance(1, 0.9), undefined), [], 'a single legal move is unique');
    assert.deepEqual(rule(atChance(1, 0.72), atChance(2, 0.2)), []);
    assert.deepEqual(rule(atChance(1, 0.68), atChance(2, 0.2)), ['not-winning']);
    // a puzzle that ends in mate: only mates are alternatives
    assert.deepEqual(rule(mateLine(1, 3), atChance(2, 0.99), undefined, true), [], 'a mate needs no gap to a winning non-mate');
    assert.deepEqual(rule(mateLine(1, 3), mateLine(2, 3), undefined, true), ['alternative']);
    assert.deepEqual(rule(mateLine(1, 3), mateLine(2, 5), undefined, true), ['longer-mate']);
    assert.deepEqual(rule(mateLine(1, 3), mateLine(2, -3), undefined, true), []);
    // any other puzzle: the gap rule, even when the best move happens to be a long mate
    assert.deepEqual(rule(mateLine(1, 3), atChance(2, 0.99)), ['alternative']);
    assert.deepEqual(rule(mateLine(1, 3), mateLine(2, 5)), ['alternative']);
    assert.deepEqual(rule(mateLine(1, 3), atChance(2, 0.5)), []);
    // the move played is judged too: a worse winning move than the best is an alternative, a losing one not winning
    assert.deepEqual(rule(atChance(1, 0.95), atChance(2, 0.5), atChance(2, 0.8)), ['alternative']);
    assert.deepEqual(rule(atChance(1, 0.95), atChance(2, 0.5), atChance(2, 0.5)), ['not-winning']);
    assert.deepEqual(rule(mateLine(1, 2), atChance(2, 0.5), atChance(2, 0.9), true), ['alternative']);
});

// a reply: weak when it allows a mate the best defence does not, when it is mated sooner, or when it gives up win chance or centipawns
const lineCp = (move, score) => ({ move, score, mate: null, pv: [move] });
test('the reply rule: a mate that could be avoided, a faster mate, and a loss that win chance cannot see', () => {
    assert.equal(V.WEAK_REPLY, 0.1);
    assert.equal(V.WEAK_REPLY_CP, 200);
    // lost anyway (win chance about 0.04 either way) but walking into a mate
    assert.equal(V.replyIsWeak(lineCp(1, -926), mateLine(2, -1)), true);
    assert.equal(V.replyIsWeak(mateLine(1, -3), mateLine(2, -2)), true, 'mated sooner');
    assert.equal(V.replyIsWeak(mateLine(1, -3), mateLine(2, -3)), false);
    assert.equal(V.replyIsWeak(mateLine(1, -3), mateLine(2, -5)), false, 'mated later is no mistake');
    // no mates: the win chance, and the centipawns when it has flattened out
    assert.equal(V.replyIsWeak(atChance(1, 0.5), atChance(2, 0.35)), true);
    assert.equal(V.replyIsWeak(atChance(1, 0.5), atChance(2, 0.45)), false);
    assert.equal(V.replyIsWeak(lineCp(1, -900), lineCp(2, -1150)), true, '250 cp more in a lost position, win chance 0.04 against 0.01');
    assert.equal(V.replyIsWeak(lineCp(1, -900), lineCp(2, -1000)), false);
});

test('the reply rule on a position: a lost side that walks into an avoidable mate is weak-reply', () => {
    const f = FX.lostSide;
    const pos = C.Position.fromFen(f.fen);
    const bad = V.judgeReply(pos, C.parseMove(pos, f.walksIntoMate), 20000);
    assert.equal(bad.length, 1);
    assert.equal(bad[0].code, 'weak-reply');
    // it names a defence that does avoid the mate, and that defence is not itself called weak
    const [named] = bad[0].moves;
    const escape = C.Position.fromFen(f.fen);
    escape.make(C.parseMove(escape, named));
    assert.ok(!P.solveMate(escape.fen(), 1).solutions?.includes(f.mate), `${named} still allows the mate`);
    assert.deepEqual(V.judgeReply(pos, C.parseMove(pos, named), 20000), []);
    assert.deepEqual(V.judgeReply(pos, C.parseMove(pos, f.best), 20000), []);
    // the mate is real
    const after = C.Position.fromFen(f.fen);
    after.make(C.parseMove(after, f.walksIntoMate));
    assert.ok(P.solveMate(after.fen(), 1).solutions.includes(f.mate));
    // and verifyPuzzle names it at the reply's ply
    const r = P.verifyPuzzle({ fen: '6k1/5ppp/8/8/8/2B5/5PPP/R5K1 w - - 0 1', moves: ['c3b2', f.walksIntoMate, f.mate] }, { nodes: 20000 });
    assert.ok(codes(r).includes('1:weak-reply'), codes(r).join());
});

test('verifyPuzzle: a solver move that does not win is not-winning; an illegal move is named with its ply', () => {
    const bad = { fen: FX.fork.fen, moves: ['g1f1'] };
    const r = P.verifyPuzzle(bad, { nodes: NODES });
    assert.equal(r.valid, false);
    assert.deepEqual(codes(r), ['0:not-winning']);
    const ill = P.verifyPuzzle({ fen: FX.fork.fen, moves: ['d5e7', 'g8f8', 'e7a1'] }, { nodes: NODES });
    assert.equal(ill.valid, false);
    assert.deepEqual(codes(ill), ['2:illegal']);
    assert.deepEqual(ill.themes, []);
});

test('verifyPuzzle: an opponent reply that is not the best defence is weak-reply', () => {
    const r = P.verifyPuzzle(FX.weakReply, { nodes: NODES });
    assert.equal(r.valid, false);
    assert.ok(codes(r).includes(`${FX.weakReply.ply}:weak-reply`), codes(r).join());
    const issue = r.issues.find((i) => i.code === 'weak-reply');
    assert.ok(issue.moves.length >= 1);
});

test('verifyPuzzle: another mating move that mates later is longer-mate, and the puzzle stays valid', () => {
    const r = P.verifyPuzzle(FX.longerMate, { nodes: NODES });
    assert.equal(r.valid, true, codes(r).join());
    const issue = r.issues.find((i) => i.code === 'longer-mate');
    assert.ok(issue, codes(r).join());
    assert.equal(issue.ply, 0);
    assert.ok(issue.moves.length >= 1);
    assert.ok(r.themes.includes('mateIn2'));
});

test('verifyPuzzle: a mate puzzle whose key has a cook is an alternative', () => {
    const r = P.verifyPuzzle({ fen: FX.cook.fen, moves: FX.cook.puzzle }, { nodes: NODES });
    assert.equal(r.valid, false);
    assert.equal(r.issues[0].code, 'alternative');
    assert.equal(r.issues[0].ply, 0);
    assert.deepEqual(r.issues[0].moves, [FX.cook.keys.find((k) => k !== FX.cook.puzzle[0])]);
});

// in a mate puzzle the keys come from an exact proof, so a small search budget cannot change the verdict
test('verifyPuzzle: the mates of a mate puzzle do not depend on the search budget (2k, 10k, 30k nodes)', () => {
    const cook = { fen: FX.cook.fen, moves: FX.cook.puzzle };
    const first = P.verifyPuzzle(cook, { nodes: 60000 });
    for (const nodes of [2000, 10000, 30000]) {
        const r = P.verifyPuzzle(cook, { nodes });
        assert.deepEqual(r.issues, first.issues, `${nodes} nodes`);
        const alt = r.issues.find((i) => i.code === 'alternative');
        assert.deepEqual(alt, { ply: 0, code: 'alternative', moves: ['e8d6'] }, `${nodes} nodes`);
        // the moves that mate only later are longer-mates and never alternatives
        const named = r.issues.filter((i) => i.code === 'alternative').flatMap((i) => i.moves);
        assert.ok(!named.includes('c7c6') && !named.includes('c7g3'), named.join());
        assert.ok(r.issues.find((i) => i.code === 'longer-mate' && i.ply === 0).moves.includes('c7c6'));
    }
    // a clean mate in 3 (a unique key at every solver ply) stays valid, with nothing but longer mates noted
    const clean = FX.cleanMate3;
    assert.deepEqual(P.solveMate(clean.fen, 3).line, clean.moves);
    for (const nodes of [2000, 10000, 30000]) {
        const r = P.verifyPuzzle(clean, { nodes });
        assert.equal(r.valid, true, `${nodes} nodes: ${codes(r).join()}`);
        assert.ok(
            r.issues.every((i) => i.code === 'longer-mate'),
            codes(r).join(),
        );
        assert.ok(r.themes.includes('mateIn3'));
    }
});

test('verifyPuzzle: the mate in 3 whose second move has a twin is named at that ply, whatever the budget', () => {
    for (const nodes of [2000, 30000]) {
        const r = P.verifyPuzzle(FX.lateAlternative, { nodes });
        const alt = r.issues.filter((i) => i.code === 'alternative');
        assert.deepEqual(alt, [{ ply: FX.lateAlternative.ply, code: 'alternative', moves: [FX.lateAlternative.alternative] }], `${nodes} nodes`);
        assert.equal(r.valid, false);
    }
});

test('verifyPuzzle: the fork is decisive at every solver ply, so a retune of the evaluation cannot flip it', () => {
    const s = new S.Searcher({ hashMb: 8 });
    const pos = C.Position.fromFen(FX.fork.fen);
    FX.fork.moves.forEach((text, i) => {
        if (i % 2 === 0) {
            s.clear();
            const lines = s.search(pos, { nodes: 100000, multipv: 2 }).lines;
            assert.ok(EV.winChance(lines[0].score) >= 0.85, `ply ${i}: ${EV.winChance(lines[0].score)}`);
            assert.equal(uci(lines[0].move), text, `ply ${i}`);
            assert.ok(EV.winChance(lines[0].score) - EV.winChance(lines[1].score) >= 0.4, `ply ${i} gap`);
        }
        pos.make(C.parseMove(pos, text));
    });
});

test('verifyPuzzle: a Black solver is judged from Black’s side (the mirrored back-rank mate and fork)', () => {
    const mate = P.verifyPuzzle(FX.blackBackRank, { nodes: NODES });
    assert.deepEqual(mate.issues, []);
    assert.equal(mate.valid, true);
    assert.ok(mate.themes.includes('mate') && mate.themes.includes('mateIn2') && mate.themes.includes('mate-back-rank'), mate.themes.join());
    assert.deepEqual(P.solveMate(FX.blackBackRank.fen, 2).solutions, ['d4d1']);
    const fork = P.verifyPuzzle(FX.blackFork, { nodes: NODES });
    assert.deepEqual(fork.issues, []);
    assert.equal(fork.valid, true);
    assert.ok(fork.themes.includes('fork'), fork.themes.join());
    // a wrong first move is not winning for Black either
    assert.deepEqual(codes(P.verifyPuzzle({ fen: FX.blackFork.fen, moves: ['g8f8'] }, { nodes: NODES })), ['0:not-winning']);
});

test('verifyPuzzle: the same input gives the same output', () => {
    const a = P.verifyPuzzle(FX.fork, { nodes: NODES });
    P.verifyPuzzle(FX.backRank, { nodes: NODES }); // another search in between
    const b = P.verifyPuzzle(FX.fork, { nodes: NODES });
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
});

test('verifyPuzzle: moves may be written in any notation', () => {
    const r = P.verifyPuzzle({ fen: FX.fork.fen, moves: ['Ne7+', 'Kf8', 'Nxc8'] }, { nodes: NODES });
    assert.deepEqual(r.issues, []);
});

test('verifyPuzzle: hostile input gives a typed invalid result and never throws', () => {
    const fen = FX.fork.fen;
    const cases = [
        [undefined, 'input'],
        [null, 'input'],
        ['fen', 'input'],
        [{ fen: 'nonsense', moves: ['e2e4'] }, 'fen'],
        [{ fen: 42, moves: ['e2e4'] }, 'fen'],
        [{ fen: '4k3/8/8/8/8/8/8/4K1K1 w - - 0 1', moves: ['e1e2'] }, 'fen'],
        [{ fen, moves: [] }, 'moves'],
        [{ fen, moves: 'd5e7' }, 'moves'],
        [{ fen, moves: [1, 2, 3] }, 'moves'],
        [{ fen, moves: ['d5e7', 'g8h8'] }, 'moves'],
        [{ fen, moves: Array(200).fill('d5e7') }, 'limit'],
    ];
    for (const [input, code] of cases) {
        const r = P.verifyPuzzle(input);
        assert.ok(isInvalid(r), JSON.stringify(input)?.slice(0, 60));
        assert.equal(r.code, code, JSON.stringify(input)?.slice(0, 60));
    }
    // garbage options and unreadable moves are survived
    assert.equal(P.verifyPuzzle({ fen, moves: ['Qh5'] }, null).ok, true);
    assert.equal(P.verifyPuzzle({ fen, moves: ['Qh5'] }, { nodes: 'many' }).issues[0].code, 'illegal');
    assert.deepEqual(codes(P.verifyPuzzle({ fen, moves: ['!!!'] }, { nodes: 1000 })), ['0:illegal']);
});

test('verifyPuzzle: a position without moves for the solver gives an illegal issue, not a crash', () => {
    const stalemate = '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1';
    const r = P.verifyPuzzle({ fen: stalemate, moves: ['h8g8'] }, { nodes: 1000 });
    assert.deepEqual(codes(r), ['0:illegal']);
});

// ---- solveMate

test('solveMate: a mate in 1, and the line to it', () => {
    const r = P.solveMate('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 1);
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'mate');
    assert.equal(r.n, 1);
    assert.deepEqual(r.solutions, ['d1d8']);
    assert.deepEqual(r.line, ['d1d8']);
});

test('solveMate: the back-rank mate in 2 has one key, and nothing mates in 1', () => {
    const r = P.solveMate(FX.backRank.fen, 2);
    assert.equal(r.kind, 'mate');
    assert.deepEqual(r.solutions, ['d5d8']);
    assert.deepEqual(r.line, FX.backRank.moves);
    assert.deepEqual(P.solveMate(FX.backRank.fen, 1), { ok: true, kind: 'none' });
});

test('solveMate: a composed mate in 2 with a cook returns both keys', () => {
    const r = P.solveMate(FX.cook.fen, 2);
    assert.equal(r.kind, 'mate');
    assert.deepEqual([...r.solutions].sort(), [...FX.cook.keys].sort());
    assert.ok(FX.cook.keys.includes(r.line[0]));
    assert.equal(r.line.length, 3);
    // the searcher agrees with both keys: after either, the side to move is mated in 2
    const pos = C.Position.fromFen(FX.cook.fen);
    const s = new S.Searcher({ hashMb: 8 });
    const found = s.search(pos, { nodes: 60000, multipv: 4 }).lines.filter((l) => l.mate === 2);
    assert.deepEqual(found.map((l) => uci(l.move)).sort(), [...FX.cook.keys].sort());
    // and each key really forces the mate: every reply has a mating answer
    for (const key of FX.cook.keys) {
        const p = C.Position.fromFen(FX.cook.fen);
        p.make(C.parseMove(p, key));
        const replies = C.legalMoves(p);
        assert.ok(replies.length > 0);
        for (const reply of replies) {
            const q = p.clone();
            q.make(reply);
            const mates = C.legalMoves(q).filter((m) => {
                const t = q.clone();
                t.make(m);
                return C.legalMoves(t).length === 0 && t.inCheck();
            });
            assert.ok(mates.length > 0, `${key} ${uci(reply)}`);
        }
    }
});

test('solveMate: the length of every key’s own mate is reported, and the budget option is capped', () => {
    const r = P.solveMate(FX.cook.fen, 5);
    assert.deepEqual(r.solutions.slice(0, 2).sort(), [...FX.cook.keys].sort());
    assert.equal(r.distances.length, r.solutions.length);
    assert.deepEqual(r.distances.slice(0, 2), [2, 2]);
    assert.ok(r.distances.slice(2).every((d) => d > 2 && d <= 5));
    assert.deepEqual(
        [...r.distances].sort((a, b) => a - b),
        r.distances,
        'shortest first',
    );
    // an absurd budget is capped rather than trusted (and does not allocate for it)
    assert.equal(M.MAX_MATE_NODES, 20000000);
    assert.deepEqual(P.solveMate(FX.backRank.fen, 2, { nodes: 1e15 }).solutions, ['d5d8']);
    assert.deepEqual(P.solveMate(FX.backRank.fen, 2, { nodes: -5 }).solutions, ['d5d8'], 'a bad budget is the default');
});

test('solveMate: a stalemate is not a mate (Qc7 is left out), and the other queen mates are all there', () => {
    const r = P.solveMate(FX.stalemateTrap.fen, 1);
    assert.deepEqual(r.solutions, FX.stalemateTrap.solutions);
    assert.ok(!r.solutions.includes(FX.stalemateTrap.stalemate));
    const pos = C.Position.fromFen(FX.stalemateTrap.fen);
    pos.make(C.parseMove(pos, FX.stalemateTrap.stalemate));
    assert.equal(C.legalMoves(pos).length, 0);
    assert.equal(pos.inCheck(), false, 'the position after it is a stalemate');
});

test('solveMate: a mate in 3 with one key, and what a longer bound adds', () => {
    const r = P.solveMate(FX.mateIn3.fen, 3);
    assert.equal(r.kind, 'mate');
    assert.deepEqual(r.solutions, [FX.mateIn3.key]);
    assert.equal(r.distance, 3);
    assert.equal(r.line.length, 5);
    assert.deepEqual(P.solveMate(FX.mateIn3.fen, 2), { ok: true, kind: 'none' });
    // a longer bound keeps every key of a shorter one
    const longer = P.solveMate(FX.mateIn3.fen, 4);
    assert.ok(longer.solutions.includes(FX.mateIn3.key) && longer.solutions.length > 1);
    // the searcher finds the same key
    const found = new S.Searcher({ hashMb: 8 }).search(C.Position.fromFen(FX.mateIn3.fen), { depth: 8 });
    assert.equal(uci(found.best), FX.mateIn3.key);
    assert.equal(found.mate, 3);
});

// an independent, unpruned proof: no ordering, no table, every move and every reply
function naiveForces(pos, k) {
    for (const m of C.legalMoves(pos)) {
        pos.make(m);
        const replies = C.legalMoves(pos);
        let ok;
        if (replies.length === 0) ok = pos.inCheck();
        else if (k === 1 || pos.isInsufficientMaterial() || pos.halfmove >= 100) ok = false;
        else {
            ok = true;
            for (const r of replies) {
                pos.make(r);
                const won = naiveForces(pos, k - 1);
                pos.unmake();
                if (!won) {
                    ok = false;
                    break;
                }
            }
        }
        pos.unmake();
        if (ok) return true;
    }
    return false;
}
const naiveKeys = (fen, n) => {
    const pos = C.Position.fromFen(fen);
    const keys = [];
    for (const m of C.legalMoves(pos)) {
        pos.make(m);
        const replies = C.legalMoves(pos);
        let ok;
        if (replies.length === 0) ok = pos.inCheck();
        else if (n === 1 || pos.isInsufficientMaterial()) ok = false;
        else ok = replies.every((r) => (pos.make(r), naiveForces(pos, n - 1) && (pos.unmake(), true)) || (pos.unmake(), false));
        pos.unmake();
        if (ok) keys.push(uci(m));
    }
    return keys.sort();
};

test('solveMate: the same keys as an unpruned brute force', () => {
    const cases = [
        [FX.backRank.fen, 2],
        [FX.cook.fen, 2],
        [FX.stalemateTrap.fen, 3],
        [FX.longerMate.fen, 2],
        [FX.mateIn3.fen, 2],
        [FX.fork.fen, 2],
        ['6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1', 2],
    ];
    for (const [fen, n] of cases) {
        const r = P.solveMate(fen, n);
        assert.deepEqual(r.kind === 'mate' ? [...r.solutions].sort() : [], naiveKeys(fen, n), `${fen} n=${n}`);
    }
});

test('solveMate: no mate gives kind none; a finished position gives none too', () => {
    assert.deepEqual(P.solveMate(C.Position.START_FEN, 2), { ok: true, kind: 'none' });
    assert.deepEqual(P.solveMate('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 3), { ok: true, kind: 'none' }, 'a stalemate');
    assert.deepEqual(P.solveMate('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1', 3), { ok: true, kind: 'none' }, 'a checkmate');
});

test('solveMate: n is bounded by 5, and bad input is typed', () => {
    const bad = (r, code) => {
        assert.ok(isInvalid(r), JSON.stringify(r));
        assert.equal(r.code, code);
    };
    bad(P.solveMate(FX.backRank.fen, 6), 'limit');
    bad(P.solveMate(FX.backRank.fen, 0), 'arg');
    bad(P.solveMate(FX.backRank.fen, -1), 'arg');
    bad(P.solveMate(FX.backRank.fen, 1.5), 'arg');
    bad(P.solveMate(FX.backRank.fen, '2'), 'arg');
    bad(P.solveMate(FX.backRank.fen, NaN), 'arg');
    bad(P.solveMate(FX.backRank.fen), 'arg');
    bad(P.solveMate('nonsense', 2), 'fen');
    bad(P.solveMate(null, 2), 'fen');
    bad(P.solveMate('4k3/8/8/8/8/8/8/4K1K1 w - - 0 1', 2), 'fen');
});

test('solveMate: a search too large for its budget says so instead of guessing', () => {
    const r = P.solveMate(C.Position.START_FEN, 5, { nodes: 20000 });
    assert.ok(isInvalid(r));
    assert.equal(r.code, 'limit');
});

// ---- findPuzzles

const GAMES = () => [FX.game, FX.forkGame];

test('findPuzzles: a blunder followed by a unique winning tactic is found, and verifies', () => {
    for (const game of GAMES()) {
        const want = game.expected;
        const r = P.findPuzzles(game.pgn, { nodes: NODES });
        assert.equal(r.ok, true, JSON.stringify(r));
        assert.equal(r.kind, 'puzzles');
        assert.equal(r.puzzles.length, 1, JSON.stringify(r.puzzles.map((p) => [p.ply, p.moves])));
        const [p] = r.puzzles;
        assert.equal(p.ply, want.ply);
        assert.equal(p.fen, want.fen);
        assert.deepEqual(p.moves.slice(0, want.moves.length), want.moves);
        assert.ok(p.moves.length % 2 === 1);
        for (const k of want.themes) assert.ok(p.themes.includes(k), `${k} in ${p.themes.join()}`);
        assert.ok(p.rating >= 400 && p.rating <= 3000);
        // it passes verifyPuzzle with the same rating
        const v = P.verifyPuzzle({ fen: p.fen, moves: p.moves }, { nodes: NODES });
        assert.equal(v.valid, true, codes(v).join());
        assert.equal(v.difficulty.rating, p.rating);
        assert.deepEqual(v.themes, p.themes);
    }
});

test('findPuzzles: the Legall game gives the mate in 2 after the capture of the queen', () => {
    const [p] = P.findPuzzles(FX.game.pgn, { nodes: NODES }).puzzles;
    assert.deepEqual(p.moves, FX.game.expected.moves);
    assert.ok(p.themes.includes('mateIn2'));
});

test('findPuzzles: the same game gives the same puzzles', () => {
    assert.deepEqual(P.findPuzzles(FX.forkGame.pgn, { nodes: NODES }), P.findPuzzles(FX.forkGame.pgn, { nodes: NODES }));
});

test('findPuzzles: comments, NAGs, variations and a game without headers are fine', () => {
    const movetext = FX.game.pgn.split('\n\n')[1];
    const noisy = movetext.replace('5. Nxe5', '5. Nxe5 {Here it is.} $1 (5. Bxf7+ Kxf7 6. Nxe5+ dxe5) ; a line comment\n');
    assert.ok(noisy.length > movetext.length);
    const r = P.findPuzzles(noisy, { nodes: NODES });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.puzzles.length, 1);
    assert.equal(r.puzzles[0].ply, FX.game.expected.ply);
});

test('findPuzzles: a quiet game has no puzzles; an empty text has none either', () => {
    const quiet = P.findPuzzles('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *', { nodes: 20000 });
    assert.deepEqual(quiet, { ok: true, kind: 'puzzles', puzzles: [] });
    assert.deepEqual(P.findPuzzles('', { nodes: 1000 }), { ok: true, kind: 'puzzles', puzzles: [] });
});

test('findPuzzles: bad input is typed invalid and never throws', () => {
    for (const input of [
        undefined,
        null,
        42,
        {},
        '1. e4 e5 2. Qxx9',
        '1. e4 e5 2. Ke2 Ke7 3. Ke2',
        '[Event "x"',
        '1. e4 {unclosed',
        '1. e4 (2. d4',
        '[FEN "bad"]\n\n1. e4',
    ]) {
        const r = P.findPuzzles(input, { nodes: 1000 });
        assert.ok(isInvalid(r), `${String(input).slice(0, 40)} -> ${JSON.stringify(r).slice(0, 80)}`);
    }
});

test('findPuzzles: a game from a FEN header starts from that position, and its puzzle is found', () => {
    const r = P.findPuzzles(FX.forkGame.pgn, { nodes: NODES });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.puzzles.length, 1);
    assert.equal(r.puzzles[0].ply, 1);
    assert.equal(r.puzzles[0].fen, FX.forkGame.expected.fen);
    assert.equal(r.puzzles[0].moves[0], 'd5e7');
    // the same moves without the header are not playable from the start position
    const movetext = FX.forkGame.pgn.split('\n\n')[1];
    assert.ok(isInvalid(P.findPuzzles(movetext, { nodes: 1000 })));
});

test('findPuzzles: a game longer than the limit is refused before any search', () => {
    let pgn = '';
    for (let i = 1; i <= 151; i++) pgn += `${2 * i - 1}. Nf3 Nf6 ${2 * i}. Ng1 Ng8 `;
    const r = P.findPuzzles(pgn, { nodes: 1000 });
    assert.ok(isInvalid(r));
    assert.equal(r.code, 'limit');
});

test('verifyPuzzle: an invalid puzzle or an illegal line has no difficulty, a valid one has it (M9)', () => {
    const alt = P.verifyPuzzle(FX.forkWithRook, { nodes: NODES });
    assert.equal(alt.valid, false);
    assert.equal(alt.difficulty, null);
    const ill = P.verifyPuzzle({ fen: FX.fork.fen, moves: ['d5e7', 'g8f8', 'e7a1'] }, { nodes: NODES });
    assert.equal(ill.difficulty, null);
    const ok = P.verifyPuzzle(FX.fork, { nodes: NODES });
    assert.equal(ok.valid, true);
    assert.equal(typeof ok.difficulty.rating, 'number');
});

test('the budget sentence agrees with its number in both languages (M7)', async () => {
    const { msg, localize } = await import('../src/i18n/index.js');
    const say = (n, lang) => localize(msg('puzzles.mate.budget', { nodes: n }), lang);
    assert.match(say(1, 'ru'), /в 1 позицию,/);
    assert.match(say(3, 'ru'), /в 3 позиции,/);
    assert.match(say(5000, 'ru'), /в 5000 позиций,/);
    assert.match(say(1, 'en'), /in 1 position,/);
    assert.match(say(5000, 'en'), /in 5000 positions,/);
});
