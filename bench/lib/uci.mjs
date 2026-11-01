// bench/lib/uci — a UCI engine run as a child process: start it, set options, ask for moves, and read the scores it reports.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';

/**
 * What to run for --a / --b: a directory holding a stepchess checkout (its bin/uci.js under this Node), or any other
 * UCI command line (words split on spaces; double quotes group a word).
 * @returns {{cmd: string, args: string[], label: string}}
 */
export function resolveEngine(spec) {
    const abs = path.resolve(spec);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
        const script = path.join(abs, 'bin', 'uci.js');
        if (!fs.existsSync(script)) throw new Error(`${abs} has no bin/uci.js`);
        return { cmd: process.execPath, args: [script], label: abs };
    }
    const words = [...spec.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
    if (!words.length) throw new Error('empty engine command');
    return { cmd: words[0], args: words.slice(1), label: spec };
}

export class UciEngine {
    /** @param {{cmd: string, args: string[], label: string}} spec */
    constructor(spec) {
        this.spec = spec;
        this.proc = spawn(spec.cmd, spec.args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
        this.waiters = [];
        this.name = spec.label;
        this.dead = false;
        this.last = { cp: null, mate: null, depth: 0, nodes: 0 };
        const fail = (e) => {
            this.dead = true;
            for (const w of this.waiters.splice(0)) {
                clearTimeout(w.timer);
                w.reject(e);
            }
        };
        // 'close' comes after the output has been read to its end, so a last bestmove is not lost to the exit
        this.proc.on('close', () => fail(new Error(`the engine ${spec.label} exited`)));
        this.proc.on('error', fail);
        this.proc.stdin.on('error', () => {});
        createInterface({ input: this.proc.stdout }).on('line', (line) => this.onLine(line.trim()));
    }

    onLine(line) {
        if (line.startsWith('info ') && line.includes(' score ')) {
            const t = line.split(/\s+/);
            const at = t.indexOf('score');
            const d = t.indexOf('depth');
            const n = t.indexOf('nodes');
            if (d > 0) this.last.depth = Number(t[d + 1]);
            if (n > 0) this.last.nodes = Number(t[n + 1]);
            if (t[at + 1] === 'cp') {
                this.last.cp = Number(t[at + 2]);
                this.last.mate = null;
            } else if (t[at + 1] === 'mate') {
                this.last.mate = Number(t[at + 2]);
                this.last.cp = null;
            }
        } else if (line.startsWith('id name ')) this.name = line.slice(8);
        for (let i = 0; i < this.waiters.length; i++) {
            const w = this.waiters[i];
            if (w.until(line)) {
                this.waiters.splice(i, 1);
                clearTimeout(w.timer);
                w.resolve(line);
                return;
            }
        }
    }

    send(text) {
        if (!this.dead) this.proc.stdin.write(`${text}\n`);
    }

    /** Wait for a line the test accepts (rejects after timeoutMs, or when the engine dies). */
    waitFor(until, timeoutMs = 60000) {
        return new Promise((resolve, reject) => {
            if (this.dead) {
                reject(new Error(`the engine ${this.spec.label} exited`));
                return;
            }
            const w = { until, resolve, reject, timer: null };
            w.timer = setTimeout(() => {
                const at = this.waiters.indexOf(w);
                if (at >= 0) this.waiters.splice(at, 1);
                reject(new Error(`timeout waiting for the engine ${this.spec.label}`));
            }, timeoutMs);
            this.waiters.push(w);
        });
    }

    /** The uci handshake, then options ({Hash: 16, …}). */
    async init(options = {}) {
        const ok = this.waitFor((l) => l === 'uciok');
        this.send('uci');
        await ok;
        for (const [k, v] of Object.entries(options)) this.send(`setoption name ${k} value ${v}`);
        await this.ready();
    }

    async ready() {
        const ok = this.waitFor((l) => l === 'readyok');
        this.send('isready');
        await ok;
    }

    async newGame() {
        this.send('ucinewgame');
        await this.ready();
    }

    /**
     * Ask for a move: the position (a FEN and the moves played from it) and the go arguments ("wtime 1000 btime 1000 …").
     * Returns {move, cp, mate, depth, nodes, ms}; move is null when the engine answered 0000 or (none).
     */
    async go(fen, moves, goArgs, timeoutMs = 120000) {
        this.last = { cp: null, mate: null, depth: 0, nodes: 0 };
        this.send(`position fen ${fen}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
        const t0 = performance.now();
        const done = this.waitFor((l) => l.startsWith('bestmove'), timeoutMs);
        this.send(`go ${goArgs}`);
        const line = await done;
        const ms = performance.now() - t0;
        const move = line.split(/\s+/)[1];
        return { move: !move || move === '0000' || move === '(none)' ? null : move, ...this.last, ms };
    }

    quit() {
        if (this.dead) return;
        this.send('quit');
        setTimeout(() => this.proc.kill(), 2000).unref();
    }

    kill() {
        this.dead = true;
        this.proc.kill();
    }
}
