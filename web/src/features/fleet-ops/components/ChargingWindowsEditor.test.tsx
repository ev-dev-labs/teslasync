import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChargingWindowsEditor } from './ChargingWindowsEditor';
import type { EditableChargingWindow } from './chargingWindowUtils';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

const windows: EditableChargingWindow[] = [
  { key: 'overnight', day_of_week: 5, start_local_time: '22:00', end_local_time: '06:00' },
  { key: 'weekend', day_of_week: 6, start_local_time: '10:00', end_local_time: '14:00' },
];

describe('ChargingWindowsEditor', () => {
  it('names the group with a legend that is the first direct fieldset child', () => {
    render(<ChargingWindowsEditor value={windows} onChange={vi.fn()} />);

    const group = screen.getByRole('group', { name: 'Allowed charging windows' });
    expect(group.tagName).toBe('FIELDSET');
    expect(group.firstElementChild?.tagName).toBe('LEGEND');
    expect(group.firstElementChild).toHaveTextContent('Allowed charging windows');
    expect(within(group).getByRole('button', { name: 'Add window' })).toHaveAttribute('type', 'button');
  });

  it('preserves populated and overnight windows and updates each control independently', () => {
    const onChange = vi.fn();
    render(<ChargingWindowsEditor value={windows} onChange={onChange} />);

    const days = screen.getAllByLabelText('Day');
    const starts = screen.getAllByLabelText(/Start/);
    const ends = screen.getAllByLabelText(/End/);
    expect(days[0]).toHaveValue('5');
    expect(days[1]).toHaveValue('6');
    expect(starts[0]).toHaveValue('22:00');
    expect(ends[0]).toHaveValue('06:00');
    expect(starts[1]).toHaveValue('10:00');
    expect(ends[1]).toHaveValue('14:00');
    expect(starts[0]).toBeRequired();
    expect(ends[0]).toBeRequired();

    fireEvent.change(days[0], { target: { value: '0' } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...windows[0], day_of_week: 0 }, windows[1]]);
    fireEvent.change(starts[0], { target: { value: '23:00' } });
    expect(onChange).toHaveBeenLastCalledWith([{ ...windows[0], start_local_time: '23:00' }, windows[1]]);
    fireEvent.change(ends[1], { target: { value: '15:00' } });
    expect(onChange).toHaveBeenLastCalledWith([windows[0], { ...windows[1], end_local_time: '15:00' }]);
  });

  it('appends a default window without replacing populated windows and removes only the selected window', () => {
    const onChange = vi.fn();
    render(<ChargingWindowsEditor value={windows} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add window' }));
    expect(onChange).toHaveBeenLastCalledWith([
      ...windows,
      { key: expect.stringMatching(/^new-/), day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' },
    ]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove charging window' })[0]);
    expect(onChange).toHaveBeenLastCalledWith([windows[1]]);
  });

  it('keeps the empty guidance and add action in the named group', () => {
    const onChange = vi.fn();
    render(<ChargingWindowsEditor value={[]} onChange={onChange} />);

    const group = screen.getByRole('group', { name: 'Allowed charging windows' });
    expect(within(group).getByText('Add at least one local-time window. Overnight windows are supported.')).toBeInTheDocument();
    expect(within(group).queryByLabelText('Day')).not.toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'Add window' }));
    expect(onChange).toHaveBeenCalledWith([
      { key: expect.stringMatching(/^new-/), day_of_week: 1, start_local_time: '00:00', end_local_time: '06:00' },
    ]);
  });

  it('associates errors with the named fieldset and clears invalid state when resolved', () => {
    const onChange = vi.fn();
    const error = 'Charging windows overlap.';
    const { rerender } = render(<ChargingWindowsEditor value={windows} onChange={onChange} error={error} />);

    const group = screen.getByRole('group', { name: 'Allowed charging windows' });
    expect(group).toHaveAttribute('aria-invalid', 'true');
    expect(group).toHaveAttribute('aria-describedby', screen.getByText(error).id);
    expect(group).toHaveAccessibleDescription(error);
    expect(within(group).getAllByLabelText('Day')).toHaveLength(2);

    rerender(<ChargingWindowsEditor value={windows} onChange={onChange} />);
    expect(group).not.toHaveAttribute('aria-invalid');
    expect(group).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText(error)).not.toBeInTheDocument();
  });
});
