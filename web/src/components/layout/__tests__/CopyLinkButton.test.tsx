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
  it('uses neutral shared chrome, wrapping labels and decorative shrink-free icons', () => {
    render(<CopyLinkButton />);
    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveClass('bg-transparent', 'min-h-11', 'md:min-h-9', 'min-w-0', 'max-w-full', 'whitespace-normal');
    expect(screen.getByText(IDLE_TEXT)).toHaveClass('min-w-0', 'break-words');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(button.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(button.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5', 'shrink-0');
    button.focus();
    expect(button).toHaveFocus();
  });

  it('keeps icon-only targets below md and allows caller class overrides', () => {
    const { rerender } = render(<CopyLinkButton iconOnly />);
    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveClass('h-11', 'w-11', 'md:h-9', 'md:w-9', 'p-0');
    expect(button).not.toHaveClass('whitespace-normal');
    rerender(<CopyLinkButton iconOnly className="h-12 w-12" />);
    expect(button).toHaveClass('h-12', 'w-12');
    expect(button).not.toHaveClass('h-11', 'w-11');
  });

  it('reads the full current workspace URL at each click without changing it', async () => {
    window.history.pushState({}, '', '/drives?from=2026-10-01&to=2026-10-08&vehicle_id=3#details');
    render(<CopyLinkButton />);
    const button = screen.getByRole('button', { name: NAME });
    const firstHref = window.location.href;
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(firstHref));
    expect(window.location.href).toBe(firstHref);

    window.history.pushState({}, '', '/charging?range=24h&vehicle_id=5#session');
    const secondHref = window.location.href;
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(secondHref));
    expect(window.location.href).toBe(secondHref);
  });

  it('keeps copy behavior and accessible feedback in icon-only mode', async () => {
    render(<CopyLinkButton iconOnly />);
    const button = screen.getByRole('button', { name: NAME });
    expect(button).toHaveAttribute('aria-describedby');
    expect(button).not.toHaveTextContent(IDLE_TEXT);
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(screen.getByRole('button', { name: COPIED_TEXT })).toBeInTheDocument();
  });

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

  it('cleans up a throwing fallback and reports failure without false success', async () => {
    setClipboard(undefined);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => { throw new Error('copy unavailable'); }),
    });
    render(<ToastProvider><CopyLinkButton /></ToastProvider>);
    const button = screen.getByRole('button', { name: NAME });
    fireEvent.click(button);
    expect(await screen.findByText(ERROR_TOAST)).toBeInTheDocument();
    expect(screen.queryByText(SUCCESS_TOAST)).not.toBeInTheDocument();
    expect(button).toHaveTextContent(IDLE_TEXT);
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('cancels the pending success reset when unmounted', async () => {
    vi.useFakeTimers();
    try {
      const clearTimeout = vi.spyOn(window, 'clearTimeout');
      const { unmount } = render(<CopyLinkButton />);
      await act(async () => {
        screen.getByRole('button', { name: NAME }).click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByRole('button', { name: NAME })).toHaveTextContent(COPIED_TEXT);
      expect(vi.getTimerCount()).toBe(1);
      unmount();
      expect(clearTimeout).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      clearTimeout.mockRestore();
    } finally {
      vi.useRealTimers();
    }
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
