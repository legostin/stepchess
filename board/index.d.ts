// board/index.d.ts — the types of stepchess/board: the four elements, their events and payloads, the board model and the piece set (hand-written; see docs/API.md).
import type { Invalid, Annotations, AnnotationKind, MoveExplanation, Terminal } from '../types/index.js';

/** The modes of a board: who may do what. */
export type BoardMode = 'play' | 'puzzle' | 'analysis' | 'setup' | 'view';
export type BoardColor = 'white' | 'black';
/** A square by name: 'e4'. */
export type Square = string;
/** A piece as its FEN letter: 'N' a white knight, 'q' a black queen. */
export type PieceLetter = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P' | 'k' | 'q' | 'r' | 'b' | 'n' | 'p';
export type Glyph = '!!' | '!' | '!?' | '?!' | '?' | '??' | '#' | '+';

/** A move as the board played it. */
export interface PlayedMove {
    uci: string;
    san: string;
    /** The FEN after the move. */
    fen: string;
    /** The FEN before the move. */
    before: string;
    /** The encoded move of the core. */
    move: number;
    /** A puzzle's automatic reply. */
    auto: boolean;
    /** The side that played it. */
    color: BoardColor;
}

/** What an input of the model did: the moves it played, the selection, an open promotion picker, the puzzle verdict. */
export interface BoardOutcome {
    moves: PlayedMove[];
    selection: Square | null;
    promotion: boolean;
    puzzle: 'solved' | 'failed' | null;
    /** The UCI move the puzzle line wanted, after a wrong one. */
    expected: string | null;
}

/** The state a view draws: the model's state() and the board's state property. */
export interface BoardState {
    fen: string;
    mode: BoardMode;
    orientation: BoardColor;
    player: BoardColor | 'both';
    turn: BoardColor;
    pieces: Record<Square, PieceLetter>;
    selected: Square | null;
    targets: Square[];
    pendingPromotion: { from: Square; to: Square; color: BoardColor } | null;
    lastMove: { from: Square; to: Square; uci: string; san: string } | null;
    /** The square of the king in check. */
    check: Square | null;
    annotations: Annotations;
    /** The arrows and circles the user drew. */
    drawn: { arrows: { from: Square; to: Square; kind: AnnotationKind }[]; squares: { sq: Square; kind: AnnotationKind }[] };
    puzzle: { index: number; length: number; solved: boolean; failed: boolean };
    history: { uci: string; san: string }[];
    status: 'ongoing' | Terminal['state'];
    winner: BoardColor | null;
    /** In setup mode: can the position be left (is it legal)? */
    valid: boolean;
    interactive: boolean;
}

export interface PuzzleLine {
    /** The position (the current one by default). */
    fen?: string;
    /** The line in UCI or SAN, the solver's move first. */
    moves: string[];
}

export type SetPositionResult = { ok: true; fen: string } | Invalid;
export type PlayMovesResult =
    { ok: true; moves: PlayedMove[]; cancelled?: boolean } | (Invalid & { played: number; moves?: PlayedMove[]; cancelled?: boolean });

// ---------------------------------------------------------------- events

export interface BoardMoveDetail {
    uci: string;
    san: string;
    /** The FEN after the move. */
    fen: string;
    color: BoardColor;
    /** The user, the puzzle's automatic reply, or playMoves. */
    source: 'user' | 'auto' | 'api';
}
export interface BoardSelectDetail {
    square: Square | null;
    targets: Square[];
}
export interface BoardPuzzleSolvedDetail {
    /** The UCI moves played. */
    moves: string[];
}
export interface BoardPuzzleFailedDetail {
    /** The wrong move, null if unknown. */
    uci: string | null;
    /** The UCI move the line wanted. */
    expected: string;
}
export interface BoardChangeDetail {
    fen: string;
    valid: boolean;
}
export interface BoardPositionDetail {
    fen: string;
    reason: 'position' | 'puzzle' | 'undo' | 'attribute' | 'cancel' | 'mode';
}
export interface BoardErrorDetail {
    attribute: 'fen' | 'puzzle';
    result: Invalid;
}

/** The events of <stepchess-board>, with the element's other events (select, change and error are the board's own). */
export type StepchessBoardEventMap = Omit<HTMLElementEventMap, 'select' | 'change' | 'error'> & {
    move: CustomEvent<BoardMoveDetail>;
    select: CustomEvent<BoardSelectDetail>;
    'puzzle-solved': CustomEvent<BoardPuzzleSolvedDetail>;
    'puzzle-failed': CustomEvent<BoardPuzzleFailedDetail>;
    change: CustomEvent<BoardChangeDetail>;
    position: CustomEvent<BoardPositionDetail>;
    error: CustomEvent<BoardErrorDetail>;
};

// ---------------------------------------------------------------- elements

/** <stepchess-board>: attributes fen, mode, orientation, player, puzzle, coordinates, lang. */
export declare class StepchessBoard extends HTMLElement {
    static observedAttributes: string[];
    /** The model's state. */
    readonly state: BoardState;
    /** The FEN the board's game started from. */
    readonly startFen: string;
    /** The FEN on the board; setting it calls setPosition. */
    fen: string;
    /** A new position, and with opts.puzzle a puzzle from it; a rejected call changes nothing. */
    setPosition(fen: string, opts?: { puzzle?: { moves: string[] } }): SetPositionResult;
    setPuzzle(puzzle: PuzzleLine): SetPositionResult;
    /** Play moves (UCI or SAN) in any mode; fires move with source 'api'. */
    playMoves(moves: string | string[]): PlayMovesResult;
    /** Arrows, squares and badges; null clears them. */
    annotate(annotations: Partial<Annotations> | null): void;
    flip(): void;
    undo(): BoardOutcome;
    cancel(): void;
    render(): void;
    addEventListener<K extends keyof StepchessBoardEventMap>(
        type: K,
        listener: (this: StepchessBoard, ev: StepchessBoardEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions,
    ): void;
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
    removeEventListener<K extends keyof StepchessBoardEventMap>(
        type: K,
        listener: (this: StepchessBoard, ev: StepchessBoardEventMap[K]) => unknown,
        options?: boolean | EventListenerOptions,
    ): void;
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions): void;
}

