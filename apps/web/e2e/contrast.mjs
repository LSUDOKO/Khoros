import { chromium } from "playwright";
const b = await chromium.launch();
function lum(rgb){const[r,g,bb]=rgb.match(/\d+/g).map(n=>n/255);const f=c=>c<=0.03928?c/12.92:((c+0.055)/1.055)**2.4;return 0.2126*f(r)+0.7152*f(g)+0.0722*f(bb);}
function ratio(a,c){const la=lum(a),lb=lum(c);const hi=Math.max(la,lb),lo=Math.min(la,lb);return (hi+0.05)/(lo+0.05);}

for (const scheme of ["light","dark"]) {
  const p = await b.newPage({ colorScheme: scheme });
  await p.goto("http://localhost:3111/arena/rebalancing", { waitUntil: "networkidle" });
  const checks = await p.evaluate(() => {
    const out = [];
    const bg = getComputedStyle(document.body).backgroundColor;
    for (const sel of [".khoros-label", ".khoros-brass", ".khoros-data", ".khoros-prune-option[data-active='true']", ".btn-secondary"]) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const s = getComputedStyle(el);
      out.push({ sel, color: s.color, bg: s.backgroundColor === "rgba(0, 0, 0, 0)" ? bg : s.backgroundColor });
    }
    return out;
  });
  console.log(`--- ${scheme} ---`);
  for (const c of checks) {
    const r = ratio(c.color, c.bg);
    console.log(`  ${c.sel.padEnd(42)} ${r.toFixed(2)}:1 ${r >= 4.5 ? "PASS" : "FAIL"}`);
  }
}
await b.close();
