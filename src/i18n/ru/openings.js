// i18n/ru/openings — Russian messages of the openings domain. The Russian name of an opening is built from the English
// name of the lichess-org/chess-openings data (family + variation words) by the tables below; whatever the tables
// do not know stays in English.
//
// A name reads "Family: Segment, Segment…". The family comes from FAMILIES (the longest one the name starts with). A
// segment is "[adjectives] [names] <kind>": «Classical Fianchetto Variation» → «классический вариант фианкетто»,
// «Smith-Morra Gambit» → «гамбит Смита — Морры». The kind noun (KINDS) comes first, adjectives (ADJECTIVES) agree
// with it in gender, names (NAMES) stand in the genitive. PHRASES hold whole segments with a fixed translation.
//
// The rules that need more than a table lookup:
//   · a prefix and an adjective make one adjective that agrees with the kind: «Semi-Slav Defense» → «полуславянская
//     защита»; a prefix and a name stay a hyphenated name: «Anti-Benoni Variation» → «вариант анти-Бенони»;
//   · «King's Knight Variation» → «вариант королевского коня» (a possessive and a piece are one noun phrase, genitive after the kind);
//   · without a kind the adjectives agree with the gender of the last noun: «Reversed Rat» → «обратная Крыса»;
//   · a qualifier at the end moves to the front and agrees too: «King's Gambit Reversed» → «обратный королевский гамбит»;
//   · a family named in the middle of a line gets its Russian name («Petrov's Defense» → «защита Петрова»), a possessive
//     of a known name is that name in the genitive («Bird's Attack» → «атака Бёрда»);
//   · a surname without a standard Russian form stays in Latin letters.

/** Families: the English name up to the first colon → the Russian one. */
export const FAMILIES = {
    'Sicilian Defense': 'Сицилианская защита',
    'Ruy Lopez': 'Испанская партия',
    "Queen's Gambit Declined": 'Отказанный ферзевый гамбит',
    "Queen's Gambit Accepted": 'Принятый ферзевый гамбит',
    "Queen's Gambit": 'Ферзевый гамбит',
    'French Defense': 'Французская защита',
    'Italian Game': 'Итальянская партия',
    'English Opening': 'Английское начало',
    "King's Gambit Accepted": 'Принятый королевский гамбит',
    "King's Gambit Declined": 'Отказанный королевский гамбит',
    "King's Gambit": 'Королевский гамбит',
    "King's Indian Defense": 'Староиндийская защита',
    "King's Indian Attack": 'Староиндийская атака',
    'Caro-Kann Defense': 'Защита Каро — Канн',
    'Nimzo-Indian Defense': 'Нимцо-индийская защита',
    'Nimzowitsch Defense': 'Защита Нимцовича (1.e4 Nc6)',
    'Nimzo-Larsen Attack': 'Атака Нимцовича — Ларсена',
    "Queen's Pawn Game": 'Партия ферзевой пешки',
    "Queen's Pawn": 'Партия ферзевой пешки',
    'Semi-Slav Defense Accepted': 'Принятая полуславянская защита',
    'Semi-Slav Defense': 'Полуславянская защита',
    'Dutch Defense': 'Голландская защита',
    'Benoni Defense': 'Защита Бенони',
    'Grünfeld Defense': 'Защита Грюнфельда',
    'Neo-Grünfeld Defense': 'Защита Нео-Грюнфельда',
    "Queen's Indian Defense": 'Ферзевоиндийская защита',
    "Queen's Indian Accelerated": 'Ускоренная ферзевоиндийская защита',
    "Pseudo Queen's Indian Defense": 'Псевдоферзевоиндийская защита',
    'Alekhine Defense': 'Защита Алехина',
    'Scotch Game': 'Шотландская партия',
    'Indian Defense': 'Индийская защита',
    'Old Indian Defense': 'Старая индийская защита',
    'East Indian Defense': 'Восточноиндийская защита',
    'Bogo-Indian Defense': 'Богоиндийская защита',
    'Slav Defense': 'Славянская защита',
    'Slav Indian': 'Славяно-индийская защита',
    "Petrov's Defense": 'Защита Петрова',
    'Four Knights Game': 'Партия четырёх коней',
    'Three Knights Opening': 'Дебют трёх коней',
    'Zukertort Opening': 'Дебют Цукерторта',
    'Zukertort Defense': 'Защита Цукерторта',
    'Scandinavian Defense': 'Скандинавская защита',
    'Philidor Defense': 'Защита Филидора',
    'Réti Opening': 'Дебют Рети',
    'Vienna Game': 'Венская партия',
    'Vienna Gambit, with Max Lange Defense': 'Венский гамбит, защита Макса Ланге',
    "Bishop's Opening": 'Дебют слона',
    'Modern Defense': 'Современная защита',
    "King's Pawn Game": 'Партия королевской пешки',
    "King's Pawn Opening": 'Дебют королевской пешки',
    "King's Knight Opening": 'Дебют королевского коня',
    'Van Geet Opening': 'Дебют Ван Гета',
    "Van't Kruijs Opening": 'Дебют Ван т’Круйса',
    'Pterodactyl Defense': 'Защита «Птеродактиль»',
    'Catalan Opening': 'Каталонское начало',
    'Pirc Defense': 'Защита Пирца',
    'Bird Opening': 'Дебют Бёрда',
    'Tarrasch Defense': 'Защита Тарраша',
    'Polish Opening': 'Польский дебют',
    'Polish Defense': 'Польская защита',
    'Blackmar-Diemer Gambit Accepted': 'Принятый гамбит Блэкмара — Димера',
    'Blackmar-Diemer Gambit Declined': 'Отказанный гамбит Блэкмара — Димера',
    'Blackmar-Diemer Gambit': 'Гамбит Блэкмара — Димера',
    'Hungarian Opening': 'Венгерский дебют',
    'Grob Opening': 'Дебют Гроба',
    'Center Game Accepted': 'Принятая центральная партия',
    'Center Game': 'Центральная партия',
    'Latvian Gambit Accepted': 'Принятый латвийский гамбит',
    'Latvian Gambit': 'Латвийский гамбит',
    'Ponziani Opening': 'Дебют Понциани',
    'Rat Defense': 'Крысиная защита',
    'Trompowsky Attack': 'Атака Тромповского',
    'Benko Gambit Accepted': 'Принятый гамбит Бенко',
    'Benko Gambit Declined': 'Отказанный гамбит Бенко',
    'Benko Gambit': 'Гамбит Бенко',
    'Kádas Opening': 'Дебют Кадаша',
    'Englund Gambit Declined': 'Отказанный гамбит Энглунда',
    'Englund Gambit': 'Гамбит Энглунда',
    'Richter-Veresov Attack': 'Атака Рихтера — Вересова',
    'Owen Defense': 'Защита Овена',
    'Ware Opening': 'Дебют Уэра',
    'Ware Defense': 'Защита Уэра',
    'English Defense': 'Английская защита',
    'Torre Attack': 'Атака Торре',
    'Rubinstein Opening': 'Дебют Рубинштейна',
    'Lion Defense': 'Защита «Лев»',
    'Danish Gambit Accepted': 'Принятый датский гамбит',
    'Danish Gambit Declined': 'Отказанный датский гамбит',
    'Danish Gambit': 'Датский гамбит',
    'Barnes Opening': 'Дебют Барнса',
    'Barnes Defense': 'Защита Барнса',
    'Borg Defense': 'Защита Борга',
    'St. George Defense': 'Защита Святого Георгия',
    'Sodium Attack': 'Атака «Натрий»',
    'Mikenas Defense': 'Защита Микенаса',
    'Mieses Opening': 'Дебют Мизеса',
    'London System': 'Лондонская система',
    'Elephant Gambit': 'Слоновий гамбит',
    'Rapport-Jobava System': 'Система Раппорта — Джобавы',
    'Portuguese Opening': 'Португальский дебют',
    'Colle System': 'Система Колле',
    'Blumenfeld Countergambit Accepted': 'Принятый контргамбит Блюменфельда',
    'Blumenfeld Countergambit': 'Контргамбит Блюменфельда',
    'Amar Opening': 'Дебют Амара',
    'Mexican Defense': 'Мексиканская защита',
    'Marienbad System': 'Мариенбадская система',
    'Kangaroo Defense': 'Защита «Кенгуру»',
    'Horwitz Defense': 'Защита Горвица',
    'Hippopotamus Defense': 'Защита «Бегемот»',
    'Goldsmith Defense': 'Защита Голдсмита',
    'English Orangutan': 'Английский орангутан',
    'Clemenz Opening': 'Дебют Клеменца',
    'Carr Defense': 'Защита Карра',
    "Anderssen's Opening": 'Дебют Андерсена',
    'Amazon Attack': 'Атака «Амазонка»',
    'Zaire Defense': 'Защита «Заир»',
    'Yusupov-Rubinstein System': 'Система Юсупова — Рубинштейна',
    'Wade Defense': 'Защита Уэйда',
    'Vulture Defense': 'Защита «Гриф»',
    'Valencia Opening': 'Валенсийский дебют',
    'Saragossa Opening': 'Сарагосский дебют',
    'Robatsch Defense': 'Защита Робача',
    'Paleface Attack': 'Атака «Бледнолицый»',
    'Montevideo Defense': 'Защита «Монтевидео»',
    'Lemming Defense': 'Защита «Лемминг»',
    'Lasker Simul Special': 'Специальный дебют Ласкера для сеанса',
    'Irish Gambit': 'Ирландский гамбит',
    'Gunderam Defense': 'Защита Гундерама',
    'Global Opening': 'Глобальный дебют',
    'Fried Fox Defense': 'Защита «Жареная лиса»',
    'Döry Defense': 'Защита Дёри',
    'Duras Gambit': 'Гамбит Дураса',
    'Dresden Opening': 'Дрезденский дебют',
    'Czech Defense': 'Чешская защита',
    'Creepy Crawly Formation': 'Построение «Ползучий гад»',
    'Canard Opening': 'Дебют «Утка»',
    'Bongcloud Attack': 'Атака «Бонгклауд»',
    'Basque Opening': 'Баскский дебют',
    'Australian Defense': 'Австралийская защита',
    'Amsterdam Attack': 'Амстердамская атака',
    Formation: 'Построение',
};

