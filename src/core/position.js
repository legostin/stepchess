// core/position — the position: a 0x88 board, side, rights, en passant, counters, kings, piece counts, the hash and the pawn hash; FEN.
import { WHITE, BLACK, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, pieceFromFen, pieceToFen } from './pieces.js';
import { parseSquare, sqName } from './squares.js';
import { F_EP, F_CASTLE, F_DOUBLE } from './move.js';
import { Z } from './zobrist.js';
import { ChessError, fenError } from './errors.js';
import { msg } from '../i18n/index.js';

/** Castling rights, one bit each. */
export const WK = 1;
export const WQ = 2;
export const BK = 4;
export const BQ = 8;

/** The plies of undo history a position keeps (the game so far plus the search). */
export const MAX_PLY = 1024;

const ZP = Z.piece;
const ZC = Z.castle;
const ZE = Z.ep;
const ZS0 = Z.side[0];
const ZS1 = Z.side[1];

// the rights that survive a move touching the square: the king's and the rooks' home squares take theirs away
const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x04] = 15 & ~(WK | WQ);
CASTLE_MASK[0x07] = 15 & ~WK;
CASTLE_MASK[0x00] = 15 & ~WQ;
CASTLE_MASK[0x74] = 15 & ~(BK | BQ);
CASTLE_MASK[0x77] = 15 & ~BK;
CASTLE_MASK[0x70] = 15 & ~BQ;

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export const KNIGHT_STEPS = Object.freeze([33, 31, 18, 14, -14, -18, -31, -33]);
export const KING_STEPS = Object.freeze([16, -16, 1, -1, 17, 15, -15, -17]);
export const ROOK_DIRS = Object.freeze([16, -16, 1, -1]);
export const BISHOP_DIRS = Object.freeze([17, 15, -15, -17]);

const WP = PAWN;
const BP = 8 | PAWN;

/**
 * Is the square attacked by a piece of the color on this board? The square's own piece does not count; the board is
 * read as it stands, so a caller may lift a piece (the king that steps away) before asking.
 */
export function attacked(b, sq, by) {
    // pawns: a white pawn on s attacks s + 15 and s + 17
    if (by === WHITE) {
        if ((((sq - 15) & 0x88) === 0 && b[sq - 15] === WP) || (((sq - 17) & 0x88) === 0 && b[sq - 17] === WP)) return true;
    } else if ((((sq + 15) & 0x88) === 0 && b[sq + 15] === BP) || (((sq + 17) & 0x88) === 0 && b[sq + 17] === BP)) return true;
    const c = by << 3;
    const n = c | KNIGHT;
    for (let i = 0; i < 8; i++) {
        const s = sq + KNIGHT_STEPS[i];
        if ((s & 0x88) === 0 && b[s] === n) return true;
    }
    const k = c | KING;
    for (let i = 0; i < 8; i++) {
        const s = sq + KING_STEPS[i];
        if ((s & 0x88) === 0 && b[s] === k) return true;
    }
    const r = c | ROOK;
    const q = c | QUEEN;
    for (let i = 0; i < 4; i++) {
        const d = ROOK_DIRS[i];
        let s = sq + d;
        while ((s & 0x88) === 0) {
            const p = b[s];
            if (p) {
                if (p === r || p === q) return true;
                break;
            }
            s += d;
        }
    }
    const bi = c | BISHOP;
    for (let i = 0; i < 4; i++) {
        const d = BISHOP_DIRS[i];
        let s = sq + d;
        while ((s & 0x88) === 0) {
            const p = b[s];
            if (p) {
                if (p === bi || p === q) return true;
                break;
            }
            s += d;
        }
    }
    return false;
}

