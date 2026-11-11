# Сборка Babylon.js

`../vendor/babylon.js` — это Babylon.js, собранный в один файл только из тех частей движка, которыми пользуется
тренажёр. Полная библиотека весит 8,4 МБ, эта сборка 2,6 МБ (около 600 КБ в сжатом виде).

Пересобрать после изменения `babylon-entry.js`:

```bash
mkdir /tmp/bjs && cd /tmp/bjs && npm init -y && npm install @babylonjs/core esbuild
cp <репозиторий>/v2/vendor-src/babylon-entry.js entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2020 --outfile=<репозиторий>/v2/vendor/babylon.js
```

Если в консоли браузера появляется ошибка вида «… needs to be imported», в `babylon-entry.js` не хватает
модуля с побочным эффектом: добавьте его импорт и пересоберите.
