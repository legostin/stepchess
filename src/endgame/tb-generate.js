// endgame/tb-generate — retrograde analysis of one table: a direct-board move generator, un-moves, DTM by levels.
//
// Every entry is first examined forwards: its legal moves are generated on a small 64-square board; a capture or a
// promotion leaves the table and is read from a smaller one (generated before), the other moves stay in it and are
// counted, each distinct child once. Then, level by level in plies (0: checkmated), the positions resolved at level d
// are walked backwards: a predecessor of a loss wins at d + 1; a predecessor of a win loses once all its children
// in the table are wins, at 1 + the longest of them (or of the captures and promotions, if those take longer). What
// is never resolved is a draw.
//
// En passant: a double step that an enemy pawn may take en passant leads to a separate node (the same board with the
// capture added to its moves); it exists only during the build, and probe looks one move ahead for it.
import { WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, Position } from '../core/index.js';
import { layoutOf, materialOf, MATED, ILLEGAL, MAX_DTM } from './tb-index.js';

// geometry on 0..63 squares
const N_STEPS = [
    [1, 2],
    [2, 1],
    [2, -1],
    [1, -2],
    [-1, -2],
    [-2, -1],
    [-2, 1],
    [-1, 2],
];
const DIRS = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
];
const inside = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const stepTable = (steps) => {
    const start = new Int32Array(65);
    const list = [];
    for (let sq = 0; sq < 64; sq++) {
        start[sq] = list.length;
        for (const [df, dr] of steps) if (inside((sq & 7) + df, (sq >> 3) + dr)) list.push(sq + df + 8 * dr);
    }
    start[64] = list.length;
    return [start, Int8Array.from(list)];
};
const [K_AT, K_TO] = stepTable(DIRS);
const [N_AT, N_TO] = stepTable(N_STEPS);
// rays: RAY_AT[sq * 8 + d] .. RAY_AT[sq * 8 + d + 1] in RAY_TO, nearest first
const RAY_AT = new Int32Array(64 * 8 + 1);
const RAY_LIST = [];
for (let sq = 0; sq < 64; sq++)
    for (let d = 0; d < 8; d++) {
        RAY_AT[sq * 8 + d] = RAY_LIST.length;
        let f = (sq & 7) + DIRS[d][0];
        let r = (sq >> 3) + DIRS[d][1];
        while (inside(f, r)) {
            RAY_LIST.push(r * 8 + f);
            f += DIRS[d][0];
            r += DIRS[d][1];
        }
    }
RAY_AT[64 * 8] = RAY_LIST.length;
const RAY_TO = Int8Array.from(RAY_LIST);
// a → b: the direction (1 + d) when b lies on a line from a, 0 otherwise; the distance along it
const LINE = new Int8Array(64 * 64);
const DIST = new Int8Array(64 * 64);
const ADJ = new Uint8Array(64 * 64);
const KNIGHT_HIT = new Uint8Array(64 * 64);
for (let a = 0; a < 64; a++) {
    for (let d = 0; d < 8; d++)
        for (let i = RAY_AT[a * 8 + d], k = 1; i < RAY_AT[a * 8 + d + 1]; i++, k++) {
            LINE[a * 64 + RAY_TO[i]] = d + 1;
            DIST[a * 64 + RAY_TO[i]] = k;
        }
    for (let i = K_AT[a]; i < K_AT[a + 1]; i++) ADJ[a * 64 + K_TO[i]] = 1;
    for (let i = N_AT[a]; i < N_AT[a + 1]; i++) KNIGHT_HIT[a * 64 + N_TO[i]] = 1;
}
const STEP = DIRS.map(([df, dr]) => df + 8 * dr);
const FWD = [8, -8];
const PROMOS = [QUEEN, ROOK, BISHOP, KNIGHT];

// a move: slot | to << 3 | promo << 9 | (captured slot + 1) << 12 | double step << 15
const M_CAP = 12;
const M_DOUBLE = 1 << 15;

/** A small board of at most a few pieces: slots with colour, type, square and alive; moves, un-moves and attacks. */
export class Board {
    constructor() {
        this.n = 0;
        this.col = new Int8Array(8);
        this.typ = new Int8Array(8);
        this.sq = new Int8Array(8);
        this.alive = new Uint8Array(8);
        this.at = new Int8Array(64); // slot + 1, or 0
        this.king = [0, 0];
    }

