// board/moves — <stepchess-moves for="boardId" pgn lang>: the game record with variations, glyphs and move classes.
//
// The record comes from the pgn attribute, or grows from the linked board's moves. A click on a move (or the arrows,
// Home and End keys, or the buttons) winds the linked board to that move. A move made on the board from the current
// move continues the line there: the same move as an existing one follows it, a new one starts a variation.
// The property classes (an array: the class of each main-line move — best, good, inaccuracy, mistake, blunder) adds
// colored marks.
import { msg, inLanguage, Position, parsePgn, parseMove, toSan, moveToUci, NO_MOVE } from '../src/index.js';
import { movesCss } from './styles.js';
import { GLYPH_NAMES } from './arrows.js';
import { langOf, esc, whenLinked, linkedBoard, icon } from './dom.js';

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;
const NAG_GLYPHS = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!' };
const CLASSES = ['best', 'good', 'inaccuracy', 'mistake', 'blunder'];
const ICONS = {
    first: icon('M6 5h2v14H6zm3.5 7L18 5.5v13z'),
    prev: icon('M8 12l8.5-6.5v13z'),
    next: icon('M16 12L7.5 18.5v-13z'),
    last: icon('M16 5h2v14h-2zm-1.5 7L6 18.5v-13z'),
};

const node = (move, parent) => ({ move, uci: move ? moveToUci(move) : '', nags: [], children: [], parent, comment: '' });

export class StepchessMoves extends Base {
    static observedAttributes = ['pgn', 'for', 'lang'];

