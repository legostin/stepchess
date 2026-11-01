// api — the public contract: analysis, explanations, reviews, hints, the opponent, puzzles, positions, games, tablebases and openings behind functions that never throw on user input.
//
// Every function takes what a stranger may type (a FEN, a PGN, options) and answers with a plain result:
//   {ok: true, kind: 'analysis' | 'move' | 'review' | 'hint' | 'terminal' | 'position' | 'game' | …, …}   or   {ok: false, kind: 'invalid', code, reason: Msg}
// A ChessError of the core becomes an invalid result with its own code ('fen', 'move', 'pgn', 'game') and its message;
// anything unexpected becomes the code 'internal'. Results hold numbers, strings, arrays and plain objects (and Msg for
// texts), so they cross a worker boundary and localize() renders every text of them. The result types below are unions
// discriminated by their literal `ok` and `kind`, so a TypeScript caller narrows on them; src/index.js exports them by name.
import { msg } from './i18n/index.js';
import { Position, Game, ChessError, WHITE, NO_MOVE, moveToUci, toSan, parsePgn } from './core/index.js';
import { trace, winChance } from './eval/index.js';
import { probe, tablebase as lookupTablebase, openingName as lookupOpening } from './endgame/index.js';
import { Searcher, allocate } from './search/index.js';
import { explainMove as explainOne, reviewGame as reviewAll, hint as hintFor, explainNodes } from './explain/index.js';
import { createOpponent as playerOf, opponentMove as playOpponent, LEVELS, DEFAULT_ELO } from './play/index.js';
import { verifyPuzzle as verifyOne, solveMate as solveOne, findPuzzles as findAll } from './puzzles/index.js';

/** The node budget of an analysis given no limit at all. */
const DEFAULT_NODES = 300000;
const DEFAULT_HASH_MB = 16;

