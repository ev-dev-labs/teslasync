/**
 * SummaryStatsRow — the security page's top-of-page KPI band.
 *
 * <SummaryStatsRow> is a pure, prop-driven row of four <MetricCard>s
 * (Current Status / Last Lock Change / Sentry Uptime / Total Events) plus a
 * dedicated loading affordance. The facets pinned here exercise every branch
 * of the component:
 *
 *   • the loading branch renders a four-cell skeleton grid exposed as an
 *     aria-busy role="status" live region (so assistive tech announces the
 *     wait) and NEVER leaks a metric card;
 *   • the loaded branch renders exactly the four labelled cards and drops the
 *     status region;
 *   • the secure⇄unsecure branch flips both the Current Status value AND the
 *     card accent tone (green vs red);
 *   • Last Lock Change degrades an undefined timestamp to "—" and otherwise
 *     renders a relative age via timeSince;
 *   • Sentry Uptime rounds through fmtInt and suffixes "%", clamping a
 *     non-finite value to "0%" rather than printing NaN;
 *   • Total Events renders locale thousands separators, shows a real 0, and
 *     clamps a non-finite count to "0" (regression pin: a raw {value} used to
 *     print "NaN" for a corrupt count);
 *   • the three non-status cards wire their cyan / blue / purple accents;
 *   • a11y: every card's decorative icon is aria-hidden.
 *
 * react-i18next is mocked to echo each call's English fallback and interpolate
 * {{token}} placeholders so copy is deterministic and no i18n backend is hit.
 * numberFormat's global locale defaults to en-US (never mutated in tests), so
 * fmtInt output is stable.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

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

import { SummaryStatsRow } from './SummaryStatsRow';

type Props = {
  isSecure: boolean;
  lastLockChange: string | undefined;
  sentryUptime: number;
  totalEvents: number;
  isLoading: boolean;
};

/** English fallbacks the mocked `t` echoes for each card label. */
const LABELS = {
  status: 'Current Status',
  lastLock: 'Last Lock Change',
  sentryUptime: 'Sentry Uptime',
  totalEvents: 'Total Events',
} as const;

function renderRow(props: Partial<Props> = {}) {
  const merged: Props = {
    isSecure: true,
    lastLockChange: undefined,
    sentryUptime: 0,
    totalEvents: 0,
    isLoading: false,
    ...props,
  };
  return render(<SummaryStatsRow {...merged} />);
}

/** The <MetricCard> root (`[data-role="metric-card"]`) that wraps a given label. */
function card(label: string): HTMLElement {
  const root = screen.getByText(label).closest('[data-role="metric-card"]');
  if (!root) throw new Error(`no card for "${label}"`);
  return root as HTMLElement;
}

/** The bold value node inside a card. */
function cardValue(label: string): string {
  const p = card(label).querySelector('[data-role="metric-value"]');
  if (!p) throw new Error(`no value node in card "${label}"`);
  return p.textContent ?? '';
}

/** The icon wrapper inside a card — carries the `data-color` accent tone. */
function cardTone(label: string): string {
  const chip = card(label).querySelector('[data-role="metric-icon"]');
  if (!(chip instanceof HTMLElement)) throw new Error(`no icon chip in card "${label}"`);
  return chip.dataset.color ?? '';
}

describe('SummaryStatsRow', () => {
  it('renders a four-cell skeleton grid as an aria-busy status region while loading (no cards leak)', () => {
    const { container } = renderRow({ isLoading: true });

    const region = screen.getByRole('status', { name: /loading/i });
    expect(region).toBeInTheDocument();
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);

    // The metric cards must not render behind the skeletons.
    expect(screen.queryByText(LABELS.status)).toBeNull();
    expect(screen.queryByText(LABELS.totalEvents)).toBeNull();
  });

  it('renders exactly the four labelled metric cards (and no status region) once loaded', () => {
    renderRow({ isLoading: false, totalEvents: 5 });

    for (const label of Object.values(LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Loading affordance is gone once data is present.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows a green "Secure" status when isSecure is true', () => {
    renderRow({ isSecure: true });

    expect(cardValue(LABELS.status)).toBe('Secure');
    expect(cardTone(LABELS.status)).toBe('green');
  });

  it('shows a red "Unsecure" status when isSecure is false', () => {
    renderRow({ isSecure: false });

    expect(cardValue(LABELS.status)).toBe('Unsecure');
    expect(cardTone(LABELS.status)).toBe('red');
  });

  it('degrades an undefined last-lock timestamp to an em dash', () => {
    renderRow({ lastLockChange: undefined });
    expect(cardValue(LABELS.lastLock)).toBe('—');
  });

  it('renders a relative age for a recent last-lock timestamp', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    renderRow({ lastLockChange: threeHoursAgo });
    expect(cardValue(LABELS.lastLock)).toBe('3h ago');
  });

  it('rounds sentry uptime through fmtInt and suffixes a percent sign', () => {
    renderRow({ sentryUptime: 87.6 });
    expect(cardValue(LABELS.sentryUptime)).toBe('88%');
  });

  it('clamps a non-finite sentry uptime to "0%" instead of printing NaN', () => {
    renderRow({ sentryUptime: Number.NaN });
    expect(cardValue(LABELS.sentryUptime)).toBe('0%');
  });

  it('formats total events with locale thousands separators', () => {
    renderRow({ totalEvents: 12345 });
    expect(cardValue(LABELS.totalEvents)).toBe('12,345');
  });

  it('renders a zero total-events count as "0" (never hidden)', () => {
    renderRow({ totalEvents: 0 });
    expect(cardValue(LABELS.totalEvents)).toBe('0');
  });

  it('clamps a non-finite total-events count to "0" (regression: raw {value} printed NaN)', () => {
    renderRow({ totalEvents: Number.NaN });
    expect(cardValue(LABELS.totalEvents)).toBe('0');
  });

  it('wires the non-status cards to their cyan / blue / purple accent tones', () => {
    renderRow({ lastLockChange: undefined, sentryUptime: 50, totalEvents: 10 });

    expect(cardTone(LABELS.lastLock)).toBe('cyan');
    expect(cardTone(LABELS.sentryUptime)).toBe('blue');
    expect(cardTone(LABELS.totalEvents)).toBe('purple');
  });

  it("marks each card's decorative icon aria-hidden (a11y)", () => {
    renderRow({ isSecure: true, sentryUptime: 42, totalEvents: 3 });

    for (const label of Object.values(LABELS)) {
      expect(card(label).querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
  });
});
