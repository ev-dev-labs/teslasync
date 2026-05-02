# Mobile / Responsive Design Guidelines

Tesla owners commonly check stats from their phone — TeslaSync is a glanceable
companion app, not just a desktop dashboard. Every page MUST work at 390px wide
(iPhone 14 portrait) without horizontal scroll, clipped buttons, or unreachable
content.

## Breakpoint Contract

Matches `tailwind.config.js` (default Tailwind breakpoints, no overrides):

| Token        | Width range       | Devices                              |
|--------------|-------------------|--------------------------------------|
| (default)    | `< 640px`         | Phone portrait                       |
| `sm:`        | `640 – 767px`     | Phone landscape / small tablet       |
| `md:`        | `768 – 1023px`    | Tablet portrait                      |
| `lg:`        | `1024 – 1279px`   | Tablet landscape / small laptop      |
| `xl:`        | `1280 – 1535px`   | Desktop                              |
| `2xl:`       | `≥ 1536px`        | External monitor                     |

## Default-Mobile Strategy

1. **Grids start at `grid-cols-1`**, escalate at `md` and `lg`:
   ```tsx
   <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
   ```
2. **Sidebar is collapsed by default below `lg`** and accessed via a hamburger
   in the top app bar. We use `lg` (not `md`) because the sidebar's navigation
   tree is dense (15+ sections, 70+ links) and only fits comfortably alongside
   page content at viewports ≥ 1024px. On tablets in portrait (744px –
   1023px), the sidebar is a swipe-in drawer, identical to phones.
3. **`<BottomTabBar>` shows on `<lg`** with 5 destinations: Dashboard, Drives,
   Charging, Battery, Map. It replaces the sidebar on tablet portrait + phone.
4. **On `≥ lg`**: hide `<BottomTabBar>`, show inline sidebar.
5. **Tables wrap in `overflow-x-auto`** AND opt into a column allowlist via
   `mobileColumns` on `<DataTable>` (essential columns only on `<md`, all
   columns on `≥ md`).
6. **Charts use `<ResponsiveContainer>`** with `aspect={…}` instead of fixed
   pixel widths. The `<ChartContainer>` shared component already does this.
7. **Modals are full-screen below `sm`** regardless of the requested `size`
   prop. The shared `<Modal>` enforces this.
8. **`<PageHeader>` stacks title and actions vertically below `sm`.** The
   shared component already does this with `flex-col … sm:flex-row`.
9. **Touch targets ≥ 44 × 44 px** for interactive elements (close buttons,
   tab bar items). This matches WCAG 2.5.5 Target Size (Enhanced).
10. **iOS safe area** — components anchored to the viewport bottom (BottomTabBar,
    main content padding) use the `safe-bottom` / `pb-safe` utility classes
    defined in `web/src/index.css`, which read `env(safe-area-inset-bottom)`.

## Responsive Patterns

### Page layout
```tsx
import { PageContainer } from '@/components/layout';

export default function ExamplePage() {
  return (
    <PageContainer title={t('page.title')}>
      {/* grid stacks on phone, 2-up on tablet, 3-up on desktop */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <GlassPanel>…</GlassPanel>
        <GlassPanel>…</GlassPanel>
        <GlassPanel>…</GlassPanel>
      </div>
    </PageContainer>
  );
}
```

### Tables with mobile column allowlist
```tsx
<DataTable
  columns={[
    { key: 'name',     header: 'Name',    render: r => r.name },
    { key: 'status',   header: 'Status',  render: r => r.status },
    { key: 'last_seen',header: 'Last',    render: r => r.last_seen },
    { key: 'odometer', header: 'Odometer',render: r => r.odometer },
  ]}
  // On <md only show name + status. The rest become hidden md:table-cell.
  mobileColumns={['name', 'status']}
  data={rows}
  keyExtractor={r => r.id}
/>
```

### Modals
```tsx
// Below sm, full-screen is forced regardless of `size`.
<Modal open={open} onClose={close} size="md" title={t('settings.title')}>
  …
</Modal>
```

### Charts
```tsx
import { ChartContainer, LineChart, Line, XAxis, YAxis } from '@/components/charts';

// ChartContainer uses ResponsiveContainer internally. Never set width="600".
<ChartContainer aspect={2.5}>
  <LineChart data={series}>…</LineChart>
</ChartContainer>
```

## Manual Viewport Verification

Before merging UI changes, open Chrome DevTools and walk Dashboard, Battery,
Drives, Charging, Settings in:

- **iPhone 14** (390 × 844) — primary mobile target
- **iPad mini** (744 × 1133) — tablet portrait, drawer + tab bar
- **Pixel 7** (412 × 915) — Android phone

Verify:
- No horizontal scroll on the page (only on opt-in tables with
  `overflow-x-auto`).
- All buttons reachable with the thumb (44 × 44 minimum, no clipped or
  off-screen actions).
- Text legible at default zoom (≥ 12px body, prefer `text-sm` / `text-base`).
- Sidebar accessible via the hamburger; closes on overlay tap and on
  navigation.
- BottomTabBar visible, all 5 tabs route correctly, active state visible.

## Audit

Run `pwsh scripts/mobile-audit.ps1` to refresh `docs/audits/mobile-audit.md`.
The script flags: pages without `grid-cols-1` base, tables without
`overflow-x-auto`, fixed pixel widths in `web/src/features/`, and Modal
usages that need review.

## Out of Scope (deferred)

- Standalone mobile app (React Native / Capacitor).
- Gesture navigation (swipe-to-go-back).
- Visual redesign — these guidelines fix layout breakage only.
