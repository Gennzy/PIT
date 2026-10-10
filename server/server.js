"use strict";
// PIT v6: async PostgreSQL, serverless entry point.
const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const QRCode = require("./qr");
const { get, all, run, transaction, close: closeDB, testing } = require("./db");
const ROOT = path.resolve(__dirname, "..");
const {zone,civilDate,localMinutes}=require("./tenant-time");
process.env.TZ = process.env.TZ || "Europe/Moscow";
const uid = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
  J = JSON.parse;
const catalogue = J(
  fs.readFileSync(path.join(__dirname, "catalog.json"), "utf8"),
);
const defaults = {
  name: "Мой автосервис",
  addr: "",
  phone: "",
  accent: "#EC0618",
  timezone: process.env.TZ || "Europe/Moscow",
  shortName: "ПИТ",
  logo: null,
  posts: 3,
  open: 540,
  close: 1260,
  days: [0, 1, 2, 3, 4, 5, 6],
  f: {
    camera: false,
    approve: true,
    lamp: true,
    history: true,
    waitlist: true,
    fixprice: true,
    chat: true,
    storage: true,
    plate: false,
    voice: true,
  },
  cameraUrls: {},
  services: [
    { id: "to", n: "ТО и масло", price: 2500, min: 60 },
    { id: "diag", n: "Диагностика", price: 1500, min: 40 },
    { id: "brakes", n: "Тормоза", price: 1800, min: 60 },
    { id: "susp", n: "Подвеска", price: 1200, min: 40 },
    { id: "tire", n: "Шиномонтаж", price: 1900, min: 40, radius: true },
    { id: "align", n: "Развал-схождение", price: 2200, min: 50 },
    { id: "ac", n: "Кондиционер", price: 2800, min: 50 },
    { id: "elec", n: "Автоэлектрика", price: 1500, min: 60 },
  ],
};
function hash(p) {
  const s = crypto.randomBytes(16).toString("hex");
  return s + ":" + crypto.scryptSync(p, s, 64).toString("hex");
}
function verify(p, h) {
  const [s, v] = h.split(":");
  const b = crypto.scryptSync(p, s, 64);
  return v.length === 128 && crypto.timingSafeEqual(b, Buffer.from(v, "hex"));
}
function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
function text(v, max = 160) {
  if (typeof v !== "string") fail(400, "Ожидался текст");
  return v.trim().slice(0, max);
}
function integer(v, a, b) {
  if (!Number.isInteger(v) || v < a || v > b)
    fail(400, "Число вне допустимого диапазона");
  return v;
}
function password(v) {
  if (typeof v !== "string" || v.length < 10 || v.length > 128)
    fail(400, "Пароль: от 10 до 128 символов");
  return v;
}
function email(v) {
  v = text(v, 160).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) fail(400, "Некорректный email");
  return v;
}
function slug(v) {
  v = text(v, 50);
  if (!/^[a-z0-9][a-z0-9-]{2,49}$/.test(v))
    fail(400, "Код СТО: 3–50 латинских букв, цифр или дефисов");
  return v;
}
function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    phone: u.phone,
    role: u.role,
  };
}
async function audit(u, a, t) {
  await run(
    "INSERT INTO audit(tenant,user_id,action,target,created) VALUES(?,?,?,?,?)",
    u.tenant,
    u.id,
    a,
    t,
    now(),
  );
}
async function notify(u, message, tenant) {
  await run(
    "INSERT INTO notifications VALUES(?,?,?,?,?,0)",
    uid(),
    tenant,
    u,
    message,
    now(),
  );
}
function cfg(t) {
  return J(t.config);
}
function validZone(v){try{return zone(v);}catch{fail(400,"Укажите корректный часовой пояс IANA, например Europe/Moscow");}}
function validLogo(v){if(v==null||v==="")return null;if(typeof v!=="string"||v.length>1400000||!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(v))fail(400,"Логотип: PNG 512×512, до 1 МБ");const b=Buffer.from(v.split(",")[1],"base64");if(b.length>1048576||b.length<33||b.subarray(0,8).toString("hex")!=="89504e470d0a1a0a"||b.subarray(12,16).toString()!=="IHDR"||b.readUInt32BE(16)!==512||b.readUInt32BE(20)!==512)fail(400,"Логотип: PNG 512×512, до 1 МБ");return v;}
function configValidate(c) {
  if(!c || typeof c!=="object" || Array.isArray(c))fail(400,"Ожидались настройки филиала");
  if(!text(c.name,80))fail(400,"Название филиала обязательно");
  const out = {
    ...defaults,
    name: text(c.name, 80),
    addr: text(c.addr || "", 200),
    phone: text(c.phone || "", 40),
    accent: c.accent,
    timezone: validZone(c.timezone || process.env.TZ || "Europe/Moscow"),
    shortName: text(c.shortName || c.name || "ПИТ",24),
    logo: validLogo(c.logo),
    posts: integer(c.posts, 1, 16),
    open: integer(c.open, 0, 1410),
    close: integer(c.close, 30, 1440),
  };
  if (!out.name || !/^#[0-9a-f]{6}$/i.test(out.accent) || out.close <= out.open)
    fail(400, "Проверьте название, цвет и часы");
  if (!Array.isArray(c.days) || !c.days.length)
    fail(400, "Выберите рабочие дни");
  out.days = [...new Set(c.days.map((v) => integer(v, 0, 6)))];
  out.f = Object.fromEntries(
    Object.keys(defaults.f).map((k) => [k, !!c.f?.[k]]),
  );
  out.f.plate = false;
  out.cameraUrls = {};
  for (const [k, v] of Object.entries(c.cameraUrls || {})) {
    if (v) {
      integer(+k, 1, out.posts);
      const url = new URL(v);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        fail(400, "Камера: HTTP(S) без пароля в URL");
      out.cameraUrls[k] = url.href;
    }
  }
  if (
    !Array.isArray(c.services) ||
    !c.services.length ||
    c.services.length > 50
  )
    fail(400, "Нужна хотя бы одна услуга");
  const ids = new Set();
  out.services = c.services.map((s) => {
    const id = text(s.id, 40);
    if (!/^[a-z0-9_-]+$/.test(id) || ids.has(id))
      fail(400, "Коды услуг должны быть уникальными");
    ids.add(id);
    const n = text(s.n, 80);
    if (!n) fail(400, "Название услуги обязательно");
    return {
      id,
      n,
      price: integer(s.price, 0, 10000000),
      min: integer(s.min, 10, 720),
      radius: !!s.radius,
    };
  });
  return out;
}
async function createTenant(code, conf, ownerKey, owner) {
  const id = uid();
  await run(
    "INSERT INTO tenants(id,slug,owner_key,config) VALUES(?,?,?,?)",
    id,
    code,
    ownerKey,
    JSON.stringify(conf),
  );
  await run(
    "INSERT INTO users(id,tenant,email,name,phone,role,hash) VALUES(?,?,?,?,?,?,?)",
    uid(),
    id,
    owner.email,
    owner.name,
    owner.phone || "",
    "owner",
    owner.hash,
  );
  return await get("SELECT * FROM tenants WHERE id=?", id);
}
async function tenantBySlug(s) {
  const t = await get("SELECT * FROM tenants WHERE slug=?", s);
  if (!t) fail(404, "СТО не найдено");
  await platform.ensureAccess(t.owner_key);
  return t;
}
async function session(req) {
  const token = (req.headers.cookie || "").match(
    /(?:^|;\s*)pit_session=([^;]+)/,
  )?.[1];
  if (!token) return null;
  const s = await get(
    "SELECT user_id,expires FROM sessions WHERE token=?",
    crypto.createHash("sha256").update(token).digest("hex"),
  );
  if (!s || s.expires < Date.now()) return null;
  return await get("SELECT * FROM users WHERE id=?", s.user_id);
}
async function auth(req, t, roles) {
  const u = await session(req);
  if (!u || u.tenant !== t.id) fail(401, "Войдите в это СТО");
  if (roles && !roles.includes(u.role)) fail(403, "Недостаточно прав");
  return u;
}
async function vehicle(u, id) {
  const v = await get(
    "SELECT * FROM vehicles WHERE id=? AND tenant=?",
    id,
    u.tenant,
  );
  if (!v || (u.role === "client" && v.user_id !== u.id))
    fail(404, "Автомобиль не найден");
  return v;
}
async function booking(u, id) {
  const b = await get(
    "SELECT * FROM bookings WHERE id=? AND tenant=?",
    id,
    u.tenant,
  );
  if (!b || (u.role === "client" && b.user_id !== u.id))
    fail(404, "Заказ не найден");
  return b;
}
async function expanded(b) {
  const v = await get("SELECT data FROM vehicles WHERE id=?", b.vehicle);
  const u = await get("SELECT name,phone FROM users WHERE id=?", b.user_id);
  return { ...b, data: J(b.data), vehicleData: J(v.data), client: u };
}
async function saveBooking(b, d, status = b.status) {
  await run(
    "UPDATE bookings SET data=?,status=? WHERE id=? AND tenant=?",
    JSON.stringify(d),
    status,
    b.id,
    b.tenant,
  );
}
function checkDate(d, c) {
  if (
    typeof d !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
    isNaN(Date.parse(d)) ||
    new Date(d).toISOString().slice(0, 10) !== d
  )
    fail(400, "Неверная дата");
  const today = localDate(0,c.timezone);
  if (d < today || d > localDate(180,c.timezone))
    fail(400, "Запись возможна на ближайшие 180 дней");
  return d;
}
function localDate(offset=0,timeZone=process.env.TZ){return civilDate(offset,timeZone||"Europe/Moscow");}

function quote(c, body) {
  if (!Array.isArray(body.services) || !body.services.length)
    fail(400, "Выберите услугу");
  const ids = [...new Set(body.services)];
  const ss = ids.map((id) => {
    const s = c.services.find((x) => x.id === id);
    if (!s) fail(400, "Услуга недоступна");
    return s;
  });
  const r = integer(body.radius || 16, 12, 24);
  return {
    items: ss.map((s) => ({
      ...s,
      price: s.price + (s.radius ? Math.max(0, r - 14) * 250 : 0),
      min: s.min + (s.radius ? Math.max(0, r - 14) * 5 : 0),
    })),
    radius: r,
  };
}
async function schedule(t, date, duration, exclude = null) {
  const c = cfg(t),
    out = [];
  if (!c.days.includes(new Date(date + "T12:00:00Z").getUTCDay())) return out;
  const list = (
    await all(
      "SELECT * FROM bookings WHERE tenant=? AND date=? AND status NOT IN ('cancelled','completed','waitlist')",
      t.id,
      date,
    )
  ).filter((b) => b.id !== exclude);
  const minute = localMinutes(c.timezone || process.env.TZ);
  for (let s = c.open; s + duration <= c.close; s += 30) {
    if (date === localDate(0,c.timezone) && s <= minute) continue;
    const post = Array.from({ length: c.posts }, (_, i) => i + 1).find(
      (p) =>
        !list.some(
          (b) =>
            b.post === p && s < b.start + b.duration && s + duration > b.start,
        ),
    );
    out.push({ start: s, available: !!post, post: post || null });
  }
  return out;
}
const testRates = new Map();
async function limit(req) {
  const address = String(
    req.headers["x-vercel-forwarded-for"] ||
      req.socket?.remoteAddress ||
      "unknown",
  )
    .split(",")[0]
    .trim();
  const key = crypto
    .createHmac(
      "sha256",
      process.env.AUTH_RATE_SECRET || process.env.PLATFORM_ADMIN_SECRET || process.env.OWNER_PASSWORD || "test-only",
    )
    .update(address)
    .digest("hex");
  let hits;
  if (testing) {
    const old = testRates.get(key) || { at: Date.now(), hits: 0 };
    if (Date.now() - old.at > 600000) {
      old.at = Date.now();
      old.hits = 0;
    }
    hits = ++old.hits;
    testRates.set(key, old);
  } else {
    hits = (await await get("SELECT pit.consume_rate_limit(?) AS hits", key))
      .hits;
  }
  if (hits > 60)
    fail(429, "Слишком много попыток входа. Повторите через 10 минут");
}
async function body(req) {
  if (req.body !== undefined) {
    const v =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    if (Buffer.byteLength(v) > 4 * 1024 * 1024)
      fail(413, "Файл слишком большой");
    try {
      return J(v);
    } catch {
      fail(400, "Некорректный JSON");
    }
  }
  let s = "";
  for await (const chunk of req) {
    s += chunk;
    if (Buffer.byteLength(s) > 4 * 1024 * 1024)
      fail(413, "Файл слишком большой (до 3 МБ)");
  }
  try {
    return J(s || "{}");
  } catch {
    fail(400, "Некорректный JSON");
  }
}
function json(res, v, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(v));
}
function image(v) {
  if (v == null) return null;
  if (
    typeof v !== "string" ||
    v.length > 4000000 ||
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)
  )
    fail(400, "Фото: JPEG, PNG или WebP до 3 МБ");
  return v;
}
async function tenantTransaction(t, f) {
  return transaction(async () => {
    const fresh = await get("SELECT revision FROM tenants WHERE id=?", t.id);
    await platform.ensureAccess(t.owner_key);
    if (!fresh || fresh.revision !== t.revision)
      fail(409, "Настройки СТО изменились. Обновите страницу");
    return f();
  });
}
async function api(req, res, url) {
  const p = url.pathname.split("/").filter(Boolean);
  if (p[1] === "health") return json(res, { ok: true });
  if (p[1] === "shared") {
    const s = await get(
      "SELECT * FROM shares WHERE token=? AND expires>?",
      p[2],
      Date.now(),
    );
    if (!s) fail(404, "Ссылка истекла или отозвана");
    const sharedTenant=await get("SELECT owner_key FROM tenants WHERE id=?",s.tenant);
    if(!sharedTenant)fail(404,"Сервис не найден");
    await platform.ensureAccess(sharedTenant.owner_key);
    const v = await get(
      "SELECT data FROM vehicles WHERE id=? AND tenant=?",
      s.vehicle,
      s.tenant,
    );
    const vd = J(v.data);
    return json(res, {
      vehicle: { brand: vd.brand, model: vd.model, year: vd.year },
      history: (
        await all(
          "SELECT date,data FROM bookings WHERE tenant=? AND vehicle=? AND status='completed' ORDER BY date DESC",
          s.tenant,
          s.vehicle,
        )
      ).map((b) => {
        const d = J(b.data);
        return {
          date: b.date,
          km: d.km,
          items: d.items.map((i) => i.n),
          price: d.price,
          findings: d.findings
            .filter((x) => x.decision === "approved")
            .map((x) => ({ name: x.name, price: x.price })),
        };
      }),
    });
  }
  if (p[1] === "entry" && req.method === "GET") {
    const t = (process.env.STO_SLUG && await get("SELECT * FROM tenants WHERE slug=?", process.env.STO_SLUG)) || await get("SELECT * FROM tenants ORDER BY slug LIMIT 1");
    if (!t) fail(503, "Сервис ещё не настроен");
    return json(res, {path:"/app/"+t.slug});
  }
  if (p[1] === "catalog") return json(res, catalogue);
  if (p[1] !== "t" || !p[2]) fail(404, "Маршрут не найден");
  const t = await tenantBySlug(p[2]),
    c = cfg(t),
    action = p[3],
    method = req.method;
  let id = p[4];
  if (action === "manifest.webmanifest" && method === "GET") {
    res.setHeader("Content-Type", "application/manifest+json; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    return res.end(JSON.stringify({name:"ПИТ · "+c.name,short_name:c.shortName||"ПИТ",id:t.slug===(process.env.STO_SLUG||"pit")?"/pit-v5":"/app/"+t.slug,start_url:"/app/"+t.slug,scope:"/",display:"standalone",background_color:"#090909",theme_color:"#090909",lang:"ru",icons:c.logo?[{src:c.logo,sizes:"512x512",type:"image/png"}]:[{src:"/assets/icons/icon-192.png",sizes:"192x192",type:"image/png"},{src:"/assets/icons/icon-512.png",sizes:"512x512",type:"image/png"}]}));
  }
  if (action === "public" && method === "GET") {
    const { cameraUrls, ...conf } = c;
    return json(res, { slug: t.slug, config: conf });
  }
  if (action === "login" || action === "register") {
    if (method !== "POST") fail(405, "Используйте POST");
    await limit(req);
    const b = await await body(req);
    const em = email(b.email),
      pw = password(b.password);
    let u = await get(
      "SELECT * FROM users WHERE tenant=? AND email=?",
      t.id,
      em,
    );
    if (action === "register") {
      if (u) fail(409, "Email уже зарегистрирован");
      const name = text(b.name, 80);
      if (!name) fail(400, "Укажите имя");
      await run(
        "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
        uid(),
        t.id,
        em,
        name,
        text(b.phone || "", 40),
        "client",
        hash(pw),
      );
      u = await get("SELECT * FROM users WHERE tenant=? AND email=?", t.id, em);
    } else if (!u || !verify(pw, u.hash))
      fail(401, "Неверный email или пароль");
    const tok = crypto.randomBytes(32).toString("hex");
    await run(
      "INSERT INTO sessions VALUES(?,?,?)",
      crypto.createHash("sha256").update(tok).digest("hex"),
      u.id,
      Date.now() + 7 * 86400000,
    );
    res.setHeader(
      "Set-Cookie",
      `pit_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
    );
    await audit(u, "login", u.id);
    return json(res, publicUser(u));
  }
  const u = await auth(req, t);
  if (action === "documents" && method === "GET") {
    const b = await expanded(await booking(u, id));
    const pdf = require("./order-pdf").orderPDF(c, b);
    const filename =
      "pit-order-" + String(b.id).replace(/[^a-zA-Z0-9-]/g, "") + ".pdf";
    await audit(u, "document.download", b.id);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="' + filename + '"',
      "Cache-Control": "private, no-store",
    });
    return res.end(pdf);
  }

  if (action === "photo" && method === "GET") {
    const photo = await get(
      "SELECT * FROM photos WHERE id=? AND tenant=?",
      id,
      t.id,
    );
    if (!photo) fail(404, "Фото не найдено");
    await booking(u, photo.booking);
    const { readPhoto } = require("./storage");
    const file = await readPhoto(photo.object_path);
    res.writeHead(200, {
      "Content-Type": photo.mime,
      "Cache-Control": "private, no-store",
    });
    return res.end(file);
  }

  if (action === "logout" && method === "POST") {
    const tok = (req.headers.cookie || "").match(/pit_session=([^;]+)/)?.[1];
    if (tok)
      await run(
        "DELETE FROM sessions WHERE token=?",
        crypto.createHash("sha256").update(tok).digest("hex"),
      );
    res.setHeader(
      "Set-Cookie",
      "pit_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    return json(res, { ok: true });
  }
  if (action === "me") {
    if (method === "GET") return json(res, publicUser(u));
    if (method === "PATCH") {
      const b = await await body(req);
      const n = text(b.name, 80);
      if (!n) fail(400, "Имя обязательно");
      await run(
        "UPDATE users SET name=?,phone=? WHERE id=?",
        n,
        text(b.phone || "", 40),
        u.id,
      );
      if (b.password) {
        await run(
          "UPDATE users SET hash=? WHERE id=?",
          hash(password(b.password)),
          u.id,
        );
        await run("DELETE FROM sessions WHERE user_id=?", u.id);
      }
      return json(res, { ok: true });
    }
  }
  if (action === "config") {
    await auth(req, t, ["owner"]);
    if (method === "GET") return json(res, { config: c, revision: t.revision });
    if (method === "PUT") {
      const b = await await body(req),
        conf = configValidate(b.config);
      await tenantTransaction(t, async () => {
        const current = await get(
          "SELECT revision FROM tenants WHERE id=?",
          t.id,
        );
        if (current.revision !== b.revision)
          fail(409, "Настройки изменились. Обновите страницу");
        if (
          (
            await all(
              "SELECT post FROM bookings WHERE tenant=? AND status IN ('booked','working')",
              t.id,
            )
          ).some((x) => x.post > conf.posts)
        )
          fail(409, "Нельзя убрать пост с активными записями");
        if(conf.timezone!==(c.timezone||process.env.TZ)&&await get("SELECT id FROM bookings WHERE tenant=? AND status IN ('booked','working') LIMIT 1",t.id))fail(409,"Перед сменой часового пояса завершите или перенесите активные записи");
        await run(
          "UPDATE tenants SET config=?,revision=revision+1 WHERE id=?",
          JSON.stringify(conf),
          t.id,
        );
        await audit(u, "settings.update", t.id);
      });
      return json(res, { config: conf, revision: t.revision + 1 });
    }
  }
  if (action === "tenants") {
    await auth(req, t, ["owner"]);
    if (method === "GET")
      return json(
        res,
        (
          await all(
            "SELECT slug,config FROM tenants WHERE owner_key=?",
            t.owner_key,
          )
        ).map((x) => ({ slug: x.slug, name: cfg(x).name })),
      );
    if (method === "POST") {
      const b = await await body(req);
      if (await get("SELECT id FROM tenants WHERE slug=?", slug(b.slug)))
        fail(409, "Код СТО занят");
      const nt = await transaction(async () => {
        await platform.ensureAccess(t.owner_key);
        if (await get("SELECT id FROM tenants WHERE slug=?",slug(b.slug)))fail(409,"Код СТО занят");
        const created=await createTenant(slug(b.slug),{ ...defaults,timezone:c.timezone||process.env.TZ,accent:c.accent,logo:c.logo,shortName:c.shortName,name:text(b.name,80) },t.owner_key,u);
        await run("UPDATE companies SET revision=revision+1,updated=? WHERE id=?",now(),t.owner_key);
        await audit(u,"tenant.create",created.id);
        return created;
      });
      return json(res, { slug: nt.slug }, 201);
    }
  }
  if (action === "users") {
    await auth(req, t, ["owner"]);
    if (method === "GET")
      return json(
        res,
        (
          await all(
            "SELECT * FROM users WHERE tenant=? ORDER BY role,name",
            t.id,
          )
        ).map(publicUser),
      );
    if (method === "POST") {
      const b = await await body(req);
      if (!["master", "client"].includes(b.role))
        fail(400, "Роль: master или client");
      const em = email(b.email);
      if (
        await get("SELECT id FROM users WHERE tenant=? AND email=?", t.id, em)
      )
        fail(409, "Email занят");
      const newId = uid(),
        n = text(b.name, 80);
      if (!n) fail(400, "Укажите имя");
      await run(
        "INSERT INTO users VALUES(?,?,?,?,?,?,?)",
        newId,
        t.id,
        em,
        n,
        text(b.phone || "", 40),
        b.role,
        hash(password(b.password)),
      );
      await audit(u, "user.create", newId);
      return json(res, { id: newId }, 201);
    }
    if (method === "PATCH") {
      const b = await await body(req),
        target = await get(
          "SELECT * FROM users WHERE id=? AND tenant=?",
          id,
          t.id,
        );
      if (!target || target.role === "owner")
        fail(403, "Владелец не изменяется здесь");
      if (b.password) {
        await run(
          "UPDATE users SET hash=? WHERE id=?",
          hash(password(b.password)),
          id,
        );
        await run("DELETE FROM sessions WHERE user_id=?", id);
      }
      if (b.role) {
        if (!["master", "client"].includes(b.role)) fail(400, "Неверная роль");
        await run("UPDATE users SET role=? WHERE id=?", b.role, id);
        await run("DELETE FROM sessions WHERE user_id=?", id);
      }
      await audit(u, "user.update", id);
      return json(res, { ok: true });
    }
  }
  if (action === "vehicles") {
    if (method === "GET") {
      const vs =
        u.role === "client"
          ? await all(
              "SELECT * FROM vehicles WHERE tenant=? AND user_id=?",
              t.id,
              u.id,
            )
          : await all("SELECT * FROM vehicles WHERE tenant=?", t.id);
      return json(
        res,
        vs.map((v) => ({ id: v.id, userId: v.user_id, ...J(v.data) })),
      );
    }
    if (method === "POST" || method === "PATCH") {
      const b = await await body(req);
      const cat = catalogue.find((x) => x.id === b.catalogId);
      const v = {
        catalogId: cat?.id || null,
        brand: text(cat?.brand || b.brand, 60),
        model: text(cat?.model || b.model, 80),
        year: integer(b.year, 1900, new Date().getFullYear() + 1),
        plate: text(b.plate || "", 20).toUpperCase(),
        km: integer(b.km || 0, 0, 9999999),
        engine: text(b.engine || "", 60),
        tire: text(b.tire || "", 60),
        oil: text(b.oil || "", 100),
        nextKm: b.nextKm == null ? null : integer(b.nextKm, 0, 9999999),
        image: cat?.image || null,
      };
      if (!v.brand || !v.model) fail(400, "Марка и модель обязательны");
      if (cat && (v.year < cat.fromYear || v.year > cat.toYear))
        fail(
          400,
          "Год не соответствует выбранному поколению; используйте ручной ввод",
        );
      if (method === "PATCH") {
        const prev = await vehicle(u, id);
        if (u.role !== "client" && u.role !== "owner")
          fail(403, "Редактирует клиент или владелец");
        await run(
          "UPDATE vehicles SET data=? WHERE id=? AND tenant=?",
          JSON.stringify(v),
          id,
          t.id,
        );
      } else {
        let owner = u.id;
        if (u.role !== "client" && b.userId) {
          const client = await get(
            "SELECT id FROM users WHERE tenant=? AND id=? AND role='client'",
            t.id,
            b.userId,
          );
          if (!client) fail(400, "Клиент не найден");
          owner = client.id;
        }
        id = uid();
        await run(
          "INSERT INTO vehicles VALUES(?,?,?,?)",
          id,
          t.id,
          owner,
          JSON.stringify(v),
        );
      }
      await audit(u, "vehicle.save", id);
      return json(res, { id, ...v }, method === "POST" ? 201 : 200);
    }
    if (method === "DELETE") {
      const v = await vehicle(u, id);
      if (u.role === "master") fail(403, "Недостаточно прав");
      if (
        (await get("SELECT id FROM bookings WHERE vehicle=?", id)) ||
        (await get("SELECT cell FROM storage WHERE vehicle=?", id))
      )
        fail(409, "У машины есть история или хранение; удаление запрещено");
      await run("DELETE FROM shares WHERE vehicle=?", id);
      await run("DELETE FROM vehicles WHERE id=?", id);
      await audit(u, "vehicle.delete", id);
      return json(res, { ok: true });
    }
  }
  if (action === "slots" && method === "POST") {
    const b = await await body(req),
      date = checkDate(b.date,c);
    if (b.exclude) {
      const previous = await booking(u, b.exclude);
      if (previous.status !== "booked")
        fail(409, "Перенос возможен до приёмки");
      return json(res, {
        date,
        duration: previous.duration,
        price: J(previous.data).price,
        slots: await schedule(t, date, previous.duration, previous.id),
      });
    }
    const q = quote(c, b),
      duration = q.items.reduce((s, x) => s + x.min, 0);
    return json(res, {
      date,
      duration,
      price: q.items.reduce((s, x) => s + x.price, 0),
      slots: await schedule(t, date, duration),
    });
  }
  if (action === "bookings") {
    if (method === "GET") {
      let bs =
        u.role === "client"
          ? await all(
              "SELECT * FROM bookings WHERE tenant=? AND user_id=? ORDER BY date DESC,start DESC",
              t.id,
              u.id,
            )
          : await all(
              "SELECT * FROM bookings WHERE tenant=? ORDER BY date DESC,start DESC",
              t.id,
            );
      if (id) bs = bs.filter((b) => b.id === id);
      return json(res, await Promise.all(bs.map(expanded)));
    }
    if (method === "POST") {
      const b = await await body(req),
        v = await vehicle(u, b.vehicle),
        q = quote(c, b),
        date = checkDate(b.date,c),
        duration = q.items.reduce((s, x) => s + x.min, 0),
        price = q.items.reduce((s, x) => s + x.price, 0),
        start = integer(b.start, 0, 1439),
        newId = uid();
      const data = {
        ...q,
        price,
        km: J(v.data).km,
        phone: text(b.phone || u.phone || "", 40),
        note: text(b.note || "", 1000),
        wait: !!b.wait,
        remind: !!b.remind,
        reminded: false,
        created: now(),
        findings: [],
        chat: [],
        works: Object.fromEntries(q.items.map((i) => [i.id, "wait"])),
      };
      if (!data.phone) fail(400, "Укажите контактный телефон");
      await transaction(async () => {
        const slot = (await schedule(t, date, duration)).find(
          (s) => s.start === start,
        );
        if (!slot?.available) fail(409, "Окно уже занято. Выберите другое");
        await run(
          "INSERT INTO bookings VALUES(?,?,?,?,?,?,?,?,?,?)",
          newId,
          t.id,
          v.user_id,
          v.id,
          date,
          start,
          duration,
          slot.post,
          "booked",
          JSON.stringify(data),
        );
        await notify(
          v.user_id,
          "Запись подтверждена: " + date + " " + hm(start),
          t.id,
        );
        await audit(u, "booking.create", newId);
      });
      return json(res, await expanded(await booking(u, newId)), 201);
    }
    if (method === "PATCH") {
      const b = await booking(u, id),
        input = await await body(req);
      return json(
        res,
        await transaction(async () => {
          const current = await booking(u, id),
            d = J(current.data);
          if (input.op === "cancel") {
            if (!["booked", "waitlist"].includes(current.status))
              fail(409, "Можно отменить только будущую запись");
            await saveBooking(current, d, "cancelled");
            await notify(current.user_id, "Запись отменена", t.id);
            for (const x of (
              await all(
                "SELECT user_id,data,date,start FROM bookings WHERE tenant=? AND status='booked'",
                t.id,
              )
            ).filter(
              (x) =>
                J(x.data).wait &&
                x.date + String(x.start).padStart(4, "0") >
                  current.date + String(current.start).padStart(4, "0"),
            )) {
              await notify(
                x.user_id,
                "Освободилось окно " +
                  current.date +
                  " " +
                  hm(current.start) +
                  ". Проверьте доступное время.",
                t.id,
              );
            }
          } else if (input.op === "reschedule") {
            if (current.status !== "booked")
              fail(409, "Перенос доступен до приёмки");
            const date = checkDate(input.date,c),
              start = integer(input.start, 0, 1439);
            const slot = (
              await schedule(t, date, current.duration, current.id)
            ).find((s) => s.start === start);
            if (!slot?.available) fail(409, "Окно уже занято");
            await run(
              "UPDATE bookings SET date=?,start=?,post=? WHERE id=?",
              date,
              start,
              slot.post,
              current.id,
            );
            d.reminded = false;
            await saveBooking(current, d);
            await notify(
              current.user_id,
              "Запись перенесена: " + date + " " + hm(start),
              t.id,
            );
          } else if (input.op === "start") {
            await auth(req, t, ["master", "owner"]);
            if (current.status !== "booked")
              fail(409, "Заказ уже принят или закрыт");
            if (current.date > localDate(0,c.timezone))
              fail(409, "Приёмка только в день визита");
            if (
              await get(
                "SELECT id FROM bookings WHERE tenant=? AND post=? AND status='working'",
                t.id,
                current.post,
              )
            )
              fail(409, "Пост занят текущим заказом");
            d.started = now();
            await saveBooking(current, d, "working");
          } else if (input.op === "work") {
            await auth(req, t, ["master", "owner"]);
            if (current.status !== "working")
              fail(409, "Сначала примите автомобиль");
            if (!Object.hasOwn(d.works, input.work))
              fail(400, "Работа не найдена");
            const s = d.works[input.work];
            if (s === "done") fail(409, "Работа уже завершена");
            d.works[input.work] = s === "wait" ? "go" : "done";
            await saveBooking(current, d);
          } else if (input.op === "finding") {
            await auth(req, t, ["master", "owner"]);
            if (!c.f.approve) fail(403, "Согласование отключено");
            if (current.status !== "working")
              fail(409, "Находку добавляют в текущий заказ");
            const name = text(input.name, 160);
            if (!name) fail(400, "Опишите находку");
            const findingId = uid();
            let findingPhoto = image(input.photo);
            if (findingPhoto && !testing && process.env.SUPABASE_SECRET_KEY) {
              const { uploadPhoto } = require("./storage");
              const saved = await storePhoto(
                t.id,
                current.id,
                findingId,
                findingPhoto,
              );
              await run(
                "INSERT INTO photos VALUES(?,?,?,?,?)",
                findingId,
                t.id,
                current.id,
                saved.path,
                saved.mime,
              );
              findingPhoto = "/api/t/" + t.slug + "/photo/" + findingId;
            }
            d.findings.push({
              id: findingId,
              name,
              description: text(input.description || "", 1000),
              price: integer(input.price, 0, 10000000),
              min: integer(input.min, 0, 720),
              severity: ["critical", "soon", "later"].includes(input.severity)
                ? input.severity
                : "soon",
              photo: findingPhoto,
              decision: "pending",
              created: now(),
            });
            await saveBooking(current, d);
            await notify(
              current.user_id,
              "Мастер отправил находку на согласование",
              t.id,
            );
          } else if (input.op === "approve") {
            if (u.role !== "client") fail(403, "Решение принимает клиент");
            if (current.status !== "working") fail(409, "Заказ закрыт");
            const f = d.findings.find((x) => x.id === input.finding);
            if (!f || f.decision !== "pending")
              fail(409, "Решение уже принято");
            f.decision = input.accept ? "approved" : "declined";
            f.decided = now();
            if (input.accept) {
              const end = current.start + current.duration + f.min;
              if (
                end > c.close ||
                (await get(
                  "SELECT id FROM bookings WHERE tenant=? AND date=? AND post=? AND id<>? AND status IN ('booked','working') AND start<? AND start+duration>?",
                  t.id,
                  current.date,
                  current.post,
                  current.id,
                  end,
                  current.start,
                ))
              )
                fail(
                  409,
                  "Не хватает времени на посту для дополнительных работ. Мастер должен согласовать другое окно",
                );
              d.price += f.price;
              d.works[f.id] = "wait";
              await run(
                "UPDATE bookings SET duration=duration+? WHERE id=?",
                f.min,
                current.id,
              );
            }
            await saveBooking(current, d);
            for (const m of await all(
              "SELECT id FROM users WHERE tenant=? AND role IN ('owner','master')",
              t.id,
            ))
              await notify(
                m.id,
                "Клиент " +
                  (input.accept ? "согласовал" : "отклонил") +
                  " работу: " +
                  f.name,
                t.id,
              );
          } else if (input.op === "chat") {
            if (!c.f.chat) fail(403, "Чат отключён");
            const message = text(input.message, 2000);
            if (!message) fail(400, "Пустое сообщение");
            if (d.chat.length >= 2000) fail(409, "Лимит сообщений заказа");
            d.chat.push({
              id: uid(),
              name: u.name,
              role: u.role,
              message,
              created: now(),
            });
            await saveBooking(current, d);
            if (u.role !== "client")
              await notify(current.user_id, "Новое сообщение от мастера", t.id);
            else
              for (const m of await all(
                "SELECT id FROM users WHERE tenant=? AND role IN ('owner','master')",
                t.id,
              ))
                await notify(m.id, "Новое сообщение от клиента", t.id);
          } else if (input.op === "complete") {
            await auth(req, t, ["master", "owner"]);
            if (current.status !== "working") fail(409, "Заказ не в работе");
            if (
              Object.values(d.works).some((x) => x !== "done") ||
              d.findings.some((x) => x.decision === "pending")
            )
              fail(409, "Завершите работы и дождитесь решения по находкам");
            d.finished = now();
            await saveBooking(current, d, "completed");
            await notify(
              current.user_id,
              "Машина готова. Можно забирать.",
              t.id,
            );
          } else fail(400, "Операция не поддерживается");
          await audit(u, "booking." + input.op, current.id);
          return await expanded(await booking(u, id));
        }),
      );
    }
  }
  if (action === "storage") {
    await auth(req, t, ["master", "owner"]);
    if (!c.f.storage) fail(403, "Хранение отключено");
    if (method === "GET")
      return json(
        res,
        await Promise.all(
          (await all("SELECT * FROM storage WHERE tenant=?", t.id)).map(
            async (s) => ({
              ...s,
              data: J(s.data),
              vehicleData: J(
                (await get("SELECT data FROM vehicles WHERE id=?", s.vehicle))
                  .data,
              ),
            }),
          ),
        ),
      );
    if (method === "PUT") {
      const b = await await body(req);
      if (!/^[ABC]-(0[1-9]|1[0-9]|20)$/.test(id)) fail(400, "Ячейка A-01…C-20");
      const v = await vehicle(u, b.vehicle);
      if (
        await get(
          "SELECT cell FROM storage WHERE tenant=? AND cell=?",
          t.id,
          id,
        )
      )
        fail(409, "Ячейка занята");
      const d = {
        count: integer(b.count, 1, 8),
        season: text(b.season, 40),
        until: text(b.until, 10),
        note: text(b.note || "", 200),
      };
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.until) || isNaN(Date.parse(d.until)))
        fail(400, "Укажите срок хранения");
      if (
        await get(
          "SELECT cell FROM storage WHERE tenant=? AND vehicle=?",
          t.id,
          v.id,
        )
      )
        fail(409, "Комплект этой машины уже на складе");
      await run(
        "INSERT INTO storage VALUES(?,?,?,?)",
        t.id,
        id,
        v.id,
        JSON.stringify(d),
      );
      await audit(u, "storage.accept", id);
      return json(res, { ok: true });
    }
    if (method === "DELETE") {
      const s = await get(
        "SELECT * FROM storage WHERE tenant=? AND cell=?",
        t.id,
        id,
      );
      if (!s) fail(404, "Ячейка пуста");
      await run("DELETE FROM storage WHERE tenant=? AND cell=?", t.id, id);
      await audit(u, "storage.release", id);
      return json(res, { ok: true });
    }
  }
  if (action === "my-storage" && method === "GET")
    return json(
      res,
      (
        await all(
          "SELECT s.cell,s.vehicle,s.data FROM storage s JOIN vehicles v ON v.id=s.vehicle WHERE s.tenant=? AND v.user_id=?",
          t.id,
          u.id,
        )
      ).map((s) => ({ ...s, data: J(s.data) })),
    );
  if (action === "notifications") {
    if (method === "GET")
      return json(
        res,
        await all(
          "SELECT * FROM notifications WHERE tenant=? AND user_id=? ORDER BY created DESC LIMIT 100",
          t.id,
          u.id,
        ),
      );
    if (method === "POST") {
      await run(
        "UPDATE notifications SET is_read=1 WHERE tenant=? AND user_id=?",
        t.id,
        u.id,
      );
      return json(res, { ok: true });
    }
  }
  if (action === "share") {
    if (!c.f.history) fail(403, "История отключена");
    const v = await vehicle(u, id);
    if (method === "POST") {
      const token = crypto.randomBytes(24).toString("hex"),
        expires = Date.now() + 30 * 86400000;
      await run(
        "INSERT INTO shares VALUES(?,?,?,?)",
        token,
        t.id,
        v.id,
        expires,
      );
      await audit(u, "history.share", v.id);
      return json(res, { path: "/history/" + token, expires });
    }
    if (method === "DELETE") {
      await run("DELETE FROM shares WHERE tenant=? AND vehicle=?", t.id, v.id);
      await audit(u, "history.revoke", v.id);
      return json(res, { ok: true });
    }
  }
  if (action === "camera" && method === "GET") {
    const b = await booking(u, id);
    if (!c.f.camera || !c.cameraUrls[b.post] || b.status !== "working")
      return json(res, {
        url: null,
        message: "Камера не подключена или заказ не в работе",
      });
    return json(res, { url: c.cameraUrls[b.post] });
  }
  if (action === "audit") {
    await auth(req, t, ["owner"]);
    return json(
      res,
      await all(
        "SELECT a.*,u.name FROM audit a JOIN users u ON u.id=a.user_id WHERE a.tenant=? ORDER BY a.id DESC LIMIT 100",
        t.id,
      ),
    );
  }
  if (action === "export") {
    await auth(req, t, ["owner"]);
    return json(res, {
      exported: now(),
      config: c,
      vehicles: (await all("SELECT * FROM vehicles WHERE tenant=?", t.id)).map(
        (v) => ({ ...v, data: J(v.data) }),
      ),
      bookings: await Promise.all(
        (await all("SELECT * FROM bookings WHERE tenant=?", t.id)).map(
          expanded,
        ),
      ),
      storage: await all("SELECT * FROM storage WHERE tenant=?", t.id),
      users: (await all("SELECT * FROM users WHERE tenant=?", t.id)).map(
        publicUser,
      ),
    });
  }
  fail(404, "Маршрут не найден");
}
const hm = (n) =>
  String(Math.floor(n / 60)).padStart(2, "0") +
  ":" +
  String(n % 60).padStart(2, "0");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
const platform=require("./platform")({get,all,run,transaction,uid,now,fail,text,email,password,hash,slug,body,json,limit,defaults,configValidate,createTenant});
async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' https: http: blob:; frame-src https: http:; object-src 'none'; base-uri 'self'; form-action 'self'",
  );
  try {
    const url = new URL(req.url, "http" + "://localhost");
    const routed = url.searchParams.get("_pit_path");
    if (routed) url.pathname = routed;
    if (req.method !== "GET" && req.method !== "HEAD") {
      if (
        req.headers.origin &&
        req.headers.origin !== "http" + "://" + req.headers.host &&
        req.headers.origin !== "https" + "://" + req.headers.host
      )
        fail(403, "Запрос с другого сайта запрещён");
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail(403, "Запрос с другого сайта запрещён");
      if (!req.headers["content-type"]?.startsWith("application/json"))
        fail(415, "Используйте JSON");
    }
    if (url.pathname === "/api/health")
      return json(res, {
        ok: true,
        version: 6,
        features: ["order-pdf"],
        database: process.env.DATABASE_URL ? "configured" : "not-configured",
      });
    // Public shells do not need a database connection. Private data still uses authenticated APIs.
    if (/^\/(app|admin)\/[a-z0-9-]+\/?$/.test(url.pathname) || url.pathname.startsWith("/assets/") || url.pathname === "/" || url.pathname === "/platform") {
      let shell;
      if (url.pathname === "/platform") shell=path.join(ROOT,"pit/platform.html");
      else if (url.pathname === "/") shell=path.join(ROOT,"pit/launch.html");
      else if (url.pathname.startsWith("/assets/")) {
        shell=path.resolve(ROOT,"pit",decodeURIComponent(url.pathname.slice(8)));
        if (!shell.startsWith(path.join(ROOT,"pit")+path.sep)) fail(403,"Запрещено");
      } else shell=path.join(ROOT,"pit",url.pathname.startsWith("/admin/")?"admin.html":"index.html");
      if (!fs.existsSync(shell) || !fs.statSync(shell).isFile()) fail(404,"Файл не найден");
      res.setHeader("Content-Type",mime[path.extname(shell)]||"application/octet-stream");
      res.setHeader("Cache-Control","no-cache");
      if (shell.endsWith("sw.js")) res.setHeader("Service-Worker-Allowed","/");
      return fs.createReadStream(shell).pipe(res);
    }
    if(url.pathname.startsWith("/api/platform/"))return await platform.route(req,res,url);
    await ensureReady();
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (url.pathname === "/qr") {
      const target = url.searchParams.get("path");
      if (!/^\/history\/[a-f0-9]{48}$/.test(target || ""))
        fail(400, "Некорректная ссылка");
      const origin =
        process.env.PUBLIC_ORIGIN ||
        (req.headers["x-forwarded-proto"] === "https" ? "https" : "http") +
          "://" +
          req.headers.host;
      let svg;
      try {
        svg = QRCode(origin + target);
      } catch (e) {
        fail(400, e.message);
      }
      res.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store",
      });
      return res.end(svg);
    }
    if (url.pathname === "/") {
      res.writeHead(302, {
        Location:
          "/app/" +
          (
            (process.env.STO_SLUG &&
              (await get(
                "SELECT slug FROM tenants WHERE slug=?",
                process.env.STO_SLUG,
              ))) ||
            (await get("SELECT slug FROM tenants ORDER BY slug LIMIT 1"))
          ).slug,
      });
      return res.end();
    }
    let file;
    if (/^\/(app|admin)\/[a-z0-9-]+\/?$/.test(url.pathname)) {
      await tenantBySlug(url.pathname.split("/")[2]);
      file = path.join(
        ROOT,
        "pit",
        url.pathname.startsWith("/admin/") ? "admin.html" : "index.html",
      );
    } else if (/^\/history\/[a-f0-9]{48}$/.test(url.pathname))
      file = path.join(ROOT, "pit/history.html");
    else if (url.pathname.startsWith("/assets/")) {
      const rel = decodeURIComponent(url.pathname.slice(8));
      file = path.resolve(ROOT, "pit", rel);
      if (!file.startsWith(path.join(ROOT, "pit") + path.sep))
        fail(403, "Запрещено");
    } else fail(404, "Страница не найдена");
    if (!fs.existsSync(file) || !fs.statSync(file).isFile())
      fail(404, "Файл не найден");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    if (file.endsWith("sw.js")) res.setHeader("Service-Worker-Allowed", "/");
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (!e.status) console.error("PIT request failed:", e.code || e.name);
    const conflict = ["23505", "23P01"].includes(e.code);
    const status = e.status || (conflict ? 409 : 500);
    if (!res.headersSent)
      json(
        res,
        {
          error: e.status
            ? e.message
            : conflict
              ? "Запись или ячейка уже занята. Обновите данные."
              : "Ошибка подключения к базе или сервера. Проверьте настройки окружения и журнал Vercel.",
        },
        status,
      );
    else res.end();
  }
}

async function storePhoto(...args) {
  return require("./storage").uploadPhoto(...args);
}

let ready;
async function ensureReady() {
  if (!ready)
    ready = transaction(async () => {
      const current = await get("SELECT id FROM tenants LIMIT 1");
      if (current) return;
      if (!process.env.OWNER_EMAIL || !process.env.OWNER_PASSWORD)
        fail(
          503,
          "Добавьте OWNER_EMAIL и OWNER_PASSWORD в окружение Vercel для первого запуска",
        );
      await createTenant(
        slug(process.env.STO_SLUG || "pit"),
        { ...defaults, name: process.env.STO_NAME || "Мой автосервис" },
        uid(),
        {
          email: email(process.env.OWNER_EMAIL),
          name: "Владелец",
          hash: hash(password(process.env.OWNER_PASSWORD)),
        },
      );
    });
  try {
    await ready;
  } catch (e) {
    ready = null;
    throw e;
  }
}
module.exports = { handle, ensureReady };
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer(handle);
  server.listen(port, process.env.HOST || "127.0.0.1", () =>
    console.log("ПИТ v6: порт " + port),
  );
  let ending = false;
  const shutdown = () => {
    if (ending) return;
    ending = true;
    server.close(async () => {
      await closeDB();
      process.exit(0);
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
