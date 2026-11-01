// puzzles/result — the typed failures every function of the unit returns, and the reading of a node budget from an option.
import { ChessError } from '../core/index.js';

/** A typed failure as every public function of the unit returns it. */
export const invalid = (code, reason) => ({ ok: false, kind: 'invalid', code, reason });

/** The typed failure for a thrown error: a ChessError keeps its code and text, anything else is internal (with the message given). */
export const failure = (e, internal) => (e instanceof ChessError ? invalid(e.code, e.text ?? internal) : invalid('internal', internal));

/** A budget from an option: a number from 1 up to the cap, else the fallback. */
export function budgetOf(value, fallback, cap) {
    return Number.isFinite(value) && value >= 1 ? Math.floor(Math.min(value, cap)) : fallback;
}
