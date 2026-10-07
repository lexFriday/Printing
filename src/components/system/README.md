# `src/components/system/`

Thin wrappers over primitives that already exist in this repo. Every component
here consolidates a pattern that was already duplicated across routes — no new
tokens, no new variants, no visual change.

## Wrappers

### `StatusPill`
- Wraps `@/components/ui/badge` with the status→class map originally inlined in
  the old dashboard route (`StatusBadge`).
- **Use when:** rendering any quote, job, or invoice status. Status vocabulary
  is closed: `draft, sent, approved, rejected, open, completed, issued, paid`.
- **Do:** pass the raw status string from the DB.
- **Don't:** introduce a new status value — add it to `DESIGN.md` Conflicts/Gaps first.

### `LoadingRow`
- Derived from the verbatim `<TableRow><TableCell colSpan className="text-center text-muted-foreground py-12">Loading…</TableCell></TableRow>`
  pattern in `_app.quotes.index.tsx:78`, `_app.jobs.index.tsx:68`,
  `_app.invoices.index.tsx:68`, `_app.customers.tsx:85`.
- **Use when:** a list table is loading.

### `EmptyState`
- Derived from the empty-row pattern in `_app.quotes.index.tsx:80-83`,
  `_app.jobs.index.tsx:69`, `_app.invoices.index.tsx:69`,
  `_app.customers.tsx:87-90`. Icon defaults to `h-8 w-8 opacity-40`.
- **Use when:** a list table has zero rows.

### `PageHeader`
- Encodes the repeated title + description + actions row at the top of every
  list/detail page (e.g. `_app.quotes.index.tsx`, `_app.jobs.index.tsx`).
- **Use when:** building a new page header. Title uses `text-2xl font-semibold`.

## Skipped on purpose

- **`Page` / `Section` / `Stack` / `Inline`** — the app shell
  (`src/routes/_app.tsx`) already provides `max-w-[1400px] p-6` and there is no
  single layout primitive duplicated across routes worth encoding. Skipped to
  avoid inventing.
- **`ErrorState`** — no in-page equivalent exists in the codebase today; only
  the root boundaries `ErrorComponent` / `NotFoundComponent` in `__root.tsx`.
  **Recommended next step**, not created here.

## Do / Don't (rules extracted from current usage)

- **Do** import status pills from `@/components/system` instead of re-creating
  badge classNames. The color map lives in `StatusPill` only.
- **Do** use `peso()`, `fmtDate()`, `fmtDateTime()` from `@/lib/format` for
  money/date rendering — no inline `Intl.NumberFormat` or `toLocaleDateString`.
- **Do** size lucide icons at `h-4 w-4` for inline use and `h-8 w-8 opacity-40`
  for empty states (matches dominant usage).
- **Don't** add new colors, fonts, radii, shadows, or status values without
  first updating `DESIGN.md`.
- **Don't** import shadcn primitives via deep relative paths — always
  `@/components/ui/<name>`.
