"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileKey,
  Globe,
  KeyRound,
  Lightbulb,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { sfmt } from "@/lib/i18n/sub-dictionary";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · v2.5 (Task 23-f) — SSL / ACME settings card
   acme.sh status + one-click install, certificate issuance
   (standalone / webroot, staging toggle), managed-cert list
   with expiry badges and a collapsible ACME log viewer.
   Issued material lands in db/certs and is selectable from the
   Forge TLS tab of any inbound (managed-cert picker).
   ============================================================ */

type SslMode = "standalone" | "webroot";

interface SslCertView {
  domain: string;
  paths: { crt: string; key: string };
  issuedAt: string | null;
  notAfter: string | null;
  daysLeft: number | null;
  test: boolean;
  tracked: boolean;
  missing?: boolean;
}

interface SslStatus {
  acmeInstalled: boolean;
  acmeVersion: string | null;
  acmeHome: string;
  certsDir: string;
  certs: SslCertView[];
  lastLog: string[];
  adminEmail: string;
  renewCheck: boolean;
}

function sslErr(code: string | undefined, s: (typeof dictionaries.en.settings)["ssl"]): string {
  switch (code) {
    case "invalid_domain":
      return s.eDomain;
    case "already_tracked":
      return s.eTracked;
    case "acme_not_installed":
      return s.eNotInstalled;
    case "bind_permission":
    case "port_in_use":
    case "invalid_http_port":
      return s.eBind;
    case "challenge_failed":
      return s.eChallenge;
    case "rate_limited":
      return s.eRate;
    default:
      return s.eGeneric;
  }
}