// kinds of lines: the noun, its gender (0 masculine, 1 feminine, 2 neuter, 3 plural) and its genitive
const KINDS = {
    Variation: ['вариант', 0, 'варианта'],
    Variations: ['варианты', 3, 'вариантов'],
    Attack: ['атака', 1, 'атаки'],
    Gambit: ['гамбит', 0, 'гамбита'],
    Defense: ['защита', 1, 'защиты'],
    Line: ['линия', 1, 'линии'],
    System: ['система', 1, 'системы'],
    Countergambit: ['контргамбит', 0, 'контргамбита'],
    Counterattack: ['контратака', 1, 'контратаки'],
    Opening: ['дебют', 0, 'дебюта'],
    Formation: ['построение', 2, 'построения'],
    Trap: ['ловушка', 1, 'ловушки'],
    Game: ['партия', 1, 'партии'],
    Sacrifice: ['жертва', 1, 'жертвы'],
    Bind: ['сжатие', 2, 'сжатия'],
    Endgame: ['эндшпиль', 0, 'эндшпиля'],
    Mate: ['мат', 0, 'мата'],
};

// after the kind: «Gambit Declined» → «отказанный гамбит»
const QUALIFIERS = new Set(['Accepted', 'Declined', 'Deferred', 'Reversed']);
// parts of surnames that stand before the name and stay with it
const PARTICLES = new Set(['Van', 'van', 'von', 'de', 'De', 'der', 'den', 'del', 'Del', 'La', 'Le', 'El', 'Mc', 'di', 'da']);

