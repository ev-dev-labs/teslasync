# Table guidelines

`<DataTable>` from `@/components/ui` is the canonical table for TeslaSync.
Phase-40 / Prompt 25 extended it with optional column visibility, resizing,
sticky header, row selection, bulk actions, and row expansion. All new props
are opt-in except that persistent DataTables now default to shared column
controls. The shared default
presentation is a theme-neutral frame, wrapping toolbar, restrained headers,
alternating rows, and selected-row marker. Caller-supplied `className` styling
remains on the scroll viewport; use it for intentional specialized layouts,
not copies of generic descendant chrome.

`<Table>` is the semantic primitive for matrices, schedules, and other complex
markup. It retains native captions, column/row scopes, merged cells, and footer
content, and contains horizontal scrolling in its own width-constrained frame.
It does **not** add sorting, selection, filters, pagination, or export controls.
Its neutral outer frame and contained viewport reuse DataTable's tokens; compact
matrix cells keep caller-owned actions, captions, and merged-header structure.
Hover and focus-within feedback make embedded actions discoverable without
turning matrix rows into interactive grid controls.

## App-wide UI casing

Use sentence case for UI labels, page and section headings, column names,
buttons, filter controls, and accessible labels throughout the application.
Capitalize the first word and retain intentional casing elsewhere: "Drive
history", "Average speed", "Export CSV", and "Tesla API status".

Preserve acronyms such as FSD, CSV, JSON, API, VIN, and SI; units such as km/h,
Wh, and kPa; proper names and brands; and user-authored or source data. This
policy does not rewrite enum values, identifiers, URLs, vehicle names, or other
data to resemble presentation labels.

Author translated labels in sentence case in the catalogs. Shared table,
header, and filter styles must not force `uppercase` or `capitalize`, and
components must not lowercase or title-case translated labels or data at
runtime. Apply the same rules to semantic Table captions and complex matrix
headers without changing their accessibility or formatting semantics.

## Quick reference — when to enable what

| Symptom                                                    | Prop to enable                                     |
| ---------------------------------------------------------- | -------------------------------------------------- |
| Long lists where users lose the header while scrolling     | `stickyHeader` + `maxHeight`                       |
| 6+ columns; users care about different ones                | `showColumnsMenu` + `tableId` + `defaultVisible`   |
| Phone users get sideways-scroll because table is too wide  | `Column.visibleOnMobile` (or `mobileColumns` prop) |
| Users export / archive / acknowledge multiple rows         | `selectable="multi"` + `bulkActions`               |
| One important field per row but the rest is reference data | `expandable` + `renderExpanded`                    |
| Table has a column where width matters (URL, JSON blob)    | `resizable` + `tableId` + `defaultWidth`           |
| Users need a different evidence-column order               | `columnReorder` + `tableId`                        |
| A fully loaded list needs searchable checkbox filters      | `enableValueFilters` + `Column.filterValue`        |

## Persistence

With `tableId`, resize, reorder, and visibility are enabled by default and share
one Columns menu on the existing toolbar. Without `tableId`, those controls
remain disabled. Explicit `resizable={false}`, `columnReorder={false}`, and
`columnVisibility={false}` opt out independently. The legacy
`showColumnsMenu={false}` also opts out of default visibility; if either
visibility alias is explicitly true, the existing OR behavior is preserved.
Disabling visibility alone leaves the reorder menu if reorder remains enabled.

For fixed-axis or otherwise specialized DataTables, supply all three false
props; semantic Table matrices never acquire interactive column controls.
Mobile allow-lists, default hidden columns, and persisted layouts are unchanged.
Column menus now announce "Reorder or hide columns" when both controls are
enabled; tests and help text must account for that intentional default change.
Sortable buttons require both `Column.sortable` and a caller-owned `onSort`;
the shared component does not invent local or server sorting.

When `tableId` is set, relevant controls persist their preferences:

- `teslasync.table.${tableId}.columns` — current column order and hidden keys
- `teslasync.table.${tableId}.visible` — legacy visible-key array, retained for compatibility
- `teslasync.table.${tableId}.widths`  — JSON map of `{ [key]: pxWidth }`
- `teslasync.table.${tableId}.page-size` — validated client page size

