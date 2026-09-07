import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 900 } });

for (const cat of ["rebalancing","grid-trading","yield-optimisation","health-factor"]) {
  await p.goto(`http://localhost:3111/arena/${cat}`, { waitUntil: "networkidle" });

  const names = async () => p.$$eval("tr[data-agent-key] .khoros-stave-name", e => e.map(x => x.textContent.trim()));
  const before = await names();
  const copyBefore = (await p.textContent(".khoros-prune-copy")).replace(/\s+/g," ").trim();

  await p.click("button:has-text('Unfiltered')");
  await p.waitForTimeout(700);
  const after = await names();
  const fell = await p.$$eval("tr[data-fell='true']", e => e.length);

  console.log(`\n=== ${cat} ===`);
  console.log(`  pruned order    : ${before.join("  >  ")}`);
  console.log(`  unfiltered order: ${after.join("  >  ")}`);
  console.log(`  ORDER CHANGED   : ${JSON.stringify(before) !== JSON.stringify(after)}`);
  console.log(`  discard copy    : ${copyBefore.slice(0, 130)}`);
}
await b.close();
