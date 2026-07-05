import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';

import {
  OnboardingStatusCard,
  type OnboardingStatusCardProps,
} from './OnboardingStatusCard';

const baseProps: OnboardingStatusCardProps = {
  icon: <span data-testid="domain-icon" />,
  color: 'cyan',
  label: 'TESLA ACCOUNT',
  value: 'Connected',
  done: true,
  hint: 'Fleet API access authorized',
};

function renderCard(overrides: Partial<OnboardingStatusCardProps> = {}) {
  return render(<OnboardingStatusCard {...baseProps} {...overrides} />);
}

describe('OnboardingStatusCard — loaded content', () => {
  it('renders the label, value and hint text', () => {
    renderCard();
    expect(screen.getByText('TESLA ACCOUNT')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
    expect(screen.getByText('Fleet API access authorized')).toBeInTheDocument();
  });

  it('renders the caller-provided domain icon inside the coloured IconBox', () => {
    renderCard({ color: 'purple' });
    const icon = screen.getByTestId('domain-icon');
    expect(icon).toBeInTheDocument();

    // The domain icon is nested directly inside the IconBox container, which
    // carries the neon accent for the requested colour.
    const iconBox = icon.parentElement as HTMLElement;
    expect(iconBox.className).toContain('bg-neon-purple/10');
    expect(iconBox.className).toContain('ring-neon-purple/20');
  });

  it('is not marked busy and exposes no loading status region when loaded', () => {
    const { container } = renderCard();
    expect(screen.queryByRole('status')).toBeNull();
    expect((container.firstChild as HTMLElement).getAttribute('aria-busy')).toBe('false');
  });
});

describe('OnboardingStatusCard — status indicator (never colour-alone)', () => {
  it('shows a check icon for a satisfied anchor', () => {
    const { container } = renderCard({ done: true });
    const check = container.querySelector('.lucide-check');
    expect(check).not.toBeNull();
    expect(container.querySelector('.lucide-clock')).toBeNull();
    // Done state uses the toned-down emerald accent, not raw neon.
    expect(check?.getAttribute('class')).toContain('text-emerald-300');
    // The status glyph is decorative — the value word carries the meaning.
    expect(check?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows a clock icon for a pending anchor', () => {
    const { container } = renderCard({ done: false, value: 'Not connected' });
    const clock = container.querySelector('.lucide-clock');
    expect(clock).not.toBeNull();
    expect(container.querySelector('.lucide-check')).toBeNull();
    expect(clock?.getAttribute('class')).toContain('text-amber-300');
    expect(screen.getByText('Not connected')).toBeInTheDocument();
  });
});

describe('OnboardingStatusCard — loading state', () => {
  it('announces a labelled loading status instead of a blank panel', () => {
    const { container } = renderCard({ loading: true });
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(/loading status/i);
    expect((container.firstChild as HTMLElement).getAttribute('aria-busy')).toBe('true');
  });

  it('renders skeleton placeholders and hides the resolved content', () => {
    const { container } = renderCard({ loading: true });
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
    expect(screen.queryByText('TESLA ACCOUNT')).toBeNull();
    expect(screen.queryByText('Connected')).toBeNull();
    expect(container.querySelector('.lucide-check')).toBeNull();
  });
});

describe('OnboardingStatusCard — props & defaults', () => {
  it('defaults to the loaded (non-loading) view when loading is omitted', () => {
    renderCard();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('forwards a custom className onto the panel root', () => {
    const { container } = renderCard({ className: 'custom-test-class' });
    const panel = container.querySelector('.custom-test-class');
    expect(panel).not.toBeNull();
    // The custom class lands on the same element as the base padding.
    expect(panel?.className).toContain('p-4');
  });
});
