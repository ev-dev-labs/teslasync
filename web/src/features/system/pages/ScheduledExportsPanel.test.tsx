/**
 * ScheduledExportsPanel — comprehensive unit + integration coverage.
 *
 * The file exports a single component (`ScheduledExportsPanel`) whose private
 * helpers (`emptyInput`, `inputFromRow`) are exercised transitively through the
 * form: opening "New schedule" proves `emptyInput`'s defaults; clicking a row's
 * Edit proves `inputFromRow` round-trips every column.
 *
 * Coverage spans:
 *   1. Data state — one row per schedule, type/format cell, cron `<Code>`,
 *      delivery-kind + optional target arrow, status badges, and the
 *      never/dash placeholders; enabled/disabled affordances.
 *   2. Loading / error / empty — skeletons while loading, an actionable
 *      QueryError (NOT the misleading empty state) when the load fails, the
 *      empty placeholder when there are genuinely no rows, and the guard that
 *      keeps the table when a *background* refetch fails but data is present.
 *   3. Create — default form values, delivery-target reveal/hide branch, the
 *      submitted payload (download drops target, email trims + keeps it), the
 *      hardened rejection path (form stays open), and the pending-submit lock.
 *   4. Edit — pre-fill from the row and the id-scoped update payload.
 *   5. Row actions — Run-now, enable/disable toggle (both directions + a
 *      swallowed rejection), and the confirm-gated delete (accept + dismiss).
 *   6. Accessibility — accessible names for the header CTA and every row action.
 *
 * Network is never touched: the five export hooks are replaced with
 * controllable doubles and the timestamp preference is pinned so `<TimeStamp>`
 * never reaches the settings query.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { ScheduledExport } from '@/api/hooks/useExports';
import { ScheduledExportsPanel } from './ScheduledExportsPanel';

// framer-motion / tooltip primitives read matchMedia, which jsdom lacks.
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

// Shared, hoisted doubles so the mock factories and the specs reach the same
// instances.
const H = vi.hoisted(() => ({
  query: { current: undefined as unknown },
  createFn: vi.fn(),
  updateFn: vi.fn(),
  removeFn: vi.fn(),
  runNowFn: vi.fn(),
  createPending: { value: false },
  updatePending: { value: false },
  runNow: { pending: false, variables: undefined as number | undefined },
  refetch: vi.fn(),
}));

// i18n → return the developer fallback string, interpolating {{vars}}. Supports
// both `t(key, 'Default', { vars })` and `t(key, { defaultValue })`.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const translate = (key: string, second?: unknown, third?: unknown): string => {
    let template = key;
    let vars: Record<string, unknown> | undefined;
    if (typeof second === 'string') {
      template = second;
      if (third && typeof third === 'object') vars = third as Record<string, unknown>;
    } else if (second && typeof second === 'object') {
      vars = second as Record<string, unknown>;
      if (typeof (second as { defaultValue?: unknown }).defaultValue === 'string') {
        template = (second as { defaultValue: string }).defaultValue;
      }
    }
    if (!vars) return template;
    return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
      name in vars! ? String(vars![name]) : `{{${name}}}`,
    );
  };
  return {
    ...actual,
    useTranslation: () => ({
      t: translate,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Pin the timestamp preference so <TimeStamp> renders deterministically without
// reaching the @/api/hooks/useSettings query (which would attempt a fetch).
vi.mock('@/hooks/useTimeFormatPreference', () => ({
  useTimeFormatPreference: () => 'relative' as const,
}));

// The five export hooks the panel consumes. Keep the real module (types +
// exportKeys are harmless) and override only the hooks with controllable
// doubles.
vi.mock('@/api/hooks/useExports', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useExports')>(
    '@/api/hooks/useExports',
  );
  return {
    ...actual,
    useScheduledExports: () => H.query.current,
    useCreateScheduledExport: () => ({ mutateAsync: H.createFn, isPending: H.createPending.value }),
    useUpdateScheduledExport: () => ({ mutateAsync: H.updateFn, isPending: H.updatePending.value }),
    useDeleteScheduledExport: () => ({ mutate: H.removeFn, isPending: false }),
    useRunScheduledExportNow: () => ({
      mutate: H.runNowFn,
      isPending: H.runNow.pending,
      variables: H.runNow.variables,
    }),
  };
});

// ── Fixtures ────────────────────────────────────────────────────────────────
function makeRow(overrides: Partial<ScheduledExport> = {}): ScheduledExport {
  return {
    id: 1,
    owner_subject: 'user-1',
    name: 'Drives weekly',
    export_type: 'drives',
    format: 'csv',
    vehicle_id: null,
    columns: null,
    schedule_cron: '0 9 * * 0',
    delivery: { kind: 'download' },
    range_window: '7d',
    enabled: true,
    last_run_at: null,
    last_status: null,
    last_error: null,
    next_run_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

interface Query {
  data?: ScheduledExport[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: typeof H.refetch;
}

function makeQuery(overrides: Partial<Query> = {}): Query {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: H.refetch,
    ...overrides,
  };
}

function setQuery(q: Partial<Query>) {
  H.query.current = makeQuery(q);
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScheduledExportsPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const DATA: ScheduledExport[] = [
  makeRow({
    id: 1,
    name: 'Drives weekly',
    export_type: 'drives',
    format: 'csv',
    delivery: { kind: 'download' },
    next_run_at: FUTURE,
    last_run_at: null,
    last_status: null,
    enabled: true,
  }),
  makeRow({
    id: 2,
    name: 'Charging weekly',
    export_type: 'charging',
    format: 'json',
    schedule_cron: '0 8 * * 1',
    delivery: { kind: 'webhook', target: 'https://hook.example/x' },
    next_run_at: FUTURE,
    last_run_at: PAST,
    last_status: 'ok',
    enabled: true,
  }),
  makeRow({
    id: 3,
    name: 'Signals daily',
    export_type: 'signals',
    format: 'csv',
    delivery: { kind: 'email', target: 'you@ex.com' },
    next_run_at: null,
    last_run_at: PAST,
    last_status: 'failed',
    enabled: false,
  }),
];

beforeEach(() => {
  H.createFn.mockReset().mockResolvedValue(makeRow());
  H.updateFn.mockReset().mockResolvedValue(makeRow());
  H.removeFn.mockReset();
  H.runNowFn.mockReset();
  H.refetch.mockReset().mockResolvedValue(undefined);
  H.createPending.value = false;
  H.updatePending.value = false;
  H.runNow.pending = false;
  H.runNow.variables = undefined;
  setQuery({ data: [] });
  window.localStorage.clear();
});

// ── 1. Data state ─────────────────────────────────────────────────────────────
describe('ScheduledExportsPanel — data state', () => {
  beforeEach(() => setQuery({ data: DATA }));

  it('renders a row per schedule with name, type/format, and cron', () => {
    renderPanel();
    expect(screen.getByTestId('scheduled-exports-table')).toBeInTheDocument();
    expect(screen.getByText('Drives weekly')).toBeInTheDocument();
    expect(screen.getByText('Charging weekly')).toBeInTheDocument();
    expect(screen.getByText('Signals daily')).toBeInTheDocument();
    expect(screen.getByText('drives (csv)')).toBeInTheDocument();
    expect(screen.getByText('charging (json)')).toBeInTheDocument();
    // cron rendered inside a <Code>
    expect(screen.getByText('0 8 * * 1')).toBeInTheDocument();
  });

  it('renders delivery kind, with a target arrow only for email/webhook', () => {
    renderPanel();
    expect(within(screen.getByTestId('scheduled-exports-row-1')).getByText('download')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('scheduled-exports-row-2')).getByText('webhook → https://hook.example/x'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('scheduled-exports-row-3')).getByText('email → you@ex.com'),
    ).toBeInTheDocument();
  });

  it('renders status badges and the never/last-run placeholders', () => {
    renderPanel();
    // last_run_at null → "Never"
    expect(within(screen.getByTestId('scheduled-exports-row-1')).getByText('Never')).toBeInTheDocument();
    expect(within(screen.getByTestId('scheduled-exports-row-2')).getByText('OK')).toBeInTheDocument();
    expect(within(screen.getByTestId('scheduled-exports-row-3')).getByText('Failed')).toBeInTheDocument();
  });

  it('dims disabled rows and swaps the toggle affordance', () => {
    renderPanel();
    const disabled = screen.getByTestId('scheduled-exports-row-3');
    expect(disabled.className).toContain('opacity-50');
    expect(within(disabled).getByRole('button', { name: 'Enable' })).toBeInTheDocument();

    const enabled = screen.getByTestId('scheduled-exports-row-1');
    expect(enabled.className).not.toContain('opacity-50');
    expect(within(enabled).getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });
});

// ── 2. Loading / error / empty ────────────────────────────────────────────────
describe('ScheduledExportsPanel — loading / error / empty', () => {
  it('shows no table or empty state while loading', () => {
    setQuery({ data: undefined, isLoading: true });
    renderPanel();
    expect(screen.queryByTestId('scheduled-exports-table')).toBeNull();
    expect(screen.queryByText('No schedules yet')).toBeNull();
    // Header (and its "New schedule" CTA) still render → surface never blank.
    expect(screen.getByText('Scheduled exports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New schedule' })).toBeInTheDocument();
  });

  it('surfaces an actionable error — not the empty state — when the load fails', () => {
    setQuery({ data: undefined, isError: true, error: new Error('boom') });
    renderPanel();
    // The misleading "no schedules" empty state must NOT appear on error.
    expect(screen.queryByText('No schedules yet')).toBeNull();
    // QueryError network branch (jsdom navigator.onLine === true).
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(H.refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are genuinely no schedules', () => {
    setQuery({ data: [] });
    renderPanel();
    expect(screen.getByText('No schedules yet')).toBeInTheDocument();
    expect(screen.queryByTestId('scheduled-exports-table')).toBeNull();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });

  it('keeps the table when a background refetch errors but data is present', () => {
    setQuery({ data: DATA, isError: true, error: new Error('stale') });
    renderPanel();
    expect(screen.getByTestId('scheduled-exports-table')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).toBeNull();
  });
});

// ── 3. Create form ────────────────────────────────────────────────────────────
describe('ScheduledExportsPanel — create form', () => {
  beforeEach(() => setQuery({ data: [] }));

  it('opens the form with emptyInput() defaults', () => {
    renderPanel();
    expect(screen.queryByTestId('scheduled-exports-form')).toBeNull();
    fireEvent.click(screen.getByTestId('scheduled-exports-new-button'));

    expect(screen.getByTestId('scheduled-exports-form')).toBeInTheDocument();
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect((screen.getByPlaceholderText('0 9 * * 0') as HTMLInputElement).value).toBe('0 9 * * 0');
    expect((screen.getByLabelText('Export type') as HTMLSelectElement).value).toBe('drives');
    expect((screen.getByLabelText('Format') as HTMLSelectElement).value).toBe('csv');
    expect((screen.getByLabelText('Delivery kind') as HTMLSelectElement).value).toBe('download');
  });

  it('hides the delivery target for download and reveals it per non-download kind', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-new-button'));
    // download → no target field
    expect(screen.queryByPlaceholderText('you@example.com')).toBeNull();
    expect(screen.queryByPlaceholderText('https://example.com/hook')).toBeNull();

    fireEvent.change(screen.getByLabelText('Delivery kind'), { target: { value: 'email' } });
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Delivery kind'), { target: { value: 'webhook' } });
    expect(screen.getByPlaceholderText('https://example.com/hook')).toBeInTheDocument();
  });

  it('submits a create payload (download drops the target) and closes the form', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-new-button'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'My export' } });
    fireEvent.submit(screen.getByTestId('scheduled-exports-form'));

    await waitFor(() => expect(H.createFn).toHaveBeenCalledTimes(1));
    expect(H.createFn).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'My export',
        export_type: 'drives',
        format: 'csv',
        schedule_cron: '0 9 * * 0',
        delivery: { kind: 'download' },
        range_window: '7d',
        enabled: true,
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('scheduled-exports-form')).toBeNull());
  });

  it('trims and keeps the delivery target for email deliveries', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-new-button'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Emailed' } });
    fireEvent.change(screen.getByLabelText('Delivery kind'), { target: { value: 'email' } });
    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: '  ops@example.com  ' },
    });
    fireEvent.submit(screen.getByTestId('scheduled-exports-form'));

    await waitFor(() => expect(H.createFn).toHaveBeenCalledTimes(1));
    expect(H.createFn).toHaveBeenCalledWith(
      expect.objectContaining({ delivery: { kind: 'email', target: 'ops@example.com' } }),
    );
  });

  it('keeps the form open when the create mutation rejects', async () => {
    H.createFn.mockRejectedValueOnce(new Error('server 400'));
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-new-button'));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad' } });
    fireEvent.submit(screen.getByTestId('scheduled-exports-form'));

    await waitFor(() => expect(H.createFn).toHaveBeenCalledTimes(1));
    // Rejection is swallowed (toast owned by the hook) and the form persists
    // so the user can correct and retry.
    expect(await screen.findByTestId('scheduled-exports-form')).toBeInTheDocument();
  });

  it('locks the submit button while a create is pending', () => {
    H.createPending.value = true;
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-new-button'));
    const submit = screen.getByTestId('scheduled-exports-form-submit');
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');
  });
});

// ── 4. Edit form ──────────────────────────────────────────────────────────────
describe('ScheduledExportsPanel — edit form', () => {
  beforeEach(() => setQuery({ data: DATA }));

  it('pre-fills the form from the selected row (inputFromRow)', () => {
    renderPanel();
    fireEvent.click(
      within(screen.getByTestId('scheduled-exports-row-2')).getByRole('button', { name: 'Edit' }),
    );
    const form = screen.getByTestId('scheduled-exports-form');
    expect((within(form).getByLabelText('Name') as HTMLInputElement).value).toBe('Charging weekly');
    expect((within(form).getByPlaceholderText('0 9 * * 0') as HTMLInputElement).value).toBe('0 8 * * 1');
    expect((within(form).getByLabelText('Delivery kind') as HTMLSelectElement).value).toBe('webhook');
    expect(
      (within(form).getByPlaceholderText('https://example.com/hook') as HTMLInputElement).value,
    ).toBe('https://hook.example/x');
  });

  it('submits an update payload scoped to the row id', async () => {
    renderPanel();
    fireEvent.click(
      within(screen.getByTestId('scheduled-exports-row-2')).getByRole('button', { name: 'Edit' }),
    );
    const form = screen.getByTestId('scheduled-exports-form');
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Charging biweekly' } });
    fireEvent.submit(form);

    await waitFor(() => expect(H.updateFn).toHaveBeenCalledTimes(1));
    expect(H.updateFn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 2,
        payload: expect.objectContaining({
          name: 'Charging biweekly',
          delivery: { kind: 'webhook', target: 'https://hook.example/x' },
        }),
      }),
    );
  });
});

// ── 5. Row actions ────────────────────────────────────────────────────────────
describe('ScheduledExportsPanel — row actions', () => {
  beforeEach(() => setQuery({ data: DATA }));

  it('triggers Run now with the row id', () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-run-2'));
    expect(H.runNowFn).toHaveBeenCalledWith(2);
  });

  it('toggles an enabled row off via the update mutation', async () => {
    renderPanel();
    fireEvent.click(
      within(screen.getByTestId('scheduled-exports-row-2')).getByRole('button', { name: 'Disable' }),
    );
    await waitFor(() => expect(H.updateFn).toHaveBeenCalledTimes(1));
    expect(H.updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 2, payload: expect.objectContaining({ enabled: false }) }),
    );
  });

  it('toggles a disabled row on via the update mutation', async () => {
    renderPanel();
    fireEvent.click(
      within(screen.getByTestId('scheduled-exports-row-3')).getByRole('button', { name: 'Enable' }),
    );
    await waitFor(() => expect(H.updateFn).toHaveBeenCalledTimes(1));
    expect(H.updateFn).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, payload: expect.objectContaining({ enabled: true }) }),
    );
  });

  it('does not throw when a toggle mutation rejects', async () => {
    H.updateFn.mockRejectedValueOnce(new Error('nope'));
    renderPanel();
    fireEvent.click(
      within(screen.getByTestId('scheduled-exports-row-2')).getByRole('button', { name: 'Disable' }),
    );
    await waitFor(() => expect(H.updateFn).toHaveBeenCalledTimes(1));
    // No unhandled rejection; the row is still rendered.
    expect(screen.getByTestId('scheduled-exports-row-2')).toBeInTheDocument();
  });
});

// ── 6. Delete flow ────────────────────────────────────────────────────────────
describe('ScheduledExportsPanel — delete flow', () => {
  beforeEach(() => setQuery({ data: DATA }));

  it('confirms then deletes the schedule', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-delete-2'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete schedule?')).toBeInTheDocument();
    // Interpolated confirmation copy.
    expect(
      within(dialog).getByText('This will stop future runs of Charging weekly.'),
    ).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(H.removeFn).toHaveBeenCalledWith(2);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('does not delete when the confirm dialog is dismissed', async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId('scheduled-exports-delete-2'));

    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(H.removeFn).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// ── 7. Accessibility ──────────────────────────────────────────────────────────
describe('ScheduledExportsPanel — accessibility', () => {
  it('exposes an accessible New schedule action', () => {
    setQuery({ data: [] });
    renderPanel();
    expect(screen.getByRole('button', { name: 'New schedule' })).toBeInTheDocument();
  });

  it('gives every row action an accessible name', () => {
    setQuery({ data: DATA });
    renderPanel();
    const row = screen.getByTestId('scheduled-exports-row-2');
    expect(within(row).getByRole('button', { name: 'Run now' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Disable' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });
});
