import { describe, expect, it } from 'vitest';
import {
  calculateCostStatistics, clampPct, computeProgress, countCategories,
  projectServices, sortItems, statusFromPct, summarizeItems,
} from '../maintenanceModel';
import { item, record } from './fixtures';

describe('maintenance calculations and source-status separation', () => {
  it('preserves mileage precedence over configured months and due odometer', () => {
    const source = item({
      current_mileage: 39000, last_service_mileage: 20000,
      interval_miles: 20000, interval_months: 24,
      last_service_date: '2000-01-01', due_mileage: 100000,
    });
    expect(computeProgress(source, Date.parse('2024-01-01'))).toBe(95);
    expect(source.current_mileage).toBe(39000);
    expect(source.interval_miles).toBe(20000);
  });

  it('retains the 30.44-day month calculation, not calendar-month replacement', () => {
    const start = Date.parse('2024-01-01T00:00:00Z');
    const monthMs = 30.44 * 24 * 60 * 60 * 1000;
    expect(computeProgress(item({
      interval_months: 12, last_service_date: '2024-01-01T00:00:00Z',
    }), start + 6 * monthMs)).toBeCloseTo(50, 12);
  });

  it('represents invalid service dates as unavailable, not measured zero', () => {
    expect(computeProgress(item({ interval_months: 12, last_service_date: 'invalid' }))).toBeNull();
  });

  it('falls back to current/due odometer only after interval paths', () => {
    expect(computeProgress(item({ current_mileage: 30000, due_mileage: 40000 }))).toBe(75);
    expect(computeProgress(item())).toBeNull();
    expect(computeProgress(item({ due_mileage: 0, current_mileage: 100 }))).toBeNull();
  });

  it.each([
    { interval_miles: 100 },
    { interval_miles: 0, last_service_mileage: 0 },
    { interval_miles: -100, last_service_mileage: 0 },
    { interval_miles: NaN, last_service_mileage: 0 },
    { interval_miles: Infinity, last_service_mileage: 0 },
    { interval_miles: 100, last_service_mileage: NaN },
    { interval_miles: 100, last_service_mileage: Infinity },
    { interval_miles: 100, last_service_mileage: 0, current_mileage: NaN },
    { interval_miles: 100, last_service_mileage: 0, current_mileage: Infinity },
    { interval_months: 12 },
    { interval_months: 0, last_service_date: '2024-01-01' },
    { interval_months: -1, last_service_date: '2024-01-01' },
    { interval_months: Infinity, last_service_date: '2024-01-01' },
    { interval_months: NaN, last_service_date: '2024-01-01' },
    { due_mileage: -100 },
    { due_mileage: Infinity },
    { due_mileage: NaN },
    { due_mileage: 100, current_mileage: undefined },
  ])('does not turn invalid or missing basis into Good: %j', overrides => {
    const pct = computeProgress(item(overrides));
    expect(pct).toBeNull();
    expect(statusFromPct(pct)).toBeNull();
  });

  it('does not mask an invalid configured basis with a lower-precedence estimate', () => {
    expect(computeProgress(item({
      interval_miles: -1, last_service_mileage: 0,
      interval_months: 12, last_service_date: '2024-01-01', due_mileage: 100,
    }))).toBeNull();
    expect(computeProgress(item({
      interval_months: 12, last_service_date: 'invalid', due_mileage: 100,
    }))).toBeNull();
  });

  it('preserves measured zero, signed numerators and fractional values', () => {
    expect(computeProgress(item({ due_mileage: 100, current_mileage: 0 }))).toBe(0);
    expect(computeProgress(item({
      interval_miles: 100, last_service_mileage: 20, current_mileage: 20,
    }))).toBe(0);
    expect(computeProgress(item({
      interval_miles: 100, last_service_mileage: 20, current_mileage: 10,
    }))).toBe(0);
    expect(computeProgress(item({
      interval_miles: 0.5, last_service_mileage: -0.5, current_mileage: -0.25,
    }))).toBe(50);
    expect(computeProgress(item({ due_mileage: 100, current_mileage: 50.125 }))).toBe(50.125);
    const start = Date.parse('2024-01-01T00:00:00Z');
    const source = item({ interval_months: 0.5, last_service_date: '2024-01-01T00:00:00Z' });
    expect(computeProgress(source, start)).toBe(0);
    expect(computeProgress(source, start - 1000)).toBe(0);
    expect(computeProgress(source, start + 0.25 * 30.44 * 86400000)).toBeCloseTo(50, 12);
    expect(computeProgress(source, NaN)).toBeNull();
    expect(computeProgress(item({
      interval_miles: Number.MIN_VALUE, last_service_mileage: 0, current_mileage: 1,
    }))).toBeNull();
  });

  it.each([
    [-1, 0], [0, 0], [50.125, 50.125], [100, 100], [101, 100],
    [NaN, 0], [Infinity, 0], [-Infinity, 0],
  ])('clamps %s to %s without changing interval definitions', (input, output) => {
    expect(clampPct(input)).toBe(output);
  });

  it.each([
    [0, 'good'], [69.999, 'good'], [70, 'soon'], [89.999, 'soon'],
    [90, 'overdue'], [100, 'overdue'],
  ])('keeps progress threshold %s -> %s', (pct, expected) => {
    expect(statusFromPct(pct)).toBe(expected);
  });

  it.each([null, NaN, Infinity, -Infinity])('does not derive Good from %s', pct => {
    expect(statusFromPct(pct)).toBeNull();
  });

  it('counts calculated progress separately from raw source status', () => {
    const rows = [
      item({ status: 'good', current_mileage: 99999, due_mileage: 1 }),
      item({ id: 2, status: 'soon', current_mileage: 0, due_mileage: 100 }),
      item({ id: 3, status: 'overdue' }),
      item({ id: 4, status: 'completed' }),
      item({ id: 5, status: 'good', current_mileage: 70, due_mileage: 100 }),
    ];
    expect(summarizeItems(rows)).toEqual({ total: 5, good: 1, soon: 1, overdue: 1, completed: 1, unavailable: 1 });
    expect(summarizeItems([])).toEqual({ total: 0, good: 0, soon: 0, overdue: 0, completed: 0, unavailable: 0 });
    expect(rows.map(row => row.status)).toEqual(['good', 'soon', 'overdue', 'completed', 'good']);
  });

  it('sorts calculated urgency ahead of completion and unavailable basis, not source status', () => {
    const rows = Object.freeze([
      Object.freeze(item({ id: 1, status: 'overdue' })),
      Object.freeze(item({ id: 2, status: 'overdue', due_mileage: 100, current_mileage: 0 })),
      Object.freeze(item({ id: 3, status: 'good', due_mileage: 100, current_mileage: 90 })),
      Object.freeze(item({ id: 4, status: 'completed', due_mileage: 100, current_mileage: 100 })),
      Object.freeze(item({ id: 5, status: 'good', due_mileage: 100, current_mileage: 70 })),
    ]);
    expect(sortItems(rows, 'status').map(row => row.id)).toEqual([3, 5, 2, 4, 1]);
    expect(rows.map(row => row.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('uses one calculation clock for month-based sorting and summaries', () => {
    const start = Date.parse('2024-01-01T00:00:00Z');
    const now = start + 0.75 * 30.44 * 86400000;
    const rows = [
      item({ id: 1, interval_months: 1, last_service_date: '2024-01-01T00:00:00Z' }),
      item({ id: 2, due_mileage: 100, current_mileage: 95 }),
      item({ id: 3, interval_months: 1, last_service_date: 'invalid' }),
    ];
    expect(sortItems(rows, 'status', now).map(row => row.id)).toEqual([2, 1, 3]);
    expect(summarizeItems(rows, now)).toEqual({
      total: 3, good: 0, soon: 1, overdue: 1, completed: 0, unavailable: 1,
    });
  });

  it('sorts by status, name, category and due date without mutating rows', () => {
    const rows = Object.freeze([
      Object.freeze(item({ id: 1, name: 'Zeta', category: 'tires', due_date: null })),
      Object.freeze(item({ id: 2, name: 'Alpha', category: 'brakes', due_date: 'invalid' })),
      Object.freeze(item({ id: 3, name: 'Mid', category: 'general', due_date: '2024-06-01', status: 'overdue' })),
    ]);
    expect(sortItems(rows, 'status').map(row => row.id)).toEqual([1, 2, 3]);
    expect(sortItems(rows, 'name').map(row => row.id)).toEqual([2, 3, 1]);
    expect(sortItems(rows, 'category').map(row => row.id)).toEqual([2, 3, 1]);
    expect(sortItems(rows, 'due_date').map(row => row.id)).toEqual([3, 2, 1]);
    expect(rows.map(row => row.id)).toEqual([1, 2, 3]);
    expect(sortItems(rows, 'unknown')).toEqual(rows);
  });

  it('retains exact total/annual/average values including valid zero cost', () => {
    expect(calculateCostStatistics([])).toBeNull();
    expect(calculateCostStatistics([record({ cost: 0 })])).toEqual({
      totalCost: 0, annualCost: 0, avgPerService: 0,
    });
    expect(calculateCostStatistics([record({ cost: 500 })])).toEqual({
      totalCost: 500, annualCost: 500, avgPerService: 500,
    });
    const result = calculateCostStatistics([
      record({ cost: 120, date: '2024-01-01T00:00:00Z' }),
      record({ id: 12, cost: 80, date: '2024-01-02T00:00:00Z' }),
      record({ id: 13, cost: 0, date: 'invalid' }),
    ]);
    expect(result?.totalCost).toBe(200);
    expect(result?.annualCost).toBe(2000); // minimum 0.1-year span
    expect(result?.avgPerService).toBe(200 / 3); // all records, not valid dates
  });

  it('retains the 365.25-day year rather than a fixed calendar year', () => {
    const result = calculateCostStatistics([
      record({ cost: 100, date: '2023-01-01T00:00:00Z' }),
      record({ id: 12, cost: 100, date: '2024-01-01T00:00:00Z' }),
    ]);
    expect(result?.annualCost).toBeCloseTo(200 / (365 / 365.25), 12);
  });

  it('keeps invalid-date records in costs and the average denominator', () => {
    expect(calculateCostStatistics([
      record({ cost: 100, date: 'invalid' }), record({ id: 12, cost: 20 }),
    ])).toEqual({ totalCost: 120, annualCost: 120, avgPerService: 60 });
  });

  it('normalizes categories by largest count, not by total rows', () => {
    const rows = [item(), item({ id: 2 }), item({ id: 3, category: 'brakes' })];
    expect(countCategories(rows)).toEqual([
      { category: 'tires', count: 2, max: 2 },
      { category: 'brakes', count: 1, max: 2 },
    ]);
    expect(countCategories([])).toEqual([]);
  });

  it('keeps due eligibility, completed exclusion, wire-status order and SI zero', () => {
    const rows = [
      item({ id: 1, interval_miles: 10000, due_mileage: 40000, current_mileage: 30000 }),
      item({ id: 2, interval_months: 12, status: 'overdue', due_mileage: 20000, current_mileage: 30000 }),
      item({ id: 3, status: 'completed', interval_months: 12 }),
      item({ id: 4, interval_miles: 0, interval_months: 0 }),
      item({ id: 5, interval_months: 6, due_date: '2025-02-01' }),
    ];
    const result = projectServices(rows, date => `business:${date}`);
    expect(result.map(row => row.id)).toEqual([2, 1, 5]);
    expect(result[0].metersRemaining).toBe(0);
    expect(result[1].metersRemaining).toBe(10000);
    expect(result[2].metersRemaining).toBeNull();
    expect(result[2].dueDate).toBe('business:2025-02-01');
    expect(rows[1].current_mileage).toBe(30000);
  });

  it('preserves the eight-projection horizon while retaining all source rows', () => {
    const rows = Array.from({ length: 10 }, (_, index) => item({
      id: index + 1, interval_months: 12, due_mileage: 1000 + index,
    }));
    expect(projectServices(rows, String)).toHaveLength(8);
    expect(rows).toHaveLength(10);
  });
});
