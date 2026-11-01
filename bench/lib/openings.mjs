// bench/lib/openings — the opening positions of the match bench: load bench/suites/openings.epd, or rebuild it from the named lines.
//
//   node bench/lib/openings.mjs --build [--count 160] [--nodes 40000] [--limit 60]
//
// The file holds one position a line: `<fen>; ce <cp for the side to move>; id "<ECO> <name>"`. It is built from the lines of
// src/endgame/openings-data.js that are 4 to 8 plies long: each position must score |eval| < limit cp at a fixed-node search,
// is taken once (by hash), and the lines of one family (the name before the colon) are capped so the set stays varied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Position, parseMove, legalMoves } from '../../src/index.js';
import { Searcher } from '../../src/search/index.js';
import { OPENINGS } from '../../src/endgame/openings-data.js';
import { parseArgs, num } from './args.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const OPENINGS_FILE = path.join(HERE, '..', 'suites', 'openings.epd');

/** The positions of the file: [{fen, ce, id}]. */
export function loadOpenings(file = OPENINGS_FILE) {
    const out = [];
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const fields = line.split(';').map((f) => f.trim());
        const p = { fen: fields[0], ce: 0, id: '' };
        for (const f of fields.slice(1)) {
            if (f.startsWith('ce ')) p.ce = Number(f.slice(3));
            else if (f.startsWith('id ')) p.id = f.slice(3).replace(/^"|"$/g, '');
        }
        out.push(p);
    }
    return out;
}

// a small deterministic generator (mulberry32), so a rebuild gives the same file
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Rebuild the file; returns the lines written. */
export function buildOpenings({ count = 160, nodes = 40000, limit = 60, minPlies = 4, maxPlies = 8, perFamily = 3, file = OPENINGS_FILE } = {}) {
    const seen = new Set();
    const candidates = [];
    for (const [eco, name, line] of OPENINGS) {
        const moves = line.split(' ');
        if (moves.length < minPlies || moves.length > maxPlies) continue;
        const pos = Position.fromFen(Position.START_FEN);
        let ok = true;
        for (const uci of moves) {
            let m;
            try {
                m = parseMove(pos, uci);
            } catch {
                ok = false;
                break;
            }
            pos.make(m);
        }
        if (!ok || !legalMoves(pos).length || pos.inCheck()) continue;
        const key = `${pos.hashLo}:${pos.hashHi}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ fen: pos.fen(), id: `${eco} ${name}`, family: name.split(':')[0] });
    }
    const rand = rng(20261101);
    for (let i = candidates.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const searcher = new Searcher({ hashMb: 16 });
    const perName = new Map();
    const kept = [];
    for (const c of candidates) {
        if (kept.length >= count) break;
        if ((perName.get(c.family) ?? 0) >= perFamily) continue;
        searcher.clear();
        const r = searcher.search(Position.fromFen(c.fen), { nodes });
        if (Math.abs(r.score) >= limit) continue;
        perName.set(c.family, (perName.get(c.family) ?? 0) + 1);
        kept.push(`${c.fen}; ce ${r.score}; id "${c.id}"`);
    }
    const header = [
        '# openings.epd — balanced starting positions for bench/match.mjs, built by bench/lib/openings.mjs --build.',
        `# Source: the named lines of src/endgame/openings-data.js (lichess-org/chess-openings, CC0), ${minPlies} to ${maxPlies} plies deep,`,
        `# kept when a ${nodes}-node search scores |eval| < ${limit} cp for the side to move; at most ${perFamily} per opening family.`,
        '# A line: the FEN; ce, that search score in centipawns for the side to move; id.',
    ];
    fs.writeFileSync(file, `${[...header, ...kept].join('\n')}\n`);
    return kept;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    const args = parseArgs(process.argv.slice(2));
    if (args.build) {
        const kept = buildOpenings({ count: num(args, 'count', 160), nodes: num(args, 'nodes', 40000), limit: num(args, 'limit', 60) });
        console.log(`wrote ${kept.length} positions to ${OPENINGS_FILE}`);
    } else console.log(`${loadOpenings().length} positions in ${OPENINGS_FILE}`);
}
