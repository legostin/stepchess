// search/tt — the transposition table: one Int32Array of 4-entry buckets, each entry the key, the move, the packed score/depth/bound/age and the static eval.
//
// A bucket is 16 int32s (64 bytes): 4 entries of [key, move, data, eval]. The bucket is chosen by the low half of the
// 64-bit Zobrist hash and an entry is recognised by the high half. data packs the score (16 bits, signed), the depth
// (8 bits; 0 is a quiescence entry), the bound (2 bits) and the search's age (6 bits); a stored entry always has a bound,
// so data 0 marks an empty slot. A new position takes the slot of its own key, else an empty one, else the one with the
// least depth, older searches counting as shallower. Mate scores are stored as distances from the node, not the root.

/** Bounds: the score is at most (UPPER), at least (LOWER) or exactly (EXACT) the true value. */
export const BOUND_UPPER = 1;
export const BOUND_LOWER = 2;
export const BOUND_EXACT = 3;

/** The static eval of an entry stored in check (no eval). */
export const NO_EVAL = -32768;

const ENTRY = 4;
const BUCKET = 16;

export class TT {
    /** A table of about hashMb megabytes (rounded down to a power-of-two number of buckets; 1 … 2048 MB). */
    constructor(hashMb = 16) {
        const mb = Number.isFinite(hashMb) ? Math.min(2048, Math.max(1, hashMb)) : 16;
        let buckets = 1;
        while (buckets * 2 * BUCKET * 4 <= mb * 1048576) buckets *= 2;
        this.data = new Int32Array(buckets * BUCKET);
        this.mask = buckets - 1;
        this.age = 0;
        // what the last probe found (entry fields), valid when probe returned true
        this.move = 0;
        this.score = 0;
        this.depth = 0;
        this.bound = 0;
        this.eval = NO_EVAL;
    }

    /** Forget everything. */
    clear() {
        this.data.fill(0);
        this.age = 0;
    }

    /** A new search: entries of earlier ones become cheaper to replace. */
    newSearch() {
        this.age = (this.age + 1) & 63;
    }

    /** Look the position up; true and the fields (move, score, depth, bound, eval) set when found. */
    probe(lo, hi) {
        const d = this.data;
        const base = (lo & this.mask) * BUCKET;
        for (let i = base; i < base + BUCKET; i += ENTRY) {
            const packed = d[i + 2];
            if (packed !== 0 && d[i] === hi) {
                this.move = d[i + 1];
                this.score = (packed << 16) >> 16;
                this.depth = (packed >>> 16) & 255;
                this.bound = (packed >>> 24) & 3;
                this.eval = d[i + 3];
                return true;
            }
        }
        return false;
    }

    /** Store a result: the move may be 0 (the old one is kept for the same position). */
    store(lo, hi, move, score, depth, bound, ev) {
        const d = this.data;
        const base = (lo & this.mask) * BUCKET;
        const age = this.age;
        let slot = -1;
        let worst = 0x7fffffff;
        for (let i = base; i < base + BUCKET; i += ENTRY) {
            const packed = d[i + 2];
            if (packed === 0) {
                // an empty slot is worth less than any entry (whose value is at least -8 * 63)
                if (worst > -1000) {
                    slot = i;
                    worst = -1000;
                }
                continue;
            }
            if (d[i] === hi) {
                // the same position: keep a deeper result of this search unless the new one is exact
                const oldDepth = (packed >>> 16) & 255;
                if (bound !== BOUND_EXACT && depth + 3 < oldDepth && packed >>> 26 === age) {
                    if (move && !d[i + 1]) d[i + 1] = move;
                    return;
                }
                if (!move) move = d[i + 1];
                slot = i;
                break;
            }
            const value = ((packed >>> 16) & 255) - 8 * ((age - (packed >>> 26)) & 63);
            if (value < worst) {
                worst = value;
                slot = i;
            }
        }
        const dep = depth < 0 ? 0 : depth > 255 ? 255 : depth;
        d[slot] = hi;
        d[slot + 1] = move;
        d[slot + 2] = (score & 0xffff) | (dep << 16) | (bound << 24) | (age << 26);
        d[slot + 3] = ev;
    }

    /** How full the table is, per mille, from the first 1000 buckets' entries of this search. */
    hashfull() {
        const d = this.data;
        const buckets = Math.min(1000, this.mask + 1);
        let used = 0;
        for (let i = 0; i < buckets * BUCKET; i += ENTRY) if (d[i + 2] !== 0 && d[i + 2] >>> 26 === this.age) used++;
        return Math.round((used * 1000) / (buckets * 4));
    }
}
