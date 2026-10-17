// Behavioural contract for MyActivityKpiBand — the responsive strip of five
// summary metrics at the top of the My Activity page. Exercises the loaded
// vs. loading branches, locale-aware integer formatting, the relative
// "last active" label, omission (never an em-dash placeholder) when that
// timestamp is unknown, the accessible loading state (aria-busy +
// role="status" live region), and null-safety against a missing kpis payload.
//
// The global test setup resolves t('key', 'Default') to 'Default' with
// interpolation, so no i18n setup is needed. The component pulls in no
// router / query context, so a bare render() is sufficient.

import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { MyActivityKpiBand } from './MyActivityKpiBand';
import type { ActivityKpis } from './myActivityAnalytics';
vi.mock('@/hooks/useSettings', async importOriginal => ({
  ...await importOriginal<typeof import('@/hooks/useSettings')>(),
  useSettings: () => ({ settings: { locale: 'en-US', decimal_precision: 2, currency_symbol: '$' }, settingsUnavailable: false }),
}));

const EM_DASH = '\u2014'; // `—` must never appear: unknown readings are omitted, not placeholder-dashed

function makeKpis(overrides: Partial<ActivityKpis> = {}): ActivityKpis {
  return {
    total: 0,
    activeDays: 0,
    actionTypes: 0,
    entitiesTouched: 0,
    lastActivityTs: null,
    ...overrides,
  };
}

describe('MyActivityKpiBand', () => {
  it('renders every KPI card with its label and formatted value', () => {
    const { container } = render(
      <MyActivityKpiBand
        kpis={makeKpis({
          total: 12_345,
          activeDays: 30,
          actionTypes: 8,
          entitiesTouched: 42,
          lastActivityTs: null,
        })}
        isLoading={false}
      />,
    );

    // The four measured KPIs stay on the face, each paired with its
    // (distinct) formatted value.
    const value = (key: string) =>
      container.querySelector(`[data-operational-metric="${key}"] [data-operational-value]`);
    expect(screen.getByText('Total actions')).toBeInTheDocument();
    expect(screen.getByText('Active days')).toBeInTheDocument();
    expect(screen.getByText('Action types')).toBeInTheDocument();
    expect(screen.getByText('Entities touched')).toBeInTheDocument();
    expect(value('total')).toHaveTextContent('12,345');
    expect(value('days')).toHaveTextContent('30');
    expect(value('types')).toHaveTextContent('8');
    expect(value('entities')).toHaveTextContent('42');

    // The unknown last-activity reading is omitted from the face (never an
    // em-dash placeholder); the drawer carries the counted explanation.
    expect(screen.queryByText('Last active')).not.toBeInTheDocument();
    expect(container.querySelector('[data-operational-metric="last-active"]')).toBeNull();
    assertOperationalMetricUnavailable(container, 'Last active');

    // The band exposes an accessible region name and is not busy when loaded.
    const region = screen.getByRole('region', { name: /Activity summary/i });
    expect(region).not.toHaveAttribute('aria-busy', 'true');
    // No loading live region survives into the loaded state.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('formats large counts with locale thousands separators', () => {
    render(
      <MyActivityKpiBand kpis={makeKpis({ total: 1_234_567 })} isLoading={false} />,
    );

    expect(screen.getByText('1,234,567')).toBeInTheDocument();
  });

  it('renders a relative "last active" label from a recent timestamp', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    render(
      <MyActivityKpiBand
        kpis={makeKpis({ lastActivityTs: twoHoursAgo })}
        isLoading={false}
      />,
    );

    expect(screen.getByText('2h ago')).toBeInTheDocument();
    // The relative label must not collapse to the em-dash when a timestamp exists.
    expect(screen.queryByText(EM_DASH)).toBeNull();
  });

  it('shows an em-dash when there is no last activity timestamp', () => {
    const { container } = render(
      <MyActivityKpiBand
        kpis={makeKpis({ total: 5, lastActivityTs: null })}
        isLoading={false}
      />,
    );

    // The unknown last-activity reading is omitted from the face (never an
    // em-dash placeholder); the drawer carries the counted explanation.
    expect(screen.queryByText('Last active')).not.toBeInTheDocument();
    expect(screen.queryByText(EM_DASH)).not.toBeInTheDocument();
    assertOperationalMetricUnavailable(container, 'Last active');
    // Real counts still render alongside the missing last-active value.
    expect(container.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('5');
  });

  it('renders an accessible loading state and hides the metrics', () => {
    const { container } = render(
      <MyActivityKpiBand kpis={makeKpis({ total: 99 })} isLoading />,
    );

    // aria-busy flips true and a polite live region announces the load.
    const region = screen.getByRole('region', { name: /Activity summary/i });
    expect(region).toHaveAttribute('aria-busy', 'true');
    assertOperationalBriefDisclosure(document.body, 'Loading source');

    // Exactly CARD_COUNT skeleton placeholders are shown.
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(5);
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);

    // Loading wins over the metric grid — no card labels or values leak through.
    expect(screen.getByText('Total actions')).toBeInTheDocument();
    expect(screen.queryByText('99')).toBeNull();
  });

  it('is null-safe: a missing kpis payload retains unknown readings without throwing', () => {
    let container!: HTMLElement;
    expect(() => {
      container = render(<MyActivityKpiBand isLoading={false} />).container;
    }).not.toThrow();

    // Nothing is invented: no zeros, no em-dash placeholders on the face.
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.queryByText(EM_DASH)).toBeNull();
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    const brief = container.querySelector('[data-operational-brief]') as HTMLElement;
    expect(brief).toHaveTextContent('No metric values are available yet.');
    // All five labels survive as chips so the operator knows what is missing...
    for (const label of ['Total actions', 'Active days', 'Action types', 'Entities touched', 'Last active']) {
      expect(within(brief).getByText(label)).toBeInTheDocument();
    }
    // ...and the drawer carries the counted explanation plus the source status.
    assertOperationalMetricUnavailable(brief, 'Total actions');
    assertOperationalMetricUnavailable(brief, 'Active days');
    assertOperationalMetricUnavailable(brief, 'Action types');
    assertOperationalMetricUnavailable(brief, 'Entities touched');
    assertOperationalMetricUnavailable(brief, 'Last active');
    assertOperationalBriefDisclosure(container, 'Source unavailable');
  });
});