    /** Set up the pieces (colours, types, squares 0..63); false when two share a square. */
    load(cols, types, sqs, n) {
        this.n = n;
        this.at.fill(0);
        for (let j = 0; j < n; j++) {
            this.col[j] = cols[j];
            this.typ[j] = types[j];
            this.sq[j] = sqs[j];
            this.alive[j] = 1;
            if (types[j] === KING) this.king[cols[j]] = j;
        }
        for (let j = 0; j < n; j++) {
            if (this.at[sqs[j]]) return false;
            this.at[sqs[j]] = j + 1;
        }
        return true;
    }

    /** Is the square attacked by a piece of the colour (the board as it stands)? */
    attacked(x, c) {
        const at = this.at;
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j] || this.col[j] !== c) continue;
            const s = this.sq[j];
            const t = this.typ[j];
            if (t === KING) {
                if (ADJ[s * 64 + x]) return true;
            } else if (t === KNIGHT) {
                if (KNIGHT_HIT[s * 64 + x]) return true;
            } else if (t === PAWN) {
                if (x >> 3 === (s >> 3) + (c === WHITE ? 1 : -1) && ((x & 7) - (s & 7) === 1 || (s & 7) - (x & 7) === 1)) return true;
            } else {
                const d = LINE[s * 64 + x];
                if (!d || (t === ROOK && d > 4) || (t === BISHOP && d <= 4)) continue;
                const step = STEP[d - 1];
                const dist = DIST[s * 64 + x];
                let k = 1;
                let p = s + step;
                while (k < dist && !at[p]) {
                    k++;
                    p += step;
                }
                if (k === dist) return true;
            }
        }
        return false;
    }

    /** Is the king of the colour attacked? */
    kingAttacked(c) {
        return this.attacked(this.sq[this.king[c]], c ^ 1);
    }

    /** The pseudo-legal moves of the colour, written to out; returns their number (never a capture of a king). */
    moves(c, out) {
        let n = 0;
        const at = this.at;
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j] || this.col[j] !== c) continue;
            const s = this.sq[j];
            const t = this.typ[j];
            if (t === KING || t === KNIGHT) {
                const [AT, TO] = t === KING ? [K_AT, K_TO] : [N_AT, N_TO];
                for (let i = AT[s]; i < AT[s + 1]; i++) {
                    const to = TO[i];
                    const o = at[to];
                    if (o && this.col[o - 1] === c) continue;
                    out[n++] = j | (to << 3) | (o << M_CAP);
                }
            } else if (t === PAWN) {
                const fwd = FWD[c];
                const to = s + fwd;
                const last = to >> 3 === (c === WHITE ? 7 : 0);
                if (!at[to]) {
                    if (last) for (const p of PROMOS) out[n++] = j | (to << 3) | (p << 9);
                    else {
                        out[n++] = j | (to << 3);
                        if (s >> 3 === (c === WHITE ? 1 : 6) && !at[to + fwd]) out[n++] = j | ((to + fwd) << 3) | M_DOUBLE;
                    }
                }
                for (const df of [-1, 1]) {
                    const f = (s & 7) + df;
                    if (f < 0 || f > 7) continue;
                    const x = to + df;
                    const o = at[x];
                    if (!o || this.col[o - 1] === c) continue;
                    if (last) for (const p of PROMOS) out[n++] = j | (x << 3) | (p << 9) | (o << M_CAP);
                    else out[n++] = j | (x << 3) | (o << M_CAP);
                }
            } else {
                const d0 = t === BISHOP ? 4 : 0;
                const d1 = t === ROOK ? 4 : 8;
                for (let d = d0; d < d1; d++)
                    for (let i = RAY_AT[s * 8 + d]; i < RAY_AT[s * 8 + d + 1]; i++) {
                        const to = RAY_TO[i];
                        const o = at[to];
                        if (o) {
                            if (this.col[o - 1] !== c) out[n++] = j | (to << 3) | (o << M_CAP);
                            break;
                        }
                        out[n++] = j | (to << 3);
                    }
            }
        }
        return n;
    }

    /** Make a move; returns the square it came from (for undo). */
    make(m) {
        const j = m & 7;
        const to = (m >> 3) & 63;
        const promo = (m >> 9) & 7;
        const cap = (m >> M_CAP) & 7;
        const from = this.sq[j];
        this.at[from] = 0;
        if (cap) this.alive[cap - 1] = 0;
        this.at[to] = j + 1;
        this.sq[j] = to;
        if (promo) this.typ[j] = promo;
        return from;
    }

    /** Take back the move made from the square. */
    undo(m, from) {
        const j = m & 7;
        const to = (m >> 3) & 63;
        const cap = (m >> M_CAP) & 7;
        this.at[from] = j + 1;
        this.sq[j] = from;
        if (cap) {
            this.alive[cap - 1] = 1;
            this.at[to] = cap;
        } else this.at[to] = 0;
        if ((m >> 9) & 7) this.typ[j] = PAWN;
    }

    /**
     * The en passant capture open to the colour to move: the enemy pawn that may just have made a double step (its
     * two squares behind empty), with a pawn of the colour beside it that may take it legally. Returns a move of the
     * capturing pawn to the square behind (with the victim as the captured slot), or 0.
     */
    enPassant(c) {
        const them = c ^ 1;
        const rank = c === WHITE ? 4 : 3;
        const back = FWD[them];
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j] || this.col[j] !== them || this.typ[j] !== PAWN) continue;
            const s = this.sq[j];
            if (s >> 3 !== rank || this.at[s - back] || this.at[s - 2 * back]) continue;
            for (let k = 0; k < this.n; k++) {
                if (!this.alive[k] || this.col[k] !== c || this.typ[k] !== PAWN) continue;
                const p = this.sq[k];
                if (p >> 3 !== rank || ((p & 7) - (s & 7) !== 1 && (s & 7) - (p & 7) !== 1)) continue;
                // the capture lifts the victim off the board: try it
                const m = k | ((s - back) << 3) | ((j + 1) << M_CAP);
                const from = this.makeEp(m);
                const legal = !this.kingAttacked(c);
                this.undoEp(m, from);
                if (legal) return m;
            }
            return 0;
        }
        return 0;
    }

    /** Make an en passant capture (a move enPassant gave): the victim stands beside the square the pawn goes to. */
    makeEp(m) {
        const from = this.make(m);
        const v = ((m >> M_CAP) & 7) - 1;
        this.at[this.sq[v]] = 0;
        return from;
    }

    /** Take back the en passant capture. */
    undoEp(m, from) {
        this.undo(m, from);
        const v = ((m >> M_CAP) & 7) - 1;
        this.at[(m >> 3) & 63] = 0;
        this.at[this.sq[v]] = v + 1;
    }

    /**
     * The predecessors of the position with the colour c to move: every un-move of a piece of the other colour onto an
     * empty square (no captures, no promotions: those come from other tables) that leaves a legal position. For each,
     * visit(isDouble) is called with the board standing in the predecessor (the other colour to move); `only` limits
     * the un-moves: 0 all, 1 all but pawn double steps, 2 pawn double steps only.
     */
    predecessors(c, only, visit) {
        const mover = c ^ 1;
        const at = this.at;
        for (let j = 0; j < this.n; j++) {
            if (!this.alive[j] || this.col[j] !== mover) continue;
            const s = this.sq[j];
            const t = this.typ[j];
            const go = (from, dbl) => {
                at[s] = 0;
                at[from] = j + 1;
                this.sq[j] = from;
                // the predecessor is legal when the side that did not move there (c) is not in check
                if (!this.kingAttacked(c)) visit(dbl);
                at[from] = 0;
                at[s] = j + 1;
                this.sq[j] = s;
            };
            if (t === PAWN) {
                const back = -FWD[mover];
                const from = s + back;
                const startRank = mover === WHITE ? 1 : 6;
                if (only !== 2 && from >> 3 !== (mover === WHITE ? 0 : 7) && !at[from]) go(from, false);
                if (only !== 1 && s >> 3 === startRank - 2 * (back >> 3) && !at[from] && !at[from + back]) go(from + back, true);
                continue;
            }
            if (only === 2) continue;
            if (t === KING || t === KNIGHT) {
                const [AT, TO] = t === KING ? [K_AT, K_TO] : [N_AT, N_TO];
                for (let i = AT[s]; i < AT[s + 1]; i++) if (!at[TO[i]]) go(TO[i], false);
            } else {
                const d0 = t === BISHOP ? 4 : 0;
                const d1 = t === ROOK ? 4 : 8;
                for (let d = d0; d < d1; d++)
                    for (let i = RAY_AT[s * 8 + d]; i < RAY_AT[s * 8 + d + 1]; i++) {
                        if (at[RAY_TO[i]]) break;
                        go(RAY_TO[i], false);
                    }
            }
        }
    }
}

