// notation: SAN in English and Russian, move parsing, PGN with variations, and the Game (status, history, limits).
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let C;
before(async () => {
    C = await import('../src/core/index.js');
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const parse = (fen, input) => C.parseMove(C.Position.fromFen(fen), input);
const uci = (m) => C.moveToUci(m);
// the error a call throws, or null
const thrown = (fn) => {
    try {
        fn();
        return null;
    } catch (e) {
        assert.ok(e instanceof C.ChessError, String(e));
        return e;
    }
};

test('toSan: English and Russian letters, castling, promotion, check and mate', () => {
    const pos = C.Position.fromFen(START);
    const nf3 = parse(START, 'Nf3');
    assert.equal(C.toSan(pos, nf3), 'Nf3');
    assert.equal(C.toSan(pos, nf3, { lang: 'en' }), 'Nf3');
    assert.equal(C.toSan(pos, nf3, { lang: 'ru' }), 'Кf3');
    assert.equal(C.toSan(pos, parse(START, 'e4'), { lang: 'ru' }), 'e4');

    const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    const cp = C.Position.fromFen(castle);
    assert.equal(C.toSan(cp, parse(castle, 'O-O')), 'O-O');
    assert.equal(C.toSan(cp, parse(castle, 'O-O-O')), 'O-O-O');
    assert.equal(C.toSan(cp, parse(castle, 'O-O'), { lang: 'ru' }), '0-0');
    assert.equal(C.toSan(cp, parse(castle, 'O-O-O'), { lang: 'ru' }), '0-0-0');
    assert.equal(C.toSan(cp, parse(castle, 'Kd2'), { lang: 'ru' }), 'Крd2');
    assert.equal(C.toSan(cp, parse(castle, 'Rb1+'), { lang: 'ru' }), 'Лb1');

    const promo = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1';
    const pp = C.Position.fromFen(promo);
    assert.equal(C.toSan(pp, parse(promo, 'e8=Q+')), 'e8=Q+');
    assert.equal(C.toSan(pp, parse(promo, 'e8=Q'), { lang: 'ru' }), 'e8=Ф+');
    assert.equal(C.toSan(pp, parse(promo, 'e8=N'), { lang: 'ru' }), 'e8=К');
    assert.equal(C.toSan(pp, parse(promo, 'e8=R'), { lang: 'ru' }), 'e8=Л+');
    assert.equal(C.toSan(pp, parse(promo, 'e8=B'), { lang: 'en' }), 'e8=B');
});

test('toSan: disambiguation by file, rank or both; pawn captures; en passant', () => {
    const f = '4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1';
    const p = C.Position.fromFen(f);
    assert.equal(C.toSan(p, parse(f, 'Nbd2')), 'Nbd2');
    assert.equal(C.toSan(p, parse(f, 'Nfd2')), 'Nfd2');
    assert.equal(C.toSan(p, parse(f, 'Nc3')), 'Nc3');

    const rank = '4k3/8/8/8/R7/8/8/R3K3 w - - 0 1';
    assert.equal(C.toSan(C.Position.fromFen(rank), parse(rank, 'R1a2')), 'R1a2');
    assert.equal(C.toSan(C.Position.fromFen(rank), parse(rank, 'R4a2')), 'R4a2');

    const trio = '4k3/8/8/8/8/Q7/8/Q1Q1K3 w - - 0 1';
    const tp = C.Position.fromFen(trio);
    const sans = C.legalMoves(tp).map((m) => C.toSan(tp, m));
    assert.ok(sans.includes('Qa1c3'), 'file and rank: ' + sans.join(' '));
    assert.ok(sans.includes('Q3c3'));
    assert.ok(sans.includes('Qcc3'));
    for (const san of ['Qa1c3', 'Q3c3', 'Qcc3']) assert.equal(C.toSan(tp, parse(trio, san)), san);

    const ep = 'rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 3';
    const epPos = C.Position.fromFen(ep);
    const m = parse(ep, 'dxe3');
    assert.equal(C.toSan(epPos, m), 'dxe3');
    assert.equal(C.moveFlags(m) & C.F_EP, C.F_EP);
});

test('parseMove: Russian letters, 0-0, figurines and long forms read as the same moves', () => {
    assert.equal(parse(START, 'Кf3'), parse(START, 'Nf3'));
    assert.equal(parse(START, '♘f3'), parse(START, 'Nf3'));
    assert.equal(parse(START, '♞f3'), parse(START, 'Nf3'));
    assert.equal(parse(START, 'Nf3'), parse(START, 'nf3'));
    assert.equal(parse(START, 'g1f3'), parse(START, 'Nf3'));
    assert.equal(parse(START, 'g1-f3'), parse(START, 'Nf3'));
    assert.equal(parse(START, 'Ng1f3'), parse(START, 'Nf3'));
    assert.equal(parse(START, { from: 'g1', to: 'f3' }), parse(START, 'Nf3'));
    assert.equal(parse(START, 'e4!?'), parse(START, 'e4'));
    assert.equal(parse(START, 'e2e4'), parse(START, 'e4'));
    assert.equal(parse(START, 'e2-e4'), parse(START, 'e4'));
    assert.equal(parse(START, 'e4+!'), parse(START, 'e4'));

    const castle = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
    assert.equal(parse(castle, '0-0'), parse(castle, 'O-O'));
    assert.equal(parse(castle, '0-0-0'), parse(castle, 'O-O-O'));
    assert.equal(parse(castle, 'o-o'), parse(castle, 'O-O'));
    assert.equal(uci(parse(castle, '0-0')), 'e1g1');
    assert.equal(uci(parse(castle, '0-0-0')), 'e1c1');
    assert.equal(parse(castle, 'e1g1'), parse(castle, 'O-O'));
    assert.equal(parse(castle, 'Крe2'), parse(castle, 'Ke2'));
    assert.equal(parse(castle, 'Лd1'), parse(castle, 'Rd1'));
    const black = 'r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1';
    assert.equal(uci(parse(black, '0-0')), 'e8g8');
    assert.equal(uci(parse(black, 'O-O-O')), 'e8c8');

    const promo = '7k/4P3/8/8/8/8/8/4K3 w - - 0 1';
    assert.equal(uci(parse(promo, 'e8=Q+')), 'e7e8q');
    assert.equal(uci(parse(promo, 'e8=Ф')), 'e7e8q');
    assert.equal(uci(parse(promo, 'e7e8q')), 'e7e8q');
    assert.equal(uci(parse(promo, 'e7e8n')), 'e7e8n');
    assert.equal(uci(parse(promo, 'e8=b')), 'e7e8b');
    assert.equal(uci(parse(promo, { from: 'e7', to: 'e8', promotion: 'r' })), 'e7e8r');
    // a promotion needs its piece
    assert.equal(parse(promo, 'e8'), C.NO_MOVE);
    assert.equal(parse(promo, { from: 'e7', to: 'e8' }), C.NO_MOVE);
    assert.equal(parse(START, 'e2e4q'), C.NO_MOVE);
});

test('parseMove: a lowercase b before a square is a pawn file, an uppercase B a bishop', () => {
    const f = '4k3/8/8/4B3/8/2p5/1P6/4K3 w - - 0 1';
    assert.equal(uci(parse(f, 'bxc3')), 'b2c3');
    assert.equal(uci(parse(f, 'Bxc3')), 'e5c3');
    assert.equal(uci(parse(f, 'b3')), 'b2b3');
    assert.equal(uci(parse(f, 'b4')), 'b2b4');
    assert.equal(parse(f, 'bxa3'), C.NO_MOVE);
});

test('parseMove: ambiguity lists the candidates; illegal moves give NO_MOVE; garbage is a syntax error', () => {
    const f = '4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1';
    assert.equal(uci(parse(f, 'Nbd2')), 'b1d2');
    assert.equal(uci(parse(f, 'Nfd2')), 'f3d2');
    const e = thrown(() => parse(f, 'Nd2'));
    assert.ok(e, 'ambiguous');
    assert.equal(e.code, 'move');
    assert.equal(e.data.reason, 'ambiguous');
    assert.equal(e.data.candidates.length, 2);
    assert.deepEqual(e.data.candidates.map((c) => c.uci).sort(), ['b1d2', 'f3d2']);
    assert.deepEqual(e.data.candidates.map((c) => c.san).sort(), ['Nbd2', 'Nfd2']);
    assert.equal(String(e.text.in('en')).includes('Nbd2'), true);
    assert.equal(e.message, 'core.move.ambiguous');

    assert.equal(parse(START, 'Nf6'), C.NO_MOVE);
    assert.equal(parse(START, 'e5'), C.NO_MOVE);
    assert.equal(parse(START, 'O-O'), C.NO_MOVE);
    assert.equal(parse(START, 'Qd8'), C.NO_MOVE);
    assert.equal(parse(START, { from: 'e2', to: 'e5' }), C.NO_MOVE);

    for (const bad of [
        '',
        '   ',
        'hello',
        'Z9',
        'e9',
        'Nf',
        'x',
        '!!',
        'N',
        '☃',
        '0-0-0-0',
        'e2e4e5',
        null,
        undefined,
        5.5,
        {},
        { from: 'z1', to: 'e4' },
        { from: 'e2' },
        [],
        true,
    ]) {
        const err = thrown(() => parse(START, bad));
        assert.ok(err, `syntax: ${String(bad)}`);
        assert.equal(err.data.reason, 'syntax', String(bad));
    }
    // an encoded move: only a legal one
    const e4 = parse(START, 'e4');
    assert.equal(parse(START, e4), e4);
    assert.equal(parse(START, 12345), C.NO_MOVE);
    assert.equal(parse(START, 0), C.NO_MOVE);
    // hostile length
    assert.equal(thrown(() => parse(START, 'N'.repeat(100000))).data.reason, 'syntax');
});

test('Game.play: typed errors for illegal, ambiguous and unreadable moves', () => {
    const g = new C.Game();
    assert.equal(thrown(() => g.play('e5')).data.reason, 'illegal');
    assert.equal(thrown(() => g.play('nonsense')).data.reason, 'syntax');
    assert.equal(g.moves.length, 0);
    const a = new C.Game('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
    assert.equal(thrown(() => a.play('Nd2')).data.reason, 'ambiguous');
    assert.equal(a.moves.length, 0);
});

test('status: checkmate, stalemate, insufficient material, ongoing', () => {
    const g = new C.Game();
    assert.deepEqual(g.status(), { state: 'ongoing' });
    for (const san of ['f3', 'e5', 'g4', 'Qh4#']) g.play(san);
    assert.deepEqual(g.sans, ['f3', 'e5', 'g4', 'Qh4#']);
    assert.deepEqual(g.status(), { state: 'checkmate', winner: 'black' });
    assert.deepEqual(g.legal(), []);

    const white = new C.Game('7k/8/6K1/8/8/8/8/R7 w - - 0 1');
    white.play('Ra8#');
    assert.deepEqual(white.status(), { state: 'checkmate', winner: 'white' });

    assert.deepEqual(new C.Game('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1').status(), { state: 'stalemate' });
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/8/8 w - - 0 1').status().state, 'insufficient');
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/4B3/8 w - - 0 1').status().state, 'insufficient');
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/4N3/8 b - - 0 1').status().state, 'insufficient');
    // bishops on squares of one color: insufficient; of two colors: ongoing
    assert.equal(new C.Game('8/8/4k1b1/8/8/4K3/4B3/8 w - - 0 1').status().state, 'insufficient');
    assert.equal(new C.Game('8/8/4k1b1/8/8/4K3/3B4/8 w - - 0 1').status().state, 'ongoing');
    // two knights against a bare king: ongoing (a mate is possible with help)
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/3NN3/8 w - - 0 1').status().state, 'ongoing');
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/3N4/8 w - - 0 1').status().state, 'insufficient');
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/3P4/8 w - - 0 1').status().state, 'ongoing');
    // fifty-move rule
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/3R4/8 w - - 99 80').status().state, 'ongoing');
    assert.equal(new C.Game('8/8/4k3/8/8/4K3/3R4/8 w - - 100 80').status().state, 'fifty');
    // a mate on the hundredth ply is a mate, not a draw
    const late = new C.Game('7k/8/6K1/8/8/8/8/R7 w - - 99 80');
    late.play('Ra8#');
    assert.deepEqual(late.status(), { state: 'checkmate', winner: 'white' });
});

test('status: threefold repetition is counted on the game real history', () => {
    const g = new C.Game();
    const cycle = ['Nf3', 'Nf6', 'Ng1', 'Ng8'];
    for (const s of cycle) g.play(s);
    assert.equal(g.status().state, 'ongoing', 'the start position has occurred twice');
    for (const s of cycle.slice(0, 3)) g.play(s);
    assert.equal(g.status().state, 'ongoing');
    g.play('Ng8');
    assert.deepEqual(g.status(), { state: 'threefold' });
    // undo takes the draw back
    assert.equal(g.undo(), true);
    assert.equal(g.status().state, 'ongoing');
    assert.equal(g.moves.length, 7);
    assert.equal(g.sans.length, 7);
});

test('Game: undo, legal, fen, history and the ply limit', () => {
    const g = new C.Game();
    assert.equal(g.undo(), false);
    assert.equal(g.legal().length, 20);
    assert.deepEqual(g.legal()[0], { uci: g.legal()[0].uci, san: g.legal()[0].san });
    assert.ok(g.legal().some((l) => l.uci === 'g1f3' && l.san === 'Nf3'));
    const m = g.play('e4');
    assert.equal(m, parse(START, 'e4'));
    assert.equal(g.fen(), 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1');
    assert.equal(g.position.fen(), g.fen());
    g.play('Кf6');
    assert.deepEqual(g.sans, ['e4', 'Nf6']);
    assert.equal(g.undo(), true);
    assert.equal(g.undo(), true);
    assert.equal(g.fen(), START);
    assert.equal(g.moves.length, 0);

    // a game as long as the history holds, then one ply more
    const long = new C.Game('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    const shuffle = ['Ra2', 'Kd8', 'Ra1', 'Ke8'];
    for (let i = 0; i < C.MAX_PLY; i++) long.play(shuffle[i % 4]);
    assert.equal(long.moves.length, C.MAX_PLY);
    const e = thrown(() => long.play('Ra2'));
    assert.ok(e);
    assert.equal(e.code, 'game');
    assert.equal(e.data.reason, 'limit');
    assert.equal(long.moves.length, C.MAX_PLY);
    assert.equal(typeof long.status().state, 'string');
    assert.ok(long.legal().length > 0);
    assert.equal(long.undo(), true);
    long.play('Ke8');
    assert.ok(long.pgn().length > 0);
});

test('parsePgn and writePgn: a game with a variation, a comment and a NAG round trips', () => {
    const text = '1. e4 e5 (1... c5 2. Nf3) 2. Nf3 {good} Nc6 $1 *';
    const game = C.parsePgn(text);
    assert.deepEqual(game.headers, {});
    assert.equal(game.result, '*');
    assert.equal(game.root.move, 0);
    assert.deepEqual(game.root.nags, []);
    const e4 = game.root.children[0];
    assert.equal(e4.san, 'e4');
    assert.equal(e4.move, parse(START, 'e4'));
    const e5 = e4.children[0];
    assert.equal(e5.san, 'e5');
    assert.equal(e4.children.length, 2);
    assert.equal(e4.children[1].san, 'c5');
    assert.equal(e4.children[1].children[0].san, 'Nf3');
    const nf3 = e5.children[0];
    assert.equal(nf3.comment, 'good');
    assert.deepEqual(nf3.children[0].nags, [1]);
    assert.equal(nf3.children[0].san, 'Nc6');
    assert.equal(C.writePgn(game), text);
    assert.equal(C.writePgn(C.parsePgn(C.writePgn(game))), text);
    // in Russian, and back
    const ru = C.writePgn(game, { lang: 'ru' });
    assert.equal(ru, '1. e4 e5 (1... c5 2. Кf3) 2. Кf3 {good} Кc6 $1 *');
    assert.equal(C.writePgn(C.parsePgn(ru)), text);
});

test('parsePgn: headers, results, ; comments, annotation marks, glued move numbers and escapes', () => {
    const text = [
        '[Event "A \\"big\\" game"]',
        '[White "Ann \\\\ Bob"]',
        '[Black "?"]',
        '[Result "1-0"]',
        '',
        '1.e4 e5 ; a line comment',
        '2.Nf3!? {first {not nested} } Nc6?? 3.Bb5 a6 1-0',
    ].join('\n');
    // a comment ends at the first closing brace: the text after it is read as moves and fails cleanly
    const e = thrown(() => C.parsePgn(text));
    assert.ok(e);
    assert.equal(e.code, 'pgn');

    const ok = [
        '[Event "A \\"big\\" game"]',
        '[White "Ann \\\\ Bob"]',
        '[Result "1-0"]',
        '',
        '1.e4 e5 ; a line comment',
        '2.Nf3!? {first} Nc6?? 3.Bb5 a6 1-0',
    ].join('\n');
    const g = C.parsePgn(ok);
    assert.equal(g.headers.Event, 'A "big" game');
    assert.equal(g.headers.White, 'Ann \\ Bob');
    assert.equal(g.result, '1-0');
    let node = g.root;
    const sans = [];
    while (node.children.length) {
        node = node.children[0];
        sans.push(node.san);
    }
    assert.deepEqual(sans, ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']);
    const e5 = g.root.children[0].children[0];
    assert.equal(e5.comment, 'a line comment');
    const nf3 = e5.children[0];
    assert.deepEqual(nf3.nags, [5]);
    assert.equal(nf3.comment, 'first');
    assert.deepEqual(nf3.children[0].nags, [4]);
    const out = C.writePgn(g);
    assert.ok(out.startsWith('[Event "A \\"big\\" game"]\n[White "Ann \\\\ Bob"]\n[Result "1-0"]\n\n1. e4 e5 {a line comment}'));
    assert.ok(out.endsWith('1-0'));
    assert.deepEqual(C.parsePgn(out).headers, g.headers);

    // Russian letters, 0-0 and no headers at all
    const ru = C.parsePgn('1. e4 e5 2. Кf3 Кc6 3. Сc4 Сc5 4. 0-0 Кf6 *');
    let n = ru.root;
    const list = [];
    while (n.children.length) {
        n = n.children[0];
        list.push(n.san);
    }
    assert.deepEqual(list, ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O', 'Nf6']);
    // the result comes from the headers when the text has none
    assert.equal(C.parsePgn('[Result "0-1"]\n\n1. f3').result, '0-1');
    assert.equal(C.parsePgn('1. f3 1/2-1/2').result, '1/2-1/2');
    assert.equal(C.parsePgn('').result, '*');
});

test('parsePgn: a FEN header sets the start; nested variations; comments before the first move', () => {
    const fen = '4k3/4p3/8/8/8/8/4P3/4K3 w - - 0 1';
    const body = '{start} 1. e4 (1. e3 e5 (1... Kd7) 2. Kd2) 1... Kd7 *';
    const g = C.parsePgn(`[SetUp "1"]
[FEN "${fen}"]

${body}`);
    assert.equal(g.root.comment, 'start');
    const e4 = g.root.children[0];
    assert.equal(e4.san, 'e4');
    assert.equal(e4.move, parse(fen, 'e4'));
    assert.equal(e4.children[0].san, 'Kd7');
    const e3 = g.root.children[1];
    assert.equal(e3.san, 'e3');
    assert.equal(e3.children.length, 2);
    assert.equal(e3.children[0].san, 'e5');
    assert.equal(e3.children[1].san, 'Kd7');
    assert.equal(e3.children[0].children[0].san, 'Kd2');
    assert.equal(
        C.writePgn(g),
        `[SetUp "1"]
[FEN "${fen}"]

${body}`,
    );
});

test('parsePgn: bad input is a typed pgn error, never another kind of throw', () => {
    const cases = {
        '1. e4 e5 2. Ke4': 'move', // illegal
        '1. e4 {unterminated': 'syntax',
        '1. e4 e5 (1... c5': 'syntax',
        '1. e4 (1... c5)': 'move',
        '1. e4 )': 'syntax',
        '( 1. e4 )': 'syntax',
        '[Event "x" 1. e4': 'syntax',
        '1. e4 e5 2. Nonsense': 'move',
        '[FEN "not a fen"]\n\n1. e4': 'fen',
    };
    for (const [text, reason] of Object.entries(cases)) {
        const e = thrown(() => C.parsePgn(text));
        assert.ok(e, text);
        assert.equal(e.code === 'pgn' || e.code === 'fen', true, text);
        if (e.code === 'pgn') assert.equal(e.data.reason, reason, text);
        assert.equal(typeof e.text.in('en'), 'string');
    }
    for (const x of [null, undefined, 5, {}]) {
        const e = thrown(() => C.parsePgn(x));
        assert.equal(e.data.reason, 'syntax');
    }
});

test('parsePgnGames and Game.fromPgn / Game.pgn', () => {
    const two = '[Event "One"]\n\n1. e4 e5 1-0\n\n[Event "Two"]\n[Result "0-1"]\n\n1. d4 d5 2. c4 0-1\n';
    const games = C.parsePgnGames(two);
    assert.equal(games.length, 2);
    assert.equal(games[0].headers.Event, 'One');
    assert.equal(games[0].result, '1-0');
    assert.equal(games[1].root.children[0].san, 'd4');
    assert.equal(games[1].result, '0-1');
    assert.equal(C.parsePgnGames('').length, 0);

    const g = C.Game.fromPgn('[Event "T"]\n\n1. e4 e5 2. Nf3 Nc6 *');
    assert.deepEqual(g.sans, ['e4', 'e5', 'Nf3', 'Nc6']);
    assert.equal(g.moves.length, 4);
    const text = g.pgn({ White: 'Ann', Black: 'Bob' });
    assert.ok(text.includes('[White "Ann"]'));
    assert.ok(text.includes('[Black "Bob"]'));
    assert.ok(text.includes('[Result "*"]'));
    assert.ok(text.trimEnd().endsWith('1. e4 e5 2. Nf3 Nc6 *'));
    assert.deepEqual(C.Game.fromPgn(text).sans, g.sans);

    const mate = new C.Game();
    for (const s of ['f3', 'e5', 'g4', 'Qh4#']) mate.play(s);
    assert.ok(mate.pgn().trimEnd().endsWith('1. f3 e5 2. g4 Qh4# 0-1'));
    assert.equal(C.Game.fromPgn(mate.pgn()).status().state, 'checkmate');

    const fenGame = new C.Game('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    fenGame.play('e4');
    const fenPgn = fenGame.pgn();
    assert.ok(fenPgn.includes('[FEN "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1"]'));
    assert.ok(fenPgn.includes('[SetUp "1"]'));
    assert.deepEqual(C.Game.fromPgn(fenPgn).sans, ['e4']);

    const bad = thrown(() => C.Game.fromPgn('1. e4 e5 2. Ke4'));
    assert.equal(bad.code, 'pgn');
});

test('every legal move of hard positions survives toSan -> parseMove in both languages, and as UCI', () => {
    const fens = [
        START,
        'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
        '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
        'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
        'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
        '8/7k/8/8/Q1Q5/8/8/Q1Q1K3 w - - 0 1',
    ];
    let checked = 0;
    for (const fen of fens) {
        const pos = C.Position.fromFen(fen);
        for (const m of C.legalMoves(pos)) {
            for (const lang of ['en', 'ru']) {
                const san = C.toSan(pos, m, { lang });
                assert.equal(C.parseMove(pos, san), m, `${fen}: ${san}`);
                checked++;
            }
            assert.equal(C.parseMove(pos, C.moveToUci(m)), m, C.moveToUci(m));
        }
        // and one ply deeper
        for (const m of C.legalMoves(pos).slice(0, 12)) {
            pos.make(m);
            for (const reply of C.legalMoves(pos)) assert.equal(C.parseMove(pos, C.toSan(pos, reply)), reply);
            pos.unmake();
        }
    }
    assert.ok(checked > 250, String(checked));
});

test('hostile text never throws anything but a ChessError', () => {
    let seed = 12345;
    const rnd = (n) => {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed % n;
    };
    const pieces = [
        '1.',
        'e4',
        'e5',
        'Nf3',
        '(',
        ')',
        '{',
        '}',
        ';',
        '$1',
        '$',
        '[',
        ']',
        '"',
        '*',
        '1-0',
        '0-0',
        'O-O-O',
        '!?',
        '\n',
        ' ',
        'x',
        '=Q',
        '\\',
        '%',
        '12...',
        'Кf3',
    ];
    const pos = C.Position.fromFen(START);
    for (let k = 0; k < 3000; k++) {
        let text = '';
        for (let j = 0, n = rnd(14); j < n; j++) text += pieces[rnd(pieces.length)] + (rnd(2) ? ' ' : '');
        for (const fn of [() => C.parsePgn(text), () => C.parsePgnGames(text), () => C.parseMove(pos, text)]) {
            try {
                fn();
            } catch (e) {
                assert.ok(e instanceof C.ChessError, `${JSON.stringify(text)}: ${e}`);
            }
        }
    }
});

test('a PGN longer than the history is a typed error; toSan works at the end of the history', () => {
    const shuffle = ['Ra2', 'Kd8', 'Ra1', 'Ke8'];
    let text = '[FEN "4k3/8/8/8/8/8/8/R3K3 w - - 0 1"]\n\n';
    for (let i = 0; i < C.MAX_PLY + 2; i++) text += (i % 2 ? '' : `${i / 2 + 1}. `) + shuffle[i % 4] + ' ';
    const e = thrown(() => C.parsePgn(text));
    assert.ok(e);
    assert.equal(e.code, 'pgn');
    assert.equal(e.data.reason, 'move');
    const g = new C.Game('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    for (let i = 0; i < C.MAX_PLY; i++) g.play(shuffle[i % 4]);
    const m = C.legalMoves(g.position)[0];
    assert.equal(typeof C.toSan(g.position, m), 'string');
    assert.equal(g.position.ply, C.MAX_PLY);
});

test('parsePgn: an unclosed ( is reported at the ( itself, not at the end of the text', () => {
    const text = '1. e4 e5 (1... c5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6\n5. O-O e6';
    const e = thrown(() => C.parsePgn(text));
    assert.equal(e.data.reason, 'syntax');
    assert.equal(e.data.cause, 'variation-open');
    assert.equal(e.data.line, 1, 'the ( is on line 1 though the text ends on line 2');
    assert.equal(e.data.text, '(1...');
    // the innermost open variation is the one named
    const nested = thrown(() => C.parsePgn('1. e4 e5\n2. Nf3 (2. Bc4 Nf6 (2... Bc5\n3. Nf3'));
    assert.equal(nested.data.cause, 'variation-open');
    assert.equal(nested.data.line, 2);
    assert.equal(nested.data.text, '(2...');
});

test('parsePgn: Unicode white space is white space, not a syntax error', () => {
    const plain = C.writePgn(C.parsePgn('[Event "x"]\n\n1. e4 e5 2. Nf3 *'));
    // NBSP, em space, ideographic space, line separator, narrow NBSP, the BOM as a space, thin space
    for (const code of [0xa0, 0x2003, 0x3000, 0x2028, 0x202f, 0xfeff, 0x2009]) {
        const space = String.fromCharCode(code);
        const text = `[Event "x"]${space}\n\n${space}1.${space}e4${space}e5 (1... c5)${space}2.${space}Nf3${space}*`;
        const g = C.parsePgn(text);
        assert.equal(g.root.children[0].san, 'e4', code.toString(16));
        assert.equal(g.root.children[0].children[1].san, 'c5');
        assert.equal(g.root.children[0].children[0].children[0].san, 'Nf3');
        assert.equal(g.headers.Event, 'x');
    }
    const nbsp = String.fromCharCode(0xa0);
    assert.equal(C.writePgn(C.parsePgn(`[Event${nbsp}"x"]${nbsp}\n\n1.${nbsp}e4${nbsp}e5${nbsp}2.${nbsp}Nf3${nbsp}*`)), plain);
    const ideo = String.fromCharCode(0x3000);
    assert.equal(C.parsePgnGames(`1. e4 e5 1-0${nbsp}${nbsp}\n${ideo}[Event "B"]\n\n1. d4 *`).length, 2);
    // real errors are still errors
    assert.equal(thrown(() => C.parsePgn('1. e4 {')).data.reason, 'syntax');
});

test('toSan, writePgn and Game.pgn accept null options as {}', () => {
    const pos = C.Position.fromFen(START);
    const e4 = C.parseMove(pos, 'e4');
    assert.equal(C.toSan(pos, e4, null), 'e4');
    assert.equal(C.toSan(pos, e4, undefined), 'e4');
    assert.equal(C.toSan(pos, C.parseMove(pos, 'Nf3'), {}), 'Nf3');
    const tree = C.parsePgn('1. e4 e5 2. Nf3 *');
    assert.equal(C.writePgn(tree, null), C.writePgn(tree));
    assert.equal(C.writePgn(tree, null), '1. e4 e5 2. Nf3 *');
    const g = new C.Game();
    g.play('e4');
    assert.equal(g.pgn({}, null), g.pgn());
    assert.equal(g.pgn(null, null), g.pgn());
    assert.equal(g.pgn({}, { lang: 'ru' }).includes('1. e4'), true);
});

test('NAGs: 0 to 255 round trip; a huge one is a typed pgn error and never written as $1e+23', () => {
    const g = C.parsePgn('1. e4 $0 $255 e5 $7 *');
    assert.deepEqual(g.root.children[0].nags, [0, 255]);
    assert.equal(C.writePgn(g), '1. e4 $0 $255 e5 $7 *');
    // a NAG is read by its value, however many zeros it is written with
    const zeros = C.parsePgn(`1. e4 $${'0'.repeat(22)}1 $007 $000 $00255 *`);
    assert.deepEqual(zeros.root.children[0].nags, [1, 7, 0, 255]);
    assert.equal(C.writePgn(zeros), '1. e4 $1 $7 $0 $255 *');
    for (const nag of ['$256', '$1000', '$99999999999999999999999', '$0000000000000000000000256', `$${'9'.repeat(400)}`]) {
        const e = thrown(() => C.parsePgn(`1. e4 ${nag} e5 *`));
        assert.equal(e.code, 'pgn', nag);
        assert.equal(e.data.reason, 'syntax', nag);
        assert.equal(e.data.cause, 'token', nag);
    }
    // a game built by hand with a NAG that cannot be written leaves it out instead of writing $1e+23
    const hand = C.parsePgn('1. e4 e5 *');
    hand.root.children[0].nags.push(1e23, -1, 1.5, NaN, 12);
    hand.root.nags = [Infinity, 3];
    const text = C.writePgn(hand);
    assert.equal(text, '$3 1. e4 $12 e5 *');
    assert.equal(/e\+/.test(text), false);
});

test('a FEN tag that is empty or bad is a typed error from parsePgn, Game.fromPgn and parseGame alike', () => {
    for (const text of ['[FEN ""]\n\n1. e4', '[FEN ""]', '[FEN "  "]\n\n*', '[FEN "8/8/8/8/8/8/8/8 w - - 0 1"]\n\n*']) {
        for (const read of [(t) => C.parsePgn(t), (t) => C.parsePgnGames(t), (t) => C.Game.fromPgn(t)]) {
            const e = thrown(() => read(text));
            assert.ok(e, text);
            assert.equal(e.code === 'pgn' || e.code === 'fen', true, text);
            assert.equal(typeof e.text.in('en'), 'string');
        }
    }
});

test('Game.play and PGN moves keep why a move was refused: data.reason and data.cause', () => {
    const g = new C.Game();
    const illegal = thrown(() => g.play('e5'));
    assert.deepEqual([illegal.code, illegal.data.reason, illegal.data.cause], ['move', 'illegal', 'illegal']);
    assert.equal(thrown(() => g.play({ from: 'e2', to: 'e5' })).data.cause, 'illegal');
    assert.equal(thrown(() => g.play(12345)).data.cause, 'illegal');
    assert.equal(thrown(() => g.play('nonsense')).data.cause, 'syntax');
    const a = new C.Game('4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1');
    const ambiguous = thrown(() => a.play('Nd2'));
    assert.deepEqual([ambiguous.code, ambiguous.data.reason, ambiguous.data.cause], ['move', 'ambiguous', 'ambiguous']);
    assert.equal(ambiguous.data.candidates.length, 2);
    // the same causes survive inside a PGN error
    const fen = '[FEN "4k3/8/8/8/8/5N2/8/1N2K3 w - - 0 1"]\n\n';
    assert.equal(thrown(() => C.parsePgn(`${fen}1. Nd2`)).data.cause, 'ambiguous');
    assert.equal(thrown(() => C.parsePgn(`${fen}1. Nb5`)).data.cause, 'illegal');
    assert.equal(thrown(() => C.parsePgn(`${fen}1. Nonsense`)).data.cause, 'syntax');
    assert.equal(thrown(() => C.parsePgn('1. e4 e5 2. Ke4')).data.reason, 'move');
});

test('writePgn leaves out an empty FEN tag, so that what is written always reads back', () => {
    for (const fen of ['', '   ', undefined]) {
        const game = C.parsePgn('1. e4 e5 *');
        game.headers = { Event: 'x', FEN: fen };
        const text = C.writePgn(game);
        assert.equal(text.includes('FEN'), false, JSON.stringify(fen));
        const back = C.parsePgn(text);
        assert.equal(back.root.children[0].san, 'e4');
        assert.deepEqual(back.headers, { Event: 'x' });
        assert.equal(C.writePgn(back), text);
    }
    // Game.pgn with an empty FEN header: the same
    const g = new C.Game();
    g.play('e4');
    const text = g.pgn({ FEN: '' });
    assert.equal(text.includes('[FEN'), false);
    assert.deepEqual(C.Game.fromPgn(text).sans, ['e4']);
    // a real FEN is kept and reads back
    const fenGame = new C.Game('4k3/8/8/8/8/8/4P3/4K3 w - - 0 1');
    fenGame.play('e4');
    assert.deepEqual(C.Game.fromPgn(fenGame.pgn()).sans, ['e4']);
});
