// i18n/en/eval — English messages of the eval domain: the name of every term of the evaluation and what it means.
export default {
    term: {
        material: {
            name: 'Material',
            about: 'What the pieces and pawns of each side are worth. An extra piece or pawn is the first thing an evaluation counts.',
        },
        'bishop-pair': {
            name: 'Bishop pair',
            about: 'Two bishops together cover squares of both colours; they are at their best in open positions and in the endgame.',
        },
        imbalance: {
            name: 'Material imbalance',
            about: 'What a piece is worth depends on the pawns: a knight likes a closed position full of pawns, a rook an open one with few.',
        },
        pst: {
            name: 'Piece placement',
            about: 'How good the squares of the pieces are: knights and bishops in the centre, pawns that have advanced, the king sheltered in the middlegame and central in the endgame.',
        },
        mobility: {
            name: 'Mobility',
            about: 'How many squares the knights, bishops, rooks and queen can go to, leaving out squares held by their own pieces or guarded by enemy pawns.',
        },
        'knight-outpost': {
            name: 'Knight outpost',
            about: 'A knight on the fourth to sixth rank, protected by a pawn, that no enemy pawn can ever drive away: a strong point in the opponent’s camp.',
        },
        'rook-open-file': {
            name: 'Rook on an open file',
            about: 'No pawns stand on the rook’s file, so it can reach deep into the opponent’s position.',
        },
        'rook-semi-open-file': {
            name: 'Rook on a half-open file',
            about: 'Only an enemy pawn stands on the rook’s file: the rook presses on it and prepares a break.',
        },
        'rook-seventh': {
            name: 'Rook on the seventh',
            about: 'A rook on the opponent’s second rank attacks the pawns there and keeps the king cut off on the edge.',
        },
        'bad-bishop': {
            name: 'Bad bishop',
            about: 'Its own pawns are blocked on squares of the bishop’s colour: they shut its diagonals, and the bishop is left guarding pawns instead of playing.',
        },
        'trapped-piece': {
            name: 'Trapped piece',
            about: 'A piece with hardly a move: a bishop on a7, h7, a6 or h6 shut in by an enemy pawn on b6, g6, b5 or g5, or a rook on its first rank with three squares or fewer, boxed in by its own king that can no longer castle to that side.',
        },
        'isolated-pawn': {
            name: 'Isolated pawn',
            about: 'A pawn with no friendly pawns on the neighbouring files: no pawn can defend it, and the square in front of it is a strong point for the opponent’s pieces.',
        },
        'doubled-pawn': {
            name: 'Doubled pawns',
            about: 'Two pawns of one colour on the same file: the rear one gets in the way of the front one, and they cannot defend each other.',
        },
        'backward-pawn': {
            name: 'Backward pawn',
            about: 'Its neighbours have advanced, and an enemy pawn guards the square in front of it: it cannot move up safely and becomes a target.',
        },
        'connected-pawn': {
            name: 'Connected pawns',
            about: 'Pawns side by side on neighbouring files support each other’s advance; the further they have gone, the stronger they are.',
        },
        'passed-pawn': {
            name: 'Passed pawn',
            about: 'No enemy pawn stands in front of it or on a neighbouring file, so only pieces can stop it. It is worth more the further it has advanced, especially when its path is clear and the enemy king cannot reach the square of the pawn.',
        },
        'pawn-chain': {
            name: 'Pawn chain',
            about: 'A pawn protected diagonally by a pawn behind it: the chain holds itself up, and its head cramps the opponent.',
        },
        'pawn-shield': {
            name: 'Pawn shield',
            about: 'Pawns in front of the king on the second and third ranks shelter it from checks and attacks.',
        },
        'pawn-storm': {
            name: 'Pawn storm',
            about: 'Pawns advance against the enemy king to tear open its shelter. A pawn that has run into a defending pawn is less dangerous.',
        },
        'king-attack': {
            name: 'King attack',
            about: 'Pieces that hit the squares around the enemy king. One piece alone does little; the more of them gather, the stronger the attack.',
        },
        'king-open-file': {
            name: 'Open file by the king',
            about: 'No pawn of its own stands on the king’s file or a file beside it: the enemy rooks and queen can come at the king along it.',
        },
        'king-activity': {
            name: 'King activity',
            about: 'In the endgame the king is a strong piece: it is good to have your own king close to a passed pawn and the enemy king far from it.',
        },
        'hanging-piece': {
            name: 'Hanging piece',
            about: 'A piece that is attacked and defended by nothing: the opponent takes it unless it moves away or gets protected.',
        },
        'pawn-threat': {
            name: 'Pawn threat',
            about: 'A pawn attacks a piece: giving the piece for the pawn is a loss, so the piece has to move.',
        },
        'double-attack': {
            name: 'Double attack',
            about: 'One piece or pawn attacks two targets at once — the king, a more valuable piece or an undefended one. One move rarely defends both, so one of them is often lost.',
        },
        'center-control': {
            name: 'Centre control',
            about: 'How often each side hits the central squares d4, e4, d5 and e5: whoever holds the centre moves pieces from wing to wing more easily.',
        },
        space: {
            name: 'Space',
            about: 'The squares on the c- to f-files on a side’s second to fourth ranks that hold no pawn of its own and that no enemy pawn attacks: safe room for the pieces to stand and regroup.',
        },
        'kbnk-corner': {
            name: 'Bishop and knight mate',
            about: 'Bishop and knight can mate only in a corner of the bishop’s colour: drive the enemy king to the edge and into that corner, with your own king helping.',
        },
        'opposite-bishops': {
            name: 'Opposite-coloured bishops',
            about: 'Each side has one bishop, on squares of different colours: the defender blocks the pawns on squares the other bishop cannot reach, and even a pawn more often does not win.',
        },
        'wrong-bishop': {
            name: 'Wrong-coloured bishop',
            about: 'A rook pawn with a bishop that does not cover the queening square: once the enemy king reaches the corner, there is no win.',
        },
        fortress: {
            name: 'Not enough to win',
            about: 'The side ahead has no pawns, and its extra material is too little to win: a lone minor piece cannot force mate, nor can two knights against a bare king, and an edge smaller than a rook is usually held.',
        },
    },
};
