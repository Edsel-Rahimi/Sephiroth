/**
 * Phase 3 one-off seed — mirrors the six inbounds core-sim has been serving
 * since Phase 2, so the dashboard look is identical when the DB mirror goes
 * live. Idempotent: guarded by the `inbounds_seeded_v1` ServerSetting flag
 * (the same flag src/lib/inbounds.ts checks), so it never duplicates rows
 * and never re-seeds after the admin intentionally deletes everything.
 *
 * Run: bun scripts/seed-inbounds.ts
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const SEED = [
  { tag: "vless-main", protocol: "vless", port: 443, transport: "ws", security: "tls", status: "online" },
  { tag: "vmess-grpc", protocol: "vmess", port: 8443, transport: "grpc", security: "none", status: "online" },
  { tag: "trojan-tls", protocol: "trojan", port: 2053, transport: "tcp", security: "tls", status: "online" },
  { tag: "ss-2022", protocol: "shadowsocks", port: 8388, transport: "tcp", security: "none", status: "online" },
  { tag: "hy2-edge", protocol: "hysteria2", port: 36712, transport: "tcp", security: "none", status: "online" },
  { tag: "legacy-ss", protocol: "shadowsocks", port: 8888, transport: "tcp", security: "none", status: "maintenance" },
] as const;

async function main() {
  /* WAL lets core-sim (bun:sqlite) read concurrently with Prisma writes */
  const mode = (await db.$queryRawUnsafe<{ journal_mode: string }[]>(
    "PRAGMA journal_mode=WAL;"
  )) as { journal_mode: string }[];
  console.log("journal_mode:", mode[0]?.journal_mode);

  const flag = await db.serverSetting.findUnique({ where: { key: "inbounds_seeded_v1" } });
  if (flag) {
    console.log("already seeded (flag present)");
    return;
  }
  const count = await db.inbound.count();
  if (count === 0) {
    const t = Date.now();
    for (let i = 0; i < SEED.length; i++) {
      const row = SEED[i]!;
      await db.inbound.create({
        data: { ...row, createdAt: new Date(t + i * 1000) },
      });
    }
    console.log(`seeded ${SEED.length} inbounds`);
  } else {
    console.log(`table not empty (${count} rows) — skipping inserts`);
  }
  await db.serverSetting.create({
    data: { key: "inbounds_seeded_v1", value: "1" },
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
