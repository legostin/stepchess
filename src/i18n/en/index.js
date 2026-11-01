// i18n/en — English: every message of the engine, by domain.
import apiMessages from './api.js';
import boardMessages from './board.js';
import clientMessages from './client.js';
import coreMessages from './core.js';
import endgameMessages from './endgame.js';
import evalMessages from './eval.js';
import explainMessages from './explain.js';
import openingsMessages from './openings.js';
import playMessages from './play.js';
import puzzlesMessages from './puzzles.js';
import searchMessages from './search.js';

export default {
    i18n: { value: '%{value}' },
    api: apiMessages,
    board: boardMessages,
    client: clientMessages,
    core: coreMessages,
    endgame: { ...endgameMessages, openings: openingsMessages }, // the openings of the endgame unit speak from its domain
    eval: evalMessages,
    explain: explainMessages,
    openings: {}, // no unit of its own: its messages are endgame.openings.*
    play: playMessages,
    puzzles: puzzlesMessages,
    search: searchMessages,
};
