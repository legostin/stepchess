// puzzles/find — findPuzzles: the puzzles of a game, where a move loses a lot and the opponent has a unique way to win.
//
// Every position of the main line is searched once. A move that costs its player BLUNDER_LOSS or more win chance, and leaves
// the opponent a clearly winning position, gives a candidate: the opponent's unique winning move, then the best defence, then
// the next unique winning move, and so on while the win stays unique (at most MAX_SOLVER_MOVES moves, unless a mate is on
// the board, which is followed to the end). Each candidate has to pass verifyPuzzle, whose verdict and measures the result keeps.
import { msg } from '../i18n/index.js';
import { Position, legalMoves, parsePgn, moveToUci } from '../core/index.js';
import { chanceOf, look, nodesOf, solverIssues, verifyPuzzle, winsOf, MAX_PLIES } from './verify.js';
import { invalid, failure } from './result.js';

/** A move that costs its player this much win chance or more is a blunder. */
export const BLUNDER_LOSS = 0.3;
/** The longest game findPuzzles reads, in plies. */
export const MAX_GAME_PLIES = 600;
const MAX_SOLVER_MOVES = 5;
const DEFAULT_NODES = 100000;

// the moves of the main line of a game, from its start position
function mainLine(game) {
    const moves = [];
    for (let node = game.root.children[0]; node; node = node.children[0]) moves.push(node.move);
    return moves;
}

// the unique winning move of a position: {move, mate} or null when there is none
function uniqueWin(pos, nodes) {
    const r = look(pos, nodes, { multipv: 2 });
    const [best, second] = r.lines;
    if (!best) return null;
    const mate = best.mate !== null && best.mate > 0;
    return solverIssues(best, second, best, mate).length === 0 ? { move: best.move, mate } : null;
}

// the line from a position where the solver is to move: [solver, reply, solver, …] as encoded moves, [] when the win is not unique.
// The line ends at the last move that was unique: when the final mating move has two equal mates, it is cut one move early.
function lineFrom(position, nodes) {
    const pos = position.clone();
    const first = uniqueWin(pos, nodes);
    if (!first) return [];
    const moves = [first.move];
    pos.make(first.move);
    let mating = first.mate;
    while (legalMoves(pos).length > 0 && moves.length + 2 <= (mating ? MAX_PLIES : 2 * MAX_SOLVER_MOVES - 1)) {
        const reply = look(pos, nodes).lines[0];
        if (!reply) break;
        pos.make(reply.move);
        const next = uniqueWin(pos, nodes);
        if (!next) break; // the line ends with the solver's last unique move
        moves.push(reply.move, next.move);
        pos.make(next.move);
        mating = next.mate;
    }
    return moves;
}

/**
 * The puzzles of the first game of a PGN: after a move with a loss of BLUNDER_LOSS or more the opponent has a unique winning
 * move, and the line is extended while the win stays unique. A puzzle is {ply, fen, moves, themes, rating}: ply is the
 * 1-based ply of the blunder (so the plies played before the position), fen the position after it, moves the solver's line in
 * UCI (the solver first and last), themes and rating as verifyPuzzle gives them. options.nodes bounds every search
 * (default 100000). Comments, NAGs and variations in the PGN are read and ignored; a game from a FEN header starts there.
 * @param {string} pgn
 * @param {{nodes?: number}} [options]
 */
export function findPuzzles(pgn, options = {}) {
    try {
        const nodes = nodesOf(options?.nodes, DEFAULT_NODES);
        const game = parsePgn(pgn);
        const moves = mainLine(game);
        if (moves.length > MAX_GAME_PLIES) return invalid('limit', msg('puzzles.find.long', { max: MAX_GAME_PLIES }));
        const pos = Position.fromFen(game.headers.FEN || Position.START_FEN);
        const puzzles = [];
        let here = look(pos, nodes); // the search of the position before the move
        for (let i = 0; i < moves.length; i++) {
            pos.make(moves[i]);
            const after = look(pos, nodes);
            const losing = chanceOf(here) - (1 - chanceOf(after)); // what the move cost its player
            if (after.best !== 0 && losing >= BLUNDER_LOSS && winsOf(after)) {
                const line = lineFrom(pos, nodes);
                if (line.length > 0) {
                    const uci = line.map((m) => moveToUci(m));
                    const fen = pos.fen();
                    const v = verifyPuzzle({ fen, moves: uci }, { nodes });
                    if (v.ok && v.valid) puzzles.push({ ply: i + 1, fen, moves: uci, themes: v.themes, rating: v.difficulty.rating });
                }
            }
            here = after;
        }
        return { ok: true, kind: 'puzzles', puzzles };
    } catch (e) {
        return failure(e, msg('puzzles.find.internal'));
    }
}
