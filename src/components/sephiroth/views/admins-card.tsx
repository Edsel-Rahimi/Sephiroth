"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Loader2,
  Plus,
  Power,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { FEATURE } from "@/lib/i18n/feature-strings";
import { sfmt } from "@/lib/i18n/sub-dictionary";
import type { Lang } from "@/lib/i18n/dictionaries";
import { useAppStore } from "@/lib/store/app-store";
import { useRole } from "@/hooks/use-role";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/* ============================================================
   Sephiroth · task 3-b — Administrators card (owner-only)

   Multi-admin RBAC management backed by /api/admins (owner-only
   API). Role matrix implemented server-side and mirrored here:
     owner  = everything + admin management + dangerous wipes
     admin  = everything except owner-only actions
     viewer = READ-ONLY (GET/HEAD only — mutations reject 403)
   For non-owners the card renders an honest note instead of the
   management UI (the API would reject them anyway). The server
   stays the source of truth — this card is convenience, not the
   security boundary.
   ============================================================ */

type AdminRole = "owner" | "admin" | "viewer";

interface AdminDTO {
  id: string;
  username: string;
  role: AdminRole;
  enabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  isSelf?: boolean;
}

const LOCALE_TAG: Record<Lang, string> = {
  en: "en-US",
  fa: "fa-IR",
  ar: "ar",
  zh: "zh-CN",
  tr: "tr-TR",
  ru: "ru-RU",
};

const ROLE_BADGE: Record<AdminRole, string> = {
  owner: "border-primary/40 bg-primary/10 text-primary",
  admin: "border-chart-3/40 bg-chart-3/10 text-chart-3",
  viewer: "border-border bg-white/[0.04] text-muted-foreground",
};

