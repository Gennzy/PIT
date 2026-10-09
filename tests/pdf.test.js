"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { model, orderPDF } = require("../server/order-pdf");
const cfg = {
  name: "Тестовое СТО",
  addr: "Тестовая улица, 1",
  phone: "+7 000 000-00-00",
  accent: "#EC0618",
};
function fixture() {
  return {
    id: "11111111-2222-4333-8444-555555555555",
    date: "2026-10-10",
    start: 570,
    duration: 70,
    post: 1,
    status: "working",
    client: { name: "Тестовый клиент" },
    vehicleData: {
      brand: "Volkswagen",
      model: "Golf II",
      year: 1990,
      plate: "А000АА00",
    },
    data: {
      created: "2026-10-09T10:00:00Z",
      phone: "+7 000 000-00-00",
      km: 100000,
      price: 4900,
      items: [{ n: "Диагностика", price: 1500, min: 40 }],
      findings: [
        { name: "Колодки", price: 3400, min: 30, decision: "approved" },
        { name: "Амортизаторы", price: 9000, min: 60, decision: "pending" },
        { name: "Отклонено", price: 2000, min: 30, decision: "declined" },
      ],
      note: "Комментарий клиента",
    },
  };
}
test("28 PDF includes only approved additions in the total", () => {
  const m = model(cfg, fixture());
  assert.equal(m.items.length, 2);
  assert.equal(m.total, 4900);
  assert.equal(m.pending, 1);
  assert.equal(m.items[1].extra, true);
});
test("29 inconsistent saved price is rejected, not printed silently", () => {
  const b = fixture();
  b.data.price = 1;
  assert.throws(
    () => orderPDF(cfg, b),
    (e) => e.status === 409,
  );
});
test("30 document number is stable when visit is rescheduled", () => {
  const b = fixture(),
    first = model(cfg, b).number;
  b.date = "2026-10-12";
  assert.equal(model(cfg, b).number, first);
  assert(first.endsWith(b.id));
});
test("31 PDF is self-contained, embeds font and Unicode mapping", () => {
  const bytes = orderPDF(cfg, fixture(), new Date("2026-10-09T10:30:00Z"));
  assert(bytes.subarray(0, 8).toString().startsWith("%PDF-1.7"));
  const raw = bytes.toString("latin1");
  assert(raw.includes("/FontFile2"));
  assert(raw.includes("/ToUnicode"));
  assert(raw.includes("/CIDToGIDMap"));
  assert(raw.includes("/Count 1"));
  assert(raw.endsWith("%%EOF\n"));
  assert(bytes.length < 500000);
});
test("32 long order creates multiple pages with headers", () => {
  const b = fixture();
  b.data.items = Array.from({ length: 25 }, (_, i) => ({
    n:
      "Работа " +
      i +
      ": проверка состояния узлов автомобиля по результатам осмотра",
    price: 1000,
    min: 20,
  }));
  b.data.findings = [];
  b.data.price = 25000;
  const raw = orderPDF(cfg, b).toString("latin1");
  const count = Number(raw.match(/\/Count (\d+)/)[1]);
  assert(count >= 2);
});
