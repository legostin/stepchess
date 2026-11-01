// i18n/ru/play — Russian messages of the play domain: why the opponent has no move to make.
export default {
    opponent: {
        internal: 'Соперник не смог выбрать ход.',
        moves: 'Ходы, сыгранные из позиции, передаются списком (UCI или SAN).',
        'checkmate-white': 'Мат: победили белые, ходить некому.',
        'checkmate-black': 'Мат: победили чёрные, ходить некому.',
        stalemate: 'Пат: у стороны, чей ход, нет ни одного хода и нет шаха, партия закончилась вничью.',
        fifty: 'Ничья: пятьдесят ходов прошло без взятия и хода пешкой.',
        threefold: 'Ничья: позиция повторилась трижды.',
        insufficient: 'Ничья: ни у одной из сторон не хватает материала для мата.',
    },
};
