# Benchmark report

Measured 2026-11-01 on Windows 11 with Node 24.16, single thread, a 16 MB hash table, and a cleared searcher for each
position. The eval is the Task 6 version that was under review on that date. Timed runs are noisy because other
processes shared the machine; runs at fixed nodes or depth are exact and can be repeated.

## Search speed

| Position | Limit | Depth / seldepth | Nodes | nps |
|---|---|---|---|---|
| start position (warm) | movetime 1000 | 13 / 23 | 457,729 | 457 k |
| Kiwipete | movetime 1000 | 12 / 27 | 531,457 | 531 k |
| WAC, 300 positions | movetime 1000 each | — | 177,908,362 | 678 k |
| WAC, 300 positions | nodes 200,000 each | — | 55,343,964 | 654 k |
| ECM, 183 positions | nodes 200,000 each | — | 36,600,119 | 539 k |

The eval runs at about 1.2 M calls/s, so it sets the search speed. Mated positions and quick mates in the suites push
the suite average above the start-position figure.

## Tactics suites

The suites come from the Arasan test files (`wacnew.epd`, `ecmgcp.epd`, distributed in a repository under the MIT licence; the positions come from Reinfeld's *Win at Chess*, 1958, and the *Encyclopedia of Chess Middlegames*, Chess Informant, 1980), normalised into `bench/suites/` by
`node bench/tactics.mjs --normalize <dir>`. `parseMove` read every `bm` and `am`, so no position was dropped
(WAC 300/300, ECM 183/183). A position counts as solved when the move played is in `bm` and not in `am`.

| Suite | Limit | Solved |
|---|---|---|
| WAC | nodes 100,000 | 265/300 |
| WAC, first 50 | nodes 100,000 | **47/50** (the test asserts ≥ 46; the brief asked for 44) |
| WAC | nodes 200,000 | **280/300** (brief target ≥ 270) |
| WAC | depth 8 | 235/300 |
| WAC | movetime 1000 | **289/300** |
| ECM | nodes 200,000 | 63/183 |
| ECM | movetime 1000 | 87/183 |

WAC failures at 1 s: 002, 049, 055, 081, 141, 163, 196, 229, 230, 291, 293.

Many ECM failures are quiet sacrifices on the king, especially Bxh7+ (ECM 1185, 1590, 1592, 1597, 1602, 1606, 1610,
1618), and Nxh7, Rxh7 and Nxg7. SEE scores these as losing captures. The search reduces them and quiescence drops
them, so the engine finds them only when the eval's king-attack terms reward the follow-up early enough.

To reproduce:

```
node bench/tactics.mjs --suite wac --nodes 200000
node bench/tactics.mjs --suite wac --movetime 1000
node bench/tactics.mjs --suite ecm --nodes 200000 --verbose
```

Raise the test threshold in `test/search.test.cjs` as strength grows, and record the new numbers here.

## Speed bench, match bench and tuning

Measured 2026-11-01 on a 16-core machine with Node 24.16 and other jobs running next to these, so timed figures carry noise
(see each table). Everything here is self-play or a suite: there was no external reference engine, so none of it is an absolute
rating.

### Speed (`node bench/speed.mjs`, one thread, 16 MB hash, 1 s a position, tuned weights)

| Position | Depth / seldepth | Nodes | nps |
|---|---|---|---|
| start position | 13 / 25 | 445,441 | 445 k |
| Kiwipete | 13 / 25 | 536,577 | 537 k |
| Italian middlegame | 13 / 24 | 392,193 | 392 k |
| open middlegame | 15 / 28 | 370,688 | 370 k |
| rook endgame | 19 / 28 | 760,832 | 760 k |
| pawn endgame | 19 / 29 | 617,472 | 617 k |
| total | | 3,123,203 | **520 k** |

The machine was busier than in the earlier runs of this report (a quiet run gave 664 k for the same search). To compare the
weights, the hand-set and the tuned copies were run back to back twice: 469 k against 469 k, and 519 k against 519 k nps in
total. The tuned weights cost no speed. Perft 4 on Kiwipete counts 4,085,603 leaves (33 M/s under that load, 55 M/s quiet) and
`evaluate` runs at about 0.9 M calls/s under load, 1.27 M quiet.

### Tactics suites at fixed nodes, and at 1 s

`node bench/tactics.mjs --suite wac|ecm --nodes 200000` (exact, repeatable) and `--movetime 1000` (four runs at once on the
machine, about 400 to 500 k nps in each). Hand-set weights against the tuned ones:

| Suite | Limit | Hand-set | Tuned |
|---|---|---|---|
| WAC (300) | nodes 200,000 | 280 | 277 |
| ECM (183) | nodes 200,000 | 63 | 53 |
| WAC (300) | movetime 1000 | 286 | 288 |
| ECM (183) | movetime 1000 | 83 | 77 |

The 1 s columns are noisy: the same hand-set weights gave 71 and 83 on ECM in two runs, so read ECM at 1 s as ±10. The
fixed-node rows are the signal: the tuner fitted quiet-position outcomes of self-play games, not tactics, and ECM, whose
positions are quiet sacrifices on the king, loses ten of 183. `test/search.test.cjs` (WAC first 50 at 100,000 nodes) still
passes.

### Match bench (`node bench/match.mjs`)

Plays engine A against engine B from `bench/suites/openings.epd`: 160 positions of 4 to 8 plies from the named opening
lines (a 40,000-node search scores each |eval| < 60 cp), every one played twice with the colours reversed. Both sides get the
same budget. A game ends by the rules, or is adjudicated (a lead of 10 pawns for 6 plies by each engine's own score, a
dead-level stretch of 12 plies after ply 100, 400 plies). The output is W/D/L, the pentanomial of the pairs, Elo with a 95%
error bar and the SPRT state (the generalised SPRT on pair scores, alpha = beta = 0.05). The previous version is a plain copy
of `src/`, `bin/` and `data/` made before the weights changed; the new one is the same copy with the tuned `weights.js`.

Gate: new anchored weights (A) against the hand-set weights (B), SPRT elo0 = 0, elo1 = 5:

| Run | Budget | Games | W / D / L (new) | Elo of new against hand-set | SPRT |
|---|---|---|---|---|---|
| **anchored, installed** | 20,000 nodes a move, 8 games at once | 1,320 | 602 / 284 / 434 | **+44.5 ± 16.7** | accepted H1 (LLR 2.96) |
| anchored, sanity check | 20,000 nodes, no adjudication | 200 | 97 / 29 / 74 | +40.1 ± 46.8 | not a gate |
| candidate B, history (pawn free: mg 51) | 20,000 nodes | 1,280 | 576 / 292 / 412 | +44.8 ± 16.8 | accepted H1, replaced by the anchored run |
| candidate B, timed | 10+0.1 s | 400 | 173 / 116 / 111 | +54.3 ± 28.6 | not decided (LLR 1.28) |

Notes on how to read the gate:

- 1,026 of its 1,320 games (78%) ended by the 10-pawn adjudication, 139 more by the dead-level one, 11 by checkmate. The
  sanity run without adjudication (171 checkmates in 200 games) points the same way, with a wide bar.
- 660 pairs over 160 openings means every opening was played about four times. The node limit of a move is jittered by ±10%,
  but one jitter is drawn per pair (both games and both engines share it), so repeated openings differ only through that and
  the colours. The error bar and the SPRT treat pairs as independent; a handful of games repeat each other.
- Fixed nodes were used for the gate because 400 timed games at 10+0.1 cost 27 minutes and the SPRT needed about 1,300.
- An unconstrained candidate (term weights free to change sign) reached +65.8 ± 20.9 in 866 games; it was not taken because it
  turned the space term into a penalty and a doubled pawn into a bonus.

### Datagen and tuning

`node scripts/datagen.mjs` played 24,613 self-play games at 5,000 nodes a move on 8 threads in 60 minutes (White 9,870, draws
4,858, Black 9,885), each opened with 4 to 8 book moves and 2 to 4 random ones (a 3,000-node search must put the position
within 250 cp). It kept 2,000,721 quiet positions (not in check, best move not a capture, en passant or promotion, no mate
score, ply above 8), each with the result of its game, in `../stepchess-data/datagen/`. About 39,000 lines have an exact twin
elsewhere in the set (the same book line and random moves).

`node scripts/tune.mjs` computes each position's feature vector once (the trace tracer gives each term's value; a weight's
coefficient is the change of its term's value when the weight moves by 64, with the piece-square tables read off the board), fits
K, and runs Adam (600 steps, 0.5 cp a step falling to 5%) on the logistic loss over 967 weights. Blocks of consecutive games
(5% of the data) form a *selection set* that picks the best step; positions that also occur in training were removed from it
(3,365 of them), leaving 96,446. It is used to choose a step, so its loss is slightly optimistic and is not a fresh test; the
gate is the match.

| | Hand-set | Anchored, tuned |
|---|---|---|
| Logistic loss on the selection set (K fitted on the hand-set weights) | 0.4635 | 0.4602 |
| Same, hand-set weights anchored (pawn fixed, tables centred), before any step | | 0.4633 |
| Weights changed | | 890 of 1,201 |
| K that fits the static eval | 0.00695 | 0.00727 |
| K that fits the 5,000-node search scores | 0.00668 | |

The linear model the fit uses was checked against the real `trace().total` with the final rounded weights on 2,001 positions
spread over the data: off by 0.007 cp on average, 0.70 at most.

The scale is anchored to the pawn: material pawn is held at 82 (middlegame) and 94 (endgame), and after every step each
piece's square table is centred on zero, its mean moving into that piece's material (for a pawn, ranks 2 to 7, the mean is
simply removed, so the average pawn is worth its material). Material is now 82 / 313 / 346 / 462 / 1039 (middlegame) and
94 / 282 / 334 / 546 / 946 (endgame) for pawn to queen. A clean extra pawn in an ordinary middlegame reads about +0.9
(`r3k2r/p4ppp/8/8/8/8/PP3PPP/R3K2R`: +91, +97 with the hand-set weights); a pawn that has not left its home rank in the opening
is worth less, since the tables rate advanced pawns higher.

Held fixed: the endgame scale factors and the KBNK bonus (the self-play games cannot mate with bishop and knight, so those
positions were labelled draws; 3,925 positions with a KBNK or scaled term were left out), weights used by fewer than 500
positions, and the sign of every term weight (a bonus stays a bonus, a penalty a penalty, at least 1 in size; a weight that
starts at 0 stays 0) so the explanations still read right. Piece-square, mobility and material tables are free.

K stays at 0.00368208 in `weights.js` (ruling): the explanations' thresholds and the accuracy formula were calibrated on it over
an eval on the pawn scale. The refits above are for information; self-play at 5,000 nodes converts advantages more surely than
learners do, so the fitted K is steeper (the win chance at +100 cp would be 67% rather than 59%).

To reproduce: `node scripts/datagen.mjs --games 200000 --positions 2000000 --threads 8 --out ../stepchess-data/datagen/`, then
`node scripts/tune.mjs --data ../stepchess-data/datagen --start <the hand-set weights.js> --epochs 600 --lr 0.5 --reg 0.05 --min-support 500 --cache ../stepchess-data/tune/features.bin --keep-k --out <candidate.js>`
(about 25 minutes of features on 8 threads, 5 for the fit), then
`node bench/match.mjs --a <copy with the candidate> --b <copy with the hand-set weights> --nodes 20000 --games 3000 --concurrency 8 --sprt elo0=0,elo1=5`.
The hand-set weights are saved outside the repo as `../stepchess-data/tune/weights.before.js`.

### Strength

Only relative: the tuned engine beats its hand-set predecessor by 44.5 Elo (95%: 28 to 61) at 20,000 nodes a move in 1,320
self-play games. Absolute strength is not measured here: self-play Elo does not transfer to other engines, and the tactics
suites above (WAC 277/300 at 200,000 nodes, 288/300 at 1 s; ECM 53/183 at 200,000 nodes) test one skill. An estimate against a
named engine needs an external reference, which is the owner's call. The play-level calibration below was repeated with these
weights.

<!-- play-calibration:begin -->

## Human-like opponent calibration

Run on 2026-11-01 from `lichess_db_standard_rated_2014-01.pgn.zst` (Lichess standard rated games, January 2014): 500000 games scanned, 328548 usable (rated, not bullet, both ratings, at least 24 plies).
Players were bucketed to the nearest anchor within ±100 rating points; up to 200 games and 2 positions per game and bucket (the player to move, ply 12 or later, best move within ±1000 cp).
The engine measured every move at 50,000 nodes; the loss is the win chance of the best move minus that of the move played (blunder: more than 20 %, mistake: 10 % or more, inaccuracy: 5 % or more).
The fit started from the hand-set anchors (HAND_SET in levels.js) and moved `nodes`, `temperature` and `blunder.base` of each level by a coordinate search (at most 14 bot evaluations per level, the bot playing the sampled positions); the blind spots stay as set.

| Anchor | Games | Positions | People: mean loss % | ≥ 5 % | ≥ 10 % | > 20 % | Bot: mean loss % | ≥ 5 % | ≥ 10 % | > 20 % | Evals | Result |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 400 | 0 | 0 | — | — | — | — | — | — | — | — | 0 | no data: hand-set anchor kept |
| 800 | 200 | 334 | 6.4 | 33.5 | 19.2 | 10.2 | 6.3 | 34.1 | 18.6 | 10.5 | 14 | fitted |
| 1200 | 200 | 307 | 6.1 | 30.6 | 19.5 | 11.7 | 5.4 | 32.6 | 16.6 | 7.2 | 14 | fitted |
| 1600 | 200 | 362 | 3.5 | 22.4 | 9.4 | 1.9 | 3.6 | 21.8 | 9.7 | 3.0 | 14 | fitted |
| 2000 | 200 | 378 | 3.2 | 18.5 | 7.4 | 3.4 | 3.8 | 23.5 | 9.8 | 4.8 | 14 | fitted |
| 2400 | 93 | 178 | 2.2 | 12.4 | 4.5 | 2.8 | 2.7 | 14.0 | 5.6 | 2.8 | 14 | fitted |
| 2800 | 1 | 0 | — | — | — | — | — | — | — | — | 0 | no data: hand-set anchor kept |

Blunder and mistake rates by phase (people → bot, %; positions in brackets):

| Anchor | Opening mistake | Opening blunder | Middlegame mistake | Middlegame blunder | Endgame mistake | Endgame blunder |
|---|---|---|---|---|---|---|
| 800 | 19.1 → 18.0 (89) | 11.2 → 14.6 (89) | 20.4 → 19.5 (226) | 10.2 → 9.3 (226) | 5.3 → 10.5 (19) | 5.3 → 5.3 (19) |
| 1200 | 23.2 → 12.2 (82) | 12.2 → 3.7 (82) | 19.2 → 19.2 (193) | 12.4 → 8.8 (193) | 12.5 → 12.5 (32) | 6.3 → 6.3 (32) |
| 1600 | 6.0 → 3.6 (83) | 0.0 → 0.0 (83) | 11.7 → 12.1 (239) | 2.9 → 4.6 (239) | 2.5 → 7.5 (40) | 0.0 → 0.0 (40) |
| 2000 | 3.2 → 6.3 (63) | 1.6 → 3.2 (63) | 9.3 → 11.2 (268) | 4.1 → 4.9 (268) | 2.1 → 6.4 (47) | 2.1 → 6.4 (47) |
| 2400 | 0.0 → 2.6 (39) | 0.0 → 0.0 (39) | 5.9 → 6.8 (118) | 3.4 → 4.2 (118) | 4.8 → 4.8 (21) | 4.8 → 0.0 (21) |

The ladder written to `src/play/levels.js` (monotone along the anchors):

| Anchor | Nodes | Temperature | Candidates | Blind: backward / diagonal / quiet / threat depth | Blunder: base / complexity |
|---|---|---|---|---|---|
| 400 | 300 | 250 | 6 | 0.5 / 0.5 / 0.6 / 1 | 0.25 / 0.03 |
| 800 | 1,600 | 162.3 | 6 | 0.35 / 0.35 / 0.45 / 1 | 0.24 / 0.02 |
| 1200 | 4,600 | 138 | 5 | 0.2 / 0.2 / 0.3 / 2 | 0.081 / 0.015 |
| 1600 | 11,000 | 60 | 5 | 0.1 / 0.1 / 0.18 / 3 | 0.071 / 0.01 |
| 2000 | 15,000 | 35 | 4 | 0.05 / 0.05 / 0.08 / 4 | 0.061 / 0.006 |
| 2400 | 21,000 | 9.1 | 4 | 0.01 / 0.01 / 0.02 / 6 | 0.051 / 0.002 |
| 2800 | 30,000 | 5 | 3 | 0 / 0 / 0 / 10 | 0 / 0 |

Plateaus and pooled anchors: the fits of neighbouring anchors cannot be told apart by the games (about 3 % loss per move at 1600-2400), so the monotone pass pools them. Equal parameters would mean equal strength, so every anchor is then made to differ from the one below by at least a factor 1.4 in nodes, 0.85 in temperature and 0.01 in blunder.base, and the ladder is measured:

- 800: pooled with its neighbours by the monotone pass (temperature 160 -> 162.3).
- 800: moved by the separation steps and the check below (nodes 1600 -> 1600, temperature 162.3 -> 162.3, blunder.base 0.25 -> 0.24).
- 1200: pooled with its neighbours by the monotone pass (temperature 164.9 -> 162.3, blunder.base 0.08 -> 0.081).
- 1200: moved by the separation steps and the check below (nodes 4600 -> 4600, temperature 162.3 -> 138, blunder.base 0.081 -> 0.081).
- 1600: pooled with its neighbours by the monotone pass (nodes 17000 -> 11000, blunder.base 0.04 -> 0.081).
- 1600: moved by the separation steps and the check below (nodes 11000 -> 11000, temperature 60 -> 60, blunder.base 0.081 -> 0.071).
- 2000: pooled with its neighbours by the monotone pass (nodes 12000 -> 11000, blunder.base 0.12 -> 0.081).
- 2000: moved by the separation steps and the check below (nodes 11000 -> 15000, temperature 35 -> 35, blunder.base 0.081 -> 0.061).
- 2400: pooled with its neighbours by the monotone pass (nodes 3800 -> 11000).
- 2400: moved by the separation steps and the check below (nodes 11000 -> 21000, temperature 9.1 -> 9.1, blunder.base 0.055 -> 0.051).
- 400: no usable games, so the hand-set anchor is kept (separation steps may apply).
- 2800: no usable games, so the hand-set anchor is kept (separation steps may apply).

The ladder measured on 223 shared positions (the same moves for every anchor, 50,000-node judge; 0 strengthening rounds were needed):

| Anchor | Mean loss % | ≥ 5 % | ≥ 10 % | > 20 % |
|---|---|---|---|---|
| 400 | 7.9 | 39.0 | 24.7 | 12.6 |
| 800 | 6.4 | 34.1 | 20.6 | 7.6 |
| 1200 | 4.9 | 30.5 | 13.9 | 4.9 |
| 1600 | 3.6 | 22.0 | 9.9 | 3.1 |
| 2000 | 2.5 | 13.0 | 6.3 | 2.7 |
| 2400 | 1.8 | 10.3 | 5.8 | 1.3 |
| 2800 | 0.6 | 1.8 | 0.4 | 0.4 |

To reproduce: `node scripts/calibrate.mjs <pgn.zst> --per-level 200 --moves 2 --nodes 50000` (add `--dry` to leave the files alone).

<!-- play-calibration:end -->
