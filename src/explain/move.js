// explain/move — explainMove: a move judged by searches before and after it and by the trace, its class, motifs, the terms it changes, the refutation and the better move, as steps; and the helpers the review and the hints share.
//
// Everything said comes from what was computed: the engine's move from the search before the move, the win chances
// from the searches after the move and after the engine's move, the terms from the evaluation trace before the move
// and at the quiet end of the forced replies, the motifs from detectMotifs on the lines the searches found. No
// sentence is said that the numbers do not carry.
import { msg, joined, eachLanguage } from '../i18n/index.js';
import { WHITE, NO_MOVE, F_CAPTURE, legalMoves, moveToUci, moveTo, movePromo, moveFlags, toSan, sqName } from '../core/index.js';
import { trace, winChance, termName, termAbout } from '../eval/index.js';
import { probe as tablebaseProbe } from '../endgame/index.js';
import { Searcher, MATE } from '../search/index.js';
import { detectMotifs } from './detect.js';
import { motifName, motifSay } from './motifs/registry.js';
import { classify, CLASS_GLYPHS, CLASS_THRESHOLDS, EXPLAIN_LEVELS } from './classify.js';
import { mergeAnnotations, moveArrow, badgeOn, squaresOf, motifAnnotations } from './annotations.js';

/** The node budget of a search of explainMove and hint given none. */
export const EXPLAIN_NODES = 300000;

/**
 * The largest node budget a search of explainMove and hint takes: a bigger one is brought down to it (an explanation
 * makes up to four searches of this size, about a minute at the most on a laptop).
 */
export const EXPLAIN_MAX_NODES = 5000000;

/** A node budget for explainMove and hint: a number from 1 up to EXPLAIN_MAX_NODES, else EXPLAIN_NODES. */
export const explainNodes = (v) => (typeof v === 'number' && v >= 1 && Number.isFinite(v) ? Math.min(EXPLAIN_MAX_NODES, Math.floor(v)) : EXPLAIN_NODES);

/** The most alternatives explainMove reports: the engine's move and the best others. */
const ALTERNATIVES = 3;

// ---------------------------------------------------------------- words

const LETTERS = ['', 'p', 'n', 'b', 'r', 'q', 'k'];

/** The name of a piece (a piece code) as a message, in the nominative: "knight"; an empty string for none. */
export const pieceWord = (code) => (Number.isInteger(code) && code & 7 ? msg(`explain.piece.${LETTERS[code & 7]}`) : '');

/** A move (legal in pos) in the SAN of every language, computed now (one value per language, e.g. 'Nf3' in English). */
export const sanWords = (pos, m) => eachLanguage((lang) => toSan(pos, m, { lang }));

/** A share 0..1 as whole percent. */
export const percent = (x) => Math.round(x * 100);

/** Centipawns as signed pawns with one decimal in every language's own digits: +0.6, −1,2. */
export const pawns = (cp, { sign = true } = {}) =>
    eachLanguage((lang) =>
        new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: sign ? 'exceptZero' : 'never' }).format(cp / 100),
    );

/** A number with one decimal in every language's own digits: 95.8, 95,8. */
export const decimal = (x) => eachLanguage((lang) => new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(x));

/** The move number of the move played from pos, with its dots: '12.' for White, '12...' for Black. */
const moveLabel = (pos) => `${pos.fullmove}${pos.side === WHITE ? '.' : '...'}`;
export { moveLabel };

/** The English SAN of a line from pos, its first `max` plies (cut at its first move that does not fit). */
export function lineSans(pos, moves, max = EXPLAIN_LEVELS.linePlies) {
    const p = pos.clone();
    const out = [];
    for (const m of (moves ?? []).slice(0, max)) {
        if (!legalMoves(p).includes(m)) break;
        out.push(toSan(p, m));
        p.make(m);
    }
    return out;
}