/** The hash of a position computed from scratch: {lo, hi}. The incremental hash must always equal it. */
export function computeHash(pos) {
    let lo = 0;
    let hi = 0;
    const b = pos.board;
    for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88 || !b[sq]) continue;
        const i = (b[sq] << 8) | (sq << 1);
        lo ^= Z.piece[i];
        hi ^= Z.piece[i + 1];
    }
    if (pos.side === BLACK) {
        lo ^= Z.side[0];
        hi ^= Z.side[1];
    }
    lo ^= Z.castle[pos.castling << 1];
    hi ^= Z.castle[(pos.castling << 1) + 1];
    if (pos.ep !== -1) {
        lo ^= Z.ep[(pos.ep & 7) << 1];
        hi ^= Z.ep[((pos.ep & 7) << 1) + 1];
    }
    return { lo, hi };
}

/**
 * The pawn hash computed from scratch: {lo, hi}, the XOR of the piece keys of the pawns alone (the keys of the full
 * hash). Positions with the same pawns share it, so the evaluation can cache what the pawns are worth; no pawns is 0.
 */
export function computePawnHash(pos) {
    let lo = 0;
    let hi = 0;
    const b = pos.board;
    for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88 || (b[sq] & 7) !== PAWN) continue;
        const i = (b[sq] << 8) | (sq << 1);
        lo ^= Z.piece[i];
        hi ^= Z.piece[i + 1];
    }
    return { lo, hi };
}

/**
 * The FEN of the same position with the colours swapped: the ranks flip (e2 ↔ e7), white pieces turn black and black
 * white, the other side moves, and the castling rights and the en passant square follow. Throws ChessError('fen') as
 * fromFen does. Twice gives the position back.
 */
export function mirrorFen(fen) {
    const [placement, side, rights, ep, half, full] = Position.fromFen(fen).fen().split(' ');
    const swap = (text) => text.replace(/[a-z]/gi, (ch) => (ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase()));
    const mirrored = swap(placement.split('/').reverse().join('/'));
    let castle = '';
    for (const ch of 'KQkq') if (rights.includes(ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase())) castle += ch;
    const square = ep === '-' ? '-' : ep[0] + (9 - Number(ep[1]));
    return `${mirrored} ${side === 'w' ? 'b' : 'w'} ${castle || '-'} ${square} ${half} ${full}`;
}

// a pawn of the side to move stands beside the pawn that just made a double step to the square behind ep
function epCapturable(b, ep, side) {
    const pawnSq = side === WHITE ? ep - 16 : ep + 16;
    const own = (side << 3) | PAWN;
    return (((pawnSq - 1) & 0x88) === 0 && b[pawnSq - 1] === own) || (((pawnSq + 1) & 0x88) === 0 && b[pawnSq + 1] === own);
}

// the user's text a FEN error echoes, cut short so that a hostile FEN cannot fill a message
const clip = (text) => (text.length > 16 ? `${text.slice(0, 16)}…` : text);

const STACKS = ['uMove', 'uCap', 'uCastle', 'uEp', 'uHalf', 'uLo', 'uHi', 'uPLo', 'uPHi'];

const COUNTER = /^\d{1,6}$/;

// the argument of the constructor that leaves the board empty, for fromFen and clone to fill (not public)
const BLANK = Symbol('blank');

export class Position {
    /**
     * The position of a FEN, the initial position without one. Throws ChessError('fen') for a FEN that is not a
     * position (as Position.fromFen does).
     * @param {string} [fen]
     */
    constructor(fen) {
        this.board = new Int8Array(128);
        this.side = WHITE;
        this.castling = 0;
        this.ep = -1;
        this.halfmove = 0;
        this.fullmove = 1;
        this.kings = new Int16Array(2);
        this.counts = new Uint8Array(16);
        this.hashLo = 0;
        this.hashHi = 0;
        this.pawnHashLo = 0;
        this.pawnHashHi = 0;
        // undo stacks: the state before the move made at each ply (NO_MOVE for a null move)
        this.ply = 0;
        this.uMove = new Int32Array(MAX_PLY);
        this.uCap = new Int8Array(MAX_PLY);
        this.uCastle = new Uint8Array(MAX_PLY);
        this.uEp = new Int8Array(MAX_PLY);
        this.uHalf = new Int32Array(MAX_PLY);
        this.uLo = new Int32Array(MAX_PLY);
        this.uHi = new Int32Array(MAX_PLY);
        this.uPLo = new Int32Array(MAX_PLY);
        this.uPHi = new Int32Array(MAX_PLY);
        if (fen !== BLANK) readFen(this, fen === undefined ? START_FEN : fen);
    }

