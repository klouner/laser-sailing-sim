// Общая таблица лидеров. Пусто — таблица хранится только в браузере игрока.
// Чтобы рекорды были общими для всех, поднимите server/leaderboard-server.js на своём VDS (см. server/README.md)
// или worker/leaderboard-worker.js на Cloudflare, и укажите адрес по HTTPS, например:
// export const LEADERBOARD_URL = 'https://laser-top.example.com';
// Временный вариант без сервера: публичный блоб на jsonblob.com, например
// export const LEADERBOARD_URL = 'https://jsonblob.com/api/jsonBlob/1234567890123456789';
export const LEADERBOARD_URL = '';
