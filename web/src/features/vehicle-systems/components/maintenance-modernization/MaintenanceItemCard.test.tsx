import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MaintenanceItemCard } from './MaintenanceItemCard';
import { item } from './__tests__/fixtures';
import type { MaintenanceItem } from './maintenanceModel';

afterEach(cleanup);

function renderItem(overrides: Partial<MaintenanceItem>) {
  return render(<MaintenanceItemCard
    item={item({ last_service_mileage: 10_000, interval_miles: 40_000, ...overrides })}
    formatDistance={value => `${value} m`}
  />);
}

describe('MaintenanceItemCard native service track', () => {
  it.each([
    { current_mileage: 10_000, extent: 0 },
    { current_mileage: 25_000, extent: 37.5 },
    { current_mileage: 60_000, extent: 100 },
  ])('preserves the service interval denominator and real $extent extent', ({ current_mileage, extent }) => {
    const { container } = renderItem({ current_mileage });
    const track = screen.getByRole('progressbar', { name: 'Rotation service progress' });
    expect(track).toHaveAttribute('data-app-part', 'metric');
    expect(track).toHaveAttribute('data-app-metric', 'bar');
    expect(track).toHaveAttribute('data-metric-track');
    expect(track).toHaveClass('h-2', 'w-full', 'rounded-full');
    expect(track).toHaveAttribute('aria-valuemin', '0');
    expect(track).toHaveAttribute('aria-valuemax', '100');
    expect(track).toHaveAttribute('aria-valuenow', String(Math.round(extent)));
    const fill = track.querySelector('[data-metric-fill]');
    expect(fill).toBe(track.firstElementChild);
    expect(fill).toHaveStyle({ width: `${extent}%` });
    expect(fill).toHaveClass('h-full', 'rounded-full', 'motion-safe:transition-all');
    expect(within(container.querySelector('article')!).getByText('Original service description')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Service interval and metadata' })).toBeInTheDocument();
  });

  it.each([
    { interval_miles: null, last_service_mileage: null },
    { interval_miles: 0 },
    { interval_miles: Number.NaN },
    { current_mileage: Number.POSITIVE_INFINITY },
    { status: 'completed' as const, current_mileage: 25_000 },
  ])('does not fabricate a native track without an eligible measured interval (%j)', overrides => {
    const { container } = renderItem(overrides);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.querySelector('[data-metric-track], [data-metric-fill]')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Service interval and metadata' })).toBeInTheDocument();
    expect(screen.getByText('Original service description')).toBeInTheDocument();
  });
});
