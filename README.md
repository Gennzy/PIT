# ПИТ v6: Vercel + Supabase

Версия подготовлена из PIT-main.zip репозитория Gennzy/PIT. Интерфейс и 202 модели/поколения сохранены. Сервер асинхронный, production-хранение PostgreSQL вместо SQLite. Отдельная админка, записи, согласования, роли, чат, склад, QR-история и аудит сохранены.

## Что уже сделано в Supabase pit

9 октября 2026 применены три миграции: 11 таблиц в приватной схеме pit, RLS, запрещающие браузерные политики и отозванные права anon/authenticated; составные внешние ключи СТО, запрет пересекающихся записей, индексы, общий лимит попыток входа. Создан приватный bucket pit-photos. Напоминания в приложении каждые 5 минут выполняются PostgreSQL Cron, не таймером Vercel. SQL из папки supabase повторно запускать НЕ НУЖНО. Данные BeatDesk не менялись.

## Завершение деплоя

1. Сделайте резервную копию Git. Замените файлы в корне Gennzy/PIT этой версией. package.json, vercel.json, api/, server/, scripts/, pit/ должны находиться в корне, не во вложенной папке. Удалите старые Dockerfile и compose.yaml из Git, затем Commit/Push.
2. Vercel Project Settings: Framework Other, Root Directory — корень репозитория, Node.js 24.x, Install Command npm install, Build Command npm run build, Output Directory public. Уберите старые настройки Docker/container-сборки.
3. Добавьте переменные ниже в Production Environment Variables. Не подключайте неизвестные Preview/PR к production-секретам.
4. Redeploy после сохранения окружения. Откройте /admin/pit и /app/pit. Владелец создаётся транзакционно при первом запросе с заполненными DATABASE_URL, OWNER_EMAIL и OWNER_PASSWORD. Демо-пользователей нет.

## Переменные окружения

| Имя | Значение |
| --- | --- |
| DATABASE_URL | Supabase pit → Connect → Transaction pooler, порт 6543. URI PostgreSQL с паролем базы; спецсимволы пароля URL-кодировать. Не прямой IPv6 endpoint. |
| OWNER_EMAIL | Выбранный вами email владельца |
| OWNER_PASSWORD | Уникальный пароль 10–128 символов, желательно не менее 16 |
| STO_SLUG | pit |
| STO_NAME | Название вашего СТО |
| COOKIE_SECURE | true |
| TZ | Europe/Moscow |
| SUPABASE_URL | https://ogbompjdfoawhjjscqjc.supabase.co |
| SUPABASE_SECRET_KEY | Серверный Secret key из Settings → API Keys, либо legacy service_role. Не anon/publishable. |
| SUPABASE_STORAGE_BUCKET | pit-photos |
| NEXT_PUBLIC_SUPABASE_URL | https://ogbompjdfoawhjjscqjc.supabase.co — только если фронтенд обращается к Supabase напрямую |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Publishable key (sb_publishable_…) из Settings → API Keys. Это аналог старого anon-ключа: он публичный по назначению, но задавайте его в Vercel Environment Variables, а не в коде |
| PUBLIC_ORIGIN | Фактический https://…vercel.app без конечного слеша |
| AUTH_RATE_SECRET | Случайная секретная строка не менее 32 символов |

Секреты НЕ размещать в GitHub, frontend, NEXT_PUBLIC_* или чате. Пароль базы — не пароль от входа Supabase. Проверка TLS включена: если подключение требует официальный CA Supabase, задайте PG_CA_CERT из настроек проекта; TLS не отключайте.

Ключ SUPABASE_SECRET_KEY включает сохранение новых фото в приватном Storage с авторизованной выдачей через сервер. Без этого ключа фото реально сохраняются в PostgreSQL, но расходуют лимит базы. Старые фото при переключении не исчезают.

Пакеты `@supabase/supabase-js` и `@supabase/ssr` установлены, но код пока их не импортирует: вся работа идёт через собственный сервер на `pg`. Учтите, что префикс `NEXT_PUBLIC_` инлайнит только бандлер Next.js, а здесь фронтенд — статические `pit/*.js`, которые `scripts/build.js` копирует в `public/` без сборки. Если фронтенду понадобится Supabase напрямую, значение нужно отдавать явно: через существующий `/api/public` или собственной подстановкой в `scripts/build.js`. Публикацию `SUPABASE_SECRET_KEY` в браузер делать нельзя.

## Доступ и эксплуатация

Вход сохранён из v5: scrypt + HttpOnly/SameSite cookie, это НЕ Supabase Auth. Только Vercel использует серверную PostgreSQL-учётную запись, которая может обходить RLS; роли/СТО дополнительно проверяются в каждом API. Схему pit не добавляйте в Exposed schemas. Все изменяющие расписание транзакции используют общий advisory lock, Cron использует тот же lock. Для больших объёмов глобальную блокировку следует оптимизировать после нагрузочного тестирования.

Смена OWNER_PASSWORD в Vercel не сбрасывает уже созданного владельца: менять пароль нужно в приложении. Для отдельного покупателя — npm run provision с NEW_STO_* и NEW_OWNER_* из customer.env.example: новый независимый owner_key. Админка создаёт несколько СТО одного владельца. Подписки и SaaS-оплата не реализованы.

/api/health сообщает версию и наличие DATABASE_URL, но не доказывает соединение. После деплоя проверьте вход владельца, настройки, регистрацию клиента, автомобиль, запись, создание мастера, приёмку, фото/согласование, чат, завершение, склад и QR/отзыв ссылки. QR v5 ограничен URL 106 байтами — используйте короткий production-домен, длинный preview-домен может не поместиться.

## Бесплатный режим

Платные тарифы/add-ons не включались. Supabase Free ограничивает размер базы/Storage/трафик и может приостанавливать неактивные проекты. Это не безлимитный production. Перед продажей СТО отдельно проверьте право коммерческого использования Vercel Hobby; бесплатный коммерческий хостинг навсегда не обещается.

Напоминания — внутри приложения, не SMS, Telegram или Web Push. Камеры требуют реальный поток. OCR, автоматическая диагностика, платежи и внешние сообщения не подключены. Экспорт админки не является полным восстановимым бэкапом PostgreSQL/Storage. Старые данные SQLite не импортировались: файла базы в присланном архиве нет. Если старый сервер содержит реальные записи, сохраните его бэкап перед переключением.

## Проверки

Node.js 24: npm test. API-регрессии используют SQLite только как отдельный тестовый драйвер, запрещённый при VERCEL. Production без DATABASE_URL не переключается на временную базу. PostgreSQL отдельно проверен SQL-тестами в вашем Supabase с полным откатом тестовых записей. Реальный Node→PostgreSQL через секреты, Storage upload и live Vercel должны быть проверены после заполнения окружения.

Локальный PostgreSQL-запуск: npm install; заполнить .env; node --env-file=.env server/server.js. Для локального HTTP COOKIE_SECURE=false. Сборка npm run build не использует секреты.
