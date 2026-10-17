import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { deriveDataState } from '@/api/dataState';
import english from '@/i18n/en.json';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { NextServiceBrief } from './NextServiceBrief';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, values?: Record<string, unknown>) => {
      const options = typeof fallback === 'object' ? fallback : values;
      const text = typeof fallback === 'string'
        ? fallback
        : typeof options?.defaultValue === 'string' ? options.defaultValue : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: 'C', pressure: 'bar',
      energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US',
    },
  }),
}));

function renderBrief(overrides: Partial<ComponentProps<typeof NextServiceBrief>> = {}) {
  return render(
    <NextServiceBrief
      state={deriveDataState({ data: { components: [], next_service: null } })}
      loading={false}
      noVehicle={false}
      componentLabel={null}
      projectedDate={null}
      formatProjectedDate={(value: unknown) => (typeof value === 'string' && value !== '' ? value : '—')}
      {...overrides}
    />,
  );
}

describe('NextServiceBrief', () => {
  it('reports no projection without inferring that the components are healthy', () => {
    renderBrief();
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(brief).toHaveTextContent('No metric values are available yet.');
    expect(brief).not.toHaveTextContent(/healthy/i);
    expect(english.rul.nextService.none).toBe('No upcoming service projected.');
    assertOperationalBriefDisclosure(brief, 'Component board available');
    assertOperationalMetricUnavailable(brief, 'Service component');
    assertOperationalMetricUnavailable(brief, 'Replace by');
    expect(brief).not.toHaveAttribute('aria-busy');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('No upcoming service projected.');
  });

  it.each(['available', 'refresh failed', 'refresh paused'] as const)(
    'preserves populated projection metrics and limitations when %s',
    (condition) => {
      renderBrief({
        state: deriveDataState({
          data: { next_service: { component: 'tires', date: '2026-08-01' } },
          error: condition === 'refresh failed' ? new Error('Refresh failed') : null,
          fetchStatus: condition === 'refresh paused' ? 'paused' : 'idle',
        }),
        componentLabel: 'Tires',
        projectedDate: '2026-08-01',
      });
      const brief = screen.getByTestId('rul-next-service-summary');
      expect(brief).toHaveTextContent('Tires');
      expect(brief).toHaveTextContent('2026-08-01');
      expect(brief.querySelectorAll('[data-value-state="value"]')).toHaveLength(2);
      assertOperationalBriefDisclosure(brief, condition === 'available'
        ? 'Component board available' : 'Showing retained measurements');
      fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
      const drawer = screen.getByRole('dialog');
      expect(drawer).toHaveTextContent('Service component');
      expect(drawer).toHaveTextContent('Tires');
      expect(drawer).toHaveTextContent('projected by');
      expect(drawer).toHaveTextContent('2026-08-01');
      expect(drawer).toHaveTextContent('not a guaranteed failure date');
      expect(drawer).toHaveTextContent('component forecasts retain their own confidence and basis below');
      expect(drawer).toHaveTextContent('Existing next-service projection from the component health board.');
    },
  );

  it.each([
    { name: 'no vehicle', noVehicle: true, state: deriveDataState({}),
      description: 'Select a vehicle to view its component prognostics.', status: 'Choose a vehicle' },
    { name: 'initial error', noVehicle: false,
      state: deriveDataState({ error: new Error('Load failed') }),
      description: 'Unable to load service projection.', status: 'Failed to load data' },
    { name: 'unavailable', noVehicle: false, state: deriveDataState({}),
      description: 'Service projection unavailable.', status: 'Service projection unavailable.' },
    { name: 'initial pause', noVehicle: false, state: deriveDataState({ fetchStatus: 'paused' }),
      description: 'Service projection unavailable.', status: 'Refresh paused' },
  ])('preserves the $name state', ({ noVehicle, state, description, status }) => {
    renderBrief({ noVehicle, state });
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(brief).not.toHaveTextContent('No upcoming service projected.');
    assertOperationalBriefDisclosure(brief, status, { contains: true });
    assertOperationalMetricUnavailable(brief, 'Service component');
    assertOperationalMetricUnavailable(brief, 'Replace by');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(description);
  });

  it('preserves initial loading without presenting an empty-board conclusion', () => {
    renderBrief({ state: deriveDataState({ isLoading: true }), loading: true });
    const brief = screen.getByTestId('rul-next-service-summary');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(brief, 'Loading');
    expect(brief).not.toHaveTextContent('No upcoming service projected.');
  });
});
