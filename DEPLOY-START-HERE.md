# Завершение подключения

База Supabase pit уже подготовлена. SQL из папки supabase повторно запускать НЕ НУЖНО.

1. Распакуйте архив. Файлы package.json, vercel.json, api/, server/, scripts/, pit/ должны попасть в корень Gennzy/PIT. Не загрузите всю внешнюю папку как вложенный проект. Удалите из Git старые Dockerfile и compose.yaml. Commit и Push.
2. В Vercel Settings выберите Other, корень репозитория, Node.js 24.x, npm install, npm run build, Output Directory public. Сбросьте прежние настройки Docker/container-сборки.
3. Settings → Environment Variables: DATABASE_URL из Supabase Connect → Transaction pooler (6543), OWNER_EMAIL и OWNER_PASSWORD для нового владельца, STO_SLUG=pit, COOKIE_SECURE=true. Полный список с приватным Storage — в README.md. Не используйте пароль от входа Supabase вместо пароля базы. Секреты не публикуйте в GitHub и не отправляйте в чат. Галочки Environment включите для Production, Preview и Development: переменные действуют только в отмеченных окружениях, и preview-деплой вида pit-*.vercel.app иначе их не увидит.
4. Перед Redeploy проверьте строку подключения локально: `npm run check:db`. Скрипт читает DATABASE_URL из окружения или .env.local, не печатает пароль, и подтверждает соединение, TLS, порт 6543, наличие всех 11 таблиц схемы pit и доступность advisory lock. Пароль при этом остаётся у вас и в чат не попадает.
5. Для фото в Storage добавьте SUPABASE_URL, SUPABASE_SECRET_KEY и SUPABASE_STORAGE_BUCKET=pit-photos. PUBLIC_ORIGIN — фактический production-домен Vercel, не адрес GitHub.
6. Redeploy. Откройте /admin/pit, войдите выбранными OWNER_EMAIL/OWNER_PASSWORD. Проверьте запись клиента и фото. /api/health проверяет наличие настройки, но не доказывает доступность базы.

Архив подготовлен и база настроена; изменения ещё не отправлены в ваш GitHub и live-деплой не проверен. Настройка может оставаться на бесплатных тарифах в пределах их лимитов и условий; право коммерческого использования Vercel Hobby нужно проверить отдельно перед продажей.
