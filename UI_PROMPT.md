# UI PROMPT — Sephiroth VPN Panel
# Copy everything below this line into the UI AI

---

You are a senior product designer + front-end engineer. Build a complete, production-grade admin UI for **"Sephiroth"** — a premium VPN / Xray proxy management panel. The design must feel luxurious, cosmic and unlike any existing VPN panel (do NOT imitate 3x-ui, Marzban or PasarGuard layouts). Originality, elegance and simplicity are mandatory.

## 1) PRODUCT CONTEXT
Sephiroth lets an admin manage proxy servers: inbounds/configs (VLESS, VMess, Trojan, Shadowsocks), clients/users with traffic & expiry limits, resellers, subscription links and live monitoring. Two audiences:
- **Admin panel** (dense, powerful, keyboard-friendly)
- **Public subscription page** read by end-users on phones (glamorous, simple)

## 2) BRAND DNA (from the logo)
The logo is a metallic silver "S" ribbon orbiting a dark planet with an electric-cyan rim glow and a thin orbital ring, on an obsidian-black rounded square. Extract and apply:
- **Obsidian black** backgrounds with subtle blue-green undertone (#060B0F → #0A1218)
- **Electric cyan** (#22D8EE) as the primary accent — used as GLOW, not as flat fills
- **Platinum silver** (#E2E8F0) metallic gradients for headings/key numbers
- Motifs: orbital rings (thin 1px arcs), star-field particles, soft radial "planet glow", glass panels
- Mood: dark sci-fi luxury — think observatory control room, not hacker terminal

## 3) THEME ENGINE — 6 UNIQUE THEMES (user-switchable, persisted)
Implement all 6 as full design-token sets (CSS variables), not just color swaps — each has its own personality:
1. **Sephiroth** (default, dark): obsidian #060B0F, cyan #22D8EE glow, silver text, star particles + planet glow background
2. **One-Winged** (light): platinum/ivory #F4F6F8 canvas, white glass cards, ink #16202A text, deep teal accent #0E7490, silver hairline borders — premium daylight mode
3. **JENOVA** (dark): deep void purple #0D0714, neon violet #A855F7 + magenta #E879F9 dual accents, aurora gradient mesh
4. **Masamune** (dark): black-red #0C0708, blood crimson #E11D48 accent, sharp 2px corners, blade-like divider lines — aggressive
5. **Terminal** (dark): #020604 pure black-green, phosphor green #22C55E, monospace font for ALL text, scanline texture, square components
6. **OLED Pure** (dark): absolute #000, same cyan accent but glow reduced 50%, no gradients, no particles — battery saver
Theme switcher = instant (no reload), respects OS dark/light for initial guess.

## 4) TYPOGRAPHY & I18N (critical!)
- **6 languages**: Persian (default), English, Arabic, Chinese, Turkish, Russian
- **Persian & Arabic are RTL** — the ENTIRE layout must mirror perfectly (sidebar flips, icons with directional meaning flip, chevrons flip, padding/margins use logical properties `ms-*`/`me-*`). Others are LTR.
- Fonts: **Vazirmatn** for Persian, **Inter** or **Space Grotesk** for Latin, **Noto Sans SC** for Chinese; Terminal theme uses **JetBrains Mono** everywhere
- Numbers always render with Latin digits (even in RTL text)
- Every string comes from an i18n dictionary — no hardcoded text. Show a language switcher (flag + label) in the topbar.

## 5) APP SHELL (admin)
- **Left sidebar** (right side when RTL), 264px, glass panel with brand logo + wordmark "Sephiroth" on top; sections: Dashboard, Inbounds, Users, Sub Groups, Resellers, Activity Log, Settings; collapsible to icon-rail (64px); active item = cyan glow pill with a small orbital-ring indicator
- **Topbar**: global search + ⌘K hint, live server status chip (green pulse dot), language switcher, theme switcher (dropdown with theme previews), notification bell with badge, admin avatar menu
- **Sticky footer** (always at viewport bottom, pushed naturally when content overflows): version, core status, current time, "Sephiroth © 2025"
- Content area max-width ~1440px, generous 24px padding, mobile-first responsive (sidebar becomes a slide-over drawer < 1024px, bottom nav optional)

## 6) PAGES — SPEC BY SPEC

### 6.1 Login
Full-screen cosmic scene: animated star-field + a glowing planet arc at the bottom, centered **glass card** (max-w-md) with the glowing logo pulsing softly (cyan box-shadow animation), username + password with floating labels, "show password" eye, error shake animation on wrong creds, subtle loading state on submit, language + theme pickers in a corner. After 5 failed attempts show a lockout countdown — design that state too.

### 6.2 Dashboard (bento grid — THE showcase page)
Asymmetric bento layout (CSS grid, 12 cols desktop, stacked mobile):
- **Hero card**: system health ring (SVG circular gauge: CPU/RAM combined) with silver gradient stroke + cyan glow, uptime, server IP
- **Live traffic card**: real-time up/down speed with animated area chart (last 60s), numbers with tabular-nums, glowing gradient under curve
- **Traffic today/week card**: bar chart (hourly / daily toggle)
- **Clients summary**: donut chart active/expired/limited/near-limit + total counters
- **Top consumers**: mini leaderboard with avatar initials, usage bars, silver→cyan gradient bars
- **Activity pulse**: live event feed (user connected / config created / limit reached) with timestamp, auto-scrolling newest-first, each row fades in
- All cards: glass (bg-white/4, backdrop-blur, 1px border-white/8, radius 16px), hover = border brightens + tiny lift. Numbers animate count-up on load. Skeleton shimmer while loading.

### 6.3 Inbounds & Configs
- Toolbar: search, protocol filter chips (VLESS/VMess/Trojan/SS with tiny protocol icons), status filter, "+ New Inbound" primary button (cyan glow)
- Table/cards hybrid: each inbound shows protocol badge, port, transport (WS/gRPC/XHTTP…), TLS/REALITY badge, clients count, traffic used bar, status toggle switch (instant, with optimistic UI)
- Create/Edit = **right slide-over drawer** (not modal) with grouped sections: Protocol & Port → Transport & Security (TLS/REALITY: SNI, fingerprint uTLS select, ALPN) → Sniffing/Advanced; dirty-state indicator; live JSON preview collapsible at bottom (monospace, syntax-tinted)
- Row actions: QR (opens glass dialog with glowing QR + copy link), share link, clone, delete (confirm with typed-name pattern)

### 6.4 Users / Clients (the workhorse)
- Full-height data table: name, status dot, traffic used/total with progress bar (bar turns amber at 80%, crimson at 95%), expiry countdown chip (e.g. "12d left", expired = red), speed limit, IP limit, last-seen, owner (for resellers)
- Search + multi-filter + sortable columns + pagination OR infinite scroll; **bulk select** → bulk bar floats up (delete / extend / reset traffic / export)
- Create user = multi-step **wizard drawer**: 1) identity (name, note, tags) 2) limits (traffic GB stepper, expiry date picker or days, speed Mbps, concurrent IPs, periodic reset daily/weekly/monthly/no-reset, HWID limit) 3) inbounds multi-select → success screen with QR + copy buttons + confetti burst (subtle)
- Clicking a user opens **user drawer**: header with avatar+status, tabbed content (Overview: usage ring + sparkline / Configs: list with QR each / Activity: timeline / Settings: edit all limits)

