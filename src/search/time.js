// search/time — the time manager: how long to think on a move with a clock, as a soft limit (no new iteration after it) and a hard one (stop at once).

/**
 * The time for a move of the side (0 White, 1 Black) from the clock, in milliseconds: soft = remaining / 30 +
 * increment · 0.75 (remaining / movestogo when fewer than 30 moves are left to the control), hard = min(soft · 4,
 * remaining / 4); the soft limit never exceeds the hard one. null when the side's remaining time is not given.
 * @param {{wtime?: number, btime?: number, winc?: number, binc?: number, movestogo?: number}} clock
 * @param {number} side
 * @returns {{soft: number, hard: number} | null}
 */
export function allocate(clock, side) {
    const c = clock && typeof clock === 'object' ? clock : {};
    const remaining = side === 1 ? c.btime : c.wtime;
    if (typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0) return null;
    const incRaw = side === 1 ? c.binc : c.winc;
    const inc = typeof incRaw === 'number' && Number.isFinite(incRaw) && incRaw > 0 ? incRaw : 0;
    const togo = typeof c.movestogo === 'number' && c.movestogo >= 1 ? Math.min(30, Math.floor(c.movestogo)) : 30;
    const soft = remaining / togo + inc * 0.75;
    const hard = Math.max(1, Math.floor(Math.min(soft * 4, remaining / 4)));
    return { soft: Math.max(1, Math.min(Math.floor(soft), hard)), hard };
}
