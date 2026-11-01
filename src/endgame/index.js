// endgame — tablebases of up to four pieces: material keys, the index, retrograde generation, loading and probing.
export { MAX_PIECES, DRAW, MATED, ILLEGAL, materialKey, keyInfo, tbIndex, tbSize, tbDependencies, decodeValue } from './tb-index.js';
export { tablebase, probe, bestTbMoves, loadTable, hasTable, getTable, preloadTables, generateTable } from './tb.js';
export { openingName, openings } from './openings.js';
export { bookMoves } from './book.js';
