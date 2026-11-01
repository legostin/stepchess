// play/opponent — the human-like opponent: book moves early, then a limited search whose candidates are thinned by blind spots and chosen by a softmax.
//
// A move is chosen in four steps. (1) In the first 12 plies a move of the opening book is drawn by its weight. (2) Otherwise
// the position is searched twice with the level's node budget and multi-PV: once shallow (to the plies the level sees
// threats at), once at full strength. (3) The candidates are thinned the way a person misses things: a backward move, a move
// along a long diagonal, a quiet move whose gain shows only beyond the shallow view are each dropped with the level's chance;
// a move whose refutation lies beyond the shallow view is scored as the shallow view scores it. (4) A softmax over the scores
// divided by the level's temperature picks the move; with a chance that grows with the number of near-equal candidates the
// 2nd..4th best is played instead. All randomness comes from the seed (mulberry32), so a seed and a sequence of positions
// always give the same moves.
//
// The blind spots work on the moves of the full search's top multi-PV only: the threat re-scoring changes the score of a
// candidate that is already among those lines, and does not bring in a move the full search left out. A mate in 1 is always
// played. A mate outranks any evaluation in the softmax, a mate against the side any evaluation.
import { msg } from '../i18n/index.js';
import {
    Position,
    Game,
    ChessError,
    WHITE,
    PAWN,
    BISHOP,
    QUEEN,
    F_CAPTURE,
    generateMoves,
    moveFrom,
    moveTo,
    movePromo,
    moveFlags,
    moveToUci,
    fileOf,
    rankOf,
    typeOf,
    toSan,
} from '../core/index.js';
import { bookMoves } from '../endgame/index.js';
import { Searcher, MATE } from '../search/index.js';
import { LEVELS, levelFor, DEFAULT_ELO } from './levels.js';

/** Plies (half-moves) of the game in which the opening book is used. */
export const BOOK_PLIES = 12;

const SCORE_CLAMP = 1500; // a huge lead counts as this much when the candidates are compared
const MATE_VIEW = 5000; // a mate counts as this much (less its distance in plies): above every clamped evaluation
const QUIET_MARGIN = 80; // cp a quiet move must gain between the shallow and the full view to count as a late gain
const THREAT_MARGIN = 120; // cp a move must lose between the shallow and the full view to count as a refutation beyond sight
const COMPLEXITY_BAND = 50; // cp from the best within which a candidate counts toward the complexity
const MAX_EXTRA = 0.9; // the largest chance of playing the 2nd..4th candidate
const HASH_MB = 8;

const BUFFER = new Int32Array(256);

/** A generator of numbers in [0, 1) from a 32-bit seed (mulberry32). */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// one searcher serves every opponent: searches are synchronous and each move starts from a cleared table
let shared = null;
const searcher = () => (shared ??= new Searcher({ hashMb: HASH_MB }));

const invalid = (code, reason) => ({ ok: false, kind: 'invalid', code, reason });
const failure = (e) =>
    e instanceof ChessError ? invalid(e.code, e.text ?? msg('play.opponent.internal')) : invalid('internal', msg('play.opponent.internal'));

// the position to play from: a Position keeps its history (repetitions count), a FEN starts a fresh one; the moves
// played from it (UCI or SAN, a list) are made on a copy, so that they count too; throws ChessError ('fen', 'moves',
// 'move' or 'game')
function positionOf(input, moves) {
    const pos = input instanceof Position ? input.clone() : Position.fromFen(input);
    if (moves === undefined) return pos;
    if (!Array.isArray(moves)) throw new ChessError('moves', { reason: 'list' }, msg('play.opponent.moves'));
    const game = new Game(pos);
    for (const m of moves) game.play(m);
    return game.position;
}

// where a game stands (as core/game.status says it), or null while it goes on
function terminalOf(pos) {
    let state = null;
    let winner;
    if (generateMoves(pos, BUFFER) === 0) {
        if (pos.inCheck()) {
            state = 'checkmate';
            winner = pos.side === WHITE ? 'black' : 'white';
        } else state = 'stalemate';
    } else if (pos.isInsufficientMaterial()) state = 'insufficient';
    else if (pos.repetitionCount() >= 3) state = 'threefold';
    else if (pos.halfmove >= 100) state = 'fifty';
    if (!state) return null;
    const out = { ok: true, kind: 'terminal', state };
    if (winner) out.winner = winner;
    out.reason = msg(`play.opponent.${winner ? `${state}-${winner}` : state}`);
    return out;
}