/** The first `max` plies of a line from pos with their move numbers, in the SAN of every language: '12. Nc7+ Kd7 13. Nxa8'. */
export function lineWords(pos, moves, max = EXPLAIN_LEVELS.linePlies) {
    return eachLanguage((lang) => {
        const p = pos.clone();
        const parts = [];
        for (const m of (moves ?? []).slice(0, max)) {
            if (!legalMoves(p).includes(m)) break;
            if (p.side === WHITE || !parts.length) parts.push(`${moveLabel(p)}${p.side === WHITE ? ' ' : ''}${toSan(p, m, { lang })}`);
            else parts.push(toSan(p, m, { lang }));
            p.make(m);
        }
        return parts.join(' ');
    });
}

/** The words of a motif's sentence: the piece that carries it, its square, its targets. */
export function motifWords(m) {
    const p = m.params ?? {};
    const sq = Number.isInteger(p.square) && (p.square & 0x88) === 0 ? sqName(p.square) : '';
    const targets = Array.isArray(p.targets) ? p.targets.map(pieceWord).filter(Boolean) : [];
    return { piece: pieceWord(p.piece), square: sq, targets: targets.length ? targets : '' };
}

/** What the motif says about the move, in a sentence. */
export const motifSentence = (m) => motifSay(m.key, motifWords(m));

/** The motifs of ply 0 played by the side, one per key, mates first, then tactics, then positional ones. */
export function ownMotifs(motifs, side, ply = 0) {
    const order = { mate: 0, tactic: 1, positional: 2 };
    const seen = new Set();
    return motifs
        .filter((m) => m.ply === ply && m.side === side)
        .filter((m) => (seen.has(m.key) ? false : seen.add(m.key)))
        .sort((a, b) => order[a.kind] - order[b.kind]);
}

// ---------------------------------------------------------------- positions and searches

/**
 * Where a position stands by the rules, its history counted: 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' |
 * 'fifty', or null while the game goes on. A threefold repetition or fifty moves can be claimed by either player, so
 * they are worth a draw.
 */
export function standing(pos) {
    if (legalMoves(pos).length === 0) return pos.inCheck() ? 'checkmate' : 'stalemate';
    if (pos.isInsufficientMaterial()) return 'insufficient';
    if (pos.repetitionCount() >= 3) return 'threefold';
    if (pos.halfmove >= 100) return 'fifty';
    return null;
}

/** The search of a zugzwang check (detectMotifs asks it about a position and its pass), on a small budget. */
export function zugzwangSearch(searcher, nodes, probe) {
    const cap = Math.max(500, Math.min(EXPLAIN_LEVELS.zugzwangNodes, Math.floor(nodes / 10)));
    return (p, { depth }) => ({ score: searcher.search(p, { depth, nodes: cap, probe }).score });
}

/**
 * A position judged for the side to move: {state, win, score, mate, best, lines}. A mated side has win 0 and mate 0, a
 * drawn position (stalemate, dead material) win 0.5 and no lines; a claimable draw is searched (the game may go on) but
 * worth 0.5. The search gets a copy of pos with its history, so repetitions count from the real game.
 */
export function judge(searcher, pos, { nodes, multipv = 1, probe, movetime }) {
    const state = standing(pos);
    if (state === 'checkmate') return { state, win: 0, score: 0, mate: 0, best: NO_MOVE, lines: [] };
    if (state === 'stalemate' || state === 'insufficient') return { state, win: 0.5, score: 0, mate: null, best: NO_MOVE, lines: [] };
    const res = searcher.search(pos.clone(), limitsOf({ nodes, multipv, probe, movetime }));
    const lines = res.lines.length ? res.lines : [{ move: res.best, score: res.score, mate: res.mate, pv: res.pv }];
    const top = lines[0];
    const drawn = state !== null;
    return { state, win: drawn ? 0.5 : winChance(top.score), score: top.score, mate: drawn ? null : top.mate, best: top.move, lines };
}

/** The limits of one search: the node budget, the lines, the tables, and a time limit when one is given. */
export function limitsOf({ nodes, multipv = 1, probe, movetime }) {
    const limits = { nodes, multipv, probe };
    if (typeof movetime === 'number' && movetime >= 1) limits.movetime = movetime;
    return limits;
}

const round4 = (x) => Math.round(x * 10000) / 10000;

/** Is the move a capture or a promotion? */
const forcing = (m) => (moveFlags(m) & F_CAPTURE) !== 0 || movePromo(m) !== 0;

