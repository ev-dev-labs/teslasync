import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';
import '../../../i18n';

import { formatMetric } from '@/lib/metric-reference';
import { OnboardingSetupStatusBand } from './OnboardingSetupStatusBand';

vi.mock('@/lib/metric-reference', async () => {
  const actual = await vi.importActual<typeof import('@/lib/metric-reference')>('@/lib/metric-reference');
  return { ...actual, formatMetric: vi.fn(actual.formatMetric) };
});

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({
    settings: {
      unit_of_length: 'km',
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      decimal_precision: 2,
      locale: 'en-US',
      currency_symbol: '$',
    },
    settingsUnavailable: false,
    locale: 'en-US',
  }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDateTime: (value: string) => `formatted ${value}` }),
}));

const retry = vi.fn();
type BandProps = ComponentProps<typeof OnboardingSetupStatusBand>;
const defaults: BandProps = {
  teslaConnected: false,
  vehicleCount: 0,
  telemetryHealth: 'unknown',
  setupComplete: false,
  isLoading: false,
  hasData: true,
  error: null,
  onRetry: retry,
};

function renderBand(overrides: Partial<BandProps> = {}) {
  return render(
    <MemoryRouter>
      <OnboardingSetupStatusBand {...defaults} {...overrides} />
    </MemoryRouter>,
  );
}

