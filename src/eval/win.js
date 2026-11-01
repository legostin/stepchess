// eval/win — the chance to win from a score: 1 / (1 + e^(−K·cp)), with the slope K of the weights.
import { W } from './weights.js';

/** The win chance (0..1) of the side a score in centipawns belongs to. */
export const winChance = (cp) => 1 / (1 + Math.exp(-W.K * cp));

/** White's win chance from a trace. */
export const winChanceWhite = (trace) => winChance(trace.total);
