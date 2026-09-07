import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
const problems = [];
p.on("pageerror", e => problems.push(`PAGEERROR ${p.url()}: ${e.message}`));
// Dev-mode hot-reload chatter is not a product defect.
p.on("console", m => {
  const t = m.text();
  if (m.type() === "error" && !/favicon|RSC payload|Failed to fetch/.test(t)) {
    problems.push(`CONSOLE ${p.url()}: ${t.slice(0, 160)}`);
  }
});

const routes = ["/", "/arena", "/arena/rebalancing", "/arena/grid-trading",
  "/arena/yield-optimisation", "/arena/health-factor", "/verify", "/benchmark",
  "/dashboard", "/agent/950000000", "/agent/950000001", "/hire/950000000",
  "/agent/1", "/agent/99999999999", "/hire/99999999999", "/dashboard/session/0xabc"];

for (const r of routes) {
  const res = await p.goto(`http://localhost:3111${r}`, { waitUntil: "networkidle" });
  // Only what a user actually reads, not framework payloads in <script>.
  const txt = await p.evaluate(() => document.querySelector("main")?.innerText ?? "");
  const h1 = await p.$eval("h1", e => e.textContent.trim()).catch(() => "(none)");
  // Look for anything that reads like an unhandled failure surfaced to a user.
  const raw = /Application error|Unhandled Runtime|TypeError|\bNaN\b|\[object Object\]|undefined/i.test(txt);
  console.log(`${String(res.status()).padEnd(4)} ${r.padEnd(30)} h1="${h1.slice(0,34)}"${raw ? "  <-- RAW ERROR TEXT" : ""}`);
}

console.log("\n=== profile of a wash-rated agent shows discarded reviews? ===");
await p.goto("http://localhost:3111/agent/950000001", { waitUntil: "networkidle" });
const body = await p.textContent("body");
console.log("  mentions discarded:", /set aside|discarded/i.test(body));
console.log("  labelled curated  :", /curated listing/i.test(body));

console.log("\n=== errors ===");
console.log(problems.length ? problems : "none");
await b.close();
