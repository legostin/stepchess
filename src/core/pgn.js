// core/pgn — PGN: parsePgn / parsePgnGames read games with variations, comments and NAGs into a tree; writePgn writes one.
//
// A game is {headers, root, result}. root is the start position (move 0); a node's children[0] is the main
// continuation, the other children are variations that replace it. Moves are read with parseMove, so English and
// Russian letters, 0-0 and figurines all work; they are written back in the language asked for.
import { msg } from '../i18n/index.js';
import { ChessError } from './errors.js';
import { Position } from './position.js';
import { NO_MOVE } from './move.js';
import { parseMove, toSan } from './san.js';

const RESULT_RE = /^(?:1-0|0-1|1\/2-1\/2|\*)$/;
const NUMBER_RE = /^(\d+)(\.+)(.*)$/s;
const TAG_RE = /\[\s*([A-Za-z0-9_]+)\s*"((?:[^"\\]|\\[\s\S])*)"\s*\]/y;
const WORD_RE = /[^\s{}()[\];$]+/y;
const NAG_MARKS = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
const MARKS_END_RE = /(!!|\?\?|!\?|\?!|!|\?)$/;
const TAG_ORDER = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result'];
const WRAP = 80;
const MAX_NAG = 255; // the PGN standard numbers NAGs 0 to 255
const SPACE_RE = /\s/; // Unicode white space too (NBSP, the ideographic space, …), not only the ASCII kind

const node = (move, san) => ({ move, san, nags: [], children: [] });

function pgnError(reason, params) {
    return new ChessError('pgn', { reason, ...params }, msg(`core.pgn.${reason}`, params));
}

function lineOf(src, index) {
    let line = 1;
    for (let k = 0; k < index && k < src.length; k++) if (src.charCodeAt(k) === 10) line++;
    return line;
}

/** A syntax error at an index of the text: why is a key of core.pgn.why. */
function syntaxAt(src, index, why) {
    const text = src.slice(index, index + 20).split(/\s/)[0] || src.slice(index, index + 1);
    return pgnError('syntax', { text, line: lineOf(src, index), why: msg(`core.pgn.why.${why}`), cause: why });
}

// the games of the text; only the first when `first` is set
function readGames(text, first) {
    if (typeof text !== 'string') throw pgnError('syntax', { text: typeof text, line: 1, why: msg('core.pgn.why.type'), cause: 'type' });
    const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
    const n = src.length;
    const games = [];
    let i = 0;
    for (;;) {
        // blank space and % escape lines between games
        for (;;) {
            while (i < n && SPACE_RE.test(src[i])) i++;
            if (src[i] === '%' && (i === 0 || src[i - 1] === '\n')) {
                while (i < n && src[i] !== '\n') i++;
            } else break;
        }
        if (i >= n) break;
        const game = { headers: {}, root: node(NO_MOVE, ''), result: '*' };
        i = readHeaders(src, i, game.headers);
        i = readMovetext(src, i, game);
        games.push(game);
        if (first) break;
    }
    return games;
}

function readHeaders(src, start, headers) {
    let i = start;
    for (;;) {
        while (i < src.length && SPACE_RE.test(src[i])) i++;
        if (src[i] !== '[') return i;
        TAG_RE.lastIndex = i;
        const m = TAG_RE.exec(src);
        if (!m) throw syntaxAt(src, i, 'tag');
        headers[m[1]] = m[2].replace(/\\([\s\S])/g, (_, c) => (c === '"' || c === '\\' ? c : '\\' + c));
        i = TAG_RE.lastIndex;
    }
}

