// i18n — every word the engine says, in any number of languages.
//
// Code holds no text. It names a message by key and passes parameters:
//
//   msg('explain.motifs.fork')                              a message without parameters
//   msg('explain.move.loses', { moves, piece })             '%{moves} %{moves|move|moves} ...'
//   msg('explain.move.best', { san: (lng) => render(lng) }) a parameter that depends on the language
//
// A message renders in a language on demand — msg.ru, msg.en, msg.in('kk'), `${msg}` (the default language) — so a
// result stays language-neutral until someone reads it. Templates live in i18n/<lang>/<domain>.js; each is a string
// with slots %{name}, plural slots %{name|one|few|many} (forms in the order of Intl.PluralRules categories of the
// language: ru one|few|many, en one|other), or a function (params, lang, render) => string for grammar a slot cannot
// express. Parameters: strings, numbers, bigints, messages, {ru, en, …} objects, arrays (joined with ', '), or
// functions of the language returning any of these.
//
// A language is registered with its catalog and, optionally, a base language whose templates fill its gaps:
//   registerLanguage('kk', kkCatalog, { base: 'ru' })
// Every message then gains a .kk getter, and everything that renders per language renders in kk too.

import ruCatalog from './ru/index.js';
import enCatalog from './en/index.js';

/**
 * A text as results carry it: a message, a string that reads the same in every language, or {lang: text}.
 * @typedef {Msg | string | Record<string, string>} Text
 */

const catalogs = new Map(); // lang → flat Map(key → template)
const bases = new Map(); // lang → base lang
/** @type {string[]} */
export const LANGUAGES = [];
export const DEFAULT_LANGUAGE = 'ru';

/** Flatten nested catalog objects into dotted keys: {explain: {move: {best: '…'}}} → 'explain.move.best'. */
function flatten(obj, prefix = '', out = new Map()) {
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
        else out.set(key, v);
    }
    return out;
}

/**
 * Register (or extend) a language: its catalog of templates and the base language that fills its gaps.
 * @param {string} lang
 * @param {Record<string, unknown>} catalog nested objects of templates (strings or functions), as in i18n/en
 * @param {{base?: string}} [opts]
 * @returns {void}
 */
export function registerLanguage(lang, catalog, opts = {}) {
    const flat = catalogs.get(lang) ?? new Map();
    for (const [k, v] of flatten(catalog)) flat.set(k, v);
    catalogs.set(lang, flat);
    if (opts.base) bases.set(lang, opts.base);
    if (!LANGUAGES.includes(lang)) {
        LANGUAGES.push(lang);
        Object.defineProperty(Msg.prototype, lang, {
            get() {
                return this.in(lang);
            },
            configurable: true,
        });
    }
}

// the template for a key: the language, its base languages, then English, then Russian
function lookup(key, lang) {
    const seen = new Set();
    for (let l = lang; l && !seen.has(l); l = bases.get(l)) {
        seen.add(l);
        const tpl = catalogs.get(l)?.get(key);
        if (tpl !== undefined) return tpl;
    }
    for (const l of ['en', DEFAULT_LANGUAGE]) {
        const tpl = catalogs.get(l)?.get(key);
        if (tpl !== undefined) return tpl;
    }
    return undefined;
}

/**
 * The language if it is registered, else the default one.
 * @param {unknown} lang
 * @returns {string}
 */
export function resolveLanguage(lang) {
    return LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;
}

/**
 * A value in a language: messages render, functions of the language are called, arrays are joined.
 * @param {unknown} value
 * @param {string} lang
 * @returns {string}
 */
export function inLanguage(value, lang) {
    if (value == null) return '';
    if (value instanceof Msg) return value.in(lang);
    if (value instanceof PerLang) return inLanguage(raw(value, lang), lang);
    if (typeof value === 'function') return inLanguage(value(lang), lang);
    if (Array.isArray(value)) return value.map((v) => inLanguage(v, lang)).join(', ');
    if (typeof value === 'object') {
        if (lang in value) return inLanguage(value[lang], lang);
        const b = bases.get(lang);
        if (b && b in value) return inLanguage(value[b], lang);
        if ('en' in value) return inLanguage(value.en, lang);
        if (DEFAULT_LANGUAGE in value) return inLanguage(value[DEFAULT_LANGUAGE], lang);
    }
    return String(value);
}

const pluralRules = new Map();
function pluralForm(lang, n, forms) {
    let rules = pluralRules.get(lang);
    if (!rules) {
        try {
            rules = new Intl.PluralRules(lang);
        } catch {
            rules = new Intl.PluralRules('en');
        }
        pluralRules.set(lang, rules);
    }
    const order = rules.resolvedOptions().pluralCategories.filter((c) => ['one', 'two', 'few', 'many', 'other'].includes(c));
    const sorted = ['one', 'two', 'few', 'many', 'other'].filter((c) => order.includes(c));
    const cat = rules.select(Number(n));
    const i = sorted.indexOf(cat);
    return forms[Math.min(i < 0 ? forms.length - 1 : i, forms.length - 1)];
}

const SLOT = /%\{(\w+)(?:\|([^}]*))?\}/g;

// a parameter that depends on the language, computed for every registered language when the message is made
// (so that it sees the variables as they are now, not as they will be when someone reads the text)
class PerLang {
    constructor(fn) {
        for (const l of LANGUAGES) this[l] = fn(l);
        Object.freeze(this);
    }
}
const raw = (v, lang) => (v instanceof PerLang ? (lang in v ? v[lang] : (v[bases.get(lang)] ?? v.en ?? v[DEFAULT_LANGUAGE])) : v);

