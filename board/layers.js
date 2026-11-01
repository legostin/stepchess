// board/layers — the DOM layers of <stepchess-board> that hold elements: the pieces (kept across renders, so moves
// slide), the promotion picker over the target file, and the setup palette.
import { msg } from '../src/index.js';
import { pieceMarkup } from './pieces.js';
import { cellOf } from './arrows.js';
import { esc, icon } from './dom.js';

const PROMO_ORDER = ['q', 'n', 'r', 'b'];
const ERASER = icon('M15.1 3.6a2 2 0 0 1 2.8 0l2.5 2.5a2 2 0 0 1 0 2.8L11.3 18H20v2H8.7l-4.6-4.6a2 2 0 0 1 0-2.8zM6.5 11.9 4.9 13.5l3.6 3.6.9.9h1.7l1.3-1.3z');
const pieceIcon = (letter) => `<svg viewBox="0 0 45 45" aria-hidden="true">${pieceMarkup(letter)}</svg>`;

/** The spoken name of a piece (FEN letter) as a message: 'white knight'. */
export const pieceName = (letter) => msg(`board.piece.${letter === letter.toUpperCase() ? 'w' : 'b'}${letter.toUpperCase()}`);

/**
 * Put the pieces of `want` ({square: letter}) on the layer, reusing the elements of `old` (square → {el, letter}):
 * pieces that stay keep their element, a moved piece takes the nearest element of its kind (so it slides), the rest
 * are created or removed. The dragged element keeps its place under the pointer. Returns the new map.
 */
export function drawPieces(layer, old, want, { dragged, place }) {
    const next = new Map();
    for (const [sq, letter] of Object.entries(want)) {
        const p = old.get(sq);
        if (p && p.letter === letter) {
            next.set(sq, p);
            old.delete(sq);
        }
    }
    for (const [sq, letter] of Object.entries(want)) {
        if (next.has(sq)) continue;
        let best = null;
        let dist = Infinity;
        for (const [from, p] of old) {
            if (p.letter !== letter) continue;
            const d = Math.abs((from.charCodeAt(0) - sq.charCodeAt(0)) * 1.01) + Math.abs(from.charCodeAt(1) - sq.charCodeAt(1));
            if (d < dist) [best, dist] = [from, d];
        }
        if (best) {
            next.set(sq, old.get(best));
            old.delete(best);
        } else {
            const el = document.createElement('div');
            el.className = 'piece fresh';
            el.setAttribute('part', 'piece');
            el.innerHTML = pieceIcon(letter);
            el.addEventListener('animationend', () => el.classList.remove('fresh'), { once: true });
            place(el, sq);
            layer.append(el);
            next.set(sq, { el, letter });
        }
    }
    for (const p of old.values()) p.el.remove();
    for (const [sq, p] of next) {
        p.el.dataset.sq = sq;
        if (p.el !== dragged) place(p.el, sq);
    }
    return next;
}

/** Show or hide the promotion picker for the state's pending promotion; true when it has just opened. */
export function drawPromotion(promo, st, lang) {
    const p = st.pendingPromotion;
    const wasOpen = !promo.hidden;
    if (!p) {
        if (wasOpen) {
            promo.hidden = true;
            promo.textContent = '';
        }
        return false;
    }
    if (wasOpen && promo.dataset.for === p.to) return false;
    const [c, r] = cellOf(p.to, st.orientation);
    const step = r === 0 ? 1 : -1; // the picks run from the promotion square toward the middle of the board
    promo.dataset.for = p.to;
    promo.setAttribute('role', 'dialog');
    promo.setAttribute('aria-modal', 'true');
    promo.setAttribute('aria-label', msg('board.promotion.label').in(lang));
    promo.innerHTML =
        `<button type="button" class="backdrop" data-promo="" tabindex="-1" aria-label="${esc(msg('board.promotion.cancel').in(lang))}"></button>` +
        PROMO_ORDER.map((t, i) => {
            const letter = p.color === 'white' ? t.toUpperCase() : t;
            const style = `left:${c * 12.5}%;top:${(r + step * i) * 12.5}%`;
            return `<button type="button" class="pick" data-promo="${t}" style="${style}" aria-label="${esc(msg(`board.promotion.${t}`).in(lang))}">${pieceIcon(letter)}</button>`;
        }).join('');
    promo.hidden = false;
    return true;
}

/** The setup palette: twelve pieces, the eraser, the side to move, the start position and clear; `tool` is pressed. */
export function drawPalette(palette, st, lang, tool) {
    const setup = st.mode === 'setup';
    palette.hidden = !setup;
    if (!setup) {
        if (palette.dataset.lang) {
            palette.textContent = '';
            palette.dataset.lang = '';
        }
        return;
    }
    const turnKey = st.turn === 'white' ? 'board.setup.white' : 'board.setup.black';
    if (palette.dataset.lang !== lang) {
        palette.dataset.lang = lang;
        palette.setAttribute('role', 'toolbar');
        palette.setAttribute('aria-label', msg('board.setup.palette').in(lang));
        const btn = (letter) => {
            const label = esc(pieceName(letter).in(lang));
            return `<button type="button" data-tool="${letter}" aria-pressed="false" aria-label="${label}" title="${label}">${pieceIcon(letter)}</button>`;
        };
        const text = (act, key) => `<button type="button" class="text" data-act="${act}">${esc(msg(key).in(lang))}</button>`;
        const erase = esc(msg('board.setup.erase').in(lang));
        palette.innerHTML =
            `<div class="group">${[...'KQRBNP'].map(btn).join('')}</div>` +
            `<div class="group">${[...'kqrbnp'].map(btn).join('')}</div>` +
            `<div class="group"><button type="button" class="eraser" data-tool="erase" aria-pressed="false" aria-label="${erase}" title="${erase}">${ERASER}</button>` +
            `${text('turn', turnKey)}${text('start', 'board.setup.start')}${text('clear', 'board.setup.clear')}</div>`;
    }
    const turn = palette.querySelector('[data-act="turn"]');
    if (turn) turn.textContent = msg(turnKey).in(lang);
    for (const b of palette.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
}
