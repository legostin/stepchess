// core/move — a move packed in one 32-bit integer: from, to, promotion type and flags; UCI text.
//
//   bits 0..6 from (0x88 square) · 7..13 to · 14..16 promotion piece type · 17..20 flags

import { sqName } from './squares.js';

export const NO_MOVE = 0;
export const F_CAPTURE = 1;
export const F_EP = 2;
export const F_CASTLE = 4;
export const F_DOUBLE = 8;

/** A move from its parts. */
export const encodeMove = (from, to, flags = 0, promo = 0) => from | (to << 7) | (promo << 14) | (flags << 17);
export const moveFrom = (m) => m & 127;
export const moveTo = (m) => (m >> 7) & 127;
export const movePromo = (m) => (m >> 14) & 7;
export const moveFlags = (m) => (m >> 17) & 15;

const PROMO = '  nbrq';

/** The move in UCI: 'e2e4', 'e7e8q'; castling is the king's move, 'e1g1'. */
export function moveToUci(m) {
    const promo = (m >> 14) & 7;
    return sqName(m & 127) + sqName((m >> 7) & 127) + (promo ? PROMO[promo] : '');
}
