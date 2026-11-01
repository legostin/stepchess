> This is the design document stepchess was built from, written on 2026-11-01. This is an English translation of the Russian original. Where the code differs from it, [API.md](API.md) and [ARCHITECTURE.md](ARCHITECTURE.md) describe what the code does; the differences are listed at the end of [ARCHITECTURE.md](ARCHITECTURE.md#where-the-code-differs-from-the-design).

# stepchess — a chess engine that teaches and explains (design)

Date: 2026-11-01. Subproject 1 of 2 of the owner's larger task: "a chess course in the format of our
best courses, interactive, with exercises, from beginner to pro, with its own powerful engine in a
separate open-source repository, like stepcas". Subproject 2 is the course itself on the site; it
will have its own spec. We build the engine first because the course stands on it: checking
puzzles, analysis, play, reviews.

## Decisions made with the owner

- **Technology:** pure JavaScript, ES modules with no dependencies, browser (Web Worker) and Node.
  The same stack as stepcas and the site; the code is readable, and the course can show how the
  engine works.
- **Goal:** a system that teaches and explains. A rating race is not the goal ("no goal of competing
  with some solutions right now"). The strength bar: confidently beat any student of the course and
  reliably check puzzles — the target is 2400+ at a normal time control in the browser.
- **Evaluation:** hand-written, broken down into named terms. NNUE is out of scope for the first
  version (a possible "booster" later that does not touch the explanations).
- **Explanations:** an "explaining engine" (approach 1 of three): the explanation is built from the
  same evaluation and the same lines that the search computes, so it never diverges from the
  engine's play. Rejected: an opaque evaluation plus a separate commentator (divergences), an LLM
  commentator (server, money, non-determinism, invented lines; possible later as a site option).
- **Package contents:** core + explanations in RU/EN + human-like strength levels + puzzles
  (verification and search) + exact tablebases for ≤ 4 pieces + opening names + a separate board
  module. Chess variants (Chess960 and others) are not in the first version.
- **Data:** the evaluation weights are tuned only on the engine's games against itself. The Lichess
  game database (CC0) is used only as statistics of human behaviour for calibrating the levels.
- **Git:** a local repository `../stepchess`; commits, creating the GitHub repository and pushing
  happen only on the owner's command.

## Package

- Name `stepchess` (a relative of stepcas). Repository `../stepchess` → `github.com/legostin/stepchess`.
- MIT, Node ≥ 20, `"type": "module"`, no runtime dependencies; dev dependencies as in stepcas
  (eslint, prettier, typescript for generating types from JSDoc).
- Entry points: `stepchess` (the core, no DOM), `stepchess/board` (web components), `stepchess/worker`
  (the worker), the binary `stepchess-uci` (`bin/uci.js`).
- Documents: `README.md`, `docs/ARCHITECTURE.md`, `docs/API.md`, `bench/REPORT.md`; a copy of this
  spec is `docs/DESIGN.md`.
- The site includes the package as `"stepchess": "file:../stepchess"`.

### Layers

Each layer imports only the layers below it; the architecture test checks this and the absence of
cycles. Modules reach each other only through the `index.js` of their layer; each file begins with
its path and a description of what is in it (as in stepcas).

```
src/
  core/      position, moves, FEN/SAN/UCI/PGN, rules
  eval/      evaluation broken down into terms
  search/    search, hash table, time control, multi-PV
  explain/   motifs, move review, game review, hints
  play/      the human-like opponent
  puzzles/   puzzle verification, search and tagging, the "mate in N" solver
  endgame/   tablebases for ≤ 4 pieces, opening names, the book
  i18n/      RU/EN messages, localize()
  worker/    the worker and a client with a promise-based API
  api.js     the public API (index.js re-exports it)
bin/uci.js
board/       web components (import only the public API of the core)
data/        evaluation weights, level parameters, openings, tablebases (generated files)
scripts/     datagen, tune, calibrate, tablebases, openings
bench/       matches, tactical suites, speed, the report
test/
```

### Public API

General rules (as in stepcas):
- on user input the functions do not throw exceptions: on error they return `{ok: false, kind: 'invalid',
  reason, code}`;
- a result has the form `{ok, kind, …}`; texts are messages in all languages at once,
  `localize(r, 'ru' | 'en')` turns the whole result into strings of a single language;
- a move is accepted as input in SAN (English and Russian), UCI, or as an object `{from, to, promotion}`.

| Function | What it returns |
|---|---|
| `new Position(fen?)` / `Game` | a position and a game: moves, undo, legal moves, status (mate, stalemate, draws), FEN/PGN |
| `analyze(fen, {depth \| movetime \| nodes, multipv})` | evaluation (hundredths of a pawn and win chances), lines, depth, nodes, the evaluation breakdown |
| `explainMove(fen, move, opts)` | move class, win chances before/after, best move, motifs, the main evaluation changes, refutation, `steps[]`, annotations for the board |
| `reviewGame(pgn, opts)` | classes of all moves, accuracy of each side, key moments, missed wins, opening and end of theory, a summary by phase |
| `hint(fen, step)` | a hint of step 1–3: where to look → what to look for → the move (+ annotations) |
| `createOpponent({elo, seed})` | an opponent with `move(fen, clock?)`; deterministic for a given `seed` |
| `verifyPuzzle({fen, moves})` | `ok`, problems (alternative solutions, weak replies), themes, a difficulty/rating estimate |
| `solveMate(fen, n)` | all "mate in n" solutions (including alternative ones) or a proof that there are none |
| `findPuzzles(pgn)` | puzzles from a game |
| `tablebase(fen)` | with ≤ 4 pieces: result, moves to mate, best moves; otherwise `{ok: false, code: 'too-many-pieces'}` |
| `openingName(moves \| fen)` | ECO, name in RU/EN, the move at which the line ends |
| `createEngine()` | a worker client: the same calls asynchronously, `stop()`, analysis progress by depth |

Synchronous calls are available in Node and in the worker; on a page, heavy work goes through
`createEngine()`.

## Core (`core/`)

- A 0x88 board (`Int8Array(128)`) with piece lists; a move is packed into a 32-bit number
  (from, to, piece, captured piece, promotion, flags).
- Incremental make/unmake: a Zobrist hash (two 32-bit halves), material and piece-square sums for
  both phases, counters for the fifty-move rule, a history of hashes for repetitions.
- Move generation is legal right away (accounting for pins and checks, with a separate path for
  escaping check), plus generation of captures/promotions only for quiescence.
- Rules: castling (including the ban on castling through an attacked square), en passant (including
  the horizontal pin), promotion to any piece, checkmate, stalemate, the fifty-move rule, threefold
  repetition, insufficient material.
- Notations: FEN (with validity checking and a clear reason for the error), SAN in English and
  Russian (Кр, Ф, Л, С, К — K, Q, R, B, N), UCI, PGN with variations, comments and NAG.
- Attack maps on demand (who attacks a square, how many times, x-ray) — used by SEE and by the
  motifs.

## Evaluation (`eval/`)

A tapered evaluation between the middlegame and the endgame by phase (piece material). Each term is
a named function that, in breakdown mode, reports `{key, white, black, squares[], pieces[]}`, and in
fast mode only adds a number. The code is the same; a test checks that both modes give the same
number and that the sum of the terms equals the total.

| Group | Terms |
|---|---|
| Material | piece values, the bishop pair, imbalances (the exchange, a minor piece against three pawns) |
| Pieces | piece-square tables, mobility, knight outpost, a rook on an open/half-open file and on the 7th rank, the "bad" bishop, trapped pieces |
| Pawns | isolated, doubled, backward, connected, passed (rank, free path, the "rule of the square"), chains |
| King | pawn shield, pawn storm, attacking pieces in the king zone, open files near the king, king activity in the endgame |
| Threats | hanging pieces, pieces attacked by a pawn, double attacks |
| Space and centre | control of the centre, space behind the pawns |
| Endgame knowledge | mate with bishop and knight (the colour of the bishop's corner), opposite-coloured bishops and the "wrong" bishop (scaling towards a draw), typical fortresses |

- The weights are in `data/weights.js`, fitted by Texel tuning (`scripts/tune`) on positions from
  the engine's games against itself (`scripts/datagen`), the label being the game result. Other
  engines' evaluations are not used.
- A pawn hash table caches the pawn terms.
- The scale: hundredths of a pawn. Win chances: `win% = 1 / (1 + exp(-k · cp))`, with `k` fitted on
  the same games. The move class is determined by the loss of win chances of the side that made the
  move:

| Class | Loss of win chances |
|---|---|
| best | the move matched the best move (or the loss is < 1%) |
| good | < 5% |
| inaccuracy (?!) | 5–10% |
| mistake (?) | 10–20% |
| blunder (??) | > 20% or a missed/allowed mate |

The thresholds are constants in one place; the course can show them.

## Search (`search/`)

- Iterative deepening, PVS, aspiration windows, a hash table on an `Int32Array` (the size is
  configurable, 16 MB by default, buckets replaced by depth and age).
- Quiescence: captures and promotions, pruning by SEE and by delta; checks at the first level.
- Pruning and reductions: null move (with a check in the endgame against zugzwang), LMR, futility and
  reverse futility, late move pruning; check extension; mate distance pruning.
- Move ordering: the hash move, captures by MVV-LVA with SEE, killer moves, history, counter-moves.
- Repetitions and the fifty-move rule inside the search; multi-PV; stopping by depth, time, nodes or
  signal; time management for games with clocks.
- A deterministic mode (a fixed number of nodes, with no dependence on time) — for tests, golden
  snapshots and reproducible levels.
- Single-threaded. Lazy SMP on several workers — later, if needed.

## Explanations (`explain/`)

### Motifs

A motif is a detector function `(position, move, context) → null | {key, side, pieces[], squares[],
arrows[], params}`. The detectors are run on every ply of the main line over the attack maps; the
result carries the evidence (who takes part, which squares, which arrows to draw).

- Tactics: fork (including by a pawn and by the king), pin absolute and relative, skewer, discovered
  attack, double check, deflection, decoy, overloading, removal of the defender, interference, x-ray,
  zwischenzug, desperado piece, trapped piece, hanging piece, back-rank weakness, clearance of a
  square/file, promotion and underpromotion, sacrifice.
- Mating patterns: back-rank mate, smothered mate, Anastasia's mate, Arabian mate, Boden's mate,
  Légal's mate, epaulette mate, Greco's mate, Damiano's mate, ladder mate, corridor mate.
- Positional: outpost, weak square, open file, isolated pawn, creating a passed pawn, minority
  attack, pawn break, prophylaxis, piece improvement, king activation, opposition, triangulation,
  zugzwang, fortress. They are determined by the deltas of the evaluation terms between the position
  before the move and the quiet position at the end of the line, plus recognisable features
  (opposition — the distance between the kings and whose turn it is; zugzwang — the null move is
  noticeably better than any move).

The list of motifs is a dictionary of keys with names and short definitions in RU/EN in `i18n/`.
The course needs the same dictionary for tags and a glossary.

### Move review, game review and hints

- `explainMove`: a search from the position before the move (multi-PV 3) and after the move; the
  class by loss of win chances; the motifs of the move and of the reply; the 2–3 terms with the
  largest delta («пешечное прикрытие короля −0,6» ("king's pawn shield −0.6")); for inaccuracies and
  worse — the refutation as a line of moves with motifs, and the best move with its motifs.
  `steps[]` are steps in the stepcas format `{title, text?, line?, annotations?, data}`.
- `reviewGame`: classes of all moves (the node budget per move is configurable), the accuracy of
  each side (the average over moves, by a formula from the loss of win chances), key moments (the
  largest swings in win chances), missed wins, the opening (`openingName`) and the move where theory
  ended, a short summary by phase.
- `hint`: step 1 — where to look (the piece or area taking part in the best move/motif), step 2 —
  what to look for (the name of the motif or plan), step 3 — the move with an explanation.
- Annotations are a common format for the board: `{arrows: [{from, to, kind}], squares: [{sq, kind}],
  badges: [{sq, glyph}]}`, where `kind` ∈ `best | threat | bad | idea | attack | defend`.

## Human-like opponent (`play/`)

- Input: a rating of 400–2800 (and `seed`). The level parameters are from `data/levels.json`.
- Mechanics: a node budget; a choice from multi-PV by softmax with the level's temperature; "blind
  spots" of the weak levels (retreating moves, long diagonals, quiet strong moves, the opponent's
  threats deeper than N plies); the probability of a mistake grows with the complexity of the
  position (the number of plausible candidates, the gap between the best and the second-best move)
  and is not uniformly random. In the opening, a book of lines of named openings with weights.
- Calibration (`scripts/calibrate`): from the monthly Lichess game dump (CC0), human statistics are
  computed by rating bucket — the distribution of the loss of win chances per move, the share of
  blunders and mistakes, by game phase and by time control. The level parameters are fitted so that
  the bot's statistics match. The games are used only as behaviour statistics; the evaluation is not
  trained on them.
- Verification: matches between levels give the score expected from the rating difference (the
  tolerance is in `bench/REPORT.md`). The label is honest: "roughly like a Lichess player rated N".

## Puzzles (`puzzles/`)

- `verifyPuzzle({fen, moves})`: at each move of the solver — multi-PV 2 and a check that the winning
  move is the only one (a threshold on the gap in win chances; in mate puzzles, another move that
  also mates but takes longer is a note, not a defect); the opponent's replies are the best ones; the
  final position is a mate or a decisive advantage. It returns the problems with a move number,
  themes (the motif detectors) and difficulty (depth, the number of plausible candidates, the
  "quietness" of the key move → an estimate of the puzzle's rating).
- `solveMate(fen, n)`: an exact search over all defences, all solutions, including alternative ones
  (for composed problems).
- `findPuzzles(pgn)`: positions where, after the opponent's mistake, there is a single winning move;
  each candidate goes through `verifyPuzzle`.
- The source of puzzles for the course is decided by the course spec; the engine verifies puzzles
  from any source.

## Endgame and openings (`endgame/`)

- Tablebases for ≤ 4 pieces are built by retrograde analysis (`scripts/tablebases`): the result and
  the number of moves to mate for each position, taking symmetries into account. The teaching set
  (about 20): KQK, KRK, KBBK, KBNK, KNNK, KPK, KQKQ, KQKR, KQKB, KQKN, KQKP, KRKR, KRKB, KRKN, KRKP,
  KBKP, KNKP, KPKP, KBPK, KRPK (the last two are 4 pieces with a pawn on the stronger side; the final
  list is set by the budget). Storage: compressed binary files in `data/tb/`, loaded lazily by
  endgame type. The budget is a few MB in total; if we do not fit, the rare endgames are generated
  in the worker on demand.
- The search and the explanations use the tables at the leaves when there are ≤ 4 pieces.
- Opening names: lichess-org/chess-openings (CC0, ~3500 lines, ECO) → `data/openings.js`
  (`scripts/openings`), with Russian names for the main openings and variations. The opponent's book
  is built from the same lines.

## Board module (`board/`)

A separate entry point `stepchess/board`, with no dependencies, web components in Shadow DOM. The
theme is CSS variables and `::part()`; light and dark out of the box.

- `<stepchess-board>`:
  - SVG and our own set of pieces (the popular open sets are GPL/GFDL, incompatible with MIT);
  - coordinates, flipping, move animation (disabled under `prefers-reduced-motion`), highlighting of
    the last move and of check;
  - input: dragging with a mouse and a finger, "tap a piece → tap a square", dots for legal moves,
    choosing a piece on promotion; from 320 px;
  - accessibility: keyboard control (arrows move the focus, Enter selects), square labels for a
    screen reader («белый конь f3» ("white knight f3")), announcement of the moves made
    (`aria-live`);
  - annotations in the `explain/` format (arrows, squares, badges) and user arrows with the right
    button or a long press;
  - modes `play`, `puzzle`, `analysis`, `setup`, `view`;
  - events `move`, `select`, `puzzle-solved`, `puzzle-failed`; methods `setPosition`,
    `playMoves`, `annotate`, `flip`, `undo`.
- `<stepchess-evalbar>` — the win-chances bar.
- `<stepchess-moves>` — the game record with variations and badges of the move classes; a click
  rewinds the linked board.
- `<stepchess-explain>` — the panel of explanation steps; steps one at a time, the annotations of
  the current step on the linked board.
- The component UI strings are from `i18n/` (`lang="ru|en"`).
- `board/demo.html` — a demo of all modes, works locally and through jsDelivr.

The unique chapter widgets, trainers and the course's styling live in the site's code on top of these
components.

## Quality assurance

Tests (`node --test test/*.test.cjs`):

- Rules: perft of the six standard positions (the initial position, Kiwipete, positions 3–6) to
  depth 5–6 with an exact match; FEN/SAN/PGN round trips; tricky cases (a pinned en passant capture,
  castling through an attacked square, promotion with capture, repetitions, insufficient material).
- Evaluation: symmetry (a mirrored position → the same evaluation with the opposite sign); fast mode
  = breakdown mode; the sum of the terms = the total.
- Search: the "mate in N" suites are solved completely; WAC at fixed nodes — not below a threshold
  (the threshold is in the test and is raised along with the strength).
- Motifs: selected positions with expected motifs and negative examples.
- Contract: every API result and every step has a documented shape; every message exists in RU and
  EN; `localize` leaves no multilingual objects.
- Architecture: layers, no cycles, entry through `index.js`, a header in every module.
- Golden snapshots: the outputs at fixed nodes over a corpus of positions are stored as fingerprints
  (`bench/golden.json`), so a change in behaviour is visible in the diff.
- Tablebases: consistency of WDL and moves to mate; known maxima (KQK 10, KRK 16, KBNK 33).
- Puzzles: the verifier finds alternative solutions in puzzles where they definitely exist; it
  accepts correct ones.
- Board: tests of the component logic in node (annotation parsing, puzzle mode) + a manual/scripted
  run of the demo in a browser (320/768/1280, light and dark, no errors in the console).

Bench (`bench/`, local; not run in CI):

- A match runner in Node on `worker_threads` (up to 16 games in parallel), starting positions from a
  balanced book, SPRT for comparing versions; against external UCI engines — through fastchess, if
  installed.
- Speed (nodes/s), the percentage of tactical positions solved, calibration of the levels.
- The results are in `bench/REPORT.md`.

CI (GitHub Actions, Node 20/22/24): lint, format:check, tests, types, a check of the golden
snapshots. Raw data (datagen games, Lichess dumps) lives outside the repository.

## Integration with the site

- The site's `package.json`: `"stepchess": "file:../stepchess"`; Vite bundles the core and the worker
  (`new Worker(new URL('stepchess/worker', import.meta.url), {type: 'module'})`).
- The tablebase files are copied to `public/` at build time; the path to them is passed in
  `createEngine({tbUrl})`.
- The course is a separate spec and a site module; it can be started after step 4 (the board and the
  demo).

## Order of work

1. Core: position, moves, rules, notations, perft.
2. Evaluation with breakdown, search, UCI, worker.
3. Explanations: motifs, `explainMove`, `reviewGame`, `hint`, i18n.
4. Board module and demo.
5. Human-like opponent and calibration.
6. Puzzles: verification, the mate solver, search in games.
7. Tablebases for ≤ 4 pieces, opening names, the book.
8. datagen + Texel tuning, strength runs, the report.
9. Documentation: README, ARCHITECTURE, API.

## Risks

- **JS speed.** 0x88 and typed arrays with no allocations in the hot loop; profiling of nodes/s from
  step 2. If 2400+ is not reached, first the search and move ordering, then tuning.
- **False motifs.** Negative examples in the tests; a detector fires only with evidence on the
  board; when in doubt, the motif is not named.
- **Calibration of the levels.** Lichess ratings ≠ FIDE — the label says so; the calibration is
  re-checked by matches between levels.
- **Tablebase size.** The budget is fixed; if exceeded — generation on demand.
- **Long runs** (datagen, tuning, matches) go in the background on the owner's PC (Ryzen 7 9800X3D,
  16 threads) and do not block the rest of the work.
