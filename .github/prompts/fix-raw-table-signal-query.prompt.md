# Fix Raw HTML Table — SignalQueryControls (1 violation)

> **Context**: The audit found 1 `[raw-html-table]` violation in
> `web/src/components/SignalQueryControls.tsx` at line 271.
> A raw `<table>` element is used instead of the shared `<DataTable>` component.

---

## ⛔ Rules

- **DO NOT** change the component's props interface, hook logic, or parent integration.
- **DO** replace the raw `<table>` with `<DataTable>` from `@/components/ui`.
- **DO** preserve all existing functionality: row numbering, value formatting, type badges, pagination, loading skeleton, empty state.
- The `<DataTable>` component accepts `columns: Column<T>[]` and `data: T[]` props.
- Pagination is **external** (the component already manages page state via props) — do NOT use DataTable's built-in pagination if it conflicts. Keep the existing pagination controls below the table.
- After changes, run `npx tsc --noEmit` and `audit_code`.

---

## Current Implementation (lines 263–315)

The `SignalDataTable` component renders:
1. A loading skeleton (lines 264–266)
2. A `<table>` with 5 columns: `#`, `Timestamp`, `Signal`, `Value`, `Type` (lines 271–298)
3. An empty state row when `rows.length === 0` (lines 294–296)
4. External pagination controls (lines 302–312)

---

## Target Implementation

Replace the raw `<table>` with `<DataTable>` from `@/components/ui`.

```tsx
import { DataTable, type Column } from '@/components/ui'
```

Define columns outside the component (stable reference):

```tsx
// Helper: build columns for signal data table
function buildSignalColumns(page: number, perPage: number): Column<SignalLogEntry>[] {
  return [
    {
      key: '_rowNum',
      header: '#',
      render: (_row, index) => (
        <span className="text-[var(--text-muted)] font-mono">{(page - 1) * perPage + (index ?? 0) + 1}</span>
      ),
    },
    {
      key: 'created_at',
      header: 'Timestamp',
      render: (row) => (
        <span className="font-mono text-[var(--text-secondary)]">{formatTimestampMs(row.created_at)}</span>
      ),
    },
    {
      key: 'signal',
      header: 'Signal',
      render: (row) => (
        <span className="font-mono text-[var(--text-primary)]">{row.signal}</span>
      ),
    },
    {
      key: 'value',
      header: 'Value',
      render: (row) => {
        const vt = getValueType(row)
        return <span className={clsx('font-mono', TYPE_VALUE_COLOR[vt])}>{formatValue(row)}</span>
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => {
        const vt = getValueType(row)
        return <Badge color={TYPE_BADGE_COLOR[vt]}>{vt}</Badge>
      },
    },
  ]
}
```

**Important**: Check the actual `DataTable` `Column` type signature in `web/src/components/ui/DataTable.tsx`. The `render` function signature may be `(row: T) => ReactNode` or `(row: T, index: number) => ReactNode`. Adapt accordingly. If `index` is not available in the render callback, compute row number from the `rows` array index using `rows.indexOf(row)` or pass `page` and `perPage` into the render closure.

Then in `SignalDataTable`:

```tsx
export function SignalDataTable({ rows, page, totalPages, total, perPage, onPageChange, loading }: SignalDataTableProps) {
  if (loading) {
    return (
      <GlassPanel className="p-4">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-8 rounded bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </GlassPanel>
    )
  }

  const columns = buildSignalColumns(page, perPage)

  return (
    <GlassPanel className="overflow-hidden">
      <DataTable
        columns={columns}
        data={rows}
        emptyMessage="No results"
      />

      {/* External pagination — keep as-is */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.06]">
          {/* ... existing pagination buttons unchanged ... */}
        </div>
      )}
    </GlassPanel>
  )
}
```

**Also replace the pagination `<button>` elements** with `<Button>` from `@/components/ui` if they are flagged as raw HTML. Currently the pagination uses raw `<button>` elements (lines 306–310). Replace with:

```tsx
import { Button } from '@/components/ui'

<Button variant="ghost" size="sm" onClick={() => onPageChange(1)} disabled={page <= 1}>
  <ChevronsLeft className="h-3.5 w-3.5" />
</Button>
```

Adjust `variant`/`size` props to match the existing visual style (small, transparent background, hover effect).

---

## Verification

```bash
cd web
npx tsc --noEmit          # must compile cleanly
```

Then run `audit_code` on `web/src/components/SignalQueryControls.tsx` — should show **0 violations**.
