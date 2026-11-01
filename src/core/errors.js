// core/errors — ChessError: a typed failure of the core (a bad FEN, move or PGN) with its reason and message.
import { msg } from '../i18n/index.js';

/**
 * A failure of the core. code: 'fen' | 'move' | 'pgn' | 'game'; data.reason names the message core.<code>.<reason> (an
 * illegal move is the code 'move' with the reason 'illegal'); text is that message, ready for any language; message is
 * its key. The public API (api.js) maps every code generically to {ok: false, kind: 'invalid', code, reason: text}, so
 * a new code needs no change there.
 */
export class ChessError extends Error {
    constructor(code, data, text = null) {
        super(`core.${code}.${data.reason}`);
        this.name = 'ChessError';
        this.code = code;
        this.data = data;
        this.text = text;
    }
}

/** A rejected FEN: the reason and the parameters of its message. */
export const fenError = (reason, params = {}) => new ChessError('fen', { reason, ...params }, msg(`core.fen.${reason}`, params));
