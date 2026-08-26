/**
 * useMutationToast — behavioural tests.
 *
 * `_toastHelpers.ts` exports a single hook, `useMutationToast()`, that returns
 * `{ success, warning, error }`. Its job is narrow but load-bearing (40+ mutation call
 * sites depend on it): translate an i18n key + English fallback into a toast
 * title, derive a user-facing detail line from an arbitrary thrown value, and
 * forward both to the in-house Toast system at the correct severity.
 *
 * These tests exercise the REAL <ToastProvider> (no toast module mock) so we
 * assert the end-to-end contract through rendered DOM:
 *   - success → a polite `role="status"` toast; error → an assertive
 *     `role="alert"` toast (the accessibility contract screen readers rely on);
 *   - i18n fallback + `{{var}}` interpolation land in the title;
 *   - the detail line is derived correctly for Error / string / number / null /
 *     duck-typed `{ message }` / message-less object / blank-message inputs —
 *     and NEVER renders the useless "[object Object]";
 *   - the returned helpers keep a stable identity across renders and continue
 *     to dispatch through the current provider after it re-renders.
 *
 * react-i18next is mocked with a deterministic `t` (honours `defaultValue` and
 * `{{var}}` interpolation) and framer-motion is flattened so toasts mount
 * synchronously in jsdom — the established pattern in this repo's suite.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { ToastProvider } from '@/components/feedback/Toast';
import { useDeferredMutationToast, useMutationToast } from './_toastHelpers';

// ── react-i18next: deterministic translator that honours `defaultValue` and
//    interpolates `{{var}}` placeholders so title assertions are exact. ──
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, opts?: unknown): string => {
    if (opts && typeof opts === 'object') {
      const bag = opts as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── framer-motion: strip animation props so <Toast> mounts inert + immediately
//    while preserving role / aria-live / className. ──
function filterDomProps(props: Record<string, any>) {
  const { layout: _l, initial: _i, animate: _a, exit: _e, transition: _t, ...rest } = props;
  return rest;
}
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...filterDomProps(props)}>{children}</div>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
  useReducedMotion: () => false,
}));

type ToastApi = ReturnType<typeof useMutationToast>;

/** Harness that surfaces the hook's helpers through a click handler. */
function Harness({ fire }: { fire: (api: ToastApi) => void }) {
  const api = useMutationToast();
  return (
    <button type="button" onClick={() => fire(api)}>
      fire
    </button>
  );
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <ToastProvider>{children}</ToastProvider>
);

/** Mount the harness inside a real ToastProvider and invoke `fire`. */
function fireHelper(fire: (api: ToastApi) => void) {
  render(<Harness fire={fire} />, { wrapper });
  fireEvent.click(screen.getByText('fire'));
}