    constructor() {
        super();
        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${movesCss}</style>
<nav class="box" part="moves"><div class="nav"></div><div class="list" part="list"></div></nav>`;
        this._nav = root.querySelector('.nav');
        this._list = root.querySelector('.list');
        this._box = root.querySelector('.box');
        this._classes = [];
        this._error = null;
        this._board = null;
        this._syncing = false;
        this._reset(Position.START_FEN);
        this._onMove = (e) => this._boardMove(e.detail);
        this._onPosition = () => this._boardPosition();
        this._unlink = null;
        this._nav.addEventListener('click', (e) => {
            const b = e.target.closest?.('button');
            if (b) this._step(b.dataset.go);
        });
        this._list.addEventListener('click', (e) => {
            const b = e.target.closest?.('[data-id]');
            if (b) this.go(this._byId.get(Number(b.dataset.id)));
        });
        this._box.addEventListener('keydown', (e) => {
            const go = { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' }[e.key];
            if (!go) return;
            e.preventDefault();
            this._step(go);
            this._list.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
        });
    }

    connectedCallback() {
        if (this.hasAttribute('pgn')) this._load(this.getAttribute('pgn'));
        this._link();
        this.render();
    }

    disconnectedCallback() {
        this._unlink?.();
        this._unlink = null;
        this._unbind();
    }

    attributeChangedCallback(name, old, value) {
        if (!this.isConnected || old === value) return;
        if (name === 'pgn') {
            this._load(value);
            this._sync();
        } else if (name === 'for') this._link();
        this.render();
    }

    /** The class of each main-line move (best | good | inaccuracy | mistake | blunder), for colored marks. */
    get classes() {
        return this._classes.slice();
    }

    set classes(list) {
        this._classes = Array.isArray(list) ? list.slice() : [];
        this.render();
    }

    /** The UCI moves from the start to the current move. */
    get path() {
        return this._pathOf(this._cur).map((n) => n.uci);
    }

    _reset(fen) {
        this._start = fen;
        this._root = node(0, null);
        this._cur = this._root;
        this._byId = new Map();
    }

    _load(text) {
        this._error = null;
        if (!text) {
            this._reset(Position.START_FEN);
            return;
        }
        try {
            const game = parsePgn(text);
            this._reset(game.headers.FEN || Position.START_FEN);
            // copy the tree, adding parents and UCI
            const copy = (src, dst) => {
                for (const c of src.children) {
                    const n = node(c.move, dst);
                    n.nags = c.nags ?? [];
                    n.comment = c.comment ?? '';
                    dst.children.push(n);
                    copy(c, n);
                }
            };
            copy(game.root, this._root);
        } catch (e) {
            this._reset(Position.START_FEN);
            this._error = e?.text ?? String(e?.message ?? e);
        }
    }

    _unbind() {
        this._board?.removeEventListener('move', this._onMove);
        this._board?.removeEventListener('position', this._onPosition);
        this._board = null;
    }

    _link() {
        this._unlink?.();
        this._unbind();
        this._unlink = whenLinked(this, (b) => {
            this._board = b;
            b.addEventListener('move', this._onMove);
            b.addEventListener('position', this._onPosition);
            if (this.hasAttribute('pgn')) this._sync();
            else this._adopt(b);
            this.render();
        });
    }

    // a record built from what the board has played
    _adopt(board) {
        this._reset(board.startFen);
        for (const uci of board.state.history.map((h) => h.uci)) this._append(uci);
    }

    // the position after a node
    _positionAt(n) {
        const pos = Position.fromFen(this._start);
        for (const x of this._pathOf(n)) pos.make(x.move);
        return pos;
    }

    _pathOf(n) {
        const path = [];
        for (let x = n; x && x.parent; x = x.parent) path.push(x);
        return path.reverse();
    }

    // follow or add a move after the current one; false when it is not legal there
    _append(uci) {
        const same = this._cur.children.find((c) => c.uci === uci);
        if (same) {
            this._cur = same;
            return true;
        }
        let m = NO_MOVE;
        try {
            m = parseMove(this._positionAt(this._cur), uci);
        } catch {}
        if (m === NO_MOVE) return false;
        const n = node(m, this._cur);
        this._cur.children.push(n);
        this._cur = n;
        return true;
    }

    _boardMove(d) {
        if (this._syncing || !d) return;
        // a move from somewhere else (the board was set to another position): start over from the board's game
        if (!this._append(d.uci) || this._positionAt(this._cur).fen() !== d.fen) this._adopt(this._board);
        this.render();
    }

    // the board's position was replaced from outside (setPosition, setPuzzle, undo, an attribute): the record follows
    // the board. When the board's game is a path of the record, the current move goes there and the variations stay;
    // otherwise the record starts over from the board's game.
    _boardPosition() {
        const b = this._board;
        if (this._syncing || !b) return;
        const fenOf = (fen) => {
            try {
                return Position.fromFen(fen).fen();
            } catch {
                return fen;
            }
        };
        let n = fenOf(b.startFen) === fenOf(this._start) ? this._root : null;
        for (const h of n ? b.state.history : []) {
            n = n.children.find((c) => c.uci === h.uci);
            if (!n) break;
        }
        if (n) this._cur = n;
        else this._adopt(b);
        this.render();
    }

    /** Wind the linked board to a node of the record (the start when null). */
    go(n) {
        if (!n) return;
        this._cur = n;
        this._sync();
        this.render();
    }

    _sync() {
        const b = this._board ?? linkedBoard(this);
        if (!b) return;
        this._syncing = true;
        try {
            b.setPosition(this._start);
            b.playMoves(this._pathOf(this._cur).map((x) => x.uci));
        } finally {
            this._syncing = false;
        }
    }

    /** Wind the board to the start, one move back, one move on (the main continuation), or the end of the line. */
    first() {
        this._step('first');
    }

    prev() {
        this._step('prev');
    }

    next() {
        this._step('next');
    }

    last() {
        this._step('last');
    }

    _step(go) {
        let n = this._cur;
        if (go === 'first') n = this._root;
        else if (go === 'prev') n = n.parent ?? n;
        else if (go === 'next') n = n.children[0] ?? n;
        else if (go === 'last') while (n.children.length) n = n.children[0];
        if (n !== this._cur) this.go(n);
    }

    render() {
        const lang = langOf(this);
        this._box.setAttribute('aria-label', msg('board.moves.label').in(lang));
        const cur = this._cur;
        const atStart = cur === this._root;
        const atEnd = cur.children.length === 0;
        const btn = (go, disabled) => {
            const label = esc(msg(`board.moves.${go}`).in(lang));
            return `<button type="button" data-go="${go}" aria-label="${label}" title="${label}"${disabled ? ' disabled' : ''}>${ICONS[go]}</button>`;
        };
        this._nav.innerHTML = btn('first', atStart) + btn('prev', atStart) + btn('next', atEnd) + btn('last', atEnd);
        if (this._error) {
            this._list.innerHTML = `<p class="error">${esc(msg('board.moves.invalid', { reason: inLanguage(this._error, lang) }).in(lang))}</p>`;
            return;
        }
        if (!this._root.children.length) {
            this._list.innerHTML = `<p class="empty">${esc(msg('board.moves.empty').in(lang))}</p>`;
            return;
        }
        this._list.innerHTML = this._html(lang);
        const current = this._list.querySelector('[aria-current="true"]');
        if (current) {
            // keep the current move in view inside the list, without scrolling the page
            const l = this._list;
            const top = current.offsetTop - l.offsetTop;
            if (top < l.scrollTop || top > l.scrollTop + l.clientHeight - current.offsetHeight) l.scrollTop = Math.max(0, top - l.clientHeight / 2);
        }
    }

    _html(lang) {
        const pos = Position.fromFen(this._start);
        const out = [];
        this._byId = new Map();
        let id = 0;
        const move = (n, force, mainIndex) => {
            const white = pos.side === 0;
            const num = white ? `${pos.fullmove}.` : force ? `${pos.fullmove}...` : '';
            const nags = n.nags
                .map((k) => NAG_GLYPHS[k])
                .filter(Boolean)
                .map((g) => `<span class="glyph g-${GLYPH_NAMES[g]}" aria-label="${esc(msg(`board.glyph.${GLYPH_NAMES[g]}`).in(lang))}">${esc(g)}</span>`)
                .join('');
            const cls = mainIndex >= 0 && CLASSES.includes(this._classes[mainIndex]) ? this._classes[mainIndex] : null;
            const mark = cls ? `<span class="cls c-${cls}" role="img" aria-label="${esc(msg(`board.class.${cls}`).in(lang))}"></span>` : '';
            this._byId.set(++id, n);
            const san = esc(toSan(pos, n.move, { lang }));
            const current = n === this._cur ? ' aria-current="true"' : '';
            const comment = n.comment ? ` <span class="var">${esc(n.comment)}</span>` : '';
            return `${num ? `<span class="num">${num}</span>` : ''}<button type="button" class="mv" data-id="${id}"${current}>${san}${nags}${mark}</button>${comment} `;
        };
        // a line: the moves after a node, each followed by its alternatives in parentheses
        const line = (start, main, first = true) => {
            let cur = start;
            let force = first;
            let made = 0;
            let index = main ? 0 : -1;
            while (cur.children.length) {
                const next = cur.children[0];
                out.push(move(next, force, index));
                force = false;
                for (const v of cur.children.slice(1)) {
                    out.push('<span class="var">(');
                    out.push(move(v, true, -1));
                    pos.make(v.move);
                    line(v, false, false);
                    pos.unmake();
                    out.push(')</span> ');
                    force = true;
                }
                pos.make(next.move);
                made++;
                cur = next;
                if (index >= 0) index++;
            }
            for (let i = 0; i < made; i++) pos.unmake();
        };
        line(this._root, true);
        return out.join('').replace(/\s+\)/g, ')').trim();
    }
}

/** Register <stepchess-moves> (once). */
export function defineMoves() {
    if (!customElements.get('stepchess-moves')) customElements.define('stepchess-moves', StepchessMoves);
}
