import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { REF_PANELS } from "@/lib/reference-panels";

/* ============================================================
   Sephiroth · Reference panel proxy
   GET|POST|… /ref/[panel]/[[...path]] → http://127.0.0.1:<port>

   Lets the six deployed reference panels be browsed from the
   same origin (no CORS, no cookie chaos, iframe-friendly):
   - native base-path panels are proxied untouched;
   - panels without base-path support get the /ref/<id> prefix
     stripped upstream-ward and their HTML/JS rewritten so the
     root-absolute URLs resolve back through the proxy.
   ============================================================ */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SKIP_RES_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "upgrade",
  // security/frame headers are meaningless cross-resource here and
  // break the iframe embedding + rewriting
  "x-frame-options",
  "content-security-policy",
  "content-security-policy-report-only",
  "strict-transport-security",
  "location",
  "set-cookie",
]);

const SKIP_REQ_HEADERS = new Set([
  "host",
  "connection",
  "accept-encoding",
  "content-length",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-forwarded-for",
  "origin",
  "referer",
]);

/** Rewrite JS: axios-style `baseURL: "/"` + literal root-absolute paths. */
function prefixJs(code: string, base: string): string {
  let out = code;
  out = out.replace(/(baseURL\s*:\s*)(["'])\/\2/g, `$1$2${base}/$2`);
  out = out.replace(
    /(["'])\/(api|assets|static|login|logout|ws)(?=\/|["'?])/g,
    `$1${base}/$2`
  );
  // root-absolute JS navigations: location.href='/dashboard' etc.
  out = out.replace(
    /((?:window\.location|location)\.(?:href|replace)\s*[\(=]?\s*["'])\/(?!\/|ref\/)/g,
    `$1${base}/`
  );
  return out;
}

/** Rewrite HTML: <base> injection + root-absolute tag attributes + inline JS. */
function prefixHtml(html: string, base: string): string {
  let out = html;
  if (!/<base\s/i.test(out)) {
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${base}/">`);
  }
  out = out.replace(
    /(\s(?:href|src|action|poster|formaction)=)(["'])(\/(?!\/|ref\/)[^"']*)\2/gi,
    (_m, attr: string, quote: string, url: string) => `${attr}${quote}${base}${url}${quote}`
  );
  return prefixJs(out, base);
}

function prefixLocation(loc: string, base: string): string {
  if (/^https?:\/\//i.test(loc) || loc.startsWith(base) || !loc.startsWith("/")) {
    return loc;
  }
  return `${base}${loc}`;
}

async function proxy(req: NextRequest, ctx: any) {
  const { panel } = (await ctx.params) as { panel: string };
  const cfg = REF_PANELS.find((p) => p.id === panel);
  if (!cfg || cfg.status === "failed") {
    return new NextResponse("Reference panel not available.", { status: 404 });
  }
  if ((req.headers.get("upgrade") ?? "").toLowerCase() === "websocket") {
    return new NextResponse("WebSockets are not proxied for reference panels.", {
      status: 501,
    });
  }

  const url = new URL(req.url);
  const upstreamPath = cfg.strip
    ? url.pathname.replace(`/ref/${cfg.id}`, "") || "/"
    : url.pathname;
  const target = `http://127.0.0.1:${cfg.port}${upstreamPath}${url.search}`;

  const fwd = new Headers(req.headers);
  for (const h of SKIP_REQ_HEADERS) fwd.delete(h);

  let res: Response;
  try {
    res = await fetch(target, {
      method: req.method,
      headers: fwd,
      body:
        req.method === "GET" || req.method === "HEAD"
          ? undefined
          : await req.arrayBuffer(),
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return new NextResponse("Reference panel upstream is offline.", { status: 502 });
  }

  const base = `/ref/${cfg.id}`;
  const headers = new Headers();
  for (const [k, v] of res.headers) {
    if (!SKIP_RES_HEADERS.has(k.toLowerCase())) headers.set(k, v);
  }
  for (const c of res.headers.getSetCookie?.() ?? []) headers.append("set-cookie", c);
  const loc = res.headers.get("location");
  if (loc) headers.set("location", cfg.strip ? prefixLocation(loc, base) : loc);

  // redirects: body is irrelevant, Location is what matters
  if (res.status >= 300 && res.status < 400) {
    return new NextResponse(null, { status: res.status, headers });
  }

  const ct = (res.headers.get("content-type") ?? "").toLowerCase();
  const isHtml = ct.includes("text/html");
  const isJs = ct.includes("javascript");

  if (cfg.rewriteHtml && isHtml) {
    return new NextResponse(prefixHtml(await res.text(), base), {
      status: res.status,
      headers,
    });
  }
  if (cfg.rewriteJs && isJs) {
    return new NextResponse(prefixJs(await res.text(), base), {
      status: res.status,
      headers,
    });
  }
  return new NextResponse(res.body, { status: res.status, headers });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
