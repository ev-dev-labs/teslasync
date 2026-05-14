import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ScoreBadge } from '../ScoreBadge';

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

describe('ScoreBadge', () => {
  it.each([
    [95, 'A+'],
    [85, 'A'],
    [70, 'B'],
    [55, 'C'],
    [40, 'D'],
    [10, 'F'],
  ])('renders %d as letter %s on default scale', (score, label) => {
    render(<ScoreBadge score={score} testId="sb" />);
    expect(screen.getByTestId('sb')).toHaveTextContent(label);
  });

  it('renders pre-computed grade directly', () => {
    render(<ScoreBadge grade="B" testId="sb" />);
    expect(screen.getByTestId('sb')).toHaveTextContent('B');
  });

  it.each([null, undefined, NaN])('renders dash for invalid score (%p)', (score) => {
    render(<ScoreBadge score={score as number | null} testId="sb" />);
    expect(screen.getByTestId('sb')).toHaveTextContent('—');
  });

  it('applies the matching grade colour via inline style', () => {
    render(<ScoreBadge grade="A" testId="sb" />);
    expect(screen.getByTestId('sb')).toHaveStyle({ color: '#10b981' });
  });

  it.each([
    ['sm', 'text-xs'],
    ['md', 'text-xl'],
    ['lg', 'text-3xl'],
  ] as const)('applies %s size class', (size, expectedClass) => {
    render(<ScoreBadge grade="A" size={size} testId="sb" />);
    expect(screen.getByTestId('sb').className).toMatch(expectedClass);
  });

  it('uses caller-supplied thresholds (Wh/km — lower better)', () => {
    const whThresholds = [
      { min: 220, label: 'D' as const },
      { min: 190, label: 'C' as const },
      { min: 160, label: 'B' as const },
      { min: 130, label: 'A' as const },
      { min: 0,   label: 'A+' as const },
    ];
    render(<ScoreBadge score={120} thresholds={whThresholds} testId="sb" />);
    expect(screen.getByTestId('sb')).toHaveTextContent('A+');
  });

  it('exposes an accessible label with the grade', () => {
    render(<ScoreBadge grade="B" testId="sb" />);
    expect(screen.getByLabelText(/score b/i)).toBeInTheDocument();
  });

  it('respects ariaLabel override', () => {
    render(<ScoreBadge grade="A" ariaLabel="Custom label" testId="sb" />);
    expect(screen.getByLabelText('Custom label')).toBeInTheDocument();
  });
});
