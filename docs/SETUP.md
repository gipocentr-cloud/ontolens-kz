# Установка платформы OntoLens-KZ на onto.buildingsmart.kz

Схема: на хостинге buildingsmart.kz лежит один неизменяемый файл `hosting/index.html` (загрузчик). Само приложение берётся из этого репозитория на GitHub через jsDelivr — после каждого коммита сайт обновляется сам, перезаливать на хостинг ничего не нужно. Вход и данные — Firebase (Google-вход, база Firestore).

```
onto.buildingsmart.kz/index.html ──► api.github.com (последний коммит)
                                 └─► cdn.jsdelivr.net/gh/<репозиторий>@<коммит>/dist/platform.js
platform.js ──► Firebase Authentication (вход Google) + Firestore (люди, онтологии, версии, оценки)
```

## 1. GitHub (один раз, ~5 минут)

1. Создайте **публичный** репозиторий, например `ontolens-kz` (jsDelivr раздаёт только публичные). В репозитории будет только код и синтетический демонабор; ваши онтологии и оценки лежат в Firestore, не в GitHub.
2. Создайте токен для обновлений: GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   - Repository access: **Only select repositories** → `ontolens-kz`.
   - Permissions → Repository permissions → **Contents: Read and write**. Остальное не трогать.
   - Срок — по вашему выбору; токен можно отозвать в любой момент.
3. Передайте имя репозитория (`аккаунт/ontolens-kz`) и токен тому, кто ведёт разработку.

## 2. Firebase (один раз, 20–30 минут)

1. https://console.firebase.google.com → **Добавить проект** → имя `ontolens-kz` → Google Analytics можно отключить.
2. **Build → Authentication → Get started → Sign-in method → Google** → Enable → укажите email поддержки → Save.
3. **Authentication → Settings → Authorized domains → Add domain** → `onto.buildingsmart.kz`.
4. **Build → Firestore Database → Create database** → расположение `eur3 (europe-west)` → **Start in production mode**.
5. **Firestore → Rules** → заменить содержимое на файл `firebase/firestore.rules` из репозитория → **Publish**.
6. **Project settings (шестерёнка) → General → Your apps → значок `</>`** → имя `ontolens-web`, Firebase Hosting не отмечать → Register app → скопировать объект `firebaseConfig` (apiKey, authDomain, projectId, appId…). Эти значения не секретны: доступ к данным ограничивают правила, а не ключ.
7. Передайте `firebaseConfig` — он записывается в `dist/config.js`.

Первый администратор — `gipocentr@gmail.com` — прописан в правилах: при первом входе его карточка создаётся сама. Остальных людей и онтологии он заводит в разделе «Управление».

## 3. Хостинг и DNS (администратор buildingsmart.kz)

1. Завести поддомен **onto.buildingsmart.kz** на том же хостинге, что и основной сайт (A- или CNAME-запись — как у остальных поддоменов), и выпустить для него **SSL-сертификат** (Let's Encrypt). Без HTTPS вход через Google не работает.
2. Положить в корень поддомена один файл — `hosting/index.html` из репозитория (в нём уже прописано имя репозитория).
3. Больше этот файл трогать не нужно.

## 4. Как идут обновления

- Разработчик коммитит в `main` → загрузчик при следующем открытии берёт новый коммит (кэш браузера — 2 минуты).
- Если GitHub API недоступен (лимит — 60 запросов в час на один IP), загрузчик берёт ветку `main`; тогда jsDelivr может отдавать прежнюю сборку до 12 часов.
- Откат: вернуть предыдущий коммит в `main`.

## 5. Что проверено и что нет

Проверено в этом репозитории (`npm test`, `node tests/platform.mjs`): весь клиент, пути пользователя трёх ролей, правила видимости, перенос оценок на новую версию — на демонстрационном сервере, который повторяет правила Firestore.

Не проверено до первого запуска: сами правила Firestore на настоящем Firebase (эмулятор недоступен в среде разработки), вход Google на onto.buildingsmart.kz, лимиты jsDelivr. Первый вход администратора и один тестовый эксперт — обязательная проверка после установки.

## Демонстрационный режим

Без `firebaseConfig` (или с `?demo` в адресе) платформа работает целиком в браузере: вход — любым адресом без пароля, данные — в localStorage этого браузера, демонабор GeodeticOnt-KZ, пользователи `gipocentr@gmail.com` (администратор), `editor@example.com` (редактор), `expert1@example.com`, `expert2@example.com` (эксперты). Для показа и обучения; к настоящим данным отношения не имеет.
