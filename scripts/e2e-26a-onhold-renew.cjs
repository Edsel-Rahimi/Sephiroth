/* ============================================================
   Sephiroth · 26-a E2E — on-hold + auto-renew lifecycle
   Runs against the LIVE dev server (no restart).
   ------------------------------------------------------------
   A) import backdated user, autoRenew=true  → cron rolls window
   B) import backdated user, autoRenew=false → cron disables
   C) import on-hold user (startedAt=null, usedTrafficGb>0)
        → immediately "onhold", then cron activates on first tick
   D) manual renew (PATCH renew:true) on the expired user
   E) on-hold re-arm (PATCH onHold:true) clears the anchor
   F) export round-trip carries usedTrafficGb
   Cleanup: bulk-delete the three test users.
   Usage: node scripts/e2e-26a-onhold-renew.cjs
   ============================================================ */
const BASE = process.env.BASE || "http://localhost:3000";
let COOKIE = "";

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(COOKIE ? { Cookie: COOKIE } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie && setCookie.includes("sephiroth_session=")) {
    COOKIE = setCookie.split(";")[0];
  }
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function report(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function findUser(username) {
  const { status, json } = await api("GET", "/api/users");
  if (status !== 200 || !json || !Array.isArray(json.users)) return null;
  return json.users.find((u) => u.username === username) || null;
}

(async () => {
  /* ---------- login ---------- */
  const login = await api("POST", "/api/auth/login", { username: "admin", password: "sephiroth" });
  if (login.status !== 200 || !COOKIE) {
    console.error("❌ login failed", login.status);
    process.exit(1);
  }
  console.log("✅ login ok");

  /* ---------- pick an inbound tag for imports ---------- */
  const inb = await api("GET", "/api/inbounds");
  const tag = inb.json?.inbounds?.[0]?.tag;
  if (!tag) { console.error("❌ no inbound available for import"); process.exit(1); }
  console.log(`✅ using inbound tag "${tag}"`);

  const daysAgo = (d) => new Date(Date.now() - d * 86_400_000).toISOString();
  const U_RENEW = "e2e-26a-renew";
  const U_EXPIRE = "e2e-26a-expire";
  const U_HOLD = "e2e-26a-hold";

  /* ---------- import the three lifecycle probes ---------- */
  const imp = await api("POST", "/api/users/import", {
    users: [
      { username: U_RENEW, expiryDays: 1, autoRenew: true, startedAt: daysAgo(3), usedTrafficGb: 2.5, inbounds: [tag] },
      { username: U_EXPIRE, expiryDays: 1, autoRenew: false, startedAt: daysAgo(3), usedTrafficGb: 0, inbounds: [tag] },
      { username: U_HOLD, onHold: true, expiryDays: 30, usedTrafficGb: 0.5, inbounds: [tag] },
    ],
  });
  const okImport = imp.status === 200 && imp.json?.ok && (imp.json.created || []).length === 3;
  report("import 3 lifecycle probes", okImport, JSON.stringify(imp.json?.created || imp.json));

  /* ---------- C0: on-hold user is "onhold" right away ---------- */
  const holdNow = await findUser(U_HOLD);
  report(
    "on-hold status=onhold (waiting, anchor null)",
    !!holdNow && holdNow.status === "onhold" && holdNow.startedAt === null && holdNow.onHold === true,
    holdNow ? `status=${holdNow.status} startedAt=${holdNow.startedAt}` : "user not found"
  );

  /* ---------- poll the cron (≤150s) ---------- */
  console.log("… waiting for the 60s maintenance cron");
  let renewU = null, expireU = null, holdU = null;
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    await sleep(10_000);
    renewU = await findUser(U_RENEW);
    expireU = await findUser(U_EXPIRE);
    holdU = await findUser(U_HOLD);
    const a = renewU && renewU.renewals >= 1 && renewU.status === "active";
    const b = expireU && expireU.enabled === false && expireU.status === "expired";
    const c = holdU && holdU.startedAt !== null && holdU.status === "active";
    if (a && b && c) break;
  }

  /* ---------- A: auto-renew rolled the window ---------- */
  report(
    "auto-renew rolls window (renewals≥1, active, usage reset)",
    !!renewU && renewU.renewals >= 1 && renewU.status === "active" && Number(renewU.usedTrafficGb) === 0,
    renewU ? `renewals=${renewU.renewals} status=${renewU.status} used=${renewU.usedTrafficGb} startedAt=${renewU.startedAt}` : "user not found"
  );

  /* ---------- B: expired without renew → disabled ---------- */
  report(
    "expiry disables non-renew user",
    !!expireU && expireU.enabled === false && expireU.status === "expired",
    expireU ? `enabled=${expireU.enabled} status=${expireU.status}` : "user not found"
  );

  /* ---------- C1: on-hold activated by first observed traffic ---------- */
  report(
    "on-hold activates on first traffic (anchor set)",
    !!holdU && holdU.startedAt !== null && holdU.status === "active",
    holdU ? `status=${holdU.status} startedAt=${holdU.startedAt}` : "user not found"
  );

  /* ---------- D: manual renew revives the expired user ---------- */
  if (expireU) {
    const ren = await api("PATCH", `/api/users/${expireU.id}`, { renew: true });
    const u = ren.json?.user;
    report(
      "manual renew revives expired user",
      ren.status === 200 && u?.enabled === true && u?.status === "active" && u?.renewals === 1 && Number(u?.usedTrafficGb) === 0,
      u ? `enabled=${u.enabled} status=${u.status} renewals=${u.renewals}` : `http=${ren.status}`
    );

    /* ---------- E: re-arm on-hold clears the anchor ---------- */
    const arm = await api("PATCH", `/api/users/${expireU.id}`, { onHold: true });
    const u2 = arm.json?.user;
    report(
      "on-hold re-arm clears anchor (waiting again)",
      arm.status === 200 && u2?.onHold === true && u2?.startedAt === null && u2?.status === "onhold",
      u2 ? `onHold=${u2.onHold} startedAt=${u2.startedAt} status=${u2.status}` : `http=${arm.status}`
    );
  } else {
    report("manual renew revives expired user", false, "expired probe missing");
  }

  /* ---------- F: export carries usedTrafficGb ---------- */
  const exp = await fetch(BASE + "/api/users/export", { headers: { Cookie: COOKIE } });
  const exportText = exp.status === 200 ? await exp.text() : "";
  let exportOk = false, detail = `http=${exp.status}`;
  try {
    const j = JSON.parse(exportText);
    const r = (j.users || []).find((x) => x.username === U_RENEW);
    exportOk = !!r && typeof r.usedTrafficGb === "number" && typeof r.startedAt === "string" && typeof r.renewals === "number";
    detail = r ? `usedTrafficGb=${r.usedTrafficGb} renewals=${r.renewals}` : "probe row missing";
  } catch { /* not json */ }
  report("export round-trips lifecycle fields", exportOk, detail);

  /* ---------- cleanup ---------- */
  const ids = [renewU?.id, expireU?.id, holdU?.id].filter(Boolean);
  if (ids.length > 0) {
    const del = await api("POST", "/api/users/bulk", { action: "delete", ids });
    report("cleanup: bulk-delete probes", del.status === 200 && del.json?.ok === true, `affected=${del.json?.affected}`);
  }

  /* ---------- verdict ---------- */
  const failed = results.filter((r) => !r.ok);
  console.log(`\n== 26-a E2E: ${results.length - failed.length}/${results.length} passed ==`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("E2E crashed:", e);
  process.exit(1);
});
