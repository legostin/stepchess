# API

Everything the package exports, with its parameters and the shape of its result. Every example was run against this version.

- [Conventions](#conventions)
- [analyze](#analyze) · [position](#position) · [parseGame](#parsegame)
- [explainMove](#explainmove) · [reviewGame](#reviewgame) · [hint](#hint)
- [createOpponent](#createopponent) · [opponentMove](#opponentmove)
- [verifyPuzzle](#verifypuzzle) · [solveMate](#solvemate) · [findPuzzles](#findpuzzles)
- [tablebase](#tablebase) · [openingName](#openingname)
- [The worker client](#the-worker-client) · [The worker message protocol](#the-worker-message-protocol)
- [Languages](#languages)
- [The rules of chess](#the-rules-of-chess)
- [Expert building blocks](#expert-building-blocks)
- [stepchess/board](#stepchessboard)
- [The UCI binary](#the-uci-binary)
- [Error codes](#error-codes)
- [Using the types](#using-the-types)

## Conventions

**Results.** A function of the API takes what a stranger may type (a FEN, a PGN, a move, options) and returns `{ok, kind, …}`. It does not throw on
user input. A failure is

```js
{ ok: false, kind: 'invalid', code: 'fen', reason: Msg }
```

`code` is for programs, `reason` is a message for people (see [Languages](#languages)). Anything unexpected inside the engine becomes `code: 'internal'`.
The [codes](#error-codes) of each function are listed at the end.

**Terminal positions.** `analyze`, `explainMove`, `hint` and the opponent accept a position that is already over and answer

```js
{ ok: true, kind: 'terminal', state: 'checkmate' | 'stalemate' | 'insufficient' | 'threefold' | 'fifty', winner?: 'white' | 'black', reason: Msg }
```

`winner` is there for a checkmate only. `threefold` and `fifty` are reported when either side can claim the draw. A FEN that cannot be a position
(two white kings, a pawn on the first rank, the side that has just moved in check) is `invalid`, not `terminal`.

**Moves on input** (the `move` argument of `explainMove`, the `moves` of `analyze` and `verifyPuzzle`, `Game.play`, `parseMove`): SAN in English or
Russian (`Nf3`, `Кf3`, `exd5`, `e8=Q`, `O-O`, `0-0`), with figurines (`♘f3`), a long form (`Ng1f3`, `g1f3`, `g1-f3`, `e7e8q`), or an object
`{from: 'e2', to: 'e4', promotion?: 'q'}`. A move that matches no legal move is `code: 'move'`, with `cause`: `'syntax'` (it cannot be read as a
move), `'ambiguous'` (two pieces can make it; the reason lists the candidates in the language's own SAN, `Nbd2, Nfd2` or the Russian letters) or `'illegal'`.

**History.** `analyze`, `explainMove`, `hint`, the opponent's `move` and `opponentMove` take the moves played from the FEN (`options.moves`, or the third
argument of `move` and `opponentMove`), in any notation. Repetitions are counted over that history, so a threefold repetition is seen and claimed. A value that
is not an array is `code: 'moves'`, a bad entry `code: 'move'`.

**Scores.** Centipawns (hundredths of a pawn). Inside a search a score is from the side to move's point of view; `analyze` also gives `scoreWhite`,
and `win` is always White's chance. `mate` is the signed number of moves to mate for the side to move (`+3`: it mates in three, `-2`: it is mated in
two) and `null` when there is no forced mate. A mate score is `MATE - ply` with `MATE = 32000`.

**Win chance.** `winChance(cp) = 1 / (1 + exp(-K · cp))` with `K = 0.00368208`, so +100 cp is 59%.

**Move classes.** By the mover's loss of win chance: `best` (the engine's own move, or a loss under 1%), `good` (under 5%), `inaccuracy` (5 to 10%),
`mistake` (10 to 20%), `blunder` (over 20%, or a missed or allowed forced mate). `CLASS_THRESHOLDS` is `{best: 0.01, good: 0.05, inaccuracy: 0.1, mistake: 0.2}`.

**Squares.** The API functions use names (`'e4'`) and UCI (`'e2e4'`). The expert functions and the `Motif` objects use 0x88 squares (numbers): see
[The rules of chess](#the-rules-of-chess).

**Synchronous and asynchronous.** The functions below are synchronous (except `tablebase`) and block their thread. In a page use
[the worker client](#the-worker-client).

## analyze

`analyze(fen, options?)`: the best lines of a position.

| Option | Meaning |
|---|---|
| `depth`, `nodes`, `movetime` | Stop at a depth, a node count, or milliseconds. Whole numbers of 1 or more. |
| `wtime`, `btime`, `winc`, `binc`, `movestogo` | A game clock in milliseconds; the engine decides how long to think. |
| `multipv` | How many best lines (default 1). |
| `infinite: true` | No bound; takes effect only together with a `stop` callback. |
| `stop` | `() => boolean`, polled during the search; return `true` to end it. |
| `moves` | Moves played from the FEN (any notation). Repetitions are counted over this history, and the result's `fen` is the position after them. A value that is not an array is `invalid` with `code: 'moves'`. |
| `hashMb` | Transposition table size in MB (default 16, at most 1024). |
| `keepHash: true` | Keep the table from the previous call. By default it is cleared, so the same FEN and options give the same answer. |
| `onInfo(result, meta)` | Called after each line of each depth with a result of the same shape; `meta = {multipv, seldepth, timeMs, hashfull, line}`. A callback that throws does not stop the search. |

With none of `depth`, `nodes`, `movetime`, a clock or `infinite`+`stop`, the budget is 300,000 nodes. Only `depth` and `nodes` make the answer a
function of the input; time does not. Tables that are in memory decide their positions ([tablebase](#tablebase)), so the answer is a function of the
input and of the tables loaded: through `createEngine({tbUrl})`, which loads them in the background, the answer in a position of four pieces or
fewer can change as they arrive.

```js
{
  ok: true, kind: 'analysis',
  fen: string,                        // the position analysed (after options.moves)
  side: 'white' | 'black',            // the side to move
  score: number, scoreWhite: number,  // centipawns, for the side to move and for White
  mate: number | null,
  win: number,                        // White's chance, 0..1
  depth: number, nodes: number,
  lines: [{ uci, san, score, mate, pv: [{uci, san}, …] }, …],   // best first; pv[0] is the move itself
  trace: { total, phase, scale, terms: [{ key, group, white, black, value, squares }, …] }
}
```

`trace` is the evaluation of the position, from White's point of view: `total` centipawns, `phase` 0 to 24 (24 with all the pieces), `scale` 0 to 1 (the
endgame scale), and the terms with a number, the largest `|value|` first. `white` and `black` are each side's part (a bonus is positive, a penalty
negative), `value = white − black`, `squares` the 0x88 squares involved. The terms add up to `total`. `group` is one of `material`, `pieces`, `pawns`,
`king`, `threats`, `space`, `endgame`. The names of the 31 terms are in `TERMS`, and `termName(key)` and `termAbout(key)` are messages.

The result of a [terminal](#conventions) position is `kind: 'terminal'`. A worker result of a stopped analysis also has `stopped: true`.

## position

`position(fen)`: the legal moves, the status and the check.

```js
{ ok: true, kind: 'position', fen, side: 'white' | 'black', legal: [{uci, san}, …], status: {state, winner?}, inCheck: boolean }
```

`status.state` is `'ongoing'` or a terminal `state` (see [Conventions](#conventions)). An invalid FEN gives `code: 'fen'`.

## parseGame

`parseGame(pgn)`: the main line of the first game of a PGN. Comments (`{…}` and `;`), NAGs and variations are accepted (variations are dropped); headers are optional.

```js
{ ok: true, kind: 'game', headers: {Event: '…', …}, moves: [{uci, san, fen}, …], result: '1-0' | '0-1' | '1/2-1/2' | '*' }
```

`fen` is the position after the move. An empty text is a game with no moves. A move that cannot be played is `code: 'pgn'`.

## explainMove

`explainMove(fen, move, options?)`: judge a move. Options:

| Option | Meaning |
|---|---|
| `nodes` | Bounds each search (default 300,000, at most 5,000,000; a larger number is clamped): the position before the move, after it, after the best move when the move is not the best, and the position before the move once more for the alternatives. |
| `movetime` | Milliseconds, a bound on each of those searches as well: whichever of `nodes` and `movetime` comes first. Time makes the answer depend on the machine. |
| `moves` | The moves played from the FEN ([History](#conventions)); the move is judged in the position after them, and a repetition counts. |
| `hashMb`, `keepHash` | As in `analyze`: by default the table is cleared, so the same input gives the same answer. A call with a `hashMb` other than 16 does not keep its table for the next call. |

```js
{
  ok: true, kind: 'move',
  move: { uci, san },
  class: 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder',
  winBefore: number,        // the mover's chance with the best move, 0..1
  winAfter: number,         // the mover's chance after this move
  loss: number,             // winBefore − winAfter, 0 for the best move
  best: { uci, san, line: string[], motifs: Motif[] } | null,   // the engine's move, also when it is the move played (null only with no move); line in SAN
  alternatives: [{ uci, san, score, scoreWhite, mate? }, …],     // at most 3 moves of the position before the move: the engine's first
  motifs: Motif[],          // what the move itself does
  terms: [{ key, delta }],  // the evaluation terms the move changes most, centipawns, largest first (at most 3)
  refutation: { line: string[], motifs: Motif[] } | null,       // the opponent's best answer line, for an inaccuracy or worse
  steps: Step[],
  annotations: Annotations  // everything the steps draw, for a board
}
```

A **Step** is one thing to show:

```js
{
  title: Msg, text?: Msg,
  line?: string[],              // a line of moves in SAN
  annotations?: Annotations,    // what to draw on the board for this step
  rule: 'class' | 'motif' | 'term' | 'refutation' | 'best' | 'answer',
  data?: object,                // facts for programs: {class, winBefore, …} | {key, delta} | {key, kind, ply, side} | …
  final?: true                  // on the last step only
}
```

A **Motif** is a tactic, a mating pattern or a positional idea found on the board, with its proof:

```js
{ key: 'fork', kind: 'tactic' | 'mate' | 'positional', side: 0 | 1, ply: number,
  pieces: number[], squares: number[], arrows: [{from, to, kind}], params: {piece, square, targets} }
```

`side` is 0 for White. `pieces`, `squares`, `arrows` and `params` hold 0x88 squares and piece codes (convert a square with `sqName`). `ply` is the index
in the line that starts with the move. `MOTIFS` lists the 46 keys by kind (21 tactics, 11 mating patterns, 14 positional), and `motifName(key)`, `motifAbout(key)` and `motifSay(key, words)` are messages.

**Annotations** is the format a board draws, the same everywhere:

```js
{ arrows: [{from: 'e2', to: 'e4', kind}], squares: [{sq: 'e4', kind}], badges: [{sq: 'e4', glyph}] }
```

`kind` is one of `best`, `threat`, `bad`, `idea`, `attack`, `defend` (`ANNOTATION_KINDS`); `glyph` is `!!`, `!`, `!?`, `?!`, `?`, `??`, `#` or `+` (`BADGE_GLYPHS`).

`alternatives` are at most three distinct moves of the position before the move: `score` in centipawns for the mover, `scoreWhite` for White, and
`mate` (the signed number of moves to mate for the mover, as in `analyze`) only on a line that mates. The engine's move (`best`, the move `analyze` plays with
the same `nodes`) comes first. The others come from one search of the position before the move with three lines (`multipv: 3`, the same `nodes`), made after
everything else: the class, the chances and the steps do not depend on it.

- The first alternative has its score from that three-line search when the move is among its lines, and otherwise the score of the search that chose it.
  When the engine's move forces mate, it carries that mate: the same number the steps say.
- **The clamp.** A later alternative never scores more than the first: a score above it is lowered to the first one's (and takes its `mate`). The two searches
  can disagree by a few centipawns at a bounded budget, and the list reads as "the engine's move, then the next best", so ties are common in quiet positions
  (`c4 +15, e3 +15, d4 +15`).

How the steps speak:

- A move that mates, allows a forced mate or misses one gets no `term` steps: the mate is the whole story. Nor does a move into a position the endgame
  tables in memory know (a draw, a win or a loss): the table decides, not the evaluation.
- The `refutation` step is titled "The answer … refutes the move" only when the move is a `mistake` or a `blunder` (a loss of 10% or more). An inaccuracy
  is only answered, even when it crosses 50%: "The opponent's best answer: …". A missed mate says so: "The mate in 2 moves slips away".
  Its `data` is `{moves, refutes}`.
- With endgame tables in memory, a drawn result is said as a draw by the tables: "By the endgame tablebases the position is a draw, and the move keeps the draw",
  or, when the move threw a win away, the chances before it and that the tables call the position a draw.
- On a promotion, a fall of the passed-pawn term (the pawn is gone) is counted in the material term.

A position that is over (after `moves`) gives a `terminal` result; an unreadable, ambiguous or illegal move is `code: 'move'` with its `cause`.

## reviewGame

`reviewGame(pgn, options?)`: every move of a game, classed. Options: `nodesPerMove` (default 150,000), `onProgress({done, total})` after every move, `hashMb`.
Each position is searched once, in order, on the game's own history. A game from a `FEN` header starts there. A game longer than 600 plies is
`code: 'limit'`, refused before any search.

```js
{
  ok: true, kind: 'review',
  headers: {…},
  moves: [{ ply, uci, san, class, loss, win, best: {uci, san} | null, motifs: string[] }, …],   // win: White's chance after the move; motifs: keys
  accuracy: { white: number | null, black: number | null },    // 0..100
  keyMoments: number[],     // plies where a side lost the most (at most 5, loss of 10% or more), and every blunder that missed or allowed a forced mate, in game order
  missedWins: number[],     // plies of a move that dropped a won position (75% or more) below that and cost 5% or more
  opening: { eco, name: Msg, ply } | null,                      // the opening the game follows and the last ply of its named line
  phases: { opening, middlegame, endgame },                     // each {white, black, from, to} in plies, or null
  steps: Step[]
}
```

`moves[i].best` is the engine's choice at that position. Accuracy of one move is `103.1668 · e^(−0.04354 · loss%) − 3.1669`, and a side's accuracy is
the mean. A text with no moves, or one that does not parse, is `code: 'pgn'`.

## hint

`hint(fen, step, options?)`: three steps towards the best move. `step` is `1` (where to look: a piece and an area), `2` (what to look for) or `3` (the move).
Options: `nodes` (default 300,000, at most 5,000,000), `movetime`, `moves`, `hashMb`, `keepHash` (as in `explainMove`).

Step 2 says the first of these that holds:

1. The best move mates: "There is a forced mate in 2 moves".
2. The opponent threatens mate: "Your opponent threatens mate with Qxf7#: look for a defence".
3. The best move starts a tactic (a motif of kind `tactic` or `mate`): "Look for a tactic: “Fork”".
4. The best move wins material.
5. The opponent threatens to win material: "Your opponent threatens to win a knight with exf6: look for a defence".
6. The best move carries a positional idea: "Think of a positional idea: “King activation”".
7. The evaluation term the best move improves most.
8. "There is no tactic here: look for a check that improves your position" when the best move is a check, and the same with "a quiet move" otherwise.

The threat is found by a null-move search (the opponent moves twice) at a quarter of `nodes`, at least 2,000: a mate, or a gain of 1.5 pawns or more of
which at least 0.8 is material. A threat counts for step 2 only when the best move meets it: after the move the threat is not the opponent's best answer
and, a capture, no longer wins on the spot. Step 3 then names the defence ("It meets the threat of Qxf7#"). A threat the best move leaves (it does better than
defend, e.g. it takes a rook) is not named at step 2, and step 3 says so plainly: "The threat of Nfxe3 remains, but this move is stronger than a defence".
Otherwise step 3 names the motif, or the term when there is no motif and no mate. A threat step 2 names is drawn as a `threat` arrow.

```js
{ ok: true, kind: 'hint', step: 1 | 2 | 3, text: Msg, annotations: Annotations, move?: {uci, san} }   // move: step 3 only
```

Steps 1 and 2 draw no arrow, so they do not give the move away. Any other `step` is `code: 'step'`. A position that is over is `terminal`.

## createOpponent

`createOpponent({elo?, seed?}?)`: a player of a given strength.

- `elo`: a number from 400 to 2800 (default 1500). Between the seven anchors (400, 800, 1200, 1600, 2000, 2400, 2800) the level is interpolated.
- `seed`: any finite number (default 1). It is used as an unsigned 32-bit integer: truncated, then taken modulo 2^32, so `7.9` plays as `7` and `-1` as `4294967295`
  (the result's `seed` is the number given).

```js
{ ok: true, kind: 'opponent', elo: number, seed: number, move(fen, clock?, moves?) }
```

Anything else is `invalid`: `code: 'elo'` (not a number, or outside 400 to 2800), `'seed'` (not a finite number), `'options'` (options that are not an object), or
`'internal'` (an options object whose getter throws). It never throws.

`move(fen | Position, clock?, moves?)` answers what `opponentMove` answers (below): `{ok: true, kind: 'move', uci, san, source}`, a [terminal](#conventions) result for a game
that is over, or `invalid` (`code: 'fen'`, `'moves'`, `'move'`). The opponent keeps its random generator between moves, so the same `elo`, `seed` and sequence of positions give the same moves.
A `Position` keeps its history, and `moves` (the moves played from the FEN) gives a FEN one, so repetitions count: the opponent steers away from a threefold
repetition when it stands better and goes for one when it stands worse. `clock` (`{wtime?, btime?, winc?, binc?, movestogo?}`) is accepted and does not change the move: the strength is
the level's node budget, which takes well under a second at every level, and a move that depended on the time left would not be reproducible from the seed.

The opponent cannot cross to a worker (it holds a function); through `createEngine` use `opponentMove`.

## opponentMove

`opponentMove({elo?, seed?}, fen, moves?)`: one move of a player of a given strength, from a fresh opponent. `moves` are the moves played from the FEN, as above.

- `elo`: 400 to 2800 (default 1500; a value outside is clamped, a non-number gives the default).
- `seed`: a number (default 1), used as an unsigned 32-bit integer as in `createOpponent`; anything else plays as 1. The same `elo`, `seed` and FEN give the same move. Vary the seed from move to move.

```js
{ ok: true, kind: 'move', uci, san, source: 'book' | 'search' }
```

or a [terminal](#conventions) result, or `invalid` (`code: 'fen'`, `'moves'`, `'move'`). `book` moves are drawn in the first twelve plies from the named openings.

## verifyPuzzle

`verifyPuzzle({fen, moves}, options?)`: is a line a puzzle? `moves` has an odd number of moves, at most 61, in any notation: the solver's move, the
reply, the solver's move, and so on, ending with a solver move. Option `nodes` bounds every search (default 500,000, at most 20,000,000).

```js
{
  ok: true, kind: 'puzzle',
  valid: boolean,                // true when the issues are none, or only 'longer-mate'
  issues: [{ ply, code, moves? }],   // ply: index in moves; moves: the better move(s) in UCI
  themes: string[],              // 'mate', 'mateIn2', … and the motif keys of the solver's side
  difficulty: { depth, candidates, quiet, rating } | null   // null when valid is false
}
```

| `issues[].code` | Meaning |
|---|---|
| `illegal` | The move at `ply` cannot be played. The check ends there. |
| `not-winning` | The solver's move does not win; `moves` has the one that does, if any. |
| `alternative` | Another move wins as well (a mate puzzle: another move mates as fast). |
| `longer-mate` | Another move mates, but later. Not a fault: `valid` stays true. |
| `weak-reply` | The opponent's reply is not the best defence. |

`difficulty.rating` is `600 + 180·depth + 120·log₂(candidates) + 250·quiet` between 400 and 3000: `depth` is the search depth from which the solution stays
the engine's choice, `candidates` the forcing moves to weigh, `quiet` the share of quiet solver moves (0..1). It has not been calibrated against solvers.
A puzzle that is not valid (or has an illegal move) has no difficulty: `difficulty` is `null`.
Invalid input: `code` `'fen'`, `'input'`, `'moves'` or `'limit'`.

## solveMate

`solveMate(fen, n, options?)`: every first move that forces mate within `n` moves of the side to move, by an exact AND-OR search over all defences. `n` is a
whole number from 1 to 5. Option `nodes` caps the positions visited (default 6,000,000, at most 20,000,000).

```js
{ ok: true, kind: 'mate', n, distance,            // distance: the length of the shortest mate found
  solutions: string[], solutionsSan: string[], distances: number[],   // first moves by length of mate, then by text
  line: string[], lineSan: string[] }               // best play for the shortest: the defender delays, the attacker hurries
{ ok: true, kind: 'none' }                         // no mate within n (also: no legal move)
```

A proof that does not fit the budget is `{ok: false, kind: 'invalid', code: 'limit'}`: the answer is never guessed. `n` not a whole number or below 1 is
`code: 'arg'`; above 5, `'limit'`.

## findPuzzles

`findPuzzles(pgn, options?)`: the puzzles of the first game of a PGN. A move that costs its player 30% or more of the win chance, and leaves the
opponent a unique winning move, gives a candidate; the line is extended while the win stays unique and then verified with `verifyPuzzle`. Option
`nodes` (default 100,000). At most 600 plies.

```js
{ ok: true, kind: 'puzzles', puzzles: [{ ply, fen, moves, themes, rating }] }
```

`ply` is the 1-based ply of the blunder, `fen` the position after it, `moves` the solver's line in UCI. Invalid: `'pgn'`, `'fen'`, `'limit'`.

## tablebase

`await tablebase(fen, {tbUrl?, onProgress?})`: the exact value of a position of at most four pieces, kings included, without castling rights. Tables are read
from `data/tb/` next to the package in Node, or by `fetch` from `tbUrl` (a directory URL, absolute or relative to the page) in a browser; a table with no file is
generated, which takes 2 to 85 seconds and blocks the thread (use a worker; `onProgress({key, phase, done, total})` is the only sign of life).

```js
{ ok: true, kind: 'tablebase', key: 'KQK',
  wdl: 1 | 0 | -1,     // for the side to move: wins, draws, loses (fifty-move rule not modelled)
  dtm: number,         // moves to mate: +n it mates in n, −n it is mated in n, 0 with wdl −1: checkmated now
  moves: [{ uci, san, wdl, dtm }, …] }   // every legal move, best first, valued for the side that makes it
```

A fetch that does not finish in 30 seconds is abandoned, and a file that inflates past the size of its table is refused: either way the table counts as missing
(and `tablebase` generates it). Invalid: `'fen'`, `'too-many-pieces'`, `'castling'`. Thirteen tables are shipped (KQK, KRK, KPK, KBBK, KBNK, KNNK, KQKQ, KQKR, KQKB, KQKN, KQKP, KRKR, KRKB).
`analyze` and the other searches use only tables that are in memory: after `await preloadTables(keys, {tbUrl?})` (resolves `{loaded, missing}`) or after a call
of `tablebase`.

## openingName

`openingName(input)`: which opening is this? `input` is one string: a PGN, a list of moves in one string (any notation, with or without move numbers, as in `'1. e4 e5 2. Nf3'`) or a FEN; an array is invalid (`type`). A game is matched on the
last position of its main line that a named line passes through, so transpositions match. 3,865 named lines (lichess-org/chess-openings).

```js
{ ok: true, kind: 'opening', eco: 'C70', name: Msg, ply: 6, moves: ['e4', …], uci: ['e2e4', …] }   // the line the name ends on
{ ok: true, kind: 'none' }
```

Invalid: `'type'` (not text), `'empty'`, `'long'`, `'fen'`, `'pgn'`, `'failed'`.

## The worker client

`createEngine({workerUrl?, tbUrl?, sharedStop?})` returns an object whose methods return promises of what the same function of the package returns:
`analyze`, `explainMove`, `reviewGame`, `hint`, `opponentMove`, `verifyPuzzle`, `solveMate`, `findPuzzles`, `tablebase`, `openingName`.

- The worker starts with the first call (a `Worker` in a browser, `worker_threads` in Node) and is a module worker at `workerUrl` (default `new URL('../worker/worker.js', import.meta.url)`).
- `tbUrl` is where the table files are; it is the default `tbUrl` of `tablebase`. With it, the worker also loads the thirteen shipped tables from there in the background as it
  starts, the smallest first. No call waits for that: a search uses the tables loaded so far (a search runs to its end before another table arrives), and a table that cannot be loaded
  is left out without an error. Without `tbUrl` a browser worker loads nothing until a `tablebase` call; a Node worker loads the shipped tables from `data/tb/` as it starts. A relative `tbUrl` is resolved against the page
  (`document.baseURI`, or `location` where there is no document) before it is sent to the worker.
- The tables stay loaded between calls only while the worker lives. With the shared stop flag (below) one worker serves every call. In the respawn mode
  each `stop()` that ends an analysis starts a new worker, which loads the tables again from `tbUrl`. A page that stops searches and uses the tables
  should be cross-origin isolated (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`), so the flag can be shared.
- Calls queue and run one at a time, in order. A second call while one runs waits; it is never interleaved.
- Callbacks in the options (`onInfo`, `onProgress`) stay on the calling side and are called as the worker reports.
- `engine.analyze(fen, {onInfo})`: `onInfo(result, meta)` is called after each line of each depth.
- `await engine.stop()` asks the running analysis to end and resolves when the call has ended; the analysis result is the last completed depth, with `stopped: true`. Where a `SharedArrayBuffer`
  can be shared (Node, or a cross-origin isolated page) the worker polls a flag. Elsewhere the worker is terminated and started again, and the call resolves with the last result its `onInfo` reported, marked `stopped: true`.
  `sharedStop` forces one way or the other. Only analysis can be stopped: during another call `stop()` waits for it to finish. With nothing running it resolves at once.
- `engine.terminate()` kills the worker. Every pending call, and every later call, rejects with `EngineError('terminated')`.
- A method the build of the worker does not have resolves to `{ok: false, kind: 'invalid', code: 'unsupported'}`.
- The client never throws on input. Options it cannot read (a getter that throws) resolve to `invalid` with `code: 'options'`; arguments that cannot be
  copied to the worker (a function or a symbol where data is expected: a `DataCloneError`) resolve to `invalid` with `code: 'clone'`.

`EngineError` has a `code`: `'terminated'`, `'crashed'` (the worker died), `'spawn'` (it could not be started) or `'failed'` (a bug in the engine; user input never causes it).
`packMessages(value)` turns every `Msg` in a result tree into `{$msg, params}` for `postMessage`, and `unpackMessages` turns it back; the client uses them.

### The worker message protocol

Use it to talk to `stepchess/worker` yourself. Plain objects both ways.

| Direction | Message |
|---|---|
| to the worker, once | `{type: 'init', tbUrl: string \| undefined, flag: SharedArrayBuffer \| null}`: `flag` is a 4-byte buffer the worker reads as an `Int32Array`; a non-zero value means *stop*, and the worker's `options.stop` polls it. A `tbUrl` starts loading the shipped tables in the background. |
| to the worker, per call | `{type: 'call', id: number, method: string, args: any[], callbacks: string[]}`: `callbacks` names the option functions the caller keeps, as `'<argument index>:<option name>'` (`'1:onInfo'`). |
| from the worker | `{type: 'result', id, value}`: `value` has every `Msg` as `{$msg: key, params}`; a stopped analysis has `stopped: true`. |
| from the worker | `{type: 'cb', id, key, args}`: a call of a callback: `key` is the same `'1:onInfo'`, `args` the arguments (packed). |
| from the worker | `{type: 'error', id, message}`: a bug in the engine, not a user mistake. |

`method` is one of `analyze`, `explainMove`, `reviewGame`, `hint`, `opponentMove`, `verifyPuzzle`, `solveMate`, `findPuzzles`, `tablebase`, `openingName`, `position`, `parseGame`
(the last two are not methods of the client). Anything else gets a `result` that is the `unsupported` invalid result. Importing `stepchess/worker` outside a worker does nothing.

## Languages

A text in a result is a `Msg`: a key and parameters, rendered in a language on demand.

```js
import { msg, localize, registerLanguage, LANGUAGES, DEFAULT_LANGUAGE } from 'stepchess';

const m = msg('api.error.internal');
m.in('en'); m.en; m.ru; `${m}`;     // a language by code, or the default language (ru)
JSON.stringify(m);                  // {"ru": "…", "en": "…"}: every registered language

localize(result, 'en');             // the whole result tree with every Msg (and {ru, en} object) as a string
```

| Export | Meaning |
|---|---|
| `msg(key, params?)` | A message by key. |
| `Msg` | The class. `.key`, `.params`, `.in(lang)`, `.toString()` (default language), `.toJSON()` (every language), and one getter per registered language. |
| `localize(value, lang?)` | Replace every message in a tree with its text in `lang`. Class instances are left as they are. |
| `registerLanguage(lang, catalog, {base?})` | Add or extend a language. A key missing in `lang` comes from `base`, then English, then Russian. |
| `LANGUAGES`, `DEFAULT_LANGUAGE` | The registered codes (`['ru', 'en']`), and `'ru'`. |
| `resolveLanguage(lang)` | `lang` if registered, else the default. |
| `inLanguage(value, lang)` | Any text value (message, string, `{lang: text}`, function, array) as a string in `lang`. |
| `allLanguages(value)` | Any text as `{lang: text}` for every registered language. |
| `eachLanguage(fn)` | `fn(lang)` for each language: `{ru, en}`, or the plain value when they are all equal. |
| `perLanguage(fn)`, `verbatim(text)`, `joined(list, sep?)`, `sameText(a, b)` | Build messages from per-language values, a text that reads the same in every language, a list of texts joined, and compare two texts. |

A catalog is a nested object of templates by domain (`{explain: {term: {title: '%{name}: %{delta}'}}}`). A template is a string with slots `%{name}`, plural slots
`%{n|one|few|many}` (the forms in the order of the language's `Intl.PluralRules` categories), or a function `(params, lang, render) => string`. The shipped catalogs are in
`src/i18n/{ru,en}/`, one file per domain. See [ARCHITECTURE.md](ARCHITECTURE.md#languages) for adding a third language.

## The rules of chess

`stepchess` exports the rules as plain classes and functions. They are the expert layer: they take encoded moves and 0x88 squares, trust their input, and throw `ChessError`
(`.code` is `'fen'`, `'move'`, `'pgn'` or `'game'`; `.text` is a `Msg`; `.data.reason` names the cause) where the API would return `invalid`.

| Export | Meaning |
|---|---|
| `Position` | A position. `new Position(fen?)` (the start position without a FEN; throws `ChessError('fen')` for a bad one), `Position.fromFen(fen)` (the same), `Position.START_FEN`. Fields `board` (an `Int8Array(128)`, 0x88), `side` (0 White, 1 Black), `castling` (bits `WK` 1, `WQ` 2, `BK` 4, `BQ` 8), `ep`, `halfmove`, `fullmove`. Methods `fen()`, `clone()`, `make(m)`, `unmake()`, `makeNull()`, `unmakeNull()`, `inCheck()`, `isRepetition()`, `repetitionCount()`, `isInsufficientMaterial()`, `isAttacked(sq, color)`. `make` takes a legal move. |
| `Game` | A game with history. `new Game(fen?)`, `Game.fromPgn(text)`; `play(input)` (any notation, returns the encoded move; throws `ChessError('move')` or `('game')`), `undo()`, `status()`, `legal()`, `fen()`, `result()`, `pgn(headers?, {lang?})`, and `position`, `startFen`, `moves`, `sans`. `status()` is `{state: 'ongoing' \| 'checkmate' \| 'stalemate' \| 'fifty' \| 'threefold' \| 'insufficient', winner?}`. The history holds `MAX_PLY` (1024) plies. |
| `ChessError` | The error class. |
| `legalMoves(pos)`, `generateMoves(pos, out, capturesOnly?)`, `perft(pos, depth)` | Legal moves as an array of encoded moves; into an `Int32Array(256)`, returning how many; the number of leaf positions. |
| `parseMove(pos, input)` | The legal move a text or object names, or `NO_MOVE`; throws `ChessError('move')` for unreadable or ambiguous input. |
| `toSan(pos, m, {lang?})` | A move as SAN (`'en'` by default, `'ru'` for the Russian letters and `0-0`). |
| `moveToUci(m)`, `encodeMove(from, to, flags?, promo?)`, `moveFrom`, `moveTo`, `movePromo`, `moveFlags`, `NO_MOVE`, `F_CAPTURE`, `F_EP`, `F_CASTLE`, `F_DOUBLE` | Moves are 32-bit numbers. |
| `parsePgn(text)`, `parsePgnGames(text)`, `writePgn(game, {lang?})` | A PGN game as `{headers, root, result}` (a tree of `{move, san, nags, children}`; `root.children[0]` is the main line); all games; a tree back to text. |
| `mirrorFen(fen)` | The same position with colours swapped. |
| `square(file, rank)`, `fileOf`, `rankOf`, `onBoard`, `sqName`, `parseSquare`, `to64`, `from64`, `flipRank`, `ALL_SQUARES` | 0x88 squares (`rank * 16 + file`); `sqName(sq)` is `'e4'`, `parseSquare('e4')` is the number or `-1`. |
| `WHITE`, `BLACK`, `EMPTY`, `PAWN`, `KNIGHT`, `BISHOP`, `ROOK`, `QUEEN`, `KING`, `makePiece(color, type)`, `colorOf`, `typeOf`, `pieceFromFen`, `pieceToFen` | Piece codes: type 1 to 6, the colour in bit 3. |
| `attackersOf(pos, sq, color)`, `xrayAttackersOf`, `attackMaps(pos)` | Who attacks a square directly, who through one piece, and the attack counts of every square. |
| `see(pos, m)`, `seeGe(pos, m, threshold)`, `SEE_VALUES` | Static exchange evaluation of a move. |
| `computeHash(pos)`, `computePawnHash(pos)`, `MAX_PLY` | The Zobrist hash computed from scratch `{lo, hi}`. |

## Expert building blocks

| Export | Meaning |
|---|---|
| `evaluate(pos)` | The evaluation in centipawns from the side to move's point of view. |
| `trace(pos \| fen)` | The evaluation with its terms; the `trace` of `analyze`. |
| `TERMS`, `termName(key)`, `termAbout(key)` | The 31 terms (`{key, group}`), and their names and one-line definitions as messages. |
| `winChance(cp)`, `winChanceWhite(trace)` | The win chance from centipawns, and from a trace (White's). |
| `Searcher` | `new Searcher({hashMb?})`; `search(pos, limits)` returns `{best, score, mate, depth, seldepth, nodes, timeMs, pv, lines, reason}` with encoded moves; `limits` as the options of `analyze` plus `probe` and `exclude`; `clear()`. Synchronous. The position you pass is not changed. |
| `MATE`, `isMateScore(score)`, `mateIn(score)` | `32000`; whether a score is a mate; the signed moves to mate. |
| `probe(pos)`, `bestTbMoves(pos)`, `loadTable(key, bytes)`, `hasTable(key)`, `preloadTables(keys, {tbUrl?})`, `materialKey(pos)`, `generateTable(key, {onProgress?})` | Tablebases in memory: the value of a position `{wdl, dtm}` or `null`, the best moves, registering a table, asking for one, loading files, the material key (`'KQK'`), generating one (slow, blocks). |
| `detectMotifs(pos, move, line?, options?)` | The motifs of a move and of the line that follows it (`Motif[]`). |
| `MOTIFS`, `motifKind(key)`, `motifName(key)`, `motifAbout(key)`, `motifSay(key, words?)` | The dictionary of the 46 motifs, in the order tactics, mating patterns, positional ideas. |
| `CLASS_THRESHOLDS`, `CLASSES`, `CLASS_GLYPHS`, `classify(loss, flags?)`, `moveAccuracy(loss)` | The move classes, their glyphs (`!`, `?!`, `?`, `??`), the class of a loss, the accuracy of a move. |
| `ANNOTATION_KINDS`, `BADGE_GLYPHS` | The values `kind` and `glyph` of annotations take. |
| `unsupported(method)` | The invalid result for a method that does not exist. |

## stepchess/board

`import 'stepchess/board'` registers four custom elements and exports their classes (`StepchessBoard`, `StepchessEvalbar`, `StepchessMoves`, `StepchessExplain`), `defineElements()`,
the board model (`createBoardModel`, `normalizeAnnotations`, `sanIn`, `piecesOfFen`, `MODES`, `KINDS`, `GLYPHS`) and the piece set (`pieceSvg`, `pieceMarkup`, `pieceSprite`, `PIECES`, `DRAWINGS`,
`GLYPH_NAMES`). The model has no DOM: it is the state machine behind the board, and tests run on it in Node.

The language of every element is its `lang` attribute, the nearest ancestor's, or the page's (`ru-RU` reads as `ru`); with none, Russian.

### `<stepchess-board>`

| Attribute | Values |
|---|---|
| `fen` | The position (the start position by default). A rejected FEN leaves the board as it was and fires `error`. |
| `mode` | `play` (default), `puzzle`, `analysis`, `setup`, `view` (no input). |
| `orientation` | `white` (default) or `black`: the side at the bottom. |
| `player` | `white`, `black` or `both` (default): who may move in `play` mode. |
| `puzzle` | A puzzle line in UCI, space separated, the solver's move first. Needs `mode="puzzle"` to be judged. |
| `coordinates` | `none` hides the coordinates. |
| `lang` | `ru` or `en` (or a registered language). |

| Property or method | Meaning |
|---|---|
| `state` | The model's state: `fen`, `mode`, `orientation`, `player`, `turn`, `pieces` (square → letter), `selected`, `targets`, `pendingPromotion`, `lastMove`, `check`, `annotations`, `puzzle {index, length, solved, failed}`, `history`, `status`, `winner`, `valid`, `interactive`. |
| `fen` (get, set), `startFen` | The FEN on the board; setting it calls `setPosition`. The FEN the game started from. |
| `setPosition(fen, {puzzle?: {moves}})` | A new position. Returns `{ok: true, fen}` or `{ok: false, kind: 'invalid', code, reason}`; a rejected call changes nothing. |
| `setPuzzle({fen?, moves})` | A puzzle from `fen` (default: the current position). |
| `playMoves(moves)` | Play moves (UCI or SAN) in any mode: an engine's reply, a line to show. Fires `move` with `source: 'api'`. Returns `{ok, moves, cancelled}` or an invalid result with `played`. |
| `annotate(annotations \| null)` | Arrows, squares and badges in the [Annotations](#explainmove) format; `null` clears. Bad parts are dropped. |
| `flip()`, `undo()`, `cancel()` | Turn the board; take back a move (in a puzzle, back to the solver's turn); drop the selection and a promotion picker, and take back a wrong puzzle move. |

Input: drag and drop, tap a piece and then a square, arrow keys to move the focus and Enter to select, a right-drag (or a long press and drag on a finger) to draw an arrow, a right click or long
press to circle a square. A gesture that ends without a move returns the board to a clean state.

**Events.** All bubble and are composed, except `error`. `event.detail` is:

| Event | `detail` | When |
|---|---|---|
| `move` | `{uci, san, fen, color, source}` | A move was played. `fen` is after it, `color` is `'white'` or `'black'`, `source` is `'user'`, `'auto'` (the puzzle's reply) or `'api'` (`playMoves`). |
| `select` | `{square, targets}` | The selection changed. `square` is the selected square or `null`, `targets` the squares it can go to. |
| `puzzle-solved` | `{moves}` | The line was played to its end, or the solver mated with its last move by a move the line did not have. `moves` are the UCI moves played. |
| `puzzle-failed` | `{uci, expected}` | A wrong solver move: what was played (`null` if unknown) and the UCI move the line wanted. The wrong move stays on show for 0.8 s, then is taken back. |
| `change` | `{fen, valid}` | `setup` mode: a piece was placed or removed. `valid` says whether the position can be left. |
| `position` | `{fen, reason}` | The game on the board was replaced or rewound from outside: `reason` is `'position'` (`setPosition`), `'puzzle'` (`setPuzzle`), `'undo'`, `'attribute'` (the `fen` or `puzzle` attribute), `'cancel'` (a wrong puzzle move taken back, or the element left the page) or `'mode'` (leaving `setup`). It describes the board as it is when sent, after that call's `move` events. |
| `error` | `{attribute, result}` | Not bubbling. The `fen` or `puzzle` attribute was rejected (`attribute` is `'fen'` or `'puzzle'`); the board keeps its position. |

**Styling.** Shadow DOM with CSS custom properties, light and dark by `prefers-color-scheme`: `--sc-light`, `--sc-dark` (squares), `--sc-select`, `--sc-last`, `--sc-check`,
`--sc-arrow-best`, `--sc-arrow-threat`, `--sc-arrow-bad`, `--sc-arrow-idea`, `--sc-arrow-attack`, `--sc-arrow-defend`, `--sc-fg`, `--sc-muted`, `--sc-surface`, `--sc-raised`, `--sc-border`, `--sc-accent`,
`--sc-focus`, `--sc-radius`, `--sc-board-radius`, the piece colours `--sc-white-fill`, `--sc-white-stroke`, `--sc-white-detail`, `--sc-black-fill`, `--sc-black-stroke`, `--sc-black-detail`, and for the
other elements `--sc-evalbar-white`, `--sc-evalbar-black`, `--sc-evalbar-mid`, `--sc-evalbar-border`, `--sc-moves-height`. Parts: `board`, `square`, `coord`, `arrow`, `promotion`
(board), `bar`, `white` (evalbar), `moves`, `list` (moves), `explain`.

### `<stepchess-evalbar>`

White's winning chance as a bar. Attributes `win` (0 to 1, default 0.5), `orientation` (`black` puts White at the top), `horizontal`, `lang`. The `win` property reads and writes the attribute. It has role `meter`.

### `<stepchess-moves>`

The game record with variations and move class marks. Attributes `for` (the id of a board), `pgn` (a record to show), `lang`. Without `pgn` the record grows from the linked board's moves.
A click on a move, the arrow keys, Home and End wind the linked board to that move; a move made on the board from the current move continues the line there, and a new move starts a variation.
Properties and methods: `classes` (get and set: an array with the class of each main-line move for coloured marks), `path` (the UCI moves up to the current move), `go(node)`, `first()`, `prev()`, `next()`, `last()`.
It fires no events of its own: it listens to `move` and `position` of the board.

### `<stepchess-explain>`

One step at a time of an explanation. Attributes `for`, `lang`. Set the `result` property to an `explainMove` result (the `ok` and `kind: 'move'` result shows steps; any other result shows its `reason`), read `index`
and call `step(by)` (Back and Next buttons and the arrow keys do the same). The annotations of the step on show are drawn on the board named by `for`.

## The UCI binary

`npx stepchess-uci` (or `node bin/uci.js`). Standard UCI on stdin and stdout; the search runs in a worker so `stop` is honoured at once. The binary starts its worker
without a `tbUrl`, so its searches use no tablebase.

| Option | Type, default, range | Effect |
|---|---|---|
| `Hash` | spin, 16, 1 to 1024 | Transposition table size in MB, from the next `go`. |
| `MultiPV` | spin, 1, 1 to 10 | Lines reported. |
| `UCI_LimitStrength` | check, false | `true`: `go` plays the move of [`createOpponent`](#createopponent) instead of searching. |
| `UCI_Elo` | spin, 2800, 400 to 2800 | The strength of that opponent. |

Commands: `uci`, `isready`, `setoption name <Name> value <v>`, `ucinewgame` (clears the table), `position startpos | fen <fen> [moves …]`, `go`, `stop`, `quit`. Unknown commands are ignored.
`go` takes `depth`, `nodes`, `movetime`, `wtime`, `btime`, `winc`, `binc`, `movestogo`, `infinite`; other tokens (`searchmoves`, `ponder`, `mate`) are ignored, and a `go` with none of the numeric limits is infinite.
The engine prints `info depth … seldepth … multipv … score cp <n> | mate <n> nodes … nps … hashfull … time … pv …` after each line of each depth, then `bestmove <uci> [ponder <uci>]`.
A position that is over, or invalid, answers `bestmove 0000` (an invalid one first prints `info string <reason>`). The end of input is a `quit` after the search in progress.

With `UCI_LimitStrength` true, `go` answers with the move of `createOpponent({elo: UCI_Elo, seed})`: one opponent per game, its seed the number of the game in the session
(the first `go`, with or without a `ucinewgame` before it, is game 1; each `ucinewgame` after a game has started begins the next), so the same game from a fresh process gets the same moves; a new `UCI_Elo` starts a new opponent with the same seed. The
limits of `go` do not change the move. It prints `info time <ms> pv <move>` and then `bestmove <move>`; a `go infinite` holds the `bestmove` back until `stop`, as the
protocol asks. With `UCI_LimitStrength` false, `go` searches as above.

## Error codes

| Function | `code` |
|---|---|
| `analyze`, `position` | `fen`, `move` (a bad entry of `options.moves`), `moves` (`options.moves` that is not an array; `analyze` only), `game` (more than 1024 plies of history), `internal` |
| `parseGame`, `reviewGame`, `findPuzzles` | `pgn`, `fen`, `game`; `reviewGame` and `findPuzzles` also `limit` (more than 600 plies) |
| `explainMove` | `fen`, `move` (with `cause`), `moves`, `game`, `internal` |
| `hint` | `fen`, `step`, `move`, `moves`, `game`, `internal` |
| `createOpponent` | `elo`, `seed`, `options`, `internal`; its `move`: `fen`, `move`, `moves`, `internal` |
| `opponentMove` | `fen`, `move`, `moves`, `internal` |
| `verifyPuzzle` | `fen`, `input`, `moves`, `limit`, `internal` |
| `solveMate` | `fen`, `arg`, `limit`, `internal` |
| `tablebase` | `fen`, `too-many-pieces`, `castling` |
| `openingName` | `type`, `empty`, `long`, `fen`, `pgn`, `failed` |
| worker client | `unsupported` from the worker; `options` (options it cannot read), `clone` (arguments it cannot copy); `EngineError` codes `terminated`, `crashed`, `spawn`, `failed` for rejections |

## Using the types

The package declares its types: `types/index.d.ts`, built from the JSDoc by `npm run types` (also on install), and `board/index.d.ts`, written by hand for
`stepchess/board`. `test/types/consumer.ts` is a strict TypeScript program that uses them with no cast; `npx tsc -p test/types/tsconfig.json` compiles it.

- Every result type is exported by name: `import type { Analysis, Terminal, Invalid, AnalyzeOptions, MoveExplanation, Alternative, GameReview, Hint, Opponent,
  OpponentMove, PuzzleVerdict, MateSolution, FoundPuzzles, TablebaseResult, OpeningResult, PositionInfo, ParsedGame, Engine, … } from 'stepchess'`.
- Every function returns a union discriminated by literal `ok` and `kind`: `if (!r.ok)` leaves the `Invalid` member, and `r.kind === 'terminal'` (or `'mate'`,
  `'none'`, …) the others. No member has `kind: string`, so a comparison with a kind the function never returns is a type error.
- The methods of `createEngine()` return promises of the same result types; an `Analysis` from the worker may carry `stopped: true`.
- `Msg` has `ru: string` and `en: string`; a language added with `registerLanguage` is `msg.in('kk')` (a string), and `msg.kk` is typed `unknown`, since the
  types cannot know which languages a program registers. `localize(r, lang)` returns the result with every `Msg` typed as `string`.
- `stepchess/board` declares its elements (also in `HTMLElementTagNameMap`, so `document.createElement('stepchess-board')` is a `StepchessBoard`), their
  properties and methods, and `addEventListener` with the payload of each event: `move` gives `CustomEvent<BoardMoveDetail>`, and so on for `select`,
  `puzzle-solved`, `puzzle-failed`, `change`, `position` and `error`. The model (`createBoardModel`) and the piece set are declared too.
- The core classes (`Position`, `Game`, …) are typed from their JSDoc, which is partial: many parameters are `any`.