    static get START_FEN() {
        return START_FEN;
    }

    /**
     * The position of a FEN (4 to 6 fields; the counters default to 0 and 1). Throws ChessError('fen') with
     * data.reason: fields, board, side, castling, ep, counters, kings, pieces, pawn-rank, opponent-in-check.
     * An en passant square no pawn of the side to move can use is dropped, as moves never set one.
     * The same as new Position(fen).
     * @param {string} fen
     * @returns {Position}
     */
    static fromFen(fen) {
        return readFen(new Position(BLANK), fen);
    }

    /** The FEN of the position. */
    fen() {
        const b = this.board;
        let out = '';
        for (let r = 7; r >= 0; r--) {
            let run = 0;
            for (let f = 0; f < 8; f++) {
                const p = b[r * 16 + f];
                if (!p) run++;
                else {
                    if (run) out += run;
                    run = 0;
                    out += pieceToFen(p);
                }
            }
            if (run) out += run;
            if (r) out += '/';
        }
        let rights = '';
        if (this.castling & WK) rights += 'K';
        if (this.castling & WQ) rights += 'Q';
        if (this.castling & BK) rights += 'k';
        if (this.castling & BQ) rights += 'q';
        const ep = this.ep === -1 ? '-' : sqName(this.ep);
        return `${out} ${this.side === WHITE ? 'w' : 'b'} ${rights || '-'} ${ep} ${this.halfmove} ${this.fullmove}`;
    }

    /** An independent copy. */
    clone() {
        const pos = new Position(BLANK);
        pos.board.set(this.board);
        pos.side = this.side;
        pos.castling = this.castling;
        pos.ep = this.ep;
        pos.halfmove = this.halfmove;
        pos.fullmove = this.fullmove;
        pos.kings.set(this.kings);
        pos.counts.set(this.counts);
        pos.hashLo = this.hashLo;
        pos.hashHi = this.hashHi;
        pos.pawnHashLo = this.pawnHashLo;
        pos.pawnHashHi = this.pawnHashHi;
        pos.ply = this.ply;
        for (const k of STACKS) pos[k].set(this[k].subarray(0, this.ply));
        return pos;
    }

    // save the state a move at this ply changes; throws when the history is full
    pushState() {
        const ply = this.ply;
        if (ply >= MAX_PLY) throw new ChessError('move', { reason: 'history' }, msg('core.move.history'));
        this.uCastle[ply] = this.castling;
        this.uEp[ply] = this.ep;
        this.uHalf[ply] = this.halfmove;
        this.uLo[ply] = this.hashLo;
        this.uHi[ply] = this.hashHi;
        this.uPLo[ply] = this.pawnHashLo;
        this.uPHi[ply] = this.pawnHashHi;
        return ply;
    }

