// index — the stepchess package: everything it exports (the i18n layer, the core rules, the engine's units and the public contract).
import { createEngine as engineInWorker } from './client/index.js';

export {
    msg,
    Msg,
    localize,
    registerLanguage,
    verbatim,
    perLanguage,
    eachLanguage,
    joined,
    sameText,
    allLanguages,
    inLanguage,
    resolveLanguage,
    LANGUAGES,
    DEFAULT_LANGUAGE,
} from './i18n/index.js';
export {
    Position,
    ChessError,
    generateMoves,
    legalMoves,
    perft,
    attackersOf,
    xrayAttackersOf,
    attackMaps,
    SEE_VALUES,
    see,
    seeGe,
    MAX_PLY,
    computeHash,
    computePawnHash,
    mirrorFen,
    WK,
    WQ,
    BK,
    BQ,
    square,
    fileOf,
    rankOf,
    onBoard,
    sqName,
    parseSquare,
    to64,
    from64,
    flipRank,
    ALL_SQUARES,
    WHITE,
    BLACK,
    EMPTY,
    PAWN,
    KNIGHT,
    BISHOP,
    ROOK,
    QUEEN,
    KING,
    makePiece,
    colorOf,
    typeOf,
    pieceFromFen,
    pieceToFen,
    NO_MOVE,
    F_CAPTURE,
    F_EP,
    F_CASTLE,
    F_DOUBLE,
    encodeMove,
    moveFrom,
    moveTo,
    movePromo,
    moveFlags,
    moveToUci,
    toSan,
    parseMove,
    parsePgn,
    parsePgnGames,
    writePgn,
    Game,
} from './core/index.js';
export { evaluate, trace, TERMS, termName, termAbout, winChance, winChanceWhite } from './eval/index.js';
export { probe, bestTbMoves, loadTable, hasTable, preloadTables, materialKey, generateTable } from './endgame/index.js';
export { Searcher, MATE, isMateScore, mateIn } from './search/index.js';
export {
    detectMotifs,
    MOTIFS,
    kindOf as motifKind,
    motifName,
    motifAbout,
    motifSay,
    CLASS_THRESHOLDS,
    CLASSES,
    CLASS_GLYPHS,
    classify,
    moveAccuracy,
    ANNOTATION_KINDS,
    BADGE_GLYPHS,
} from './explain/index.js';
// the public contract (explainMove, reviewGame, hint, createOpponent, opponentMove, the puzzles, tablebase and openingName are its safe wrappers) and the worker client
export {
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
    unsupported,
} from './api.js';
export { EngineError, packMessages, unpackMessages } from './client/index.js';

/**
 * The engine in a worker: the functions of the package as async methods that answer the same results (see client).
 * The same function as client's createEngine, typed with the results of the public contract.
 * @type {(options?: import('./client/index.js').EngineOptions) => import('./api.js').Engine}
 */
export const createEngine = engineInWorker;

// the result types of the public contract, for `import type { Analysis } from 'stepchess'`
/**
 * @typedef {import('./i18n/index.js').Text} Text
 * @typedef {import('./api.js').Side} Side
 * @typedef {import('./api.js').Invalid} Invalid
 * @typedef {import('./api.js').TerminalState} TerminalState
 * @typedef {import('./api.js').Terminal} Terminal
 * @typedef {import('./api.js').MoveInput} MoveInput
 * @typedef {import('./api.js').PvMove} PvMove
 * @typedef {import('./api.js').AnalysisLine} AnalysisLine
 * @typedef {import('./api.js').Trace} Trace
 * @typedef {import('./api.js').Analysis} Analysis
 * @typedef {import('./api.js').InfoMeta} InfoMeta
 * @typedef {import('./api.js').AnalyzeOptions} AnalyzeOptions
 * @typedef {import('./api.js').Status} Status
 * @typedef {import('./api.js').PositionInfo} PositionInfo
 * @typedef {import('./api.js').ParsedGame} ParsedGame
 * @typedef {import('./api.js').MoveClass} MoveClass
 * @typedef {import('./api.js').AnnotationKind} AnnotationKind
 * @typedef {import('./api.js').Annotations} Annotations
 * @typedef {import('./api.js').Motif} Motif
 * @typedef {import('./api.js').Step} Step
 * @typedef {import('./api.js').Alternative} Alternative
 * @typedef {import('./api.js').MoveExplanation} MoveExplanation
 * @typedef {import('./api.js').ExplainOptions} ExplainOptions
 * @typedef {import('./api.js').ReviewedMove} ReviewedMove
 * @typedef {import('./api.js').Stage} Stage
 * @typedef {import('./api.js').GameReview} GameReview
 * @typedef {import('./api.js').ReviewOptions} ReviewOptions
 * @typedef {import('./api.js').Hint} Hint
 * @typedef {import('./api.js').OpponentOptions} OpponentOptions
 * @typedef {import('./api.js').Clock} Clock
 * @typedef {import('./api.js').OpponentMove} OpponentMove
 * @typedef {import('./api.js').Opponent} Opponent
 * @typedef {import('./api.js').PuzzleIssue} PuzzleIssue
 * @typedef {import('./api.js').Difficulty} Difficulty
 * @typedef {import('./api.js').PuzzleVerdict} PuzzleVerdict
 * @typedef {import('./api.js').MateSolution} MateSolution
 * @typedef {import('./api.js').NoMate} NoMate
 * @typedef {import('./api.js').FoundPuzzle} FoundPuzzle
 * @typedef {import('./api.js').FoundPuzzles} FoundPuzzles
 * @typedef {import('./api.js').PuzzleOptions} PuzzleOptions
 * @typedef {import('./api.js').TablebaseMove} TablebaseMove
 * @typedef {import('./api.js').TablebaseResult} TablebaseResult
 * @typedef {import('./api.js').TablebaseProgress} TablebaseProgress
 * @typedef {import('./api.js').TablebaseOptions} TablebaseOptions
 * @typedef {import('./api.js').OpeningResult} OpeningResult
 * @typedef {import('./api.js').NoOpening} NoOpening
 * @typedef {import('./api.js').EngineAnalyzeOptions} EngineAnalyzeOptions
 * @typedef {import('./api.js').Engine} Engine
 * @typedef {import('./client/index.js').EngineOptions} EngineOptions
 */
