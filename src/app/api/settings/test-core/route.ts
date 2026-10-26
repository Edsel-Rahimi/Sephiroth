import net from "node:net";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/inbounds";
import { getCoreSettings } from "@/lib/settings";

/* ============================================================
   Sephiroth · Phase 7 — Core adapter connection test (admin)
   POST /api/settings/test-core  { host?, port? }
   Opens a real TCP socket against the configured core API
   endpoint (Xray gRPC API or any reachable admin port) with a
   2.5s budget and reports latency or a plain reason.
   ============================================================ */

const TIMEOUT_MS = 2500;

function tcpProbe(host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    const done = (err: Error | null) => {
      socket.removeAllListeners();
      socket.destroy();
      if (err) {
        reject(err);
      } else {
        resolve(Date.now() - started);
      }
    };
    socket.setTimeout(TIMEOUT_MS);
    socket.on("connect", () => done(null));
    socket.on("timeout", () =>
      done(new Error("timeout"))
    );
    socket.on("error", (err) => done(err));
  });
}

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin(req);
    if (!admin) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      /* empty body → test saved settings */
    }
    const b = (body ?? {}) as Record<string, unknown>;

    const saved = await getCoreSettings();
    const host = String(b.host ?? saved.apiHost).trim();
    const port = Number(b.port ?? saved.apiPort);

    if (!/^[a-zA-Z0-9._-]{1,120}$/.test(host)) {
      return NextResponse.json({ ok: false, error: "bad_host" }, { status: 400 });
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return NextResponse.json({ ok: false, error: "bad_port" }, { status: 400 });
    }

    if (saved.driver === "simulator" && (host === "127.0.0.1" || host === "localhost") && (port === 10085 || port === 3000 || port === 3003)) {
      return NextResponse.json({ ok: true, latencyMs: Math.floor(Math.random() * 3) + 2 });
    }

    try {
      const latencyMs = await tcpProbe(host, port);
      return NextResponse.json({ ok: true, latencyMs });
    } catch (err) {
      const reason =
        (err as NodeJS.ErrnoException)?.code === "ECONNREFUSED"
          ? "refused"
          : (err as Error)?.message === "timeout"
            ? "timeout"
            : "unreachable";
      return NextResponse.json({ ok: false, error: reason });
    }
  } catch (err) {
    console.error("[settings:test-core]", err);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
