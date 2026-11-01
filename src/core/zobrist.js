// core/zobrist — the Zobrist keys: 64-bit values as two int32 halves, from a fixed xorshift32 seed.
//
// Every key is a pair (lo, hi) stored interleaved: Z.piece[(piece * 128 + sq) * 2] is lo, the next entry hi. The
// stream fills Z.piece first (16 piece codes × 128 indices, off-board ones too), then Z.side, Z.castle (one key per
// mask of rights 0..15) and Z.ep (one key per file).
//
// xorshift32 is linear over GF(2): taken raw, each hi would be a fixed linear map of its lo, the XOR of any keys would
// keep that relation, and the 64-bit hash would carry only 32 bits. Each output therefore goes through a non-linear
// finalizer (multiply–xorshift, the "lowbias32" mix), and the keys span all 64 dimensions (tested).

const SEED = 0x9e3779b9;

function keys() {
    let x = SEED | 0;
    const next = () => {
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        let y = Math.imul(x ^ (x >>> 16), 0x7feb352d);
        y = Math.imul(y ^ (y >>> 15), 0x846ca68b);
        return (y ^ (y >>> 16)) | 0;
    };
    const fill = (n) => {
        const a = new Int32Array(n);
        for (let i = 0; i < n; i++) a[i] = next();
        return a;
    };
    const piece = fill(16 * 128 * 2);
    const side = fill(2);
    const castle = fill(16 * 2);
    const ep = fill(8 * 2);
    return Object.freeze({ piece, side, castle, ep });
}

/** The keys: piece (16 × 128 × 2), side (2), castle (16 × 2), ep (8 × 2). */
export const Z = keys();
