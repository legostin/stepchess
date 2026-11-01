// puzzles/verify — verifyPuzzle: is a line a puzzle? Every solver move must be the only winning one, every reply the best defence.
//
// moves[0] is the solver's move from the FEN, then the opponent's reply, the solver again, … ending with a solver move.
// At each solver ply the position is searched with two lines: the played move has to be the best, its win chance has to be at
// least WIN_MIN (or it mates), and the second-best move has to trail by UNIQUE_GAP or more. In a mate puzzle (the line ends in
// checkmate) only mates count as alternatives: another key of the same length is an alternative, a longer one only a
// longer-mate, and the puzzle stays valid; there the keys come from an exact proof (solveMate's) where it fits, not from the
// search. At each opponent ply the reply must not be a mistake against the best defence (see replyIssue). The searches are
// limited by nodes and start from a cleared table, so the same input always gives the same verdict.
import { msg } from '../i18n/index.js';
import { Position, NO_MOVE, generateMoves, legalMoves, parseMove, moveToUci } from '../core/index.js';
import { Searcher } from '../search/index.js';
import { winChance } from '../eval/index.js';
import { detectMotifs } from '../explain/index.js';
import { difficultyOf } from './difficulty.js';
import { invalid, failure, budgetOf } from './result.js';
import { mateKeys, MAX_MATE } from './mate.js';

/** The second-best move's win chance has to trail the best by at least this much. */
export const UNIQUE_GAP = 0.25;
/** The best move's win chance has to reach this (a mate always does). */
export const WIN_MIN = 0.7;
/** An opponent reply may give up at most this much win chance against the best defence... */
export const WEAK_REPLY = 0.1;
/** ...and at most this many centipawns (win chance flattens near 0 and 1, where a lost side can still throw pieces away). */
export const WEAK_REPLY_CP = 200;
/** The positions an exact proof of the keys of a mate puzzle may visit; a bigger one is left to the search. */
export const MATE_PROOF_NODES = 500000;
/** The positions each wider proof, for the keys that mate later than the puzzle, may visit; longer mates beyond the last proof that fits are not listed. */
export const LONGER_PROOF_NODES = 400000;
export const DEFAULT_NODES = 500000;
export const MAX_NODES = 20000000;
/** The longest line verifyPuzzle takes, in plies. */
export const MAX_PLIES = 61;

const HASH_MB = 8;
const PROBE_NODES = 20000; // the node cap of a zugzwang probe

// one searcher serves every call: searches are synchronous and each starts from a cleared table
let shared = null;
const searcher = () => (shared ??= new Searcher({ hashMb: HASH_MB }));

/** A node budget from an option: a number from 1 up to MAX_NODES, else the fallback. */
export const nodesOf = (value, fallback = DEFAULT_NODES) => budgetOf(value, fallback, MAX_NODES);

/**
 * A search from a cleared table. Also gives the best move of every depth reached (iterations), for the difficulty.
 * @param {Position} pos
 * @param {number} nodes
 * @param {{multipv?: number, exclude?: number[]}} [more]
 */
export function look(pos, nodes, more = {}) {
    const s = searcher();
    s.clear();
    const iterations = [];
    const result = s.search(pos, {
        nodes,
        multipv: more.multipv ?? 1,
        exclude: more.exclude,
        onInfo: (info) => {
            if (info.multipv === 1) iterations.push({ depth: info.depth, best: info.best, wins: winsOf(info) });
        },
    });
    return { ...result, iterations };
}

// what a line is worth to the side to move: a mate is all or nothing, anything else a win chance
export const chanceOf = (line) => (line.mate !== null ? (line.mate > 0 ? 1 : 0) : winChance(line.score));
export const winsOf = (line) => (line.mate !== null ? line.mate > 0 : chanceOf(line) >= WIN_MIN);

// the line of one move of the position, searched on its own when it is not among the lines already found
function lineOf(pos, move, nodes, lines) {
    const found = lines.find((l) => l.move === move);
    if (found) return found;
    const others = legalMoves(pos).filter((m) => m !== move);
    return look(pos, nodes, { exclude: others }).lines[0];
}

/**
 * The issues of a solver move, from the best two lines of its position (second may be missing) and the line of the move played
 * (mine). With mateMode (the puzzle ends in checkmate) and a mate at hand, only mates count as alternatives: another mate of the
 * same length is an alternative, a longer one a longer-mate, a non-mating move no issue. Otherwise the second move has to trail
 * the best by UNIQUE_GAP of win chance.
 */
