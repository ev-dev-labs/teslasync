/**
 * PreviewApplyPanel — the explicit preview -> apply backfill/reprice flow.
 *
 * This is the ONLY write path that ever reprices already-existing sessions,
 * so its guardrails are the most safety-critical UI in the feature:
 *
 *   1. Empty state when no rate is selected yet (nothing to preview).
 *   2. Renders matched/eligible/protected/energy/estimated-cost once a rate
 *      is selected and its preview has loaded.
 *   3. Apply is gated behind a confirm dialog and disabled until there is
 *      at least one eligible session.
 *   4. Narrowing from/to re-queries the preview with the converted ISO range.
 *   5. A successful apply shows the priced/skipped/total result inline.
 *   6. Loading and error states for the preview query.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) => (name in o ? String(o[name]) : `{{${name}}}`));
          }
          return fallbackOrOpts;
        }
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') return o.defaultValue;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'en-US' }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatEnergy: (wh: number) => `${(wh / 1000).toFixed(1)} kWh` }),
}));

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofenceRatePreview: vi.fn(),
  useApplyGeofenceRate: vi.fn(),
}));

import { useGeofenceRatePreview, useApplyGeofenceRate } from '@/api/hooks/useLocations';
import { PreviewApplyPanel } from './PreviewApplyPanel';
import type { GeofenceRate, GeofenceRateImpactPreview, GeofenceRateApplyResult } from '@/api/types';

const mockedPreview = useGeofenceRatePreview as unknown as ReturnType<typeof vi.fn>;
const mockedApply = useApplyGeofenceRate as unknown as ReturnType<typeof vi.fn>;

type PreviewQuery = UseQueryResult<GeofenceRateImpactPreview, Error>;

let applyMutate: ReturnType<typeof vi.fn>;
let applyReset: ReturnType<typeof vi.fn>;
let previewRefetch: ReturnType<typeof vi.fn>;

const rate: GeofenceRate = {
  id: 99,
  geofence_id: 7,
  rate_per_wh: 0.00012,
  currency: 'USD',
  effective_from: '2026-08-27T00:00:00Z',
  effective_to: null,
  created_at: '2026-08-27T00:00:00Z',
};

function makePreviewQuery(overrides: Partial<PreviewQuery> = {}): PreviewQuery {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: previewRefetch,
    ...overrides,
  } as unknown as PreviewQuery;
}

function makePreview(overrides: Partial<GeofenceRateImpactPreview> = {}): GeofenceRateImpactPreview {
  return {
    matched_sessions: 10,
    eligible_sessions: 6,
    protected_sessions: 4,
    total_energy_wh: 60_000,
    estimated_cost_decimal: 7.2,
    currency: 'USD',
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  applyMutate = vi.fn();
  applyReset = vi.fn();
  previewRefetch = vi.fn();
  mockedApply.mockReturnValue({ mutate: applyMutate, reset: applyReset, isPending: false, data: undefined });
  mockedPreview.mockReturnValue(makePreviewQuery({ data: makePreview() }));
});

// QueryError (rendered on the error path) calls useNavigate(), so every
// render needs a Router ancestor even for tests that never hit that path.
function renderPanel(props: { geofenceId: number; rate: GeofenceRate | null }) {
  return render(
    <MemoryRouter>
      <PreviewApplyPanel {...props} />
    </MemoryRouter>,
  );
}

describe('PreviewApplyPanel — no rate selected', () => {
  it('shows an empty state prompting the user to pick a rate, with no metrics rendered', () => {
    renderPanel({ geofenceId: 7, rate: null });

    expect(
      screen.getByText('Select a rate from the history table above to preview its impact.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Matched')).not.toBeInTheDocument();
  });
});

describe('PreviewApplyPanel — preview metrics', () => {
  it('renders matched/eligible/protected/energy/estimated-cost for the selected rate', () => {
    renderPanel({ geofenceId: 7, rate });

    expect(screen.getByText('Matched')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('Eligible')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText('Protected')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('60.0 kWh')).toBeInTheDocument();
    expect(screen.getByText('$7.20')).toBeInTheDocument();
  });

  it('shows a loading skeleton while the preview query is in flight', () => {
    mockedPreview.mockReturnValue(makePreviewQuery({ isLoading: true, data: undefined }));
    const { container } = renderPanel({ geofenceId: 7, rate });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('surfaces a QueryError with a working retry when the preview fails', () => {
    mockedPreview.mockReturnValue(makePreviewQuery({ isError: true, error: new Error('preview boom') }));
    renderPanel({ geofenceId: 7, rate });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(previewRefetch).toHaveBeenCalledTimes(1);
  });
});

describe('PreviewApplyPanel — narrowing the window', () => {
  it('re-queries the preview hook with the converted ISO from/to once both fields are set', () => {
    renderPanel({ geofenceId: 7, rate });

    fireEvent.change(screen.getByLabelText('Narrow from (optional)'), { target: { value: '2026-09-01T00:00' } });
    fireEvent.change(screen.getByLabelText('Narrow to (optional)'), { target: { value: '2026-10-01T00:00' } });

    const lastCall = mockedPreview.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(7);
    expect(lastCall?.[1]).toBe(99);
    expect(lastCall?.[2]).toEqual({
      from: new Date('2026-09-01T00:00').toISOString(),
      to: new Date('2026-10-01T00:00').toISOString(),
    });
  });

  it('clears a narrowed window and prior apply state when a different rate is selected', () => {
    const { rerender } = renderPanel({ geofenceId: 7, rate });
    fireEvent.change(screen.getByLabelText('Narrow from (optional)'), {
      target: { value: '2026-09-01T00:00' },
    });

    rerender(
      <MemoryRouter>
        <PreviewApplyPanel
          geofenceId={7}
          rate={{ ...rate, id: 100, effective_from: '2026-10-01T00:00:00Z' }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Narrow from (optional)')).toHaveValue('');
    expect(applyReset).toHaveBeenCalled();
  });
});

describe('PreviewApplyPanel — apply gating', () => {
  it('disables Apply when there are zero eligible sessions', () => {
    mockedPreview.mockReturnValue(makePreviewQuery({ data: makePreview({ eligible_sessions: 0 }) }));
    renderPanel({ geofenceId: 7, rate });

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('requires confirmation before calling the apply mutation', async () => {
    renderPanel({ geofenceId: 7, rate });

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    // The confirm dialog must appear before the mutation fires.
    await waitFor(() => expect(screen.getByText('Apply this rate to matching sessions?')).toBeInTheDocument());
    expect(applyMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole('button', { name: 'Apply' })[1]);
    await waitFor(() => expect(applyMutate).toHaveBeenCalledTimes(1));
    expect(applyMutate).toHaveBeenCalledWith({ geofenceId: 7, rateId: 99, from: undefined, to: undefined });
  });

  it('shows the applied result inline once the mutation has data', () => {
    mockedApply.mockReturnValue({
      mutate: applyMutate,
      reset: applyReset,
      isPending: false,
      data: { priced_sessions: 6, skipped_sessions: 4, total_cost_decimal: 7.2, currency: 'USD' } satisfies GeofenceRateApplyResult,
    });
    renderPanel({ geofenceId: 7, rate });

    expect(screen.getByText('Applied: 6 priced, 4 skipped, $7.20 total.')).toBeInTheDocument();
  });
});