/**
 * @typedef {import('./i18n/index.js').Msg} Msg
 * @typedef {'white' | 'black'} Side
 * @typedef {'syntax' | 'ambiguous' | 'illegal'} MoveCause
 * @typedef {{ok: false, kind: 'invalid', code: string, reason: Msg, cause?: MoveCause}} Invalid
 * @typedef {'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty'} TerminalState
 * @typedef {{ok: true, kind: 'terminal', state: TerminalState, winner?: Side, reason: Msg}} Terminal
 * @typedef {string | {from: string, to: string, promotion?: string}} MoveInput
 * @typedef {{uci: string, san: string}} PvMove
 * @typedef {{uci: string, san: string, score: number, mate: number | null, pv: PvMove[]}} AnalysisLine
 * @typedef {ReturnType<typeof trace>} Trace
 * @typedef {{ok: true, kind: 'analysis', fen: string, side: Side, score: number, scoreWhite: number, mate: number | null,
 *   win: number, depth: number, nodes: number, lines: AnalysisLine[], trace: Trace, stopped?: true}} Analysis
 * @typedef {{multipv: number, seldepth: number, timeMs: number, hashfull: number, line: AnalysisLine}} InfoMeta
 * @typedef {{depth?: number, nodes?: number, movetime?: number, multipv?: number, wtime?: number, btime?: number, winc?: number,
 *   binc?: number, movestogo?: number, infinite?: boolean, moves?: string[], hashMb?: number, keepHash?: boolean,
 *   stop?: () => boolean, onInfo?: (result: Analysis, meta: InfoMeta) => void}} AnalyzeOptions
 *
 * @typedef {{state: 'ongoing' | TerminalState, winner?: Side}} Status
 * @typedef {{ok: true, kind: 'position', fen: string, side: Side, legal: PvMove[], status: Status, inCheck: boolean}} PositionInfo
 * @typedef {{ok: true, kind: 'game', headers: Record<string, string>, moves: {uci: string, san: string, fen: string}[], result: string}} ParsedGame
 *
 * @typedef {'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'} MoveClass
 * @typedef {'best' | 'threat' | 'bad' | 'idea' | 'attack' | 'defend'} AnnotationKind
 * @typedef {{arrows: {from: string, to: string, kind: AnnotationKind}[], squares: {sq: string, kind: AnnotationKind}[],
 *   badges: {sq: string, glyph: string}[]}} Annotations
 * @typedef {{key: string, kind: 'tactic' | 'mate' | 'positional', side: number, ply: number, pieces: number[], squares: number[],
 *   arrows: {from: number, to: number, kind: AnnotationKind}[], params: Record<string, unknown>}} Motif
 * @typedef {{title: Msg, text?: Msg, line?: string[], annotations?: Annotations, rule: 'class' | 'motif' | 'term' | 'refutation' | 'best' | 'answer',
 *   data?: Record<string, unknown>, final?: true}} Step
 * @typedef {{uci: string, san: string, score: number, scoreWhite: number, mate?: number}} Alternative
 * @typedef {{ok: true, kind: 'move', move: PvMove, class: MoveClass, winBefore: number, winAfter: number, loss: number,
 *   best: {uci: string, san: string, line: string[], motifs: Motif[]} | null, alternatives: Alternative[], motifs: Motif[],
 *   terms: {key: string, delta: number}[], refutation: {line: string[], motifs: Motif[]} | null, steps: Step[], annotations: Annotations}} MoveExplanation
 * @typedef {{nodes?: number, movetime?: number, moves?: string[], hashMb?: number, keepHash?: boolean}} ExplainOptions
 *
 * @typedef {{ply: number, uci: string, san: string, class: MoveClass, loss: number, win: number, best: PvMove | null, motifs: string[]}} ReviewedMove
 * @typedef {{white: number | null, black: number | null, from: number, to: number}} Stage
 * @typedef {{ok: true, kind: 'review', headers: Record<string, string>, moves: ReviewedMove[], accuracy: {white: number | null, black: number | null},
 *   keyMoments: number[], missedWins: number[], opening: {eco: string, name: Msg, ply: number} | null,
 *   phases: {opening: Stage | null, middlegame: Stage | null, endgame: Stage | null}, steps: Step[]}} GameReview
 * @typedef {{nodesPerMove?: number, onProgress?: (p: {done: number, total: number}) => void, hashMb?: number, keepHash?: boolean}} ReviewOptions
 * @typedef {{ok: true, kind: 'hint', step: 1 | 2 | 3, text: Msg, annotations: Annotations, move?: PvMove}} Hint
 *
 * @typedef {{elo?: number, seed?: number}} OpponentOptions
 * @typedef {{wtime?: number, btime?: number, winc?: number, binc?: number, movestogo?: number}} Clock
 * @typedef {{ok: true, kind: 'move', uci: string, san: string, source: 'book' | 'search'}} OpponentMove
 * @typedef {{ok: true, kind: 'opponent', elo: number, seed: number,
 *   move: (fen: string | Position, clock?: Clock, moves?: string[]) => OpponentMove | Terminal | Invalid}} Opponent
 *
 * @typedef {{ply: number, code: 'illegal' | 'not-winning' | 'alternative' | 'longer-mate' | 'weak-reply', moves?: string[]}} PuzzleIssue
 * @typedef {{depth: number, candidates: number, quiet: number, rating: number}} Difficulty
 * @typedef {{ok: true, kind: 'puzzle', valid: boolean, issues: PuzzleIssue[], themes: string[], difficulty: Difficulty | null}} PuzzleVerdict
 * @typedef {{ok: true, kind: 'mate', n: number, distance: number, solutions: string[], solutionsSan: string[], distances: number[],
 *   line: string[], lineSan: string[]}} MateSolution
 * @typedef {{ok: true, kind: 'none'}} NoMate
 * @typedef {{ply: number, fen: string, moves: string[], themes: string[], rating: number}} FoundPuzzle
 * @typedef {{ok: true, kind: 'puzzles', puzzles: FoundPuzzle[]}} FoundPuzzles
 * @typedef {{nodes?: number}} PuzzleOptions
 *
 * @typedef {{uci: string, san: string, wdl: -1 | 0 | 1, dtm: number}} TablebaseMove
 * @typedef {{ok: true, kind: 'tablebase', key: string, wdl: -1 | 0 | 1, dtm: number, moves: TablebaseMove[]}} TablebaseResult
 * @typedef {{key: string, phase: string, done: number, total: number}} TablebaseProgress
 * @typedef {{tbUrl?: string, onProgress?: (p: TablebaseProgress) => void}} TablebaseOptions
 * @typedef {{ok: true, kind: 'opening', eco: string, name: Msg, ply: number, moves: string[], uci: string[]}} OpeningResult
 * @typedef {{ok: true, kind: 'none'}} NoOpening
 *
 * The engine in a worker (createEngine): the functions of the package as promises of the same results; an analysis
 * ended by stop() carries stopped: true. A stop callback cannot cross to the worker: stop() is the engine's own.
 * @typedef {Omit<AnalyzeOptions, 'stop'>} EngineAnalyzeOptions
 * @typedef {{
 *   analyze(fen: string, opts?: EngineAnalyzeOptions): Promise<Analysis | Terminal | Invalid>,
 *   explainMove(fen: string, move: MoveInput, opts?: ExplainOptions): Promise<MoveExplanation | Terminal | Invalid>,
 *   reviewGame(pgn: string, opts?: ReviewOptions): Promise<GameReview | Invalid>,
 *   hint(fen: string, step: 1 | 2 | 3, opts?: ExplainOptions): Promise<Hint | Terminal | Invalid>,
 *   opponentMove(options: OpponentOptions, fen: string, moves?: string[]): Promise<OpponentMove | Terminal | Invalid>,
 *   verifyPuzzle(input: {fen: string, moves: string[]}, options?: PuzzleOptions): Promise<PuzzleVerdict | Invalid>,
 *   solveMate(fen: string, n: number, options?: PuzzleOptions): Promise<MateSolution | NoMate | Invalid>,
 *   findPuzzles(pgn: string, options?: PuzzleOptions): Promise<FoundPuzzles | Invalid>,
 *   tablebase(fen: string, opts?: TablebaseOptions): Promise<TablebaseResult | Invalid>,
 *   openingName(input: string): Promise<OpeningResult | NoOpening | Invalid>,
 *   stop(): Promise<void>,
 *   terminate(): void,
 * }} Engine
 */

