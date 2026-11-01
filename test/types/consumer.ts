// test/types/consumer — what a TypeScript user of stepchess gets: the package imported by its own name (resolved through
// package.json "exports" → "types", as a consumer's tsc resolves it) and used in strict mode, narrowing on `ok` and `kind`.
// Nothing here runs: `npx tsc -p test/types/tsconfig.json` has to compile it with no error. Each @ts-expect-error line
// must be an error, or the compile fails. No result is cast: every member is reached by narrowing alone.
import {
    analyze,
    explainMove,
    reviewGame,
    hint,
    createOpponent,
    opponentMove,
    verifyPuzzle,
    solveMate,
    findPuzzles,
    position,
    parseGame,
    tablebase,
    openingName,
    createEngine,
    EngineError,
    localize,
    msg,
    Msg,
    Position,
    Game,
} from 'stepchess';
import type {
    Analysis,
    Terminal,
    Invalid,
    AnalyzeOptions,
    MoveExplanation,
    Alternative,
    GameReview,
    Hint,
    Opponent,
    OpponentMove,
    PuzzleVerdict,
    MateSolution,
    FoundPuzzles,
    TablebaseResult,
    OpeningResult,
    PositionInfo,
    ParsedGame,
    Engine,
    MoveClass,
} from 'stepchess';
import { createBoardModel, defineElements, StepchessBoard, StepchessExplain, StepchessEvalbar, StepchessMoves, pieceSvg, MODES } from 'stepchess/board';
import type { BoardMoveDetail, BoardState, BoardOutcome } from 'stepchess/board';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// every text is a Msg with its languages as fields
const why: Msg = msg('api.error.internal');
const both: [string, string] = [why.ru, why.en];
const added: unknown = why.kk; // a registered language: typed unknown, why.in('kk') is the string
const inKazakh: string = why.in('kk');
void [both, added, inKazakh];

// analyze: Analysis | Terminal | Invalid. ok splits the invalid result off, kind splits the other two.
export function bestMove(fen: string): string {
    const r = analyze(fen, { depth: 8 });
    if (!r.ok) {
        const invalid: Invalid = r;
        return `${invalid.code}: ${invalid.reason.en}`;
    }
    if (r.kind === 'terminal') {
        const t: Terminal = r;
        const state: 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty' = t.state;
        return `${state} ${t.winner ?? 'draw'} ${t.reason.ru}`;
    }
    const a: Analysis = r;
    const top = a.lines[0];
    const pv: string[] = top.pv.map((m) => m.san);
    const mate: number | null = a.mate;
    const termValue: number = a.trace.terms[0].value;
    return `${top.san} ${a.scoreWhite} ${a.win} ${mate ?? 'no mate'} ${pv.join(' ')} ${termValue} ${a.side}`;
}

// the options are checked: the callbacks get the typed result and the meta
const options: AnalyzeOptions = {
    movetime: 500,
    multipv: 3,
    moves: ['e2e4', 'e7e5'],
    onInfo(result, meta) {
        const lineNumber: number = meta.multipv;
        const depth: number = result.depth;
        void [lineNumber, depth];
    },
};
analyze(START, options);

// a wrong option, a wrong kind and a field of another member are rejected
// @ts-expect-error Object literal may only specify known properties: the option is called movetime
analyze(START, { moveTime: 500 });
// @ts-expect-error moves is a list
analyze(START, { moves: 'e2e4' });
const unnarrowed = analyze(START, { depth: 4 });
// @ts-expect-error lines is on the Analysis member only: a Terminal has none
void unnarrowed.lines;
// @ts-expect-error analyze has no member of the kind 'review'
if (unnarrowed.kind === 'review') void 0;
if (unnarrowed.ok && unnarrowed.kind === 'terminal') {
    // @ts-expect-error a Terminal has no score
    void unnarrowed.score;
}