// states of a node during the build
const UNRES = 0;
const WIN = 1;
const LOSS = 2;
const DRAW_ST = 3;
const ILL = 4;
const DUP = 5;
const NO_LOSS = 255; // emax: a capture or promotion that draws or wins, so the node cannot be lost
const NONE = 255;

// a growable list of node numbers
class List {
    constructor(cap = 1024) {
        this.a = new Int32Array(cap);
        this.n = 0;
    }
    push(x) {
        if (this.n === this.a.length) {
            const b = new Int32Array(this.a.length * 2);
            b.set(this.a);
            this.a = b;
        }
        this.a[this.n++] = x;
    }
}

// the value (plies, for the side to move in the child) of a child that left the table, through its smaller table
const X_COL = new Int8Array(8);
const X_TYP = new Int8Array(8);
const X_SQ = new Int8Array(8);
function exitValue(bd, stm, getTable) {
    let n = 0;
    for (let j = 0; j < bd.n; j++)
        if (bd.alive[j]) {
            X_COL[n] = bd.col[j];
            X_TYP[n] = bd.typ[j];
            X_SQ[n] = bd.sq[j];
            n++;
        }
    const info = materialOf(X_COL, X_TYP, n);
    if (info.trivial) return 0;
    const table = getTable(info.key);
    if (!table) throw new Error(`endgame/tb-generate: the table ${info.key} is needed first`);
    const v = table[info.layout.indexOf(info.flip, X_COL, X_TYP, X_SQ, n, stm)];
    if (v === ILLEGAL) throw new Error(`endgame/tb-generate: an illegal entry of ${info.key} was reached`);
    return v;
}