/** An invalid result. */
const invalid = (code, reason) => ({ ok: false, kind: 'invalid', code, reason });

// why a move was refused, as a ChessError of the core names it
const CAUSES = ['syntax', 'ambiguous', 'illegal'];

/**
 * The invalid result of a failure: a ChessError says what was wrong, anything else is 'internal'. A move that could
 * not be played (code 'move', or a move inside a PGN) also says why in cause: 'syntax' (unreadable), 'ambiguous'
 * (several moves fit) or 'illegal'.
 */
function failure(e) {
    if (e instanceof ChessError) {
        const out = invalid(e.code, e.text ?? msg('api.error.internal'));
        const cause = e.data?.cause;
        if (CAUSES.includes(cause)) out.cause = cause;
        return out;
    }
    return invalid('internal', msg('api.error.internal'));
}

/**
 * The result for a method this build of the engine does not have (a worker is asked for it by name).
 * @param {string} method
 * @returns {Invalid}
 */
export const unsupported = (method) => invalid('unsupported', msg('api.error.unsupported', { method: String(method).slice(0, 40) }));

// a number the caller gave as a limit, or undefined
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const positive = (v) => (finite(v) && v >= 1 ? Math.floor(v) : undefined);

// a Game from a FEN and the moves played from it (a long form, SAN in any language); throws ChessError
function gameOf(fen, moves) {
    if (typeof fen !== 'string') Position.fromFen(fen); // throws the 'fen' error for anything that is not text
    const game = new Game(fen);
    if (Array.isArray(moves)) for (const m of moves) game.play(m);
    return game;
}

const sideOf = (pos) => (pos.side === WHITE ? 'white' : 'black');

// the terminal answer for a game that is over (or claimable as drawn), or null while it goes on
function terminalOf(game) {
    const { state, winner } = game.status();
    if (state === 'ongoing') return null;
    const key = state === 'checkmate' ? `checkmate-${winner}` : state;
    const out = { ok: true, kind: 'terminal', state };
    if (winner) out.winner = winner;
    out.reason = msg(`api.terminal.${key}`);
    return out;
}

