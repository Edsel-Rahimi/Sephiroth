/* ============================================================
   Sephiroth · 28 E2E — notifications ×3 + white-label + bulk
   Runs against the LIVE dev server (no restart).
   ------------------------------------------------------------
   A) white-label: panel brand → sub payload + headers + SSR title
   B) bulk actions: holdOn/holdOff/adjust/autoRenewOn/renew/
      resetDevices (+ bulk-delete cleanup)
   C) digest event: /api/telegram/digest-test auth + force path
   D) failed-login event: wrong password → auth.failed in activity
   E) near-expiry event: expiryDays=2 probe → maintenance ticker
      stamps expiryWarnedAt within ~60-100s
   Cleanup: bulk-delete the probes.
   Usage: node scripts/e2e-28-notify-whitelabel-bulk.cjs
   ============================================================ */
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE || "http://localhost:3000";
const STORE = path.join(__dirname, "..", "db", "sephiroth-store.json");
let COOKIE = "";

async function api(method, path_, body, extraHeaders) {
  const res = await fetch(BASE + path_, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
      ...(extraHeaders || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && setCookie.includes("sephiroth_session=")) {
    COOKIE = setCookie.split(";")[0];
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json, headers: res.headers };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

function storeUserSync(username) {
  try {
    const store = JSON.parse(fs.readFileSync(STORE, "utf8"));
    return (store.clientUser || []).find((u) => u.username === username) || null;
  } catch { return null; }
}

/* the store persists on a 50ms debounce — wait past it before file reads */
async function storeUser(username) {
  await sleep(350);
  return storeUserSync(username);
}

async function findUser(username) {
  const { status, json } = await api("GET", "/api/users");
  if (status !== 200 || !json || !Array.isArray(json.users)) return null;
  return json.users.find((u) => u.username === username) || null;
}

async function bulk(action, ids, extra) {
  return api("POST", "/api/users/bulk", { action, ids, ...(extra || {}) });
}

(async () => {
  /* ---------- login ---------- */
  const login = await api("POST", "/api/auth/login", { username: "admin", password: "sephiroth" });
  if (login.status !== 200 || !COOKIE) {
    console.error("❌ login failed", login.status);
    process.exit(1);
  }
  console.log("✅ login ok");

  const inb = await api("GET", "/api/inbounds");
  const tag = inb.json?.inbounds?.[0]?.tag;
  if (!tag) { console.error("❌ no inbound available"); process.exit(1); }

  /* pick a real user token for the white-label probe */
  const list = await api("GET", "/api/users");
  const probeHost = list.json?.users?.find((u) => u.subId);
  if (!probeHost) { console.error("❌ no user with subId"); process.exit(1); }
  const TOK = probeHost.subId;

  /* ================= A) white-label ================= */
  const bad = await api("PUT", "/api/settings", { section: "general", subBrandName: "Nova Net", subBrandAccent: "not-a-color" });
  report("white-label: bad accent rejected", bad.status === 400, `status=${bad.status}`);

  const put = await api("PUT", "/api/settings", {
    section: "general",
    subBrandName: "Nova Net",
    subBrandLogo: "https://cdn.example.com/logo.png",
    subBrandAccent: "#ff8800",
  });
  report("white-label: PUT general brand", put.status === 200, `status=${put.status}`);

  const getSet = await api("GET", "/api/settings");
  const g = getSet.json?.general || {};
  report("white-label: settings persisted",
    g.subBrandName === "Nova Net" && g.subBrandLogo === "https://cdn.example.com/logo.png" && g.subBrandAccent === "#ff8800",
    JSON.stringify({ n: g.subBrandName, l: g.subBrandLogo, a: g.subBrandAccent }));

  const sub = await api("GET", `/api/sub/${TOK}`);
  const brand = sub.json?.brand || null;
  report("white-label: payload.brand", brand?.name === "Nova Net", JSON.stringify(brand));

  /* profile-title + filename ride the CONFIG-format responses */
  const raw = await api("GET", `/api/sub/${TOK}?format=raw`);
  const ptRaw = raw.headers.get("profile-title") || "";
  let ptDecoded = "";
  try {
    ptDecoded = ptRaw.startsWith("base64:") ? Buffer.from(ptRaw.slice(7), "base64").toString("utf8") : ptRaw;
  } catch { /* keep empty */ }
  const cDisp = raw.headers.get("content-disposition") || "";
  report("white-label: profile-title header (decoded)", ptDecoded.includes("Nova Net"), ptDecoded || ptRaw);
  report("white-label: content-disposition", /nova-net/i.test(cDisp), cDisp);

  /* page HTML is an SPA shell — the brand title is applied client-side
     (document.title), verified separately in the browser pass */

  /* restore: unbranded must fall back to Sephiroth exactly */
  await api("PUT", "/api/settings", { section: "general", subBrandName: "", subBrandLogo: "", subBrandAccent: "" });
  const sub2 = await api("GET", `/api/sub/${TOK}`);
  const raw2 = await api("GET", `/api/sub/${TOK}?format=raw`);
  const pt2 = raw2.headers.get("profile-title") || "";
  let pt2d = "";
  try {
    pt2d = pt2.startsWith("base64:") ? Buffer.from(pt2.slice(7), "base64").toString("utf8") : pt2;
  } catch { /* keep empty */ }
  report("white-label: fallback to Sephiroth after clear",
    (sub2.json?.brand ?? null) === null && pt2d.includes("Sephiroth"),
    `brand=${JSON.stringify(sub2.json?.brand ?? null)} pt=${pt2d}`);

  /* ================= B) bulk actions ================= */
  const U_BULK = `e2e-28-blk-${Date.now().toString(36).slice(-4)}`;
  const imp = await api("POST", "/api/users/import", {
    users: [{ username: U_BULK, expiryDays: 10, trafficLimitGb: 10, ipLimit: 2, usedTrafficGb: 3.2, inbounds: [tag] }],
  });
  const bulkUser = await findUser(U_BULK);
  report("bulk: import probe", imp.status === 200 && !!bulkUser?.id, JSON.stringify(imp.json?.created || imp.json));
  if (bulkUser?.id) {
    const id = bulkUser.id;
    const ids = [id];

    let r = await bulk("holdOn", ids);
    let su = await storeUser(U_BULK);
    report("bulk holdOn", r.status === 200 && r.json?.affected === 1 && su?.onHold === true && su?.startedAt === null,
      `status=${r.status} onHold=${su?.onHold} startedAt=${su?.startedAt}`);

    r = await bulk("holdOff", ids);
    su = await storeUser(U_BULK);
    report("bulk holdOff", r.status === 200 && su?.onHold === false && su?.startedAt === null,
      `onHold=${su?.onHold} startedAt=${su?.startedAt}`);

    r = await bulk("adjust", ids, { expiryDays: 5, trafficLimitGb: 20 });
    su = await storeUser(U_BULK);
    report("bulk adjust (partial merge)", r.status === 200 && su?.expiryDays === 5 && su?.trafficLimitGb === 20 && su?.ipLimit === 2,
      `expiry=${su?.expiryDays} traffic=${su?.trafficLimitGb} ip=${su?.ipLimit}`);

    r = await bulk("adjust", ids, { expiryDays: 99999 });
    report("bulk adjust: out-of-range rejected", r.status === 400, `status=${r.status}`);

    r = await bulk("autoRenewOn", ids);
    su = await storeUser(U_BULK);
    report("bulk autoRenewOn", r.status === 200 && su?.autoRenew === true, `autoRenew=${su?.autoRenew}`);

    r = await bulk("renew", ids);
    su = await storeUser(U_BULK);
    const freshStart = su?.startedAt && Date.now() - new Date(su.startedAt).getTime() < 60_000;
    report("bulk renew", r.status === 200 && su?.renewals === 1 && su?.usedTrafficGb === 0 && su?.enabled === true && freshStart,
      `renewals=${su?.renewals} used=${su?.usedTrafficGb} enabled=${su?.enabled} startedAt=${su?.startedAt}`);

    r = await bulk("resetDevices", ids);
    su = await storeUser(U_BULK);
    report("bulk resetDevices", r.status === 200 && (su?.devices === "[]" || JSON.stringify(su?.devices) === "[]"),
      `devices=${JSON.stringify(su?.devices).slice(0, 40)}`);

    r = await bulk("delete", ids);
    const gone = !(await findUser(U_BULK));
    report("bulk delete (cleanup half 1)", r.status === 200 && gone, `status=${r.status} gone=${gone}`);
  }

  /* ================= C) digest event ================= */
  const anon = await fetch(`${BASE}/api/telegram/digest-test`, { method: "POST" });
  report("digest: anonymous rejected", anon.status === 401, `status=${anon.status}`);

  const dig = await api("POST", "/api/telegram/digest-test");
  /* sandbox has no Telegram configured → force path must reach the TG gate
     and answer {ok:false, reason:"telegram_off"} WITHOUT a 500 */
  report("digest: force path executes",
    dig.status === 200 && dig.json?.ok === false && dig.json?.reason === "telegram_off",
    JSON.stringify(dig.json));

  /* ================= D) failed-login event ================= */
  const badLogin = await api("POST", "/api/auth/login", { username: "e2e-28-nope", password: "wrong-password" });
  report("failed-login: 401 on bad creds", badLogin.status === 401, `status=${badLogin.status}`);

  await sleep(1500);
  const act = await api("GET", "/api/activity?page=1&pageSize=10");
  const items = act.json?.items || [];
  const failed = items.find((x) => x.kind === "auth.failed" && (x.message || "").includes("e2e-28-nope"));
  report("failed-login: auth.failed in activity log", !!failed, failed ? failed.message : JSON.stringify(items.slice(0, 2).map((i) => i.kind)));

  /* ================= E) near-expiry event ================= */
  /* unique per run — leftover users from earlier runs (upserted by import)
     can carry an old expiryWarnedAt and poison this check */
  const U_EXP = `e2e-28-exp-${Date.now().toString(36).slice(-4)}`;
  const imp2 = await api("POST", "/api/users/import", {
    users: [{ username: U_EXP, expiryDays: 2, usedTrafficGb: 0.5, inbounds: [tag] }],
  });
  const expUser = await findUser(U_EXP);
  report("near-expiry: import probe (2 days left)", imp2.status === 200 && !!expUser?.id, JSON.stringify(imp2.json?.created || imp2.json));

  if (expUser?.id) {
    let warned = false;
    let saw = null;
    for (let i = 0; i < 28 && !warned; i++) {
      await sleep(5000);
      const su = storeUserSync(U_EXP);
      saw = su?.expiryWarnedAt ?? null;
      if (saw) warned = true;
    }
    report("near-expiry: ticker stamped expiryWarnedAt (≤140s)", warned, `expiryWarnedAt=${saw}`);
    const del = await bulk("delete", [expUser.id]);
    const gone = !(await findUser(U_EXP));
    report("near-expiry: cleanup probe", del.status === 200 && gone, `status=${del.status} gone=${gone}`);
  }

  /* ---------- summary ---------- */
  const failedCount = results.filter((r) => !r.ok).length;
  console.log(failedCount === 0 ? "\n🎉 ALL PASS" : `\n💥 ${failedCount} FAILED`);
  process.exit(failedCount === 0 ? 0 : 1);
})();
