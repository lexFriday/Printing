# DESIGN.md — Mitzy Sy Printing Operations

> **This document is a transcription, not a proposal.** Every value below cites
> the file it came from. If a value isn't here, it isn't in the system — list
> it under **Gaps** before adding it.

---

## AI / Developer Contract

Rules enforced for any change touching UI. Each names a real artifact that
exists in this repo today.

1. **Status pills** → `import { StatusPill } from "@/components/system"`. The
   color map lives in `src/components/system/StatusPill.tsx` only. The closed
   vocabulary is `draft, sent, approved, rejected, open, completed, issued, paid`.
2. **Money** → `peso()` from `src/lib/format.ts`. No inline `Intl.NumberFormat`.
3. **Dates** → `fmtDate()` / `fmtDateTime()` from `src/lib/format.ts`. No inline
   `toLocaleDateString`.
4. **List loading rows** → `<LoadingRow colSpan={n} />` from `@/components/system`.
5. **List empty rows** → `<EmptyState colSpan={n} icon={Icon}>...</EmptyState>` from `@/components/system`.
6. **Page header** → `<PageHeader title=... actions=... />` from `@/components/system`.
7. **Primitives** → always `@/components/ui/<name>` (shadcn). Never deep relative paths.
8. **Icons** → `lucide-react`. Inline default `h-4 w-4`. Empty-state `h-8 w-8 opacity-40`. No stroke override.
9. **Colors** → only the tokens listed below. Never hard-code hex, rgb, or oklch in components.
10. **Spacing / radius / shadow** → only values listed below. Anything missing belongs in **Gaps**, not in code.

---

## Brand

- **Product name:** "Mitzy Sy Printing Operations" — `src/routes/__root.tsx:84`
- **Package id:** `tanstack_start_ts` — `package.json:2`
- **Tagline / description:** "Quotations, job orders, invoices, and project profitability for Mitzy Sy Printing." — `src/routes/__root.tsx:85`
- **Sidebar mark:** lucide `Printer` icon on a `--gradient-brand` tile — `src/components/AppSidebar.tsx:44-47`

---

## Color Tokens

Color space: **oklch** (exclusively). Defined via `@theme inline` + `:root` / `.dark` blocks in `src/styles.css`.

### Light (`:root`, `src/styles.css:50-108`)

| Token | Value |
|---|---|
| `--radius` | `0.75rem` |
| `--background` | `oklch(0.985 0.003 240)` |
| `--foreground` | `oklch(0.18 0.03 260)` |
| `--card` | `oklch(1 0 0)` |
| `--card-foreground` | `oklch(0.18 0.03 260)` |
| `--popover` | `oklch(1 0 0)` |
| `--popover-foreground` | `oklch(0.18 0.03 260)` |
| `--primary` | `oklch(0.52 0.21 268)` |
| `--primary-foreground` | `oklch(0.99 0 0)` |
| `--secondary` | `oklch(0.965 0.008 260)` |
| `--secondary-foreground` | `oklch(0.25 0.03 260)` |
| `--muted` | `oklch(0.965 0.008 260)` |
| `--muted-foreground` | `oklch(0.52 0.025 260)` |
| `--accent` | `oklch(0.95 0.03 268)` |
| `--accent-foreground` | `oklch(0.32 0.12 268)` |
| `--destructive` | `oklch(0.58 0.22 25)` |
| `--destructive-foreground` | `oklch(0.99 0 0)` |
| `--success` | `oklch(0.62 0.16 155)` |
| `--success-foreground` | `oklch(0.99 0 0)` |
| `--warning` | `oklch(0.78 0.15 75)` |
| `--warning-foreground` | `oklch(0.25 0.05 75)` |
| `--info` | `oklch(0.65 0.14 240)` |
| `--info-foreground` | `oklch(0.99 0 0)` |
| `--border` | `oklch(0.92 0.008 260)` |
| `--input` | `oklch(0.92 0.008 260)` |
| `--ring` | `oklch(0.52 0.21 268)` |
| `--sidebar` | `oklch(0.99 0.003 260)` |
| `--sidebar-foreground` | `oklch(0.25 0.03 260)` |
| `--sidebar-primary` | `oklch(0.52 0.21 268)` |
| `--sidebar-primary-foreground` | `oklch(0.99 0 0)` |
| `--sidebar-accent` | `oklch(0.95 0.02 268)` |
| `--sidebar-accent-foreground` | `oklch(0.32 0.12 268)` |
| `--sidebar-border` | `oklch(0.92 0.008 260)` |
| `--sidebar-ring` | `oklch(0.52 0.21 268)` |
| `--gradient-brand` | `linear-gradient(135deg, oklch(0.55 0.22 268), oklch(0.62 0.2 240))` |
| `--shadow-card` | `0 1px 2px oklch(0.18 0.03 260 / 0.04), 0 1px 3px oklch(0.18 0.03 260 / 0.06)` |
| `--shadow-lifted` | `0 10px 30px -12px oklch(0.18 0.03 260 / 0.18)` |

