import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { FleetTelemetryCategoryCoverage } from '@/api/types';
import { CoverageCategory } from './CoverageCategory';

vi.mock('react-i18next', async () => {
  const { testTranslation } = await import('./testTranslation');
  return {
    ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
    useTranslation: () => ({ t: testTranslation, i18n: { language: 'en', changeLanguage: vi.fn() } }),
  };
});

const category: FleetTelemetryCategoryCoverage = {
  category: 'a-long-category-identity-that-must-not-be-clipped',
  total_fields: 2,
  destinations: { signal_log: 2, drive_telemetry: 1 },
  fields: [
    { field: 'VehicleSpeed', destination: 'signal_log', column: '', also_signal_log: false, subscribed: true },
    { field: 'BrakePedal', destination: 'drive_telemetry', column: 'brake_pedal', also_signal_log: true, subscribed: false },
  ],
};

function renderCategory(filter = '') {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CoverageCategory category={category} filter={filter} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('CoverageCategory preservation', () => {
  it('retains full identity, destination order and every field metadata column', () => {
    const { container } = renderCategory();
    expect(screen.getByRole('heading', { name: category.category })).toBeInTheDocument();
    const table = screen.getByRole('table');
    for (const label of ['Field', 'Destination', 'Column', 'Dual write', 'Subscribed']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(within(table).getByText('brake_pedal')).toBeInTheDocument();
    expect(within(table).getByText('no')).toBeInTheDocument();
    const destinationChips = Array.from(container.querySelectorAll('[data-testid^="coverage-cat-dest-"]'));
    expect(destinationChips.map(node => node.textContent)).toEqual(['signal_log: 2', 'drive_telemetry: 1']);
  });

  it('keeps category-name matches with the specialist no-field-match explanation', () => {
    renderCategory(category.category);
    expect(screen.getByRole('heading', { name: category.category })).toBeInTheDocument();
    expect(screen.getByText('No fields match the current filter.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('filters displayed rows without losing the full category value-filter options', () => {
    renderCategory('BrakePedal');
    const table = screen.getByRole('table');
    expect(within(table).getByText('BrakePedal')).toBeInTheDocument();
    expect(within(table).queryByText('VehicleSpeed')).not.toBeInTheDocument();
    const filter = within(table).getByRole('button', { name: 'Field filter' });
    fireEvent.click(filter);
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument();
    expect(screen.getAllByText('BrakePedal').length).toBeGreaterThan(1);
  });
});