// adjectives as stem|ending; the ending gives the four forms (masculine, feminine, neuter, plural)
const ENDINGS = {
    ый: ['ый', 'ая', 'ое', 'ые'],
    ий: ['ий', 'ая', 'ое', 'ие'],
    ой: ['ой', 'ая', 'ое', 'ые'],
    ный: ['ный', 'ная', 'ное', 'ные'],
    ний: ['нний', 'нняя', 'ннее', 'нние'],
};
const ADJECTIVE_LIST = {
    Classical: 'классическ|ий',
    Closed: 'закрыт|ый',
    Open: 'открыт|ый',
    Modern: 'современн|ый',
    Normal: 'обычн|ый',
    Main: 'основн|ой',
    Orthodox: 'ортодоксальн|ый',
    Symmetrical: 'симметричн|ый',
    Reversed: 'обратн|ый',
    Accelerated: 'ускорен|ный',
    Delayed: 'отложен|ный',
    Deferred: 'отложен|ный',
    'Ultra-Delayed': 'сверхотложен|ный',
    Double: 'двойн|ой',
    Quiet: 'тих|ий',
    Positional: 'позиционн|ый',
    Central: 'центральн|ый',
    Traditional: 'традиционн|ый',
    Old: 'стар|ый',
    Early: 'ра|ний',
    Russian: 'русск|ий',
    Austrian: 'австрийск|ий',
    Hungarian: 'венгерск|ий',
    Spanish: 'испанск|ий',
    English: 'английск|ий',
    Dutch: 'голландск|ий',
    Sicilian: 'сицилианск|ий',
    Indian: 'индийск|ий',
    Italian: 'итальянск|ий',
    Portuguese: 'португальск|ий',
    Polish: 'польск|ий',
    Czech: 'чешск|ий',
    Scandinavian: 'скандинавск|ий',
    Norwegian: 'норвежск|ий',
    French: 'французск|ий',
    German: 'немецк|ий',
    Swedish: 'шведск|ий',
    Danish: 'датск|ий',
    Latvian: 'латвийск|ий',
    Scotch: 'шотландск|ий',
    Vienna: 'венск|ий',
    Eastern: 'восточн|ый',
    Western: 'западн|ый',
    Sharp: 'остр|ый',
    Hyperaccelerated: 'гиперускорен|ный',
    Poisoned: 'отравлен|ный',
    Compromised: 'скомпрометирован|ный',
    Accepted: 'принят|ый',
    Declined: 'отказан|ный',
    Wing: 'флангов|ый',
    'Semi-Slav': 'полуславянск|ий',
    Original: 'оригинальн|ый',
    Improved: 'улучшенн|ый',
    Rare: 'редк|ий',
    Symmetric: 'симметричн|ый',
    'Ultra-Symmetrical': 'ультрасимметричн|ый',
    Fully: 'полностью|',
    "King's Indian": 'староиндийск|ий',
    "Queen's Indian": 'ферзевоиндийск|ий',
    'Neo-Classical': 'неоклассическ|ий',
    'Anti-Classical': 'антиклассическ|ий',
    'Anti-Modern': 'антисовременн|ый',
    Ukrainian: 'украинск|ий',
    Argentine: 'аргентинск|ий',
    Lithuanian: 'литовск|ий',
    Maltese: 'мальтийск|ий',
    Mexican: 'мексиканск|ий',
    Transpositional: 'транспозиционн|ый',
    Icelandic: 'исландск|ий',
    Batavo: 'батаво',
    Standard: 'стандартн|ый',
    Flexible: 'гибк|ий',
    Defensive: 'оборонительн|ый',
    'Semi-Classical': 'полуклассическ|ий',
    'Semi-Averbakh': 'полуавербаховск|ий',
    'Neo-Modern': 'неосовременн|ый',
    'Neo-Orthodox': 'неоортодоксальн|ый',
    Long: 'длинн|ый',
    Short: 'коротк|ий',
    Full: 'полн|ый',
    Chinese: 'китайск|ий',
    American: 'американск|ий',
    Siberian: 'сибирск|ий',
    Swiss: 'швейцарск|ий',
    Mannheim: 'мангеймск|ий',
    Yugoslav: 'югославск|ий',
    Baltic: 'балтийск|ий',
    Catalan: 'каталонск|ий',
    Slav: 'славянск|ий',
    Valencian: 'валенсийск|ий',
    Warsaw: 'варшавск|ий',
    Wayward: 'своенравн|ый',
    "King's": 'королевск|ий',
    "Queen's": 'ферзев|ый',
    New: 'нов|ый',
};

