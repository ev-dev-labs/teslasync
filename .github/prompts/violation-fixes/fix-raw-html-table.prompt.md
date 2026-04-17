# Fix Raw HTML Table — Replace `<table>` with `<DataTable>` Component

## Rule: `raw-html-table`

Raw HTML `<table>`, `<thead>`, `<tbody>`, `<tr>`, `<th>`, `<td>` elements must be replaced with the shared `<DataTable>` component from `@/components/ui`.

## File to Fix (1 violation)

### `web/src/components/SignalQueryControls.tsx` — Line 271

**Current code (lines 269-298):**
```tsx
<GlassPanel className="overflow-hidden">
  <div className="overflow-x-auto">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-white/[0.06]">
          <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">#</th>
          <th className="...">Timestamp</th>
          <th className="...">Signal</th>
          <th className="...">Value</th>
          <th className="...">Type</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry, i) => (
          <tr key={i} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
            <td className="px-3 py-2 text-[var(--text-muted)] font-mono">{(page - 1) * perPage + i + 1}</td>
            <td className="px-3 py-2 font-mono text-[var(--text-secondary)]">{formatTimestampMs(entry.created_at)}</td>
            <td className="px-3 py-2 font-mono text-[var(--text-primary)]">{entry.signal}</td>
            <td className={clsx('px-3 py-2 font-mono', TYPE_VALUE_COLOR[vt])}>{formatValue(entry)}</td>
            <td className="px-3 py-2"><Badge color={TYPE_BADGE_COLOR[vt]}>{vt}</Badge></td>
          </tr>
        ))}
        {rows.length === 0 && (
          <tr><td colSpan={5} className="...">No results</td></tr>
        )}
      </tbody>
    </table>
  </div>

  {/* Pagination */}
  ...
</GlassPanel>
```

## Fix Instructions

### Step 1: Understand `DataTable` API

Read the `DataTable` component to understand its props:
```bash
cat web/src/components/ui/DataTable.tsx | head -80
```

The `DataTable` component uses a `Column[]` definition and renders the table automatically. It imports as:
```typescript
import { DataTable, type Column } from '@/components/ui'
```

### Step 2: Define Columns

Create a columns definition for the signal data table. The exact type of each row entry needs to be determined by reading the component — look at the `rows` prop type and the `SignalDataTableProps` interface.

```typescript
// Determine the row type from the existing code
// It appears to have: created_at, signal, value fields

const columns: Column<RowType>[] = [
  {
    key: 'index',
    header: '#',
    render: (_row, i) => (page - 1) * perPage + i + 1,
    className: 'text-white/40 font-mono',
  },
  {
    key: 'created_at',
    header: 'Timestamp',
    render: (row) => formatTimestampMs(row.created_at),
    className: 'font-mono text-white/60',
  },
  {
    key: 'signal',
    header: 'Signal',
    render: (row) => row.signal,
    className: 'font-mono text-white/90',
  },
  {
    key: 'value',
    header: 'Value',
    render: (row) => {
      const vt = getValueType(row)
      return <span className={TYPE_VALUE_COLOR[vt]}>{formatValue(row)}</span>
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
```

**NOTE:** The exact column definition API depends on how `DataTable` is implemented. Read the component first and adapt accordingly. The `Column` type may use `accessor` instead of `key`, or `label` instead of `header`, or `cell` instead of `render`.

### Step 3: Replace the Table

Replace the entire `<table>...</table>` block with:
```tsx
<DataTable
  columns={columns}
  data={rows}
  emptyMessage="No results"
/>
```

### Step 4: Preserve Pagination

The pagination section below the table (lines 301-311) should remain as-is if `DataTable` doesn't include built-in pagination. If `DataTable` has pagination props, use those instead.

Check if DataTable supports pagination:
```bash
grep -n "pagination\|page\|pageSize\|onPageChange" web/src/components/ui/DataTable.tsx
```

### Step 5: Preserve Loading State

The `SignalDataTable` function also has a loading state check at the top (lines 264-266). Keep that — `DataTable` may or may not have a `loading` prop.

### Step 6: Remove Unused Imports

After conversion, check if `clsx` is still needed (it was used for the value column className). If not, remove the import. Also check if any `<th>`/`<td>` specific styling classes are no longer needed.

### Step 7: Also Fix CSS Variable Usage

While fixing the table, also note that the raw `<table>` uses `text-[var(--text-muted)]`, `text-[var(--text-secondary)]`, `text-[var(--text-primary)]` in Tailwind arbitrary value syntax. These should also be converted:
- `text-[var(--text-muted)]` → `text-white/40`
- `text-[var(--text-secondary)]` → `text-white/60`
- `text-[var(--text-primary)]` → `text-white/90`

## Verification

After changes:

```bash
cd web && npx tsc --noEmit
```

Must compile with zero errors. Specifically verify:
- `Column` type is correctly imported and used
- Row type matches the `DataTable` generic parameter
- All render functions return valid ReactNode
- Pagination still works (page navigation, page count display)
- Empty state ("No results") still displays when `rows.length === 0`
- Loading skeleton still works

Also verify no raw table elements remain:
```bash
grep -n "<table\|<thead\|<tbody\|<tr\|<th\|<td" web/src/components/SignalQueryControls.tsx
```

This should return zero matches after the fix.
