// explain/review — reviewGame: every move of a game classed by one search per position on the game's real history, the accuracy of both sides, key moments, missed wins, the opening and the stages.
//
// Each position of the main line is searched once, in game order, on the game's own Position (so a repetition counts
// from the moves really played, Review Focus #5): the search of position i gives the best move of ply i + 1 and, seen
// from the other side, the value of the move that led to it. A claimable draw (threefold, fifty moves) is worth a
// draw. The searcher's table is kept from position to position, so a review is a function of the PGN and the budget.
import { msg, joined } from '../i18n/index.js';
import { ChessError, Game, Position, WHITE, parsePgn, moveToUci, moveTo, toSan } from '../core/index.js';
import { trace } from '../eval/index.js';
import { probe as tablebaseProbe, bookMoves, openingName } from '../endgame/index.js';
import { Searcher } from '../search/index.js';
import { detectMotifs } from './detect.js';
import { classify, moveAccuracy, CLASS_THRESHOLDS, CLASS_GLYPHS, EXPLAIN_LEVELS } from './classify.js';
import { mergeAnnotations, moveArrow, badgeOn } from './annotations.js';
import { judge, zugzwangSearch, ownMotifs, sanWords, percent, moveLabel, decimal } from './move.js';

/** The longest game reviewGame takes, in plies (half-moves): a longer one is the invalid code 'limit'. */
export const REVIEW_MAX_PLIES = 600;