// names and nouns that follow the kind: nominative and genitive.
// 'nom+suffix' (genitive = nom + suffix) · 'nom/gen' · 'word' (does not decline)
const NAME_LIST = {
    Najdorf: 'Найдорф+а',
    Mengarini: 'Менгарини',
    Hiva: 'Хива',
    Franco: 'Франко',
    Ghulam: 'Гулям',
    Kassim: 'Кассим',
    Keoni: 'Кеони',
    Kahiko: 'Кахико',
    Hula: 'Хула',
    Omega: 'Омега',
    Anglo: 'Англо',
    Nimzo: 'Нимцо',
    Edge: 'Эдж',
    'El Columpio': 'Эль Колумпио',
    Columpio: 'Колумпио',
    Schiller: 'Шиллер+а',
    Hobbs: 'Хоббс+а',
    Wagner: 'Вагнер+а',
    Shirov: 'Широв+а',
    'Van der Wiel': 'ван дер Вил+я',
    Studier: 'Штудир+а',
    Halasz: 'Халас+а',
    Meitner: 'Мейтнер+а',
    Gianutio: 'Джанутио',
    Bugayev: 'Бугаев+а',
    Schiffler: 'Шиффлер+а',
    Novosibirsk: 'Новосибирск+а',
    Pfeiffer: 'Пфайфер+а',
    Graz: 'Грац+а',
    Ross: 'Росс+а',
    Norfolk: 'Норфолк+а',
    Bremen: 'Бремен+а',
    Bellon: 'Беллон+а',
    Hort: 'Горт+а',
    Parma: 'Парма',
    Duz: 'Дуз',
    Khotimirsky: 'Хотимирский/Хотимирского',
    Pytel: 'Питель',
    Herzog: 'Герцог+а',
    Tiviakov: 'Тивяков+а',
    Santasiere: 'Сантасьер+а',
    Aronin: 'Аронин+а',
    Westerinen: 'Вестеринен+а',
    Jaffe: 'Яффе',
    Palatnik: 'Палатник+а',
    Grigoriev: 'Григорьев+а',
    Sherbakov: 'Щербаков+а',
    Adams: 'Адамс+а',
    Lipnitsky: 'Липницкий/Липницкого',
    Leong: 'Леонг+а',
    Chistyakov: 'Чистяков+а',
    Portisch: 'Портиш+а',
    Arnold: 'Арнольд+а',
    Minckwitz: 'Минквиц+а',
    Bledow: 'Бледов+а',
    Benoni: 'Бенони',
    Korchnoi: 'Корчной/Корчного',
    Myers: 'Майерс+а',
    Schliemann: 'Шлиман+а',
    Blackburne: 'Блэкберн+а',
    Spike: 'Спайк+а',
    Réti: 'Рети',
    Gunderam: 'Гундерам+а',
    Basman: 'Басман+а',
    Brooklyn: 'Бруклин+а',
    Simagin: 'Симагин+а',
    "Simagin's": 'Симагина/Симагина',
    Urusov: 'Урусов+а',
    York: 'Йорк+а',
    'New York': 'Нью-Йорк+а',
    Mokele: 'Мокеле',
    Mbembe: 'Мбембе',
    Norwalde: 'Норвальд+а',
    Canal: 'Канал+а',
    Napoleon: 'Наполеон+а',
    Fajarowicz: 'Файаровича',
    'Grand Prix': 'Гран-при',
    'La Bourdonnais': 'Лабурдонне',
    'St. George': 'Святой Георгий/Святого Георгия',
    'Move Order': 'порядок ходов/порядка ходов',
    Check: 'шах/шаха',
    Transfer: 'перевод/перевода',
    Castling: 'рокировка/рокировки#f',
    Queen: 'ферзь/ферзя',
    King: 'король/короля',
    Rat: 'Крыса/Крысы#f',
    Lion: 'Лев/Льва',
    Bird: 'Бёрд+а',
    Pirc: 'Пирц+а',
    Burn: 'Бёрн+а',
    Benko: 'Бенко',
    Ware: 'Уэр+а',
    Amsterdam: 'Амстердам+а',
    Diemer: 'Димер+а',
    Blackmar: 'Блэкмар+а',
    Hromádka: 'Громадка',
    Kurajica: 'Курайица',
    Bled: 'Блед+а',
    Sosonko: 'Сосонко',
    Uhlmann: 'Ульман+а',
    Unzicker: 'Унцикер+а',
    Ljubojevic: 'Любоевич+а',
    Alburt: 'Альбурт+а',
    Carlsen: 'Карлсен+а',
    Kramnik: 'Крамник+а',
    Ivanchuk: 'Иванчук+а',
    Seirawan: 'Сирован+а',
    Shabalov: 'Шабалов+а',
    Adorjan: 'Адорьян+а',
    Tennison: 'Теннисон+а',
    Landau: 'Ландау',
    Hennig: 'Хеннинг+а',
    Lazard: 'Лазар+а',
    Ponziani: 'Понциани',
    Chicago: 'Чикаго',
    Prague: 'Прага/Праги#f',
    Belgrade: 'Белград+а',
    Wiesbaden: 'Висбаден+а',
    Düsseldorf: 'Дюссельдорф+а',
    Cologne: 'Кёльн+а',
    Birmingham: 'Бирмингем+а',
    Goteborg: 'Гётеборг+а',
    Lisbon: 'Лиссабон+а',
    Janeiro: 'Жанейро',
    'Rio de Janeiro': 'Рио-де-Жанейро',
    Buenos: 'Буэнос',
    Aires: 'Айрес',
    Sideline: 'ответвление/ответвления#n',
    Intermezzo: 'промежуточный ход/промежуточного хода',
    Blockade: 'блокада/блокады#f',
    Development: 'развитие/развития#n',
    Connection: 'связь/связи#f',
    Symmetry: 'симметрия/симметрии#f',
    Push: 'продвижение/продвижения#n',
    Corkscrew: 'штопор/штопора',
    Millennium: 'тысячелетие/тысячелетия#n',
    Plan: 'план/плана',
    Return: 'возврат/возврата',
    Walk: 'прогулка/прогулки#f',
    Hippopotamus: 'Бегемот+а',
    Dilworth: 'Дилворт+а',
    Weiss: 'Вайс+а',
    Suttles: 'Саттлс+а',
    Sleipnir: 'Слейпнир+а',
    Hillbilly: 'Хиллбилли',
    Mortimer: 'Мортимер+а',
    Keidansky: 'Кейданский/Кейданского',
    Gent: 'Гент',
    Paoli: 'Паоли',
    Calabrese: 'Калабрезе',
    Hartlaub: 'Хартлауб+а',
    Zeller: 'Целлер+а',
    Popiel: 'Попель/Попеля',
    Morris: 'Моррис+а',
    Furman: 'Фурман+а',
    Belyavsky: 'Белявский/Белявского',
    Szabo: 'Сабо',
    Lundin: 'Лундин+а',
    Hübner: 'Хюбнер+а',
    Donner: 'Доннер+а',
    Schneider: 'Шнайдер+а',
    Thomas: 'Томас+а',
    Browne: 'Браун+а',
    Wolf: 'Вольф+а',
    Schmidt: 'Шмидт+а',
    Neumann: 'Нойман+а',
    Potter: 'Поттер+а',
    Young: 'Янг+а',
    Rice: 'Райс+а',
    Barcza: 'Барца',
    Tate: 'Тейт+а',
    Erben: 'Эрбен+а',
    Welling: 'Веллинг+а',
    Gipslis: 'Гипслис+а',
    Mongredien: 'Монгредьен+а',
    Wall: 'стена/стены#f',
    Wind: 'ветер/ветра',
    Frankenstein: 'Франкенштейн+а',
    Dracula: 'Дракул+а',
    Chameleon: 'Хамелеон+а',
    Dragon: 'Дракон+а',
    Winawer: 'Винавер+а',
    Rubinstein: 'Рубинштейн+а',
    Chigorin: 'Чигорин+а',
    Evans: 'Эванс+а',
    Morphy: 'Морфи',
    Berlin: 'Берлин+а',
    Tarrasch: 'Тарраш+а',
    Giuoco: 'Джуоко',
    Alekhine: 'Алехин+а',
    Sämisch: 'Земиш+а',
    Nimzowitsch: 'Нимцович+а',
    Bogoljubow: 'Боголюбов+а',
    Alapin: 'Алапин+а',
    Botvinnik: 'Ботвинник+а',
    Paulsen: 'Паульсен+а',
    Marshall: 'Маршалл+а',
    Kieseritzky: 'Кизерицкий/Кизерицкого',
    Panov: 'Панов+а',
    Tartakower: 'Тартаковер+а',
    Maróczy: 'Марошши',
    Keres: 'Керес+а',
    Falkbeer: 'Фалькбеер+а',
    "O'Kelly": 'О’Келли',
    Agincourt: 'Азенкур+а',
    Scheveningen: 'Схевенинген+а',
    Meran: 'Меран+а',
    Kan: 'Кан+а',
    Taimanov: 'Тайманов+а',
    Czerniak: 'Черняк+а',
    Lasker: 'Ласкер+а',
    Spielmann: 'Шпильман+а',
    Smyslov: 'Смыслов+а',
    Petrosian: 'Петросян+а',
    Karpov: 'Карпов+а',
    Kasparov: 'Каспаров+а',
    Reshevsky: 'Решевский/Решевского',
    Capablanca: 'Капабланк+а/Капабланки',
    Averbakh: 'Авербах+а',
    Steinitz: 'Стейниц+а',
    Spassky: 'Спасский/Спасского',
    Janowski: 'Яновский/Яновского',
    Albin: 'Альбин+а',
    Greco: 'Греко',
    Fischer: 'Фишер+а',
    Gligoric: 'Глигорич+а',
    Stoltz: 'Штольц+а',
    Stanley: 'Стэнли',
    Leningrad: 'Ленинград+а',
    Moscow: 'Москва/Москвы#f',
    Carlsbad: 'Карлсбад+а',
    Bronstein: 'Бронштейн+а',
    Breyer: 'Брейер+а',
    Steiner: 'Штайнер+а',
    Sozin: 'Созин+а',
    Noa: 'Ноа',
    Krause: 'Краузе',
    Hanham: 'Хэнэм+а',
    Barmen: 'Бармен+а',
    Schlechter: 'Шлехтер+а',
    Salvio: 'Сальвио',
    Romanishin: 'Романишин+а',
    Panteldakis: 'Пантелдакис+а',
    Opocensky: 'Опоченский/Опоченского',
    Larsen: 'Ларсен+а',
    Henneberger: 'Хеннебергер+а',
    Charousek: 'Харузек+а',
    Bernstein: 'Бернштейн+а',
    Berger: 'Бергер+а',
    Lemberger: 'Лембергер+а',
    Brinckmann: 'Бринкман+а',
    Bayonet: 'штык/штыка',
    Chatard: 'Шатар+а',
    "l'Hermet": 'л’Эрме',
    Zukertort: 'Цукерторт+а',
    Sveshnikov: 'Свешников+а',
    Sokolsky: 'Сокольский/Сокольского',
    Rosentreter: 'Розентретер+а',
    Philidor: 'Филидор+а',
    Noteboom: 'Нотебом+а',
    Muzio: 'Музио',
    Mayet: 'Майе',
    Levenfish: 'Левенфиш+а',
    Leonhardt: 'Леонгардт+а',
    Knight: 'конь/коня',
    Knights: 'кони/коней#p',
    'Two Knights': 'два коня/двух коней#p',
    'Three Knights': 'три коня/трёх коней#p',
    'Four Knights': 'четыре коня/четырёх коней#p',
    'Ilyin-Zhenevsky': 'Ильин — Женевский/Ильина — Женевского',
    Gurevich: 'Гуревич+а',
    From: 'Фром+а',
    "From's": 'Фрома/Фрома',
    Flohr: 'Флор+а',
    Euwe: 'Эйве',
    Cunningham: 'Каннингем+а',
    Cozio: 'Коцио',
    Boleslavsky: 'Болеславский/Болеславского',
    Allgaier: 'Алгайер+а',
    Zurich: 'Цюрих+а',
    Yates: 'Йейтс+а',
    Worrall: 'Уоррел+а',
    Wade: 'Уэйд+а',
    Trifunovic: 'Трифунович+а',
    Traxler: 'Тракслер+а',
    Teichmann: 'Тейхман+а',
    Tayler: 'Тейлор+а',
    Stahlberg: 'Шталберг+а',
    Staunton: 'Стонтон+а',
    Schallopp: 'Шаллоп+а',
    Richter: 'Рихтер+а',
    Rauzer: 'Раузер+а',
    Ragozin: 'Рагозин+а',
    Pin: 'связка/связки#f',
    Pillsbury: 'Пилсбери',
    Paris: 'Париж+а',
    Panno: 'Панно',
    Pachman: 'Пахман+а',
    Mieses: 'Мизес+а',
    McDonnell: 'Макдоннелл+а',
    McCutcheon: 'Маккатчен+а',
    Manhattan: 'Манхэттен+а',
    Lutikov: 'Лутиков+а',
    Krejcik: 'Крейчик+а',
    Kmoch: 'Кмох+а',
    Kennedy: 'Кеннеди',
    Jaenisch: 'Яниш+а',
    Hunt: 'Хант+а',
    Horwitz: 'Горвиц+а',
    Hergert: 'Хергерт+а',
    Göring: 'Гёринг+а',
    Grünfeld: 'Грюнфельд+а',
    Grob: 'Гроб+а',
    Harrwitz: 'Харрвиц+а',
    Fingerslip: 'Фингерслип+а',
    Dubois: 'Дюбуа',
    Kádas: 'Кадаш+а',
    Fraser: 'Фрейзер+а',
    Cochrane: 'Кокрейн+а',
    Center: 'центр/центра',
    Bishop: 'слон/слона',
    Brentano: 'Брентано',
    Bastrikov: 'Бастриков+а',
    Barry: 'Барри',
    Milner: 'Милнер+а',
    Bardeleben: 'Барделебен+а',
    Anderssen: 'Андерсен+а',
    Alatortsev: 'Алаторцев+а',
    Venice: 'Венеция/Венеции#f',
    Pteranodon: 'Птеранодон+а',
    Pterodactyl: 'Птеродактиль/Птеродактиля',
    Exchange: 'размен/размена',
    Advance: 'продвижение/продвижения#n',
    Retreat: 'отступление/отступления#n',
    Bind: 'сжатие/сжатия',
    Smith: 'Смит+а',
    Morra: 'Морра/Морры',
    Max: 'Макс+а',
    Lange: 'Ланге',
    Petersburg: 'Петербург+а',
    'St. Petersburg': 'Санкт-Петербург+а',
    Caro: 'Каро',
    Budapest: 'Будапешт+а',
    Torre: 'Торре',
    London: 'Лондон+а',
    Colle: 'Колле',
    Nyezhmetdinov: 'Нежметдинов+а',
    Rossolimo: 'Россолимо',
    Gibbins: 'Гиббинс+а',
    Weidenhagen: 'Вайденхаген+а',
    Hamppe: 'Хампе',
    Pelikan: 'Пеликан+а',
    Hector: 'Гектор+а',
    Geller: 'Геллер+а',
    Gurgenidze: 'Гургенидзе',
    Gunsberg: 'Гунсберг+а',
    Gedult: 'Гедульт+а',
    Kotov: 'Котов+а',
    Kholmov: 'Холмов+а',
    Keene: 'Кин+а',
    Kaufmann: 'Кауфман+а',
    Howell: 'Хауэлл+а',
    Hastings: 'Гастингс+а',
    Harding: 'Хардинг+а',
    Guimard: 'Гимар+а',
    Glek: 'Глек+а',
    Fritz: 'Фриц+а',
    Duras: 'Дурас+а',
    Chekhover: 'Чеховер+а',
    Chebanenko: 'Чебаненко',
    Byrne: 'Бёрн+а',
    Borg: 'Борг+а',
    Boden: 'Боден+а',
    Blumenfeld: 'Блюменфельд+а',
    Balogh: 'Балог+а',
    Abrahams: 'Абрахамс+а',
    Zaitsev: 'Зайцев+а',
    Tal: 'Таль/Таля',
    Pollock: 'Поллок+а',
    Pierce: 'Пирс+а',
    Morozevich: 'Морозевич+а',
    Mason: 'Мейсон+а',
    Makogonov: 'Макогонов+а',
    Lisitsyn: 'Лисицын+а',
    Levitsky: 'Левицкий/Левицкого',
    Kupreichik: 'Куприйчик+а',
    Romanovsky: 'Романовский/Романовского',
    Riumin: 'Рюмин+а',
    Rabinovich: 'Рабинович+а',
    Prins: 'Принс+а',
    Schmid: 'Шмид+а',
    Showalter: 'Шоуолтер+а',
    Rosenthal: 'Розенталь/Розенталя',
    Polugaevsky: 'Полугаевский/Полугаевского',
    Miles: 'Майлз+а',
    Mikenas: 'Микенас+а',
    Carls: 'Карлс+а',
    MacLeod: 'Маклеод+а',
    Lewis: 'Льюис+а',
    Svenonius: 'Свенониус+а',
    Stafford: 'Стаффорд+а',
    Soller: 'Золлер+а',
    Sörensen: 'Сёренсен+а',
    Vitolins: 'Витолинш+а',
    Veresov: 'Вересов+а',
    Bücker: 'Бюкер+а',
    Cordel: 'Кордель/Корделя',
    Ulvestad: 'Ульвестад+а',
    Thorold: 'Торолд+а',
    Stockholm: 'Стокгольм+а',
    Stein: 'Штейн+а',
    Wiel: 'Вилль',
    Williams: 'Уильямс+а',
    Zilbermints: 'Зильберминц+а',
    Halloween: 'Хэллоуин+а',
    Lolli: 'Лолли',
    Polerio: 'Полерио',
    Damiano: 'Дамиано',
    Lopez: 'Лопес+а',
    Hybrid: 'гибрид/гибрида',
    Invitation: 'приглашение/приглашения#n',
    Cambridge: 'Кембридж+а',
    Springs: 'Спрингс',
    Counterattack: 'контратака/контратаки',
    Trap: 'ловушка/ловушки',
    Pawn: 'пешка/пешки#f',
    Pawns: 'пешки/пешек#p',
    Endgame: 'эндшпиль/эндшпиля',
    Poison: 'яд/яда',
    Sacrifice: 'жертва/жертвы',
    Rio: 'Рио',
    Rhamphorhynchus: 'Рамфоринх+а',
    Anhanguera: 'Анхангера',
    Quetzalcoatlus: 'Кетцалькоатль/Кетцалькоатля',
    Fianchetto: 'фианкетто',
    Stonewall: 'Стоунволл+а',
    Hedgehog: 'ёж/ежа',
    Kingside: 'королевский фланг/королевского фланга',
    Queenside: 'ферзевый фланг/ферзевого фланга',
    "Bishop's": 'слона',
    "Knight's": 'коня',
    Siroccopteryx: 'Сироккоптерикс+а',
    Kling: 'Клинг+а',
    Eisenberg: 'Эйзенберг+а',
    Colorado: 'Колорадо',
    Krebs: 'Кребс+а',
    Dzindzi: 'Дзиндзи',
    'Caro-Kann': 'Каро — Канн',
    'Four Pawns': 'четыре пешки/четырёх пешек#p',
    'Three Pawn': 'три пешки/трёх пешек#p',
    'Three Pawns': 'три пешки/трёх пешек#p',
    'Two Pawns': 'две пешки/двух пешек#p',
    Queens: 'ферзи/ферзей#p',
    Bishops: 'слоны/слонов#p',
    Rooks: 'ладьи/ладей#p',
    Rook: 'ладья/ладьи#f',
};

