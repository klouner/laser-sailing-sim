// ---------- Свой сервер: статистика посещений и общая таблица рекордов ----------
// Сервис на VDS, контракт описан в server/STATS_SERVER.md.
//   base   — адрес без слэша в конце
//   event  — POST: событие статистики
//   top    — GET ?ver=N: десять лучших результатов гонки
//   submit — POST: записать результат
//   ver    — версия физики лодки: после изменения модели старые результаты несравнимы и в таблицу не попадают
// При разработке на своей машине сервер не используется: ничего не пишется, рекорды хранятся в браузере.
// Параметр ?api=1 в адресе включает сервер и там.
const LOCAL = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1|)$/.test(location.hostname) && !/[?&]api=1/.test(location.search);
export const API = LOCAL ? null : { base: 'https://sh38.ru/laser-api', event: '/event', top: '/top', submit: '/submit', ver: 3 };

// ---------- Запасные варианты таблицы рекордов (используются, только если API = null) ----------
// Google Форма + Таблица: { action, nameEntry, timeEntry, csv }
export const GFORM = null;
// Публичный блоб jsonblob.com (https://jsonblob.com/api/jsonBlob/<id>) или сервер с путями /top и /submit
export const LEADERBOARD_URL = '';
