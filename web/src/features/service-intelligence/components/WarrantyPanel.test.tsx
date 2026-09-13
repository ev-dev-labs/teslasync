/**
 * WarrantyPanel — coverage countdown rows + assumption disclosure.
 * Pure presentational: outlook passed as props.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: unknown,
      variables?: Record<string, string | number>,
    ) => {
      if (typeof fallback !== 'string') return key;
      return Object.entries(variables ?? {}).reduce(
        (value, [name, replacement]) =>
          value.replace(`{{${name}}}`, String(replacement)),
        fallback,
      );
    },
  }),
}));

import type { WarrantyOutlook } from '@/api/hooks/useServiceIntelligence';
import { WarrantyPanel } from './WarrantyPanel';

const outlook: WarrantyOutlook = {
  vehicle_id: 9,
  model: 'Model Y',
  model_year: 2024,
  assumption: 'Counted from January 1 of the model year.',
  coverages: [
    { name: 'Basic Limited', expires_at: '2028-01-01', days_remaining: 400, km_limit: 80467, km_remaining: 50000, status: 'active', basis: 'time' },
    { name: 'Battery & Drive Unit', expires_at: '2032-01-01', days_remaining: 1800, km_limit: 192000, km_remaining: 160000, status: 'active', basis: 'time' },
  ],
};

describe('WarrantyPanel', () => {
  it('renders coverage rows with countdowns and the assumption', () => {
    render(
      <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={() => {}} />,
    );
    expect(screen.getByText('Basic Limited')).toBeTruthy();
    expect(screen.getByText('Battery & Drive Unit')).toBeTruthy();
    expect(screen.getByText('Counted from January 1 of the model year.')).toBeTruthy();
  });

  it('marks expired coverage', () => {
    render(
      <WarrantyPanel
        selected
        loading={false}
        error={null}
        outlook={{
          ...outlook,
          coverages: [
            { name: 'Basic Limited', expires_at: '2023-01-01', days_remaining: -100, km_limit: null, km_remaining: null, status: 'expired', basis: 'time' },
          ],
        }}
        onRetry={() => {}}
      />,
    );
    expect(screen.getByText('Expired')).toBeTruthy();
  });

  it('prompts to select a vehicle when none is chosen', () => {
    render(
      <WarrantyPanel selected={false} loading={false} error={null} outlook={null} onRetry={() => {}} />,
    );
    expect(screen.getByText('Select a vehicle')).toBeTruthy();
  });
});
