// i18n/en/openings — English messages of the openings domain: the name of an opening is the name of the lichess data itself.
export default {
    opening: {
        name: '%{name}',
    },
    invalid: {
        type: 'The opening is looked up in text: a PGN game, a list of moves or a FEN.',
        empty: 'Nothing to look up: the text is empty.',
        long: 'The text is too long: %{chars} characters, the limit is %{limit}.',
        failed: 'The text could not be read.',
    },
};
