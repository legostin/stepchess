// board-model: the pure state machine behind <stepchess-board> — selection, drops, promotion, puzzles, annotations,
// setup, and the touch edge cases that must leave a clean state (no selection, no pending picker, no stray move).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let B;
let S;
before(async () => {
    B = await import('../board/model.js');
    S = await import('../src/index.js');
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
// a white pawn on e7, one step from promotion
const PROMO = 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1';
// 1. Rd8+ Rxd8 2. Rxd8#: the reply is forced, the last move mates
const BACK_RANK = 'r5k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1';
const BACK_RANK_LINE = ['d2d8', 'a8d8', 'd1d8'];
// mate in one with two mating moves (Ra8# and Rd8#)
const TWO_MATES = '6k1/5ppp/8/8/8/8/5PPP/R2R2K1 w - - 0 1';

// the state a board must come back to after any aborted gesture
const assertClean = (st) => {
    assert.equal(st.selected, null, 'no selection');
    assert.deepEqual(st.targets, [], 'no targets');
    assert.equal(st.pendingPromotion, null, 'no promotion picker');
};

// the legal destinations of the piece on a square, by the engine
const legalTargets = (fen, from) => {
    const pos = S.Position.fromFen(fen);
    const sq = S.parseSquare(from);
    return [
        ...new Set(
            S.legalMoves(pos)
                .filter((m) => S.moveFrom(m) === sq)
                .map((m) => S.sqName(S.moveTo(m))),
        ),
    ].sort();
};

test('a fresh model holds the position, no selection and an empty puzzle record', () => {
    const m = B.createBoardModel();
    const st = m.state();
    assert.equal(st.fen, START);
    assert.equal(st.mode, 'play');
    assert.equal(st.orientation, 'white');
    assert.equal(st.turn, 'white');
    assert.equal(st.lastMove, null);
    assert.equal(st.check, null);
    assert.deepEqual(st.annotations, { arrows: [], squares: [], badges: [] });
    assert.deepEqual(st.puzzle, { index: 0, length: 0, solved: false, failed: false });
    assert.equal(st.pieces.e1, 'K');
    assert.equal(st.pieces.g8, 'n');
    assert.equal(Object.keys(st.pieces).length, 32);
    assertClean(st);
});

test('an invalid FEN falls back to the start position; options are normalised', () => {
    const m = B.createBoardModel({ fen: 'not a fen', mode: 'nonsense', orientation: 'sideways' });
    const st = m.state();
    assert.equal(st.fen, START);
    assert.equal(st.mode, 'play');
    assert.equal(st.orientation, 'white');
});

test('select an own piece: the targets are its legal destinations', () => {
    const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
    for (const from of ['e1', 'f3', 'f1', 'd1', 'b1', 'a2', 'h1']) {
        const m = B.createBoardModel({ fen });
        const out = m.select(from);
        const st = m.state();
        const expected = legalTargets(fen, from);
        if (expected.length) {
            assert.equal(st.selected, from);
            assert.equal(out.selection, from);
            assert.deepEqual([...st.targets].sort(), expected, from);
        } else {
            // a piece with no legal move may still be picked up: it shows no targets
            assert.deepEqual(st.targets, []);
        }
    }
});

test('a piece of the side not to move is not selected in play mode', () => {
    const m = B.createBoardModel();
    m.select('e7');
    assertClean(m.state());
    m.select('e4');
    assertClean(m.state());
});

test('tap-tap plays a move; the outcome lists it; the selection is cleared', () => {
    const m = B.createBoardModel();
    m.select('e2');
    const out = m.select('e4');
    assert.equal(out.moves.length, 1);
    assert.equal(out.moves[0].uci, 'e2e4');
    assert.equal(out.moves[0].san, 'e4');
    assert.equal(out.moves[0].auto, false);
    const st = m.state();
    assert.equal(st.fen, 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    assert.equal(out.moves[0].fen, st.fen);
    assert.deepEqual(st.lastMove, { from: 'e2', to: 'e4', uci: 'e2e4', san: 'e4' });
    assert.equal(st.turn, 'black');
    assertClean(st);
});

test('tap on the selected piece deselects it; tap on another own piece reselects; tap elsewhere clears', () => {
    const m = B.createBoardModel();
    m.select('e2');
    m.select('e2');
    assertClean(m.state());
    m.select('e2');
    m.select('g1');
    assert.equal(m.state().selected, 'g1');
    assert.deepEqual([...m.state().targets].sort(), ['f3', 'h3']);
    m.select('e5'); // not a target
    assertClean(m.state());
    assert.equal(m.state().fen, START);
    m.select('e2');
    m.select(null);
    assertClean(m.state());
});

test('a drag released off the board (to = null) plays nothing and clears the selection', () => {
    const m = B.createBoardModel();
    m.select('e2');
    const out = m.drop('e2', null);
    assert.deepEqual(out.moves, []);
    assert.equal(m.state().fen, START);
    assertClean(m.state());
    // a drop with no selection before it (the element picks the piece up on pointerdown, but be lenient)
    m.drop('g1', null);
    assertClean(m.state());
});

test('an illegal drop snaps back: no move, no selection; a drop on its own square keeps the selection', () => {
    const m = B.createBoardModel();
    m.select('e2');
    assert.deepEqual(m.drop('e2', 'e5').moves, []);
    assert.equal(m.state().fen, START);
    assertClean(m.state());
    m.select('e2');
    m.drop('e2', 'e2');
    assert.equal(m.state().selected, 'e2');
    const out = m.drop('e2', 'e4');
    assert.equal(out.moves[0].uci, 'e2e4');
    assertClean(m.state());
});

test('a drop by the wrong side or from an empty square plays nothing', () => {
    const m = B.createBoardModel();
    assert.deepEqual(m.drop('e7', 'e5').moves, []);
    assert.deepEqual(m.drop('e4', 'e5').moves, []);
    assert.deepEqual(m.drop('zz', 'e4').moves, []);
    assert.equal(m.state().fen, START);
    assertClean(m.state());
});

test('promotion: drop e7-e8 asks for a piece; promote(null) leaves the position as it was', () => {
    const m = B.createBoardModel({ fen: PROMO });
    const before = m.state().fen;
    const out = m.drop('e7', 'e8');
    assert.deepEqual(out.moves, []);
    assert.equal(out.promotion, true);
    assert.deepEqual(m.state().pendingPromotion, { from: 'e7', to: 'e8', color: 'white' });
    assert.equal(m.state().fen, before);
    // input while the picker is open is ignored
    m.select('e1');
    assert.deepEqual(m.state().pendingPromotion, { from: 'e7', to: 'e8', color: 'white' });
    m.drop('e1', 'd1');
    assert.equal(m.state().fen, before);
    const back = m.promote(null);
    assert.deepEqual(back.moves, []);
    assert.equal(m.state().fen, before);
    assert.equal(m.state().lastMove, null);
    assertClean(m.state());
});

test('promotion: the chosen piece is played; tap-tap and cancel() go through the same picker', () => {
    const m = B.createBoardModel({ fen: PROMO });
    m.select('e7');
    m.select('e8');
    assert.ok(m.state().pendingPromotion);
    m.cancel();
    assertClean(m.state());
    m.drop('e7', 'e8');
    const out = m.promote('n');
    assert.equal(out.moves[0].uci, 'e7e8n');
    assert.equal(m.state().pieces.e8, 'N');
    assertClean(m.state());
    // an unknown piece letter cancels the picker
    const m2 = B.createBoardModel({ fen: PROMO });
    m2.drop('e7', 'e8');
    m2.promote('k');
    assert.equal(m2.state().fen, PROMO);
    assertClean(m2.state());
    // promote() with no picker open does nothing
    assert.deepEqual(m2.promote('q').moves, []);
});

test('check: the square of the king in check', () => {
    const m = B.createBoardModel({ fen: 'rnbqkbnr/ppppp1pp/8/5p2/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2' });
    m.drop('d1', 'h5');
    assert.equal(m.state().check, 'e8');
    m.select('g7');
    m.select('g6');
    assert.equal(m.state().check, null);
});

test('puzzle: a wrong move fails; cancel() takes it back to the puzzle position', () => {
    const m = B.createBoardModel({ fen: BACK_RANK, mode: 'puzzle', puzzle: { moves: BACK_RANK_LINE } });
    assert.deepEqual(m.state().puzzle, { index: 0, length: 3, solved: false, failed: false });
    const out = m.drop('h2', 'h3');
    assert.equal(out.moves.length, 1);
    assert.equal(out.puzzle, 'failed');
    assert.equal(out.expected, 'd2d8');
    const st = m.state();
    assert.equal(st.puzzle.failed, true);
    assert.equal(st.lastMove.uci, 'h2h3');
    assert.notEqual(st.fen, BACK_RANK);
    // nothing moves while the failure is shown
    m.select('d2');
    assert.equal(m.state().selected, null);
    m.cancel();
    assert.equal(m.state().fen, BACK_RANK);
    assert.equal(m.state().puzzle.failed, false);
    assert.equal(m.state().puzzle.index, 0);
    assert.equal(m.state().lastMove, null);
    assertClean(m.state());
});

test('puzzle: the right move is answered by the opponent; the last move solves it', () => {
    const m = B.createBoardModel({ fen: BACK_RANK, mode: 'puzzle', puzzle: { moves: BACK_RANK_LINE } });
    const first = m.drop('d2', 'd8');
    assert.deepEqual(
        first.moves.map((x) => [x.uci, x.auto]),
        [
            ['d2d8', false],
            ['a8d8', true],
        ],
    );
    assert.equal(first.puzzle, null);
    assert.equal(m.state().puzzle.index, 2);
    assert.equal(m.state().turn, 'white');
    assert.equal(m.state().lastMove.uci, 'a8d8');
    m.select('d1');
    const last = m.select('d8');
    assert.equal(last.puzzle, 'solved');
    const st = m.state();
    assert.deepEqual(st.puzzle, { index: 3, length: 3, solved: true, failed: false });
    assert.equal(st.status, 'checkmate');
    // a solved puzzle takes no more input
    m.select('g1');
    assertClean(m.state());
});

test('puzzle: a tap on an opponent piece selects nothing', () => {
    const m = B.createBoardModel({ fen: BACK_RANK, mode: 'puzzle', puzzle: { moves: BACK_RANK_LINE } });
    m.select('a8');
    assertClean(m.state());
    m.select('d2');
    m.select('a8'); // not a target of the rook: the selection is cleared, nothing is played
    assertClean(m.state());
    assert.equal(m.state().fen, BACK_RANK);
    assert.deepEqual(m.drop('g8', 'h8').moves, []);
    assertClean(m.state());
});

test('puzzle: another mate on the last move counts as the solution; undo goes back to the solver', () => {
    const m = B.createBoardModel({ fen: TWO_MATES, mode: 'puzzle', puzzle: { moves: ['d1d8'] } });
    const out = m.drop('a1', 'a8');
    assert.equal(out.puzzle, 'solved');
    assert.equal(m.state().puzzle.solved, true);

    const p = B.createBoardModel({ fen: BACK_RANK, mode: 'puzzle', puzzle: { moves: BACK_RANK_LINE } });
    p.drop('d2', 'd8');
    p.undo();
    assert.equal(p.state().fen, BACK_RANK, 'undo takes back the reply and the move');
    assert.equal(p.state().puzzle.index, 0);
    p.drop('h2', 'h3');
    p.undo(); // undo of a failed try is the same as cancel()
    assert.equal(p.state().fen, BACK_RANK);
    assert.equal(p.state().puzzle.failed, false);
});

test('puzzle: an invalid line is rejected with a typed result', () => {
    const m = B.createBoardModel({ mode: 'puzzle' });
    const r = m.setPuzzle({ fen: BACK_RANK, moves: ['d2d8', 'e2e4'] });
    assert.equal(r.ok, false);
    assert.equal(r.kind, 'invalid');
    const ok = m.setPuzzle({ fen: BACK_RANK, moves: BACK_RANK_LINE });
    assert.equal(ok.ok, true);
    assert.equal(m.state().fen, BACK_RANK);
    assert.equal(m.state().puzzle.length, 3);
});

test('view mode takes no input; analysis moves both sides; player limits play mode to one color', () => {
    const v = B.createBoardModel({ mode: 'view' });
    v.select('e2');
    assertClean(v.state());
    assert.deepEqual(v.drop('e2', 'e4').moves, []);

    const a = B.createBoardModel({ mode: 'analysis' });
    a.drop('e2', 'e4');
    a.drop('e7', 'e5');
    assert.equal(a.state().history.length, 2);

    const p = B.createBoardModel({ player: 'white' });
    p.drop('e2', 'e4');
    p.select('e7');
    assertClean(p.state());
    assert.deepEqual(p.drop('e7', 'e5').moves, []);
    // the engine answers through the API, which is not limited
    assert.equal(p.playMoves(['e7e5']).ok, true);
    assert.equal(p.state().turn, 'white');
});

test('annotations: annotate() keeps the valid parts; a move clears them; annotate(null) clears', () => {
    const m = B.createBoardModel();
    m.annotate({
        arrows: [
            { from: 'e2', to: 'e4', kind: 'best' },
            { from: 'e2', to: 'x9', kind: 'best' },
            { from: 'g1', to: 'f3' },
            { from: 'a1', to: 'a1', kind: 'idea' },
        ],
        squares: [
            { sq: 'e4', kind: 'threat' },
            { sq: 'zz', kind: 'bad' },
            { sq: 'd4', kind: 'weird' },
        ],
        badges: [
            { sq: 'e4', glyph: '!!' },
            { sq: 'd4', glyph: 'X' },
        ],
    });
    assert.deepEqual(m.state().annotations, {
        arrows: [
            { from: 'e2', to: 'e4', kind: 'best' },
            { from: 'g1', to: 'f3', kind: 'idea' },
        ],
        squares: [
            { sq: 'e4', kind: 'threat' },
            { sq: 'd4', kind: 'idea' },
        ],
        badges: [{ sq: 'e4', glyph: '!!' }],
    });
    m.annotate(null);
    assert.deepEqual(m.state().annotations, { arrows: [], squares: [], badges: [] });
    m.annotate({ arrows: [{ from: 'e2', to: 'e4', kind: 'best' }] });
    m.drop('e2', 'e4');
    assert.deepEqual(m.state().annotations.arrows, []);
    // garbage never throws
    m.annotate('nonsense');
    m.annotate({ arrows: 'x', squares: [null, 3], badges: [{}] });
    assert.deepEqual(m.state().annotations, { arrows: [], squares: [], badges: [] });
});

test('drawn arrows and circles toggle, and a move clears them', () => {
    const m = B.createBoardModel();
    m.draw('e2', 'e4');
    m.draw('d4', 'd4');
    m.draw('g1', 'f3', 'threat');
    assert.deepEqual(m.state().drawn, {
        arrows: [
            { from: 'e2', to: 'e4', kind: 'idea' },
            { from: 'g1', to: 'f3', kind: 'threat' },
        ],
        squares: [{ sq: 'd4', kind: 'idea' }],
    });
    m.draw('e2', 'e4');
    assert.equal(m.state().drawn.arrows.length, 1);
    m.draw('e2', null); // released off the board: nothing
    assert.equal(m.state().drawn.arrows.length, 1);
    m.drop('e2', 'e4');
    assert.deepEqual(m.state().drawn, { arrows: [], squares: [] });
});

test('setPosition: an invalid FEN is a typed result and changes nothing; a valid one resets the board', () => {
    const m = B.createBoardModel();
    m.drop('e2', 'e4');
    m.select('e7');
    const bad = m.setPosition('8/8/8/8/8/8/8/8 w - - 0 1');
    assert.equal(bad.ok, false);
    assert.equal(bad.kind, 'invalid');
    assert.equal(bad.code, 'fen');
    assert.ok(bad.reason);
    assert.equal(m.state().history.length, 1);
    const ok = m.setPosition(PROMO);
    assert.equal(ok.ok, true);
    const st = m.state();
    assert.equal(st.fen, PROMO);
    assert.deepEqual(st.history, []);
    assert.equal(st.lastMove, null);
    assertClean(st);
    assert.equal(m.setPosition(42).ok, false);
});

test('playMoves plays a line and stops at the first bad move with a typed result; undo takes moves back', () => {
    const m = B.createBoardModel();
    const r = m.playMoves(['e2e4', 'e7e5', 'Nf3']);
    assert.equal(r.ok, true);
    assert.deepEqual(
        r.moves.map((x) => x.uci),
        ['e2e4', 'e7e5', 'g1f3'],
    );
    assert.equal(m.state().lastMove.san, 'Nf3');
    const bad = m.playMoves(['Nc6', 'Ke3', 'd4']);
    assert.equal(bad.ok, false);
    assert.equal(bad.kind, 'invalid');
    assert.equal(bad.code, 'move');
    assert.equal(bad.played, 1);
    assert.equal(m.playMoves('e2e4').ok, false);
    assert.equal(m.playMoves([{}]).ok, false);
    assert.equal(m.state().history.length, 4);
    assert.equal(m.undo().moves.length, 1);
    assert.equal(m.state().history.length, 3);
    m.undo();
    m.undo();
    m.undo();
    assert.equal(m.state().fen, START);
    assert.deepEqual(m.undo().moves, []);
});

test('a move record carries the position before it and the move, so a view can write it in any language', () => {
    const m = B.createBoardModel();
    const out = m.drop('g1', 'f3');
    const rec = out.moves[0];
    assert.equal(rec.before, START);
    assert.equal(B.sanIn(rec, 'en'), 'Nf3');
    assert.notEqual(B.sanIn(rec, 'ru'), 'Nf3');
    assert.ok(B.sanIn(rec, 'ru').endsWith('f3'));
});

test('flip and orientation', () => {
    const m = B.createBoardModel({ orientation: 'black' });
    assert.equal(m.state().orientation, 'black');
    m.flip();
    assert.equal(m.state().orientation, 'white');
    m.setOrientation('black');
    assert.equal(m.state().orientation, 'black');
    m.setOrientation('nope');
    assert.equal(m.state().orientation, 'black');
});

test('setup: pieces move freely, a piece dragged off the board is removed, place() adds pieces', () => {
    const m = B.createBoardModel({ mode: 'setup' });
    m.drop('e2', 'e5');
    assert.equal(m.state().pieces.e5, 'P');
    assert.equal(m.state().pieces.e2, undefined);
    m.drop('d1', null);
    assert.equal(m.state().pieces.d1, undefined);
    m.place('d4', 'q');
    assert.equal(m.state().pieces.d4, 'q');
    m.place('d4', null);
    assert.equal(m.state().pieces.d4, undefined);
    m.place('d4', 'X'); // not a piece
    assert.equal(m.state().pieces.d4, undefined);
    m.select('a1');
    m.select('a4');
    assert.equal(m.state().pieces.a4, 'R');
    assertClean(m.state());
    m.setTurn('black');
    assert.equal(m.state().turn, 'black');
    assert.ok(m.state().fen.startsWith('rnbqkbnr/pppppppp/8/4P3/R7/8/PPPP1PPP/1NB1KBNR b Kkq - '), m.state().fen);
    assert.equal(m.state().valid, true);
    // an impossible position is reported, and play cannot start from it
    m.drop('e1', null);
    assert.equal(m.state().valid, false);
    const r = m.setMode('play');
    assert.equal(r.ok, false);
    assert.equal(m.state().mode, 'setup');
    m.place('e1', 'K');
    assert.equal(m.setMode('play').ok, true);
    assert.equal(m.state().mode, 'play');
    assert.equal(m.state().turn, 'black');
});

test('setup: castling rights follow the kings and rooks on their home squares', () => {
    const m = B.createBoardModel({ mode: 'setup' });
    assert.ok(m.state().fen.includes(' w KQkq - '));
    m.drop('h1', null);
    assert.ok(m.state().fen.includes(' w Qkq - '));
    m.clear();
    assert.equal(Object.keys(m.state().pieces).length, 0);
});

test('piecesOfFen reads the placement field, the same as the model, and skips junk', () => {
    assert.deepEqual(B.piecesOfFen(START), B.createBoardModel().state().pieces);
    assert.deepEqual(B.piecesOfFen('k7/4P3/8/8/8/8/8/4K3 w - - 0 1'), { a8: 'k', e7: 'P', e1: 'K' });
    assert.deepEqual(B.piecesOfFen(null), {});
    assert.deepEqual(B.piecesOfFen('x9/99'), {});
});

test('setPosition with a bad puzzle line (or FEN) changes nothing at all', () => {
    // a puzzle in progress, with a selection, annotations and a drawn arrow
    const m = B.createBoardModel({ fen: BACK_RANK, mode: 'puzzle', puzzle: { moves: BACK_RANK_LINE } });
    m.drop('d2', 'd8');
    m.annotate({ arrows: [{ from: 'd1', to: 'd8', kind: 'best' }] });
    m.draw('g1', 'h1');
    m.select('d1');
    const before = m.state();
    for (const [fen, opts] of [
        [BACK_RANK, { puzzle: { moves: ['d2d8', 'e2e4'] } }],
        [BACK_RANK, { puzzle: { moves: [] } }],
        [BACK_RANK, { puzzle: { moves: 'd2d8' } }],
        [BACK_RANK, { puzzle: {} }],
        ['8/8/8/8/8/8/8/8 w - - 0 1', { puzzle: { moves: BACK_RANK_LINE } }],
        ['8/8/8/8/8/8/8/8 w - - 0 1', {}],
        [null, {}],
    ]) {
        const r = m.setPosition(fen, opts);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'invalid');
        assert.deepEqual(m.state(), before, JSON.stringify([fen, opts]));
    }
    // and the board still plays on
    assert.equal(m.select('d8').puzzle, 'solved');
});

test('view mode draws no arrows or circles, and entering it clears the drawn ones', () => {
    const v = B.createBoardModel({ mode: 'view' });
    v.draw('e2', 'e4');
    v.draw('d4', 'd4');
    assert.deepEqual(v.state().drawn, { arrows: [], squares: [] });
    const a = B.createBoardModel({ mode: 'analysis' });
    a.draw('e2', 'e4');
    a.setMode('view');
    assert.deepEqual(a.state().drawn, { arrows: [], squares: [] });
});

test('playMoves with a bad first move changes nothing; a good first move after a wrong puzzle move takes it back', () => {
    const m = B.createBoardModel({ mode: 'analysis' });
    m.select('e2');
    m.draw('g1', 'h1');
    m.annotate({ arrows: [{ from: 'd1', to: 'd8', kind: 'best' }] });
    const before = m.state();
    for (const list of [['zz'], ['e7e5'], [''], [null], ['e2e4x']]) {
        const r = m.playMoves(list);
        assert.equal(r.ok, false);
        assert.equal(r.kind, 'invalid');
        assert.equal(r.played, 0);
        assert.deepEqual(r.moves, []);
        assert.deepEqual(m.state(), before, JSON.stringify(list));
    }
    // the same for a puzzle that shows a wrong move: it stays on show until a move is really played
    const p = B.createBoardModel({ fen: BACK_RANK, mode: 'puzzle', puzzle: { moves: BACK_RANK_LINE } });
    p.drop('d2', 'd7');
    assert.equal(p.state().puzzle.failed, true);
    const shown = p.state();
    assert.equal(p.playMoves(['zz']).ok, false);
    assert.deepEqual(p.state(), shown);
    // a first move that is legal from the puzzle position (not from the wrong move) is played, and the wrong move is gone
    const r = p.playMoves(['d2d8']);
    assert.equal(r.ok, true);
    assert.deepEqual(
        p.state().history.map((h) => h.uci),
        ['d2d8'],
    );
    assert.equal(p.state().puzzle.failed, false);
});