    /** Make a legal move (one generateMoves gave for this position). */
    make(m) {
        const ply = this.pushState();
        const b = this.board;
        const counts = this.counts;
        const from = m & 127;
        const to = (m >> 7) & 127;
        const promo = (m >> 14) & 7;
        const flags = (m >> 17) & 15;
        const us = this.side;
        const p = b[from];
        let lo = this.hashLo;
        let hi = this.hashHi;
        let plo = this.pawnHashLo;
        let phi = this.pawnHashHi;
        let k;
        this.uMove[ply] = m;
        if (this.ep !== -1) {
            k = (this.ep & 7) << 1;
            lo ^= ZE[k];
            hi ^= ZE[k + 1];
        }
        let cap;
        if (flags & F_EP) {
            const cs = us === WHITE ? to - 16 : to + 16;
            cap = b[cs];
            b[cs] = 0;
            k = (cap << 8) | (cs << 1);
            lo ^= ZP[k];
            hi ^= ZP[k + 1];
            plo ^= ZP[k];
            phi ^= ZP[k + 1];
            counts[cap]--;
        } else {
            cap = b[to];
            if (cap) {
                k = (cap << 8) | (to << 1);
                lo ^= ZP[k];
                hi ^= ZP[k + 1];
                if ((cap & 7) === PAWN) {
                    plo ^= ZP[k];
                    phi ^= ZP[k + 1];
                }
                counts[cap]--;
            }
        }
        this.uCap[ply] = cap;
        k = (p << 8) | (from << 1);
        lo ^= ZP[k];
        hi ^= ZP[k + 1];
        b[from] = 0;
        let placed = p;
        if ((p & 7) === PAWN) {
            // the pawn leaves its square; it lands on the next one unless it promotes
            plo ^= ZP[k];
            phi ^= ZP[k + 1];
            if (promo) {
                placed = (us << 3) | promo;
                counts[p]--;
                counts[placed]++;
            } else {
                plo ^= ZP[(p << 8) | (to << 1)];
                phi ^= ZP[((p << 8) | (to << 1)) + 1];
            }
        }
        b[to] = placed;
        k = (placed << 8) | (to << 1);
        lo ^= ZP[k];
        hi ^= ZP[k + 1];
        if ((p & 7) === KING) {
            this.kings[us] = to;
            if (flags & F_CASTLE) {
                const rf = to > from ? from + 3 : from - 4;
                const rt = to > from ? from + 1 : from - 1;
                const r = b[rf];
                b[rf] = 0;
                b[rt] = r;
                k = (r << 8) | (rf << 1);
                lo ^= ZP[k];
                hi ^= ZP[k + 1];
                k = (r << 8) | (rt << 1);
                lo ^= ZP[k];
                hi ^= ZP[k + 1];
            }
        }
        const oc = this.castling;
        const nc = oc & CASTLE_MASK[from] & CASTLE_MASK[to];
        if (nc !== oc) {
            lo ^= ZC[oc << 1] ^ ZC[nc << 1];
            hi ^= ZC[(oc << 1) + 1] ^ ZC[(nc << 1) + 1];
            this.castling = nc;
        }
        let ep = -1;
        if (flags & F_DOUBLE) {
            // an en passant square only when a pawn stands ready to take
            const theirs = ((us ^ 1) << 3) | PAWN;
            if ((((to - 1) & 0x88) === 0 && b[to - 1] === theirs) || (((to + 1) & 0x88) === 0 && b[to + 1] === theirs)) {
                ep = (from + to) >> 1;
                k = (ep & 7) << 1;
                lo ^= ZE[k];
                hi ^= ZE[k + 1];
            }
        }
        this.ep = ep;
        this.halfmove = cap || (p & 7) === PAWN ? 0 : this.halfmove + 1;
        if (us === BLACK) this.fullmove++;
        this.side = us ^ 1;
        this.hashLo = lo ^ ZS0;
        this.hashHi = hi ^ ZS1;
        this.pawnHashLo = plo;
        this.pawnHashHi = phi;
        this.ply = ply + 1;
    }

    /** Take back the last move made with make. */
    unmake() {
        const ply = --this.ply;
        const m = this.uMove[ply];
        const b = this.board;
        const from = m & 127;
        const to = (m >> 7) & 127;
        const promo = (m >> 14) & 7;
        const flags = (m >> 17) & 15;
        const us = this.side ^ 1;
        this.side = us;
        let p = b[to];
        if (promo) {
            this.counts[p]--;
            p = (us << 3) | PAWN;
            this.counts[p]++;
        }
        b[from] = p;
        const cap = this.uCap[ply];
        if (flags & F_EP) {
            b[to] = 0;
            b[us === WHITE ? to - 16 : to + 16] = cap;
        } else b[to] = cap;
        if (cap) this.counts[cap]++;
        if ((p & 7) === KING) {
            this.kings[us] = from;
            if (flags & F_CASTLE) {
                const rf = to > from ? from + 3 : from - 4;
                const rt = to > from ? from + 1 : from - 1;
                b[rf] = b[rt];
                b[rt] = 0;
            }
        }
        this.castling = this.uCastle[ply];
        this.ep = this.uEp[ply];
        this.halfmove = this.uHalf[ply];
        this.hashLo = this.uLo[ply];
        this.hashHi = this.uHi[ply];
        this.pawnHashLo = this.uPLo[ply];
        this.pawnHashHi = this.uPHi[ply];
        if (us === BLACK) this.fullmove--;
    }

