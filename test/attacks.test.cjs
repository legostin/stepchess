// attacks: who attacks a square (direct and through one piece), the attack maps, and static exchange evaluation (SEE),
// checked against hand-made exchanges, an independent attack finder and a brute-force exchange on playout positions.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

let C;
before(async () => {
    C = await import('../src/core/index.js');
});

const pos = (fen) => C.Position.fromFen(fen);
const uciOf = (p, text) => {
    const m = C.legalMoves(p).find((x) => C.moveToUci(x) === text);
    assert.ok(m, `${text} is legal in ${p.fen()}`);
    return m;
};
const sq = (names) => names.map((n) => C.parseSquare(n)).sort((a, b) => a - b);

// the position with the colors exchanged: ranks reversed, case swapped, side swapped, rights and en passant mirrored
function mirrorFen(fen) {
    const [board, side, castling, ep, half, full] = fen.split(' ');
    const rows = board
        .split('/')
        .reverse()
        .map((r) => [...r].map((ch) => (/[a-z]/.test(ch) ? ch.toUpperCase() : /[A-Z]/.test(ch) ? ch.toLowerCase() : ch)).join(''));
    const rights = castling === '-' ? '-' : [...castling].map((ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())).join('');
    const mep = ep === '-' ? '-' : ep[0] + (9 - Number(ep[1]));
    return [rows.join('/'), side === 'w' ? 'b' : 'w', rights, mep, half, full].join(' ');
}

// a small deterministic generator
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// the independent attack finder: the geometry of each piece, written out square by square
function referenceAttackers(board, target, color) {
    const out = [];
    const tf = target & 7;
    const tr = target >> 4;
    for (let s = 0; s < 128; s++) {
        if (s & 0x88 || !board[s] || board[s] >> 3 !== color) continue;
        const type = board[s] & 7;
        const df = tf - (s & 7);
        const dr = tr - (s >> 4);
        if (s === target) continue;
        let hit = false;
        if (type === C.PAWN) hit = Math.abs(df) === 1 && dr === (color === C.WHITE ? 1 : -1);
        else if (type === C.KNIGHT) hit = (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
        else if (type === C.KING) hit = Math.max(Math.abs(df), Math.abs(dr)) === 1;
        else {
            const diag = Math.abs(df) === Math.abs(dr);
            const line = df === 0 || dr === 0;
            if ((type === C.BISHOP && diag) || (type === C.ROOK && line) || (type === C.QUEEN && (diag || line))) {
                const sf = Math.sign(df);
                const sr = Math.sign(dr);
                const step = sr * 16 + sf;
                hit = true;
                for (let t = s + step; t !== target; t += step)
                    if (board[t]) {
                        hit = false;
                        break;
                    }
            }
        }
        if (hit) out.push(s);
    }
    return out;
}

// the brute-force exchange on one square, written independently: alpha-beta over the captures on that square only.
// SEE takes the least valuable attacker each time (that is what makes it static), so the brute force does the same and,
// where several attackers of the least type exist and the choice could matter (they open different x-rays), reports the
// range of values over all choices: {lo, hi}. A side may always stop; a king captures only when nothing recaptures.
const VALUES = [0, 100, 320, 330, 500, 900, 20000];
function exchange(board, target, side, onSquare) {
    const all = referenceAttackers(board, target, side);
    if (!all.length) return { lo: 0, hi: 0 };
    let least = 7;
    for (const s of all) least = Math.min(least, board[s] & 7);
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of all) {
        const piece = board[s];
        const type = piece & 7;
        if (type !== least) continue;
        board[s] = 0;
        const lastRank = target >> 4 === 0 || target >> 4 === 7;
        const promotes = type === C.PAWN && lastRank;
        const gained = VALUES[onSquare] + (promotes ? VALUES[C.QUEEN] - VALUES[C.PAWN] : 0);
        const safe = type !== C.KING || referenceAttackers(board, target, side ^ 1).length === 0;
        if (safe) {
            const reply = exchange(board, target, side ^ 1, promotes ? C.QUEEN : type);
            lo = Math.min(lo, gained - reply.hi);
            hi = Math.max(hi, gained - reply.lo);
        } else {
            lo = Math.min(lo, 0);
            hi = Math.max(hi, 0);
        }
        board[s] = piece;
    }
    return { lo: Math.max(0, lo), hi: Math.max(0, hi) };
}
// the first move is the given one; everything after it is the exchange. {lo, hi}: equal unless the tie between attackers
// of one type matters
function bruteSee(p, m) {
    const board = Int8Array.from(p.board);
    const from = C.moveFrom(m);
    const to = C.moveTo(m);
    const promo = C.movePromo(m);
    const flags = C.moveFlags(m);
    if (flags & C.F_CASTLE) return { lo: 0, hi: 0 };
    const piece = board[from];
    const us = piece >> 3;
    let victim = board[to] & 7;
    if (flags & C.F_EP) {
        victim = C.PAWN;
        board[us === C.WHITE ? to - 16 : to + 16] = 0;
    }
    board[from] = 0;
    board[to] = 0;
    const gain = VALUES[victim] + (promo ? VALUES[promo] - VALUES[C.PAWN] : 0);
    const reply = exchange(board, to, us ^ 1, promo || piece & 7);
    return { lo: gain - reply.hi, hi: gain - reply.lo };
}
// see must lie in the range of the brute force; it must equal it whenever the range is a single value
const TALLY = { moves: 0, ties: 0 };
function checkAgainstBrute(p, m, label) {
    const { lo, hi } = bruteSee(p, m);
    const got = C.see(p, m);
    TALLY.moves++;
    if (lo === hi) assert.equal(got, lo, label);
    else {
        TALLY.ties++;
        assert.ok(got >= lo && got <= hi, `${label}: ${got} in [${lo}, ${hi}]`);
    }
    // seeGe is see compared to a threshold, always
    for (const t of [got - 1, got, got + 1, 0, 100, -100, 330, -330, 800]) assert.equal(C.seeGe(p, m, t), got >= t, `${label} >= ${t} (see ${got})`);
    return got;
}

