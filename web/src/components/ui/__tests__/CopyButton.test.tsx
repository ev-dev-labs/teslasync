import { render, screen, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastProvider } from '@/components/feedback/Toast';

const handlerRejection = vi.hoisted(() => vi.fn());

// Keep the real Button, but observe rejected async event handlers so callback
// exceptions can be asserted without becoming unhandled test-runner errors.
vi.mock('../Button', async (importOriginal) => {
  const module = await importOriginal<typeof import('../Button')>();
  return {
    ...module,
    Button: (props: import('../Button').ButtonProps) => (
      <module.Button
        {...props}
        onClick={(event) => {
          const result: unknown = props.onClick?.(event);
          if (result instanceof Promise) void result.catch(handlerRejection);
        }}
      />
    ),
  };
});

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
  writeText.mockReset().mockResolvedValue(undefined);
  handlerRejection.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CopyButton', () => {
  it.each(['', '  exact\r\npayload\t🙂 العربية  '])('preserves the exact clipboard payload %j', async (text) => {
    render(<CopyButton text={text} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it('keeps long RTL labels wrapping and native focus without submitting the containing form', async () => {
    const label = 'نسخ الرابط الكامل '.repeat(12);
    const submit = vi.fn();
    render(
      <form dir="rtl" onSubmit={submit}>
        <CopyButton text="exact link" label={label} className="custom-copy" />
      </form>,
    );
    const trigger = screen.getByRole('button', { name: label.trim() });
    expect(trigger).toHaveClass('custom-copy', 'min-w-0', 'max-w-full', 'whitespace-normal');
    expect(trigger).toHaveAttribute('type', 'button');
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
    expect(submit).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    expect(trigger.querySelector('svg')).toHaveClass('h-3.5', 'w-3.5', 'shrink-0');
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger.querySelector('svg')).toHaveAttribute('focusable', 'false');
  });

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

  it('announces success with a custom label without changing its accessible name', async () => {
    render(<CopyButton text="link" label="Copy link" variant="outline" size="md" title="Share link" />);
    const trigger = screen.getByRole('button', { name: 'Copy link' });
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('title', 'Share link');
    expect(trigger).not.toHaveAttribute('aria-live');
    expect(trigger).toHaveClass('bg-transparent', 'min-h-10');

    fireEvent.click(trigger);

    await waitFor(() => expect(status).toHaveTextContent('Copied'));
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveAttribute('aria-atomic', 'true');
    expect(screen.getByRole('button', { name: 'Copy link' })).toBe(trigger);
    expect(writeText).toHaveBeenCalledExactlyOnceWith('link');
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(trigger.querySelector('svg')).toHaveAttribute('focusable', 'false');
  });

  it('announces icon-only success with an explicit name and clears it after the reset timer', async () => {
    vi.useFakeTimers();
    render(<CopyButton text="key" iconOnly ariaLabel="Copy API key" />);
    const trigger = screen.getByRole('button', { name: 'Copy API key' });
    const status = screen.getByRole('status');
    expect(trigger.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    await act(async () => { fireEvent.click(trigger); });

    expect(status).toHaveTextContent('Copied');
    expect(trigger).not.toHaveTextContent('Copied');
    expect(screen.getByRole('button', { name: 'Copy API key' })).toBe(trigger);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(status).toBeEmptyDOMElement();
  });

  it('keeps custom-label success announcements empty on failure and allows retry', async () => {
    const error = new Error('Denied');
    const onCopyError = vi.fn();
    const onCopy = vi.fn();
    writeText.mockRejectedValueOnce(error);
    const { rerender } = render(
      <CopyButton text="old" label="Copy query" onCopyError={onCopyError} onCopy={onCopy} />,
    );
    const trigger = screen.getByRole('button', { name: 'Copy query' });
    fireEvent.click(trigger);

    await waitFor(() => expect(onCopyError).toHaveBeenCalledExactlyOnceWith(error));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(onCopy).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied'));
    expect(onCopy).toHaveBeenCalledTimes(1);
    rerender(<CopyButton text="new" label="Copy query" />);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
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

  it('reports the original rejected error once without success feedback', async () => {
    const error = new Error('Clipboard permission denied');
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    writeText.mockRejectedValueOnce(error);
    render(
      <ToastProvider>
        <CopyButton text="private-value" withToast onCopy={onCopy} onCopyError={onCopyError} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByText('Failed to copy')).toBeInTheDocument();
    expect(onCopyError).toHaveBeenCalledTimes(1);
    expect(onCopyError.mock.calls[0][0]).toBe(error);
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument();
    expect(console.error).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', error);
    expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('private-value'), expect.anything());
  });

  it('reports unavailable clipboard once using the original failure and no fallback', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    render(<CopyButton text="x" withToast onCopy={onCopy} onCopyError={onCopyError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(onCopyError).toHaveBeenCalledTimes(1));
    const originalError = vi.mocked(console.error).mock.calls[0][1];
    expect(originalError).toBeInstanceOf(TypeError);
    expect(onCopyError.mock.calls[0][0]).toBe(originalError);
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument();
  });

  it('preserves a synchronous clipboard access error by identity', async () => {
    const error = new Error('Clipboard unavailable');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get: () => { throw error; },
    });
    const onCopyError = vi.fn();
    render(<CopyButton text="x" onCopyError={onCopyError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(onCopyError).toHaveBeenCalledExactlyOnceWith(error));
    expect(console.error).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', error);
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('passes non-Error clipboard rejections through unchanged', async () => {
    const error = { reason: 'permission-denied' };
    writeText.mockRejectedValueOnce(error);
    const onCopyError = vi.fn();
    render(<CopyButton text="x" onCopyError={onCopyError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(onCopyError).toHaveBeenCalledTimes(1));
    expect(onCopyError.mock.calls[0][0]).toBe(error);
  });

  it('keeps success callbacks and the default no-toast behavior unchanged', async () => {
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    render(
      <ToastProvider>
        <CopyButton text="x" onCopy={onCopy} onCopyError={onCopyError} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopyError).not.toHaveBeenCalled();
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument();
    expect(screen.queryByText('Failed to copy')).not.toBeInTheDocument();
    expect(console.error).not.toHaveBeenCalled();
  });

  it('keeps failure toasts opt-in while still reporting and logging the error', async () => {
    const error = new Error('Denied');
    const onCopyError = vi.fn();
    writeText.mockRejectedValueOnce(error);
    render(
      <ToastProvider>
        <CopyButton text="x" onCopyError={onCopyError} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(onCopyError).toHaveBeenCalledExactlyOnceWith(error));
    expect(console.error).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', error);
    expect(screen.queryByText('Failed to copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument();
  });

  it('does not invoke either callback or emit feedback when disabled', () => {
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    render(<CopyButton text="x" disabled withToast onCopy={onCopy} onCopyError={onCopyError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(writeText).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyError).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });

  it('does not report success callback exceptions as clipboard failures', async () => {
    const error = new Error('Caller callback failed');
    const onCopy = vi.fn(() => { throw error; });
    const onCopyError = vi.fn();
    render(
      <ToastProvider>
        <CopyButton text="x" withToast onCopy={onCopy} onCopyError={onCopyError} />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(handlerRejection).toHaveBeenCalledExactlyOnceWith(error));
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopyError).not.toHaveBeenCalled();
    expect(console.error).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(screen.queryByText('Failed to copy')).not.toBeInTheDocument();
  });

  it('logs the original clipboard failure even when the error callback throws', async () => {
    const error = new Error('Clipboard rejected');
    const callbackError = new Error('Manual-copy UI failed');
    const onCopyError = vi.fn(() => { throw callbackError; });
    writeText.mockRejectedValueOnce(error);
    render(<CopyButton text="x" onCopyError={onCopyError} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() => expect(handlerRejection).toHaveBeenCalledExactlyOnceWith(callbackError));
    expect(onCopyError).toHaveBeenCalledExactlyOnceWith(error);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', error);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('clears prior copied feedback when the next clipboard write fails', async () => {
    vi.useFakeTimers();
    const error = new Error('Second copy denied');
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    render(<CopyButton text="x" onCopy={onCopy} onCopyError={onCopyError} />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);

    writeText.mockRejectedValueOnce(error);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copied' })); });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopyError).toHaveBeenCalledExactlyOnceWith(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets copied feedback after two seconds', async () => {
    vi.useFakeTimers();
    render(<CopyButton text="x" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });

    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('restarts the feedback timer on repeated successful copies', async () => {
    vi.useFakeTimers();
    render(<CopyButton text="x" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    act(() => { vi.advanceTimersByTime(1500); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copied' })); });

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears copied feedback and its timer when text changes', async () => {
    vi.useFakeTimers();
    const { rerender } = render(<CopyButton text="old" iconOnly />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);

    rerender(<CopyButton text="new" iconOnly />);

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenLastCalledWith('new');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('cleans the feedback timer on unmount', async () => {
    vi.useFakeTimers();
    const { unmount } = render(<CopyButton text="x" />);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });
    expect(vi.getTimerCount()).toBe(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores a pending success after text changes', async () => {
    vi.useFakeTimers();
    let resolveWrite!: () => void;
    writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    const { rerender } = render(<CopyButton text="old" withToast onCopy={onCopy} onCopyError={onCopyError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    rerender(<CopyButton text="new" withToast onCopy={onCopy} onCopyError={onCopyError} />);

    await act(async () => { resolveWrite(); });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores stale failure feedback after text changes but preserves logging', async () => {
    const error = new Error('Old write denied');
    let rejectWrite!: (error: unknown) => void;
    writeText.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectWrite = reject; }));
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    const { rerender } = render(
      <ToastProvider>
        <CopyButton text="old" withToast onCopy={onCopy} onCopyError={onCopyError} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    rerender(
      <ToastProvider>
        <CopyButton text="new" withToast onCopy={onCopy} onCopyError={onCopyError} />
      </ToastProvider>,
    );

    await act(async () => { rejectWrite(error); });

    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyError).not.toHaveBeenCalled();
    expect(screen.queryByText('Failed to copy')).not.toBeInTheDocument();
    expect(screen.queryByText('Copied to clipboard')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(console.error).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', error);
  });

  it('ignores an older rejected write after a newer copy succeeds', async () => {
    vi.useFakeTimers();
    const error = new Error('Old write denied');
    let rejectWrite!: (error: unknown) => void;
    writeText.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectWrite = reject; }));
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    render(<CopyButton text="x" onCopy={onCopy} onCopyError={onCopyError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });

    await act(async () => { rejectWrite(error); });

    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopyError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', error);
  });

  it('does not deliver callbacks or create a timer for a pending write after unmount', async () => {
    vi.useFakeTimers();
    let resolveWrite!: () => void;
    writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    const { unmount } = render(<CopyButton text="x" onCopy={onCopy} onCopyError={onCopyError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    unmount();

    await act(async () => { resolveWrite(); });

    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyError).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restore copied feedback from an older success after a newer failure', async () => {
    vi.useFakeTimers();
    let resolveWrite!: () => void;
    writeText.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    const error = new Error('Latest copy denied');
    writeText.mockRejectedValueOnce(error);
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    render(<CopyButton text="x" onCopy={onCopy} onCopyError={onCopyError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Copy' })); });

    await act(async () => { resolveWrite(); });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyError).toHaveBeenCalledExactlyOnceWith(error);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not deliver stale error callbacks after unmount but preserves logging', async () => {
    vi.useFakeTimers();
    const error = new Error('Unmounted write denied');
    let rejectWrite!: (error: unknown) => void;
    writeText.mockImplementationOnce(() => new Promise<void>((_, reject) => { rejectWrite = reject; }));
    const onCopy = vi.fn();
    const onCopyError = vi.fn();
    const { unmount } = render(<CopyButton text="x" onCopy={onCopy} onCopyError={onCopyError} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    unmount();

    await act(async () => { rejectWrite(error); });

    expect(onCopy).not.toHaveBeenCalled();
    expect(onCopyError).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledExactlyOnceWith('CopyButton: clipboard write failed', error);
    expect(vi.getTimerCount()).toBe(0);
  });
});
