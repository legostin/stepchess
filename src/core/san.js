// core/san — standard algebraic notation: toSan writes a move in English or Russian, parseMove reads one in any language.
//
// The piece letters and the castling marks are messages (core.san.*), so a language is a catalog entry, not a code
// change. parseMove accepts the letters of every registered language, figurines, long forms (e2e4, e2-e4, Ng1f3),
// castling as O-O or 0-0, promotion with or without "=", trailing marks (+ # ! ?) and objects {from, to, promotion}.
import { LANGUAGES, msg, resolveLanguage } from '../i18n/index.js';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from './pieces.js';
import { fileOf, rankOf, parseSquare, sqName } from './squares.js';
import { F_CAPTURE, F_CASTLE, moveFrom, moveTo, movePromo, moveFlags, moveToUci, NO_MOVE } from './move.js';
import { ChessError } from './errors.js';
import { Position, MAX_PLY } from './position.js';
import { generateMoves } from './movegen.js';

const KEYS = [null, null, 'N', 'B', 'R', 'Q', 'K']; // by piece type: the message key of its letter
const MAX_INPUT = 32; // a move is never longer; anything longer is not read at all

const BEFORE = new Int32Array(256);
const AFTER = new Int32Array(256);

const letterCache = new Map();

// the letters and castling marks of a language
function lettersOf(lang) {
    let l = letterCache.get(lang);
    if (!l) {
        l = {
            piece: KEYS.map((k) => (k ? msg(`core.san.${k}`).in(lang) : '')),
            short: msg('core.san.castle-short').in(lang),
            long: msg('core.san.castle-long').in(lang),
        };
        letterCache.set(lang, l);
    }
    return l;
}

// the check or mate mark of the move; a position at the end of the history is replayed on a fresh copy
function suffixOf(pos, m) {
    const work = pos.ply >= MAX_PLY ? Position.fromFen(pos.fen()) : pos;
    work.make(m);
    let s = '';
    if (work.inCheck()) s = generateMoves(work, AFTER) === 0 ? '#' : '+';
    work.unmake();
    return s;
}

/**
 * The move (legal in pos) in SAN: 'Nf3', 'exd5', 'Qh4#', 'e8=Q+', 'O-O'. lang 'en' (default) writes KQRBN and O-O,
 * 'ru' writes the Russian letters of core.san.* and 0-0; an unknown language falls back to the default one.
 */
export function toSan(pos, m, opts) {
    const L = lettersOf(resolveLanguage(opts?.lang ?? 'en')); // opts may be missing or null
    const from = moveFrom(m);
    const to = moveTo(m);
    const flags = moveFlags(m);
    const type = pos.board[from] & 7;
    let s;
    if (flags & F_CASTLE) s = (to & 7) === 6 ? L.short : L.long;
    else {
        const capture = (flags & F_CAPTURE) !== 0;
        if (type === PAWN) {
            s = capture ? sqName(from)[0] + 'x' : '';
            s += sqName(to);
            const promo = movePromo(m);
            if (promo) s += '=' + L.piece[promo];
        } else {
            s = L.piece[type];
            // other pieces of the kind that can go to the same square: name the file, else the rank, else both
            const n = generateMoves(pos, BEFORE);
            let sameFile = false;
            let sameRank = false;
            let other = false;
            for (let i = 0; i < n; i++) {
                const o = BEFORE[i];
                const of = moveFrom(o);
                if (o === m || moveTo(o) !== to || of === from || (pos.board[of] & 7) !== type) continue;
                other = true;
                if (fileOf(of) === fileOf(from)) sameFile = true;
                if (rankOf(of) === rankOf(from)) sameRank = true;
            }
            if (other) {
                const name = sqName(from);
                if (!sameFile) s += name[0];
                else if (!sameRank) s += name[1];
                else s += name;
            }
            if (capture) s += 'x';
            s += sqName(to);
        }
        // (a king move is never disambiguated: there is one king)
    }
    return s + suffixOf(pos, m);
}

