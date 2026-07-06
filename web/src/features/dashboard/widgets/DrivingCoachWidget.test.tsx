/**
 * DrivingCoachWidget — behaviour, branch, null-safety and a11y coverage for the
 * dashboard's efficiency-coaching widget.
 *
 * What this file pins:
 *   - the exported pure helper `computeSavingsPct` — the current-vs-best
 *     efficiency ratio, its rounding, and every guard: divide-by-zero (no
 *     drives), a missing/zero baseline that must NOT read as a bogus "100%",
 *     the negative → 0 clamp, and null/undefined/NaN inputs;
 *   - the widget's data-source resolution (explicit `vehicleId` prop vs. the
 *     first fleet vehicle vs. an empty fleet → `undefined` so the coach query
 *     stays disabled), including the number → string coercion;
 *   - every render state fanned out by `WidgetShell` — loading skeleton, the
 *     QueryError panel on failure, and the empty tips state (never a blank
 *     panel: the score header still renders);
 *   - the populated full-size widget — score, "/ 100" label, the "Potential
 *     savings" badge, the recommendation cards (title / tip / impact badge),
 *     the 3-card cap, and the badge being hidden when there is no headroom;
 *   - null-safety — a recommendation missing category/tip/impact renders em
 *     dashes and no `undefined` leaks to the DOM;
 *   - the compact (1×1) variant — score + savings badge, title-less, with its
 *     own empty state;
 *   - a11y — the decorative lightbulb icons are hidden from the a11y tree and
 *     the freshness Refresh control exposes an accessible name that wires back
 *     to `refetch`.
 *
 * Strategy: the two data hooks (`useDrivingCoach`, `useVehicles`) are mocked so
 * no network is touched and every query state is controllable per-test. i18n is
 * a passthrough that honours the English default and interpolates `{{pct}}`, so
 * the visible copy is deterministic and real. The widget is rendered inside a
 * MemoryRouter because the shared `QueryError` panel (surfaced on the error
 * branch) calls `useNavigate()`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { DrivingCoachData, CoachRecommendation } from '@/types/driving';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default and interpolates {{var}} tokens
// so the savings copy ("Potential savings: 25%") is asserted as a real string.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useDrivingCoachMock, useVehiclesMock } = vi.hoisted(() => ({
  useDrivingCoachMock: vi.fn(),
  useVehiclesMock: vi.fn(),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrivingCoach: (...args: unknown[]) => useDrivingCoachMock(...args),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

import DrivingCoachWidget, { computeSavingsPct } from './DrivingCoachWidget';

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRec(over: Partial<CoachRecommendation> = {}): CoachRecommendation {
  return {
    category: 'Smooth acceleration',
    impact: 'high',
    tip: 'Ease off the accelerator pedal',
    ...over,
  };
}

function makeCoachData(over: Partial<DrivingCoachData> = {}): DrivingCoachData {
  return {
    overall_score: 82,
    efficiency_wh_km: 200,
    best_efficiency_wh_km: 150,
    total_drives_analyzed: 12,
    style_breakdown: {},
    patterns: {
      hard_accel_pct: 0,
      hard_brake_pct: 0,
      highway_pct: 0,
      short_trip_pct: 0,
      cold_start_pct: 0,
    },
    weekly_trend: [],
    recommendations: [],
    per_drive_scores: [],
    ...over,
  };
}

interface CoachResult {
  data: DrivingCoachData | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeResult(over: Partial<CoachResult> = {}): CoachResult {
  return {
    data: makeCoachData(),
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <DrivingCoachWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useDrivingCoachMock.mockReset();
  useVehiclesMock.mockReset();
  useVehiclesMock.mockReturnValue({ data: [] });
  useDrivingCoachMock.mockReturnValue(makeResult());
});

// ── Pure helper: computeSavingsPct ───────────────────────────────────────────

describe('computeSavingsPct', () => {
  it('computes the rounded improvement from current vs. best efficiency', () => {
    expect(computeSavingsPct(200, 150)).toBe(25);
    expect(computeSavingsPct(300, 200)).toBe(33); // 33.33… rounds to 33
  });

  it('returns 0 when current efficiency is missing or non-positive (no divide-by-zero)', () => {
    expect(computeSavingsPct(0, 150)).toBe(0);
    expect(computeSavingsPct(-10, 150)).toBe(0);
    expect(computeSavingsPct(undefined, 150)).toBe(0);
  });

  it('returns 0 for a missing/zero baseline instead of a misleading 100%', () => {
    expect(computeSavingsPct(200, 0)).toBe(0);
    expect(computeSavingsPct(200, undefined)).toBe(0);
    expect(computeSavingsPct(200, null)).toBe(0);
  });

  it('clamps a run that already beats the recorded best to 0, not a negative', () => {
    expect(computeSavingsPct(150, 200)).toBe(0);
  });

  it('is NaN-safe on either input', () => {
    expect(computeSavingsPct(NaN, 150)).toBe(0);
    expect(computeSavingsPct(200, NaN)).toBe(0);
  });
});

// ── Data-source resolution ───────────────────────────────────────────────────

describe('DrivingCoachWidget — vehicle resolution', () => {
  it('queries the coach for the explicit vehicleId prop (stringified)', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 9 }] });
    renderWidget({ cols: 2, rows: 2 }, 42);
    expect(useDrivingCoachMock).toHaveBeenCalledWith('42');
  });

  it('falls back to the first fleet vehicle when no vehicleId prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget();
    expect(useDrivingCoachMock).toHaveBeenCalledWith('7');
  });

  it('passes undefined (query disabled) when the fleet is empty', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget();
    expect(useDrivingCoachMock).toHaveBeenCalledWith(undefined);
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('DrivingCoachWidget — states', () => {
  it('renders a loading skeleton while the coach query is pending', () => {
    useDrivingCoachMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Driving Coach')).toBeNull();
    expect(screen.queryByText('/ 100')).toBeNull();
  });

  it('surfaces a QueryError panel (never a blank widget) on failure', () => {
    useDrivingCoachMock.mockReturnValue(
      makeResult({ isError: true, error: new Error('boom'), data: undefined }),
    );
    renderWidget();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // The populated content must not render behind the error panel.
    expect(screen.queryByText('/ 100')).toBeNull();
  });

  it('shows the empty tips state but keeps the score header when there are no recommendations', () => {
    useDrivingCoachMock.mockReturnValue(
      makeResult({
        data: makeCoachData({
          recommendations: [],
          efficiency_wh_km: 0,
          best_efficiency_wh_km: 0,
        }),
      }),
    );
    renderWidget();
    expect(screen.getByText('No tips available')).toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();
    expect(screen.queryByText(/Potential savings/)).toBeNull();
  });
});

// ── Populated (full size) ────────────────────────────────────────────────────

describe('DrivingCoachWidget — populated (full size)', () => {
  it('renders the score, the savings badge and the recommendation card', () => {
    useDrivingCoachMock.mockReturnValue(
      makeResult({
        data: makeCoachData({
          overall_score: 82,
          efficiency_wh_km: 200,
          best_efficiency_wh_km: 150,
          recommendations: [
            makeRec({ category: 'Smooth acceleration', tip: 'Ease off the pedal', impact: 'high' }),
          ],
        }),
      }),
    );
    renderWidget();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.getByText('/ 100')).toBeInTheDocument();
    expect(screen.getByText('Potential savings: 25%')).toBeInTheDocument();
    expect(screen.getByText('Smooth acceleration')).toBeInTheDocument();
    expect(screen.getByText('Ease off the pedal')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });

  it('caps the recommendation list at three cards', () => {
    const recs = Array.from({ length: 6 }, (_, i) =>
      makeRec({ category: `Category ${i}`, tip: `Tip number ${i}`, impact: 'low' }),
    );
    useDrivingCoachMock.mockReturnValue(
      makeResult({ data: makeCoachData({ recommendations: recs }) }),
    );
    renderWidget();
    expect(screen.getByText('Category 0')).toBeInTheDocument();
    expect(screen.getByText('Category 2')).toBeInTheDocument();
    expect(screen.queryByText('Category 3')).toBeNull();
    expect(screen.queryByText('Category 5')).toBeNull();
  });

  it('hides the savings badge when there is no improvement headroom', () => {
    useDrivingCoachMock.mockReturnValue(
      makeResult({
        data: makeCoachData({ efficiency_wh_km: 150, best_efficiency_wh_km: 150 }),
      }),
    );
    renderWidget();
    expect(screen.queryByText(/Potential savings/)).toBeNull();
  });

  it('falls back to em dashes for a recommendation with missing fields (no undefined leak)', () => {
    const partial = {
      category: undefined,
      tip: undefined,
      impact: undefined,
    } as unknown as CoachRecommendation;
    useDrivingCoachMock.mockReturnValue(
      makeResult({ data: makeCoachData({ recommendations: [partial] }) }),
    );
    renderWidget();
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(2); // title + description
    expect(screen.queryByText('undefined')).toBeNull();
  });

  it('refetches when the freshness Refresh control is activated', () => {
    const refetch = vi.fn();
    useDrivingCoachMock.mockReturnValue(makeResult({ refetch }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Compact (1×1) variant ────────────────────────────────────────────────────

describe('DrivingCoachWidget — compact (1×1)', () => {
  it('renders the score and savings badge without the widget title or "/ 100"', () => {
    useDrivingCoachMock.mockReturnValue(
      makeResult({
        data: makeCoachData({
          overall_score: 91,
          efficiency_wh_km: 200,
          best_efficiency_wh_km: 150,
        }),
      }),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('91')).toBeInTheDocument();
    expect(screen.getByText('Potential savings: 25%')).toBeInTheDocument();
    expect(screen.queryByText('Driving Coach')).toBeNull();
    expect(screen.queryByText('/ 100')).toBeNull();
  });

  it('shows the compact empty state when there is no coaching data', () => {
    useDrivingCoachMock.mockReturnValue(
      makeResult({
        data: makeCoachData({
          overall_score: 0,
          recommendations: [],
          efficiency_wh_km: 0,
          best_efficiency_wh_km: 0,
        }),
      }),
    );
    renderWidget({ cols: 1, rows: 1 });
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('No tips available')).toBeInTheDocument();
  });
});

// ── Accessibility ────────────────────────────────────────────────────────────

describe('DrivingCoachWidget — accessibility', () => {
  it('marks the decorative lightbulb icons as aria-hidden', () => {
    useDrivingCoachMock.mockReturnValue(
      makeResult({ data: makeCoachData({ recommendations: [makeRec()] }) }),
    );
    const { container } = renderWidget();
    // Header icon + tip-card icon are decorative and hidden from assistive tech.
    expect(
      container.querySelectorAll('svg[aria-hidden="true"]').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('exposes the freshness Refresh control with an accessible name', () => {
    useDrivingCoachMock.mockReturnValue(makeResult());
    renderWidget();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });
});
