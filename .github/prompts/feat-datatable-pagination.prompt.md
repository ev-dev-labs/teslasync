---
description: "Add built-in pagination to DataTable — auto page-size selector + page controls. 51 usages get pagination for free."
---

# Feature: Add Pagination to DataTable Component

## Goal

Add optional built-in pagination to `DataTable` so ALL 51 table instances across the app
get consistent pagination with page-size selector (20/50/100), page navigation
(first/prev/next/last), and "Showing X–Y of Z" indicator — without changing any consuming pages.

## Current State

- `DataTable` at `web/src/components/ui/DataTable.tsx` (107 lines) — no pagination
- `Pagination` at `web/src/components/ui/Pagination.tsx` (57 lines) — standalone component with page-size selector, already has the exact UI needed
- 51 `<DataTable>` usages across the app — none paginated

## Design

Add an optional `pagination` prop to DataTable. When enabled, DataTable:
1. Manages internal page/pageSize state
2. Slices the data array to show only the current page
3. Renders the existing `Pagination` component below the table

### API

```typescript
// Opt-in — just add `pagination`
<DataTable columns={cols} data={drives} keyExtractor={d => d.id} pagination />

// With custom defaults
<DataTable columns={cols} data={drives} keyExtractor={d => d.id}
  pagination={{ defaultPageSize: 50, pageSizeOptions: [20, 50, 100, 200] }} />

// No pagination (default, backwards compatible)
<DataTable columns={cols} data={drives} keyExtractor={d => d.id} />
```

## Implementation

### Step 1 — Update DataTable props

In `web/src/components/ui/DataTable.tsx`, add pagination to the interface:

```typescript
interface PaginationConfig {
  defaultPageSize?: number;           // default: 25
  pageSizeOptions?: number[];         // default: [20, 50, 100]
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  emptyMessage?: string;
  className?: string;
  compact?: boolean;
  pagination?: boolean | PaginationConfig;  // NEW — opt-in pagination
}
```

### Step 2 — Add pagination state and slicing

Inside the DataTable component, add:

```typescript
import { Pagination } from './Pagination';

// Parse pagination config
const paginationEnabled = !!pagination;
const paginationConfig: PaginationConfig = typeof pagination === 'object' ? pagination : {};
const defaultPageSize = paginationConfig.defaultPageSize ?? 25;
const pageSizeOptions = paginationConfig.pageSizeOptions ?? [20, 50, 100];

// Pagination state
const [page, setPage] = useState(1);
const [pageSize, setPageSize] = useState(defaultPageSize);

// Reset to page 1 when data changes (e.g., filters applied)
useEffect(() => { setPage(1); }, [data.length]);

// Slice data for current page
const paginatedData = paginationEnabled
  ? data.slice((page - 1) * pageSize, page * pageSize)
  : data;
```

### Step 3 — Render paginated data + Pagination footer

Replace the `data.map(row => ...)` with `paginatedData.map(row => ...)`.

After the `</table>` closing tag, add:

```typescript
{paginationEnabled && data.length > 0 && (
  <Pagination
    page={page}
    pageSize={pageSize}
    total={data.length}
    onPageChange={setPage}
    onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
    pageSizeOptions={pageSizeOptions}
  />
)}
```

### Step 4 — Fix the Pagination component i18n

Update `web/src/components/ui/Pagination.tsx` to use proper i18n and shared components:

```typescript
// Replace hardcoded "Showing X–Y of Z" with i18n
// Replace raw <select> with shared <Select> if feasible, or keep as-is (it's in components/ui/)
// Replace raw <button> with styled buttons (already has proper styling)

// Add aria-labels for accessibility
<button aria-label="First page" ... />
<button aria-label="Previous page" ... />
<button aria-label="Next page" ... />
<button aria-label="Last page" ... />
```

The `Pagination` component is in `components/ui/` so raw HTML elements are acceptable here
(it IS a shared component). But do add `aria-label` attributes.

### Step 5 — Verify backwards compatibility

**CRITICAL:** The `pagination` prop is optional and defaults to undefined/false.
All 51 existing DataTable usages must work exactly as before — no pagination, full data rendered.

Only when `pagination` or `pagination={{ ... }}` is explicitly passed does pagination activate.

## DO enable pagination on ALL existing DataTable usages

After updating the component, add `pagination` to ALL 51 DataTable instances across the app.
Default page size is 25 — no need to pass config unless a different size is needed.

**Find all usages:**
```bash
grep -rn "<DataTable" web/src/features/ --include="*.tsx"
```

**For each usage, add `pagination`:**
```tsx
// BEFORE
<DataTable columns={cols} data={drives} keyExtractor={d => d.id} />

// AFTER
<DataTable columns={cols} data={drives} keyExtractor={d => d.id} pagination />
```

**Exceptions — use larger page size for these tables:**
- Signal log/history tables: `pagination={{ defaultPageSize: 50 }}` (high-volume data)
- Audit/API logs tables: `pagination={{ defaultPageSize: 50 }}` (high-volume data)
- Small reference tables (< 10 rows typically): skip pagination

## Verification

```bash
cd web
npx tsc --noEmit

# DataTable should now import Pagination
grep -n "Pagination" src/components/ui/DataTable.tsx

# Pagination props should include pageSize state
grep -n "pageSize\|pagination" src/components/ui/DataTable.tsx

# NO consuming pages should be changed
git diff --name-only | grep -v "components/ui/"
# Should return nothing (or only DataTable.tsx and Pagination.tsx)
```

**COMPLETION DEFINITION:**
- [ ] DataTable accepts optional `pagination` prop (boolean or config object)
- [ ] Default page size is 25
- [ ] When enabled: manages page/pageSize state internally
- [ ] When enabled: slices data to current page
- [ ] When enabled: renders Pagination component below table
- [ ] When disabled: works exactly as before — no regression
- [ ] Pagination component has aria-labels for accessibility
- [ ] Page resets to 1 when data length changes
- [ ] ALL 51 DataTable usages have `pagination` added
- [ ] Signal/audit log tables use `pagination={{ defaultPageSize: 50 }}`
- [ ] TypeScript compiles clean
- [ ] Exported types updated (PaginationConfig in barrel)
