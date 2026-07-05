/**
 * StatCard — behaviour, null-safety, trend semantics and a11y coverage.
 *
 * StatCard is a purely presentational KPI tile: it fetches nothing and exposes
 * no interactive controls, so there is no user-event surface to drive. What the
 * consumers (VehicleHeroCard, QuickStatsPage, …) actually depend on is the DOM
 * + a11y contract locked in below:
 *   - numeric 0 renders as "0", but null/undefined/NaN/'' degrade to an em-dash;
 *   - the unit only shows next to a real value (never a dangling "— mi");
 *   - the leading icon is decorative (aria-hidden) so it is never announced;
 *   - the trend chip encodes direction with an aria-hidden glyph PLUS an sr-only
 *     word (so meaning is not colour-only) and picks its colour from
 *     positive/flat/negative;
 *   - the loading state is an aria-busy status region, not the resolved content.
 *
 * i18n is mocked so `t(key, fallback)` resolves the developer fallback string,
 * matching the repo convention (see Delta.test.tsx).
 */
import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { StatCard } from './StatCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

/** A bare SVG stand-in for a lucide glyph — the icon is an opaque ReactNode. */
const icon = <svg data-testid="stat-icon" />;

/** The outer Card <div> rendered by the component. */
function card(container: HTMLElement): HTMLElement {
  return container.firstChild as HTMLElement;
}

describe('StatCard — core rendering', () => {
  it('renders the label, value and unit', () => {
    render(<StatCard label="Range" value={280} unit="mi" />);
    expect(screen.getByText('Range')).toBeInTheDocument();
    expect(screen.getByText('280')).toBeInTheDocument();
    expect(screen.getByText('mi')).toBeInTheDocument();
  });

  it('renders a string value verbatim', () => {
    render(<StatCard label="Status" value="Charging" />);
    expect(screen.getByText('Charging')).toBeInTheDocument();
  });

  it('merges a custom className onto the Card alongside the layout classes', () => {
    const { container } = render(
      <StatCard label="X" value={1} className="col-span-2" />,
    );
    expect(card(container)).toHaveClass('flex', 'flex-col', 'gap-1', 'col-span-2');
  });
});

describe('StatCard — value null-safety', () => {
  it('renders numeric zero rather than the em-dash fallback', () => {
    render(<StatCard label="Trips" value={0} />);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('degrades a null value to an em-dash', () => {
    render(<StatCard label="Range" value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('degrades an undefined value to an em-dash', () => {
    render(<StatCard label="Range" value={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('degrades a non-finite number (NaN / Infinity) to an em-dash', () => {
    const { rerender } = render(<StatCard label="Eff" value={NaN} />);
    expect(screen.getByText('—')).toBeInTheDocument();

    rerender(<StatCard label="Eff" value={Infinity} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('Infinity')).not.toBeInTheDocument();
  });

  it('degrades an empty-string value to an em-dash', () => {
    render(<StatCard label="Name" value="" />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('hides the unit when the value is missing (no dangling "— mi")', () => {
    render(<StatCard label="Range" value={null} unit="mi" />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('mi')).not.toBeInTheDocument();
  });
});

describe('StatCard — icon', () => {
  it('renders the icon and wraps it in an aria-hidden span so it is not announced', () => {
    const { container } = render(<StatCard label="Speed" value={65} icon={icon} />);
    const glyph = container.querySelector('[data-testid="stat-icon"]');
    expect(glyph).not.toBeNull();
    expect(glyph?.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('omits the icon wrapper entirely when no icon is supplied', () => {
    const { container } = render(<StatCard label="Speed" value={65} />);
    expect(container.querySelector('[data-testid="stat-icon"]')).toBeNull();
  });
});

describe('StatCard — trend', () => {
  it('renders an up arrow, positive colour and the sr-only "increased" word', () => {
    render(
      <StatCard
        label="Range"
        value={280}
        trend={{ direction: 'up', value: '+12%', positive: true }}
      />,
    );
    const row = screen.getByText('+12%').closest('div') as HTMLElement;
    expect(row).toHaveClass('text-green-600');
    // Direction is conveyed by a word too, not colour alone (WCAG 1.4.1).
    expect(within(row).getByText('increased')).toBeInTheDocument();
    const glyph = within(row).getByText('↑');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders a down arrow and negative colour when not marked positive', () => {
    render(
      <StatCard
        label="Cost"
        value="$42"
        trend={{ direction: 'down', value: '-8%' }}
      />,
    );
    const row = screen.getByText('-8%').closest('div') as HTMLElement;
    expect(row).toHaveClass('text-red-600');
    expect(within(row).getByText('decreased')).toBeInTheDocument();
    expect(within(row).getByText('↓')).toBeInTheDocument();
  });

  it('renders a muted flat trend with the "no change" word', () => {
    render(
      <StatCard label="Idle" value={3} trend={{ direction: 'flat', value: '0%' }} />,
    );
    const row = screen.getByText('0%').closest('div') as HTMLElement;
    expect(row).toHaveClass('text-[var(--text-muted)]');
    expect(row).not.toHaveClass('text-green-600');
    expect(row).not.toHaveClass('text-red-600');
    expect(within(row).getByText('no change')).toBeInTheDocument();
  });

  it('uses the positive colour even for a down direction when marked positive', () => {
    // e.g. energy *consumption* dropping is good — the caller opts in via positive.
    render(
      <StatCard
        label="Usage"
        value="12 kWh"
        trend={{ direction: 'down', value: '-5%', positive: true }}
      />,
    );
    const row = screen.getByText('-5%').closest('div') as HTMLElement;
    expect(row).toHaveClass('text-green-600');
    expect(row).not.toHaveClass('text-red-600');
  });

  it('omits the trend row when no trend is supplied', () => {
    render(<StatCard label="Range" value={280} />);
    expect(screen.queryByText('increased')).not.toBeInTheDocument();
    expect(screen.queryByText('no change')).not.toBeInTheDocument();
  });
});

describe('StatCard — sublabel', () => {
  it('renders the sublabel when provided', () => {
    render(<StatCard label="Range" value={280} sublabel="rated" />);
    expect(screen.getByText('rated')).toBeInTheDocument();
  });

  it('omits the sublabel node when not provided', () => {
    render(<StatCard label="Range" value={280} />);
    expect(screen.queryByText('rated')).not.toBeInTheDocument();
  });
});

describe('StatCard — loading state', () => {
  it('renders an aria-busy status region with skeletons instead of the value', () => {
    const { container } = render(<StatCard label="Range" value={280} loading />);
    const status = container.querySelector('[role="status"]') as HTMLElement;
    expect(status).not.toBeNull();
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute('aria-label', 'Loading');
    // Two pulsing skeleton bars, and none of the resolved content.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
    expect(screen.queryByText('280')).not.toBeInTheDocument();
    expect(screen.queryByText('Range')).not.toBeInTheDocument();
  });

  it('forwards the className to the loading Card', () => {
    const { container } = render(
      <StatCard label="Range" value={280} loading className="col-span-3" />,
    );
    expect(card(container)).toHaveClass('col-span-3');
  });
});
