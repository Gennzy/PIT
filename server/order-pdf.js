"use strict";
// Small server-side PDF renderer: embedded Cyrillic TrueType, selectable text, no external API.
const fs = require("node:fs"),
  path = require("node:path"),
  zlib = require("node:zlib");
let cachedFont;
function font() {
  if (cachedFont) return cachedFont;
  const bytes = fs.readFileSync(
    path.join(__dirname, "fonts/LiberationSans-Regular.ttf"),
  );
  const tables = {};
  for (let i = 0, n = bytes.readUInt16BE(4); i < n; i++) {
    const p = 12 + i * 16;
    tables[bytes.toString("ascii", p, p + 4)] = bytes.readUInt32BE(p + 8);
  }
  const head = tables.head,
    hhea = tables.hhea,
    units = bytes.readUInt16BE(head + 18),
    metrics = bytes.readUInt16BE(hhea + 34),
    cmap = tables.cmap;
  let sub;
  for (let i = 0, n = bytes.readUInt16BE(cmap + 2); i < n; i++) {
    const p = cmap + 4 + i * 8,
      o = cmap + bytes.readUInt32BE(p + 4);
    if (bytes.readUInt16BE(o) === 4) {
      sub = o;
      if (bytes.readUInt16BE(p) === 3) break;
    }
  }
  if (!sub) throw Error("TrueType cmap format 4 is required");
  const count = bytes.readUInt16BE(sub + 6) / 2,
    end = sub + 14,
    start = end + count * 2 + 2,
    delta = start + count * 2,
    range = delta + count * 2;
  function glyph(code) {
    for (let i = 0; i < count; i++) {
      if (code > bytes.readUInt16BE(end + i * 2)) continue;
      if (code < bytes.readUInt16BE(start + i * 2)) return 0;
      const d = bytes.readInt16BE(delta + i * 2),
        r = bytes.readUInt16BE(range + i * 2);
      if (!r) return (code + d) & 65535;
      const p =
        range + i * 2 + r + 2 * (code - bytes.readUInt16BE(start + i * 2));
      if (p >= bytes.length) return 0;
      const g = bytes.readUInt16BE(p);
      return g ? (g + d) & 65535 : 0;
    }
    return 0;
  }
  const scale = (v) => Math.round((v * 1000) / units);
  cachedFont = {
    bytes,
    glyph,
    width: (g) =>
      scale(bytes.readUInt16BE(tables.hmtx + Math.min(g, metrics - 1) * 4)),
    bbox: [0, 2, 4, 6].map((i) => scale(bytes.readInt16BE(head + 36 + i))),
    ascent: scale(bytes.readInt16BE(hhea + 4)),
    descent: scale(bytes.readInt16BE(hhea + 6)),
  };
  return cachedFont;
}
const clean = (v) =>
  String(v ?? "")
    .replace(/[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const money = (n) =>
  Number(n).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) + " руб.";
const date = (v) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v || "")
    ? v.split("-").reverse().join(".")
    : clean(v);