    /** Pass the turn (for the null-move search): no move, no en passant square. */
    makeNull() {
        const ply = this.pushState();
        this.uMove[ply] = 0;
        let lo = this.hashLo ^ ZS0;
        let hi = this.hashHi ^ ZS1;
        if (this.ep !== -1) {
            const k = (this.ep & 7) << 1;
            lo ^= ZE[k];
            hi ^= ZE[k + 1];
            this.ep = -1;
        }
        this.hashLo = lo;
        this.hashHi = hi;
        this.halfmove++;
        this.side ^= 1;
        this.ply = ply + 1;
    }

    /** Take back the null move. */
    unmakeNull() {
        const ply = --this.ply;
        this.side ^= 1;
        this.ep = this.uEp[ply];
        this.halfmove = this.uHalf[ply];
        this.hashLo = this.uLo[ply];
        this.hashHi = this.uHi[ply];
    }

    /** Is the side to move in check? */
    inCheck() {
        return attacked(this.board, this.kings[this.side], this.side ^ 1);
    }

    /**
     * Has the position occurred before since the last irreversible move and the last null move? For the search: one
     * repetition is enough to score a draw.
     */
    isRepetition() {
        const lo = this.hashLo;
        const hi = this.hashHi;
        const n = Math.min(this.halfmove, this.ply);
        for (let k = 1; k <= n; k++) {
            const i = this.ply - k;
            if (this.uMove[i] === 0) return false;
            if ((k & 1) === 0 && this.uLo[i] === lo && this.uHi[i] === hi) return true;
        }
        return false;
    }

    /** How many times the position has occurred, this time included, since the last irreversible move (3 is a draw). */
    repetitionCount() {
        const lo = this.hashLo;
        const hi = this.hashHi;
        const n = Math.min(this.halfmove, this.ply);
        let count = 1;
        for (let k = 1; k <= n; k++) {
            const i = this.ply - k;
            if (this.uMove[i] === 0) break;
            if ((k & 1) === 0 && this.uLo[i] === lo && this.uHi[i] === hi) count++;
        }
        return count;
    }

    /** Can neither side mate: bare kings, one minor piece, or bishops only, all on squares of one color? */
    isInsufficientMaterial() {
        const c = this.counts;
        if (c[PAWN] || c[8 | PAWN] || c[ROOK] || c[8 | ROOK] || c[QUEEN] || c[8 | QUEEN]) return false;
        const knights = c[KNIGHT] + c[8 | KNIGHT];
        const bishops = c[BISHOP] + c[8 | BISHOP];
        if (knights + bishops <= 1) return true;
        if (knights) return false;
        const b = this.board;
        let colors = 0;
        for (let sq = 0; sq < 120; sq++) if ((sq & 0x88) === 0 && (b[sq] & 7) === BISHOP) colors |= 1 << (((sq >> 4) + sq) & 1);
        return colors !== 3;
    }

    /** Is the square attacked by a piece of the color? */
    isAttacked(sq, byColor) {
        return attacked(this.board, sq, byColor);
    }
}