// A message: a key and its parameters, rendered per language on demand. The class is bound to a const and exported
// through the typed Msg below, so that its type carries the getters registerLanguage defines (msg.ru, msg.en, msg.kk).
const MsgClass = class Msg {
    /**
     * @param {string} key
     * @param {Record<string, unknown> | null} [params]
     */
    constructor(key, params = null) {
        this.key = key;
        if (params) {
            const p = {};
            for (const [k, v] of Object.entries(params)) p[k] = typeof v === 'function' ? new PerLang(v) : v;
            /** @type {Readonly<Record<string, unknown>> | null} */
            this.params = Object.freeze(p);
        } else this.params = null;
        Object.freeze(this);
    }

    /**
     * The text in a language.
     * @param {string} [lang]
     * @returns {string}
     */
    in(lang = DEFAULT_LANGUAGE) {
        const tpl = lookup(this.key, lang);
        if (tpl === undefined) return this.key;
        const p = this.params ?? {};
        if (typeof tpl === 'function') {
            const resolved = {};
            for (const [k, v] of Object.entries(p)) resolved[k] = raw(v, lang);
            return tpl(resolved, lang, (v) => inLanguage(v, lang));
        }
        return tpl.replace(SLOT, (m, name, forms) => {
            const v = raw(p[name], lang);
            return forms !== undefined ? pluralForm(lang, v, forms.split('|')) : inLanguage(v, lang);
        });
    }

    /** @returns {string} */
    toString() {
        return this.in(DEFAULT_LANGUAGE);
    }

    /**
     * JSON: the text in every registered language.
     * @returns {Record<string, string>}
     */
    toJSON() {
        return Object.fromEntries(LANGUAGES.map((l) => [l, this.in(l)]));
    }
};

/**
 * A message: a key and its parameters, rendered per language on demand. msg.ru and msg.en are its text in Russian and
 * English; a language added with registerLanguage reads as msg.in('kk') (or msg.kk, typed unknown: the type cannot know
 * which languages a program registers).
 * @typedef {InstanceType<typeof MsgClass> & {readonly ru: string, readonly en: string, readonly [lang: string]: unknown}} Msg
 */

/** @type {{new (key: string, params?: Record<string, unknown> | null): Msg, prototype: Msg}} */
export const Msg = MsgClass;

/**
 * A message by key with its parameters.
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {Msg}
 */
export function msg(key, params) {
    return new Msg(key, params ?? null);
}

/**
 * A value computed per language (a text that differs between languages, joined messages, …) as a message.
 * @param {(lang: string) => unknown} fn
 * @returns {Msg}
 */
export function perLanguage(fn) {
    return msg('i18n.value', { value: fn });
}

/**
 * A text that reads the same in every language (a move in SAN, a FEN, a square name) as a message.
 * @param {unknown} text
 * @returns {Msg}
 */
export function verbatim(text) {
    return msg('i18n.value', { value: String(text) });
}

/**
 * fn(lang) for every registered language: {ru: …, en: …, …}; with compact (the default) a plain value when every
 * language gives the same one. Values are computed now.
 * @template T
 * @param {(lang: string) => T} fn
 * @param {{compact?: boolean}} [opts]
 * @returns {T | Record<string, T>}
 */
export function eachLanguage(fn, { compact = true } = {}) {
    const values = LANGUAGES.map((l) => fn(l));
    if (compact && values.every((v) => v === values[0])) return values[0];
    return Object.fromEntries(LANGUAGES.map((l, i) => [l, values[i]]));
}

/**
 * Messages (or strings, {lang: …} objects) joined with a separator, as one message in every language.
 * @param {unknown[]} list
 * @param {string} [sep]
 * @returns {Msg}
 */
export function joined(list, sep = ' ') {
    return perLanguage((lang) => list.map((x) => inLanguage(x, lang)).join(sep));
}

/**
 * Do two texts read the same in every registered language?
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function sameText(a, b) {
    return LANGUAGES.every((l) => inLanguage(a, l) === inLanguage(b, l));
}

/**
 * Any bilingual value → a plain {lang: text} object for every registered language.
 * @param {unknown} value
 * @returns {Record<string, string>}
 */
export function allLanguages(value) {
    return Object.fromEntries(LANGUAGES.map((l) => [l, inLanguage(value, l)]));
}

/**
 * A result tree as localize returns it: every Msg a string, the rest as it was. ({ru, en, …} objects become strings
 * too, which the type cannot tell from other objects.)
 * @template T
 * @typedef {T extends Msg ? string : T extends (...args: never[]) => unknown ? T : T extends readonly (infer U)[] ? Localized<U>[] :
 *   T extends object ? {[K in keyof T]: Localized<T[K]>} : T} Localized
 */

/**
 * Replace every message (and {ru, en, …} value) in a result tree with its text in one language.
 * @template T
 * @param {T} value
 * @param {string} [lang]
 * @param {WeakMap<object, unknown>} [done] the values already rendered (for a tree that holds one twice)
 * @returns {Localized<T>}
 */
export function localize(value, lang = DEFAULT_LANGUAGE, done = new WeakMap()) {
    if (value == null || typeof value !== 'object') return value;
    if (value instanceof Msg) return value.in(lang);
    // a value the tree holds twice is rendered once and reused; a cycle stays a cycle
    if (done.has(value)) return done.get(value);
    if (Array.isArray(value)) {
        const out = [];
        done.set(value, out);
        for (const v of value) out.push(localize(v, lang, done));
        return out;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) return value; // class instances keep their own form
    const keys = Object.keys(value);
    if (keys.length && keys.every((k) => LANGUAGES.includes(k))) return inLanguage(value, lang);
    const out = {};
    done.set(value, out);
    for (const k of keys) out[k] = localize(value[k], lang, done);
    return out;
}

registerLanguage('ru', ruCatalog);
registerLanguage('en', enCatalog);
