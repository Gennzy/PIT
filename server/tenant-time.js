"use strict";
function zone(value) {
  if (typeof value !== "string" || value.length > 80)
    throw Error("Некорректный часовой пояс");
  new Intl.DateTimeFormat("en", { timeZone: value }).format();
  return value;
}
function parts(timeZone, instant = new Date()) {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(instant)
      .map((x) => [x.type, x.value]),
  );
}
function civilDate(
  offset = 0,
  timeZone = "Europe/Moscow",
  instant = new Date(),
) {
  const p = parts(timeZone, instant),
    d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + offset));
  return d.toISOString().slice(0, 10);
}
function localMinutes(timeZone, instant = new Date()) {
  const p = parts(timeZone, instant);
  return +p.hour * 60 + +p.minute;
}
module.exports = { zone, civilDate, localMinutes };
