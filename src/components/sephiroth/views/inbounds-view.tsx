"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  ArrowUpFromLine,
  BadgeCheck,
  CircleAlert,
  CircleCheck,
  Copy,
  EllipsisVertical,
  Fingerprint,
  Globe,
  KeyRound,
  Layers,
  Lightbulb,
  Link2,
  Loader2,
  Network,
  Pencil,
  Plus,
  Radar,
  RadioTower,
  RefreshCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  ShieldPlus,
  Sparkles,
  Star,
  LayoutGrid,
  Rows3,
  SlidersHorizontal,
  Trash2,
  TrendingUp,
  Users,
  Waves,
  Wifi,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppStore } from "@/lib/store/app-store";
import { useCoreStore } from "@/lib/store/core-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { lfmt } from "@/lib/i18n/live-strings";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { buildDokoSummary, buildShareLink, buildWgConf } from "@/lib/share-links";

// moved to lib/share-links.ts (shared with the public sub API) — re-exported for older import paths
export { buildDokoSummary, buildShareLink, buildWgConf };


/* ============================================================
   Sephiroth · Phase 3R — Inbounds management (redesigned)
   Config source of truth = Prisma (`/api/inbounds`), live stats
   = core-store (socket). The create/edit dialog is Xray-grade:
   General / Clients / Transport / Security / Advanced tabs.
   ============================================================ */

interface InboundClientDTO {
  email: string;
  key: string;
  subId: string;
  flow: string;
  ipLimit: number;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  enabled: boolean;
}

interface InboundDTO {
  id: string;
  tag: string;
  protocol: string;
  port: number;
  listen: string;
  transport: string;
  security: string;
  status: string;
  note: string | null;
  trafficLimitGb: number | null;
  expiryDays: number | null;
  clients: InboundClientDTO[];
  sniffing: { enabled: boolean; destOverride: string[]; routeOnly: boolean };
  stream: Record<string, string | number | boolean>;
  createdAt: string;
  updatedAt: string;
}

type StatusFilter = "all" | "online" | "maintenance" | "disabled";
type ViewMode = "grid" | "table";
type TabId = "general" | "clients" | "transport" | "security" | "advanced";

interface ClientForm {
  email: string;
  key: string;
  subId: string;
  flow: string;
  ipLimit: string;
  trafficLimitGb: string;
  expiryDays: string;
  enabled: boolean;
}

interface FallbackForm {
  name: string;
  dest: string;
  alpn: string;
  path: string;
}

interface FormState {
  tag: string;
  protocol: string;
  port: string;
  listen: string;
  transport: string;
  security: string;
  status: string;
  note: string;
  trafficLimitGb: string;
  expiryDays: string;
  clients: ClientForm[];
  sniffing: { enabled: boolean; destOverride: string[]; routeOnly: boolean };
  mux: boolean;
  fallbacks: FallbackForm[];
  stream: Record<string, string>;
}

const PROTOCOLS = [
  "vless",
  "vmess",
  "trojan",
  "shadowsocks",
  "hysteria2",
  "wireguard",
  "dokodemo-door",
  "socks",
  "http",
] as const;
const TRANSPORTS = ["tcp", "ws", "grpc", "httpupgrade", "xhttp"] as const;
const STATUSES = ["online", "maintenance", "disabled"] as const;
const FLOWS = ["", "xtls-rprx-vision"] as const;
const SNIFF_DESTS = ["http", "tls", "quic", "fakerd"] as const;
const TLS_VERSIONS = ["", "1.0", "1.1", "1.2", "1.3"] as const;
const FINGERPRINTS = [
  "chrome",
  "firefox",
  "safari",
  "ios",
  "android",
  "edge",
  "360",
  "qq",
  "random",
] as const;

const PROTO_LABEL: Record<string, string> = {
  vless: "VLESS",
  vmess: "VMess",
  trojan: "Trojan",
  shadowsocks: "Shadowsocks",
  hysteria2: "Hysteria2",
  wireguard: "WireGuard",
  "dokodemo-door": "Dokodemo",
  socks: "SOCKS",
  http: "HTTP",
};

const PROTO_CLS: Record<string, string> = {
  vless: "bg-primary/10 text-primary ring-primary/30",
  vmess: "bg-[#8b8cf8]/10 text-[#8b8cf8] ring-[#8b8cf8]/30",
  trojan: "bg-chart-4/10 text-chart-4 ring-chart-4/30",
  shadowsocks: "bg-chart-3/10 text-chart-3 ring-chart-3/30",
  hysteria2: "bg-chart-5/10 text-chart-5 ring-chart-5/30",
  wireguard: "bg-[#c084fc]/10 text-[#c084fc] ring-[#c084fc]/30",
  "dokodemo-door": "bg-[#f472b6]/10 text-[#f472b6] ring-[#f472b6]/30",
  socks: "bg-[#fde047]/10 text-[#fde047] ring-[#fde047]/30",
  http: "bg-[#fb923c]/10 text-[#fb923c] ring-[#fb923c]/30",
};

/* Lovable-design per-protocol accents (solid bar / spark color / hover glow) */
const PROTO_BAR: Record<string, string> = {
  vless: "bg-primary",
  vmess: "bg-[#8b8cf8]",
  trojan: "bg-chart-4",
  shadowsocks: "bg-chart-3",
  hysteria2: "bg-chart-5",
  wireguard: "bg-[#c084fc]",
  "dokodemo-door": "bg-[#f472b6]",
  socks: "bg-[#fde047]",
  http: "bg-[#fb923c]",
};

const PROTO_VAR: Record<string, string> = {
  vless: "var(--primary)",
  vmess: "#8b8cf8",
  trojan: "var(--chart-4)",
  shadowsocks: "var(--chart-3)",
  hysteria2: "var(--chart-5)",
  wireguard: "#c084fc",
  "dokodemo-door": "#f472b6",
  socks: "#fde047",
  http: "#fb923c",
};

const PROTO_HOVER: Record<string, string> = {
  vless:
    "hover:border-primary/50 hover:shadow-[0_0_38px_-12px_var(--primary)]",
  vmess:
    "hover:border-[#8b8cf8]/50 hover:shadow-[0_0_38px_-12px_#8b8cf8]",
  trojan:
    "hover:border-chart-4/50 hover:shadow-[0_0_38px_-12px_var(--chart-4)]",
  shadowsocks:
    "hover:border-chart-3/50 hover:shadow-[0_0_38px_-12px_var(--chart-3)]",
  hysteria2:
    "hover:border-chart-5/50 hover:shadow-[0_0_38px_-12px_var(--chart-5)]",
  wireguard:
    "hover:border-[#c084fc]/50 hover:shadow-[0_0_38px_-12px_#c084fc]",
  "dokodemo-door":
    "hover:border-[#f472b6]/50 hover:shadow-[0_0_38px_-12px_#f472b6]",
  socks:
    "hover:border-[#fde047]/50 hover:shadow-[0_0_38px_-12px_#fde047]",
  http:
    "hover:border-[#fb923c]/50 hover:shadow-[0_0_38px_-12px_#fb923c]",
};

/* protocols that carry raw sockets — no transport/security layers apply */
const NO_STREAM_PROTOCOLS = new Set(["wireguard", "socks", "http", "dokodemo-door"]);

/* dictionary key per protocol for the picker card descriptions */
const PROTO_DESC_KEY: Record<string, string> = {
  vless: "pdVless",
  vmess: "pdVmess",
  trojan: "pdTrojan",
  shadowsocks: "pdSs",
  hysteria2: "pdHy2",
  wireguard: "pdWg",
  "dokodemo-door": "pdDoko",
  socks: "pdSocks",
  http: "pdHttp",
};

const TRANSPORT_META: Record<string, { icon: LucideIcon; descKey: string }> = {
  tcp: { icon: Network, descKey: "trTcpDesc" },
  ws: { icon: Waves, descKey: "trWsDesc" },
  grpc: { icon: Layers, descKey: "trGrpcDesc" },
  httpupgrade: { icon: ArrowUpFromLine, descKey: "trHttpUpDesc" },
  xhttp: { icon: Zap, descKey: "trXhttpDesc" },
};

const STATUS_DOT: Record<string, string> = {
  online: "bg-chart-3",
  maintenance: "bg-chart-4",
  disabled: "bg-chart-5",
};

const TRANSPORT_SHORT: Record<string, string> = {
  tcp: "",
  ws: "WS",
  grpc: "gRPC",
  httpupgrade: "HTTPUpgrade",
  xhttp: "XHTTP",
};

/** Same composition the core driver uses for its wire `proto` label. */
function composeProto(protocol: string, transport: string, security: string): string {
  const parts = [PROTO_LABEL[protocol] ?? protocol];
  const tr = TRANSPORT_SHORT[transport] ?? transport.toUpperCase();
  if (tr) parts.push(tr);
  if (security === "tls") parts.push("TLS");
  if (security === "reality") parts.push("REALITY");
  return parts.join(" · ");
}

function fmtTraffic(gb: number): string {
  if (gb >= 1000) return `${(gb / 1000).toFixed(2)} TB`;
  return `${Math.round(gb)} GB`;
}

/* ---------- deterministic sparkline (Lovable-style card art) ---------- */

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Sparkline({
  seed,
  color,
  className,
}: {
  seed: string;
  color: string;
  className?: string;
}) {
  const pts = useMemo(() => {
    const rnd = mulberry32(hashSeed(seed));
    const n = 26;
    const arr: number[] = [];
    let v = 0.45 + rnd() * 0.2;
    for (let i = 0; i < n; i++) {
      v += (rnd() - 0.48) * 0.16;
      v = Math.min(0.95, Math.max(0.12, v));
      arr.push(v);
    }
    return arr;
  }, [seed]);
  const W = 120;
  const H = 40;
  const step = W / (pts.length - 1);
  const line = pts
    .map((p, i) => `${(i * step).toFixed(1)},${(H - p * H).toFixed(1)}`)
    .join(" ");
  const gid = `sp-${hashSeed(seed).toString(36)}`;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={cn("h-9 w-24 shrink-0", className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.34 }} />
          <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill={`url(#${gid})`} />
      <polyline
        points={line}
        fill="none"
        style={{ stroke: color }}
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ---------- id generators (client-side, preview-grade) ---------- */

function b64url(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Standard base64 with padding — the WireGuard key format. */
function b64std(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  let bin = "";
  for (const b of arr) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Readable password for socks / http auth (no lookalike characters). */
function genReadableKey(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const arr = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(arr, (b) => alphabet[b % alphabet.length]).join("");
}

function genClientKey(protocol: string): string {
  if (protocol === "vless" || protocol === "vmess") {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
    return b64url(16);
  }
  if (protocol === "wireguard") return b64std(32); // peer public key (44-char base64)
  if (protocol === "socks" || protocol === "http") return genReadableKey();
  return b64url(18); // trojan / shadowsocks / hysteria2 password
}

function genSubId(): string {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Preview-grade x25519-style pair (43-char base64url) — visual only. */
function genRealityPair(): { priv: string; pub: string; shortIds: string } {
  return {
    priv: b64url(32),
    pub: b64url(32),
    shortIds: Array.from({ length: 2 }, () =>
      Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) =>
        b.toString(16).padStart(2, "0")
      ).join("")
    ).join(","),
  };
}

/** Preview-grade WireGuard key pair (44-char standard base64). */
function genWgPair(): { priv: string; pub: string } {
  return { priv: b64std(32), pub: b64std(32) };
}

/* ---------- form <-> payload ---------- */

const NUM_STREAM_KEYS = new Set(["maxEarlyData", "dokoPort", "wgMtu"]);
const BOOL_STREAM_KEYS = new Set(["multiMode", "mux", "allowInsecure", "socksUdp"]);

const SS_METHODS = [
  "2022-blake3-aes-128-gcm",
  "2022-blake3-aes-256-gcm",
  "2022-blake3-chacha20-poly1305",
  "aes-128-gcm",
  "aes-256-gcm",
  "chacha20-ietf-poly1305",
] as const;

/** One-click presets for Quick Create (simple-panel style defaults). */
const QUICK_PRESET: Record<string, { transport: string; security: string }> = {
  vless: { transport: "tcp", security: "none" },
  vmess: { transport: "ws", security: "none" },
  trojan: { transport: "tcp", security: "tls" },
  shadowsocks: { transport: "tcp", security: "none" },
  hysteria2: { transport: "tcp", security: "none" },
  wireguard: { transport: "tcp", security: "none" },
  "dokodemo-door": { transport: "tcp", security: "none" },
  socks: { transport: "tcp", security: "none" },
  http: { transport: "tcp", security: "none" },
};

/** Sensible default stream values for Quick Create, per protocol. */
function buildQuickStream(proto: string): Record<string, string | number | boolean> {
  if (proto === "shadowsocks") return { method: "2022-blake3-aes-128-gcm" };
  if (proto === "socks") return { socksUdp: true };
  if (proto === "dokodemo-door")
    return { dokoAddress: "one.one.one.one", dokoPort: 53, dokoNetwork: "tcp,udp" };
  if (proto === "wireguard") {
    const pair = genWgPair();
    return { wgSecretKey: pair.priv, wgPublicKey: pair.pub, wgMtu: 1420 };
  }
  return {};
}

function buildStream(form: FormState): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(form.stream)) {
    if (v === "" || v === undefined || v === null) continue;
    if (NUM_STREAM_KEYS.has(k)) out[k] = Number(v) || 0;
    else if (BOOL_STREAM_KEYS.has(k)) out[k] = v === "true";
    else out[k] = v;
  }
  if (form.security === "tls" || form.security === "reality") {
    out.fingerprint = form.stream.fingerprint || "chrome";
  }
  if (form.transport === "grpc") out.multiMode = form.stream.multiMode === "true";
  out.mux = form.mux;
  const fb = form.fallbacks.filter((f) => f.dest.trim());
  if (fb.length > 0) {
    out.fallbacksJson = JSON.stringify(
      fb.map((f) => ({
        name: f.name.trim() || undefined,
        dest: f.dest.trim(),
        alpn: f.alpn.trim() || undefined,
        path: f.path.trim() || undefined,
      }))
    );
  }
  return out;
}

