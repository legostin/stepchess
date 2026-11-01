// explain — the explanations: the motifs of a move and its line, the dictionary of motifs, move classes, annotations, explainMove, reviewGame and hint.
export { detectMotifs } from './detect.js';
export { MOTIFS, kindOf, motifName, motifAbout, motifSay } from './motifs/registry.js';
export { CLASS_THRESHOLDS, CLASSES, CLASS_GLYPHS, EXPLAIN_LEVELS, classify, moveAccuracy } from './classify.js';
export { ANNOTATION_KINDS, BADGE_GLYPHS, noAnnotations, mergeAnnotations } from './annotations.js';
export { explainMove, EXPLAIN_NODES, EXPLAIN_MAX_NODES, explainNodes } from './move.js';
export { reviewGame } from './review.js';
export { hint } from './hint.js';
