import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildXrayServerConfig } from "../src/lib/core/config-builder.ts";
import { db } from "../src/lib/db.ts";

const created: string[] = [];
after(async () => {
  for (const id of created) {
    try {
      await db.inbound.delete({ where: { id } });
    } catch {
      /* already gone */
    }
  }
});

const UUID = "11111111-2222-3333-4444-555555555555";

function makeInbound(tag: string, protocol: string, status: string) {
  return db.inbound
    .create({
      data: {
        tag,
        protocol,
        port: 10000 + Math.floor(Math.random() * 9000),
        listen: "0.0.0.0",
        transport: "tcp",
        security: "none",
        status,
        clientsJson: JSON.stringify([{ key: UUID, email: `${tag}@example.com` }]),
        sniffingJson: "{}",
        streamJson: "{}",
      },
    })
    .then((row: any) => {
      created.push(String(row.id));
      return row;
    });
}

test("xray config: online inbounds become listeners, offline ones are not served", async () => {
  const online = (await makeInbound("cfg-online", "vless", "online")) as any;
  await makeInbound("cfg-offline", "vless", "offline");
  const built = buildXrayServerConfig(15490);

  const inbounds = built.config.inbounds as any[];
  const onlineNode = inbounds.find((i) => i.tag === "cfg-online");
  assert.ok(onlineNode, "online inbound must produce a listener");
  assert.equal(onlineNode.port, Number(online.port));
  assert.equal(onlineNode.protocol, "vless");
  assert.deepEqual(
    (onlineNode.settings as any).clients.map((c: any) => c.id),
    [UUID],
  );
  assert.equal(
    inbounds.some((i) => i.tag === "cfg-offline"),
    false,
    "offline inbound must not be served",
  );
  assert.equal(built.skipped.some((s) => s.startsWith("cfg-offline")), false);
});

test("xray config: sidecar-served protocols land in skipped with a reason", async () => {
  await makeInbound("cfg-mtproto", "mtproto", "online");
  const built = buildXrayServerConfig(15490);
  assert.ok(
    built.skipped.some((s) => s.startsWith("cfg-mtproto")),
    "mtproto must be reported as skipped",
  );
  assert.equal(
    (built.config.inbounds as any[]).some((i) => i.tag === "cfg-mtproto"),
    false,
  );
});

test("xray config: hidden stats-api dokodemo-door is present", () => {
  const built = buildXrayServerConfig(15490);
  const api = (built.config.inbounds as any[]).find((i) => i.tag === "api");
  assert.ok(api, "api door must exist");
  assert.equal(api.port, 15490);
  assert.equal(api.protocol, "dokodemo-door");
  assert.deepEqual((built.config as any).api.services, ["HandlerService", "LoggerService", "StatsService"]);
});
