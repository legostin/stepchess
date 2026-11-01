// board/dom — helpers the elements share: the language of an element, the board it is linked to, HTML escaping.
import { resolveLanguage } from '../src/index.js';

/** The language of an element: its lang attribute, the nearest ancestor's, the page's; 'ru-RU' reads as 'ru'. */
export function langOf(el) {
    const raw = el.getAttribute('lang') || el.closest?.('[lang]')?.getAttribute('lang') || document.documentElement.getAttribute('lang') || '';
    return resolveLanguage(raw.trim().toLowerCase().split('-')[0]);
}

/** Text made safe for HTML. */
export function esc(text) {
    return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** The <stepchess-board> an element names in its for attribute (in its own document or shadow root), or null. */
export function linkedBoard(el) {
    const id = el.getAttribute('for');
    if (!id) return null;
    const root = el.getRootNode();
    const found = (root && typeof root.getElementById === 'function' ? root.getElementById(id) : null) ?? document.getElementById(id);
    return found && typeof found.playMoves === 'function' ? found : null;
}

/**
 * Call fn(board) once the linked board exists and is upgraded (now, after the page is parsed, or when it is defined).
 * Returns a function that cancels the wait: after it, fn is never called (an element that left the page, or whose `for`
 * changed, must not be linked later).
 */
export function whenLinked(el, fn) {
    let live = true;
    const tryNow = () => {
        if (!live) return true;
        const b = linkedBoard(el);
        if (b) {
            live = false;
            fn(b);
        }
        return Boolean(b);
    };
    const later = () => {
        if (live && !tryNow()) customElements.whenDefined('stepchess-board').then(() => queueMicrotask(tryNow));
    };
    const cancel = () => {
        live = false;
        document.removeEventListener('DOMContentLoaded', later);
    };
    if (tryNow()) return cancel;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', later, { once: true });
    else queueMicrotask(later);
    return cancel;
}

/** A small inline SVG icon from a path (24×24). */
export function icon(d) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${d}"/></svg>`;
}
