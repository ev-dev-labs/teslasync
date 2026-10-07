import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { SchemaKpis } from './SchemaKpis';
import type { SchemaSectionState } from './schemaPresentation';
import { getFormatterPreferences, setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(options?.[key] ?? `{{${key}}}`)),
  i18n: { language: 'en' },
}) }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { ...getFormatterPreferences(), distance: 'mi',
    speed: 'mph', energy: 'kWh', power: 'kW', duration: 'h', temperature: '°F', pressure: 'psi' },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
const original = getFormatterPreferences();
afterEach(() => { cleanup(); setGlobalPrecision(original.precision); setGlobalLocale(original.locale); });

const state: SchemaSectionState = {
  drift: {
    has_drift: true,
    current: { sha256: 'current', table_count: 45, column_count: 125, index_count: 40 },
    expected: { sha256: 'expected', table_count: 42, column_count: 128, index_count: 40 },
    table_count_delta: 3, column_count_delta: -3, index_count_delta: 0,
    expected_generated_at: '2026-01-01T00:00:00Z',
  },
  isLoading: false, error: null, onRetry: vi.fn(),
};

describe('SchemaKpis canonical preservation', () => {
  it('keeps all numeric signed deltas, current/expected operands and badges', () => {
    render(<SchemaKpis state={state} isDrifted />);
    const strip = screen.getByTestId('schema-drift-summary');
    expect([...strip.querySelectorAll('[data-operational-value]')].map(node => node.textContent))
      .toEqual(['Drift detected', '+3', '-3', '0']);
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(strip).toHaveTextContent('45 current · 42 expected');
    expect(strip).toHaveTextContent('125 current · 128 expected');
    expect(strip).toHaveTextContent('40 current · 40 expected');
    expect(strip).toHaveTextContent('Match');
    expect(strip).toHaveTextContent('Drift');
    expect(state.drift?.table_count_delta).toBe(3);
  });

  it('withholds the verdict and numbers during initial loading but retains them during refresh', () => {
    const { rerender } = render(<SchemaKpis state={{ ...state, drift: null, isLoading: true }} isDrifted={false} />);
    const strip = screen.getByTestId('schema-drift-summary');
    expect(strip).toHaveAttribute('aria-busy', 'true');
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(strip.querySelector('[data-operational-value]')).toBeNull();
    rerender(<SchemaKpis state={{ ...state, isLoading: true }} isDrifted retained />);
    expect(strip.closest('[data-retained]')).toHaveAttribute('data-retained', 'true');
    expect(strip.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(strip).toHaveTextContent('+3');
  });

  it('keeps deltas integral and localized independently of measurement precision', () => {
    setGlobalPrecision(3);
    setGlobalLocale('de-DE');
    const drift = state.drift;
    if (!drift) throw new Error('The fixture must contain schema evidence');
    const localizedState = { ...state, drift: { ...drift, table_count_delta: 1234, column_count_delta: -1234 } };
    render(<SchemaKpis state={localizedState} isDrifted />);
    const strip = screen.getByTestId('schema-drift-summary');
    expect([...strip.querySelectorAll('[data-operational-value]')].map(node => node.textContent))
      .toEqual(['Drift detected', '+1.234', '-1.234', '0']);
    act(() => { setGlobalPrecision(0); setGlobalLocale('en-US'); });
    expect([...strip.querySelectorAll('[data-operational-value]')].map(node => node.textContent))
      .toEqual(['Drift detected', '+1,234', '-1,234', '0']);
    expect(localizedState.drift.table_count_delta).toBe(1234);
  });

  it('opens the actual Review details drawer with schema status, delta operands and badges', () => {
    render(<SchemaKpis state={state} isDrifted />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Schema drift summary details' });
    expect(within(drawer).getByText('Drift detected')).toBeInTheDocument();
    expect(within(drawer).getByText('+3')).toBeInTheDocument();
    expect(within(drawer).getByText('-3')).toBeInTheDocument();
    expect(within(drawer).getByText('45 current · 42 expected')).toBeInTheDocument();
    expect(within(drawer).getByText('Match')).toBeInTheDocument();
  });
});
