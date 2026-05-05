/**
 * Phase-46 / Prompt 13 — chartA11y helper tests.
 *
 * Covers the projection rules `chartRowsFromTimeseries` applies to a
 * typed time-series array before `<ChartContainer>` consumes it as
 * the SR/forced-colors fallback table.
 */

import { describe, it, expect } from 'vitest';
import {
  chartRowsFromTimeseries,
  type ChartA11yField,
} from '../chartA11y';

interface Row {
  time: string;
  kwh: number;
  cost?: number;
  note?: string | null;
}

describe('chartRowsFromTimeseries', () => {
  it('projects every declared field into the data rows in order', () => {
    const rows: Row[] = [
      { time: '00:00', kwh: 1.2, cost: 0.42 },
      { time: '01:00', kwh: 0.8, cost: 0.28 },
    ];
    const fields: ChartA11yField<Row>[] = [
      { key: 'time', label: 'Time' },
      { key: 'kwh', label: 'kWh' },
      { key: 'cost', label: 'Cost' },
    ];

    const { data, dataColumns } = chartRowsFromTimeseries(rows, fields);

    expect(dataColumns).toEqual([
      { key: 'time', label: 'Time', format: undefined },
      { key: 'kwh', label: 'kWh', format: undefined },
      { key: 'cost', label: 'Cost', format: undefined },
    ]);
    expect(data).toEqual([
      { time: '00:00', kwh: 1.2, cost: 0.42 },
      { time: '01:00', kwh: 0.8, cost: 0.28 },
    ]);
  });

  it('preserves the order of fields as the column order', () => {
    const fields: ChartA11yField<Row>[] = [
      { key: 'kwh', label: 'kWh' },
      { key: 'time', label: 'Time' },
    ];
    const { dataColumns } = chartRowsFromTimeseries([], fields);
    expect(dataColumns.map((c) => c.key)).toEqual(['kwh', 'time']);
  });

  it('coerces undefined values to null so the default cell formatter can render the empty marker', () => {
    const rows: Row[] = [{ time: '00:00', kwh: 1, cost: undefined }];
    const fields: ChartA11yField<Row>[] = [
      { key: 'time', label: 'Time' },
      { key: 'cost', label: 'Cost' },
    ];

    const { data } = chartRowsFromTimeseries(rows, fields);

    expect(data[0].cost).toBeNull();
    expect(data[0].time).toBe('00:00');
  });

  it('preserves explicit null values', () => {
    const rows: Row[] = [{ time: '00:00', kwh: 1, note: null }];
    const fields: ChartA11yField<Row>[] = [
      { key: 'note', label: 'Note' },
    ];
    const { data } = chartRowsFromTimeseries(rows, fields);
    expect(data[0].note).toBeNull();
  });

  it('passes formatter functions through unchanged', () => {
    const fmt = (v: unknown) => `${(v as number).toFixed(2)} kWh`;
    const fields: ChartA11yField<Row>[] = [
      { key: 'kwh', label: 'kWh', format: fmt },
    ];
    const { dataColumns } = chartRowsFromTimeseries([], fields);
    expect(dataColumns[0].format).toBe(fmt);
  });

  it('stringifies unsupported value types so the SR user still hears something', () => {
    interface Weird {
      time: string;
      tag: { id: number };
    }
    const rows: Weird[] = [
      { time: '00:00', tag: { id: 7 } as { id: number } },
    ];
    const fields: ChartA11yField<Weird>[] = [
      { key: 'time', label: 'Time' },
      { key: 'tag', label: 'Tag' },
    ];
    const { data } = chartRowsFromTimeseries(rows, fields);
    // `[object Object]` is ugly but at least the SR user hears something
    // non-empty. Real consumers should pass a `format` to render nicely.
    expect(typeof data[0].tag).toBe('string');
  });

  it('returns empty data when given an empty rows array', () => {
    const fields: ChartA11yField<Row>[] = [
      { key: 'time', label: 'Time' },
      { key: 'kwh', label: 'kWh' },
    ];
    const { data, dataColumns } = chartRowsFromTimeseries([], fields);
    expect(data).toEqual([]);
    // Columns are still emitted so the header survives empty-state.
    expect(dataColumns).toHaveLength(2);
  });
});