/**
 * The quiet end of a move: the position after it and the replies of the line that are captures, promotions or answers
 * to a check, so that an exchange under way is counted whole.
 */
export function quietEnd(pos, move, line) {
    const p = pos.clone();
    p.make(move);
    for (const m of line ?? []) {
        if (!(forcing(m) || p.inCheck())) break;
        if (!legalMoves(p).includes(m)) break;
        p.make(m);
    }
    return p;
}

/**
 * The terms of the evaluation the move changes most, for the mover: [{key, delta}] (centipawns, positive when the
 * term turns in the mover's favour), the largest first, from the trace before the move and at its quiet end. With
 * them the trace after, whose squares the steps mark.
 */
export function termDeltas(pos, move, line) {
    const end = quietEnd(pos, move, line);
    const before = trace(pos);
    const after = trace(end);
    const sign = pos.side === WHITE ? 1 : -1;
    const values = new Map();
    for (const t of before.terms) values.set(t.key, -t.value);
    for (const t of after.terms) values.set(t.key, (values.get(t.key) ?? 0) + t.value);
    // a pawn that promotes is not a passed pawn any more: what it was worth as one is part of the piece it becomes,
    // so on a promotion a fall of the passed-pawn term is counted in the material, never as a price of the move
    if (movePromo(move) !== 0 && sign * (values.get('passed-pawn') ?? 0) < 0) {
        values.set('material', (values.get('material') ?? 0) + values.get('passed-pawn'));
        values.delete('passed-pawn');
    }
    const terms = [...values]
        .map(([key, v]) => ({ key, delta: Math.round(sign * v) }))
        .filter((t) => Math.abs(t.delta) >= EXPLAIN_LEVELS.termMin)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || (a.key < b.key ? -1 : 1))
        .slice(0, EXPLAIN_LEVELS.terms);
    // a change too small beside the largest one says nothing next to it
    const largest = terms.length ? Math.abs(terms[0].delta) : 0;
    const kept = terms.filter((t) => Math.abs(t.delta) >= largest * EXPLAIN_LEVELS.termShare);
    return { terms: kept, after };
}

/**
 * The step of a term: its name and change, what the change means for the mover, what the term is. A change against
 * the verdict on the move is said as such: for a sound move (bad false) a term that falls is the price it pays, for a
 * move that gives chances away (bad true) a term that rises is what it gets in return.
 */
export function termStep(t, after, bad = false) {
    const name = termName(t.key);
    const squares = after.terms.find((x) => x.key === t.key)?.squares ?? [];
    const up = t.delta > 0;
    const key = up ? (bad ? 'explain.term.gain' : 'explain.term.up') : bad ? 'explain.term.down' : 'explain.term.price';
    return {
        title: msg('explain.term.title', { name, delta: pawns(t.delta) }),
        text: joined([msg(key, { delta: pawns(Math.abs(t.delta), { sign: false }) }), termAbout(t.key)]),
        annotations: squaresOf(squares, t.delta > 0 ? 'idea' : 'bad'),
        rule: 'term',
        data: { key: t.key, delta: t.delta },
    };
}

/** The step of a motif: its name, its sentence and its proof on the board. */
export function motifStep(m, kind) {
    return {
        title: motifName(m.key),
        text: motifSentence(m),
        annotations: motifAnnotations(m, { kind }),
        rule: 'motif',
        data: { key: m.key, kind: m.kind, ply: m.ply, side: m.side === WHITE ? 'white' : 'black' },
    };
}

// ---------------------------------------------------------------- explainMove

/**
 * @typedef {import('./detect.js').Motif} Motif
 * @typedef {import('./annotations.js').Annotations} Annotations
 * @typedef {{title: import('../i18n/index.js').Msg, text?: import('../i18n/index.js').Msg, line?: string[], annotations?: Annotations,
 *   rule: 'class' | 'motif' | 'term' | 'refutation' | 'best' | 'answer', data?: object, final?: true}} Step
 * @typedef {{uci: string, san: string, score: number, scoreWhite: number, mate?: number}} Alternative
 * @typedef {{ok: true, kind: 'move', move: {uci: string, san: string}, class: string, winBefore: number, winAfter: number,
 *   loss: number, best: {uci: string, san: string, line: string[], motifs: Motif[]} | null, alternatives: Alternative[], motifs: Motif[],
 *   terms: {key: string, delta: number}[], refutation: {line: string[], motifs: Motif[]} | null, steps: Step[],
 *   annotations: Annotations}} MoveExplanation
 */