// the moves of a principal variation from a position, as {uci, san}; stops at a move that does not fit
function variation(pos, moves) {
    const p = pos.clone();
    const out = [];
    for (const m of moves) {
        let san;
        try {
            san = toSan(p, m);
            p.make(m);
        } catch {
            break;
        }
        out.push({ uci: moveToUci(m), san });
    }
    return out;
}

// a searcher kept between calls (its table is cleared before each, so a call depends on its input only); a call made
// while another is running gets a searcher of its own. Only a searcher of the default size is kept: a call with
// another hashMb drops it when it ends, so that a large table is not held between calls (on a phone it would be the
// memory the page runs out of); keepHash then has no table to keep.
let shared = null;
let busy = false;

// fn(searcher) on the shared searcher (or a fresh one inside a running call), its table cleared unless keepHash
function searching(o, fn) {
    const hashMb = Math.min(1024, positive(o.hashMb) ?? DEFAULT_HASH_MB);
    let searcher;
    const reuse = !busy;
    if (reuse && shared && shared.hashMb === hashMb) searcher = shared.searcher;
    else {
        searcher = new Searcher({ hashMb });
        if (reuse) shared = { hashMb, searcher };
    }
    if (o.keepHash !== true) searcher.clear();
    const was = busy; // a call made from a callback of this one nests: it must leave the flag as it found it
    busy = true;
    try {
        return fn(searcher);
    } finally {
        busy = was;
        if (reuse && hashMb !== DEFAULT_HASH_MB && shared?.searcher === searcher) shared = null;
    }
}

/**
 * The searcher the API keeps between calls: {hashMb} of the one kept, or null when none is (for the tests).
 * @returns {{hashMb: number} | null}
 */
export const sharedSearcher = () => (shared ? { hashMb: shared.hashMb } : null);

const optionsOf = (opts) => (opts && typeof opts === 'object' ? opts : {});

/**
 * Analyse a position: the best lines with scores, the win chance and the evaluation trace.
 *
 * Options: depth, nodes, movetime (ms), multipv, or a clock (wtime, btime, winc, binc, movestogo) bound the search;
 * with none of them the budget is 300000 nodes (`infinite: true` removes it when a `stop` callback is given, and then `stop` ends the search).
 * moves: the moves (UCI or SAN) played from the FEN, so that repetitions are counted on the real history; the result's
 * fen is the position after them (moves that are not an array are an invalid result with the code 'moves'). hashMb
 * sizes the transposition table; keepHash keeps it from the previous call
 * (otherwise it is cleared, and the same fen and options give the same answer). stop() is polled during the search;
 * onInfo(result, meta) gets a result of the same shape after each line of each depth (meta: multipv, seldepth,
 * timeMs, hashfull and the line that has just been updated). Tablebases that are loaded decide their positions.
 *
 * Scores are in centipawns from the side to move's point of view, scoreWhite from White's, and mate is the signed
 * number of moves to mate for the side to move (+n it mates, −n it is mated), null for no mate. win is White's chance.
 *
 * @param {string} fen
 * @param {AnalyzeOptions} [opts]
 * @returns {Analysis | Terminal | Invalid}
 */
export function analyze(fen, opts) {
    try {
        return run(fen, opts && typeof opts === 'object' ? opts : {});
    } catch (e) {
        return failure(e);
    }
}

