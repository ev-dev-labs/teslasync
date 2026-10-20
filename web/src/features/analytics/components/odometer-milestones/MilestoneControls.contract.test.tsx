import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MilestoneControls } from './MilestoneControls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | { defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback.defaultValue ?? '',
  }),
}));

const name = 'Odometer immediately before the chronologically first eligible returned drive';

describe('MilestoneControls real Input contract', () => {
  it('commits valid blur and focused Enter drafts, never unchanged precision', () => {
    const commit = vi.fn(() => true);
    render(<MilestoneControls baseDisplay={123.456789012345} distanceUnit="km" onBaseChange={commit} />);
    const input = screen.getByRole('spinbutton', { name });
    fireEvent.focus(input);
    fireEvent.blur(input);
    expect(commit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '234.56789' } });
    fireEvent.blur(input);
    expect(commit).toHaveBeenLastCalledWith('234.56789');
    input.focus();
    fireEvent.change(input, { target: { value: '345.6789' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(commit).toHaveBeenLastCalledWith('345.6789');
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('retains a rejected draft with stable associated error and cancels Escape without committing', () => {
    const commit = vi.fn(() => false);
    const cancel = vi.fn();
    render(<MilestoneControls baseDisplay={12.3456} distanceUnit="km" onBaseChange={commit} onCancel={cancel} />);
    const input = screen.getByRole('spinbutton', { name });
    const id = input.id;
    fireEvent.change(input, { target: { value: '1000000000' } });
    fireEvent.blur(input);
    expect(input).toHaveValue(1000000000);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent('Enter a valid number');
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue(12.3456);
    expect(input.id).toBe(id);
    expect(cancel).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('synchronizes external commits and scope/unit changes without remounting field identity', () => {
    const commit = vi.fn(() => false);
    const view = render(<MilestoneControls baseDisplay={12.3456} distanceUnit="km" calibrationKey="synthetic-a" onBaseChange={commit} />);
    const input = screen.getByRole('spinbutton', { name });
    const id = input.id;
    fireEvent.change(input, { target: { value: '999999999' } });
    fireEvent.blur(input);
    view.rerender(<MilestoneControls baseDisplay={123.4567} distanceUnit="km" calibrationKey="synthetic-a" onBaseChange={commit} />);
    expect(input).toHaveValue(123.4567);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.rerender(<MilestoneControls baseDisplay={0} distanceUnit="mi" calibrationKey="synthetic-b" onBaseChange={commit} />);
    expect(input).toHaveValue(0);
    expect(input.id).toBe(id);
    expect(screen.getByText('mi')).toBeInTheDocument();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('keeps persisted errors associated and unknown calibration blank rather than successful zero', () => {
    render(<MilestoneControls baseDisplay={null} distanceUnit="km" error="Synthetic saved calibration error" onBaseChange={() => false} />);
    const input = screen.getByRole('spinbutton', { name });
    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toHaveTextContent('Synthetic saved calibration error');
  });
});