function buildPayload(form: FormState) {
  const isDoko = form.protocol === "dokodemo-door";
  return {
    tag: form.tag.trim(),
    protocol: form.protocol,
    port: form.port.trim() === "" ? "" : Number(form.port),
    listen: form.listen.trim(),
    transport: form.transport,
    security: form.security,
    status: form.status,
    note: form.note.trim(),
    trafficLimitGb: form.trafficLimitGb.trim() === "" ? null : Number(form.trafficLimitGb),
    expiryDays: form.expiryDays.trim() === "" ? null : Number(form.expiryDays),
    clients: isDoko
      ? [] // dokodemo-door has no client accounts
      : form.clients.map((c) => ({
          email: c.email.trim(),
          key: c.key.trim(),
          subId: c.subId.trim(),
          flow: form.protocol === "vless" && form.security === "reality" ? c.flow : "",
          ipLimit: c.ipLimit.trim() === "" ? 0 : Number(c.ipLimit),
          trafficLimitGb: c.trafficLimitGb.trim() === "" ? null : Number(c.trafficLimitGb),
          expiryDays: c.expiryDays.trim() === "" ? null : Number(c.expiryDays),
          enabled: c.enabled,
        })),
    sniffing: form.sniffing,
    stream: buildStream(form),
  };
}

function dtoToForm(dto: InboundDTO): FormState {
  const stream: Record<string, string> = {};
  for (const [k, v] of Object.entries(dto.stream ?? {})) {
    stream[k] = BOOL_STREAM_KEYS.has(k) ? String(Boolean(v)) : String(v);
  }
  let fallbacks: FallbackForm[] = [];
  try {
    const raw = stream.fallbacksJson;
    if (raw) {
      const parsed = JSON.parse(raw) as Array<Record<string, string | undefined>>;
      fallbacks = parsed.map((f) => ({
        name: f.name ?? "",
        dest: f.dest ?? "",
        alpn: f.alpn ?? "",
        path: f.path ?? "",
      }));
    }
  } catch {
    fallbacks = [];
  }
  return {
    tag: dto.tag,
    protocol: dto.protocol,
    port: String(dto.port),
    listen: dto.listen ?? "",
    transport: dto.transport,
    security: dto.security,
    status: dto.status,
    note: dto.note ?? "",
    trafficLimitGb: dto.trafficLimitGb === null ? "" : String(dto.trafficLimitGb),
    expiryDays: dto.expiryDays === null ? "" : String(dto.expiryDays),
    clients: (dto.clients ?? []).map((c) => ({
      email: c.email,
      key: c.key,
      subId: c.subId,
      flow: c.flow ?? "",
      ipLimit: String(c.ipLimit ?? 0),
      trafficLimitGb: c.trafficLimitGb === null || c.trafficLimitGb === undefined ? "" : String(c.trafficLimitGb),
      expiryDays: c.expiryDays === null || c.expiryDays === undefined ? "" : String(c.expiryDays),
      enabled: c.enabled,
    })),
    sniffing: {
      enabled: dto.sniffing?.enabled ?? false,
      destOverride: dto.sniffing?.destOverride?.length
        ? dto.sniffing.destOverride
        : ["http", "tls"],
      routeOnly: dto.sniffing?.routeOnly ?? false,
    },
    mux: dto.stream?.mux === true || dto.stream?.mux === "true",
    fallbacks,
    stream,
  };
}

/* ---------- small building blocks ---------- */

function ProtoOrb({ protocol, size = "md" }: { protocol: string; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "h-10 w-10 text-sm" : "h-9 w-9 text-xs";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl font-mono font-bold ring-1",
        dim,
        PROTO_CLS[protocol] ?? PROTO_CLS.vless
      )}
      aria-hidden="true"
    >
      {(PROTO_LABEL[protocol] ?? protocol).slice(0, 2).toUpperCase()}
    </span>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 font-mono text-[10px] ring-1",
        accent
          ? "bg-primary/8 text-primary/90 ring-primary/20"
          : "bg-white/5 text-muted-foreground ring-white/10"
      )}
    >
      {children}
    </span>
  );
}

function MiniField({
  id,
  label,
  children,
  error,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {error ? (
        <p className="text-[11px] font-medium text-chart-5">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted-foreground/70">{hint}</p>
      ) : null}
    </div>
  );
}