function run(fen, o) {
    if (o.moves !== undefined && !Array.isArray(o.moves)) return invalid('moves', msg('api.error.moves'));
    const game = gameOf(fen, o.moves);
    const over = terminalOf(game);
    if (over) return over;

    const pos = game.position.clone(); // the searcher never sees the game's own position
    const side = sideOf(pos);
    const limits = { probe };
    for (const k of ['depth', 'nodes', 'movetime', 'multipv', 'movestogo']) {
        const v = positive(o[k]);
        if (v !== undefined) limits[k] = v;
    }
    for (const k of ['wtime', 'btime']) if (finite(o[k]) && o[k] >= 0) limits[k] = o[k];
    for (const k of ['winc', 'binc']) if (finite(o[k]) && o[k] > 0) limits[k] = o[k];
    if (typeof o.stop === 'function') limits.stop = o.stop;
    const bounded = limits.depth || limits.nodes || limits.movetime || allocate(limits, pos.side) || (o.infinite === true && typeof o.stop === 'function');
    if (!bounded) limits.nodes = DEFAULT_NODES;

    let rootTrace = null;
    const traceOnce = () => (rootTrace ??= trace(pos));
    const build = (lines, depth, nodes) => {
        const described = lines.map((l) => {
            const pv = variation(pos, l.pv);
            return { uci: pv[0]?.uci ?? moveToUci(l.move), san: pv[0]?.san ?? '', score: l.score, mate: l.mate, pv };
        });
        const score = described[0].score;
        const scoreWhite = pos.side === WHITE ? score : -score;
        return {
            ok: true,
            kind: 'analysis',
            fen: pos.fen(),
            side,
            score,
            scoreWhite,
            mate: described[0].mate,
            win: winChance(scoreWhite),
            depth,
            nodes,
            lines: described,
            trace: traceOnce(),
        };
    };

    if (typeof o.onInfo === 'function') {
        limits.onInfo = (info) => {
            if (!info.lines.length) return;
            const result = build(info.lines, info.depth, info.nodes);
            const line = result.lines.find((l) => l.uci === moveToUci(info.best)) ?? result.lines[0];
            try {
                o.onInfo(result, { multipv: info.multipv, seldepth: info.seldepth, timeMs: info.timeMs, hashfull: info.hashfull, line });
            } catch {
                // a callback that fails does not stop the analysis
            }
        };
    }

    const res = searching(o, (searcher) => searcher.search(pos, limits));
    if (res.best === NO_MOVE || !res.lines.length) return invalid('internal', msg('api.error.internal'));
    return build(res.lines, res.depth, res.nodes);
}

/**
 * The legal moves, the status and the check of a position.
 * @param {string} fen
 * @returns {PositionInfo | Invalid}
 */
export function position(fen) {
    try {
        const game = gameOf(fen);
        const pos = game.position;
        return { ok: true, kind: 'position', fen: game.fen(), side: sideOf(pos), legal: game.legal(), status: game.status(), inCheck: pos.inCheck() };
    } catch (e) {
        return failure(e);
    }
}

/**
 * A game from PGN text: the headers, the main line with the FEN after every move, and the result. Comments, NAGs and
 * variations are accepted (variations are dropped); a PGN needs no headers.
 * @param {string} pgn
 * @returns {ParsedGame | Invalid}
 */
export function parseGame(pgn) {
    try {
        const tree = parsePgn(pgn);
        const game = new Game(tree.headers.FEN);
        const moves = [];
        for (let n = tree.root.children[0]; n; n = n.children[0]) {
            const m = game.play(n.move);
            moves.push({ uci: moveToUci(m), san: game.sans[game.sans.length - 1], fen: game.fen() });
        }
        return { ok: true, kind: 'game', headers: { ...tree.headers }, moves, result: tree.result };
    } catch (e) {
        return failure(e);
    }
}

/**
 * The tablebase answer for a position of at most four pieces (see endgame/tb), with failures as invalid results.
 * @param {string} fen
 * @param {TablebaseOptions} [opts]
 * @returns {Promise<TablebaseResult | Invalid>}
 */
export async function tablebase(fen, opts) {
    try {
        return await lookupTablebase(fen, opts && typeof opts === 'object' ? opts : {});
    } catch (e) {
        return failure(e);
    }
}

/**
 * The opening a game, a list of moves or a FEN (one string) belongs to (see endgame/openings), with failures as invalid results.
 * @param {string} input
 * @returns {OpeningResult | NoOpening | Invalid}
 */
export function openingName(input) {
    try {
        return lookupOpening(input);
    } catch (e) {
        return failure(e);
    }
}

// the move encoded in the game's position, which is left as it was (ChessError when the move is not legal)
function moveIn(game, move) {
    const m = game.play(move);
    game.undo();
    return m;
}

// the limits of the searches of explainMove and hint: the node budget (default 300000, at most 5000000) and the time
function explainLimits(o) {
    const limits = { nodes: explainNodes(o.nodes) };
    const movetime = positive(o.movetime);
    if (movetime !== undefined) limits.movetime = movetime;
    return limits;
}

