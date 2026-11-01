// eval — the explainable evaluation: the score, its trace by named terms, the weights and the win chance.
export { TERMS, T, termName, termAbout, flattenWeights, unflattenWeights, weightsModule } from './params.js';
export { W } from './weights.js';
export { FastTracer, TraceTracer } from './tracer.js';
export { evaluate, trace, setWeights, clearPawnHash } from './evaluate.js';
export { winChance, winChanceWhite } from './win.js';
