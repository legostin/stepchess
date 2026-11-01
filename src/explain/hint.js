// explain/hint — hint: three steps towards the best move, from the search and its motifs: where to look, what to look for, the move.
//
//   step 1  the piece that makes the best move and the area of the board it goes to, never the move itself
//   step 2  what to look for: a forced mate, a mate the opponent threatens, the tactic of the move, material to win,
//           material the opponent threatens to win, the positional idea of the move, or the term it improves
//   step 3  the move, with the sentence of its motif (or what it changes), and the threat it meets, or the threat it
//           leaves when the move is stronger than a defence
//
// The opponent's threat is what the opponent would do if the side to move could pass: a search of the position with
// the turn passed (never in check, where every legal move already answers the check). A forced mate there is a mate
// threat; a line that wins material and leaves the side to move worse off by THREAT_CP than with its best move is a
// threat to win material. The threat is met when, after the best move, it is not the opponent's best answer and, a capture,
// no longer wins on the spot (a mate threat the best move did not meet would make the line a mate against the side to
// move, and is no threat then). A threat the best move leaves is no point of step 2: the move does better than defend.
// Without a threat, a tactic, material or an idea, the hint says the move is a quiet one.
import { msg, joined } from '../i18n/index.js';
import { NO_MOVE, F_CAPTURE, moveFrom, moveTo, moveFlags, moveToUci, toSan, sqName, see, legalMoves } from '../core/index.js';
import { termName } from '../eval/index.js';
import { probe as tablebaseProbe } from '../endgame/index.js';
import { Searcher } from '../search/index.js';
import { detectMotifs } from './detect.js';
import { motifName, motifAbout } from './motifs/registry.js';
import { mergeAnnotations, moveArrow, squaresOf, motifAnnotations } from './annotations.js';
import { EXPLAIN_NODES, explainNodes, judge, zugzwangSearch, ownMotifs, motifSentence, pieceWord, sanWords, termDeltas, pawns } from './move.js';

/** How much worse (in centipawns) passing must leave the side to move than its best move, for a material threat. */
export const THREAT_CP = 150;
/** How much material (in centipawns, at the quiet end of the threat) a threat must win. */
const THREAT_MATERIAL = 80;

const LETTERS = ['', 'p', 'n', 'b', 'r', 'q', 'k'];

// does the move give check?
function givesCheck(pos, m) {
    const p = pos.clone();
    p.make(m);
    return p.inCheck();
}

// the area of a square: the queenside (files a–c), the centre (d, e) or the kingside (f–h)
const areaOf = (sq) => ((sq & 7) <= 2 ? 'queenside' : (sq & 7) <= 4 ? 'centre' : 'kingside');

/**
 * The opponent's threat in pos (the side to move to defend), or null: {kind: 'mate', move, n, from} with n the moves to
 * mate, or {kind: 'material', move, piece, from} with piece the piece code the move wins outright (0 when it wins
 * material otherwise); from is the position with the turn passed, where the move is played.
 */
function threatOf(s, pos, found, { nodes, probe, movetime }) {
    if (pos.inCheck() || found.best === NO_MOVE) return null;
    const passed = pos.clone();
    passed.makeNull();
    const budget = Math.max(2000, Math.floor(nodes / 4));
    const theirs = judge(s, passed, { nodes: budget, multipv: 1, probe, movetime });
    if (theirs.best === NO_MOVE || theirs.state !== null) return null;
    const move = theirs.best;
    // a mate threat the best move cannot meet is no threat to look for a defence against
    if (theirs.mate !== null && theirs.mate > 0) return found.mate !== null && found.mate < 0 ? null : { kind: 'mate', move, n: theirs.mate, from: passed };
    if (theirs.score + found.score < THREAT_CP) return null;
    const pv = theirs.lines[0]?.pv ?? [move];
    const won = termDeltas(passed, move, pv[0] === move ? pv.slice(1) : []).terms.find((t) => t.key === 'material');
    if (!won || won.delta < THREAT_MATERIAL) return null;
    const capture = (moveFlags(move) & F_CAPTURE) !== 0 && see(passed, move) > 0;
    return { kind: 'material', move, piece: capture ? passed.board[moveTo(move)] & 7 || 1 : 0, from: passed };
}

/**
 * Does the best move meet the threat? After it, the threat must not be the opponent's best answer (the next move of
 * the line, or of a search of the position after the move when the line stops there), and a capture must no longer win
 * on the spot. A mate threat is met whenever it is reported: threatOf leaves out one the line does not escape.
 */
function meets(s, pos, move, pv, threat, { nodes, probe, movetime }) {
    if (threat.kind === 'mate') return true;
    const after = pos.clone();
    after.make(move);
    const uci = moveToUci(threat.move);
    let reply = pv[0] === move && pv.length > 1 ? pv[1] : NO_MOVE;
    if (reply === NO_MOVE) {
        const theirs = judge(s, after, { nodes: Math.max(2000, Math.floor(nodes / 4)), multipv: 1, probe, movetime });
        reply = theirs.best;
    }
    if (reply !== NO_MOVE && moveToUci(reply) === uci) return false;
    const same = legalMoves(after).find((m) => moveToUci(m) === uci);
    return !(same !== undefined && (moveFlags(same) & F_CAPTURE) !== 0 && see(after, same) > 0);
}

