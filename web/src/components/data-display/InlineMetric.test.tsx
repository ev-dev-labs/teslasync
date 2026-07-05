import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { InlineMetric } from './InlineMetric';

/**
 * InlineMetric is a purely presentational atom: an [icon][value][label] row of
 * sibling spans used inside cards. It fetches nothing, so there are no
 * loading/error states to exercise — instead we lock in the DOM contract that
 * consumers (DriveCard, ThermalLoadPanel, LiveMotorStatus, InfrastructureSection)
 * depend on: the value is the label span's previous sibling, the icon is
 * decorative (aria-hidden), and a missing value degrades to an em-dash.
 */

/** A bare SVG stand-in for a lucide glyph — the icon is an opaque ReactNode. */
const icon = <svg data-testid="metric-icon" />;

/** The outer wrapper span rendered by the component. */
function wrapper(container: HTMLElement): HTMLElement {
  return container.firstChild as HTMLElement;
}

describe('InlineMetric — value rendering', () => {
  it('renders a string value verbatim', () => {
    render(<InlineMetric icon={icon} value="12h 30m" />);
    expect(screen.getByText('12h 30m')).toBeInTheDocument();
  });

  it('renders a numeric value coerced to text', () => {
    render(<InlineMetric icon={icon} value={42} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders numeric zero rather than the em-dash fallback', () => {
    const { container } = render(<InlineMetric icon={icon} value={0} />);
    // The value span is the icon wrapper's next sibling.
    const valueSpan = wrapper(container).children[1];
    expect(valueSpan.textContent).toBe('0');
    expect(container.textContent).not.toContain('—');
  });
});

describe('InlineMetric — missing-value null safety', () => {
  it('degrades a null value to an em-dash instead of a blank span', () => {
    const { container } = render(<InlineMetric icon={icon} value={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(wrapper(container).children[1].textContent).toBe('—');
  });

  it('degrades an undefined value to an em-dash', () => {
    render(<InlineMetric icon={icon} value={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

describe('InlineMetric — label', () => {
  it('renders the label as its own span after the value', () => {
    render(<InlineMetric icon={icon} value="90" label="km/h" />);
    const label = screen.getByText('km/h');
    // Consumer tests read the value as the label span's previous sibling —
    // pin that contract so a refactor cannot silently break their reads.
    expect(label.previousElementSibling?.textContent).toBe('90');
  });

  it('omits the label span entirely when no label is supplied', () => {
    const { container } = render(<InlineMetric icon={icon} value="90" />);
    // icon wrapper + value only.
    expect(wrapper(container).children).toHaveLength(2);
  });

  it('omits the label span for an empty-string label (no stray node)', () => {
    const { container } = render(<InlineMetric icon={icon} value="90" label="" />);
    expect(wrapper(container).children).toHaveLength(2);
  });
});

describe('InlineMetric — sibling structure contract', () => {
  it('renders [icon][value][label] as direct sibling spans in order', () => {
    const { container } = render(<InlineMetric icon={icon} value="90" label="km/h" />);
    const [iconSpan, valueSpan, labelSpan] = Array.from(
      wrapper(container).children,
    ) as HTMLElement[];

    expect(iconSpan.querySelector('[data-testid="metric-icon"]')).not.toBeNull();
    expect(valueSpan.textContent).toBe('90');
    expect(labelSpan.textContent).toBe('km/h');
  });
});

describe('InlineMetric — accessibility', () => {
  it('wraps the decorative icon in an aria-hidden span so it is not announced', () => {
    const { container } = render(<InlineMetric icon={icon} value="90" />);
    const iconSpan = container.querySelector('[data-testid="metric-icon"]')?.parentElement;
    expect(iconSpan).not.toBeNull();
    expect(iconSpan).toHaveAttribute('aria-hidden', 'true');
  });

  it('exposes only the value (and label) as accessible text, not the glyph', () => {
    render(<InlineMetric icon={icon} value="90" label="km/h" />);
    // The svg carries no accessible name, and its wrapper is aria-hidden, so
    // the only readable content is the value + label.
    expect(screen.getByText('90')).toBeInTheDocument();
    expect(screen.getByText('km/h')).toBeInTheDocument();
  });
});

describe('InlineMetric — styling', () => {
  it('keeps the theme-var muted colour and base layout classes by default', () => {
    const { container } = render(<InlineMetric icon={icon} value="90" />);
    expect(wrapper(container)).toHaveClass(
      'inline-flex',
      'items-center',
      'gap-1',
      'text-xs',
      'text-[var(--text-muted)]',
    );
  });

  it('merges a custom className onto the wrapper alongside the base classes', () => {
    const { container } = render(
      <InlineMetric icon={icon} value="90" className="text-emerald-300" />,
    );
    expect(wrapper(container)).toHaveClass('inline-flex', 'text-xs', 'text-emerald-300');
  });

  it('applies the compact svg-sizing utility to the icon wrapper', () => {
    const { container } = render(<InlineMetric icon={icon} value="90" />);
    const iconSpan = container.querySelector('[data-testid="metric-icon"]')?.parentElement;
    expect(iconSpan?.className).toContain('shrink-0');
    expect(iconSpan?.className).toContain('[&>svg]:h-3');
  });
});
