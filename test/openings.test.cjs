// openings: the generated data (every line legal, no hash collisions), the lookup by position (transpositions, FEN,
// deviations), hostile input, the Russian names and the book of moves.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let E; // endgame (the public side of the unit)
let D; // endgame/openings-data
let O; // endgame/openings (the index)
let C; // core
let I; // i18n

before(async () => {
    E = await import('../src/endgame/index.js');
    D = await import('../src/endgame/openings-data.js');
    O = await import('../src/endgame/openings.js');
    C = await import('../src/core/index.js');
    I = await import('../src/i18n/index.js');
});

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const NAJDORF = '1.e4 c5 2.Nf3 d6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6';

// every position of every line: [epd, hash key] (replayed with the engine)
function walk(line, visit) {
    const pos = C.Position.fromFen(START);
    visit(pos, -1);
    line.split(' ').forEach((uci, i) => {
        const m = C.legalMoves(pos).find((x) => C.moveToUci(x) === uci);
        assert.ok(m, `illegal move ${uci} at ply ${i + 1} of ${line}`);
        pos.make(m);
        visit(pos, i);
    });
}

test('the data: [eco, name, uci line] entries with a header naming source and licence', () => {
    const { OPENINGS } = D;
    assert.ok(Array.isArray(OPENINGS) && OPENINGS.length > 3000, `entries: ${OPENINGS.length}`);
    for (const e of OPENINGS) {
        assert.equal(e.length, 3);
        assert.match(e[0], /^[A-E]\d\d$/);
        assert.ok(typeof e[1] === 'string' && e[1].length > 2);
        assert.match(e[2], /^[a-h][1-8][a-h][1-8][nbrq]?( [a-h][1-8][a-h][1-8][nbrq]?)*$/);
    }
    const head = fs.readFileSync(path.join(__dirname, '../src/endgame/openings-data.js'), 'utf8').slice(0, 600);
    assert.match(head, /lichess-org\/chess-openings/);
    assert.match(head, /CC0/);
    assert.match(head, /20\d\d-\d\d-\d\d/);
});

test('the data: every line is legal from the start position', () => {
    for (const [, , line] of D.OPENINGS) walk(line, () => {});
});

test('the data: the 64-bit hash of a position identifies it (no collisions among the positions of the dataset)', () => {
    const byHash = new Map(); // full hash → epd
    const byEpd = new Map(); // epd → full hash
    const by53 = new Map(); // the 53-bit key the index uses → epd
    for (const [, , line] of D.OPENINGS) {
        walk(line, (pos) => {
            const epd = pos.fen().split(' ').slice(0, 4).join(' ');
            const h = `${pos.hashHi >>> 0}:${pos.hashLo >>> 0}`;
            const k = O.hashKey(pos);
            for (const [map, key] of [
                [byHash, h],
                [by53, k],
            ]) {
                const seen = map.get(key);
                assert.ok(seen === undefined || seen === epd, `collision: ${seen} vs ${epd}`);
                map.set(key, epd);
            }
            const seen = byEpd.get(epd);
            assert.ok(seen === undefined || seen === h, `one position, two hashes: ${epd}`);
            byEpd.set(epd, h);
        });
    }
    assert.equal(byHash.size, byEpd.size);
    assert.equal(by53.size, byEpd.size);
    assert.ok(byEpd.size > 7000, `positions: ${byEpd.size}`);
});

