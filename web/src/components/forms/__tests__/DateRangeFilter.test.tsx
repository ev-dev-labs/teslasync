import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { DateRangeFilter } from '../DateRangeFilter';

describe('DateRangeFilter <onRangeChange> path', () => {
  it('preset chip click calls onRangeChange (not onStartDateChange/onEndDateChange) when prop present', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const onRange = vi.fn();
    const { getByText } = render(
      <DateRangeFilter
        startDate="2025-01-01"
        endDate="2025-01-31"
        onStartDateChange={onStart}
        onEndDateChange={onEnd}
        onRangeChange={onRange}
      />,
    );
    fireEvent.click(getByText(/last 7 days/i));
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange.mock.calls[0][0]).toEqual({
      start: expect.any(String),
      end: expect.any(String),
    });
    // Both start/end strings should be ISO date format.
    const arg = onRange.mock.calls[0][0] as { start: string; end: string };
    expect(arg.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(arg.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('falls back to onStart/onEndDateChange when onRangeChange is omitted (back-compat)', () => {
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { getByText } = render(
      <DateRangeFilter
        startDate="2025-01-01"
        endDate="2025-01-31"
        onStartDateChange={onStart}
        onEndDateChange={onEnd}
      />,
    );
    fireEvent.click(getByText(/last 7 days/i));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('still fires onApply alongside onRangeChange', () => {
    const onApply = vi.fn();
    const onRange = vi.fn();
    const { getByText } = render(
      <DateRangeFilter
        startDate="2025-01-01"
        endDate="2025-01-31"
        onStartDateChange={vi.fn()}
        onEndDateChange={vi.fn()}
        onRangeChange={onRange}
        onApply={onApply}
      />,
    );
    fireEvent.click(getByText(/last 30 days/i));
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
