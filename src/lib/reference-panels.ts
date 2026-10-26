/* ============================================================
   Sephiroth · Reference panels registry
   The six research panels are deployed as real, running apps
   on this machine (see /home/z/panels/<id> + panels.json).
   They are exposed to the browser through the same-origin
   proxy route:  /ref/[panel]/[[...path]]  → 127.0.0.1:<port>

   Proxy behavior flags (derived from each panel's capabilities):
   - strip:       panel has NO base-path support → the proxy strips
                  the /ref/<id> prefix before forwarding.
   - rewriteHtml: panel serves root-absolute HTML → inject <base>
                  + prefix root-absolute href/src/action.
   - rewriteJs:   panel JS calls root-absolute API paths (axios
                  baseURL '/' or literal "/api/…") → rewrite.
   ============================================================ */

export type RefPanelStatus = "running" | "partial" | "failed";

export interface RefPanel {
  id: string;
  name: string;
  repo: string;
  stars: number;
  version: string;
  port: number;
  /** URL path on our origin (through the proxy) that shows the panel */
  entry: string;
  creds: string;
  status: RefPanelStatus;
  notes: string;
  strip: boolean;
  rewriteHtml: boolean;
  rewriteJs: boolean;
}

export const REF_PANELS: RefPanel[] = [
  {
    id: "3xui",
    name: "3x-ui",
    repo: "https://github.com/MHSanaei/3x-ui",
    stars: 48528,
    version: "v3.10.2",
    port: 4101,
    entry: "/ref/3xui/",
    creds: "admin / admin",
    status: "running",
    notes: "Official release binary; webBasePath=/ref/3xui/ (fully base-path native).",
    strip: false,
    rewriteHtml: false,
    rewriteJs: false,
  },
  {
    id: "pasarguard",
    name: "PasarGuard",
    repo: "https://github.com/PasarGuard/panel",
    stars: 2752,
    version: "5.5.0",
    port: 4102,
    entry: "/ref/pasarguard/dashboard/",
    creds: "admin / admin",
    status: "running",
    notes: "ASGI PrefixStripper upstream; dashboard rebuilt with BASE_URL; JS API calls rewritten by proxy.",
    strip: false,
    rewriteHtml: false,
    rewriteJs: true,
  },
  {
    id: "superjinx",
    name: "SuperJinX",
    repo: "https://github.com/x4gpanell/SuperJinX",
    stars: 467,
    version: "v6.1.3",
    port: 4103,
    entry: "/ref/superjinx/dashboard/",
    creds: "admin / admin",
    status: "running",
    notes: "PasarGuard 5.5.0 engine + JinX overlay; same proxy rewriting as PasarGuard.",
    strip: false,
    rewriteHtml: false,
    rewriteJs: true,
  },
  {
    id: "newyork",
    name: "NewYork · Gateway",
    repo: "https://github.com/x4gpanell/NewYork",
    stars: 1204,
    version: "v11",
    port: 4104,
    entry: "/ref/newyork/login",
    creds: "admin (password only)",
    status: "running",
    notes: "No base-path support; inline UI + CDN. Proxy strips prefix and rewrites root-absolute paths.",
    strip: true,
    rewriteHtml: true,
    rewriteJs: true,
  },
  {
    id: "jinx-x4g",
    name: "JinX-X4G",
    repo: "https://github.com/x4gpanell/JinX-X4G",
    stars: 379,
    version: "x-ui 2.9.4 fork",
    port: 4105,
    entry: "/ref/jinx-x4g/",
    creds: "admin / admin",
    status: "running",
    notes: "Prebuilt 3x-ui fork binary; webBasePath=/ref/jinx-x4g/ (fully base-path native).",
    strip: false,
    rewriteHtml: false,
    rewriteJs: false,
  },
  {
    id: "vodiwalker",
    name: "VodiWalker Kata",
    repo: "https://github.com/Vodiwalker/vodiwalker_kata",
    stars: 97,
    version: "v15.0.0",
    port: 4106,
    entry: "/ref/vodiwalker",
    creds: "admin / admin",
    status: "running",
    notes: "FastAPI app; no base-path support. Proxy strips prefix and rewrites root-absolute paths.",
    strip: true,
    rewriteHtml: true,
    rewriteJs: true,
  },
];

export function findRefPanel(id: string): RefPanel | undefined {
  return REF_PANELS.find((p) => p.id === id);
}
