// i18n: complete catalogs, keys that exist, messages that are used, no words in the code, and a new language without code changes.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let I;
let RU;
let EN;
before(async () => {
    I = await import('../src/i18n/index.js');
    RU = (await import('../src/i18n/ru/index.js')).default;
    EN = (await import('../src/i18n/en/index.js')).default;
});

const DOMAINS = ['core', 'client', 'eval', 'search', 'explain', 'play', 'puzzles', 'endgame', 'api', 'board', 'openings'];
// messages that only a test uses (empty once the first real module speaks)
const ALLOWED_UNUSED = [];

const flatten = (o, prefix = '', out = new Map()) => {
    for (const [k, v] of Object.entries(o)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
        else out.set(key, v);
    }
    return out;
};
const slots = (tpl) => new Set([...String(tpl).matchAll(/%\{(\w+)(?:\|[^}]*)?\}/g)].map((m) => m[1]));
const ROOT = path.join(__dirname, '..');

// the .js files under a directory of the repo; the catalogs (src/i18n) are left out when asked
const sourceFiles = (dir, { skipI18n = false } = {}) => {
    const out = [];
    const walk = (d) => {
        if (!fs.existsSync(d)) return;
        fs.readdirSync(d).forEach((f) => {
            const p = path.join(d, f);
            if (fs.statSync(p).isDirectory()) {
                if (!(skipI18n && f === 'i18n')) walk(p);
            } else if (p.endsWith('.js')) out.push(p);
        });
    };
    walk(path.join(ROOT, dir));
    return out;
};
const read = (files) => files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
// the code that names messages: src/ and board/, without the catalogs
const code = () => read([...sourceFiles('src', { skipI18n: true }), ...sourceFiles('board')]);

test('the catalogs hold the domains of the engine', () => {
    for (const cat of [RU, EN]) {
        assert.deepEqual(
            Object.keys(cat)
                .filter((k) => k !== 'i18n')
                .sort(),
            [...DOMAINS].sort(),
        );
        assert.ok(cat.i18n.value);
    }
});

test('every message exists in every built-in language, with the same slots', () => {
    const ru = flatten(RU);
    const en = flatten(EN);
    const onlyRu = [...ru.keys()].filter((k) => !en.has(k));
    const onlyEn = [...en.keys()].filter((k) => !ru.has(k));
    assert.deepEqual(onlyRu, [], 'keys missing in English');
    assert.deepEqual(onlyEn, [], 'keys missing in Russian');
    for (const [k, r] of ru) {
        const e = en.get(k);
        if (typeof r !== 'string' || typeof e !== 'string') continue;
        // a language may leave a parameter out, but two languages must not each use a parameter the other lacks:
        // that means the code passes language-specific values instead of neutral ones
        const [a, b] = [slots(r), slots(e)];
        const onlyA = [...a].filter((x) => !b.has(x));
        const onlyB = [...b].filter((x) => !a.has(x));
        assert.ok(!(onlyA.length && onlyB.length), `slots of ${k}: ${onlyA} vs ${onlyB}`);
    }
});

test('every key is <domain>.<module>.<name>', () => {
    const bad = [...flatten(RU).keys()].filter((k) => !k.startsWith('i18n.') && (k.split('.').length < 3 || !DOMAINS.includes(k.split('.')[0])));
    assert.deepEqual(bad, []);
});