test('the Najdorf line is B90, in both languages', () => {
    const r = E.openingName(NAJDORF);
    assert.equal(r.ok, true);
    assert.equal(r.kind, 'opening');
    assert.equal(r.eco, 'B90');
    assert.match(String(r.name.en), /Najdorf/);
    assert.match(String(r.name.ru), /Найдорф/);
    assert.equal(r.ply, 10);
    assert.deepEqual(r.moves, ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6']);
    assert.ok(r.name instanceof I.Msg);
    assert.equal(JSON.parse(JSON.stringify(r)).name.ru, r.name.ru);
});

test('transpositions match by position: 1.d4 Nf6 2.c4 e6 3.Nc3 Bb4 and 1.c4 e6 2.Nc3 Nf6 3.d4 Bb4', () => {
    for (const text of ['1.d4 Nf6 2.c4 e6 3.Nc3 Bb4', '1.c4 e6 2.Nc3 Nf6 3.d4 Bb4', '1.c4 Nf6 2.Nc3 e6 3.d4 Bb4']) {
        const r = E.openingName(text);
        assert.equal(r.kind, 'opening', text);
        assert.match(String(r.name.en), /Nimzo-Indian/, text);
        assert.match(r.eco, /^E[2-3]\d$/);
        assert.equal(r.ply, 6);
    }
});

test('the start position names nothing; nor does an empty game or a position out of the books', () => {
    assert.deepEqual(E.openingName(START), { ok: true, kind: 'none' });
    assert.deepEqual(E.openingName(`[Event "x"]\n\n*`), { ok: true, kind: 'none' });
    assert.deepEqual(E.openingName('8/8/4k3/8/8/4K3/4P3/8 w - - 0 1'), { ok: true, kind: 'none' });
    assert.deepEqual(E.openingName('[FEN "8/8/4k3/8/8/8/4P3/4K3 w - - 0 1"]\n\n1.e4 Kd6'), { ok: true, kind: 'none' });
});

test('a FEN matches by position, whatever the clocks say', () => {
    const g = new C.Game();
    for (const san of NAJDORF.replace(/\d+\./g, ' ').trim().split(/\s+/)) g.play(san);
    const fen = g.position.fen();
    const r = E.openingName(fen);
    assert.equal(r.eco, 'B90');
    assert.ok(r.ply >= 10);
    assert.ok(r.moves.length === r.ply);
    const clocks = fen.split(' ').slice(0, 4).join(' ') + ' 17 99';
    assert.equal(E.openingName(clocks).eco, 'B90');
    // the position after 1.e4 (the ep square is not set: no black pawn can capture)
    const e4 = E.openingName('rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1');
    assert.equal(e4.kind, 'opening');
    assert.match(String(e4.name.en), /King's Pawn/);
});

test('input forms: SAN with and without numbers, UCI, Russian letters, castling marks, a PGN with headers and comments', () => {
    const want = E.openingName(NAJDORF);
    const forms = [
        'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6',
        'e2e4 c7c5 g1f3 d6 d2d4 c5d4 f3d4 g8f6 b1c3 a7a6',
        '1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 *',
        'e4 c5 Кf3 d6 d4 cxd4 Кxd4 Кf6 Кc3 a6',
        '1.e4 c5 2.♘f3 d6 3.d4 cxd4 4.♘xd4 ♘f6 5.♘c3 a6',
        '[Event "?"]\n[Result "*"]\n\n1. e4 {best by test} c5 2. Nf3 $1 d6 3. d4 (3. Bb5+) cxd4 4. Nxd4 Nf6 5. Nc3 a6 ; the rest\n*',
        '  1.e4   c5\n2.Nf3\td6 3.d4 cxd4 4.Nxd4 Nf6 5.Nc3 a6  ',
    ];
    for (const f of forms) {
        const r = E.openingName(f);
        assert.equal(r.kind, 'opening', f);
        assert.equal(r.eco, want.eco, f);
        assert.equal(r.ply, want.ply, f);
    }
    // castling in both spellings
    const castled = (c) => E.openingName(`1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.${c}`);
    assert.equal(castled('O-O').eco, castled('0-0').eco);
    assert.equal(castled('O-O').kind, 'opening');
});

test('the deepest known position wins; moves after the book are ignored', () => {
    const short = E.openingName('1.e4 e5 2.Nf3 Nc6 3.Bb5');
    assert.match(String(short.name.en), /Ruy Lopez/);
    assert.equal(short.ply, 5);
    const far = E.openingName(
        '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 d6 8.c3 O-O 9.h3 Nb8 10.d4 Nbd7 11.Nbd2 Bb7 12.Bc2 Re8 13.a4 Bf8 14.Qe2 g6',
    );
    assert.equal(far.kind, 'opening');
    assert.match(String(far.name.en), /Ruy Lopez/);
    assert.ok(far.ply >= 17 && far.ply <= 28, `ply ${far.ply}`);
    assert.equal(far.moves.length, far.ply);
    // an off-book start: the opening is the last named position even when the line wanders away
    const gone = E.openingName('1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Qe2 b5 7.Bb3 d6 8.a4 Bg4 9.h3 Bh5 10.g4 Bg6');
    assert.equal(gone.kind, 'opening');
    assert.match(String(gone.name.en), /Ruy Lopez/);
});

test('a position handed in is not touched, and the same input names the same opening twice', () => {
    const a = E.openingName(NAJDORF);
    const b = E.openingName(NAJDORF);
    assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)));
    const p = C.Position.fromFen(START);
    const before = [p.hashLo, p.hashHi, p.fen()];
    E.bookMoves(p);
    assert.deepEqual([p.hashLo, p.hashHi, p.fen()], before);
});

