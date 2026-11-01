// worker/worker — the worker script: messages from the client → the functions the package exports → messages back.
//
// Importing this module anywhere but in a worker does nothing: it starts listening only inside a browser worker or a
// worker_threads worker. Messages: {type: 'init', tbUrl, flag} once, then {type: 'call', id, method, args, callbacks}
// per call; the answers are {type: 'result', id, value}, {type: 'cb', id, key, args} for each callback of the options
// (onInfo, onProgress) and {type: 'error', id, message} for a bug (user input never makes one: the API answers it).
//
// An init with a tbUrl starts loading the shipped tablebases from there in the background, smallest first, so that the
// searches and explanations find them in their leaves; in Node an init without one loads them from the package's own
// data/tb (a browser has no such place to read from without being told). Nothing waits for it: a call is answered with the tables loaded
// so far (a search runs synchronously, so a table never arrives in the middle of one), and a table that cannot be
// loaded is left out without a word.
import * as api from '../index.js';
import { packMessages } from '../client/index.js';

// the functions a client may ask for; one the package does not (yet) export is answered as unsupported
const METHODS = [
    'analyze',
    'explainMove',
    'reviewGame',
    'hint',
    'opponentMove',
    'verifyPuzzle',
    'solveMate',
    'findPuzzles',
    'tablebase',
    'openingName',
    'position',
    'parseGame',
];

const NODE_WORKER_THREADS = 'node:worker_threads';

// the tables data/tb ships, by the size of their files: the small (and common) endings are in memory first
const SHIPPED_TABLES = ['KNNK', 'KQK', 'KRK', 'KPK', 'KRKB', 'KRKR', 'KBBK', 'KQKQ', 'KQKB', 'KBNK', 'KQKN', 'KQKR', 'KQKP'];

let tbUrl;
let flag = null; // Int32Array over the shared stop flag, or null

const isPlain = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

async function call(post, { id, method, args, callbacks }) {
    try {
        const list = Array.isArray(args) ? args : [];
        // the callbacks of the options come back to the client as messages
        for (const key of callbacks ?? []) {
            const [i, name] = key.split(':');
            if (isPlain(list[i])) list[i][name] = (...a) => post({ type: 'cb', id, key, args: packMessages(a) });
        }
        // the stop flag becomes the options' stop(); a table location the client was given is the default
        let stopped = false;
        const last = list[list.length - 1];
        if (flag && isPlain(last)) {
            last.stop = () => {
                if (globalThis.Atomics.load(flag, 0) === 0) return false;
                stopped = true;
                return true;
            };
        } else if (isPlain(last) && last.infinite === true) {
            // no shared flag: the client stops by ending the worker, so an infinite search runs until then
            last.stop = () => false;
        }
        if (method === 'tablebase' && tbUrl && isPlain(last) && last.tbUrl === undefined) last.tbUrl = tbUrl;

        let value;
        if (!METHODS.includes(method) || typeof api[method] !== 'function') value = api.unsupported(method);
        else value = await api[method](...list);
        if (stopped && value?.kind === 'analysis') value.stopped = true;
        post({ type: 'result', id, value: packMessages(value) });
    } catch (e) {
        post({ type: 'error', id, message: String(e?.message ?? e) });
    }
}

// the shipped tables from tbUrl, in the background: not awaited, and a failure only leaves the tables out
function preload(url) {
    try {
        api.preloadTables(SHIPPED_TABLES, { tbUrl: url }).catch(() => {});
    } catch {
        // a location that cannot be read is no table, not a broken worker
    }
}

function handle(post, data) {
    if (!data || typeof data !== 'object') return;
    if (data.type === 'init') {
        tbUrl = data.tbUrl;
        flag = data.flag ? new Int32Array(data.flag) : null;
        if (tbUrl) preload(tbUrl);
        else if (typeof globalThis.process?.versions?.node === 'string' && typeof globalThis.WorkerGlobalScope !== 'function') preload(undefined);
    } else if (data.type === 'call') call(post, data);
}

async function boot() {
    const g = globalThis;
    if (typeof g.WorkerGlobalScope === 'function' && g.self instanceof g.WorkerGlobalScope) {
        g.addEventListener('message', (e) => handle((m) => g.postMessage(m), e.data));
    } else if (typeof g.process?.versions?.node === 'string') {
        const { isMainThread, parentPort } = await import(/* @vite-ignore */ NODE_WORKER_THREADS);
        if (!isMainThread && parentPort) parentPort.on('message', (data) => handle((m) => parentPort.postMessage(m), data));
    }
}

boot().catch(() => {});
