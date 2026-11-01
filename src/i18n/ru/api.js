// i18n/ru/api — Russian messages of the api domain: what the public functions say when they cannot answer, and why a game is over.
export default {
    error: {
        internal: 'Движок не смог выполнить этот запрос.',
        unsupported: 'В этой сборке движка нет метода «%{method}».',
        step: 'У подсказки три ступени: 1, 2 или 3.',
        moves: 'Ходы, сыгранные из позиции, передаются списком (UCI или SAN).',
    },
    opponent: {
        options: 'Настройки соперника передаются объектом, например {elo, seed}.',
        elo: 'Сила соперника задаётся числом от %{min} до %{max}.',
        seed: 'Зерно соперника задаётся конечным числом.',
    },
    terminal: {
        'checkmate-white': 'Мат: победили белые.',
        'checkmate-black': 'Мат: победили чёрные.',
        stalemate: 'Пат: у стороны, чей ход, нет ни одного хода и нет шаха, партия закончилась вничью.',
        fifty: 'Ничья: пятьдесят ходов прошло без взятия и хода пешкой.',
        threefold: 'Ничья: позиция повторилась трижды.',
        insufficient: 'Ничья: ни у одной из сторон не хватает материала для мата.',
    },
};
