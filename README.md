# stepchess

A chess engine written in dependency-free JavaScript that explains its moves in Russian and English. It runs in Node and in the browser.

```js
import { explainMove, localize } from 'stepchess';

const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const r = localize(explainMove(fen, 'Nxe5', { nodes: 100000 }), 'en');

r.class;                        // "mistake"
r.steps.map((s) => s.title);    // "Nxe5 is a mistake", "Material: -2.3", "Piece placement: -0.3",
                                // "The answer Nxe5 refutes it", "Better was Bc4", "Nxe5?: a mistake; Bc4 was better"
r.steps[4].text;                // "It keeps your winning chances at 53%: 3. Bc4 Nf6 4. O-O Nxe4 …"
```

It is the engine behind the chess course on [legost.in](https://legost.in). The explanation is built from the same evaluation and the same
lines the search computes, so it never disagrees with how the engine plays: a sentence is said only when the numbers carry it. Use it to
build analysis boards, trainers, puzzle checkers and opponents that play like a person of a given rating.

- [Install](#install)
- [Quick start](#quick-start)
- [Results and errors](#results-and-errors)
- [Languages](#languages)
- [Puzzles](#puzzles)
- [Endgames and openings](#endgames-and-openings)
- [The opponent](#the-opponent)
- [The worker client](#the-worker-client)
- [The board](#the-board)
- [The UCI binary](#the-uci-binary)
- [Strength](#strength)
- [The bench](#the-bench)
- [Data and licences](#data-and-licences)
- [Development](#development)

## Install

The package is not on npm yet. Install it from GitHub:

```sh
npm install github:legostin/stepchess
```

It is a set of ES modules (Node ≥ 20, any modern browser) with no dependencies, and TypeScript types built on install. The package ships its
sources, the board elements, the endgame tables (7.6 MB in `data/tb/`) and the docs.

| Import | What it is |
|---|---|
| `stepchess` | The engine, with no DOM: analysis, explanations, review, hints, the opponent, puzzles, tablebases, openings, the worker client, and the rules of chess (`Position`, `Game`, SAN, PGN). |
| `stepchess/board` | Four web components: a board, an evaluation bar, a move list and an explanation panel. |
| `stepchess/worker` | The script that runs the engine in a Worker. Only the client starts it. |
| `npx stepchess-uci` | The engine as a UCI program. |

## Quick start

The functions are synchronous and run on the thread that calls them. In a page, call them through [the worker client](#the-worker-client).

### Analyse a position

```js
import { analyze } from 'stepchess';

const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const a = analyze(START, { depth: 10, multipv: 2 });

a.ok;                      // true
a.kind;                    // "analysis"
a.lines.map((l) => l.san); // the two best moves, best first
a.lines[0].pv;             // [{uci: 'c2c4', san: 'c4'}, …]: the line of the best move
a.scoreWhite;              // centipawns from White's point of view
a.mate;                    // null, or the number of moves to mate for the side to move (negative: it is mated)
a.win;                     // White's chance to win, 0 to 1
a.trace.terms;             // the evaluation split into named terms: [{key: 'pst', group: 'pieces', white, black, value, squares}, …]
```

Bound the search with `depth`, `nodes`, `movetime` (ms) or a clock (`wtime`, `btime`, `winc`, `binc`, `movestogo`). With no bound at all it
searches 300,000 nodes. A search bounded by `depth` or `nodes` alone gives the same answer for the same input and the same tables in memory (an engine made with
`createEngine({ tbUrl })` loads its tables in the background, so its answers in a position of four pieces or fewer can change as they arrive). `moves` lists the moves played
from the FEN, so that repetitions are counted on the real history (a `moves` that is not an array is an invalid result with the code `moves`).

### Explain a move

```js
import { explainMove, localize } from 'stepchess';

const fen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
const r = explainMove(fen, 'Nxe5', { nodes: 100000 });   // SAN in English or Russian, UCI, or {from, to, promotion}

r.class;                  // 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder'
r.winBefore;              // your winning chance with the best move
r.winAfter;               // ...and after this one
r.best;                   // {uci, san, line, motifs}: the engine's move, also when it is the move played
r.alternatives;           // up to 3 moves of the position before the move: [{uci, san, score, scoreWhite, mate?}], the engine's move first
                          // here Bc4 +22, d4 +14, Nc3 +14
r.refutation;             // {line, motifs} for an inaccuracy or worse
r.terms;                  // [{key: 'material', delta: -229}, …]: the evaluation terms the move changes most, in centipawns
r.steps;                  // the explanation, one step at a time
r.annotations;            // {arrows, squares, badges} for a board

for (const s of localize(r, 'en').steps) console.log(s.title, '—', s.text);
```

The engine's move, its class and the chances come from a search of the position before the move at `nodes`, the same search `analyze` makes
with the same `nodes`, so the move `analyze` plays is the one `explainMove` calls best. The other alternatives come from one more search of that
position with three lines, at the same budget; none of them scores above the engine's move (a higher score is lowered to its score). `moves` lists the
moves played from the FEN, so a repetition counts, and `movetime` bounds each search in milliseconds; `nodes` is at most 5,000,000. `keepHash: true`
keeps the table from the previous call, as in `analyze`.

A move that mates, allows a forced mate or misses one is explained by the mate alone, with no evaluation terms, and so is a move into a position the
endgame tables in memory know. The answer "refutes" the move only when the move is a mistake or a blunder; otherwise it is "the opponent's best answer".

A move is classed by the chance of winning it gives away: under 1% (or the engine's own move) is `best`, under 5% `good`, 5 to 10%
`inaccuracy`, 10 to 20% `mistake`, more than 20% or a missed or allowed forced mate `blunder`. The thresholds are in `CLASS_THRESHOLDS`.

### Review a game

```js
import { reviewGame } from 'stepchess';

const pgn = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
const r = reviewGame(pgn, { nodesPerMove: 50000, onProgress: ({ done, total }) => console.log(done, total) });

r.moves.map((m) => `${m.san}:${m.class}`); // ['e4:best', 'e5:best', 'Qh5:good', …, 'Nf6:blunder', 'Qxf7#:best']
r.accuracy;                                // {white: 96.5, black: 69.2}
r.keyMoments;                              // [6]: the plies where a side lost most
r.opening;                                 // {eco: 'C20', name, ply: 3}
r.phases;                                  // each side's accuracy in the opening, the middlegame and the endgame
r.steps;                                   // a short report in the same step format
```

Comments, NAGs and variations in the PGN are accepted, and a PGN needs no headers. A review searches each position once with `nodesPerMove`
nodes (150,000 by default) on the game's own history, so repetitions count.

### Hints

```js
import { hint } from 'stepchess';

const fen = 'r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3';   // 1. e4 e5 2. Qh5 Nc6 3. Bc4
hint(fen, 1).text.en; // where to look: "Look at your pawn on g7 and at the kingside."
hint(fen, 2).text.en; // what to look for: "Your opponent threatens mate with Qxf7#: look for a defence."
hint(fen, 3).text.en; // the move, with the reason: "The move: g6. It meets the threat of Qxf7#." (the result has move: {uci, san})
```

Step 2 names a mate, a threat of the opponent (found by letting the opponent move twice), a tactic, a gain of material, a positional idea or an
evaluation term, in that order. `hint` takes `nodes`, `movetime` and `moves` as `explainMove` does.

### Positions, moves and games

The rules of chess are in the same package:

```js
import { position, parseGame, Game, Position, ChessError } from 'stepchess';

position(START).legal.length;       // 20
parseGame('1. e4 e5 2. Nf3').moves; // [{uci, san, fen}, …]

const game = new Game();
game.play('e4');                    // SAN in any language, 'e2e4', 'e2-e4', {from: 'e2', to: 'e4'}
game.play('Кf6');                   // the Russian knight letter
try {
    game.play('Nf9');               // not a move
} catch (e) {
    e instanceof ChessError;        // true: the raw classes throw; the API functions above return a result instead
}
game.status();                      // {state: 'ongoing'}, or 'checkmate', 'stalemate', 'fifty', 'threefold', 'insufficient'
game.pgn({ White: 'A', Black: 'B' });

new Position(START).fen();          // new Position() is the start position; a bad FEN throws ChessError('fen')
Position.fromFen(START).fen();      // the same
```

## Results and errors

Every function of the API returns a plain object `{ok, kind, …}` and never throws on what a person can type:

```js
import { analyze, localize } from 'stepchess';

localize(analyze('not a fen'), 'en');
// {ok: false, kind: 'invalid', code: 'fen', reason: 'A FEN has 4 to 6 fields separated by spaces; this one has 3.'}

analyze('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
// {ok: true, kind: 'terminal', state: 'stalemate', reason: …}: a position that is already over has no best move
```

- `ok: false` always comes with `kind: 'invalid'`, a `code` for programs (`'fen'`, `'move'`, `'pgn'`, …) and a `reason` for people.
- A position that is over (checkmate, stalemate, a draw by the fifty-move rule, a threefold repetition or dead material) gives
  `ok: true, kind: 'terminal'` from `analyze`, `explainMove`, `hint` and the opponent.
- The raw building blocks (`Searcher`, `evaluate`, `Position`, `Game`, `parseMove`) are for experts: they trust their input and throw `ChessError` on a bad FEN or move.

[docs/API.md](docs/API.md) lists every result shape and every `code`.

## Languages

Russian and English are built in. A text in a result is a message that holds both languages. `localize(result, lang)` turns the whole result into
plain strings in one language; `message.in('en')` reads one message, and `message.en` and `message.ru` are shortcuts.

```js
import { explainMove, localize, registerLanguage } from 'stepchess';

const r = explainMove(fen, 'Nxe5', { nodes: 100000 });
r.steps[0].title.in('ru');          // "Кxe5 — ошибка"
localize(r, 'ru').steps[0].title;   // the same, for the whole result

// A new language is one catalog and one call, with no change to the code. Keys you leave out come from the base language.
registerLanguage('kk', catalog, { base: 'en' });
```

Moves are read in both languages and in several spellings: `Nf3`, `Кf3`, `♘f3`, `Ng1f3`, `g1f3`, `g1-f3`, `O-O` and `0-0`.

## Puzzles

```js
import { solveMate, verifyPuzzle, findPuzzles } from 'stepchess';

// every first move that mates within n moves (n from 1 to 5), by an exact search over all defences
const m = solveMate('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 1);
m.solutionsSan;   // ['Qxf7#']
m.line;           // the best play of both sides: the defender delays the mate, the attacker hurries

// is this line a puzzle? the first move and every second move after it are the solver's
const p = verifyPuzzle({ fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', moves: ['Qxf7#'] });
p.valid;          // true
p.issues;         // [{ply, code: 'alternative' | 'not-winning' | 'longer-mate' | 'weak-reply' | 'illegal', moves?}, …]
p.themes;         // ['mate', 'mateIn1']
p.difficulty;     // {depth: 1, candidates: 4, quiet: 0, rating: 1020}: an estimate on a 400 to 3000 scale, not calibrated on solvers; null when not valid

// the puzzles inside a game: after a blunder, a position where the win is unique
findPuzzles('1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#', { nodes: 50000 }).puzzles;
// [{ply: 6, fen, moves: ['h5f7'], themes: ['mate', 'mateIn1'], rating: 1020}]
```

## Endgames and openings

Positions of up to four pieces (kings included) are solved exactly. The tables are generated by the engine itself:

```js
import { tablebase, preloadTables, openingName } from 'stepchess';

const t = await tablebase('8/8/8/8/8/2k5/8/KQ6 w - - 0 1');
t.key;          // 'KQK'
t.wdl;          // 1: the side to move wins (0 a draw, -1 it loses)
t.dtm;          // 6: it mates in 6 moves
t.moves[0];     // {uci: 'b1e4', san: 'Qe4', wdl: 1, dtm: 6}: every legal move, best first

openingName('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6'); // {ok: true, kind: 'opening', eco: 'C70', name, ply: 6, moves: […], uci: […]}
```

Thirteen tables are shipped in `data/tb/` (7.6 MB): KQK, KRK, KPK, KBBK, KBNK, KNNK, KQKQ, KQKR, KQKB, KQKN, KQKP, KRKR and KRKB. A table that is not
shipped is generated on demand by `tablebase()`, which takes from 2 to 85 seconds and blocks its thread, so run it in a worker. In a browser, tell the
engine where the files are: `createEngine({ tbUrl: '/tb/' })`.

`analyze` and the other searches use a table only when it is in memory. In Node, or on the thread that calls the functions, load tables with
`await preloadTables(['KQK', 'KPK'])`, or call `tablebase()` once. An engine created with `createEngine({ tbUrl })` loads the thirteen shipped tables
from `tbUrl` in the background as its worker starts: no call waits for them, a search uses those loaded so far, and a table that cannot be loaded is
left out. The tables stay loaded between calls only while the worker lives. Where the client can stop a search through a shared flag (a
`SharedArrayBuffer`: Node, or a page that is cross-origin isolated, served with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`), one worker serves every call. Elsewhere each `stop()` ends the worker and starts a new one, which
loads the tables again. Serve the page with those two headers if it stops searches and uses the tables.

## The opponent

`createOpponent` gives a player of a given strength. The weaker levels miss what a person misses: backward moves, long diagonals, quiet moves,
threats deeper than a few plies. They blunder more in complex positions, not at random.

```js
import { createOpponent, opponentMove } from 'stepchess';

const opponent = createOpponent({ elo: 1200, seed: 7 });  // elo from 400 to 2800 (default 1500), seed any finite number (default 1)
opponent;                 // {ok: true, kind: 'opponent', elo: 1200, seed: 7, move(fen, clock?, moves?)}
opponent.move(START);     // {ok: true, kind: 'move', uci: 'e2e4', san: 'e4', source: 'book'}
opponent.move(fen, undefined, ['e2e4', 'e7e5']);          // the moves played from the FEN: repetitions count

opponentMove({ elo: 1200, seed: 7 }, fen, moves);         // one move from a fresh opponent
```

An opponent keeps its random generator between moves: the same `elo`, `seed` and sequence of positions always give the same moves. `opponentMove`
starts a fresh one each time, so change its seed from move to move. The seed is used as an unsigned 32-bit integer (truncated, then taken modulo
2^32: `7.9` plays as `7`, `-1` as `4294967295`). An elo outside 400 to 2800 or a seed that is not a number is an invalid result
(`code: 'elo'` or `'seed'`; `opponentMove` brings the elo into range instead). The `clock` of `move` is accepted and does not change the move: the
strength is the level's node budget, which takes well under a second at every level, and a move that depended on the time left would not be
reproducible from the seed. In the first twelve plies it plays book moves, drawn by the weight of the named openings that go on with each. A game that
is over gives `kind: 'terminal'`. `move` also takes a `Position`, whose history counts for repetitions, or a FEN with the moves played from it:
with the history the opponent steers away from a threefold repetition when it stands better and goes for one when it stands worse. Through the worker client, use `opponentMove`
(an opponent object cannot cross to a worker).

The label is "about as a Lichess player of that rating". The levels were fitted to games of Lichess players of January 2014, and
[bench/REPORT.md](bench/REPORT.md) shows how well the fit holds at each level (400 and 2800 had no games to fit and keep their hand-set values).

## The worker client

A search blocks the thread it runs on. `createEngine()` starts the engine in a Worker (a `worker_threads` Worker in Node) and gives the same functions
as promises. Calls queue one after another; `stop()` ends a running analysis at the last depth it finished.

```js
import { createEngine } from 'stepchess';

const engine = createEngine({ tbUrl: '/tb/' });

const a = await engine.analyze(fen, {
    movetime: 5000,
    multipv: 3,
    onInfo: (result, meta) => console.log('depth', result.depth, result.lines[0].san),   // after every depth
});

const running = engine.analyze(fen, { infinite: true });
setTimeout(() => engine.stop(), 1000);
const last = await running;      // the last completed depth; last.stopped === true

const e = await engine.explainMove(fen, 'Nxe5');
const r = await engine.reviewGame(pgn, { onProgress: ({ done, total }) => bar.update(done / total) });

engine.terminate();              // pending calls reject with EngineError('terminated')
```

With a bundler, the client finds the worker by `new URL('../worker/worker.js', import.meta.url)`. Pass `workerUrl` to put it elsewhere.
The message protocol is in [docs/API.md](docs/API.md#the-worker-message-protocol).

## The board

`stepchess/board` has no dependencies. It registers four web components in Shadow DOM, with light and dark themes, a keyboard interface and screen
reader labels. A board works from 320 px wide.

```html
<script type="module">
    import 'stepchess/board';             // or the URL of board/index.js
</script>

<stepchess-evalbar id="bar" win="0.5" lang="en"></stepchess-evalbar>
<stepchess-board id="b" mode="play" player="white" lang="en"></stepchess-board>
<stepchess-moves for="b" lang="en"></stepchess-moves>
<stepchess-explain for="b" lang="en"></stepchess-explain>
```

```js
import { analyze } from 'stepchess';

const board = document.getElementById('b');
board.addEventListener('move', (e) => {
    const { uci, san, fen, color, source } = e.detail;   // source: 'user' | 'auto' | 'api'
    document.getElementById('bar').win = analyze(fen, { depth: 8 }).win;
});

board.setPosition('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1');
board.annotate({ arrows: [{ from: 'e2', to: 'e4', kind: 'best' }] });

// a puzzle: the line is in UCI, the solver's move first; the board plays the replies itself
board.setAttribute('mode', 'puzzle');
board.setPuzzle({ fen: 'r5k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1', moves: ['d2d8', 'a8d8', 'd1d8'] });
board.addEventListener('puzzle-solved', (e) => console.log('solved', e.detail.moves));
board.addEventListener('puzzle-failed', (e) => console.log('wrong move', e.detail.uci, 'expected', e.detail.expected));
```

Modes are `play`, `puzzle`, `analysis`, `setup` and `view`. Input is by mouse, finger or keyboard: tap a piece and then a square, or drag. The board
returns to a clean state when a gesture ends off the board, is cancelled, or a promotion picker is dismissed. Without a `lang` attribute on the element
or an ancestor, the components speak Russian. `<stepchess-explain>` takes an `explainMove` result in its `result` property and draws each step's
annotations on the board named by `for`. [board/demo.html](board/demo.html) shows every mode; serve the repository over any static server, because ES
modules do not load from `file://`. The events, attributes and CSS properties are in [docs/API.md](docs/API.md#stepchessboard).

## The UCI binary

```sh
npx stepchess-uci
```

It speaks UCI on stdin and stdout, so it works in any chess GUI: add it as an engine whose command is `npx stepchess-uci`, or `node` with the path to
`bin/uci.js`. The search runs in a worker, so `stop` is honoured at once. The options are `Hash`, `MultiPV`, `UCI_LimitStrength` and `UCI_Elo`; the bench
uses the same binary to play two versions against each other.

```
uci
position startpos moves e2e4 e7e5
go movetime 1000
```

With `UCI_LimitStrength` set to true, `go` plays the move of `createOpponent({ elo: UCI_Elo, seed })` instead of searching, the seed being the
number of the game in the session (the first game is 1, and each `ucinewgame` after a game has started begins the next), so the same game gives the same moves. See [docs/API.md](docs/API.md#the-uci-binary).

## Strength

Only relative strength is measured. There was no external engine to play against, so the numbers below come from self-play and from tactics test
suites, and none of them is a rating. They are copied from [bench/REPORT.md](bench/REPORT.md), measured on 2026-11-01 on one machine, with one thread
and a 16 MB hash table, with the tuned evaluation weights the package ships. The report says how each was run.

| Measure | Result |
|---|---|
| Search speed, one thread | about 660,000 nodes per second on a quiet machine; 520,000 under load (start position 445 k, Kiwipete 537 k) |
| Win at Chess (300 positions), 1 s each | 288 solved |
| Win at Chess, 200,000 nodes each | 277 solved |
| ECM (183 positions), 1 s each | 77 solved |
| ECM, 200,000 nodes each | 53 solved |
| Tuned weights against hand-set weights, 20,000 nodes a move, 1,320 games | +44.5 ± 16.7 Elo (SPRT accepted) |

The ECM misses are mostly quiet sacrifices on the king. The match figure says the tuned engine beats its own earlier version. It does not say how the
engine stands against another engine or against a person. The design aims at beating any student of the course, and no measurement here shows that yet.

## The bench

The speed, tactics and match benches run locally; CI does not run them.

```sh
node bench/speed.mjs                               # nodes per second, perft, evaluations per second
node bench/tactics.mjs --suite wac --nodes 200000  # positions solved in WAC or ECM, at fixed nodes, depth or time
node bench/match.mjs --a ../old-checkout --b . --nodes 20000 --games 400 --sprt elo0=0,elo1=5
                                                   # A against B from balanced openings, colours reversed: Elo and an SPRT
node bench/perft.mjs                               # the move generator against the published counts
npm run snapshot:verify                            # the analysis and explanation of 60 positions against bench/golden.json
```

`bench/match.mjs` takes any UCI engine as either side, so it can measure the engine against an external one when you have one. The scripts that
produce the data are in `scripts/` (`datagen`, `tune`, `calibrate`, `tablebases`, `openings`); [bench/REPORT.md](bench/REPORT.md) says how each was run.

## Data and licences

The code is MIT. The data the package ships or builds on:

| Data | Source | Licence | Where it is used |
|---|---|---|---|
| Opening names and lines (3,865, with ECO codes) | [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings) | CC0 | `src/endgame/openings-data.js`, generated by `scripts/openings.mjs`; also the opponent's opening book. The Russian names are written for this project. |
| Endgame tables of up to four pieces | Generated by the engine (`scripts/tablebases.mjs`, retrograde analysis) | MIT, with the code | `data/tb/` |
| Win at Chess (WAC) and Encyclopedia of Chess Middlegames (ECM) positions | The positions of Fred Reinfeld's *Win at Chess* (1958) and of the *Encyclopedia of Chess Middlegames* (Chess Informant, 1980), as collected in the Arasan engine's `wacnew.epd` and `ecmgcp.epd` | Distributed in the Arasan repository under the MIT licence; see the headers of the files in `bench/suites/` | `bench/suites/` and the tests. Used for testing only: they are not part of the engine, and `bench/` is not in the npm `files`. |
| Self-play games | Played by the engine itself (`scripts/datagen.mjs`) | n/a | They train the evaluation weights. No other engine's evaluation is used. |
| Lichess game database | [database.lichess.org](https://database.lichess.org) | CC0 | Read as statistics of how people of each rating play, to calibrate the opponent's levels. No game is kept in the repository, and the evaluation is not trained on them. |

The board draws its own pieces (`board/pieces.js`), not a third-party set.

## Development

```sh
git clone https://github.com/legostin/stepchess && cd stepchess && npm install
npm run check                          # lint, formatting, tests (architecture, languages and result shapes included) and types
npm test                               # node --test test/*.test.cjs
npm run types                          # TypeScript declarations into types/ (generated, not committed)
npx tsc -p test/types/tsconfig.json    # a strict TypeScript program that uses the package by its types
```

The result types are exported by name (`import type { Analysis, MoveExplanation, Invalid } from 'stepchess'`), and every result is a union you narrow
on `ok` and `kind`. `stepchess/board` has its own declarations (`board/index.d.ts`) with the payload of every event.

The engine is built in layers with no import cycles, and a test enforces this. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) describes the layers, the
evaluation trace, the result contract, languages, the opponent levels and what each test pins. [docs/API.md](docs/API.md) lists every function and result
shape. [docs/DESIGN.md](docs/DESIGN.md) is the design the engine was built from.

## License

MIT © 2026 legostin
