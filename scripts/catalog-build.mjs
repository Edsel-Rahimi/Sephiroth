#!/usr/bin/env node
/**
 * catalog-build.mjs — Sephiroth catalog builder
 * - renumbers .pfoot .pg spans + figure captions sequentially at print time
 * - overflow probe: chrome --dump-dom on a probe copy → reports pages whose content is cut
 * - prints PDF via headless chromium from a temp copy IN THE SAME DIRECTORY
 *   (so relative fonts/screenshots resolve and embed)
 *
 * Usage: node scripts/catalog-build.mjs docs/sephiroth-catalog-fa.html [--no-pdf] [--no-renumber]
 */
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const CHROME = "/home/z/.cache/ms-playwright/chromium-1200/chrome-linux64/chrome";
const FA_DIGITS = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--"));
const NO_PDF = args.includes("--no-pdf");
const NO_RENUMBER = args.includes("--no-renumber");
if (!src || !existsSync(src)) {
  console.error("usage: node scripts/catalog-build.mjs <catalog.html> [--no-pdf] [--no-renumber]");
  process.exit(1);
}
const lang = basename(src).match(/(catalog|sephiroth-beginner-guide)-([a-z]+)\.html/)?.[2] ?? "en";
const pad2 = (n) => String(n).padStart(2, "0");
const digits = (n) =>
  lang === "fa" ? pad2(n).replace(/\d/g, (d) => FA_DIGITS[+d]) : pad2(n);

let html = readFileSync(src, "utf8");

// ── 0. renumber figure captions (<figcaption …><span class="step">تصویر ۱</span>) ─
const CAP_PREFIX = { fa: "تصویر", en: "Figure", ar: "صورة", zh: "图", tr: "Şekil", ru: "Рисунок" };
if (!NO_RENUMBER) {
  let f = 0;
  html = html.replace(/(<figcaption[^>]*><span class="step">)([^<]*?)(\d+|[۰-۹]+)(<\/span>)/g, (_m, a, _pre, _num, z) => {
    f += 1;
    return `${a}${CAP_PREFIX[lang] ?? "Figure"} ${digits(f).replace(/^0/, "")}${z}`;
  });
  console.log(`[figures] renumbered ${f} captions`);

  // ── 1. renumber .pg spans in DOM order (cover has none) ─────────────
  let i = 1; // first .page after cover is 2
  html = html.replace(/(<span class="pg">)[^<]*(<\/span>)/g, (_m, a, b) => {
    i += 1;
    return `${a}${digits(i - 1)}${b}`;
  });
  console.log(`[renumber] ${i - 1} numbered footers (last = ${digits(i - 1)})`);
}

const dir = resolve(join(src, ".."));
const probePath = join(dir, `.build-probe-${basename(src)}`);
const printPath = join(dir, `.build-print-${basename(src)}`);

// probe copy: renumbered + probe script (dump-dom pass only)
const probeScript = `<script>
window.addEventListener("load", () => {
  try {
    const pages = [...document.querySelectorAll(".page, .cover")];
    const bad = [];
    pages.forEach((p, idx) => {
      const oh = p.scrollHeight - p.clientHeight;
      if (oh > 4) bad.push((idx + 1) + ":" + oh + "px");
    });
    const r = document.createElement("div");
    r.id = "overflow-report-content";
    r.style.cssText = "position:fixed;top:-9999px;left:-9999px";
    r.textContent = "PAGES=" + pages.length + " OVERFLOW=" + (bad.length ? bad.join(",") : "none");
    document.body.appendChild(r);
  } catch (e) {}
});
</scr` + `ipt>`;
writeFileSync(probePath, html + probeScript);

// print copy: renumbered, no probe script
writeFileSync(printPath, html);

// ── 2. dump-dom probe pass ───────────────────────────────────────────
try {
  const dom = execFileSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
     "--virtual-time-budget=12000", "--dump-dom", "file://" + probePath],
    { encoding: "utf8", maxBuffer: 512 * 1024 * 1024, timeout: 180000, stdio: ["ignore", "pipe", "ignore"] }
  );
  const m = dom.match(/PAGES=(\d+) OVERFLOW=([^<]*)/);
  if (m) console.log(`[probe] pages=${m[1]} overflow=${m[2]}`);
  else console.log("[probe] report missing (check fonts)");
} catch (e) {
  console.log("[probe] skipped:", String(e.message).slice(0, 120));
}

// ── 3. print PDF ─────────────────────────────────────────────────────
if (!NO_PDF) {
  const out = resolve(src.replace(/\.html$/, ".pdf"));
  execFileSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
     "--virtual-time-budget=20000", "--run-all-compositor-stages-before-draw",
     "--print-to-pdf=" + out, "--no-pdf-header-footer", "file://" + printPath],
    { encoding: "utf8", timeout: 300000, stdio: ["ignore", "pipe", "ignore"] }
  );
  console.log(`[pdf] ${out}`);
}

try { unlinkSync(probePath); } catch {}
try { unlinkSync(printPath); } catch {}