// the sentence of a threat (step 2)
function threatText(t) {
    const san = sanWords(t.from, t.move);
    if (t.kind === 'mate') return t.n === 1 ? msg('explain.hint.threat.mate-in-one', { san }) : msg('explain.hint.threat.mate', { n: t.n, san });
    if (t.piece) return msg('explain.hint.threat.piece', { san, piece: msg(`explain.motif.word.acc.${LETTERS[t.piece]}`) });
    return msg('explain.hint.threat.material', { san });
}

/**
 * A hint for the side to move: pos is not over (left as it was), step 1, 2 or 3.
 * @param {import('../core/index.js').Position} pos
 * @param {1 | 2 | 3} step
 * @param {{nodes?: number, movetime?: number, searcher?: Searcher, probe?: Function}} [opts] nodes is brought down to
 *   EXPLAIN_MAX_NODES; movetime (ms) bounds each search as well
 * @returns {{ok: true, kind: 'hint', step: number, text: import('../i18n/index.js').Msg, annotations: import('./annotations.js').Annotations, move?: {uci: string, san: string}}}
 */
export function hint(pos, step, { nodes: given = EXPLAIN_NODES, movetime, searcher, probe = tablebaseProbe } = {}) {
    const nodes = explainNodes(given);
    const s = searcher ?? new Searcher();
    const found = judge(s, pos, { nodes, multipv: 1, probe, movetime });
    const move = found.best;
    const line = found.lines[0]?.pv ?? [move];
    const pv = line[0] === move ? line : [move];
    const from = moveFrom(move);
    const to = moveTo(move);
    const piece = pos.board[from];
    const where = squaresOf([from], 'idea');

    if (step === 1) {
        const text = msg('explain.hint.where', { piece: pieceWord(piece), square: sqName(from), area: msg(`explain.area.${areaOf(to)}`) });
        return { ok: true, kind: 'hint', step, text, annotations: where };
    }

    const lead = ownMotifs(detectMotifs(pos, move, pv.slice(1), { search: zugzwangSearch(s, nodes, probe) }), pos.side)[0] ?? null;
    const mate = found.mate !== null && found.mate > 0 ? found.mate : null;
    const { terms } = termDeltas(pos, move, pv.slice(1));
    const gain = terms.find((t) => t.key === 'material' && t.delta > 0);
    const plan = terms.find((t) => t.delta > 0 && t.key !== 'material');
    const threat = mate ? null : threatOf(s, pos, found, { nodes, probe, movetime });
    // a threat the best move leaves is no defence to look for: step 2 says what the move does, step 3 says the threat stays
    const met = threat !== null && meets(s, pos, move, pv, threat, { nodes, probe, movetime });
    const defended = met ? threat : null;
    const tactic = lead && lead.kind !== 'positional' ? lead : null;
    const threatMark = threat ? moveArrow(threat.move, 'threat') : null;

    if (step === 2) {
        let text;
        if (mate) text = msg('explain.hint.mate', { n: mate });
        else if (defended?.kind === 'mate') text = threatText(defended);
        else if (tactic) text = joined([msg('explain.hint.motif', { name: motifName(tactic.key) }), motifAbout(tactic.key)]);
        else if (gain) text = msg('explain.hint.material');
        else if (defended) text = threatText(defended);
        else if (lead) text = joined([msg('explain.hint.positional', { name: motifName(lead.key) }), motifAbout(lead.key)]);
        else if (plan) text = msg('explain.hint.term', { name: termName(plan.key) });
        else text = msg(givesCheck(pos, move) ? 'explain.hint.check' : 'explain.hint.quiet');
        const annotations = mergeAnnotations(where, lead ? motifAnnotations(lead, { withArrows: false }) : null, defended ? threatMark : null);
        return { ok: true, kind: 'hint', step, text, annotations };
    }

    const parts = [msg('explain.hint.move', { san: sanWords(pos, move) })];
    if (mate) parts.push(msg('explain.hint.move-mate', { n: mate }));
    if (lead) parts.push(motifSentence(lead));
    if (defended) parts.push(msg('explain.hint.defence', { san: sanWords(threat.from, threat.move) }));
    else {
        // the term step 2 spoke of: the material when there is material to win, else the plan
        const said = gain ?? plan;
        if (!lead && !mate && said) parts.push(msg('explain.hint.move-term', { name: termName(said.key), delta: pawns(said.delta) }));
        // a threat the move leaves is said as one, never as met
        if (threat) parts.push(msg('explain.hint.leaves', { san: sanWords(threat.from, threat.move) }));
    }
    const annotations = mergeAnnotations(moveArrow(move, 'best'), lead ? motifAnnotations(lead) : null, threatMark);
    return { ok: true, kind: 'hint', step, text: joined(parts), annotations, move: { uci: moveToUci(move), san: toSan(pos, move) } };
}