### Dark (`.dark`, `src/styles.css:111-141`)

Same token names, dark values; full list in `src/styles.css`. Notable:

- `--background: oklch(0.16 0.02 260)`
- `--foreground: oklch(0.96 0.005 260)`
- `--primary: oklch(0.7 0.18 268)`
- `--border: oklch(1 0 0 / 10%)`
- `--input: oklch(1 0 0 / 12%)`

---

## Typography

- **Family:** `--font-sans: "Inter", ui-sans-serif, system-ui, sans-serif` — `src/styles.css:14`
- **Loaded via:** Google Fonts `<link>` (weights 400/500/600/700) — `src/routes/__root.tsx:91-95`
- **Headings** get `letter-spacing: -0.02em` — `src/styles.css:base h1..h4`
- **Size scale in use** (grep of `text-*` across `src/`):
  `text-xs, text-sm, text-base, text-lg, text-xl, text-2xl, text-3xl, text-4xl, text-7xl`.
  `text-5xl` and `text-6xl` are **not used** in the codebase.

---

## Spacing Scale (Actually In Use)

Across `p/px/py/pt/pb/pl/pr/m/mx/my/mt/mb/gap/space-x/space-y` utilities in `src/`:

`0, 0.5, 1, 2, 3, 4, 5, 6, 8, 12, 24`

Notable patterns:

- App main content: `p-6` (`src/routes/_app.tsx:30`)
- Container width: `max-w-[1400px]` (`src/routes/_app.tsx:30`)
- Sticky header height: `h-14` (`src/routes/_app.tsx:27`)
- List empty/loading row padding: `py-12`

---

## Radius

- Source: `--radius: 0.75rem` (`src/styles.css:50`)
- Derived in `@theme inline`: `--radius-sm = radius - 4px`, `-md = -2px`, `-lg = radius`, `-xl = +4px`, `-2xl = +8px` (`src/styles.css:8-12`)
- Utilities in use: `rounded, rounded-sm, rounded-md, rounded-lg, rounded-xl, rounded-full, rounded-none, rounded-l, rounded-r, rounded-t, rounded-tl`

---

## Elevation

- Tailwind built-ins in use: `shadow-none, shadow-xs, shadow-sm, shadow, shadow-md, shadow-lg, shadow-xl`
- Custom tokens: `--shadow-card`, `--shadow-lifted` — `src/styles.css:107-108`. Exposed as `shadow-card`, `shadow-lifted`.

---

## Motion

**Not defined in current codebase.** No motion tokens, no duration scale. Only
implicit Radix data-state animations from shadcn primitives.

---

## Iconography

