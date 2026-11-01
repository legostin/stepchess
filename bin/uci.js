#!/usr/bin/env node
// bin/uci — stepchess as a UCI engine on stdin/stdout; the search runs in a worker, so stop is honoured at once.
//
// With UCI_LimitStrength the engine plays as the human-like opponent of UCI_Elo instead (createOpponent): one opponent
// per game, its seed the number of the game in this session (the first go, with or without a ucinewgame before it, is
// game 1; each ucinewgame after a game has started begins the next), so the same game from a fresh process gets the
// same moves. Its move takes well under a second at every level, so it is computed
// here, in turn with the searches; `go infinite` (or ponder) holds the bestmove back until stop, as the protocol asks.
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { createEngine, createOpponent, Game, Position } from '../src/index.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const OPTIONS = {
    hash: { name: 'Hash', type: 'spin', default: 16, min: 1, max: 1024 },
    multipv: { name: 'MultiPV', type: 'spin', default: 1, min: 1, max: 10 },
    limit: { name: 'UCI_LimitStrength', type: 'check', default: false },
    elo: { name: 'UCI_Elo', type: 'spin', default: 2800, min: 400, max: 2800 },
};

const engine = createEngine();
const settings = { hash: OPTIONS.hash.default, multipv: OPTIONS.multipv.default, limit: false, elo: OPTIONS.elo.default };
// game: the number of the game in this session; started: whether a go has been sent in it
const state = { fen: Position.START_FEN, moves: [], fresh: true, game: 1, started: false, opponent: null };
// the go commands, oldest first: {done, promise}; the engine runs them one at a time, so the first one not done is the search
// running and the others wait behind it in the engine's queue (a done one may stay in the list for a moment)
const runs = [];
let quitting = false;

const out = (line) => process.stdout.write(`${line}\n`);
const clamp = (v, { min, max }) => Math.min(max, Math.max(min, Math.floor(Number(v))));

function describeOptions() {
    for (const o of Object.values(OPTIONS)) {
        const range = o.type === 'spin' ? ` min ${o.min} max ${o.max}` : '';
        out(`option name ${o.name} type ${o.type} default ${o.default}${range}`);
    }
}

function setOption(tokens) {
    const at = tokens.indexOf('value');
    const name = tokens
        .slice(tokens.indexOf('name') + 1, at < 0 ? undefined : at)
        .join(' ')
        .toLowerCase();
    const value = at < 0 ? '' : tokens.slice(at + 1).join(' ');
    if (name === 'hash' && Number.isFinite(Number(value))) settings.hash = clamp(value, OPTIONS.hash);
    else if (name === 'multipv' && Number.isFinite(Number(value))) settings.multipv = clamp(value, OPTIONS.multipv);
    else if (name === 'uci_limitstrength') settings.limit = value.toLowerCase() === 'true';
    else if (name === 'uci_elo' && Number.isFinite(Number(value))) settings.elo = clamp(value, OPTIONS.elo);
}

function setPosition(tokens) {
    const at = tokens.indexOf('moves');
    const head = at < 0 ? tokens : tokens.slice(0, at);
    const moves = at < 0 ? [] : tokens.slice(at + 1);
    if (head[0] === 'startpos') state.fen = Position.START_FEN;
    else if (head[0] === 'fen') state.fen = head.slice(1).join(' ');
    else return;
    state.moves = moves;
}

// the opponent of the game at the strength set now: a new one for a new game or another UCI_Elo
function opponent() {
    if (!state.opponent || state.opponent.elo !== settings.elo) {
        const made = createOpponent({ elo: settings.elo, seed: state.game });
        state.opponent = made.ok ? made : null;
    }
    return state.opponent;
}

// the opponent's answer for a position the GUI set (its moves are the game's history, so repetitions count)
function opponentAnswer(player, fen, moves) {
    if (!player) return null;
    let game;
    try {
        game = new Game(fen);
        for (const m of moves) game.play(m);
    } catch (e) {
        return { ok: false, kind: 'invalid', reason: e?.text ?? null };
    }
    return player.move(game.position);
}

