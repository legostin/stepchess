// endgame/tb — the tables in memory: loading (data/tb in Node, fetch in browsers), generation on demand, probe, the best moves, tablebase().
//
// A loaded table is an Int8Array in the encoding of tb-index. Files are read by preloadTables (and by tablebase,
// which also generates what no file holds): in Node from data/tb next to the package through a dynamic node:fs, in
// a browser by fetch from tbUrl (or the same place relative to this module), inflated with DecompressionStream. A
// fetch that takes longer than FETCH_TIMEOUT_MS, and a stream that inflates to more than its header says, count as a
// missing file.
//
// Generation on demand is synchronous: buildTable runs the whole retrograde analysis in one go, with no yield to the
// event loop, and a table no file holds takes from about 2 s (three pieces) to about 85 s (four pieces with a pawn,
// KPKP and the tables below it took about two minutes when TB_SLOW=1 ran the test on a laptop). It blocks the thread it
// runs on, so a page or a server must run generateTable and tablebase for a missing table in a worker and never on the
// main thread; onProgress({key, phase, done, total}) is the only sign of life while it runs.
import {
    Position,
    ChessError,
    legalMoves,
    moveToUci,
    moveFrom,
    moveTo,
    movePromo,
    moveFlags,
    F_CAPTURE,
    PAWN,
    KING,
    pieceToFen,
    sqName,
} from '../core/index.js';
import { msg } from '../i18n/index.js';
import { MAX_PIECES, keyInfo, layoutOf, tbIndex, tbSize, decodeValue, tbDependencies, readHeader } from './tb-index.js';
import { buildTable, markIllegal } from './tb-generate.js';

const TABLES = new Map();
const TRIVIAL = new Set(['KK', 'KBK', 'KNK']);

/** Register a table: the inflated entries of the key (tbSize(key) bytes). Returns false when they do not fit. */
export function loadTable(key, bytes) {
    const size = tbSize(key);
    if (!size || !bytes || bytes.length !== size || !ArrayBuffer.isView(bytes)) return false;
    TABLES.set(key, bytes instanceof Int8Array ? bytes : new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length));
    return true;
}

/** Is the table of the key in memory (the materials nobody can mate with need none)? */
export const hasTable = (key) => TRIVIAL.has(key) || TABLES.has(key);

/** The table of the key in memory, or null. */
export const getTable = (key) => TABLES.get(key) ?? null;

/**
 * Generate the table of the key by retrograde analysis and keep it; the tables it depends on are taken from memory or
 * generated first, recursively. onProgress({key, phase, done, total}) reports each table's work. Returns the table.
 * Synchronous and slow (2 to 85 s for a table with a pawn): it blocks its thread, so call it in a worker (see the top of the file).
 */
export function generateTable(key, { onProgress = null } = {}) {
    if (!layoutOf(key)) return null;
    for (const dep of tbDependencies(key)) if (!hasTable(dep)) generateTable(dep, { onProgress });
    const table = buildTable(key, getTable, onProgress);
    TABLES.set(key, table);
    return table;
}

// --- files

const DATA_DIR = new globalThis.URL('../../data/tb/', import.meta.url);
const NODE_FS = 'node:fs'; // named by a variable: a bundler for browsers has nothing to resolve

/** How long a fetch of a table file may take, in milliseconds, before the table counts as missing. */
export const FETCH_TIMEOUT_MS = 30000;

// the signal that ends a fetch after FETCH_TIMEOUT_MS (none where AbortSignal.timeout does not exist)
const timeout = () => (typeof globalThis.AbortSignal?.timeout === 'function' ? globalThis.AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined);

/**
 * A deflate stream inflated to exactly size bytes, or null: a broken stream, a shorter one, or one that holds more,
 * which is not inflated beyond size + one chunk (a file from a wrong server cannot fill the memory).
 * @param {Uint8Array} bytes
 * @param {number} size
 * @returns {Promise<Uint8Array | null>}
 */
export async function inflateExactly(bytes, size) {
    const out = new Uint8Array(size);
    let n = 0;
    try {
        const reader = new globalThis.Blob([bytes]).stream().pipeThrough(new globalThis.DecompressionStream('deflate')).getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (n + value.length > size) {
                reader.cancel().catch(() => {});
                return null;
            }
            out.set(value, n);
            n += value.length;
        }
    } catch {
        return null;
    }
    return n === size ? out : null;
}

