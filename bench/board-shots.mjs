// bench/board-shots — headless screenshots and input checks of board/demo.html (Playwright, Chromium or Edge).
//
//   node bench/board-shots.mjs [--w 320,768,1280] [--theme light,dark] [--out bench/out] [--no-checks]
//
// Serves the repository over a tiny static server on a free port (ES modules do not load from file://), opens the demo
// at each width in light and dark, and saves full-page shots (demo-<w>-<theme>.png) plus a close-up of the analysis
// board. It fails on a console error, a page error, a failed request or a page that scrolls sideways. Then it plays
// the board by mouse, touch (CDP touch events) and keyboard and checks the state after each gesture: tap-tap, drag,
// a drag released off the board, a cancelled promotion, puzzle taps on an opponent piece, arrows by right-drag and by
// long press. Further checks drive fresh boards by keyboard and API calls: rejected calls that must be no-ops, the
// timers (reply, wrong move, announcements, links) on undo, playMoves and disconnect, pointer capture, announcements,
// the promotion focus trap, focus after a flip, the moves list following the board, and the explain focus handoff.
// Needs playwright-core: PLAYWRIGHT_CORE, or the copy npx keeps in its cache; PW_CHANNEL (default msedge).
/* global window, document, PointerEvent */ // the callbacks of page.evaluate run in the browser
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { msg } from '../src/index.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i < 0 ? def : args[i + 1];
};
const widths = String(opt('w', '320,768,1280')).split(',').map(Number);
const themes = String(opt('theme', 'light,dark')).split(',');
const outDir = path.resolve(ROOT, opt('out', 'bench/out'));
const checks = !args.includes('--no-checks');
fs.mkdirSync(outDir, { recursive: true });

