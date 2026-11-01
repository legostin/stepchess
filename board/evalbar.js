// board/evalbar — <stepchess-evalbar win orientation horizontal lang>: White's winning chances (0..1) as a bar.
//
// The white part grows from White's end (the bottom, or the top with orientation="black"; the left when horizontal).
// The number shows at the end of the side that is ahead. Screen readers get a meter with the percentage.
import { msg } from '../src/index.js';
import { evalbarCss } from './styles.js';
import { langOf } from './dom.js';

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

export class StepchessEvalbar extends Base {
    static observedAttributes = ['win', 'orientation', 'horizontal', 'lang'];

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${evalbarCss}</style>
<div class="bar" part="bar" role="meter" aria-valuemin="0" aria-valuemax="100"><div class="white" part="white"></div><div class="mid"></div><span class="value" aria-hidden="true"></span></div>`;
        this._bar = root.querySelector('.bar');
        this._white = root.querySelector('.white');
        this._value = root.querySelector('.value');
    }

    /** White's winning chance, 0..1 (0.5 when the attribute is missing or not a number). */
    get win() {
        const v = Number.parseFloat(this.getAttribute('win'));
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.5;
    }

    set win(v) {
        this.setAttribute('win', String(v));
    }

    connectedCallback() {
        this.render();
    }

    attributeChangedCallback() {
        if (this.isConnected) this.render();
    }

    render() {
        const lang = langOf(this);
        const w = this.win;
        const pct = Math.round(w * 100);
        const horizontal = this.hasAttribute('horizontal');
        const flipped = this.getAttribute('orientation') === 'black';
        this._white.style.height = horizontal ? '' : `${w * 100}%`;
        this._white.style.width = horizontal ? `${w * 100}%` : '';
        // the number sits at the end of the side that is ahead, in the color of that side's part
        const whiteAhead = w >= 0.5;
        const atStart = whiteAhead !== flipped; // the start is the bottom (vertical) or the left (horizontal)
        const v = this._value;
        v.textContent = String(whiteAhead ? pct : 100 - pct);
        v.className = `value ${whiteAhead ? 'on-white' : 'on-black'}`;
        v.style.top = v.style.bottom = v.style.left = v.style.right = '';
        if (horizontal) v.style[atStart ? 'left' : 'right'] = '0';
        else v.style[atStart ? 'bottom' : 'top'] = '0';
        this._bar.setAttribute('aria-label', msg('board.evalbar.label').in(lang));
        this._bar.setAttribute('aria-valuenow', String(pct));
        this._bar.setAttribute('aria-valuetext', msg('board.evalbar.value', { percent: pct }).in(lang));
    }
}

/** Register <stepchess-evalbar> (once). */
export function defineEvalbar() {
    if (!customElements.get('stepchess-evalbar')) customElements.define('stepchess-evalbar', StepchessEvalbar);
}
