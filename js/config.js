// ---------- Общая таблица лидеров ----------
// Вариант 1 (рекомендуется без сервера): Google Форма + Google Таблица.
//   action    — адрес отправки формы: https://docs.google.com/forms/d/e/<ID>/formResponse
//   nameEntry — поле «Имя»  (entry.XXXXXXX из предзаполненной ссылки)
//   timeEntry — поле «Время» (entry.XXXXXXX)
//   csv       — публичная таблица ответов: https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv
export const GFORM = null;
// пример:
// export const GFORM = {
//   action: 'https://docs.google.com/forms/d/e/1FAIpQL.../formResponse',
//   nameEntry: 'entry.1234567890', timeEntry: 'entry.987654321',
//   csv: 'https://docs.google.com/spreadsheets/d/1AbC.../gviz/tq?tqx=out:csv',
// };

// Вариант 2: свой сервер (server/) или Cloudflare Worker (worker/) — адрес по HTTPS
// или публичный блоб jsonblob.com (https://jsonblob.com/api/jsonBlob/<id>)
export const LEADERBOARD_URL = '';
