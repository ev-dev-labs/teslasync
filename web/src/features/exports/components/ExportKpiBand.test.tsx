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
 *   • the `isLoading` branch swaps the whole band for five skeleton
 *     placeholders and shows none of the metric labels, while keeping the same
 *     labelled landmark region so the summary never loses its accessible name;
 *   • design-language §8 "always visible": an empty account (real
 *     `deriveExportStats([])`) still renders the full five-card band with every
 *     count collapsed to `0` and the storage cell to `—`, never a blank panel;
 *   • null-safety: a malformed `stats` object missing its numeric aggregates
 *     degrades each count to `0` and the storage cell to `—` (proving the
 *     `fmtInt` / `formatBytes` guards) instead of rendering NaN or an empty cell;
 *   • a11y: the band is a labelled region and every lucide glyph is decorative
 *     and hidden from assistive tech.
 *
 * react-i18next is mocked to echo the English fallback so labels are
 * deterministic. framer-motion is mocked to a passthrough because the
 * `@/components/data-display` barrel this file pulls in ships motion-driven
 * components; the mock keeps module load hermetic even though the band renders
 * no motion itself.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { deriveExportStats, type ExportStats } from './exportStats';

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
const LABELS = ['Total Exports', 'Ready', 'In Progress', 'Failed', 'Total Size'] as const;

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

    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
  });

  it('collapses a zero storage footprint to an em-dash (formatBytes zeroAsEmpty)', () => {
    renderBand({ totalBytes: 0 });

    // The four counts still render; only the storage cell degrades to "—".
    expect(screen.getByText('Total Size')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('swaps the band for five skeleton placeholders while loading and shows no metric labels', () => {
    const { container } = renderBand({}, true);

    // None of the metric cards are mounted during the loading branch.
    for (const label of LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // Exactly five skeleton placeholders stand in for the five cards.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
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

  it('is null-safe: coerces a malformed stats object to zero / em-dash rather than NaN or a blank cell', () => {
    // A stale/partial cached shape with no numeric fields. The formatter guards
    // (fmtInt → safeNumber, formatBytes → nullish check) must keep every value
    // cell populated.
    render(<ExportKpiBand stats={{} as ExportStats} isLoading={false} />);

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('NaN')).not.toBeInTheDocument();
  });

  it('hides its decorative lucide icons from assistive technology (a11y)', () => {
    const { container } = renderBand();

    // One decorative glyph per card → at least five aria-hidden icons.
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(5);
  });
});
