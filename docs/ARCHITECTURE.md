# Architecture

How stepchess is put together, and why. [API.md](API.md) says what each function takes and returns; [DESIGN.md](DESIGN.md) is the design it was built from (an English translation of the Russian original).

- [The layers](#the-layers)
- [The evaluation and its trace](#the-evaluation-and-its-trace)
- [From a trace to an explanation](#from-a-trace-to-an-explanation)
- [Results and steps](#results-and-steps)
- [Languages](#languages)
- [Puzzles and the exact mate solver](#puzzles-and-the-exact-mate-solver)
- [The opponent](#the-opponent)
- [The board](#the-board)
- [Testing](#testing)
- [Where the code differs from the design](#where-the-code-differs-from-the-design)

## The layers

Each unit of `src/` (a directory, or a top-level file) sits on a layer and imports only from its own unit or from a lower layer. Units on one layer do not import each other.
Lowest first:

| Layer | Units | What they hold |
|---|---|---|
| 0 | `i18n` | Messages: every word the engine says, in every language. |
| 1 | `core`, `client` | The rules: squares, pieces, moves, Zobrist keys, `Position`, move generation, attacks, SEE, SAN, PGN, `Game`. And the worker client, which imports nothing above it. |
| 2 | `eval`, `endgame` | The evaluation with a trace. Tablebases, opening names and the opening book. |
| 3 | `search` | Iterative-deepening alpha-beta: the transposition table, move ordering, time allocation. |
| 4 | `explain` | Motifs, move classes, annotations, `explainMove`, `reviewGame`, `hint`. |
| 5 | `play`, `puzzles` | The opponent's levels and the opponent. Puzzle verification, search and the exact mate solver. |
| 6 | `api` (`src/api.js`) | The public contract: safe wrappers and result shapes. |
| 7 | `index` (`src/index.js`) | The package: re-exports `api.js` and the lower units. |
| 8 | `worker` | The worker script: messages in, the functions of the package, messages out. |

`test/architecture.test.cjs` checks these rules on the import graph:

- a module imports from its own unit or a lower layer only;
- there are no import cycles, not even inside a unit;
- another unit is entered through its `index.js`;
- `api.js` is imported only by `src/index.js`, and `src/index.js` only by the worker;
- a module speaks from its own catalog domain: `msg('explain.…')` only in `src/explain/`, `msg('api.…')` only in `api.js`;
- every file opens with a comment with its path and what it holds;
- every module loads.

`board/` is outside the layers. It imports only the public package (`../src/index.js`), so it can be used with any build of the engine.

Code holds no words: every text a user can read is `msg('<domain>.<module>.<name>', params)`, with templates in `src/i18n/{ru,en}/<domain>.js`. There is no Cyrillic in
the code outside `src/i18n/ru/`. A test scans for both.

## The evaluation and its trace

The evaluation is hand-written, a sum of named terms, tapered between a middlegame value and an endgame value by the phase (24 with all the pieces, 0 with none), and multiplied by an endgame scale
(a drawish endgame, such as opposite-coloured bishops, scales the score towards 0). There are 31 terms in seven groups (`TERMS` in `src/eval/params.js`):

| Group | Terms |
|---|---|
| material | `material`, `bishop-pair`, `imbalance` |
| pieces | `pst` (piece-square tables), `mobility`, `knight-outpost`, `rook-open-file`, `rook-semi-open-file`, `rook-seventh`, `bad-bishop`, `trapped-piece` |
| pawns | `isolated-pawn`, `doubled-pawn`, `backward-pawn`, `connected-pawn`, `passed-pawn`, `pawn-chain` |
| king | `pawn-shield`, `pawn-storm`, `king-attack`, `king-open-file`, `king-activity` |
| threats | `hanging-piece`, `pawn-threat`, `double-attack` |
| space | `center-control`, `space` |
| endgame | `kbnk-corner`, `opposite-bishops`, `wrong-bishop`, `fortress` |

Every term is a function `(pos, t, ctx) → void` that reports through a **tracer**: `t.add(key, color, mg, eg, square?)` adds a value for a colour (a bonus is positive, a penalty is
negative) and `t.mark(key, color, square)` names a square without a number. There are two tracers, and the code of the terms is the same for both:

- `FastTracer` (`src/eval/tracer.js`) keeps two sums, middlegame and endgame, White minus Black. It is what the search uses through `evaluate(pos)`. It allocates nothing, and the pawn terms are read from a pawn hash table.
- `TraceTracer` keeps, for every term, each colour's middlegame and endgame values and the set of squares the term named. `trace(pos)` runs it and returns `{total, phase, scale, terms}`, where each
  term is `{key, group, white, black, value, squares}`, tapered and scaled the same way, so that the terms add up to `total`.

`test/eval.test.cjs` pins what that design promises: the fast score equals the trace total, the terms add up, a mirrored board (colours swapped) negates the score, and each term fires where
it should. The weights are in `src/eval/weights.js` as a readable object, compiled into typed tables by `applyWeights` at load. The tuner (`scripts/tune.mjs`) swaps the tables with `setWeights`.
A move's win chance is `1 / (1 + exp(-K · cp))`; `K` scales only what the explanations show, and the search never reads it.

## From a trace to an explanation

An explanation says only what was computed. `explainMove` makes these computations and nothing else:

1. A search of the position before the move, a search of the position after it, and, when the move is not the engine's own, a search after the engine's move (each with one line). Each is bounded by `nodes`. The win chances come from these; the class of the move comes from the
   loss of the mover's win chance. The search before the move is the one `analyze` makes with the same `nodes`, so the move `analyze` plays is the one called best. Last, for the `alternatives` only, the position before the move is searched once more with the engine's move excluded (multi-PV 2, the same `nodes`); the alternatives are the engine's line and those two, and nothing else in the explanation depends on that search.
2. `detectMotifs` on the move and on the lines the searches found (the engine's line and the refutation). A detector returns a motif only with its proof on the board (the pieces, the squares and the arrows); without a proof it returns nothing.
3. The terms the move changes: `trace` of the position before the move, and `trace` of its quiet end (the position after the move and the captures, promotions and answers to checks that follow in the line, so that an exchange under way
   is counted whole). The difference of each term, for the mover, in centipawns; the largest are kept (at most three, each at least 15 cp and at least a tenth of the largest). A term that moves against the verdict is said as such: the price a sound move pays,
   or what an unsound one gets in return.
4. The sentences are templates filled with these numbers, in every language at once.

Tactics and mating patterns are detected on every ply of the line from attack maps. Positional motifs speak about the move itself: the pawn structure is compared between the position before the move and the end of the line, most of the others are read off the board right after the move, a
fortress comes from the traces (before the move and at the end of the line), and a zugzwang is found by asking a search whether passing would be clearly better than every move (without a search it is not detected). `MOTIFS` lists the 46 keys: 21 tactics, 11 mating patterns, 14 positional.

`reviewGame` does the same per move of a game with one search per position, on the game's own `Position`, so repetitions count from the moves really played. A search of position *i* gives the engine's move at ply *i + 1* and, seen from the other side, the value of the
move that led to it.

## Results and steps

Every public function returns `{ok, kind, …}` and never throws on user input (the contract in [API.md](API.md#conventions)). The mechanism:

- The core throws `ChessError(code, data, text)`. `src/api.js` wraps each function in a `try`: a `ChessError` becomes `{ok: false, kind: 'invalid', code, reason: text}` with its own code (`fen`, `move`, `pgn`, `game`), and anything else becomes
  `code: 'internal'`. A new core code needs no change in `api.js`. The units under `api` (`puzzles`, `play`, `endgame`) do the same for their own failures, so each answers invalid input by itself.
- A result holds numbers, strings, arrays, plain objects and `Msg`. No functions, no class instances other than `Msg`, no cycles. That is why a result crosses a worker boundary (`packMessages` turns each `Msg` into `{$msg, params}`).
- The raw exports (`Searcher`, `evaluate`, `Position`, `Game`, `parseMove`, `detectMotifs`, `generateTable`…) are expert APIs: they take encoded moves and 0x88 squares, trust their input, and throw. Use the safe functions with anything a person typed.
- A position that is over is answered with `ok: true, kind: 'terminal'` instead of a null move.

A **step** is the unit of an explanation, in the format of the stepcas solution steps: `{title: Msg, text?: Msg, line?: string[], annotations?: Annotations, rule, data?, final?}`. `rule` says what the step is (`class`, `motif`, `term`,
`refutation`, `best`, `answer`) and `data` carries the same facts as numbers for programs. The last step has `final: true`. `annotations` is `{arrows, squares, badges}` in square names, ready for a board, and is the same format the board accepts.

`test/contract.test.cjs` checks that over a corpus every result has exactly the documented fields and types, and every step renders in both languages.

## Languages

`src/i18n/index.js` holds the mechanism, and it is the one stepcas uses.

- `msg(key, params)` makes a `Msg`: a key and its parameters. Nothing is rendered until someone reads it: `m.in('en')`, `m.en`, `` `${m}` `` (the default language), `localize(tree, lang)`. `JSON.stringify(m)` writes every language: `{"ru": "…", "en": "…"}`.
- A template is a string with slots `%{name}` and plural slots `%{n|one|few|many}` (forms in the order of the language's `Intl.PluralRules` categories), or a function `(params, lang, render) => string` for grammar a slot cannot express.
  A parameter may be a string, a number, a `Msg`, a `{ru, en}` object, a list (joined with `, `) or a function of the language, computed for every language when the message is made.
- The catalogs live in `src/i18n/{ru,en}/<domain>.js`: `api`, `board`, `client`, `core`, `endgame`, `eval`, `explain`, `openings` (inside `endgame`), `play`, `puzzles`, `search`.
- A key is looked up in the language, then its base languages, then English, then Russian.

Adding a third language needs no change in the code:

```js
import { registerLanguage } from 'stepchess';
registerLanguage('kk', { api: { error: { internal: '…' } } /* … */ }, { base: 'ru' });
```

From then on every `Msg` has a `.kk` getter, `localize(result, 'kk')` renders the whole result in it, the `lang="kk"` attribute works on the board elements, and the keys the catalog lacks come from `base`. A complete catalog has the same keys as `src/i18n/en/`;
`test/i18n.test.cjs` checks that the shipped catalogs are complete, that every key used in the code exists, that every key in the catalogs is used, and that a third language joins with one call.

## Puzzles and the exact mate solver

`verifyPuzzle` judges a line by searches (multi-PV 2 at each solver move: the played move must be the best and win, and the second-best must trail by a margin of win chance; each reply must be the best defence).
In a puzzle that ends in checkmate the alternatives that count are mates only, and the keys come from an exact proof where it fits in the budget.

`solveMate` is exact, not a search with a depth and a hope. It proves *the attacker wins in n moves* as an AND-OR tree:

- OR node (the attacker to move): some move wins in `n` moves. The last attacker move is tried among the checking moves only, since a mate is a check. Every other attacker move is tried.
- AND node (the defender to move): every legal reply leaves the attacker a mate in `n − 1`. A stalemate or a drawn position ends a line without a win. Every reply is tried.
- Nothing is pruned that could change the answer. What makes it fast is only order (checks first, the reply that refuted the previous sibling first) and a table of positions whose answer is known for some `n`.
- Because it does not prune, it finds the *cooks* of a problem (every first move that mates), and `verifyPuzzle` uses that to find alternatives that the search would miss.
- A proof too large for its node budget is reported as `invalid`, code `limit`, and never guessed. Two things are outside the proof: repetitions (a mate in at most 5 does not need one) and the half-move clock when two routes reach one position.
  `n` is at most 5.

`findPuzzles` runs the search over a game, takes the moves that cost 30% or more of the win chance and leave the opponent a unique win, extends the line while the win stays unique, and passes each candidate through `verifyPuzzle`.

## The opponent

`play/` makes a player of a given strength that errs the way a person of that strength errs.

A level is `{elo, nodes, temperature, multipv, blind: {backward, longDiagonal, quietWin, threatDepth}, blunder: {base, complexity}}`, with seven anchors (400, 800, 1200, 1600, 2000, 2400, 2800); an elo between two anchors is interpolated. A move is chosen in four steps:

1. In the first 12 plies a book move is drawn by weight (the number of named opening lines that go on with it).
2. Otherwise the position is searched twice with the level's node budget and multi-PV: once shallow (to `threatDepth` plies), once at full depth.
3. The candidates are thinned the way a person misses things. With the level's chance, a move backward by a piece other than a pawn, a move along a diagonal of more than four squares, and a quiet move whose gain shows only beyond the shallow view are dropped.
   A move whose refutation lies beyond the shallow view is scored as the shallow view scores it. The thinning works on the moves of the full search's top multi-PV; it does not bring in a move the search left out. A mate in 1 is always played.
4. A softmax over the scores divided by the level's `temperature` picks the move; with a chance `blunder.base + blunder.complexity · (candidates within 50 cp of the best − 1)`, the 2nd to 4th best is played instead. The chance grows with the number of near-equal candidates,
   so mistakes come in complex positions rather than at random.

All randomness comes from the `seed` (mulberry32): the same seed, level and sequence of positions give the same moves.

**Calibration** (`scripts/calibrate.mjs`, results in [bench/REPORT.md](../bench/REPORT.md)). The anchors of the ladder were fitted to the statistics of real games, with no engine play against people:

1. A monthly Lichess dump (January 2014: 500,000 games scanned, 328,548 usable: rated, not bullet, both ratings, at least 24 plies) is read as a stream. Players are put into buckets by the nearest anchor within ±100 rating points, with up to 200 games and 2 positions per game and bucket.
2. The engine measures, at 50,000 nodes, the loss of win chance of each human move (the best move's chance minus the played move's). Per bucket: the mean loss, and the shares of moves losing 5% or more, 10% or more and more than 20%, by phase.
3. Per bucket a coordinate search moves `nodes`, `temperature` and `blunder.base` until the bot, playing the same positions, loses as the people did. The blind spots stay as set by hand.
4. The anchors are made monotone along the ladder (pool adjacent violators; anchors with no data keep their hand-set values), then each is separated from the one below by at least a factor 1.4 in nodes, 0.85 in temperature and 0.01 in `blunder.base`, since equal parameters would mean equal strength.
5. The ladder is measured on 224 shared positions (the same moves for every level, a 50,000-node judge): the mean loss falls from 7.8% at 400 to 1.0% at 2800.

Only games of Lichess players are used, and only as statistics of behaviour: Lichess ratings are not FIDE ratings, so the label is "about as a Lichess player of that rating". The anchors 400 and 2800 had no games within range and keep their hand-set values. The games of 1600, 2000 and 2400 cannot be
told apart by loss per move (about 3%), which is why the monotone pass pools them. The block between the markers `<generated>` and `</generated>` in `src/play/levels.js` is written by the script; `HAND_SET` keeps the starting anchors so the calibration can be run again, for instance after the weights change.

## The board

`board/` is four web components over a pure state machine. `board/model.js` holds the state (the game, the selection, a pending promotion, a puzzle in progress, annotations, the set-up position) and has no DOM; every input method takes squares (`'e4'`, or `null` for "off the board") and returns an
outcome `{moves, selection, promotion, puzzle, expected}`. `board/board.js` is a thin view: pointer, keyboard and screen-reader input, drawing, timers, and the events. Because the model is plain, `test/board-model.test.cjs` runs the gestures (tap-tap, a drop off the board, a cancelled promotion, a tap on an opponent piece in a
puzzle) in Node. `bench/board-shots.mjs` drives the real elements in headless Chromium or Edge with mouse, touch and keyboard (Playwright), and checks the console and the layout at several widths.

## Testing

`npm test` runs `node --test test/*.test.cjs`. `npm run check` is lint, `prettier --check`, the tests and the type declarations (CI runs it on Node 20, 22 and 24).

| File | What it pins |
|---|---|
| `architecture.test.cjs` | The layers, no cycles, entry through `index.js`, `api.js` and `index.js` imports, the catalog domain of each module, the header comment of each file, every module loads. |
| `core.test.cjs` | Squares, pieces, moves, Zobrist keys, errors, the position and its FEN: parsing, validation of every bad FEN, the round trip. |
| `perft.test.cjs` | Legal move generation against the published node counts of the standard positions; make and unmake, the incremental hash, and the rules of the game (castling, en passant, promotion, repetitions, insufficient material). |
| `notation.test.cjs` | SAN in English and Russian, move parsing (figurines, long forms, ambiguity), PGN with variations, comments and NAGs, the `Game` (status, history, limits). |
| `attacks.test.cjs` | Who attacks a square (directly and through one piece), the attack maps, and SEE against hand-made exchanges and a brute-force exchange on playout positions. |
| `eval.test.cjs` | The fast score equals the trace total, the terms add up, a colour swap flips the sign, each term fires where it should. |
| `search.test.cjs` | Mates found and scored by distance, stalemate and draws seen, reproducible searches, multi-PV and `exclude`, the WAC suite at a fixed node budget (a threshold that rises with strength). |
| `tablebase.test.cjs` | Material keys and the index with its symmetries, the generator against `Position`, the shipped tables (known maxima: KQK 10, KRK 16, KBNK 33; KPK; KNNK), DTM consistency on random positions, colour flips, en passant, the API. |
| `openings.test.cjs` | The generated data (every line legal, no hash collisions), lookup by position (transpositions, FEN, deviations), hostile input, the Russian names, the book. |
| `motifs.test.cjs` | The motif dictionary and its messages, hand-built positions with the expected motifs and negative examples, the position left untouched, no throw on random games, speed. |
| `explain.test.cjs` | The classes and the accuracy formula, `explainMove`, `reviewGame` and `hint` built from the search and the trace, terminal positions, repetitions on a game's real history (`options.moves`), the worker. The alternatives (the engine's move first, none scored above it), no evaluation terms on a mate, the refutation title, the opponent's threat in a hint, the mate counts that agree, the draw by the tables, the node cap and `movetime`, the 600-ply review limit, mate blunders as key moments. |
| `contract.test.cjs` | Every result of the analysis and explanation API has exactly the documented fields and types over a corpus of positions, and every step renders in Russian and English. |
| `i18n.test.cjs` | Complete catalogs, keys that exist, messages that are used, no words in the code, plural and function templates, a new language without a change to the code. |
| `play.test.cjs` | The levels and their interpolation, the opponent: determinism by seed, legal moves, the book, terminal and invalid input, the strength ladder. |
| `puzzles.test.cjs` | `verifyPuzzle` (valid puzzles, the issues it names and where), `solveMate` (exhaustive, finds a cook), `findPuzzles` (a blunder and its tactic), hostile input. |
| `api.test.cjs` | The public analysis API against hostile input (bad FENs, unplayable moves, odd options, PGN with comments, NAGs and variations), terminal positions, determinism; `createOpponent` (determinism by seed, bad options, terminal positions); the worker client in Node: queueing, `stop`, `terminate`, the tables a `tbUrl` loads in the background (and a Node worker without it), `moves` passed through, options it cannot read or copy as invalid results. |
| `uci.test.cjs` | `bin/uci.js` on stdin and stdout: the handshake, positions, fixed-node and infinite searches with `stop`, clocks, errors, the end of input, `UCI_LimitStrength` (the moves of `createOpponent`, the same in every run). |
| `board-model.test.cjs` | The state machine of the board: selection, drops, promotion, puzzles, annotations, setup, and the touch edge cases that must leave a clean state. |
| `types/consumer.ts` | Not run by `npm test`. A strict TypeScript program that uses the package and `stepchess/board` through their declarations, narrowing every result on `ok` and `kind` with no cast; `npx tsc -p test/types/tsconfig.json` has to compile it, and its `@ts-expect-error` lines (a wrong option, a kind a function never returns, a field another member has) have to be errors. |

The fixtures are in `test/fixtures/` (`motifs.json`, `puzzles.json`, `review.json`). The golden record is `bench/golden.json`: for 60 positions (`bench/suites/snapshot.epd`) the public API runs `analyze` and `explainMove` at a fixed node count, the results are localized to Russian and English, and each of the four texts is hashed. `npm run snapshot:verify` compares every hash with the file and says what moved; `npm run snapshot:update` rewrites it after an intended change of output, so a change of behaviour shows in the diff of one file.
The rest of `bench/` measures speed, tactics and strength (see [bench/REPORT.md](../bench/REPORT.md)) and is not run in CI.

## Where the code differs from the design

[DESIGN.md](DESIGN.md) was written before the code. Where they differ, the code is right, and this is the list, each with its reason.

| Design | The code | Why |
|---|---|---|
| `k` of the win chance is fitted on the same self-play games. | `K = 0.00368208`, the first value, is still in `weights.js`. The fit on the tuning data gives about 0.0070 (bench/REPORT.md). | The explain thresholds and the accuracy formula are Lichess's, calibrated on that `K` over an evaluation on the pawn scale. The self-play fit comes from 5000-node games, which convert an advantage more surely than learners do, so its `K` would overstate a learner's chances. |
| Positional motifs are found by the deltas of the evaluation terms between the position before the move and the quiet end of the line. | Only the pawn-structure motifs and the fortress compare positions that way; the others are read off the board after the move (see above), and zugzwang needs a search. | A term's delta says that something changed, not which piece did it or why; a motif must name its pieces and squares to be shown on the board. The pawn structure and the fortress are the motifs a delta does describe. |
| Weights in `data/weights.js`, level parameters in `data/levels.json`, openings in `data/`; `worker/` holds the worker and the client. | `src/eval/weights.js`, `src/play/levels.js` (a generated block), `src/endgame/openings-data.js`; `data/` holds only the tables, `data/tb/*.bin`. Two units: `client/` (layer 1) and `worker/` (the top layer). | Generated code that is imported is a module of the unit that uses it, so it sits in that unit and the layer test sees it. The client must sit below the API (any page may load it without the engine), the worker above the package it calls. |
| A strength target of 2400+ at a normal time control. | Not measured. [bench/REPORT.md](../bench/REPORT.md) has self-play and suite numbers only. | There was no external engine to play against, and a rating needs one. |
| About 20 tables: also KRKN, KRKP, KBKP, KNKP, KPKP, KBPK, KRPK. | Thirteen are shipped (7.6 MB). The others are generated on demand by `tablebase()`, in 2 to 85 seconds. | The size of the package: the seven others would add several times as much for endings a learner rarely reaches. |
| Search and explanations use the tables in the leaves when there are four pieces or fewer. | They use the tables that are in memory. A worker started with `createEngine({tbUrl})` loads the shipped tables in the background, and a Node worker without `tbUrl` loads them from `data/tb/`; on the calling thread (Node) load them with `preloadTables` or `tablebase` first. | `analyze` and the other functions are synchronous, and reading a table is not: a synchronous call cannot wait for a file. |
| `createOpponent({elo, seed})` gives an opponent with `move(fen, clock?)`. | `move(fen, clock?, moves?)`: the moves played from the FEN make repetitions count. The `clock` is accepted and does not change the move. | The strength is the level's node budget, which takes well under a second at every level; a move that depended on the time left would not be reproducible from the seed. |
| `steps[]` of the form `{title, text?, line?, annotations?, data}`. | Each step also has `rule` (the kind of step), and the last one `final: true`. | An extension: a program can tell the steps apart without reading their text. |
| Board events `move`, `select`, `puzzle-solved`, `puzzle-failed`; methods `setPosition`, `playMoves`, `annotate`, `flip`, `undo`. | Also the events `change`, `position` and `error`, and the methods `setPuzzle` and `cancel`. | An extension: the move list follows the board through `position`, setup mode needs `change`, and a rejected attribute needs `error`. |
| The UCI binary is not described. | `Hash`, `MultiPV`, and `UCI_LimitStrength` with `UCI_Elo` (the move of `createOpponent`, its seed the number of the game in the session). | An extension: the bench plays versions against each other through it. |
| `tablebase(fen)` for more than four pieces gives `{ok: false, code: 'too-many-pieces'}`. | The same, with `kind: 'invalid'` and a `reason`. | The shape every invalid result has. |
| `tablebase(fen)` returns the result. | It returns a Promise of the result. | A table that is not in memory is read from a file, or generated, and reading a file is asynchronous in the browser. |
| `createEngine()`: the same calls, asynchronously. | Its methods are the searches and the lookups (`analyze`, `explainMove`, `reviewGame`, `hint`, `opponentMove`, the puzzles, `tablebase`, `openingName`); it has no `createOpponent`, `position` or `parseGame`. | An opponent object holds functions and state, which cannot cross to a worker (`opponentMove` with a seed varied per move does instead); `position` and `parseGame` do not search, so the package's own functions serve on the calling thread. |
| CI checks the golden snapshots with lint, format, tests and types. | `npm run snapshot:verify` is a separate CI step, on Node 24 only; it is not part of `npm run check`. | The record holds localized texts, and the `Intl` output of other Node versions may differ. |
| The search uses the tables of up to four pieces. | `bin/uci.js` loads no tablebase. | It has no option that says where the files are. The bench compares versions through it, where tables would decide the same endings for both sides, and a GUI brings its own. |
| `explainMove` searches the position before the move with multi-PV 3. | It judges the move with one line, the search `analyze` makes at the same `nodes`, and takes the `alternatives` from one more search of that position with multi-PV 3. The engine's move comes first, with its score from the multi-PV 3 search when it is listed there (and its mate when it forces one); a later alternative is clamped to at most the first one's score. Each alternative also carries `uci`, `scoreWhite`, and `mate` on a line that mates. | A multi-PV search at the same budget can pick another best move than `analyze` does, and the explanation must agree with how the engine plays: the move called best is the one played, and the clamp keeps the list from ranking a move above it. The `uci` is an extension: a board draws a move from it. |
