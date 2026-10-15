import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettings } from '@/api/types';
import { ActionCenterSummary } from './ActionCenterSummary';

const preferences = vi.hoisted(() => ({
  locale: 'de-DE',
  tz_display_default: 'user',
  timezone_user: 'Pacific/Honolulu',
  decimal_precision: 2,
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  currency_symbol: '$',
} satisfies Pick<AppSettings,
  | 'locale' | 'tz_display_default' | 'timezone_user' | 'decimal_precision'
  | 'unit_of_length' | 'unit_of_temp' | 'unit_of_pressure' | 'currency_symbol'
>));

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>(
    '@/hooks/useSettings',
  );
  return {
    ...actual,
    useSettings: () => ({ settings: preferences, locale: preferences.locale }),
  };
});
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: null }),
}));
vi.unmock('@/lib/timezone');

const props: ComponentProps<typeof ActionCenterSummary> = {
  summary: { open: 7, critical: 0, high: 3, acknowledged: 2, snoozed: 1, dismissed: 4 },
  loading: false,
  status: 'ok',
  provenance: 'live',
  generatedAt: '2026-10-12T03:30:00Z',
  vehicleName: 'Fixture vehicle',
  providers: [{
    source_feature: 'active_alerts', status: 'available', item_count: 7, limitations: [],
  }],
};

beforeEach(() => {
  preferences.locale = 'de-DE';
  preferences.timezone_user = 'Pacific/Honolulu';
});

describe('ActionCenterSummary generated timestamp preferences', () => {
  it('renders Generated in the saved locale and timezone instead of browser defaults', () => {
    render(<ActionCenterSummary {...props} />);
    const summary = screen.getByRole('region', { name: 'Action center summary' });
    expect(within(summary).getByText('Generated 11. Okt. 2026, 17:30')).toBeVisible();
    const browserDate = new Date(props.generatedAt!).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    expect(within(summary).queryByText(`Generated ${browserDate}`)).not.toBeInTheDocument();
    const metrics = within(summary).getAllByRole('listitem');
    expect(metrics).toHaveLength(6);
    for (const [index, [label, value]] of [
      ['Open', '7'], ['Critical', '0'], ['High', '3'],
      ['Acknowledged', '2'], ['Snoozed', '1'], ['Dismissed', '4'],
    ].entries()) {
      expect(within(metrics[index]).getByText(label)).toBeVisible();
      expect(metrics[index].querySelector('[data-operational-value]')).toHaveTextContent(value);
    }
    expect(within(summary).getByText('Summary returned')).toBeVisible();
    expect(within(summary).getByText(
      'Fixture vehicle · Before priority, source, state, and pagination filters',
    )).toBeVisible();
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Decision queue overview details' });
    expect(within(details).getByText('Generated 11. Okt. 2026, 17:30')).toBeVisible();
    expect(within(details).getByText('Operational metrics')).toBeVisible();
    expect(props.generatedAt).toBe('2026-10-12T03:30:00Z');
  });

  it('updates Generated after saved timezone and locale preferences change on rerender', () => {
    const { rerender } = render(<ActionCenterSummary {...props} />);
    expect(screen.getByText('Generated 11. Okt. 2026, 17:30')).toBeVisible();
    preferences.timezone_user = 'Asia/Tokyo';
    rerender(<ActionCenterSummary {...props} />);
    expect(screen.getByText('Generated 12. Okt. 2026, 12:30')).toBeVisible();
    expect(screen.queryByText('Generated 11. Okt. 2026, 17:30')).not.toBeInTheDocument();
    preferences.locale = 'en-US';
    rerender(<ActionCenterSummary {...props} />);
    expect(screen.getByText('Generated Oct 12, 2026, 12:30 PM')).toBeVisible();
    expect(screen.queryByText('Generated 12. Okt. 2026, 12:30')).not.toBeInTheDocument();
    expect(props.generatedAt).toBe('2026-10-12T03:30:00Z');
  });

  it.each([
    { caseId: 'null timestamp', generatedAt: null, expected: 'Generation time unavailable' },
    { caseId: 'empty timestamp', generatedAt: '', expected: 'Generation time unavailable' },
    { caseId: 'invalid timestamp', generatedAt: 'not-a-timestamp', expected: 'Generated —' },
  ])('preserves the placeholder for $caseId', ({ generatedAt, expected }) => {
    render(<ActionCenterSummary {...props} generatedAt={generatedAt} />);
    const summary = screen.getByRole('region', { name: 'Action center summary' });
    expect(within(summary).getByText(expected)).toBeVisible();
    expect(within(summary).getAllByRole('listitem')).toHaveLength(6);
    expect(within(summary).getByRole('button', { name: 'Review details' })).toBeEnabled();
    expect(within(summary).queryByText(/Invalid Date|NaN/)).not.toBeInTheDocument();
  });

  it('retains all six unknown metrics and the summary section when timestamp and evidence are missing', () => {
    render(<ActionCenterSummary {...props} summary={null} generatedAt={null} providers={[]} />);
    const summary = screen.getByRole('region', { name: 'Action center summary' });
    expect(within(summary).getByText('Generation time unavailable')).toBeVisible();
    expect(within(summary).getByText('Summary unavailable')).toBeVisible();
    expect(within(summary).getByRole('heading', { name: 'Decision queue overview' })).toBeVisible();
    const metrics = within(summary).getAllByRole('listitem');
    expect(metrics).toHaveLength(6);
    for (const metric of metrics) {
      expect(metric).toHaveAttribute('data-value-state', 'missing');
      expect(metric.querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
    expect(within(summary).getByRole('button', { name: 'Review details' })).toBeEnabled();
  });
});
