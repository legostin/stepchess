// board/pieces — the stepchess piece set: twelve SVG pieces (viewBox 0 0 45 45) drawn for this project.
//
// Every piece is a silhouette of filled parts on a shared two-step plinth, plus seams (thin lines between the parts)
// and dots. The colors are CSS custom properties, so a theme recolors the set without touching the drawing:
//   --sc-white-fill, --sc-white-stroke, --sc-white-detail, --sc-black-fill, --sc-black-stroke, --sc-black-detail.
// On black pieces the seams are drawn in the light detail color, so the parts stay readable on a dark body.

// the plinth every piece but the pawn stands on, and the pawn's narrower one
const PLINTH = '<path d="M10 39.5h25a2 2 0 0 0 2-2v-.5a2.5 2.5 0 0 0-2.5-2.5h-24A2.5 2.5 0 0 0 8 37v.5a2 2 0 0 0 2 2z"/>';
const PLINTH_SEAM = 'M11 37.25h23';
const PAWN_PLINTH = '<path d="M13 39.5h19a2 2 0 0 0 2-2v-.5a2.5 2.5 0 0 0-2.5-2.5h-18A2.5 2.5 0 0 0 11 37v.5a2 2 0 0 0 2 2z"/>';

/** The drawing of each piece type: body parts (filled, outlined), seams (lines), dots (filled with the detail color). */
export const DRAWINGS = Object.freeze({
    p: {
        body: [
            '<path d="M15.5 34.5c.4-5.4 3.2-8.6 4.6-12h4.8c1.4 3.4 4.2 6.6 4.6 12z"/>',
            PAWN_PLINTH,
            '<rect x="16.5" y="19" width="12" height="3.5" rx="1.75"/>',
            '<circle cx="22.5" cy="12.75" r="5.75"/>',
        ],
        seams: ['M14 37.25h17', 'M18.2 19.05h8.6', 'M18.2 22.45h8.6'],
        dots: [],
    },
    n: {
        body: [
            '<path d="M12.5 34.5c-.3-5.2 2.4-8.6 6.4-11.3-2.3.2-4.4 1-6.6 2.4-1.6 1-3.6.5-4.3-1.1-.6-1.4-.3-2.8.8-4L16 12.6c.3-2.2.9-4.3 1.9-6.3l2.9 3.1c7.2-.4 13 4.9 13.5 13.2.2 4.2-.4 8.1-1.3 11.9z"/>',
            PLINTH,
        ],
        seams: [PLINTH_SEAM, 'M21.7 11.9c5.6.6 9.4 4.9 9.7 11.3', 'M18.9 23.2c1.5-.9 2.6-2 3.2-3.4'],
        dots: ['<circle cx="16.1" cy="15.4" r="1.25"/>', '<circle cx="10.3" cy="22.4" r=".85"/>'],
    },
    b: {
        body: [
            '<path d="M15.5 34.5c.5-4.3 3-6.9 3.6-9.5h6.8c.6 2.6 3.1 5.2 3.6 9.5z"/>',
            PLINTH,
            '<rect x="16" y="22.5" width="13" height="3.25" rx="1.6"/>',
            '<path d="M22.5 8c-4.9 3.6-7.6 8-7.1 11.4.4 2.3 2.9 3.4 7.1 3.4s6.7-1.1 7.1-3.4C30.1 16 27.4 11.6 22.5 8z"/>',
            '<circle cx="22.5" cy="6" r="2.25"/>',
        ],
        seams: [PLINTH_SEAM, 'M25.2 12.4l-4.4 5.4', 'M17.7 22.55h9.6', 'M17.7 25.7h9.6'],
        dots: [],
    },
    r: {
        body: [
            '<path d="M14 31.5l1.4-14.5h14.2L31 31.5z"/>',
            PLINTH,
            '<rect x="11" y="31" width="23" height="3.75" rx="1.5"/>',
            '<path d="M11.5 16.9V8.5h4.6v3h3.9v-3h5v3h3.9v-3h4.6v8.4z"/>',
        ],
        seams: [PLINTH_SEAM, 'M16 16.95h13', 'M22.5 21v5.5', 'M13 31.05h19'],
        dots: [],
    },
    q: {
        body: [
            '<path d="M13 34.5c.8-5.4 3.7-9.6 4.6-13.3h9.8c.9 3.7 3.8 7.9 4.6 13.3z"/>',
            PLINTH,
            '<rect x="15.5" y="18.5" width="14" height="3.4" rx="1.7"/>',
            '<path d="M15.6 18.6L10.7 11l4.5 3.4L16.6 8.6l3.1 4.6L22.5 6.9l2.8 6.3 3.1-4.6 1.4 5.8 4.5-3.4-4.9 7.6z"/>',
            '<circle cx="10.6" cy="10.3" r="1.75"/>',
            '<circle cx="16.6" cy="7.6" r="1.75"/>',
            '<circle cx="22.5" cy="5.9" r="1.75"/>',
            '<circle cx="28.4" cy="7.6" r="1.75"/>',
            '<circle cx="34.4" cy="10.3" r="1.75"/>',
        ],
        seams: [PLINTH_SEAM, 'M15.9 30.5h13.2', 'M17.2 18.55h10.6', 'M17.2 21.85h10.6'],
        dots: [],
    },
    k: {
        body: [
            '<path d="M13.5 34.5c.8-5 3.4-9 4.3-12.6h9.4c.9 3.6 3.5 7.6 4.3 12.6z"/>',
            PLINTH,
            '<rect x="15.5" y="19" width="14" height="3.4" rx="1.7"/>',
            '<path d="M16.2 19.1c-2.6-2.4-3-6.4-.4-8 2.2-1.4 5 -.4 6.7 1.9 1.7-2.3 4.5-3.3 6.7-1.9 2.6 1.6 2.2 5.6-.4 8z"/>',
            '<path d="M21.25 3.25h2.5v2.5h2.5v2.5h-2.5v3.6h-2.5v-3.6h-2.5v-2.5h2.5z"/>',
        ],
        seams: [PLINTH_SEAM, 'M15.9 30.5h13.2', 'M22.5 13.4v5.6', 'M17.2 19.05h10.6', 'M17.2 22.35h10.6'],
        dots: [],
    },
});

