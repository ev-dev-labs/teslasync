/**
 * PlaceDetailPanel — the per-place detail workspace (Modal + Tabs) wiring
 * rate history / add-a-rate / preview-apply / charging-activity for ONE
 * geofence, plus archive/unarchive/mark-reviewed lifecycle actions.
 *
 * The five content panels (RateForm, RateHistoryPanel, PreviewApplyPanel,
 * ChargingSummaryPanel, ChargingActivityList) each carry their own
 * dedicated test suite — here they are replaced with prop-echoing stubs so
 * these tests stay focused on PlaceDetailPanel's OWN contract: which panel
 * renders under which tab, the auto-select-open-rate behaviour, delete
 * wiring, and the archive/unarchive/mark-reviewed lifecycle buttons.
 *
 * Coverage:
 *   1. Renders nothing when `place` is null.
 *   2. Modal title uses the place name (with "Unnamed place" fallback).
 *   3. "Needs review" badge + "Mark reviewed" only when `needs_review`;
 *      clicking invokes the mutation with the place id.
 *   4. Archive/Restore toggle based on `archived_at`; clicking invokes the
 *      matching mutation with the place id.
 *   5. Tab switching: "Rates & Pricing" (default) shows RateForm/
 *      RateHistoryPanel/PreviewApplyPanel; "Charging Activity" shows
 *      ChargingSummaryPanel/ChargingActivityList.
 *   6. Auto-selects the rate active now. A future open-ended schedule is
 *      available for preview but is not passed to RateForm as current.
 *   7. RateHistoryPanel's onDelete wiring calls the delete mutation with
 *      `{ geofenceId, rateId }`.
 *   8. Selecting a different rate from history feeds PreviewApplyPanel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        if (typeof fallback !== 'string') return key;
        return fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
          String(options?.[name] ?? `{{${name}}}`),
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofenceRates: vi.fn(),
  useDeleteGeofenceRate: vi.fn(),
  useArchiveGeofence: vi.fn(),
  useUnarchiveGeofence: vi.fn(),
  useMarkGeofenceReviewed: vi.fn(),
  useGeofenceChargingSummary: vi.fn(),
  useRenameGeofence: vi.fn(),
  useUpdateGeofenceCategory: vi.fn(),
}));

vi.mock('@/components/feedback/Toast', () => {
  const toast = {
    toast: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    dismiss: vi.fn(),
  };
  return {
    useToast: () => toast,
    useOptionalToast: () => toast,
  };
});

vi.mock('./RateForm', () => ({
  RateForm: ({ geofenceId, currentRate }: { geofenceId: number; currentRate?: { id: number } | null }) => (
    <div data-testid="stub-rate-form">{`RateForm geofenceId=${geofenceId} currentRate=${currentRate?.id ?? 'none'}`}</div>
  ),
}));

vi.mock('./RateHistoryPanel', () => ({
  RateHistoryPanel: ({
    rates,
    selectedRateId,
    onSelectRate,
    onDelete,
  }: {
    rates?: { id: number }[];
    selectedRateId?: number | null;
    onSelectRate: (r: { id: number }) => void;
    onDelete: (r: { id: number }) => void;
  }) => (
    <div data-testid="stub-rate-history">
      {`RateHistoryPanel rates=${rates?.length ?? 0} selected=${selectedRateId ?? 'none'}`}
      <a href="#select-second-rate" onClick={() => rates?.[1] && onSelectRate(rates[1])}>stub-select-second-rate</a>
      <a href="#delete-first-rate" onClick={() => rates?.[0] && onDelete(rates[0])}>stub-delete-first-rate</a>
    </div>
  ),
}));

vi.mock('./PreviewApplyPanel', () => ({
  PreviewApplyPanel: ({ geofenceId, rate }: { geofenceId: number; rate: { id: number } | null }) => (
    <div data-testid="stub-preview-apply">{`PreviewApplyPanel geofenceId=${geofenceId} rate=${rate?.id ?? 'none'}`}</div>
  ),
}));

vi.mock('./ChargingSummaryPanel', () => ({
  ChargingSummaryPanel: ({ summary }: { summary?: unknown[] }) => (
    <div data-testid="stub-summary">{`ChargingSummaryPanel rows=${summary?.length ?? 0}`}</div>
  ),
}));

vi.mock('./ChargingActivityList', () => ({
  ChargingActivityList: ({ geofenceId }: { geofenceId: number }) => (
    <div data-testid="stub-activity">{`ChargingActivityList geofenceId=${geofenceId}`}</div>
  ),
}));

import {
  useGeofenceRates,
  useDeleteGeofenceRate,
  useArchiveGeofence,
  useUnarchiveGeofence,
  useMarkGeofenceReviewed,
  useGeofenceChargingSummary,
  useRenameGeofence,
  useUpdateGeofenceCategory,
} from '@/api/hooks/useLocations';
import { PlaceDetailPanel } from './PlaceDetailPanel';
import type { Geofence, GeofenceRate } from '@/api/types';

const mockedRates = useGeofenceRates as unknown as ReturnType<typeof vi.fn>;
const mockedDeleteRate = useDeleteGeofenceRate as unknown as ReturnType<typeof vi.fn>;
const mockedArchive = useArchiveGeofence as unknown as ReturnType<typeof vi.fn>;
const mockedUnarchive = useUnarchiveGeofence as unknown as ReturnType<typeof vi.fn>;
const mockedMarkReviewed = useMarkGeofenceReviewed as unknown as ReturnType<typeof vi.fn>;
const mockedSummary = useGeofenceChargingSummary as unknown as ReturnType<typeof vi.fn>;
const mockedRename = useRenameGeofence as unknown as ReturnType<typeof vi.fn>;
const mockedUpdateCategory = useUpdateGeofenceCategory as unknown as ReturnType<typeof vi.fn>;

let deleteMutate: ReturnType<typeof vi.fn>;
let archiveMutate: ReturnType<typeof vi.fn>;
let unarchiveMutate: ReturnType<typeof vi.fn>;
let markReviewedMutate: ReturnType<typeof vi.fn>;
let renameMutateAsync: ReturnType<typeof vi.fn>;
let categoryMutate: ReturnType<typeof vi.fn>;

function makePlace(overrides: Partial<Geofence> = {}): Geofence {
  return {
    id: 7,
    name: 'Home',
    polygon_wkt: 'POLYGON((0 0,0 0,0 0,0 0))',
    category: 'home',
    enabled: true,
    alert_on_entry: false,
    alert_on_exit: false,
    origin: 'manual',
    needs_review: false,
    archived_at: null,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    latitude: 40,
    longitude: -74,
    radius: 50,
    ...overrides,
  };
}

function makeRate(overrides: Partial<GeofenceRate> = {}): GeofenceRate {
  return {
    id: 1,
    geofence_id: 7,
    rate_per_wh: 0.0001,
    currency: 'USD',
    effective_from: '2020-01-01T00:00:00Z',
    effective_to: null,
    created_at: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  deleteMutate = vi.fn();
  archiveMutate = vi.fn();
  unarchiveMutate = vi.fn();
  markReviewedMutate = vi.fn();
  renameMutateAsync = vi.fn().mockResolvedValue(undefined);
  categoryMutate = vi.fn();

  mockedRates.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  mockedSummary.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  mockedDeleteRate.mockReturnValue({ mutate: deleteMutate, isPending: false });
  mockedArchive.mockReturnValue({ mutate: archiveMutate, isPending: false });
  mockedUnarchive.mockReturnValue({ mutate: unarchiveMutate, isPending: false });
  mockedMarkReviewed.mockReturnValue({ mutate: markReviewedMutate, isPending: false });
  mockedRename.mockReturnValue({ mutateAsync: renameMutateAsync, isPending: false });
  mockedUpdateCategory.mockReturnValue({ mutate: categoryMutate, isPending: false });
});

describe('PlaceDetailPanel — closed state', () => {
  it('renders nothing when place is null', () => {
    const { container } = render(<PlaceDetailPanel place={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('PlaceDetailPanel — header', () => {
  it('titles the modal with the place name', () => {
    render(<PlaceDetailPanel place={makePlace({ name: 'Costco Supercharger' })} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Costco Supercharger' }),
    ).toBeInTheDocument();
  });

  it('falls back to "Unnamed place" when the name is empty', () => {
    render(<PlaceDetailPanel place={makePlace({ name: '' })} onClose={vi.fn()} />);
    expect(screen.getByText('Unnamed place')).toBeInTheDocument();
  });

  it('stacks the place-name label and editor using the same field rhythm as Category', () => {
    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);

    const label = screen.getByText('Place name');
    const editor = screen.getByRole('button', { name: 'Rename Home' });

    expect(label).toHaveClass('block');
    expect(label.parentElement).toHaveClass('space-y-1');
    expect(editor.parentElement).toHaveClass('min-h-10', 'items-center');
  });

  it('renames the place through the canonical geofence mutation', async () => {
    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Rename Home' }));
    const input = screen.getByRole('textbox', { name: 'Rename Home' });
    fireEvent.change(input, { target: { value: 'Office Charger' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(renameMutateAsync).toHaveBeenCalledWith({
        geofenceId: 7,
        name: 'Office Charger',
      }),
    );
  });

  it('updates the category without resending place geometry', () => {
    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: 'work' },
    });

    expect(categoryMutate).toHaveBeenCalledWith(
      { geofenceId: 7, category: 'work' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });
});

describe('PlaceDetailPanel — needs-review lifecycle', () => {
  it('shows the needs-review badge and Mark reviewed button when needs_review is true', () => {
    render(<PlaceDetailPanel place={makePlace({ needs_review: true })} onClose={vi.fn()} />);
    expect(screen.getByText('Needs review')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark reviewed' })).toBeInTheDocument();
  });

  it('omits the needs-review badge/button when needs_review is false', () => {
    render(<PlaceDetailPanel place={makePlace({ needs_review: false })} onClose={vi.fn()} />);
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
  });

  it('calls the mark-reviewed mutation with the place id when clicked', () => {
    render(<PlaceDetailPanel place={makePlace({ id: 42, needs_review: true })} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mark reviewed' }));
    expect(markReviewedMutate).toHaveBeenCalledWith(42);
  });
});

describe('PlaceDetailPanel — archive lifecycle', () => {
  it('shows an Archive button for an active place and calls the archive mutation with its id', () => {
    const onClose = vi.fn();
    archiveMutate.mockImplementation((_id, options) => options?.onSuccess?.());
    render(<PlaceDetailPanel place={makePlace({ id: 5, archived_at: null })} onClose={onClose} />);
    const btn = screen.getByRole('button', { name: 'Archive' });
    fireEvent.click(btn);
    expect(archiveMutate).toHaveBeenCalledWith(5, expect.objectContaining({ onSuccess: onClose }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('shows a Restore button for an archived place and calls the unarchive mutation with its id', () => {
    render(<PlaceDetailPanel place={makePlace({ id: 5, archived_at: '2026-06-01T00:00:00Z' })} onClose={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Restore' });
    fireEvent.click(btn);
    expect(unarchiveMutate).toHaveBeenCalledWith(5);
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
  });
});

describe('PlaceDetailPanel — tabs', () => {
  it('defaults to the Rates & Pricing tab, showing rate form/history/preview panels', () => {
    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);

    expect(screen.getByTestId('stub-rate-form')).toBeInTheDocument();
    expect(screen.getByTestId('stub-rate-history')).toBeInTheDocument();
    expect(screen.getByTestId('stub-preview-apply')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-summary')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-activity')).not.toBeInTheDocument();
  });

  it('switches to the Charging Activity tab, showing summary/activity panels', () => {
    render(<PlaceDetailPanel place={makePlace({ id: 11 })} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Charging Activity' }));

    expect(screen.getByTestId('stub-summary')).toBeInTheDocument();
    expect(screen.getByTestId('stub-activity')).toHaveTextContent('geofenceId=11');
    expect(screen.queryByTestId('stub-rate-form')).not.toBeInTheDocument();
  });
});

describe('PlaceDetailPanel — rate selection', () => {
  it('prefers the rate active now over a future open-ended schedule', () => {
    mockedRates.mockReturnValue({
      data: [
        makeRate({
          id: 1,
          effective_from: '2020-01-01T00:00:00Z',
          effective_to: '2021-01-01T00:00:00Z',
        }),
        makeRate({
          id: 2,
          effective_from: '2099-01-01T00:00:00Z',
          effective_to: null,
        }),
        makeRate({
          id: 3,
          effective_from: '2021-01-01T00:00:00Z',
          effective_to: '2098-01-01T00:00:00Z',
        }),
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);

    expect(screen.getByTestId('stub-rate-form')).toHaveTextContent('currentRate=3');
    expect(screen.getByTestId('stub-preview-apply')).toHaveTextContent('rate=3');
  });

  it('previews a future schedule without treating it as the current rate', () => {
    mockedRates.mockReturnValue({
      data: [makeRate({ id: 2, effective_from: '2099-01-01T00:00:00Z', effective_to: null })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);

    expect(screen.getByTestId('stub-rate-form')).toHaveTextContent('currentRate=none');
    expect(screen.getByTestId('stub-preview-apply')).toHaveTextContent('rate=2');
  });

  it('does not auto-select a rate when all intervals are historical', () => {
    mockedRates.mockReturnValue({
      data: [makeRate({ id: 1, effective_to: '2021-01-01T00:00:00Z' })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);

    expect(screen.getByTestId('stub-rate-form')).toHaveTextContent('currentRate=none');
    expect(screen.getByTestId('stub-preview-apply')).toHaveTextContent('rate=none');
  });

  it('feeds a manually-selected rate from history into PreviewApplyPanel', () => {
    mockedRates.mockReturnValue({
      data: [makeRate({ id: 1, effective_to: '2026-08-27T00:00:00Z' }), makeRate({ id: 2, effective_to: null })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('stub-select-second-rate'));

    expect(screen.getByTestId('stub-preview-apply')).toHaveTextContent('rate=2');
  });

  it('scrolls and focuses the pricing preview when a rate is selected', () => {
    mockedRates.mockReturnValue({
      data: [
        makeRate({ id: 1, effective_to: '2026-08-27T00:00:00Z' }),
        makeRate({ id: 2, effective_to: null }),
      ],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        callback(0);
        return 1;
      });

    render(<PlaceDetailPanel place={makePlace()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    const scrollBody = dialog.querySelector<HTMLElement>('[data-modal-scroll-body="true"]');
    const previewRegion = screen.getByRole('region', { name: 'Session pricing preview' });
    expect(scrollBody).not.toBeNull();

    const scrollTo = vi.fn();
    Object.defineProperty(scrollBody, 'scrollTop', { configurable: true, value: 20 });
    Object.defineProperty(scrollBody, 'scrollTo', { configurable: true, value: scrollTo });
    vi.spyOn(scrollBody as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 100,
      top: 100,
      right: 600,
      bottom: 700,
      left: 0,
      width: 600,
      height: 600,
      toJSON: () => ({}),
    });
    vi.spyOn(previewRegion, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 500,
      top: 500,
      right: 600,
      bottom: 700,
      left: 0,
      width: 600,
      height: 200,
      toJSON: () => ({}),
    });

    fireEvent.click(screen.getByText('stub-select-second-rate'));

    expect(scrollTo).toHaveBeenCalledWith({ top: 404, behavior: 'smooth' });
    expect(document.activeElement).toBe(previewRegion);
    requestAnimationFrameSpy.mockRestore();
  });

  it('wires RateHistoryPanel\'s onDelete to the delete mutation with {geofenceId, rateId}', () => {
    mockedRates.mockReturnValue({
      data: [makeRate({ id: 3 })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<PlaceDetailPanel place={makePlace({ id: 77 })} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('stub-delete-first-rate'));

    expect(deleteMutate).toHaveBeenCalledWith({ geofenceId: 77, rateId: 3 });
  });
});
