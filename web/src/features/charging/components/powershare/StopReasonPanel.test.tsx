/**
 * StopReasonPanel — behaviour, branch precedence, a11y + null-safety cover.
 *
 * <StopReasonPanel /> is the "why did Powershare halt?" tile in the Powershare
 * cockpit. It receives a raw Tesla stop-reason enum plus the owning query's
 * {isLoading, error, onRetry} and renders exactly ONE of four mutually
 * exclusive states beneath a persistent "Stop Reason" heading:
 *
 *   LOADING   → <Skeleton>                         (isLoading, highest priority)
 *   ERROR     → <QueryError onRetry>               (error, before any label)
 *   POPULATED → <Badge>{humanized}</Badge> + help  (a humanizable reason)
 *   EMPTY     → <EmptyState>                        (null / empty reason)
 *
 * What is pinned here:
 *   • CHROME      — the "Stop Reason" heading + its decorative AlertCircle glyph
 *     render in every state; the glyph is hidden from assistive tech.
 *   • LOADING     — a skeleton shows and NO badge / error / empty leaks through.
 *   • POPULATED   — the proto enum is humanised into the Badge label AND the
 *     stop-reason severity is projected onto the Badge variant (danger / warning
 *     / neutral), with the helper caption alongside.
 *   • EMPTY       — a null OR empty-string reason collapses to the EmptyState
 *     placeholder (role=status) with a decorative, a11y-hidden Info glyph — never
 *     a blank badge.
 *   • ERROR       — QueryError renders and its Retry button is wired to onRetry.
 *   • PRECEDENCE  — loading beats error; error beats a stale reason label.
 *
 * The real GlassPanel / Badge / Skeleton / EmptyState / QueryError render.
 * react-i18next is mocked to the English fallback (repo convention) and
 * useOnlineStatus is pinned online so QueryError resolves to its deterministic
 * "Can't reach server" network branch. QueryError calls useNavigate(), so every
 * render is wrapped in a MemoryRouter. No network is touched — the panel is a
 * pure prop-driven view.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

import { StopReasonPanel } from './StopReasonPanel';

// English-fallback i18n: `t(key, default)` → default, with {{placeholder}}
// interpolation (repo convention — mirrors QuickMetrics.test.tsx).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>) =>
    vars ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`)) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Pin the browser online so QueryError resolves to the network ("Can't reach
// server") branch with an enabled Retry button rather than the offline copy.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

type Props = ComponentProps<typeof StopReasonPanel>;

function renderPanel(overrides: Partial<Props> = {}) {
  const onRetry = overrides.onRetry ?? vi.fn();
  const props: Props = {
    reason: null,
    isLoading: false,
    error: null,
    onRetry,
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <StopReasonPanel {...props} />
    </MemoryRouter>,
  );
  return { ...utils, onRetry };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StopReasonPanel — persistent chrome', () => {
  it('renders the "Stop Reason" heading with a decorative, a11y-hidden icon in the populated state', () => {
    renderPanel({ reason: 'PowershareStopReasonFault' });

    const heading = screen.getByRole('heading', { name: /stop reason/i });
    expect(heading).toBeInTheDocument();

    // The AlertCircle title glyph duplicates the "Stop Reason" text, so it must
    // be hidden from assistive tech (aria-hidden) — the visible label is the
    // sole accessible name for the heading.
    const icon = heading.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
  });

  it('keeps the heading present across loading, empty and populated states', () => {
    const { rerender } = renderPanel({ isLoading: true });
    expect(screen.getByRole('heading', { name: /stop reason/i })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <StopReasonPanel reason={null} isLoading={false} error={null} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /stop reason/i })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <StopReasonPanel reason="None" isLoading={false} error={null} onRetry={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /stop reason/i })).toBeInTheDocument();
  });
});

describe('StopReasonPanel — loading state', () => {
  it('shows a skeleton and suppresses the badge / error / empty branches', () => {
    const { container } = renderPanel({ isLoading: true, reason: null });

    // Skeleton is the animate-pulse placeholder block.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();

    // None of the resolved states leak through while loading.
    expect(screen.queryByRole('status')).toBeNull(); // no EmptyState
    expect(screen.queryByRole('alert')).toBeNull(); // no QueryError
    expect(screen.queryByText(/last recorded reason/i)).toBeNull(); // no helper/badge
  });

  it('prefers the loading skeleton even when an error is also present (precedence)', () => {
    const { container } = renderPanel({ isLoading: true, error: new Error('stale') });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/can't reach server/i)).toBeNull();
  });
});

describe('StopReasonPanel — populated (reason present)', () => {
  it('humanises the proto enum into the Badge label and shows the helper caption', () => {
    renderPanel({ reason: 'PowershareStopReasonUserRequest' });

    // `PowershareStopReasonUserRequest` → prefix stripped → camelCase split.
    const badge = screen.getByText('User Request');
    expect(badge.tagName).toBe('SPAN');

    expect(
      screen.getByText(/last recorded reason powershare was halted/i),
    ).toBeInTheDocument();

    // Populated ⇒ neither the empty nor the error placeholder is mounted.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('projects a fault reason onto the danger Badge variant', () => {
    renderPanel({ reason: 'PowershareStopReasonFault' });
    const badge = screen.getByText('Fault');
    expect(badge.className).toContain('bg-red-100'); // danger variant
  });

  it('projects a user-initiated reason onto the warning Badge variant', () => {
    renderPanel({ reason: 'PowershareStopReasonUserRequest' });
    const badge = screen.getByText('User Request');
    expect(badge.className).toContain('bg-yellow-100'); // warning variant
  });

  it('treats a bare "None" as a neutral, non-alarming reason (not amber/red)', () => {
    // The decoder trims Tesla's enum to bare "None" — a healthy "not halted"
    // signal that must read neutral, and is a real value distinct from EMPTY.
    renderPanel({ reason: 'None' });
    const badge = screen.getByText('None');
    expect(badge.className).toContain('bg-gray-100'); // neutral variant
    expect(screen.queryByRole('status')).toBeNull(); // NOT the empty placeholder
  });
});

describe('StopReasonPanel — empty state', () => {
  it('renders the no-data EmptyState (and no badge) when reason is null', () => {
    const { container } = renderPanel({ reason: null });

    const empty = screen.getByRole('status');
    expect(empty).toBeInTheDocument();
    expect(
      within(empty).getByText(/no stop reason recorded/i),
    ).toBeInTheDocument();

    // Every glyph in the empty state is decorative and must stay out of the
    // a11y tree (title AlertCircle + the EmptyState Info icon).
    const icons = Array.from(container.querySelectorAll('svg'));
    expect(icons.length).toBeGreaterThanOrEqual(2);
    for (const svg of icons) {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('treats an empty-string reason as no data — EmptyState, never a blank badge', () => {
    renderPanel({ reason: '' });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/no stop reason recorded/i)).toBeInTheDocument();
    expect(screen.queryByText(/last recorded reason/i)).toBeNull();
  });
});

describe('StopReasonPanel — error state', () => {
  it('renders QueryError and wires the Retry button to onRetry', () => {
    const onRetry = vi.fn();
    renderPanel({ error: new Error('boom'), onRetry });

    // Plain Error with no ApiError.status → the network branch (role=alert).
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/can't reach server/i)).toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('prefers the error branch over a stale reason label (precedence)', () => {
    renderPanel({ error: new Error('boom'), reason: 'PowershareStopReasonFault' });

    // Error outranks a populated reason: the QueryError shows, the badge does not.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Fault')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
