import type { ComponentType } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExclusiveReport } from '@/types/teslaPhysics';
import { usePhysicsPage, type PhysicsPage } from '../tesla-physics/PhysicsPageShell';
import PhysicsClocksSection from '../tesla-physics/PhysicsClocksSection';
import PhysicsLifeTapeSection from '../tesla-physics/PhysicsLifeTapeSection';
import PhysicsContradictionsSection from '../tesla-physics/PhysicsContradictionsSection';
import PhysicsMetersSection from '../tesla-physics/PhysicsMetersSection';
import PhysicsUnknownSection from '../tesla-physics/PhysicsUnknownSection';
import PhysicsCarKeptLivingSection from '../tesla-physics/PhysicsCarKeptLivingSection';
import PhysicsLogbookSection from '../tesla-physics/PhysicsLogbookSection';
import PhysicsFirmwareEpochsSection from '../tesla-physics/PhysicsFirmwareEpochsSection';
import PhysicsChargePortSection from '../tesla-physics/PhysicsChargePortSection';
import PhysicsBlackBoxSection from '../tesla-physics/PhysicsBlackBoxSection';
import PhysicsDictionarySection from '../tesla-physics/PhysicsDictionarySection';
import PhysicsVaultSection from '../tesla-physics/PhysicsVaultSection';
import PhysicsModesSection from '../tesla-physics/PhysicsModesSection';
import PhysicsNervousSystemSection from '../tesla-physics/PhysicsNervousSystemSection';
import PhysicsRangeSection from '../tesla-physics/PhysicsRangeSection';

const source = vi.hoisted((): { report: Partial<ExclusiveReport> | undefined; error: Error | null; loading: boolean } => ({
  report: undefined,
  error: null,
  loading: false,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key),
    i18n: { language: 'en' },
  }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: () => ({ vehicleId: 7 }) }));
vi.mock('@/api/hooks/useTeslaPhysics', () => ({
  useTeslaExclusive: () => ({
    data: source.report, error: source.error, isError: source.error != null,
    isLoading: source.loading, isPending: source.loading, isFetching: false,
    isSuccess: source.report != null, fetchStatus: 'idle', dataUpdatedAt: 1790812800000,
    refetch: vi.fn(),
  }),
}));

const start = '2026-10-01T00:00:00Z';
const end = '2026-10-01T01:00:00Z';
const boundedReport: Partial<ExclusiveReport> = {
  vehicle_id: 7,
  evidence: {
    requested_from: start, requested_to: end, first_recorded_at: start, last_recorded_at: end,
    history_rows: 0, black_box_rows: 0, history_truncated: false, black_box_truncated: false,
    drive_sessions_truncated: false, charge_sessions_truncated: false,
    history_available: true, black_box_available: true,
  },
};

function Harness({ Component }: { Component: ComponentType<{ physics: PhysicsPage }> }) {
  const physics = usePhysicsPage();
  return <Component physics={physics} />;
}

function renderSection(Component: ComponentType<{ physics: PhysicsPage }>) {
  return render(<MemoryRouter><Harness Component={Component} /></MemoryRouter>);
}

function metric(briefId: string, metricId: string) {
  const found = screen.getByTestId(briefId).querySelector(`[data-operational-metric="${metricId}"]`);
  if (!found) throw new Error(`Missing metric ${briefId}/${metricId}`);
  return found;
}

beforeEach(() => {
  source.report = boundedReport;
  source.error = null;
  source.loading = false;
});

