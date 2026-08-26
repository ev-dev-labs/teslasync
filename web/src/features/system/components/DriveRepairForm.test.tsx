/**
 * DriveRepairForm tests (Project Apex elevation).
 *
 * DriveRepairForm is the inline SI editor for one stale drive. Its single
 * export orchestrates:
 *   - six SI-canonical inputs (ended_at ISO text + distance_m / duration_s /
 *     end_soc_pct / max_speed_mps / avg_speed_mps numbers) seeded from the
 *     drive prop,
 *   - live `useUnits()` hints that convert each SI entry to the operator's
 *     preferred display unit at the render boundary (km / km·h⁻¹ / h),
 *   - a Save that PUTs only the filled fields to the singular SI-canonical
 *     `/data-repair/drive/{id}` route, a Close that POSTs `.../close`, a
 *     Discard that DELETEs, and a Cancel that just calls `onClose`.
 *
 * These tests exercise every branch. The shared `request` client is stubbed so
 * the real TanStack Query mutation hooks (`useUpdateDrive`, `useCloseDrive`,
 * `useDiscardDrive`) run end-to-end without a network. `useSettings` is left to
 * the global test-setup stub (metric / SI units, decimal_precision=2), so SI
 * values format as km / km/h / h. i18n is stubbed to return the English
 * `defaultValue` with `{{var}}` interpolation so visible copy is deterministic.
 *
 * user-event is intentionally NOT used — it is not installed in this repo (see
 * DataRepairPage.test.tsx). Interactions go through `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// Stub the resilient fetch client while preserving the rest of the module so
// transitive consumers (toast helpers, query broadcast) keep working.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

// Deterministic i18n: return the English defaultValue and interpolate the
// `{{id}}` placeholder the region label uses.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>): string =>
    vars
      ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) =>
          k in vars ? String(vars[k]) : `{{${k}}}`,
        )
      : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, dflt?: unknown, opts?: unknown) => {
        if (typeof dflt === 'string') {
          const vars = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : undefined;
          return interpolate(dflt, vars);
        }
        if (dflt && typeof dflt === 'object') {
          const o = dflt as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return interpolate(o.defaultValue, o);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { request } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import { DriveRepairForm } from './DriveRepairForm';
import type { StaleDrive } from '@/api/hooks/useDataRepair';

const mockRequest = request as unknown as ReturnType<typeof vi.fn>;

type RequestArgs = [string, RequestInit?];

/** A fully-populated, well-formed stale drive. Override per test. */
function buildDrive(overrides?: Partial<StaleDrive>): StaleDrive {
  return {
    id: 202,
    vehicle_id: 7,
    start_ts: '2026-03-29T09:00:00Z',
    end_ts: null,
    duration_s: null,
    distance_m: 15000, // → 15.00 km
    start_battery_pct: 80,
    end_battery_pct: 80,
    max_speed_mps: 30, // → 108.00 km/h
    avg_speed_mps: 20, // → 72.00 km/h
    energy_used_wh: null,
    ...overrides,
  };
}

function renderForm(drive: StaleDrive = buildDrive(), formId = 'drive-repair-202-form') {
  const onClose = vi.fn();
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <DriveRepairForm drive={drive} formId={formId} onClose={onClose} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { onClose, formId, ...utils };
}

/** Find the first stubbed request call issued with the given HTTP method. */
function findCall(method: string): RequestArgs | undefined {
  return (mockRequest.mock.calls as RequestArgs[]).find((c) => c[1]?.method === method);
}

/** Parse the JSON body of a captured request call into a plain object. */
function bodyOf(call: RequestArgs | undefined): Record<string, unknown> {
  return JSON.parse(String(call?.[1]?.body ?? '{}')) as Record<string, unknown>;
}

function confirmAction(actionName: string): void {
  fireEvent.click(screen.getByRole('button', { name: actionName }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
}

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
});