// ---- the tables made ready ----

const KIND = new Map(Object.entries(KINDS));
const ADJECTIVES = new Map();
for (const [word, spec] of Object.entries(ADJECTIVE_LIST)) {
    if (!spec) continue;
    const [stem, ending] = spec.split('|');
    // 'ending' empty: the word does not change
    ADJECTIVES.set(word, ending ? ENDINGS[ending].map((e) => stem + e) : [stem, stem, stem, stem]);
}
const NAMES = new Map();
for (const [word, listed] of Object.entries(NAME_LIST)) {
    let spec = listed;
    // a mark at the end gives the gender of a noun: #f feminine, #n neuter, #p plural; without one it is masculine (as every surname)
    const mark = /#([fnp])$/.exec(spec);
    const g = mark ? { f: 1, n: 2, p: 3 }[mark[1]] : 0;
    if (mark) spec = spec.slice(0, mark.index);
    let nom = spec;
    let gen = spec;
    if (spec.includes('/')) [nom, gen] = spec.split('/');
    else if (spec.includes('+')) {
        const [base, tail] = spec.split('+');
        nom = base;
        gen = base + tail;
    }
    NAMES.set(word, { nom, gen, g, noun: nom[0] === nom[0].toLowerCase() && nom[0] !== nom[0].toUpperCase() });
}