export function AdminsCard() {
  const lang = useAppStore((s) => s.lang);
  const role = useRole();
  const isOwner = role === "owner";
  const fx = FEATURE[lang].admins;
  const { toast } = useToast();

  const [list, setList] = useState<AdminDTO[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("viewer");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<AdminDTO | null>(null);
  const mounted = useRef(true);

  const dateFmt = useCallback(
    (iso: string | null) => {
      if (!iso) return null;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      try {
        return new Intl.DateTimeFormat(LOCALE_TAG[lang], {
          dateStyle: "medium",
        }).format(d);
      } catch {
        return d.toISOString().slice(0, 10);
      }
    },
    [lang]
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admins", { cache: "no-store" });
      if (!res.ok) {
        if (mounted.current) setLoadFailed(true);
        return;
      }
      const data = (await res.json()) as { admins?: AdminDTO[] };
      if (mounted.current) {
        setList(Array.isArray(data.admins) ? data.admins : []);
        setLoadFailed(false);
      }
    } catch {
      if (mounted.current) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (isOwner) void load();
    return () => {
      mounted.current = false;
    };
  }, [isOwner, load]);

  /** Map an /api/admins failure to a translated message. */
  const errMsg = useCallback(
    async (res: Response): Promise<string> => {
      if (res.status === 409) return fx.errTaken;
      if (res.status === 403) return fx.errForbidden;
      if (res.status === 400) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (data.error === "last_owner") return fx.errLastOwner;
        if (data.error === "self_delete") return fx.errSelfDelete;
        return fx.errInvalid;
      }
      return fx.errServer;
    },
    [fx]
  );

  const addAdmin = async () => {
    const name = username.trim();
    if (!name || password.length < 6) {
      toast({ variant: "destructive", description: fx.errInvalid });
      return;
    }
    setAdding(true);
    try {
      const res = await fetch("/api/admins", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name, password, role: newRole }),
      });
      if (!res.ok) {
        toast({ variant: "destructive", description: await errMsg(res) });
      } else {
        toast({ description: sfmt(fx.added, { name }) });
        setUsername("");
        setPassword("");
        await load();
      }
    } catch {
      toast({ variant: "destructive", description: fx.errServer });
    }
    if (mounted.current) setAdding(false);
  };

  const patchAdmin = async (
    row: AdminDTO,
    patch: { role?: AdminRole; enabled?: boolean },
    successMsg: string
  ) => {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admins/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        toast({ variant: "destructive", description: await errMsg(res) });
      } else {
        const data = (await res.json()) as { admin?: AdminDTO };
        if (mounted.current && data.admin) {
          setList((prev) =>
            prev ? prev.map((a) => (a.id === row.id ? data.admin! : a)) : prev
          );
        }
        toast({ description: successMsg });
      }
    } catch {
      toast({ variant: "destructive", description: fx.errServer });
    }
    if (mounted.current) setBusyId(null);
  };

  const removeAdmin = async (row: AdminDTO) => {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admins/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        toast({ variant: "destructive", description: await errMsg(res) });
      } else {
        toast({ description: sfmt(fx.deleted, { name: row.username }) });
        await load();
      }
    } catch {
      toast({ variant: "destructive", description: fx.errServer });
    }
    if (mounted.current) setBusyId(null);
    setDeleting(null);
  };

  const roleLabel = (r: AdminRole) =>
    r === "owner" ? fx.roleOwner : r === "admin" ? fx.roleAdmin : fx.roleViewer;

  return (
    <section className="glass rounded-2xl p-5 md:p-6" aria-label={fx.title}>
      {/* header */}
      <div className="flex items-start gap-3">
        <span className="glass flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-primary/30">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-base font-bold text-foreground">{fx.title}</h3>
          <p className="max-w-md text-xs text-muted-foreground" dir="auto">
            {fx.desc}
          </p>
        </div>
      </div>

      {!isOwner ? (
        <p
          role="note"
          className="mt-4 flex items-start gap-2 rounded-lg bg-white/[0.04] px-2.5 py-2 text-xs text-muted-foreground ring-1 ring-border/60"
          dir="auto"
        >
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {fx.ownerOnly}
        </p>
      ) : (
        <>
          {/* add form */}
          <div className="mt-5 rounded-xl border border-border/70 bg-white/[0.02] p-4">
            <p className="text-xs font-semibold text-foreground" dir="auto">
              {fx.addTitle}
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="admins-username">{fx.username}</Label>
                <Input
                  id="admins-username"
                  dir="ltr"
                  className="font-mono"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={fx.usernamePh}
                  autoComplete="off"
                  maxLength={32}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admins-password">{fx.password}</Label>
                <Input
                  id="admins-password"
                  dir="ltr"
                  type="password"
                  className="font-mono"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={fx.passwordPh}
                  autoComplete="new-password"
                  maxLength={128}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admins-role">{fx.role}</Label>
                <Select
                  value={newRole}
                  onValueChange={(v) => setNewRole(v === "owner" ? "owner" : v === "admin" ? "admin" : "viewer")}
                >
                  <SelectTrigger id="admins-role" dir="auto" className="min-h-11" aria-label={fx.role}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="glass-strong">
                    <SelectItem value="owner">{fx.roleOwner}</SelectItem>
                    <SelectItem value="admin">{fx.roleAdmin}</SelectItem>
                    <SelectItem value="viewer">{fx.roleViewer}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={() => void addAdmin()}
                  disabled={adding || !username.trim() || password.length < 6}
                  className="min-h-11 w-full gap-2"
                >
                  {adding ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  )}
                  {adding ? fx.adding : fx.add}
                </Button>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground" dir="auto">
              {fx.roleHint}
            </p>
          </div>

          {/* list */}
          <div className="mt-4" aria-live="polite">
            {list === null && !loadFailed && (
              <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                {fx.adding}
              </p>
            )}
            {list === null && loadFailed && (
              <p role="alert" className="py-2 text-xs text-chart-5" dir="auto">
                {fx.errServer}
              </p>
            )}
            {list !== null && list.length === 0 && (
              <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground" dir="auto">
                <UsersRound className="h-3.5 w-3.5" aria-hidden="true" />
                {fx.empty}
              </p>
            )}
            {list !== null && list.length > 0 && (
              <ul className="max-h-96 divide-y divide-border/60 overflow-y-auto rounded-xl border border-border/60">
                {list.map((row) => {
                  const created = dateFmt(row.createdAt);
                  const lastLogin = dateFmt(row.lastLoginAt);
                  const busy = busyId === row.id;
                  return (
                    <li
                      key={row.id}
                      className={cn(
                        "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3 sm:flex-nowrap",
                        !row.enabled && "opacity-60"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-mono text-sm font-semibold text-foreground" dir="ltr">
                            {row.username}
                          </span>
                          {row.isSelf && (
                            <Badge
                              variant="outline"
                              className="shrink-0 rounded-full border-border bg-white/4 px-2 py-0 text-[10px]"
                            >
                              <span dir="auto">{fx.you}</span>
                            </Badge>
                          )}
                          {!row.enabled && (
                            <Badge
                              variant="outline"
                              className="shrink-0 rounded-full border-chart-5/40 bg-chart-5/10 px-2 py-0 text-[10px] text-chart-5"
                            >
                              <span dir="auto">{fx.disabled}</span>
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" dir="auto">
                          {fx.created}: {created ?? "—"}
                          {" · "}
                          {fx.lastLogin}: {lastLogin ?? fx.never}
                        </p>
                      </div>

                      <Badge
                        variant="outline"
                        className={cn("shrink-0 rounded-full px-2.5 py-1 text-[11px]", ROLE_BADGE[row.role])}
                      >
                        <span dir="auto">{roleLabel(row.role)}</span>
                      </Badge>

                      {/* per-row role select */}
                      <Select
                        value={row.role}
                        disabled={busy}
                        onValueChange={(v) => {
                          const next: AdminRole =
                            v === "owner" ? "owner" : v === "admin" ? "admin" : "viewer";
                          if (next !== row.role) {
                            void patchAdmin(row, { role: next }, sfmt(fx.updated, { name: row.username }));
                          }
                        }}
                      >
                        <SelectTrigger
                          className="h-9 w-28 shrink-0 rounded-lg text-xs"
                          dir="auto"
                          aria-label={`${fx.role}: ${row.username}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="glass-strong">
                          <SelectItem value="owner">{fx.roleOwner}</SelectItem>
                          <SelectItem value="admin">{fx.roleAdmin}</SelectItem>
                          <SelectItem value="viewer">{fx.roleViewer}</SelectItem>
                        </SelectContent>
                      </Select>

                      {/* enable / disable */}
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void patchAdmin(
                            row,
                            { enabled: !row.enabled },
                            sfmt(fx.updated, { name: row.username })
                          )
                        }
                        className="h-9 w-9 shrink-0 text-muted-foreground hover:text-foreground"
                        aria-label={row.enabled ? fx.disable : fx.enable}
                        title={row.enabled ? fx.disable : fx.enable}
                      >
                        {busy ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Power className="h-4 w-4" aria-hidden="true" />
                        )}
                      </Button>

                      {/* delete (own account is protected server-side too) */}
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={busy || row.isSelf === true}
                        onClick={() => setDeleting(row)}
                        className="h-9 w-9 shrink-0 text-destructive hover:text-destructive disabled:opacity-40"
                        aria-label={row.isSelf ? fx.errSelfDelete : fx.del}
                        title={row.isSelf ? fx.errSelfDelete : fx.del}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* delete confirm */}
      <AlertDialog open={deleting !== null} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent className="glass-strong border-white/10">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-foreground" dir="auto">
              {fx.delTitle}
            </AlertDialogTitle>
            <AlertDialogDescription dir="auto">
              {deleting ? sfmt(fx.delDesc, { name: deleting.username }) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full border-white/10 bg-white/[0.03]">
              <span dir="auto">{fx.cancel}</span>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (deleting) void removeAdmin(deleting);
              }}
              disabled={busyId !== null}
              className="rounded-full bg-chart-5 text-white hover:bg-chart-5/90"
            >
              {busyId ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <span dir="auto">{fx.delConfirm}</span>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