- **Library:** `lucide-react` (`package.json:45`), imported by 30 files in `src/`.
- **Default inline size:** `h-4 w-4` (24 occurrences in audited files).
- **Empty-state size:** `h-8 w-8 opacity-40` (5 occurrences).
- **Other sizes seen rarely:** `h-3 w-3`, `h-5 w-5`, `h-6 w-6`, `h-10 w-10`.
- **Stroke width:** lucide default; never overridden.

---

## Formatting Helpers

All in `src/lib/format.ts`:

- `peso(n: number | string | null | undefined): string` — `Intl.NumberFormat` `en-PH`, currency PHP.
- `fmtDate(d): string` — `en-PH` short (year/month/day). Returns `"—"` for nullish.
- `fmtDateTime(d): string` — `en-PH` short + 2-digit time.

No other formatters exist. No generic number formatter — see **Gaps**.

---

## Status Vocabulary

Closed set, with semantic color, from `StatusBadge` map in `src/routes/_app.dashboard.tsx:131-142` (now re-exported via `src/components/system/StatusPill.tsx`):

| Status | Entity | Class |
|---|---|---|
| `draft` | quote | `bg-muted text-muted-foreground` |
| `sent` | quote | `bg-info/15 text-info border-info/30` |
| `approved` | quote | `bg-success/15 text-success border-success/30` |
| `rejected` | quote | `bg-destructive/15 text-destructive border-destructive/30` |
| `open` | job | `bg-info/15 text-info border-info/30` |
| `completed` | job | `bg-success/15 text-success border-success/30` |
| `issued` | invoice | `bg-warning/20 text-warning-foreground border-warning/40` |
| `paid` | invoice | `bg-success/15 text-success border-success/30` |

---

## Layout & Navigation

- **Shell:** sidebar + top header — `src/routes/_app.tsx:24-37`.
  - `SidebarProvider` (`@/components/ui/sidebar`) + `<AppSidebar collapsible="icon" />`.
  - Sticky header: `h-14 flex items-center gap-2 border-b bg-card/50 backdrop-blur px-4 sticky top-0 z-30`.
  - Main content: `flex-1 p-6 max-w-[1400px] w-full mx-auto`.
- **Sidebar mark:** `Printer` lucide icon on `--gradient-brand` 8×8 tile — `src/components/AppSidebar.tsx:44-47`.
- **Nav items:** `Dashboard, Quotes, Job Orders, Invoices, Customers, Reports` — `src/components/AppSidebar.tsx:25-32`.
- **Route convention:** TanStack file-based, flat dot files. Authenticated subtree under `_app.*`; `/auth` and `/` are public.

---

## Conflicts

Surfaced from the audit. **Not resolved.** Decide before changing.

1. **Invoice status `open` vs `issued`** — `StatusPill` defines `issued` and `paid`, but `src/routes/_app.invoices.index.tsx` filters/writes `"open"` (treated as unpaid). The badge renders `"open"` using the job-status (info) colors instead of warning. Decide canonical invoice status: `open`/`paid` or `issued`/`paid`.
2. **`--gradient-brand` missing in `.dark`** — defined only on `:root` (`src/styles.css:107`). The sidebar logo tile uses it in dark mode, falling back to nothing.
3. **`EmptyRow` exported from a route file** — `src/routes/_app.dashboard.tsx:127` exports a sibling of the new `EmptyState`. Two empty patterns coexist (page-level `EmptyRow` vs table-row `EmptyState`). Pick one home.
4. **Loading copy duplicated** — `_app.tsx:20` uses a full-page `Loading…` div; list pages use a centered `<TableRow>` cell. Same word, different shells. Acceptable, but worth naming.

---

## Gaps

Things absent from the current codebase. **Listed, not added.**

- Motion tokens (duration / easing scale).
- Reusable in-page `ErrorState` component (only root boundary exists).
- Layout primitives (`Page`, `Section`, `Stack`, `Inline`).
- Dark-mode value for `--gradient-brand`.
- Generic number formatter (only `peso` exists).
- Typography weights beyond 400/500/600/700.
- `text-5xl` / `text-6xl` — unused, no action needed.
