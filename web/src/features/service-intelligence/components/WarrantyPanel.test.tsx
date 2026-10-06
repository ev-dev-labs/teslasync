/**
 * WarrantyPanel — coverage countdown rows + assumption disclosure.
 * Pure presentational: outlook passed as props.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  it('preserves null versus real zero distance allowance, supplied coverage ordering and countdown clamping', () => {
    render(
      <WarrantyPanel selected loading={false} error={null}
        outlook={{
          ...outlook,
          coverages: [
            { ...outlook.coverages[0], name: 'Time-only coverage', km_limit: null, km_remaining: null, days_remaining: 0, status: 'expiring_soon' },
            { ...outlook.coverages[1], name: 'Exhausted distance allowance', km_remaining: 0, days_remaining: -3, status: 'expired' },
          ],
        }}
        onRetry={vi.fn()} />,
    );
    const timeOnly = screen.getByText('Time-only coverage').parentElement;
    const exhausted = screen.getByText('Exhausted distance allowance').parentElement;
    expect(timeOnly).toHaveTextContent('0 days left');
    expect(timeOnly).not.toHaveTextContent('km left');
    expect(exhausted).toHaveTextContent('0 days left');
    expect(exhausted).toHaveTextContent(/0(?:[,.]0+)? km left/);
    expect(screen.getByText('Expiring soon')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(timeOnly?.parentElement?.nextElementSibling).toBe(exhausted?.parentElement);
    expect(screen.getByText(outlook.assumption)).toBeInTheDocument();
  });

  it('keeps initial warranty failure distinct from an empty outlook and recovers only its source', () => {
    const onRetry = vi.fn();
    const view = render(
      <MemoryRouter>
        <WarrantyPanel selected loading={false} error={new Error('warranty unavailable')} outlook={null} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Warranty countdown' })).toBeInTheDocument();
    expect(screen.getByText('This source could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No warranty outlook')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    view.rerender(
      <MemoryRouter>
        <WarrantyPanel selected loading={false} error={null} outlook={outlook} onRetry={onRetry} />
      </MemoryRouter>,
    );
    expect(screen.getByText(outlook.assumption)).toBeInTheDocument();
    expect(screen.getByText('Basic Limited')).toBeInTheDocument();
    expect(screen.getByText('Battery & Drive Unit')).toBeInTheDocument();
    expect(screen.queryByText('This source could not be loaded.')).not.toBeInTheDocument();
  });

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
