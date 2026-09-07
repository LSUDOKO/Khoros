import { chromium } from "playwright";
const b = await chromium.launch();

// --- 320px mobile ---
const mob = await b.newPage({ viewport: { width: 320, height: 720 } });
await mob.goto("http://localhost:3111/arena/rebalancing", { waitUntil: "networkidle" });
const overflow = await mob.evaluate(() => ({
  bodyScrollW: document.body.scrollWidth,
  clientW: document.documentElement.clientWidth,
}));
console.log("320px horizontal overflow:", overflow.bodyScrollW > overflow.clientW ? `YES (${overflow.bodyScrollW} > ${overflow.clientW})` : "none");

// metric slots still all visible?
const slots = await mob.$$eval(".khoros-metric", els => els.length);
console.log("320px metric slots rendered:", slots);

// --- touch targets ---
const small = await mob.$$eval("a, button", els =>
  els.filter(e => { const r = e.getBoundingClientRect(); return r.height > 0 && r.height < 44; })
     .map(e => `${e.tagName}: ${e.textContent?.trim().slice(0,28)} (${Math.round(e.getBoundingClientRect().height)}px)`)
);
console.log("Touch targets under 44px:", small.length ? small.slice(0,6) : "none");

// --- keyboard: can we reach and operate the prune toggle? ---
const desk = await b.newPage({ viewport: { width: 1280, height: 900 } });
await desk.goto("http://localhost:3111/arena/rebalancing", { waitUntil: "networkidle" });
let reached = false;
for (let i = 0; i < 14; i++) {
  await desk.keyboard.press("Tab");
  const t = await desk.evaluate(() => document.activeElement?.textContent?.trim());
  if (t === "Unfiltered") { reached = true; break; }
}
console.log("Keyboard reaches prune toggle:", reached);
if (reached) {
  await desk.keyboard.press("Enter");
  await desk.waitForTimeout(300);
  const copy = await desk.textContent(".khoros-prune-copy");
  console.log("Keyboard activates it:", /unfiltered registry averages/i.test(copy ?? ""));
}

// --- focus visibility ---
const outline = await desk.evaluate(() => {
  const el = document.querySelector("button");
  el?.focus();
  const s = getComputedStyle(el);
  return { outlineWidth: s.outlineWidth, outlineColor: s.outlineColor };
});
console.log("Focus ring:", outline);

// --- semantic table for screen readers ---
const tableInfo = await desk.evaluate(() => {
  const t = document.querySelector("table.khoros-arena");
  return t ? { caption: !!t.querySelector("caption"), headers: t.querySelectorAll("th[scope='col']").length, rowHeaders: t.querySelectorAll("th[scope='row']").length } : null;
});
console.log("Semantic table:", tableInfo);

await b.close();
