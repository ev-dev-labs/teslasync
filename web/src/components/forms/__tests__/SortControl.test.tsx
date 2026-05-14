import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortControl } from '../SortControl';

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

const OPTIONS = [
  { value: 'date',     label: 'Date' },
  { value: 'distance', label: 'Distance' },
  { value: 'score',    label: 'Score' },
];

describe('SortControl', () => {
  it('renders the field selector with the current value', () => {
    render(
      <SortControl
        field="distance"
        direction="desc"
        options={OPTIONS}
        onFieldChange={vi.fn()}
        onDirectionChange={vi.fn()}
        testId="sc"
      />,
    );
    expect((screen.getByTestId('sc-field') as HTMLSelectElement).value).toBe('distance');
  });

  it('renders a downward arrow icon for desc direction', () => {
    render(
      <SortControl
        field="date"
        direction="desc"
        options={OPTIONS}
        onFieldChange={vi.fn()}
        onDirectionChange={vi.fn()}
        testId="sc"
      />,
    );
    expect(screen.getByTestId('sc-direction').querySelector('.lucide-arrow-down')).not.toBeNull();
    expect(screen.getByTestId('sc-direction').querySelector('.lucide-arrow-up')).toBeNull();
  });

  it('renders an upward arrow icon for asc direction', () => {
    render(
      <SortControl
        field="date"
        direction="asc"
        options={OPTIONS}
        onFieldChange={vi.fn()}
        onDirectionChange={vi.fn()}
        testId="sc"
      />,
    );
    expect(screen.getByTestId('sc-direction').querySelector('.lucide-arrow-up')).not.toBeNull();
    expect(screen.getByTestId('sc-direction').querySelector('.lucide-arrow-down')).toBeNull();
  });

  it('calls onFieldChange when the user picks a new field', () => {
    const onFieldChange = vi.fn();
    render(
      <SortControl
        field="date"
        direction="desc"
        options={OPTIONS}
        onFieldChange={onFieldChange}
        onDirectionChange={vi.fn()}
        testId="sc"
      />,
    );
    fireEvent.change(screen.getByTestId('sc-field'), { target: { value: 'score' } });
    expect(onFieldChange).toHaveBeenCalledWith('score');
  });

  it('toggles direction when the arrow button is clicked', () => {
    const onDirectionChange = vi.fn();
    const { rerender } = render(
      <SortControl
        field="date"
        direction="desc"
        options={OPTIONS}
        onFieldChange={vi.fn()}
        onDirectionChange={onDirectionChange}
        testId="sc"
      />,
    );
    fireEvent.click(screen.getByTestId('sc-direction'));
    expect(onDirectionChange).toHaveBeenLastCalledWith('asc');

    rerender(
      <SortControl
        field="date"
        direction="asc"
        options={OPTIONS}
        onFieldChange={vi.fn()}
        onDirectionChange={onDirectionChange}
        testId="sc"
      />,
    );
    fireEvent.click(screen.getByTestId('sc-direction'));
    expect(onDirectionChange).toHaveBeenLastCalledWith('desc');
  });

  it('exposes a descriptive aria-label on the direction button', () => {
    render(
      <SortControl
        field="date"
        direction="desc"
        options={OPTIONS}
        onFieldChange={vi.fn()}
        onDirectionChange={vi.fn()}
        testId="sc"
      />,
    );
    expect(screen.getByTestId('sc-direction')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/descending/i),
    );
  });
});
