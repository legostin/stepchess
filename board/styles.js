// board/styles — the CSS of the board elements: theme tokens (light and dark), the board, the evalbar, moves, explain.
//
// Public custom properties (--sc-*) set from outside win; each has a light default and a dark one under
// prefers-color-scheme: dark. Inside, the elements read the private --_* copies.

// the theme: public properties with light defaults, then the dark defaults
const TOKENS = `
:host {
    --_light: var(--sc-light, #eee5d3);
    --_dark: var(--sc-dark, #ad8a68);
    --_select: var(--sc-select, rgba(46, 137, 96, 0.5));
    --_last: var(--sc-last, rgba(222, 186, 54, 0.45));
    --_check: var(--sc-check, #e0402f);
    --_best: var(--sc-arrow-best, #2a9560);
    --_threat: var(--sc-arrow-threat, #d63c32);
    --_bad: var(--sc-arrow-bad, #e2832a);
    --_idea: var(--sc-arrow-idea, #3577d4);
    --_attack: var(--sc-arrow-attack, #c8481f);
    --_defend: var(--sc-arrow-defend, #2b93a5);
    --_fg: var(--sc-fg, #221f1b);
    --_muted: var(--sc-muted, #6c655b);
    --_surface: var(--sc-surface, #fbf9f4);
    --_raised: var(--sc-raised, #ffffff);
    --_border: var(--sc-border, #ddd4c4);
    --_accent: var(--sc-accent, #2a7a52);
    --_focus: var(--sc-focus, #2f6fd6);
    --_radius: var(--sc-radius, 6px);
    --_anim: 170ms;
    color: var(--_fg);
}
@media (prefers-color-scheme: dark) {
    :host {
        --_light: var(--sc-light, #bdb19c);
        --_dark: var(--sc-dark, #80684f);
        --_select: var(--sc-select, rgba(70, 170, 120, 0.55));
        --_last: var(--sc-last, rgba(232, 196, 64, 0.42));
        --_fg: var(--sc-fg, #ece6da);
        --_muted: var(--sc-muted, #a99f90);
        --_surface: var(--sc-surface, #23211e);
        --_raised: var(--sc-raised, #2d2a26);
        --_border: var(--sc-border, #423d36);
        --_accent: var(--sc-accent, #6cc195);
        --_focus: var(--sc-focus, #7aa7f0);
    }
}
@media (prefers-reduced-motion: reduce) {
    :host { --_anim: 0ms; }
}
.sr-only {
    position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
    clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}
button { font: inherit; color: inherit; }
`;

