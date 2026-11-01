// i18n/en/core — English messages of the core domain.
export default {
    fen: {
        fields: 'A FEN has 4 to 6 fields separated by spaces; this one has %{count}.',
        board: 'The piece placement must list 8 ranks of 8 squares each, with the letters PNBRQK for White and pnbrqk for Black.',
        side: 'The side to move must be w or b, not “%{text}”.',
        castling: 'The castling rights “%{text}” do not match the board: each right needs the king and the rook on their home squares.',
        ep: 'The en passant square “%{text}” does not fit: it must lie behind a pawn that has just made a double step.',
        counters: 'The move counters must be whole numbers, and the move number at least 1.',
        kings: 'Each side needs exactly one king; White has %{white} and Black %{black}.',
        pieces: 'A side cannot have more than 16 pieces or more than 8 pawns.',
        'pawn-rank': 'A pawn cannot stand on the first or the last rank (%{square}).',
        'opponent-in-check': 'The side that has just moved is in check, which is impossible.',
    },
    move: {
        history: 'The game is too long for the move history of the position.',
        syntax: 'Cannot read “%{text}” as a move: write it as Nf3, exd5, O-O, e8=Q or e2e4.',
        illegal: 'The move “%{text}” is not legal in this position.',
        ambiguous: 'The move “%{text}” fits several pieces: %{candidates}.',
    },
    san: {
        K: 'K',
        Q: 'Q',
        R: 'R',
        B: 'B',
        N: 'N',
        'castle-short': 'O-O',
        'castle-long': 'O-O-O',
    },
    pgn: {
        syntax: 'The PGN cannot be read near “%{text}” (line %{line}): %{why}.',
        move: 'The PGN has a move that cannot be played: “%{text}” at ply %{ply} (line %{line}).',
        why: {
            type: 'a PGN must be text',
            comment: 'a comment in braces is not closed',
            'variation-open': 'a variation in parentheses is not closed',
            'variation-close': 'a closing parenthesis has no opening one',
            'variation-start': 'a variation must follow a move it replaces',
            tag: 'a tag pair must look like [Name "value"]',
            token: 'this is not a move, a number, a comment or a result',
        },
    },
    game: {
        limit: 'The game has reached the longest length the engine keeps (%{plies} plies).',
    },
};
