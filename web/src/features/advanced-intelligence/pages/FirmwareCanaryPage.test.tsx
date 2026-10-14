import type { ReactElement, ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataStateSource } from '@/api/dataState';
import type { AdvancedPage, FirmwareCanary } from '@/types/advancedIntelligence';
import { ToastProvider } from '@/components/feedback';
import { typography } from '@/lib/tokens';
import { formatDateTime } from '@/lib/dateFormat';
import { firmware, observation } from './advancedIntelligenceClosure.fixtures';
import FirmwareCanaryPage from './FirmwareCanaryPage';

const state = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  query: {} as DataStateSource<AdvancedPage<FirmwareCanary>>,
  read: vi.fn(),
  retry: vi.fn(),
  locale: 'en-US',
  timezone: 'UTC',
}));

vi.mock('@/api/hooks/useAdvancedIntelligence', () => ({
  useFirmwareCanary: (...args: unknown[]) => {
    state.read(...args);
    return state.query;
  },
}));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: state.vehicleId }),
}));
vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => ({
      settings: { locale: state.locale, tz_display_default: 'vehicle', ui_density: 'comfortable' },
      locale: state.locale,
      decimals: 2,
    }),
  };
});
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return { ...actual, useTimezone: () => state.timezone };
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Providers({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>
      <MemoryRouter><ToastProvider>{children}</ToastProvider></MemoryRouter>
    </QueryClientProvider>;
  }
  const view = render(<FirmwareCanaryPage />, { wrapper: Providers });
  return {
    ...view,
    rerender: (element: ReactElement = <FirmwareCanaryPage />) => view.rerender(element),
  };
}

function decision(version = '2026.20') {
  const article = screen.getByRole('heading', { name: version }).closest('article');
  if (!article) throw new Error('Missing firmware decision article');
  return article;
}

function populate(items: FirmwareCanary[] = [firmware], total = items.length) {
  state.query.data = { items, total, limit: 10, offset: 0 };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.vehicleId = 7;
  state.locale = 'en-US';
  state.timezone = 'UTC';
  state.query = {
    data: undefined,
    error: null,
    isError: false,
    isLoading: false,
    isFetching: false,
    fetchStatus: 'idle',
    refetch: state.retry,
  };
  window.localStorage.clear();
});

