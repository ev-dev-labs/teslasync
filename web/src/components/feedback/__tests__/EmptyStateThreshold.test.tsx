import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyStateThreshold } from '../EmptyStateThreshold';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      const tpl = fallback ?? '';
      if (!opts) return tpl;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      );
    },
  }),
}));

describe('EmptyStateThreshold', () => {
  it('renders the section title', () => {
    render(
      <EmptyStateThreshold
        sectionLabel="Cost Heatmap"
        currentCount={5}
        threshold={30}
        testId="est"
      />,
    );
    expect(screen.getByTestId('est')).toHaveTextContent('Cost Heatmap');
  });

  it('renders the auto-generated count message with item noun', () => {
    render(
      <EmptyStateThreshold
        sectionLabel="Cost Heatmap"
        currentCount={5}
        threshold={30}
        itemNoun="sessions"
        testId="est"
      />,
    );
    expect(screen.getByTestId('est')).toHaveTextContent(/at least 30 sessions/i);
    expect(screen.getByTestId('est')).toHaveTextContent(/5 so far/i);
  });

  it('falls back to "items" when no noun is provided', () => {
    render(
      <EmptyStateThreshold
        sectionLabel="Section"
        currentCount={1}
        threshold={10}
        testId="est"
      />,
    );
    expect(screen.getByTestId('est')).toHaveTextContent(/at least 10 items/i);
  });

  it('renders a custom message when provided', () => {
    render(
      <EmptyStateThreshold
        sectionLabel="Section"
        currentCount={1}
        threshold={10}
        message="Custom prompt here"
        testId="est"
      />,
    );
    expect(screen.getByTestId('est')).toHaveTextContent('Custom prompt here');
    // The default message should NOT appear
    expect(screen.getByTestId('est')).not.toHaveTextContent(/at least 10/);
  });

  it('renders the description below the title', () => {
    render(
      <EmptyStateThreshold
        sectionLabel="Section"
        currentCount={1}
        threshold={10}
        description="A subtitle that explains the section"
        testId="est"
      />,
    );
    expect(screen.getByTestId('est')).toHaveTextContent('A subtitle that explains the section');
  });

  it('renders the action slot', () => {
    render(
      <EmptyStateThreshold
        sectionLabel="Section"
        currentCount={1}
        threshold={10}
        action={<button type="button">Adjust filters</button>}
        testId="est"
      />,
    );
    expect(screen.getByRole('button', { name: /adjust filters/i })).toBeInTheDocument();
  });

  it('exposes role=status for screen readers (live region)', () => {
    render(
      <EmptyStateThreshold
        sectionLabel="Section"
        currentCount={1}
        threshold={10}
        testId="est"
      />,
    );
    expect(screen.getByTestId('est')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('est')).toHaveAttribute('aria-live', 'polite');
  });
});
