import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { RepairCase } from '@/api/hooks/useDataRepair';
import english from '@/i18n/en.json';
import { RepairCaseQueue } from './RepairCaseQueue';

const tableProps = vi.hoisted(() => ({ enableValueFilters: undefined as boolean | undefined }));

vi.mock('react-i18next', async (importActual) =>
  await importActual<typeof import('react-i18next')>());

vi.mock('@/components/ui', async (importActual) => {
  const actual = await importActual<typeof import('@/components/ui')>();
  return {
    ...actual,
    DataTable: (props: ComponentProps<typeof actual.DataTable>) => {
      tableProps.enableValueFilters = props.enableValueFilters;
      return <actual.DataTable {...props} />;
    },
  };
});

function props(): ComponentProps<typeof RepairCaseQueue> {
  return {
    cases: [],
    filters: { limit: 50 },
    selectedCaseIds: [],
    loading: false,
    hasData: true,
    error: null,
    hasMore: true,
    hasPrevious: false,
    onFiltersChange: vi.fn(),
    onSelectionChange: vi.fn(),
    onOpenCase: vi.fn(),
    onPrevious: vi.fn(),
    onNext: vi.fn(),
    onRetry: vi.fn(),
    onBeginReview: vi.fn(),
    onDismiss: vi.fn(),
  };
}

function renderQueue(options: ComponentProps<typeof RepairCaseQueue>, localizedLabel?: string) {
  const i18n = createInstance();
  void i18n.init({
    lng: localizedLabel ? 'ar' : 'en',
    fallbackLng: 'en',
    initAsync: false,
    resources: {
      en: { translation: { dataRepair: english.dataRepair } },
      ...(localizedLabel ? {
        ar: { translation: { dataRepair: { confidence: { high: localizedLabel } } } },
      } : {}),
    },
    interpolation: { escapeValue: false },
  });
  return render(<I18nextProvider i18n={i18n}><RepairCaseQueue {...options} /></I18nextProvider>);
}

function caseWith(confidence: RepairCase['confidence']): RepairCase {
  return {
    id: 7, fingerprint: 'drive:42:drive_open_charging_started', kind: 'drive',
    session_id: 42, vehicle_id: 3, rule: 'drive_open_charging_started',
    confidence, status: 'open', applicable: false, assigned_to: 'Review operator',
    blocked_reason: 'overlaps_next_session',
    evidence_started_at: '2026-08-25T09:00:00Z',
    evidence_contradiction_ts: '2026-08-25T10:00:00Z',
    evidence_contradiction_src: 'charging_sessions',
    evidence_contradiction_field: 'energy_used_wh',
    evidence_contradiction_value: '-1.00123456789',
    evidence_gap_s: 120.125,
    first_seen_at: '2026-08-25T10:01:00Z', last_seen_at: '2026-08-25T10:02:00Z',
    created_at: '2026-08-25T10:01:00Z', updated_at: '2026-08-25T10:02:00Z',
  };
}

beforeEach(() => {
  window.localStorage.clear();
  tableProps.enableValueFilters = undefined;
});

describe('RepairCaseQueue table ownership', () => {
  it('explicitly retains server filtering and cursor navigation rather than filtering a partial page', () => {
    const options = props();
    renderQueue(options);
    expect(tableProps.enableValueFilters).toBe(false);
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(options.onNext).toHaveBeenCalledOnce();
    expect(options.onPrevious).not.toHaveBeenCalled();
    expect(screen.getByText('No repair cases match these filters.')).toBeInTheDocument();
  });
});

describe('RepairCaseQueue confidence semantics', () => {
  it.each(['high', 'medium'] as const)('renders canonical %s confidence neutrally without changing findings or review actions', (confidence) => {
    const item = caseWith(confidence);
    const options = { ...props(), cases: [item] };
    const original = structuredClone(item);
    renderQueue(options);
    const label = english.dataRepair.confidence[confidence];
    const cell = screen.getAllByRole('cell').find((element) => element.textContent === label);
    expect(cell).toBeDefined();
    const badge = within(cell!).getByText(label);
    expect(badge.textContent).toBe(label);
    expect(badge).toHaveClass('bg-[var(--surface-2)]', 'text-[var(--text-secondary)]');
    expect(badge.className).not.toMatch(/semantic-(success|danger|warning)/);
    expect(screen.getByRole('columnheader', { name: 'Confidence' })).toBeInTheDocument();
    expect(screen.getByText(english.dataRepair.blocked.overlapsNextSession)).toBeInTheDocument();
    expect(screen.getAllByText(english.dataRepair.cases.status.open).length).toBeGreaterThan(0);
    expect(screen.getByText('Review operator')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review case 7' }));
    expect(options.onOpenCase).toHaveBeenCalledExactlyOnceWith(7);
    expect(item).toEqual(original);
    expect(tableProps.enableValueFilters).toBe(false);
  });

  it('uses the translated complete confidence label with neutral roles and preserves selected-row bulk controls', () => {
    const label = 'ثقة عالية';
    const options = { ...props(), cases: [caseWith('high')], selectedCaseIds: [7] };
    renderQueue(options, label);
    const cell = screen.getAllByRole('cell').find((element) => element.textContent === label);
    const badge = within(cell!).getByText(label);
    expect(badge.textContent).toBe(label);
    expect(badge).toHaveClass('text-[var(--text-secondary)]');
    fireEvent.click(screen.getByRole('button', { name: 'Begin review' }));
    expect(options.onBeginReview).toHaveBeenCalledExactlyOnceWith([7]);
    expect(screen.getByRole('button', { name: 'Dismiss selected' })).toHaveClass('text-[var(--semantic-danger)]');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss selected' }));
    expect(options.onDismiss).toHaveBeenCalledExactlyOnceWith([7]);
  });
});