// go with UCI_LimitStrength: the opponent's move for the position and strength of now, played after the searches
// before it; an infinite go answers at stop
function goAtStrength(opts) {
    const player = opponent();
    const { fen, moves } = state;
    const entry = { done: false, promise: null, release: null };
    const held = opts.infinite ? new Promise((resolve) => (entry.release = resolve)) : null;
    const before = runs.map((r) => r.promise);
    entry.promise = Promise.allSettled(before).then(async () => {
        const started = Date.now();
        const r = opponentAnswer(player, fen, moves);
        if (r?.kind === 'move') out(`info time ${Date.now() - started} pv ${r.uci}`);
        else if (r?.kind === 'invalid' && r.reason) out(`info string ${r.reason.en}`);
        if (held) await held;
        entry.done = true;
        out(`bestmove ${r?.kind === 'move' ? r.uci : '0000'}`);
    });
    runs.push(entry);
    entry.promise.finally(() => runs.splice(runs.indexOf(entry), 1));
}

// the opponent moves held back by an infinite go are let go
const release = () => runs.forEach((entry) => entry.release?.());

// go: the limits of the tokens (a keyword without a number is skipped); none at all means infinite
function parseGo(tokens) {
    const opts = {};
    const numeric = ['depth', 'nodes', 'movetime', 'wtime', 'btime', 'winc', 'binc', 'movestogo'];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const n = Number(tokens[i + 1]);
        if (numeric.includes(t) && tokens[i + 1] !== undefined && Number.isFinite(n)) {
            opts[t] = n;
            i++;
        } else if (t === 'infinite') opts.infinite = true;
    }
    if (!numeric.some((k) => opts[k] !== undefined)) opts.infinite = true;
    return opts;
}

function infoLine(result, meta) {
    const line = meta.line;
    const score = line.mate !== null ? `mate ${line.mate}` : `cp ${line.score}`;
    const nps = meta.timeMs > 0 ? Math.round((result.nodes * 1000) / meta.timeMs) : 0;
    return `info depth ${result.depth} seldepth ${meta.seldepth} multipv ${meta.multipv} score ${score} nodes ${result.nodes} nps ${nps} hashfull ${meta.hashfull} time ${meta.timeMs} pv ${line.pv.map((m) => m.uci).join(' ')}`;
}

function go(tokens) {
    state.started = true;
    if (settings.limit) return goAtStrength(parseGo(tokens));
    const opts = { ...parseGo(tokens), moves: state.moves, hashMb: settings.hash, multipv: settings.multipv, keepHash: !state.fresh };
    state.fresh = false;
    opts.onInfo = (result, meta) => out(infoLine(result, meta));
    const entry = { done: false, promise: null };
    entry.promise = engine
        .analyze(state.fen, opts)
        .then((r) => {
            entry.done = true;
            if (r.kind === 'analysis') {
                const pv = r.lines[0].pv;
                out(`bestmove ${r.lines[0].uci}${pv.length > 1 ? ` ponder ${pv[1].uci}` : ''}`);
            } else {
                if (r.kind === 'invalid') out(`info string ${r.reason.en}`);
                out('bestmove 0000');
            }
        })
        .catch((e) => {
            entry.done = true;
            if (e?.code !== 'terminated') out(`info string ${e?.message ?? 'the engine failed'}`);
            if (!quitting) out('bestmove 0000');
        });
    runs.push(entry);
    entry.promise.finally(() => runs.splice(runs.indexOf(entry), 1));
}

// quit and the end of input: the search running ends at its last depth and answers; what waits behind it (a second go
// infinite, say) is dropped when the engine is terminated, so that the process always exits
function shutdown() {
    if (quitting) return;
    quitting = true;
    const running = runs.find((entry) => !entry.done)?.promise ?? Promise.resolve();
    engine.stop();
    release();
    running.then(() => {
        engine.terminate();
        process.exit(0);
    });
}

function command(line) {
    if (quitting) return; // nothing is read after quit
    const tokens = line.trim().split(/\s+/).filter(Boolean);
    switch (tokens[0]) {
        case 'uci':
            out(`id name stepchess ${version}`);
            out('id author legostin');
            describeOptions();
            out('uciok');
            break;
        case 'isready':
            out('readyok');
            break;
        case 'setoption':
            setOption(tokens);
            break;
        case 'ucinewgame':
            state.fresh = true;
            if (state.started) state.game++;
            state.started = false;
            state.opponent = null;
            break;
        case 'position':
            setPosition(tokens.slice(1));
            break;
        case 'go':
            go(tokens.slice(1));
            break;
        case 'stop':
            engine.stop();
            release();
            break;
        case 'quit':
            shutdown();
            break;
        default: // unknown commands are ignored, as the protocol asks
    }
}

const lines = createInterface({ input: process.stdin });
lines.on('line', command);
// the end of input is a quit, after the search in progress
lines.on('close', shutdown);
