// i18n/en/play — English messages of the play domain: why the opponent has no move to make.
export default {
    opponent: {
        internal: 'The opponent could not choose a move.',
        moves: 'The moves played from the position must be a list (UCI or SAN).',
        'checkmate-white': 'Checkmate: White has won, so there is no move to make.',
        'checkmate-black': 'Checkmate: Black has won, so there is no move to make.',
        stalemate: 'Stalemate: the side to move has no legal move and is not in check, so the game is drawn.',
        fifty: 'Draw: fifty moves have passed without a capture or a pawn move.',
        threefold: 'Draw: the position has occurred three times.',
        insufficient: 'Draw: neither side has enough material to give mate.',
    },
};