export function solverIssues(best, second, mine, mateMode = false) {
    const played = mine.move;
    if (!winsOf(mine)) return [best.move !== played && winsOf(best) ? { code: 'not-winning', moves: [moveToUci(best.move)] } : { code: 'not-winning' }];
    if (best.move !== played) return [{ code: 'alternative', moves: [moveToUci(best.move)] }];
    if (!second) return [];
    if (mateMode && best.mate !== null && best.mate > 0) {
        if (second.mate === null || second.mate < 0) return [];
        return [{ code: second.mate > best.mate ? 'longer-mate' : 'alternative', moves: [moveToUci(second.move)] }];
    }
    return chanceOf(best) - chanceOf(second) < UNIQUE_GAP ? [{ code: 'alternative', moves: [moveToUci(second.move)] }] : [];
}

/**
 * The issues of a solver move in a mate puzzle, from an exact proof of every first move that mates within MAX_MATE moves: other
 * keys that mate as fast as the move played (or faster) are alternatives, slower ones longer-mates. null when the proof does not
 * fit its budget, or the move played is not a key it found: the search decides then.
 */
function exactIssues(pos, played, left) {
    const near = mateKeys(pos, left, MATE_PROOF_NODES);
    if (!near) return null;
    // the keys that mate later, as far up to MAX_MATE as a proof fits
    let keys = near.keys;
    for (let n = left + 1; n <= MAX_MATE; n++) {
        const wider = mateKeys(pos, n, LONGER_PROOF_NODES);
        if (!wider) break;
        keys = wider.keys;
    }
    const mine = keys.find((k) => k.move === played);
    if (!mine) return null;
    const others = keys.filter((k) => k !== mine);
    const same = others.filter((k) => k.distance <= mine.distance).map((k) => moveToUci(k.move));
    const longer = others.filter((k) => k.distance > mine.distance).map((k) => moveToUci(k.move));
    const out = [];
    if (same.length) out.push({ code: 'alternative', moves: same });
    if (longer.length) out.push({ code: 'longer-mate', moves: longer });
    return out;
}

/**
 * Judge the solver's move at a position: the issues it raises (none for a clean move) and the iterations of the search.
 * mateLeft is the number of solver moves the line has left when it is a mate puzzle (0 otherwise). The search is skipped when
 * the exact proof decides and the iterations are not wanted.
 * @returns {{issues: {code: string, moves?: string[]}[], iterations: {depth: number, best: number}[]}}
 */
export function judgeSolver(pos, played, nodes, { mateLeft = 0, iterations = true } = {}) {
    const exact = mateLeft > 0 && mateLeft <= MAX_MATE ? exactIssues(pos, played, mateLeft) : null;
    if (exact && !iterations) return { issues: exact, iterations: [] };
    const r = look(pos, nodes, { multipv: 2 });
    const [best, second] = r.lines;
    return { issues: exact ?? solverIssues(best, second, lineOf(pos, played, nodes, r.lines), mateLeft > 0), iterations: r.iterations };
}

/**
 * Is a reply a mistake against the best defence? Both are lines of the side that replies. A reply that allows a mate when the best
 * defence does not is always one, and so is one that is mated sooner than the best defence is. Otherwise it is one when it gives up
 * more than WEAK_REPLY of win chance or WEAK_REPLY_CP centipawns: the second measure keeps its meaning where the first has flattened
 * out, as when the side is lost anyway and throws a piece away.
 */
export function replyIsWeak(best, mine) {
    const mated = (l) => l.mate !== null && l.mate < 0;
    if (mated(mine)) return !mated(best) || mine.mate > best.mate;
    if (mated(best)) return false;
    if (best.mate !== null || mine.mate !== null) return chanceOf(best) - chanceOf(mine) > WEAK_REPLY; // the reply mates, or the best defence does
    return chanceOf(best) - chanceOf(mine) > WEAK_REPLY || best.score - mine.score >= WEAK_REPLY_CP;
}