const FEN_ROOK = '1k1r4/1pp4p/p7/4p3/8/P5P1/1PP4P/2K1R3 w - - 0 1';
const FEN_KNIGHT = '1k1r3q/1ppn3p/p4b2/4p3/8/P2N2P1/1PP1R1BP/2K1Q3 w - - 0 1';

test('see: Rxe5 against an undefended pawn wins the pawn; Nxe5 into a defended pawn loses the knight for a pawn', () => {
    const a = pos(FEN_ROOK);
    assert.equal(C.see(a, uciOf(a, 'e1e5')), 100);
    const b = pos(FEN_KNIGHT);
    assert.equal(C.see(b, uciOf(b, 'd3e5')), -220);
    assert.deepEqual(C.SEE_VALUES, [0, 100, 320, 330, 500, 900, 20000]);
});

test('seeGe: the threshold cuts exactly at the SEE value', () => {
    for (const [fen, move, value] of [
        [FEN_ROOK, 'e1e5', 100],
        [FEN_KNIGHT, 'd3e5', -220],
    ]) {
        const p = pos(fen);
        const m = uciOf(p, move);
        for (const d of [-300, -101, -1, 0, 1, 99, 300]) {
            assert.equal(C.seeGe(p, m, value + d), d <= 0, `${move} >= ${value + d}`);
        }
    }
});