function metric(key: string) {
  const element = screen.getByTestId('onboarding-setup-brief')
    .querySelector(`[data-operational-metric="${key}"]`);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing setup metric: ${key}`);
  return element;
}

describe('OnboardingSetupStatusBand — real compact Brief and raw metric bridge', () => {
  beforeEach(() => {
    retry.mockClear();
    vi.mocked(formatMetric).mockClear();
  });

  it('retains genuine zero counts, their denominator and source status captions', () => {
    renderBand();
    expect(screen.getByTestId('onboarding-setup-brief')).toHaveAttribute('data-operational-brief');
    expect(metric('setup-progress')).toHaveAttribute('data-value-state', 'value');
    expect(metric('setup-progress').querySelector('[data-operational-value]')).toHaveTextContent('0/3');
    expect(metric('vehicles').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(within(metric('tesla')).getByText('Not connected')).toBeInTheDocument();
    expect(within(metric('telemetry')).getByText('Waiting')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the first sync')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Setup progress: 0/3' })).toBeInTheDocument();
    expect(vi.mocked(formatMetric)).toHaveBeenCalledWith(
      'count', 0, expect.any(Object), expect.any(String), { countTotal: 3 },
    );
    expect(vi.mocked(formatMetric)).toHaveBeenCalledWith(
      'count', 0, expect.any(Object), expect.any(String), undefined,
    );
  });

  it('does not turn an absent response into disconnected statuses or measured zero', () => {
    renderBand({ hasData: false });
    for (const key of ['setup-progress', 'tesla', 'vehicles', 'telemetry']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'missing');
      expect(metric(key).querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
    expect(screen.queryByRole('img', { name: /Setup progress:/ })).toBeNull();
    expect(screen.queryByText('Not connected')).toBeNull();
    expect(screen.getByText('Setup status not yet received')).toBeInTheDocument();
    expect(vi.mocked(formatMetric)).toHaveBeenCalledWith(
      'count', null, expect.any(Object), expect.any(String), { countTotal: 3 },
    );
  });

  it('marks the loading root busy without exposing fabricated operational values', () => {
    renderBand({ hasData: false, isLoading: true });
    const brief = screen.getByTestId('onboarding-setup-brief');
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(brief.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(metric('vehicles')).toHaveAttribute('data-value-state', 'missing');
  });

  it('retains completed setup during a telemetry outage without claiming live health', () => {
    renderBand({
      setupComplete: true,
      teslaConnected: true,
      vehicleCount: 2,
      telemetryHealth: 'stale',
      lastTelemetryAt: '2026-10-06T20:00:00Z',
    });
    expect(metric('setup-progress').querySelector('[data-operational-value]')).toHaveTextContent('3/3');
    expect(metric('vehicles').querySelector('[data-operational-value]')).toHaveTextContent('2');
    expect(within(metric('telemetry')).getByText('Interrupted')).toBeInTheDocument();
    expect(screen.getByText('Stored history remains available')).toBeInTheDocument();
    expect(screen.getByText('Last telemetry: formatted 2026-10-06T20:00:00Z')).toBeInTheDocument();
  });

  it('distinguishes retained source data from a currently healthy fetch', () => {
    renderBand({ retained: true, teslaConnected: true, vehicleCount: 2 });
    expect(screen.getByText('Retained setup status')).toBeInTheDocument();
    expect(metric('setup-progress').querySelector('[data-operational-value]')).toHaveTextContent('2/3');
    expect(metric('vehicles')).toHaveAttribute('data-value-state', 'value');
    expect(screen.getByText('Last telemetry time not supplied')).toBeInTheDocument();
  });

  it('retains fatal-error recovery beside missing summary values', () => {
    renderBand({ hasData: false, error: new Error('Setup check failed') });
    expect(screen.getByText('Setup status unavailable')).toBeInTheDocument();
    expect(metric('vehicles')).toHaveAttribute('data-value-state', 'missing');
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('keeps invalid numerical counts invalid rather than coercing them to status text', () => {
    renderBand({ vehicleCount: Number.NaN });
    expect(metric('vehicles')).toHaveAttribute('data-value-state', 'invalid');
    expect(metric('vehicles').querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(vi.mocked(formatMetric)).toHaveBeenCalledWith(
      'count', Number.NaN, expect.any(Object), expect.any(String), undefined,
    );
  });

  it('opens the real Review details drawer with original captions, gauge and provenance and closes on Escape', async () => {
    renderBand({ teslaConnected: true, vehicleCount: 1, telemetryHealth: 'healthy' });
    const trigger = screen.getByRole('button', { name: 'Review details' });
    trigger.focus();
    fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: 'Setup status details' });
    expect(within(drawer).getByText('Fleet API access authorized')).toBeInTheDocument();
    expect(within(drawer).getByText('Synced from the Fleet API')).toBeInTheDocument();
    expect(within(drawer).getByText('Live signals arriving')).toBeInTheDocument();
    expect(within(drawer).getByRole('img', { name: 'Setup progress: 3/3' })).toBeInTheDocument();
    expect(within(drawer).getByText(/Existing onboarding status response;/)).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('OnboardingSetupStatusBand — semantic setup ring', () => {
  beforeEach(() => {
    retry.mockClear();
    vi.mocked(formatMetric).mockClear();
  });

  it.each([
    {
      caseName: 'measured zero',
      props: {},
      completed: 0,
      color: 'var(--semantic-info)',
      status: 'In progress',
    },
    {
      caseName: 'one completed anchor',
      props: { teslaConnected: true },
      completed: 1,
      color: 'var(--semantic-info)',
      status: 'In progress',
    },
    {
      caseName: 'two completed anchors',
      props: { teslaConnected: true, vehicleCount: 2 },
      completed: 2,
      color: 'var(--semantic-info)',
      status: 'In progress',
    },
    {
      caseName: 'all anchors without setup confirmation',
      props: { teslaConnected: true, vehicleCount: 2, telemetryHealth: 'healthy' },
      completed: 3,
      color: 'var(--semantic-info)',
      status: 'In progress',
    },
    {
      caseName: 'confirmed setup during a telemetry outage',
      props: { setupComplete: true, telemetryHealth: 'stale' },
      completed: 3,
      color: 'var(--semantic-success)',
      status: 'All steps complete',
    },
  ] satisfies readonly {
    caseName: string;
    props: Partial<BandProps>;
    completed: number;
    color: string;
    status: string;
  }[])('preserves progress and percentage with semantic paint for $caseName', ({
    props, completed, color, status,
  }) => {
    renderBand(props);
    const ring = screen.getByRole('img', { name: `Setup progress: ${completed}/3` });
    const arc = ring.querySelector('circle[stroke-dasharray]');
    if (!(arc instanceof SVGElement)) throw new Error('Missing setup progress arc');

    expect(arc).toHaveAttribute('stroke', color);
    expect(arc).toHaveAttribute('stroke-width', '6');
    expect(ring.querySelector('svg')).toHaveAttribute('width', '60');
    expect(ring.querySelector('svg')).toHaveAttribute('height', '60');
    expect(Number(arc.getAttribute('stroke-dasharray'))).toBeCloseTo(169.64600329384882);
    expect(Number(arc.getAttribute('stroke-dashoffset')))
      .toBeCloseTo(169.64600329384882 * (1 - completed / 3));
    expect(within(ring).getByText(`${completed}/3`)).toBeInTheDocument();
    expect(metric('setup-progress').querySelector('[data-operational-value]'))
      .toHaveTextContent(`${completed}/3`);
    expect(screen.getByText(status, { selector: 'span.rounded-full' }))
      .toBeInTheDocument();
  });

  it('keeps missing setup unknown without a success ring even when completion is supplied', () => {
    renderBand({ hasData: false, setupComplete: true, vehicleCount: 0 });
    expect(screen.getByText('Setup status not yet received')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Setup progress:/ })).toBeNull();
    for (const key of ['setup-progress', 'tesla', 'vehicles', 'telemetry']) {
      expect(metric(key)).toHaveAttribute('data-value-state', 'missing');
      expect(metric(key).querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
  });

  it('retains source warning and retry beside a confirmed semantic ring during refresh failure', () => {
    renderBand({
      setupComplete: true,
      retained: true,
      telemetryHealth: 'stale',
      vehicleCount: 0,
      error: new Error('Setup refresh failed'),
    });
    const ring = screen.getByRole('img', { name: 'Setup progress: 3/3' });
    expect(ring.querySelector('circle[stroke-dasharray]'))
      .toHaveAttribute('stroke', 'var(--semantic-success)');
    expect(metric('setup-progress').querySelector('[data-operational-value]')).toHaveTextContent('3/3');
    expect(metric('vehicles').querySelector('[data-operational-value]')).toHaveTextContent('0');
    expect(within(metric('telemetry')).getByText('Interrupted')).toBeInTheDocument();
    expect(screen.getByText('Setup status unavailable')).toBeInTheDocument();
    expect(screen.getByText('Stored history remains available')).toBeInTheDocument();
    expect(screen.getByText('Last telemetry time not supplied')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry|try again/i }));
    expect(retry).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Setup status details' });
    expect(within(drawer).getByText(/completed setup remains complete during a live-service outage/))
      .toBeInTheDocument();
    expect(within(drawer).getByRole('img', { name: 'Setup progress: 3/3' })
      .querySelector('circle[stroke-dasharray]'))
      .toHaveAttribute('stroke', 'var(--semantic-success)');
  });
});
