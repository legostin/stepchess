// i18n/en/puzzles — English messages of the puzzles domain: why a puzzle, a mate search or a game could not be read.
export default {
    verify: {
        internal: 'The puzzle could not be checked.',
        input: 'A puzzle is an object with a position (fen) and a list of moves.',
        moves: 'The moves have to be a list of moves written as text, with at least one move.',
        even: 'A puzzle line ends with the solver’s move, so it holds an odd number of moves, not %{count}.',
        long: 'A puzzle line may hold at most %{max} moves.',
    },
    mate: {
        internal: 'The mate search failed.',
        n: 'The length of the mate has to be a whole number, 1 or more.',
        max: 'The search for a forced mate goes up to %{max} moves.',
        budget: 'The search is too large: it does not fit in %{nodes} %{nodes|position|positions}, and an exact answer cannot be guessed.',
    },
    find: {
        internal: 'The game could not be searched for puzzles.',
        long: 'The game is too long: puzzles are searched for in games of up to %{max} half-moves.',
    },
};