// the moves of one game, from i to its result, the next game's tags or the end; returns where it stopped
function readMovetext(src, start, game) {
    const n = src.length;
    const headers = game.headers;
    // a FEN tag that is present is read as it stands, so an empty one is a typed 'fen' error and not a silent start position
    const pos = Position.fromFen(headers.FEN !== undefined ? headers.FEN : Position.START_FEN);
    const root = game.root;
    let cur = root; // the node at the end of the line being read
    const line = []; // the nodes from the root to cur
    const frames = []; // open variations: {saved: the line before the variation took its last move off, moved}
    let pre = []; // comments between "(" and the first move of the variation
    let result = null;
    let i = start;

    const attach = (text) => {
        const top = frames[frames.length - 1];
        if (top && !top.moved) pre.push(text);
        else if (cur === root && line.length === 0) root.comment = root.comment ? `${root.comment} ${text}` : text;
        else cur.comment = cur.comment ? `${cur.comment} ${text}` : text;
    };

    const play = (word, at) => {
        const marks = MARKS_END_RE.exec(word);
        const bare = marks ? word.slice(0, marks.index) : word;
        // cause is why parseMove refused the move (syntax, ambiguous or illegal), so a caller can tell them apart
        const fail = (cause) => {
            const params = { text: word, ply: line.length + 1, line: lineOf(src, at) };
            return new ChessError('pgn', { reason: 'move', cause, ...params }, msg('core.pgn.move', params));
        };
        let m;
        try {
            m = parseMove(pos, bare);
        } catch (e) {
            throw fail(e instanceof ChessError && e.code === 'move' ? e.data.reason : 'syntax');
        }
        if (m === NO_MOVE) throw fail('illegal');
        const child = node(m, toSan(pos, m));
        if (marks) child.nags.push(NAG_MARKS[marks[1]]);
        if (pre.length) {
            child.comment = pre.join(' ');
            pre = [];
        }
        try {
            pos.make(m);
        } catch (e) {
            throw fail('illegal');
        }
        cur.children.push(child);
        line.push(child);
        cur = child;
        if (frames.length) frames[frames.length - 1].moved = true;
    };

    while (i < n) {
        const c = src[i];
        if (c <= ' ' || SPACE_RE.test(c)) {
            i++;
        } else if (c === '{') {
            const end = src.indexOf('}', i + 1);
            if (end < 0) throw syntaxAt(src, i, 'comment');
            attach(src.slice(i + 1, end).trim());
            i = end + 1;
        } else if (c === ';') {
            let end = src.indexOf('\n', i);
            if (end < 0) end = n;
            attach(src.slice(i + 1, end).trim());
            i = end;
        } else if (c === '%' && src[i - 1] === '\n') {
            while (i < n && src[i] !== '\n') i++;
        } else if (c === '[') {
            break; // the tags of the next game
        } else if (c === '(') {
            const top = frames[frames.length - 1];
            if (line.length === 0 || (top && !top.moved)) throw syntaxAt(src, i, 'variation-start');
            frames.push({ saved: line.slice(), moved: false, at: i });
            line.pop();
            pos.unmake();
            cur = line.length ? line[line.length - 1] : root;
            pre = [];
            i++;
        } else if (c === ')') {
            const frame = frames.pop();
            if (!frame) throw syntaxAt(src, i, 'variation-close');
            const base = frame.saved.length - 1;
            while (line.length > base) {
                line.pop();
                pos.unmake();
            }
            const last = frame.saved[base];
            pos.make(last.move);
            line.push(last);
            cur = last;
            pre = [];
            i++;
        } else if (c === '$') {
            let j = i + 1;
            while (j < n && src.charCodeAt(j) >= 48 && src.charCodeAt(j) <= 57) j++;
            // a NAG is 0 to 255, by its value: $001 is 1, and a number beyond 255 (however many digits) is no NAG
            const nag = Number(src.slice(i + 1, j));
            if (j === i + 1 || nag > MAX_NAG) throw syntaxAt(src, i, 'token');
            cur.nags.push(nag);
            i = j;
        } else {
            WORD_RE.lastIndex = i;
            const w = WORD_RE.exec(src);
            if (!w) throw syntaxAt(src, i, 'token');
            let word = w[0];
            const at = i;
            i = WORD_RE.lastIndex;
            if (RESULT_RE.test(word)) {
                result = word;
                break;
            }
            if (/^[!?]+$/.test(word)) {
                if (word in NAG_MARKS) cur.nags.push(NAG_MARKS[word]);
                continue;
            }
            const num = NUMBER_RE.exec(word);
            if (num) {
                word = num[3];
                if (!word) continue;
            } else if (/^\d+$/.test(word)) continue;
            play(word, at);
        }
    }
    if (frames.length) throw syntaxAt(src, frames[frames.length - 1].at, 'variation-open'); // at the "(" that is never closed
    game.result = result ?? (RESULT_RE.test(headers.Result ?? '') ? headers.Result : '*');
    return i;
}

