// Behavioural contract for MyActivityKpiBand — the responsive strip of five
// summary MetricCards at the top of the My Activity page. Exercises the loaded
// vs. loading branches, locale-aware integer formatting, the relative
// "last active" label, its em-dash empty-value guard, the accessible loading
// state (aria-busy + role="status" live region), and null-safety against a
// missing kpis payload.
//
// react-i18next's useTranslation returns the second argument (English
// fallback) when no provider is mounted, so t('key', 'Default') resolves to
// 'Default' without any i18n setup. The component pulls in no router / query
// context, so a bare render() is sufficient.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MyActivityKpiBand } from './MyActivityKpiBand';
import type { ActivityKpis } from './myActivityAnalytics';

const EM_DASH = '\u2014'; // `—` shown when there is no last-activity timestamp

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
    render(
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

    // All five labels are present…
    expect(screen.getByText('Total actions')).toBeInTheDocument();
    expect(screen.getByText('Active days')).toBeInTheDocument();
    expect(screen.getByText('Action types')).toBeInTheDocument();
    expect(screen.getByText('Entities touched')).toBeInTheDocument();
    expect(screen.getByText('Last active')).toBeInTheDocument();

    // …each paired with its (distinct) formatted value.
    expect(screen.getByText('12,345')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    // The band exposes an accessible region name and is not busy when loaded.
    const region = screen.getByRole('region', { name: /activity summary/i });
    expect(region).toHaveAttribute('aria-busy', 'false');
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
    render(
      <MyActivityKpiBand
        kpis={makeKpis({ total: 5, lastActivityTs: null })}
        isLoading={false}
      />,
    );

    expect(screen.getByText('Last active')).toBeInTheDocument();
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
    // Real counts still render alongside the empty last-active value.
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders an accessible loading state and hides the metrics', () => {
    const { container } = render(
      <MyActivityKpiBand kpis={makeKpis({ total: 99 })} isLoading />,
    );

    // aria-busy flips true and a polite live region announces the load.
    const region = screen.getByRole('region', { name: /activity summary/i });
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);

    // Exactly CARD_COUNT skeleton placeholders are shown.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);

    // Loading wins over the metric grid — no card labels or values leak through.
    expect(screen.queryByText('Total actions')).toBeNull();
    expect(screen.queryByText('99')).toBeNull();
  });

  it('is null-safe: a missing kpis payload renders zeros and an em-dash without throwing', () => {
    const missing = undefined as unknown as ActivityKpis;

    expect(() =>
      render(<MyActivityKpiBand kpis={missing} isLoading={false} />),
    ).not.toThrow();

    // The four numeric KPIs fall back to 0 and the timestamp KPI to an em-dash.
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.getByText(EM_DASH)).toBeInTheDocument();
  });
});
