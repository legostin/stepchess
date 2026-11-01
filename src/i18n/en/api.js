// i18n/en/api — English messages of the api domain: what the public functions say when they cannot answer, and why a game is over.
export default {
    error: {
        internal: 'The engine could not finish this request.',
        unsupported: 'This build of the engine has no “%{method}”.',
        step: 'A hint has three steps: 1, 2 or 3.',
        moves: 'The moves played from the position must be a list (UCI or SAN).',
    },
    opponent: {
        options: 'The options of an opponent must be an object such as {elo, seed}.',
        elo: 'The strength of an opponent is a number from %{min} to %{max}.',
        seed: 'The seed of an opponent is a finite number.',
    },
    terminal: {
        'checkmate-white': 'Checkmate: White has won.',
        'checkmate-black': 'Checkmate: Black has won.',
        stalemate: 'Stalemate: the side to move has no legal move and is not in check, so the game is drawn.',
        fifty: 'Draw: fifty moves have passed without a capture or a pawn move.',
        threefold: 'Draw: the position has occurred three times.',
        insufficient: 'Draw: neither side has enough material to give mate.',
    },
};
