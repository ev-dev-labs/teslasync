import { act, cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RepairImpactPreview, RepairPreviewValue } from '@/api/hooks/useDataRepair';
import { formatDateTime } from '@/lib/dateFormat';
import {
  getFormatterPreferences,
  setGlobalLocale,
  setGlobalPrecision,
} from '@/lib/numberFormat';

import { RepairImpactSummary } from './RepairImpactSummary';

const originalPreferences = getFormatterPreferences();

function preview(
  field = 'duration_s',
  before: RepairPreviewValue = { type: 'float64', float64: 1.001 },
  after: RepairPreviewValue = { type: 'float64', float64: 1.004 },
): RepairImpactPreview {
  return {
    kind: 'drive',
    session_id: 42,
    rule: 'drive_open_park_observed',
    source: 'suggestion',
    status: 'ready',
    started_at: '2026-03-29T06:00:00Z',
    current_ended_at: null,
    proposed_ended_at: '2026-03-29T07:00:00Z',
    current_duration_s: null,
    proposed_duration_s: 3600,
    fields_changed: [{ field, before, after }],
    fields_preserved: [
      { field: 'distance_m', value: { type: 'float64', float64: 1234.567 }, reason: 'measured' },
      { field: 'energy_used_wh', value: { type: 'null', null: true }, reason: 'unknown' },
    ],
    warnings: ['Measured totals remain unchanged.'],
  };
}

function changedValue(): HTMLElement {
  return within(screen.getByTestId('repair-impact-preview')).getByRole('definition');
}

describe('RepairImpactSummary exact source values', () => {
  beforeEach(() => {
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
  });

  afterEach(() => {
    cleanup();
    setGlobalLocale(originalPreferences.locale);
    setGlobalPrecision(originalPreferences.precision);
  });

  it('keeps sub-cent differences visible alongside the user-rounded presentation', () => {
    render(<RepairImpactSummary preview={preview()} />);
    const value = changedValue();
    expect(within(value).getByText('1.00 → 1.00')).toBeVisible();
    expect(within(value).getByText('duration_s: 1.001 → 1.004')).toBeVisible();
  });

  it('uses effective locale and precision for integers and floats without changing raw values', () => {
    setGlobalLocale('de-DE');
    setGlobalPrecision(3);
    const data = preview('technical_value', { type: 'int64', int64: 1234 }, {
      type: 'float64', float64: 5678.9012,
    });
    render(<RepairImpactSummary preview={data} />);
    expect(within(changedValue()).getByText('1.234,000 → 5.678,901')).toBeVisible();
    expect(within(changedValue()).getByText('technical_value: 1234 → 5678.9012')).toBeVisible();
  });

  it('reacts to changed number preferences without replacing the preview or rounding its source', () => {
    render(<RepairImpactSummary preview={preview()} />);
    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(4);
    });
    expect(within(changedValue()).getByText('1,0010 → 1,0040')).toBeVisible();
    expect(within(changedValue()).getByText('duration_s: 1.001 → 1.004')).toBeVisible();
  });

  it('retains exact differences even when the saved precision is zero', () => {
    setGlobalPrecision(0);
    render(<RepairImpactSummary preview={preview('cost_decimal')} />);
    expect(within(changedValue()).getByText('1 → 1')).toBeVisible();
    expect(within(changedValue()).getByText('cost_decimal: 1.001 → 1.004')).toBeVisible();
    expect(changedValue()).not.toHaveTextContent('$');
  });

  it('preserves negative values, negative zero and signed tiny SI numbers', () => {
    render(<RepairImpactSummary preview={preview('avg_power_w', {
      type: 'float64', float64: -0,
    }, { type: 'float64', float64: -1e-25 })} />);
    expect(within(changedValue()).getByText('avg_power_w: -0 → -1e-25')).toBeVisible();
  });

  it('preserves huge and adjacent representable values without inventing missing integer precision', () => {
    render(<RepairImpactSummary preview={preview('technical_value', {
      type: 'float64', float64: 1e30,
    }, { type: 'float64', float64: 1.0000000000000002e30 })} />);
    expect(within(changedValue()).getByText(
      'technical_value: 1e+30 → 1.0000000000000002e+30',
    )).toBeVisible();
  });

  it.each([
    ['null', { type: 'null', null: true }],
    ['missing float', { type: 'float64' }],
    ['missing integer', { type: 'int64' }],
    ['NaN', { type: 'float64', float64: Number.NaN }],
    ['infinity', { type: 'float64', float64: Number.POSITIVE_INFINITY }],
    ['negative infinity', { type: 'float64', float64: Number.NEGATIVE_INFINITY }],
  ] satisfies [string, RepairPreviewValue][])('keeps %s unknown rather than fabricating zero', (_name, before) => {
    render(<RepairImpactSummary preview={preview('duration_s', before, {
      type: 'int64', int64: 0,
    })} />);
    expect(within(changedValue()).getByText('— → 0.00')).toBeVisible();
    expect(within(changedValue()).getByText('duration_s: — → 0')).toBeVisible();
  });

  it('does not guess units or turn a dimensionless confidence into physical or health data', () => {
    render(<RepairImpactSummary preview={preview('confidence', {
      type: 'float64', float64: 0.991,
    }, { type: 'float64', float64: 0.994 })} />);
    expect(within(changedValue()).getByText('confidence: 0.991 → 0.994')).toBeVisible();
    expect(changedValue()).not.toHaveTextContent(/%|km|mph|kWh|success|high confidence/i);
  });

  it('retains timestamp precision and source strings without changing date-helper presentation', () => {
    const before = '2026-03-29T07:00:00.001Z';
    const after = '2026-03-29T07:00:00.004Z';
    const { rerender } = render(<RepairImpactSummary preview={preview('ended_at', {
      type: 'timestamp', timestamp: before,
    }, { type: 'timestamp', timestamp: after })} />);
    expect(within(changedValue()).getByText(`${formatDateTime(before)} → ${formatDateTime(after)}`)).toBeVisible();
    expect(within(changedValue()).getByText(`ended_at: ${before} → ${after}`)).toBeVisible();
    rerender(<RepairImpactSummary preview={preview('cost_source', {
      type: 'string', string: '',
    }, { type: 'string', string: '<source unchanged>' })} />);
    expect(changedValue()).toHaveTextContent('<source unchanged>');
    expect(changedValue().querySelector('source')).toBeNull();
  });

  it('preserves every status, measured-field name, warning and server-validation section', () => {
    const data = preview();
    const original = structuredClone(data);
    const { rerender } = render(<RepairImpactSummary preview={data} />);
    expect(screen.getByText('Verified impact')).toBeVisible();
    expect(screen.getByText('Ready to apply')).toBeVisible();
    expect(screen.getByText('2 measured fields stay unchanged')).toBeVisible();
    expect(screen.getByText('Distance m, Energy used wh')).toBeVisible();
    expect(screen.getByText(data.warnings[0])).toBeVisible();
    expect(screen.getByText(/The server revalidated the current row/)).toBeVisible();
    expect(data).toEqual(original);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<RepairImpactSummary preview={{ ...data, status: 'already_applied', fields_changed: [] }} />);
    expect(screen.getByText('Already applied')).toBeVisible();
    expect(screen.getByText('No database fields would change.')).toBeVisible();
    expect(screen.getByText('Distance m, Energy used wh')).toBeVisible();
  });
});
