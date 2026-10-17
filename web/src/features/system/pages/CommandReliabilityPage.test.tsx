import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { CommandLogEntry } from '@/api/hooks/useCommands';

const translationFixture = vi.hoisted(() => ({
  language: 'en',
  labels: {} as Record<string, string>,
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
        const template = translationFixture.labels[key] ?? (typeof fallback === 'string' ? fallback : key);
        return template.replace(/{{(\w+)}}/g, (match, name: string) =>
          vars && name in vars ? String(vars[name]) : match);
      },
      i18n: { language: translationFixture.language, changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});
vi.mock('@/api/hooks/useCommands', () => ({ useCommandReliabilityHistory: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-01-01T00:00:00Z',
    endInstantExclusive: '2026-02-01T00:00:00Z',
  }),
}));
vi.mock('@/hooks/useProductPreferences', () => ({
  useProductPreferences: () => ({ preferences: { defaultAnalysisRange: '30d' } }),
}));
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return { ...actual, useTimezone: () => 'UTC' };
});
vi.mock('@/lib/csvExport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport');
  return { ...actual, downloadCSV: vi.fn() };
});

import { useCommandReliabilityHistory } from '@/api/hooks/useCommands';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { downloadCSV } from '@/lib/csvExport';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';
import { MockResizeObserver } from '@/test/setup';
import CommandReliabilityPage from './CommandReliabilityPage';

const mockHistory = useCommandReliabilityHistory as unknown as ReturnType<typeof vi.fn>;
const mockVehicle = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;

function query(data: CommandLogEntry[] | undefined, overrides: Record<string, unknown> = {}) {
  return {
    data, isLoading: false, isFetching: false, isError: false,
    error: null, refetch: vi.fn(), ...overrides,
  };
}

function commands(): CommandLogEntry[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({
      id: index + 1, vehicle_id: 7, command: 'lock', params: '',
      status: index < 2 ? 'success' : 'failed', error: index < 2 ? '' : 'Vehicle offline',
      created_at: new Date(Date.UTC(2026, 0, 15, 12, index)).toISOString(),
    })),
    {
      id: 6, vehicle_id: 7, command: 'honk_horn', params: '',
      status: 'pending', error: '', created_at: '2026-01-15T13:00:00Z',
    },
  ];
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/command-reliability']}>
        <CommandReliabilityPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function band() {
  return screen.getByRole('region', { name: 'Command reliability metrics' });
}

function stat(label: string) {
  const element = within(band()).getByText(label).closest('[data-operational-metric]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing genuine operational metric: ${label}`);
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  translationFixture.language = 'en';
  translationFixture.labels = {};
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  mockVehicle.mockReturnValue({ vehicleId: 7 });
  mockHistory.mockReturnValue(query([]));
});

afterEach(() => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  vi.unstubAllGlobals();
});

/**
 * jsdom has no layout engine, so Recharts' ResponsiveContainer measures 0×0
 * and renders no plot — which also hides the "Save as SVG" export item (the
 * menu only offers SVG when a capture-eligible plot exists). Give observed
 * elements a real size so the genuine chart renders, mirroring the
 * PackCapacityModernization convention.
 */
function stubLayoutSize(width = 800, height = 400) {
  class SizedObserver extends MockResizeObserver {
    override observe(target: Element): void {
      Object.defineProperty(target, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
          width, height, top: 0, left: 0, right: width, bottom: height,
          x: 0, y: 0, toJSON: () => ({}),
        }),
      });
      super.observe(target);
      this.trigger(target);
    }
  }
  vi.stubGlobal('ResizeObserver', SizedObserver);
}

