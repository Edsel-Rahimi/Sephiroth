import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { db, flushStore } from "../src/lib/db.ts";

const DB_FILE = resolve(process.cwd(), "db", "sephiroth-store.db");

function readRow(id: string): any | null {
  const dbh = new DatabaseSync(DB_FILE);
  try {
    const row = dbh.prepare("SELECT data FROM adminUser WHERE id = ?").get(id) as
      | { data: string }
      | undefined;
    return row ? JSON.parse(row.data) : null;
  } finally {
    dbh.close();
  }
}

test("store: created rows are flushed into SQLite and survive a reopen", async () => {
  const created = (await db.adminUser.create({
    data: { email: `store-test-${Date.now()}@example.com`, passwordHash: "x", role: "admin" },
  })) as any;
  flushStore();
  const reopened = readRow(String(created.id));
  assert.ok(reopened, "row must exist in the SQLite file after flush");
  assert.equal(reopened.email, created.email);

  await db.adminUser.delete({ where: { id: created.id } });
  flushStore();
  assert.equal(readRow(String(created.id)), null, "deleted row must be removed from SQLite");
});

test("store: legacy JSON store auto-migrates into SQLite on first boot", () => {
  const sep = resolve(process.cwd());
  const tmp = mkdtempSync(join(sep, ".tmp-store-test-"));
  try {
    mkdirSync(join(tmp, "db"));
    const legacy = { adminUser: [{ id: "mig-1", email: "migrated@example.com", passwordHash: "h" }] };
    writeFileSync(join(tmp, "db", "sephiroth-store.json"), JSON.stringify(legacy), "utf8");
    const script = join(tmp, "boot.mjs");
    writeFileSync(
      script,
      [
        `import { db, flushStore } from "${join(sep, "src", "lib", "db.ts").replace(/\\/g, "/")}";`,
        `const rows = await db.adminUser.findMany();`,
        `flushStore();`,
        `console.log("MIGRATED:" + JSON.stringify(rows.map((r) => r.id)));`,
      ].join("\n"),
      "utf8",
    );
    const out = execFileSync(process.execPath, ["--import", "tsx", script], {
      cwd: tmp,
      encoding: "utf8",
    });
    assert.match(out, /MIGRATED:.*mig-1/, "migrated row must be readable through the db client");

    const dbh = new DatabaseSync(join(tmp, "db", "sephiroth-store.db"));
    try {
      const row = dbh.prepare("SELECT data FROM adminUser WHERE id = ?").get("mig-1");
      assert.ok(row, "migrated row must be persisted in SQLite");
    } finally {
      dbh.close();
    }
    assert.ok(existsSync(join(tmp, "db", "sephiroth-store.json")), "JSON file is kept as rollback copy");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