const COLORS = {
    w: { fill: 'var(--sc-white-fill, #fbf7ee)', stroke: 'var(--sc-white-stroke, #23201b)', detail: 'var(--sc-white-detail, #23201b)' },
    b: { fill: 'var(--sc-black-fill, #2c2925)', stroke: 'var(--sc-black-stroke, #15130f)', detail: 'var(--sc-black-detail, #ece5d5)' },
};

/** The inner markup of a piece (FEN letter: 'N' a white knight, 'q' a black queen), for a 45×45 viewBox. */
export function pieceMarkup(letter) {
    const type = String(letter).toLowerCase();
    const d = DRAWINGS[type];
    if (!d) return '';
    const c = COLORS[letter === type ? 'b' : 'w'];
    const seams = d.seams.map((s) => `<path d="${s}"/>`).join('');
    return (
        `<g style="fill:${c.fill};stroke:${c.stroke};stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round">${d.body.join('')}</g>` +
        `<g style="fill:none;stroke:${c.detail};stroke-width:1.2;stroke-linecap:round">${seams}</g>` +
        (d.dots.length ? `<g style="fill:${c.detail};stroke:none">${d.dots.join('')}</g>` : '')
    );
}

/** A piece as a standalone <svg> (FEN letter); attrs are added to the svg element. */
export function pieceSvg(letter, attrs = '') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 45 45" ${attrs}>${pieceMarkup(letter)}</svg>`;
}

/** The twelve pieces as <symbol id="sc-wK"> … <symbol id="sc-bP"> in one hidden sprite, for pages that <use> them. */
export function pieceSprite(prefix = 'sc-') {
    const symbols = [...'KQRBNPkqrbnp']
        .map((l) => `<symbol id="${prefix}${l === l.toUpperCase() ? 'w' : 'b'}${l.toUpperCase()}" viewBox="0 0 45 45">${pieceMarkup(l)}</symbol>`)
        .join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">${symbols}</svg>`;
}

/** The FEN letters of the set, white first. */
export const PIECES = Object.freeze([...'KQRBNPkqrbnp']);
