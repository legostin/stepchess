// core/attacks — who attacks a square: the direct attackers, the sliders behind the first piece of a line, and the attack maps.
//
// Attackers are looked up on the board as it stands; the piece on the asked square itself never counts, so the same
// call answers "who defends this piece" and "who attacks this empty square". Squares come back in ascending order.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING } from './pieces.js';
import { KNIGHT_STEPS, KING_STEPS, ROOK_DIRS, BISHOP_DIRS } from './position.js';

const KN = new Int8Array(KNIGHT_STEPS);
const KG = new Int8Array(KING_STEPS);
const RD = new Int8Array(ROOK_DIRS);
const BD = new Int8Array(BISHOP_DIRS);

const byValue = (a, b) => a - b;

/**
 * The squares of the pieces of the color that attack the square, each one directly (a slider with nothing between it and
 * the square). A pinned piece still attacks; the king counts as an attacker.
 */
export function attackersOf(pos, sq, color) {
    const b = pos.board;
    const c = color << 3;
    const out = [];
    // a white pawn on s attacks s + 15 and s + 17, so the attackers of sq stand at sq - 17 and sq - 15
    const back = color === 0 ? -16 : 16;
    for (const s of [sq + back - 1, sq + back + 1]) if ((s & 0x88) === 0 && b[s] === (c | PAWN)) out.push(s);
    for (let i = 0; i < 8; i++) {
        const s = sq + KN[i];
        if ((s & 0x88) === 0 && b[s] === (c | KNIGHT)) out.push(s);
    }
    for (let i = 0; i < 8; i++) {
        const s = sq + KG[i];
        if ((s & 0x88) === 0 && b[s] === (c | KING)) out.push(s);
    }
    for (let i = 0; i < 4; i++) {
        const d = RD[i];
        for (let s = sq + d; (s & 0x88) === 0; s += d) {
            const p = b[s];
            if (!p) continue;
            if (p === (c | ROOK) || p === (c | QUEEN)) out.push(s);
            break;
        }
    }
    for (let i = 0; i < 4; i++) {
        const d = BD[i];
        for (let s = sq + d; (s & 0x88) === 0; s += d) {
            const p = b[s];
            if (!p) continue;
            if (p === (c | BISHOP) || p === (c | QUEEN)) out.push(s);
            break;
        }
    }
    return out.sort(byValue);
}

/**
 * The sliders of the color that would attack the square if the first piece on their line (of either color) were gone:
 * the second piece on a line from the square, when it is a rook or queen on a rank or file, or a bishop or queen on a
 * diagonal. One piece deep: a third piece behind two is not listed. A direct attacker is never listed here.
 */
export function xrayAttackersOf(pos, sq, color) {
    const b = pos.board;
    const c = color << 3;
    const out = [];
    for (let i = 0; i < 8; i++) {
        const d = i < 4 ? RD[i] : BD[i - 4];
        const own = i < 4 ? c | ROOK : c | BISHOP;
        let s = sq + d;
        while ((s & 0x88) === 0 && !b[s]) s += d;
        if (s & 0x88) continue;
        s += d;
        while ((s & 0x88) === 0 && !b[s]) s += d;
        if (s & 0x88) continue;
        const p = b[s];
        if (p === own || p === (c | QUEEN)) out.push(s);
    }
    return out.sort(byValue);
}

/**
 * The attacks of both colors on every square, the occupied ones included (a defended piece counts as attacked by its
 * friends): {count: [white, black], least: [white, black]}. count is the number of direct attackers; least is the type
 * of the least valuable attacker (PAWN < KNIGHT < BISHOP < ROOK < QUEEN < KING), 0 where there is none. Indexed by
 * 0x88 square. Allocates its result.
 */
export function attackMaps(pos) {
    const b = pos.board;
    const count = [new Uint8Array(128), new Uint8Array(128)];
    const least = [new Int8Array(128), new Int8Array(128)];
    const mark = (color, s, type) => {
        count[color][s]++;
        const l = least[color][s];
        if (l === 0 || type < l) least[color][s] = type;
    };
    for (let from = 0; from < 128; from++) {
        if (from & 0x88) {
            from += 7;
            continue;
        }
        const p = b[from];
        if (!p) continue;
        const color = p >> 3;
        const type = p & 7;
        if (type === PAWN) {
            const up = color === 0 ? 16 : -16;
            if (((from + up - 1) & 0x88) === 0) mark(color, from + up - 1, PAWN);
            if (((from + up + 1) & 0x88) === 0) mark(color, from + up + 1, PAWN);
        } else if (type === KNIGHT || type === KING) {
            const steps = type === KNIGHT ? KN : KG;
            for (let i = 0; i < 8; i++) {
                const s = from + steps[i];
                if ((s & 0x88) === 0) mark(color, s, type);
            }
        } else {
            const first = type === BISHOP ? 4 : 0;
            const last = type === ROOK ? 4 : 8;
            for (let i = first; i < last; i++) {
                const d = i < 4 ? RD[i] : BD[i - 4];
                for (let s = from + d; (s & 0x88) === 0; s += d) {
                    mark(color, s, type);
                    if (b[s]) break;
                }
            }
        }
    }
    return { count, least };
}