Choose a stable `tableId` once and never rename it (renames orphan the
user's preferences). New IDs should be scoped, e.g. `drives:evidence` or
`admin:audit-logs`. IDs are persistence keys, not visible section headings.
Use `toolbarHeading` for a genuine page-owned heading and `caption` for a
human-readable accessible name.

## Column metadata

For a source-record download whose schema differs from the display columns,
use `onExport(format, rows, scope)` on `DataTable`. It receives original matching
loaded rows after local search/value filters, or selected loaded rows for the
selected scope. With `exportAll`, non-selected exports receive its full-result
rows instead. Client pagination and hidden columns do not trim this payload.
The callback owns serialization and downloads; rejected promises use the
existing export-menu error surface. Without this callback, `exportRow` and
`Column.exportValue` retain the default visible-column projection.
Explicit `controls.exports` still takes precedence and owns its own scope.

Every `Column<T>` accepts these optional fields in addition to the original
`{ key, header, render, sortable, className }`:

| Field             | Purpose                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `defaultVisible`  | Hide the column initially (still listed in the columns menu so users can show it).       |
| `visibleOnMobile` | Keep the column visible at <md viewports. Derives `mobileColumns` when not supplied.     |
| `defaultWidth`    | Initial width in px (or `'auto'`). User drags persist over this.                         |
| `minWidth` / `maxWidth` | Clamp values used by the resize handle.                                            |
| `align`           | `'left'` (default) / `'center'` / `'right'`. Right-align numeric columns.                |
| `filter`          | Shared controls displayed in a popover opened by the column header's filter icon. |
| `filterActive` / `onFilterClear` | Indicate an applied filter and supply its Clear action. |
| `filterValue` | Canonical `string \| number \| boolean \| null` accessor for opt-in local value filtering. Use raw SI readings, not formatted display units. |
| `filterValueLabel` | Optional `(value, row) => string` display formatter, applied only to the checkbox label. |
| `groupStart` | Subtle divider before a column group, in both its header and cells, including after reordering. |

## Shared loaded-row value filters

Enable `enableValueFilters` only for a genuinely local loaded collection; its
default is `false`. Columns with `filterValue` receive a searchable
`DataTableValueFilter` inside their header popover. Other columns retain existing
`filter` behavior. A column with both forms keeps its legacy conditions inside
an Accordion. Clear removes the local value choice and calls `onFilterClear`
for the caller-owned condition.

`filterData` optionally supplies the full **loaded** candidate collection,
independent of caller-owned search/conditions in `data`. Counts are occurrences
in that loaded collection, not distinct keys, and never imply unlimited server
coverage. Applied local filters show matching/loaded row counts. Filters combine
across columns before the table's own client pagination, export, and select-all;
incoming sort order is preserved. Existing controlled row selections are not
discarded by filtering. Ordinary CSV exports contain all matching loaded rows,
not just the displayed client page. Bulk actions receive selected rows from the
incoming `data` even when a local value filter hides them, and the selection
count includes those hidden selections. With active internal value filters,
select-all adds matching keys to the existing selection; deselect-all removes
only matching keys. Explicit Clear selection still clears the complete
controlled selection. Keys whose records are absent from `data` remain in
`selectedKeys`, but resolving/exporting those records stays caller-owned.
The same preservation applies when search or replacing-page data limits the
current collection: select-all adds only its matching keys, and deselect-all
removes only those keys. Neither operation clears selections owned by other
pages. Explicit Clear selection still clears the complete selection.

The opt-in `mobilePresentation` uses that same DataTable pipeline. Its reveal
limit is independent of desktop pagination; revealing more mobile records must
not rewrite a caller's controlled page or the desktop page-size preference.
Returning to desktop restores the existing pagination behavior. Mobile details
render null or undefined values as unknown (`—`), not a blank or fabricated zero;
recorded numeric zero remains zero. Masking and caller-owned detail renderers
retain priority. Import `MobileDataTablePresentation`, `MobileDataTableDetail`
and `MobileTableRowKey` from `@/components/ui`.

`exportAll` remains caller-owned server export behavior, is not filtered by
loaded-row choices, and remains available when those choices match zero rows
but the incoming loaded dataset is nonempty. Callers must explicitly apply any
intended server-side scope there.

```tsx
const columns: Column<Reading>[] = [{
  key: 'distance',
  header: t('readings.distance', 'Distance'),
  align: 'right',
  filterValue: row => row.distance_m,
  filterValueLabel: value => value == null ? '—' : formatDistance(Number(value)),
  render: row => formatDistance(row.distance_m),
}];

<DataTable columns={columns} data={searchedRows} filterData={loadedRows}
  keyExtractor={row => row.id} enableValueFilters pagination />
```

Without an explicit formatter, the shared safe rendered-text extraction provides
a label, then falls back to the raw value. Raw null readings default to unknown
(`—`) without reading a renderer that might substitute zero. Unknown readings
also retain a distinct checkbox bucket if an explicit formatter gives them the
same label as a recorded value. Canonical keys always come from
`filterValue`, even when several raw readings share one rounded display label.
Use an explicit formatter for component-based cells whose text cannot be read
without mounting the component.

The generic selection is local in-memory UI state, with no Router requirement
and no automatic URL/localStorage persistence. Applications that already own
URL filters (Drive History's `grid_values`, for example) retain that contract
and use the exported helpers plus `DataTableValueFilter`, rather than enabling
a second independent filter state.

Shared helpers exported from `@/components/ui`:
`tableValueKey`, `buildTableFilterValues`, `parseTableValueSelections`,
`compactTableValueSelection`, `matchesTableValueSelection`, and
`selectedTableValueKeys`, plus their raw-value/selection types. Parsing reports
`invalid` explicitly; callers must show a reset/error state, never silently
treat invalid saved state as success. An absent selection means all; an empty
inclusion means none. Compact exclusions include future loaded values except
those explicitly excluded.

Never automatically enable these filters on a server-paginated source. Extend
its backend filtering contract when full-server filtering is needed; do not
claim that checkbox counts cover rows that have not been loaded.

Keep column filters closed by default; do not reserve an always-visible input
row. Apply filters and sorting to the complete fetched result **before**
pagination, and keep the header available when no rows match so users can clear
their filters. Drive evidence stores its column filters in URL state alongside
the workspace range. Use `toolbarActions` for page-owned CSV/JSON downloads
beside the Columns menu, rather than a second export row.
Use `toolbarHeading` for the section title and count on that same toolbar.
The shared table root and scroll viewport are width-constrained in flex/grid
parents; wide columns scroll inside the table, not the page. Toolbar controls
wrap on narrow screens without being hidden. Use `visibleOnMobile` or
`mobileColumns` for a deliberate small-screen subset, not automatic data loss.
Drive History retains its mobile cards below 1,024px. Set
`showSelectionSummary={false}` when the page already owns the selection/action
toolbar, avoiding duplicate counts and keeping the heading/actions aligned.
Drive evidence uses single-line cells with separate Start/Destination columns,
right-aligned measurements, and units in headers. Battery start/end/used are
separate columns; used is start minus end, in percentage points. Only meaningful
indicators sit beside numbers: battery silhouettes show actual charge out of
100%, efficiency segments show the SI grade, and the optional drive-score ring
uses a fixed 100-point scale. Other measurements are plain numbers, never
compared against the largest drive. Secondary
metrics are opt-in columns; warning indicators remain visible beside dates.
The extended grid also exposes maximum speed, average power, outside/cabin
temperature, Energy, Regen, FSD, drive score, efficiency grade, estimated cost,
and status. Missing readings stay unknown; do not substitute average power
for peak power or invent a net-energy figure without a defined API contract.
Distance, speed, temperature, and consumption follow saved display units.
Semantic colors use the shared battery/health thresholds and SI efficiency
grades; numeric text remains neutral and readable in both themes.
The evidence grid uses one restrained frame around its heading and actions,
a stronger neutral header, soft alternating rows, and subtle dividers before
the battery, energy, and FSD groups. Selected rows retain their own background
and an inset leading marker, including on alternating rows; keyboard focus and
hover remain visible. Use theme surface/text tokens rather than neon accents.

Use `DataTableValueFilter` in the header popover for Excel-style value lists:
search, mixed-state Select all, checkboxes, and occurrence counts. Drive evidence
builds options from the entire loaded date window (up to 1,000 rows), not the
current page. Counts describe loaded drives, not guaranteed full-server coverage.
Choices use canonical raw keys in `grid_values` so they survive unit changes;
display-equivalent values share one checkbox. An absent selection means all
values, while an empty selection means no rows. Selections across columns are
combined before pagination and remain editable when no rows match. Clear resets
that column's value selection and its condition in one URL update. Existing
minimum, substring, collection, and confidence conditions remain available in
collapsed sections. Invalid saved filters show an explicit reset message.
Filter panels use a search icon and clear-search control, grouped option lists,
neutral count badges, and an Active badge for applied filters. These are visual
cues only; filtering remains live and Done closes the panel without changing
the selected values.
Large selections are stored as compact exclusions when shorter; future loaded
values are included unless excluded. Small explicit selections stay inclusive.

## Selection conventions

- Use `selectable="multi"` for any list where bulk export, bulk archive, or
  bulk acknowledge is meaningful. Use `selectable="single"` only when the
  selection drives a sidebar/preview pane.
- Drive `selectedKeys` from `useState`; keep it lifted in the page so a
  parent toolbar can read it. Pair with `useTableSelection()` for boilerplate
  reduction.
- Shift-click extends the range from the last clicked row (additive, not
  replacing).
- - The header checkbox toggles the entire locally filtered data set, not just the visible page.
- Use the shared `Checkbox` for table and column-menu selection (and for
  checkboxes in page forms). Checked and mixed states have a solid fill and a
  visible glyph; the header shows the mixed state when only some rows are
  selected. Do not use a native checkbox with ad-hoc styling.

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

`columnReorder` provides header drag handles and column-menu reorder controls;
`columnVisibility` (or its legacy `showColumnsMenu` alias) provides visibility.
The shared order layout survives reloads while retaining defaults for newly
introduced optional columns.

## Density and metric indicators

The DataTable default remains `density="auto"` and follows the application's
global density. Explicit `density="compact"` and legacy `compact` retain their
32px-row defaults; comfortable/spacious overrides remain available. The
semantic Table primitive uses compact cell padding without overriding caller
matrix classes.

`GridMetricIndicator` from `@/components/data-display` renders only the neutral
number and small semantic indicator. Callers supply the fixed-scale fraction,
meaningful band, title, and optional grade segments; it does not infer thresholds
or compare with the largest loaded row. Domain wrappers own SI thresholds,
display conversion, missing-data behavior, and translated descriptions.

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

- In-cell editing
- Server-side pagination (current pagination is client-side only)
- Replacing the in-house API with TanStack Table
