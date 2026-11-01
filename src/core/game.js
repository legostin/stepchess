// core/game — a game in progress: one position with its whole history, SAN of every move, status, undo and PGN.
//
// The game keeps every ply in the one Position, so repetitions are counted on the real history and never reset. The
// history holds MAX_PLY plies; one more is a typed error ChessError('game', {reason: 'limit'}).
import { msg } from '../i18n/index.js';
import { ChessError } from './errors.js';
import { Position, MAX_PLY } from './position.js';
import { generateMoves, legalMoves } from './movegen.js';
import { NO_MOVE, moveToUci } from './move.js';
import { WHITE } from './pieces.js';
import { parseMove, toSan, illegalMove } from './san.js';
import { parsePgn, writePgn } from './pgn.js';

const BUFFER = new Int32Array(256);

/** The PGN result of a status: a mate decides, stalemate and dead material draw, claimable draws leave the game open. */
const RESULTS = { stalemate: '1/2-1/2', insufficient: '1/2-1/2' };

export class Game {
    /**
     * A game from a FEN (the start position by default), or from a copy of a Position, whose history it keeps (the
     * moves of the game are the ones played on it from now on). Throws ChessError('fen').
     */
    constructor(fen) {
        this.position = fen instanceof Position ? fen.clone() : Position.fromFen(fen ?? Position.START_FEN);
        this.startFen = this.position.fen();
        /** The moves played, encoded (see moveToUci). */
        this.moves = [];
        /** The same moves in English SAN. */
        this.sans = [];
    }

    /**
     * Play a move: SAN in any language, a long form, {from, to, promotion?} or an encoded move; returns the move.
     * Throws ChessError('move') with reason syntax, ambiguous or illegal, and ChessError('game') with reason limit
     * when the history is full.
     */
    play(input) {
        const pos = this.position;
        if (pos.ply >= MAX_PLY) throw new ChessError('game', { reason: 'limit', plies: MAX_PLY }, msg('core.game.limit', { plies: MAX_PLY }));
        let m;
        try {
            m = parseMove(pos, input);
        } catch (e) {
            // the cause (syntax, ambiguous) stays in data.reason; data.cause repeats it for callers that only read the cause
            if (e instanceof ChessError && e.data.cause === undefined) e.data.cause = e.data.reason;
            throw e;
        }
        if (m === NO_MOVE) {
            const e = illegalMove(input);
            e.data.cause = 'illegal';
            throw e;
        }
        const san = toSan(pos, m);
        pos.make(m);
        this.moves.push(m);
        this.sans.push(san);
        return m;
    }

    /** Take back the last move; false when there is none. */
    undo() {
        if (this.moves.length === 0) return false;
        this.position.unmake();
        this.moves.pop();
        this.sans.pop();
        return true;
    }

    /**
     * Where the game stands: {state: 'ongoing' | 'checkmate' | 'stalemate' | 'fifty' | 'threefold' | 'insufficient',
     * winner?: 'white' | 'black'}. A mate is a mate even on the hundredth ply; fifty and threefold are reported at the
     * moment they can be claimed, and the game may go on.
     */
    status() {
        const pos = this.position;
        if (generateMoves(pos, BUFFER) === 0) {
            if (pos.inCheck()) return { state: 'checkmate', winner: pos.side === WHITE ? 'black' : 'white' };
            return { state: 'stalemate' };
        }
        if (pos.isInsufficientMaterial()) return { state: 'insufficient' };
        if (pos.repetitionCount() >= 3) return { state: 'threefold' };
        if (pos.halfmove >= 100) return { state: 'fifty' };
        return { state: 'ongoing' };
    }

    /** The legal moves with their UCI and English SAN. */
    legal() {
        const pos = this.position;
        return legalMoves(pos).map((m) => ({ uci: moveToUci(m), san: toSan(pos, m) }));
    }

    /** The FEN of the current position. */
    fen() {
        return this.position.fen();
    }

    /** The result tag of the game so far: 1-0, 0-1, 1/2-1/2, or * while it is open. */
    result() {
        const s = this.status();
        if (s.state === 'checkmate') return s.winner === 'white' ? '1-0' : '0-1';
        return RESULTS[s.state] ?? '*';
    }

    /** The game as PGN; headers are added to the tags (a start FEN and the result are filled in). lang is the language of the moves. */
    pgn(headers, opts) {
        const lang = opts?.lang ?? 'en'; // headers and opts may be missing or null
        const tags = { ...headers };
        if (tags.Result === undefined) tags.Result = this.result();
        if (this.startFen !== Position.START_FEN && tags.FEN === undefined) {
            tags.SetUp = '1';
            tags.FEN = this.startFen;
        }
        const root = { move: NO_MOVE, san: '', nags: [], children: [] };
        let cur = root;
        for (let i = 0; i < this.moves.length; i++) {
            const child = { move: this.moves[i], san: this.sans[i], nags: [], children: [] };
            cur.children.push(child);
            cur = child;
        }
        return writePgn({ headers: tags, root, result: tags.Result }, { lang });
    }

    /** A game from PGN text, its main line played (variations are dropped). Throws ChessError('pgn' | 'fen' | 'game'). */
    static fromPgn(text) {
        const tree = parsePgn(text);
        const game = new Game(tree.headers.FEN);
        for (let n = tree.root.children[0]; n; n = n.children[0]) game.play(n.move);
        return game;
    }
}
