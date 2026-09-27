/**
 * DriveLedgerCompactPanel — Go nil nested ledgers must not crash.
 *
 * encoding/json marshals a nil *LongitudinalDynamics as JSON null. After
 * camelCaseKeys the field can also be missing (undefined). Accessing
 * `.regen_wh` on that value used to throw and trip the drive-detail
 * energy-ledger error boundary.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PhysicsLedger, PhysicsTerm } from '@/api/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useDriveLedgerMock } = vi.hoisted(() => ({
  useDriveLedgerMock: vi.fn(),
}));

vi.mock('@/api/hooks/usePhysicsLedger', () => ({
  useDriveLedger: useDriveLedgerMock,
}));

import { DriveLedgerCompactPanel } from './DriveLedgerCompactPanel';

function queryState(over: Record<string, unknown> = {}) {
  return {
    data: undefined,
    dataUpdatedAt: Date.now(),
    error: null,
    isError: false,
    isPending: false,
    isLoading: false,
    isFetching: false,
    isSuccess: true,
    status: 'success',
    fetchStatus: 'idle',
    refetch: vi.fn(),
    ...over,
  };
}

function ledgerStub(over: Partial<PhysicsLedger> = {}): PhysicsLedger {
  return {
    vehicle_id: 1,
    kind: 'drive',
    start: '2026-09-17T12:00:00Z',
    end: '2026-09-17T13:00:00Z',
    dynamics: null,
    drive: null,
    charge: null,
    park: null,
    thermal: null,
    range: null,
    tires: null,
    epochs: null,
    unknown_intervals: null,
    unknown_hours: 0,
    black_box: null,
    truncated: false,
    honesty: 'Predicted vs measured.',
    ...over,
  };
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <DriveLedgerCompactPanel driveId="393" />
    </MemoryRouter>,
  );
}

describe('DriveLedgerCompactPanel', () => {
  beforeEach(() => {
    useDriveLedgerMock.mockReset();
  });

  it('renders regen/friction as Unknown when dynamics is JSON null', () => {
    useDriveLedgerMock.mockReturnValue(queryState({ data: ledgerStub({ dynamics: null }) }));
    expect(() => renderPanel()).not.toThrow();
    expect(screen.getByTestId('drive-ledger-compact')).toBeInTheDocument();
    expect(screen.getByText(/Regen/)).toHaveTextContent(/Unknown/);
    expect(screen.getByText(/Friction brake/)).toHaveTextContent(/Unknown/);
  });

  it('does not crash when dynamics is omitted (undefined)', () => {
    const data = ledgerStub();
    delete (data as { dynamics?: PhysicsLedger['dynamics'] }).dynamics;
    useDriveLedgerMock.mockReturnValue(queryState({ data }));
    expect(() => renderPanel()).not.toThrow();
    expect(screen.getByTestId('drive-ledger-compact')).toBeInTheDocument();
    expect(screen.getByText(/Regen/)).toHaveTextContent(/Unknown/);
  });

  it('shows formatted regen when dynamics is present', () => {
    useDriveLedgerMock.mockReturnValue(
      queryState({
        data: ledgerStub({
          dynamics: {
            points: [],
            mass_kg: null,
            mass_source: 'unknown',
            regen_wh: 4880,
            friction_brake_wh: 0,
            unknown: false,
            honesty: 'Regen is pack charge current while moving.',
          },
        }),
      }),
    );
    renderPanel();
    expect(screen.getByText(/Regen/)).not.toHaveTextContent(/Unknown/);
  });

  it('explains why missing physical inputs cannot be replaced with estimates', () => {
    const missing: PhysicsTerm = { value_wh: null, method: 'unknown', unknown: true };
    useDriveLedgerMock.mockReturnValue(queryState({
      data: ledgerStub({
        drive: {
          measured_wh: { value_wh: 100, method: 'pack_vi_trapezoid', unknown: false },
          aero_wh: { value_wh: 30, method: 'half_rho_cda_v3', unknown: false },
          rolling_wh: missing,
          grade_wh: missing,
          inertial_wh: missing,
          accessory_wh: missing,
          drivetrain_loss_wh: missing,
          session_wh: null,
          reconcile_wh: null,
          predicted_wh: 30,
          unexplained_wh: null,
          unexplained_known: false,
          missing_signals: ['mass_kg', 'elevation', 'HVAC power (W)'],
          honesty: 'Unknown inputs stay unknown.',
        },
      }),
    }));
    renderPanel();
    expect(screen.getByText(/TESLASYNC_VEHICLE_MASS_KG/)).toBeInTheDocument();
    expect(screen.getByText(/recorded elevation/)).toBeInTheDocument();
    expect(screen.getByText(/HVAC on\/off state/)).toBeInTheDocument();
    expect(screen.getByText(/Unexplained residual/).parentElement).toHaveTextContent('Unknown');
  });
});