describe('FirmwareCanaryPage restrained decision presentation', () => {
  it('reactively formats generated timestamps with the display timezone and locale without mutating UTC data', () => {
    const generatedAt = '2026-06-01T00:30:00Z';
    populate([{ ...firmware, generated_at: generatedAt }]);
    const view = renderPage();
    const utcLabel = formatDateTime(generatedAt, { locale: 'en-US', tz: 'UTC' });
    expect(within(decision()).getByText(utcLabel)).toBeInTheDocument();

    state.timezone = 'America/Los_Angeles';
    view.rerender();
    const localLabel = formatDateTime(generatedAt, { locale: 'en-US', tz: state.timezone });
    expect(localLabel).not.toBe(utcLabel);
    expect(within(decision()).getByText(localLabel)).toBeInTheDocument();
    expect(within(decision()).queryByText(utcLabel)).not.toBeInTheDocument();

    state.locale = 'de-DE';
    view.rerender();
    const localizedLabel = formatDateTime(generatedAt, { locale: state.locale, tz: state.timezone });
    expect(localizedLabel).not.toBe(localLabel);
    expect(within(decision()).getByText(localizedLabel)).toBeInTheDocument();
    expect(within(decision()).queryByText(localLabel)).not.toBeInTheDocument();
    expect(state.query.data?.items[0].generated_at).toBe(generatedAt);
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 0);
  });

  it.each([null, undefined, '', 'invalid-date'])('preserves the generated-date placeholder for %s', generatedAt => {
    const item = { ...firmware };
    Reflect.set(item, 'generated_at', generatedAt);
    populate([item]);
    const view = renderPage();
    const placeholders = () => within(decision()).getAllByText('—');
    expect(placeholders()).toHaveLength(3);
    state.locale = 'de-DE';
    state.timezone = 'America/Los_Angeles';
    view.rerender();
    expect(placeholders()).toHaveLength(3);
    expect(within(decision()).queryByText(/Invalid Date/)).not.toBeInTheDocument();
    expect(state.query.data?.items[0].generated_at).toBe(generatedAt);
  });

  it('uses the shared neutral card without changing article identity or regression values', () => {
    populate();
    renderPage();
    const article = decision();
    const card = article.querySelector('[data-print-card]');
    expect(card).toHaveClass(
      'rounded-panel', 'border-[var(--panel-border)]', 'bg-[var(--panel-bg)]',
      'forced-colors:border-[CanvasText]', 'forced-colors:bg-[Canvas]',
    );
    expect(article).toHaveClass('min-w-0', 'break-words');
    expect(article).not.toHaveClass('border-white/[0.08]', 'bg-white/[0.025]');
    expect(within(article).getByText('0.00%')).toBeInTheDocument();
    expect(within(article).getAllByText('—')).toHaveLength(2);
    expect(within(article).getByText('insufficient')).toBeInTheDocument();
    ['Target regression', 'Peer regression', 'Matched excess', 'Decision generated']
      .forEach(label => expect(within(article).getByText(label)).toBeInTheDocument());
    const rationale = within(article).getByText('Decision rationale').parentElement;
    expect(rationale).toHaveClass('border-[var(--border-default)]', 'bg-[var(--surface-2)]');
    expect(rationale).not.toHaveClass('border-white/[0.06]');
    expect(within(article).getByText(/do not contain enough supported observations/)).toBeInTheDocument();
    const icon = article.querySelector('.lucide-git-compare-arrows');
    expect(icon).toHaveClass(...typography.color.secondary.split(' '), 'shrink-0');
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });

  it('preserves every returned version, status and supported rationale in source order', () => {
    populate([
      { ...firmware, decision: 'rollout', vehicle_regression_pct: -1, peer_regression_pct: 0, matched_excess_pct: -1 },
      { ...firmware, version: '2026.21', decision: 'hold' },
      { ...firmware, version: '2026.22', decision: 'investigate' },
      { ...firmware, version: null },
    ]);
    renderPage();
    expect(screen.getAllByRole('article').map(article =>
      within(article).getByRole('heading', { level: 3 }).textContent))
      .toEqual(['2026.20', '2026.21', '2026.22', 'Version unsupported']);
    expect(within(decision()).getAllByText('-1.00%')).toHaveLength(2);
    expect(within(decision()).getByText('0.00%')).toBeInTheDocument();
    expect(within(decision()).getByText('rollout')).toBeInTheDocument();
    expect(within(decision('2026.21')).getByText('hold')).toBeInTheDocument();
    expect(within(decision('2026.22')).getByText('investigate')).toBeInTheDocument();
    expect(within(decision()).getByText(/relative to the matched peer change and window quality/)).toBeInTheDocument();
  });

  it('retains evidence metadata and unsupported deployment limits without exposing command actions', () => {
    populate([{ ...firmware, evidence: [
      observation, { ...observation, source: 'second-source', sample_count: null },
    ] }]);
    renderPage();
    const quality = screen.getByRole('region', { name: 'Data quality' });
    expect(within(quality).getByText('Limited evidence')).toBeInTheDocument();
    expect(within(quality).getByText('0')).toBeInTheDocument();
    expect(within(quality).getByText('—')).toBeInTheDocument();
    expect(within(quality).getByText(/2026/)).toBeInTheDocument();
    expect(within(quality).getByText(/No meter coverage; do not infer a measured loss/)).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    const first = within(sources).getByText(observation.source);
    const second = within(sources).getByText('second-source');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(sources).getByText(/0 samples/)).toBeInTheDocument();
    const limitations = screen.getByRole('region', { name: 'Limitations' });
    expect(within(limitations).getByText(/Matched peers are incomplete/)).toBeInTheDocument();
    expect(within(limitations).getByText('Explicitly unsupported')).toBeInTheDocument();
    expect(within(limitations).getByText(/Proof that firmware caused a measured change/)).toBeInTheDocument();
    expect(within(limitations).getByText(/Firmware deployment or rollback commands/)).toBeInTheDocument();
    expect(screen.getByText(/does not install, hold, or roll back firmware/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /install|hold|rollback|roll back/i })).not.toBeInTheDocument();
  });

  it('keeps caller-owned page size and exact offsets through retained refresh failure', () => {
    populate([firmware], 20);
    const view = renderPage();
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 0);
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 10);
    state.query.error = new Error('refresh failed');
    view.rerender();
    expect(within(decision()).getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByText(/refresh failed; the most recently loaded evidence remains visible/)).toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 0);
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent(observation.source);
  });

  it.each([
    { name: 'unselected vehicle', selected: null, message: 'Select a vehicle to load intelligence.' },
    { name: 'resolved empty windows', selected: 7, message: 'No firmware canary windows are available.' },
  ])('keeps both section shells for $name', ({ selected, message }) => {
    state.vehicleId = selected;
    populate([]);
    renderPage();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Matched cohort decisions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Data quality' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('Explicitly unsupported');
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('retains the warning and evidence shell when the decision source initially fails', () => {
    state.query.error = new Error('source failed');
    state.query.isError = true;
    renderPage();
    expect(screen.getByText('Intelligence evidence could not be loaded.')).toBeInTheDocument();
    expect(screen.getByText(/does not install, hold, or roll back firmware/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

describe('FirmwareCanaryPage investigate rationale', () => {
  function rationale() {
    const panel = within(decision()).getByText('Decision rationale').parentElement;
    if (!panel) throw new Error('Missing decision rationale');
    return panel;
  }

  const sufficientQuality = { ...firmware.window_quality, status: 'sufficient' as const };

  it.each(['peer_regression_pct', 'matched_excess_pct'] as const)(
    'does not infer matched support from missing or invalid %s',
    field => {
      const item: FirmwareCanary = {
        ...firmware, decision: 'investigate', vehicle_regression_pct: 6.25,
        peer_regression_pct: 0, matched_excess_pct: 6.25,
        window_quality: sufficientQuality,
      };
      populate([item]);
      const view = renderPage();
      for (const value of [null, undefined, NaN, Infinity, -Infinity, '', '0', false]) {
        Reflect.set(item, field, value);
        view.rerender();
        expect(rationale()).toHaveTextContent('This is a target-only investigation');
        expect(rationale()).toHaveTextContent('matched-peer support is not established');
        expect(rationale()).toHaveTextContent(
          field === 'peer_regression_pct' ? 'peer regression: —' : 'matched excess: —',
        );
        expect(within(decision()).getAllByText('—')).toHaveLength(1);
        expect(within(decision()).getByText('investigate')).toBeInTheDocument();
        expect(rationale()).not.toHaveTextContent('Investigation uses the returned matched-peer comparison');
      }
    },
  );

  it.each([null, undefined, NaN, Infinity, -Infinity, '', '0', false])(
    'does not turn invalid target regression %s into measured zero',
    value => {
      const item: FirmwareCanary = {
        ...firmware, decision: 'investigate', peer_regression_pct: null, matched_excess_pct: null,
      };
      Reflect.set(item, 'vehicle_regression_pct', value);
      populate([item]);
      renderPage();
      expect(rationale()).toHaveTextContent('Target regression: —');
      expect(rationale()).toHaveTextContent('This is a target-only investigation');
      expect(within(decision()).getAllByText('—')).toHaveLength(3);
      expect(within(decision()).queryByText('0.00%')).not.toBeInTheDocument();
      expect(within(decision()).getByText('investigate')).toBeInTheDocument();
    },
  );

  it.each([
    { target: 0, peer: 0, excess: 0 },
    { target: 6.25, peer: 0, excess: 6.25 },
    { target: -1.25, peer: -5.5, excess: 4.25 },
    { target: 4.5, peer: 4.5, excess: 0 },
    { target: -5.75, peer: -1.5, excess: -4.25 },
  ])('retains measured signed and fractional evidence $target/$peer/$excess without redeciding', values => {
    populate([{
      ...firmware, decision: 'investigate', window_quality: sufficientQuality,
      vehicle_regression_pct: values.target, peer_regression_pct: values.peer,
      matched_excess_pct: values.excess,
    }]);
    renderPage();
    expect(rationale()).toHaveTextContent('Investigation uses the returned matched-peer comparison');
    expect(rationale()).toHaveTextContent(`Target regression: ${values.target.toFixed(2)}%`);
    expect(rationale()).toHaveTextContent(`peer regression: ${values.peer.toFixed(2)}%`);
    expect(rationale()).toHaveTextContent(`matched excess: ${values.excess.toFixed(2)}%`);
    expect(rationale()).toHaveTextContent('Window quality: Sufficient evidence');
    expect(rationale()).not.toHaveTextContent('target-only investigation');
    expect(within(decision()).getByText('investigate')).toBeInTheDocument();
  });

  it.each(['limited', 'insufficient', null, undefined, 'invalid'])(
    'does not claim sufficient matched support for quality %s',
    status => {
      const item: FirmwareCanary = {
        ...firmware, decision: 'investigate', vehicle_regression_pct: 6.5,
        peer_regression_pct: 0, matched_excess_pct: 6.5,
        window_quality: { ...sufficientQuality },
      };
      Reflect.set(item.window_quality, 'status', status);
      populate([item]);
      renderPage();
      expect(rationale()).toHaveTextContent('window quality does not establish sufficient matched-peer support');
      expect(rationale()).not.toHaveTextContent('target-only investigation');
      expect(rationale()).toHaveTextContent(status === 'limited' ? 'Limited evidence'
        : status === 'insufficient' ? 'Insufficient evidence' : 'Quality not supplied');
      expect(within(decision()).getByText('0.00%')).toBeInTheDocument();
    },
  );

  it('explains the actual target-only evidence and preserves the backend thresholds', () => {
    populate([{ ...firmware, decision: 'investigate', vehicle_regression_pct: 5.25 }]);
    renderPage();
    expect(rationale()).toHaveTextContent('This is a target-only investigation');
    expect(rationale()).toHaveTextContent('Target regression: 5.25%; peer regression: —; matched excess: —');
    expect(rationale()).toHaveTextContent('Window quality: Limited evidence');
    expect(rationale()).toHaveTextContent('Target-only investigation requires target regression > 5%');
    expect(rationale()).toHaveTextContent('excess > 10% means hold');
    expect(rationale()).toHaveTextContent('excess ≤ 3% means rollout');
    expect(rationale()).toHaveTextContent('excess > 3% through 10% means investigate');
    expect(state.query.data?.items[0]).toEqual({
      ...firmware, decision: 'investigate', vehicle_regression_pct: 5.25,
    });
  });
});

describe('FirmwareCanaryPage evidence source trust', () => {
  const updatedAt = Date.parse(firmware.generated_at);

  beforeEach(() => {
    Object.assign(state.query, {
      isSuccess: false,
      isPending: true,
      isStale: true,
      dataUpdatedAt: 0,
      errorUpdatedAt: 0,
    });
  });

  function receive(items: FirmwareCanary[] = [firmware], total = items.length) {
    populate(items, total);
    Object.assign(state.query, {
      error: null,
      isError: false,
      isSuccess: true,
      isPending: false,
      isLoading: false,
      isFetching: false,
      isStale: false,
      fetchStatus: 'idle',
      dataUpdatedAt: updatedAt,
      errorUpdatedAt: 0,
    });
  }

  function evidenceSource() {
    const source = screen.getByRole('region', { name: 'Data quality' })
      .closest('[data-source-status]');
    if (!source) throw new Error('Missing firmware evidence source state');
    return source;
  }

  function expectShells() {
    expect(screen.getByRole('heading', { name: 'Matched cohort decisions' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Evidence, quality, and limitations' })).toBeInTheDocument();
    ['Data quality', 'Evidence sources', 'Limitations'].forEach(name =>
      expect(screen.getByRole('region', { name })).toBeInTheDocument());
    const limitations = screen.getByRole('region', { name: 'Limitations' });
    expect(within(limitations).getByText('Explicitly unsupported')).toBeInTheDocument();
    expect(within(limitations).getByText(/Proof that firmware caused a measured change/)).toBeInTheDocument();
    expect(within(limitations).getByText(/Firmware deployment or rollback commands/)).toBeInTheDocument();
    expect(screen.getByText(/does not install, hold, or roll back firmware/)).toBeInTheDocument();
  }

  function expectNoResolvedEvidence() {
    expect(screen.queryByText('Quality metadata is unsupported.')).not.toBeInTheDocument();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
    expect(screen.queryByText(observation.source)).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  }

  it.each([
    { name: 'initial fetch', fetchStatus: 'fetching' as const, failed: false },
    { name: 'unresolved idle source', fetchStatus: 'idle' as const, failed: false },
    { name: 'paused initial source', fetchStatus: 'paused' as const, failed: false },
    { name: 'failed initial source', fetchStatus: 'idle' as const, failed: true },
  ])('does not infer unsupported metadata or returned emptiness for $name', ({ fetchStatus, failed }) => {
    Object.assign(state.query, {
      fetchStatus,
      isLoading: fetchStatus === 'fetching',
      isFetching: fetchStatus === 'fetching',
      isPending: !failed,
      isError: failed,
      error: failed ? new Error('source failed') : null,
      errorUpdatedAt: failed ? updatedAt + 1000 : 0,
    });
    renderPage();
    expectShells();
    expectNoResolvedEvidence();
    expect(evidenceSource()).toHaveAttribute('data-source-status', failed ? 'initialFailure' : 'initial');
    expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'unknown');
    expect(evidenceSource()).toHaveAttribute('aria-busy', String(fetchStatus === 'fetching'));
    if (fetchStatus === 'fetching') {
      ['Data quality', 'Evidence sources', 'Limitations'].forEach(name =>
        expect(within(screen.getByRole('region', { name }))
          .getByRole('status', { name: `Loading ${name}` })).toBeInTheDocument());
    } else {
      ['Data quality', 'Evidence sources', 'Limitations'].forEach(name =>
        expect(within(screen.getByRole('region', { name })).getByText('Unknown')).toBeInTheDocument());
    }
    expect(screen.queryAllByText('Intelligence evidence could not be loaded.')).toHaveLength(failed ? 1 : 0);
  });

  it('keeps an unselected disabled query unknown without adding a recovery action', () => {
    state.vehicleId = null;
    renderPage();
    expectShells();
    expectNoResolvedEvidence();
    expect(state.read).toHaveBeenLastCalledWith(null, 10, 0);
    expect(screen.getByText('Select a vehicle to load intelligence.')).toBeInTheDocument();
    expect(evidenceSource()).toHaveAttribute('data-source-status', 'initial');
    expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'unknown');
    expect(screen.queryByRole('button', { name: /refresh|retry/i })).not.toBeInTheDocument();
  });

  it('only shows authoritative empty metadata after the paused list actually returns', () => {
    state.query.fetchStatus = 'paused';
    const view = renderPage();
    expectNoResolvedEvidence();
    expect(screen.getByText('The initial evidence query is paused; no empty result is inferred.')).toBeInTheDocument();
    receive([]);
    view.rerender();
    expectShells();
    expect(evidenceSource()).toHaveAttribute('data-source-status', 'ok');
    expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'cached');
    expect(screen.getByText('No firmware canary windows are available.')).toBeInTheDocument();
    expect(screen.getByText('Quality metadata is unsupported.')).toBeInTheDocument();
    expect(screen.getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(screen.getByText('No additional limitations were returned.')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.retry).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'in-flight refresh', fetchStatus: 'fetching' as const, failed: false },
    { name: 'paused refresh', fetchStatus: 'paused' as const, failed: false },
    { name: 'failed refresh', fetchStatus: 'idle' as const, failed: true },
  ])('preserves the first decision and its actual evidence pair during $name', ({ fetchStatus, failed }) => {
    receive();
    Object.assign(state.query, {
      fetchStatus,
      isFetching: fetchStatus === 'fetching',
      isStale: true,
      isError: failed,
      isSuccess: !failed,
      error: failed ? new Error('refresh failed') : null,
      errorUpdatedAt: failed ? updatedAt + 1000 : 0,
    });
    renderPage();
    expectShells();
    expect(evidenceSource()).toHaveAttribute('data-source-status', fetchStatus === 'fetching' ? 'ok' : 'stale');
    expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'cached');
    expect(evidenceSource()).toHaveAttribute('aria-busy', String(fetchStatus === 'fetching'));
    expect(within(decision()).getByText('0.00%')).toBeInTheDocument();
    const quality = screen.getByRole('region', { name: 'Data quality' });
    expect(within(quality).getByText('Limited evidence')).toBeInTheDocument();
    expect(within(quality).getByText('0')).toBeInTheDocument();
    expect(within(quality).getByText('—')).toBeInTheDocument();
    expect(within(quality).getByText(/No meter coverage; do not infer a measured loss/)).toBeInTheDocument();
    expect(within(quality).getByText(/2026/)).toBeInTheDocument();
    const sources = screen.getByRole('region', { name: 'Evidence sources' });
    expect(within(sources).getByText(observation.source)).toBeInTheDocument();
    expect(within(sources).getByText(observation.summary)).toBeInTheDocument();
    expect(within(sources).getByText(/0 samples/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('Matched peers are incomplete.');
    expect(state.query.dataUpdatedAt).toBe(updatedAt);
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
    if (fetchStatus !== 'fetching') {
      expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
      if (fetchStatus === 'paused') {
        expect(screen.getByText('Cached evidence remains visible while its refresh is paused.')).toBeInTheDocument();
      }
      fireEvent.click(within(screen.getByTestId('stale-refresh-warning'))
        .getByRole('button', { name: 'Refresh' }));
      expect(state.retry).toHaveBeenCalledOnce();
    } else {
      expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    }
  });

  it.each([
    { name: 'refreshing', fetchStatus: 'fetching' as const, failed: false },
    { name: 'paused', fetchStatus: 'paused' as const, failed: false },
    { name: 'failed', fetchStatus: 'idle' as const, failed: true },
  ])('retains a returned empty list as authoritative while its refresh is $name', ({ fetchStatus, failed }) => {
    receive([]);
    Object.assign(state.query, {
      fetchStatus,
      isFetching: fetchStatus === 'fetching',
      isStale: true,
      isError: failed,
      isSuccess: !failed,
      error: failed ? new Error('empty refresh failed') : null,
      errorUpdatedAt: failed ? updatedAt + 1000 : 0,
    });
    renderPage();
    expectShells();
    expect(evidenceSource()).toHaveAttribute('data-source-status', fetchStatus === 'fetching' ? 'ok' : 'stale');
    expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'cached');
    expect(screen.getByText('No firmware canary windows are available.')).toBeInTheDocument();
    expect(screen.getByText('Quality metadata is unsupported.')).toBeInTheDocument();
    expect(screen.getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(screen.getByText('No additional limitations were returned.')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
  });

  it('keeps metadata scoped to items[0] instead of borrowing from a later supported record', () => {
    const firstWithoutEvidence: FirmwareCanary = {
      ...firmware,
      version: '2026.21',
      window_quality: { ...firmware.window_quality, status: 'insufficient', reasons: [] },
      evidence: [],
      limitations: [],
    };
    receive([firstWithoutEvidence, firmware], 20);
    const view = renderPage();
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(evidenceSource()).toHaveAttribute('data-source-status', 'ok');
    const quality = screen.getByRole('region', { name: 'Data quality' });
    expect(within(quality).getByText('Insufficient evidence')).toBeInTheDocument();
    expect(within(quality).queryByText('Limited evidence')).not.toBeInTheDocument();
    expect(within(quality).queryByText(/No meter coverage; do not infer a measured loss/)).not.toBeInTheDocument();
    expect(screen.getByText('No supporting evidence was returned.')).toBeInTheDocument();
    expect(screen.getByText('No additional limitations were returned.')).toBeInTheDocument();
    expect(screen.queryByText(observation.source)).not.toBeInTheDocument();
    expect(screen.queryByText('Matched peers are incomplete.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 10);
    receive([firmware], 20);
    if (state.query.data) state.query.data.offset = 10;
    view.rerender();
    expect(within(decision()).getByText('0.00%')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent(observation.source);
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('Matched peers are incomplete.');
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent('Limited evidence');
    expect(within(screen.getByRole('region', { name: 'Data quality' })).queryByText('Insufficient evidence')).not.toBeInTheDocument();
    expect(screen.queryByText('No supporting evidence was returned.')).not.toBeInTheDocument();
    expect(screen.queryByText('No additional limitations were returned.')).not.toBeInTheDocument();
    expect(state.read).toHaveBeenLastCalledWith(7, 10, 10);
  });

  it('keeps fatal retry caller-owned and replaces unknown metadata only when a record arrives', () => {
    Object.assign(state.query, {
      isError: true, isPending: false, error: new Error('source failed'),
      errorUpdatedAt: updatedAt + 1000,
    });
    const view = renderPage();
    expectShells();
    expectNoResolvedEvidence();
    expect(screen.getAllByText('Intelligence evidence could not be loaded.')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.retry).toHaveBeenCalledOnce();
    receive();
    view.rerender();
    expect(evidenceSource()).toHaveAttribute('data-source-status', 'ok');
    expect(evidenceSource()).toHaveAttribute('data-source-provenance', 'cached');
    expect(screen.getByRole('region', { name: 'Evidence sources' })).toHaveTextContent(observation.source);
    expect(screen.getByRole('region', { name: 'Limitations' })).toHaveTextContent('Matched peers are incomplete.');
    expect(within(decision()).getByText('insufficient')).toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
    expect(screen.queryByText('Intelligence evidence could not be loaded.')).not.toBeInTheDocument();
  });
});