test('attackersOf: the direct attackers of e5 in both positions', () => {
    const a = pos(FEN_ROOK);
    assert.deepEqual(C.attackersOf(a, C.parseSquare('e5'), C.WHITE), sq(['e1']));
    assert.deepEqual(C.attackersOf(a, C.parseSquare('e5'), C.BLACK), []);
    const b = pos(FEN_KNIGHT);
    assert.deepEqual(C.attackersOf(b, C.parseSquare('e5'), C.WHITE), sq(['e2', 'd3']));
    assert.deepEqual(C.attackersOf(b, C.parseSquare('e5'), C.BLACK), sq(['f6', 'd7']));
});

test('xrayAttackersOf: the sliders behind the first piece on a line', () => {
    const a = pos(FEN_ROOK);
    assert.deepEqual(C.xrayAttackersOf(a, C.parseSquare('e5'), C.WHITE), []);
    const b = pos(FEN_KNIGHT);
    assert.deepEqual(C.xrayAttackersOf(b, C.parseSquare('e5'), C.WHITE), sq(['e1']));
    assert.deepEqual(C.xrayAttackersOf(b, C.parseSquare('e5'), C.BLACK), sq(['h8']));
    // a rook behind an enemy piece counts too, and a direct attacker is never also an x-ray attacker
    const c = pos('4k3/8/8/4p3/8/8/4r3/4RK2 w - - 0 1');
    assert.deepEqual(C.attackersOf(c, C.parseSquare('e5'), C.BLACK), sq(['e2']));
    assert.deepEqual(C.xrayAttackersOf(c, C.parseSquare('e5'), C.WHITE), sq(['e1']));
    assert.deepEqual(C.xrayAttackersOf(c, C.parseSquare('e5'), C.BLACK), []);
    // only one piece deep, and the piece on the target square is ignored
    const d = pos('3k4/8/8/8/4R3/4R3/4R3/4RK2 w - - 0 1');
    assert.deepEqual(C.attackersOf(d, C.parseSquare('e5'), C.WHITE), sq(['e4']));
    assert.deepEqual(C.xrayAttackersOf(d, C.parseSquare('e5'), C.WHITE), sq(['e3']));
    assert.deepEqual(C.attackersOf(d, C.parseSquare('e4'), C.WHITE), sq(['e3']));
    // pawns and knights never x-ray
    const e = pos('4k3/8/8/3p4/8/2P5/1P6/4K3 w - - 0 1');
    assert.deepEqual(C.xrayAttackersOf(e, C.parseSquare('d5'), C.WHITE), []);
});

const SAMPLE = [
    'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
    '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1',
    'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
    'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8',
    'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10',
    FEN_ROOK,
    FEN_KNIGHT,
];

test('attackMaps: counts and least attackers agree with the attackers of every square', () => {
    for (const fen of SAMPLE) {
        const p = pos(fen);
        const maps = C.attackMaps(p);
        assert.equal(maps.count.length, 2);
        assert.equal(maps.least.length, 2);
        for (let s = 0; s < 128; s++) {
            if (s & 0x88) continue;
            for (const color of [C.WHITE, C.BLACK]) {
                const list = C.attackersOf(p, s, color);
                assert.equal(maps.count[color][s], list.length, `${fen} ${C.sqName(s)} ${color}`);
                const least = list.length ? Math.min(...list.map((x) => p.board[x] & 7)) : 0;
                assert.equal(maps.least[color][s], least, `${fen} least ${C.sqName(s)} ${color}`);
            }
        }
    }
});

test('attackMaps: symmetric under the colour flip of the position', () => {
    for (const fen of SAMPLE) {
        const a = C.attackMaps(pos(fen));
        const b = C.attackMaps(pos(mirrorFen(fen)));
        for (let s = 0; s < 128; s++) {
            if (s & 0x88) continue;
            for (const color of [C.WHITE, C.BLACK]) {
                assert.equal(a.count[color][s], b.count[color ^ 1][C.flipRank(s)], `${fen} count ${C.sqName(s)}`);
                assert.equal(a.least[color][s], b.least[color ^ 1][C.flipRank(s)], `${fen} least ${C.sqName(s)}`);
            }
        }
    }
});