const round1 = (x) => Math.round(x * 10) / 10;
const round4 = (x) => Math.round(x * 10000) / 10000;
const mean = (xs) => (xs.length ? round1(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
// a number for a sentence, or a dash when there is none
const shown = (x) => (x === null ? '—' : decimal(x));

/**
 * @typedef {{ply: number, uci: string, san: string, class: string, loss: number, win: number, best: {uci: string, san: string} | null,
 *   motifs: string[]}} ReviewedMove
 * @typedef {{white: number | null, black: number | null, from: number, to: number}} Stage
 */

/**
 * The review of a game (PGN text; its main line). Throws ChessError('pgn') for text that is not a game, or a game
 * without moves, and ChessError('limit') for a game longer than REVIEW_MAX_PLIES plies. onProgress({done, total}) is
 * called once per move reviewed, done counting up to total.
 * moves[i].win is White's chance after the move, loss the mover's loss; accuracy and the stages are means of the
 * accuracy of each move (null for a side with no move there); keyMoments and missedWins are plies. The key moments
 * are the largest drops of the mover's chances, and every blunder that lets a mate go or allows one, however small
 * its drop (a mate the learner must be able to find).
 * @param {string} text
 * @param {{nodesPerMove?: number, onProgress?: (p: {done: number, total: number}) => void, searcher?: Searcher, probe?: Function}} [opts]
 */
export function reviewGame(text, { nodesPerMove = 150000, onProgress, searcher, probe = tablebaseProbe } = {}) {
    const tree = parsePgn(text);
    const played = [];
    for (let n = tree.root.children[0]; n; n = n.children[0]) played.push(n.move);
    if (!played.length) throw new ChessError('pgn', { reason: 'empty' }, msg('explain.review.empty'));
    if (played.length > REVIEW_MAX_PLIES)
        throw new ChessError('limit', { reason: 'plies', max: REVIEW_MAX_PLIES }, msg('explain.review.long', { max: REVIEW_MAX_PLIES }));
    const s = searcher ?? new Searcher();
    const nodes = nodesPerMove;
    const zz = zugzwangSearch(s, nodes, probe);
    const game = new Game(tree.headers.FEN);
    const total = played.length;

    const moves = [];
    const facts = []; // per ply: what the steps need besides the move record
    let here = judge(s, game.position, { nodes, probe });
    let inBook = true;
    let lastBook = 0;
    let endgameFrom = 0;
    for (let i = 0; i < total; i++) {
        const pos = game.position.clone();
        const m = played[i];
        const mover = pos.side;
        if (inBook && bookMoves(pos).some((b) => b.move === m)) lastBook = i + 1;
        else inBook = false;
        const san = toSan(pos, m);
        game.play(m);
        const next = judge(s, game.position, { nodes, probe });

        const winBefore = here.win;
        const winAfter = 1 - next.win;
        const isBest = here.best === m;
        // the engine's own move loses nothing: a drop across it is the next search seeing deeper, not a fault of the move
        const loss = isBest ? 0 : round4(Math.max(0, winBefore - winAfter));
        const keepsMate = next.state === 'checkmate' || (next.mate !== null && next.mate < 0);
        const missedMate = here.mate !== null && here.mate > 0 && !keepsMate;
        const allowedMate = next.mate !== null && next.mate > 0 && !(here.mate !== null && here.mate < 0);
        const cls = classify(loss, { isBest, missedMate, allowedMate });
        const replyPv = next.lines[0]?.pv ?? [];
        const keys = ownMotifs(detectMotifs(pos, m, replyPv, { search: zz }), mover).map((x) => x.key);
        const whiteBefore = mover === WHITE ? winBefore : 1 - winBefore;
        const win = round4(mover === WHITE ? winAfter : 1 - winAfter);
        const best = here.best ? { uci: moveToUci(here.best), san: toSan(pos, here.best) } : null;
        moves.push({ ply: i + 1, uci: moveToUci(m), san, class: cls, loss, win, best, motifs: keys });
        facts.push({
            mover,
            label: moveLabel(pos),
            words: sanWords(pos, m),
            // the engine's move is named only for a move that gave something away
            bestWords: here.best && ERRORS.includes(cls) ? sanWords(pos, here.best) : null,
            move: m,
            bestMove: here.best,
            whiteBefore,
            mateBlunder: cls === 'blunder' && (missedMate || allowedMate),
            // the mate a blunder lets go (in moves, as the search before it sees it) or allows (as the search after it does)
            missedMateIn: cls === 'blunder' && missedMate ? here.mate : null,
            allowedMateIn: cls === 'blunder' && allowedMate ? next.mate : null,
            missedWin: winBefore >= EXPLAIN_LEVELS.winning && winAfter < EXPLAIN_LEVELS.winning && loss >= CLASS_THRESHOLDS.inaccuracy,
        });
        // the endgame boundary: the move that brings the phase down to endgamePhase (a capture, as a rule) is the first
        // move of the endgame, because the position it leaves is the first endgame position; it is never left again
        if (!endgameFrom && trace(game.position).phase <= EXPLAIN_LEVELS.endgamePhase) endgameFrom = i + 1;
        here = next;
        if (typeof onProgress === 'function') {
            try {
                onProgress({ done: i + 1, total });
            } catch {
                // a callback that fails does not stop the review
            }
        }
    }

    const sideOf = (i) => (facts[i].mover === WHITE ? 'white' : 'black');
    const accuracyOf = (from, to) => {
        const out = { white: [], black: [] };
        for (let i = from - 1; i < to; i++) out[sideOf(i)].push(moveAccuracy(moves[i].loss));
        return { white: mean(out.white), black: mean(out.black) };
    };
    const accuracy = accuracyOf(1, total);

    // key moments: the moves with the largest drop of the mover's own chances (a rise across a move is the search
    // noticing an earlier error, not a moment of this move), and every blunder about a mate, which the summary counts
    const swings = moves
        .map((m) => ({ ply: m.ply, drop: m.loss }))
        .filter((x) => x.drop >= EXPLAIN_LEVELS.swing)
        .sort((a, b) => b.drop - a.drop || a.ply - b.ply)
        .slice(0, EXPLAIN_LEVELS.moments)
        .map((x) => x.ply);
    const mates = facts.map((f, i) => (f.mateBlunder ? i + 1 : 0)).filter(Boolean);
    const keyMoments = [...new Set([...swings, ...mates])].sort((a, b) => a - b);
    const missedWins = facts.map((f, i) => (f.missedWin ? i + 1 : 0)).filter(Boolean);

    const named = openingName(text);
    const opening = named.ok && named.kind === 'opening' ? { eco: named.eco, name: named.name, ply: named.ply } : null;

    // the stages: the opening up to the last book ply (or a fixed ply off the book, but only for a game from the
    // initial position: a game from a set-up position has no opening without the book), the endgame from a low phase on
    const endStart = endgameFrom || total + 1;
    const fromStart = game.startFen === Position.START_FEN;
    const openingTo = Math.min(lastBook || (fromStart ? EXPLAIN_LEVELS.openingPlies : 0), total, endStart - 1);
    const stage = (from, to) => (from <= to ? { ...accuracyOf(from, to), from, to } : null);
    const phases = { opening: stage(1, openingTo), middlegame: stage(openingTo + 1, endStart - 1), endgame: stage(endStart, total) };

    const steps = reviewSteps({ moves, facts, accuracy, keyMoments, missedWins, opening, phases, lastBook });
    return { ok: true, kind: 'review', headers: { ...tree.headers }, moves, accuracy, keyMoments, missedWins, opening, phases, steps };
}

const ERRORS = ['inaccuracy', 'mistake', 'blunder'];

// the steps of a review: the accuracy, the stages, every key moment, and the verdict
function reviewSteps({ moves, facts, accuracy, keyMoments, missedWins, opening, phases, lastBook }) {
    const steps = [];
    const counts = { white: {}, black: {} };
    moves.forEach((m, i) => {
        const side = facts[i].mover === WHITE ? 'white' : 'black';
        counts[side][m.class] = (counts[side][m.class] ?? 0) + 1;
    });
    const countText = (c) => {
        const parts = ERRORS.filter((k) => c[k]).map((k) => msg(`explain.review.count.${k}`, { n: c[k] }));
        return parts.length ? joined(parts, ', ') : msg('explain.review.clean');
    };
    steps.push({
        title: msg('explain.review.accuracy', { white: shown(accuracy.white), black: shown(accuracy.black) }),
        text: msg('explain.review.counts', { white: countText(counts.white), black: countText(counts.black) }),
        rule: 'class',
        data: { accuracy, counts },
    });

    const stages = Object.entries(phases).filter(([, p]) => p);
    if (stages.length) {
        // a stage runs from its first move to its last, each with its number and dots: '1. d4', '5... Be7'
        const moveOf = (ply) => joined([facts[ply - 1].label, facts[ply - 1].words]);
        steps.push({
            title: msg('explain.review.stages'),
            text: joined(
                stages.map(([name, p]) =>
                    msg(`explain.review.stage.${name}`, { from: moveOf(p.from), to: moveOf(p.to), white: shown(p.white), black: shown(p.black) }),
                ),
            ),
            rule: 'class',
            data: { phases },
        });
    }

    for (const ply of keyMoments) {
        const m = moves[ply - 1];
        const f = facts[ply - 1];
        const parts = [msg('explain.review.swing', { before: percent(f.whiteBefore), after: percent(m.win) })];
        if (f.missedMateIn !== null && f.bestWords) parts.push(msg('explain.move.missed-mate', { n: f.missedMateIn, san: f.bestWords }));
        else if (f.bestWords) parts.push(msg('explain.review.better', { san: f.bestWords }));
        if (f.allowedMateIn !== null) parts.push(msg('explain.move.allows-mate', { n: f.allowedMateIn }));
        if (f.missedWin) parts.push(msg('explain.review.missed-win'));
        steps.push({
            title: msg('explain.review.moment', { move: f.label, san: f.words, name: msg(`explain.class.${m.class}`) }),
            text: joined(parts),
            annotations: mergeAnnotations(
                moveArrow(f.move, m.class === 'best' || m.class === 'good' ? 'best' : 'bad'),
                badgeOn(moveTo(f.move), CLASS_GLYPHS[m.class]),
                f.bestWords ? moveArrow(f.bestMove, 'best') : null,
            ),
            rule: 'best',
            data: { ply },
        });
    }

    const parts = [];
    if (opening) parts.push(msg('explain.review.opening', { name: opening.name, eco: opening.eco }));
    if (lastBook) parts.push(msg('explain.review.book', { move: facts[lastBook - 1].label, san: facts[lastBook - 1].words }));
    if (missedWins.length) parts.push(msg('explain.review.missed', { n: missedWins.length }));
    const a = accuracy.white === null ? null : Math.round(accuracy.white);
    const b = accuracy.black === null ? null : Math.round(accuracy.black);
    const who = a === null || b === null || a === b ? 'even' : a > b ? 'white' : 'black';
    steps.push({
        title: msg(`explain.review.verdict.${who}`, { white: shown(accuracy.white), black: shown(accuracy.black) }),
        ...(parts.length ? { text: joined(parts) } : {}),
        rule: 'answer',
        data: { accuracy },
        final: true,
    });
    return steps;
}