// whole segments with a fixed translation
const PHRASES = {
    'Main Line': 'основной вариант',
    'Poisoned Pawn': 'отравленная пешка',
    'Poisoned Pawn Variation': 'вариант с отравленной пешкой',
    'Poisoned Pawn Variation Declined': 'отказанный вариант с отравленной пешкой',
    'Smith-Morra Declined': 'отказанный гамбит Смита — Морры',
    'Réti Accepted': 'принятый вариант Рети',
    'Steinitz Deferred': 'отложенная защита Стейница',
    'Sämisch Deferred': 'отложенный вариант Земиша',
    'Anti-Qxd4 Move Order Accepted': 'принятый вариант с порядком ходов анти-Qxd4',
    "Queen's Gambit Invitation": 'приглашение в ферзевый гамбит',
    'Nimzo-Indian': 'нимцо-индийская защита',
    'Anti-Nimzo-Indian': 'система против нимцо-индийской защиты',
    'Berlin Wall': 'Берлинская стена',
    'Fried Liver Attack': 'атака «Жареная печень»',
    'Berlin Wall Defense': 'защита «Берлинская стена»',
    'Anti-Cambridge Springs': 'анти-Кембридж-Спрингс',
    'Anti-Cambridge Springs Variation': 'вариант анти-Кембридж-Спрингс',
    Accepted: 'принятый вариант',
    Declined: 'отказанный вариант',
    'Gambit Accepted': 'принятый гамбит',
    'Gambit Declined': 'отказанный гамбит',
    'Giuoco Piano': 'Джуоко пиано',
    'Giuoco Pianissimo': 'Джуоко пианиссимо',
    'Maróczy Bind': 'сжатие Марошши',
    'Smith-Morra Gambit Accepted': 'принятый гамбит Смита — Морры',
    'Smith-Morra Gambit Declined': 'отказанный гамбит Смита — Морры',
    'Budapest Gambit Accepted': 'принятый будапештский гамбит',
    'Neo-Catalan Declined': 'неокаталонская система, отказанный вариант',
    'Evans Gambit Declined': 'отказанный гамбит Эванса',
    'Botvinnik System Reversed': 'обратная система Ботвинника',
    'Reversed Closed Sicilian': 'обратная закрытая сицилианская защита',
    'Reversed Grünfeld': 'обратный Грюнфельд',
    'Anti-Grünfeld': 'анти-Грюнфельд',
    'Accelerated Dragon': 'ускоренный дракон',
    'Double Fianchetto': 'двойное фианкетто',
    Fianchetto: 'фианкетто',
    Sicilian: 'сицилианская защита',
    'Anglo-Slav Variation': 'англо-славянский вариант',
    'Anglo-Indian Defense': 'англо-индийская защита',
    'Anglo-Scandinavian Defense': 'англо-скандинавская защита',
    'Anglo-Grünfeld Variation': 'англо-грюнфельдовский вариант',
    'Anglo-Dutch Defense': 'англо-голландская защита',
    'Neo-Catalan': 'неокаталонская система',
    'Four Pawns Attack': 'атака четырёх пешек',
    'Two Pawns Attack': 'атака двух пешек',
    'Wing Gambit': 'фланговый гамбит',
    'Wing Attack': 'фланговая атака',
    "King's English Variation": 'королевский английский вариант',
    "King's Pawn Line": 'линия королевской пешки',
    "King's Knight's Gambit": 'гамбит королевского коня',
    "King's Indian Variation": 'староиндийский вариант',
    'Fianchetto Variation': 'вариант с фианкетто',
    'Fianchetto Line': 'линия с фианкетто',
    'Fianchetto Defense': 'защита с фианкетто',
    Rhamphorhynchus: 'рамфоринх',
    Anhanguera: 'анхангера',
    Allgaier: 'гамбит Алгайера',
    Kieseritzky: 'гамбит Кизерицкого',
};

