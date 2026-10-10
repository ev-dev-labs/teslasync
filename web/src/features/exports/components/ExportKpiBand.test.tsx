/**
 * ExportKpiBand — the always-on KPI summary above the Exports page.
 *
 * The contract pinned here exercises every facet of the band:
 *   • the loaded band renders all five metric cards — total, ready, in-progress,
 *     failed and total-size — each with its label and the exact aggregate read
 *     off the `stats` prop, formatted through `fmtInt` / `formatBytes`;
 *   • large counts are rendered with locale separators (proving `fmtInt`), and
 *     the storage cell renders a binary-unit byte string, collapsing a zero
 *     footprint to an em-dash (proving `formatBytes`' `zeroAsEmpty`);
 *   • loading keeps the Brief and five metric labels with skeleton values and
 *     no measured values, while keeping the same
 *     labelled landmark region so the summary never loses its accessible name;
 *   • design-language §8 "always visible": an empty account (real
 *     `deriveExportStats([])`) still renders the full five-card band with every
 *     count collapsed to `0` and the storage cell to `—`, never a blank panel;
 *   • null-safety: missing aggregates remain unknown (`—`), not fabricated zero
 *     counts, NaN or empty cells;
 *   • a11y: the band is a labelled region with no exposed decorative glyphs.
 *
 * react-i18next is mocked to echo the English fallback so labels are
 * deterministic. framer-motion is mocked to a passthrough because the
 * `@/components/data-display` barrel this file pulls in ships motion-driven
 * components; the mock keeps module load hermetic even though the band renders
 * no motion itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { deriveExportStats, type ExportStats } from './exportStats';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import * as metricReference from '@/lib/metric-reference';

const settings = vi.hoisted(() => ({
  decimal_precision: 2, locale: 'en-US', unit_of_length: 'km',
  unit_of_temp: 'C', unit_of_pressure: 'bar', currency_symbol: '$',
}));
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings, settingsUnavailable: false }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
  useInView: () => true,
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useSpring: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useTransform: () => ({ get: () => 0, set: vi.fn(), on: vi.fn() }),
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { ExportKpiBand } from './ExportKpiBand';

/** Build a well-formed stats aggregate; every field is overridable per case. */
function makeStats(over: Partial<ExportStats> = {}): ExportStats {
  return {
    total: 42,
    ready: 20,
    inProgress: 7,
    failed: 3,
    expired: 2,
    totalBytes: 1536, // → "1.5 KB"
    byStatus: { ready: 20, processing: 4, queued: 3, failed: 3, expired: 2 },
    ...over,
  };
}

function renderBand(over: Partial<ExportStats> = {}, isLoading = false) {
  return render(<ExportKpiBand stats={makeStats(over)} isLoading={isLoading} />);
}

/** All five card labels, in render order. */
const LABELS = ['Total exports', 'Ready', 'In progress', 'Failed', 'Total size'] as const;

beforeEach(() => {
  settings.decimal_precision = 2;
  settings.locale = 'en-US';
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});
afterEach(() => {
  vi.restoreAllMocks();
  setGlobalPrecision(2);
  setGlobalLocale('en-US');
});

