"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Plus, Ticket, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FEATURE } from "@/lib/i18n/feature-strings";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Task 2-d — Discount codes settings card

   Admin-managed promo codes for the bot shop cart: create
   (code / percentOff / optional Toman cap / usage limit /
   optional expiry), list (code, %off, cap, used/limit, expiry,
   enabled switch), delete. Talks to the admin-guarded
   /api/discount-codes routes; every mutation lands in the
   activity log server-side (discount.created/updated/deleted).
   ============================================================ */

interface DiscountCodeDTO {
  id: string;
  code: string;
  enabled: boolean;
  percentOff: number;
  maxOff: number | null;
  usageLimit: number;
  usedCount: number;
  usedByCount: number;
  expiresAt: string | null;
  createdBy: string;
  createdAt: string;
}

/** {var} interpolation, same helper style as the webhooks card. */
function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? `{${k}}`));
}

export function DiscountCodesCard() {
  const lang = useAppStore((s) => s.lang);
  const fx = FEATURE[lang].discounts;
  const { toast } = useToast();

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [codes, setCodes] = useState<DiscountCodeDTO[]>([]);
  const mounted = useRef(true);

  // create form
  const [code, setCode] = useState("");
  const [percent, setPercent] = useState("");
  const [cap, setCap] = useState("");
  const [usage, setUsage] = useState("0");
  const [expires, setExpires] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/discount-codes", { cache: "no-store" });
      if (!res.ok) throw new Error("load");
      const data = (await res.json()) as { codes: DiscountCodeDTO[] };
      if (mounted.current) {
        setCodes(Array.isArray(data.codes) ? data.codes : []);
        setLoadError(false);
        setLoaded(true);
      }
    } catch {
      if (mounted.current) {
        setLoadError(true);
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);

  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/discount-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.trim(),
          percentOff: percent.trim() === "" ? undefined : Number(percent.trim()),
          maxOff: cap.trim() === "" ? null : Number(cap.trim()),
          usageLimit: usage.trim() === "" ? 0 : Number(usage.trim()),
          expiresAt: expires.trim() === "" ? null : expires.trim(),
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { code: DiscountCodeDTO };
        if (mounted.current && data.code) {
          setCodes((prev) => [data.code, ...prev.filter((c) => c.id !== data.code.id)]);
        }
        setCode("");
        setPercent("");
        setCap("");
        setUsage("0");
        setExpires("");
        toast({ description: fx.createdToast });
      } else {
        const data = (await res.json().catch(() => ({}))) as { fields?: { field: string; code: string }[] };
        const detail = (data.fields ?? []).map((f) => `${f.field}: ${f.code}`).join(" · ");
        toast({ variant: "destructive", description: detail || fx.loadError });
      }
    } catch {
      toast({ variant: "destructive", description: fx.loadError });
    }
    setCreating(false);
  };

  const toggle = async (row: DiscountCodeDTO, enabled: boolean) => {
    // optimistic flip, rolled back on failure
    const prev = codes;
    setCodes((cur) => cur.map((c) => (c.id === row.id ? { ...c, enabled } : c)));
    try {
      const res = await fetch(`/api/discount-codes/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("toggle");
      const data = (await res.json()) as { code: DiscountCodeDTO };
      if (mounted.current && data.code) {
        setCodes((cur) => cur.map((c) => (c.id === row.id ? data.code : c)));
      }
    } catch {
      if (mounted.current) setCodes(prev);
      toast({ variant: "destructive", description: fx.loadError });
    }
  };

  const remove = async (row: DiscountCodeDTO) => {
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/discount-codes/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      if (mounted.current) setCodes((cur) => cur.filter((c) => c.id !== row.id));
      toast({ description: fx.deletedToast });
    } catch {
      toast({ variant: "destructive", description: fx.loadError });
    }
    setDeletingId(null);
  };

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      <div className="flex items-start gap-3">
        <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
          <Ticket className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-base font-bold text-foreground">{fx.title}</h3>
          <p className="max-w-md text-xs text-muted-foreground">{fx.desc}</p>
        </div>
      </div>

      {/* create form */}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="dc-code">{fx.codeLabel}</Label>
          <Input
            id="dc-code"
            dir="ltr"
            className="font-mono uppercase"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={fx.codePh}
            autoComplete="off"
            maxLength={32}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-percent">{fx.percentLabel}</Label>
          <Input
            id="dc-percent"
            dir="ltr"
            inputMode="numeric"
            className="font-mono"
            value={percent}
            onChange={(e) => setPercent(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={fx.percentPh}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-cap">{fx.capLabel}</Label>
          <Input
            id="dc-cap"
            dir="ltr"
            inputMode="numeric"
            className="font-mono"
            value={cap}
            onChange={(e) => setCap(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={fx.capPh}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">{fx.capHint}</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="dc-usage">{fx.usageLabel}</Label>
          <Input
            id="dc-usage"
            dir="ltr"
            inputMode="numeric"
            className="font-mono"
            value={usage}
            onChange={(e) => setUsage(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={fx.usagePh}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">{fx.usageHint}</p>
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="dc-expiry">{fx.expiryLabel}</Label>
          <Input
            id="dc-expiry"
            dir="ltr"
            type="date"
            className="font-mono"
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground">{fx.expiryHint}</p>
        </div>
      </div>
      <div className="mt-4">
        <Button
          onClick={() => void create()}
          disabled={creating || code.trim().length === 0}
          className="min-h-11 gap-2"
        >
          {creating ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Plus className="h-4 w-4" aria-hidden="true" />
          )}
          {creating ? fx.creating : fx.create}
        </Button>
      </div>

      {/* list */}
      <div className="mt-6">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-foreground">{fx.listTitle}</h4>
          {loaded && !loadError && (
            <span className="text-[11px] text-muted-foreground" dir="ltr">
              {codes.length}
            </span>
          )}
        </div>

        {!loaded && (
          <div className="mt-3 text-muted-foreground" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          </div>
        )}

        {loaded && loadError && (
          <p className="mt-3 text-xs text-chart-5" role="alert">
            {fx.loadError}
          </p>
        )}

        {loaded && !loadError && codes.length === 0 && (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {fx.empty}
          </p>
        )}

        {loaded && !loadError && codes.length > 0 && (
          <ul className="mt-3 max-h-96 divide-y divide-border/60 overflow-y-auto pe-1">
            {codes.map((row) => (
              <li
                key={row.id}
                aria-label={fmt(fx.rowAria, { key: row.code })}
                className="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Badge variant="outline" className="shrink-0 font-mono" dir="ltr">
                    {row.code}
                  </Badge>
                  <span className="text-sm font-semibold text-foreground" dir="ltr">
                    {row.percentOff}%
                  </span>
                  <span className="truncate text-xs text-muted-foreground" dir="ltr">
                    {row.maxOff === null ? fx.noCap : row.maxOff.toLocaleString("en-US")}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground md:shrink-0">
                  <span dir="ltr" className="font-mono">
                    {row.usageLimit > 0
                      ? fmt(fx.colUsedFmt, { used: row.usedCount, limit: row.usageLimit })
                      : `${row.usedCount} · ${fx.unlimited}`}
                  </span>
                  <span dir="ltr">
                    {row.expiresAt
                      ? new Date(row.expiresAt).toLocaleDateString(lang, {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        })
                      : fx.never}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
                      row.enabled
                        ? "bg-chart-3/10 text-chart-3 ring-chart-3/30"
                        : "bg-white/[0.04] text-muted-foreground ring-white/10"
                    )}
                  >
                    {row.enabled ? fx.stateOn : fx.stateOff}
                  </span>
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(v) => void toggle(row, v)}
                    aria-label={fmt(fx.rowAria, { key: row.code })}
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0 rounded-full border-border bg-white/4 hover:bg-white/8"
                    onClick={() => void remove(row)}
                    disabled={deletingId === row.id}
                    aria-label={fx.delete}
                  >
                    {deletingId === row.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4 text-chart-5" aria-hidden="true" />
                    )}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
