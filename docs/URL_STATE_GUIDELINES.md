# URL State Guidelines

> Phase 40 / Prompt 33 — Scroll restoration & URL deep-linking

TeslaSync mirrors filter / tab / expansion state into the URL query string so
that views can be **shared, bookmarked, reloaded, and navigated back to** with
their state intact. This document explains where each kind of state belongs,
which helper to reach for, and when to use `push` vs `replace` history
semantics.

## Where state should live

| Kind of state                                         | Storage              | Why                                                     |
| ----------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| Filters, tabs, sort, search, page, expansion          | **URL query string** | Shareable, restorable on reload, back-button friendly   |
| User preferences (default sort, default vehicle, units) | **Settings (DB)**   | Per-user, persistent across devices                     |
| Per-device chrome (sidebar collapsed, theme)          | **localStorage**     | Per-device, doesn't make sense to share via URL         |
| Auth tokens, secrets                                  | **httpOnly cookies** | NEVER in URL                                            |
| Server data (the actual rows)                         | **TanStack Query**   | Backed by the API, refetched as needed                  |
| Ephemeral UI (a tooltip's open flag)                  | **`useState`**       | No reason to survive a reload or be shared              |

If a piece of state would feel weird to put in the URL ("why does the URL say
`?tooltipOpen=true`?") it probably belongs in `useState` instead.

## Hook surface

All URL-backed state goes through the `useUrlState` family in
`web/src/hooks/useUrlState.ts`:

```ts
import {
  useUrlState,    // generic — supply your own parse/serialize
  useUrlString,   // string
  useUrlBoolean,  // boolean — encodes as 'true' / 'false'
  useUrlNumber,   // number — falls back to default on NaN
  useUrlEnum,     // constrained string — unknown values fall back
  useUrlArray,    // string[] — joined with ',' by default
} from '@/hooks/useUrlState';
```

Each hook returns `[value, setValue]` and is API-compatible with `useState`,
including the **updater form** (`setX(prev => prev + 1)`).

### Examples

```tsx
// Boolean toggle
const [showArchived, setShowArchived] = useUrlBoolean('archived', false);

// Constrained tab
const [tab, setTab] = useUrlEnum<'inbox' | 'archive'>(
  'tab',
  ['inbox', 'archive'] as const,
  'inbox',
);

// Numeric pagination
const [page, setPage] = useUrlNumber('page', 1);

// Array of selected items
const [selected, setSelected] = useUrlArray('signals');

// Free-form search
const [q, setQ] = useUrlString('q', '');
```

## `push` vs `replace`

By default, all setters use `replaceState` — a filter toggle should NOT add a
new browser history entry, otherwise the back button gets clogged with junk.

Use `push: true` only for **navigation-feeling** changes — a primary tab
switch, swapping the active vehicle, opening a sub-view that the user might
want to back out of:

```tsx
// Primary tab — push so back button takes you to the previous tab
setTab(next, { push: true });

// Filter — replace (default) so back button skips past filter changes
setSeverity('critical');
```

A simple rule of thumb:

| Action                                       | Semantics    |
| -------------------------------------------- | ------------ |
| Change a filter / sort / search              | `replace`    |
| Toggle an expansion / panel                  | `replace`    |
| Paginate                                     | `replace`    |
| Switch primary tab                           | `push`       |
| Switch active vehicle                        | `push`       |
| Open a destructive sub-view (rule editor)    | `push`       |

## Default value handling

When the new value equals the supplied default, the param is removed from the
URL — `?severity=all` becomes just `/notifications`. This keeps URLs clean and
makes the canonical "fresh page" URL look like the canonical fresh page.

If you need to keep the param even when it equals the default (rare), pass
`omitDefault: false` to `useUrlState`. None of the convenience hooks expose
this — drop down to `useUrlState` directly.

## Identity stability

`useUrlState` snapshots the parsed value with `useRef`, so as long as the URL
string for a given key hasn't changed, the returned value reference is **stable
across renders**. This matters for callers that pass the URL value into
`useMemo` / `useEffect` deps — without it, hooks like `useUrlArray` would
return a fresh `string[]` every render and downstream effects would loop.

You don't need to think about this when using the hook — just don't wrap the
returned value with another `useMemo(() => urlValue, [urlValue])`, that's
already taken care of.

## What does NOT belong in the URL

- **Authentication tokens** — never. Use httpOnly cookies via Authentik.
- **PII** — VINs, locations, names. Treat URLs as something a user might paste
  into a public Slack channel.
- **Server-side state** — the API is the source of truth.
- **Settings** — per-user preferences belong in the Settings table.
- **Per-device chrome** — sidebar collapse, theme, etc. belong in localStorage.
- **Drive-level state** — opening a single drive uses a route param
  (`/drives/123`), not a query string.

## Scroll restoration

The `<ScrollRestoration>` component in `web/src/components/layout` is mounted
once at the router root by `App.tsx`. It:

- Records scroll position on every scroll into `sessionStorage`, keyed by
  `pathname + search`.
- Restores scroll on `POP` navigation (back / forward) so a user who scrolled
  80% down the Drives list and opened a detail returns to the same row.
- Scrolls to the top on `PUSH` / `REPLACE` so a fresh navigation starts at the
  top.

The scroll container is the `<main id="main-content">` element from `Layout`,
not the window — chunks of the app render outside `Layout` (`/watch`,
`/onboarding`, etc.) and fall back to scrolling the window.

You don't need to opt in or interact with this — it Just Works.

## Copy link affordance

Pages with rich URL state can opt in to a "Copy link" button in the header by
passing `copyLink` to `PageContainer` (or `PageHeader` when used standalone):

```tsx
<PageContainer
  title={t('page.notifications.title')}
  loading={isLoading}
  copyLink
>
  {/* … */}
</PageContainer>
```

The button copies `window.location.href` (which now reflects the user's
filters) and shows a 2-second "Copied" confirmation. Don't add it everywhere —
only on pages where sharing the current view actually makes sense:

- ✅ Notifications inbox (filtered by severity / vehicle)
- ✅ Drives list (sorted, filtered by date)
- ✅ Charging history (filtered by VIN)
- ✅ Signal log query (selected signals + date range)
- ❌ A page with no URL state at all
- ❌ A page that requires login to view (sharing won't help)