test('see: symmetric under the colour flip of the position', () => {
    for (const fen of SAMPLE) {
        const p = pos(fen);
        const q = pos(mirrorFen(fen));
        for (const m of C.legalMoves(p)) {
            const flipped = C.encodeMove(C.flipRank(C.moveFrom(m)), C.flipRank(C.moveTo(m)), C.moveFlags(m), C.movePromo(m));
            assert.ok(C.legalMoves(q).includes(flipped), `${fen} ${C.moveToUci(m)}`);
            assert.equal(C.see(p, m), C.see(q, flipped), `${fen} ${C.moveToUci(m)}`);
        }
    }
});

test('see: hand-made exchanges, x-rays, promotions, en passant, castling', () => {
    const cases = [
        // a pawn takes an undefended pawn
        ['4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1', 'e4d5', 100],
        // the queen takes a pawn defended by a pawn
        ['4k3/8/2p5/3p4/8/8/8/3QK3 w - - 0 1', 'd1d5', -800],
        // two rooks against two: the x-ray rooks are counted (320, -500, +500, -500)
        ['3r2k1/3r4/8/3n4/8/8/3R4/3RK3 w - - 0 1', 'd2d5', -180],
        // a quiet move onto an attacked square loses the piece
        ['4k3/8/8/4p3/8/8/8/3QK3 w - - 0 1', 'd1d4', -900],
        ['4k3/8/8/4p3/8/8/8/3QK3 w - - 0 1', 'd1d3', 0],
        // en passant: the victim is the pawn although the target square is empty; a recapture is counted
        ['4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6', 100],
        ['3rk3/8/8/3pP3/8/8/8/4K3 w - d6 0 1', 'e5d6', 0],
        // a capture with promotion: the rook plus the promotion, minus the queen when it is recaptured
        ['2r1k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7c8q', 500 + 800],
        ['q1r1k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7c8q', 500 + 800 - 900],
        ['q1r1k3/1P6/8/8/8/8/8/4K3 w - - 0 1', 'b7c8n', 500 + 220 - 320],
        // the king is the last to recapture
        ['4k3/8/8/8/8/1r1p4/4K3/3Q4 w - - 0 1', 'd1d3', -300],
        // a quiet promotion onto a defended square
        ['3r2k1/4P3/8/8/8/8/8/4K3 w - - 0 1', 'e7e8q', 800 - 900],
        ['8/4Pk2/8/8/8/8/8/4K3 w - - 0 1', 'e7e8q', 800 - 900],
        ['6k1/4P3/8/8/8/8/8/4K3 w - - 0 1', 'e7e8q', 800],
    ];
    for (const [fen, move, expected] of cases) {
        const p = pos(fen);
        const m = uciOf(p, move);
        assert.equal(C.see(p, m), expected, `${fen} ${move}`);
        assert.equal(checkAgainstBrute(p, m, `${fen} ${move}`), expected);
        assert.equal(C.seeGe(p, m, expected), true);
        assert.equal(C.seeGe(p, m, expected + 1), false);
    }
    // castling is neutral
    const castle = pos('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
    assert.equal(C.see(castle, uciOf(castle, 'e1g1')), 0);
    assert.equal(C.seeGe(castle, uciOf(castle, 'e1g1'), 0), true);
    assert.equal(C.seeGe(castle, uciOf(castle, 'e1g1'), 1), false);
});

test('see: a recapturing pawn that promotes counts its promotion', () => {
    // b2xa1=Q takes the knight and promotes; the king takes the new queen
    const p = pos('4k3/8/8/8/8/8/1p6/NK6 b - - 0 1');
    const m = uciOf(p, 'b2a1q');
    assert.equal(C.see(p, m), 320 + 800 - 900);
    assert.equal(checkAgainstBrute(p, m, 'b2a1q'), 320 + 800 - 900);
    // a white pawn takes on b8 and a black rook retakes... and a pawn behind it takes again and promotes
    const q = pos('1r2k3/P1P5/8/8/8/8/8/4K3 w - - 0 1');
    for (const m2 of C.legalMoves(q)) checkAgainstBrute(q, m2, C.moveToUci(m2));
});

test('see: a king takes only when nothing recaptures, even through the king (a rook behind it)', () => {
    // Nf4 is guarded by the black king; Kxf4 is illegal, and the rook behind the white king must not make it look otherwise
    const p = pos('8/1Q3R2/4n3/5K2/2p5/4k3/6P1/8 b - - 1 34');
    const m = uciOf(p, 'e6f4');
    assert.equal(C.see(p, m), 0);
    assert.equal(checkAgainstBrute(p, m, 'e6f4'), 0);
    // an undefended piece is taken by the king
    const q = pos('4k3/8/8/8/8/8/3n4/4K3 w - - 0 1');
    assert.equal(C.see(q, uciOf(q, 'e1d2')), 320);
});

// random playouts: positions from a deterministic stream of random legal moves
function* playouts(games, seed, maxPlies) {
    const rand = rng(seed);
    for (let g = 0; g < games; g++) {
        const p = pos(SAMPLE[g % SAMPLE.length]);
        for (let ply = 0; ply < maxPlies; ply++) {
            const moves = C.legalMoves(p);
            if (!moves.length) break;
            yield p;
            p.make(moves[Math.floor(rand() * moves.length)]);
        }
    }
}

test('attackersOf, xrayAttackersOf and attackMaps agree with an independent attack finder on playout positions', () => {
    let positions = 0;
    for (const p of playouts(40, 7, 60)) {
        positions++;
        const maps = C.attackMaps(p);
        for (let s = 0; s < 128; s++) {
            if (s & 0x88) continue;
            for (const color of [C.WHITE, C.BLACK]) {
                const expected = referenceAttackers(p.board, s, color).sort((a, b) => a - b);
                assert.deepEqual(C.attackersOf(p, s, color), expected, `${p.fen()} ${C.sqName(s)} ${color}`);
                assert.equal(maps.count[color][s], expected.length);
                // x-rays: the second piece on a line, when it is a slider of the color moving along that line
                const board = p.board;
                const xray = [];
                for (const step of [16, -16, 1, -1, 17, 15, -15, -17]) {
                    let t = s + step;
                    while (!(t & 0x88) && !board[t]) t += step;
                    if (t & 0x88) continue;
                    t += step;
                    while (!(t & 0x88) && !board[t]) t += step;
                    if (t & 0x88 || board[t] >> 3 !== color) continue;
                    const type = board[t] & 7;
                    const diagStep = Math.abs(step) === 15 || Math.abs(step) === 17;
                    if (type === C.QUEEN || (diagStep && type === C.BISHOP) || (!diagStep && type === C.ROOK)) xray.push(t);
                }
                assert.deepEqual(
                    C.xrayAttackersOf(p, s, color),
                    xray.sort((a, b) => a - b),
                    `${p.fen()} xray ${C.sqName(s)} ${color}`,
                );
            }
        }
    }
    assert.ok(positions > 400);
});

test('see and seeGe equal the brute-force exchange on every legal move of playout positions', () => {
    let moves = 0;
    let captures = 0;
    let negative = 0;
    for (const p of playouts(120, 2024, 90)) {
        const before = p.fen();
        for (const m of C.legalMoves(p)) {
            const expected = checkAgainstBrute(p, m, `${before} ${C.moveToUci(m)}`);
            moves++;
            if (C.moveFlags(m) & C.F_CAPTURE) captures++;
            if (expected < 0) negative++;
        }
        assert.equal(p.fen(), before, 'see leaves the position as it was');
    }
    assert.ok(moves > 5000 && captures > 300 && negative > 100, `${moves} moves, ${captures} captures, ${negative} losing`);
    assert.ok(TALLY.ties < TALLY.moves / 50, `${TALLY.ties} of ${TALLY.moves} moves depend on the choice among equal attackers`);
});

// random sparse positions with pawns near promotion and a pair of pawns that allows en passant
function randomFen(rand) {
    const board = new Array(64).fill('');
    const free = () => {
        for (;;) {
            const i = Math.floor(rand() * 64);
            if (!board[i]) return i;
        }
    };
    board[free()] = 'k';
    board[free()] = 'K';
    const n = 6 + Math.floor(rand() * 12);
    for (let k = 0; k < n; k++) {
        const letter = 'pnbrqPNBRQ'[Math.floor(rand() * 10)];
        const i = free();
        const rank = i >> 3;
        if (letter.toLowerCase() === 'p' && (rank === 0 || rank === 7)) continue;
        board[i] = letter;
    }
    let ep = '-';
    if (rand() < 0.5) {
        // a black pawn that has just moved e.g. d7-d5 beside a white pawn on e5, with d6 and d7 empty
        const f = 1 + Math.floor(rand() * 6);
        const squares = [4 * 8 + f, 4 * 8 + f + 1, 5 * 8 + f, 6 * 8 + f];
        if (squares.every((s) => !board[s] || s === 4 * 8 + f || s === 4 * 8 + f + 1)) {
            board[4 * 8 + f] = 'p';
            board[4 * 8 + f + 1] = 'P';
            board[5 * 8 + f] = '';
            board[6 * 8 + f] = '';
            ep = 'abcdefgh'[f] + '6';
        }
    }
    const rows = [];
    for (let r = 7; r >= 0; r--) {
        let row = '';
        let empty = 0;
        for (let f = 0; f < 8; f++) {
            const ch = board[r * 8 + f];
            if (!ch) empty++;
            else {
                if (empty) row += empty;
                empty = 0;
                row += ch;
            }
        }
        rows.push(row + (empty || ''));
    }
    return `${rows.join('/')} w - ${ep} 0 1`;
}

test('see and seeGe equal the brute force on random positions rich in promotions and en passant', () => {
    const rand = rng(31337);
    let valid = 0;
    let promotions = 0;
    let eps = 0;
    for (let k = 0; k < 4000; k++) {
        const fen = randomFen(rand);
        let p;
        try {
            p = pos(fen);
        } catch {
            continue;
        }
        valid++;
        for (const m of C.legalMoves(p)) {
            checkAgainstBrute(p, m, `${fen} ${C.moveToUci(m)}`);
            if (C.movePromo(m)) promotions++;
            if (C.moveFlags(m) & C.F_EP) eps++;
        }
    }
    assert.ok(valid > 500 && promotions > 200 && eps > 50, `${valid} positions, ${promotions} promotions, ${eps} en passant captures`);
});

test('see and seeGe equal the brute force on promotion and en passant positions', () => {
    const fens = [
        '2r1k3/1P6/8/8/8/8/8/4K3 w - - 0 1',
        'q1r1k3/1P6/8/8/8/8/8/4K3 w - - 0 1',
        '3rk3/4P3/8/8/8/8/8/4K3 w - - 0 1',
        'r1b1k2r/1P4P1/8/8/8/8/1p4p1/R1B1K2R w - - 0 1',
        'r1b1k2r/1P4P1/8/8/8/8/1p4p1/R1B1K2R b - - 0 1',
        '2r1k3/8/8/3pP3/8/8/8/2R1K3 w - d6 0 1',
        '4kb2/8/8/3pP3/8/8/8/4K3 w - d6 0 1',
        '4k3/1b6/8/2pP4/8/8/8/4K2R w - c6 0 1',
        '3rk3/8/8/8/3pP3/8/8/4K3 b - e3 0 1',
        '1n2k3/P1P5/8/8/8/8/8/1N2K3 w - - 0 1',
        '1nb1k3/P1P5/8/8/8/8/p1p5/1NB1K3 w - - 0 1',
    ];
    let promos = 0;
    let eps = 0;
    for (const fen of fens) {
        const p = pos(fen);
        for (const m of C.legalMoves(p)) {
            checkAgainstBrute(p, m, `${fen} ${C.moveToUci(m)}`);
            if (C.movePromo(m)) promos++;
            if (C.moveFlags(m) & C.F_EP) eps++;
        }
    }
    assert.ok(promos > 20 && eps >= 3, `${promos} promotions, ${eps} en passant`);
});

test('attackMaps: least is KING where only a king attacks the square, and 0 where nothing does', () => {
    const p = pos('8/8/8/8/8/8/k7/3QK3 w - - 0 1');
    const { least, count } = C.attackMaps(p);
    const cell = (color, name) => [least[color][C.parseSquare(name)], count[color][C.parseSquare(name)]];
    // only the white king reaches d1, f1 and f2 (the queen is blocked by it on f1)
    for (const name of ['d1', 'f1', 'f2']) assert.deepEqual(cell(C.WHITE, name), [C.KING, 1], `white ${name}`);
    // the queen and the king both attack d2 and e2: the least valuable of them is the queen
    for (const name of ['d2', 'e2']) assert.deepEqual(cell(C.WHITE, name), [C.QUEEN, 2], `white ${name}`);
    // only the black king attacks its neighbours
    for (const name of ['a1', 'a3', 'b2', 'b3']) assert.deepEqual(cell(C.BLACK, name), [C.KING, 1], `black ${name}`);
    assert.deepEqual(cell(C.BLACK, 'b1'), [C.KING, 1]);
    assert.deepEqual(cell(C.WHITE, 'b1'), [C.QUEEN, 1]);
    // squares nobody attacks hold 0 with a zero count
    for (const name of ['h8', 'e5', 'g6', 'c8']) {
        assert.deepEqual(cell(C.WHITE, name), [0, 0], `white ${name}`);
        assert.deepEqual(cell(C.BLACK, name), [0, 0], `black ${name}`);
    }
    // a lone king: every square is 0 except its eight neighbours
    const lone = C.attackMaps(pos('4k3/8/8/8/8/8/8/K7 w - - 0 1'));
    let kings = 0;
    for (let s = 0; s < 128; s++) {
        if (s & 0x88) continue;
        if (lone.least[C.WHITE][s] === C.KING) kings++;
        else assert.equal(lone.least[C.WHITE][s], 0, C.sqName(s));
    }
    assert.equal(kings, 3);
});

test('see: a king as the only attacker captures only when nothing recaptures; with nothing to capture the value is 0', () => {
    // Rxd5 wins a pawn; the king on e4 is the only black attacker of d5 and cannot take a rook defended by nothing... it can
    const free = pos('8/8/8/3p4/4k3/8/8/3RK3 w - - 0 1');
    assert.equal(C.see(free, uciOf(free, 'd1d5')), 100 - 500, 'the king takes the rook: the pawn is bought for a rook');
    // the same rook defended by a knight: the king cannot recapture, so the pawn is won clean
    const defended = pos('8/8/8/3p4/1N2k3/8/8/3RK3 w - - 0 1');
    assert.equal(C.see(defended, uciOf(defended, 'd1d5')), 100);
    // a quiet move onto an empty square that nobody attacks: nothing to win or lose
    const quiet = pos('4k3/8/8/8/8/8/8/R3K3 w - - 0 1');
    assert.equal(C.see(quiet, uciOf(quiet, 'a1a5')), 0);
    // a quiet move onto a square only the enemy king attacks: it would lose the rook for nothing
    const guarded = pos('8/8/8/8/1k6/8/8/R3K3 w - - 0 1');
    assert.equal(C.see(guarded, uciOf(guarded, 'a1a3')), -500);
});