/**
 * The explanation of a move: pos is the position before it (with its history; left as it was), move an encoded legal
 * move, and the position is not over. winBefore and winAfter are the mover's chances (0..1) with the best move and
 * with this one, loss the drop between them. alternatives are at most ALTERNATIVES lines of the position before the
 * move, from one more search of it with multi-PV ALTERNATIVES (the same node budget, run after everything else so the
 * explanation is computed as it is without it): the engine's move first, with its score from that search when the
 * search lists it (from the search before the move when it does not; and when the engine's move forces a mate, the
 * mate the steps say, so that its length is the same everywhere), then the best others, each score at most the first one's (a
 * later line scored above the engine's move is clamped to its score, and to its mate). Each has its score for the
 * mover and for White, and the signed number of moves to mate when the line mates.
 *
 * A move that mates, lets a mate go or allows one is not weighed by the evaluation: its terms are empty and it has no
 * term steps, since the mate decides it; nor is a move into a position the tables know. The refutation step is titled a
 * refutation only for a mistake or a blunder (a loss of 10% or more); otherwise, an inaccuracy too, it is the
 * opponent's best answer, and for a mate let go it is about that mate.
 * @param {import('../core/index.js').Position} pos
 * @param {number} move
 * @param {{nodes?: number, movetime?: number, searcher?: Searcher, probe?: Function}} [opts] nodes is brought down to
 *   EXPLAIN_MAX_NODES; movetime (ms) bounds each search as well
 * @returns {MoveExplanation}
 */