// playwright-core: the env, else the first copy in an npx cache (POSIX ~/.npm, Windows %LOCALAPPDATA%\npm-cache)
function findPlaywright() {
    if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE;
    const caches = [path.join(os.homedir(), '.npm/_npx'), path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData/Local'), 'npm-cache/_npx')];
    for (const dir of caches) {
        if (!fs.existsSync(dir)) continue;
        for (const d of fs.readdirSync(dir)) {
            const p = path.join(dir, d, 'node_modules/playwright-core');
            if (fs.existsSync(p)) return p;
        }
    }
    throw new Error('playwright-core not found: set PLAYWRIGHT_CORE or run `npx playwright --version` once');
}
const { chromium } = createRequire(import.meta.url)(findPlaywright());

// a static server for the repository
const TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
};
const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const file = path.join(ROOT, decodeURIComponent(url.pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/board/demo.html`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'msedge', headless: true });
const problems = [];
const passed = [];
const fail = (what) => problems.push(what);
const check = (ok, what) => (ok ? passed.push(what) : fail(what));

async function open(w, theme, { touch = w < 700, lang = 'ru' } = {}) {
    const ctx = await browser.newContext({
        viewport: { width: w, height: w < 700 ? 820 : 900 },
        deviceScaleFactor: w < 700 ? 2 : 1,
        colorScheme: theme,
        hasTouch: touch,
        isMobile: touch,
    });
    // the demo opponent plays at random: a fixed sequence keeps the games, and so the checks that count plies, repeatable
    await ctx.addInitScript(() => {
        let seed = 42;
        Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    });
    const page = await ctx.newPage();
    const tag = `${w}/${theme}`;
    page.on('console', (m) => m.type() === 'error' && fail(`${tag}: console error: ${m.text()}`));
    page.on('pageerror', (e) => fail(`${tag}: page error: ${e.message}`));
    page.on('requestfailed', (r) => fail(`${tag}: request failed: ${r.url()}`));
    await page.goto(`${base}?lang=${lang}`);
    await page.waitForFunction(() => window.demoReady === true, null, { timeout: 15000 });
    return { ctx, page };
}

// the center of a square of a board, in page coordinates (after scrolling the board into view)
async function squareAt(page, id, sq) {
    return page.evaluate(
        ([id, sq]) => {
            const b = document.getElementById(id);
            b.scrollIntoView({ block: 'center' });
            const r = b.shadowRoot.querySelector(`[data-sq="${sq}"]`).getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        },
        [id, sq],
    );
}

// the state a board must be in after an aborted gesture
const boardInfo = (page, id) =>
    page.evaluate((id) => {
        const b = document.getElementById(id);
        const st = b.state;
        const root = b.shadowRoot;
        return {
            fen: st.fen,
            selected: st.selected,
            targets: st.targets.length,
            pending: st.pendingPromotion,
            history: st.history.map((h) => h.uci),
            drawn: st.drawn.arrows.length + st.drawn.squares.length,
            pieces: root.querySelectorAll('.piece').length,
            dragging: root.querySelectorAll('.piece.drag').length,
            promoOpen: !root.querySelector('.promotion').hidden,
            stateCount: Object.keys(st.pieces).length,
        };
    }, id);
const clean = (i) => i.selected === null && i.targets === 0 && i.pending === null && i.dragging === 0 && !i.promoOpen && i.pieces === i.stateCount;

async function touchDrag(page, cdp, from, to, { hold = 0, steps = 8 } = {}) {
    const pt = (p) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
    if (hold) await page.waitForTimeout(hold);
    for (let i = 1; i <= steps; i++) {
        const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p) });
        await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(60);
}

// a finger put on a square and moved toward another, still down (the caller ends it, cancels it or does something else)
async function touchHold(page, cdp, from, to, steps = 6) {
    const pt = (p) => [{ x: p.x, y: p.y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(from) });
    for (let i = 1; i <= steps; i++) {
        const p = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p) });
        await page.waitForTimeout(16);
    }
}

async function mouseDrag(page, from, to, button = 'left') {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down({ button });
    for (let i = 1; i <= 6; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
    await page.mouse.up({ button });
    await page.waitForTimeout(60);
}

// —— screenshots ——
for (const theme of themes) {
    for (const w of widths) {
        const { ctx, page } = await open(w, theme, { lang: theme === 'dark' ? 'en' : 'ru' });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        check(overflow <= 0, `${w}/${theme}: no horizontal scroll (overflow ${overflow}px)`);
        // a selected piece with its targets on the play board, so the shot shows them
        const e2 = await squareAt(page, 'play', 'e2');
        if (w < 700) await page.touchscreen.tap(e2.x, e2.y);
        else await page.mouse.click(e2.x, e2.y);
        await page.waitForTimeout(250);
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.screenshot({ path: path.join(outDir, `demo-${w}-${theme}.png`), fullPage: true });
        await page.locator('#analysis-card').screenshot({ path: path.join(outDir, `analysis-${w}-${theme}.png`) });
        await page.locator('#view-card').screenshot({ path: path.join(outDir, `view-${w}-${theme}.png`) });
        await ctx.close();
    }
}

// —— input checks ——
if (checks) {
    // mouse at 1280
    {
        const { ctx, page } = await open(1280, 'light');
        const at = (sq) => squareAt(page, 'play', sq);
        await page.evaluate(() => {
            window.moves = [];
            document.getElementById('play').addEventListener('move', (e) => window.moves.push(e.detail));
        });
        await mouseDrag(page, await at('e2'), await at('e4'));
        let i = await boardInfo(page, 'play');
        check(i.history[0] === 'e2e4' && clean(i), 'mouse: drag e2-e4 plays the move and leaves no selection');
        check((await page.evaluate(() => window.moves[0]?.source)) === 'user', 'mouse: the move event says source user');
        await page.waitForTimeout(700); // the demo opponent answers
        i = await boardInfo(page, 'play');
        check(i.history.length === 2, 'mouse: the demo opponent answered through playMoves');
        const before = i.fen;
        const d2 = await at('d2');
        await mouseDrag(page, d2, { x: d2.x, y: d2.y + 600 }); // released far below the board
        i = await boardInfo(page, 'play');
        check(i.fen === before && clean(i), 'mouse: a drag released off the board plays nothing, leaves no selection or ghost');
        await page.mouse.click((await at('g1')).x, (await at('g1')).y);
        i = await boardInfo(page, 'play');
        check(i.selected === 'g1' && i.targets >= 2, 'mouse: a click selects g1 and shows its targets');
        await page.mouse.click((await at('f3')).x, (await at('f3')).y);
        i = await boardInfo(page, 'play');
        check(i.history[2] === 'g1f3' && clean(i), 'mouse: click-click g1 f3 plays Nf3');
        await page.waitForTimeout(700);
        // right-drag draws an arrow, a left click clears it
        await mouseDrag(page, await at('d2'), await at('d4'), 'right');
        i = await boardInfo(page, 'play');
        check(i.drawn === 1 && i.selected === null, 'mouse: right-drag draws an arrow');
        await page.mouse.click((await at('h4')).x, (await at('h4')).y);
        check((await boardInfo(page, 'play')).drawn === 0, 'mouse: a left click clears drawn arrows');

        // a gesture whose pointerup never came must not lock the board: the next press takes over
        await page.evaluate(() => document.getElementById('play').setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
        const d2s = await at('d2');
        await page.evaluate(
            ([x, y]) => {
                const el = document.getElementById('play').shadowRoot.querySelector('.board');
                const ev = (type, dx) =>
                    new PointerEvent(type, {
                        pointerId: 77,
                        pointerType: 'mouse',
                        isPrimary: true,
                        button: 0,
                        buttons: 1,
                        clientX: x + dx,
                        clientY: y,
                        bubbles: true,
                    });
                el.dispatchEvent(ev('pointerdown', 0));
                el.dispatchEvent(ev('pointermove', 30)); // now a drag, and no pointerup will ever come
            },
            [d2s.x, d2s.y],
        );
        i = await boardInfo(page, 'play');
        check(i.selected === 'd2' && i.dragging === 1, 'stale gesture: a drag that never ends is under way');
        await mouseDrag(page, await at('e2'), await at('e4'));
        i = await boardInfo(page, 'play');
        check(i.history[0] === 'e2e4' && clean(i), 'stale gesture: the next press aborts it and plays e2-e4, leaving a clean board');
        await page.waitForTimeout(700);

        // the diagram takes no input: no arrows, no selection
        const va = (sq) => squareAt(page, 'view', sq);
        await mouseDrag(page, await va('e4'), await va('e5'), 'right');
        await page.mouse.click((await va('d4')).x, (await va('d4')).y, { button: 'right' });
        await page.mouse.click((await va('c4')).x, (await va('c4')).y);
        i = await boardInfo(page, 'view');
        check(i.drawn === 0 && i.selected === null, 'view: right-drag, right click and click change nothing');

        // promotion: a drag to the last rank opens the picker; Escape takes it back
        await page.evaluate(() => document.getElementById('analysis').setPosition('k7/4P3/8/8/8/8/8/4K3 w - - 0 1'));
        const pa = (sq) => squareAt(page, 'analysis', sq);
        await mouseDrag(page, await pa('e7'), await pa('e8'));
        i = await boardInfo(page, 'analysis');
        check(i.promoOpen && i.pending?.to === 'e8', 'promotion: a drag to e8 opens the picker');
        await page.locator('#analysis-card').screenshot({ path: path.join(outDir, 'promotion-1280-light.png') });
        await page.keyboard.press('Escape');
        i = await boardInfo(page, 'analysis');
        check(i.fen.startsWith('k7/4P3/') && clean(i), 'promotion: Escape cancels: the pawn is back, nothing selected');
        await mouseDrag(page, await pa('e7'), await pa('e8'));
        const backdrop = await pa('a1');
        await page.mouse.click(backdrop.x, backdrop.y);
        i = await boardInfo(page, 'analysis');
        check(i.fen.startsWith('k7/4P3/') && clean(i), 'promotion: a click outside the picker cancels it');
        await mouseDrag(page, await pa('e7'), await pa('e8'));
        await page.evaluate(() => document.getElementById('analysis').shadowRoot.querySelector('[data-promo="n"]').click());
        i = await boardInfo(page, 'analysis');
        check(i.history[0] === 'e7e8n' && clean(i), 'promotion: picking the knight plays e8=N');

        // explain: the live region is the same node across steps, only its text changes
        const live1 = await page.evaluate(() => {
            const root = document.getElementById('explain').shadowRoot;
            window.liveNode = root.querySelector('[aria-live]');
            const before = window.liveNode.textContent;
            root.querySelector('[data-go="next"]').click();
            const after = root.querySelector('[aria-live]');
            return { same: after === window.liveNode, changed: after.textContent !== before, focus: root.activeElement?.dataset?.go ?? null };
        });
        check(live1.same && live1.changed, `explain: Next changes the text of the same aria-live node (${JSON.stringify(live1)})`);

        // explain: a game that is over (a terminal result) is a plain note, a refusal is an error
        const styled = await page.evaluate(() => {
            const ex = document.createElement('stepchess-explain');
            document.body.append(ex);
            const shown = (r) => {
                ex.result = r;
                const p = ex.shadowRoot.querySelector('.note, .error');
                return p ? `${p.className}:${p.textContent}` : 'none';
            };
            const out = {
                terminal: shown({ ok: true, kind: 'terminal', state: 'checkmate', winner: 'w', reason: 'over' }),
                invalid: shown({ ok: false, kind: 'invalid', code: 'fen', reason: 'bad' }),
            };
            ex.remove();
            return out;
        });
        check(
            styled.terminal === 'note:over' && styled.invalid === 'error:bad',
            `explain: a terminal result is a note, a refusal an error (${JSON.stringify(styled)})`,
        );

        // a bad puzzle attribute: an error event and a warning, the board stays usable
        const bad = await page.evaluate(
            () =>
                new Promise((resolve) => {
                    const b = document.createElement('stepchess-board');
                    b.setAttribute('mode', 'puzzle');
                    b.setAttribute('fen', 'r5k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1');
                    b.setAttribute('puzzle', 'd2d8 e2e4');
                    let got = null;
                    b.addEventListener('error', (e) => (got = e.detail));
                    document.body.append(b);
                    setTimeout(() => {
                        const ok = b.setPuzzle({ moves: ['d2d8', 'a8d8', 'd1d8'] }).ok;
                        resolve({ attribute: got?.attribute, kind: got?.result?.kind, ok, fen: b.fen, pieces: b.shadowRoot.querySelectorAll('.piece').length });
                        b.remove();
                    }, 50);
                }),
        );
        check(
            bad.attribute === 'puzzle' && bad.kind === 'invalid' && bad.ok && bad.pieces > 0,
            `attributes: a bad puzzle line fires error and leaves a working board (${JSON.stringify(bad)})`,
        );

        // keyboard: focus a square, walk with the arrows, Enter selects and moves
        await page.evaluate(() => document.getElementById('play').setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
        await page.evaluate(() => {
            const b = document.getElementById('play');
            b.scrollIntoView({ block: 'center' });
            b.shadowRoot.querySelector('[data-sq="d2"]').focus();
        });
        await page.keyboard.press('Enter');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Enter');
        i = await boardInfo(page, 'play');
        check(i.history[0] === 'd2d4', 'keyboard: Enter on d2, two arrows up, Enter plays d4');
        await page.waitForTimeout(120);
        const label = await page.evaluate(() => document.getElementById('play').shadowRoot.querySelector('[data-sq="g1"]').getAttribute('aria-label'));
        const expected = msg('board.square.piece', { piece: msg('board.piece.wN'), square: 'g1' }).ru;
        check(label === expected, `keyboard: the g1 cell is labelled "${label}" (expected "${expected}")`);
        const live = await page.evaluate(() => document.getElementById('play').shadowRoot.querySelector('[aria-live]').textContent);
        check(/d4/.test(live), `keyboard: the move is announced ("${live}")`);
        await ctx.close();
    }

    // behaviour of the elements, driven by the keyboard and by calls on fresh boards (nothing here depends on the demo's state)
    {
        const { ctx, page } = await open(1280, 'light');
        let i;
        const PUZZLE = { mode: 'puzzle', fen: 'r5k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1', puzzle: 'd2d8 a8d8 d1d8' };
        const PROMO = 'k7/4P3/8/8/8/8/8/4K3 w - - 0 1';
        // a fresh board at the end of the page; its events go to window.log as {t, ...detail}
        const scratch = (attrs = {}) =>
            page.evaluate((attrs) => {
                document.getElementById('scratch')?.remove();
                const b = document.createElement('stepchess-board');
                b.id = 'scratch';
                b.style.cssText = 'display:block;width:320px;margin:0 auto';
                window.log = [];
                for (const t of ['move', 'puzzle-solved', 'puzzle-failed', 'position', 'error', 'change']) {
                    b.addEventListener(t, (e) => window.log.push({ t, source: e.detail?.source, reason: e.detail?.reason, attribute: e.detail?.attribute }));
                }
                for (const [k, v] of Object.entries(attrs)) b.setAttribute(k, v);
                document.body.append(b);
            }, attrs);
        const logged = () => page.evaluate(() => window.log);
        const on = (fn, ...a) => page.evaluate(fn, ...a);
        // focus a square of the scratch board and walk from it with the keyboard: Enter, the arrows, Enter
        const focusSq = (sq) =>
            page.evaluate((sq) => {
                const b = document.getElementById('scratch');
                b.scrollIntoView({ block: 'center' });
                b.shadowRoot.querySelector(`[data-sq="${sq}"]`).focus();
            }, sq);
        const keyMove = async (from, ups) => {
            await focusSq(from);
            await page.keyboard.press('Enter');
            for (let n = 0; n < ups; n++) await page.keyboard.press('ArrowUp');
            await page.keyboard.press('Enter');
        };
        const play = (sq) => squareAt(page, 'play', sq);
        const sources = (log) => log.filter((x) => x.t === 'move').map((x) => x.source);

        // 1. a rejected setPosition / setPuzzle is a no-op: the pending reply still comes, the selection stays
        await scratch(PUZZLE);
        await keyMove('d2', 6); // 1. Rd8+: the reply Rxd8 is on its way
        const rejected = await on(() => {
            const b = document.getElementById('scratch');
            return [b.setPosition('garbage'), b.setPosition('garbage', { puzzle: { moves: ['d2d8'] } }), b.setPuzzle({ moves: ['zz'] }), b.setPuzzle({})].map(
                (r) => r.ok,
            );
        });
        await page.waitForTimeout(500);
        let log = await logged();
        check(
            rejected.every((ok) => ok === false) && sources(log).join() === 'user,auto' && !log.some((x) => x.t === 'position'),
            `rejected setPosition/setPuzzle: the pending reply still fires, no position event (${JSON.stringify(rejected)} ${sources(log)})`,
        );
        await focusSq('d1');
        await page.keyboard.press('Enter');
        await on(() => {
            const b = document.getElementById('scratch');
            b.setPosition('garbage');
            b.setPuzzle({ moves: [] });
        });
        check((await boardInfo(page, 'scratch')).selected === 'd1', 'rejected setPosition/setPuzzle: the selection stays');
        for (let n = 0; n < 7; n++) await page.keyboard.press('ArrowUp'); // d1 to d8: the last move, Rxd8#
        await page.keyboard.press('Enter');
        await page.waitForTimeout(100);
        check(
            (await logged()).some((x) => x.t === 'puzzle-solved'),
            'the puzzle still solves after rejected calls',
        );

        // a drag in progress survives a rejected call too
        await on(() => document.getElementById('play').setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
        const [pe2, pe3, pe4] = [await play('e2'), await play('e3'), await play('e4')];
        await page.mouse.move(pe2.x, pe2.y);
        await page.mouse.down();
        await page.mouse.move(pe3.x, pe3.y, { steps: 3 });
        await on(() => document.getElementById('play').setPosition('garbage'));
        await page.mouse.move(pe4.x, pe4.y, { steps: 3 });
        await page.mouse.up();
        check((await boardInfo(page, 'play')).history[0] === 'e2e4', 'rejected setPosition: a drag in progress is not aborted');
        await page.waitForTimeout(700);

        // 2. the error event names the attribute at fault
        await scratch({ ...PUZZLE, fen: 'not a fen' });
        log = await logged();
        const errFen = log.find((x) => x.t === 'error');
        await scratch({ ...PUZZLE, puzzle: 'd2d8 e2e4' });
        const errLine = (await logged()).find((x) => x.t === 'error');
        check(
            errFen?.attribute === 'fen' && errLine?.attribute === 'puzzle',
            `error event: a bad fen with a puzzle says fen, a bad line says puzzle (${errFen?.attribute}, ${errLine?.attribute})`,
        );

        // 3. a stale pointer's lostpointercapture does not end the gesture in progress; the stale capture is released
        await on(() => {
            window.released = [];
            const el = document.getElementById('play').shadowRoot.querySelector('.board');
            const release = el.releasePointerCapture;
            el.releasePointerCapture = function (id) {
                window.released.push(id);
                return release.call(this, id);
            };
            document.getElementById('play').setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
        });
        const d2s = await play('d2');
        await on(
            ([x, y]) => {
                const el = document.getElementById('play').shadowRoot.querySelector('.board');
                const ev = (type, dx) =>
                    new PointerEvent(type, {
                        pointerId: 77,
                        pointerType: 'mouse',
                        isPrimary: true,
                        button: 0,
                        buttons: 1,
                        clientX: x + dx,
                        clientY: y,
                        bubbles: true,
                    });
                el.dispatchEvent(ev('pointerdown', 0));
                el.dispatchEvent(ev('pointermove', 30));
            },
            [d2s.x, d2s.y],
        );
        const [e2, e4] = [await play('e2'), await play('e4')];
        await page.mouse.move(e2.x, e2.y);
        await page.mouse.down();
        await page.mouse.move(e2.x, e2.y - 20);
        await on(() =>
            document
                .getElementById('play')
                .shadowRoot.querySelector('.board')
                .dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 77, bubbles: true })),
        );
        const mid = await boardInfo(page, 'play');
        await page.mouse.move(e4.x, e4.y, { steps: 4 });
        await page.mouse.up();
        const after = await boardInfo(page, 'play');
        check(mid.dragging === 1 && after.history[0] === 'e2e4', 'pointer capture: another pointer losing its capture does not end the drag in progress');
        check((await on(() => window.released)).includes(77), "pointer capture: the stale gesture's pointer is released when the next press takes over");
        await page.waitForTimeout(700);

        // 10. a tap acts when the pointer is lifted on the square, not when it lands
        await on(() => document.getElementById('play').setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
        const [g1, f3] = [await play('g1'), await play('f3')];
        await page.mouse.click(g1.x, g1.y);
        await page.mouse.move(f3.x, f3.y);
        await page.mouse.down();
        i = await boardInfo(page, 'play');
        check(i.history.length === 0 && i.selected === 'g1', 'tap: pressing on a target does not play the move yet');
        await page.mouse.move(f3.x, f3.y + 900, { steps: 4 });
        await page.mouse.up();
        i = await boardInfo(page, 'play');
        check(i.history.length === 0 && i.selected === 'g1', 'tap: a press released off its square plays nothing and keeps the selection');
        await page.mouse.click(f3.x, f3.y);
        i = await boardInfo(page, 'play');
        check(i.history[0] === 'g1f3' && clean(i), 'tap: lifting the pointer on the target plays the move');
        await page.waitForTimeout(700);

        // 4. timers: reset on undo, told on playMoves and on disconnect, cleared with the board
        await scratch(PUZZLE);
        await keyMove('d2', 6);
        await on(() => document.getElementById('scratch').undo());
        await page.waitForTimeout(500);
        log = await logged();
        check(
            sources(log).join() === 'user' && (await boardInfo(page, 'scratch')).history.length === 0,
            `timers: undo drops the pending reply (${sources(log)})`,
        );

        await scratch(PUZZLE);
        await keyMove('d2', 6);
        const played = await on(() => document.getElementById('scratch').playMoves(['d1d8']).ok);
        await page.waitForTimeout(400);
        log = await logged();
        check(played && sources(log).join() === 'user,auto,api', `timers: playMoves tells the pending reply first, in order (${sources(log)})`);
        check(
            (await boardInfo(page, 'scratch')).pieces === (await boardInfo(page, 'scratch')).stateCount,
            'timers: playMoves leaves the board showing the real position',
        );

        await scratch(PUZZLE);
        await keyMove('d2', 5); // Rd7: wrong, shown for a moment
        await on(() => document.getElementById('scratch').cancel());
        await focusSq('d2');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1000);
        check((await boardInfo(page, 'scratch')).selected === 'd2', 'timers: cancel() clears the wrong-move timer, which cannot undo a later selection');

        await scratch(PUZZLE);
        await keyMove('d2', 5);
        await page.waitForTimeout(1000);
        const back = await boardInfo(page, 'scratch');
        log = await logged();
        check(
            back.history.length === 0 && log.some((x) => x.t === 'position' && x.reason === 'cancel'),
            'timers: the wrong move is taken back after its time, and the board says so (position/cancel)',
        );

        // position events: every take-back and rewind is told, after the move events of the same call
        const trail = (l) => l.map((x) => (x.t === 'move' ? `move:${x.source}` : x.t === 'position' ? `position:${x.reason}` : x.t)).join();
        await scratch(PUZZLE);
        await keyMove('d2', 5); // wrong
        await on(() => document.getElementById('scratch').playMoves([]));
        log = await logged();
        check(
            trail(log) === 'move:user,puzzle-failed' && (await boardInfo(page, 'scratch')).history.length === 1,
            `position: playMoves([]) is a no-op, the wrong move stays on show (${trail(log)})`,
        );
        await on(() => document.getElementById('scratch').playMoves(['d2d8']));
        log = await logged();
        check(
            trail(log) === 'move:user,puzzle-failed,move:api,position:cancel',
            `position: playMoves after a wrong move: move, then position/cancel (${trail(log)})`,
        );
        await scratch(PUZZLE);
        await keyMove('d2', 6);
        await on(() => document.getElementById('scratch').undo());
        await page.waitForTimeout(400);
        log = await logged();
        check(trail(log) === 'move:user,position:undo', `position: undo comes after the move it takes back and drops the reply (${trail(log)})`);
        await scratch({ ...PUZZLE, lang: 'en' });
        await keyMove('d2', 6);
        await on(() => document.getElementById('scratch').playMoves(['d1d8']));
        await page.waitForTimeout(150);
        const flushed = await on(() => document.getElementById('scratch').shadowRoot.querySelector('[aria-live]').textContent);
        check(/Black: .*White: .*Checkmate/.test(flushed), `announce: playMoves speaks the reply it flushed and then its own moves ("${flushed}")`);
        await scratch(PUZZLE);
        await keyMove('d2', 5);
        await on(() => document.getElementById('scratch').setAttribute('mode', 'analysis'));
        log = await logged();
        check(
            trail(log) === 'move:user,puzzle-failed,position:cancel',
            `position: a mode change while a wrong move is on show tells the take-back (${trail(log)})`,
        );
        await scratch(PUZZLE);
        await keyMove('d2', 5);
        log = await on(() => {
            document.getElementById('scratch').remove();
            return window.log;
        });
        check(
            trail(log) === 'move:user,puzzle-failed,position:cancel',
            `position: leaving the page with a wrong move on show tells the take-back (${trail(log)})`,
        );
        await scratch({ mode: 'setup', fen: PROMO });
        await on(() => document.getElementById('scratch').setAttribute('mode', 'play'));
        log = await logged();
        check(trail(log) === 'position:mode', `position: leaving setup tells the new game (${trail(log)})`);

        await scratch({ mode: 'play', lang: 'en' });
        const quiet = await on(
            () =>
                new Promise((resolve) => {
                    const b = document.getElementById('scratch');
                    b.playMoves(['e2e4']); // schedules an announcement
                    b.remove(); // the board leaves before it is spoken
                    setTimeout(() => resolve(b.shadowRoot.querySelector('[aria-live]').textContent), 200);
                }),
        );
        check(quiet === '', `timers: an announcement scheduled before disconnect is not spoken afterwards ("${quiet}")`);

        await scratch(PUZZLE);
        await keyMove('d2', 6);
        log = await on(() => {
            document.getElementById('scratch').remove();
            return window.log;
        });
        check(sources(log).join() === 'user,auto', `timers: leaving the page tells the reply the board owes (${sources(log)})`);

        // whenLinked can be cancelled: an explain element that leaves before its board exists never annotates it
        const linked = await on(async () => {
            const result = {
                ok: true,
                kind: 'move',
                class: 'best',
                move: { uci: 'e2e4', san: 'e4' },
                steps: [{ title: 'x', annotations: { arrows: [{ from: 'e2', to: 'e4', kind: 'best' }], squares: [], badges: [] } }],
                annotations: null,
            };
            const make = (id, keep) => {
                const ex = document.createElement('stepchess-explain');
                ex.setAttribute('for', id);
                ex.result = result;
                document.body.append(ex);
                if (!keep) ex.remove();
                const b = document.createElement('stepchess-board');
                b.id = id;
                document.body.append(b);
                return b;
            };
            const [gone, kept] = [make('link-gone', false), make('link-kept', true)];
            await new Promise((r) => setTimeout(r, 100));
            const out = { gone: gone.state.annotations.arrows.length, kept: kept.state.annotations.arrows.length };
            for (const el of document.querySelectorAll('stepchess-explain[for^="link-"], #link-gone, #link-kept')) el.remove();
            return out;
        });
        check(linked.gone === 0 && linked.kept === 1, `whenLinked: cancelled when the element leaves, still links otherwise (${JSON.stringify(linked)})`);

        // 5. keyboard and accessibility
        await scratch({ mode: 'play', lang: 'ru' });
        await focusSq('g1');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(120);
        let said = await on(() => document.getElementById('scratch').shadowRoot.querySelector('[aria-live]').textContent);
        const targets = await on(() => document.getElementById('scratch').state.targets);
        const wantSel = msg('board.announce.selected', { piece: msg('board.piece.wN'), square: 'g1', targets }).ru;
        check(said === wantSel, `keyboard: selecting a piece announces it and its moves ("${said}")`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(120);
        said = await on(() => document.getElementById('scratch').shadowRoot.querySelector('[aria-live]').textContent);
        check(said === msg('board.announce.deselected').ru, `keyboard: Escape announces that the selection is cleared ("${said}")`);

        await scratch({ mode: 'analysis', fen: PROMO });
        await keyMove('e7', 1);
        const activeIn = () =>
            on(() => {
                const root = document.getElementById('scratch').shadowRoot;
                const a = root.activeElement;
                return { promo: a?.dataset?.promo ?? null, inside: Boolean(a?.closest?.('.promotion')), sq: a?.dataset?.sq ?? null };
            });
        const seen = [(await activeIn()).promo];
        for (let n = 0; n < 4; n++) {
            await page.keyboard.press('Tab');
            seen.push((await activeIn()).promo);
        }
        check(seen.join() === 'q,n,r,b,q', `promotion: Tab walks the picker in a circle (${seen})`);
        await page.keyboard.press('Shift+Tab');
        check((await activeIn()).promo === 'b', 'promotion: Shift+Tab goes back, wrapping to the last piece');
        await page.keyboard.press('Escape');
        let a = await activeIn();
        i = await boardInfo(page, 'scratch');
        check(clean(i) && i.fen.startsWith('k7/4P3/') && a.sq === 'e8', `promotion: Escape cancels and returns the focus to the board (${JSON.stringify(a)})`);

        await scratch({ mode: 'play' });
        await focusSq('d4');
        await on(() => document.getElementById('scratch').flip());
        a = await activeIn();
        await on(() => document.getElementById('scratch').flip());
        const b2 = await activeIn();
        check(a.sq === 'd4' && b2.sq === 'd4', `flip: the focus stays on the same square (${a.sq}, ${b2.sq})`);

        // 6. the moves list follows the board when its position is replaced from outside
        await ctx.close();
    }
    {
        const { ctx, page } = await open(1280, 'light');
        const moves = () =>
            page.evaluate(() => {
                const m = document.getElementById('analysis-moves');
                const b = document.getElementById('analysis');
                return {
                    path: m.path.join(' '),
                    board: b.state.history.map((h) => h.uci).join(' '),
                    buttons: m.shadowRoot.querySelectorAll('.mv').length,
                    current: m.shadowRoot.querySelectorAll('[aria-current="true"]').length,
                };
            });
        let m = await moves();
        check(m.path === m.board && m.path.split(' ').length === 6, `moves: starts on the sixth ply of the record (${m.path})`);
        await page.evaluate(() => document.getElementById('analysis').undo());
        m = await moves();
        check(
            m.path === m.board && m.path.split(' ').length === 5 && m.buttons > 6,
            `moves: undo on the board moves the record back, keeping the variations (${m.path})`,
        );
        await page.evaluate(() => document.getElementById('analysis').setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
        m = await moves();
        check(m.path === '' && m.buttons > 6 && m.current === 0, 'moves: the board set back to the start winds the record to its start');
        await page.evaluate(() => document.getElementById('analysis').setPosition('k7/4P3/8/8/8/8/8/4K3 w - - 0 1'));
        m = await moves();
        check(m.path === '' && m.buttons === 0, `moves: a position that is not in the record starts the record over (${m.buttons} moves listed)`);
        await page.evaluate(() => document.getElementById('analysis').playMoves(['e7e8q']));
        m = await moves();
        check(m.path === 'e7e8q' && m.buttons === 1, `moves: moves played from there are recorded (${m.path})`);

        // explain: keyboard focus stays on the pressed button and passes to the other one at either end
        const focusGo = () => page.evaluate(() => document.getElementById('explain').shadowRoot.activeElement?.dataset?.go ?? null);
        const idx = () => page.evaluate(() => document.getElementById('explain').index);
        await page.evaluate(() => document.getElementById('explain').shadowRoot.querySelector('[data-go="next"]').focus());
        const trail = [];
        for (const key of ['Enter', 'Enter', 'Enter', 'Enter']) {
            await page.keyboard.press(key);
            trail.push(`${await idx()}${await focusGo()}`);
        }
        // steps 0 → 1 → 2 (the last: Next disabled, focus passes to Back) → 1 (Back) → 0 (Back disabled, focus passes to Next)
        check(trail.join() === '1next,2prev,1prev,0next', `explain: focus stays on the pressed button and passes to the other at either end (${trail})`);
        await ctx.close();
    }

    // touch at 320 (CDP touch events: real touchstart/touchmove/touchend, so touch-action applies)
    {
        const { ctx, page } = await open(320, 'light');
        const cdp = await ctx.newCDPSession(page);
        const at = (sq) => squareAt(page, 'play', sq);
        let p = await at('e2');
        await page.touchscreen.tap(p.x, p.y);
        p = await at('e4');
        await page.touchscreen.tap(p.x, p.y);
        let i = await boardInfo(page, 'play');
        check(i.history[0] === 'e2e4' && clean(i), 'touch: tap-tap e2 e4 plays the move');
        await page.waitForTimeout(700);
        const scrollBefore = await page.evaluate(() => window.scrollY);
        await touchDrag(page, cdp, await at('d2'), await at('d4'));
        i = await boardInfo(page, 'play');
        const scrollAfter = await page.evaluate(() => window.scrollY);
        check(i.history[2] === 'd2d4' && clean(i), 'touch: a finger drag d2-d4 plays the move');
        check(scrollAfter === scrollBefore, `touch: dragging a piece does not scroll the page (${scrollBefore} → ${scrollAfter})`);
        await page.waitForTimeout(700);
        const fen = (await boardInfo(page, 'play')).fen;
        const g1 = await at('g1');
        await touchDrag(page, cdp, g1, { x: g1.x, y: g1.y + 500 });
        i = await boardInfo(page, 'play');
        check(i.fen === fen && clean(i), 'touch: a drag released off the board plays nothing, no selection, no ghost piece');
        // the browser cancels a drag (pointercancel through a real touchcancel): the piece goes home, nothing selected
        await touchHold(page, cdp, await at('a2'), await at('a4'));
        check((await boardInfo(page, 'play')).dragging === 1, 'touch: a finger drag of a2 is under way');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
        await page.waitForTimeout(60);
        i = await boardInfo(page, 'play');
        check(i.fen === fen && clean(i), 'touch: pointercancel mid-drag leaves a clean board, no ghost piece');
        // the board is taken out of the page mid-drag and put back
        await touchHold(page, cdp, await at('h2'), await at('h4'));
        await page.evaluate(() => {
            const b = document.getElementById('play');
            const [parent, next] = [b.parentNode, b.nextSibling];
            b.remove();
            parent.insertBefore(b, next);
        });
        i = await boardInfo(page, 'play');
        check(i.fen === fen && clean(i), 'touch: remove() mid-drag and re-attach leaves a clean board');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(60);
        i = await boardInfo(page, 'play');
        check(i.fen === fen && clean(i), 'touch: the finger lifted after re-attaching plays nothing');
        p = await at('h2');
        await page.touchscreen.tap(p.x, p.y);
        p = await at('h3');
        await page.touchscreen.tap(p.x, p.y);
        i = await boardInfo(page, 'play');
        check(i.history[4] === 'h2h3' && clean(i), 'touch: after all that, tap-tap h2 h3 still plays');
        await page.waitForTimeout(700);
        // long press on an empty square, then drag: an arrow
        const fen2 = (await boardInfo(page, 'play')).fen;
        await touchDrag(page, cdp, await at('e3'), await at('e5'), { hold: 650 });
        i = await boardInfo(page, 'play');
        check(i.drawn === 1 && i.fen === fen2 && clean(i), 'touch: a long press on an empty square and a drag draws an arrow, moves nothing');
        // long press on an own piece, then drag: still a move, never an arrow
        await touchDrag(page, cdp, await at('b1'), await at('c3'), { hold: 650 });
        i = await boardInfo(page, 'play');
        check(i.history[6] === 'b1c3' && i.drawn === 0 && clean(i), 'touch: a long press on an own piece and a drag plays the move (b1-c3), no arrow');
        await page.waitForTimeout(700);
        // tap a piece, then rest the finger on its destination: the move, and no circle
        p = await at('g1');
        await page.touchscreen.tap(p.x, p.y);
        await touchDrag(page, cdp, await at('f3'), await at('f3'), { hold: 650, steps: 1 });
        i = await boardInfo(page, 'play');
        check(i.history[8] === 'g1f3' && i.drawn === 0 && clean(i), `touch: a hold on the destination of a tap-move draws no circle ${JSON.stringify(i)}`);
        await page.waitForTimeout(700);
        // a finger that lands on a target and swipes away is a scroll, not a tap: nothing is played, the selection stays
        p = await at('a2');
        await page.touchscreen.tap(p.x, p.y);
        const a4 = await at('a4');
        await touchDrag(page, cdp, a4, { x: a4.x + 40, y: a4.y });
        i = await boardInfo(page, 'play');
        check(i.history.length === 10 && i.selected === 'a2', 'touch: a swipe that starts on a target plays nothing and keeps the selection');
        p = await at('a3');
        await page.touchscreen.tap(p.x, p.y);
        i = await boardInfo(page, 'play');
        check(i.history[10] === 'a2a3' && clean(i), 'touch: a tap on a target plays the move when the finger lifts');
        await page.waitForTimeout(700);

        // puzzle: a tap on an opponent piece selects nothing; a wrong move is shown, then taken back; the line solves it
        const pz = (sq) => squareAt(page, 'puzzle', sq);
        await page.evaluate(() => {
            window.pz = [];
            const b = document.getElementById('puzzle');
            b.addEventListener('puzzle-failed', () => window.pz.push('failed'));
            b.addEventListener('puzzle-solved', () => window.pz.push('solved'));
        });
        p = await pz('a8');
        await page.touchscreen.tap(p.x, p.y);
        i = await boardInfo(page, 'puzzle');
        check(clean(i) && i.history.length === 0, 'puzzle: a tap on an opponent piece selects nothing');
        await touchDrag(page, cdp, await pz('h2'), await pz('h3'));
        check((await page.evaluate(() => window.pz)).includes('failed'), 'puzzle: a wrong move fires puzzle-failed');
        await page.waitForTimeout(1100);
        i = await boardInfo(page, 'puzzle');
        check(i.history.length === 0 && clean(i), 'puzzle: the wrong move is taken back');
        await touchDrag(page, cdp, await pz('d2'), await pz('d8'));
        await page.waitForTimeout(500);
        i = await boardInfo(page, 'puzzle');
        check(i.history.join(' ') === 'd2d8 a8d8', 'puzzle: the right move is answered automatically');
        p = await pz('d1');
        await page.touchscreen.tap(p.x, p.y);
        p = await pz('d8');
        await page.touchscreen.tap(p.x, p.y);
        await page.waitForTimeout(100);
        check((await page.evaluate(() => window.pz)).includes('solved'), 'puzzle: the last move fires puzzle-solved');
        await page.locator('#puzzle-card').screenshot({ path: path.join(outDir, 'puzzle-solved-320-light.png') });

        // the moves list winds the analysis board
        await page.evaluate(() => document.getElementById('analysis-moves').shadowRoot.querySelector('[data-go="first"]').click());
        i = await boardInfo(page, 'analysis');
        check(i.fen.startsWith('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR'), 'moves: "to the start" winds the board to the start');

        // tap-tap promotion: the picker that opens under the finger is not answered by the tap's own compatibility click
        await page.evaluate(() => document.getElementById('analysis').setPosition('k7/4P3/8/8/8/8/8/4K3 w - - 0 1'));
        const an = (sq) => squareAt(page, 'analysis', sq);
        p = await an('e7');
        await page.touchscreen.tap(p.x, p.y);
        p = await an('e8');
        await page.touchscreen.tap(p.x, p.y);
        await page.waitForTimeout(100);
        i = await boardInfo(page, 'analysis');
        check(i.promoOpen && i.history.length === 0, `touch: tap-tap onto the last rank opens the picker and does not pick the queen (${i.history})`);
        await page.waitForTimeout(400);
        i = await boardInfo(page, 'analysis');
        check(i.promoOpen && i.history.length === 0, 'touch: the picker is still open when nobody chose');
        const knight = await page.evaluate(() => {
            const r = document.getElementById('analysis').shadowRoot.querySelector('[data-promo="n"]')?.getBoundingClientRect();
            return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: 0, y: 0 }; // no picker: the tap lands elsewhere
        });
        await page.touchscreen.tap(knight.x, knight.y);
        await page.waitForTimeout(100);
        i = await boardInfo(page, 'analysis');
        check(i.history[0] === 'e7e8n' && clean(i), `touch: a later tap on the knight plays e8=N (${i.history})`);
        await ctx.close();
    }
}

await browser.close();
server.close();
for (const p of passed) console.log(`ok   ${p}`);
for (const p of problems) console.log(`FAIL ${p}`);
console.log(`\n${passed.length} passed, ${problems.length} failed; shots in ${path.relative(ROOT, outDir)}`);
process.exit(problems.length ? 1 : 0);
