import { chromium } from "playwright";
const b = await chromium.launch();

// --- 200% zoom (docs/08 requires testing this) ---
const z = await b.newPage({ viewport: { width: 640, height: 480 }, deviceScaleFactor: 2 });
await z.goto("http://localhost:3111/arena/rebalancing", { waitUntil: "networkidle" });
await z.evaluate(() => { document.body.style.zoom = "200%"; });
await z.waitForTimeout(400);
const zoomOverflow = await z.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 2);
console.log("200% zoom horizontal overflow:", zoomOverflow ? "YES" : "none");

// --- dark mode ---
const d = await b.newPage({ colorScheme: "dark" });
await d.goto("http://localhost:3111/", { waitUntil: "networkidle" });
const dark = await d.evaluate(() => {
  const s = getComputedStyle(document.body);
  const root = getComputedStyle(document.documentElement);
  return { bg: s.backgroundColor, fg: s.color, verdigris: root.getPropertyValue("--verdigris").trim() };
});
console.log("Dark mode:", dark);

// --- reduced motion: reorder must be instant, info identical ---
const rm = await b.newPage({ reducedMotion: "reduce" });
await rm.goto("http://localhost:3111/arena/rebalancing", { waitUntil: "networkidle" });
const dur = await rm.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--reorder-duration").trim());
console.log("Reduced-motion reorder duration:", dur);
await rm.click("button:has-text('Unfiltered')");
await rm.waitForTimeout(200);
const rmRows = await rm.$$eval("tr[data-agent-key]", r => r.length);
console.log("Reduced-motion still renders rows:", rmRows);

// --- sparkline alt text ---
const alt = await rm.$$eval("[role='img']", els => els.map(e => e.getAttribute("aria-label")).slice(0,2));
console.log("Sparkline alt text:", alt);

// --- headings hierarchy ---
const heads = await rm.$$eval("h1,h2,h3", els => els.map(e => `${e.tagName}:${e.textContent?.trim().slice(0,26)}`));
console.log("Heading order:", heads.slice(0, 6));

// --- /verify renders real params from the engine ---
const v = await b.newPage();
await v.goto("http://localhost:3111/verify", { waitUntil: "networkidle" });
const body = await v.textContent("body");
console.log("\n/verify shows real params:", { lambda: /0\.05/.test(body), sevenDays: /604,800|7 days/.test(body), weights: /0\.45/.test(body) });
console.log("/verify states the limitation:", /Stated limitation/i.test(body));

await b.close();
