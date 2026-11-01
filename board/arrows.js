// board/arrows — the SVG drawing of annotations: arrows (straight and knight-shaped), marked squares, circles, badges.
//
// Everything is drawn in a viewBox of 8×8 (one unit per square), seen from the board's orientation. Colors come from
// the k-<kind> classes of the board's stylesheet, so a theme changes them with --sc-arrow-*.
import { parseSquare } from '../src/index.js';

/** The name of each badge glyph, for its color class and its spoken label (board.glyph.<name>). */
export const GLYPH_NAMES = Object.freeze({
    '!!': 'brilliant',
    '!': 'good',
    '!?': 'interesting',
    '?!': 'dubious',
    '?': 'mistake',
    '??': 'blunder',
    '#': 'mate',
    '+': 'check',
});

const BADGE_COLORS = {
    brilliant: '#1f9e89',
    good: '#5b8f2f',
    interesting: '#8a63d2',
    dubious: '#c9930f',
    mistake: '#e0712a',
    blunder: '#d23b30',
    mate: '#2b2824',
    check: '#2b2824',
};

const SHAFT = 0.085; // half the width of an arrow's shaft
const HEAD_LENGTH = 0.36;
const HEAD_HALF = 0.235;
const TIP_BACK = 0.08; // the tip stops a little before the center of the target square

const r3 = (x) => Math.round(x * 1000) / 1000;

/** The column and row (0..7, from the top left as drawn) of a square name. */
export function cellOf(name, orientation) {
    const sq = parseSquare(name);
    const file = sq & 7;
    const rank = sq >> 4;
    return orientation === 'black' ? [7 - file, rank] : [file, 7 - rank];
}

const center = (name, orientation) => {
    const [c, r] = cellOf(name, orientation);
    return [c + 0.5, r + 0.5];
};

/** One arrow: a shaft (straight, or bent like a knight's move) and a head, both in the color of its kind. */
export function arrowSvg({ from, to, kind }, orientation, extra = '') {
    const [x0, y0] = center(from, orientation);
    const [x1, y1] = center(to, orientation);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const knight = (Math.abs(dx) === 1 && Math.abs(dy) === 2) || (Math.abs(dx) === 2 && Math.abs(dy) === 1);
    // the points of the shaft: start, (the bend of a knight's move), and where the head begins
    const pts = [[x0, y0]];
    let lx = x0;
    let ly = y0;
    if (knight) {
        const bend = Math.abs(dx) > Math.abs(dy) ? [x1, y0] : [x0, y1];
        pts.push(bend);
        [lx, ly] = bend;
    }
    const len = Math.hypot(x1 - lx, y1 - ly);
    const ux = (x1 - lx) / len;
    const uy = (y1 - ly) / len;
    const tipX = x1 - ux * TIP_BACK;
    const tipY = y1 - uy * TIP_BACK;
    const baseX = tipX - ux * HEAD_LENGTH;
    const baseY = tipY - uy * HEAD_LENGTH;
    pts.push([baseX + ux * 0.02, baseY + uy * 0.02]); // a hair under the head, so no seam shows
    const shaft = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${r3(x)} ${r3(y)}`).join('');
    const head = [
        [tipX, tipY],
        [baseX - uy * HEAD_HALF, baseY + ux * HEAD_HALF],
        [baseX + uy * HEAD_HALF, baseY - ux * HEAD_HALF],
    ]
        .map(([x, y]) => `${r3(x)},${r3(y)}`)
        .join(' ');
    return (
        `<g class="arrow k-${kind}${extra}">` +
        `<path d="${shaft}" style="fill:none;stroke-width:${SHAFT * 2};stroke-linejoin:miter;stroke-linecap:butt"/>` +
        `<polygon points="${head}" style="stroke:none"/></g>`
    );
}

/** Marked squares (annotation squares), drawn under the pieces. */
export function marksSvg(squares, orientation) {
    return squares
        .map(({ sq, kind }) => {
            const [c, r] = cellOf(sq, orientation);
            return `<rect class="mark k-${kind}" x="${c}" y="${r}" width="1" height="1"/>`;
        })
        .join('');
}

/** Circles drawn by the user on squares. */
export function ringsSvg(squares, orientation) {
    return squares
        .map(({ sq, kind }) => {
            const [c, r] = cellOf(sq, orientation);
            return `<circle class="ring k-${kind}" cx="${c + 0.5}" cy="${r + 0.5}" r="0.46"/>`;
        })
        .join('');
}

/** Badges (move glyphs) in the top right corner of their squares. */
export function badgesSvg(badges, orientation) {
    return badges
        .map(({ sq, glyph }) => {
            const [c, r] = cellOf(sq, orientation);
            const name = GLYPH_NAMES[glyph];
            const x = r3(c + 0.82);
            const y = r3(r + 0.18);
            const size = glyph.length > 1 ? 0.19 : 0.23;
            return (
                `<g class="badge g-${name}"><circle cx="${x}" cy="${y}" r="0.17" style="fill:${BADGE_COLORS[name]}"/>` +
                `<text x="${x}" y="${r3(y + 0.005)}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="800" ` +
                `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">${glyph}</text></g>`
            );
        })
        .join('');
}