// Fake timers keep the 4s auto-dismiss setTimeout from firing after a test.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useMutationToast — success()', () => {
  it('renders a polite status toast with the translated fallback title', () => {
    fireHelper((api) => api.success('toast.settings.saved', 'Settings saved'));

    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('Settings saved');
    // Success is polite, never assertive — no error/alert region should exist.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('useMutationToast — warning()', () => {
    it('renders a polite warning toast with interpolated counts', () => {
      fireHelper((api) => api.warning(
        'toast.repair.partial',
        'Updated {{updated}} cases; {{skipped}} skipped',
        { updated: 2, skipped: 1 },
      ));

      const region = screen.getByRole('status');
      expect(region).toHaveTextContent('Updated 2 cases; 1 skipped');
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('interpolates {{count}} placeholders into the success message', () => {
    fireHelper((api) => api.success('toast.rules.deleted', 'Deleted {{count}} rules', { count: 3 }));

    expect(screen.getByRole('status')).toHaveTextContent('Deleted 3 rules');
    expect(screen.getByRole('status')).not.toHaveTextContent('{{count}}');
  });

  it('leaves the fallback untouched when extra vars do not match a placeholder', () => {
    fireHelper((api) => api.success('toast.k', 'Plain message', { unused: 'x' }));

    expect(screen.getByRole('status')).toHaveTextContent('Plain message');
  });
});

describe('useMutationToast — error() title + severity', () => {
  it('renders an assertive alert toast with the Error message as the detail line', () => {
    fireHelper((api) => api.error(new Error('HTTP 500: boom'), 'toast.save.error', 'Failed to save'));

    const region = screen.getByRole('alert');
    expect(region).toHaveTextContent('Failed to save');
    expect(region).toHaveTextContent('HTTP 500: boom');
    // Error is assertive, never polite — no status region should exist.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('uses the default key + fallback ("Something went wrong") when none are supplied', () => {
    fireHelper((api) => api.error(new Error('kaboom')));

    const region = screen.getByRole('alert');
    expect(region).toHaveTextContent('Something went wrong');
    expect(region).toHaveTextContent('kaboom');
  });
});

describe('useMutationToast — error() detail derivation', () => {
  it('shows a raw string error verbatim as the detail line', () => {
    fireHelper((api) => api.error('network unreachable', 'toast.k', 'Request failed'));

    const region = screen.getByRole('alert');
    expect(region).toHaveTextContent('Request failed');
    expect(region).toHaveTextContent('network unreachable');
  });

  it('stringifies a numeric error code into the detail line', () => {
    fireHelper((api) => api.error(429, 'toast.k', 'Rate limited'));

    expect(screen.getByRole('alert')).toHaveTextContent('429');
  });

  it('extracts .message from a duck-typed error object instead of "[object Object]"', () => {
    fireHelper((api) => api.error({ message: 'duck typed failure' }, 'toast.k', 'Failed'));

    const region = screen.getByRole('alert');
    expect(region).toHaveTextContent('duck typed failure');
    expect(region).not.toHaveTextContent('[object Object]');
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('never surfaces "[object Object]" for a message-less object (title only)', () => {
    fireHelper((api) => api.error({ code: 500 }, 'toast.k', 'Failed'));

    const region = screen.getByRole('alert');
    // Exactly one <p> (the title) — no secondary detail line was rendered.
    expect(region.querySelectorAll('p')).toHaveLength(1);
    expect(region).toHaveTextContent('Failed');
    expect(screen.queryByText('[object Object]')).toBeNull();
  });

  it('renders a title-only toast when the error is null', () => {
    fireHelper((api) => api.error(null, 'toast.k', 'Something failed'));

    const region = screen.getByRole('alert');
    expect(region.querySelectorAll('p')).toHaveLength(1);
    expect(region).toHaveTextContent('Something failed');
  });

  it('renders a title-only toast when the error is undefined', () => {
    fireHelper((api) => api.error(undefined, 'toast.k', 'Something failed'));

    expect(screen.getByRole('alert').querySelectorAll('p')).toHaveLength(1);
  });

  it('collapses a whitespace-only Error message to a title-only toast', () => {
    fireHelper((api) => api.error(new Error('   '), 'toast.k', 'Blank detail'));

    const region = screen.getByRole('alert');
    expect(region.querySelectorAll('p')).toHaveLength(1);
    expect(region).toHaveTextContent('Blank detail');
  });
});

describe('useMutationToast — stability & live dispatch', () => {
  it('returns referentially stable helpers across re-renders', () => {
    const { result, rerender } = renderHook(() => useMutationToast(), { wrapper });

    const first = result.current;
    rerender();

    expect(result.current).toBe(first);
    expect(result.current.success).toBe(first.success);
    expect(result.current.warning).toBe(first.warning);
    expect(result.current.error).toBe(first.error);
  });

  it('keeps dispatching through the current provider after it re-renders', () => {
    const { result } = renderHook(() => useMutationToast(), { wrapper });

    // The first toast mutates provider state → the provider (and the hook
    // consumer) re-render. The ref-backed helpers must still reach the live
    // dispatcher for the second toast.
    act(() => {
      result.current.success('toast.k', 'first message');
    });
    act(() => {
      result.current.error(new Error('second detail'), 'toast.k', 'second title');
    });

    expect(screen.getByRole('status')).toHaveTextContent('first message');
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('second title');
    expect(alert).toHaveTextContent('second detail');
  });
});

describe('useMutationToast — provider contract', () => {
  it('throws when used outside a ToastProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Harness fire={() => {}} />)).toThrow(
      'useToast must be used within ToastProvider',
    );
    spy.mockRestore();
  });
});

describe('useDeferredMutationToast — deferred provider contract', () => {
  it('mounts without a provider while the mutation feedback remains dormant', () => {
    const { result } = renderHook(() => useDeferredMutationToast());

    expect(result.current.success).toBeTypeOf('function');
    expect(result.current.warning).toBeTypeOf('function');
    expect(result.current.error).toBeTypeOf('function');
  });

  it('still fails loudly when feedback is dispatched without a provider', () => {
    const { result } = renderHook(() => useDeferredMutationToast());

    expect(() => result.current.success('toast.k', 'Saved')).toThrow(
      'useToast must be used within ToastProvider',
    );
    expect(() => result.current.warning('toast.k', 'Review needed')).toThrow(
      'useToast must be used within ToastProvider',
    );
    expect(() => result.current.error(new Error('boom'))).toThrow(
      'useToast must be used within ToastProvider',
    );
  });
});
