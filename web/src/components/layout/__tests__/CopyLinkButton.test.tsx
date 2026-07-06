import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider } from '@/components/feedback/Toast';

// Mirror the repo's clipboard-button test convention (see
// components/ui/__tests__/CopyButton.test.tsx): stub i18n so `t(key, default)`
// returns the English default, letting us assert on the visible copy.
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

import { CopyLinkButton } from '../CopyLinkButton';

// Accessible name comes from the static aria-label; the visible text toggles.
const NAME = 'Copy link to this view';
const IDLE_TEXT = 'Copy link';
const COPIED_TEXT = 'Copied';
const SUCCESS_TOAST = 'Link copied to clipboard';
const ERROR_TOAST = 'Could not copy link';

const writeText = vi.fn(() => Promise.resolve());

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value });
}

beforeEach(() => {
  writeText.mockClear();
  setClipboard({ writeText });
  window.history.pushState({}, '', '/');
});

afterEach(() => {
  vi.restoreAllMocks();
  // Drop any per-test execCommand override so the next test starts clean.
  Reflect.deleteProperty(document, 'execCommand');
});

describe('CopyLinkButton', () => {
  it('copies the current URL (path + query) via the Clipboard API and confirms', async () => {
    window.history.pushState({}, '', '/drives?range=7d&vehicle_id=3');

    render(
      <ToastProvider>
        <CopyLinkButton />
      </ToastProvider>,
    );

    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveTextContent(IDLE_TEXT);

    fireEvent.click(button);

    const href = window.location.href;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(href));
    expect(href).toContain('/drives?range=7d&vehicle_id=3');
    expect(await screen.findByText(SUCCESS_TOAST)).toBeInTheDocument();
    expect(button).toHaveTextContent(COPIED_TEXT);
    expect(button).not.toHaveTextContent(IDLE_TEXT);
  });

  it('falls back to execCommand when the Clipboard API is unavailable and cleans up', async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });

    render(
      <ToastProvider>
        <CopyLinkButton />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: NAME }));

    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByText(SUCCESS_TOAST)).toBeInTheDocument();
    // The transient <textarea> must be removed from the DOM afterwards.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('shows an error toast and keeps the idle label when the clipboard write rejects', async () => {
    writeText.mockRejectedValueOnce(new Error('permission denied'));

    render(
      <ToastProvider>
        <CopyLinkButton />
      </ToastProvider>,
    );

    const button = screen.getByRole('button', { name: NAME });
    fireEvent.click(button);

    expect(await screen.findByText(ERROR_TOAST)).toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_TOAST)).not.toBeInTheDocument();
    expect(button).toHaveTextContent(IDLE_TEXT);
    expect(button).not.toHaveTextContent(COPIED_TEXT);
  });

  it('treats a falsy execCommand result as a failure (error toast, stays idle)', async () => {
    setClipboard(undefined);
    const exec = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });

    render(
      <ToastProvider>
        <CopyLinkButton />
      </ToastProvider>,
    );

    const button = screen.getByRole('button', { name: NAME });
    fireEvent.click(button);

    await waitFor(() => expect(exec).toHaveBeenCalledWith('copy'));
    expect(await screen.findByText(ERROR_TOAST)).toBeInTheDocument();
    expect(button).toHaveTextContent(IDLE_TEXT);
    // Failed fallback must not leave the temporary textarea behind.
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('renders a type="button" so it never submits a surrounding form', async () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());

    render(
      <form onSubmit={onSubmit}>
        <CopyLinkButton />
      </form>,
    );

    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveAttribute('type', 'button');

    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reverts to the idle label after the 2s success window elapses', async () => {
    vi.useFakeTimers();
    try {
      render(<CopyLinkButton />);
      const button = screen.getByRole('button', { name: NAME });

      await act(async () => {
        button.click();
        // Flush the awaited clipboard promise (microtasks aren't faked).
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(button).toHaveTextContent(COPIED_TEXT);

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(button).toHaveTextContent(IDLE_TEXT);
      expect(button).not.toHaveTextContent(COPIED_TEXT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('degrades gracefully (no crash) when rendered without a ToastProvider', async () => {
    render(<CopyLinkButton />);

    const button = screen.getByRole('button', { name: NAME });
    fireEvent.click(button);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // Copy still succeeds and the label flips even though no toast can render.
    expect(await screen.findByText(COPIED_TEXT)).toBeInTheDocument();
  });
});
