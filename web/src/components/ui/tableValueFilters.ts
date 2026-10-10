import type { TableFilterValue } from './DataTableValueFilter';

export type TableRawValue = string | number | boolean | null;
export type TableValueSelection = string[] | { excluded: string[] };
export type TableValueSelections<K extends string = string> = Partial<Record<K, TableValueSelection>>;

export function tableValueKey(value: TableRawValue): string {
  return JSON.stringify(value ?? null);
}

function isValueKeys(values: unknown): values is string[] {
  return Array.isArray(values) && values.every((value) => {
    if (typeof value !== 'string') return false;
    try {
      const decoded: unknown = JSON.parse(value);
      return (decoded === null || typeof decoded === 'string' || typeof decoded === 'boolean'
        || (typeof decoded === 'number' && Number.isFinite(decoded)))
        && JSON.stringify(decoded) === value;
    } catch {
      return false;
    }
  });
}

export function parseTableValueSelections<K extends string>(
  raw: string, columns: readonly K[],
): { selections: TableValueSelections<K>; invalid: boolean } {
  if (!raw) return { selections: {}, invalid: false };
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { selections: {}, invalid: true };
  }
  if (decoded == null || typeof decoded !== 'object' || Array.isArray(decoded)) return { selections: {}, invalid: true };
  const selections: TableValueSelections<K> = {};
  for (const [key, values] of Object.entries(decoded)) {
    const column = columns.find((item) => item === key);
    if (!column) return { selections: {}, invalid: true };
    if (isValueKeys(values)) selections[column] = Array.from(new Set(values));
    else if (values != null && typeof values === 'object' && 'excluded' in values
      && Object.keys(values).length === 1 && isValueKeys(values.excluded)) {
      selections[column] = { excluded: Array.from(new Set(values.excluded)) };
    } else return { selections: {}, invalid: true };
  }
  return { selections, invalid: false };
}

export function compactTableValueSelection(selected: string[], available: string[]): TableValueSelection {
  const all = new Set(available);
  const chosen = new Set(selected);
  const excluded = available.filter((value) => !chosen.has(value));
  return selected.every((value) => all.has(value)) && JSON.stringify(excluded).length < JSON.stringify(selected).length
    ? { excluded }
    : selected;
}

export function matchesTableValueSelection(value: TableRawValue, selection?: TableValueSelection): boolean {
  if (selection == null) return true;
  const key = tableValueKey(value);
  return Array.isArray(selection) ? selection.includes(key) : !selection.excluded.includes(key);
}

export function selectedTableValueKeys(selection: TableValueSelection | undefined, available: string[]): string[] | null {
  return selection == null ? null : Array.isArray(selection) ? selection
    : available.filter((key) => !selection.excluded.includes(key));
}

/** Display-equivalent readings share a checkbox, but retain every canonical key. */
export function buildTableFilterValues<T>(
  rows: readonly T[],
  valueFor: (row: T) => TableRawValue,
  labelFor: (value: TableRawValue, row: T) => string,
): TableFilterValue[] {
  const groups = new Map<string, TableFilterValue & { sortValue: TableRawValue }>();
  for (const row of rows) {
    const value = valueFor(row) ?? null;
    const label = labelFor(value, row);
    const key = tableValueKey(value);
    const groupKey = JSON.stringify([value === null, label]);
    const group = groups.get(groupKey);
    if (group) {
      group.count += 1;
      if (!group.keys?.includes(key)) group.keys?.push(key);
    } else {
      groups.set(groupKey, { value: groupKey, label, count: 1, keys: [key], sortValue: value });
    }
  }
  return Array.from(groups.values()).sort((left, right) => {
    if (left.sortValue == null) return right.sortValue == null ? 0 : 1;
    if (right.sortValue == null) return -1;
    return typeof left.sortValue === 'number' && typeof right.sortValue === 'number'
      ? left.sortValue - right.sortValue
      : left.label.localeCompare(right.label, undefined, { numeric: true });
  });
}