describe('DriveRepairForm — Project Apex elevation', () => {
  it('renders an accessible region wired to formId, with all six SI inputs seeded from the drive', () => {
    renderForm(buildDrive(), 'drive-202-editor');

    // The region carries the caller-supplied id so the triggering row can
    // reference it via aria-controls, and is labelled with the drive id.
    const region = screen.getByRole('region', { name: 'Repair drive #202' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('id', 'drive-202-editor');

    // Every field is labelled and seeded from SI columns (nullish → '').
    expect((screen.getByLabelText('End Date/Time (ISO)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Distance (m)') as HTMLInputElement).value).toBe('15000');
    expect((screen.getByLabelText('Duration (s)') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('End Battery (%)') as HTMLInputElement).value).toBe('80');
    expect((screen.getByLabelText('Max Speed (m/s)') as HTMLInputElement).value).toBe('30');
    expect((screen.getByLabelText('Avg Speed (m/s)') as HTMLInputElement).value).toBe('20');

    // The four actions are reachable by their accessible names, and each
    // carries a decorative, aria-hidden icon (icon-only-in-spirit controls
    // must never expose the glyph to assistive tech).
    const save = within(region).getByRole('button', { name: 'Save' });
    expect(save).toBeInTheDocument();
    expect(save.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    expect(within(region).getByRole('button', { name: 'Close Drive' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    expect(within(region).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows live SI→display-unit hints and updates them as the operator edits', () => {
    renderForm();

    // Seeded SI values convert at the boundary: 15000 m → km, 30/20 m/s → km/h.
    expect(screen.getByText('15.00 km')).toBeInTheDocument();
    expect(screen.getByText('108.00 km/h')).toBeInTheDocument();
    expect(screen.getByText('72.00 km/h')).toBeInTheDocument();
    // duration_s was null → empty field → no duration hint yet.
    expect(screen.queryByText('1.00 h')).not.toBeInTheDocument();

    // Editing distance re-derives the hint live; the stale hint is gone.
    fireEvent.change(screen.getByLabelText('Distance (m)'), { target: { value: '20000' } });
    expect(screen.getByText('20.00 km')).toBeInTheDocument();
    expect(screen.queryByText('15.00 km')).not.toBeInTheDocument();

    // Entering a duration surfaces the hours hint (3600 s → 1.00 h).
    fireEvent.change(screen.getByLabelText('Duration (s)'), { target: { value: '3600' } });
    expect(screen.getByText('1.00 h')).toBeInTheDocument();
  });

  it('Save PUTs only the filled fields to the singular SI-canonical route, then calls onClose', async () => {
    const { onClose } = renderForm();

    confirmAction('Save');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const put = findCall('PUT');
    expect(put?.[0]).toBe('/data-repair/drive/202');
    // ended_at (empty) and duration_s (null) are omitted; the rest are patched
    // by their SI-canonical column names.
    expect(bodyOf(put)).toEqual({
      distance_m: 15000,
      end_soc_pct: 80,
      max_speed_mps: 30,
      avg_speed_mps: 20,
    });
  });

  it('keeps ended_at out of Save and omits a field the operator clears', async () => {
    const { onClose } = renderForm();

    fireEvent.change(screen.getByLabelText('Distance (m)'), { target: { value: '20000' } });
    fireEvent.change(screen.getByLabelText('Avg Speed (m/s)'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('End Date/Time (ISO)'), {
      target: { value: '  2026-03-30T04:00:00Z  ' },
    });

    confirmAction('Save');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    // avg_speed_mps was cleared and ended_at belongs only to Close.
    expect(bodyOf(findCall('PUT'))).toEqual({
      distance_m: 20000,
      end_soc_pct: 80,
      max_speed_mps: 30,
    });
  });

  it('drops non-finite seeded values from the patch instead of serialising them to null', async () => {
    // A corrupted drive row (NaN/Infinity SI values) seeds the form state as
    // "NaN"/"Infinity" strings — number inputs never sanitise state, only the
    // DOM. Saving without touching those fields must NOT emit `null` columns.
    const { onClose } = renderForm(
      buildDrive({ distance_m: Infinity, max_speed_mps: NaN }),
    );

    confirmAction('Save');
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));

    const put = findCall('PUT');
    const body = bodyOf(put);
    // The non-finite fields are excluded entirely; the well-formed ones remain.
    expect(body).not.toHaveProperty('distance_m');
    expect(body).not.toHaveProperty('max_speed_mps');
    expect(body).toEqual({ end_soc_pct: 80, avg_speed_mps: 20 });
    // Defense-in-depth: nothing serialised to a null-nulling value.
    expect(String(put?.[1]?.body)).not.toContain('null');
    // The hint for the non-finite distance is suppressed (no bare em dash).
    expect(screen.queryByText(/\d+\.\d+ km$/)).not.toBeInTheDocument();
  });

  it('Close POSTs to the SI-canonical close route and closes the form on success', async () => {
    const { onClose } = renderForm();

    fireEvent.change(screen.getByLabelText('End Date/Time (ISO)'), {
      target: { value: '2026-03-30T04:00:00Z' },
    });
    confirmAction('Close Drive');

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRequest).toHaveBeenCalledWith(
      '/data-repair/drive/202/close',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          ended_at: '2026-03-30T04:00:00Z',
          rule: 'manual',
          expected_stored_ended_at: '',
        }),
      }),
    );
    // Close is a stamp-only action — it must not send a PUT patch.
    expect(findCall('PUT')).toBeUndefined();
  });

  it('Discard DELETEs the drive and closes the form on success', async () => {
    const { onClose } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mockRequest).toHaveBeenCalledWith(
      '/data-repair/drive/202',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('Cancel closes the form without issuing any network request', () => {
    const { onClose } = renderForm();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('marks Save busy and disabled while the update mutation is in flight', async () => {
    // A request that never settles keeps the mutation pending.
    mockRequest.mockReturnValue(new Promise<never>(() => {}));
    const { onClose } = renderForm();

    confirmAction('Save');

    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeDisabled());
    expect(save).toHaveAttribute('aria-busy', 'true');
    // The user is never trapped — Cancel stays operable during the request.
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