/** Judge the opponent's reply at a position: weak-reply with the best defence, or nothing. */
export function judgeReply(pos, played, nodes) {
    const best = look(pos, nodes).lines[0];
    if (!best || best.move === played) return [];
    return replyIsWeak(best, lineOf(pos, played, nodes, [best])) ? [{ code: 'weak-reply', moves: [moveToUci(best.move)] }] : [];
}

// is the side to move checkmated?
const isMated = (pos) => pos.inCheck() && generateMoves(pos, new Int32Array(256)) === 0;

// the motifs of the solver's side along the line as theme keys; 'mate' and 'mateIn{N}' first when the line ends in checkmate
function themesOf(start, moves, mateMode) {
    const themes = [];
    if (mateMode) themes.push('mate', `mateIn${(moves.length + 1) / 2}`);
    try {
        const search = (p, { depth }) => {
            const s = searcher();
            s.clear();
            return { score: s.search(p.clone(), { depth, nodes: PROBE_NODES }).score };
        };
        for (const m of detectMotifs(start, moves[0], moves.slice(1), { search })) {
            if (m.side === start.side && !themes.includes(m.key)) themes.push(m.key);
        }
    } catch {
        // a motif that cannot be read must not cost the verdict: the themes stay those found so far
    }
    return themes;
}

/**
 * Check a puzzle line. input.fen is the position, input.moves the line in any notation, the solver's move first and last.
 * An illegal move is the issue 'illegal' at its ply (a ply is the index in moves) and ends the check. Otherwise each solver
 * ply may raise 'not-winning', 'alternative' or 'longer-mate' and each opponent ply 'weak-reply'; moves holds the better
 * move(s) in UCI. valid is true without issues other than 'longer-mate'.
 * themes are the motif keys of the solver's side along the line, with 'mate' and 'mateIn{N}' when the line ends in checkmate.
 * difficulty = {depth, candidates, quiet, rating} (see difficulty.js) for a valid puzzle, null for one that is not (a
 * rating of a broken puzzle would be a number nobody should show). options.nodes bounds every search (default 500000).
 * @param {{fen: string, moves: string[]}} input
 * @param {{nodes?: number}} [options]
 */
export function verifyPuzzle(input, options = {}) {
    try {
        if (!input || typeof input !== 'object') return invalid('input', msg('puzzles.verify.input'));
        const { fen, moves } = input;
        const nodes = nodesOf(options?.nodes);
        const start = Position.fromFen(fen);
        if (!Array.isArray(moves) || moves.length === 0 || moves.some((m) => typeof m !== 'string')) return invalid('moves', msg('puzzles.verify.moves'));
        if (moves.length > MAX_PLIES) return invalid('limit', msg('puzzles.verify.long', { max: MAX_PLIES }));
        if (moves.length % 2 === 0) return invalid('moves', msg('puzzles.verify.even', { count: moves.length }));

        // read the line: the position before each ply and the encoded moves
        const before = [];
        const encoded = [];
        const walk = start.clone();
        for (let i = 0; i < moves.length; i++) {
            let m = NO_MOVE;
            try {
                m = parseMove(walk, moves[i]);
            } catch {
                m = NO_MOVE; // unreadable or ambiguous: as good as illegal here
            }
            if (m === NO_MOVE) return { ok: true, kind: 'puzzle', valid: false, issues: [{ ply: i, code: 'illegal' }], themes: [], difficulty: null };
            before.push(walk.clone());
            encoded.push(m);
            walk.make(m);
        }
        const mateMode = isMated(walk);

        const issues = [];
        let iterations = [];
        for (let i = 0; i < encoded.length; i++) {
            const found =
                i % 2 === 0
                    ? judgeSolver(before[i], encoded[i], nodes, { mateLeft: mateMode ? (encoded.length - i + 1) / 2 : 0, iterations: i === 0 })
                    : { issues: judgeReply(before[i], encoded[i], nodes) };
            if (i === 0) iterations = found.iterations;
            for (const it of found.issues) issues.push(it.moves ? { ply: i, code: it.code, moves: it.moves } : { ply: i, code: it.code });
        }
        const valid = issues.every((i) => i.code === 'longer-mate');
        return {
            ok: true,
            kind: 'puzzle',
            valid,
            issues,
            themes: themesOf(start, encoded, mateMode),
            difficulty: valid ? difficultyOf(start, encoded, iterations, legalMoves(start)) : null,
        };
    } catch (e) {
        return failure(e, msg('puzzles.verify.internal'));
    }
}