// explainMove: MoveExplanation | Terminal | Invalid
export function explain(fen: string, move: string): string[] {
    const r = explainMove(fen, move, { nodes: 100000, movetime: 500, moves: ['e2e4', 'e7e5'] });
    if (!r.ok) return [r.reason.ru, r.cause ?? ''];
    if (r.kind === 'terminal') return [r.reason.en];
    const e: MoveExplanation = r;
    const cls: MoveClass = e.class;
    const alternatives: Alternative[] = e.alternatives;
    const firstMate: number | undefined = alternatives[0]?.mate;
    const best = e.best; // {uci, san, line, motifs} | null
    const arrow = e.annotations.arrows[0];
    const steps = e.steps.map((s) => `${s.rule}: ${s.title.en}${s.final ? ' (final)' : ''}`);
    return [cls, String(e.loss), String(firstMate), best ? best.san : 'best move played', arrow ? `${arrow.from}${arrow.to}${arrow.kind}` : '', ...steps];
}
// @ts-expect-error the moves before the position are a list
explainMove(START, 'e4', { moves: 'e2e4' });
// @ts-expect-error a move class is one of five
export const notAClass: MoveClass = 'brilliant';

// reviewGame: GameReview | Invalid
export function review(pgn: string): number | null | string {
    const r = reviewGame(pgn, { nodesPerMove: 50000, onProgress: (p) => void [p.done, p.total] });
    if (!r.ok) return r.reason.en;
    const g: GameReview = r;
    const first = g.moves[0];
    const opening: string = g.opening ? g.opening.name.en : '';
    void [first.class, first.best?.san, g.phases.endgame?.white, g.keyMoments, opening];
    return g.accuracy.white;
}

// hint: Hint | Terminal | Invalid; only step 3 has a move
export function hintMove(fen: string): string {
    const h = hint(fen, 3, { moves: ['e4'] });
    if (!h.ok) return h.code;
    if (h.kind === 'terminal') return h.state;
    const ok: Hint = h;
    return `${ok.step} ${ok.text.en} ${ok.move?.san ?? ''}`;
}
// @ts-expect-error a hint has the steps 1, 2 and 3
hint(START, 4);

// the opponent: createOpponent gives an Opponent or an Invalid; its moves are OpponentMove | Terminal | Invalid
export function play(fen: string, seed: number): string {
    const o = createOpponent({ elo: 1200, seed });
    if (!o.ok) return o.reason.en;
    const opponent: Opponent = o;
    const r = opponent.move(fen, { wtime: 60000, btime: 60000 }, ['e2e4']);
    if (!r.ok) return r.code;
    if (r.kind === 'terminal') return r.state;
    const m: OpponentMove = r;
    return `${m.san} (${m.source}) at ${opponent.elo}`;
}
export function playOnce(fen: string): string {
    const r = opponentMove({ elo: 1600, seed: 2 }, fen, ['e4', 'e5']);
    if (r.ok && r.kind === 'move') return r.uci;
    return r.ok ? r.state : r.code;
}
const o = createOpponent();
// @ts-expect-error move is on the opponent member only: narrow on ok first
o.move(START);

// puzzles: narrowed by kind
export function isPuzzle(fen: string, moves: string[]): number | string {
    const r = verifyPuzzle({ fen, moves });
    if (r.kind === 'invalid') return r.code;
    const v: PuzzleVerdict = r;
    // an invalid puzzle has no difficulty: it is null there
    return v.difficulty ? v.difficulty.rating : v.issues.map((i) => i.code).join(',');
}
export function mates(fen: string): string[] {
    const r = solveMate(fen, 2);
    if (r.kind === 'mate') {
        const s: MateSolution = r;
        return s.solutionsSan;
    }
    if (r.kind === 'none') return [];
    return [r.reason.en];
}
export function puzzlesOf(pgn: string): number {
    const r = findPuzzles(pgn);
    if (r.kind !== 'puzzles') return 0;
    const f: FoundPuzzles = r;
    return f.puzzles.length;
}
const sm = solveMate(START, 1);
// @ts-expect-error solveMate has no member of the kind 'puzzle'
if (sm.kind === 'puzzle') void 0;

