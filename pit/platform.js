"use strict";
const P = {
  user: null,
  companies: [],
  company: null,
  view: "list",
  branch: null,
  audit: [],
  logo: null,
  mfaRequired: true,
};
const root = document.getElementById("platform-root");
const E = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const features = {
  camera: "Камеры",
  approve: "Согласование",
  lamp: "Справочник ламп",
  history: "История и QR",
  waitlist: "Лист ожидания",
  fixprice: "Фиксированный прайс",
  chat: "Чат",
  storage: "Хранение шин",
  voice: "Голосовой ввод",
};
const hm = (v) =>
  String(Math.floor(v / 60)).padStart(2, "0") +
  ":" +
  String(v % 60).padStart(2, "0");
const min = (v) => +v.split(":")[0] * 60 + +v.split(":")[1];
async function api(path = "", method = "GET", data) {
  const r = await fetch("/api/platform/" + path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const b = await r.json();
  if (!r.ok) {
    const e = new Error(b.error || "Не удалось выполнить запрос");
    e.status = r.status;
    throw e;
  }
  return b;
}
const input = (label, name, value = "", type = "text", extra = "") =>
  `<label class="field"><span>${E(label)}</span><input name="${E(name)}" value="${E(value)}" type="${E(type)}" ${extra}></label>`;
const panel = (title, html) =>
  `<section class="platform-panel"><h2>${E(title)}</h2>${html}</section>`;
const err = '<p class="error-text form-error" role="alert"></p>';
const action = (name, label, cls = "secondary") =>
  `<button type="button" class="${cls}" data-action="${name}">${label}</button>`;
const status = (c) =>
  c.status === "paused"
    ? "Приостановлена"
    : c.expired
      ? "Срок истёк"
      : c.accessUntil
        ? "Пилот / до " + c.accessUntil
        : "Активна";
const badge = (c) =>
  `<span class="platform-status ${c.status === "paused" || c.expired ? "off" : "on"}">${E(status(c))}</span>`;
function toast(message, error = false) {
  const t = document.getElementById("platform-toast");
  t.textContent = message;
  t.className = "toast show" + (error ? " error" : "");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = "toast"), 7000);
}
function heading(title, sub, buttons = "") {
  return `<header class="platform-heading"><div><p class="eyebrow">ПИТ / ПЛАТФОРМА</p><h1>${E(title)}</h1><p class="muted">${E(sub)}</p></div><div class="button-row">${buttons}</div></header>`;
}
function passwordFields() {
  return `<div class="password-tools">${input("Начальный пароль владельца", "ownerPassword", "", "password", 'required minlength="16" maxlength="128" autocomplete="new-password"')}<div class="button-row">${action("password", "Сгенерировать")}${action("show-password", "Показать")}</div><p class="muted">Передайте пароль отдельно защищённым каналом. Он не появится в журнале или ссылке.</p></div>`;
}
function ownerFields(o = {}) {
  return `<div class="platform-fields">${input("Имя владельца", "ownerName", o.name, "text", 'required maxlength="80"')}${input("Email владельца", "ownerEmail", o.email, "email", 'required autocomplete="off"')}${input("Телефон владельца", "ownerPhone", o.phone, "tel", 'maxlength="40"')}</div>${passwordFields()}`;
}
function list() {
  const count = P.companies.length,
    bs = P.companies.reduce((n, c) => n + c.branches.length, 0),
    active = P.companies.filter(
      (c) => c.status === "active" && !c.expired,
    ).length;
  return (
    heading(
      "Один продукт. Все компании.",
      "Подключение, бренд и доступ — отдельно от рабочих кабинетов СТО.",
      action("new", "＋ Подключить компанию", "primary"),
    ) +
    `<div class="platform-metrics"><article><small>Компаний</small><strong>${count}</strong></article><article><small>Филиалов</small><strong>${bs}</strong></article><article><small>С доступом</small><strong>${active}</strong></article></div><label class="field search-field"><span>Найти компанию</span><input id="company-search" placeholder="Название, код ссылки или email владельца"></label><div id="company-list" class="company-grid">${cards(P.companies)}</div><p class="platform-note">Владелец компании не получает доступ к этой панели. Клиентские заказы и автомобили здесь не отображаются.</p>`
  );
}
function cards(cs) {
  return (
    cs
      .map(
        (c) =>
          `<article class="company-card"><div class="company-card-top"><span class="company-monogram">${c.branches[0]?.config.logo ? `<img src="${E(c.branches[0].config.logo)}" alt="">` : E(c.name.slice(0, 1))}</span>${badge(c)}</div><h2>${E(c.name)}</h2><p>${c.branches.length} филиал(а) · ${E(c.branches[0]?.owner?.email || "Без владельца")}</p><div class="company-links">${c.branches.map((b) => `<span>/${E(b.slug)}</span>`).join("")}</div><button class="secondary" data-company="${E(c.id)}">Управлять компанией →</button></article>`,
      )
      .join("") ||
    panel(
      "Компаний пока нет",
      "<p>Подключите первую компанию: её владелец получит отдельный аккаунт и собственное пространство.</p>",
    )
  );
}
function create() {
  return (
    heading(
      "Подключить компанию",
      "Независимый владелец, чистые данные и своя ссылка.",
      action("list", "← Все компании"),
    ) +
    `<form id="company-create">${panel("Компания и первый филиал", `<div class="platform-fields">${input("Название компании", "name", "", "text", 'required maxlength="80"')}${input("Код ссылки", "slug", "", "text", 'required pattern="[a-z0-9](?:[a-z0-9]|-){2,49}" maxlength="50" placeholder="sever-auto"')}${input("Часовой пояс IANA", "timezone", "Europe/Moscow", "text", 'required list="timezones"')}${input("Фирменный цвет", "accent", "#ec0618", "color", "required")}${input("Краткое название СТО", "shortName", "ПИТ", "text", 'required maxlength="24"')}${input("Доступ включительно до (UTC)", "accessUntil", "", "date")}</div><p class="muted">Пустая дата — без ограничения срока. Ссылка будет /app/ваш-код; код после создания не меняется.</p>`)}${panel("Владелец компании", ownerFields())}<div class="platform-save"><span>Существующие клиенты и заказы не копируются.</span><button class="primary" type="submit">Создать компанию и доступ</button></div>${err}</form>`
  );
}
function detail() {
  const c = P.company,
    o = c.branches[0]?.owner || {};
  return (
    heading(
      c.name,
      "Филиалы одной компании объединены владельцем, но хранят рабочие данные отдельно.",
      action("list", "← Все компании"),
    ) +
    `<div class="platform-two">${panel("Доступ к продукту", `<form id="company-access">${badge(c)}<div class="platform-fields">${input("Название компании", "name", c.name, "text", 'required maxlength="80"')}<label class="field"><span>Состояние доступа</span><select name="status"><option value="active" ${c.status === "active" ? "selected" : ""}>Активен</option><option value="paused" ${c.status === "paused" ? "selected" : ""}>Приостановлен</option></select></label>${input("Доступ включительно до (UTC)", "accessUntil", c.accessUntil, "date")}</div><p class="muted">Приостановка или истечение срока закрывают доступ ко всем филиалам и отзывают сессии. Данные сохраняются. Продление не списывает деньги.</p><button class="primary" type="submit">Сохранить доступ</button>${err}</form>`)}${panel("Владелец и передача доступа", `<p><b>${E(o.name)}</b><br>${E(o.email)}</p><p class="muted">Для входа используйте кабинет конкретного филиала. Пароль в панели не хранится в открытом виде и не показывается повторно.</p>${action("owner", "Назначить владельца / новый пароль")}<p class="muted">Новый пароль применяется к владельцам всех филиалов. Старые сессии владельца отзываются.</p>`)}</div>${heading("Филиалы", "Бренд, контакты, прайс, график и функции настраиваются для каждого филиала.", action("new-branch", "＋ Добавить филиал", "primary"))}<div class="company-grid">${c.branches.map((b) => `<article class="company-card"><p class="eyebrow">/${E(b.slug)}</p><h2>${E(b.config.name)}</h2><p>${E(b.config.timezone || "Europe/Moscow")} · ${hm(b.config.open)}–${hm(b.config.close)}<br>${b.config.posts} поста · ${b.config.services.length} услуг</p><p>${E(b.config.addr || "Адрес не задан")}</p><div class="button-row"><button class="primary" data-branch="${E(b.slug)}">Настроить</button><button class="secondary" data-copy="${E(b.appPath)}">Скопировать ссылку</button></div><div class="branch-links"><a href="${E(b.appPath)}" target="_blank" rel="noopener">Приложение ↗</a><a href="${E(b.adminPath)}" target="_blank" rel="noopener">Кабинет, команда и клиенты ↗</a></div></article>`).join("")}</div>`
  );
}
function newBranch() {
  return (
    heading("Новый филиал", P.company.name, action("detail", "← К компании")) +
    `<form id="branch-create">${panel("Данные филиала", `<div class="platform-fields">${input("Название филиала", "name", "", "text", 'required maxlength="80"')}${input("Код ссылки", "slug", "", "text", 'required pattern="[a-z0-9](?:[a-z0-9]|-){2,49}" placeholder="sever-centre"')}</div><p class="muted">Краткое название СТО, логотип, цвет и часовой пояс берутся из первого филиала. Прайс и график начнутся со стандартных настроек — проверьте их перед выдачей ссылки.</p><p class="muted">Создаётся отдельный аккаунт того же владельца с текущим паролем первого филиала. Данные клиентов не копируются.</p>`)}<button type="submit" class="primary">Создать филиал</button>${err}</form>`
  );
}
function ownerView() {
  return (
    heading(
      "Назначить владельца",
      P.company.name,
      action("detail", "← К компании"),
    ) +
    `<form id="owner-reset">${panel("Новые реквизиты доступа", ownerFields(P.company.branches[0]?.owner))}<p class="platform-note">Аккаунты владельца во всех филиалах будут обновлены. Передайте новый пароль владельцу отдельно.</p><button class="primary" type="submit">Обновить владельца и отозвать сессии</button>${err}</form>`
  );
}
function serviceRow(s) {
  return `<div class="platform-price-row">${input("Код", "id", s.id, "text", 'required pattern="(?:[a-z0-9_]|-)+" maxlength="40"')}${input("Услуга", "n", s.n, "text", 'required maxlength="80"')}${input("Цена, ₽", "price", s.price, "number", 'required min="0" max="10000000"')}${input("Минуты", "min", s.min, "number", 'required min="10" max="720"')}<label class="check"><input type="checkbox" name="radius" ${s.radius ? "checked" : ""}>Доплата R</label><button type="button" class="secondary danger" data-action="remove-service" aria-label="Удалить услугу">Удалить</button></div>`;
}
function branchView() {
  const b = P.branch,
    c = b.config;
  return (
    heading(
      c.name,
      "Настройки филиала /" + b.slug,
      action("detail", "← К компании"),
    ) +
    `<form id="branch-settings">${panel("Название и бренд", `<div class="platform-fields">${input("Название филиала", "name", c.name, "text", 'required maxlength="80"')}${input("Краткое название СТО", "shortName", c.shortName || "ПИТ", "text", 'required maxlength="24"')}${input("Фирменный цвет", "accent", c.accent, "color", "required")}${input("Часовой пояс IANA", "timezone", c.timezone || "Europe/Moscow", "text", 'required list="timezones"')}</div><div class="platform-logo-row"><div class="logo-preview" id="logo-preview">${c.logo ? `<img src="${E(c.logo)}" alt="Текущий логотип">` : "Без логотипа"}</div><div><label class="field"><span>Логотип · PNG, JPEG или WebP до 3 МБ</span><input id="brand-logo" type="file" accept="image/png,image/jpeg,image/webp"></label><p class="muted">Приводится к PNG 512×512. Логотип компании показывается рядом с названием СТО. Бренд ПИТ, значок вкладки и иконка установки остаются общими. Подготовьте квадратный знак с полями.</p>${action("clear-logo", "Убрать логотип")}</div></div>`)}${panel("Контакты и расписание", `<div class="platform-fields">${input("Адрес", "addr", c.addr, "text", 'maxlength="200"')}${input("Телефон", "phone", c.phone, "tel", 'maxlength="40"')}${input("Рабочих постов", "posts", c.posts, "number", 'required min="1" max="16"')}${input("Открытие", "open", hm(c.open), "time", "required")}${input("Закрытие", "close", hm(c.close), "time", "required")}</div><div class="platform-days">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<label class="check"><input type="checkbox" name="day" value="${d}" ${c.days.includes(d) ? "checked" : ""}>${["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"][d]}</label>`).join("")}</div><p class="muted">Время записи и свободных окон рассчитывается в часовом поясе этого филиала.</p>`)}${panel("Прайс и длительность", `<div id="platform-services">${c.services.map(serviceRow).join("")}</div>${action("add-service", "＋ Добавить услугу")}<p class="muted">Доплата R: +250 ₽ и +5 минут за каждый R сверх R14. Старые заказы сохраняют свой прайс.</p>`)}${panel(
      "Функции",
      `<div class="platform-features">${Object.entries(features)
        .map(
          ([k, n]) =>
            `<label class="check"><input type="checkbox" name="feature" value="${k}" ${c.f[k] ? "checked" : ""}>${E(n)}</label>`,
        )
        .join(
          "",
        )}</div><p class="muted">Переключатели — настройка продукта, не платёжные тарифы. Камерам нужен реальный поток; OCR и внешний push не подключены.</p>`,
    )}<div class="platform-save"><span>Версия настроек ${b.revision}. Изменения сохраняются на сервере.</span><button class="primary" type="submit">Сохранить настройки филиала</button></div>${err}</form>`
  );
}
const logNames = {
  "platform.login": "Вход администратора",
  "company.create": "Компания подключена",
  "company.access.update": "Доступ изменён",
  "company.owner.reset": "Владелец обновлён",
  "company.branch.create": "Филиал добавлен",
  "company.branch.settings": "Настройки филиала",
};
const logTarget = (id) =>
  id === "platform"
    ? "Платформа"
    : P.companies.find((c) => c.id === id)?.name || id;
function logs() {
  return (
    heading(
      "Журнал платформы",
      "Последние 100 событий. Пароли и содержимое клиентских заказов не записываются.",
      action("list", "← Все компании"),
    ) +
    panel(
      "Действия администратора",
      `<div class="table-wrap"><table><thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Компания / филиал</th></tr></thead><tbody>${P.audit.map((x) => `<tr><td>${E(new Date(x.created).toLocaleString("ru-RU"))}</td><td>${E(x.actor)}</td><td>${E(logNames[x.action] || x.action)}</td><td>${E(logTarget(x.target))}</td></tr>`).join("") || '<tr><td colspan="4">Действий пока нет</td></tr>'}</tbody></table></div>`,
    )
  );
}
function login() {
  return `<main class="platform-login"><div class="platform-login-mark"><span class="pit-app-brand" role="img" aria-label="ПИТ"><img class="pit-app-mark" src="/assets/brand/mark-3d.svg" alt="" width="40" height="40"><img class="pit-app-wordmark" src="/assets/brand/wordmark-white.svg" alt="" width="84" height="30"></span><span>PLATFORM</span></div><p class="eyebrow">УПРАВЛЕНИЕ ПРОДУКТОМ</p><h1>Вход администратора платформы</h1><p class="muted">Отдельный доступ для подключения компаний. Email и пароль владельца СТО здесь не работают.</p><form id="platform-auth">${input("Email администратора", "email", "", "email", 'required autocomplete="username"')}${input("Пароль администратора", "password", "", "password", 'required maxlength="128" autocomplete="current-password"')}${P.mfaRequired?`<div class="platform-mfa"><label class="field"><span>Код из приложения-аутентификатора</span><input name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required placeholder="000000" aria-describedby="mfa-hint"></label><p id="mfa-hint" class="muted">Введите текущий 6-значный код. Код меняется каждые 30 секунд; использованный код нельзя применять повторно.</p></div>`:""}<button type="submit" class="primary wide">Войти в платформу</button>${err}</form><p class="platform-note">Доступ задаётся в защищённом окружении сервера. Публичной регистрации администраторов нет.</p></main>`;
}
function render() {
  if (!P.user) {
    root.innerHTML = login();
    return;
  }
  const views = {
    list,
    create,
    detail,
    "new-branch": newBranch,
    owner: ownerView,
    branch: branchView,
    logs,
  };
  root.innerHTML = `<div class="platform-layout"><aside class="platform-sidebar"><button class="platform-logo" data-action="list"><span class="pit-app-brand" role="img" aria-label="ПИТ"><img class="pit-app-mark" src="/assets/brand/mark-3d.svg" alt="" width="40" height="40"><img class="pit-app-wordmark" src="/assets/brand/wordmark-white.svg" alt="" width="84" height="30"></span><small>PLATFORM</small></button><p class="muted">Одна платформа.<br>Отдельные компании.</p><nav aria-label="Панель платформы"><button class="${P.view === "list" ? "active" : ""}" data-action="list">Компании</button><button class="${P.view === "create" ? "active" : ""}" data-action="new">Подключить компанию</button><button class="${P.view === "logs" ? "active" : ""}" data-action="logs">Журнал платформы</button></nav><footer><small>${E(P.user.email)}</small>${action("logout", "Выйти")}</footer></aside><main class="platform-main"><div class="platform-top"><span>Администратор платформы / не кабинет СТО</span>${action("refresh", "Обновить")}</div><div class="platform-content">${(views[P.view] || list)()}</div></main></div><datalist id="timezones"><option value="Europe/Moscow"><option value="Europe/Kaliningrad"><option value="Asia/Yekaterinburg"><option value="Asia/Novosibirsk"><option value="Asia/Vladivostok"><option value="Europe/Istanbul"></datalist>`;
}
async function refresh() {
  P.companies = await api("companies");
  if (P.company)
    P.company = P.companies.find((c) => c.id === P.company.id) || null;
  if (P.branch)
    P.branch =
      P.company?.branches.find((b) => b.slug === P.branch.slug) || null;
}
function show(view) {
  P.view = view;
  render();
  window.scrollTo(0, 0);
  root.querySelector("h1")?.setAttribute("tabindex", "-1");
  root.querySelector("h1")?.focus({ preventScroll: true });
}
document.addEventListener("click", async (event) => {
  const b = event.target.closest("button");
  if (!b || b.disabled) return;
  const a = b.dataset.action;
  try {
    if (b.dataset.company) {
      P.company = P.companies.find((c) => c.id === b.dataset.company);
      show("detail");
      return;
    }
    if (b.dataset.branch) {
      P.branch = P.company.branches.find((x) => x.slug === b.dataset.branch);
      P.logo = P.branch.config.logo;
      show("branch");
      return;
    }
    if (b.dataset.copy) {
      try {
        await navigator.clipboard.writeText(location.origin + b.dataset.copy);
        toast("Ссылка приложения скопирована");
      } catch {
        prompt("Скопируйте ссылку", location.origin + b.dataset.copy);
      }
      return;
    }
    if (a === "password") {
      const el = b.closest("form").elements.ownerPassword;
      el.value = Array.from(crypto.getRandomValues(new Uint8Array(16)), (v) =>
        v.toString(16).padStart(2, "0"),
      ).join("");
      toast("Пароль создан. Передайте его отдельно.");
      return;
    }
    if (a === "show-password") {
      const el = b.closest("form").elements.ownerPassword;
      el.type = el.type === "password" ? "text" : "password";
      b.textContent = el.type === "password" ? "Показать" : "Скрыть";
      return;
    }
    if (a === "clear-logo") {
      P.logo = null;
      document.getElementById("logo-preview").textContent = "Без логотипа";
      document.getElementById("brand-logo").value = "";
      return;
    }
    if (a === "add-service") {
      document
        .getElementById("platform-services")
        .insertAdjacentHTML(
          "beforeend",
          serviceRow({
            id: "service_" + Date.now(),
            n: "Новая услуга",
            price: 1000,
            min: 30,
          }),
        );
      return;
    }
    if (a === "remove-service") {
      if (document.querySelectorAll(".platform-price-row").length < 2)
        throw Error("Нужна хотя бы одна услуга");
      b.closest(".platform-price-row").remove();
      return;
    }
    if (["new", "list", "detail", "new-branch", "owner"].includes(a)) {
      show(a === "new" ? "create" : a);
      return;
    }
    b.disabled = true;
    if (a === "logs") {
      P.audit = await api("audit");
      show("logs");
    }
    if (a === "logout") {
      await api("logout", "POST", {});
      P.user = null;
      P.company = null;
      P.companies = [];
      render();
    }
    if (a === "refresh") {
      await refresh();
      render();
      toast("Данные обновлены");
    }
  } catch (e) {
    toast(e.message, true);
    if (e.status === 401) {
      P.user = null;
      render();
    }
  } finally {
    if (b.isConnected) b.disabled = false;
  }
});
document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const f = event.target,
    b = f.querySelector("button[type=submit]"),
    error = f.querySelector(".form-error"),
    v = Object.fromEntries(new FormData(f));
  if (error) error.textContent = "";
  b.disabled = true;
  try {
    if (f.getAttribute("id") === "platform-auth") {
      P.user = await api("login", "POST", v);
      f.querySelector('[name=password]').value="";
      if(f.querySelector('[name=otp]'))f.querySelector('[name=otp]').value="";
      await refresh();
      show("list");
      return;
    }
    const owner = {
      name: v.ownerName,
      email: v.ownerEmail,
      phone: v.ownerPhone,
      password: v.ownerPassword,
    };
    if (f.getAttribute("id") === "company-create") {
      P.company = await api("companies", "POST", {
        name: v.name,
        slug: v.slug,
        accessUntil: v.accessUntil || null,
        owner,
        config: {
          timezone: v.timezone,
          accent: v.accent,
          shortName: v.shortName,
        },
      });
      await refresh();
      show("detail");
      toast("Компания и отдельный аккаунт владельца созданы");
    }
    if (f.getAttribute("id") === "company-access") {
      if (
        (v.status === "paused" ||
          (v.accessUntil &&
            v.accessUntil < new Date().toISOString().slice(0, 10))) &&
        !confirm(
          "Закрыть доступ всех филиалов этой компании? Данные сохранятся, сессии будут отозваны.",
        )
      )
        return;
      P.company = await api("companies/" + P.company.id, "PATCH", {
        name: v.name,
        status: v.status,
        accessUntil: v.accessUntil || null,
        revision: P.company.revision,
      });
      await refresh();
      show("detail");
      toast("Состояние доступа сохранено");
    }
    if (f.getAttribute("id") === "owner-reset") {
      if (
        !confirm(
          "Обновить владельца во всех филиалах и отозвать прежние сессии владельца?",
        )
      )
        return;
      P.company = await api("companies/" + P.company.id + "/owner", "PUT", {
        owner,
        revision: P.company.revision,
      });
      await refresh();
      show("detail");
      toast("Владелец обновлён; прежние сессии отозваны");
    }
    if (f.getAttribute("id") === "branch-create") {
      P.company = await api("companies/" + P.company.id + "/branches", "POST", {
        name: v.name,
        slug: v.slug,
        revision: P.company.revision,
      });
      await refresh();
      show("detail");
      toast("Филиал создан; проверьте прайс и график");
    }
    if (f.getAttribute("id") === "branch-settings") {
      const fd = new FormData(f),
        enabled = fd.getAll("feature"),
        config = {
          ...P.branch.config,
          name: v.name,
          addr: v.addr,
          phone: v.phone,
          shortName: v.shortName,
          timezone: v.timezone,
          accent: v.accent,
          logo: P.logo,
          posts: +v.posts,
          open: min(v.open),
          close: min(v.close),
          days: fd.getAll("day").map(Number),
          f: {
            ...P.branch.config.f,
            ...Object.fromEntries(
              Object.keys(features).map((k) => [k, enabled.includes(k)]),
            ),
          },
          services: [...f.querySelectorAll(".platform-price-row")].map(
            (row) => {
              const vals = Object.fromEntries(
                [...row.querySelectorAll("input")].map((x) => [
                  x.name,
                  x.type === "checkbox"
                    ? x.checked
                    : ["price", "min"].includes(x.name)
                      ? +x.value
                      : x.value,
                ]),
              );
              return vals;
            },
          ),
        };
      P.company = await api(
        "companies/" + P.company.id + "/branches/" + P.branch.slug,
        "PUT",
        {
          config,
          revision: P.branch.revision,
          companyRevision: P.company.revision,
        },
      );
      await refresh();
      show("branch");
      toast("Настройки филиала сохранены");
    }
  } catch (e) {
    if (error) error.textContent = e.message;
    else toast(e.message, true);
    if(f.getAttribute("id")==="platform-auth"){
      const otp=f.querySelector('[name=otp]');if(otp)otp.value="";
    } else if (e.status === 401) {
      P.user = null;
      render();
      const message=root.querySelector(".form-error");if(message)message.textContent=e.message;
    }
  } finally {
    if (b.isConnected) b.disabled = false;
  }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "company-search") {
    const q = event.target.value.trim().toLowerCase();
    document.getElementById("company-list").innerHTML = cards(
      P.companies.filter((c) =>
        (
          c.name +
          " " +
          c.branches.map((b) => b.slug + " " + (b.owner?.email || "")).join(" ")
        )
          .toLowerCase()
          .includes(q),
      ),
    );
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.id !== "brand-logo") return;
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (
      file.size > 3 * 1024 * 1024 ||
      !["image/png", "image/jpeg", "image/webp"].includes(file.type)
    )
      throw Error("Выберите PNG, JPEG или WebP до 3 МБ");
    const url = URL.createObjectURL(file),
      img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(Error("Изображение не удалось прочитать"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 512;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#090909";
    ctx.fillRect(0, 0, 512, 512);
    const scale = 448 / Math.max(img.width, img.height);
    ctx.drawImage(
      img,
      (512 - img.width * scale) / 2,
      (512 - img.height * scale) / 2,
      img.width * scale,
      img.height * scale,
    );
    URL.revokeObjectURL(url);
    P.logo = canvas.toDataURL("image/png");
    document.getElementById("logo-preview").innerHTML =
      `<img src="${E(P.logo)}" alt="Новый логотип">`;
    toast("Логотип подготовлен. Сохраните настройки филиала.");
  } catch (e) {
    toast(e.message, true);
  }
});
(async () => {
  try {
    const policy=await api("security");
    P.mfaRequired=policy.mfaRequired;
    P.user = await api("me");
    await refresh();
    render();
  } catch (e) {
    P.user = null;
    render();
    if (e.status !== 401)
      root.querySelector(".form-error").textContent = e.message;
  }
})();
