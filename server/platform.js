"use strict";
const crypto = require("node:crypto");
const security = require("./security");
const digest = (v) => crypto.createHash("sha256").update(v).digest("hex");
module.exports = function platform(d) {
  const {
    get,
    all,
    run,
    transaction,
    uid,
    now,
    fail,
    text,
    email,
    password,
    hash,
    slug,
    body,
    json,
    limit,
    defaults,
    configValidate,
    createTenant,
  } = d;
  function credentials() {
    const em = process.env.PLATFORM_ADMIN_EMAIL,
      pw = process.env.PLATFORM_ADMIN_PASSWORD,
      key = process.env.PLATFORM_ADMIN_SECRET;
    if (!em || !pw || pw.length > 128 || !key)
      fail(503, "Панель платформы не настроена. Задайте отдельный email, непустой пароль (до 128 символов) и непустой секрет на сервере.");
    let mfa;
    try {mfa=security.mfaSettings();} catch {fail(503,"Для входа администратора настройте PLATFORM_TOTP_SECRET на сервере. Используйте ключ из генератора MFA.");}
    return {
      mfa,
      email: email(em),
      password: pw,
      fingerprint: crypto
        .createHmac("sha256", key)
        .update(em.toLowerCase() + "\0" + pw + (mfa.required?"\0mfa:"+mfa.canonical:""))
        .digest("hex"),
    };
  }
  const token = (req) =>
    (req.headers.cookie || "").match(
      /(?:^|;\s*)pit_platform=([a-f0-9]{64})(?:;|$)/,
    )?.[1];
  const cookie = (v, age) =>
    `pit_platform=${v}; HttpOnly; SameSite=Strict; Path=/api/platform; Max-Age=${age}${security.secureCookie() ? "; Secure" : ""}`;
  async function auth(req) {
    const c = credentials(),
      t = token(req);
    if (!t) fail(401, "Войдите в панель платформы");
    const s = await get(
      "SELECT credential,expires FROM platform_sessions WHERE token=?",
      digest(t),
    );
    if (!s || s.expires <= Date.now() || s.credential !== c.fingerprint)
      fail(401, "Сессия платформы завершена");
    return c.email;
  }
  async function log(actor, action, target) {
    await run(
      "INSERT INTO platform_audit(id,actor,action,target,created) VALUES(?,?,?,?,?)",
      uid(),
      actor,
      action,
      target,
      now(),
    );
  }
  function until(v) {
    if (v === null || v === "") return null;
    if (
      typeof v !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      !Number.isFinite(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v
    )
      fail(400, "Укажите корректную дату окончания доступа");
    return v;
  }
  async function ensureAccess(ownerKey) {
    const c = await get(
      "SELECT status,access_until FROM companies WHERE id=?",
      ownerKey,
    );
    if (
      c &&
      (c.status === "paused" ||
        (c.access_until &&
          c.access_until < new Date().toISOString().slice(0, 10)))
    ) {
      if (
        c.access_until &&
        c.access_until < new Date().toISOString().slice(0, 10)
      )
        await run(
          "DELETE FROM sessions WHERE user_id IN (SELECT u.id FROM users u JOIN tenants t ON t.id=u.tenant WHERE t.owner_key=?)",
          ownerKey,
        );
      fail(423, "Доступ к сервису приостановлен. Обратитесь к владельцу СТО.");
    }
  }
  async function branches(id) {
    const ts = await all(
      "SELECT id,slug,config,revision FROM tenants WHERE owner_key=? ORDER BY slug",
      id,
    );
    return Promise.all(
      ts.map(async (t) => {
        const o = await get(
          "SELECT id,email,name,phone FROM users WHERE tenant=? AND role='owner' ORDER BY id LIMIT 1",
          t.id,
        );
        return {
          slug: t.slug,
          config: JSON.parse(t.config),
          revision: t.revision,
          owner: o || null,
          appPath: "/app/" + t.slug,
          adminPath: "/admin/" + t.slug,
        };
      }),
    );
  }
  async function detail(id) {
    const bs = await branches(id);
    let c = await get("SELECT * FROM companies WHERE id=?", id);
    if (!c && !bs.length) fail(404, "Компания не найдена");
    c = c || {
      id,
      name: bs[0].config.name,
      status: "active",
      access_until: null,
      revision: 0,
      created: null,
      updated: null,
    };
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      accessUntil: c.access_until,
      revision: c.revision,
      created: c.created,
      updated: c.updated,
      expired:
        !!c.access_until &&
        c.access_until < new Date().toISOString().slice(0, 10),
      branches: bs,
    };
  }
  async function current(id, revision) {
    const c = await detail(id);
    if (c.revision !== revision)
      fail(409, "Компания изменена. Обновите данные перед сохранением.");
    if (c.revision === 0) {
      await run(
        "INSERT INTO companies(id,name,status,access_until,created,updated,revision) VALUES(?,?,?,?,?,?,?)",
        id,
        c.name,
        "active",
        null,
        now(),
        now(),
        1,
      );
      c.revision = 1;
    }
    return c;
  }
  async function bump(id) {
    await run(
      "UPDATE companies SET updated=?,revision=revision+1 WHERE id=?",
      now(),
      id,
    );
  }
  async function unique(code) {
    if (await get("SELECT id FROM tenants WHERE slug=?", code))
      fail(409, "Этот код ссылки уже занят");
  }
  function owner(v) {
    if (typeof v?.password !== "string" || v.password.length < 16)
      fail(400, "Пароль владельца: от 16 до 128 символов");
    const n = text(v?.name || "", 80);
    if (!n) fail(400, "Укажите имя владельца");
    return {
      name: n,
      email: email(v.email),
      phone: text(v.phone || "", 40),
      hash: hash(password(v.password)),
    };
  }
  async function route(req, res, url) {
    const p = url.pathname.split("/").filter(Boolean).slice(2),
      method = req.method;
    if(p[0]==="security" && method==="GET")return json(res,{mfaRequired:security.mfaRequired()});
    if (p[0] === "login" && method === "POST") {
      const c = credentials();
      await limit(req,undefined,"platform",res);
      const b = await body(req);
      await limit(req,String(b.email||""),"platform",res);
      const valid = crypto.timingSafeEqual(
        Buffer.from(digest(String(b.password || "")), "hex"),
        Buffer.from(digest(c.password), "hex"),
      );
      if (
        String(b.email || "")
          .trim()
          .toLowerCase() !== c.email ||
        !valid
      )
        fail(401,c.mfa.required?"Неверные данные входа или код подтверждения":"Неверный email или пароль");
      const step=c.mfa.required?security.matchTotp(c.mfa.secret,b.otp):null;
      if(c.mfa.required&&step===null)fail(401,"Неверные данные входа или код подтверждения");
      const t = crypto.randomBytes(32).toString("hex");
      await transaction(async () => {
        if(c.mfa.required){
          const claimed=await run("INSERT INTO platform_mfa_replay AS used(credential,last_step,updated) VALUES(?,?,?) ON CONFLICT(credential) DO UPDATE SET last_step=excluded.last_step,updated=excluded.updated WHERE used.last_step<excluded.last_step",c.fingerprint,step,now());
          if(claimed.rowCount!==1)fail(401,"Этот код уже использован. Дождитесь нового кода в приложении-аутентификаторе");
        }
        await run("DELETE FROM platform_sessions WHERE expires<?", Date.now());
        await run(
          "INSERT INTO platform_sessions(token,credential,expires) VALUES(?,?,?)",
          digest(t),
          c.fingerprint,
          Date.now() + 8 * 3600000,
        );
        await log(c.email, "platform.login", "platform");
      });
      res.setHeader("Set-Cookie", cookie(t, 28800));
      return json(res, { email: c.email });
    }
    if (p[0] === "logout" && method === "POST") {
      const t = token(req);
      if (t)
        await run("DELETE FROM platform_sessions WHERE token=?", digest(t));
      res.setHeader("Set-Cookie", cookie("", 0));
      return json(res, { ok: true });
    }
    const actor = await auth(req);
    if (p[0] === "me" && method === "GET") return json(res, { email: actor });
    if (p[0] === "audit" && method === "GET")
      return json(
        res,
        await all(
          "SELECT actor,action,target,created FROM platform_audit ORDER BY created DESC LIMIT 100",
        ),
      );
    if (p[0] !== "companies") fail(404, "Маршрут не найден");
    const id = p[1],
      action = p[2];
    if (!id && method === "GET") {
      const ids = new Set(
        (await all("SELECT owner_key FROM tenants")).map((t) => t.owner_key),
      );
      for (const c of await all("SELECT id FROM companies")) ids.add(c.id);
      return json(res, await Promise.all([...ids].map(detail)));
    }
    if (!id && method === "POST") {
      const b = await body(req),
        name = text(b.name, 80),
        code = slug(b.slug),
        o = owner(b.owner);
      if (!name) fail(400, "Название компании обязательно");
      const conf = configValidate({
          ...defaults,
          ...b.config,
          name: b.config?.name || name,
        }),
        access = until(b.accessUntil ?? null),
        key = uid();
      await transaction(async () => {
        await unique(code);
        await run(
          "INSERT INTO companies(id,name,status,access_until,created,updated,revision) VALUES(?,?,?,?,?,?,?)",
          key,
          name,
          "active",
          access,
          now(),
          now(),
          1,
        );
        await createTenant(code, conf, key, o);
        await log(actor, "company.create", key);
      });
      return json(res, await detail(key), 201);
    }
    if (!id) fail(405, "Метод не поддерживается");
    if (!action && method === "GET") return json(res, await detail(id));
    if (!action && method === "PATCH") {
      const b = await body(req);
      await transaction(async () => {
        const c = await current(id, b.revision),
          name = text(b.name ?? c.name, 80),
          status = b.status ?? c.status,
          access = until(
            b.accessUntil === undefined ? c.accessUntil : b.accessUntil,
          );
        if (!name || !["active", "paused"].includes(status))
          fail(400, "Проверьте название и состояние доступа");
        await run(
          "UPDATE companies SET name=?,status=?,access_until=?,updated=?,revision=revision+1 WHERE id=?",
          name,
          status,
          access,
          now(),
          id,
        );
        if (
          status === "paused" ||
          (access && access < new Date().toISOString().slice(0, 10))
        )
          await run(
            "DELETE FROM sessions WHERE user_id IN (SELECT u.id FROM users u JOIN tenants t ON t.id=u.tenant WHERE t.owner_key=?)",
            id,
          );
        await log(actor, "company.access.update", id);
      });
      return json(res, await detail(id));
    }
    if (action === "owner" && method === "PUT") {
      const b = await body(req),
        o = owner(b.owner);
      await transaction(async () => {
        await current(id, b.revision);
        const users = await all(
          "SELECT u.id FROM users u JOIN tenants t ON t.id=u.tenant WHERE t.owner_key=? AND u.role='owner'",
          id,
        );
        if (!users.length) fail(409, "В компании нет аккаунта владельца");
        for (const u of users) {
          await run(
            "UPDATE users SET name=?,email=?,phone=?,hash=? WHERE id=?",
            o.name,
            o.email,
            o.phone,
            o.hash,
            u.id,
          );
          await run("DELETE FROM sessions WHERE user_id=?", u.id);
        }
        await bump(id);
        await log(actor, "company.owner.reset", id);
      });
      return json(res, await detail(id));
    }
    if (action === "branches" && !p[3] && method === "POST") {
      const b = await body(req),
        code = slug(b.slug);
      await transaction(async () => {
        await current(id, b.revision);
        await unique(code);
        const source = await get(
          "SELECT u.* FROM users u JOIN tenants t ON t.id=u.tenant WHERE t.owner_key=? AND u.role='owner' ORDER BY t.slug LIMIT 1",
          id,
        );
        if (!source) fail(409, "Сначала назначьте владельца");
        const existing = (await branches(id))[0].config;
        const conf = configValidate({
          ...defaults,
          accent: existing.accent,
          logo: existing.logo,
          shortName: existing.shortName,
          timezone: existing.timezone,
          ...b.config,
          name: text(b.name, 80),
        });
        await createTenant(code, conf, id, source);
        await bump(id);
        await log(actor, "company.branch.create", code);
      });
      return json(res, await detail(id), 201);
    }
    if (action === "branches" && p[3] && method === "PUT") {
      const b = await body(req),
        conf = configValidate(b.config);
      await transaction(async () => {
        await current(id, b.companyRevision);
        const t = await get(
          "SELECT id,revision,config FROM tenants WHERE slug=? AND owner_key=?",
          p[3],
          id,
        );
        if (!t) fail(404, "Филиал этой компании не найден");
        if (t.revision !== b.revision)
          fail(409, "Настройки филиала изменились. Обновите данные.");
        const active = await all(
          "SELECT post FROM bookings WHERE tenant=? AND status IN ('booked','working')",
          t.id,
        );
        if (
          active.length &&
          conf.timezone !==
            (JSON.parse(t.config).timezone || process.env.TZ || "Europe/Moscow")
        )
          fail(
            409,
            "Сначала завершите или перенесите активные записи перед сменой часового пояса",
          );
        if (active.some((x) => x.post > conf.posts))
          fail(409, "Нельзя убрать пост с активными записями");
        await run(
          "UPDATE tenants SET config=?,revision=revision+1 WHERE id=?",
          JSON.stringify(conf),
          t.id,
        );
        await bump(id);
        await log(actor, "company.branch.settings", p[3]);
      });
      return json(res, await detail(id));
    }
    fail(405, "Метод не поддерживается");
  }
  return { route, ensureAccess };
};