const BOARD = `
:host { display: block; position: relative; width: 100%; max-width: 100%; -webkit-tap-highlight-color: transparent; }
:host([hidden]) { display: none; }
.board {
    position: relative; width: 100%; aspect-ratio: 1 / 1; container-type: inline-size;
    border-radius: var(--sc-board-radius, 4px); overflow: hidden;
    user-select: none; -webkit-user-select: none; -webkit-touch-callout: none;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.12), 0 4px 14px -6px rgba(0, 0, 0, 0.25);
    touch-action: manipulation;
}
.board[data-busy] { touch-action: none; }
.row { display: flex; height: 12.5%; }
.sq {
    position: relative; width: 12.5%; height: 100%; outline: none; touch-action: manipulation;
}
.sq.movable, .board[data-busy] .sq { touch-action: none; }
.board[data-interactive] .sq.movable { cursor: grab; }
.board[data-dragging], .board[data-dragging] .sq { cursor: grabbing; }
.sq.light { background-color: var(--_light); }
.sq.dark { background-color: var(--_dark); }
.sq::before { content: ''; position: absolute; inset: 0; pointer-events: none; }
.sq.last::before { background: var(--_last); }
.sq.selected::before { background: var(--_select); }
.sq.check { background-image: radial-gradient(circle at center, var(--_check) 0%, color-mix(in srgb, var(--_check) 70%, transparent) 30%, transparent 72%); }
.sq.target::after {
    content: ''; position: absolute; left: 50%; top: 50%; width: 30%; height: 30%; translate: -50% -50%;
    border-radius: 50%; background: var(--_select); pointer-events: none;
}
.sq.target.occupied::after {
    width: 100%; height: 100%; border-radius: 0; background:
        radial-gradient(circle at center, transparent 0 66%, var(--_select) 67%);
}
.sq.hover::before { background: var(--_select); opacity: 0.55; }
.sq.hover.target::after { opacity: 0; }
.sq:focus-visible { box-shadow: inset 0 0 0 3px var(--_focus); z-index: 1; }
.coord {
    position: absolute; font: 700 max(9px, 2.5cqw) / 1 system-ui, -apple-system, 'Segoe UI', sans-serif;
    pointer-events: none; opacity: 0.9;
}
.board[data-coords='none'] .coord { display: none; }
.instant .piece { transition: none; }
.coord.rank { left: 4%; top: 5%; }
.coord.file { right: 5%; bottom: 4%; }
.sq.light .coord { color: var(--_dark); }
.sq.dark .coord { color: var(--_light); }
.layer { position: absolute; inset: 0; pointer-events: none; }
svg.layer { width: 100%; height: 100%; overflow: visible; }
.piece {
    position: absolute; left: 0; top: 0; width: 12.5%; height: 12.5%;
    transition: transform var(--_anim) cubic-bezier(0.25, 0.8, 0.35, 1);
    will-change: transform;
}
.piece svg { display: block; width: 100%; height: 100%; }
.piece.drag {
    transition: none; z-index: 3; filter: drop-shadow(0 5px 6px rgba(0, 0, 0, 0.32));
}
.piece.drag.touch svg { transform: scale(1.35) translateY(-22%); }
.piece.fresh { animation: sc-in var(--_anim) ease-out; }
@keyframes sc-in { from { opacity: 0; } }
.over { z-index: 4; }
.arrow { opacity: 0.82; }
.arrow.drawn { opacity: 0.7; }
.k-best { fill: var(--_best); stroke: var(--_best); color: var(--_best); }
.k-threat { fill: var(--_threat); stroke: var(--_threat); color: var(--_threat); }
.k-bad { fill: var(--_bad); stroke: var(--_bad); color: var(--_bad); }
.k-idea { fill: var(--_idea); stroke: var(--_idea); color: var(--_idea); }
.k-attack { fill: var(--_attack); stroke: var(--_attack); color: var(--_attack); }
.k-defend { fill: var(--_defend); stroke: var(--_defend); color: var(--_defend); }
.mark { stroke: none; fill-opacity: 0.38; }
.ring { fill: none; stroke-width: 0.075; opacity: 0.8; }
.badge circle { stroke: rgba(255, 255, 255, 0.92); stroke-width: 0.035; }
.badge text { fill: #fff; stroke: none; }
.promotion { position: absolute; inset: 0; z-index: 6; }
.promotion[hidden] { display: none; }
.promotion .backdrop { position: absolute; inset: 0; background: rgba(20, 18, 15, 0.45); border: 0; padding: 0; cursor: default; }
.promotion .pick {
    position: absolute; width: 12.5%; height: 12.5%; padding: 0; border: 0; cursor: pointer;
    background: radial-gradient(circle at center, var(--_raised) 0 58%, color-mix(in srgb, var(--_raised) 80%, #888) 70%);
    border-radius: 50%; transition: border-radius var(--_anim), background var(--_anim);
    touch-action: manipulation;
}
.promotion .pick:hover, .promotion .pick:focus-visible { border-radius: 8%; background: var(--_raised); outline: none; }
.promotion .pick:focus-visible { box-shadow: inset 0 0 0 3px var(--_focus); }
.promotion .pick svg { width: 86%; height: 86%; display: block; margin: 7%; pointer-events: none; }
.palette { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: center; margin-top: 10px; }
.palette[hidden] { display: none; }
.palette .group { display: flex; flex-wrap: wrap; justify-content: center; max-width: 100%; gap: 2px; padding: 3px; border-radius: var(--_radius); background: var(--_surface); border: 1px solid var(--_border); }
.palette button {
    width: 36px; height: 36px; padding: 2px; border: 0; border-radius: 4px; background: transparent; cursor: pointer;
    display: grid; place-items: center; touch-action: manipulation;
}
.palette button svg { width: 100%; height: 100%; }
.palette button[aria-pressed='true'] { background: var(--_select); }
.palette button:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
.palette .text { width: auto; padding: 0 10px; font-size: 13px; white-space: nowrap; }
.palette .eraser { color: var(--_fg); }
`;

const EVALBAR = `
:host { display: block; position: relative; width: 16px; min-height: 40px; flex: none; align-self: stretch; }
:host([horizontal]) { width: 100%; height: 16px; min-height: 0; }
:host([hidden]) { display: none; }
.bar {
    position: relative; width: 100%; height: 100%; border-radius: 3px; overflow: hidden;
    background: var(--sc-evalbar-black, #2f2c28); box-sizing: border-box; border: 1px solid var(--sc-evalbar-border, rgba(0, 0, 0, 0.22));
}
.white {
    position: absolute; left: 0; right: 0; bottom: 0; background: var(--sc-evalbar-white, #f4f0e7);
    transition: height 380ms cubic-bezier(0.25, 0.8, 0.35, 1), width 380ms cubic-bezier(0.25, 0.8, 0.35, 1);
}
:host([orientation='black']) .white { bottom: auto; top: 0; }
:host([horizontal]) .white { top: 0; bottom: 0; left: 0; right: auto; }
:host([horizontal][orientation='black']) .white { left: auto; right: 0; }
.mid { position: absolute; left: 0; right: 0; top: calc(50% - 1px); height: 2px; background: var(--sc-evalbar-mid, rgba(214, 60, 50, 0.55)); }
:host([horizontal]) .mid { top: 0; bottom: 0; left: calc(50% - 1px); width: 2px; height: auto; }
.value {
    position: absolute; left: 0; right: 0; text-align: center; padding: 3px 0;
    font: 700 9px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; font-variant-numeric: tabular-nums;
}
:host([horizontal]) .value { top: 0; bottom: 0; left: auto; right: auto; padding: 0 4px; display: flex; align-items: center; }
.value.on-white { color: #2f2c28; }
.value.on-black { color: #f4f0e7; }
@media (prefers-reduced-motion: reduce) { .white { transition: none; } }
`;