// the bytes of data/tb/<key>.bin (or <tbUrl><key>.bin), or null when there is no such file
async function readFile(key, tbUrl) {
    try {
        // tbUrl: a directory, absolute or relative to the page (or to this module where there is no page)
        const dir = tbUrl ? new globalThis.URL(String(tbUrl).replace(/\/?$/, '/'), globalThis.location?.href ?? DATA_DIR) : DATA_DIR;
        const url = new globalThis.URL(`${key}.bin`, dir);
        if (url.protocol === 'file:') {
            const fs = await import(/* @vite-ignore */ NODE_FS);
            return new Uint8Array(await fs.promises.readFile(url));
        }
        const res = await globalThis.fetch(url, { signal: timeout() });
        return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
    } catch {
        return null;
    }
}

/** Read one table file (header, deflate) and register it; false when the file is missing or does not fit. */
async function loadFile(key, tbUrl) {
    const bytes = await readFile(key, tbUrl);
    const head = bytes && readHeader(bytes);
    if (!head || head.key !== key) return false;
    const table = await inflateExactly(bytes.subarray(head.offset), head.size);
    if (!table) return false;
    return loadTable(key, markIllegal(key, new Int8Array(table.buffer, table.byteOffset, table.length)));
}

/**
 * Load the files of the keys that are not in memory yet. Resolves to {loaded, missing} (keys).
 * @param {string[]} keys
 * @param {{tbUrl?: string}} [opts]
 * @returns {Promise<{loaded: string[], missing: string[]}>}
 */
export async function preloadTables(keys, { tbUrl } = {}) {
    const loaded = [];
    const missing = [];
    for (const key of keys) {
        if (hasTable(key)) continue;
        ((await loadFile(key, tbUrl)) ? loaded : missing).push(key);
    }
    return { loaded, missing };
}

// a table in memory, from its file or generated (its dependencies first, the same way)
async function ensure(key, tbUrl, onProgress) {
    if (hasTable(key) || (await loadFile(key, tbUrl))) return;
    for (const dep of tbDependencies(key)) await ensure(dep, tbUrl, onProgress);
    TABLES.set(key, buildTable(key, getTable, onProgress));
}

// --- probing

const pieceCount = (pos) => {
    let n = 0;
    for (let i = 0; i < 16; i++) n += pos.counts[i];
    return n;
};

// a value as one number to compare, higher is better for the side to move: a mate sooner, a loss later
const rank = (v) => (v.wdl > 0 ? 1000 - v.dtm : v.wdl < 0 ? -1000 - v.dtm : 0);

// the value of a child (for its side to move) for the side that made the move
const parentView = (c) => (c.wdl < 0 ? { wdl: 1, dtm: 1 - c.dtm } : c.wdl > 0 ? { wdl: -1, dtm: -c.dtm } : { wdl: 0, dtm: 0 });

/**
 * The exact value of a position of at most MAX_PIECES pieces whose table is loaded: {wdl: −1 | 0 | 1, dtm} for the
 * side to move (dtm in moves: +n mates in n, −n is mated in n, 0 with wdl −1 when checkmated), or null (more pieces,
 * a table not in memory, castling rights). An en passant square is answered by looking one move ahead.
 */
export function probe(pos) {
    if (pieceCount(pos) > MAX_PIECES || pos.castling) return null;
    if (pos.ep !== -1) {
        const moves = legalMoves(pos);
        if (!moves.length) return pos.inCheck() ? { wdl: -1, dtm: 0 } : { wdl: 0, dtm: 0 };
        let best = null;
        for (const m of moves) {
            pos.make(m);
            const c = probe(pos);
            pos.unmake();
            if (!c) return null;
            const v = parentView(c);
            if (!best || rank(v) > rank(best)) best = v;
        }
        return best;
    }
    const info = keyInfo(pos);
    if (info.trivial) return { wdl: 0, dtm: 0 };
    const table = TABLES.get(info.key);
    if (!table) return null;
    return decodeValue(table[tbIndex(info.key, pos)]);
}

const PIECE_LETTER = (pos, sq) => pieceToFen(pos.board[sq] & 7).toUpperCase();