/**
 * Build the table of a key by retrograde analysis. getTable(key) gives the smaller tables that captures and promotions
 * lead to (all of tbDependencies(key)); onProgress({key, phase, done, total}) reports the work. Returns an Int8Array in
 * the encoding of tb-index.
 */
export function buildTable(key, getTable, onProgress = null) {
    const L = layoutOf(key);
    if (!L) throw new Error(`endgame/tb-generate: no table for ${key}`);
    const SIZE = L.size;
    const n = L.n;
    let whitePawn = false;
    let blackPawn = false;
    for (let j = 0; j < n; j++) if (L.type[j] === PAWN) L.color[j] ? (blackPawn = true) : (whitePawn = true);
    const withEp = whitePawn && blackPawn;
    const NODES = withEp ? 2 * SIZE : SIZE;
    const st = new Uint8Array(NODES);
    const pl = new Uint8Array(NODES);
    const cnt = new Uint8Array(NODES);
    const emax = new Uint8Array(NODES);
    const hasAux = withEp ? new Uint8Array(SIZE) : null;
    const winsAt = [];
    const lossesAt = [];
    const levels = [new List(1 << 16)];
    const at = (lists, d) => (lists[d] ??= new List());
    const bd = new Board();
    const sqs = new Int8Array(8);
    const moves = new Int32Array(256);
    const kids = new Int32Array(256);
    const report = (phase, done, total) => onProgress && onProgress({ key, phase, done, total });
    const STEP_REPORT = 1 << 20;

    // forwards: the children of every entry
    for (let i = 0; i < SIZE; i++) {
        if ((i & (STEP_REPORT - 1)) === 0) report('init', i, SIZE);
        const stm = L.decode(i, sqs);
        if (!bd.load(L.color, L.type, sqs, n) || bd.kingAttacked(stm ^ 1)) {
            st[i] = ILL;
            continue;
        }
        if (L.canon(sqs, stm) !== i) {
            st[i] = DUP;
            continue;
        }
        const inCheck = bd.kingAttacked(stm);
        const count = bd.moves(stm, moves);
        let legal = 0;
        let nk = 0;
        let ewin = NONE;
        let emx = 0;
        let draw = false;
        for (let k = 0; k < count; k++) {
            const m = moves[k];
            const from = bd.make(m);
            if (!bd.kingAttacked(stm)) {
                legal++;
                if ((m >> M_CAP) & 7 || (m >> 9) & 7) {
                    const v = exitValue(bd, stm ^ 1, getTable);
                    if (v === 0) draw = true;
                    else if (v > 0) emx = Math.max(emx, 2 * v);
                    else {
                        const w = v === MATED ? 1 : -2 * v + 1;
                        if (w < ewin) ewin = w;
                    }
                } else {
                    let child = L.canon(bd.sq, stm ^ 1);
                    if (withEp && m & M_DOUBLE && bd.enPassant(stm ^ 1)) child += SIZE;
                    let seen = false;
                    for (let q = 0; q < nk; q++)
                        if (kids[q] === child) {
                            seen = true;
                            break;
                        }
                    if (!seen) kids[nk++] = child;
                }
            }
            bd.undo(m, from);
        }
        const settle = (x, nLegal, ewinX, emaxX, drawX) => {
            if (nLegal === 0) {
                if (inCheck) {
                    st[x] = LOSS;
                    pl[x] = 0;
                    levels[0].push(x);
                } else st[x] = DRAW_ST;
                return;
            }
            cnt[x] = nk;
            const noLoss = drawX || ewinX !== NONE;
            emax[x] = noLoss ? NO_LOSS : emaxX;
            if (ewinX !== NONE) at(winsAt, ewinX).push(x);
            if (nk === 0 && !noLoss) at(lossesAt, emaxX).push(x);
        };
        settle(i, legal, ewin, emx, draw);
        if (withEp) {
            // the same board right after the enemy pawn's double step: the en passant capture is one more move
            const ep = bd.enPassant(stm);
            if (ep) {
                hasAux[i] = 1;
                const from = bd.makeEp(ep);
                const v = exitValue(bd, stm ^ 1, getTable);
                bd.undoEp(ep, from);
                let aw = ewin;
                let am = emx;
                let ad = draw;
                if (v === 0) ad = true;
                else if (v > 0) am = Math.max(am, 2 * v);
                else aw = Math.min(aw, v === MATED ? 1 : -2 * v + 1);
                settle(SIZE + i, legal + 1, aw, am, ad);
            }
        }
    }
    report('init', SIZE, SIZE);

    // backwards, level by level
    const preds = new Int32Array(512);
    let np = 0;
    let level = 0;
    let curStm = 0;
    const visit = () => {
        let p = L.canon(bd.sq, curStm ^ 1);
        for (let r = 0; r < 2; r++) {
            let seen = false;
            for (let q = 0; q < np; q++)
                if (preds[q] === p) {
                    seen = true;
                    break;
                }
            if (!seen) preds[np++] = p;
            if (!withEp || p >= SIZE || !hasAux[p]) break;
            p += SIZE;
        }
    };
    let resolved = 0;
    for (level = 0; ; level++) {
        if (level > 2 * MAX_DTM) throw new Error(`endgame/tb-generate: ${key} is deeper than the value byte holds`);
        const cur = (levels[level] ??= new List());
        for (const [lists, state] of [
            [winsAt, WIN],
            [lossesAt, LOSS],
        ]) {
            const l = lists[level];
            if (!l) continue;
            for (let q = 0; q < l.n; q++) {
                const x = l.a[q];
                if (st[x] !== UNRES) continue;
                st[x] = state;
                pl[x] = level;
                cur.push(x);
            }
            lists[level] = null;
        }
        const next = (levels[level + 1] ??= new List());
        if (cur.n === 0 && next.n === 0 && !winsAt.some((l, d) => l && d > level) && !lossesAt.some((l, d) => l && d > level)) break;
        for (let q = 0; q < cur.n; q++) {
            const x = cur.a[q];
            const base = x >= SIZE ? x - SIZE : x;
            curStm = L.decode(base, sqs);
            bd.load(L.color, L.type, sqs, n);
            np = 0;
            bd.predecessors(curStm, x >= SIZE ? 2 : withEp && hasAux[base] ? 1 : 0, visit);
            const lost = st[x] === LOSS;
            for (let r = 0; r < np; r++) {
                const p = preds[r];
                if (st[p] !== UNRES) continue;
                if (lost) {
                    st[p] = WIN;
                    pl[p] = level + 1;
                    next.push(p);
                } else if (emax[p] !== NO_LOSS && --cnt[p] === 0) {
                    const d = Math.max(level + 1, emax[p]);
                    if (d === level + 1) {
                        st[p] = LOSS;
                        pl[p] = d;
                        next.push(p);
                    } else at(lossesAt, d).push(p);
                }
            }
        }
        resolved += cur.n;
        levels[level] = null;
        report('retro', level, resolved);
    }

    // the value bytes, canonical entries first, then the copies
    const out = new Int8Array(SIZE);
    for (let i = 0; i < SIZE; i++) {
        const s = st[i];
        if (s === WIN) out[i] = (pl[i] + 1) >> 1;
        else if (s === LOSS) out[i] = pl[i] === 0 ? MATED : -(pl[i] >> 1);
        else if (s === ILL) out[i] = ILLEGAL;
    }
    for (let i = 0; i < SIZE; i++) {
        if (st[i] !== DUP) continue;
        const stm = L.decode(i, sqs);
        out[i] = out[L.canon(sqs, stm)];
    }
    report('done', SIZE, SIZE);
    return out;
}

