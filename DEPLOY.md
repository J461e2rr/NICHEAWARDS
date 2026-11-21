# Голосование на GitHub Pages

GitHub Pages раздаёт файлы из `dist/`. API и общая база голосов работают отдельно, в Cloudflare Worker и D1.

## Автоматическая публикация

1. Поместите исходники в репозиторий GitHub. На GitHub Free для Pages нужен публичный репозиторий. В **Settings → Pages** выберите **GitHub Actions**.
2. Включите поддомен `workers.dev` в Cloudflare. Создайте API-токен с правами **Workers Scripts Write** и **D1 Write** для этого аккаунта.
3. В **Settings → Secrets and variables → Actions** добавьте секрет `CLOUDFLARE_API_TOKEN` и переменную `CLOUDFLARE_ACCOUNT_ID`.
4. В **Actions → Deploy Niche Awards** нажмите **Run workflow**. Workflow создаст базу или переиспользует существующую, применит миграции, развернёт API и проверит его перед публикацией Pages. Ссылка на сайт появится в результате деплоя.

## Ручная публикация

1. Создайте базу командой `npx wrangler d1 create niche-awards-ballots`.
2. Скопируйте `wrangler.example.json` в `wrangler.json`. Вставьте идентификатор D1 и точный origin сайта, например `https://example.github.io` без пути репозитория и без завершающей косой черты.
3. Выполните `npx wrangler d1 migrations apply DB --remote`, затем `npx wrangler deploy`.
4. В `dist/ballot-config.js` укажите адрес Worker с путём `/api/ballot`. Опубликуйте статические файлы из `dist/` (без `dist/server/`) через GitHub Pages. Сохраняйте структуру папок, чтобы ресурсы работали и на `/repository/`.

В базе одна запись на браузерный токен. Сервер хранит хеш токена, выбранные номера и ревизию. Голоса суммируются по актуальным бюллетеням:

```sql
SELECT CAST(j.value AS INTEGER) AS nomination, count(*) AS votes
FROM nomination_ballots AS b, json_each(b.choices) AS j
GROUP BY nomination ORDER BY nomination;
```

Лимит составляет четыре разные номинации на токен. Очистка данных браузера или другой браузер дают новый токен. Для лимита на человека потребуется вход и проверка личности на стороне сервера. Приватный предпросмотр Sites и отдельный Worker для GitHub Pages используют свои базы.
