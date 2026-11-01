// board/model — the state machine behind <stepchess-board>: selection, drops, promotion, puzzles, annotations, setup.
//
// No DOM: the element feeds it squares ('e4', or null for "off the board") and draws state(). Every input method
// returns an outcome {moves, selection, promotion, puzzle, expected}: the moves it played (the user's and, in puzzle
// mode, the opponent's automatic reply), so the view can animate and announce them and fire its events. Nothing here
// throws on input; a bad FEN or move is a typed result {ok: false, kind: 'invalid', code, reason}.
import { msg, Game, Position, legalMoves, parseMove, toSan, moveFrom, moveTo, movePromo, moveToUci, sqName, parseSquare, NO_MOVE } from '../src/index.js';

const START_FEN = Position.START_FEN;
export const MODES = Object.freeze(['play', 'puzzle', 'analysis', 'setup', 'view']);
export const KINDS = Object.freeze(['best', 'threat', 'bad', 'idea', 'attack', 'defend']);
export const GLYPHS = Object.freeze(['!!', '!', '!?', '?!', '?', '??', '#', '+']);
const PROMO_TYPES = { n: 2, b: 3, r: 4, q: 5 };
const PIECE_LETTERS = 'PNBRQKpnbrqk';
const FILES = 'abcdefgh';

const square = (name) => (typeof name === 'string' && parseSquare(name) >= 0 ? name : null);
const colorName = (side) => (side === 0 ? 'white' : 'black');
const invalid = (code, reason, extra = {}) => ({ ok: false, kind: 'invalid', code, reason, ...extra });
const errorText = (e) => e?.text ?? String(e?.message ?? e);
const empty = () => ({ arrows: [], squares: [], badges: [] });

/** The SAN of a move record ({before, move}) in a language: 'Nf3', or the Russian letters. */
export function sanIn(record, lang) {
    try {
        return toSan(Position.fromFen(record.before), record.move, { lang });
    } catch {
        return record.san ?? '';
    }
}

/** The pieces of a FEN's placement field as {square: letter}; whatever is not a piece is skipped. */
export function piecesOfFen(fen) {
    const out = {};
    const ranks = String(fen ?? '')
        .split(' ')[0]
        .split('/');
    ranks.slice(0, 8).forEach((row, i) => {
        let f = 0;
        for (const ch of row) {
            if (ch >= '1' && ch <= '8') f += Number(ch);
            else {
                if (f < 8 && PIECE_LETTERS.includes(ch)) out[FILES[f] + (8 - i)] = ch;
                f++;
            }
        }
    });
    return out;
}

/** Annotations ({arrows, squares, badges}) with every bad part dropped; a missing kind is 'idea'. */
export function normalizeAnnotations(a) {
    const out = empty();
    if (!a || typeof a !== 'object') return out;
    const kind = (k) => (KINDS.includes(k) ? k : 'idea');
    for (const x of Array.isArray(a.arrows) ? a.arrows : []) {
        if (!x || typeof x !== 'object') continue;
        const from = square(x.from);
        const to = square(x.to);
        if (from && to && from !== to) out.arrows.push({ from, to, kind: kind(x.kind) });
    }
    for (const x of Array.isArray(a.squares) ? a.squares : []) {
        const sq = square(x?.sq);
        if (sq) out.squares.push({ sq, kind: kind(x.kind) });
    }
    for (const x of Array.isArray(a.badges) ? a.badges : []) {
        const sq = square(x?.sq);
        if (sq && GLYPHS.includes(x.glyph)) out.badges.push({ sq, glyph: x.glyph });
    }
    return out;
}

// the castling rights a set-up board allows: a king and a rook on their home squares
function inferCastling(cells) {
    let r = '';
    if (cells.e1 === 'K' && cells.h1 === 'R') r += 'K';
    if (cells.e1 === 'K' && cells.a1 === 'R') r += 'Q';
    if (cells.e8 === 'k' && cells.h8 === 'r') r += 'k';
    if (cells.e8 === 'k' && cells.a8 === 'r') r += 'q';
    return r || '-';
}

function placementOf(cells) {
    let out = '';
    for (let r = 8; r >= 1; r--) {
        let run = 0;
        for (const f of FILES) {
            const p = cells[f + r];
            if (!p) run++;
            else {
                if (run) out += run;
                run = 0;
                out += p;
            }
        }
        if (run) out += run;
        if (r > 1) out += '/';
    }
    return out;
}