/** The first game of a PGN text (an empty text gives an empty game). Throws ChessError('pgn' | 'fen'). */
export function parsePgn(text) {
    const games = readGames(text, true);
    return games[0] ?? { headers: {}, root: node(NO_MOVE, ''), result: '*' };
}

/** Every game of a PGN text. Throws ChessError('pgn' | 'fen'). */
export function parsePgnGames(text) {
    return readGames(text, false);
}

// a NAG that can be written: a whole number 0 to 255 (anything else a caller put in the tree is left out)
const validNag = (nag) => Number.isInteger(nag) && nag >= 0 && nag <= MAX_NAG;

const escapeTag = (v) => String(v).replace(/[\\"]/g, '\\$&');

/**
 * The game as PGN text, its moves in the language (en by default; ru writes the Russian letters and 0-0). The moves are replayed from the
 * FEN header (or the start position), so every node's move must be legal on its line.
 */
export function writePgn(game, opts) {
    const lang = opts?.lang ?? 'en';
    const headers = game.headers ?? {};
    // an empty FEN tag is no FEN: it is left out, so that what is written always reads back
    const keys = Object.keys(headers).filter((k) => /^\w+$/.test(k) && !(k === 'FEN' && String(headers[k] ?? '').trim() === ''));
    keys.sort((a, b) => {
        const ia = TAG_ORDER.indexOf(a);
        const ib = TAG_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    const pos = Position.fromFen(keys.includes('FEN') ? headers.FEN : Position.START_FEN);
    const tokens = [];
    const root = game.root;
    if (root.comment) tokens.push(`{${root.comment.replace(/}/g, ')')}}`);
    for (const nag of root.nags ?? []) if (validNag(nag)) tokens.push(`$${nag}`);

    // the lines being written: a frame walks one line, and a variation is a frame of its own on top of it
    const stack = [{ cur: root, idx: 0, plies: 0, forceNum: true, child: null, vars: [], variation: false }];
    while (stack.length) {
        const f = stack[stack.length - 1];
        if (f.child === null) {
            const child = f.cur.children[f.idx];
            if (!child) {
                while (f.plies-- > 0) pos.unmake();
                stack.pop();
                if (f.variation) tokens.push(')');
                continue;
            }
            const white = pos.side === 0;
            if (white) tokens.push(`${pos.fullmove}.`);
            else if (f.forceNum) tokens.push(`${pos.fullmove}...`);
            f.forceNum = false;
            tokens.push(toSan(pos, child.move, { lang }));
            for (const nag of child.nags ?? []) if (validNag(nag)) tokens.push(`$${nag}`);
            if (child.comment) tokens.push(`{${child.comment.replace(/}/g, ')')}}`);
            f.child = child;
            f.vars = f.idx === 0 ? f.cur.children.map((_, k) => k).slice(1) : [];
        } else if (f.vars.length) {
            const k = f.vars.shift();
            tokens.push('(');
            stack.push({ cur: f.cur, idx: k, plies: 0, forceNum: true, child: null, vars: [], variation: true });
            f.forceNum = true;
        } else {
            pos.make(f.child.move);
            f.plies++;
            f.cur = f.child;
            f.idx = 0;
            f.child = null;
        }
    }
    tokens.push(game.result && RESULT_RE.test(game.result) ? game.result : '*');
    // the "(" and ")" stick to their moves
    const joined = [];
    for (const t of tokens) {
        if (joined.length && (joined[joined.length - 1] === '(' || t === ')')) joined[joined.length - 1] += t;
        else joined.push(t);
    }
    const lines = [];
    let row = '';
    for (const t of joined) {
        if (row && row.length + 1 + t.length > WRAP) {
            lines.push(row);
            row = t;
        } else row = row ? `${row} ${t}` : t;
    }
    if (row) lines.push(row);
    const head = keys.map((k) => `[${k} "${escapeTag(headers[k])}"]`).join('\n');
    return (head ? head + '\n\n' : '') + lines.join('\n');
}