describe('Tesla physics nested summary adoption', () => {
  const sections = [
    ['clocks', PhysicsClocksSection], ['life', PhysicsLifeTapeSection],
    ['contradictions', PhysicsContradictionsSection], ['meters', PhysicsMetersSection],
    ['unknown', PhysicsUnknownSection], ['living', PhysicsCarKeptLivingSection],
    ['logbook', PhysicsLogbookSection], ['epochs', PhysicsFirmwareEpochsSection],
    ['port', PhysicsChargePortSection], ['black-box', PhysicsBlackBoxSection],
    ['dictionary', PhysicsDictionarySection], ['vault', PhysicsVaultSection],
    ['modes', PhysicsModesSection], ['nerves', PhysicsNervousSystemSection],
    ['range', PhysicsRangeSection],
  ] satisfies ReadonlyArray<readonly [string, ComponentType<{ physics: PhysicsPage }>]>;

  it.each(sections)('%s mounts the actual compact brief without inferring a missing slice as measured zero', (_name, Component) => {
    const { container } = renderSection(Component);
    expect(container.querySelector('[data-operational-brief]')).not.toBeNull();
    expect(container.querySelector('[data-value-state="missing"]')).not.toBeNull();
    expect(screen.getAllByText('Partial source coverage').length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Review details' }).length).toBeGreaterThan(0);
  });

  it('keeps signed paired clock lag, zero intervals, raw rows and exact count denominators in Review details', () => {
    source.report = { ...boundedReport, clocks: {
      vehicle_id: 7, latest: null, honesty: 'Paired readings only.',
      samples: [
        { event_time: start, ingest_time: '2026-09-30T23:59:58Z', display_time: end, gap_s: 0, unknown: false },
        { event_time: end, ingest_time: null, display_time: end, gap_s: null, unknown: true },
      ],
    } };
    renderSection(PhysicsClocksSection);
    expect(metric('physics-clocks-summary', 'median-lag')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-clocks-summary', 'median-lag')).toHaveTextContent('-2');
    expect(metric('physics-clocks-summary', 'paired')).toHaveTextContent('1/2');
    expect(metric('physics-clocks-summary', 'max-gap')).toHaveTextContent('0');
    expect(screen.getByLabelText('Filter event intervals')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('physics-clocks-summary')).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Stored ingest timestamps: 1 / 2')).toBeInTheDocument();
    expect(within(drawer).getByText('Known event intervals: 1 / 2')).toBeInTheDocument();
    expect(within(drawer).getByText(/Requested:/)).toBeInTheDocument();
  });

  it('preserves false versus unknown mode fields and independent cross-check populations', () => {
    source.report = { ...boundedReport, modes: {
      vehicle_id: 7, valet: false, service: null, transport: true,
      allowed: ['Observed only.'], forbidden: ['No historical assignment.'], honesty: 'Mode snapshot.',
    }, meters: { vehicle_id: 7, odometer_m: 0, driving_distance_m: null, fsd_distance_m: null, resets: [], honesty: 'Counters only.' } };
    renderSection(PhysicsModesSection);
    expect(metric('physics-modes-summary', 'valet')).toHaveTextContent('No');
    expect(metric('physics-modes-summary', 'service')).toHaveAttribute('data-value-state', 'missing');
    expect(metric('physics-modes-summary', 'transport')).toHaveTextContent('Yes');
    expect(metric('physics-modes-summary', 'drops')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-modes-crosscheck', 'epochs')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('Observed only.')).toBeInTheDocument();
    expect(screen.getByText('No historical assignment.')).toBeInTheDocument();
  });

  it('retains successful empty interval counts and the original interpolated captions without reusing them as labels', () => {
    source.report = { ...boundedReport, life_tape: {
      vehicle_id: 7, from: start, to: end, segments: [], honesty: 'Returned intervals only.',
    } };
    renderSection(PhysicsLifeTapeSection);
    expect(metric('physics-life-summary', 'segments')).toHaveAttribute('data-value-state', 'value');
    expect(metric('physics-life-summary', 'segments')).toHaveTextContent('0 classified intervals');
    expect(metric('physics-life-summary', 'unknown')).toHaveAttribute('data-value-state', 'missing');
    expect(metric('physics-life-summary', 'unknown')).toHaveTextContent('Unclassified: unknown');
    expect(screen.getByLabelText('Filter by state')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('physics-life-summary')).getByRole('button', { name: 'Review details' }));
    expect(within(screen.getByRole('dialog')).getByText('0 classified intervals')).toBeInTheDocument();
  });

  it('does not turn a retained report into loading or remove its measurements after refresh failure', () => {
    source.report = { ...boundedReport, charge_port_court: {
      vehicle_id: 7, honesty: 'One returned sample.',
      evidence: [{ at: start, door_open: false, pack_current_a: -1.25, charge_state: 'Charging' }],
    } };
    source.error = new Error('refresh failed');
    renderSection(PhysicsChargePortSection);
    expect(screen.getAllByText('Retained after refresh failure').length).toBeGreaterThan(0);
    expect(metric('physics-port-summary', 'current')).toHaveTextContent('-1.25 A');
    expect(metric('physics-port-transitions', 'disconnected')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByLabelText('Filter charge-port samples by state')).toBeInTheDocument();
  });

  it('distinguishes unavailable initial measurements from loading and retains all summary shells', () => {
    source.report = undefined;
    source.loading = true;
    renderSection(PhysicsCarKeptLivingSection);
    expect(screen.getByTestId('physics-living-summary')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('physics-living-ingestion')).toHaveAttribute('aria-busy', 'true');
    expect(metric('physics-living-summary', 'queued')).toHaveAttribute('data-value-state', 'missing');
  });
});