export function SslCard() {
  const lang = useAppStore((s) => s.lang);
  const t = dictionaries[lang];
  const s = t.settings.ssl;
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SslStatus | null>(null);

  const [installing, setInstalling] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [form, setForm] = useState({
    domain: "",
    email: "",
    mode: "standalone" as SslMode,
    webroot: "",
    test: true,
  });
  const [formErr, setFormErr] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [delTarget, setDelTarget] = useState<SslCertView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/system/ssl", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const d = (await res.json()) as SslStatus;
      setStatus(d);
      setForm((p) => ({ ...p, email: p.email || d.adminEmail }));
    } catch {
      setStatus(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const installAcme = async () => {
    setInstalling(true);
    setFormErr(null);
    try {
      const res = await fetch("/api/system/ssl-install-acme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim() || undefined }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setFormErr(d.error === "email_required" ? s.eGeneric : sslErr(d.error, s));
      } else {
        toast({ description: s.statusInstalled });
        await load();
      }
    } catch {
      setFormErr(s.eGeneric);
    }
    setInstalling(false);
  };

  const issue = async () => {
    const domain = form.domain.trim();
    if (!domain) {
      setFormErr(s.eDomain);
      return;
    }
    setIssuing(true);
    setFormErr(null);
    try {
      const res = await fetch("/api/system/ssl-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          domain,
          email: form.email.trim() || undefined,
          mode: form.mode,
          webroot: form.mode === "webroot" ? form.webroot.trim() : undefined,
          test: form.test,
        }),
      });
      const d = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !d.ok) {
        setFormErr(sslErr(d.error, s));
      } else {
        toast({ description: s.issuedOk });
        setForm((p) => ({ ...p, domain: "" }));
        await load();
      }
    } catch {
      setFormErr(s.eGeneric);
    }
    setIssuing(false);
  };

  const toggleRenew = async (v: boolean) => {
    setStatus((p) => (p ? { ...p, renewCheck: v } : p));
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "ssl", renewCheck: v }),
      });
    } catch {
      await load();
    }
  };

  const removeCert = async () => {
    if (!delTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/system/ssl?domain=${encodeURIComponent(delTarget.domain)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("del");
      toast({ description: s.deleted });
      await load();
    } catch {
      setFormErr(s.eGeneric);
    }
    setDeleting(false);
    setDelTarget(null);
  };

  const daysBadge = (days: number | null): string => {
    if (days === null) return "bg-muted/10 text-muted-foreground ring-border";
    if (days < 10) return "bg-chart-5/10 text-chart-5 ring-chart-5/30";
    if (days < 30) return "bg-amber-400/10 text-amber-400 ring-amber-400/30";
    return "bg-emerald-400/10 text-emerald-400 ring-emerald-400/30";
  };

  return (
    <section className="glass rounded-2xl p-5 md:p-6 lg:col-span-2" aria-label={s.cardTitle}>
      <div className="mb-4 flex items-start gap-3">
        <span className="glass flex h-9 w-9 shrink-0 items-center justify-center rounded-xl">
          <FileKey className="h-4 w-4 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{s.cardTitle}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{s.cardDesc}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="ms-auto h-8 shrink-0 gap-1.5 rounded-full border-border bg-white/4 px-3 text-[11px] hover:bg-white/8"
          aria-label={t.nodes.refresh}
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} aria-hidden="true" />
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-2">
          <div className="h-10 animate-pulse rounded-xl bg-white/[0.04]" />
          <div className="h-24 animate-pulse rounded-xl bg-white/[0.04]" />
        </div>
      ) : !status ? (
        <p className="flex items-center gap-2 rounded-lg bg-chart-5/10 px-2.5 py-2 text-xs text-chart-5 ring-1 ring-chart-5/30">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {s.eGeneric}
        </p>
      ) : (
        <div className="space-y-4">
          {/* acme.sh status strip */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white/[0.03] px-4 py-3 ring-1 ring-border/70">
            <span
              className={cn(
                "relative inline-flex h-2.5 w-2.5 shrink-0 rounded-full",
                status.acmeInstalled ? "bg-emerald-400" : "bg-chart-5"
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1",
                status.acmeInstalled
                  ? "bg-emerald-400/10 text-emerald-400 ring-emerald-400/30"
                  : "bg-chart-5/10 text-chart-5 ring-chart-5/30"
              )}
            >
              {status.acmeInstalled ? s.statusInstalled : s.statusMissing}
            </span>
            {status.acmeVersion && (
              <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                {status.acmeVersion}
              </span>
            )}
            {!status.acmeInstalled && (
              <Button
                size="sm"
                onClick={() => void installAcme()}
                disabled={installing}
                className="ms-auto gap-2"
              >
                {installing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {installing ? s.installing : s.installBtn}
              </Button>
            )}
          </div>

          {/* issue form */}
          <div className="space-y-3 rounded-xl bg-white/[0.02] p-4 ring-1 ring-border/50">
            <p className="flex items-center gap-2 text-xs font-semibold text-silver">
              <KeyRound className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {s.issueTitle}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ssl-domain" className="text-xs text-muted-foreground">
                  {s.domain}
                </Label>
                <Input
                  id="ssl-domain"
                  dir="ltr"
                  className="font-mono text-xs"
                  autoComplete="off"
                  value={form.domain}
                  onChange={(e) => setForm((p) => ({ ...p, domain: e.target.value }))}
                  placeholder={s.domainPh}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ssl-email" className="text-xs text-muted-foreground">
                  {s.email}
                </Label>
                <Input
                  id="ssl-email"
                  dir="ltr"
                  type="email"
                  className="font-mono text-xs"
                  autoComplete="off"
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  placeholder="admin@example.com"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ssl-mode" className="text-xs text-muted-foreground">
                  {s.mode}
                </Label>
                <Select
                  value={form.mode}
                  onValueChange={(v) => setForm((p) => ({ ...p, mode: v as SslMode }))}
                >
                  <SelectTrigger id="ssl-mode" className="w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    <SelectItem value="standalone" className="text-xs">
                      {s.modeStandalone}
                    </SelectItem>
                    <SelectItem value="webroot" className="text-xs">
                      {s.modeWebroot}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground/70">
                  {form.mode === "standalone" ? s.modeStandaloneDesc : s.modeWebrootDesc}
                </p>
              </div>
              {form.mode === "webroot" && (
                <div className="space-y-1.5">
                  <Label htmlFor="ssl-webroot" className="text-xs text-muted-foreground">
                    {s.webroot}
                  </Label>
                  <Input
                    id="ssl-webroot"
                    dir="ltr"
                    className="font-mono text-xs"
                    autoComplete="off"
                    value={form.webroot}
                    onChange={(e) => setForm((p) => ({ ...p, webroot: e.target.value }))}
                    placeholder={s.webrootPh}
                  />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <label className="flex cursor-pointer items-center gap-2.5 text-xs text-muted-foreground">
                <Switch
                  checked={form.test}
                  onCheckedChange={(v) => setForm((p) => ({ ...p, test: v }))}
                  aria-label={s.testToggle}
                />
                {s.testToggle}
              </label>
              <Button onClick={() => void issue()} disabled={issuing} className="gap-2">
                {issuing ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                )}
                {issuing ? s.issuing : s.issueBtn}
              </Button>
            </div>
            {form.test && (
              <p className="text-[11px] leading-relaxed text-muted-foreground/70">{s.testHint}</p>
            )}
            {formErr && (
              <p
                className="flex items-start gap-1.5 rounded-lg bg-chart-5/10 px-2.5 py-2 text-xs text-chart-5 ring-1 ring-chart-5/30"
                dir="auto"
              >
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{formErr}</span>
              </p>
            )}
          </div>

          {/* managed cert list */}
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-xs font-semibold text-silver">
              <Globe className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              {s.certsTitle}
            </p>
            {status.certs.length === 0 ? (
              <p className="rounded-xl bg-white/[0.02] px-3.5 py-3 text-xs text-muted-foreground ring-1 ring-border/50">
                {s.certEmpty}
              </p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {status.certs.map((c) => (
                  <li
                    key={c.domain}
                    className="flex flex-wrap items-center gap-2 rounded-xl bg-white/[0.02] px-3.5 py-2.5 ring-1 ring-border/50"
                  >
                    <span className="min-w-0 truncate font-mono text-xs text-foreground" dir="ltr">
                      {c.domain}
                    </span>
                    {c.test && (
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30">
                        {s.testBadge}
                      </span>
                    )}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1",
                        daysBadge(c.daysLeft)
                      )}
                    >
                      {c.daysLeft !== null ? sfmt(s.daysLeft, { d: c.daysLeft }) : "—"}
                    </span>
                    <span
                      className="ms-auto hidden max-w-[220px] truncate font-mono text-[10px] text-muted-foreground sm:block"
                      dir="ltr"
                      title={c.paths.crt}
                    >
                      {c.paths.crt}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDelTarget(c)}
                      disabled={deleting}
                      className="h-7 shrink-0 rounded-full border-border bg-white/4 px-2.5 hover:bg-chart-5/15"
                      aria-label={`${s.delBtn} ${c.domain}`}
                    >
                      <Trash2 className="h-3 w-3 text-chart-5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-white/[0.02] px-3.5 py-2.5 ring-1 ring-border/50">
              <span className="min-w-0">
                <span className="block text-xs font-medium text-foreground">{s.renewCheck}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {s.renewCheckDesc}
                </span>
              </span>
              <Switch
                checked={status.renewCheck}
                onCheckedChange={(v) => void toggleRenew(v)}
                aria-label={s.renewCheck}
              />
            </label>
          </div>

          {/* collapsible ACME log */}
          <div className="rounded-xl bg-white/[0.02] ring-1 ring-border/50">
            <button
              type="button"
              onClick={() => setLogOpen((v) => !v)}
              aria-expanded={logOpen}
              className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex items-center gap-2">
                <Terminal className="h-3.5 w-3.5 text-primary/80" aria-hidden="true" />
                {s.logTitle}
              </span>
              {logOpen ? (
                <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
            {logOpen && (
              <div className="border-t border-border/50 px-3.5 py-3">
                {status.lastLog.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">{s.logEmpty}</p>
                ) : (
                  <pre
                    dir="ltr"
                    className="max-h-64 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground/90"
                  >
                    {status.lastLog.join("\n")}
                  </pre>
                )}
              </div>
            )}
          </div>

          <p
            className="flex items-start gap-1.5 rounded-lg bg-primary/[0.04] px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground ring-1 ring-primary/10"
            dir="auto"
          >
            <Lightbulb className="mt-0.5 h-3 w-3 shrink-0 text-primary/80" aria-hidden="true" />
            <span>{s.tip}</span>
          </p>
        </div>
      )}

      {/* delete confirm */}
      <AlertDialog open={delTarget !== null} onOpenChange={(v) => !v && setDelTarget(null)}>
        <AlertDialogContent className="glass-strong">
          <AlertDialogHeader>
            <AlertDialogTitle>{s.delTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {s.delDesc}
              {delTarget && (
                <span className="mt-2 block font-mono text-xs text-foreground" dir="ltr">
                  {delTarget.domain}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.subgroups.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void removeCert();
              }}
              className="bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : s.delBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
