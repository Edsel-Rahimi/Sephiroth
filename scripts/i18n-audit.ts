/* i18n audit: key parity, placeholder parity, artifact & script-specific heuristics */
import { dictionaries } from "../src/lib/i18n/dictionaries";
import { subDictionaries } from "../src/lib/i18n/sub-dictionary";
import { guideLessons } from "../src/lib/i18n/guide-detail";
import { liveDictionaries } from "../src/lib/i18n/live-strings";
import { d2Dictionaries } from "../src/lib/i18n/dashboard-strings";
import { FEATURE } from "../src/lib/i18n/feature-strings";

type Lang = "en" | "fa" | "ar" | "zh" | "tr" | "ru";
const LANGS: Lang[] = ["en", "fa", "ar", "zh", "tr", "ru"];

type Tree = unknown;

const leaves = (v: Tree, prefix = "", out: [string, string][] = []): [string, string][] => {
  if (typeof v === "string") out.push([prefix, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${prefix}[${i}]`, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v as Record<string, Tree>)) leaves(x, prefix ? `${prefix}.${k}` : k, out);
  return out;
};

const ph = (s: string): string[] => {
  const m = s.match(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g);
  return m ? m.slice().sort() : [];
};

const TECH = new Set([
  "vless", "vmess", "trojan", "shadowsocks", "reality", "xray", "tls", "totp", "mtproto", "qr", "grpc",
  "xhttp", "wg", "warp", "socks", "http", "tcp", "ws", "ss", "uuid", "ip", "port", "n", "gb", "mb", "kb",
  "b", "url", "uri", "id", "tag", "email", "x25519", "ed", "pbk", "sid", "sni", "fp", "dns", "api",
  "json", "env", "bin", "v", "lang", "user", "pass", "h", "m", "s", "d", "w", "y", "sec", "t", "proto",
  "type", "name", "size", "mbps", "gbps", "tb", "pb", "count", "index", "list", "key", "value", "host",
  // v2.7 — webhooks / discord / online / scanner / csv vocabulary
  "webhook", "webhooks", "discord", "sephiroth", "sign", "hmac", "sha", "message", "content",
  "csv", "alpn", "rtt", "dest", "post", "example", "timestamp", "body", "inbound", "status", "users",
  "help", "username", "note", "enabled", "traffic", "limit", "expiry", "days", "reset", "period",
  "hold", "auto", "renew", "used", "inbounds", "emails", "keys", "rows", "make",
  "minutes", "detail", "time", "prefix", "hook", "intent", "realtime", "com", "https",
]);

let issues = 0;
const rep = (file: string, lang: string, key: string, msg: string) => {
  issues++;
  console.log(`[${file}] ${lang} :: ${key} :: ${msg}`);
};

function audit(file: string, dicts: Record<Lang, unknown>) {
  const en = new Map(leaves(dicts.en));
  const enKeys = new Set(en.keys());
  for (const lang of LANGS) {
    const cur = new Map(leaves(dicts[lang]));
    const curKeys = new Set(cur.keys());
    // key parity
    for (const k of enKeys) if (!curKeys.has(k)) rep(file, lang, k, "MISSING KEY");
    for (const k of curKeys) if (!enKeys.has(k)) rep(file, lang, k, "EXTRA KEY (en lacks it)");
    // value checks
    for (const [k, s] of cur) {
      const enS = en.get(k);
      // placeholders
      const a = ph(s).join(",");
      const b = enS ? ph(enS).join(",") : "";
      if (enS !== undefined && a !== b) rep(file, lang, k, `PLACEHOLDER MISMATCH lang={${a}} en={${b}}`);
      // artifacts
      if (s !== s.trim()) rep(file, lang, k, "LEAD/TRAIL WHITESPACE");
      if (/[ \t]{2,}/.test(s)) rep(file, lang, k, "DOUBLE/TRIPLE SPACE");
      if (/,,|\.\.|;;|\?\?|!!(?!\!)/.test(s)) rep(file, lang, k, "REPEATED PUNCT");
      if (/[“”]/.test(s)) rep(file, lang, k, "SMART QUOTES");
      if (/\[object/.test(s)) rep(file, lang, k, "[object ...");
      // trailing punctuation before end after placeholder style issues
      if (/{\s*[a-zA-Z_]+\s*}/.test(s.replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, ""))) rep(file, lang, k, "MALFORMED PLACEHOLDER");
    }
    // en placeholders that use odd tokens — check tech tokens stay reasonable (informational only)
  }
  // per-language heuristics
  for (const lang of ["fa", "ar", "zh", "tr", "ru"] as Lang[]) {
    for (const [k, s] of new Map(leaves(dicts[lang]))) {
      if (lang === "fa") {
        // words that need ZWNJ but have none (common verbs/nouns)
        const bad = s.match(/\b(میشود|میشود|میکنید|میکنیم|میکنم|میکنند|میکند|میکن|میباشد|نمیباشد|نمیشود|نمیکنید|نمیکنند|نمیکند|میپذیرد|نمیپذیرد|میدهد|نمیدهد|میکرد|میگوید|نمیگوید|میزند|نمیزند|میشناسد|نمیشناسد|میرسد|میشود.\S)/g);
        if (bad) rep(file, lang, k, `ZWNJ-MISSING: ${bad.join("|")}`);
        // "می " with a plain space before a verb (should be ZWNJ) — only flag when followed by letters
        if (/(^|\s)(ن?می) [آابپتثجچحخدذرزژسشصضطظعغفقکگلمنوهی]/.test(s)) rep(file, lang, k, "SPACE-AFTER-MI (should be ZWNJ?)");
        // Persian digits vs ASCII digits mix inside one string
        const pd = /[۰-۹]/.test(s), ad = /[0-9]/.test(s);
        if (pd && ad) rep(file, lang, k, "MIXED DIGIT SCRIPTS");
        // leftover English words (heuristic: 4+ latin letters word that's not technical)
        const latin = (s.match(/[A-Za-z]{4,}/g) || []).filter((w) => !TECH.has(w.toLowerCase()));
        if (latin.length) rep(file, lang, k, `LATIN WORDS: ${latin.join(",")}`);
      }
      if (lang === "ar") {
        const latin = (s.match(/[A-Za-z]{4,}/g) || []).filter((w) => !TECH.has(w.toLowerCase()));
        if (latin.length) rep(file, lang, k, `LATIN WORDS: ${latin.join(",")}`);
        const ad = /[0-9]/.test(s), ad2 = /[٠-٩]/.test(s);
        if (ad && ad2) rep(file, lang, k, "MIXED DIGIT SCRIPTS");
      }
      if (lang === "ru") {
        const latin = (s.match(/[A-Za-z]{4,}/g) || []).filter((w) => !TECH.has(w.toLowerCase()));
        if (latin.length) rep(file, lang, k, `LATIN WORDS: ${latin.join(",")}`);
      }
      if (lang === "zh") {
        const latin = (s.match(/[A-Za-z]{3,}/g) || []).filter((w) => !TECH.has(w.toLowerCase()));
        if (latin.length) rep(file, lang, k, `LATIN WORDS: ${latin.join(",")}`);
      }
      if (lang === "tr") {
        // Turkish: common wrong-dotless/dotted i usage can't be regex'd reliably; flag known misspell words
        const bad = s.match(/\b(olcaktır|edicek|olucak|başlamıştı|değilki|yapılcak|olacakmı|görebilirsiz|girişyapınız)\b/gi);
        if (bad) rep(file, lang, k, `TR SUSPECT: ${bad.join("|")}`);
      }
    }
  }
}

audit("dictionaries", dictionaries as unknown as Record<Lang, unknown>);
audit("sub-dictionary", subDictionaries as unknown as Record<Lang, unknown>);
audit("live-strings", liveDictionaries as unknown as Record<Lang, unknown>);
audit("dashboard-strings", d2Dictionaries as unknown as Record<Lang, unknown>);
// guide-detail: Record<Lang, Record<viewId, Lesson>> — nested arrays/objects, leaves() handles it
audit("guide-detail", guideLessons as unknown as Record<Lang, unknown>);
// v2.7 — webhooks / discord / online / scanner / csv bundle
audit("feature-strings", FEATURE as unknown as Record<Lang, unknown>);

console.log(`\n== total reported: ${issues} (heuristics include benign latin tech words)`);
