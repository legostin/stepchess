// explain/motifs/registry — the dictionary of motifs: every key with its kind, and its name, definition and sentence as messages.
//
// The same dictionary serves the explanations, the hints and a course that wants tags and a glossary: a key is stable,
// its words live in i18n/{ru,en}/explain.js under explain.motif.<key>.{name, about, say}.
import { msg, Msg, inLanguage } from '../../i18n/index.js';

const TACTICS = [
    'fork',
    'pin-absolute',
    'pin-relative',
    'skewer',
    'discovered-attack',
    'double-check',
    'deflection',
    'decoy',
    'overloading',
    'remove-defender',
    'interference',
    'x-ray',
    'zwischenzug',
    'desperado',
    'trapped-piece',
    'hanging-piece',
    'back-rank-weakness',
    'clearance',
    'promotion',
    'underpromotion',
    'sacrifice',
];
const MATES = [
    'mate-back-rank',
    'mate-smothered',
    'mate-anastasia',
    'mate-arabian',
    'mate-boden',
    'mate-legal',
    'mate-epaulette',
    'mate-greco',
    'mate-damiano',
    'mate-ladder',
    'mate-corridor',
];
const POSITIONAL = [
    'outpost',
    'weak-square',
    'open-file',
    'isolated-pawn',
    'passed-pawn-created',
    'minority-attack',
    'pawn-break',
    'prophylaxis',
    'piece-improvement',
    'king-activation',
    'opposition',
    'triangulation',
    'zugzwang',
    'fortress',
];

/**
 * The motifs in a fixed order: tactics, mating patterns, positional motifs.
 * @type {ReadonlyArray<Readonly<{key: string, kind: 'tactic' | 'mate' | 'positional'}>>}
 */
export const MOTIFS = Object.freeze([
    ...TACTICS.map((key) => Object.freeze({ key, kind: 'tactic' })),
    ...MATES.map((key) => Object.freeze({ key, kind: 'mate' })),
    ...POSITIONAL.map((key) => Object.freeze({ key, kind: 'positional' })),
]);

const KIND = new Map(MOTIFS.map((m) => [m.key, m.kind]));
/** The kind of a motif key: 'tactic', 'mate' or 'positional' (undefined for an unknown key). */
export const kindOf = (key) => KIND.get(key);

/** The name of a motif (a Msg), e.g. "Fork". */
export const motifName = (key) => msg(`explain.motif.${key}.name`);
/** What a motif is, in a sentence or two (a Msg). */
export const motifAbout = (key) => msg(`explain.motif.${key}.about`);

const LETTERS = ['', 'p', 'n', 'b', 'r', 'q', 'k'];
const PIECE_WORD = /^explain\.piece\.([pnbrqk])$/;

// the piece letter of a word: a piece code, or a piece word made from explain.piece.<letter> (null for anything else)
function letterOf(w) {
    if (Number.isInteger(w)) return LETTERS[w & 7] || null;
    if (w instanceof Msg) return PIECE_WORD.exec(w.key)?.[1] ?? null;
    return null;
}

// a word in a grammatical case of the language: a piece by its own declined form (with its article where the
// language has one), anything else as it is
function inCase(w, c, lang) {
    const letter = letterOf(w);
    return letter ? msg(`explain.motif.word.${c}.${letter}`).in(lang) : inLanguage(w, lang);
}

// a list of words in a case, joined the way the language joins a list ("the king and the rook", or in the accusative of Russian)
// pieces of one kind are said together ("both rooks", "3 pawns"), at the place of the first of them
function listIn(words, c, lang) {
    const groups = [];
    for (const w of words) {
        const letter = letterOf(w);
        const same = letter && groups.find((g) => g.letter === letter);
        if (same) same.n++;
        else groups.push({ letter, w, n: 1 });
    }
    const say = (g) => (g.n === 1 ? inCase(g.w, c, lang) : msg(`explain.motif.word.${g.n === 2 ? 'both' : 'many'}.${c}.${g.letter}`, { n: g.n }).in(lang));
    const items = groups.map(say).filter((x) => x !== '');
    try {
        return new Intl.ListFormat(lang, { type: 'conjunction' }).format(items);
    } catch {
        return items.join(', ');
    }
}

const capital = (text, lang) => (text ? text.charAt(0).toLocaleUpperCase(lang) + text.slice(1) : text);
const asList = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v]);

/**
 * The motif said about a move (a Msg). words: piece (the piece that carries the motif), square (its key square) and
 * targets (what it is aimed at, a list). A piece may be given as a piece code or as a piece word (explain.piece.*); the
 * sentence then declines it itself. The templates choose the form through their slots: piece and Piece (capitalised)
 * in the nominative, piece_acc; targets, targets_acc, targets_gen as a list; first/second (and _acc) for the first
 * two targets one by one; square as given.
 * @param {string} key
 * @param {{piece?: unknown, square?: unknown, targets?: unknown}} [words]
 */
export function motifSay(key, words = {}) {
    const w = words ?? {};
    const targets = asList(w.targets);
    const one = (i, c) => (lang) => (targets[i] === undefined ? '' : inCase(targets[i], c, lang));
    return msg(`explain.motif.${key}.say`, {
        piece: (lang) => inCase(w.piece, 'nom', lang),
        Piece: (lang) => capital(inCase(w.piece, 'nom', lang), lang),
        piece_acc: (lang) => inCase(w.piece, 'acc', lang),
        square: w.square ?? '',
        targets: (lang) => listIn(targets, 'nom', lang),
        targets_acc: (lang) => listIn(targets, 'acc', lang),
        targets_gen: (lang) => listIn(targets, 'gen', lang),
        first: one(0, 'nom'),
        first_acc: one(0, 'acc'),
        second: one(1, 'nom'),
        second_acc: one(1, 'acc'),
    });
}
