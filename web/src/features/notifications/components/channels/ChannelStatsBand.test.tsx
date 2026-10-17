/**
 * ChannelStatsBand — full behavioural coverage.
 *
 * The band has three branches and one derived value, and every one is
 * pinned here:
 *
 *   1. Loaded — the four KPI cards render with their English labels, the
 *      sent / failed / pending counts come straight off the stats payload, and
 *      the "Active Channels" card renders the enabled/total ratio. A dedicated
 *      spec proves the "Total Sent" card reads `sent` (successful deliveries)
 *      and NOT the misnamed `total_sent` (which is really the grand total of
 *      every log) — swapping the two would be a silent regression.
 *   2. Loading — when the query is in flight with no cached stats the band
 *      swaps the cards for a four-cell skeleton wrapped in a labelled
 *      `role="status"` `aria-busy` region (so assistive tech announces the
 *      wait), and none of the metric labels leak through. A background refetch
 *      (isLoading true but stats already cached) keeps the cards up rather than
 *      flashing back to the skeleton — the `!stats` guard.
 *   3. Error — a failed stats query with nothing cached renders a compact
 *      error with retry instead of zeros that would read as healthy. Cached
 *      stats still win over the error (stale-but-honest beats blank).
 *   4. Numeric integrity — missing values remain unknown, measured zeros
 *      remain zero, and the shared count API rejects invalid counts/totals.
 *   5. Accessibility — the four lucide glyphs are decorative and hidden from
 *      assistive tech.
 *
 * `@/components/data-display` (pulled in via MetricCard) drags motion-driven
 * siblings into the module graph, so framer-motion is stubbed to a passthrough
 * to keep module load hermetic in jsdom. react-i18next echoes the English
 * fallback so copy is deterministic without booting the real catalog.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { NotificationStats } from '@/api/types';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import {
  assertOperationalBriefDisclosure,
  assertOperationalMetricUnavailable,
} from '@/test/operationalBriefAssertions';

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
    t: (_key: string, fallback?: string, options?: Record<string, unknown>) => {
      let template = fallback ?? _key;
      const count = options?.count;
      if (typeof count === 'number' && options) {
        const plural = count === 1 ? options.defaultValue_one : options.defaultValue_other;
        if (typeof plural === 'string') template = plural;
      }
      if (options) {
        for (const [name, value] of Object.entries(options)) {
          if (name.startsWith('defaultValue')) continue;
          template = template.replaceAll(`{{${name}}}`, String(value));
        }
      }
      return template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>(
    '@/hooks/useOperationalMetrics',
  );
  return { ...actual, useOperationalMetrics: vi.fn(actual.useOperationalMetrics) };
});

import { ChannelStatsBand } from './ChannelStatsBand';

function expectHiddenCount(brief: HTMLElement, count: number) {
  fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  try {
    expect(within(dialog).getByText(
      count === 1 ? '1 empty field is hidden.' : `${count} empty fields are hidden.`,
    )).toBeInTheDocument();
  } finally {
    fireEvent.keyDown(dialog, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

function mappedValueStates() {
  const mapped = vi.mocked(useOperationalMetrics).mock.results.at(-1)?.value as
    readonly { valueState?: string }[] | undefined;
  return mapped?.map(metric => metric.valueState);
}

// Every rendered figure is distinct so getByText is unambiguous. `total_sent`
// is deliberately a value that appears nowhere else on screen — the band must
// never render it (it reads `sent`, not `total_sent`).
const FULL: NotificationStats = {
  total_sent: 52,
  sent: 42,
  failed: 7,
  pending: 3,
  total_channels: 8,
  enabled_channels: 5,
};

describe('ChannelStatsBand — loaded', () => {
  it('renders all four KPI cards with their English labels', () => {
    const { container } = render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(4);
    expect(screen.getByText('Total sent')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Active channels')).toBeInTheDocument();
  });

  it('renders the sent / failed / pending counts and the enabled/total ratio', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    expect(screen.getByText('42')).toBeInTheDocument(); // sent
    expect(screen.getByText('7')).toBeInTheDocument(); // failed
    expect(screen.getByText('3')).toBeInTheDocument(); // pending
    expect(screen.getByText('5/8')).toBeInTheDocument(); // enabled/total
    const brief = screen.getByTestId('notification-channel-brief');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    try {
      expect(dialog).toHaveTextContent('Delivery counts have no reported time bounds; active channels are the configured enabled/total count.');
    } finally {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    }
  });

  it('retains the screenshot active-channel numerator and denominator without duplicating the band', () => {
    const { container } = render(<ChannelStatsBand stats={{ ...FULL, enabled_channels: 1, total_channels: 1 }} isLoading={false} />);
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="channels-active"] [data-operational-value]')).toHaveTextContent('1/1');
  });

  it('reads `sent` (successful deliveries), never the misnamed `total_sent`', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    // total_sent (52) is the grand total of every log and must not surface.
    expect(screen.queryByText('52')).not.toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('shows no loading skeleton once stats have resolved', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ChannelStatsBand — loading', () => {
  it('swaps the cards for a labelled, busy skeleton region while loading', () => {
    const { container } = render(<ChannelStatsBand stats={undefined} isLoading />);

    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveAttribute('aria-label', 'Loading notification statistics');
    // Four skeleton cells, and none of the metric labels leak through.
    expect(container.querySelectorAll('[class*="--skeleton-bg"]')).toHaveLength(4);
    expect(screen.queryByText('Total sent')).not.toBeInTheDocument();
  });

  it('keeps cached cards up during a background refetch (isLoading + stats)', () => {
    // isLoading is true but stats are already cached: the `!stats` guard keeps
    // the cards on screen instead of flashing back to the skeleton.
    render(<ChannelStatsBand stats={FULL} isLoading />);

    expect(screen.getByText('Total sent')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('ChannelStatsBand — error', () => {
  it('renders a retryable error instead of healthy-looking zeros when the stats query fails', () => {
    const onRetry = vi.fn();
    // QueryError calls useNavigate unconditionally, so the error branch needs
    // a Router even though the band itself is router-free.
    render(
      <MemoryRouter>
        <ChannelStatsBand stats={undefined} isLoading={false} error={new Error('stats down')} onRetry={onRetry} />
      </MemoryRouter>,
    );

    // No zeroed cards ("Total Sent 0, Failed 0…") that would read as healthy.
    expect(screen.queryByText('Total sent')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed')).not.toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps cached stats up when a background refetch errors', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} error={new Error('stats down')} />);

    expect(screen.getByText('Total sent')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('ChannelStatsBand — null safety', () => {
  it('keeps all four missing metrics and their reasons for an undefined payload', () => {
    render(<ChannelStatsBand stats={undefined} isLoading={false} />);
    const brief = screen.getByTestId('notification-channel-brief');

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(mappedValueStates()).toEqual(['missing', 'missing', 'missing', 'missing']);
    for (const label of ['Total sent', 'Failed', 'Pending', 'Active channels']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenCount(brief, 4);
    assertOperationalBriefDisclosure(brief, 'No statistics supplied');
    expect(screen.queryByText('0/0')).not.toBeInTheDocument();
    expect(brief).toHaveTextContent('Active channels');
  });

  it('keeps individually-missing numeric fields unknown while retaining valid siblings', () => {
    const partial: NotificationStats = JSON.parse('{"sent":9}');
    render(<ChannelStatsBand stats={partial} isLoading={false} />);
    const brief = screen.getByTestId('notification-channel-brief');

    expect(screen.getByText('9')).toBeInTheDocument();
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(1);
    expect(brief.querySelectorAll('[data-value-state="missing"], [data-value-state="invalid"]')).toHaveLength(0);
    expect(mappedValueStates()).toEqual(['value', 'missing', 'missing', 'missing']);
    for (const label of ['Failed', 'Pending', 'Active channels']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenCount(brief, 3);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('keeps explicit null inputs unknown rather than measured zero', () => {
    const stats: NotificationStats = JSON.parse(
      '{"sent":null,"failed":null,"pending":null,"enabled_channels":null,"total_channels":null}',
    );
    render(<ChannelStatsBand stats={stats} isLoading={false} />);
    const brief = screen.getByTestId('notification-channel-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(mappedValueStates()).toEqual(['missing', 'missing', 'missing', 'missing']);
    for (const label of ['Total sent', 'Failed', 'Pending', 'Active channels']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenCount(brief, 4);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('rejects numeric strings rather than coercing them into counts', () => {
    const stats: NotificationStats = JSON.parse(
      '{"sent":"12","failed":"0","pending":"3","enabled_channels":"5","total_channels":8}',
    );
    render(<ChannelStatsBand stats={stats} isLoading={false} />);
    const brief = screen.getByTestId('notification-channel-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expect(mappedValueStates()).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
    for (const label of ['Total sent', 'Failed', 'Pending', 'Active channels']) {
      assertOperationalMetricUnavailable(brief, label);
    }
    expectHiddenCount(brief, 4);
  });

  it.each(['enabled_channels', 'total_channels'] as const)('keeps the ratio unknown when %s is missing', field => {
    const partial = { ...FULL };
    Reflect.deleteProperty(partial, field);
    render(<ChannelStatsBand stats={partial} isLoading={false} />);
    const brief = screen.getByTestId('notification-channel-brief');
    expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
    expect(mappedValueStates()).toEqual(['value', 'value', 'value', 'missing']);
    assertOperationalMetricUnavailable(brief, 'Active channels');
    expectHiddenCount(brief, 1);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('preserves measured zero including a measured 0/0 ratio', () => {
    const { container } = render(<ChannelStatsBand stats={{
      total_sent: 0, sent: 0, failed: 0, pending: 0, enabled_channels: 0, total_channels: 0,
    }} isLoading={false} />);
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(screen.getAllByText('0')).toHaveLength(3);
    expect(screen.getByText('0/0')).toBeInTheDocument();
    expect(screen.queryByText('No measurement supplied')).not.toBeInTheDocument();
  });

  it.each([NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'passes invalid count %s through shared validation without rounding or clamping', value => {
      render(<ChannelStatsBand stats={{
        ...FULL, sent: value, failed: value, pending: value, enabled_channels: value,
      }} isLoading={false} />);
      const brief = screen.getByTestId('notification-channel-brief');
      const inputs = vi.mocked(useOperationalMetrics).mock.calls.at(-1)![0];
      for (const metric of inputs) {
        expect(Object.is(metric.rawValue, value)).toBe(true);
      }
      expect(mappedValueStates()).toEqual(['invalid', 'invalid', 'invalid', 'invalid']);
      expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
      for (const label of ['Total sent', 'Failed', 'Pending', 'Active channels']) {
        assertOperationalMetricUnavailable(brief, label);
      }
      expectHiddenCount(brief, 4);
    },
  );

  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid ratio total %s while retaining delivery counts', total => {
      render(<ChannelStatsBand stats={{ ...FULL, total_channels: total }} isLoading={false} />);
      const brief = screen.getByTestId('notification-channel-brief');
      expect(mappedValueStates()).toEqual(['value', 'value', 'value', 'invalid']);
      expect(brief.querySelectorAll('[data-operational-metric]')).toHaveLength(3);
      assertOperationalMetricUnavailable(brief, 'Active channels');
      expectHiddenCount(brief, 1);
      expect(screen.getByText('42')).toBeInTheDocument();
    },
  );

  it('preserves valid explicitly positive counts and signed zero', () => {
    const { container } = render(<ChannelStatsBand stats={{
      ...FULL, sent: +12, failed: -0, pending: +3, enabled_channels: +5, total_channels: +8,
    }} isLoading={false} />);
    expect(container.querySelectorAll('[data-value-state="value"]')).toHaveLength(4);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('5/8')).toBeInTheDocument();
  });
});

describe('ChannelStatsBand — accessibility', () => {
  it('marks all four metric glyphs as decorative', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);
    const brief = screen.getByTestId('notification-channel-brief');

    // One lucide icon per drawer metric group, each hidden from assistive tech.
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const dialog = screen.getByRole('dialog');
    try {
      expect(dialog.querySelectorAll('[role="group"] svg[aria-hidden="true"]')).toHaveLength(4);
    } finally {
      fireEvent.keyDown(dialog, { key: 'Escape' });
    }
  });

  it('opens the shared Review details drawer with every count and its source context', () => {
    render(<ChannelStatsBand stats={FULL} isLoading={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Delivery counts have no reported time bounds; active channels are the configured enabled/total count.');
    expect(drawer).toHaveTextContent('Total sent');
    expect(drawer).toHaveTextContent('42');
    expect(drawer).toHaveTextContent('Active channels');
    expect(drawer).toHaveTextContent('5/8');
  });
});
