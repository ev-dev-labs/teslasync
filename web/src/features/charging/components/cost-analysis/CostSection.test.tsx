/**
 * CostSection — behaviour, branch precedence, a11y + null-safety coverage.
 *
 * CostSection is the self-sufficient section shell every band on the Cost
 * Analysis page renders through. A persistent header (an h3 <PanelTitle> plus an
 * optional decorative icon and a trailing action slot) sits above a single
 * state-driven body whose branch order is:
 *
 *     isLoading  → <Skeleton>            (query loading its first payload)
 *     error      → <QueryError>          (retry wired to onRetry)
 *     isEmpty    → <EmptyState>          (query resolved but produced no rows)
 *     otherwise  → children in a body wrapper (with optional bodyClassName)
 *
 * The branch precedence is asserted directly (loading beats error beats empty),
 * the header is proven to stay mounted through every state (never a blank
 * panel), the decorative icon is proven to be excluded from the heading's
 * accessible name, and the empty-message fallback is pinned so an empty section
 * can never collapse to a message-less <EmptyState>.
 *
 * Strategy: CostSection takes all of its data as props, so no network is
 * touched. <QueryError> reaches for useNavigate + useOnlineStatus, so the tree
 * is wrapped in QueryClientProvider + MemoryRouter (mirrors the sibling
 * DrivingSection test). Only `react-i18next` is mocked so `t(key, fallback)` /
 * `t(key, fallback, { vars })` render the English fallback deterministically —
 * exactly how QueryError builds "{{thing}} not found" and how CostSection builds
 * its default selected-window guidance. `@testing-library/user-event` is
 * intentionally NOT a dependency of this repo; `fireEvent.click` is the
 * established interaction convention for the Retry CTA.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { type ComponentProps, type ReactNode } from 'react';

// jsdom lacks matchMedia; install a benign stub before any module that might
// read it at import time evaluates (defensive — shared UI pulls it in).
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// i18n → return the developer fallback string, interpolating {{vars}} so the
// error/empty copy reads as real English. Handles both call shapes the tree
// uses: t(key, 'fallback') and t(key, 'fallback', { vars }).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { CostSection } from './CostSection';
import { ApiError } from '@/lib/resilience';

const TITLE = 'Cost per kWh';

type Overrides = Partial<ComponentProps<typeof CostSection>>;

function renderSection(over: Overrides = {}) {
  const { children, title, ...rest } = over;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CostSection title={title ?? TITLE} {...rest}>
          {children === undefined ? <div data-testid="body">Body content</div> : children}
        </CostSection>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function heading(): HTMLElement {
  return screen.getByRole('heading', { level: 3 });
}

function panel(container: HTMLElement): HTMLElement {
  const el = container.querySelector('[data-print-card]');
  if (!el) throw new Error('GlassPanel root ([data-print-card]) not found');
  return el as HTMLElement;
}

describe('CostSection — header (always mounted)', () => {
  it('renders the title as an h3 whose accessible name excludes the decorative icon', () => {
    renderSection({ icon: <svg data-testid="icon" /> });

    const h = heading();
    expect(h.tagName).toBe('H3');
    // The icon is wrapped aria-hidden, so the heading name is text-only.
    expect(h).toHaveAccessibleName(TITLE);

    // The icon still renders (decoration), but inside an aria-hidden subtree.
    const icon = screen.getByTestId('icon');
    expect(icon).toBeInTheDocument();
    expect(icon.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('renders no icon wrapper when no icon is provided', () => {
    const { container } = renderSection();
    expect(heading()).toHaveAccessibleName(TITLE);
    expect(screen.queryByTestId('icon')).toBeNull();
    expect(container.querySelector('h3 span[aria-hidden="true"]')).toBeNull();
  });

  it('renders the trailing action slot when provided', () => {
    renderSection({ action: <span data-testid="action">Legend</span> });
    expect(screen.getByTestId('action')).toBeInTheDocument();
  });

  it('omits the action wrapper entirely when no action is passed', () => {
    renderSection();
    expect(screen.queryByTestId('action')).toBeNull();
  });
});

describe('CostSection — content branch', () => {
  it('renders children inside a body wrapper carrying bodyClassName when idle', () => {
    const { container } = renderSection({
      bodyClassName: 'space-y-4',
      children: <div data-testid="body">Rendered rows</div>,
    });

    const body = screen.getByTestId('body');
    expect(body).toBeInTheDocument();
    // The wrapper div (not the child) receives bodyClassName.
    expect(body.parentElement).toHaveClass('space-y-4');
    // None of the state branches leak alongside the content.
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders an empty body wrapper without crashing when children is null and idle', () => {
    // MonthlyCostChart / CostPerKwhChart pass `{null}` in their non-error path.
    const { container } = renderSection({ children: null });
    expect(heading()).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('CostSection — loading branch', () => {
  it('renders a default-height skeleton and hides children while loading', () => {
    const { container } = renderSection({
      isLoading: true,
      children: <div data-testid="body" />,
    });

    const skeleton = container.querySelector('.animate-pulse');
    expect(skeleton).not.toBeNull();
    expect(skeleton).toHaveStyle('height: 220px');
    expect(screen.queryByTestId('body')).toBeNull();
    // Never a blank panel: the header persists through the loading state.
    expect(heading()).toBeInTheDocument();
  });

  it('honours a custom skeletonHeight', () => {
    const { container } = renderSection({ isLoading: true, skeletonHeight: 300 });
    expect(container.querySelector('.animate-pulse')).toHaveStyle('height: 300px');
  });

  it('gives loading precedence over error (skeleton wins, no QueryError)', () => {
    const { container } = renderSection({
      isLoading: true,
      error: new ApiError('boom', 500),
    });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
  });
});

describe('CostSection — error branch', () => {
  it('surfaces a retryable 5xx error and wires Retry to onRetry', () => {
    const onRetry = vi.fn();
    renderSection({
      error: new ApiError('drives feed exploded', 500),
      onRetry,
      children: <div data-testid="body" />,
    });

    // QueryError branches on ApiError.status → the 5xx "Server error" copy.
    expect(screen.getByText('Server error')).toBeInTheDocument();
    // The content is replaced, never rendered alongside the error.
    expect(screen.queryByTestId('body')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the 404 not-found variant for a missing resource', () => {
    renderSection({ error: new ApiError('missing', 404) });
    expect(screen.getByText('Resource not found')).toBeInTheDocument();
    expect(screen.queryByText('Server error')).toBeNull();
  });

  it('keeps the header mounted through the error branch (never a blank panel)', () => {
    renderSection({ error: new ApiError('down', 503) });
    expect(heading()).toHaveAccessibleName(TITLE);
  });

  it('gives error precedence over empty (QueryError wins, no EmptyState)', () => {
    renderSection({
      error: new ApiError('x', 502),
      isEmpty: true,
      emptyMessage: 'Nothing here',
    });
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Nothing here')).toBeNull();
  });
});

describe('CostSection — empty branch', () => {
  it('renders the provided empty message (role=status) and hides children', () => {
    renderSection({
      isEmpty: true,
      emptyMessage: 'No monthly data available',
      children: <div data-testid="body" />,
    });

    expect(screen.getByText('No monthly data available')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('body')).toBeNull();
  });

  it('falls back to localized charging guidance when empty without a message', () => {
    renderSection({ isEmpty: true, emptyMessage: undefined });

    expect(
      screen.getByText('No charging records match the current selection.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/Adjust the vehicle or date filters/)).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders the emptyIcon inside the empty state', () => {
    renderSection({
      isEmpty: true,
      emptyMessage: 'None yet',
      emptyIcon: <svg data-testid="empty-icon" />,
    });
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });
});

describe('CostSection — panel styling', () => {
  it('merges a custom className onto the GlassPanel while keeping the base padding', () => {
    const { container } = renderSection({ glow: 'cyan', className: 'col-span-2' });
    const root = panel(container);
    expect(root).toHaveClass('col-span-2');
    expect(root).toHaveClass('p-4');
    expect(root).toHaveClass('sm:p-5');
  });
});