test('hostile input is a typed invalid result, never a throw', () => {
    const bad = [
        undefined,
        null,
        42,
        {},
        [],
        '',
        '   ',
        'hello world',
        '1.e4 e5 2.Ke4',
        'e2e5',
        '1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Bxf7+',
        '1.e4 e5 2.Nf3 ((((((',
        '[Event',
        '{ unterminated',
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR',
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR x KQkq - 0 1',
        '4k3/8/8/8/8/8/8/KK6 w - - 0 1',
        'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNP w KQkq - 0 1',
        'P7/8/8/8/8/8/8/4K2k w - - 0 1',
        '4k3/8/8/8/8/8/4q3/4K3 b - - 0 1',
        'x'.repeat(300000),
        'e4 '.repeat(50000),
    ];
    for (const input of bad) {
        let r;
        assert.doesNotThrow(() => (r = E.openingName(input)), String(input).slice(0, 30));
        assert.equal(r.ok, false, String(input).slice(0, 30));
        assert.equal(r.kind, 'invalid');
        assert.ok(typeof r.code === 'string' && r.code.length > 0);
        assert.ok(r.reason instanceof I.Msg);
        assert.ok(String(r.reason.ru).length > 3 && !/^openings\./.test(String(r.reason.ru)), `reason: ${r.reason.ru}`);
        assert.ok(String(r.reason.en).length > 3 && !/^openings\./.test(String(r.reason.en)));
    }
    assert.equal(E.openingName(null).code, 'type');
    assert.equal(E.openingName('').code, 'empty');
    assert.equal(E.openingName('1.e4 e5 2.Ke4').code, 'pgn');
    assert.equal(E.openingName('4k3/8/8/8/8/8/8/KK6 w - - 0 1').code, 'fen');
});

test('Russian names: families, variation words, proper names, the English fallback', () => {
    const ru = (eco, en) => String(E.openings.name(eco, en).ru);
    const en = (eco, en) => String(E.openings.name(eco, en).en);
    assert.equal(ru('B20', 'Sicilian Defense'), 'Сицилианская защита');
    assert.equal(ru('C60', 'Ruy Lopez'), 'Испанская партия');
    assert.equal(ru('C50', 'Italian Game'), 'Итальянская партия');
    assert.equal(ru('D06', "Queen's Gambit"), 'Ферзевый гамбит');
    assert.equal(ru('E60', "King's Indian Defense"), 'Староиндийская защита');
    assert.equal(ru('D80', 'Grünfeld Defense'), 'Защита Грюнфельда');
    assert.equal(ru('C00', 'French Defense'), 'Французская защита');
    assert.equal(ru('B10', 'Caro-Kann Defense'), 'Защита Каро — Канн');
    assert.equal(ru('E20', 'Nimzo-Indian Defense'), 'Нимцо-индийская защита');
    assert.equal(ru('B00', 'Nimzowitsch Defense'), 'Защита Нимцовича (1.e4 Nc6)');
    assert.match(ru('B90', 'Sicilian Defense: Najdorf Variation'), /^Сицилианская защита: .*Найдорф/);
    assert.match(ru('B90', 'Sicilian Defense: Najdorf Variation'), /вариант/i);
    assert.match(ru('B23', 'Sicilian Defense: Grand Prix Attack'), /атака/i);
    assert.match(ru('C30', "King's Gambit Accepted: Kieseritzky Gambit"), /гамбит/i);
    // an unknown word stays English
    assert.match(ru('A00', 'Frobnitz Opening'), /Frobnitz/);
    assert.match(ru('B90', 'Sicilian Defense: Zxqvk Variation'), /^Сицилианская защита: вариант Zxqvk$/);
    // the English name is the name from the data itself
    assert.equal(en('B90', 'Sicilian Defense: Najdorf Variation'), 'Sicilian Defense: Najdorf Variation');
    // never throws on anything
    for (const odd of ['', ':', ', ,', 'Variation', 'a: b: c, d', 'x'.repeat(2000)]) assert.doesNotThrow(() => String(E.openings.name('A00', odd).ru));
    assert.doesNotThrow(() => String(E.openings.name(undefined, undefined).ru));
});