// positions, games, tablebases and openings
const pos = position(START);
if (pos.kind === 'position') {
    const p: PositionInfo = pos;
    const first: { uci: string; san: string } = p.legal[0];
    void [first, p.status.state];
}
const game = parseGame('1. e4 e5');
if (game.ok) {
    const g: ParsedGame = game;
    void g.moves[0].fen;
}
export async function probeKQK(): Promise<number> {
    const r = await tablebase('8/8/8/8/8/2k5/8/KQ6 w - - 0 1');
    if (r.kind !== 'tablebase') return 0;
    const t: TablebaseResult = r;
    return t.wdl * t.dtm + t.moves.length;
}
export function named(moves: string): string {
    const r = openingName(moves);
    if (r.kind === 'opening') {
        const n: OpeningResult = r;
        return `${n.eco} ${n.name.en}`;
    }
    return r.kind === 'none' ? '' : r.code;
}

// the classes of the core: new Position(fen?) and Game
const p = new Position(START);
void [p.fen(), new Position().fen(), Position.fromFen(START).fen()];
void new Game(START).legal();

// the worker client: every method returns a Promise of the same results; EngineError carries a code
export async function inWorker(): Promise<string> {
    const engine: Engine = createEngine({ tbUrl: '/tb/' });
    try {
        const r = await engine.analyze(START, { movetime: 200, onInfo: (result) => void result.depth });
        if (r.kind === 'analysis') return `${r.lines[0].uci}${r.stopped ? ' (stopped)' : ''}`;
        const e = await engine.explainMove(START, 'e4', { moves: [] });
        if (e.ok && e.kind === 'move') return e.class;
        const p = await engine.opponentMove({ elo: 1500 }, START, ['e2e4']);
        if (p.ok && p.kind === 'move') return p.san;
        const h = await engine.hint(START, 1);
        if (h.ok && h.kind === 'hint') return h.text.en;
        const g = await engine.reviewGame('1. e4 e5');
        if (g.ok) return String(g.accuracy.black);
        const t = await engine.tablebase('8/8/8/8/8/2k5/8/KQ6 w - - 0 1');
        if (t.kind === 'tablebase') return t.key;
        await engine.stop();
        return r.kind;
    } catch (e) {
        if (e instanceof EngineError) return e.code;
        throw e;
    } finally {
        engine.terminate();
    }
}

// localize turns a result into plain strings in one language
const invalid: Invalid = { ok: false, kind: 'invalid', code: 'fen', reason: new Msg('api.error.internal') };
const plain = localize(invalid, 'en');
export const reasonText: string = plain.reason;
export const over: Terminal | null = null;

// the board: the elements by tag, their events with typed payloads, the model in Node
defineElements();
const board = document.createElement('stepchess-board');
const isBoard: StepchessBoard = board;
board.addEventListener('move', (e) => {
    const d: BoardMoveDetail = e.detail;
    const source: 'user' | 'auto' | 'api' = d.source;
    void [d.uci, d.san, d.fen, d.color, source];
});
board.addEventListener('puzzle-failed', (e) => void [e.detail.uci, e.detail.expected]);
board.addEventListener('puzzle-solved', (e) => void e.detail.moves.length);
board.addEventListener('select', (e) => void [e.detail.square, e.detail.targets]);
board.addEventListener('change', (e) => void e.detail.valid);
board.addEventListener('position', (e) => void e.detail.reason);
board.addEventListener('error', (e) => void [e.detail.attribute, e.detail.result.reason.en]);
board.addEventListener('click', (e) => void e.clientX);
// @ts-expect-error a move event has no expected field
board.addEventListener('move', (e) => void e.detail.expected);
const placed = board.setPosition(START);
if (!placed.ok) void placed.reason.en;
board.annotate({ arrows: [{ from: 'e2', to: 'e4', kind: 'best' }] });
const shown: BoardState = board.state;
void [shown.turn, shown.puzzle.solved, isBoard];
const explainer = document.createElement('stepchess-explain');
const explained = explainMove(START, 'e4');
explainer.result = explained;
const bar: StepchessEvalbar = document.createElement('stepchess-evalbar');
bar.win = 0.6;
const record: StepchessMoves = document.createElement('stepchess-moves');
void [record.path, explainer instanceof StepchessExplain];
const model = createBoardModel({ fen: START, mode: 'puzzle', puzzle: { moves: ['e2e4'] } });
const out: BoardOutcome = model.drop('e2', 'e4');
void [out.puzzle, out.moves[0]?.color, model.state().fen, pieceSvg('N'), MODES[0]];
// @ts-expect-error a board mode is one of five
createBoardModel({ mode: 'blitz' });
