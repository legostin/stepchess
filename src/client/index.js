// client — createEngine(): the engine in a worker behind async methods; calls queue FIFO, stop() ends the running analysis at its last depth, terminate() rejects what is pending.
//
// The worker is a Worker in browsers and a worker_threads Worker in Node (src/worker/worker.js either way), started with
// the first call. Callbacks in the options (onInfo, onProgress) cannot cross the boundary, so they stay here and the
// worker reports to them by message; a result crosses with its texts as {$msg, params} and comes back as Msg.
//
// stop(): where a SharedArrayBuffer can be shared (Node, or a cross-origin isolated page) the worker polls a flag, so
// the search ends by itself and its result carries stopped: true. Elsewhere the worker is terminated and respawned and
// the running call resolves with the last result its onInfo reported, marked stopped: true. Only analysis can be
// stopped; stop() during another call waits for it to finish.
/* global URL -- written as a bare new URL(…, import.meta.url) so that bundlers find the worker script */
import { Msg, msg } from '../i18n/index.js';

/**
 * @typedef {'terminated' | 'crashed' | 'spawn' | 'failed'} EngineErrorCode
 * @typedef {{workerUrl?: string | URL, tbUrl?: string, sharedStop?: boolean}} EngineOptions
 */

/** The rejection of a call the engine could not answer: code 'terminated' (terminate() was called), 'crashed', 'spawn' or 'failed'. */
export class EngineError extends Error {
    /**
     * @param {EngineErrorCode} code
     * @param {string} [detail]
     */
    constructor(code, detail = '') {
        super(detail ? `${code}: ${detail}` : code);
        this.name = 'EngineError';
        /** @type {EngineErrorCode} */
        this.code = code;
    }
}

/** A result tree ready for postMessage: every Msg becomes {$msg: key, params}. */
export function packMessages(v) {
    if (v instanceof Msg) return { $msg: v.key, params: v.params ? packMessages(v.params) : null };
    if (Array.isArray(v)) return v.map(packMessages);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) out[k] = packMessages(v[k]);
        return out;
    }
    return typeof v === 'function' ? undefined : v;
}

/** The inverse of packMessages. */
export function unpackMessages(v) {
    if (Array.isArray(v)) return v.map(unpackMessages);
    if (v && typeof v === 'object') {
        if (typeof v.$msg === 'string') return new Msg(v.$msg, v.params ? unpackMessages(v.params) : null);
        const out = {};
        for (const k of Object.keys(v)) out[k] = unpackMessages(v[k]);
        return out;
    }
    return v;
}

const NODE_WORKER_THREADS = 'node:worker_threads'; // named by a variable: a bundler for browsers has nothing to resolve

const inNode = () => typeof globalThis.Worker !== 'function' && typeof globalThis.process?.versions?.node === 'string';