const FIGURINES = { '♔': 'K', '♕': 'Q', '♖': 'R', '♗': 'B', '♘': 'N', '♙': '', '♚': 'K', '♛': 'Q', '♜': 'R', '♝': 'B', '♞': 'N', '♟': '' };
const FIGURINE_RE = /[♔♕♖♗♘♙♚♛♜♝♞♟]/g;
const MARKS_RE = /[+#!?‼⁇⁈⁉]+$/;
const EP_RE = /\s*e\.?p\.?$/i;
const CASTLE_RE = /^([0Oo])-([0Oo])(?:-([0Oo]))?$/;
const PROMO_LETTERS = { q: QUEEN, r: ROOK, b: BISHOP, n: KNIGHT };

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let table = null; // the letters of every registered language, rebuilt when a language is registered

function letterTable() {
    if (table && table.languages === LANGUAGES.length) return table;
    const piece = new Map(); // letter → piece type, for a leading piece
    const promo = new Map(); // letter → piece type, after a square
    for (const lang of LANGUAGES) {
        const L = lettersOf(lang);
        for (const type of [KNIGHT, BISHOP, ROOK, QUEEN, KING]) {
            const letter = L.piece[type];
            const lower = letter.toLowerCase();
            piece.set(letter, type);
            // a bare lowercase b is a pawn file, never a bishop
            if (lower !== 'b') piece.set(lower, type);
            if (type !== KING) {
                promo.set(letter, type);
                promo.set(lower, type);
            }
        }
    }
    const alt = (m) =>
        [...m.keys()]
            .sort((a, b) => b.length - a.length)
            .map(escapeRe)
            .join('|');
    table = {
        languages: LANGUAGES.length,
        piece,
        promo,
        re: new RegExp(`^(${alt(piece)})?([a-h])?([1-8])?([-x:×])?([a-h][1-8])(?:=?(${alt(promo)}))?$`),
    };
    return table;
}

const shorten = (x) => {
    const s = typeof x === 'string' ? x : typeof x === 'number' ? String(x) : typeof x;
    return s.length > MAX_INPUT ? s.slice(0, MAX_INPUT) + '…' : s;
};

function syntaxError(input) {
    const text = shorten(input);
    return new ChessError('move', { reason: 'syntax', input: text }, msg('core.move.syntax', { text }));
}

/** The error for a well-formed input that no legal move matches (parseMove returns NO_MOVE; the Game throws this). */
export function illegalMove(input) {
    const text = shorten(typeof input === 'object' && input ? `${shorten(input.from)}-${shorten(input.to)}` : input);
    return new ChessError('move', { reason: 'illegal', input: text }, msg('core.move.illegal', { text }));
}

// the legal moves as an array
function legalList(pos) {
    const out = new Int32Array(256);
    return Array.from(out.subarray(0, generateMoves(pos, out)));
}

// the single move of the list, NO_MOVE for none; several moves are an ambiguity error
function single(pos, text, list) {
    if (list.length === 0) return NO_MOVE;
    if (list.length === 1) return list[0];
    const candidates = list.map((move) => ({ move, uci: moveToUci(move), san: toSan(pos, move) }));
    const shown = shorten(text);
    // the moves it may mean, each language in its own SAN (Nbd2 in English, with the Russian knight letter in Russian)
    const sans = (lang) => list.map((move) => toSan(pos, move, { lang })).join(', ');
    throw new ChessError('move', { reason: 'ambiguous', input: shown, candidates }, msg('core.move.ambiguous', { text: shown, candidates: sans }));
}

/**
 * The legal move of pos that the input names. input: SAN in any registered language (Nf3, a Russian knight letter, ♘f3, exd5, e8=Q,
 * O-O, 0-0-0), a long form (e2e4, e2-e4, e7e8q, Ng1f3), an object {from: 'e2', to: 'e4', promotion?: 'q'} or an
 * encoded move. Returns NO_MOVE when the input is well formed but no legal move matches; throws
 * ChessError('move') with data.reason 'syntax' for unreadable input and 'ambiguous' (data.candidates: [{move, uci,
 * san}]) when several moves match.
 */
export function parseMove(pos, input) {
    if (typeof input === 'number') {
        if (!Number.isInteger(input)) throw syntaxError(input);
        return input !== NO_MOVE && legalList(pos).includes(input) ? input : NO_MOVE;
    }
    if (input && typeof input === 'object' && !Array.isArray(input)) return parseObject(pos, input);
    if (typeof input !== 'string') throw syntaxError(input);
    const trimmed = input.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_INPUT) throw syntaxError(input);
    const text = trimmed
        .replace(FIGURINE_RE, (c) => FIGURINES[c])
        .replace(MARKS_RE, '')
        .replace(EP_RE, '')
        .replace(MARKS_RE, '');

    const castle = CASTLE_RE.exec(text);
    if (castle) {
        // the same mark twice or thrice: O-O or O-O-O, written with letters or zeros
        const long = castle[3] !== undefined;
        const list = legalList(pos).filter((m) => moveFlags(m) & F_CASTLE && ((moveTo(m) & 7) === 2) === long);
        return single(pos, input, list);
    }

    const t = letterTable();
    const parts = t.re.exec(text);
    if (!parts) throw syntaxError(input);
    const type = parts[1] === undefined ? 0 : t.piece.get(parts[1]);
    const fileGiven = parts[2] === undefined ? -1 : parts[2].charCodeAt(0) - 97;
    const rankGiven = parts[3] === undefined ? -1 : parts[3].charCodeAt(0) - 49;
    const takes = parts[4] === 'x' || parts[4] === ':' || parts[4] === '×';
    const to = parseSquare(parts[5]);
    const promo = parts[6] === undefined ? 0 : t.promo.get(parts[6]);
    const fullFrom = fileGiven >= 0 && rankGiven >= 0;

    const list = legalList(pos).filter((m) => {
        if (moveTo(m) !== to || movePromo(m) !== promo) return false;
        const from = moveFrom(m);
        const piece = pos.board[from] & 7;
        if (type) {
            if (piece !== type) return false;
        } else if (!fullFrom) {
            // a pawn: with a file it leaves that file; without one it goes straight ahead
            if (piece !== PAWN) return false;
            if (fileGiven < 0 && fileOf(from) !== fileOf(to)) return false;
        }
        if (fileGiven >= 0 && fileOf(from) !== fileGiven) return false;
        if (rankGiven >= 0 && rankOf(from) !== rankGiven) return false;
        if (takes && !(moveFlags(m) & F_CAPTURE)) return false;
        return true;
    });
    return single(pos, input, list);
}

function parseObject(pos, input) {
    const from = parseSquare(input.from);
    const to = parseSquare(input.to);
    if (from < 0 || to < 0) throw syntaxError(`${shorten(input.from)}-${shorten(input.to)}`);
    let promo = 0;
    const p = input.promotion;
    if (p !== undefined && p !== null && p !== '') {
        promo = typeof p === 'string' ? (PROMO_LETTERS[p.toLowerCase()] ?? 0) : 0;
        if (!promo) throw syntaxError(String(p));
    }
    const list = legalList(pos).filter((m) => moveFrom(m) === from && moveTo(m) === to && movePromo(m) === promo);
    return list.length ? list[0] : NO_MOVE;
}