describe('ExportKpiBand', () => {
  it('renders every one of the five KPI cards with its label', () => {
    renderBand();

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders each lifecycle aggregate read off the stats prop', () => {
    renderBand({ total: 42, ready: 20, inProgress: 7, failed: 3 });

    // Every count is distinct so each assertion is unambiguous.
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('formats a large total with locale separators (fmtInt)', () => {
    renderBand({ total: 12345 });

    expect(screen.getByText('12,345')).toBeInTheDocument();
  });

  it('renders the storage footprint as a binary-unit byte string (formatBytes)', () => {
    renderBand({ totalBytes: 1536 });

    expect(screen.getByText('1.50 KB')).toBeInTheDocument();
  });

  it('collapses a zero storage footprint to an em-dash (formatBytes zeroAsEmpty)', () => {
    renderBand({ totalBytes: 0 });

    // The four counts still render; only the storage cell degrades to "—".
    expect(screen.getByText('Total size')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('retains the Brief and five labels with busy skeleton values while loading, not fabricated measurements', () => {
    const { container } = renderBand({}, true);

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(container.querySelectorAll('[data-operational-metric] [aria-hidden="true"][class*="--surface-3"]')).toHaveLength(5);
  });

  it('keeps the labelled summary region present in both the loading and loaded states', () => {
    // A <section> with an aria-label exposes the "region" landmark role.
    const loading = renderBand({}, true);
    expect(
      loading.getByRole('region', { name: 'Export summary' }),
    ).toBeInTheDocument();
    loading.unmount();

    renderBand();
    expect(
      screen.getByRole('region', { name: 'Export summary' }),
    ).toBeInTheDocument();
  });

  it('always renders the full five-card band for an empty account, collapsing to zero / em-dash (§8)', () => {
    // Feed the real deriver so the empty-state path is exercised end to end.
    render(<ExportKpiBand stats={deriveExportStats([])} isLoading={false} />);

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Four numeric cards collapse to 0; the storage cell shows an em-dash.
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('is null-safe: keeps missing stats unknown rather than fabricating zero or rendering NaN', () => {
    render(<ExportKpiBand stats={{} as ExportStats} isLoading={false} />);

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(5);
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('does not expose decorative glyphs as accessible images (a11y)', () => {
    const { container } = renderBand();

    expect(screen.queryAllByRole('img')).toHaveLength(0);
    for (const icon of container.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });

  it('preserves raw numeric bytes and counts through the real bridge and distinguishes measured zero from missing', () => {
    const formatSpy = vi.spyOn(metricReference, 'formatMetric');
    const view = render(<ExportKpiBand stats={deriveExportStats([])} isLoading={false} />);
    const storage = view.container.querySelector('[data-operational-metric="storage"]');
    expect(storage).toHaveAttribute('data-value-state', 'value');
    expect(storage?.querySelector('[data-operational-value]')).toHaveTextContent('—');
    expect(view.container.querySelector('[data-operational-metric="total"]')).toHaveAttribute('data-value-state', 'value');
    expect(screen.queryByText('No measurement supplied')).not.toBeInTheDocument();
    expect(formatSpy).toHaveBeenCalledWith('bytes', 0, expect.any(Object), undefined,
      expect.objectContaining({ formatter: expect.any(Function) }));
    expect(formatSpy).toHaveBeenCalledWith('count', 0, expect.any(Object), undefined, undefined);

    view.rerender(<ExportKpiBand stats={deriveExportStats([])} isLoading={false} hasData={false} />);
    expect(view.container.querySelectorAll('[data-value-state="missing"]')).toHaveLength(5);
    expect(screen.getAllByText('No measurement supplied')).toHaveLength(5);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    expect(formatSpy).toHaveBeenCalledWith('bytes', null, expect.any(Object), undefined,
      expect.objectContaining({ formatter: expect.any(Function) }));
    formatSpy.mockRestore();
  });

  it('rejects invalid counts and bytes before the specialist formatter runs', () => {
    const { container } = renderBand({ total: 1.5, ready: -1, totalBytes: Number.NaN });
    expect(container.querySelector('[data-operational-metric="total"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(container.querySelector('[data-operational-metric="ready"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(container.querySelector('[data-operational-metric="storage"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('keeps binary storage formatting and saved locale/precision without treating numeric bytes as text', () => {
    settings.decimal_precision = 3;
    settings.locale = 'de-DE';
    setGlobalPrecision(3);
    setGlobalLocale('de-DE');
    const { container } = renderBand({ total: 12345, totalBytes: 1536 });
    expect(screen.getByText('12.345')).toBeInTheDocument();
    expect(screen.getByText('1,500 KB')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="storage"]')).toHaveAttribute('data-value-state', 'value');
  });

  it('opens the real Review details drawer with complete captions and source limitations, then restores focus on Escape', async () => {
    renderBand();
    const trigger = screen.getByRole('button', { name: 'Review details' });
    trigger.focus();
    fireEvent.click(trigger);
    const drawer = await screen.findByRole('dialog', { name: 'Export summary details' });
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument();
    expect(within(drawer).getByText('Queued and processing jobs combined; this is not a completion estimate.')).toBeInTheDocument();
    expect(within(drawer).getByText('Sum of known positive finite file sizes in bytes across all returned jobs; missing or invalid sizes contribute nothing.')).toBeInTheDocument();
    expect(within(drawer).getByText('Binary byte units use saved precision and locale. A zero footprint displays as —, not as an unknown source.')).toBeInTheDocument();
    expect(within(drawer).getByText(/Derived from the export\/jobs response snapshot; list coverage is not an all-time or date-range guarantee\./)).toBeInTheDocument();
    const drawerHeader = drawer.querySelector('[data-drawer-header]');
    if (!(drawerHeader instanceof HTMLElement)) throw new Error('Export summary drawer header is missing');
    expect(within(drawerHeader).getByText('Loaded jobs before table filters and pagination; no date window is applied.')).toBeInTheDocument();
    expect(within(drawerHeader).getByText(/Successful load time is unknown\./)).toBeInTheDocument();
    expect(within(drawer).getByText('1.50 KB')).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
