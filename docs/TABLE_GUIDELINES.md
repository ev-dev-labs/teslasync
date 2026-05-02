# Table Guidelines (Phase-40 / Prompt 25)

`<DataTable>` from `@/components/ui` is the canonical table for TeslaSync.
Phase-40 / Prompt 25 extended it with optional column visibility, resizing,
sticky header, row selection, bulk actions, and row expansion. All new props
are opt-in — existing call sites continue to work unchanged.

## Quick reference — when to enable what

| Symptom                                                    | Prop to enable                                     |
| ---------------------------------------------------------- | -------------------------------------------------- |
| Long lists where users lose the header while scrolling     | `stickyHeader` + `maxHeight`                       |
| 6+ columns; users care about different ones                | `showColumnsMenu` + `tableId` + `defaultVisible`   |
| Phone users get sideways-scroll because table is too wide  | `Column.visibleOnMobile` (or `mobileColumns` prop) |
| Users export / archive / acknowledge multiple rows         | `selectable="multi"` + `bulkActions`               |
| One important field per row but the rest is reference data | `expandable` + `renderExpanded`                    |
| Table has a column where width matters (URL, JSON blob)    | `resizable` + `tableId` + `defaultWidth`           |

## Persistence

When `tableId` is set, two `localStorage` entries are written automatically:

- `teslasync.table.${tableId}.visible` — JSON array of visible column keys
- `teslasync.table.${tableId}.widths`  — JSON map of `{ [key]: pxWidth }`

Choose a stable `tableId` once and never rename it (renames orphan the
user's preferences). Use kebab-case scoped to the page, e.g.
`tesla-charging-history` or `notification-logs`.

## Column metadata

Every `Column<T>` accepts these optional fields in addition to the original
`{ key, header, render, sortable, className }`:

| Field             | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `defaultVisible`  | Hide the column initially (still listed in the columns menu so users can show it).       |
| `visibleOnMobile` | Keep the column visible at <md viewports. Derives `mobileColumns` when not supplied.     |
| `defaultWidth`    | Initial width in px (or `'auto'`). User drags persist over this.                         |
| `minWidth` / `maxWidth` | Clamp values used by the resize handle.                                            |
| `align`           | `'left'` (default) / `'center'` / `'right'`. Right-align numeric columns.                |

## Selection conventions

- Use `selectable="multi"` for any list where bulk export, bulk archive, or
  bulk acknowledge is meaningful. Use `selectable="single"` only when the
  selection drives a sidebar/preview pane.
- Drive `selectedKeys` from `useState`; keep it lifted in the page so a
  parent toolbar can read it. Pair with `useTableSelection()` for boilerplate
  reduction.
- Shift-click extends the range from the last clicked row (additive, not
  replacing).
- The header checkbox toggles the entire data set, not just the visible page.

## Bulk-action toolbar

When at least one row is selected, the toolbar appears above the table:

```
[3 selected]                         [Export CSV] [Archive] [✕ Clear selection]
```

Conventions:

- Show "{n} selected" + 1–4 action buttons + the built-in "Clear selection".
- Destructive actions (delete, archive, factory-reset) **must** go through
  `<ConfirmDialog>` via `useConfirm()` — do NOT trigger them on the first
  click.
- More than 4 actions → collapse the rest behind a `<Menu>` ("More…").
- Toast feedback: use `useMutationToast()` from `@/api/hooks/_toastHelpers`
  with i18n-aware keys (`toast.<feature>.bulkExport.success`, …).
- After a successful bulk mutation, clear the selection (`onSelectionChange([])`).

## Sticky header recipe

```tsx
<DataTable
  columns={columns}
  data={rows}
  keyExtractor={r => r.id}
  stickyHeader
  maxHeight={600}        // matches the panel/glass card the table sits in
/>
```

`maxHeight` accepts a number (px) or any CSS string (`'70vh'`). Without
`maxHeight`, sticky has nothing to scroll inside, so always pair them.

## Row expansion recipe

```tsx
const [expandedKeys, setExpandedKeys] = useState<(string | number)[]>([]);

<DataTable
  ...
  expandable
  expandedKeys={expandedKeys}
  onExpandedChange={setExpandedKeys}
  renderExpanded={row => <pre>{JSON.stringify(row, null, 2)}</pre>}
/>
```

A leading chevron column is added automatically. `Enter` on the row also
toggles expansion when the row is focused.

## Resize recipe

```tsx
<DataTable
  ...
  tableId="signal-log"   // required — widths are persisted by id
  resizable
  columns={[
    { key: 'time',  header: 'Time',  defaultWidth: 160, render: ... },
    { key: 'value', header: 'Value', defaultWidth: 240, minWidth: 120, render: ... },
  ]}
/>
```

Keyboard support on the resizer handle: `←` / `→` adjusts by 8px,
`Home` resets to 80px, `End` jumps to `maxWidth`.

## Accessibility checklist

- Sticky header rows render with the same `<th>` semantics; screen readers
  still announce them as column headers.
- Each row checkbox has an `aria-label` ("Select row" / "Deselect row").
- The bulk-action toolbar is wrapped in `<div role="region">` so AT users can
  jump to it via landmarks.
- Expand buttons toggle `aria-expanded` on the trigger so AT announces the
  state change.
- The columns menu is a `<div role="menu">` with `aria-labelledby` on the
  trigger button.

## Anti-patterns

- ❌ Don't use `mobileColumns` AND set `visibleOnMobile` on every column —
  the prop wins. Pick one mechanism per table.
- ❌ Don't render destructive bulk actions without a `<ConfirmDialog>`.
- ❌ Don't forget `tableId` when enabling `resizable` or `showColumnsMenu` —
  without it, persistence is silently disabled.
- ❌ Don't put more than 4 buttons in the bulk toolbar; collapse to "More…".
- ❌ Don't resize a column to less than its `minWidth` / more than `maxWidth`
  (the handle clamps automatically; pick sensible bounds in the column def).

## Out of scope (deferred)

- Drag-to-reorder columns
- In-cell editing
- Server-side pagination (current pagination is client-side only)
- Replacing the in-house API with TanStack Table
