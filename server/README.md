# Таблица лидеров на своём VDS

Маленький API на Node.js без зависимостей. Хранит результаты в JSON-файле.
Нужны: Ubuntu/Debian, Node.js 18+, поддомен (например `laser-top.ваш-домен.ru`) с A-записью на IP сервера.

## Установка (5 минут)

```bash
# 1. Node.js, если его нет
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs

# 2. Файлы сервера
sudo mkdir -p /opt/laser-leaderboard /var/lib/laser-leaderboard
sudo curl -fsSL https://raw.githubusercontent.com/klouner/laser-sailing-sim/main/server/leaderboard-server.js -o /opt/laser-leaderboard/leaderboard-server.js
sudo chown -R www-data:www-data /var/lib/laser-leaderboard

# 3. Служба
sudo curl -fsSL https://raw.githubusercontent.com/klouner/laser-sailing-sim/main/server/laser-leaderboard.service -o /etc/systemd/system/laser-leaderboard.service
sudo systemctl daemon-reload && sudo systemctl enable --now laser-leaderboard
curl -s http://127.0.0.1:8787/health      # → {"ok":true,"count":0}

# 4. HTTPS через Caddy (сертификат выпускается автоматически)
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
# в /etc/caddy/Caddyfile — две строки (замените домен):
#   laser-top.example.com {
#       reverse_proxy 127.0.0.1:8787
#   }
sudo systemctl reload caddy
curl -s https://laser-top.example.com/top   # → []
```

Если на сервере уже стоит nginx, вместо Caddy используйте `server/nginx.conf` и `certbot --nginx`.

## Подключение к сайту

В `js/config.js` укажите адрес:

```js
export const LEADERBOARD_URL = 'https://laser-top.example.com';
```

После пуша в `main` страница начнёт читать и записывать общий топ-10.

## Эндпоинты

- `GET /top` — топ-10 `[ { name, time, date } ]`
- `POST /submit` `{ "name": "Имя", "time": 151.2 }` — добавить результат, вернёт топ-10
- `GET /health` — состояние

Защита: имя до 18 символов, время от 20 с до 1 ч, не чаще одной записи в 10 с с одного IP, хранится 100 лучших.
Переменная `ORIGIN` в юните ограничивает CORS адресом сайта.