// a score as the candidates are compared: evaluations clamped, a mate above (and a mate against below) all of them
function view(s) {
    if (s >= MATE - 1000) return MATE_VIEW - (MATE - s);
    if (s <= -(MATE - 1000)) return -MATE_VIEW + (MATE + s);
    return s > SCORE_CLAMP ? SCORE_CLAMP : s < -SCORE_CLAMP ? -SCORE_CLAMP : s;
}

// a move toward the player's own back rank by a piece that is not a pawn
function isBackward(pos, m) {
    const piece = pos.board[moveFrom(m)];
    if (typeOf(piece) === PAWN) return false;
    const dr = rankOf(moveTo(m)) - rankOf(moveFrom(m));
    return pos.side === WHITE ? dr < 0 : dr > 0;
}

// a bishop or queen move along a diagonal of more than 4 squares
function isLongDiagonal(pos, m) {
    const t = typeOf(pos.board[moveFrom(m)]);
    if (t !== BISHOP && t !== QUEEN) return false;
    const df = Math.abs(fileOf(moveTo(m)) - fileOf(moveFrom(m)));
    const dr = Math.abs(rankOf(moveTo(m)) - rankOf(moveFrom(m)));
    return df === dr && df > 4;
}

// a move that captures nothing, promotes nothing and gives no check
function isQuiet(pos, m) {
    if (movePromo(m) || (moveFlags(m) & F_CAPTURE) !== 0) return false;
    pos.make(m);
    const check = pos.inCheck();
    pos.unmake();
    return !check;
}

// a draw from a discrete distribution given by weights
function pickWeighted(weights, u) {
    let total = 0;
    for (const w of weights) total += w;
    let x = u * total;
    for (let i = 0; i < weights.length; i++) {
        x -= weights[i];
        if (x < 0) return i;
    }
    return weights.length - 1;
}

// the book move for a position in the first plies, or null
function bookMove(pos, rand) {
    const plies = (pos.fullmove - 1) * 2 + (pos.side === WHITE ? 0 : 1);
    if (plies >= BOOK_PLIES) return null;
    const book = bookMoves(pos);
    if (!book.length) return null;
    return book[
        pickWeighted(
            book.map((b) => b.weight),
            rand(),
        )
    ].move;
}

// the move a person of the level would play from a searched position
function searchMove(pos, level, rand) {
    const s = searcher();
    const { blind, blunder } = level;
    const limit = { multipv: level.multipv };
    // the shallow view first: the full search then starts from a warm table
    s.clear();
    const shallow = s.search(pos, { ...limit, depth: blind.threatDepth, nodes: Math.max(1, Math.ceil(level.nodes / 2)) });
    const full = s.search(pos, { ...limit, nodes: level.nodes });
    if (!full.lines.length) return full.best;
    const shallowScore = new Map(shallow.lines.map((l) => [l.move, l.score]));
    const shallowFloor = shallow.lines.length ? Math.min(...shallow.lines.map((l) => l.score)) : null;

    // the candidates, best first, each with the score it seems to have
    const cands = [];
    for (const line of full.lines) {
        const m = line.move;
        const deep = view(line.score);
        const seen = shallowScore.get(m) ?? shallowFloor;
        let score = deep;
        let hidden = false;
        const mateNow = line.score >= MATE - 2;
        if (seen !== null && !mateNow) {
            const near = view(seen);
            if (near - deep > THREAT_MARGIN) score = near;
            if (blind.quietWin > 0 && deep - near > QUIET_MARGIN && isQuiet(pos, m) && rand() < blind.quietWin) hidden = true;
        }
        if (!mateNow) {
            if (blind.backward > 0 && isBackward(pos, m) && rand() < blind.backward) hidden = true;
            if (blind.longDiagonal > 0 && isLongDiagonal(pos, m) && rand() < blind.longDiagonal) hidden = true;
        }
        if (!hidden) cands.push({ move: m, score, mate1: mateNow });
    }
    if (!cands.length) cands.push({ move: full.lines[0].move, score: view(full.lines[0].score), mate1: full.lines[0].score >= MATE - 2 });
    cands.sort((a, b) => b.score - a.score);
    if (cands[0].mate1) return cands[0].move; // a mate in 1 is seen at every level

    const best = cands[0].score;
    const near = cands.filter((c) => c.score >= best - COMPLEXITY_BAND).length;
    const extra = Math.min(MAX_EXTRA, blunder.base + blunder.complexity * (near - 1));
    const gate = rand();
    const draw = rand();
    if (cands.length > 1 && gate < extra) {
        const pool = Math.min(4, cands.length) - 1; // the 2nd..4th
        return cands[1 + Math.min(pool - 1, Math.floor(draw * pool))].move;
    }
    const temperature = level.temperature > 0 ? level.temperature : 1;
    const weights = cands.map((c) => Math.exp(Math.max(-50, (c.score - best) / temperature)));
    return cands[pickWeighted(weights, draw)].move;
}

