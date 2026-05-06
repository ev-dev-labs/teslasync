/**
 * Phase-46 / Prompt 13 — chart accessibility helpers.
 *
 * Builds the `data` + `dataColumns` payload `<ChartContainer>`'s
 * SR/forced-colors fallback table expects, from a generic time-series
 * row shape. Reduces caller boilerplate so a typical adoption looks
 * like:
 *
 * ```tsx
 * const { data: tableData, dataColumns } = chartRowsFromTimeseries(rows, [
 *   { key: 'time', label: t('chart.col.time', 'Time') },
 *   { key: 'kwh',  label: t('chart.col.energy', 'Energy (kWh)'),
 *     format: (v) => formatKWh(v as number) },
 * ]);
 * <ChartContainer data={tableData} dataColumns={dataColumns} ariaLabel={…}>
 *   …recharts…
 * </ChartContainer>
 * ```
 *
 * The helper is intentionally type-light: it accepts the row keys as
 * `keyof T & string` so a typo in `key` fails at the call site rather
 * than producing a missing column at runtime.
 */

import type { ChartDataColumn, ChartDataRow } from '@/components/charts/ChartContainer';

/**
 * Field declaration consumed by {@link chartRowsFromTimeseries}.
 * Mirrors {@link ChartDataColumn} but constrains `key` to a known
 * field of the input row shape.
 */
export interface ChartA11yField<T> {
  /** Property of `T` to project into the fallback table. */
  key: keyof T & string;
  /** Pre-localized header text. */
  label: string;
  /** Optional unit-aware formatter — runs once per cell. */
  format?: (value: unknown) => string;
}

/**
 * Result of {@link chartRowsFromTimeseries}, ready to spread into
 * `<ChartContainer data=… dataColumns=… />`.
 */
export interface ChartA11yPayload {
  data: ChartDataRow[];
  dataColumns: ChartDataColumn[];
}

/**
 * Project a typed time-series array into the shape `<ChartContainer>`'s
 * fallback table consumes.
 *
 * - Rows whose values are `undefined` are coerced to `null` so the
 *   default cell formatter renders `—` instead of the literal string
 *   "undefined".
 * - The relative order of `fields` is preserved as the column order in
 *   the rendered table.
 */
export function chartRowsFromTimeseries<T extends Record<string, unknown>>(
  rows: ReadonlyArray<T>,
  fields: ReadonlyArray<ChartA11yField<T>>,
): ChartA11yPayload {
  const dataColumns: ChartDataColumn[] = fields.map((f) => ({
    key: f.key,
    label: f.label,
    format: f.format,
  }));

  const data: ChartDataRow[] = rows.map((row) => {
    const out: ChartDataRow = {};
    for (const f of fields) {
      const v = row[f.key];
      // Normalize `undefined` → `null` so the default cell formatter
      // renders the i18n empty marker rather than literal "undefined".
      if (v === undefined) {
        out[f.key] = null;
      } else if (
        typeof v === 'string' ||
        typeof v === 'number' ||
        v === null
      ) {
        out[f.key] = v;
      } else {
        // Unsupported value type (object/array/boolean) — coerce
        // through the column's formatter when available, otherwise
        // stringify so the SR user still hears something.
        out[f.key] = String(v);
      }
    }
    return out;
  });

  return { data, dataColumns };
}