// SAN of a legal move: piece letter, the file or rank that tells two such pieces apart, x, =Q, + or #
function san(pos, m, moves) {
    const from = moveFrom(m);
    const to = moveTo(m);
    const type = pos.board[from] & 7;
    const capture = moveFlags(m) & F_CAPTURE;
    let out;
    if (type === PAWN) out = capture ? `${sqName(from)[0]}x` : '';
    else {
        out = PIECE_LETTER(pos, from);
        if (type !== KING) {
            const rivals = moves.filter((o) => o !== m && moveTo(o) === to && (pos.board[moveFrom(o)] & 7) === type).map(moveFrom);
            if (rivals.length) {
                const f = sqName(from)[0];
                const r = sqName(from)[1];
                if (!rivals.some((s) => sqName(s)[0] === f)) out += f;
                else if (!rivals.some((s) => sqName(s)[1] === r)) out += r;
                else out += f + r;
            }
        }
        if (capture) out += 'x';
    }
    out += sqName(to);
    if (movePromo(m)) out += `=${pieceToFen(movePromo(m)).toUpperCase()}`;
    pos.make(m);
    if (pos.inCheck()) out += legalMoves(pos).length ? '+' : '#';
    pos.unmake();
    return out;
}

// every legal move with its value for the side to move, best first; null when a child cannot be probed
function rankedMoves(pos) {
    const moves = legalMoves(pos);
    const out = [];
    for (const m of moves) {
        pos.make(m);
        const c = probe(pos);
        pos.unmake();
        if (!c) return null;
        const v = parentView(c);
        out.push({ uci: moveToUci(m), san: san(pos, m, moves), wdl: v.wdl, dtm: v.dtm });
    }
    return out.sort((a, b) => rank(b) - rank(a));
}

/**
 * The moves that keep the exact result at the best distance: the quickest mates, every drawing move, the longest
 * defences. [{uci, san, dtm}] (dtm for the side to move after playing it, as probe gives), [] when the game is over,
 * null when a table is missing.
 */
export function bestTbMoves(pos) {
    if (pieceCount(pos) > MAX_PIECES || pos.castling) return null;
    const ranked = rankedMoves(pos);
    if (!ranked) return null;
    return ranked.filter((v) => rank(v) === rank(ranked[0])).map(({ uci, san: s, dtm }) => ({ uci, san: s, dtm }));
}

const fail = (code, reason) => ({ ok: false, kind: 'invalid', code, reason });

/**
 * The tablebase answer for a FEN of at most MAX_PIECES pieces: {ok: true, kind: 'tablebase', key, wdl, dtm, moves}
 * with every legal move ranked best first ({uci, san, wdl, dtm}, for the side to move), loading the tables it needs
 * from tbUrl or data/tb and generating those no file holds. On failure {ok: false, kind: 'invalid', code, reason}:
 * code 'fen', 'too-many-pieces' or 'castling' (rights the tables do not model). Never throws on its input.
 * A table no file holds is generated here, synchronously, in 2 to 85 s: run this in a worker, not on the main thread.
 * @param {string} fen
 * @param {{tbUrl?: string, onProgress?: ((p: {key: string, phase: string, done: number, total: number}) => void) | null}} [opts]
 */
export async function tablebase(fen, { tbUrl, onProgress = null } = {}) {
    let pos;
    try {
        pos = Position.fromFen(fen);
    } catch (e) {
        // a ChessError says what is wrong with the FEN; anything else is still a 'fen' result, never a throw
        return fail('fen', msg('endgame.tb.fen', { detail: e instanceof ChessError && e.text ? e.text : msg('endgame.tb.unreadable') }));
    }
    const count = pieceCount(pos);
    if (count > MAX_PIECES) return fail('too-many-pieces', msg('endgame.tb.too-many-pieces', { count, max: MAX_PIECES }));
    if (pos.castling) return fail('castling', msg('endgame.tb.castling'));
    const { key } = keyInfo(pos);
    await ensure(key, tbUrl, onProgress);
    for (const dep of tbDependencies(key)) await ensure(dep, tbUrl, onProgress);
    const value = probe(pos);
    const moves = rankedMoves(pos);
    return { ok: true, kind: 'tablebase', key, wdl: value.wdl, dtm: value.dtm, moves };
}