// the position of a FEN filled into pos, an empty board (see Position.fromFen); throws ChessError('fen')
function readFen(pos, fen) {
    if (typeof fen !== 'string') throw fenError('fields', { count: 0 });
    const trimmed = fen.trim();
    const parts = trimmed ? trimmed.split(/\s+/) : [];
    if (parts.length < 4 || parts.length > 6) throw fenError('fields', { count: parts.length });
    const [placement, sideText, castleText, epText, halfText = '0', fullText = '1'] = parts;
    const b = pos.board;

    const ranks = placement.split('/');
    if (ranks.length !== 8) throw fenError('board');
    for (let i = 0; i < 8; i++) {
        const r = 7 - i;
        let f = 0;
        let digit = false;
        for (const ch of ranks[i]) {
            if (ch >= '1' && ch <= '8') {
                if (digit) throw fenError('board');
                f += ch.charCodeAt(0) - 48;
                digit = true;
            } else {
                const p = pieceFromFen(ch);
                if (!p || f > 7) throw fenError('board');
                b[r * 16 + f] = p;
                f++;
                digit = false;
            }
            if (f > 8) throw fenError('board');
        }
        if (f !== 8) throw fenError('board');
    }

    if (sideText !== 'w' && sideText !== 'b') throw fenError('side', { text: clip(sideText) });
    pos.side = sideText === 'w' ? WHITE : BLACK;

    if (castleText !== '-') {
        for (const ch of castleText) {
            const bit = ch === 'K' ? WK : ch === 'Q' ? WQ : ch === 'k' ? BK : ch === 'q' ? BQ : 0;
            if (!bit || pos.castling & bit) throw fenError('castling', { text: clip(castleText) });
            pos.castling |= bit;
        }
    }

    let ep = -1;
    if (epText !== '-') {
        ep = parseSquare(epText);
        if (ep === -1) throw fenError('ep', { text: clip(epText) });
    }

    if (!COUNTER.test(halfText) || !COUNTER.test(fullText) || Number(fullText) < 1) throw fenError('counters');
    pos.halfmove = Number(halfText);
    pos.fullmove = Number(fullText);

    // what is on the board
    const counts = pos.counts;
    for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88 || !b[sq]) continue;
        const p = b[sq];
        counts[p]++;
        if ((p & 7) === KING) pos.kings[p >> 3] = sq;
    }
    if (counts[KING] !== 1 || counts[8 | KING] !== 1) throw fenError('kings', { white: counts[KING], black: counts[8 | KING] });
    for (const c of [0, 8]) {
        let total = 0;
        for (let t = PAWN; t <= KING; t++) total += counts[c | t];
        if (total > 16 || counts[c | PAWN] > 8) throw fenError('pieces');
    }
    for (let f = 0; f < 8; f++) for (const sq of [f, 0x70 + f]) if ((b[sq] & 7) === PAWN) throw fenError('pawn-rank', { square: sqName(sq) });
    if (attacked(b, pos.kings[pos.side ^ 1], pos.side)) throw fenError('opponent-in-check');

    const has = (name, p) => b[parseSquare(name)] === p;
    const wk = has('e1', KING);
    const bk = has('e8', 8 | KING);
    if (
        (pos.castling & WK && !(wk && has('h1', ROOK))) ||
        (pos.castling & WQ && !(wk && has('a1', ROOK))) ||
        (pos.castling & BK && !(bk && has('h8', 8 | ROOK))) ||
        (pos.castling & BQ && !(bk && has('a8', 8 | ROOK)))
    )
        throw fenError('castling', { text: clip(castleText) });

    if (ep !== -1) {
        // White to move: Black's pawn went from ep + 16 over ep to ep - 16
        const dir = pos.side === WHITE ? -16 : 16;
        const theirPawn = ((pos.side ^ 1) << 3) | PAWN;
        const okRank = ep >> 4 === (pos.side === WHITE ? 5 : 2);
        if (!okRank || b[ep] || b[ep - dir] || b[ep + dir] !== theirPawn) throw fenError('ep', { text: clip(epText) });
        if (epCapturable(b, ep, pos.side)) pos.ep = ep;
    }

    const h = computeHash(pos);
    pos.hashLo = h.lo;
    pos.hashHi = h.hi;
    const ph = computePawnHash(pos);
    pos.pawnHashLo = ph.lo;
    pos.pawnHashHi = ph.hi;
    return pos;
}