const MOVES = `
:host { display: block; font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; }
.box { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_surface); overflow: hidden; }
.nav { display: flex; border-bottom: 1px solid var(--_border); }
.nav button {
    flex: 1; min-height: 40px; border: 0; background: transparent; cursor: pointer; display: grid; place-items: center;
    color: var(--_muted);
}
.nav button + button { border-left: 1px solid var(--_border); }
.nav button:hover:not(:disabled) { background: var(--_raised); color: var(--_fg); }
.nav button:disabled { opacity: 0.35; cursor: default; }
.nav button:focus-visible { outline: 2px solid var(--_focus); outline-offset: -2px; }
.nav svg { width: 18px; height: 18px; fill: currentColor; }
.list { padding: 8px 10px; max-height: var(--sc-moves-height, 260px); overflow-y: auto; overflow-wrap: anywhere; }
.empty { color: var(--_muted); font-style: italic; }
.num { color: var(--_muted); margin-right: 2px; font-variant-numeric: tabular-nums; }
.mv {
    display: inline-flex; align-items: baseline; gap: 1px; border: 0; background: transparent; padding: 1px 5px; margin: 1px 1px;
    border-radius: 4px; cursor: pointer; font-weight: 600; line-height: 1.4; min-height: 28px; align-items: center;
}
.mv:hover { background: var(--_raised); }
.mv[aria-current='true'] { background: var(--_accent); color: var(--_surface); }
.mv:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
.var { color: var(--_muted); font-size: 0.92em; }
.var .mv { font-weight: 500; }
.glyph { font-weight: 800; margin-left: 1px; }
.g-brilliant { color: #1f9e89; } .g-good { color: #5b8f2f; } .g-interesting { color: #8a63d2; }
.g-dubious { color: #c9930f; } .g-mistake { color: #e0712a; } .g-blunder { color: #d23b30; }
.cls { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-left: 4px; align-self: center; }
.c-best { background: #2a9560; } .c-good { background: #8db866; } .c-inaccuracy { background: #e2b32a; }
.c-mistake { background: #e2832a; } .c-blunder { background: #d63c32; }
.mv[aria-current='true'] .glyph { color: inherit; }
.error { color: #c0392b; }
`;

const EXPLAIN = `
:host { display: block; font: 15px/1.55 system-ui, -apple-system, 'Segoe UI', sans-serif; }
[hidden] { display: none !important; }
.box { border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_surface); padding: 14px 16px; }
.head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin-bottom: 8px; }
.san { font-weight: 800; font-size: 1.15em; }
.cls { font-size: 0.82em; font-weight: 700; padding: 1px 8px; border-radius: 999px; color: #fff; }
.c-best { background: #2a9560; } .c-good { background: #6d9a45; } .c-inaccuracy { background: #c9930f; }
.c-mistake { background: #e0712a; } .c-blunder { background: #d23b30; }
.count { margin-left: auto; color: var(--_muted); font-size: 0.85em; font-variant-numeric: tabular-nums; }
.title { margin: 0 0 4px; font-size: 1em; font-weight: 700; }
.text { margin: 0; }
.line { margin: 8px 0 0; color: var(--_muted); font-size: 0.92em; }
.line b { color: var(--_fg); font-weight: 600; }
.dots { display: flex; gap: 5px; margin: 12px 0 0; }
.dots i { width: 7px; height: 7px; border-radius: 50%; background: var(--_border); }
.dots i.on { background: var(--_accent); }
.nav { display: flex; gap: 8px; margin-top: 12px; }
.nav button {
    flex: 1; min-height: 40px; border: 1px solid var(--_border); border-radius: var(--_radius); background: var(--_raised);
    cursor: pointer; font-weight: 600;
}
.nav button:hover:not(:disabled) { border-color: var(--_accent); }
.nav button:disabled { opacity: 0.4; cursor: default; }
.nav button:focus-visible { outline: 2px solid var(--_focus); outline-offset: 1px; }
.empty, .error { color: var(--_muted); margin: 0; }
.note { margin: 0; }
`;

export const boardCss = TOKENS + BOARD;
export const evalbarCss = TOKENS + EVALBAR;
export const movesCss = TOKENS + MOVES;
export const explainCss = TOKENS + EXPLAIN;