/** Plain-language helper line — one per section (user-requested guidance). */
function Tip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 rounded-lg bg-primary/[0.04] px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-primary/10",
        className
      )}
    >
      <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-primary/80" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function SecPicker({
  value,
  onChange,
  noneLabel,
  tlsLabel,
  realLabel,
  noneDesc,
  tlsDesc,
  realDesc,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  noneLabel: string;
  tlsLabel: string;
  realLabel: string;
  noneDesc: string;
  tlsDesc: string;
  realDesc: string;
  hint: string;
}) {
  const items = [
    { v: "none", label: noneLabel, desc: noneDesc, icon: ShieldOff },
    { v: "tls", label: tlsLabel, desc: tlsDesc, icon: ShieldCheck },
    { v: "reality", label: realLabel, desc: realDesc, icon: ShieldPlus },
  ];
  return (
    <div className="space-y-2">
      <div className="grid gap-2.5 sm:grid-cols-3" role="radiogroup" aria-label={hint}>
        {items.map(({ v, label, desc, icon: Icon }) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "group/sec relative flex items-start gap-3 overflow-hidden rounded-2xl border p-3.5 text-start transition-all duration-200",
              value === v
                ? "border-primary/45 bg-primary/[0.07] shadow-[0_0_26px_-10px_var(--primary)]"
                : "border-white/10 bg-white/[0.03] hover:border-white/20"
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition-colors",
                value === v
                  ? "bg-primary/10 text-primary ring-primary/30"
                  : "bg-white/[0.04] text-muted-foreground ring-white/10 group-hover/sec:text-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span
                className={cn(
                  "block text-[12px] font-bold",
                  value === v ? "text-primary" : "text-silver"
                )}
              >
                {label}
              </span>
              <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                {desc}
              </span>
            </span>
            {value === v && (
              <BadgeCheck className="absolute top-2.5 end-2.5 h-3.5 w-3.5 shrink-0 text-primary" />
            )}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground/70">{hint}</p>
    </div>
  );
}

/* ============================================================
   Main view
   ============================================================ */

export function InboundsView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const { toast } = useToast();

  /* live stats from the core adapter (wire list is a stable ref) */
  const wireInbounds = useCoreStore((s) => s.snapshot.inbounds);
  const upsertInboundLocal = useCoreStore((s) => s.upsertInboundLocal);
  const removeInboundLocal = useCoreStore((s) => s.removeInboundLocal);

  /* config rows from the API — null = first load */
  const [rows, setRows] = useState<InboundDTO[] | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  /* toolbar */
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  /* create / edit dialog */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InboundDTO | null>(null);
  const [tab, setTab] = useState<TabId>("general");
  const [form, setForm] = useState<FormState>(() => ({
    tag: "",
    protocol: "vless",
    port: "",
    listen: "",
    transport: "tcp",
    security: "none",
    status: "online",
    note: "",
    trafficLimitGb: "",
    expiryDays: "",
    clients: [],
    sniffing: { enabled: false, destOverride: ["http", "tls"], routeOnly: false },
    mux: false,
    fallbacks: [],
    stream: {},
  }));
  const [fieldErr, setFieldErr] = useState<Partial<Record<string, string>>>({});
  const [dupEmails, setDupEmails] = useState<Set<number>>(new Set());
  const [topErr, setTopErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /* quick create (simple-panel mode) */
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickProto, setQuickProto] = useState<string>("vless");
  const [quickDraft, setQuickDraft] = useState({
    tag: "",
    port: 0,
    email: "",
    key: "",
    subId: "",
  });
  const [quickBusy, setQuickBusy] = useState(false);

  /* delete confirm */
  const [deleting, setDeleting] = useState<InboundDTO | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const FIELD_ERR: Record<string, string> = {
    required: t.inbounds.errGeneric,
    tagFormat: t.inbounds.errTagFormat,
    portType: t.inbounds.errPortType,
    portRange: t.inbounds.errPortRange,
    noteLong: t.inbounds.errNoteLong,
    badValue: t.inbounds.errBadValue,
    invalid: t.inbounds.errBadValue,
    tooLong: t.inbounds.errBadValue,
    tooMany: t.inbounds.errBadValue,
    dupEmail: t.inbounds.errBadValue,
  };

  /** which tab owns each server-side field error */
  const FIELD_TAB: Record<string, TabId> = {
    tag: "general",
    protocol: "general",
    port: "general",
    listen: "general",
    status: "general",
    note: "general",
    trafficLimitGb: "general",
    expiryDays: "general",
    clients: form.protocol === "dokodemo-door" ? "general" : "clients",
    transport: "transport",
    // per-protocol connection fields (socks/http auth, doko target, wg keys)
    // live in the General tab for those protocols, otherwise Transport
    stream: ["dokodemo-door", "wireguard", "socks", "http"].includes(form.protocol)
      ? "general"
      : "transport",
    security: "security",
    sniffing: "advanced",
  };

  /* ---------- data ---------- */

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inbounds", { cache: "no-store" });
      if (!res.ok) {
        setLoadErr(true);
        return;
      }
      const data = (await res.json()) as { inbounds?: InboundDTO[] };
      setRows(data.inbounds ?? []);
      setLoadErr(false);
    } catch {
      setLoadErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statsByTag = useMemo(() => {
    const map = new Map<string, { users: number; txGb: number }>();
    for (const ib of wireInbounds) map.set(ib.tag, { users: ib.users, txGb: ib.txGb });
    return map;
  }, [wireInbounds]);

  const merged = useMemo(
    () =>
      (rows ?? []).map((r) => {
        const live = statsByTag.get(r.tag);
        return { ...r, users: live?.users ?? 0, txGb: live?.txGb ?? 0 };
      }),
    [rows, statsByTag]
  );

  const counts = useMemo(
    () => ({
      all: merged.length,
      online: merged.filter((r) => r.status === "online").length,
      maintenance: merged.filter((r) => r.status === "maintenance").length,
      disabled: merged.filter((r) => r.status === "disabled").length,
    }),
    [merged]
  );

  const totals = useMemo(
    () => ({
      users: merged.reduce((acc, r) => acc + r.users, 0),
      traffic: merged.reduce((acc, r) => acc + r.txGb, 0),
      clients: merged.reduce((acc, r) => acc + (r.clients?.length ?? 0), 0),
    }),
    [merged]
  );

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return merged.filter(
      (r) =>
        (statusFilter === "all" || r.status === statusFilter) &&
        (!needle || r.tag.toLowerCase().includes(needle))
    );
  }, [merged, q, statusFilter]);

  const maxTx = useMemo(
    () => Math.max(1, ...merged.map((r) => r.txGb)),
    [merged]
  );

  /* ---------- mutations ---------- */

  const openCreate = () => {
    const used = new Set((rows ?? []).map((r) => r.port));
    let port = 10000;
    while (used.has(port)) port++;
    setEditing(null);
    setTab("general");
    setForm({
      tag: "",
      protocol: "vless",
      port: String(port),
      listen: "",
      transport: "tcp",
      security: "none",
      status: "online",
      note: "",
      trafficLimitGb: "",
      expiryDays: "",
      clients: [
        {
          email: "",
          key: genClientKey("vless"),
          subId: genSubId(),
          flow: "",
          ipLimit: "0",
          trafficLimitGb: "",
          expiryDays: "",
          enabled: true,
        },
      ],
      sniffing: { enabled: false, destOverride: ["http", "tls"], routeOnly: false },
      mux: false,
      fallbacks: [],
      stream: {},
    });
    setFieldErr({});
    setDupEmails(new Set());
    setTopErr(null);
    setDialogOpen(true);
  };

  /* ---------- quick create (Marzban-simple) ---------- */

  const makeQuickDraft = useCallback(
    (proto: string) => {
      const used = new Set((rows ?? []).map((r) => r.port));
      let port = 10000;
      while (used.has(port)) port++;
      setQuickDraft({
        tag: `${proto}-${port}`,
        port,
        email: proto === "dokodemo-door" ? "—" : `user-${port}`,
        key: proto === "dokodemo-door" ? "—" : genClientKey(proto),
        subId: proto === "dokodemo-door" ? "—" : genSubId(),
      });
      setQuickProto(proto);
    },
    [rows]
  );

  const openQuick = () => {
    makeQuickDraft("vless");
    setQuickOpen(true);
  };

  const runQuickCreate = async () => {
    if (quickBusy) return;
    const preset = QUICK_PRESET[quickProto] ?? QUICK_PRESET.vless;
    setQuickBusy(true);
    try {
      const payload = {
        tag: quickDraft.tag,
        protocol: quickProto,
        port: quickDraft.port,
        listen: "",
        transport: preset.transport,
        security: preset.security,
        status: "online",
        note: "",
        trafficLimitGb: null,
        expiryDays: null,
        clients:
          quickProto === "dokodemo-door"
            ? []
            : [
                {
                  email: quickDraft.email,
                  key: quickDraft.key,
                  subId: quickDraft.subId,
                  flow: "",
                  ipLimit: 0,
                  trafficLimitGb: null,
                  expiryDays: null,
                  enabled: true,
                },
              ],
        sniffing: { enabled: false, destOverride: ["http", "tls"], routeOnly: false },
        stream: buildQuickStream(quickProto),
      };
      const res = await fetch("/api/inbounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        inbound?: InboundDTO;
        error?: string;
      };
      if (res.ok && data.inbound) {
        const dto = data.inbound;
        upsertInboundLocal({
          tag: dto.tag,
          proto: composeProto(dto.protocol, dto.transport, dto.security),
          port: dto.port,
          status: "online",
          users: 0,
          txGb: 0,
        });
        setRows((prev) => [...(prev ?? []), dto]);
        setQuickOpen(false);
        toast({ title: lfmt(t.inbounds.toastQuick, { tag: dto.tag }) });
        void load();
      } else if (res.status === 409) {
        // port raced — re-draft and let the user retry
        makeQuickDraft(quickProto);
        toast({ title: t.inbounds.errPortUsed, variant: "destructive" });
      } else {
        toast({ title: t.inbounds.toastFail, variant: "destructive" });
      }
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    } finally {
      setQuickBusy(false);
    }
  };

  const openEdit = (row: InboundDTO) => {
    setEditing(row);
    setTab("general");
    setForm(dtoToForm(row));
    setFieldErr({});
    setDupEmails(new Set());
    setTopErr(null);
    setDialogOpen(true);
  };

  const save = async () => {
    if (saving) return;

    /* local pre-flight */
    const localErrs: Partial<Record<string, string>> = {};
    if (!form.tag.trim()) localErrs.tag = FIELD_ERR.required;
    else if (form.tag.trim().length > 32 || !/^[a-zA-Z0-9_-]+$/.test(form.tag.trim()))
      localErrs.tag = FIELD_ERR.tagFormat;
    const portNum = Number(form.port);
    if (form.port.trim() === "") localErrs.port = FIELD_ERR.portType;
    else if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)
      localErrs.port = FIELD_ERR.portRange;

    const isDoko = form.protocol === "dokodemo-door";
    const dupSet = new Set<number>();
    const seenEmails = new Set<string>();
    if (!isDoko) {
      form.clients.forEach((c, i) => {
        const email = c.email.trim();
        if (!email || seenEmails.has(email)) dupSet.add(i);
        seenEmails.add(email);
        if (!c.key.trim()) localErrs[`client-${i}-key`] = FIELD_ERR.required;
      });
    }
    setDupEmails(dupSet);

    if (Object.keys(localErrs).length > 0 || dupSet.size > 0) {
      setFieldErr(localErrs);
      setTopErr(t.inbounds.errConfig);
      const firstKey = Object.keys(localErrs)[0];
      const targetTab: TabId =
        dupSet.size > 0 && !firstKey
          ? "clients"
          : FIELD_TAB[firstKey?.startsWith("client-") ? "clients" : (firstKey ?? "general")] ??
            "general";
      setTab(targetTab);
      return;
    }

    setSaving(true);
    setTopErr(null);
    setFieldErr({});
    try {
      const res = await fetch(editing ? `/api/inbounds/${editing.id}` : "/api/inbounds", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      const data = (await res.json().catch(() => ({}))) as {
        inbound?: InboundDTO;
        error?: string;
        fields?: Record<string, string>;
      };

      if (res.status === 401) {
        setTopErr(t.inbounds.errGeneric);
        return;
      }
      if (res.status === 400 && data.fields) {
        const mapped: Partial<Record<string, string>> = {};
        for (const [k, v] of Object.entries(data.fields)) {
          mapped[k] = FIELD_ERR[v] ?? t.inbounds.errBadValue;
        }
        setFieldErr(mapped);
        setTopErr(t.inbounds.errConfig);
        const firstKey = Object.keys(data.fields)[0];
        setTab(FIELD_TAB[firstKey] ?? "general");
        return;
      }
      if (res.status === 409) {
        setTopErr(
          data.error === "duplicate_tag"
            ? t.inbounds.errTagUsed
            : data.error === "duplicate_port"
              ? t.inbounds.errPortUsed
              : t.inbounds.errGeneric
        );
        setTab("general");
        return;
      }
      if (!res.ok || !data.inbound) {
        toast({ title: t.inbounds.toastFail, variant: "destructive" });
        return;
      }

      const dto = data.inbound;
      const oldTag = editing?.tag;
      if (editing && oldTag && oldTag !== dto.tag) {
        removeInboundLocal(oldTag);
        upsertInboundLocal({
          tag: dto.tag,
          proto: composeProto(dto.protocol, dto.transport, dto.security),
          port: dto.port,
          status: dto.status as "online" | "maintenance" | "disabled",
          users: 0,
          txGb: 0,
        });
      } else {
        const prev = wireInbounds.find((x) => x.tag === (oldTag ?? dto.tag));
        upsertInboundLocal({
          tag: dto.tag,
          proto: composeProto(dto.protocol, dto.transport, dto.security),
          port: dto.port,
          status: dto.status as "online" | "maintenance" | "disabled",
          users: prev?.users ?? 0,
          txGb: prev?.txGb ?? 0,
        });
      }

      setRows((prev) => {
        const base = prev ?? [];
        return editing
          ? base.map((r) => (r.id === dto.id ? dto : r))
          : [...base, dto];
      });
      setDialogOpen(false);
      toast({
        title: lfmt(editing ? t.inbounds.toastUpdated : t.inbounds.toastCreated, { tag: dto.tag }),
      });
      if (!editing) void load(); // canonical ordering for fresh rows
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || deleteBusy) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/inbounds/${deleting.id}`, { method: "DELETE" });
      if (res.ok || res.status === 404) {
        removeInboundLocal(deleting.tag);
        setRows((prev) => (prev ?? []).filter((r) => r.id !== deleting.id));
        toast({ title: lfmt(t.inbounds.toastDeleted, { tag: deleting.tag }) });
        setDeleting(null);
      } else {
        toast({ title: t.inbounds.toastFail, variant: "destructive" });
      }
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    } finally {
      setDeleteBusy(false);
    }
  };

  const setStatus = async (row: InboundDTO, status: string) => {
    try {
      const res = await fetch(`/api/inbounds/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = (await res.json().catch(() => ({}))) as { inbound?: InboundDTO };
      if (!res.ok || !data.inbound) {
        toast({ title: t.inbounds.toastFail, variant: "destructive" });
        return;
      }
      upsertInboundLocal({
        tag: row.tag,
        proto: composeProto(row.protocol, row.transport, row.security),
        port: row.port,
        status: status as "online" | "maintenance" | "disabled",
        users: statsByTag.get(row.tag)?.users ?? 0,
        txGb: statsByTag.get(row.tag)?.txGb ?? 0,
      });
      setRows((prev) => (prev ?? []).map((r) => (r.id === row.id ? data.inbound! : r)));
      toast({ title: lfmt(t.inbounds.toastUpdated, { tag: row.tag }) });
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    }
  };

  const copyLink = async (row: InboundDTO) => {
    const first = (row.clients ?? []).find((c) => c.enabled) ?? row.clients?.[0];
    let text: string | null = null;
    if (row.protocol === "wireguard") {
      text = buildWgConf(row, first);
    } else if (row.protocol === "dokodemo-door") {
      text = buildDokoSummary(row);
    } else {
      text = buildShareLink(row, first);
    }
    if (!text) {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t.inbounds.toastCopied });
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    }
  };

  /* ---------- render helpers ---------- */

  const StatusText: Record<string, string> = {
    online: t.inbounds.stOnline,
    maintenance: t.inbounds.stMaint,
    disabled: t.inbounds.stDisabled,
  };

  const TransportText: Record<string, string> = {
    tcp: t.inbounds.trTcp,
    ws: t.inbounds.trWs,
    grpc: t.inbounds.trGrpc,
    httpupgrade: t.inbounds.trHttpUp,
    xhttp: "XHTTP",
  };

  const SecurityText: Record<string, string> = {
    none: t.inbounds.secNone,
    tls: t.inbounds.secTls,
    reality: t.inbounds.secReal,
  };

  const KPI = ({
    icon: Icon,
    value,
    label,
    trend,
  }: {
    icon: LucideIcon;
    value: string;
    label: string;
    trend: string;
  }) => (
    <div className="glass hover-glow group relative overflow-hidden rounded-2xl px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
          <Icon className="h-4.5 w-4.5 text-primary" />
        </span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-chart-3">
          <TrendingUp className="h-3 w-3" />
          {trend}
        </span>
      </div>
      <p className="mt-3 truncate font-mono text-2xl font-bold leading-none text-silver tabular-nums md:text-3xl">
        {value}
      </p>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{label}</p>
    </div>
  );

  /* ---------- dialog tab renderers ---------- */

  const setS = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const setStream = (key: string, value: string) =>
    setForm((f) => ({ ...f, stream: { ...f.stream, [key]: value } }));

  const renderGeneral = () => (
    <div className="space-y-5">
      {/* protocol picker — rich per-protocol cards */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">{t.inbounds.fieldProtocol}</Label>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {PROTOCOLS.map((p) => {
            const selected = form.protocol === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setForm((f) => {
                    const stream = { ...f.stream };
                    if (p === "shadowsocks" && !stream.method)
                      stream.method = "2022-blake3-aes-128-gcm";
                    if (p === "wireguard" && !stream.wgSecretKey) {
                      const pair = genWgPair();
                      stream.wgSecretKey = pair.priv;
                      stream.wgPublicKey = pair.pub;
                      if (!stream.wgMtu) stream.wgMtu = "1420";
                    }
                    if (p === "dokodemo-door" && !stream.dokoAddress) {
                      stream.dokoAddress = "one.one.one.one";
                      if (!stream.dokoPort) stream.dokoPort = "53";
                      if (!stream.dokoNetwork) stream.dokoNetwork = "tcp,udp";
                    }
                    const noStream = NO_STREAM_PROTOCOLS.has(p);
                    return {
                      ...f,
                      protocol: p,
                      stream,
                      // raw-socket protocols carry no transport/security layers
                      transport: noStream ? "tcp" : f.transport,
                      security: noStream ? "none" : f.security,
                      clients:
                        p === "dokodemo-door"
                          ? []
                          : f.clients.length === 0
                            ? [
                                {
                                  email: "",
                                  key: genClientKey(p),
                                  subId: genSubId(),
                                  flow: "",
                                  ipLimit: "0",
                                  trafficLimitGb: "",
                                  expiryDays: "",
                                  enabled: true,
                                },
                              ]
                            : f.clients.map((c) => ({
                                ...c,
                                key: genClientKey(p),
                                flow: p === "vless" ? c.flow : "",
                              })),
                    };
                  });
                  if (p === "dokodemo-door") {
                    setTab((cur) => (cur === "clients" ? "general" : cur));
                  }
                }}
                className={cn(
                  "group/card relative flex items-start gap-3 overflow-hidden rounded-2xl border p-3 text-start transition-all duration-200",
                  selected
                    ? "border-primary/45 bg-primary/[0.07] shadow-[0_0_26px_-10px_var(--primary)]"
                    : cn("border-white/10 bg-white/[0.03]", PROTO_HOVER[p])
                )}
                aria-pressed={selected}
              >
                <span
                  className={cn(
                    "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 transition-transform duration-200 group-hover/card:scale-105",
                    PROTO_CLS[p]
                  )}
                >
                  <ProtoOrb protocol={p} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1">
                    <span
                      className={cn(
                        "text-[12px] font-bold",
                        selected ? "text-primary" : "text-silver"
                      )}
                    >
                      {PROTO_LABEL[p]}
                    </span>
                    {p === "vless" && (
                      <Star
                        className="h-3 w-3 shrink-0 fill-chart-3 text-chart-3"
                        aria-label={t.inbounds.recoBadge}
                      />
                    )}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                    {t.inbounds[PROTO_DESC_KEY[p] as keyof typeof t.inbounds]}
                  </span>
                </span>
                {selected && (
                  <BadgeCheck className="absolute top-2 end-2 h-3.5 w-3.5 shrink-0 text-primary" />
                )}
              </button>
            );
          })}
        </div>
        <Tip>{t.inbounds.tipProtocol}</Tip>
      </div>

      {/* shadowsocks cipher */}
      {form.protocol === "shadowsocks" && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniField id="ss-method" label={t.inbounds.ssMethod} hint={t.inbounds.tipSs}>
              <Select
                value={form.stream.method || "2022-blake3-aes-128-gcm"}
                onValueChange={(v) => setStream("method", v)}
              >
                <SelectTrigger id="ss-method" className="w-full font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {SS_METHODS.map((m) => (
                    <SelectItem key={m} value={m} className="font-mono text-xs">
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MiniField>
          </div>
        </div>
      )}

      {/* socks / http auth */}
      {(form.protocol === "socks" || form.protocol === "http") && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-silver">
            <Users className="h-3.5 w-3.5 text-primary" />
            {PROTO_LABEL[form.protocol]}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniField id="pa-user" label={t.inbounds.authUser} hint={t.inbounds.tipAuth}>
              <Input
                id="pa-user"
                value={form.stream.authUser ?? ""}
                onChange={(e) => setStream("authUser", e.target.value)}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="pa-pass" label={t.inbounds.authPass}>
              <Input
                id="pa-pass"
                value={form.stream.authPass ?? ""}
                onChange={(e) => setStream("authPass", e.target.value)}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            {form.protocol === "socks" && (
              <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground sm:col-span-2">
                <Switch
                  checked={form.stream.socksUdp === "true"}
                  onCheckedChange={(v) => setStream("socksUdp", String(v))}
                  aria-label={t.inbounds.udpOn}
                />
                {t.inbounds.udpOn}
              </label>
            )}
          </div>
          <Tip>{t.inbounds.tipAuth}</Tip>
        </div>
      )}

      {/* dokodemo-door target */}
      {form.protocol === "dokodemo-door" && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-silver">
            <Globe className="h-3.5 w-3.5 text-primary" />
            {PROTO_LABEL["dokodemo-door"]}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <MiniField id="dk-addr" label={t.inbounds.dokoAddr}>
              <Input
                id="dk-addr"
                value={form.stream.dokoAddress ?? ""}
                onChange={(e) => setStream("dokoAddress", e.target.value)}
                placeholder="one.one.one.one"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="dk-port" label={t.inbounds.dokoPortL}>
              <Input
                id="dk-port"
                value={form.stream.dokoPort ?? ""}
                onChange={(e) => setStream("dokoPort", e.target.value)}
                placeholder="53"
                inputMode="numeric"
                className="font-mono text-xs"
              />
            </MiniField>
            <MiniField id="dk-net" label={t.inbounds.dokoNet}>
              <Select
                value={form.stream.dokoNetwork || "tcp,udp"}
                onValueChange={(v) => setStream("dokoNetwork", v)}
              >
                <SelectTrigger id="dk-net" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  <SelectItem value="tcp">{t.inbounds.dokoTcp}</SelectItem>
                  <SelectItem value="udp">{t.inbounds.dokoUdp}</SelectItem>
                  <SelectItem value="tcp,udp">{t.inbounds.dokoBoth}</SelectItem>
                </SelectContent>
              </Select>
            </MiniField>
          </div>
          <Tip>{t.inbounds.tipDoko}</Tip>
        </div>
      )}

      {/* wireguard keys */}
      {form.protocol === "wireguard" && (
        <div className="space-y-3 rounded-xl border border-[#c084fc]/20 bg-[#c084fc]/[0.04] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-silver">
              <KeyRound className="h-3.5 w-3.5 text-[#c084fc]" />
              {PROTO_LABEL["wireguard"]}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const pair = genWgPair();
                setForm((f) => ({
                  ...f,
                  stream: { ...f.stream, wgSecretKey: pair.priv, wgPublicKey: pair.pub },
                }));
              }}
              className="h-7 gap-1.5 rounded-full border-[#c084fc]/30 bg-[#c084fc]/10 px-3 text-[11px] text-[#c084fc] hover:bg-[#c084fc]/20"
            >
              <RefreshCcw className="h-3 w-3" />
              {t.inbounds.wgGen}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniField id="wg-priv" label={t.inbounds.wgSecret}>
              <Input
                id="wg-priv"
                value={form.stream.wgSecretKey ?? ""}
                onChange={(e) => setStream("wgSecretKey", e.target.value)}
                className="font-mono text-[11px]"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="wg-pub" label={t.inbounds.wgPublic}>
              <Input
                id="wg-pub"
                value={form.stream.wgPublicKey ?? ""}
                onChange={(e) => setStream("wgPublicKey", e.target.value)}
                className="font-mono text-[11px]"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="wg-mtu" label={t.inbounds.wgMtu}>
              <Input
                id="wg-mtu"
                value={form.stream.wgMtu ?? ""}
                onChange={(e) => setStream("wgMtu", e.target.value)}
                placeholder="1420"
                inputMode="numeric"
                className="font-mono text-xs"
              />
            </MiniField>
          </div>
          <Tip>{t.inbounds.tipWg}</Tip>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <MiniField
          id="ib-tag"
          label={t.inbounds.fieldTag}
          error={fieldErr.tag}
          hint={t.inbounds.errTagFormat}
        >
          <Input
            id="ib-tag"
            value={form.tag}
            onChange={(e) => setS({ tag: e.target.value })}
            placeholder={t.inbounds.phTag}
            className="font-mono"
            autoComplete="off"
          />
        </MiniField>

        <MiniField
          id="ib-port"
          label={t.inbounds.fieldPort}
          error={fieldErr.port}
          hint={t.inbounds.tipPort}
        >
          <div className="flex gap-2">
            <Input
              id="ib-port"
              value={form.port}
              onChange={(e) => setS({ port: e.target.value })}
              placeholder={t.inbounds.phPort}
              inputMode="numeric"
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const used = new Set((rows ?? []).map((r) => r.port));
                let port = Number(form.port) || 10000;
                while (used.has(port)) port++;
                setS({ port: String(port) });
              }}
              className="shrink-0 gap-1.5 rounded-xl border-white/10 bg-white/[0.03] text-[11px] hover:bg-white/[0.06]"
              title={t.inbounds.randPort}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              {t.inbounds.randPort}
            </Button>
          </div>
        </MiniField>

        <MiniField
          id="ib-listen"
          label={t.inbounds.fieldListen}
          error={fieldErr.listen}
          hint={t.inbounds.listenHint}
        >
          <Input
            id="ib-listen"
            value={form.listen}
            onChange={(e) => setS({ listen: e.target.value })}
            placeholder={t.inbounds.phListen}
            className="font-mono"
            autoComplete="off"
          />
        </MiniField>

        <MiniField id="ib-status" label={t.inbounds.fieldStatus} hint={t.inbounds.tipStatus}>
          <Select value={form.status} onValueChange={(v) => setS({ status: v })}>
            <SelectTrigger id="ib-status" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="glass-strong">
              <SelectItem value="online">{t.inbounds.stOnline}</SelectItem>
              <SelectItem value="maintenance">{t.inbounds.stMaint}</SelectItem>
              <SelectItem value="disabled">{t.inbounds.stDisabled}</SelectItem>
            </SelectContent>
          </Select>
        </MiniField>

        <MiniField
          id="ib-total"
          label={t.inbounds.fieldTotal}
          error={fieldErr.trafficLimitGb}
          hint={t.inbounds.tipTotal}
        >
          <Input
            id="ib-total"
            value={form.trafficLimitGb}
            onChange={(e) => setS({ trafficLimitGb: e.target.value })}
            placeholder="0"
            inputMode="decimal"
            className="font-mono"
          />
        </MiniField>

        <MiniField
          id="ib-expiry"
          label={t.inbounds.fieldExpiry}
          error={fieldErr.expiryDays}
          hint={t.inbounds.tipExpiry}
        >
          <Input
            id="ib-expiry"
            value={form.expiryDays}
            onChange={(e) => setS({ expiryDays: e.target.value })}
            placeholder="0"
            inputMode="numeric"
            className="font-mono"
          />
        </MiniField>
      </div>

      <MiniField id="ib-note" label={t.inbounds.fieldNote} error={fieldErr.note} hint={t.inbounds.tipNote}>
        <Textarea
          id="ib-note"
          value={form.note}
          onChange={(e) => setS({ note: e.target.value })}
          placeholder={t.inbounds.phNote}
          rows={2}
          className="resize-none"
        />
      </MiniField>
    </div>
  );

  const renderClients = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {lfmt(t.inbounds.clientsCount, { n: form.clients.length })}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setForm((f) => ({
              ...f,
              clients: [
                ...f.clients,
                {
                  email: "",
                  key: genClientKey(f.protocol),
                  subId: genSubId(),
                  flow: "",
                  ipLimit: "0",
                  trafficLimitGb: "",
                  expiryDays: "",
                  enabled: true,
                },
              ],
            }))
          }
          disabled={form.clients.length >= 100}
          className="gap-1.5 rounded-full border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.inbounds.addClient}
        </Button>
      </div>

      <Tip>{t.inbounds.tipClients}</Tip>

      {form.clients.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-muted-foreground">
          {t.inbounds.errGeneric}
        </div>
      )}

      {form.clients.map((c, i) => {
        const emailDup = dupEmails.has(i);
        const emailBad = fieldErr[`client-${i}-email`];
        const keyErr = fieldErr[`client-${i}-key`];
        return (
          <div
            key={i}
            className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-3.5"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <MiniField
                id={`c-email-${i}`}
                label={t.inbounds.cEmail}
                hint={t.inbounds.tipEmail}
                error={emailDup || emailBad ? t.inbounds.errBadValue : undefined}
              >
                <Input
                  id={`c-email-${i}`}
                  value={c.email}
                  onChange={(e) => {
                    const email = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, email } : x)),
                    }));
                    setDupEmails((prev) => {
                      const next = new Set(prev);
                      next.delete(i);
                      return next;
                    });
                  }}
                  placeholder={t.inbounds.phEmail}
                  className={cn("font-mono", (emailDup || emailBad) && "border-chart-5/60")}
                  autoComplete="off"
                />
              </MiniField>

              <MiniField
                id={`c-key-${i}`}
                label={t.inbounds.cId}
                hint={t.inbounds.tipKey}
                error={keyErr}
              >
                <div className="flex gap-1.5">
                  <Input
                    id={`c-key-${i}`}
                    value={c.key}
                    onChange={(e) => {
                      const key = e.target.value;
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) => (j === i ? { ...x, key } : x)),
                      }));
                    }}
                    className="font-mono text-xs"
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) =>
                          j === i ? { ...x, key: genClientKey(f.protocol) } : x
                        ),
                      }))
                    }
                    className="h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:text-primary"
                    title={t.inbounds.genId}
                    aria-label={t.inbounds.genId}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </MiniField>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniField id={`c-sub-${i}`} label={t.inbounds.cSubId} hint={t.inbounds.tipSub}>
                <Input
                  id={`c-sub-${i}`}
                  value={c.subId}
                  onChange={(e) => {
                    const subId = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, subId } : x)),
                    }));
                  }}
                  placeholder={t.inbounds.phSubId}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </MiniField>

              {form.protocol === "vless" ? (
                <MiniField id={`c-flow-${i}`} label={t.inbounds.cFlow} hint={t.inbounds.tipFlow}>
                  <Select
                    value={c.flow || "none"}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) =>
                          j === i ? { ...x, flow: v === "none" ? "" : v } : x
                        ),
                      }))
                    }
                  >
                    <SelectTrigger id={`c-flow-${i}`} className="w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-strong">
                      <SelectItem value="none">{t.inbounds.flowNone}</SelectItem>
                      <SelectItem value="xtls-rprx-vision">{t.inbounds.flowVision}</SelectItem>
                    </SelectContent>
                  </Select>
                </MiniField>
              ) : (
                <MiniField id={`c-ips-${i}`} label={t.inbounds.cIps} hint={t.inbounds.phIps}>
                  <Input
                    id={`c-ips-${i}`}
                    value={c.ipLimit}
                    onChange={(e) => {
                      const ipLimit = e.target.value;
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) => (j === i ? { ...x, ipLimit } : x)),
                      }));
                    }}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </MiniField>
              )}

              <MiniField
                id={`c-tx-${i}`}
                label={t.inbounds.cTraffic}
                hint={t.inbounds.tipCTraffic}
              >
                <Input
                  id={`c-tx-${i}`}
                  value={c.trafficLimitGb}
                  onChange={(e) => {
                    const trafficLimitGb = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, trafficLimitGb } : x)),
                    }));
                  }}
                  placeholder="0"
                  inputMode="decimal"
                  className="font-mono text-xs"
                />
              </MiniField>

              <MiniField id={`c-exp-${i}`} label={t.inbounds.cExpiry} hint={t.inbounds.tipCExpiry}>
                <Input
                  id={`c-exp-${i}`}
                  value={c.expiryDays}
                  onChange={(e) => {
                    const expiryDays = e.target.value;
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, expiryDays } : x)),
                    }));
                  }}
                  placeholder="0"
                  inputMode="numeric"
                  className="font-mono text-xs"
                />
              </MiniField>
            </div>

            {form.protocol === "vless" && (
              <div className="grid gap-3 sm:grid-cols-4">
                <MiniField id={`c-ips2-${i}`} label={t.inbounds.cIps} hint={t.inbounds.phIps}>
                  <Input
                    id={`c-ips2-${i}`}
                    value={c.ipLimit}
                    onChange={(e) => {
                      const ipLimit = e.target.value;
                      setForm((f) => ({
                        ...f,
                        clients: f.clients.map((x, j) => (j === i ? { ...x, ipLimit } : x)),
                      }));
                    }}
                    inputMode="numeric"
                    className="font-mono text-xs"
                  />
                </MiniField>
              </div>
            )}

            <div className="flex items-center justify-between gap-3 border-t border-white/5 pt-2.5">
              <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
                <Switch
                  checked={c.enabled}
                  onCheckedChange={(enabled) =>
                    setForm((f) => ({
                      ...f,
                      clients: f.clients.map((x, j) => (j === i ? { ...x, enabled } : x)),
                    }))
                  }
                  aria-label={t.inbounds.cEnabled}
                />
                {t.inbounds.cEnabled}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setForm((f) => ({
                    ...f,
                    clients: f.clients.filter((_, j) => j !== i),
                  }))
                }
                className="h-7 gap-1 rounded-full px-2.5 text-[11px] text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
              >
                <Trash2 className="h-3 w-3" />
                {t.inbounds.removeClient}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderTransport = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5" role="radiogroup" aria-label={t.inbounds.transportHint}>
        {TRANSPORTS.map((tr) => {
          const meta = TRANSPORT_META[tr] ?? TRANSPORT_META.tcp;
          const TrIcon = meta.icon;
          const selected = form.transport === tr;
          return (
            <button
              key={tr}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setS({ transport: tr })}
              className={cn(
                "group/tr relative flex items-start gap-3 overflow-hidden rounded-2xl border p-3 text-start transition-all duration-200",
                selected
                  ? "border-primary/45 bg-primary/[0.07] shadow-[0_0_26px_-10px_var(--primary)]"
                  : "border-white/10 bg-white/[0.03] hover:border-white/20"
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 transition-colors",
                  selected
                    ? "bg-primary/10 text-primary ring-primary/30"
                    : "bg-white/[0.04] text-muted-foreground ring-white/10 group-hover/tr:text-foreground"
                )}
              >
                <TrIcon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-[12px] font-bold",
                    selected ? "text-primary" : "text-silver"
                  )}
                >
                  {TransportText[tr] ?? tr}
                </span>
                <span className="mt-0.5 block text-[10px] leading-snug text-muted-foreground">
                  {t.inbounds[meta.descKey as keyof typeof t.inbounds]}
                </span>
              </span>
              {selected && (
                <BadgeCheck className="absolute top-2.5 end-2.5 h-3.5 w-3.5 shrink-0 text-primary" />
              )}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground/70">{t.inbounds.transportHint}</p>

      {form.transport === "xhttp" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-xhpath" label={t.inbounds.wsPath}>
            <Input
              id="st-xhpath"
              value={form.stream.path ?? ""}
              onChange={(e) => setStream("path", e.target.value)}
              placeholder={t.inbounds.phWsPath}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-xhhost" label={t.inbounds.wsHost}>
            <Input
              id="st-xhhost"
              value={form.stream.host ?? ""}
              onChange={(e) => setStream("host", e.target.value)}
              placeholder={t.inbounds.phHost}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-xhmode" label={t.inbounds.xhMode}>
            <Select
              value={form.stream.mode || "auto"}
              onValueChange={(v) => setStream("mode", v)}
            >
              <SelectTrigger id="st-xhmode" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong">
                <SelectItem value="auto">{t.inbounds.xhAuto}</SelectItem>
                <SelectItem value="packet-up">{t.inbounds.xhPacket}</SelectItem>
                <SelectItem value="stream-up">{t.inbounds.xhStream}</SelectItem>
                <SelectItem value="stream-one">{t.inbounds.xhOne}</SelectItem>
              </SelectContent>
            </Select>
          </MiniField>
        </div>
      )}

      {form.transport === "tcp" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-tcp" label={t.inbounds.tcpType}>
            <Select
              value={form.stream.headerType === "http" ? "http" : "none"}
              onValueChange={(v) => setStream("headerType", v)}
            >
              <SelectTrigger id="st-tcp" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="glass-strong">
                <SelectItem value="none">{t.inbounds.tcpNone}</SelectItem>
                <SelectItem value="http">{t.inbounds.tcpHttp}</SelectItem>
              </SelectContent>
            </Select>
          </MiniField>
          {form.stream.headerType === "http" && (
            <>
              <MiniField id="st-reqpath" label={t.inbounds.reqPath}>
                <Input
                  id="st-reqpath"
                  value={form.stream.requestPath ?? ""}
                  onChange={(e) => setStream("requestPath", e.target.value)}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </MiniField>
              <MiniField id="st-reqhost" label={t.inbounds.reqHost}>
                <Input
                  id="st-reqhost"
                  value={form.stream.requestHost ?? ""}
                  onChange={(e) => setStream("requestHost", e.target.value)}
                  className="font-mono text-xs"
                  autoComplete="off"
                />
              </MiniField>
            </>
          )}
        </div>
      )}

      {form.transport === "ws" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-wspath" label={t.inbounds.wsPath}>
            <Input
              id="st-wspath"
              value={form.stream.path ?? ""}
              onChange={(e) => setStream("path", e.target.value)}
              placeholder={t.inbounds.phWsPath}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-wshost" label={t.inbounds.wsHost}>
            <Input
              id="st-wshost"
              value={form.stream.host ?? ""}
              onChange={(e) => setStream("host", e.target.value)}
              placeholder={t.inbounds.phHost}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-ed" label="Max early data">
            <Input
              id="st-ed"
              value={form.stream.maxEarlyData ?? ""}
              onChange={(e) => setStream("maxEarlyData", e.target.value)}
              placeholder="2048"
              inputMode="numeric"
              className="font-mono text-xs"
            />
          </MiniField>
          <MiniField id="st-edh" label="Early data header">
            <Input
              id="st-edh"
              value={form.stream.earlyDataHeaderName ?? ""}
              onChange={(e) => setStream("earlyDataHeaderName", e.target.value)}
              placeholder="ed=2048"
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
        </div>
      )}

      {form.transport === "grpc" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-svc" label={t.inbounds.grpcService}>
            <Input
              id="st-svc"
              value={form.stream.serviceName ?? ""}
              onChange={(e) => setStream("serviceName", e.target.value)}
              placeholder={t.inbounds.phGrpc}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-auth" label={t.inbounds.grpcAuthority}>
            <Input
              id="st-auth"
              value={form.stream.authority ?? ""}
              onChange={(e) => setStream("authority", e.target.value)}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground sm:col-span-2">
            <Switch
              checked={form.stream.multiMode === "true"}
              onCheckedChange={(v) => setStream("multiMode", String(v))}
              aria-label={t.inbounds.grpcMulti}
            />
            {t.inbounds.grpcMulti}
          </label>
        </div>
      )}

      {form.transport === "httpupgrade" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MiniField id="st-xup" label={t.inbounds.xuPath}>
            <Input
              id="st-xup"
              value={form.stream.path ?? ""}
              onChange={(e) => setStream("path", e.target.value)}
              placeholder={t.inbounds.phWsPath}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
          <MiniField id="st-xuh" label={t.inbounds.xuHost}>
            <Input
              id="st-xuh"
              value={form.stream.host ?? ""}
              onChange={(e) => setStream("host", e.target.value)}
              placeholder={t.inbounds.phHost}
              className="font-mono text-xs"
              autoComplete="off"
            />
          </MiniField>
        </div>
      )}
      <Tip>
        {form.transport === "tcp"
          ? t.inbounds.tipTcp
          : form.transport === "ws"
            ? t.inbounds.tipWs
            : form.transport === "grpc"
              ? t.inbounds.tipGrpc
              : form.transport === "httpupgrade"
                ? t.inbounds.tipHttpUp
                : t.inbounds.tipXhttp}
      </Tip>
    </div>
  );

  const renderSecurity = () => (
    <div className="space-y-5">
      <SecPicker
        value={form.security}
        onChange={(v) => setS({ security: v })}
        noneLabel={t.inbounds.secNone}
        tlsLabel={t.inbounds.secTls}
        realLabel={t.inbounds.secReal}
        noneDesc={t.inbounds.secNoneDesc}
        tlsDesc={t.inbounds.secTlsDesc}
        realDesc={t.inbounds.secRealDesc}
        hint={t.inbounds.secHint}
      />

      {form.security === "tls" && (
        <div className="space-y-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-silver">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            TLS
          </div>
          <Tip>{t.inbounds.tipTls}</Tip>
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniField id="tls-sni" label={t.inbounds.tlsServerName}>
              <Input
                id="tls-sni"
                value={form.stream.sni ?? ""}
                onChange={(e) => setStream("sni", e.target.value)}
                placeholder={t.inbounds.phSni}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="tls-alpn" label={t.inbounds.alpn} hint={t.inbounds.alpnHint}>
              <Input
                id="tls-alpn"
                value={form.stream.alpn ?? ""}
                onChange={(e) => setStream("alpn", e.target.value)}
                placeholder="h2, http/1.1"
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="tls-fp" label={t.inbounds.fingerprint}>
              <Select
                value={form.stream.fingerprint || "chrome"}
                onValueChange={(v) => setStream("fingerprint", v)}
              >
                <SelectTrigger id="tls-fp" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {FINGERPRINTS.map((f) => (
                    <SelectItem key={f} value={f} className="font-mono text-xs">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MiniField>
            <div className="grid grid-cols-2 gap-3">
              <MiniField id="tls-min" label={t.inbounds.minVer}>
                <Select
                  value={form.stream.minVer || "1.2"}
                  onValueChange={(v) => setStream("minVer", v)}
                >
                  <SelectTrigger id="tls-min" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    {TLS_VERSIONS.filter(Boolean).map((v) => (
                      <SelectItem key={v} value={v} className="font-mono text-xs">
                        TLS {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </MiniField>
              <MiniField id="tls-max" label={t.inbounds.maxVer}>
                <Select
                  value={form.stream.maxVer || "1.3"}
                  onValueChange={(v) => setStream("maxVer", v)}
                >
                  <SelectTrigger id="tls-max" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    {TLS_VERSIONS.filter(Boolean).map((v) => (
                      <SelectItem key={v} value={v} className="font-mono text-xs">
                        TLS {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </MiniField>
            </div>
            <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground sm:col-span-2">
              <Switch
                checked={form.stream.allowInsecure === "true"}
                onCheckedChange={(v) => setStream("allowInsecure", String(v))}
                aria-label={t.inbounds.allowInsecure}
              />
              {t.inbounds.allowInsecure}
            </label>
          </div>

          <div className="space-y-3 border-t border-white/5 pt-3">
            <p className="text-xs font-semibold text-silver">{t.inbounds.certTitle}</p>
            <MiniField id="tls-certpub" label={t.inbounds.certPublic}>
              <Textarea
                id="tls-certpub"
                value={form.stream.certPublic ?? ""}
                onChange={(e) => setStream("certPublic", e.target.value)}
                rows={2}
                className="resize-none font-mono text-[10px]"
              />
            </MiniField>
            <MiniField id="tls-certpriv" label={t.inbounds.certPrivate} hint={t.inbounds.certHint}>
              <Textarea
                id="tls-certpriv"
                value={form.stream.certPrivate ?? ""}
                onChange={(e) => setStream("certPrivate", e.target.value)}
                rows={2}
                className="resize-none font-mono text-[10px]"
              />
            </MiniField>
          </div>
        </div>
      )}

      {form.security === "reality" && (
        <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-silver">
              <Fingerprint className="h-3.5 w-3.5 text-primary" />
              {t.inbounds.realTitle}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const pair = genRealityPair();
                setForm((f) => ({
                  ...f,
                  stream: {
                    ...f.stream,
                    privateKey: pair.priv,
                    publicKey: pair.pub,
                    shortIds: f.stream.shortIds || pair.shortIds,
                  },
                }));
              }}
              className="h-7 gap-1.5 rounded-full border-primary/30 bg-primary/10 px-3 text-[11px] text-primary hover:bg-primary/20"
            >
              <RefreshCcw className="h-3 w-3" />
              {t.inbounds.genKeys}
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniField id="r-dest" label={t.inbounds.realDest}>
              <Input
                id="r-dest"
                value={form.stream.dest ?? ""}
                onChange={(e) => setStream("dest", e.target.value)}
                placeholder={t.inbounds.phDest}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-snames" label={t.inbounds.realServerNames}>
              <Input
                id="r-snames"
                value={form.stream.serverNames ?? ""}
                onChange={(e) => setStream("serverNames", e.target.value)}
                placeholder={t.inbounds.phServerNames}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-short" label={t.inbounds.realShortIds}>
              <Input
                id="r-short"
                value={form.stream.shortIds ?? ""}
                onChange={(e) => setStream("shortIds", e.target.value)}
                placeholder={t.inbounds.phShortIds}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-fp" label={t.inbounds.fingerprint}>
              <Select
                value={form.stream.fingerprint || "chrome"}
                onValueChange={(v) => setStream("fingerprint", v)}
              >
                <SelectTrigger id="r-fp" className="w-full text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-strong">
                  {FINGERPRINTS.map((f) => (
                    <SelectItem key={f} value={f} className="font-mono text-xs">
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </MiniField>
            <MiniField id="r-priv" label={t.inbounds.realPriv}>
              <Input
                id="r-priv"
                value={form.stream.privateKey ?? ""}
                onChange={(e) => setStream("privateKey", e.target.value)}
                className="font-mono text-[11px]"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-pub" label={t.inbounds.realPub}>
              <Input
                id="r-pub"
                value={form.stream.publicKey ?? ""}
                onChange={(e) => setStream("publicKey", e.target.value)}
                className="font-mono text-[11px]"
                autoComplete="off"
              />
            </MiniField>
            <MiniField id="r-spider" label={t.inbounds.realSpider}>
              <Input
                id="r-spider"
                value={form.stream.spiderX ?? ""}
                onChange={(e) => setStream("spiderX", e.target.value)}
                placeholder={t.inbounds.phSpider}
                className="font-mono text-xs"
                autoComplete="off"
              />
            </MiniField>
          </div>
          <Tip>{t.inbounds.tipReality}</Tip>
        </div>
      )}

      {form.security === "none" && (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-white/10 px-4 py-6 text-xs text-muted-foreground">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          {t.inbounds.secHint}
        </div>
      )}
    </div>
  );

  const renderAdvanced = () => (
    <div className="space-y-4">
      {/* sniffing */}
      <div className="space-y-3.5 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-xs font-semibold text-silver">
              <Radar className="h-3.5 w-3.5 text-primary" />
              {t.inbounds.sniffTitle}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {t.inbounds.sniffDesc}
            </p>
          </div>
          <Switch
            checked={form.sniffing.enabled}
            onCheckedChange={(enabled) =>
              setS({ sniffing: { ...form.sniffing, enabled } })
            }
            aria-label={t.inbounds.sniffOn}
          />
        </div>
        <div
          className={cn(
            "grid grid-cols-2 gap-2 transition-opacity sm:grid-cols-4",
            !form.sniffing.enabled && "pointer-events-none opacity-40"
          )}
          role="group"
          aria-label={t.inbounds.destOverride}
        >
          {SNIFF_DESTS.map((d) => {
            const on = form.sniffing.destOverride.includes(d);
            const label =
              d === "http"
                ? t.inbounds.ovHttp
                : d === "tls"
                  ? t.inbounds.ovTls
                  : d === "quic"
                    ? t.inbounds.ovQuic
                    : t.inbounds.ovFake;
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setS({
                    sniffing: {
                      ...form.sniffing,
                      destOverride: on
                        ? form.sniffing.destOverride.filter((x) => x !== d)
                        : [...form.sniffing.destOverride, d],
                    },
                  })
                }
                className={cn(
                  "h-8 rounded-lg border font-mono text-[11px] transition-all",
                  on
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-white/10 bg-white/[0.02] text-muted-foreground hover:border-white/20"
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        <label className="flex cursor-pointer items-start gap-2.5">
          <Switch
            checked={form.sniffing.routeOnly}
            disabled={!form.sniffing.enabled}
            onCheckedChange={(routeOnly) =>
              setS({ sniffing: { ...form.sniffing, routeOnly } })
            }
            aria-label={t.inbounds.routeOnly}
          />
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            <span className="block font-medium text-foreground">{t.inbounds.routeOnly}</span>
            {t.inbounds.routeOnlyDesc}
          </span>
        </label>
      </div>

      {/* mux */}
      <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold text-silver">
            <SlidersHorizontal className="h-3.5 w-3.5 text-primary" />
            Mux
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t.inbounds.muxDesc}</p>
        </div>
        <Switch
          checked={form.mux}
          onCheckedChange={(mux) => setS({ mux })}
          aria-label={t.inbounds.muxOn}
        />
      </div>

      {/* fallbacks */}
      <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
        <div>
          <p className="text-xs font-semibold text-silver">{t.inbounds.fallbacks}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">{t.inbounds.fbHint}</p>
        </div>
        {form.fallbacks.map((fb, i) => (
          <div key={i} className="grid gap-2.5 sm:grid-cols-[1fr_1.2fr_1fr_1fr_auto]">
            <Input
              value={fb.name}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbName}
              className="h-9 text-xs"
              aria-label={t.inbounds.fbName}
            />
            <Input
              value={fb.dest}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, dest: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbDest}
              className="h-9 font-mono text-xs"
              aria-label={t.inbounds.fbDest}
            />
            <Input
              value={fb.alpn}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, alpn: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbAlpn}
              className="h-9 font-mono text-xs"
              aria-label={t.inbounds.fbAlpn}
            />
            <Input
              value={fb.path}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.map((x, j) =>
                    j === i ? { ...x, path: e.target.value } : x
                  ),
                }))
              }
              placeholder={t.inbounds.fbPath}
              className="h-9 font-mono text-xs"
              aria-label={t.inbounds.fbPath}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  fallbacks: f.fallbacks.filter((_, j) => j !== i),
                }))
              }
              className="h-9 w-9 rounded-lg text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
              aria-label={t.inbounds.removeClient}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            setForm((f) => ({
              ...f,
              fallbacks: [...f.fallbacks, { name: "", dest: "", alpn: "", path: "" }],
            }))
          }
          className="gap-1.5 rounded-full border-white/10 bg-white/[0.03] text-xs hover:bg-white/[0.06]"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.inbounds.addFallback}
        </Button>
      </div>

      {/* live JSON preview */}
      <Tip>{t.inbounds.tipJson}</Tip>
      <details className="group rounded-xl border border-white/10 bg-black/30">
        <summary className="cursor-pointer px-4 py-3 text-[11px] font-semibold tracking-wide text-muted-foreground transition-colors hover:text-foreground">
          Xray JSON · preview
        </summary>
        <pre className="max-h-56 overflow-auto border-t border-white/5 px-4 py-3 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {JSON.stringify(
            {
              protocol: form.protocol,
              port: Number(form.port) || 0,
              listen: form.listen || "0.0.0.0",
              settings: {
                clients: form.clients.map((c) => ({ email: c.email, id: c.key, flow: c.flow })),
              },
              streamSettings: {
                network: form.transport,
                security: form.security,
                ...buildStream(form),
              },
              sniffing: form.sniffing,
            },
            null,
            2
          )}
        </pre>
      </details>
    </div>
  );

  const ALL_TABS: { id: TabId; label: string; sub: string; icon: LucideIcon }[] = [
    { id: "general", label: t.inbounds.tabGeneral, sub: t.inbounds.subGeneral, icon: RadioTower },
    { id: "clients", label: t.inbounds.tabClients, sub: t.inbounds.subClients, icon: Users },
    { id: "transport", label: t.inbounds.tabTransport, sub: t.inbounds.subTransport, icon: Network },
    { id: "security", label: t.inbounds.tabSecurity, sub: t.inbounds.subSecurity, icon: ShieldPlus },
    { id: "advanced", label: t.inbounds.tabAdvanced, sub: t.inbounds.subAdvanced, icon: SlidersHorizontal },
  ];
  // dokodemo-door has no client accounts → hide the Clients tab;
  // raw-socket protocols (wg/socks/http/doko) carry no transport/security layers
  const TABS = ALL_TABS.filter((x) => {
    if (form.protocol === "dokodemo-door" && x.id === "clients") return false;
    if (NO_STREAM_PROTOCOLS.has(form.protocol) && (x.id === "transport" || x.id === "security"))
      return false;
    return true;
  });
  // if the active tab vanished (protocol switched), snap back to general
  const activeTab = TABS.some((x) => x.id === tab) ? tab : "general";

  const tabHasError = (id: TabId): boolean =>
    Object.keys(fieldErr).some(
      (k) => FIELD_TAB[k.replace(/-\d+$/, "")] === id || FIELD_TAB[k] === id
    ) || (id === "clients" && dupEmails.size > 0);

  /* ---------- live share-link preview (dialog sidebar) ---------- */
  const previewClient =
    form.clients.find((c) => c.enabled) ?? form.clients[0] ?? null;
  const previewClientDto = previewClient
    ? {
        email: previewClient.email,
        key: previewClient.key,
        flow: previewClient.flow,
        subId: previewClient.subId,
        ipLimit: Number(previewClient.ipLimit) || 0,
        trafficLimitGb: null,
        expiryDays: null,
        enabled: previewClient.enabled,
      }
    : null;
  const previewLink = (() => {
    if (!form.port || !Number(form.port)) return null;
    try {
      const row = {
        id: editing?.id ?? "draft",
        tag: form.tag.trim() || "draft",
        protocol: form.protocol,
        port: Number(form.port) || 0,
        listen: form.listen,
        transport: form.transport,
        security: form.security,
        stream: form.stream,
      };
      if (form.protocol === "wireguard")
        return buildWgConf(row, previewClientDto ?? undefined);
      if (form.protocol === "dokodemo-door") return buildDokoSummary(row);
      return buildShareLink(row, previewClientDto ?? undefined);
    } catch {
      return null;
    }
  })();
  const copyPreview = async () => {
    if (!previewLink) return;
    try {
      await navigator.clipboard.writeText(previewLink);
      toast({ title: t.inbounds.toastCopied });
    } catch {
      toast({ title: t.inbounds.toastFail, variant: "destructive" });
    }
  };
  const hasFieldErrors = Object.keys(fieldErr).length > 0 || dupEmails.size > 0;

  return (
    <div className="space-y-6">
      {/* ── header ─────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-block rounded-full border border-primary/25 bg-primary/8 px-3 py-1 text-[10px] font-bold tracking-[0.18em] text-primary shadow-[0_0_18px_-8px_var(--primary)]">
            {t.inbounds.badge}
          </span>
          <h1 className="text-silver mt-4 text-4xl font-bold tracking-tight md:text-5xl">
            {t.nav.inbounds}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            {t.inbounds.subtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            onClick={openQuick}
            variant="outline"
            className="gap-2 rounded-xl border-primary/30 bg-primary/10 px-4 font-semibold text-primary hover:bg-primary/15"
            title={t.inbounds.quickSub}
          >
            <Zap className="h-4 w-4" />
            {t.inbounds.quickCreate}
          </Button>
          <Button
            onClick={openCreate}
            className="glow-cyan gap-2 rounded-xl px-5 font-semibold shadow-lg shadow-primary/25"
          >
            <Plus className="h-4 w-4" />
            {t.inbounds.new}
          </Button>
        </div>
      </div>

      {/* ── KPI strip ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        <KPI icon={RadioTower} value={String(counts.all)} label={t.inbounds.kpiTotal} trend={t.inbounds.trendWeek} />
        <KPI icon={Wifi} value={String(counts.online)} label={t.inbounds.kpiOnline} trend={t.inbounds.trendUptime} />
        <KPI icon={Users} value={String(totals.users)} label={t.inbounds.kpiUsers} trend={t.inbounds.trendUsers} />
        <KPI
          icon={ArrowLeftRight}
          value={fmtTraffic(totals.traffic)}
          label={t.inbounds.kpiTraffic}
          trend={t.inbounds.trendTraffic}
        />
      </div>

      {/* ── toolbar ────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="glass relative h-10 min-w-0 flex-1 rounded-xl sm:max-w-72">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t.inbounds.searchPh}
            aria-label={t.inbounds.searchPh}
            className="h-full w-full bg-transparent ps-9 pe-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t.nav.inbounds}
        >
          {(
            [
              ["all", t.inbounds.fAll, counts.all],
              ["online", t.inbounds.fOnline, counts.online],
              ["maintenance", t.inbounds.fMaint, counts.maintenance],
              ["disabled", t.inbounds.fDisabled, counts.disabled],
            ] as const
          ).map(([key, label, count]) => {
            const active = statusFilter === key;
            return (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                aria-pressed={active}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-full border px-3.5 text-[12px] font-medium transition-all",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_16px_-6px_var(--primary)]"
                    : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20 hover:text-foreground"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    key === "all" ? "bg-primary" : STATUS_DOT[key]
                  )}
                  aria-hidden="true"
                />
                {label}
                <span
                  className={cn(
                    "rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums",
                    active ? "bg-primary/15" : "bg-white/5"
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
        <div
          className="glass ms-auto flex items-center rounded-full p-1"
          role="group"
          aria-label={t.inbounds.viewGrid}
        >
          {(
            [
              ["grid", t.inbounds.viewGrid, LayoutGrid],
              ["table", t.inbounds.viewTable, Rows3],
            ] as const
          ).map(([mode, label, Icon]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              aria-label={label}
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
                viewMode === mode
                  ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      </div>

      {/* ── load error ─────────────────────────────────────── */}
      {loadErr && rows === null && (
        <div className="glass flex items-center gap-3 rounded-2xl border-chart-5/30 px-5 py-4 text-sm text-chart-5">
          <RadioTower className="h-4 w-4 shrink-0" />
          {t.inbounds.loadFail}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="ms-auto rounded-full"
            aria-label="retry"
          >
            ↻
          </Button>
        </div>
      )}

      {/* ── grid / table / empty / loading ─────────────────── */}
      {rows === null ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="glass h-60 rounded-2xl" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        counts.all === 0 ? (
          <div className="glass hover-glow flex flex-col items-center rounded-3xl px-8 py-14 text-center">
            <span className="glass glow-cyan mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
              <RadioTower className="h-7 w-7 text-primary" />
            </span>
            <h3 className="text-silver text-lg font-bold">{t.inbounds.emptyTitle}</h3>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">{t.inbounds.emptyDesc}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
              <Button
                onClick={openQuick}
                variant="outline"
                className="gap-2 rounded-full border-primary/30 bg-primary/10 px-4 font-semibold text-primary hover:bg-primary/15"
              >
                <Zap className="h-4 w-4" />
                {t.inbounds.quickCreate}
              </Button>
              <Button
                onClick={openCreate}
                className="glow-cyan gap-2 rounded-full px-5 font-semibold"
              >
                <Plus className="h-4 w-4" />
                {t.inbounds.new}
              </Button>
            </div>
          </div>
        ) : (
          <p className="glass rounded-2xl px-5 py-6 text-center text-sm text-muted-foreground">
            {t.inbounds.noMatch}
          </p>
        )
      ) : viewMode === "grid" ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((row, i) => (
            <article
              key={row.id}
              style={{ animationDelay: `${(i % 6) * 70}ms` }}
              className={cn(
                "fade-up group relative flex flex-col gap-3.5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-xl transition-all duration-300",
                PROTO_HOVER[row.protocol] ?? PROTO_HOVER.vless
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute inset-x-0 top-0 h-[3px] opacity-80",
                  PROTO_BAR[row.protocol] ?? PROTO_BAR.vless
                )}
              />
              {/* proto badge + status */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={cn(
                    "rounded-lg px-2.5 py-1 font-mono text-[10px] font-bold tracking-wide ring-1",
                    PROTO_CLS[row.protocol] ?? PROTO_CLS.vless
                  )}
                >
                  {PROTO_LABEL[row.protocol] ?? row.protocol.toUpperCase()}
                </span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      STATUS_DOT[row.status] ?? "bg-muted-foreground",
                      row.status === "online" && "animate-pulse"
                    )}
                    aria-hidden="true"
                  />
                  {StatusText[row.status] ?? row.status}
                </span>
              </div>

              {/* tag + sparkline */}
              <div className="flex items-end justify-between gap-3">
                <h3
                  className="min-w-0 truncate font-mono text-sm font-semibold text-silver"
                  title={row.tag}
                >
                  {row.tag}
                </h3>
                <Sparkline seed={row.tag} color={PROTO_VAR[row.protocol] ?? PROTO_VAR.vless} />
              </div>

              {/* port */}
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-3xl font-bold leading-none tracking-tight text-silver tabular-nums md:text-4xl">
                  {row.port}
                </span>
                <span className="text-[10px] font-semibold tracking-[0.18em] text-muted-foreground/80">
                  PORT
                </span>
                {row.listen && row.listen !== "0.0.0.0" && (
                  <span className="font-mono text-[10px] text-muted-foreground/70">
                    @ {row.listen}
                  </span>
                )}
              </p>

              {/* chips */}
              <div className="flex flex-wrap gap-1.5">
                <Chip>{TransportText[row.transport] ?? row.transport}</Chip>
                <Chip accent={row.security !== "none"}>
                  {SecurityText[row.security] ?? row.security}
                </Chip>
                {(row.clients?.length ?? 0) > 0 && (
                  <Chip>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-2.5 w-2.5" />
                      {row.clients.length}
                    </span>
                  </Chip>
                )}
                {row.trafficLimitGb !== null && <Chip>≤ {fmtTraffic(row.trafficLimitGb)}</Chip>}
                {row.expiryDays !== null && <Chip>{row.expiryDays}d</Chip>}
                {row.note && (
                  <Chip accent>
                    <span className="max-w-40 truncate" title={row.note}>
                      {row.note}
                    </span>
                  </Chip>
                )}
              </div>

              {/* live stats (inset panel) */}
              <div className="mt-auto rounded-xl border border-white/[0.07] bg-black/25 px-4 py-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t.inbounds.usersLabel}
                    </p>
                    <p className="mt-1 font-mono text-lg font-bold leading-none text-silver tabular-nums">
                      {row.users}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t.inbounds.trafficLabel}
                    </p>
                    <p className="mt-1 font-mono text-lg font-bold leading-none text-silver tabular-nums">
                      {fmtTraffic(row.txGb)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <span
                    className={cn(
                      "block h-full rounded-full transition-all duration-700",
                      PROTO_BAR[row.protocol] ?? PROTO_BAR.vless
                    )}
                    style={{
                      width: `${Math.min(100, Math.max(2, Math.round((row.txGb / maxTx) * 100)))}%`,
                    }}
                  />
                </div>
              </div>

              {/* actions */}
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyLink(row)}
                  className="h-8 gap-1.5 rounded-full px-3 text-[11px] text-muted-foreground hover:text-foreground"
                  aria-label={t.inbounds.copyLink}
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t.inbounds.copyLink}</span>
                </Button>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEdit(row)}
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    aria-label={t.inbounds.edit}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={t.inbounds.setStatus}
                      >
                        <EllipsisVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="glass-strong min-w-44">
                      <DropdownMenuLabel className="text-xs text-muted-foreground">
                        {t.inbounds.setStatus}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {STATUSES.map((s) => (
                        <DropdownMenuItem
                          key={s}
                          onClick={() => void setStatus(row, s)}
                          className="flex items-center justify-between gap-2"
                        >
                          <span className="flex items-center gap-2">
                            <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[s])} />
                            {StatusText[s]}
                          </span>
                          {row.status === s && <CircleCheck className="h-3.5 w-3.5 text-primary" />}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleting(row)}
                    className="h-8 w-8 rounded-full text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
                    aria-label={t.inbounds.deleteAction}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        /* ── table view ── */
        <div className="glass overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-white/5 text-start text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblTag}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblProto}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblPort}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblSec}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblClients}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblTraffic}</th>
                <th className="px-4 py-3 text-start font-medium">{t.inbounds.tblStatus}</th>
                <th className="px-4 py-3 text-end font-medium">{t.inbounds.tblActions}</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.03]"
                >
                  <td className="max-w-44 px-4 py-3">
                    <p className="truncate font-mono text-xs font-semibold text-silver">{row.tag}</p>
                    {row.note && (
                      <p className="truncate text-[10px] text-muted-foreground">{row.note}</p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ring-1",
                        PROTO_CLS[row.protocol] ?? PROTO_CLS.vless
                      )}
                    >
                      {PROTO_LABEL[row.protocol] ?? row.protocol.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-silver">{row.port}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {TransportText[row.transport]} · {SecurityText[row.security]}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums">
                    {row.clients?.length ?? 0}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-silver">
                    {fmtTraffic(row.txGb)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          STATUS_DOT[row.status],
                          row.status === "online" && "animate-pulse"
                        )}
                      />
                      {StatusText[row.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => void copyLink(row)}
                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={t.inbounds.copyLink}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(row)}
                        className="h-7 w-7 rounded-full text-muted-foreground hover:text-foreground"
                        aria-label={t.inbounds.edit}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleting(row)}
                        className="h-7 w-7 rounded-full text-muted-foreground hover:bg-chart-5/10 hover:text-chart-5"
                        aria-label={t.inbounds.deleteAction}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── create / edit dialog — Sephiroth Forge ─────────── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="glass-strong flex h-[94dvh] flex-col gap-0 overflow-hidden rounded-2xl border-white/10 p-0 sm:h-[700px] sm:max-h-[92vh] sm:max-w-[1100px]">
          {/* hero header — protocol-reactive glow band */}
          <DialogHeader className="relative shrink-0 overflow-hidden rounded-none border-b border-white/5 p-0 text-start">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_190%_at_0%_0%,color-mix(in_srgb,var(--primary)_16%,transparent),transparent_58%)]"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-16 end-10 h-40 w-40 rounded-full bg-primary/10 blur-3xl"
            />
            <DialogTitle className="relative flex items-center gap-3.5 px-5 py-4 md:px-6">
              <span className="glass glow-cyan relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-primary/25">
                <ProtoOrb protocol={form.protocol} size="lg" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[15px] font-semibold leading-tight text-silver">
                  {editing ? t.inbounds.dialogEdit : t.inbounds.dialogCreate}
                  <Chip accent>{PROTO_LABEL[form.protocol]}</Chip>
                  <Chip>:{form.port || "—"}</Chip>
                </span>
                <DialogDescription className="mt-0.5 block truncate text-[11px] font-normal text-muted-foreground">
                  {t.inbounds.dlgSub}
                </DialogDescription>
              </span>
              <span
                aria-hidden="true"
                className="glass hidden shrink-0 items-center gap-2 rounded-full px-3 py-1.5 font-mono text-[11px] font-bold text-primary/90 ring-1 ring-primary/20 sm:flex"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_1px_var(--primary)]" />
                {composeProto(form.protocol, form.transport, form.security)}
              </span>
            </DialogTitle>
          </DialogHeader>

          {/* mobile step chips (below md) */}
          <div
            className="no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto border-b border-white/5 bg-black/25 px-4 py-2.5 md:hidden"
            role="tablist"
          >
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setTab(id)}
                className={cn(
                  "relative flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-medium transition-all duration-200",
                  activeTab === id
                    ? "bg-primary text-primary-foreground shadow-[0_0_20px_-4px_var(--primary)] ring-1 ring-primary/50"
                    : "bg-white/[0.04] text-muted-foreground ring-1 ring-white/10 hover:bg-white/[0.07] hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {label}
                {tabHasError(id) && (
                  <span className="relative flex h-1.5 w-1.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-5 opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-chart-5" />
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex min-h-0 flex-1">
            {/* step rail — numbered, glow pill, sub-labels */}
            <div
              className="hidden w-56 shrink-0 flex-col gap-1 border-e border-white/5 bg-black/20 p-3 md:flex"
              role="tablist"
            >
              {TABS.map(({ id, label, sub, icon: Icon }, idx) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={activeTab === id}
                  onClick={() => setTab(id)}
                  className={cn(
                    "group/rail relative flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-start transition-all duration-200",
                    activeTab === id
                      ? "bg-primary/15 shadow-[0_0_18px_-6px_var(--primary)] ring-1 ring-primary/30"
                      : "hover:bg-white/[0.04]"
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute top-1/2 start-0 h-6 w-[3px] -translate-y-1/2 rounded-full transition-all duration-200",
                      activeTab === id
                        ? "bg-primary shadow-[0_0_10px_1px_var(--primary)]"
                        : "bg-transparent group-hover/rail:bg-white/15"
                    )}
                  />
                  <span
                    aria-hidden="true"
                    className={cn(
                      "font-mono text-[9px] font-bold tabular-nums",
                      activeTab === id ? "text-primary" : "text-muted-foreground/50"
                    )}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      activeTab === id ? "text-primary" : "text-muted-foreground"
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "block truncate text-[12px] font-semibold leading-tight",
                        activeTab === id ? "text-primary" : "text-muted-foreground group-hover/rail:text-foreground"
                      )}
                    >
                      {label}
                    </span>
                    <span className="block truncate text-[9.5px] leading-tight text-muted-foreground/60">
                      {sub}
                    </span>
                  </span>
                  {tabHasError(id) && (
                    <span className="relative flex h-1.5 w-1.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chart-5 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-chart-5" />
                    </span>
                  )}
                </button>
              ))}

              <div className="mt-auto space-y-2 px-1 pb-1">
                {editing && (
                  <p className="flex items-start gap-1.5 border-t border-white/5 pt-2.5 text-[10px] leading-relaxed text-muted-foreground/70">
                    <BadgeCheck className="mt-px h-3 w-3 shrink-0 text-primary" />
                    <span className="min-w-0 break-all">
                      {editing.tag} · {editing.updatedAt.slice(0, 10)}
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* content — the only scrolling region (outer height is locked) */}
            <div className="min-h-0 flex-1 scroll-smooth overflow-y-auto px-5 py-5 md:px-6 md:py-6">
              {topErr && (
                <p className="mb-4 rounded-xl bg-chart-5/10 px-3.5 py-2.5 text-xs font-medium text-chart-5 ring-1 ring-chart-5/30">
                  {topErr}
                </p>
              )}
              <div key={activeTab} className="tab-swap">
                {activeTab === "general" && renderGeneral()}
                {activeTab === "clients" && renderClients()}
                {activeTab === "transport" && renderTransport()}
                {activeTab === "security" && renderSecurity()}
                {activeTab === "advanced" && renderAdvanced()}
              </div>
            </div>

            {/* live preview sidebar — forge output at a glance */}
            <aside
              className="hidden w-64 shrink-0 flex-col gap-4 overflow-y-auto border-s border-white/5 bg-black/20 p-4 lg:flex"
              aria-label={t.inbounds.pvTitle}
            >
              <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                <Sparkles className="h-3 w-3 text-primary" aria-hidden="true" />
                {t.inbounds.pvTitle}
              </p>

              <div className="glass rounded-2xl p-3.5 ring-1 ring-white/10">
                <div className="flex items-center gap-2.5">
                  <ProtoOrb protocol={form.protocol} size="lg" />
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px] font-bold text-silver">
                      {form.tag.trim() || t.inbounds.pvEmpty}
                    </p>
                    <p
                      dir="ltr"
                      className="truncate font-mono text-[10px] text-primary/90"
                    >
                      {composeProto(form.protocol, form.transport, form.security)}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Chip>:{form.port || "—"}</Chip>
                  {!NO_STREAM_PROTOCOLS.has(form.protocol) && (
                    <Chip>{SecurityText[form.security] ?? form.security}</Chip>
                  )}
                  {!NO_STREAM_PROTOCOLS.has(form.protocol) && (
                    <Chip>{TransportText[form.transport] ?? form.transport}</Chip>
                  )}
                  {form.protocol !== "dokodemo-door" && (
                    <Chip>
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-2.5 w-2.5" aria-hidden="true" />
                        {form.clients.length}
                      </span>
                    </Chip>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  <Link2 className="h-3 w-3 text-primary" aria-hidden="true" />
                  {t.inbounds.pvCopy}
                </p>
                <div className="rounded-xl border border-white/10 bg-black/40 p-2.5">
                  <p
                    dir="ltr"
                    className="break-all font-mono text-[9px] leading-relaxed text-muted-foreground"
                  >
                    {previewLink ?? t.inbounds.pvNoLink}
                  </p>
                </div>
                {previewLink && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void copyPreview()}
                    className="h-7 w-full gap-1.5 rounded-full border-white/10 bg-white/[0.03] text-[11px] hover:bg-white/[0.06]"
                  >
                    <Copy className="h-3 w-3" />
                    {t.inbounds.pvCopy}
                  </Button>
                )}
              </div>

              {hasFieldErrors && (
                <div className="space-y-1.5">
                  {TABS.filter((x) => tabHasError(x.id)).map(({ id, label }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className="flex w-full items-center gap-1.5 rounded-lg bg-chart-5/10 px-2.5 py-1.5 text-start text-[11px] font-medium text-chart-5 ring-1 ring-chart-5/25 transition-colors hover:bg-chart-5/15"
                    >
                      <CircleAlert className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="min-w-0 truncate">{label}</span>
                    </button>
                  ))}
                </div>
              )}
            </aside>
          </div>

          <DialogFooter className="shrink-0 border-t border-white/5 bg-black/25 px-5 py-3.5 md:px-6">
            <div className="flex w-full flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
              {/* live composed-config preview (sm+) */}
              <span className="hidden min-w-0 items-center gap-2 font-mono text-[11px] font-bold text-primary/90 sm:flex">
                <span
                  aria-hidden="true"
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_8px_1px_var(--primary)]"
                />
                <span className="truncate">
                  {composeProto(form.protocol, form.transport, form.security)}
                </span>
              </span>
              <div className="flex w-full gap-2 sm:w-auto">
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                  className="flex-1 rounded-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06] sm:flex-none"
                >
                  {t.inbounds.cancel}
                </Button>
                <Button
                  onClick={() => void save()}
                  disabled={saving}
                  className="glow-cyan min-w-0 flex-1 gap-2 rounded-full font-semibold sm:min-w-32 sm:flex-none"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                  {saving ? t.inbounds.saving : t.inbounds.save}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── quick create dialog (simple-panel mode) ─────────── */}
      <Dialog open={quickOpen} onOpenChange={setQuickOpen}>
        <DialogContent className="glass-strong border-white/10 p-0 sm:max-w-[560px]">
          <DialogHeader className="border-b border-white/5 px-5 py-4 text-start">
            <DialogTitle className="flex items-center gap-3 text-silver">
              <span className="glass flex h-9 w-9 items-center justify-center rounded-xl">
                <Zap className="h-4 w-4 text-primary" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base">{t.inbounds.quickTitle}</span>
                <DialogDescription className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                  {t.inbounds.quickSub}
                </DialogDescription>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 px-5 py-4">
            {/* protocol tiles */}
            <div className="grid grid-cols-3 gap-2">
              {PROTOCOLS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => makeQuickDraft(p)}
                  aria-pressed={quickProto === p}
                  className={cn(
                    "flex h-12 items-center justify-center gap-2 rounded-xl border text-[11px] font-semibold transition-all",
                    quickProto === p
                      ? "border-primary/40 bg-primary/10 text-primary shadow-[0_0_18px_-6px] shadow-primary/40"
                      : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-white/20 hover:text-foreground"
                  )}
                >
                  <Zap className="h-3 w-3" />
                  {PROTO_LABEL[p]}
                </button>
              ))}
            </div>
            <Tip>{t.inbounds.tipProtocol}</Tip>

            {/* what will be created */}
            <div className="rounded-xl border border-white/10 bg-black/25 p-4">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                {t.inbounds.quickWill}
              </p>
              <dl className="mt-3 space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t.inbounds.quickTag}</dt>
                  <dd className="font-mono text-silver">{quickDraft.tag}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">{t.inbounds.quickPort}</dt>
                  <dd className="font-mono text-silver tabular-nums">{quickDraft.port}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">
                    {t.inbounds.fieldTransport} · {t.inbounds.fieldSecurity}
                  </dt>
                  <dd className="font-mono text-silver">
                    {composeProto(
                      quickProto,
                      QUICK_PRESET[quickProto]?.transport ?? "tcp",
                      QUICK_PRESET[quickProto]?.security ?? "none"
                    )}
                  </dd>
                </div>
                {quickProto !== "dokodemo-door" && (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{t.inbounds.quickClient}</dt>
                      <dd className="font-mono text-silver">{quickDraft.email}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{t.inbounds.cId}</dt>
                      <dd
                        className="max-w-56 truncate font-mono text-xs text-muted-foreground"
                        title={quickDraft.key}
                      >
                        {quickDraft.key}
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
          </div>

          <DialogFooter className="border-t border-white/5 px-5 py-3.5">
            <div className="flex w-full items-center justify-between gap-3">
              <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
                {quickBusy ? t.inbounds.saving : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => setQuickOpen(false)}
                  className="rounded-full border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                >
                  {t.inbounds.cancel}
                </Button>
                <Button
                  onClick={() => void runQuickCreate()}
                  disabled={quickBusy}
                  className="glow-cyan min-w-32 gap-2 rounded-full font-semibold"
                >
                  {quickBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  {quickBusy ? t.inbounds.saving : t.inbounds.quickBtn}
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── delete confirm ─────────────────────────────────── */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{t.inbounds.delTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              {lfmt(t.inbounds.delDesc, {
                tag: deleting?.tag ?? "",
                port: String(deleting?.port ?? ""),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              {t.inbounds.cancel}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleteBusy}
              className="rounded-full bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {deleteBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t.inbounds.delete
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
