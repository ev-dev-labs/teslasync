import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { DataStateSource } from '@/api/dataState';
import type { SecretRotationStatus } from '@/types/admin-operator-confidence';
import { useSecretRotationPage } from './useSecretRotationPage';

// The runtime can omit an age or return null despite the existing wire type.
type RuntimeStatus = Omit<SecretRotationStatus, 'age_days'> & {
  age_days?: number | null;
};
type FixtureQuery = DataStateSource<{ items: RuntimeStatus[] }> & {
  isLoading: boolean;
  refetch: () => unknown;
};

const { queryMock, refetch, fmtNumber } = vi.hoisted(() => ({
  queryMock: vi.fn<() => FixtureQuery>(),
  refetch: vi.fn(() => undefined),
  fmtNumber: vi.fn((value: number) => String(value)),
}));

vi.mock('@/api/hooks/useOperatorConfidence', () => ({
  useSecretRotation: queryMock,
}));
vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({ fmtNumber }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}));

function status(overrides: Partial<RuntimeStatus>): RuntimeStatus {
  return Object.freeze({
    kind: 'fixture-kind',
    last_rotated: '',
    warn_days: 30,
    critical_days: 60,
    severity: 'unknown',
    ...overrides,
  });
}

function renderWithItems(items: RuntimeStatus[]) {
  Object.freeze(items);
  const query: FixtureQuery = {
    data: { items },
    isLoading: false,
    isSuccess: true,
    fetchStatus: 'idle',
    refetch,
  };
  queryMock.mockReturnValue(query);
  return { ...renderHook(() => useSecretRotationPage()), query };
}

beforeEach(() => {
  queryMock.mockReset();
  refetch.mockClear();
});

describe('useSecretRotationPage oldest known age', () => {
  it('selects measured zero after unknown first rows without changing raw records or counts', () => {
    const unknownNull = status({ kind: 'fixture-null', age_days: null });
    const unknownOmitted = status({ kind: 'fixture-omitted', severity: 'warn' });
    const measuredZero = status({ kind: 'fixture-zero', age_days: 0, severity: 'ok' });
    const items = [unknownNull, unknownOmitted, measuredZero];
    const { result, query } = renderWithItems(items);

    expect(result.current.oldest).toBe(measuredZero);
    expect(result.current.oldest?.age_days).toBe(0);
    expect(result.current.items).toBe(items);
    expect(result.current.items).toEqual([unknownNull, unknownOmitted, measuredZero]);
    expect(result.current.items[0].age_days).toBeNull();
    expect(result.current.items[1]).not.toHaveProperty('age_days');
    expect(result.current.counts).toEqual({ ok: 1, warn: 1, critical: 0, unknown: 1 });
    expect(result.current.total).toBe(3);
    expect(result.current.distinctKinds).toBe(3);
    expect(result.current.okPct).toBe('33%');
    expect(result.current.query).toBe(query);
    expect(result.current.source.data).toBe(query.data);
  });

  it('returns null for unknown-only ages while retaining every raw row and severity', () => {
    const unknownNull = status({ kind: 'fixture-null', age_days: null, severity: 'critical' });
    const unknownOmitted = status({ kind: 'fixture-omitted' });
    const items = [unknownNull, unknownOmitted];
    const { result } = renderWithItems(items);

    expect(result.current.oldest).toBeNull();
    expect(result.current.items).toBe(items);
    expect(result.current.items).toEqual([unknownNull, unknownOmitted]);
    expect(result.current.items[0].age_days).toBeNull();
    expect(result.current.items[1]).not.toHaveProperty('age_days');
    expect(result.current.counts).toEqual({ ok: 0, warn: 0, critical: 1, unknown: 1 });
    expect(result.current.total).toBe(2);
    expect(result.current.source.hasData).toBe(true);
    expect(result.current.source.status).toBe('ok');
  });

  it('selects the greatest known age while preserving raw order, rankings, expiry and callbacks', () => {
    const unknown = status({ kind: 'fixture-unknown', age_days: null });
    const younger = status({ kind: 'fixture-younger', age_days: 7, severity: 'ok' });
    const oldest = status({
      kind: 'fixture-oldest',
      age_days: 42,
      severity: 'critical',
      expires_at: '2026-01-10T00:00:00Z',
      days_to_expiry: -2,
    });
    const zero = status({ kind: 'fixture-zero', age_days: 0, severity: 'ok' });
    const middle = status({ kind: 'fixture-middle', age_days: 11, severity: 'warn' });
    const items = [unknown, younger, oldest, zero, middle];
    const { result, query } = renderWithItems(items);

    expect(result.current.oldest).toBe(oldest);
    expect(result.current.oldest?.age_days).toBe(42);
    expect(result.current.items).toBe(items);
    expect(result.current.items).toEqual([unknown, younger, oldest, zero, middle]);
    expect(result.current.items.map(row => row.age_days)).toEqual([null, 7, 42, 0, 11]);
    expect(result.current.counts).toEqual({ ok: 2, warn: 1, critical: 1, unknown: 1 });
    expect(result.current.topByAge.map(row => row.kind)).toEqual([
      'fixture-oldest', 'fixture-middle', 'fixture-younger', 'fixture-unknown', 'fixture-zero',
    ]);
    expect(result.current.urgency.map(({ r, ratio }) => ({ kind: r.kind, ratio }))).toEqual([
      { kind: 'fixture-oldest', ratio: 42 / 60 },
      { kind: 'fixture-middle', ratio: 11 / 60 },
      { kind: 'fixture-younger', ratio: 7 / 60 },
      { kind: 'fixture-unknown', ratio: 0 },
      { kind: 'fixture-zero', ratio: 0 },
    ]);
    expect(result.current.soonestExpiry).toBe(oldest);
    expect(result.current.expiryWatch).toEqual([oldest]);
    expect(result.current.source.data).toBe(query.data);
    expect(result.current.source.status).toBe('ok');
    expect(result.current.showError).toBe(false);
    expect(result.current.subsystemMissing).toBe(false);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.fmtNumber).toBe(fmtNumber);
    expect(result.current.rowLabel(younger)).toBe('fixture-younger');
    result.current.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
