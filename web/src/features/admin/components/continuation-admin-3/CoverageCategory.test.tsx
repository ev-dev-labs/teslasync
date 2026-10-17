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

function renderCategory(filter = '', categoryOverride = category) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CoverageCategory category={categoryOverride} filter={filter} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('CoverageCategory preservation', () => {
  it('keeps explicit unit_history destinations for Setting*Unit fields without per-field columns', () => {
    const fields = ['SettingChargeUnit', 'SettingDistanceUnit', 'SettingTemperatureUnit', 'SettingTirePressureUnit']
    renderCategory('', {
      category: 'User Preferences',
      total_fields: fields.length,
      destinations: { unit_history: fields.length },
      fields: fields.map(field => ({
        field,
        destination: 'unit_history',
        column: '',
        also_signal_log: false,
        subscribed: true,
      })),
    });
    const table = screen.getByRole('table');
    for (const field of fields) {
      const row = within(table).getByText(field).closest('tr')!;
      expect(within(row).getByText('unit_history')).toBeInTheDocument();
      expect(within(row).getAllByText('—')).toHaveLength(2);
      expect(within(row).getByText('yes')).toBeInTheDocument();
      expect(within(row).queryByText('signal_log')).not.toBeInTheDocument();
    }
    expect(screen.getByTestId('coverage-cat-dest-User Preferences-unit_history')).toHaveTextContent('unit_history: 4');
  });

  it('retains full identity, destination order and every field metadata column', () => {
    const { container } = renderCategory();
    expect(screen.getByRole('heading', { name: category.category })).toBeInTheDocument();
    const table = screen.getByRole('table');
    for (const label of ['Field', 'Destination', 'Column', 'Dual write', 'Configured subscription']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(within(table).getByText('brake_pedal')).toBeInTheDocument();
    expect(within(table).getByText('no')).toBeInTheDocument();
    const destinationChips = Array.from(container.querySelectorAll('[data-testid^="coverage-cat-dest-"]'));
    expect(destinationChips.map(node => node.textContent)).toEqual(['signal_log: 2', 'drive_telemetry: 1']);
  });

  it('labels desired subscription membership and preserves both configured values and their filter options', () => {
    renderCategory();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: /Configured subscription/ })).toBeInTheDocument();
    expect(within(within(table).getByText('VehicleSpeed').closest('tr')!).getByText('yes')).toBeInTheDocument();
    expect(within(within(table).getByText('BrakePedal').closest('tr')!).getByText('no')).toBeInTheDocument();
    expect(within(table).queryByRole('columnheader', { name: /^Subscribed/ })).not.toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: 'Configured subscription filter' }));
    expect(screen.getAllByText('yes').length).toBeGreaterThan(1);
    expect(screen.getAllByText('no').length).toBeGreaterThan(1);
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
