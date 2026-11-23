import { test } from "node:test";
import assert from "node:assert/strict";
import { buildClashMetaYaml, buildSingboxJson, type SubExportItem } from "../src/lib/share-links.ts";

const base = {
  port: 443,
  listen: "0.0.0.0",
  email: "u@example.com",
  stream: {},
};

const vlessWsTls: SubExportItem = {
  ...base,
  tag: "de-ws",
  protocol: "vless",
  transport: "ws",
  security: "tls",
  key: "11111111-2222-3333-4444-555555555555",
  stream: { path: "/wspath", host: "cdn.example.com", sni: "sni.example.com" },
};

test("clash: vless + ws emits ws-opts with path/host and tls", () => {
  const yaml = buildClashMetaYaml([vlessWsTls], "sub");
  assert.match(yaml, /type: vless/);
  assert.match(yaml, /port: 443/);
  assert.match(yaml, /ws-opts:/);
  assert.match(yaml, /path: "\/wspath"/);
  assert.match(yaml, /Host: "cdn\.example\.com"/);
  assert.match(yaml, /servername: sni\.example\.com/);
  assert.equal(yaml.includes("mtproto"), false, "MTProto must not be emitted for Clash");
});

test("clash: httpupgrade rides ws, grpc and kcp map to their own opts", () => {
  const httpupgrade: SubExportItem = { ...vlessWsTls, tag: "hu", transport: "httpupgrade" };
  assert.match(buildClashMetaYaml([httpupgrade], "sub"), /network: ws/);

  const grpc: SubExportItem = {
    ...base,
    tag: "grpc-node",
    protocol: "trojan",
    transport: "grpc",
    security: "tls",
    key: "pw",
    stream: { serviceName: "grpcsvc" },
  };
  assert.match(buildClashMetaYaml([grpc], "sub"), /grpc-service-name: "grpcsvc"/);

  const kcp: SubExportItem = { ...vlessWsTls, tag: "kcp-node", transport: "kcp" };
  assert.match(buildClashMetaYaml([kcp], "sub"), /kcp-opts:/);
});

test("sing-box: valid JSON, ws transport mapped, reality fields kept", () => {
  const reality: SubExportItem = {
    ...vlessWsTls,
    tag: "reality-node",
    security: "reality",
    stream: { ...vlessWsTls.stream, publicKey: "pbk", shortIds: "abcd,ef01" },
  };
  const doc = JSON.parse(buildSingboxJson([reality], "sub")) as { outbounds: any[] };
  const node = doc.outbounds.find((o) => String(o.tag).includes("reality-node"));
  assert.ok(node, "vless node present");
  assert.equal(node.type, "vless");
  assert.equal(node.transport?.type, "ws");
  assert.equal(node.tls?.reality?.enabled, true);
  assert.equal(node.tls?.reality?.public_key, "pbk");
  assert.equal(node.tls?.reality?.short_id, "abcd");
});

test("sing-box: mKCP nodes are skipped, not silently dialled as TCP", () => {
  const kcp: SubExportItem = { ...vlessWsTls, tag: "kcp-node", transport: "kcp" };
  const doc = JSON.parse(buildSingboxJson([kcp], "sub")) as { outbounds: any[] };
  assert.equal(
    doc.outbounds.filter((o) => String(o.tag).includes("kcp-node")).length,
    0,
    "mKCP has no sing-box transport — node must be omitted",
  );
});

test("sing-box: hysteria2 and trojan outbounds keep their types", () => {
  const items: SubExportItem[] = [
    { ...base, tag: "hy2", protocol: "hysteria2", transport: "udp", security: "tls", key: "hypass" },
    { ...base, tag: "trj", protocol: "trojan", transport: "tcp", security: "tls", key: "trojpass" },
  ];
  const doc = JSON.parse(buildSingboxJson(items, "sub")) as { outbounds: any[] };
  const nodeTypes = doc.outbounds
    .filter((o) => !["direct", "block", "dns", "selector", "urltest"].includes(o.type))
    .map((o) => o.type)
    .sort();
  assert.deepEqual(nodeTypes, ["hysteria2", "trojan"]);
});
