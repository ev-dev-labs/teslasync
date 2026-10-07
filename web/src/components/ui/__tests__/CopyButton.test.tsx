import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToastProvider } from '@/components/feedback/Toast';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      if (typeof opts === 'string') return opts || key;
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
        return (opts.defaultValue as string) ?? key;
      }
      return key;
    },
  }),
}));

import { CopyButton } from '../CopyButton';

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

describe('CopyButton', () => {
  it('writes the text to the clipboard on click and toggles to "Copied"', async () => {
    render(<CopyButton text="hello-world" />);

    const trigger = screen.getByRole('button', { name: 'Copy' });
    expect(trigger).toBeInTheDocument();

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('hello-world');
    });
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('renders no visible text in iconOnly mode but exposes an aria-label', () => {
    render(<CopyButton text="x" iconOnly ariaLabel="Copy API key" />);
    const trigger = screen.getByRole('button', { name: 'Copy API key' });
    expect(trigger).toBeInTheDocument();
    expect(trigger).not.toHaveTextContent('Copy');
  });

  it('respects a custom label override', () => {
    render(<CopyButton text="x" label="Copy link" />);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('does not crash when rendered outside ToastProvider with withToast=true', async () => {
    // No ToastProvider wrapping — useOptionalToast returns null.
    render(<CopyButton text="x" withToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('x');
    });
  });

  it('fires the toast helper on success when wrapped in ToastProvider', async () => {
    render(
      <ToastProvider>
        <CopyButton text="hi" withToast />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByText('Copied to clipboard')).toBeInTheDocument();
  });

  it('respects the disabled prop', () => {
    render(<CopyButton text="x" disabled />);
    const trigger = screen.getByRole('button', { name: 'Copy' });
    expect(trigger).toBeDisabled();
    fireEvent.click(trigger);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('invokes the onCopy callback on success', async () => {
    const onCopy = vi.fn();
    render(<CopyButton text="x" onCopy={onCopy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(onCopy).toHaveBeenCalledTimes(1);
    });
  });
});

