import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { deriveDataState } from '@/api/dataState';
import type { GasPriceStatus } from '@/api/types';
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';
import { GasPriceBrief } from './GasPriceBrief';

const preferences = vi.hoisted(() => ({
  locale: 'en-US', decimal_precision: 2, currency_symbol: '$', gas_unit: 'gallon',
  unit_of_length: 'km', unit_of_temp: 'C', unit_of_pressure: 'bar',
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, vars?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (match, name: string) => vars && name in vars ? String(vars[name]) : match),
  }),
}));
vi.mock('@/hooks/useSettings', async importOriginal => {
  const original = await importOriginal<typeof import('@/hooks/useSettings')>();
  const { deriveDataState } = await import('@/api/dataState');
  return {
    ...original,
    useSettings: () => ({
      settings: preferences,
      settingsUnavailable: false,
      settingsState: deriveDataState({ data: preferences }),
    }),
  };
});

const populated: GasPriceStatus = {
  enabled: true, poll_interval: '24h', last_poll_time: '2026-10-14T12:00:00Z',
  current_price: 3.5, current_price_kwh_eq: 0.125, current_price_unit: 'gallon',
};

afterEach(() => {
  cleanup();
  Object.assign(preferences, { locale: 'en-US', decimal_precision: 2, currency_symbol: '$', gas_unit: 'gallon' });
});

function renderBrief(data: GasPriceStatus | undefined = populated, error?: Error) {
  return render(<MemoryRouter><GasPriceBrief source={deriveDataState({ data, error })} /></MemoryRouter>);
}

function value(container: HTMLElement, occurrence: string) {
  return container.querySelector(`[data-operational-metric="${occurrence}"] [data-operational-value]`);
}

describe('GasPriceBrief source currency', () => {
  it.each(['$', '€', '£', 'C$', 'kr'])('keeps both source amounts in explicit USD with saved symbol %s', symbol => {
    preferences.currency_symbol = symbol;
    const { container } = renderBrief();
    expect(value(container, 'price')).toHaveTextContent('$3.50 USD');
    expect(value(container, 'equivalent')).toHaveTextContent('$0.13 USD');
    expect(value(container, 'status')).toHaveTextContent('Running');
    // Metric context (denominations) moved off the brief face into the
    // drawer's per-metric groups.
    const summary = screen.getByTestId('gas-price-summary');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('group', { name: 'Current price' })).toHaveTextContent('per gal');
    expect(within(drawer).getByRole('group', { name: 'kWh equivalent' })).toHaveTextContent('per kWh');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(value(container, 'polled')).not.toHaveTextContent('Never');
  });

  it('preserves locale, precision and volume preferences without converting or relabeling currency', () => {
    Object.assign(preferences, { locale: 'de-DE', decimal_precision: 3, currency_symbol: '€', gas_unit: 'liter' });
    const { container } = renderBrief({ ...populated, current_price_unit: 'liter' });
    expect(value(container, 'price')).toHaveTextContent('3,500 $ USD');
    expect(value(container, 'equivalent')).toHaveTextContent('0,125 $ USD');
    const summary = screen.getByTestId('gas-price-summary');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('group', { name: 'Current price' })).toHaveTextContent('per L');
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('retains populated quotes during a failed refresh', () => {
    preferences.currency_symbol = '£';
    const { container } = renderBrief(populated, new Error('Refresh failed'));
    expect(value(container, 'price')).toHaveTextContent('$3.50 USD');
    expect(value(container, 'equivalent')).toHaveTextContent('$0.13 USD');
    assertOperationalBriefDisclosure(container, 'Retained measurements');
  });

  it('preserves stopped and never-polled populated states without inventing prices', () => {
    const { container } = renderBrief({
      ...populated, enabled: false, last_poll_time: '0001-01-01T00:00:00Z',
      current_price: 0, current_price_kwh_eq: 0,
    });
    expect(value(container, 'status')).toHaveTextContent('Stopped');
    expect(value(container, 'polled')).toHaveTextContent('Never');
    // Unknown quotes are omitted from the face (never invented as zero);
    // the drawer carries the counted explanation.
    assertOperationalMetricUnavailable(container, 'Current price');
    assertOperationalMetricUnavailable(container, 'kWh equivalent');
  });

  it('keeps all metric shells during initial loading', () => {
    const { container } = render(<MemoryRouter><GasPriceBrief source={deriveDataState<GasPriceStatus>({})} /></MemoryRouter>);
    expect(screen.getByTestId('gas-price-summary')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(container.querySelector('[data-operational-value]')).toBeNull();
  });
});
