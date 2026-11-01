// board/explain — <stepchess-explain for="boardId" lang>: an explanation of a move, one step at a time.
//
// Its result property takes what explainMove returns: {ok, kind: 'move', class, move: {uci, san}, steps: [{title,
// text?, line?, annotations?, rule}], annotations}. The steps are shown one by one with Back and Next (and the arrow
// keys); the annotations of the step on show (or the result's own) are drawn on the linked board. A failed or other
// result shows its reason.
import { msg, inLanguage } from '../src/index.js';
import { explainCss } from './styles.js';
import { langOf, esc, whenLinked, linkedBoard } from './dom.js';

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;
const CLASSES = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];

export class StepchessExplain extends Base {
    static observedAttributes = ['for', 'lang'];

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        // a fixed skeleton: the live region and the buttons stay the same nodes, so a screen reader hears each new
        // step and keyboard focus stays on the button that was pressed
        root.innerHTML = `<style>${explainCss}</style><section class="box" part="explain">
<div class="head" hidden></div><div class="step" aria-live="polite"></div><div class="dots" aria-hidden="true" hidden></div>
<div class="nav" hidden><button type="button" data-go="prev"></button><button type="button" data-go="next"></button></div></section>`;
        this._box = root.querySelector('.box');
        this._head = root.querySelector('.head');
        this._live = root.querySelector('.step');
        this._dots = root.querySelector('.dots');
        this._navBox = root.querySelector('.nav');
        this._prev = root.querySelector('[data-go="prev"]');
        this._next = root.querySelector('[data-go="next"]');
        this._result = null;
        this._index = 0;
        this._box.addEventListener('click', (e) => {
            const b = e.target.closest?.('button[data-go]');
            if (b) this.step(b.dataset.go === 'next' ? 1 : -1);
        });
        this._box.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                this.step(e.key === 'ArrowRight' ? 1 : -1);
            }
        });
    }

    connectedCallback() {
        this._link();
        this.render();
    }

    disconnectedCallback() {
        this._unlink?.();
        this._unlink = null;
    }

    attributeChangedCallback(name) {
        if (!this.isConnected) return;
        if (name === 'for') this._link();
        this.render();
    }

    // draw the explanation on the board named by `for`, as soon as there is one; a wait that is still open is cancelled
    _link() {
        this._unlink?.();
        this._unlink = whenLinked(this, () => this._annotate());
    }

    /** The explanation on show (an explainMove result), or null. */
    get result() {
        return this._result;
    }

    set result(r) {
        this._result = r ?? null;
        this._index = 0;
        this.render();
        this._annotate();
    }

    /** The step on show (0-based). */
    get index() {
        return this._index;
    }

    /** Show the step `by` steps further (or back); the linked board shows its annotations. */
    step(by) {
        const steps = this._steps();
        const next = Math.max(0, Math.min(steps.length - 1, this._index + by));
        if (next === this._index) return;
        this._index = next;
        this.render();
        this._annotate();
        // keep focus on the pressed button; at either end it passes to the other one
        if (this.shadowRoot.activeElement?.closest?.('.nav')) {
            const [pressed, other] = by > 0 ? [this._next, this._prev] : [this._prev, this._next];
            (pressed.disabled ? other : pressed).focus({ preventScroll: true });
        }
    }

    _steps() {
        const r = this._result;
        return r && r.ok && Array.isArray(r.steps) ? r.steps : [];
    }

    _annotate() {
        const board = linkedBoard(this);
        if (!board) return;
        const r = this._result;
        const step = this._steps()[this._index];
        board.annotate(r && r.ok ? (step?.annotations ?? r.annotations ?? null) : null);
    }

    render() {
        const lang = langOf(this);
        const t = (x) => esc(inLanguage(x, lang));
        const r = this._result;
        this._box.setAttribute('aria-label', msg('board.explain.label').in(lang));
        const ok = r && r.ok && r.kind === 'move';
        const steps = ok ? this._steps() : [];
        const many = steps.length > 1;
        this._head.hidden = !ok;
        this._dots.hidden = !many;
        this._navBox.hidden = !many;
        let body;
        if (!r) body = `<p class="empty">${esc(msg('board.explain.empty').in(lang))}</p>`;
        // a refusal is an error; a game that is over (a terminal result) or a hint is said plainly, as a note
        else if (!ok) body = r.ok === false ? `<p class="error">${t(r.reason ?? r.text ?? '')}</p>` : `<p class="note">${t(r.reason ?? r.text ?? '')}</p>`;
        else {
            const step = steps[this._index];
            const cls = CLASSES.includes(r.class) ? `<span class="cls c-${r.class}">${esc(msg(`board.class.${r.class}`).in(lang))}</span>` : '';
            const count = many ? `<span class="count">${esc(msg('board.explain.step', { n: this._index + 1, total: steps.length }).in(lang))}</span>` : '';
            this._head.innerHTML = `<span class="san">${t(r.move?.san ?? '')}</span>${cls}${count}`;
            body = '';
            if (step) {
                body += `<h3 class="title">${t(step.title)}</h3>`;
                if (step.text) body += `<p class="text">${t(step.text)}</p>`;
                if (Array.isArray(step.line) && step.line.length) {
                    const line = step.line.map((x) => inLanguage(x, lang)).join(' ');
                    body += `<p class="line">${esc(msg('board.explain.line', { line }).in(lang))}</p>`;
                }
            }
            this._dots.innerHTML = steps.map((_, i) => `<i class="${i === this._index ? 'on' : ''}"></i>`).join('');
            this._prev.textContent = msg('board.explain.prev').in(lang);
            this._next.textContent = msg('board.explain.next').in(lang);
            this._prev.disabled = this._index === 0;
            this._next.disabled = this._index === steps.length - 1;
        }
        // only the content of the live region changes, never the region itself
        if (this._live.innerHTML !== body) this._live.innerHTML = body;
    }
}

/** Register <stepchess-explain> (once). */
export function defineExplain() {
    if (!customElements.get('stepchess-explain')) customElements.define('stepchess-explain', StepchessExplain);
}