### 6.5 Public Subscription Page (end-user facing, phone-first)
- **The "Pass Card"**: a credit-card-shaped holographic panel (own original design) — dark glass with an animated cyan shine sweep, planet arc watermark, user name in silver, live usage ring, expiry; the page background is a soft cosmic gradient with stars
- Glowing QR code (cyan gradient modules on white rounded tile, soft outer glow), tap to fullscreen
- "Connect" buttons row: v2rayNG, Hiddify, Streisand, V2Box, Happ, Clash (icons + deep links)
- Usage stats section: used/total with elegant progress, reset date, speed/IP limits shown as small chips
- Theme-aware (follows the 6 themes), auto direction by locale, huge touch targets (min 48px)

### 6.6 Resellers
- Reseller list with quota rings (used volume / allocated), users count, revenue-ish stats
- Create reseller drawer: username, password, volume quota, expiry, allowed sale templates
- Sale templates grid: preset cards (e.g. "1 Month / 50GB") with price placeholder, one-click apply when creating a user as reseller

### 6.7 Settings
Left vertical tab nav: General (branding, language defaults), Security (password change, recovery key display, session timeout, login lockout policy), Core (driver status card: "Simulator connected" green pulse — designed to later show real Xray), Backup (export/import buttons with file dropzone), Telegram Bot (token field, admin IDs, test message button, on/off switch), Appearance (theme gallery: 6 preview thumbnails rendered as mini-mockups, click to apply)

### 6.8 Command Palette (⌘K)
Centered glass overlay, blurred backdrop: search input with result groups (Navigation / Users / Inbounds / Actions), arrow-key navigation, each row shows kbd shortcut + icon; actions like "Create user", "Toggle theme", "Restart core" (with confirm). Opens with ⌘K / Ctrl+K, closes Esc, focus-trapped.

## 7) COMPONENT & MOTION RULES
- Use **shadcn/ui** components (New York style) as the base, heavily customized via tokens; **Lucide** icons only (stroke 1.5)
- Radius scale: 10px controls, 16px cards, 24px hero cards. Glass surfaces: `bg-white/4` + `backdrop-blur-xl` + `border-white/8`
- **Motion (framer-motion)**: 150–250ms ease-out micro-interactions; page transitions = fade + 8px rise; numbers count-up; charts animate on mount; respect `prefers-reduced-motion` (disable particles + count-ups)
- Glow discipline: only ONE glowing element per view section (primary CTA, active nav, live dot). Glow = `box-shadow: 0 0 24px -6px accent40%`. Never glow body text.
- Status colors: emerald #34D399 ok, amber #FBBF24 warning, crimson #F43F5E danger — consistent across all themes
- Every async state designed: skeleton (shimmer), empty (illustration-lite + CTA), error (retry button), success toast (bottom corner, glass)
- Accessibility: AA contrast even on glass, focus-visible cyan ring, all interactive ≥44px, aria-labels on icon buttons, tables have proper headers

## 8) DO / DON'T
✅ Original cosmic-luxury identity, glass + glow + metallic silver, RTL-perfect, keyboard-first, dense-but-calm admin
❌ No copying 3x-ui/Marzban layouts, no Bootstrap look, no purple-blue gradient clichés, no emoji in UI chrome, no more than 2 accent colors per theme, no flat boring gray dashboards

Deliver: complete Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui implementation, dark-first, fully responsive, with all 6 themes and RTL support working.