export function explainMove(pos, move, { nodes: given = EXPLAIN_NODES, movetime, searcher, probe = tablebaseProbe } = {}) {
    const nodes = explainNodes(given);
    const s = searcher ?? new Searcher();
    const mover = pos.side;
    const zz = zugzwangSearch(s, nodes, probe);

    const before = judge(s, pos, { nodes, multipv: 1, probe, movetime });
    const after = pos.clone();
    after.make(move);
    const reply = judge(s, after, { nodes, multipv: 1, probe, movetime });
    const isBest = before.best === move;
    // the best move is measured the way the move played is, by a search of the position after it, so the two chances
    // compare like with like; a move the deeper search finds better than the best one loses nothing
    let bestReply = reply;
    if (!isBest && before.best !== NO_MOVE) {
        const alt = pos.clone();
        alt.make(before.best);
        bestReply = judge(s, alt, { nodes, multipv: 1, probe, movetime });
    }

    const winAfter = round4(1 - reply.win);
    const winBefore = round4(Math.max(1 - bestReply.win, winAfter));
    const loss = round4(Math.max(0, winBefore - winAfter));
    const checkmate = reply.state === 'checkmate';
    const drawn = reply.state !== null && !checkmate;
    // a position after the move that the tables call drawn is a draw, whatever chance a search score would give it
    const exact = reply.state === null && typeof probe === 'function' ? probe(after) : null;
    const tableDraw = exact !== null && exact !== undefined && exact.wdl === 0;
    // mates: the mate the engine's move forces (in moves of the mover, the move counted) is the one the search before
    // the move sees, as hint and the alternatives say it, or else the one the search after the best move sees; the mate
    // this move forces is the same for the engine's move, else the one the search after it sees; the mate the opponent
    // has is judged on the two searches after the moves
    const seen = before.mate !== null && before.mate > 0 ? before.mate : null;
    const bestMates = seen ?? matesAfter(bestReply);
    const moveMates = isBest ? bestMates : matesAfter(reply);
    const missedMate = bestMates !== null && moveMates === null;
    const allowedMate = reply.mate !== null && reply.mate > 0 && !(bestReply.mate !== null && bestReply.mate > 0);
    const cls = classify(loss, { isBest, missedMate, allowedMate });
    const bad = CLASSES_REFUTED.includes(cls);
    // a move of the class 'best' that is not the engine's own choice is as good as it, not the best
    const equal = cls === 'best' && !isBest;
    // a mate decides the move, and so does a game that ends or a position the tables know: the evaluation has nothing to add
    const tabled = exact !== null && exact !== undefined;
    const decided = checkmate || drawn || tabled || moveMates !== null || missedMate || allowedMate;

    const san = toSan(pos, move);
    const words = sanWords(pos, move);
    const replyPv = reply.lines[0]?.pv ?? [];
    const motifs = detectMotifs(pos, move, replyPv, { search: zz });

    const top = before.lines[0];
    let best = null;
    let bestPv = [];
    if (top && top.move !== NO_MOVE) {
        bestPv = top.pv[0] === top.move ? top.pv : [top.move];
        best = {
            uci: moveToUci(top.move),
            san: toSan(pos, top.move),
            line: lineSans(pos, bestPv),
            motifs: isBest ? motifs : detectMotifs(pos, top.move, bestPv.slice(1), { search: zz }),
        };
    }
    const refutation =
        bad && replyPv.length ? { line: lineSans(after, replyPv), motifs: detectMotifs(after, replyPv[0], replyPv.slice(1), { search: zz }) } : null;
    const { terms, after: traceAfter } = decided ? { terms: [], after: null } : termDeltas(pos, move, replyPv);

    // the steps
    const steps = [];
    const glyph = checkmate ? '#' : CLASS_GLYPHS[cls];
    const moveMark = mergeAnnotations(moveArrow(move, bad ? 'bad' : 'best'), badgeOn(moveTo(move), glyph));
    const chances = [];
    if (checkmate) chances.push(msg('explain.move.mates'));
    else if (drawn) chances.push(msg(`explain.move.draw.${reply.state}`));
    else if (tableDraw) {
        if (loss >= CLASS_THRESHOLDS.best) {
            chances.push(msg('explain.move.table-draw.lost', { before: percent(winBefore) }));
            chances.push(msg('explain.move.loss', { loss: percent(loss) }));
        } else chances.push(msg('explain.move.table-draw.kept'));
    } else {
        if (loss >= CLASS_THRESHOLDS.best) {
            chances.push(msg('explain.move.chances', { before: percent(winBefore), after: percent(winAfter) }));
            chances.push(msg('explain.move.loss', { loss: percent(loss) }));
        } else chances.push(msg('explain.move.kept', { win: percent(winAfter) }));
        if (moveMates !== null) chances.push(msg('explain.move.forced-mate', { n: moveMates }));
    }
    if (missedMate && best) chances.push(msg('explain.move.missed-mate', { n: bestMates, san: sanWords(pos, top.move) }));
    if (allowedMate) chances.push(msg('explain.move.allows-mate', { n: reply.mate }));
    steps.push({
        title: msg(`explain.move.class.${equal ? 'equal' : cls}`, { san: words }),
        text: joined(chances),
        annotations: moveMark,
        rule: 'class',
        data: { class: cls, winBefore, winAfter, loss, checkmate, missedMate, allowedMate },
    });

    for (const m of ownMotifs(motifs, mover).slice(0, EXPLAIN_LEVELS.motifs)) steps.push(motifStep(m));
    for (const t of terms) steps.push(termStep(t, traceAfter, bad));

    if (refutation) {
        const theirs = ownMotifs(refutation.motifs, mover ^ 1).slice(0, 2);
        // the reply refutes the move when the move is a mistake or a blunder (a loss of 10% or more); a mate let go is
        // the point of its own step; anything else, an inaccuracy too, is the best answer
        const refutes = !missedMate && (cls === 'mistake' || cls === 'blunder');
        const title = missedMate
            ? msg('explain.move.refutation.missed', { n: bestMates })
            : msg(refutes ? 'explain.move.refutation.title' : 'explain.move.refutation.answer', { san: sanWords(after, replyPv[0]) });
        const lead = missedMate ? [msg('explain.move.refutation.gone')] : [];
        steps.push({
            title,
            text: joined([...lead, msg('explain.move.refutation.text', { line: lineWords(after, replyPv) }), ...theirs.map(motifSentence)]),
            line: refutation.line,
            annotations: mergeAnnotations(moveArrow(replyPv[0], 'threat'), ...theirs.map((m) => motifAnnotations(m, { kind: 'threat' }))),
            rule: 'refutation',
            data: { moves: replyPv.map(moveToUci), refutes },
        });
    }

    // the engine's own move: "better" only when the move played gives something away (from an inaccuracy on), the
    // engine's choice for a good move, nothing for a move as good as it
    const showBest = best && !isBest && !equal;
    if (showBest) {
        const own = ownMotifs(best.motifs, mover).slice(0, 2);
        const lead =
            bestMates !== null
                ? msg('explain.move.best.mate', { n: bestMates, line: lineWords(pos, bestPv) })
                : msg('explain.move.best.text', { win: percent(winBefore), line: lineWords(pos, bestPv) });
        steps.push({
            title: msg(bad ? 'explain.move.best.title' : 'explain.move.best.choice', { san: sanWords(pos, top.move) }),
            text: joined([lead, ...own.map(motifSentence)]),
            line: best.line,
            annotations: mergeAnnotations(moveArrow(top.move, 'best'), ...own.map((m) => motifAnnotations(m))),
            rule: 'best',
            data: { uci: best.uci, san: best.san, win: winBefore },
        });
    }

    const annotations = mergeAnnotations(moveMark, showBest ? moveArrow(top.move, 'best') : null, refutation ? moveArrow(replyPv[0], 'threat') : null);
    const answerKey = checkmate ? 'checkmate' : equal && best ? 'equal' : cls;
    steps.push({
        title: msg(`explain.move.answer.${answerKey}`, { san: words, best: best ? sanWords(pos, top.move) : '' }),
        text: checkmate || drawn || loss < CLASS_THRESHOLDS.best ? undefined : msg('explain.move.summary', { loss: percent(loss) }),
        annotations,
        rule: 'answer',
        data: { class: cls, checkmate },
        final: true,
    });
    for (const st of steps) if (st.text === undefined) delete st.text;

    // the alternatives: one multi-PV search of the position before the move, made last so that nothing above depends
    // on it; the engine's move first, the others never above it
    const alternatives = [];
    if (top && top.move !== NO_MOVE) {
        const wide = s.search(pos.clone(), limitsOf({ nodes, multipv: ALTERNATIVES, probe, movetime }));
        const listed = wide.lines.find((l) => l.move === top.move);
        // a mate the engine's move forces is the one the steps say (a mate in n moves is mate at ply 2n - 1)
        const own = bestMates !== null ? { ...top, score: MATE - (2 * bestMates - 1), mate: bestMates } : (listed ?? top);
        const first = alternativeOf(pos, own, mover);
        alternatives.push(first);
        for (const l of wide.lines) {
            if (alternatives.length >= ALTERNATIVES) break;
            if (l.move === top.move || l.move === NO_MOVE) continue;
            alternatives.push(alternativeOf(pos, l.score > first.score ? { ...l, score: first.score, mate: first.mate ?? null } : l, mover));
        }
    }

    return {
        ok: true,
        kind: 'move',
        move: { uci: moveToUci(move), san },
        class: cls,
        winBefore,
        winAfter,
        loss,
        best,
        alternatives,
        motifs,
        terms,
        refutation,
        steps,
        annotations,
    };
}

// a line of the position before the move as an alternative: the move, its score for the mover and for White, its mate
function alternativeOf(pos, line, mover) {
    const alt = { uci: moveToUci(line.move), san: toSan(pos, line.move), score: line.score, scoreWhite: mover === WHITE ? line.score : -line.score };
    if (line.mate !== null && line.mate !== undefined) alt.mate = line.mate;
    return alt;
}

/**
 * The mate a move forces, from the judgement of the position after it (the opponent to move): its length in moves of
 * the mover with the move itself counted (1 for a move that mates), or null when it forces none.
 */
export function matesAfter(judged) {
    if (judged.state === 'checkmate') return 1;
    return judged.mate !== null && judged.mate < 0 ? 1 - judged.mate : null;
}

// the classes that get a refutation and a better move
const CLASSES_REFUTED = ['inaccuracy', 'mistake', 'blunder'];