// a started worker: post(message), kill(), ref()/unref() (Node: only a busy worker keeps the process alive)
async function start(workerUrl, on) {
    if (inNode()) {
        const { Worker } = await import(/* @vite-ignore */ NODE_WORKER_THREADS);
        const w = new Worker(workerUrl ?? new URL('../worker/worker.js', import.meta.url));
        w.on('message', on.message);
        w.on('error', on.crash);
        w.on('messageerror', on.crash);
        w.on('exit', () => on.crash(null));
        w.unref();
        return { post: (m) => w.postMessage(m), kill: () => w.terminate().catch(() => {}), ref: () => w.ref(), unref: () => w.unref() };
    }
    const w = workerUrl
        ? new globalThis.Worker(workerUrl, { type: 'module' })
        : new globalThis.Worker(new URL('../worker/worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => on.message(e.data);
    w.onerror = (e) => on.crash(e);
    w.onmessageerror = (e) => on.crash(e);
    return { post: (m) => w.postMessage(m), kill: () => w.terminate(), ref() {}, unref() {} };
}

const isPlain = (v) => v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype;

// the results of a call that cannot be sent: options that cannot be read (a getter that throws, a revoked Proxy), and
// arguments that cannot be copied to the worker (a symbol, a function deep inside, …); the shape of the API's invalid results
const unreadable = () => ({ ok: false, kind: 'invalid', code: 'options', reason: msg('client.engine.options') });
const uncopyable = () => ({ ok: false, kind: 'invalid', code: 'clone', reason: msg('client.engine.clone') });

// a table location as the worker needs it: a relative one resolved here, against the page (inside the worker it would
// resolve against the worker script); as it was where there is no page, or when it cannot be read as a URL
function absoluteUrl(url) {
    if (url === undefined || url === null) return undefined;
    const base = globalThis.document?.baseURI ?? globalThis.location?.href;
    if (!base) return String(url);
    try {
        return new URL(String(url), base).href;
    } catch {
        return String(url);
    }
}

/**
 * The engine in a worker. Every method is async and answers what the same function of the package answers
 * (analyze, explainMove, reviewGame, hint, opponentMove, verifyPuzzle, solveMate, findPuzzles, tablebase, openingName); the
 * callbacks of the options (onInfo, onProgress) are called here. A method the build does not have resolves to an
 * invalid result with the code 'unsupported'. No method throws: options that cannot be read (a throwing getter, a
 * revoked Proxy) resolve to an invalid result with the code 'options', and arguments that cannot be copied to the
 * worker (a symbol, a function inside a list) to one with the code 'clone'. stop() resolves when the running call has
 * ended; terminate() rejects every pending call with EngineError('terminated') and so does any later call. A relative
 * tbUrl is resolved against the page (document.baseURI, or location where there is no document). With tbUrl the worker
 * also loads the shipped tablebases from there in the background as it starts; in Node it loads them from the
 * package's data/tb without one (see worker). The package exports this function typed
 * with the results of the public contract (src/index.js), which this unit, below the api, cannot name.
 * @param {EngineOptions} [options] sharedStop forces the stop mechanism (a shared flag or respawning)
 */
export function createEngine({ workerUrl, tbUrl: tbLocation, sharedStop } = {}) {
    const tbUrl = absoluteUrl(tbLocation);
    const canShare = typeof globalThis.SharedArrayBuffer === 'function' && (inNode() || globalThis.crossOriginIsolated === true);
    const flag = (sharedStop ?? canShare) && canShare ? new Int32Array(new globalThis.SharedArrayBuffer(4)) : null;

    let handle = null; // the live worker
    let closed = false;
    let current = null; // the job the worker is running
    const queue = [];
    let seq = 0;

    // a job leaves: settle its promise, release those waiting in stop(), start the next
    function finish(job, settle) {
        if (current !== job) return;
        current = null;
        handle?.unref();
        settle();
        for (const w of job.waiters) w();
        pump();
    }

    // the respawn way of stopping: kill the worker, give the call the last result it reported
    function cutShort(job) {
        const old = handle;
        handle = null;
        old?.kill();
        finish(job, () => job.resolve({ ...job.last, stopped: true }));
    }

    function onMessage(token, data) {
        const job = current;
        if (token !== handle || !job || !data || data.id !== job.id) return;
        if (data.type === 'result') finish(job, () => job.resolve(unpackMessages(data.value)));
        else if (data.type === 'error') finish(job, () => job.reject(new EngineError('failed', String(data.message))));
        else if (data.type === 'cb') {
            const args = unpackMessages(data.args);
            if (job.track && data.key.endsWith(':onInfo')) {
                // job.last is the end of a depth: the info that holds every requested line, or the one before the next depth starts
                const info = args[0];
                if (job.now && info.depth > job.now.depth) job.last = job.now;
                if (info.lines.length >= job.multipv) job.last = info;
                job.now = info;
            }
            try {
                job.callbacks.get(data.key)?.(...args);
            } catch {
                // a callback that fails does not break the call
            }
            if (!flag && job.stopRequested && job.last) cutShort(job);
        }
    }

    function onCrash(token, error) {
        if (token !== handle) return;
        handle = null;
        token.kill();
        const job = current;
        if (job) finish(job, () => job.reject(new EngineError('crashed', error?.message ?? '')));
    }

    async function pump() {
        if (current || closed) return;
        const job = queue.shift();
        if (!job) return;
        current = job;
        try {
            if (!handle) {
                const token = {};
                const started = await start(workerUrl, { message: (d) => onMessage(token, d), crash: (e) => onCrash(token, e) });
                Object.assign(token, started);
                if (closed) return started.kill();
                handle = token;
                token.post({ type: 'init', tbUrl, flag: flag ? flag.buffer : null });
            }
            if (closed || current !== job) return;
            if (flag) globalThis.Atomics.store(flag, 0, job.stopRequested ? 1 : 0); // a stop() asked before the worker was running counts
            handle.ref();
            try {
                handle.post({ type: 'call', id: job.id, method: job.method, args: job.args, callbacks: [...job.callbacks.keys()] });
            } catch {
                // the arguments cannot be copied (structured clone refused them): nothing reached the worker
                finish(job, () => job.resolve(uncopyable()));
            }
        } catch (e) {
            finish(job, () => job.reject(new EngineError(handle ? 'failed' : 'spawn', e?.message ?? '')));
        }
    }

    // the arguments as they cross: plain objects lose their functions, which stay here as callbacks; arguments that
    // cannot be read resolve to an invalid result, never a throw
    function enqueue(method, args, { track = false, multipv = 1 } = {}) {
        if (closed) return Promise.reject(new EngineError('terminated'));
        return new Promise((resolve, reject) => {
            const job = {
                id: ++seq,
                method,
                args: [],
                callbacks: new Map(),
                track,
                multipv,
                now: null,
                last: null,
                stopRequested: false,
                waiters: [],
                resolve,
                reject,
            };
            try {
                args.forEach((a, i) => {
                    if (isPlain(a)) {
                        const copy = {};
                        for (const [k, v] of Object.entries(a)) {
                            if (typeof v === 'function') job.callbacks.set(`${i}:${k}`, v);
                            else copy[k] = v;
                        }
                        job.args.push(copy);
                    } else job.args.push(typeof a === 'function' ? undefined : a);
                });
            } catch {
                resolve(unreadable());
                return;
            }
            queue.push(job);
            pump();
        });
    }

    const options = (o) => (isPlain(o) ? { ...o } : {});
    const forward =
        (method) =>
        (...args) =>
            enqueue(method, args);

    return {
        /** analyze(fen, opts) of the package; onInfo(result, meta) is called after every depth. */
        analyze(fen, opts) {
            let o;
            try {
                o = options(opts);
            } catch {
                return closed ? Promise.reject(new EngineError('terminated')) : Promise.resolve(unreadable());
            }
            const user = typeof o.onInfo === 'function' ? o.onInfo : null;
            o.onInfo = (result, meta) => user?.(result, meta); // always reported: the last one is what a stopped call resolves with
            return enqueue('analyze', [fen, o], { track: true, multipv: Number.isFinite(o.multipv) && o.multipv >= 1 ? Math.floor(o.multipv) : 1 });
        },
        explainMove: forward('explainMove'),
        reviewGame: forward('reviewGame'),
        hint: forward('hint'),
        opponentMove: forward('opponentMove'),
        verifyPuzzle: forward('verifyPuzzle'),
        solveMate: forward('solveMate'),
        findPuzzles: forward('findPuzzles'),
        tablebase(fen, opts) {
            let o;
            try {
                o = options(opts);
            } catch {
                return closed ? Promise.reject(new EngineError('terminated')) : Promise.resolve(unreadable());
            }
            return enqueue('tablebase', [fen, o]);
        },
        openingName: (input) => enqueue('openingName', [input]),

        /**
         * Ask the running analysis to end; resolves when the call has ended (at once with nothing running).
         * @returns {Promise<void>}
         */
        stop() {
            const job = current;
            if (!job) return Promise.resolve();
            const ended = new Promise((resolve) => job.waiters.push(resolve));
            job.stopRequested = true;
            if (flag) globalThis.Atomics.store(flag, 0, 1);
            else if (job.last) cutShort(job);
            return ended;
        },

        /**
         * Kill the worker and reject every pending call with EngineError('terminated').
         * @returns {void}
         */
        terminate() {
            if (closed) return;
            closed = true;
            const jobs = [current, ...queue].filter(Boolean);
            current = null;
            queue.length = 0;
            handle?.kill();
            handle = null;
            for (const job of jobs) {
                job.reject(new EngineError('terminated'));
                for (const w of job.waiters) w();
            }
        },
    };
}
