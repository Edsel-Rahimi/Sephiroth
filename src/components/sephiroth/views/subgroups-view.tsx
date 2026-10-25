"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  FolderPlus,
  KeyRound,
  Layers,
  Lightbulb,
  Link2,
  LockOpen,
  Search,
  SquarePen,
  Trash2,
  Users as UsersIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { useAppStore } from "@/lib/store/app-store";
import { dictionaries } from "@/lib/i18n/dictionaries";
import type { GroupDTO } from "@/lib/sub-groups";
import type { UserDTO } from "@/lib/user-types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · Phase 5 — Sub Groups view (admin)
   Bundles panel users onto one public /sub/[token] page.
   Cards carry token copy + public-link preview; the dialog edits
   identity (name/info line/password) and the member set. Every
   section carries a plain-language tip; all strings come from
   the 6-language dictionary (subgroups section).
   ============================================================ */

interface GrpForm {
  name: string;
  infoLine: string;
  password: string;
  clearPassword: boolean;
  enabled: boolean;
  memberIds: Set<string>;
}

const EMPTY_FORM: GrpForm = {
  name: "",
  infoLine: "",
  password: "",
  clearPassword: false,
  enabled: true,
  memberIds: new Set<string>(),
};

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

function avatarColor(seed: string): string {
  const palette = [
    "bg-primary/20 text-primary",
    "bg-[#8b8cf8]/20 text-[#8b8cf8]",
    "bg-chart-3/20 text-chart-3",
    "bg-chart-4/20 text-chart-4",
    "bg-[#c084fc]/20 text-[#c084fc]",
    "bg-[#f472b6]/20 text-[#f472b6]",
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

/* ============================================================ */

export function SubGroupsView() {
  const lang = useAppStore((s) => s.lang);
  const t = useMemo(() => dictionaries[lang], [lang]);
  const u = t.subgroups;

  const { toast } = useToast();

  const [groups, setGroups] = useState<GroupDTO[] | null>(null);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [loadErr, setLoadErr] = useState(false);
  const [origin, setOrigin] = useState("");

  /* toolbar */
  const [q, setQ] = useState("");

  /* dialog */
  const [dlgOpen, setDlgOpen] = useState(false);
  const [editing, setEditing] = useState<GroupDTO | null>(null);
  const [form, setForm] = useState<GrpForm>(EMPTY_FORM);
  const [fieldErr, setFieldErr] = useState<Partial<Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [memberQ, setMemberQ] = useState("");

  /* delete */
  const [deleting, setDeleting] = useState<GroupDTO | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const load = useCallback(async () => {
    try {
      const [gr, ur] = await Promise.all([
        fetch("/api/sub/groups", { cache: "no-store" }),
        fetch("/api/users", { cache: "no-store" }),
      ]);
      if (!gr.ok || !ur.ok) throw new Error("load");
      const gj = (await gr.json()) as { groups: GroupDTO[] };
      const uj = (await ur.json()) as { users: UserDTO[] };
      setGroups(gj.groups);
      setUsers(uj.users);
      setLoadErr(false);
    } catch {
      setGroups([]);
      setLoadErr(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* ---------- derived ---------- */

  const userById = useMemo(() => {
    const m = new Map<string, UserDTO>();
    for (const x of users) m.set(x.id, x);
    return m;
  }, [users]);

  const kpis = useMemo(() => {
    const list = groups ?? [];
    const members = new Set<string>();
    for (const g of list) for (const id of g.memberIds) members.add(id);
    return {
      groups: list.length,
      members: members.size,
      protected: list.filter((g) => g.hasPassword).length,
    };
  }, [groups]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = [...(groups ?? [])];
    if (needle) {
      list = list.filter(
        (g) =>
          g.name.toLowerCase().includes(needle) ||
          g.token.includes(needle) ||
          g.memberIds.some((id) => (userById.get(id)?.username ?? "").toLowerCase().includes(needle))
      );
    }
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [groups, q, userById]);

  const memberCandidates = useMemo(() => {
    const needle = memberQ.trim().toLowerCase();
    return users.filter((x) => !needle || x.username.toLowerCase().includes(needle));
  }, [users, memberQ]);

  /* ---------- actions ---------- */

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setMemberQ("");
    setFieldErr({});
    setDlgOpen(true);
  };

  const openEdit = (g: GroupDTO) => {
    setEditing(g);
    setForm({
      name: g.name,
      infoLine: g.infoLine ?? "",
      password: "",
      clearPassword: false,
      enabled: g.enabled,
      memberIds: new Set(g.memberIds),
    });
    setMemberQ("");
    setFieldErr({});
    setDlgOpen(true);
  };

  const toggleMember = (id: string) => {
    setForm((f) => {
      const next = new Set(f.memberIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { ...f, memberIds: next };
    });
  };

  const save = async () => {
    setSaving(true);
    setFieldErr({});
    const name = form.name.trim();
    if (name.length < 1 || name.length > 48) {
      setFieldErr({ name: u.errName });
      setSaving(false);
      return;
    }
    if (form.password && form.password.length < 4) {
      setFieldErr({ password: u.pwShort });
      setSaving(false);
      return;
    }
    try {
      const payload: Record<string, unknown> = {
        name,
        infoLine: form.infoLine.trim(),
        enabled: form.enabled,
        memberIds: [...form.memberIds],
      };
      if (form.clearPassword) payload.clearPassword = true;
      else if (form.password) payload.password = form.password;

      const res = await fetch(editing ? `/api/sub/groups/${editing.id}` : "/api/sub/groups", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.status === 400) {
        const j = (await res.json()) as { fields?: { field: string; code: string }[] };
        const map: Partial<Record<string, string>> = {};
        for (const f of j.fields ?? []) map[f.field] = f.code === "short" ? u.pwShort : u.errName;
        setFieldErr(map);
        setSaving(false);
        return;
      }
      if (!res.ok) throw new Error("save");
      await load();
      setDlgOpen(false);
      toast({
        description: editing ? u.toastUpdated : `${u.toastCreated} · ${name}`,
      });
    } catch {
      setFieldErr({ name: u.errName });
    }
    setSaving(false);
  };

  const destroy = async (g: GroupDTO) => {
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/sub/groups/${g.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete");
      setGroups((prev) => (prev ?? []).filter((x) => x.id !== g.id));
      setDeleting(null);
      toast({ description: `${u.toastDeleted} · ${g.name}` });
    } catch {
      setDeleting(null);
    }
    setDeleteBusy(false);
  };

  const toggleEnabled = async (g: GroupDTO, enabled: boolean) => {
    setGroups((prev) => (prev ?? []).map((x) => (x.id === g.id ? { ...x, enabled } : x)));
    try {
      await fetch(`/api/sub/groups/${g.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setGroups((prev) => (prev ?? []).map((x) => (x.id === g.id ? { ...x, enabled: !enabled } : x)));
    }
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* noop */
    }
    toast({ description: label });
  };

  const publicLinkOf = (g: GroupDTO) => `${origin}/sub/${g.token}`;

  const loading = groups === null;

  /* ---------- render ---------- */

  return (
    <div className="fade-up space-y-6">
      {/* header */}
      <section className="space-y-2">
        <span className="glass inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold tracking-[0.22em] text-primary/90 ring-1 ring-primary/20">
          <Layers className="h-3 w-3" aria-hidden="true" />
          {u.badge}
        </span>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-silver text-3xl font-bold tracking-tight md:text-4xl">{t.nav.subgroups}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{u.subtitle}</p>
          </div>
          <Button onClick={openCreate} className="glow-cyan gap-2" aria-label={u.new}>
            <FolderPlus className="h-4 w-4" aria-hidden="true" />
            {u.new}
          </Button>
        </div>
      </section>

      {/* KPI row */}
      <section className="grid grid-cols-3 gap-3" aria-label={u.kpiGroups}>
        {[
          { label: u.kpiGroups, value: kpis.groups, icon: Layers, cls: "text-primary" },
          { label: u.kpiMembers, value: kpis.members, icon: UsersIcon, cls: "text-chart-3" },
          { label: u.kpiProtected, value: kpis.protected, icon: KeyRound, cls: "text-chart-4" },
        ].map(({ label, value, icon: Icon, cls }) => (
          <div key={label} className="glass rounded-2xl p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
              <span className={cn("glass flex h-7 w-7 items-center justify-center rounded-lg ring-1 ring-white/10", cls)}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </div>
            <p className="mt-1.5 font-mono text-2xl font-bold text-foreground md:text-3xl">{value}</p>
          </div>
        ))}
      </section>

      {/* search */}
      <section className="relative max-w-md">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={u.searchPh}
          className="h-10 ps-9"
          aria-label={u.searchPh}
        />
      </section>
      <Tip>{u.tipGroups}</Tip>

      {/* list */}
      {loading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-52 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center ring-1 ring-white/10">
          <Layers className="mx-auto h-10 w-10 text-muted-foreground/50" aria-hidden="true" />
          <p className="mt-4 text-sm font-semibold text-foreground">{u.empty}</p>
          <p className="mt-1 text-xs text-muted-foreground">{u.emptyDesc}</p>
        </div>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {filtered.map((g) => (
            <li
              key={g.id}
              className={cn(
                "glass hover-glow relative overflow-hidden rounded-2xl p-5 ring-1 ring-white/10",
                !g.enabled && "opacity-60"
              )}
            >
              <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent" />
              {/* name + protection */}
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-white/10",
                      avatarColor(g.token)
                    )}
                  >
                    <Layers className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-foreground">{g.name}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <CalendarDays className="h-3 w-3" aria-hidden="true" />
                      {u.memberSince} {new Date(g.createdAt).toLocaleDateString(lang)}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1",
                    g.hasPassword
                      ? "ring-chart-4/40 bg-chart-4/10 text-chart-4"
                      : "ring-chart-3/40 bg-chart-3/10 text-chart-3"
                  )}
                >
                  <KeyRound className="h-3 w-3" aria-hidden="true" />
                  {g.hasPassword ? u.pwProtected : u.pwOpen}
                </span>
              </div>

              {/* token */}
              <div className="mt-3.5">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{u.colToken}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-primary/90 ring-1 ring-white/10">
                    {g.token}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText(g.token, u.colToken)}
                    aria-label={u.colToken}
                    className="h-8 border-white/10 bg-white/[0.03] px-2 text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {/* members */}
              <div className="mt-3.5">
                <p className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  <span>{u.colMembers}</span>
                  <span className="font-mono text-primary">{g.memberIds.length}</span>
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {g.memberIds.length === 0 ? (
                    <span className="text-[11px] text-muted-foreground/70">{u.noMembers}</span>
                  ) : (
                    g.memberIds.slice(0, 6).map((id) => {
                      const usr = userById.get(id);
                      return (
                        <span
                          key={id}
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                            usr
                              ? usr.enabled
                                ? "ring-chart-3/30 bg-chart-3/10 text-chart-3"
                                : "ring-border bg-muted/40 text-muted-foreground"
                              : "ring-border bg-muted/40 text-muted-foreground"
                          )}
                        >
                          {usr?.username ?? id.slice(0, 8)}
                        </span>
                      );
                    })
                  )}
                  {g.memberIds.length > 6 && (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-muted-foreground ring-1 ring-white/10">
                      +{g.memberIds.length - 6}
                    </span>
                  )}
                </div>
              </div>

              {/* info line */}
              {g.infoLine && (
                <p className="mt-3 truncate rounded-lg bg-primary/[0.06] px-2.5 py-1.5 text-[11px] text-primary/85 ring-1 ring-primary/15">
                  {g.infoLine}
                </p>
              )}

              {/* actions */}
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/5 pt-3.5">
                <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground">
                  <Switch checked={g.enabled} onCheckedChange={(v) => void toggleEnabled(g, v)} aria-label={u.enabled} />
                  {u.enabled}
                </label>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(publicLinkOf(g), "_blank")}
                    aria-label={u.preview}
                    title={u.preview}
                    className="h-8 gap-1.5 border-primary/25 bg-primary/10 px-2.5 text-[11px] text-primary hover:bg-primary/15 hover:text-primary"
                  >
                    <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="hidden sm:inline">{u.preview}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyText(publicLinkOf(g), u.copyLink)}
                    aria-label={u.copyLink}
                    className="h-8 border-white/10 bg-white/[0.03] px-2 text-muted-foreground hover:text-foreground"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(g)}
                    aria-label={u.dlgEdit}
                    className="h-8 border-white/10 bg-white/[0.03] px-2 text-muted-foreground hover:text-foreground"
                  >
                    <SquarePen className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDeleting(g)}
                    aria-label={u.delTitle}
                    className="h-8 border-chart-5/25 bg-chart-5/10 px-2 text-chart-5 hover:bg-chart-5/15 hover:text-chart-5"
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ---------------- create / edit dialog ---------------- */}
      <Dialog open={dlgOpen} onOpenChange={setDlgOpen}>
        <DialogContent className="glass-strong max-h-[85vh] max-w-lg overflow-y-auto border-white/10">
          <DialogHeader>
            <DialogTitle className="text-silver text-lg font-bold">
              {editing ? u.dlgEdit : u.dlgCreate}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {u.membersHint}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            {/* identity */}
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/90">{u.secIdentity}</p>
              <div className="space-y-1.5">
                <Label htmlFor="grp-name" className="text-xs text-muted-foreground">
                  {u.fieldGroup}
                </Label>
                <Input
                  id="grp-name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder={u.phGroup}
                  maxLength={48}
                  className="h-10"
                />
                {fieldErr.name && <p className="text-[11px] text-chart-5">{fieldErr.name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grp-info" className="text-xs text-muted-foreground">
                  {u.fieldInfo}
                </Label>
                <Input
                  id="grp-info"
                  value={form.infoLine}
                  onChange={(e) => setForm((f) => ({ ...f, infoLine: e.target.value }))}
                  placeholder={u.phInfo}
                  maxLength={200}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grp-pw" className="text-xs text-muted-foreground">
                  {u.fieldPassword}
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="grp-pw"
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value, clearPassword: false }))}
                    placeholder={editing && editing.hasPassword ? u.pwKeep : u.phPassword}
                    className="h-10"
                    autoComplete="new-password"
                  />
                  {editing && editing.hasPassword && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setForm((f) => ({ ...f, password: "", clearPassword: !f.clearPassword }))
                      }
                      aria-pressed={form.clearPassword}
                      className={cn(
                        "h-10 shrink-0 gap-1.5 text-[11px]",
                        form.clearPassword
                          ? "border-chart-5/40 bg-chart-5/10 text-chart-5"
                          : "border-white/10 bg-white/[0.03] text-muted-foreground"
                      )}
                    >
                      <LockOpen className="h-3.5 w-3.5" aria-hidden="true" />
                      {u.pwClear}
                    </Button>
                  )}
                </div>
                {fieldErr.password && <p className="text-[11px] text-chart-5">{fieldErr.password}</p>}
              </div>
              <Tip>{u.tipIdentity}</Tip>
            </div>

            {/* members */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-primary/90">{u.secMembers}</p>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm((f) => ({ ...f, memberIds: new Set(users.map((x) => x.id)) }))}
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {u.selectAll}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setForm((f) => ({ ...f, memberIds: new Set() }))}
                    className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    {u.clearAll}
                  </Button>
                </div>
              </div>
              <div className="relative">
                <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={memberQ}
                  onChange={(e) => setMemberQ(e.target.value)}
                  placeholder={u.searchPh}
                  className="h-9 ps-9 text-xs"
                  aria-label={u.searchPh}
                />
              </div>
              <Tip>{u.tipMembers}</Tip>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl bg-black/20 p-2 ring-1 ring-white/10">
                {memberCandidates.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">{u.noMembers}</p>
                ) : (
                  memberCandidates.map((usr) => (
                    <div
                      key={usr.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleMember(usr.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleMember(usr.id);
                        }
                      }}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors",
                        form.memberIds.has(usr.id) ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-white/5"
                      )}
                    >
                      <Checkbox checked={form.memberIds.has(usr.id)} aria-hidden="true" tabIndex={-1} className="pointer-events-none" />
                      <span
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                          avatarColor(usr.username)
                        )}
                      >
                        {usr.username.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium text-foreground">{usr.username}</span>
                        <span className="block font-mono text-[9px] text-muted-foreground">
                          {usr.accesses.length} · {usr.subId.slice(0, 8)}
                        </span>
                      </span>
                      {form.memberIds.has(usr.id) && (
                        <Check className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                      )}
                    </div>
                  ))
                )}
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                {form.memberIds.size} {u.colMembers.toLowerCase()}
              </p>
            </div>

            {/* token tip */}
            {editing && <Tip>{u.tipToken}</Tip>}

            {/* actions */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setDlgOpen(false)} className="h-10 border-white/10 bg-white/[0.03]">
                {u.cancel}
              </Button>
              <Button onClick={() => void save()} disabled={saving} className="glow-cyan h-10 gap-2 bg-primary/90 font-semibold text-black hover:bg-primary">
                {saving ? <Check className="h-4 w-4 animate-pulse" aria-hidden="true" /> : <FolderPlus className="h-4 w-4" aria-hidden="true" />}
                {u.save}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-silver">{u.delTitle}</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed text-muted-foreground">
              {u.delDesc}
              {deleting && <span className="mt-2 block font-mono text-[11px] text-primary/80">· {deleting.name}</span>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-white/[0.03]">{u.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && void destroy(deleting)}
              disabled={deleteBusy}
              className="bg-chart-5/90 text-white hover:bg-chart-5"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