/**
 * Explain a move: its class by the win chance it gives away, the chances before and after it, the best move with its
 * line and motifs, the motifs of the move and of the reply, the terms of the evaluation it changes most, the refutation
 * (for an inaccuracy or worse), steps to show one by one, and annotations for a board. The move is SAN in any
 * language, a long form, UCI or {from, to, promotion}. opts.nodes bounds each of its searches (default 300000, at most
 * 5000000: a larger number is brought down to it), and opts.movetime (ms) bounds each of them in time as well: the
 * position before the move (one line, as analyze searches it at the same nodes, so analyze's move is called best), after
 * it and, when the move is not the best, after the best one; then the position before the move again with three lines
 * for the alternatives, whose first is the engine's move and whose others never score above it. opts.moves: the moves
 * (UCI or SAN) played from the FEN, as in analyze, so that a repetition and the fifty-move rule count on the real game;
 * the move is played after them. keepHash keeps the table from the previous call. A position that is over is a terminal result.
 * @param {string} fen
 * @param {MoveInput} move
 * @param {ExplainOptions} [opts]
 * @returns {MoveExplanation | Terminal | Invalid}
 */
export function explainMove(fen, move, opts) {
    try {
        const o = optionsOf(opts);
        if (o.moves !== undefined && !Array.isArray(o.moves)) return invalid('moves', msg('api.error.moves'));
        const game = gameOf(fen, o.moves);
        const over = terminalOf(game);
        if (over) return over;
        const m = moveIn(game, move);
        const limits = explainLimits(o);
        return searching(o, (searcher) => explainOne(game.position.clone(), m, { ...limits, searcher, probe }));
    } catch (e) {
        return failure(e);
    }
}

/**
 * Review a game (PGN text, its main line): the class, loss and win chance of every move, the accuracy of each side, the
 * key moments, the missed wins, the opening, the stages and steps. Every position is searched once with
 * opts.nodesPerMove nodes (default 150000) on the game's own history, so repetitions count; opts.onProgress({done,
 * total}) is called after every move.
 * @param {string} pgn
 * @param {ReviewOptions} [opts]
 * @returns {GameReview | Invalid}
 */
export function reviewGame(pgn, opts) {
    try {
        const o = optionsOf(opts);
        const nodesPerMove = positive(o.nodesPerMove) ?? 150000;
        const onProgress = typeof o.onProgress === 'function' ? o.onProgress : undefined;
        return searching(o, (searcher) => reviewAll(pgn, { nodesPerMove, onProgress, searcher, probe }));
    } catch (e) {
        return failure(e);
    }
}

/**
 * A hint for the side to move, step 1 (where to look: a piece and an area), 2 (what to look for: a mate, a threat of
 * the opponent, a motif, material or a plan) or 3 (the move, as move: {uci, san}). opts.nodes bounds each search
 * (default 300000, at most 5000000) and opts.movetime (ms) each search's time; opts.moves are the moves played from the
 * FEN, as in explainMove. A position that is over is a terminal result; any other step is an invalid result with the code 'step'.
 * @param {string} fen
 * @param {1 | 2 | 3} step
 * @param {ExplainOptions} [opts]
 * @returns {Hint | Terminal | Invalid}
 */
export function hint(fen, step, opts) {
    try {
        const o = optionsOf(opts);
        if (o.moves !== undefined && !Array.isArray(o.moves)) return invalid('moves', msg('api.error.moves'));
        const game = gameOf(fen, o.moves);
        const over = terminalOf(game);
        if (over) return over;
        if (step !== 1 && step !== 2 && step !== 3) return invalid('step', msg('api.error.step'));
        const limits = explainLimits(o);
        return searching(o, (searcher) => hintFor(game.position.clone(), step, { ...limits, searcher, probe }));
    } catch (e) {
        return failure(e);
    }
}

const MIN_ELO = LEVELS[0].elo;
const MAX_ELO = LEVELS[LEVELS.length - 1].elo;
const DEFAULT_SEED = 1;

