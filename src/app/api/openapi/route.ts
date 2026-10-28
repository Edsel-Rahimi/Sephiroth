import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/* ============================================================
   Sephiroth · Phase 27/28 — OpenAPI 3.1 specification
   Served at /api/openapi.json and consumed by the embedded
   Swagger UI in Settings → Public API AND the standalone
   /api-docs page. The spec is generated
   per-request so `servers` always matches the deployment origin
   (LAN IP, domain, or localhost preview alike).

   Auth model:
     • cookieAuth  — the dashboard session (same-site UI)
     • bearerAuth  — `Authorization: Bearer seph_…` public-API
                     tokens minted in Settings → Public API
   The /api/v1/* paths are the stable public namespace (Phase 28):
   curated bearer-authed aliases of the dashboard routes.
   ============================================================ */

export async function GET(req: Request) {
  const actor = await getSession(req);
  if (!actor || actor.role !== "admin") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const userCreate = {
    type: "object",
    required: ["username", "inboundIds"],
    properties: {
      username: { type: "string", description: "2-32 chars [a-zA-Z0-9_-], unique" },
      note: { type: "string", nullable: true },
      enabled: { type: "boolean", default: true },
      trafficLimitGb: { type: "number", nullable: true, description: "null = unlimited" },
      expiryDays: { type: "integer", nullable: true, description: "null = never expires" },
      ipLimit: { type: "integer", default: 0, description: "0 = unlimited" },
      hwidLimit: { type: "integer", nullable: true, description: "0/null = unlimited" },
      resetPeriod: { type: "string", enum: ["none", "daily", "weekly", "monthly", null] },
      onHold: { type: "boolean", default: false, description: "expiry clock starts at first connect" },
      autoRenew: { type: "boolean", default: false },
      inboundIds: { type: "array", items: { type: "string" }, description: "Inbound ids to attach" },
    },
  };

  /* Phase 28 — /api/v1 public namespace. The same handlers as the dashboard
     REST API, also mounted under a stable versioned prefix so external
     integrations can pin /api/v1 without tracking internal routes. */
  const v1 = (summary: string) => ({
    tags: ["Public v1"],
    summary,
    responses: {
      "200": { description: "OK — same payload as the aliased dashboard route" },
      "401": { description: "Missing or invalid seph_ bearer token" },
    },
  });
  const v1Paths: Record<string, unknown> = {
    "/api/v1/ping": {
      get: {
        tags: ["Public v1"],
        summary: "Unauthenticated health probe (no token needed)",
        security: [],
        responses: { "200": { description: "{ ok, service, version, time }" } },
      },
    },
    "/api/v1/users": {
      get: v1("List users — alias of GET /api/users"),
      post: v1("Create a user — alias of POST /api/users"),
    },
    "/api/v1/users/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: v1("Get one user — alias of GET /api/users/{id}"),
      patch: v1("Update a user — alias of PATCH /api/users/{id}"),
      delete: v1("Delete a user — alias of DELETE /api/users/{id}"),
    },
    "/api/v1/users/bulk": { post: v1("Bulk action — alias of POST /api/users/bulk") },
    "/api/v1/users/bulk-create": { post: v1("Batch create — alias of POST /api/users/bulk-create") },
    "/api/v1/users/export": { get: v1("Export users — alias of GET /api/users/export") },
    "/api/v1/users/import": { post: v1("Import users — alias of POST /api/users/import") },
    "/api/v1/users/ip-usage": { get: v1("Per-user IP usage — alias of GET /api/users/ip-usage") },
    "/api/v1/inbounds": {
      get: v1("List inbounds — alias of GET /api/inbounds"),
      post: v1("Create an inbound — alias of POST /api/inbounds"),
    },
    "/api/v1/inbounds/{id}": {
      parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
      get: v1("Get one inbound — alias of GET /api/inbounds/{id}"),
      patch: v1("Update an inbound — alias of PATCH /api/inbounds/{id}"),
      delete: v1("Delete an inbound — alias of DELETE /api/inbounds/{id}"),
    },
    "/api/v1/system/server-info": { get: v1("Server info & stats — alias of GET /api/system/server-info") },
    "/api/v1/system/core-status": { get: v1("Live core status — alias of GET /api/system/core-status") },
    "/api/v1/activity": { get: v1("Audit trail — alias of GET /api/activity") },
  };

  const spec = {
    openapi: "3.1.0",
    info: {
      title: "Sephiroth Panel — Public API",
      version: "27.1.0",
      description:
        "REST API for managing users, inbounds and panel state. " +
        "Authenticate with a public-API token (`seph_…`) via the Authorize button — " +
        "mint tokens in Settings → Public API. The stable public namespace is " +
        "**/api/v1** (see the Public v1 tag): `/api/v1/ping` needs no token, every " +
        "other /api/v1 route is a bearer-authed alias of the corresponding " +
        "/api route. Interactive docs: /api-docs.",
      contact: { name: "Sephiroth Panel" },
    },
    servers: [{ url: origin, description: "This deployment" }],
    tags: [
      { name: "Auth", description: "Login / session management" },
      { name: "Users", description: "Client users and bulk operations" },
      { name: "Inbounds", description: "Inbound listeners (vless, vmess, trojan, shadowsocks, hysteria2, tuic, wireguard, amnezia-wg, dokodemo-door, socks, http, mixed, mtproto)" },
      { name: "System", description: "Core status, logs, restart" },
      { name: "Activity", description: "Audit trail" },
      { name: "Public v1", description: "Stable versioned namespace — /api/v1 aliases (bearer seph_ token; ping is open)" },
      { name: "Subscription", description: "Public subscription endpoints (no auth)" },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "seph_<hex>",
          description: "Public API token minted in Settings → Public API.",
        },
        cookieAuth: { type: "apiKey", in: "cookie", name: "sephiroth_session" },
      },
      schemas: {
        Error: { type: "object", properties: { error: { type: "string" } } },
        User: {
          type: "object",
          properties: {
            id: { type: "string" },
            username: { type: "string" },
            subId: { type: "string" },
            note: { type: "string", nullable: true },
            enabled: { type: "boolean" },
            trafficLimitGb: { type: "number", nullable: true },
            expiryDays: { type: "integer", nullable: true },
            ipLimit: { type: "integer" },
            hwidLimit: { type: "integer", nullable: true },
            usedTrafficGb: { type: "number" },
            resetPeriod: { type: "string", nullable: true },
            onHold: { type: "boolean" },
            autoRenew: { type: "boolean" },
            renewals: { type: "integer" },
            status: { type: "string", enum: ["active", "expired", "capped", "disabled", "on-hold"] },
            accesses: { type: "array", items: { $ref: "#/components/schemas/Access" } },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Access: {
          type: "object",
          properties: {
            id: { type: "string" },
            inboundId: { type: "string" },
            email: { type: "string" },
            key: { type: "string" },
            flow: { type: "string" },
            inbound: { type: "object" },
          },
        },
        Inbound: {
          type: "object",
          properties: {
            id: { type: "string" },
            tag: { type: "string" },
            protocol: { type: "string" },
            port: { type: "integer" },
            listen: { type: "string" },
            transport: { type: "string" },
            security: { type: "string", enum: ["none", "tls", "reality"] },
            status: { type: "string", enum: ["online", "maintenance", "disabled"] },
            note: { type: "string", nullable: true },
            trafficLimitGb: { type: "number", nullable: true },
            expiryDays: { type: "integer", nullable: true },
            clients: { type: "array", items: { type: "object" } },
            sniffing: { type: "object" },
            stream: { type: "object", description: "transport/security/protocol-specific flat settings" },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
    paths: {
      ...v1Paths,
      "/api/auth/login": {
        post: {
          tags: ["Auth"],
          summary: "Log in (sets session cookie)",
          security: [],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["username", "password"],
                  properties: {
                    username: { type: "string" },
                    password: { type: "string" },
                    remember: { type: "boolean", default: false },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "Session cookie issued" },
            "401": { description: "Invalid credentials", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
            "423": { description: "Locked (brute-force guard)" },
          },
        },
      },
      "/api/auth/session": {
        get: { tags: ["Auth"], summary: "Current actor (admin/reseller)", responses: { "200": { description: "Actor or null" } } },
      },
      "/api/auth/logout": {
        post: { tags: ["Auth"], summary: "Destroy the session", responses: { "200": { description: "Logged out" } } },
      },
      "/api/users": {
        get: {
          tags: ["Users"],
          summary: "List users",
          responses: {
            "200": {
              description: "User list",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { users: { type: "array", items: { $ref: "#/components/schemas/User" } } } },
                },
              },
            },
            "401": { description: "Unauthorized" },
          },
        },
        post: {
          tags: ["Users"],
          summary: "Create a user",
          requestBody: { required: true, content: { "application/json": { schema: userCreate } } },
          responses: {
            "201": { description: "Created", content: { "application/json": { schema: { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } } } } },
            "400": { description: "Validation error" },
            "409": { description: "Username taken" },
          },
        },
      },
      "/api/users/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { tags: ["Users"], summary: "Get one user", responses: { "200": { description: "User DTO" }, "404": { description: "Not found" } } },
        patch: {
          tags: ["Users"],
          summary: "Update a user (partial)",
          requestBody: { required: true, content: { "application/json": { schema: userCreate } } },
          responses: { "200": { description: "Updated user" }, "404": { description: "Not found" } },
        },
        delete: { tags: ["Users"], summary: "Delete a user", responses: { "200": { description: "Deleted" }, "404": { description: "Not found" } } },
      },
      "/api/users/{id}/reset-devices": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        post: { tags: ["Users"], summary: "Reset HWID devices for a user", responses: { "200": { description: "Devices cleared" } } },
      },
      "/api/users/bulk": {
        post: {
          tags: ["Users"],
          summary: "Bulk action on users",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action", "ids"],
                  properties: {
                    action: { type: "string", enum: ["enable", "disable", "delete", "reset-traffic"] },
                    ids: { type: "array", items: { type: "string" } },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "Action result" } },
        },
      },
      "/api/users/bulk-create": {
        post: {
          tags: ["Users"],
          summary: "One-click batch creation (same spec repeated)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["count", "user"],
                  properties: {
                    count: { type: "integer", minimum: 1, maximum: 50 },
                    user: userCreate,
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Created users" } },
        },
      },
      "/api/users/export": {
        get: { tags: ["Users"], summary: "Export users (JSON)", responses: { "200": { description: "Export payload" } } },
      },
      "/api/users/import": {
        post: { tags: ["Users"], summary: "Import users from another panel (JSON)", responses: { "201": { description: "Import report" } } },
      },
      "/api/users/ip-usage": {
        get: { tags: ["Users"], summary: "Per-user IP usage", responses: { "200": { description: "IP usage map" } } },
      },
      "/api/inbounds": {
        get: {
          tags: ["Inbounds"],
          summary: "List inbounds",
          responses: {
            "200": {
              description: "Inbound list",
              content: {
                "application/json": {
                  schema: { type: "object", properties: { inbounds: { type: "array", items: { $ref: "#/components/schemas/Inbound" } } } },
                },
              },
            },
          },
        },
        post: {
          tags: ["Inbounds"],
          summary: "Create an inbound",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Inbound" } } } },
          responses: { "201": { description: "Created inbound" }, "400": { description: "Validation error" }, "409": { description: "Tag or port taken" } },
        },
      },
      "/api/inbounds/{id}": {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        get: { tags: ["Inbounds"], summary: "Get one inbound", responses: { "200": { description: "Inbound DTO" }, "404": { description: "Not found" } } },
        patch: {
          tags: ["Inbounds"],
          summary: "Update an inbound (partial)",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Inbound" } } } },
          responses: { "200": { description: "Updated inbound" } },
        },
        delete: { tags: ["Inbounds"], summary: "Delete an inbound", responses: { "200": { description: "Deleted" } } },
      },
      "/api/inbounds/autopilot": {
        post: {
          tags: ["Inbounds"],
          summary: "One-Port Autopilot — build a protocol fleet",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["mode", "protocols"],
                  properties: {
                    mode: { type: "string", enum: ["clone", "multi"] },
                    templateId: { type: "string", description: "clone mode: inbound id to clone" },
                    protocols: { type: "array", items: { type: "string" }, description: "multi mode: protocols to build" },
                    portStart: { type: "integer", description: "optional first port" },
                    clientCount: { type: "integer", default: 1 },
                  },
                },
              },
            },
          },
          responses: { "201": { description: "Plan executed — created inbounds + links" } },
        },
      },
      "/api/system/core-status": {
        get: {
          tags: ["System"],
          summary: "Live core status (xray / sing-box / sidecars)",
          responses: { "200": { description: "CoreStatusPayload" } },
        },
      },
      "/api/system/core-action": {
        post: {
          tags: ["System"],
          summary: "Core control (start/stop/restart/switch)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["action"],
                  properties: { action: { type: "string", enum: ["start", "stop", "restart"] } },
                },
              },
            },
          },
          responses: { "200": { description: "Action result" } },
        },
      },
      "/api/system/core-log": {
        get: { tags: ["System"], summary: "Recent core log lines", responses: { "200": { description: "Log lines" } } },
      },
      "/api/system/restart": {
        post: { tags: ["System"], summary: "Restart the panel process", responses: { "200": { description: "Restart scheduled" } } },
      },
      "/api/activity": {
        get: {
          tags: ["Activity"],
          summary: "Audit trail",
          parameters: [
            { name: "kind", in: "query", schema: { type: "string" } },
            { name: "limit", in: "query", schema: { type: "integer", default: 100 } },
          ],
          responses: { "200": { description: "Activity rows" } },
        },
      },
      "/api/sub/{token}": {
        parameters: [
          { name: "token", in: "path", required: true, schema: { type: "string" }, description: "user subId or group token" },
          { name: "format", in: "query", schema: { type: "string", enum: ["json", "b64", "raw"] } },
        ],
        get: {
          tags: ["Subscription"],
          summary: "Public subscription payload (no auth)",
          security: [],
          responses: {
            "200": { description: "Subscription configs (links + conf texts)" },
            "404": { description: "Unknown token" },
            "423": { description: "Device-limit blocked" },
          },
        },
      },
    },
  };

  return NextResponse.json(spec, {
    headers: { "cache-control": "no-store" },
  });
}
