/**
 * TeslaOrdersKpiBand — the always-on KPI summary above the Tesla Orders page.
 *
 * The contract pinned here exercises every facet of the band:
 *   • a fully-populated account renders all six metric cards — total,
 *     delivered, in-progress, ready, upgradable and next-delivery — each with
 *     its label and the exact aggregate read off the `stats` prop;
 *   • the three contextual cards carry their subtitles (in-progress / ready /
 *     next-delivery) so the extra guidance never silently drops;
 *   • the next-delivery cell forwards its raw ISO string to `formatDate`
 *     verbatim and renders the formatter's result, but shows an em-dash and
 *     never invokes the formatter when there is no upcoming delivery;
 *   • design-language §8 "always visible": an empty account still renders the
 *     full six-card band with every count collapsed to `0`, never a blank
 *     panel;
 *   • null-safety: a malformed `stats` object missing its numeric aggregates
 *     degrades each count to `0` (proving the `?? 0` guards) instead of
 *     rendering an empty value cell;
 *   • a11y: every lucide glyph is decorative and hidden from assistive tech.
 *
 * `useDateFormat` is stubbed so `formatDate` echoes a deterministic, timezone-
 * stable token and we can assert its argument is forwarded unmodified.
 * react-i18next is mocked to echo the English fallback so the labels are
 * deterministic. framer-motion is mocked to a passthrough because the
 * `@/components/data-display` barrel this file pulls in ships motion-driven
 * components; the mock keeps module load hermetic even though the band renders
 * no motion itself.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { OrderStats } from './teslaOrderStats';

// Deterministic date formatting: the real useDateFormat threads user settings +
// timezone; stubbing it pins that `formatDate` receives the raw ISO string
// verbatim and lets us assert an exact, timezone-stable next-delivery cell.
const { formatDate } = vi.hoisted(() => ({
  formatDate: vi.fn((value: unknown) => `fmt:${String(value)}`),
}));
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatDate }),
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

import { TeslaOrdersKpiBand } from './TeslaOrdersKpiBand';

/** Build a well-formed stats aggregate; every field is overridable per case. */
function makeStats(over: Partial<OrderStats> = {}): OrderStats {
  return {
    total: 12,
    byBucket: { inProgress: 3, ready: 2, delivered: 5, cancelled: 1, other: 1 },
    buckets: [
      { bucket: 'inProgress', count: 3 },
      { bucket: 'ready', count: 2 },
      { bucket: 'delivered', count: 5 },
      { bucket: 'cancelled', count: 1 },
      { bucket: 'other', count: 1 },
    ],
    delivered: 5,
    ready: 2,
    inProgress: 3,
    cancelled: 1,
    upgradable: 4,
    models: 2,
    withVin: 6,
    nextDelivery: '2026-08-15T00:00:00Z',
    ...over,
  };
}

function renderBand(over: Partial<OrderStats> = {}) {
  return render(<TeslaOrdersKpiBand stats={makeStats(over)} />);
}

/** All six card labels, in render order. */
const LABELS = [
  'Total Orders',
  'Delivered',
  'In Progress',
  'Ready · Transit',
  'Upgradable',
  'Next Delivery',
] as const;

beforeEach(() => {
  formatDate.mockClear();
});

describe('TeslaOrdersKpiBand', () => {
  it('renders every one of the six KPI cards with its label', () => {
    renderBand();

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('renders each lifecycle aggregate read off the stats prop', () => {
    renderBand({
      total: 12,
      delivered: 5,
      inProgress: 3,
      ready: 2,
      upgradable: 4,
    });

    // Every count is distinct so each assertion is unambiguous.
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('renders the contextual subtitles on the in-progress, ready and next-delivery cards', () => {
    renderBand();

    expect(screen.getByText('Booked or building')).toBeInTheDocument();
    expect(screen.getByText('Awaiting handover')).toBeInTheDocument();
    expect(screen.getByText('Soonest upcoming')).toBeInTheDocument();
  });

  it('forwards the raw nextDelivery ISO string to the formatter verbatim and renders its result', () => {
    renderBand({ nextDelivery: '2026-12-31T23:59:00Z' });

    expect(formatDate).toHaveBeenCalledWith('2026-12-31T23:59:00Z');
    expect(screen.getByText('fmt:2026-12-31T23:59:00Z')).toBeInTheDocument();
  });

  it('shows an em-dash and never calls the formatter when there is no upcoming delivery', () => {
    renderBand({ nextDelivery: null });

    expect(formatDate).not.toHaveBeenCalled();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('always renders the full six-card band for an empty account, collapsing counts to zero (§8)', () => {
    renderBand({
      total: 0,
      delivered: 0,
      inProgress: 0,
      ready: 0,
      upgradable: 0,
      nextDelivery: null,
    });

    // The band never disappears — all six labels remain.
    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Five numeric cards collapse to 0; the next-delivery cell shows an em-dash.
    expect(screen.getAllByText('0')).toHaveLength(5);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('is null-safe: coerces missing numeric aggregates to zero rather than rendering a blank value', () => {
    // A malformed stats object with no numeric fields (e.g. a stale cached
    // shape). The `?? 0` guards must keep every value cell populated.
    render(<TeslaOrdersKpiBand stats={{ nextDelivery: null } as OrderStats} />);

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('0')).toHaveLength(5);
    expect(formatDate).not.toHaveBeenCalled();
  });

  it('hides its decorative lucide icons from assistive technology (a11y)', () => {
    const { container } = renderBand();

    // One decorative glyph per card → six aria-hidden icons.
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(6);
  });
});