describe('CommandReliabilityPage — genuine summary OperationalBrief', () => {
  it('preserves the zero-attempt record and every original caption and section', () => {
    renderPage();
    expect(band().querySelector('[data-operational-brief]')).toBeInTheDocument();
    expect(band().querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(stat('Overall success').querySelector('[data-operational-value]')).toHaveTextContent('0%');
    // Metric context moved off the face into the drawer's per-metric groups.
    expect(stat('Overall success')).not.toHaveTextContent('0 attempts');
    expect(stat('Unreliable commands')).not.toHaveTextContent('Nothing failing');
    expect(band().querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(4);
    expect(screen.getByRole('heading', { name: 'Command breakdown' })).toBeInTheDocument();
    expect(screen.getByText('No remote commands have been issued yet, so there is no reliability record to grade.')).toBeInTheDocument();
    expect(screen.getByText('No commands recorded yet.')).toBeInTheDocument();
    expect(mockHistory).toHaveBeenCalledWith(7, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    fireEvent.click(within(band()).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Overall success' })).toHaveTextContent('0 attempts');
    expect(within(dialog).getByRole('group', { name: 'Unreliable commands' })).toHaveTextContent('Nothing failing');
    expect(within(dialog).getByRole('group', { name: 'Distinct intents' })).toHaveTextContent('after collapsing retry storms');
    expect(within(dialog).getByRole('group', { name: 'Retry storms' })).toHaveTextContent('you pressed it again, and again');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  describe('CommandReliabilityPage source trust and complete chart evidence', () => {
    it('shows source failure and read retry in every section without empty-history claims', () => {
      const refetch = vi.fn();
      mockHistory.mockReturnValue(query(undefined, { error: new Error('History unavailable'), refetch }));
      renderPage();
      expect(screen.getByRole('heading', { name: 'Confidence-weighted success' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Command breakdown' })).toBeInTheDocument();
      expect(screen.queryByText('No commands recorded yet.')).not.toBeInTheDocument();
      expect(screen.queryByText('No remote commands have been issued yet, so there is no reliability record to grade.')).not.toBeInTheDocument();
      const retries = screen.getAllByRole('button', { name: 'Retry' });
      expect(retries).toHaveLength(3);
      retries.forEach((button) => fireEvent.click(button));
      expect(refetch).toHaveBeenCalledTimes(3);
    });

    it('keeps an initially paused read unknown rather than claiming no records', () => {
      mockHistory.mockReturnValue(query(undefined, { isPending: true, fetchStatus: 'paused' }));
      renderPage();
      // The brief's status moved into the drawer header; the two chart/detail
      // sections still name the outage on the face.
      expect(screen.getAllByText('Command outcomes unavailable')).toHaveLength(2);
      assertOperationalBriefDisclosure(band(), 'Command outcomes unavailable');
      expect(screen.queryByText('No attempts recorded')).not.toBeInTheDocument();
      expect(screen.queryByText('No commands recorded yet.')).not.toBeInTheDocument();
      expect(screen.queryByText('No remote commands have been issued yet, so there is no reliability record to grade.')).not.toBeInTheDocument();
      // Unknown metrics are omitted from the face; the drawer counts all four.
      expect(band().querySelectorAll('[data-operational-metric]')).toHaveLength(0);
      expect(within(band()).getByText('No metric values are available yet.')).toBeInTheDocument();
      for (const label of ['Overall success', 'Unreliable commands', 'Distinct intents', 'Retry storms']) {
        assertOperationalMetricUnavailable(band(), label);
      }
      expect(screen.queryByText('Nothing failing')).not.toBeInTheDocument();
    });

    it('retains paused history and every confidence row without replacing it with empty content', () => {
      const data = commands();
      const original = structuredClone(data);
      mockHistory.mockReturnValue(query(data, { fetchStatus: 'paused', isPending: false }));
      renderPage();
      expect(stat('Overall success')).toHaveTextContent('40%');
      assertOperationalBriefDisclosure(band(), 'Data may be stale');
      expect(within(screen.getByRole('table')).getByText('Lock')).toBeInTheDocument();
      expect(within(screen.getByRole('table')).getByText('Honk horn')).toBeInTheDocument();
      expect(screen.getByText('2 ok · 3 failed')).toBeInTheDocument();
      expect(data).toEqual(original);
    });

    it('preserves full colliding command names in the fallback table and CSV action', () => {
      mockHistory.mockReturnValue(query([
        { id: 41, vehicle_id: 7, command: 'command_prefix_shares_twenty_four_chars_alpha', params: '', status: 'failed', error: '', created_at: '2026-01-15T12:00:00Z' },
        { id: 42, vehicle_id: 7, command: 'command_prefix_shares_twenty_four_chars_beta', params: '', status: 'success', error: '', created_at: '2026-01-15T12:01:00Z' },
      ]));
      stubLayoutSize();
      renderPage();
      const table = screen.getByRole('table');
      expect(within(table).getByText('Command prefix shares twenty four chars alpha')).toBeInTheDocument();
      expect(within(table).getByText('Command prefix shares twenty four chars beta')).toBeInTheDocument();
      expect(within(table).getAllByRole('row')).toHaveLength(3);
      fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
      expect(screen.getByRole('menuitem', { name: 'Download data as CSV' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Save as PNG' })).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Save as SVG' })).toBeInTheDocument();
    });

    it('distinguishes pending-only confidence from measured zero success in the chart and detail', () => {
      mockHistory.mockReturnValue(query([
        { id: 51, vehicle_id: 7, command: 'wake_up', params: '', status: 'pending', error: '', created_at: '2026-01-15T12:00:00Z' },
        { id: 52, vehicle_id: 7, command: 'lock', params: '', status: 'failed', error: '', created_at: '2026-01-15T12:01:00Z' },
      ]));
      renderPage();
      const table = screen.getByRole('table');
      const pending = within(table).getByText('Wake up').closest('tr');
      const failure = within(table).getByText('Lock').closest('tr');
      if (!pending || !failure) throw new Error('Missing original command rows');
      expect(within(pending).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
        'Wake up', '—', '—', '—', '1', 'Not enough attempts',
      ]);
      expect(within(failure).getAllByRole('cell')[2]).toHaveTextContent('0');
      const detail = screen.getAllByText('Wake up').find((node) => node.closest('li'))?.closest('li');
      if (!detail) throw new Error('Missing pending command detail');
      const interval = within(detail).getByText('95 % interval');
      expect(interval.tagName).toBe('DT');
      expect(interval.nextElementSibling).toHaveTextContent('Unknown');
      expect(interval.nextElementSibling?.tagName).toBe('DD');
    });

    describe('NEED02 translated grades and locale display', () => {
      it.each([
        ['excellent', 40, 40, 'Hervorragend'],
        ['good', 10, 10, 'Gut'],
        ['flaky', 8, 7, 'Wechselhaft'],
        ['unreliable', 5, 0, 'Unzuverlässig'],
        ['unproven', 1, 1, 'Zu wenige Versuche'],
      ] as const)('translates %s in both the six-column fallback and detail badge without changing the CSV grade', (grade, total, successes, label) => {
        // Controlled translation fixture proves lookup, not canonical key presence.
        translationFixture.language = 'de';
        translationFixture.labels = { [`commandReliability.grade.${grade}`]: label };
        const data = Array.from({ length: total }, (_, index) => ({
          id: index + 1, vehicle_id: 7, command: 'lock', params: '',
          status: index < successes ? 'success' : 'failed', error: '',
          created_at: new Date(Date.UTC(2026, 0, 15, 0, index)).toISOString(),
        }));
        const original = structuredClone(data);
        mockHistory.mockReturnValue(query(data));
        renderPage();
        const table = screen.getByRole('table');
        expect(within(table).getAllByRole('columnheader')).toHaveLength(6);
        expect(within(table).getByText(label)).toBeInTheDocument();
        const detail = screen.getAllByText('Lock').find((node) => node.closest('li'))?.closest('li');
        if (!detail) throw new Error('Missing original command detail');
        expect(within(detail).getByText(label)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
        expect(downloadCSV).toHaveBeenCalledOnce();
        const csv = vi.mocked(downloadCSV).mock.calls[0]?.[1];
        expect(csv).toContain('command,command_id,lower,naive,upper,attempts,grade');
        expect(csv).toContain(`,${total},${grade}`);
        expect(csv).not.toContain(label);
        expect(data).toEqual(original);
      });

      it('localizes confidence, retry effort and counts while exporting raw decimals and full colliding identities', () => {
        setGlobalLocale('de-DE');
        const first = 'command_prefix_shares_twenty_four_chars_alpha';
        const second = 'command_prefix_shares_twenty_four_chars_beta';
        const data = [
          { id: 81, vehicle_id: 7, command: first, params: '', status: 'success', error: '', created_at: '2026-01-15T12:00:00Z' },
          { id: 82, vehicle_id: 7, command: first, params: '', status: 'failed', error: 'Vehicle offline', created_at: '2026-01-15T12:01:00Z' },
          { id: 83, vehicle_id: 7, command: first, params: '', status: 'success', error: '', created_at: '2026-01-15T12:10:00Z' },
          ...Array.from({ length: 1234 }, (_, index) => ({
            id: index + 100, vehicle_id: 7, command: second, params: '',
            status: 'failed', error: 'Vehicle offline',
            created_at: new Date(Date.UTC(2026, 0, 15, 13, index)).toISOString(),
          })),
        ];
        const original = structuredClone(data);
        mockHistory.mockReturnValue(query(data));
        renderPage();
        const table = screen.getByRole('table');
        const row = within(table).getByText('Command prefix shares twenty four chars alpha').closest('tr');
        if (!row) throw new Error('Missing full command identity');
        expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
          'Command prefix shares twenty four chars alpha', '20,8', '66,7', '93,9', '3', 'Not enough attempts',
        ]);
        expect(within(table).getByText('Command prefix shares twenty four chars beta')).toBeInTheDocument();
        expect(within(table).getByText('1.234')).toBeInTheDocument();
        expect(screen.getByText('1,5 · 1 retried')).toBeInTheDocument();
        expect(screen.getByText('21–94%')).toBeInTheDocument();
        expect(screen.getByText('0 ok · 1.234 failed')).toBeInTheDocument();
        expect(screen.getByText('1.234 · 1 retried')).toBeInTheDocument();
        expect(screen.getByText('Vehicle offline (×1.234)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
        const csv = vi.mocked(downloadCSV).mock.calls[0]?.[1];
        expect(csv).toContain(`${first},20.8,66.7,93.9,3,unproven`);
        expect(csv).toContain(`${second},0,0,0.3,1234,unreliable`);
        expect(csv).not.toContain('1.234');
        expect(data).toEqual(original);
      });

      it('updates number presentation on locale changes without refetching or changing raw exports', () => {
        mockHistory.mockReturnValue(query([
          { id: 91, vehicle_id: 7, command: 'lock', params: '', status: 'success', error: '', created_at: '2026-01-15T12:00:00Z' },
          { id: 92, vehicle_id: 7, command: 'lock', params: '', status: 'failed', error: '', created_at: '2026-01-15T12:01:00Z' },
          { id: 93, vehicle_id: 7, command: 'lock', params: '', status: 'success', error: '', created_at: '2026-01-15T12:10:00Z' },
        ]));
        renderPage();
        expect(screen.getByText('1.5 · 1 retried')).toBeInTheDocument();
        expect(within(screen.getByRole('table')).getByText('66.7')).toBeInTheDocument();
        act(() => setGlobalLocale('de-DE'));
        expect(screen.getByText('1,5 · 1 retried')).toBeInTheDocument();
        expect(within(screen.getByRole('table')).getByText('66,7')).toBeInTheDocument();
        expect(mockHistory).toHaveBeenLastCalledWith(7, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
        expect(mockHistory.mock.results[mockHistory.mock.results.length - 1]?.value.refetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Export chart' }));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Download data as CSV' }));
        expect(vi.mocked(downloadCSV).mock.calls[0]?.[1]).toContain('Lock,lock,20.8,66.7,93.9,3,unproven');
      });
    });

    it('keeps full normalized failure evidence in semantic definition pairs', () => {
      const error = 'FailureSignature'.repeat(8);
      mockHistory.mockReturnValue(query([
        { id: 61, vehicle_id: 7, command: 'lock', params: '', status: 'failed', error, created_at: '2026-01-15T12:00:00Z' },
      ]));
      renderPage();
      const label = screen.getByText('Usual failure');
      expect(label.tagName).toBe('DT');
      expect(label.nextElementSibling?.tagName).toBe('DD');
      expect(label.nextElementSibling).toHaveTextContent(`${error.slice(0, 120)} (×1)`);
      expect(label.nextElementSibling).toHaveClass('min-w-0', 'break-words', 'text-[var(--semantic-danger)]');
      expect(screen.getByText('0 ok · 1 failed')).toBeInTheDocument();
    });

    it('uses the vehicle timezone for range, last-used date and retained fetch time', async () => {
      const timezone = await import('@/lib/timezone');
      const zone = vi.spyOn(timezone, 'useTimezone').mockReturnValue('America/Los_Angeles');
      try {
        mockHistory.mockReturnValue(query([
          { id: 71, vehicle_id: 7, command: 'lock', params: '', status: 'success', error: '', created_at: '2026-01-15T00:30:00Z' },
        ], { dataUpdatedAt: Date.UTC(2026, 0, 15, 0, 30) }));
        renderPage();
        const date = screen.getByText('Last used').nextElementSibling;
        expect(date).toHaveTextContent('Jan 14');
        // The range scope moved off the face into the drawer header.
        assertOperationalBriefDisclosure(band(), 'Dec 31, 2025', { contains: true });
        assertOperationalBriefDisclosure(band(), 'Jan 14, 2026', { contains: true });
        expect(mockHistory).toHaveBeenCalledWith(7, '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
      } finally {
        zone.mockRestore();
      }
    });
  });

  it('preserves resolved-success rates, all attempts and collapsed retry-intent definitions', () => {
    mockHistory.mockReturnValue(query(commands()));
    renderPage();
    expect(stat('Overall success').querySelector('[data-operational-value]')).toHaveTextContent('40%');
    expect(stat('Unreliable commands').querySelector('[data-operational-value]')).toHaveTextContent('1');
    expect(stat('Distinct intents').querySelector('[data-operational-value]')).toHaveTextContent('2');
    expect(stat('Retry storms').querySelector('[data-operational-value]')).toHaveTextContent('1');
    // Attempt counts and the worst-command identity moved off the face into
    // the drawer's per-metric groups.
    expect(stat('Overall success')).not.toHaveTextContent('6 attempts');
    fireEvent.click(within(band()).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('group', { name: 'Overall success' })).toHaveTextContent('6 attempts');
    expect(within(dialog).getByRole('group', { name: 'Unreliable commands' })).toHaveTextContent('Lock');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Confidence-weighted success' })).toBeInTheDocument();
    expect(screen.getByText('2 ok · 3 failed')).toBeInTheDocument();
    expect(screen.getByText('5 · 1 retried')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
  });

  it('keeps loading and missing sources distinct from measured zero', () => {
    mockHistory.mockReturnValue(query(undefined, { isLoading: true }));
    const view = renderPage();
    expect(band().querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(band().querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(band().querySelector('[data-operational-value]')).not.toBeInTheDocument();
    view.unmount();
    mockHistory.mockReturnValue(query(undefined));
    renderPage();
    expect(band().querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(4);
    expect(within(band()).queryByText('0 attempts')).not.toBeInTheDocument();
    expect(within(band()).queryByText('Nothing failing')).not.toBeInTheDocument();
  });

  it('keeps retained values, source warning and the existing retry action on refresh failure', () => {
    const refetch = vi.fn();
    mockHistory.mockReturnValue(query(commands(), { error: new Error('refresh failed'), refetch }));
    renderPage();
    expect(stat('Overall success').querySelector('[data-operational-value]')).toHaveTextContent('40%');
    assertOperationalBriefDisclosure(band(), 'Data may be stale');
    fireEvent.click(within(band()).getByRole('button', { name: 'Review details' }));
    const staleDialog = screen.getByRole('dialog');
    expect(within(staleDialog).getByRole('group', { name: 'Overall success' })).toHaveTextContent('6 attempts');
    fireEvent.keyDown(staleDialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByText(/Previously loaded data remains visible/).length).toBeGreaterThan(0);
    fireEvent.click(within(screen.getByTestId('stale-refresh-warning')).getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(screen.getByRole('heading', { name: 'Command breakdown' })).toBeInTheDocument();
  });

  it('retains the fatal source retry rather than fabricating summary values', () => {
    const refetch = vi.fn();
    mockHistory.mockReturnValue(query(undefined, { error: new Error('failed'), refetch }));
    renderPage();
    expect(band().querySelector('[data-operational-metric]')).not.toBeInTheDocument();
    fireEvent.click(within(band()).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
