/* Dump each language's leaf strings as "key => value" lines (newlines escaped, ZWNJ marked) */
import { dictionaries } from "../src/lib/i18n/dictionaries";
import { subDictionaries } from "../src/lib/i18n/sub-dictionary";
import { guideLessons } from "../src/lib/i18n/guide-detail";
import { liveDictionaries } from "../src/lib/i18n/live-strings";
import { d2Dictionaries } from "../src/lib/i18n/dashboard-strings";

type Lang = "en" | "fa" | "ar" | "zh" | "tr" | "ru";
const LANGS: Lang[] = ["en", "fa", "ar", "zh", "tr", "ru"];

const leaves = (v: unknown, prefix = "", out: [string, string][] = []): [string, string][] => {
  if (typeof v === "string") out.push([prefix, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => leaves(x, `${prefix}[${i}]`, out));
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) leaves(x, prefix ? `${prefix}.${k}` : k, out);
  return out;
};

const esc = (s: string) =>
  s.replace(/\n/g, "\\n").replace(/\t/g, "\\t").replace(/\u200c/g, "⸲");

type Bundle = [string, Record<Lang, unknown>][];
const bundles: Bundle = [
  ["dict", dictionaries as unknown as Record<Lang, unknown>],
  ["sub", subDictionaries as unknown as Record<Lang, unknown>],
  ["live", liveDictionaries as unknown as Record<Lang, unknown>],
  ["d2", d2Dictionaries as unknown as Record<Lang, unknown>],
  ["guide", guideLessons as unknown as Record<Lang, unknown>],
];

for (const [name, dicts] of bundles) {
  for (const lang of LANGS) {
    const lines = leaves(dicts[lang]).map(([k, v]) => `${k} ⇒ ${esc(v)}`);
    await Bun.write(`/tmp/i18n/${name}.${lang}.txt`, lines.join("\n") + "\n");
    console.log(`${name}.${lang}: ${lines.length} leaves`);
  }
}