test('Russian names: the families are all translated, and most of the dataset reads in Russian', () => {
    const families = new Set(D.OPENINGS.map((e) => e[1].split(':')[0]));
    assert.ok(families.size > 100, `families: ${families.size}`);
    const latin = /[A-Za-zÀ-ÿ]/;
    // the moves in a name (Bd3, g3, Bb4+, 4. Bg5, …) are not words
    const words = (s) => s.replace(/(?<![\w])(?:\d+\.|[KQRBN]?[a-h]?x?[a-h][1-8][+#]?)(?![\w])/g, '');
    const untranslated = [...families].filter((f) => latin.test(words(String(E.openings.name('A00', f).ru))));
    assert.deepEqual(untranslated, [], 'families left in English');
    let clean = 0;
    for (const [eco, name] of D.OPENINGS) {
        const r = String(E.openings.name(eco, name).ru);
        assert.ok(r.length > 0 && !/[{}%]|undefined|null/.test(r), r);
        if (!latin.test(words(r))) clean++;
    }
    const share = clean / D.OPENINGS.length;
    assert.ok(share > 0.78, `fully Russian names: ${(share * 100).toFixed(1)}%`);
});

test('bookMoves: the start position offers the main openings, weighted by the number of lines', () => {
    const start = C.Position.fromFen(START);
    const book = E.bookMoves(start);
    const uci = book.map((b) => C.moveToUci(b.move));
    for (const m of ['e2e4', 'd2d4', 'c2c4', 'g1f3']) assert.ok(uci.includes(m), m);
    const legal = new Set(C.legalMoves(start));
    for (const b of book) {
        assert.ok(legal.has(b.move));
        assert.ok(Number.isInteger(b.weight) && b.weight >= 1);
    }
    const w = (u) => book[uci.indexOf(u)].weight;
    assert.ok(w('e2e4') > w('g1f3') && w('d2d4') > w('b2b3'), 'weights follow the number of lines');
    // sorted by weight, heaviest first; every move once
    for (let i = 1; i < book.length; i++) assert.ok(book[i - 1].weight >= book[i].weight);
    assert.equal(new Set(uci).size, uci.length);
    // the weight of a move is the number of lines that continue with it
    const lines = D.OPENINGS.filter((e) => e[2].startsWith('e2e4'));
    assert.equal(w('e2e4'), lines.length);
});

test('bookMoves: deeper positions, transpositions, and out of the book', () => {
    const g = new C.Game();
    g.play('e4');
    const uci = E.bookMoves(g.position).map((b) => C.moveToUci(b.move));
    for (const m of ['e7e5', 'c7c5', 'e7e6', 'c7c6']) assert.ok(uci.includes(m), m);
    // 1.d4 Nf6 2.c4 and 1.c4 Nf6 2.d4 are the same position
    const via = (...sans) => {
        const x = new C.Game();
        sans.forEach((s) => x.play(s));
        return E.bookMoves(x.position).map((b) => `${C.moveToUci(b.move)}:${b.weight}`);
    };
    assert.deepEqual(via('d4', 'Nf6', 'c4'), via('c4', 'Nf6', 'd4'));
    assert.ok(via('d4', 'Nf6', 'c4').some((s) => s.startsWith('e7e6:')));
    // out of the book and terminal positions: nothing
    assert.deepEqual(E.bookMoves(C.Position.fromFen('8/8/4k3/8/8/4K3/4P3/8 w - - 0 1')), []);
    assert.deepEqual(E.bookMoves(C.Position.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')), []);
    const deep = new C.Game();
    for (const s of NAJDORF.replace(/\d+\./g, ' ').trim().split(/\s+/)) deep.play(s);
    assert.ok(E.bookMoves(deep.position).length > 0, 'the Najdorf goes on');
    // not a position: no throw
    assert.deepEqual(E.bookMoves(null), []);
    assert.deepEqual(E.bookMoves({}), []);
});

test('bookMoves: every book move is legal and leads on to a named position', () => {
    // walk the book breadth-first from the start for a few plies
    let level = [C.Position.fromFen(START)];
    for (let ply = 0; ply < 4; ply++) {
        const next = [];
        for (const pos of level) {
            for (const b of E.bookMoves(pos)) {
                assert.ok(C.legalMoves(pos).includes(b.move));
                const p = pos.clone();
                p.make(b.move);
                next.push(p);
            }
        }
        assert.ok(next.length > 0);
        level = next.slice(0, 40);
    }
});

// The expected Russian is written by hand (a native check), one row per rule of the generator in src/i18n/ru/openings.js.
const RU_NAMES = [
    // a prefix and an adjective fuse into one adjective that agrees with the kind (Semi-, Neo-, Anti-, Pseudo-, Ultra-, Anglo-)
    ["Queen's Gambit Declined: Semi-Slav Defense", 'Отказанный ферзевый гамбит: полуславянская защита'],
    ['Semi-Slav Defense: Stoltz Variation', 'Полуславянская защита: вариант Штольца'],
    ['Modern Defense: Semi-Averbakh Variation', 'Современная защита: полуавербаховский вариант'],
    ['Modern Defense: Neo-Modern Defense', 'Современная защита: неосовременная защита'],
    ['Sicilian Defense: Richter-Rauzer Variation, Neo-Modern Variation', 'Сицилианская защита: вариант Рихтера — Раузера, неосовременный вариант'],
    ['Dutch Defense: Manhattan Gambit, Anti-Classical Line', 'Голландская защита: гамбит Манхэттена, антиклассическая линия'],
    ['Nimzowitsch Defense: Pseudo-Spanish Variation', 'Защита Нимцовича (1.e4 Nc6): псевдоиспанский вариант'],
    ['Caro-Kann Defense: Pseudo-Scandinavian', 'Защита Каро — Канн: псевдоскандинавский вариант'],
    ['English Opening: Symmetrical Variation, Ultra-Symmetrical Variation', 'Английское начало: симметричный вариант, ультрасимметричный вариант'],
    ["Queen's Pawn Game: Anglo-Slav Opening", 'Партия ферзевой пешки: англо-славянский дебют'],
    ['Sicilian Defense: Franco-Sicilian Variation', 'Сицилианская защита: франко-сицилианский вариант'],
    ['Benoni Defense: Benoni-Indian Defense', 'Защита Бенони: Бенони-индийская защита'],
    ['Neo-Grünfeld Defense: Classical Variation', 'Защита Нео-Грюнфельда: классический вариант'],
    // a prefix and a name keep the hyphen and stand in the genitive after the kind
    ['Sicilian Defense: Closed, Anti-Sveshnikov Variation', 'Сицилианская защита: закрытый вариант, вариант анти-Свешникова'],
    ['Ruy Lopez: Closed, Anti-Marshall', 'Испанская партия: закрытый вариант, анти-Маршалл'],
    ["Queen's Gambit Declined: Semi-Tarrasch Defense", 'Отказанный ферзевый гамбит: полутаррашевская защита'],
    ['Benoni Defense: Semi-Benoni', 'Защита Бенони: полу-Бенони'],
    ['Indian Defense: Anti-Nimzo-Indian', 'Индийская защита: система против нимцо-индийской защиты'],
    // a possessive and a piece: the word order of «King's Knight Variation»
    ["English Opening: Anglo-Indian Defense, King's Knight Variation", 'Английское начало: англо-индийская защита, вариант королевского коня'],
    ["Dutch Defense: Queen's Knight Variation", 'Голландская защита: вариант ферзевого коня'],
    ["Ruy Lopez: Exchange Variation, King's Bishop Variation", 'Испанская партия: вариант размена, вариант королевского слона'],
    ["French Defense: Queen's Knight", 'Французская защита: ферзевый конь'],
    ["Benoni Defense: King's Pawn Line", 'Защита Бенони: линия королевской пешки'],
    ["Polish Opening: King's Indian Variation", 'Польский дебют: староиндийский вариант'],
    ["English Opening: Anglo-Indian Defense, King's Indian Formation", 'Английское начало: англо-индийская защита, староиндийское построение'],
    // an adjective without a kind agrees with the noun after it
    ['Mieses Opening: Reversed Rat', 'Дебют Мизеса: обратная Крыса'],
    ['Rat Defense: English Rat', 'Крысиная защита: английская Крыса'],
    ['Van Geet Opening: Reversed Nimzowitsch', 'Дебют Ван Гета: обратный Нимцович'],
    ['Hungarian Opening: Reversed Dragon', 'Венгерский дебют: обратный Дракон'],
    ['Zukertort Opening: Reversed Mexican Defense', 'Дебют Цукерторта: обратная мексиканская защита'],
    ['Vienna Game: Stanley Variation, Reversed Spanish', 'Венская партия: вариант Стэнли, обратный испанский вариант'],
    // a qualifier at the end moves to the front and agrees
    ["King's Pawn Game: Clam Variation, King's Gambit Reversed", 'Партия королевской пешки: вариант Clam, обратный королевский гамбит'],
    ['Sicilian Defense: Najdorf Variation, Poisoned Pawn Accepted', 'Сицилианская защита: вариант Найдорфа, принятая отравленная пешка'],
    [
        'Modern Defense: Semi-Averbakh Variation, Pterodactyl Variation Declined',
        'Современная защита: полуавербаховский вариант, отказанный вариант Птеродактиля',
    ],
    ['Italian Game: Scotch Invitation Declined', 'Итальянская партия: отказанное шотландское приглашение'],
    ['Sicilian Defense: Smith-Morra Gambit Accepted, Morphy Defense Deferred', 'Сицилианская защита: принятый гамбит Смита — Морры, отложенная защита Морфи'],
    ['Sicilian Defense: Alapin Variation, Smith-Morra Declined', 'Сицилианская защита: вариант Алапина, отказанный гамбит Смита — Морры'],
    ['Ruy Lopez: Morphy Defense, Steinitz Deferred', 'Испанская партия: защита Морфи, отложенная защита Стейница'],
    // the common names are Russian wherever they stand, a possessive of a known name is that name
    ['Sicilian Defense: Najdorf Variation', 'Сицилианская защита: вариант Найдорфа'],
    ['Ruy Lopez: Berlin Defense', 'Испанская партия: берлинская защита'],
    ['Caro-Kann Defense: Advance Variation', 'Защита Каро — Канн: вариант продвижения'],
    ['Nimzo-Indian Defense: Classical Variation', 'Нимцо-индийская защита: классический вариант'],
    ['English Opening: Caro-Kann Defensive System', 'Английское начало: оборонительная система Каро — Канн'],
    ["King's Gambit Declined: Petrov's Defense", 'Отказанный королевский гамбит: защита Петрова'],
    ["Italian Game: Bird's Attack", 'Итальянская партия: атака Бёрда'],
    ['Modern Defense: Three Pawns Attack', 'Современная защита: атака трёх пешек'],
    ["Zukertort Opening: Queen's Gambit Invitation", 'Дебют Цукерторта: приглашение в ферзевый гамбит'],
    // a name and a noun with no kind: the noun first, the name in the genitive, the moves after the noun
    ['Zukertort Opening: Pirc Invitation', 'Дебют Цукерторта: приглашение Пирца'],
    ['French Defense: Bird Invitation', 'Французская защита: приглашение Бёрда'],
    ['Scandinavian Defense: Panov Transfer', 'Скандинавская защита: перевод Панова'],
    ['Zukertort Opening: Wade Defense, Chigorin Plan', 'Дебют Цукерторта: защита Уэйда, план Чигорина'],
    ['Ruy Lopez: Closed, Breyer Defense, Zaitsev Hybrid', 'Испанская партия: закрытый вариант, защита Брейера, гибрид Зайцева'],
    ['Pterodactyl Defense: Fianchetto, Queen Pterodactyl', 'Защита «Птеродактиль»: фианкетто, ферзь Птеродактиля'],
    ["Queen's Gambit Accepted: Normal Variation, .. a6 Sideline", 'Принятый ферзевый гамбит: обычный вариант, ответвление .. a6'],
    ['Ruy Lopez: Berlin Defense, Berlin Wall', 'Испанская партия: берлинская защита, Берлинская стена'],
    ['Ruy Lopez: Berlin Defense, Berlin Wall Defense', 'Испанская партия: берлинская защита, защита «Берлинская стена»'],
    // a hyphenated stem with a name: an adjective that agrees, or the hyphenated name
    ['English Opening: Anglo-Grünfeld Defense', 'Английское начало: англо-грюнфельдовская защита'],
    ['Dutch Defense: Semi-Leningrad Variation', 'Голландская защита: полуленинградский вариант'],
    ['Semi-Slav Defense: Semi-Meran Variation', 'Полуславянская защита: полумеранский вариант'],
    [
        "Queen's Gambit Declined: Capablanca Variation, Anti-Cambridge Springs Variation",
        'Отказанный ферзевый гамбит: вариант Капабланки, вариант анти-Кембридж-Спрингс',
    ],
    // an unknown word next to translated ones: the whole segment stays English
    [
        "English Opening: King's English Variation, Botvinnik System, Prickly Pawn Pass System",
        'Английское начало: королевский английский вариант, система Ботвинника, Prickly Pawn Pass System',
    ],
    ['Benoni Defense: Pawn Storm Variation', 'Защита Бенони: Pawn Storm Variation'],
    ["Lion Defense: Anti-Philidor, Lion's Cave", "Защита «Лев»: анти-Филидор, Lion's Cave"],
    // a surname with no standard Russian form stays in Latin letters
    ['Sicilian Defense: Frederico Variation', 'Сицилианская защита: вариант Frederico'],
];

test('Russian names: about fifty names, one or more for every rule of the generator', () => {
    const ru = (name) => String(E.openings.name('A00', name).ru);
    assert.ok(RU_NAMES.length >= 40);
    for (const [en, expected] of RU_NAMES) assert.equal(ru(en), expected, en);
    // the rules do not leak into the unrelated words: no hyphen is left between a prefix and an adjective, no «вариант» comes before an adjective
    for (const [, expected] of RU_NAMES) assert.equal(/(?:полу|нео|псевдо|анти|ультра)-[а-я]/.test(expected), false, expected);
});

test('Russian names: no name of the dataset keeps a prefix hyphen before a Russian adjective, and words of table keys are not mistaken for others', () => {
    let seen = 0;
    for (const [eco, name] of D.OPENINGS) {
        const r = String(E.openings.name(eco, name).ru);
        assert.equal(/(?:полу|нео|псевдо)-[а-я]+(?:ий|ый|ой|ая|ое|ые|ие)(?![а-я])/.test(r), false, `${name} => ${r}`);
        // «Semi-Slav Defense» in any position agrees: the adjective and the kind are of one gender
        if (/Semi-Slav Defense/.test(name)) {
            seen++;
            assert.match(r, /полуславянская защита|Полуславянская защита/, `${name} => ${r}`);
        }
        // a king's or queen's piece is never left in the wrong word order
        assert.equal(/(?:королевск|ферзев)(?:ый|ая|ое|ого|ой) вариант (?:коня|слона|ладьи|пешки)/.test(r), false, `${name} => ${r}`);
    }
    assert.ok(seen > 0);
    // words that are properties of every object are plain words here
    for (const odd of ['constructor', 'toString', '__proto__', 'hasOwnProperty: valueOf'])
        assert.equal(typeof E.openings.name('A00', odd).ru.toString(), 'string');
    assert.equal(String(E.openings.name('A00', 'Sicilian Defense: constructor').ru), 'Сицилианская защита: constructor');
});
