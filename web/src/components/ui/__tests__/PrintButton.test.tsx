import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: string) => defaultValue ?? key,
  }),
}));

import { PrintButton } from '../PrintButton';

const print = vi.fn();
let rafCallbacks: FrameRequestCallback[] = [];
const flushRaf = () =>
  act(() => {
    const cbs = rafCallbacks;
    rafCallbacks = [];
    for (const cb of cbs) cb(performance.now());
  });

beforeEach(() => {
  print.mockClear();
  rafCallbacks = [];
  Object.defineProperty(window, 'print', {
    configurable: true,
    value: print,
  });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    rafCallbacks.push(cb);
    return rafCallbacks.length;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PrintButton', () => {
  it('renders a Print button with a visible label', () => {
    render(<PrintButton />);
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
  });

  it('opens the print dialog on click', async () => {
    render(<PrintButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => {
      expect(rafCallbacks.length).toBeGreaterThan(0);
    });
    flushRaf();
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('runs beforePrint before opening the print dialog', async () => {
    const order: string[] = [];
    const beforePrint = vi.fn(async () => {
      order.push('before');
    });
    print.mockImplementation(() => {
      order.push('print');
    });
    render(<PrintButton beforePrint={beforePrint} />);
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => {
      expect(beforePrint).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(rafCallbacks.length).toBeGreaterThan(0);
    });
    flushRaf();
    expect(print).toHaveBeenCalled();
    expect(order).toEqual(['before', 'print']);
  });

  it('hides the visible label and exposes an aria-label in iconOnly mode', () => {
    render(<PrintButton iconOnly />);
    const trigger = screen.getByRole('button', { name: 'Print' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).not.toHaveTextContent('Print');
  });

  it('respects a custom label override', () => {
    render(<PrintButton label="Print snapshot" />);
    expect(screen.getByRole('button', { name: 'Print snapshot' })).toBeInTheDocument();
  });

  it('carries data-print-hide so the trigger is hidden in printouts', () => {
    render(<PrintButton />);
    const trigger = screen.getByRole('button', { name: 'Print' });
    expect(trigger).toHaveAttribute('data-print-hide');
  });

  it('respects the disabled prop', () => {
    render(<PrintButton disabled />);
    const trigger = screen.getByRole('button', { name: 'Print' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    flushRaf();
    expect(print).not.toHaveBeenCalled();
  });
});
