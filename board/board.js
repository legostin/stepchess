// board/board — <stepchess-board>: the chessboard element, a thin view over board/model with pointer, keyboard and
// screen-reader input.
//
// Attributes: fen, mode (play | puzzle | analysis | setup | view), orientation (white | black), lang, coordinates
// ("none" hides them), player (white | black | both: who moves in play mode), puzzle (the line in UCI, space separated).
// Events (bubbling, composed): move {uci, san, fen, color, source: 'user' | 'auto' | 'api'}, select {square, targets},
// puzzle-solved {moves}, puzzle-failed {uci, expected}, change {fen, valid} (setup edits), position {fen, reason} when
// the game on the board is replaced or rewound from outside: setPosition, setPuzzle, undo, the fen or puzzle attribute,
// a wrong puzzle move taken back, a mode change that leaves setup (reason 'position' | 'puzzle' | 'undo' | 'attribute' |
// 'cancel' | 'mode'). It describes the board as it is when it is sent, so within one call it comes after that call's
// move events. error {attribute, result} (not bubbling) when the fen or puzzle attribute is rejected — the board keeps
// its position. A call that is rejected (a bad FEN, a bad line, an empty list) changes nothing at all: no deselection,
// no timer cleared, no event lost.
// Methods: setPosition(fen, {puzzle}), setPuzzle({fen, moves}), playMoves(moves), annotate(a), flip(), undo(), cancel().
//
// Input: one set of pointer handlers serves mouse, touch and pen — drag and drop, tap a piece then a square, right-drag
// (or a long press and drag on touch) draws an arrow, a right click or long press without moving circles a square.
// Every gesture that ends without a move (released off the board, cancelled by the browser, Escape) returns the board
// to a clean state: the piece snaps home, nothing stays selected. A tap on a square that is not a piece to pick up
// (a target, an empty square, the setup tool) acts when the pointer is lifted on it, not when it lands, so a press that
// turns into a scroll, a long press or a cancelled touch moves nothing.
//
// Timers: every pending timer (the long press, the puzzle's reply, the wrong move on show, the announcements) is
// cleared when the board leaves the page and whenever the position is replaced. The events of a pending reply are told
// when the game goes on (render, playMoves, leaving the page) and dropped with the position they describe (setPosition,
// setPuzzle, undo, a mode change). On leaving the page they are sent from the detached element itself, so listeners on
// the element hear them but delegates higher up the document do not (a detached element bubbles to nothing).
//
// Touch: a promotion picker opened by a finger or pen ignores picks for a moment (PROMO_GUARD), so the compatibility
// click that follows the tap cannot choose the queen under the finger.
import { msg, Position } from '../src/index.js';
import { createBoardModel, sanIn, piecesOfFen } from './model.js';
import { boardCss } from './styles.js';
import { arrowSvg, marksSvg, ringsSvg, badgesSvg, cellOf } from './arrows.js';
import { langOf } from './dom.js';
import { drawPieces, drawPromotion, drawPalette, pieceName } from './layers.js';

const FILES = 'abcdefgh';
const LONG_PRESS = 450; // ms a finger rests before a press becomes an arrow
const SLOP = { mouse: 3, pen: 5, touch: 8 }; // px a pointer moves before a press becomes a drag
const FAIL_SHOW = 800; // ms a wrong puzzle move stays on the board
const REPLY_DELAY = 280; // ms before the puzzle's reply is shown
const PROMO_GUARD = 300; // ms a promotion picker opened by touch or pen ignores picks
const SVG_NS = 'http://www.w3.org/2000/svg';

const svgLayer = (cls) => {
    const el = document.createElementNS(SVG_NS, 'svg');
    el.setAttribute('class', `layer ${cls}`);
    el.setAttribute('viewBox', '0 0 8 8');
    el.setAttribute('aria-hidden', 'true');
    return el;
};

const nameOf = (file, rank) => FILES[file] + (rank + 1);

const Base = typeof HTMLElement === 'undefined' ? class {} : HTMLElement;

export class StepchessBoard extends Base {
    static observedAttributes = ['fen', 'mode', 'orientation', 'lang', 'coordinates', 'player', 'puzzle'];

