# Contributing to Sephiroth

Thanks for your interest in contributing to **Sephiroth**, a next-generation Xray VPN management panel. Sephiroth is a fully self-contained, full-stack application: an Express server serves both the REST/WebSocket API and a Vite-built React dashboard, backed by a JSON store — no external database or managed service is required to run it.

## Tech Stack

- **Backend:** Express on the Bun runtime (`bun` runs all dev tooling)
- **Frontend:** Vite + React 19 + TypeScript 5 (Tailwind CSS, shadcn/ui, Zustand)
- **Storage:** JSON file store under `db/` — zero external DB
- **i18n:** 6 languages (en/fa/ar/zh/tr/ru) defined in `src/lib/i18n/dictionaries.ts`

## Development Setup

1. Install [Bun](https://bun.sh) (v1.x or newer).
2. Install dependencies:

   ```bash
   bun install
   ```

3. Start the dev server (panel listens on **port 3000**):

   ```bash
   bun run dev
   ```

4. Optional: seed demo inbounds on a fresh install:

   ```bash
   node scripts/seed-inbounds.ts
   ```

## Quality Gates — every PR must pass

Run these before opening or pushing to a PR. CI runs exactly the same commands:

| Gate | Command | What it checks |
| --- | --- | --- |
| Typecheck | `bun run lint` | TypeScript `tsc --noEmit` over the whole project |
| i18n audit | `bun scripts/i18n-audit.ts` | Key/placeholder parity across all 6 languages |

- The **i18n audit** compares the translation dictionaries so every language defines the same keys with matching `{placeholders}`. The script may print heuristic notes (smart quotes, benign Latin tech words); these are informational — the gate is the **exit code**.
- **End-to-end tests** are exercised via the `scripts/e2e-*.cjs` harnesses against a **running dev server** (start `bun run dev` first, then e.g. `bun scripts/e2e-28-notify-whitelabel-bulk.cjs`). Run the harnesses relevant to the area you touched.

## i18n Rule (strict)

Any new UI string — label, toast, tooltip, error, dialog text — must be added to **all 6 languages** (`en`, `fa`, `ar`, `zh`, `tr`, `ru`) in `src/lib/i18n/dictionaries.ts`. A missing or mismatched key in any language fails the i18n audit and blocks merge. Never hardcode user-visible strings in components.

## Commit Style

Use [Conventional Commits](https://www.conventionalcommits.org):

- `feat:` new feature
- `fix:` bug fix
- `docs:` documentation only
- `chore:` tooling, CI, dependencies, cleanup

Examples: `feat(inbounds): add autopilot schedule`, `fix(i18n): missing tr key for settings view`, `docs: expand contributing guide`.

## Reporting Security Issues

**Do NOT open a public GitHub issue for security vulnerabilities** (exploits, auth bypasses, credential leaks, and similar).

Once this repository is public, please open a **private security advisory on GitHub** (Security → Advisories → New draft security advisory). Until then, contact the maintainers privately through the project's official channels. We acknowledge reports and coordinate a fix and disclosure timeline before any detail is made public.

## House Rules

- **No real data in commits:** never commit real server IPs, hostnames, tokens, passwords, subscription links, or any personal data — in code, docs, screenshots, or test fixtures. Use placeholders (`example.com`, `1.2.3.4`, `<token>`).
- Keep changes focused: one logical change per PR.
- Update related docs (`README.md` and language READMEs) when behavior or setup changes.

Thank you for helping make Sephiroth better!
