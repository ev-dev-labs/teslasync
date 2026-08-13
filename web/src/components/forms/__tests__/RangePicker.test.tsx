import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@/i18n';
import { RangePicker } from '../RangePicker';

const baseProps = {
  value: { start: '2025-01-01', end: '2025-01-07' },
};

describe('<RangePicker /> trigger', () => {
  it('renders a button trigger with active label and resolved date readout', () => {
    render(<RangePicker {...baseProps} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /date range/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveTextContent('Custom range');
    // The readout always renders the resolved dates.
    expect(trigger).toHaveTextContent(/jan/i);
  });

  it('toggles the popover open/closed on click', () => {
    render(<RangePicker {...baseProps} onChange={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: /date range/i });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('<RangePicker /> preset behavior — auto-apply, no Apply needed', () => {
  it('clicking a preset calls onChange immediately and closes the popover', () => {
    const onChange = vi.fn();
    render(<RangePicker {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('option', { name: /last 30 days/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [range, presetId] = onChange.mock.calls[0];
    expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(range.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(presetId).toBe('30d');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('clicking a preset never invokes Apply or Cancel handlers', () => {
    const onChange = vi.fn();
    render(<RangePicker {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('option', { name: /today/i }));
    // Only one onChange — preset path bypasses Apply.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('honors minDate when "All time" preset is clicked', () => {
    const onChange = vi.fn();
    render(<RangePicker {...baseProps} onChange={onChange} minDate="2024-06-01" />);
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('option', { name: /all time/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ start: '2024-06-01' }),
      'all',
    );
  });

  it('marks the active preset with aria-selected', () => {
    // 30-day window — match the 30d preset deterministically.
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 29);
    const iso = (d: Date) => {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    };
    render(
      <RangePicker
        value={{ start: iso(start), end: iso(today) }}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    const active = screen.getByRole('option', { name: /last 30 days/i });
    expect(active).toHaveAttribute('aria-selected', 'true');
  });
});

describe('<RangePicker /> Apply button', () => {
  it('Apply is disabled when staged range matches the current value', () => {
    render(<RangePicker {...baseProps} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    const dialog = screen.getByRole('dialog');
    const apply = within(dialog).getByRole('button', { name: /^apply$/i });
    expect(apply).toBeDisabled();
  });

  it('Cancel closes the popover without calling onChange', () => {
    const onChange = vi.fn();
    render(<RangePicker {...baseProps} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^cancel$/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('<RangePicker /> compare toggle', () => {
  it('compare toggle is hidden by default', () => {
    render(<RangePicker {...baseProps} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    expect(
      screen.queryByLabelText(/compare to previous period/i),
    ).not.toBeInTheDocument();
  });

  it('compare toggle is shown when enableCompare is true and fires onCompareChange', () => {
    const onCompareChange = vi.fn();
    render(
      <RangePicker
        {...baseProps}
        onChange={vi.fn()}
        enableCompare
        compare={false}
        onCompareChange={onCompareChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    const checkbox = screen.getByLabelText(/compare to previous period/i);
    fireEvent.click(checkbox);
    expect(onCompareChange).toHaveBeenCalledWith(true);
  });
});

describe('<RangePicker /> Esc closes popover', () => {
  it('pressing Escape closes the popover', () => {
    render(<RangePicker {...baseProps} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /date range/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
