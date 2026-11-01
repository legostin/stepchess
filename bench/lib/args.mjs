// bench/lib/args — a small command-line parser for the bench and tuning scripts: --name value, --name=value and bare --flag.

/**
 * Parse argv into {name: value}; a flag without a value is true, and a value stays a string (the caller converts with num()).
 * Positional words are collected under `_`.
 * @param {string[]} argv
 * @returns {Record<string, any>}
 */
export function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) {
            out._.push(a);
            continue;
        }
        const eq = a.indexOf('=');
        if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
        else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
        else out[a.slice(2)] = true;
    }
    return out;
}

/** A number option with a default; exits with a message when the text is not a number. */
export function num(args, name, fallback) {
    const v = args[name];
    if (v === undefined || v === true) return fallback;
    const n = Number(v);
    if (!Number.isFinite(n)) {
        console.error(`--${name}: "${v}" is not a number`);
        process.exit(2);
    }
    return n;
}

/** A string option with a default. */
export const str = (args, name, fallback) => (typeof args[name] === 'string' ? args[name] : fallback);