test('every msg(…) the code writes exists, and every message is used', () => {
    const text = code();
    const ru = flatten(RU);
    // a key is used when the code names it: msg('key', …) or a key chosen by a condition, msg(c ? 'a' : 'b')
    const named = new Set([...text.matchAll(new RegExp(`'((?:${DOMAINS.join('|')})\\.[\\w.-]+)'`, 'g'))].map((m) => m[1]));
    const literal = [...text.matchAll(/\bmsg\(\s*'([\w.-]+)'/g)].map((m) => m[1]);
    const prefixes = [...text.matchAll(/msg\(`([\w.-]+)\.\$\{/g)].map((m) => `${m[1]}.`);
    const missing = [...new Set([...literal, ...named])].filter((k) => !ru.has(k));
    assert.deepEqual(missing, [], 'keys used in the code but absent from the catalogs');
    const unused = [...ru.keys()].filter(
        (k) => !k.startsWith('i18n.') && !ALLOWED_UNUSED.includes(k) && !named.has(k) && !prefixes.some((p) => k.startsWith(p)),
    );
    assert.deepEqual(unused, [], 'messages nobody uses');
});

test('the allow-list holds only messages that exist', () => {
    const ru = flatten(RU);
    assert.deepEqual(
        ALLOWED_UNUSED.filter((k) => !ru.has(k)),
        [],
    );
});

test('no Cyrillic in src/ outside src/i18n/ru/, and none in board/', () => {
    const ruDir = path.join(ROOT, 'src', 'i18n', 'ru');
    const bad = [...sourceFiles('src'), ...sourceFiles('board')].filter(
        (f) => !f.startsWith(ruDir + path.sep) && /[А-Яа-яЁё]/.test(fs.readFileSync(f, 'utf8')),
    );
    assert.deepEqual(
        bad.map((f) => path.relative(ROOT, f)),
        [],
    );
});

test('no language code is compared in the code', () => {
    const stripped = code()
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/===\s*'ru'|'ru'\s*===|===\s*'en'|'en'\s*===/.test(stripped), 'a comparison with a language code');
    const pairs = stripped.match(/\(\s*ru\s*,\s*en\b[^)]*\)|\{\s*ru\s*[:,][^}]*\}/g) ?? [];
    assert.deepEqual(pairs, [], 'a value written per language in the code');
});

// a real message with a slot: the number of fields a FEN was given
const FIELDS = 'core.fen.fields';
const fieldsEn = (count) => EN.core.fen.fields.replace('%{count}', count);

test('a message localizes to a string', () => {
    const m = I.msg(FIELDS, { count: 3 });
    assert.equal(typeof I.localize(m, 'en'), 'string');
    assert.equal(I.localize(m, 'en'), fieldsEn(3));
    assert.ok(m.en.includes('3') && m.ru.includes('3'), 'the slot is filled in every language');
    assert.equal(I.localize(m, 'ru'), m.ru);
    assert.notEqual(m.en, m.ru);
});

test('messages render lazily, stringify in the default language and serialise in every language', () => {
    const m = I.msg(FIELDS, { count: 2 });
    assert.equal(I.DEFAULT_LANGUAGE, 'ru');
    assert.equal(`${m}`, m.ru);
    assert.deepEqual(JSON.parse(JSON.stringify(m)), { ru: m.ru, en: m.en });
    assert.equal(I.msg('core.test.absent').en, 'core.test.absent', 'a missing message shows its key');
});

test('localize renders the messages of a tree, the value held twice in both places, and keeps cycles', () => {
    const shared = I.msg(FIELDS, { count: 1 });
    const hello = fieldsEn(1);
    const tree = { title: shared, list: [shared, 'plain', 3], nested: { text: { ru: 'р', en: 'e' } }, verbatim: I.verbatim('Nf3') };
    const en = I.localize(tree, 'en');
    assert.equal(en.title, hello);
    assert.deepEqual(en.list, [hello, 'plain', 3]);
    assert.equal(en.nested.text, 'e');
    assert.equal(en.verbatim, 'Nf3');
    assert.equal(I.localize(tree, 'ru').verbatim, 'Nf3');
    const loop = { title: shared };
    loop.self = loop;
    const out = I.localize(loop, 'en');
    assert.equal(out.title, hello);
    assert.equal(out.self, out);
    assert.equal(I.localize(null, 'en'), null);
});

test('parameters, plural slots and function templates follow the rules of each language', () => {
    I.registerLanguage('ru', { core: { test: { moves: '%{n} %{n|ход|хода|ходов}', side: (p, lang, t) => `${t(p.who)}!` } } });
    I.registerLanguage('en', { core: { test: { moves: '%{n} %{n|move|moves}', side: (p, lang, t) => `${t(p.who)}!` } } });
    const n = (k) => I.msg('core.test.moves', { n: k });
    assert.deepEqual(
        [1, 2, 5, 11, 21, 22].map((k) => n(k).ru),
        ['1 ход', '2 хода', '5 ходов', '11 ходов', '21 ход', '22 хода'],
    );
    assert.deepEqual(
        [1, 2, 21].map((k) => n(k).en),
        ['1 move', '2 moves', '21 moves'],
    );
    // a parameter may be a message, a {lang: text} object or a function of the language
    assert.equal(I.msg('core.test.side', { who: I.msg(FIELDS, { count: 7 }) }).en, `${fieldsEn(7)}!`);
    assert.equal(I.msg('core.test.side', { who: { ru: 'белые', en: 'White' } }).ru, 'белые!');
    assert.equal(I.msg('core.test.side', { who: (lang) => `<${lang}>` }).en, '<en>!');
});

test('a third language joins with one call: its own words, the rest from its base', () => {
    I.registerLanguage('ru', { core: { test: { moves: '%{n} %{n|ход|хода|ходов}' } } });
    I.registerLanguage('xx', { core: { fen: { fields: 'XX %{count}' } } }, { base: 'ru' });
    assert.ok(I.LANGUAGES.includes('xx'));
    assert.equal(I.msg(FIELDS, { count: 4 }).xx, 'XX 4');
    assert.equal(I.msg('core.fen.kings', { white: 0, black: 1 }).xx, I.msg('core.fen.kings', { white: 0, black: 1 }).ru, 'the rest comes from the base');
    assert.equal(I.msg('core.test.moves', { n: 1 }).in('xx'), '1 ход', 'a missing message comes from the base language');
    assert.deepEqual(
        I.eachLanguage((l) => l, { compact: false }),
        { ru: 'ru', en: 'en', xx: 'xx' },
    );
    assert.equal(
        I.eachLanguage(() => 'same'),
        'same',
    );
    assert.equal(I.resolveLanguage('zz'), 'ru');
    assert.equal(I.resolveLanguage('xx'), 'xx');
    assert.equal(I.localize(I.verbatim('e4'), 'xx'), 'e4');
});