/** <stepchess-evalbar>: White's winning chance as a bar. Attributes win, orientation, horizontal, lang. */
export declare class StepchessEvalbar extends HTMLElement {
    static observedAttributes: string[];
    /** 0 to 1 (the attribute win). */
    win: number;
    render(): void;
}

/** A node of the record of <stepchess-moves>. */
export interface MovesNode {
    readonly uci: string;
    readonly parent: MovesNode | null;
    readonly children: readonly MovesNode[];
}

/** <stepchess-moves>: the game record with variations. Attributes for, pgn, lang. It fires no events of its own. */
export declare class StepchessMoves extends HTMLElement {
    static observedAttributes: string[];
    /** The class of each main-line move, for coloured marks. */
    classes: (string | null)[];
    /** The UCI moves up to the current move. */
    readonly path: string[];
    go(node: MovesNode | null): void;
    first(): void;
    prev(): void;
    next(): void;
    last(): void;
    render(): void;
}

/** <stepchess-explain>: one step at a time of an explanation. Attributes for, lang. */
export declare class StepchessExplain extends HTMLElement {
    static observedAttributes: string[];
    /** An explainMove result (another result shows its reason), or null. */
    result: MoveExplanation | Terminal | Invalid | null;
    /** The step on show. */
    readonly index: number;
    step(by: number): void;
    render(): void;
}

declare global {
    interface HTMLElementTagNameMap {
        'stepchess-board': StepchessBoard;
        'stepchess-evalbar': StepchessEvalbar;
        'stepchess-moves': StepchessMoves;
        'stepchess-explain': StepchessExplain;
    }
}

/** Register all four elements (once); called on import where custom elements exist. */
export declare function defineElements(): void;

// ---------------------------------------------------------------- the model (no DOM)

export interface BoardModelOptions {
    /** The start position by default; an invalid one falls back to it. */
    fen?: string;
    mode?: BoardMode;
    orientation?: BoardColor;
    player?: BoardColor | 'both';
    puzzle?: { moves: string[] } | null;
}

/** The state machine behind <stepchess-board>: it never throws on input. */
export interface BoardModel {
    /** A tap (or Enter) on a square, or null: select, reselect, deselect or move. */
    select(square: Square | null): BoardOutcome;
    /** A piece dropped from a square on another (to = null: off the board). */
    drop(from: Square, to: Square | null): BoardOutcome;
    /** The piece of the open promotion picker, or null to take the move back. */
    promote(type: 'q' | 'r' | 'b' | 'n' | null): BoardOutcome;
    cancel(): BoardOutcome;
    annotate(annotations: Partial<Annotations> | null): void;
    /** Toggle a drawn arrow (from ≠ to) or circle (from = to). */
    draw(from: Square, to: Square | null, kind?: AnnotationKind): void;
    clearDrawn(): void;
    setPosition(fen: string, opts?: { puzzle?: { moves: string[] } }): SetPositionResult;
    setPuzzle(puzzle: PuzzleLine): SetPositionResult;
    playMoves(moves: string[]): PlayMovesResult;
    undo(): BoardOutcome;
    flip(): void;
    setOrientation(orientation: BoardColor): void;
    setPlayer(player: BoardColor | 'both'): void;
    /** Change the mode; leaving setup needs a legal position. */
    setMode(mode: BoardMode): { ok: boolean } | Invalid;
    /** Setup mode: put a piece on a square, or remove it (null). */
    place(square: Square, letter: PieceLetter | null): void;
    setTurn(color: BoardColor): void;
    clear(): void;
    state(): BoardState;
    records(): PlayedMove[];
    startFen(): string;
    /** May the piece on this square be picked up now? */
    movable(square: Square): boolean;
}

export declare function createBoardModel(options?: BoardModelOptions): BoardModel;
/** Annotations with every bad part dropped; a missing kind is 'idea'. */
export declare function normalizeAnnotations(annotations: unknown): Annotations;
/** The SAN of a move record in a language. */
export declare function sanIn(record: { before: string; move: number; san?: string }, lang: string): string;
/** The pieces of a FEN's placement field as {square: letter}. */
export declare function piecesOfFen(fen: string): Record<Square, PieceLetter>;
export declare const MODES: readonly BoardMode[];
export declare const KINDS: readonly AnnotationKind[];
export declare const GLYPHS: readonly Glyph[];

// ---------------------------------------------------------------- the piece set

/** The inner markup of a piece for a 45×45 viewBox ('' for a letter that is not a piece). */
export declare function pieceMarkup(letter: string): string;
/** A piece as a standalone <svg>; attrs are added to the svg element. */
export declare function pieceSvg(letter: string, attrs?: string): string;
/** The twelve pieces as <symbol id="sc-wK"> … in one hidden sprite. */
export declare function pieceSprite(prefix?: string): string;
/** The FEN letters of the set, white first. */
export declare const PIECES: readonly PieceLetter[];
/** The drawing of each piece type: its body, seams and dots (SVG markup). */
export declare const DRAWINGS: Readonly<
    Record<'k' | 'q' | 'r' | 'b' | 'n' | 'p', { body: readonly string[]; seams: readonly string[]; dots: readonly string[] }>
>;
/** The name of each badge glyph. */
export declare const GLYPH_NAMES: Readonly<Record<Glyph, string>>;