function model(config, booking) {
  const data = booking.data,
    car = booking.vehicleData,
    items = (data.items || []).map((x) => ({
      name: clean(x.n),
      price: Number(x.price),
      min: Number(x.min) || 0,
      extra: false,
    }));
  for (const f of data.findings || [])
    if (f.decision === "approved")
      items.push({
        name: clean(f.name),
        price: Number(f.price),
        min: Number(f.min) || 0,
        extra: true,
      });
  const sum = items.reduce((s, x) => s + x.price, 0);
  if (
    items.some((x) => !Number.isFinite(x.price) || x.price < 0) ||
    !Number.isFinite(Number(data.price)) ||
    Math.abs(sum - Number(data.price)) > 0.005
  ) {
    const e = Error(
      "Стоимость заказа не совпадает с составом работ. Проверьте заказ перед скачиванием",
    );
    e.status = 409;
    throw e;
  }
  const created = data.created ? new Date(data.created) : null;
  const stamp =
    created && !isNaN(created)
      ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow" })
          .format(created)
          .replace(/-/g, "")
      : "ID";
  return {
    config,
    booking,
    data,
    car,
    items,
    total: sum,
    number: stamp + "-" + booking.id,
    pending: (data.findings || []).filter((x) => x.decision === "pending")
      .length,
  };
}
function orderPDF(config, booking, generatedAt = new Date()) {
  const m = model(config, booking),
    { data, car } = m,
    f = font(),
    used = new Map(),
    pages = [];
  let ops, y;
  const W = 595.28,
    H = 841.89,
    L = 48,
    R = W - 48,
    WIDTH = R - L;
  const gray = [0.42, 0.44, 0.47],
    ink = [0.12, 0.14, 0.17],
    light = [0.95, 0.96, 0.97];
  const accent = /^#[a-f0-9]{6}$/i.test(config.accent || "")
    ? [1, 3, 5].map((i) => parseInt(config.accent.slice(i, i + 2), 16) / 255)
    : [0.92, 0.02, 0.1];
  function entry(ch) {
    if (!used.has(ch)) {
      const code = ch.codePointAt(0),
        g = f.glyph(code) || f.glyph(63);
      used.set(ch, {
        cid: used.size + 1,
        g,
        width: f.width(g),
        unicode: Buffer.from(ch, "utf16le")
          .swap16()
          .toString("hex")
          .toUpperCase(),
      });
    }
    return used.get(ch);
  }
  function encode(s) {
    return Array.from(clean(s), (ch) =>
      entry(ch).cid.toString(16).padStart(4, "0"),
    ).join("");
  }
  function measure(s, size) {
    return (
      (Array.from(clean(s), (ch) => entry(ch).width).reduce(
        (a, b) => a + b,
        0,
      ) *
        size) /
      1000
    );
  }
  function text(s, x, top, size = 11, color = ink) {
    ops.push(
      `BT /F1 ${size} Tf ${color.join(" ")} rg 1 0 0 1 ${x.toFixed(2)} ${(H - top).toFixed(2)} Tm <${encode(s)}> Tj ET`,
    );
  }
  function rect(x, top, w, h, color) {
    ops.push(`${color.join(" ")} rg ${x} ${H - top - h} ${w} ${h} re f`);
  }
  function line(top) {
    ops.push(`0.85 0.87 0.89 RG 0.6 w ${L} ${H - top} m ${R} ${H - top} l S`);
  }
  function wrap(s, size, width) {
    const words = clean(s).split(" "),
      out = [];
    let row = "";
    for (const word of words) {
      if (!word) continue;
      const next = row ? row + " " + word : word;
      if (measure(next, size) <= width) {
        row = next;
        continue;
      }
      if (row) {
        out.push(row);
        row = "";
      }
      let part = "";
      for (const ch of word) {
        if (part && measure(part + ch, size) > width) {
          out.push(part);
          part = "";
        }
        part += ch;
      }
      row = part;
    }
    if (row) out.push(row);
    return out.length ? out : ["—"];
  }
  function newPage(first = false) {
    ops = [];
    pages.push(ops);
    y = 42;
    text("ПИТ / ЗАКАЗ-НАРЯД", L, y, 10, gray);
    text(first ? "ДОКУМЕНТ ПО ЗАКАЗУ" : "ПРОДОЛЖЕНИЕ", R - 135, y, 9, gray);
    y += 26;
    if (first) {
      for (const r of wrap(config.name || "Автосервис", 21, WIDTH)) {
        text(r, L, y, 21);
        y += 23;
      }
      if (config.addr) {
        for (const r of wrap(config.addr, 11, WIDTH)) {
          text(r, L, y, 11, gray);
          y += 14;
        }
      }
      if (config.phone) {
        text("Телефон СТО: " + config.phone, L, y, 11, gray);
        y += 14;
      }
      y += 8;
    } else {
      text(config.name || "Автосервис", L, y, 12);
      y += 20;
    }
    line(y);
    y += 20;
    if (first) {
      text("Заказ-наряд", L, y, 22);
      y += 22;
    }
    text("Внутренний номер: " + m.number, L, y, 9, gray);
    y += 15;
  }
  function ensure(h) {
    if (y + h > H - 72) newPage();
  }
  function paragraph(s, size = 11, color = ink) {
    const rows = wrap(s, size, WIDTH);
    for (const r of rows) {
      ensure(size * 1.4 + 4);
      text(r, L, y, size, color);
      y += size * 1.4;
    }
    y += 4;
  }
  function section(title) {
    ensure(48);
    y += 8;
    text(title, L, y, 14);
    y += 20;
  }
  function field(label, value) {
    const rows = wrap(value || "Не указано", 11, WIDTH - 128);
    ensure(rows.length * 15 + 12);
    text(label, L, y, 10, gray);
    for (const r of rows) {
      text(r, L + 128, y, 11);
      y += 14;
    }
    y += 3;
  }
  function tableHead() {
    ensure(45);
    rect(L, y - 12, WIDTH, 28, light);
    text("№", L + 8, y + 6, 10);
    text("Работы / услуги", L + 32, y + 6, 10);
    text("Мин.", R - 150, y + 6, 10);
    text("Стоимость", R - 102, y + 6, 10);
    y += 34;
  }
  newPage(true);
  const statuses = {
    booked: "Записан — работы ещё не завершены",
    working: "В работе",
    completed: "Работы завершены",
    cancelled: "Запись отменена",
    waitlist: "Лист ожидания",
  };
  paragraph(
    "Статус: " + (statuses[booking.status] || booking.status),
    11,
    booking.status === "cancelled" ? [0.75, 0.08, 0.08] : ink,
  );
  paragraph(
    "Визит: " +
      date(booking.date) +
      " в " +
      String(Math.floor(booking.start / 60)).padStart(2, "0") +
      ":" +
      String(booking.start % 60).padStart(2, "0") +
      " · Пост " +
      booking.post +
      " · " +
      booking.duration +
      " мин.",
    11,
  );
  paragraph(
    "Сформирован: " +
      generatedAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" }),
    9,
    gray,
  );
  section("Клиент и автомобиль");
  field("Клиент", booking.client?.name);
  field("Телефон", data.phone || booking.client?.phone);
  field(
    "Автомобиль",
    [car.brand, car.model, car.year].filter(Boolean).join(" "),
  );
  field("Госномер", car.plate);
  field("Двигатель", car.engine);
  field(
    "Пробег на приёмке",
    data.km == null
      ? "Не указан"
      : Number(data.km).toLocaleString("ru-RU") + " км",
  );
  section("Работы и согласованные дополнения");
  tableHead();
  m.items.forEach((item, i) => {
    const rows = wrap(
        (item.extra ? "Допработа: " : "") + item.name,
        11,
        WIDTH - 193,
      ),
      height = Math.max(35, rows.length * 15 + 18);
    if (y + height > H - 72) {
      newPage();
      tableHead();
    }
    text(String(i + 1), L + 8, y, 10, gray);
    rows.forEach((r, n) => text(r, L + 32, y + n * 15, 11));
    text(String(item.min), R - 150, y, 11);
    const price = money(item.price);
    text(price, R - measure(price, 10) - 4, y, 10);
    y += height;
    line(y - 12);
  });
  ensure(64);
  y += 10;
  rect(L, y - 16, WIDTH, 44, light);
  text("ИТОГО ПО ЗАКАЗУ", L + 12, y + 9, 12);
  const total = money(m.total);
  text(total, R - measure(total, 16) - 12, y + 9, 16, accent);
  y += 52;
  if (m.pending)
    paragraph(
      "На согласовании: " +
        m.pending +
        ". Эти работы не включены в сумму заказа.",
      10,
      gray,
    );
  if (data.note) {
    section("Комментарий к заказу");
    paragraph(data.note);
  }
  ensure(138);
  section("Подписи сторон");
  paragraph(
    "Документ не является кассовым чеком и не подтверждает оплату. Без электронной подписи. Условия гарантии согласуются с исполнителем отдельно.",
    10,
    gray,
  );
  ensure(78);
  text("Исполнитель: __________________________", L, y + 16, 11);
  text("Клиент: ______________________________", L, y + 43, 11);
  y += 60;
  for (let i = 0; i < pages.length; i++) {
    ops = pages[i];
    line(H - 51);
    text("ПИТ · " + m.number, L, H - 33, 9, gray);
    text(i + 1 + " / " + pages.length, R - 34, H - 33, 9, gray);
  }
  const objects = [];
  const add = (value) => (objects.push(value), objects.length);
  const stream = (data, extra = "") => {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const packed = zlib.deflateSync(bytes);
    return Buffer.concat([
      Buffer.from(
        `<< /Length ${packed.length} /Filter /FlateDecode ${extra} >>\nstream\n`,
      ),
      packed,
      Buffer.from("\nendstream"),
    ]);
  };
  const catalog = add(""),
    pageTree = add(""),
    fontFile = add(stream(f.bytes, `/Length1 ${f.bytes.length}`));
  const descriptor = add(
    `<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [${f.bbox.join(" ")}] /ItalicAngle 0 /Ascent ${f.ascent} /Descent ${f.descent} /CapHeight ${f.ascent} /StemV 80 /FontFile2 ${fontFile} 0 R >>`,
  );
  const entries = [...used.values()],
    gids = Buffer.alloc((entries.length + 1) * 2);
  entries.forEach((e) => gids.writeUInt16BE(e.g, e.cid * 2));
  const mapId = add(stream(gids));
  const cid = add(
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW 500 /W [1 [${entries.map((e) => e.width).join(" ")}]] /CIDToGIDMap ${mapId} 0 R >>`,
  );
  let unicode =
    "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /PITUnicode def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
  for (let i = 0; i < entries.length; i += 100) {
    const part = entries.slice(i, i + 100);
    unicode +=
      part.length +
      " beginbfchar\n" +
      part
        .map((e) => `<${e.cid.toString(16).padStart(4, "0")}> <${e.unicode}>`)
        .join("\n") +
      "\nendbfchar\n";
  }
  unicode += "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
  const unicodeId = add(stream(unicode));
  const fontId = add(
    `<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${unicodeId} 0 R >>`,
  );
  const pageIds = pages.map((page) => {
    const content = add(stream(page.join("\n")));
    return add(
      `<< /Type /Page /Parent ${pageTree} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${content} 0 R >>`,
    );
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pageTree} 0 R >>`;
  objects[pageTree - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((i) => i + " 0 R").join(" ")}] /Count ${pages.length} >>`;
  const chunks = [Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1")],
    offsets = [0];
  let offset = chunks[0].length;
  objects.forEach((obj, i) => {
    offsets.push(offset);
    const bytes = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      Buffer.isBuffer(obj) ? obj : Buffer.from(obj),
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(bytes);
    offset += bytes.length;
  });
  const xref = offset;
  chunks.push(
    Buffer.from(
      "xref\n0 " +
        (objects.length + 1) +
        "\n0000000000 65535 f \n" +
        offsets
          .slice(1)
          .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
          .join("") +
        "trailer\n<< /Size " +
        (objects.length + 1) +
        " /Root " +
        catalog +
        " 0 R >>\nstartxref\n" +
        xref +
        "\n%%EOF\n",
    ),
  );
  return Buffer.concat(chunks);
}
module.exports = { orderPDF, model };