// something that is a move, not a word: Bd3, g3, Nge2, 4. Bg5, .., O-O
const MOVE = /^(?:\d+\.{1,3}|\.{2,3}|[KQRBN]?[a-h]?x?[a-h][1-8][+#]?|O-O(?:-O)?|[KQRBN][a-h]|[a-h][1-8]?)$/;

// prefixes that fuse with an adjective into one word (Semi-Slav → полуславянский) and keep a hyphen before a name (Anti-Benoni → анти-Бенони)
const PREFIXES = { Anti: 'анти', Neo: 'нео', Pseudo: 'псевдо', Semi: 'полу', Ultra: 'ультра' };
// stems that keep their hyphen before an adjective (Anglo-Dutch → англо-голландский)
const HYPHEN_STEMS = { Anglo: 'англо', Nimzo: 'нимцо', Franco: 'франко' };
// «King's Knight», «Queen's Pawn»: a possessive adjective and the piece it belongs to
const POSSESSIVES = new Set(["King's", "Queen's"]);
const PIECES = new Set(['Knight', 'Bishop', 'Rook', 'Pawn', 'Queen', 'King']);

// the genitive of an adjective form (royal → «королевского»): the case a noun phrase takes after the kind
function genitiveForm(form) {
    if (/ний$/.test(form)) return form.replace(/ий$/, 'его');
    if (/(?:ый|ий|ой)$/.test(form)) return form.replace(/(?:ый|ий|ой)$/, 'ого');
    if (/ая$/.test(form)) return form.replace(/ая$/, 'ой');
    if (/ое$/.test(form)) return form.replace(/ое$/, 'ого');
    if (/ые$/.test(form)) return form.replace(/ые$/, 'ых');
    if (/ие$/.test(form)) return form.replace(/ие$/, 'их');
    return form;
}

// the first part of a compound of two adjectives (Czech-Indian → чешско-индийский): a nationality in -ский, or a word that does not change
function combiningForm(word) {
    const forms = ADJECTIVES.get(word);
    if (!forms) return null;
    if (forms.every((form) => form === forms[0])) return forms[0];
    return /ск(?:ий)$/.test(forms[0]) ? forms[0].replace(/ий$/, 'о') : null;
}

// places take -ский, not the -овский of a surname
const PLACE_ADJECTIVES = { Ленинград: 'ленинградск', Меран: 'меранск' };
// a line named after a place takes its adjective: «Berlin Defense» → «берлинская защита», «Leningrad Variation» → «ленинградский вариант»
const PLACES = { Berlin: 'берлинск', Leningrad: 'ленинградск', Meran: 'меранск', Moscow: 'московск', Carlsbad: 'карлсбадск', Scheveningen: 'схевенингенск' };

// the adjective of a surname (Грюнфельд → грюнфельдовск-, Тарраш → таррашевск-), or null where the name does not take one
function nameAdjective(nom) {
    if (Object.hasOwn(PLACE_ADJECTIVES, nom)) return PLACE_ADJECTIVES[nom];
    if (/(?:ский|цкий|ий|ый|ой)$/.test(nom)) return null;
    const stem = lowerFirst(nom);
    if (/[жшчщц]$/.test(stem)) return `${stem}евск`;
    if (/[бвгдзклмнпрстфх]$/.test(stem)) return `${stem}овск`;
    return null;
}

// An adjective-like word: the four forms of an adjective, or a noun {nom, gen, g}, or null. Compounds with a hyphen
// are taken apart: a prefix and an adjective make one adjective (Semi-Slav → полуславянский, Pseudo-Spanish →
// псевдоиспанский), a prefix and a name stay a hyphenated name (Anti-Benoni → анти-Бенони), a name and an adjective make an
// adjective (Benoni-Indian → Бенони-индийский). Whole words of the tables come first.
function compoundAt(token) {
    if (ADJECTIVES.has(token)) return { adj: ADJECTIVES.get(token) };
    const dash = token.indexOf('-');
    if (dash < 1 || NAMES.has(token)) return null;
    const first = token.slice(0, dash);
    const rest = token.slice(dash + 1);
    const inner = compoundAt(rest);
    const prefix = PREFIXES[first];
    if (prefix !== undefined) {
        if (inner?.adj) return { adj: inner.adj.map((form) => prefix + form) };
        if (inner?.noun) return { noun: { nom: `${prefix}-${inner.noun.nom}`, gen: `${prefix}-${inner.noun.gen}`, g: 0 } };
        const name = NAMES.get(rest);
        const derived = first === 'Semi' && name && !name.noun ? nameAdjective(name.nom) : null;
        if (derived) return { adj: ENDINGS.ий.map((end) => prefix + derived + end) };
        return name ? { noun: { nom: `${prefix}-${name.nom}`, gen: `${prefix}-${name.gen}`, g: 0 } } : null;
    }
    if (first === 'Anglo' && !inner) {
        const name = NAMES.get(rest);
        const derived = name && !name.noun ? nameAdjective(name.nom) : null;
        if (derived) return { adj: ENDINGS.ий.map((end) => `англо-${derived}${end}`) };
        if (name) return { noun: { nom: `англо-${name.nom}`, gen: `англо-${name.gen}`, g: 0 } };
    }
    const stem = HYPHEN_STEMS[first] ?? NAMES.get(first)?.nom ?? combiningForm(first);
    if (stem && inner?.adj) return { adj: inner.adj.map((form) => `${stem}-${form}`) };
    return null;
}

// the name at tokens[i] (up to three words): its text in the case asked, its gender and how many words it took
function nameAt(tokens, i, field) {
    for (let n = Math.min(3, tokens.length - i); n >= 1; n--) {
        const key = tokens.slice(i, i + n).join(' ');
        const hit = NAMES.get(key);
        if (hit) return { text: hit[field], gen: hit.gen, g: hit.g, noun: hit.noun, len: n };
        if (n === 1) {
            // Bird's → Бёрда: a possessive of a known name is that name
            const stem = key.endsWith("'s") && !ADJECTIVES.has(key) ? NAMES.get(key.slice(0, -2)) : null;
            if (stem) return { text: stem.gen, gen: stem.gen, g: 0, len: 1 };
            if (key.includes('-')) {
                const parts = key.split('-');
                // Smith-Morra → Смит — Морра: every part on its own
                if (parts.every((p) => NAMES.has(p))) {
                    const gen = parts.map((p) => NAMES.get(p).gen).join(' — ');
                    return { text: field === 'gen' ? gen : parts.map((p) => NAMES.get(p)[field]).join(' — '), gen, g: 0, len: 1 };
                }
            }
        }
    }
    return null;
}

const lowerFirst = (text) => text.charAt(0).toLowerCase() + text.slice(1);

// one segment: "[adjectives] [names] <kind>"
function segment(text) {
    const fixed = Object.hasOwn(PHRASES, text) ? PHRASES[text] : undefined;
    if (fixed) return fixed;
    // a family named in the middle of a line («Petrov's Defense»): the family's name in lower case
    if (Object.hasOwn(FAMILIES, text)) return lowerFirst(FAMILIES[text]);
    if (text.startsWith('with ')) return `с ${segment(text.slice(5))}`;
    const tokens = text.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return text;
    const last = () => tokens[tokens.length - 1];
    // a qualifier at the end («Gambit Accepted», «Smith-Morra Declined», «King's Gambit Reversed») moves to the front
    const qualifier = tokens.length > 1 && QUALIFIERS.has(last()) ? tokens.pop() : null;
    const kind = KIND.get(last()) ?? null;
    if (kind) tokens.pop();
    // a kind before the kind: «Bradford Attack Variation» → «вариант атаки Брэдфорда»
    const inner = kind && tokens.length > 0 && KIND.has(last()) ? KIND.get(tokens.pop()) : null;
    if (qualifier && !kind && Object.hasOwn(PHRASES, tokens.join(' '))) {
        // a fixed phrase with a qualifier after it takes the gender of its last word, when that is known
        const hit = NAMES.get(last());
        if (hit) return `${ADJECTIVES.get(qualifier)[hit.g]} ${PHRASES[tokens.join(' ')]}`;
    }
    const agree = kind ? kind[1] : -1; // the gender adjectives take; for a line with no kind it is the gender of its last noun, found below
    const items = []; // what comes after the kind (or all of the segment when there is none): {text, g} or {adj: forms}
    let i = 0;
    while (i < tokens.length) {
        const token = tokens[i];
        if (MOVE.test(token)) {
            items.push({ text: token, g: 0, move: true });
            i++;
            continue;
        }
        // «King's Knight»: genitive after a kind («вариант королевского коня»), nominative alone («королевский конь»)
        if (POSSESSIVES.has(token) && PIECES.has(tokens[i + 1])) {
            const piece = NAMES.get(tokens[i + 1]);
            const forms = ADJECTIVES.get(token);
            const nom = `${forms[piece.g]} ${piece.nom}`;
            const gen = `${genitiveForm(forms[piece.g])} ${piece.gen}`;
            items.push({ text: kind ? gen : nom, gen, g: piece.g, known: true });
            i += 2;
            continue;
        }
        if (i + 1 < tokens.length && ADJECTIVES.has(`${token} ${tokens[i + 1]}`)) {
            items.push({ adj: ADJECTIVES.get(`${token} ${tokens[i + 1]}`) });
            i += 2;
            continue;
        }
        const compound = token.includes('-') && !NAMES.has(token) ? compoundAt(token) : null;
        if (compound?.adj) {
            items.push({ adj: compound.adj });
            i++;
            continue;
        }
        if (compound?.noun) {
            items.push({ text: kind ? compound.noun.gen : compound.noun.nom, gen: compound.noun.gen, g: compound.noun.g, known: true });
            i++;
            continue;
        }
        if (Object.hasOwn(PLACES, token)) {
            items.push({ adj: ENDINGS.ий.map((end) => PLACES[token] + end) });
            i++;
            continue;
        }
        const hit = nameAt(tokens, i, kind ? 'gen' : 'nom');
        if (hit) {
            items.push({ text: hit.text, gen: hit.gen, g: hit.g, noun: hit.noun, known: true });
            i += hit.len;
            continue;
        }
        if (ADJECTIVES.has(token)) {
            items.push({ adj: ADJECTIVES.get(token) });
            i++;
            continue;
        }
        if (PARTICLES.has(token)) {
            // a surname with particles stays English as a whole
            let j = i;
            while (j < tokens.length - 1 && PARTICLES.has(tokens[j])) j++;
            items.push({ text: tokens.slice(i, j + 1).join(' '), g: 0, unknown: true });
            i = j + 1;
            continue;
        }
        // a word nobody knows stays English
        items.push({ text: token, g: 0, unknown: true });
        i++;
    }
    // a word nobody knows next to translated ones: the whole segment stays English, not half of it in each language
    if (items.some((item) => item.unknown) && items.some((item) => item.known)) return text;
    const nouns = items.filter((item) => item.noun);
    if (!kind && nouns.length === 1 && items.some((item) => item.move || (item.known && !item.noun))) {
        const noun = nouns[0];
        const words = items.filter((item) => item !== noun && !item.adj && !item.move).map((item) => item.gen ?? item.text);
        const moves = items.filter((item) => item.move).map((item) => item.text);
        const adjectives = items.filter((item) => item.adj).map((item) => item.adj[noun.g]);
        const front = qualifier ? [ADJECTIVES.get(qualifier)[noun.g]] : [];
        return [...front, ...adjectives, noun.text, ...words, ...moves].join(' ');
    }
    // adjectives alone ("Classical", "Open", "Pseudo-Spanish") name that kind of variation
    const onlyAdjectives = !kind && items.length > 0 && items.every((item) => item.adj);
    const gender = kind ? agree : onlyAdjectives ? 0 : (items.findLast((item) => item.text !== undefined)?.g ?? 0);
    const head = qualifier ? [ADJECTIVES.get(qualifier)[gender]] : [];
    const tail = [];
    for (const item of items) {
        // with a kind the adjectives agree with it and stand before it; without one they agree with the noun they stand before
        if (item.adj && kind) head.push(item.adj[gender]);
        else tail.push(item.adj ? item.adj[gender] : item.text);
    }
    if (onlyAdjectives) return `${[...head, ...tail].join(' ')} вариант`;
    return [...head, ...(kind ? [kind[0]] : []), ...(inner ? [inner[2]] : []), ...tail].join(' ');
}

// the longest family the name starts with, at a boundary
function familyOf(name) {
    let found = null;
    for (const key of Object.keys(FAMILIES)) {
        if (found !== null && key.length <= found.length) continue;
        if (!name.startsWith(key)) continue;
        const next = name.slice(key.length, key.length + 2);
        if (next === '' || next === ': ' || next === ', ') found = key;
    }
    return found;
}

const SEPARATOR = /(: |, )/;
const MAX_NAME = 400;

/** The Russian name of an opening from its English name; an unknown word stays English. Never throws. */
export function russianName(name) {
    const en = String(name ?? '');
    if (en.length > MAX_NAME) return en;
    let head;
    let rest;
    const family = familyOf(en);
    if (family) {
        head = FAMILIES[family];
        rest = en.slice(family.length);
    } else {
        const cut = en.search(SEPARATOR);
        const first = cut < 0 ? en : en.slice(0, cut);
        head = segment(first);
        head = head.charAt(0).toUpperCase() + head.slice(1);
        rest = cut < 0 ? '' : en.slice(cut);
    }
    // the rest alternates separator, segment, separator, segment…
    const parts = rest.split(SEPARATOR);
    let out = head;
    for (let i = 0; i < parts.length; i++) out += i % 2 === 0 ? (parts[i] ? segment(parts[i]) : '') : parts[i];
    return out;
}

export default {
    opening: {
        name: (p) => russianName(p.name),
    },
    invalid: {
        type: 'Название дебюта ищут по тексту: партии PGN, списку ходов или FEN.',
        empty: 'Нечего искать: текст пуст.',
        long: 'Текст слишком длинный: %{chars} знаков, предел — %{limit}.',
        failed: 'Не удалось разобрать текст.',
    },
};