function piecesOf(pos) {
    const out = {};
    for (let r = 0; r < 8; r++)
        for (let f = 0; f < 8; f++) {
            const p = pos.board[r * 16 + f];
            if (p) out[FILES[f] + (r + 1)] = PIECE_LETTERS[(p & 7) - 1 + (p >> 3 ? 6 : 0)];
        }
    return out;
}

/**
 * A board model. fen (start position by default; an invalid one falls back to it), mode play | puzzle | analysis |
 * setup | view, orientation white | black, player white | black | both (who may move in play mode), puzzle {moves}.
 */
export function createBoardModel({ fen, mode = 'play', orientation = 'white', player = 'both', puzzle = null } = {}) {
    let game = new Game();
    let records = []; // the move records of the game, one per ply
    let curMode = MODES.includes(mode) ? mode : 'play';
    let side = orientation === 'black' ? 'black' : 'white';
    let who = ['white', 'black'].includes(player) ? player : 'both';
    let selected = null;
    let pending = null; // {from, to, color}
    let annotations = empty();
    let drawn = { arrows: [], squares: [] };
    // the puzzle: the line, the solver's color, and the wrong move being shown
    let line = [];
    let solver = 0;
    let failed = false;
    // setup: square → letter, and the side to move
    let cells = {};
    let setupTurn = 'w';
    let solvedFlag = false;

    const pos = () => game.position;
    const index = () => (curMode === 'puzzle' ? records.length - (failed ? 1 : 0) : 0);
    const solved = () => curMode === 'puzzle' && line.length > 0 && !failed && records.length >= line.length && solvedFlag;

    function loadGame(text) {
        try {
            const g = new Game(text);
            game = g;
            records = [];
            return { ok: true };
        } catch (e) {
            return invalid('fen', errorText(e));
        }
    }

    function clearMarks() {
        selected = null;
        pending = null;
    }

    function resetView() {
        clearMarks();
        annotations = empty();
        drawn = { arrows: [], squares: [] };
    }

    function enterSetup() {
        cells = piecesOf(pos());
        setupTurn = pos().side === 0 ? 'w' : 'b';
    }

    const setupFen = () => `${placementOf(cells)} ${setupTurn} ${inferCastling(cells)} - 0 1`;

    // may the user move pieces of this color now?
    function canMove(color) {
        if (curMode === 'view' || pending || failed || solved()) return false;
        if (curMode === 'setup') return true;
        if (color !== pos().side) return false;
        if (curMode === 'puzzle') return line.length > 0 && color === solver && records.length < line.length;
        if (curMode === 'play') return who === 'both' || who === colorName(color);
        return true;
    }

    const pieceAt = (name) => {
        const sq = parseSquare(name);
        return sq < 0 ? 0 : pos().board[sq];
    };

    function movesFrom(name) {
        const sq = parseSquare(name);
        return legalMoves(pos()).filter((m) => moveFrom(m) === sq);
    }

    function targetsOf(name) {
        if (!name || curMode === 'setup') return [];
        return [...new Set(movesFrom(name).map((m) => sqName(moveTo(m))))];
    }

    // play a move (legal in the position) and record it
    function play(m, auto) {
        const before = pos().fen();
        game.play(m);
        const rec = { uci: moveToUci(m), san: game.sans[game.sans.length - 1], fen: pos().fen(), before, move: m, auto, color: colorName(pos().side ^ 1) };
        records.push(rec);
        return rec;
    }

    // a move the user made: play it, then the puzzle logic
    function userMove(m) {
        const out = outcome();
        const uci = moveToUci(m);
        clearMarks();
        annotations = empty();
        drawn = { arrows: [], squares: [] };
        if (curMode !== 'puzzle') {
            out.moves.push(play(m, false));
            return out;
        }
        const expected = line[records.length];
        const last = records.length === line.length - 1;
        out.moves.push(play(m, false));
        const mates = last && game.status().state === 'checkmate';
        if (uci !== expected && !mates) {
            failed = true;
            out.puzzle = 'failed';
            out.expected = expected;
            return out;
        }
        if (records.length < line.length) {
            const reply = parseMove(pos(), line[records.length]);
            if (reply !== NO_MOVE) out.moves.push(play(reply, true));
        }
        if (records.length >= line.length) {
            solvedFlag = true;
            out.puzzle = 'solved';
        }
        return out;
    }

    function outcome(selection = undefined) {
        return { moves: [], selection: selection === undefined ? selected : selection, promotion: false, puzzle: null, expected: null };
    }

    // a move from → to by the user: played, a promotion picker, or nothing (the selection is cleared)
    function tryMove(from, to) {
        const list = movesFrom(from).filter((m) => sqName(moveTo(m)) === to);
        if (!list.length) {
            clearMarks();
            return outcome(null);
        }
        if (list.some((m) => movePromo(m))) {
            selected = from;
            pending = { from, to, color: colorName(pos().side) };
            const out = outcome();
            out.promotion = true;
            return out;
        }
        return userMove(list[0]);
    }

    function setupMove(from, to) {
        const p = cells[from];
        if (p) {
            delete cells[from];
            if (to) cells[to] = p;
        }
        clearMarks();
        return outcome(null);
    }

    const api = {
        /** A tap (or Enter) on a square, or null: select, reselect, deselect or move. */
        select(sqText) {
            const sq = square(sqText);
            if (pending) return outcome();
            if (sq === null) {
                clearMarks();
                return outcome(null);
            }
            if (curMode === 'setup') {
                if (selected === sq) {
                    selected = null;
                    return outcome(null);
                }
                if (selected) return setupMove(selected, sq);
                if (cells[sq] && canMove(0)) selected = sq;
                return outcome();
            }
            const p = pieceAt(sq);
            if (selected === sq) {
                selected = null;
                return outcome(null);
            }
            if (selected && targetsOf(selected).includes(sq)) return tryMove(selected, sq);
            if (p && canMove(p >> 3)) {
                selected = sq;
                return outcome(sq);
            }
            clearMarks();
            return outcome(null);
        },

        /** A piece dropped from a square on another (to = null: off the board). */
        drop(fromText, toText) {
            const from = square(fromText);
            const to = square(toText);
            if (pending || !from) {
                if (!pending) clearMarks();
                return outcome();
            }
            if (curMode === 'setup') {
                if (to === from) return outcome();
                if (!cells[from]) {
                    clearMarks();
                    return outcome(null);
                }
                return setupMove(from, to);
            }
            const p = pieceAt(from);
            if (!p || !canMove(p >> 3) || to === null) {
                clearMarks();
                return outcome(null);
            }
            if (to === from) {
                selected = from;
                return outcome(from);
            }
            return tryMove(from, to);
        },

        /** The piece of the open promotion picker: 'q' | 'r' | 'b' | 'n', or null to take the move back. */
        promote(type) {
            if (!pending) return outcome();
            const { from, to } = pending;
            const promo = typeof type === 'string' ? PROMO_TYPES[type.toLowerCase()] : undefined;
            if (!promo) {
                clearMarks();
                return outcome(null);
            }
            const m = movesFrom(from).find((x) => sqName(moveTo(x)) === to && movePromo(x) === promo);
            pending = null;
            if (!m) {
                clearMarks();
                return outcome(null);
            }
            return userMove(m);
        },

        /** Drop the selection and the promotion picker; in a failed puzzle, take the wrong move back. */
        cancel() {
            clearMarks();
            if (failed) {
                game.undo();
                records.pop();
                failed = false;
            }
            return outcome(null);
        },

        /** Arrows, squares and badges to show (the explain/ format); null clears them. */
        annotate(a) {
            annotations = normalizeAnnotations(a);
        },

        /** Toggle a drawn arrow (from ≠ to) or circle (from = to); to = null does nothing. */
        draw(fromText, toText, kind = 'idea') {
            const from = square(fromText);
            const to = square(toText);
            if (!from || !to || curMode === 'view') return;
            const k = KINDS.includes(kind) ? kind : 'idea';
            if (from === to) {
                const i = drawn.squares.findIndex((s) => s.sq === from);
                if (i >= 0) drawn.squares.splice(i, 1);
                else drawn.squares.push({ sq: from, kind: k });
            } else {
                const i = drawn.arrows.findIndex((x) => x.from === from && x.to === to);
                if (i >= 0) drawn.arrows.splice(i, 1);
                else drawn.arrows.push({ from, to, kind: k });
            }
        },

        clearDrawn() {
            drawn = { arrows: [], squares: [] };
        },

        /** A new position; opts.puzzle {moves} starts a puzzle from it. */
        // (validated in full before anything changes: a rejected position or line leaves the model as it was)
        setPosition(fenText, opts = {}) {
            const text = typeof fenText === 'string' ? fenText : '';
            if (opts && opts.puzzle) return api.setPuzzle({ fen: text, moves: opts.puzzle.moves });
            const r = loadGame(text);
            if (!r.ok) return r;
            resetView();
            failed = false;
            solvedFlag = false;
            line = [];
            solver = pos().side;
            if (curMode === 'setup') enterSetup();
            return { ok: true, fen: pos().fen() };
        },

        /** A puzzle: its position (the current one by default) and its line in UCI, the solver's move first. */
        setPuzzle({ fen: fenText, moves } = {}) {
            if (!Array.isArray(moves) || !moves.length || !moves.every((x) => typeof x === 'string')) return invalid('puzzle', msg('board.model.noLine'));
            const start = fenText ?? (records.length ? records[0].before : pos().fen());
            let probe;
            try {
                probe = new Game(start);
            } catch (e) {
                return invalid('fen', errorText(e));
            }
            const ucis = [];
            for (let i = 0; i < moves.length; i++) {
                let m = NO_MOVE;
                try {
                    m = parseMove(probe.position, moves[i]);
                } catch {}
                if (m === NO_MOVE) return invalid('move', msg('board.model.badMove', { move: String(moves[i]), ply: i + 1 }), { played: i });
                ucis.push(moveToUci(m));
                probe.play(m);
            }
            loadGame(start);
            resetView();
            line = ucis;
            solver = pos().side;
            failed = false;
            solvedFlag = false;
            if (curMode === 'setup') enterSetup();
            return { ok: true, fen: pos().fen() };
        },

        /** Play moves (UCI, SAN in any language) through the API, whatever the mode; stops at the first bad one. */
        // (a first move that cannot be played changes nothing: the selection, the drawn marks and a wrong puzzle move on
        // show are left as they were)
        playMoves(list) {
            if (!Array.isArray(list)) return invalid('move', msg('board.model.noLine'), { played: 0 });
            if (curMode === 'setup') return invalid('move', msg('board.model.setup'), { played: 0 });
            if (!list.length) return { ok: true, moves: [] }; // nothing to play: nothing changes
            const parse = (position, input, ply) => {
                try {
                    const m = parseMove(position, input);
                    if (m !== NO_MOVE) return { m };
                    return { m, bad: msg('board.model.badMove', { move: String(input), ply }) };
                } catch (e) {
                    return { m: NO_MOVE, bad: errorText(e) };
                }
            };
            if (list.length) {
                // the line starts from the position without the wrong move that is on show, if any
                const base = failed ? Position.fromFen(records[records.length - 1].before) : pos();
                const first = parse(base, list[0], 1);
                if (first.m === NO_MOVE) return invalid('move', first.bad, { played: 0, moves: [] });
            }
            // cancelled: a wrong puzzle move that was on show has been taken back (the view tells its followers)
            const cancelled = failed;
            if (failed) api.cancel();
            clearMarks();
            const moves = [];
            for (const input of list) {
                const { m, bad } = parse(pos(), input, moves.length + 1);
                if (m === NO_MOVE) return invalid('move', bad, { played: moves.length, moves, cancelled });
                moves.push(play(m, false));
            }
            if (moves.length) {
                annotations = empty();
                drawn = { arrows: [], squares: [] };
            }
            if (curMode === 'puzzle' && line.length && records.length >= line.length) solvedFlag = true;
            return { ok: true, moves, cancelled };
        },

        /** Take back the last move (in a puzzle: back to the solver's turn); outcome.moves are the moves taken back. */
        undo() {
            const out = outcome(null);
            if (curMode === 'setup') return out;
            if (failed) {
                out.moves.push(records[records.length - 1]);
                api.cancel();
                return out;
            }
            clearMarks();
            const take = () => {
                if (!records.length) return false;
                game.undo();
                out.moves.push(records.pop());
                return true;
            };
            take();
            if (curMode === 'puzzle') while (records.length && pos().side !== solver) take();
            solvedFlag = false;
            if (out.moves.length) {
                annotations = empty();
                drawn = { arrows: [], squares: [] };
            }
            return out;
        },

        flip() {
            side = side === 'white' ? 'black' : 'white';
        },

        setOrientation(o) {
            if (o === 'white' || o === 'black') side = o;
        },

        setPlayer(p) {
            who = ['white', 'black'].includes(p) ? p : 'both';
        },

        /** Change the mode; leaving setup needs a legal position (else a typed result and setup stays). */
        setMode(m) {
            if (!MODES.includes(m) || m === curMode) return { ok: MODES.includes(m) };
            if (curMode === 'setup') {
                const r = loadGame(setupFen());
                if (!r.ok) return r;
            }
            if (curMode === 'puzzle' && failed) api.cancel();
            curMode = m;
            clearMarks();
            if (m === 'view') drawn = { arrows: [], squares: [] };
            if (m === 'setup') enterSetup();
            return { ok: true };
        },

        // setup mode
        /** Put a piece (FEN letter) on a square, or remove it (null). */
        place(sqText, letter) {
            const sq = square(sqText);
            if (!sq || curMode !== 'setup') return;
            if (letter === null || letter === undefined || letter === '') delete cells[sq];
            else if (typeof letter === 'string' && letter.length === 1 && PIECE_LETTERS.includes(letter)) cells[sq] = letter;
            clearMarks();
        },

        setTurn(color) {
            if (curMode === 'setup' && (color === 'white' || color === 'black')) setupTurn = color === 'white' ? 'w' : 'b';
        },

        clear() {
            if (curMode === 'setup') cells = {};
            clearMarks();
        },

        /** Everything a view needs to draw the board. */
        state() {
            const setup = curMode === 'setup';
            let fenText;
            let pieces;
            let turn;
            let check = null;
            let valid = true;
            let status = 'ongoing';
            let winner = null;
            if (setup) {
                fenText = setupFen();
                pieces = { ...cells };
                turn = setupTurn === 'w' ? 'white' : 'black';
                try {
                    Position.fromFen(fenText);
                } catch {
                    valid = false;
                }
            } else {
                const p = pos();
                fenText = p.fen();
                pieces = piecesOf(p);
                turn = colorName(p.side);
                if (p.inCheck()) check = sqName(p.kings[p.side]);
                const s = game.status();
                status = s.state;
                winner = s.winner ?? null;
            }
            const last = setup ? null : records[records.length - 1];
            return {
                fen: fenText,
                mode: curMode,
                orientation: side,
                player: who,
                turn,
                pieces,
                selected,
                targets: targetsOf(selected),
                pendingPromotion: pending ? { ...pending } : null,
                lastMove: last ? { from: last.uci.slice(0, 2), to: last.uci.slice(2, 4), uci: last.uci, san: last.san } : null,
                check,
                annotations: {
                    arrows: annotations.arrows.map((x) => ({ ...x })),
                    squares: annotations.squares.map((x) => ({ ...x })),
                    badges: annotations.badges.map((x) => ({ ...x })),
                },
                drawn: { arrows: drawn.arrows.map((x) => ({ ...x })), squares: drawn.squares.map((x) => ({ ...x })) },
                puzzle: { index: index(), length: curMode === 'puzzle' ? line.length : 0, solved: solved(), failed: curMode === 'puzzle' && failed },
                history: records.map((r) => ({ uci: r.uci, san: r.san })),
                status,
                winner,
                valid,
                interactive: curMode !== 'view' && !failed && !solved(),
            };
        },

        /** The move records of the game (with the position before each move, for sanIn). */
        records() {
            return records.slice();
        },

        /** The FEN the game started from. */
        startFen() {
            return game.startFen;
        },

        /** May the piece on this square be picked up now? (for the view: cursor and touch-action) */
        movable(sqText) {
            const sq = square(sqText);
            if (!sq) return false;
            if (curMode === 'setup') return Boolean(cells[sq]) && canMove(0);
            const p = pieceAt(sq);
            return Boolean(p) && canMove(p >> 3);
        },
    };

    // the initial position; an invalid FEN falls back to the start position
    if (fen === undefined || !loadGame(fen).ok) loadGame(START_FEN);
    solver = pos().side;
    if (curMode === 'puzzle' && puzzle) api.setPuzzle({ moves: puzzle.moves });
    if (curMode === 'setup') enterSetup();
    return api;
}