// a level with some parameters replaced (the calibration tries parameters this way)
const mergeLevel = (base, over) =>
    over && typeof over === 'object' ? { ...base, ...over, blind: { ...base.blind, ...over.blind }, blunder: { ...base.blunder, ...over.blunder } } : base;

/** A seed as a 32-bit integer: any number, 1 for anything else. */
const seedOf = (seed) => (typeof seed === 'number' && Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 1);
const eloOf = (elo) => (typeof elo === 'number' && !Number.isNaN(elo) ? Math.min(LEVELS[LEVELS.length - 1].elo, Math.max(LEVELS[0].elo, elo)) : DEFAULT_ELO);

/**
 * An opponent of a strength. move(fen | Position, moves?) → {ok: true, kind: 'move', uci, san, source: 'book' | 'search'}, or
 * {ok: true, kind: 'terminal', state, winner?, reason} for a game that is over, or {ok: false, kind: 'invalid', code, reason}.
 * It never throws on its input. The opponent keeps its random generator between moves: the same seed, level and sequence of
 * positions give the same moves. A Position is not changed; its history counts for repetitions, and so do the moves
 * (UCI or SAN) played from the position: the search scores a move that repeats a position for the third time as a
 * draw, so a side that is ahead avoids it and a side that is behind goes for it.
 * options.level replaces parameters of the level of the elo (the calibration fits them this way).
 * @param {{elo?: number, seed?: number, level?: object}} [options]
 */
export function createOpponent(options) {
    let strength;
    let level;
    let rand;
    try {
        // the options are a stranger's: a getter may throw, a Proxy may be revoked
        const o = options && typeof options === 'object' ? options : {};
        const { elo = DEFAULT_ELO, seed = 1, level: custom } = o;
        strength = eloOf(elo);
        level = mergeLevel(levelFor(strength), custom);
        rand = mulberry32(seedOf(seed));
    } catch (e) {
        // a result of its own for every call: a caller that changes one does not change the next
        return { elo: DEFAULT_ELO, move: () => failure(e) };
    }
    return {
        elo: strength,
        move(input, moves) {
            try {
                const pos = positionOf(input, moves);
                const over = terminalOf(pos);
                if (over) return over;
                let m = bookMove(pos, rand);
                const source = m === null ? 'search' : 'book';
                if (m === null) m = searchMove(pos, level, rand);
                const uci = moveToUci(m);
                return { ok: true, kind: 'move', uci, san: toSan(pos, m), source };
            } catch (e) {
                return failure(e);
            }
        },
    };
}

/**
 * One move for a position, from a fresh opponent of the strength: the same elo, seed, FEN and moves always give the same
 * answer. Results as in createOpponent().move; options that are not an object give the defaults. Vary the seed from move to move.
 * @param {{elo?: number, seed?: number}} options
 * @param {string | Position} fen
 * @param {string[]} [moves] the moves played from the position, so that repetitions count
 */
export function opponentMove(options, fen, moves) {
    try {
        const o = options && typeof options === 'object' ? options : {};
        return createOpponent({ elo: o.elo, seed: o.seed }).move(fen, moves);
    } catch (e) {
        return failure(e);
    }
}
