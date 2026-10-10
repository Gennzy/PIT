"use strict";
const { test, before, after } = require("node:test"),
  assert = require("node:assert/strict"),
  { spawn } = require("node:child_process"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pit-platform-")),
  port = 4500 + Math.floor(Math.random() * 400),
  base = "http://127.0.0.1:" + port;
let server, A, B, clientCookie, sharedPath;
const cookies = {};
const admin = {
    email: "admin@platform.test",
    password: "Platform-Fixture-Secret-2026",
  },
  owner = {
    name: "Владелец А",
    email: "owner-a@fixture.test",
    password: "Owner-A-Fixture-2026",
  };
async function req(who, url, method = "GET", data, headers = {}) {
  const r = await fetch(base + url, {
    method,
    headers: {
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(cookies[who] ? { Cookie: cookies[who] } : {}),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (r.headers.get("set-cookie"))
    cookies[who] = r.headers.get("set-cookie").split(";")[0];
  return { status: r.status, data: await r.json(), headers: r.headers };
}
const p = (who, url = "", method = "GET", data, headers) =>
  req(who, "/api/platform/" + url, method, data, headers);
const t = (who, slug, url, method = "GET", data) =>
  req(who, "/api/t/" + slug + "/" + url, method, data);
function ok(r, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  server = spawn(process.execPath, ["server/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      NODE_ENV: "test",
      TEST_SQLITE_FILE: path.join(dir, "db.sqlite"),
      OWNER_EMAIL: "",
      OWNER_PASSWORD: "",
      PLATFORM_ADMIN_EMAIL: admin.email,
      PLATFORM_ADMIN_PASSWORD: admin.password,
      PLATFORM_ADMIN_SECRET: "test-fixture-platform-secret-32-characters",
      TZ: "Europe/Moscow",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  server.stderr.on("data", (d) => (logs += d));
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 40));
    try {
      if ((await fetch(base + "/api/health")).ok) return;
    } catch {}
    if (server.exitCode !== null) throw Error(logs);
  }
  throw Error(logs);
});
after(async () => {
  server.kill();
  await new Promise((r) => server.once("exit", r));
  fs.rmSync(dir, { recursive: true, force: true });
});
test("P01 platform shell is distinct; anonymous and bad password rejected", async () => {
  assert.equal((await fetch(base + "/platform")).status, 200);
  assert.equal((await p("anon", "companies")).status, 401);
  assert.equal(
    (
      await p("bad", "login", "POST", {
        ...admin,
        password: "Wrong-Fixture-Secret-2026",
      })
    ).status,
    401,
  );
  const r = await p("platform", "login", "POST", admin);
  ok(r);
  assert(r.headers.get("set-cookie").includes("HttpOnly"));
  assert(r.headers.get("set-cookie").includes("SameSite=Strict"));
  assert(r.headers.get("set-cookie").includes("Path=/api/platform"));
  assert.equal(ok(await p("platform", "companies")).length, 0);
});
test("P02 create first company without legacy owner bootstrap", async () => {
  A = ok(
    await p("platform", "companies", "POST", {
      name: "Автосервис Север",
      slug: "north-auto",
      owner,
      config: {
        timezone: "Asia/Vladivostok",
        accent: "#ec0618",
        shortName: "Север",
      },
    }),
    201,
  );
  assert.equal(A.branches.length, 1);
  assert.equal(A.branches[0].owner.email, owner.email);
  assert.equal(A.branches[0].config.timezone, "Asia/Vladivostok");
  assert(!JSON.stringify(A).includes("hash"));
  assert(!JSON.stringify(A).includes(owner.password));
});
test("P03 second independent company and owner group isolated", async () => {
  B = ok(
    await p("platform", "companies", "POST", {
      name: "Гараж Юг",
      slug: "south-auto",
      owner: { ...owner, email: "owner-b@fixture.test", name: "Владелец Б" },
    }),
    201,
  );
  assert.notEqual(A.id, B.id);
  ok(
    await t("owner-a", "north-auto", "login", "POST", {
      email: owner.email,
      password: owner.password,
    }),
  );
  ok(
    await t("owner-b", "south-auto", "login", "POST", {
      email: "owner-b@fixture.test",
      password: owner.password,
    }),
  );
  assert.equal(ok(await t("owner-a", "north-auto", "tenants")).length, 1);
  assert.equal((await t("owner-a", "south-auto", "vehicles")).status, 401);
  assert.equal((await p("owner-a", "companies")).status, 401);
  assert.equal((await t("platform", "north-auto", "config")).status, 401);
  assert.equal((await p("owner-a", "login", "POST", owner)).status, 401);
});
test("P04 duplicate slug rolls back the entire company", async () => {
  const before = ok(await p("platform", "companies")).length;
  assert.equal(
    (
      await p("platform", "companies", "POST", {
        name: "Дубликат",
        slug: "north-auto",
        owner,
      })
    ).status,
    409,
  );
  assert.equal(ok(await p("platform", "companies")).length, before);
});
test("P05 branch shares only its company owner and copies no client data", async () => {
  ok(
    await t("client-a", "north-auto", "register", "POST", {
      email: "client@fixture.test",
      password: "Client-Fixture-2026",
      name: "Клиент",
    }),
  );
  const v = ok(
    await t("client-a", "north-auto", "vehicles", "POST", {
      brand: "Example",
      model: "Fixture",
      year: 2020,
      km: 100,
      plate: "ДЕМО",
    }),
    201,
  );
  sharedPath = ok(
    await t("client-a", "north-auto", "share/" + v.id, "POST", {}),
  ).path;
  A = ok(
    await p("platform", "companies/" + A.id + "/branches", "POST", {
      name: "Север · Центр",
      slug: "north-centre",
      revision: A.revision,
    }),
    201,
  );
  assert.equal(A.branches.length, 2);
  assert.equal(
    A.branches.find((b) => b.slug === "north-centre").config.timezone,
    "Asia/Vladivostok",
  );
  ok(
    await t("branch-owner", "north-centre", "login", "POST", {
      email: owner.email,
      password: owner.password,
    }),
  );
  assert.equal(ok(await t("branch-owner", "north-centre", "users")).length, 1);
  assert.equal(
    ok(await t("branch-owner", "north-centre", "vehicles")).length,
    0,
  );
  assert.equal(ok(await t("owner-a", "north-auto", "tenants")).length, 2);
  assert.equal(ok(await t("owner-b", "south-auto", "tenants")).length, 1);
});
test("P06 validated brand and schedule update with revisions", async () => {
  let b = A.branches.find((x) => x.slug === "north-auto");
  A = ok(
    await p("platform", "companies/" + A.id + "/branches/north-auto", "PUT", {
      config: {
        ...b.config,
        name: "Север · Основной",
        timezone: "Asia/Yekaterinburg",
        shortName: "Север ПИТ",
      },
      revision: b.revision,
      companyRevision: A.revision,
    }),
  );
  const pub = ok(await t("anon", "north-auto", "public"));
  assert.equal(pub.config.name, "Север · Основной");
  assert.equal(pub.config.timezone, "Asia/Yekaterinburg");
  const manifest = ok(await t("anon", "north-auto", "manifest.webmanifest"));
  assert.equal(manifest.short_name, "Север ПИТ");
  assert.equal(
    (
      await p("platform", "companies/" + A.id + "/branches/north-auto", "PUT", {
        config: b.config,
        revision: b.revision,
        companyRevision: A.revision,
      })
    ).status,
    409,
  );
});
test("P07 unsafe logos, invalid timezone and foreign branch rejected", async () => {
  const b = A.branches.find((x) => x.slug === "north-auto"),
    payload = {
      config: b.config,
      revision: b.revision,
      companyRevision: A.revision,
    };
  for (const change of [
    { timezone: "Bad/Zone" },
    { logo: "data:image/svg+xml;base64,PHN2Zz4=" },
    { logo: "data:image/png;base64,AAAA" },
    { accent: "javascript:alert(1)" },
  ])
    assert.equal(
      (
        await p(
          "platform",
          "companies/" + A.id + "/branches/north-auto",
          "PUT",
          { ...payload, config: { ...b.config, ...change } },
        )
      ).status,
      400,
    );
  assert.equal(
    (
      await p(
        "platform",
        "companies/" + A.id + "/branches/south-auto",
        "PUT",
        payload,
      )
    ).status,
    404,
  );
});
test("P08 stale company revision and cross-origin mutation rejected", async () => {
  assert.equal(
    (
      await p("platform", "companies/" + A.id, "PATCH", {
        status: "paused",
        revision: A.revision - 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await p(
        "platform",
        "companies/" + A.id,
        "PATCH",
        { status: "paused", revision: A.revision },
        { Origin: "https://evil.test" },
      )
    ).status,
    403,
  );
});
test("P09 pause blocks all company branches and revokes existing sessions", async () => {
  clientCookie = cookies["client-a"];
  A = ok(
    await p("platform", "companies/" + A.id, "PATCH", {
      status: "paused",
      revision: A.revision,
    }),
  );
  for (const branch of ["north-auto", "north-centre"]) {
    assert.equal((await t("anon", branch, "public")).status, 423);
    assert.equal((await t("owner-a", branch, "me")).status, 423);
    assert.equal(
      (await t("owner-a", branch, "login", "POST", owner)).status,
      423,
    );
  }
  assert.equal((await t("owner-b", "south-auto", "me")).status, 200);
  assert.equal(
    (await fetch(base + "/api/shared/" + sharedPath.split("/")[2])).status,
    423,
  );
});
test("P10 resume retains accounts and requires new login", async () => {
  A = ok(
    await p("platform", "companies/" + A.id, "PATCH", {
      status: "active",
      revision: A.revision,
    }),
  );
  assert.equal((await t("owner-a", "north-auto", "me")).status, 401);
  assert.equal((await t("client-a", "north-auto", "me")).status, 401);
  ok(
    await t("owner-a", "north-auto", "login", "POST", {
      email: owner.email,
      password: owner.password,
    }),
  );
  assert.equal(ok(await t("owner-a", "north-auto", "users")).length, 2);
  assert.equal(
    (await fetch(base + "/api/shared/" + sharedPath.split("/")[2])).status,
    200,
  );
});
test("P11 expired access and extension enforced on server", async () => {
  A = ok(
    await p("platform", "companies/" + A.id, "PATCH", {
      accessUntil: "2020-01-01",
      revision: A.revision,
    }),
  );
  assert(A.expired);
  assert.equal((await t("anon", "north-auto", "public")).status, 423);
  A = ok(
    await p("platform", "companies/" + A.id, "PATCH", {
      accessUntil: "2099-12-31",
      revision: A.revision,
    }),
  );
  assert(!A.expired);
  assert.equal((await t("anon", "north-auto", "public")).status, 200);
});
test("P12 replace owner across branches and invalidate old passwords/sessions", async () => {
  A = ok(
    await p("platform", "companies/" + A.id + "/owner", "PUT", {
      revision: A.revision,
      owner: {
        name: "Новый владелец",
        email: "new-owner@fixture.test",
        password: "Replacement-Fixture-2026",
      },
    }),
  );
  for (const branch of ["north-auto", "north-centre"]) {
    assert.equal(
      (
        await t("old", branch, "login", "POST", {
          email: owner.email,
          password: owner.password,
        })
      ).status,
      401,
    );
    ok(
      await t("new-" + branch, branch, "login", "POST", {
        email: "new-owner@fixture.test",
        password: "Replacement-Fixture-2026",
      }),
    );
  }
  assert.equal((await t("branch-owner", "north-centre", "me")).status, 401);
});
test("P13 audit and company metadata contain no passwords or order records", async () => {
  const logs = ok(await p("platform", "audit"));
  assert(logs.some((x) => x.action === "company.create"));
  assert(logs.some((x) => x.action === "company.owner.reset"));
  const text = JSON.stringify({
    logs,
    companies: ok(await p("platform", "companies")),
  });
  for (const secret of [
    owner.password,
    admin.password,
    "Replacement-Fixture-2026",
  ])
    assert(!text.includes(secret));
  assert(!text.includes('"hash"'));
  assert(!text.includes('"bookings"'));
});
test("P14 malformed date, empty owner and unsupported company deletion rejected", async () => {
  assert.equal(
    (
      await p("platform", "companies/" + A.id, "PATCH", {
        accessUntil: "2026-02-30",
        revision: A.revision,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await p("platform", "companies", "POST", {
        name: "No owner",
        slug: "no-owner",
        owner: {},
      })
    ).status,
    400,
  );
  assert.equal(
    (await p("platform", "companies/" + A.id, "DELETE", {})).status,
    405,
  );
});
test("P15 logout revokes platform token without affecting tenant cookie", async () => {
  ok(await p("platform", "logout", "POST", {}));
  assert.equal((await p("platform", "companies")).status, 401);
  assert.equal((await t("owner-b", "south-auto", "me")).status, 200);
});
test("P16 civil timezone dates, rollover and local minutes", () => {
  const { civilDate, localMinutes } = require("../server/tenant-time");
  const instant = new Date("2026-10-10T20:30:00Z");
  assert.equal(civilDate(0, "Europe/Moscow", instant), "2026-10-10");
  assert.equal(civilDate(0, "Asia/Vladivostok", instant), "2026-10-11");
  assert.equal(civilDate(1, "Asia/Vladivostok", instant), "2026-10-12");
  assert.equal(localMinutes("Asia/Vladivostok", instant), 390);
  assert.equal(
    civilDate(1, "America/New_York", new Date("2026-03-08T05:30:00Z")),
    "2026-03-09",
  );
});

test("P17 credential rotation invalidates a stored platform session", async () => {
  const crypto = require("node:crypto"),
    keys = [
      "PLATFORM_ADMIN_EMAIL",
      "PLATFORM_ADMIN_PASSWORD",
      "PLATFORM_ADMIN_SECRET",
    ],
    old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    process.env.PLATFORM_ADMIN_EMAIL = admin.email;
    process.env.PLATFORM_ADMIN_PASSWORD = admin.password;
    process.env.PLATFORM_ADMIN_SECRET =
      "unit-fixture-secret-with-32-characters";
    const credential = crypto
      .createHmac("sha256", process.env.PLATFORM_ADMIN_SECRET)
      .update(admin.email + "\0" + admin.password)
      .digest("hex");
    const module = require("../server/platform")({
      email: (v) => v,
      fail: (status, msg) => {
        throw Object.assign(Error(msg), { status });
      },
      get: async () => ({ credential, expires: Date.now() + 10000 }),
      json: (_, v) => v,
    });
    const request = {
        method: "GET",
        headers: { cookie: "pit_platform=" + "a".repeat(64) },
      },
      url = new URL("http://local/api/platform/me");
    assert.equal((await module.route(request, {}, url)).email, admin.email);
    process.env.PLATFORM_ADMIN_PASSWORD = "Rotated-Fixture-Password-2026";
    await assert.rejects(
      () => module.route(request, {}, url),
      (e) => e.status === 401,
    );
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});
test("P18 missing platform credentials fail closed before database access", async () => {
  const keys = [
      "PLATFORM_ADMIN_EMAIL",
      "PLATFORM_ADMIN_PASSWORD",
      "PLATFORM_ADMIN_SECRET",
    ],
    old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  try {
    for (const k of keys) delete process.env[k];
    let used = false;
    const module = require("../server/platform")({
      email: (v) => v,
      fail: (status, msg) => {
        throw Object.assign(Error(msg), { status });
      },
      get: async () => {
        used = true;
      },
      limit: async () => {
        used = true;
      },
    });
    await assert.rejects(
      () =>
        module.route(
          { method: "POST", headers: {} },
          {},
          new URL("http://local/api/platform/login"),
        ),
      (e) => e.status === 503,
    );
    assert.equal(used, false);
  } finally {
    for (const k of keys) {
      if (old[k] === undefined) delete process.env[k];
      else process.env[k] = old[k];
    }
  }
});


test("P19 short admin password and short secret authenticate; wrong password is denied", async () => {
 const crypto=require("node:crypto"),keys=["PLATFORM_ADMIN_EMAIL","PLATFORM_ADMIN_PASSWORD","PLATFORM_ADMIN_SECRET"],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  process.env.PLATFORM_ADMIN_EMAIL=admin.email;process.env.PLATFORM_ADMIN_PASSWORD="short";process.env.PLATFORM_ADMIN_SECRET="tiny";
  const stored=new Map();let cookie="";
  const module=require("../server/platform")({email:v=>v,fail:(status,msg)=>{throw Object.assign(Error(msg),{status})},limit:async()=>{},transaction:async fn=>fn(),body:async req=>req.data,run:async(sql,...args)=>{if(sql.startsWith("INSERT INTO platform_sessions"))stored.set(args[0],{credential:args[1],expires:args[2]})},get:async(sql,token)=>stored.get(token),uid:()=>crypto.randomUUID(),now:()=>new Date().toISOString(),json:(_,v)=>v});
  const res={setHeader:(name,value)=>{if(name==="Set-Cookie")cookie=value}},url=new URL("http://local/api/platform/login");
  const result=await module.route({method:"POST",headers:{},data:{email:admin.email,password:"short"}},res,url);
  assert.equal(result.email,admin.email);assert(cookie.includes("HttpOnly"));
  const me=await module.route({method:"GET",headers:{cookie:cookie.split(";")[0]}},{},new URL("http://local/api/platform/me"));assert.equal(me.email,admin.email);
  await assert.rejects(()=>module.route({method:"POST",headers:{},data:{email:admin.email,password:"wrong"}},res,url),e=>e.status===401);
 } finally {for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});
test("P20 blank admin password or secret remain disabled; browser no longer requires 16",async()=>{
 const keys=["PLATFORM_ADMIN_EMAIL","PLATFORM_ADMIN_PASSWORD","PLATFORM_ADMIN_SECRET"],old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 try {
  const module=require("../server/platform")({email:v=>v,fail:(status,msg)=>{throw Object.assign(Error(msg),{status})}});
  for(const values of [["","tiny"],["short",""]]){process.env.PLATFORM_ADMIN_EMAIL=admin.email;process.env.PLATFORM_ADMIN_PASSWORD=values[0];process.env.PLATFORM_ADMIN_SECRET=values[1];await assert.rejects(()=>module.route({method:"GET",headers:{}},{},new URL("http://local/api/platform/me")),e=>e.status===503);}
  const js=fs.readFileSync(path.resolve(__dirname,"../pit/platform.js"),"utf8");const login=js.slice(js.indexOf("function login()"),js.indexOf("function render()"));assert(!login.includes('minlength="16"'));assert(login.includes('maxlength="128"'));
 } finally {for(const k of keys){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
});