/**
 * The human-like opponent (see play): {ok: true, kind: 'opponent', elo, seed, move(fen, clock?)}. elo is a number from
 * 400 to 2800 (default 1500) and seed any finite number (default 1), used as an unsigned 32-bit integer (truncated, then
 * taken modulo 2^32, so 7.9 plays as 7 and -1 as 4294967295; the result keeps the number given); anything else is an invalid result with the code
 * 'elo' or 'seed', and options that are not an object have the code 'options'. move(fen) answers {ok: true, kind:
 * 'move', uci, san, source: 'book' | 'search'}, a terminal result for a game that is over, or an invalid result; it never
 * throws. The opponent keeps its random generator between moves, so the same elo, seed and sequence of positions give the
 * same moves. A Position instead of a FEN keeps its history (repetitions count); move(fen, clock, moves) also takes the
 * moves played from the FEN (UCI or SAN, as in analyze; anything but a list is the code 'moves'), so that the opponent
 * sees a repetition and the fifty-move rule of the real game. The clock ({wtime, btime, winc, binc,
 * movestogo}) is accepted and does not change the move: the strength is the level's node budget, which takes well under
 * a second at every level, and a move that depended on the time left would break the determinism of the seed.
 * @param {OpponentOptions} [options]
 * @returns {Opponent | Invalid}
 */
export function createOpponent(options) {
    try {
        if (options != null && typeof options !== 'object') return invalid('options', msg('api.opponent.options'));
        const { elo = DEFAULT_ELO, seed = DEFAULT_SEED } = options ?? {}; // a getter of a stranger's object may throw: caught below
        if (typeof elo !== 'number' || !(elo >= MIN_ELO && elo <= MAX_ELO)) return invalid('elo', msg('api.opponent.elo', { min: MIN_ELO, max: MAX_ELO }));
        if (typeof seed !== 'number' || !Number.isFinite(seed)) return invalid('seed', msg('api.opponent.seed'));
        const player = playerOf({ elo, seed });
        return {
            ok: true,
            kind: 'opponent',
            elo: player.elo,
            seed,
            move(fen, clock, moves) {
                try {
                    if (moves !== undefined && !Array.isArray(moves)) return invalid('moves', msg('api.error.moves'));
                    return player.move(fen, moves);
                } catch (e) {
                    return failure(e);
                }
            },
        };
    } catch (e) {
        return failure(e);
    }
}

/**
 * One move of the human-like opponent for a position (see play): the same elo, seed, FEN and moves give the same move.
 * moves: the moves (UCI or SAN) played from the FEN, as in analyze (anything but a list is the code 'moves'), so that
 * a repetition and the fifty-move rule count on the real game. Options that are out of range are brought into it
 * (createOpponent rejects them instead).
 * @param {OpponentOptions} options
 * @param {string} fen
 * @param {string[]} [moves]
 * @returns {OpponentMove | Terminal | Invalid}
 */
export function opponentMove(options, fen, moves) {
    try {
        if (moves !== undefined && !Array.isArray(moves)) return invalid('moves', msg('api.error.moves'));
        return playOpponent(options, fen, moves);
    } catch (e) {
        return failure(e);
    }
}

/**
 * Check a puzzle line (see puzzles/verify).
 * @param {{fen: string, moves: string[]}} input
 * @param {PuzzleOptions} [options]
 * @returns {PuzzleVerdict | Invalid}
 */
export function verifyPuzzle(input, options) {
    try {
        return verifyOne(input, optionsOf(options));
    } catch (e) {
        return failure(e);
    }
}

/**
 * Every solution of a mate in n (see puzzles/mate).
 * @param {string} fen
 * @param {number} n
 * @param {PuzzleOptions} [options]
 * @returns {MateSolution | NoMate | Invalid}
 */
export function solveMate(fen, n, options) {
    try {
        return solveOne(fen, n, optionsOf(options));
    } catch (e) {
        return failure(e);
    }
}

/**
 * The puzzles of a game (see puzzles/find).
 * @param {string} pgn
 * @param {PuzzleOptions} [options]
 * @returns {FoundPuzzles | Invalid}
 */
export function findPuzzles(pgn, options) {
    try {
        return findAll(pgn, optionsOf(options));
    } catch (e) {
        return failure(e);
    }
}