/** Mark the illegal entries of a table read from a file (ILLEGAL, as buildTable leaves them); returns the table. */
export function markIllegal(key, table) {
    const L = layoutOf(key);
    const bd = new Board();
    const sqs = new Int8Array(8);
    for (let i = 0; i < table.length; i++) {
        const stm = L.decode(i, sqs);
        if (!bd.load(L.color, L.type, sqs, L.n) || bd.kingAttacked(stm ^ 1)) table[i] = ILLEGAL;
    }
    return table;
}

// --- checks against Position (for the tests): the moves and the predecessors of a FEN on the direct board

const UCI_PROMO = ' pnbrq';
const name64 = (s) => 'abcdefgh'[s & 7] + ((s >> 3) + 1);

function boardOf(fen) {
    const pos = Position.fromFen(fen);
    const cols = [];
    const types = [];
    const sqs = [];
    for (let sq = 0; sq < 120; sq++) {
        if (sq & 0x88 || !pos.board[sq]) continue;
        cols.push(pos.board[sq] >> 3);
        types.push(pos.board[sq] & 7);
        sqs.push((sq >> 4) * 8 + (sq & 7));
    }
    const bd = new Board();
    bd.load(cols, types, sqs, cols.length);
    return [bd, pos.side];
}

function fenOf(bd, stm) {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
        let row = '';
        let run = 0;
        for (let f = 0; f < 8; f++) {
            const o = bd.at[r * 8 + f];
            if (!o) run++;
            else {
                if (run) row += run;
                run = 0;
                const ch = ' pnbrqk'[bd.typ[o - 1]];
                row += bd.col[o - 1] === WHITE ? ch.toUpperCase() : ch;
            }
        }
        if (run) row += run;
        rows.push(row);
    }
    return `${rows.join('/')} ${stm === WHITE ? 'w' : 'b'} - - 0 1`;
}

/** The legal moves of a FEN (no castling, no en passant square) by the direct board, in UCI. */
export function boardMoves(fen) {
    const [bd, stm] = boardOf(fen);
    const out = new Int32Array(256);
    const count = bd.moves(stm, out);
    const list = [];
    for (let k = 0; k < count; k++) {
        const m = out[k];
        const from = bd.make(m);
        if (!bd.kingAttacked(stm)) list.push(name64(from) + name64((m >> 3) & 63) + ((m >> 9) & 7 ? UCI_PROMO[(m >> 9) & 7] : ''));
        bd.undo(m, from);
    }
    return list;
}

/**
 * The predecessors of a FEN in its table, as FENs (a pawn's double step left out when an enemy pawn could take it en
 * passant: that move leads to the node with the capture, not to this one).
 */
export function boardPredecessors(fen) {
    const [bd, stm] = boardOf(fen);
    const only = bd.enPassant(stm) ? 1 : 0;
    const out = [];
    bd.predecessors(stm, only, () => out.push(fenOf(bd, stm ^ 1)));
    return out;
}