    constructor() {
        super();
        this._model = createBoardModel();
        this._ready = false;
        this._cells = new Map(); // square → cell element
        this._pieces = new Map(); // square → {el, letter}
        this._builtFor = null;
        this._focus = null;
        this._g = null; // the gesture in progress
        this._timers = new Set();
        this._lastInput = null; // the kind of the last input: a pointerType, or 'key'
        this._promoGuardUntil = 0;
        this._tool = null; // setup: the piece letter (or 'erase') a tap puts on a square
        this._shownSelection = null;
        this._reply = null; // the puzzle's reply, reported when its timer fires (or at the next render)
        this._nextView = null; // the view the next render shows: the user's move before the reply

        const root = this.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${boardCss}</style>
<div class="board" part="board" role="grid"></div>
<div class="palette" hidden></div>
<div class="sr-only" aria-live="polite" aria-atomic="true"></div>`;
        this._board = root.querySelector('.board');
        this._palette = root.querySelector('.palette');
        this._live = root.querySelector('[aria-live]');
        this._under = svgLayer('under');
        this._layer = document.createElement('div');
        this._layer.className = 'layer pieces';
        this._layer.setAttribute('aria-hidden', 'true');
        this._over = svgLayer('over');
        this._over.setAttribute('part', 'arrow');
        this._promo = document.createElement('div');
        this._promo.className = 'promotion';
        this._promo.setAttribute('part', 'promotion');
        this._promo.hidden = true;

        const b = this._board;
        b.addEventListener('pointerdown', (e) => this._down(e));
        b.addEventListener('pointermove', (e) => this._move(e));
        b.addEventListener('pointerup', (e) => this._up(e));
        // only the pointer of the gesture in progress counts: a stale or second pointer must not end it
        b.addEventListener('pointercancel', (e) => this._g && e.pointerId === this._g.id && this._abort());
        b.addEventListener('lostpointercapture', (e) => this._g && e.pointerId === this._g.id && this._abort());
        b.addEventListener('contextmenu', (e) => e.preventDefault());
        // a finger that drags a piece or draws an arrow must not scroll the page
        b.addEventListener('touchmove', (e) => this._g && this._g.kind !== 'tap' && e.cancelable && e.preventDefault(), { passive: false });
        b.addEventListener('keydown', (e) => this._key(e));
        b.addEventListener('focusin', (e) => {
            const sq = e.target?.dataset?.sq;
            if (sq) this._setFocus(sq, false);
        });
        this._promo.addEventListener('click', (e) => this._promoClick(e));
        this._promo.addEventListener('keydown', (e) => this._promoKey(e));
        this._palette.addEventListener('click', (e) => this._paletteClick(e));
        this._onBlur = () => this._g && this._abort();
    }

    connectedCallback() {
        if (!this._ready) {
            this._ready = true;
            const mode = this.getAttribute('mode');
            if (mode) this._model.setMode(mode === 'setup' ? 'play' : mode);
            this._model.setOrientation(this.getAttribute('orientation'));
            this._model.setPlayer(this.getAttribute('player'));
            this._applyPosition();
            if (mode === 'setup') this._model.setMode('setup');
        }
        window.addEventListener('blur', this._onBlur);
        this.render();
    }

    disconnectedCallback() {
        window.removeEventListener('blur', this._onBlur);
        this._abort();
        // the events a pending reply owes are told, then nothing is left scheduled
        this._flushReply();
        if (this._clearTimers()) this._emit('position', { fen: this._model.state().fen, reason: 'cancel' });
    }

    attributeChangedCallback(name, old, value) {
        if (!this._ready || old === value) return;
        let moved = null; // the reason for a position event, when the game on the board changed
        if (name === 'fen') {
            if (value !== this._model.state().fen && this._applyPosition()) moved = 'attribute';
        } else if (name === 'puzzle') moved = this._applyPosition() ? 'attribute' : null;
        else if (name === 'mode') {
            const was = this._model.state();
            if (this._model.setMode(value ?? 'play').ok) {
                this._clearTimers();
                this._abort();
                // leaving setup loads the set-up position as a new game; leaving a puzzle takes a wrong move back
                if (was.mode === 'setup' && was.mode !== (value ?? 'play')) moved = 'mode';
                else if (was.puzzle.failed) moved = 'cancel';
            }
            this._tool = null;
        } else if (name === 'orientation') this._model.setOrientation(value === 'black' ? 'black' : 'white');
        else if (name === 'player') this._model.setPlayer(value);
        this.render();
        if (moved) this._emit('position', { fen: this._model.state().fen, reason: moved });
    }

    // the fen and puzzle attributes, applied together; a bad FEN leaves the board as it was, a bad line still shows
    // its position without the puzzle; either way an error event and a console warning say so. True when the position
    // was replaced, and so whatever was pending on the old one is gone.
    _applyPosition() {
        const fen = this.getAttribute('fen');
        const line = (this.getAttribute('puzzle') ?? '').trim().split(/\s+/).filter(Boolean);
        let r = { ok: true };
        let applied = Boolean(line.length || fen);
        if (line.length) r = this._model.setPosition(fen || Position.START_FEN, { puzzle: { moves: line } });
        else if (fen) r = this._model.setPosition(fen);
        if (!r.ok) {
            applied = Boolean(line.length && fen && this._model.setPosition(fen).ok);
            // the attribute at fault is named by the result's code, not by whether a puzzle is present
            const attribute = r.code === 'fen' ? 'fen' : 'puzzle';
            const reason = typeof r.reason === 'string' ? r.reason : (r.reason?.in?.(this._lang()) ?? '');
            console.warn(`<stepchess-board>: ${attribute} attribute rejected: ${reason}`);
            this.dispatchEvent(new CustomEvent('error', { detail: { attribute, result: r } }));
        }
        if (applied) {
            this._clearTimers();
            this._abort();
        }
        return applied;
    }

    // —— public API ——

    /** The model's state: fen, pieces, selection, last move, puzzle progress, … */
    get state() {
        return this._model.state();
    }

    /** The FEN the board's game started from (the puzzle's position in puzzle mode). */
    get startFen() {
        return this._model.startFen();
    }

    get fen() {
        return this._model.state().fen;
    }

    set fen(value) {
        this.setPosition(value);
    }

    /** A new position (and, with opts.puzzle {moves}, a puzzle from it); returns {ok} or a typed invalid result. */
    setPosition(fen, opts = {}) {
        const r = this._model.setPosition(fen, opts);
        if (r.ok) this._replaced('position');
        return r;
    }

    setPuzzle(p) {
        const r = this._model.setPuzzle(p ?? {});
        if (r.ok) this._replaced('puzzle');
        return r;
    }

    // the model took a new position: what was pending on the old one is dropped, the new one is drawn, and whoever
    // follows the board (<stepchess-moves>) is told. A rejected call never gets here: it is a no-op from end to end.
    _replaced(reason) {
        this._clearTimers();
        this._abort();
        this.render();
        this._emit('position', { fen: this._model.state().fen, reason });
    }

    /** Play moves (UCI or SAN) whatever the mode: an engine's reply, a line to show. Fires move with source 'api'. */
    playMoves(moves) {
        const r = this._model.playMoves(Array.isArray(moves) ? moves : [moves]);
        if (r.moves?.length) {
            // the game goes on: the reply the user's move was waiting for is told first (and spoken before the new
            // moves, not instead of them), a wrong move on show is gone
            const owed = Boolean(this._reply);
            this._flushReply();
            this._clearTimer('fail');
            this._abort();
            this._report(r.moves, 'api', owed);
            this.render();
            if (r.cancelled) this._emit('position', { fen: this._model.state().fen, reason: 'cancel' });
        }
        return r;
    }

    /** Arrows, squares and badges in the explain/ format; null clears them. */
    annotate(a) {
        this._model.annotate(a);
        this.render();
    }

    flip() {
        this._model.flip();
        this.render();
    }

    undo() {
        const out = this._model.undo();
        if (out.moves.length) {
            this._clearTimers();
            this._abort();
            this._say(msg('board.announce.undo').in(this._lang()));
            this.render();
            this._emit('position', { fen: this._model.state().fen, reason: 'undo' });
        }
        return out;
    }

    /** Drop the selection and any open promotion picker. */
    cancel() {
        this._abort();
        if (this._model.state().puzzle.failed) this._takeBack();
        else {
            this._model.cancel();
            this.render();
        }
    }

    // the wrong puzzle move on show is taken back (by its timer, or by cancel()); its timer has nothing left to do
    _takeBack() {
        this._clearTimer('fail');
        this._model.cancel();
        this.render();
        this._emit('position', { fen: this._model.state().fen, reason: 'cancel' });
    }

    // —— rendering ——

    _lang() {
        return langOf(this);
    }

    _buildGrid(orientation) {
        const b = this._board;
        b.textContent = '';
        this._cells.clear();
        for (let row = 0; row < 8; row++) {
            const r = document.createElement('div');
            r.className = 'row';
            r.setAttribute('role', 'row');
            for (let col = 0; col < 8; col++) {
                const file = orientation === 'black' ? 7 - col : col;
                const rank = orientation === 'black' ? row : 7 - row;
                const sq = nameOf(file, rank);
                const c = document.createElement('div');
                c.className = `sq ${(file + rank) % 2 ? 'light' : 'dark'}`;
                c.setAttribute('role', 'gridcell');
                c.setAttribute('part', 'square');
                c.dataset.sq = sq;
                c.tabIndex = -1;
                let coords = '';
                if (col === 0) coords += `<span class="coord rank" part="coord" aria-hidden="true">${rank + 1}</span>`;
                if (row === 7) coords += `<span class="coord file" part="coord" aria-hidden="true">${FILES[file]}</span>`;
                c.innerHTML = coords;
                r.append(c);
                this._cells.set(sq, c);
            }
            b.append(r);
        }
        b.append(this._under, this._layer, this._over, this._promo);
        // pieces jump to their new places instead of sliding across the board
        this._layer.classList.add('instant');
        for (const [sq, p] of this._pieces) this._place(p.el, sq, orientation);
        void this._layer.offsetWidth;
        this._layer.classList.remove('instant');
        this._builtFor = orientation;
    }

    _place(el, sq, orientation = this._builtFor) {
        const [c, r] = cellOf(sq, orientation);
        el.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
    }

    /** Draw the state; view (optional) overrides the pieces and the last move, to show a move before its reply. */
    render(view = null) {
        if (!view && this._nextView) {
            view = this._nextView;
            this._nextView = null;
        } else if (!view && this._reply) this._flushReply();
        const st = this._model.state();
        this._st = st;
        const lang = this._lang();
        if (st.orientation !== this._builtFor) {
            // the cells are rebuilt: a flip keeps the keyboard focus on the same square
            const focused = this.shadowRoot.activeElement?.dataset?.sq;
            this._buildGrid(st.orientation);
            if (focused) this._cells.get(focused)?.focus({ preventScroll: true });
        }
        const b = this._board;
        const pieces = view?.pieces ?? st.pieces;
        const last = view ? view.lastMove : st.lastMove;
        const coords = (this.getAttribute('coordinates') ?? '').toLowerCase();
        b.dataset.coords = ['none', 'off', 'false', 'hidden'].includes(coords) ? 'none' : 'inside';
        b.toggleAttribute('data-interactive', st.interactive);
        b.toggleAttribute('data-busy', Boolean(st.selected) || Boolean(this._g && this._g.kind !== 'tap'));
        b.setAttribute('aria-label', msg(st.mode === 'setup' ? 'board.board.setup' : st.turn === 'white' ? 'board.board.white' : 'board.board.black').in(lang));
        if (!this._focus) this._focus = st.orientation === 'black' ? 'h8' : 'a1';

        const targets = new Set(st.targets);
        const lastSq = last ? [last.from, last.to] : [];
        const hover = this._g?.kind === 'drag' ? this._g.over : null;
        for (const [sq, c] of this._cells) {
            const letter = pieces[sq];
            const cl = c.classList;
            cl.toggle('last', lastSq.includes(sq));
            cl.toggle('selected', st.selected === sq);
            cl.toggle('check', !view && st.check === sq);
            cl.toggle('target', targets.has(sq));
            cl.toggle('occupied', Boolean(letter));
            cl.toggle('movable', st.interactive && this._model.movable(sq));
            cl.toggle('hover', hover === sq && sq !== st.selected);
            c.tabIndex = sq === this._focus ? 0 : -1;
            c.setAttribute('aria-selected', String(st.selected === sq));
            c.setAttribute('aria-label', this._label(sq, letter, { last: lastSq.includes(sq), target: targets.has(sq), check: st.check === sq }, lang));
        }
        this._drawPieces(pieces);
        this._drawOverlay(st);
        this._drawPromotion(st, lang);
        this._drawPalette(st, lang);
        if (st.selected !== this._shownSelection) {
            this._shownSelection = st.selected;
            this._emit('select', { square: st.selected, targets: st.targets });
        }
    }

    _label(sq, letter, flags, lang) {
        const parts = [letter ? msg('board.square.piece', { piece: pieceName(letter), square: sq }) : msg('board.square.empty', { square: sq })];
        if (this._st.selected === sq) parts.push(msg('board.square.selected'));
        if (flags.target) parts.push(msg(letter ? 'board.square.capture' : 'board.square.target'));
        if (flags.check) parts.push(msg('board.square.check'));
        if (flags.last) parts.push(msg('board.square.last'));
        return parts.map((p) => p.in(lang)).join(', ');
    }

    _drawPieces(want) {
        this._pieces = drawPieces(this._layer, this._pieces, want, {
            dragged: this._g?.kind === 'drag' ? this._g.el : null,
            place: (el, sq) => this._place(el, sq),
        });
    }

    _drawOverlay(st) {
        const o = st.orientation;
        const a = st.annotations;
        this._under.innerHTML = marksSvg(a.squares, o);
        let over = a.arrows.map((x) => arrowSvg(x, o)).join('');
        over += st.drawn.arrows.map((x) => arrowSvg(x, o, ' drawn')).join('');
        const g = this._g;
        if (g?.kind === 'arrow' && g.to && g.to !== g.from) over += arrowSvg({ from: g.from, to: g.to, kind: g.arrowKind }, o, ' drawn');
        over += ringsSvg(st.drawn.squares, o);
        over += badgesSvg(a.badges, o);
        this._over.innerHTML = over;
    }

    _drawPromotion(st, lang) {
        const inside = this._promo.contains(this.shadowRoot.activeElement);
        if (!drawPromotion(this._promo, st, lang)) {
            // the picker closed under the focus (the position was replaced, Escape elsewhere): the focus goes back to the board
            if (inside && this._promo.hidden) this._cells.get(this._focus)?.focus({ preventScroll: true });
            return;
        }
        this._say(msg('board.announce.promotion').in(lang));
        this._promo.querySelector('.pick')?.focus({ preventScroll: true });
        // the picker opens under a finger that is still landing: its compatibility click must not pick the piece there
        this._promoGuardUntil = this._lastInput === 'touch' || this._lastInput === 'pen' ? performance.now() + PROMO_GUARD : 0;
    }

    _drawPalette(st, lang) {
        drawPalette(this._palette, st, lang, this._tool);
    }

    // —— input ——

    _squareAt(x, y) {
        const r = this._board.getBoundingClientRect();
        if (x < r.left || y < r.top || x >= r.right || y >= r.bottom || !r.width) return null;
        const col = Math.min(7, Math.floor(((x - r.left) / r.width) * 8));
        const row = Math.min(7, Math.floor(((y - r.top) / r.height) * 8));
        const black = this._builtFor === 'black';
        return nameOf(black ? 7 - col : col, black ? row : 7 - row);
    }

    _down(e) {
        if (!e.isPrimary || !this._promo.hidden) return;
        // a gesture whose pointerup never came (lost to another window, a dialog, a broken touch) gives way
        if (this._g) this._abort();
        this._lastInput = e.pointerType;
        const sq = this._squareAt(e.clientX, e.clientY);
        if (!sq) return;
        const st = this._model.state();
        if (st.mode === 'view') return; // a diagram: no input, not even arrows
        const base = { id: e.pointerId, type: e.pointerType, from: sq, to: sq, x0: e.clientX, y0: e.clientY };
        if (e.button === 2) {
            // a right drag draws an arrow, a right click circles a square
            this._g = { ...base, kind: 'arrow', arrowKind: e.shiftKey ? (e.altKey ? 'bad' : 'threat') : e.altKey ? 'idea' : 'best' };
            this._capture(e);
            return;
        }
        if (e.button !== 0) return;
        if (st.drawn.arrows.length || st.drawn.squares.length) this._model.clearDrawn();
        const tool = st.mode === 'setup' && this._tool;
        const movable = !tool && st.interactive && this._model.movable(sq) && !(st.mode === 'setup' && st.selected && st.selected !== sq);
        if (movable) {
            // a piece to pick up is selected at once: a drag needs its targets, and a cancelled press takes it back
            const wasSelected = st.selected === sq;
            if (!wasSelected) this._model.select(sq);
            this._g = { ...base, kind: 'press', piece: true, wasSelected, el: this._pieces.get(sq)?.el ?? null };
        } else {
            // any other tap acts when the pointer is lifted on the same square (_tapCommit), so a press that is cancelled,
            // scrolls away or turns into an arrow moves nothing
            this._g = { ...base, kind: 'tap', piece: false, moved: false };
            // a resting finger draws an arrow, but never from a piece it could pick up (that press is a drag) and
            // never from a square the tap is about to act on: a target of the selected piece, or any square being set up
            const acts = tool || (st.selected && (st.mode === 'setup' || st.targets.includes(sq)));
            if (e.pointerType !== 'mouse' && !acts) this._timer('press', LONG_PRESS, () => this._longPress());
        }
        this._capture(e);
        this.render();
    }

    _capture(e) {
        try {
            this._board.setPointerCapture(e.pointerId);
        } catch {}
    }

    // the tap on a square, acted on when the pointer is lifted: a setup tool puts its piece there, else select/move
    _tapCommit(sq) {
        if (!this._toolTap(sq)) this._after(this._model.select(sq), 'user');
    }

    // setup mode with a piece (or the eraser) chosen: put it on the square, or take it off; false when there is no tool
    _toolTap(sq) {
        const st = this._model.state();
        if (st.mode !== 'setup' || !this._tool) return false;
        this._model.place(sq, this._tool === 'erase' || st.pieces[sq] === this._tool ? null : this._tool);
        this._emitChange();
        return true;
    }

    _emitChange() {
        const st = this._model.state();
        this._emit('change', { fen: st.fen, valid: st.valid });
    }

    // a finger that rests becomes an arrow from its square (and a selection it was resting on is let go)
    _longPress() {
        const g = this._g;
        if (!g || g.kind !== 'tap') return;
        this._g = { ...g, kind: 'arrow', arrowKind: 'best' };
        this._model.select(null);
        this.render();
    }

    _move(e) {
        const g = this._g;
        if (!g || e.pointerId !== g.id) return;
        const dist = Math.hypot(e.clientX - g.x0, e.clientY - g.y0);
        if (g.kind === 'press' && dist > (SLOP[g.type] ?? 4)) {
            this._clearTimer('press');
            g.kind = 'drag';
            if (g.el) g.el.classList.add('drag', ...(g.type === 'touch' ? ['touch'] : []));
            this._board.toggleAttribute('data-dragging', true);
        } else if (g.kind === 'tap' && dist > (SLOP[g.type] ?? 4)) {
            this._clearTimer('press');
            // a finger or pen that moved is a scroll or a swipe, not a tap; a mouse may wobble within its square
            if (g.type !== 'mouse') g.moved = true;
        }
        if (g.kind === 'drag') {
            const r = this._board.getBoundingClientRect();
            const size = r.width / 8;
            if (g.el) g.el.style.transform = `translate(${e.clientX - r.left - size / 2}px, ${e.clientY - r.top - size / 2}px)`;
            const over = this._squareAt(e.clientX, e.clientY);
            if (over !== g.over) {
                g.over = over;
                for (const [sq, c] of this._cells) c.classList.toggle('hover', sq === over && sq !== g.from);
            }
        } else if (g.kind === 'arrow') {
            const to = this._squareAt(e.clientX, e.clientY);
            if (to !== g.to) {
                g.to = to;
                this._drawOverlay(this._model.state());
            }
        }
    }

    _up(e) {
        const g = this._g;
        if (!g || e.pointerId !== g.id) return;
        this._clearTimer('press');
        this._g = null;
        this._endDrag(g);
        const to = this._squareAt(e.clientX, e.clientY);
        if (g.kind === 'drag') this._after(this._model.drop(g.from, to), 'user');
        else if (g.kind === 'press' && g.wasSelected) this._model.select(g.from);
        else if (g.kind === 'arrow' && to) this._model.draw(g.from, to, g.arrowKind);
        else if (g.kind === 'tap' && to === g.from && !g.moved) this._tapCommit(g.from);
        this.render();
    }

    _endDrag(g) {
        if (g?.el) g.el.classList.remove('drag', 'touch');
        this._board.removeAttribute('data-dragging');
        for (const c of this._cells.values()) c.classList.remove('hover');
    }

    // a gesture the browser or the page took away: nothing is played, nothing stays selected
    _abort() {
        const g = this._g;
        this._clearTimer('press');
        if (!g) return;
        this._g = null;
        // the pointer is let go too, so its late lostpointercapture cannot be mistaken for the next gesture's
        try {
            this._board.releasePointerCapture(g.id);
        } catch {}
        this._endDrag(g);
        if (g.kind === 'drag' || g.kind === 'press') this._model.cancel();
        if (this.isConnected) this.render();
    }

    _key(e) {
        const sq = e.target?.dataset?.sq;
        if (!sq) return;
        this._lastInput = 'key';
        const [c, r] = cellOf(sq, this._builtFor);
        const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Home: [-c, 0], End: [7 - c, 0] };
        if (moves[e.key]) {
            e.preventDefault();
            const nc = Math.max(0, Math.min(7, c + moves[e.key][0]));
            const nr = Math.max(0, Math.min(7, r + moves[e.key][1]));
            const black = this._builtFor === 'black';
            this._setFocus(nameOf(black ? 7 - nc : nc, black ? nr : 7 - nr), true);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            const before = this._model.state().selected;
            if (!this._toolTap(sq)) {
                const out = this._model.select(sq);
                this._after(out, 'user');
                if (!out.moves.length && !out.promotion) this._announceSelection(before);
            }
            this.render();
        } else if (e.key === 'Escape') {
            const before = this._model.state().selected;
            this.cancel();
            if (before) this._announceSelection(before);
        }
    }

    // the keyboard has no pointer to show what was selected: the live region says which piece and where it can go
    _announceSelection(before) {
        const st = this._model.state();
        const lang = this._lang();
        if (st.selected) {
            const params = { piece: pieceName(st.pieces[st.selected]), square: st.selected, targets: st.targets };
            this._say(msg(st.targets.length ? 'board.announce.selected' : 'board.announce.selectedPlain', params).in(lang));
        } else if (before) this._say(msg('board.announce.deselected').in(lang));
    }

    _setFocus(sq, move) {
        if (this._focus === sq && !move) return;
        const prev = this._cells.get(this._focus);
        if (prev) prev.tabIndex = -1;
        this._focus = sq;
        const c = this._cells.get(sq);
        if (c) {
            c.tabIndex = 0;
            if (move) c.focus();
        }
    }

    _promoClick(e) {
        const t = e.target.closest?.('[data-promo]');
        if (!t || performance.now() < this._promoGuardUntil) return;
        const out = this._model.promote(t.dataset.promo || null);
        this._after(out, 'user');
        this.render();
        this._cells.get(this._focus)?.focus({ preventScroll: true });
    }

    _promoKey(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            this._model.promote(null);
            this.render();
            this._cells.get(this._focus)?.focus({ preventScroll: true });
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Tab') {
            // the picker is modal: the arrows and Tab walk its pieces in a circle, the focus never leaves it
            e.preventDefault();
            const picks = [...this._promo.querySelectorAll('.pick')];
            const i = picks.indexOf(this.shadowRoot.activeElement);
            const back = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
            picks[i < 0 ? (back ? picks.length - 1 : 0) : (i + (back ? picks.length - 1 : 1)) % picks.length]?.focus();
        }
    }

    _paletteClick(e) {
        const b = e.target.closest?.('button');
        if (!b) return;
        if (b.dataset.tool) this._tool = this._tool === b.dataset.tool ? null : b.dataset.tool;
        else if (b.dataset.act === 'turn') this._model.setTurn(this._model.state().turn === 'white' ? 'black' : 'white');
        else if (b.dataset.act === 'clear') this._model.clear();
        else if (b.dataset.act === 'start') {
            this._model.clear();
            for (const [sq, l] of Object.entries(piecesOfFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'))) this._model.place(sq, l);
            this._model.setTurn('white');
        }
        if (b.dataset.act) this._emitChange();
        this.render();
    }

    // —— outcomes: events, announcements, the puzzle's reply and failure ——

    _after(out, source) {
        const lang = this._lang();
        const own = out.moves.filter((m) => !m.auto);
        const auto = out.moves.filter((m) => m.auto);
        this._report(own, source);
        if (auto.length && own.length) {
            // show the user's move first, then the reply
            const lastOwn = own[own.length - 1];
            // the line as it is now: a later playMoves must not leak into the event the reply owes
            const line = this._model.state().history.map((h) => h.uci);
            this._nextView = { pieces: piecesOfFen(lastOwn.fen), lastMove: { from: lastOwn.uci.slice(0, 2), to: lastOwn.uci.slice(2, 4) } };
            this._reply = () => {
                this._report(auto, 'auto');
                this._puzzleEnd(out, lang, line);
            };
            this._timer('reply', REPLY_DELAY, () => this.render());
            return;
        }
        this._puzzleEnd(
            out,
            lang,
            this._model.state().history.map((h) => h.uci),
        );
    }

    // tell the events a pending reply owes now, instead of when its timer fires
    _flushReply() {
        this._clearTimer('reply');
        this._nextView = null;
        const f = this._reply;
        this._reply = null;
        f?.();
    }

    _puzzleEnd(out, lang, line) {
        if (out.puzzle === 'solved') {
            this._say(msg('board.announce.solved').in(lang), true);
            this._emit('puzzle-solved', { moves: line });
        } else if (out.puzzle === 'failed') {
            const wrong = out.moves[out.moves.length - 1];
            this._say(msg('board.announce.failed').in(lang), true);
            this._emit('puzzle-failed', { uci: wrong?.uci ?? null, expected: out.expected });
            this._timer('fail', FAIL_SHOW, () => this._takeBack());
        }
    }

    // fire move events and announce the moves
    _report(moves, source, append = false) {
        if (!moves.length) return;
        const lang = this._lang();
        const st = this._model.state();
        const text = moves.map((m, i) => {
            let line = msg(`board.announce.${m.color}`, { san: sanIn(m, lang) }).in(lang);
            if (m.san.endsWith('#')) line += ` ${msg('board.announce.mate').in(lang)}`;
            else if (m.san.endsWith('+')) line += ` ${msg('board.announce.check').in(lang)}`;
            else if (i === moves.length - 1 && st.status === 'stalemate' && m.fen === st.fen) line += ` ${msg('board.announce.stalemate').in(lang)}`;
            return line;
        });
        this._say(text.join(' '), append);
        for (const m of moves) this._emit('move', { uci: m.uci, san: m.san, fen: m.fen, color: m.color, source: m.auto ? 'auto' : source });
    }

    _say(text, append = false) {
        const live = this._live;
        const next = append && this._said ? `${this._said} ${text}` : text;
        this._said = next;
        live.textContent = '';
        this._timer('say', 40, () => {
            live.textContent = next;
            this._timer('said', 1500, () => (this._said = ''));
        });
    }

    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    _timer(name, ms, fn) {
        this._clearTimer(name);
        const id = setTimeout(() => {
            this._timers.delete(entry);
            fn();
        }, ms);
        const entry = { name, id };
        this._timers.add(entry);
    }

    _clearTimer(name) {
        for (const t of this._timers)
            if (t.name === name) {
                clearTimeout(t.id);
                this._timers.delete(t);
            }
    }

    // Nothing scheduled outlives the state it belongs to: every timer is cleared (the long press, the reply, the wrong
    // move on show, the announcements), the reply's events are dropped with the position they describe, the live region
    // is emptied, and a wrong puzzle move on show is taken back at once. Callers that must not lose the reply's events
    // call _flushReply first.
    _clearTimers() {
        this._reply = null;
        this._nextView = null;
        for (const t of this._timers) clearTimeout(t.id);
        this._timers.clear();
        this._said = '';
        this._live.textContent = '';
        // true when a wrong puzzle move was on show and is now taken back (a caller that is not already telling its
        // followers about a new position must send position/cancel)
        const failed = this._model.state().puzzle.failed;
        if (failed) this._model.cancel();
        return failed;
    }
}

/** Register <stepchess-board> (once). */
export function defineBoard() {
    if (!customElements.get('stepchess-board')) customElements.define('stepchess-board', StepchessBoard);
}
