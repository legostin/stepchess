// board/index — stepchess/board: the board elements and the piece set. Importing it registers the elements:
// <stepchess-board>, <stepchess-evalbar>, <stepchess-moves>, <stepchess-explain>.
import { StepchessBoard, defineBoard } from './board.js';
import { StepchessEvalbar, defineEvalbar } from './evalbar.js';
import { StepchessMoves, defineMoves } from './moves.js';
import { StepchessExplain, defineExplain } from './explain.js';

export { StepchessBoard, StepchessEvalbar, StepchessMoves, StepchessExplain };
export { createBoardModel, normalizeAnnotations, sanIn, piecesOfFen, MODES, KINDS, GLYPHS } from './model.js';
export { pieceSvg, pieceMarkup, pieceSprite, PIECES, DRAWINGS } from './pieces.js';
export { GLYPH_NAMES } from './arrows.js';

/** Register all four elements (once); called on import where custom elements exist. */
export function defineElements() {
    if (typeof customElements === 'undefined') return;
    defineBoard();
    defineEvalbar();
    defineMoves();
    defineExplain();
}

defineElements();
