// endgame/openings — which opening a game is: openingName looks the moves (or a FEN) up in the named lines by position
// hash, so transpositions match; openings.name builds the bilingual name; openingIndex serves the book as well.
import { msg } from '../i18n/index.js';
import { Position, ChessError, generateMoves, parsePgn, toSan, moveToUci, moveFrom, moveTo, movePromo, KNIGHT, BISHOP, ROOK, QUEEN } from '../core/index.js';
import { OPENINGS } from './openings-data.js';

const MAX_INPUT = 100000; // characters of text; a longer one is not read
const PROMOTION = { n: KNIGHT, b: BISHOP, r: ROOK, q: QUEEN };
const BUFFER = new Int32Array(256);

/** The name of an opening in every language: openings.name('B90', 'Sicilian Defense: Najdorf Variation'). */
export const openings = {
    name: (eco, name) => msg('endgame.openings.opening.name', { eco: String(eco ?? ''), name: String(name ?? '') }),
};

/** A position as a number: the 53 low bits of its 64-bit hash (exact in a double; the tests show no two positions of the data share it). */
export function hashKey(pos) {
    return (pos.hashHi & 0x1fffff) * 4294967296 + (pos.hashLo >>> 0);
}

// the encoded move of a position given as UCI text, or 0
function uciMove(pos, uci) {
    const from = (uci.charCodeAt(1) - 49) * 16 + (uci.charCodeAt(0) - 97);
    const to = (uci.charCodeAt(3) - 49) * 16 + (uci.charCodeAt(2) - 97);
    const promo = uci.length > 4 ? PROMOTION[uci[4]] : 0;
    const n = generateMoves(pos, BUFFER);
    for (let i = 0; i < n; i++) {
        const m = BUFFER[i];
        if (moveFrom(m) === from && moveTo(m) === to && movePromo(m) === promo) return m;
    }
    return 0;
}

let built = null;

/**
 * The lookup tables, built on first use by replaying every line of the data:
 *   named   position key → index of the first entry whose line ends in that position
 *   next    position key → Map(uci → number of lines that go on with that move)
 *   longest plies of the longest line
 */
export function openingIndex() {
    if (built) return built;
    const named = new Map();
    const next = new Map();
    let longest = 0;
    OPENINGS.forEach(([, , line], i) => {
        const moves = line.split(' ');
        longest = Math.max(longest, moves.length);
        const pos = Position.fromFen(Position.START_FEN);
        for (const uci of moves) {
            const key = hashKey(pos);
            let counts = next.get(key);
            if (!counts) next.set(key, (counts = new Map()));
            counts.set(uci, (counts.get(uci) ?? 0) + 1);
            pos.make(uciMove(pos, uci));
        }
        const end = hashKey(pos);
        if (!named.has(end)) named.set(end, i);
    });
    built = { named, next, longest };
    return built;
}

const invalid = (code, reason) => ({ ok: false, kind: 'invalid', code, reason });

// the answer for an entry reached after `ply` plies of the input; moves and uci are the first `ply` moves played
function found(entry, ply, moves, uci) {
    const [eco, name] = OPENINGS[entry];
    return { ok: true, kind: 'opening', eco, name: openings.name(eco, name), ply, moves, uci };
}

// the moves of an entry's own line, as English SAN and as UCI
function lineOf(entry) {
    const uci = OPENINGS[entry][2].split(' ');
    const pos = Position.fromFen(Position.START_FEN);
    const moves = uci.map((u) => {
        const m = uciMove(pos, u);
        const san = toSan(pos, m);
        pos.make(m);
        return san;
    });
    return { moves, uci };
}

const FEN_SHAPE = /^\S+(?:\/\S+){7}(?:\s|$)/;

function look(input) {
    if (typeof input !== 'string') return invalid('type', msg('endgame.openings.invalid.type'));
    if (input.length > MAX_INPUT) return invalid('long', msg('endgame.openings.invalid.long', { chars: input.length, limit: MAX_INPUT }));
    const text = input.trim();
    if (text === '') return invalid('empty', msg('endgame.openings.invalid.empty'));
    const { named, longest } = openingIndex();

    // a FEN: the position itself
    if (FEN_SHAPE.test(text)) {
        const entry = named.get(hashKey(Position.fromFen(text)));
        if (entry === undefined) return { ok: true, kind: 'none' };
        const line = lineOf(entry);
        return found(entry, line.uci.length, line.moves, line.uci);
    }

    // a PGN or a bare list of moves: the main line of the first game; the last named position on it wins
    const game = parsePgn(text);
    const startFen = game.headers.FEN || Position.START_FEN;
    const pos = Position.fromFen(startFen);
    const played = [];
    let best = null;
    const atStart = named.get(hashKey(pos));
    if (atStart !== undefined && startFen !== Position.START_FEN) best = { entry: atStart, ply: 0 };
    for (let node = game.root.children[0]; node && played.length < longest; node = node.children[0]) {
        played.push(node.move);
        pos.make(node.move);
        const entry = named.get(hashKey(pos));
        if (entry !== undefined) best = { entry, ply: played.length };
    }
    if (!best) return { ok: true, kind: 'none' };
    const replay = Position.fromFen(startFen);
    const moves = [];
    const uci = [];
    for (let i = 0; i < best.ply; i++) {
        moves.push(toSan(replay, played[i]));
        uci.push(moveToUci(played[i]));
        replay.make(played[i]);
    }
    return found(best.entry, best.ply, moves, uci);
}

/**
 * Which opening is this? input: a PGN, a list of moves (SAN in any language, long forms or UCI, with or without move
 * numbers) or a FEN. A game gets the last position of its main line (within the length of the longest named line)
 * that a named line passes through, so transpositions match; a FEN gets the name of its position.
 *   {ok: true, kind: 'opening', eco, name: Msg, ply, moves: string[], uci: string[]}   moves: SAN of the first ply moves
 *   {ok: true, kind: 'none'}
 *   {ok: false, kind: 'invalid', code: 'type' | 'empty' | 'long' | 'fen' | 'pgn' | 'failed', reason: Msg}
 * Never throws.
 */
export function openingName(input) {
    try {
        return look(input);
    } catch (e) {
        if (e instanceof ChessError) return invalid(e.code, e.text ?? msg('endgame.openings.invalid.failed'));
        return invalid('failed', msg('endgame.openings.invalid.failed'));
    }
}
