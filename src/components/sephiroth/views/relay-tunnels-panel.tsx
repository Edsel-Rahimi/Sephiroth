"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Check,
  Loader2,
  Network,
  Plus,
  RotateCw,
  Trash2,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface RelayTunnel {
  id: string;
  name: string;
  mode: string;
  entryNode: string;
  entryAddress: string;
  entryPort: number;
  exitNode: string;
  exitAddress: string;
  exitPort: number;
  inboundTag: string;
  lbStrategy: string;
  enabled: boolean;
  latencyMs: number;
  upBytes: number;
  downBytes: number;
  status: string;
}

export function RelayTunnelsPanel() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang].tunnels, [lang]);
  const { toast } = useToast();

  const [tunnels, setTunnels] = useState<RelayTunnel[]>([]);
  const [loading, setLoading] = useState(true);
  const [probingId, setProbingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name: "",
    mode: "xhttp-reverse",
    entryNode: "Tehran Edge Bridge · Asiatech",
    entryAddress: "ir1.sephiroth.net",
    entryPort: "443",
    exitNode: "Orbit Relay 01 · Frankfurt",
    exitAddress: "de1.sephiroth.net",
    exitPort: "443",
    inboundTag: "vless-main",
    lbStrategy: "least-ping",
  });

  const loadTunnels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tunnels", { cache: "no-store" });
      if (res.ok) {
        const data = (await res.json()) as { items?: RelayTunnel[] };
        setTunnels(data.items ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTunnels();
  }, [loadTunnels]);

  const handleProbe = async (id: string) => {
    setProbingId(id);
    try {
      const res = await fetch("/api/tunnels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "probe", id }),
      });
      if (res.ok) {
        const data = (await res.json()) as { item: RelayTunnel; latencyMs: number };
        setTunnels((prev) => prev.map((tun) => (tun.id === id ? data.item : tun)));
        toast({
          description: t.probeOk.replace("{ms}", String(data.latencyMs)),
        });
      }
    } finally {
      setProbingId(null);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const res = await fetch("/api/tunnels", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, enabled }),
    });
    if (res.ok) {
      const data = (await res.json()) as { item: RelayTunnel };
      setTunnels((prev) => prev.map((tun) => (tun.id === id ? data.item : tun)));
    }
  };

  const handleStrategyChange = async (id: string, lbStrategy: string) => {
    const res = await fetch("/api/tunnels", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, lbStrategy }),
    });
    if (res.ok) {
      const data = (await res.json()) as { item: RelayTunnel };
      setTunnels((prev) => prev.map((tun) => (tun.id === id ? data.item : tun)));
      toast({
        description: t.toastStrategy.replace("{strategy}", lbStrategy),
      });
    }
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/tunnels?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setTunnels((prev) => prev.filter((tun) => tun.id !== id));
      toast({ description: t.toastDeleted });
    }
  };

  const handleCreate = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/tunnels", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          entryPort: Number(form.entryPort) || 443,
          exitPort: Number(form.exitPort) || 443,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { item: RelayTunnel };
        setTunnels((prev) => [...prev, data.item]);
        setOpen(false);
        toast({ description: t.toastCreated });
      } else {
        toast({ variant: "destructive", description: t.toastFailed });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 pt-4 border-t border-white/10">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
            <Network className="h-5 w-5 text-primary" />
          </span>
          <div>
            <h3 className="text-base font-bold text-foreground">{t.title}</h3>
            <p className="text-xs text-muted-foreground">{t.subtitle}</p>
          </div>
        </div>
        <Button onClick={() => setOpen(true)} className="gap-2 rounded-full self-start sm:self-auto">
          <Plus className="h-4 w-4" />
          {t.add}
        </Button>
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="glass h-44 rounded-2xl animate-pulse" />
          <div className="glass h-44 rounded-2xl animate-pulse" />
        </div>
      ) : tunnels.length === 0 ? (
        <div className="glass flex flex-col items-center justify-center gap-2 rounded-2xl p-8 text-center ring-1 ring-white/10">
          <RotateCw className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t.empty}</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {tunnels.map((tun) => (
            <div
              key={tun.id}
              className="glass hover-glow flex flex-col justify-between rounded-2xl p-5 ring-1 ring-white/10"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 rounded-full",
                        tun.enabled ? "bg-chart-3 shadow-[0_0_10px_#34d399]" : "bg-muted-foreground"
                      )}
                    />
                    <h4 className="truncate text-sm font-bold text-foreground">{tun.name}</h4>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-xs text-primary" dir="ltr">
                      {tun.mode.toUpperCase()} · {tun.latencyMs}ms
                    </span>
                    <span
                      className={cn(
                        "text-[10px] font-medium",
                        probingId === tun.id
                          ? "text-primary"
                          : tun.enabled
                            ? "text-chart-3"
                            : "text-muted-foreground"
                      )}
                    >
                      {probingId === tun.id
                        ? t.stTesting
                        : tun.enabled
                          ? t.stActive
                          : t.stInactive}
                    </span>
                    <Switch
                      checked={tun.enabled}
                      onCheckedChange={(v) => void handleToggle(tun.id, v)}
                      aria-label={tun.enabled ? t.stInactive : t.stActive}
                    />
                  </div>
                </div>

                {/* Visual Chain */}
                <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-xl bg-black/25 p-3 ring-1 ring-white/10">
                  <div className="min-w-0">
                    <p className="text-[10px] text-muted-foreground">{t.entryBridge}</p>
                    <p className="truncate text-xs font-semibold text-foreground">{tun.entryNode}</p>
                    <p className="truncate font-mono text-[11px] text-primary" dir="ltr">
                      {tun.entryAddress}:{tun.entryPort}
                    </p>
                  </div>
                  <div className="flex flex-col items-center px-2">
                    <ArrowRight className="h-4 w-4 text-primary rtl:rotate-180" />
                    <span className="mt-0.5 font-mono text-[9px] text-muted-foreground" dir="ltr">
                      {tun.inboundTag}
                    </span>
                  </div>
                  <div className="min-w-0 text-end">
                    <p className="text-[10px] text-muted-foreground">{t.exitUpstream}</p>
                    <p className="truncate text-xs font-semibold text-foreground">{tun.exitNode}</p>
                    <p className="truncate font-mono text-[11px] text-chart-3" dir="ltr">
                      {tun.exitAddress}:{tun.exitPort}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-white/10">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t.lb}</span>
                  <Select
                    value={tun.lbStrategy}
                    onValueChange={(v) => void handleStrategyChange(tun.id, v)}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="glass-strong">
                      <SelectItem value="least-ping">least-ping (Auto)</SelectItem>
                      <SelectItem value="round-robin">round-robin</SelectItem>
                      <SelectItem value="failover">failover (HA)</SelectItem>
                      <SelectItem value="hash-ip">hash-ip (Sticky)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleProbe(tun.id)}
                    disabled={probingId === tun.id}
                    className="h-7 gap-1 rounded-full border-white/10 bg-white/[0.03] px-2.5 text-xs"
                  >
                    {probingId === tun.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Activity className="h-3 w-3 text-primary" />
                    )}
                    {t.probe}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDelete(tun.id)}
                    aria-label={t.del}
                    className="h-7 w-7 rounded-full p-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="glass-strong border-white/10 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-silver">{t.dlgTitle}</DialogTitle>
            <DialogDescription>{t.dlgDesc}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div>
                <Label htmlFor="tun-name">{t.fName}</Label>
                <Input
                  id="tun-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={t.phName}
                />
              </div>
              <div>
                <Label htmlFor="tun-protocol">{t.fProtocol}</Label>
                <Select
                  value={form.mode}
                  onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}
                >
                  <SelectTrigger id="tun-protocol">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    <SelectItem value="xhttp-reverse">XHTTP Reverse Tunnel</SelectItem>
                    <SelectItem value="grpc-mux">gRPC Multiplexed</SelectItem>
                    <SelectItem value="ws-tunnel">WebSocket TLS Tunnel</SelectItem>
                    <SelectItem value="tcp-relay">Dokodemo / TCP Fast-Relay</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-1.5 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="tun-entry-addr">{t.fEntryAddr}</Label>
                <Input
                  id="tun-entry-addr"
                  dir="ltr"
                  value={form.entryAddress}
                  onChange={(e) => setForm((f) => ({ ...f, entryAddress: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="tun-entry-port">{t.fEntryPort}</Label>
                <Input
                  id="tun-entry-port"
                  dir="ltr"
                  value={form.entryPort}
                  onChange={(e) => setForm((f) => ({ ...f, entryPort: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-1.5 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label htmlFor="tun-exit-addr">{t.fExitAddr}</Label>
                <Input
                  id="tun-exit-addr"
                  dir="ltr"
                  value={form.exitAddress}
                  onChange={(e) => setForm((f) => ({ ...f, exitAddress: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="tun-exit-port">{t.fExitPort}</Label>
                <Input
                  id="tun-exit-port"
                  dir="ltr"
                  value={form.exitPort}
                  onChange={(e) => setForm((f) => ({ ...f, exitPort: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid gap-1.5 sm:grid-cols-2">
              <div>
                <Label htmlFor="tun-inbound">{t.fInbound}</Label>
                <Input
                  id="tun-inbound"
                  dir="ltr"
                  value={form.inboundTag}
                  onChange={(e) => setForm((f) => ({ ...f, inboundTag: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="tun-lb">{t.fLb}</Label>
                <Select
                  value={form.lbStrategy}
                  onValueChange={(v) => setForm((f) => ({ ...f, lbStrategy: v }))}
                >
                  <SelectTrigger id="tun-lb">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    <SelectItem value="least-ping">least-ping (Lowest Latency)</SelectItem>
                    <SelectItem value="round-robin">round-robin (Equal Split)</SelectItem>
                    <SelectItem value="failover">failover (Active / Standby)</SelectItem>
                    <SelectItem value="hash-ip">hash-ip (Client IP Affinity)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} className="rounded-full">
              {t.cancel}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={saving} className="gap-2 rounded-full">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {t.create}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
