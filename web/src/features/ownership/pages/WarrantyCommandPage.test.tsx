/**
 * WarrantyCommandPage — confirm-gated warranty deletion.
 *
 * Removing a warranty is destructive (claims go with it), so the row Remove
 * button must open a danger confirm dialog naming the coverage instead of
 * firing the mutation directly. Only the data hooks, vehicle selection, and
 * i18n are mocked; the table, buttons, and confirm dialog render for real.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const translations = vi.hoisted(() => ({} as Record<string, string>));

vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (translations[key] !== undefined) return translations[key];
    if (typeof second === 'string') {
      return interpolate(second, third as Record<string, unknown> | undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

describe('WarrantyCommandPage — mobile table preservation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(target: Element) {
        this.callback([{ target, contentRect: { width: 375 } } as ResizeObserverEntry], this);
      }
      unobserve() {}
      disconnect() {}
    });
    const overview = makeOverview();
    overview.coverages[0].readiness = [{
      code: 'receipt', label: 'Service receipt', satisfied: false,
      detail: 'Full service receipt detail remains available.', severity: 'high',
    }];
    mockOverview.mockReturnValue(makeQuery(overview));
  });

  afterEach(() => vi.unstubAllGlobals());

  it('exposes every checklist, coverage and claim field in keyboard-reachable details', async () => {
    const user = userEvent.setup();
    renderPage();
    const checklist = within(card('Claim readiness checklist'));
    const quickView = checklist.getByRole('button', { name: 'Quick view' });
    quickView.focus();
    await user.keyboard('{Enter}');
    let dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Full service receipt detail remains available.')).toBeInTheDocument();
    expect(dialog.getByLabelText('No')).toBeInTheDocument();
    expect(dialog.getByText('High')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(quickView).toHaveFocus();

    await user.click(within(card('Recorded coverages')).getAllByRole('button', { name: 'Quick view' })[0]);
    dialog = within(screen.getByRole('dialog'));
    for (const label of ['Coverage', 'Starts', 'Term', 'Capacity floor', 'Deductible', 'Actions']) {
      expect(dialog.getByText(label)).toBeInTheDocument();
    }
    expect(dialog.getByText(formatPct(70))).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Claim' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(within(card('Claim ledger')).getByRole('button', { name: 'Quick view' }));
    dialog = within(screen.getByRole('dialog'));
    for (const label of ['Claim', 'Status', 'Opened', 'Amount', 'Evidence note']) {
      expect(dialog.getByText(label)).toBeInTheDocument();
    }
    expect(dialog.getByText('Full claim evidence retained.')).toBeInTheDocument();
    expect(dialog.getByText('$123.45')).toBeInTheDocument();
  });

  it('retains row order and original IDs for inline claim and confirmed removal actions', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    const register = within(card('Recorded coverages'));
    const claims = register.getAllByRole('button', { name: 'Claim' });
    for (const action of [...claims, ...register.getAllByRole('button', { name: 'Remove' })]) {
      expect(action).toHaveClass('min-h-11', 'min-w-11');
    }
    claims[1].focus();
    await user.keyboard('{Enter}');
    fireEvent.change(screen.getByLabelText(/Claim title/), { target: { value: 'Paint claim' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Record claim' }).closest('form')!);
    expect(mockClaim().mutate).toHaveBeenCalledWith(
      expect.objectContaining({ warranty_id: 2, title: 'Paint claim', confirmed: true }),
      expect.any(Object),
    );
    await user.click(register.getAllByRole('button', { name: 'Remove' })[1]);
    expect(mutate).not.toHaveBeenCalled();
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText(/Paint Guard/)).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Delete' }));
    expect(mutate).toHaveBeenCalledWith(2);
  });
});

vi.mock('@/hooks/useSelectedVehicle', () => ({ useSelectedVehicle: vi.fn() }));
vi.mock('@/api/hooks/useOwnership', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/hooks/useOwnership')>('@/api/hooks/useOwnership');
  return {
    ...actual,
    useWarrantyOverview: vi.fn(),
    useWarranties: vi.fn(),
    useCreateWarranty: vi.fn(),
    useDeleteWarranty: vi.fn(),
    useCreateWarrantyClaim: vi.fn(),
  };
});

import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import {
  useWarrantyOverview,
  useWarranties,
  useCreateWarranty,
  useDeleteWarranty,
  useCreateWarrantyClaim,
} from '@/api/hooks/useOwnership';
import WarrantyCommandPage from './WarrantyCommandPage';
import { expectOperationalBand, summaryMetric } from '../components/operationalbrief-all/testAssertions';
import type { ClaimStatus, Warranty, WarrantyCoverage, WarrantyKind, WarrantyOverview } from '@/types/ownership';
import { formatDateTime } from '@/lib/dateFormat';
import * as settingsHook from '@/hooks/useSettings';
import * as timezoneHook from '@/lib/timezone';
import { formatPct } from '../formatters';

const mockSelected = useSelectedVehicle as unknown as ReturnType<typeof vi.fn>;
const mockOverview = useWarrantyOverview as unknown as ReturnType<typeof vi.fn>;
const mockWarranties = useWarranties as unknown as ReturnType<typeof vi.fn>;
const mockCreate = useCreateWarranty as unknown as ReturnType<typeof vi.fn>;
const mockRemove = useDeleteWarranty as unknown as ReturnType<typeof vi.fn>;
const mockClaim = useCreateWarrantyClaim as unknown as ReturnType<typeof vi.fn>;

function makeWarranty(overrides: Partial<Warranty> = {}): Warranty {
  return {
    id: 1,
    vehicle_id: 7,
    kind: 'battery',
    label: 'Battery Shield',
    provider: 'Tesla',
    start_at: '2026-01-01T00:00:00Z',
    start_odometer_m: 0,
    term_s: 8 * 365 * 86400,
    term_distance_m: 192000,
    capacity_floor_pct: 70,
    deductible_minor: 0,
    currency: 'USD',
    notes: '',
    version: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function makeMutation(overrides: Record<string, unknown> = {}) {
  return { mutate: vi.fn(), isPending: false, variables: undefined, ...overrides };
}

function makeOverview(): WarrantyOverview {
  const coverage: WarrantyCoverage = {
    warranty: makeWarranty(),
    active: true,
    elapsed_s: 86400,
    remaining_s: 31536000,
    time_used_pct: 1,
    distance_used_m: 1000,
    distance_remaining_m: 191000,
    distance_used_pct: 0.5,
    observed_pace_m_per_s: null,
    time_expiry_at: '2034-01-01T00:00:00Z',
    distance_expiry_at: null,
    projected_expiry_at: '2034-01-01T00:00:00Z',
    binding_limit: 'time',
    capacity_retention_pct: null,
    capacity_floor_breach_at: null,
    capacity_headroom_pct: null,
    claim_window_closing_s: null,
    readiness: [],
    readiness_score: 80,
    claims: [{
      id: 91, warranty_id: 1, title: 'Observed warranty claim', status: 'submitted',
      opened_at: '2026-02-01T00:00:00Z', closed_at: null, amount_minor: 12345,
      evidence_note: 'Full claim evidence retained.',
      created_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z',
    }],
    status: 'active',
    narrative: 'Coverage governed by the entered contract.',
  };
  return {
    vehicle_id: 7, as_of: '2026-02-01T00:00:00Z', odometer_m: 1000,
    coverages: [coverage], active_count: 1, expiring_soon_count: 0,
    next_expiry_at: '2034-01-01T00:00:00Z', total_claimed_minor: 12345,
    currency: 'USD', evidence_bundle_hash: 'complete-warranty-digest',
    quality: { status: 'sufficient', sample_count: 42, coverage_pct: 100, window_start: null, window_end: null, reasons: [] },
    evidence: [],
  };
}

function card(title: string): HTMLElement {
  const element = screen.getByRole('heading', { name: title }).closest('[data-card]');
  if (!(element instanceof HTMLElement)) throw new Error(`Missing card: ${title}`);
  return element;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const page = () => (
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <WarrantyCommandPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
  const view = render(page());
  return { ...view, rerenderPage: () => view.rerender(page()) };
}

/** The Remove button in the table row showing the given coverage label. */
function removeButton(label: string): HTMLElement {
  const row = screen.getByText(label).closest('tr') as HTMLElement;
  return within(row).getByRole('button', { name: 'Remove' });
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(translations)) delete translations[key];
  mockSelected.mockReturnValue({
    vehicleId: 7,
    vehicle: null,
    vehicles: [{ id: 7, display_name: 'Model 3' }],
    setVehicleId: vi.fn(),
  });
  mockOverview.mockReturnValue(makeQuery({ currency: 'USD', coverages: [] }));
  mockWarranties.mockReturnValue(
    makeQuery({
      items: [makeWarranty(), makeWarranty({ id: 2, label: 'Paint Guard', kind: 'corrosion' })],
    }),
  );
  mockCreate.mockReturnValue(makeMutation());
  mockRemove.mockReturnValue(makeMutation());
  mockClaim.mockReturnValue(makeMutation());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WarrantyCommandPage — editor scope and completion ownership', () => {
  const workflows = [
    { name: 'coverage', hook: mockCreate, field: 'Label', submit: 'Save coverage' },
    { name: 'claim', hook: mockClaim, field: 'Claim title', submit: 'Record claim' },
  ];

  function openEditor(name: string) {
    if (name === 'coverage') {
      fireEvent.click(screen.getByRole('button', { name: 'Add coverage' }));
    } else {
      fireEvent.click(within(card('Recorded coverages')).getAllByRole('button', { name: 'Claim' })[0]);
    }
  }

  function changeVehicle(id: number | null) {
    mockSelected.mockReturnValue({ ...mockSelected(), vehicleId: id });
    mockWarranties.mockReturnValue(makeQuery({
      items: id == null ? [] : [makeWarranty({ vehicle_id: id })],
    }));
  }

  it.each(workflows)('retains and blocks a $name draft outside its original vehicle, including manual submission', ({ name, hook, field, submit }) => {
    const view = renderPage();
    openEditor(name);
    fireEvent.change(screen.getByLabelText(field), { target: { value: 'Original draft' } });
    for (const id of [8, null]) {
      changeVehicle(id);
      view.rerenderPage();
      expect(screen.getByLabelText(field)).toHaveValue('Original draft');
      expect(screen.getByText('Unavailable vehicle 7')).toBeInTheDocument();
      const save = screen.getByRole('button', { name: submit });
      expect(save).toBeDisabled();
      fireEvent.submit(save.closest('form')!);
      expect(hook().mutate).not.toHaveBeenCalled();
    }
    changeVehicle(7);
    view.rerenderPage();
    fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
    expect(hook().mutate).toHaveBeenCalledWith(
      expect.objectContaining(name === 'coverage' ? { vehicle_id: 7 } : { warranty_id: 1 }),
      expect.any(Object),
    );
  });

  it.each(workflows)('does not let pending $name work close a draft after a scope round trip', ({ name, hook, field, submit }) => {
    const mutate = vi.fn();
    hook.mockReturnValue(makeMutation({ mutate }));
    const view = renderPage();
    openEditor(name);
    fireEvent.change(screen.getByLabelText(field), { target: { value: 'Pending draft' } });
    fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
    const success = mutate.mock.calls[0][1].onSuccess as () => void;
    hook.mockReturnValue(makeMutation({ mutate, isPending: true }));
    changeVehicle(8);
    view.rerenderPage();
    fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
    expect(mutate).toHaveBeenCalledOnce();
    changeVehicle(7);
    view.rerenderPage();
    act(success);
    expect(screen.getByLabelText(field)).toHaveValue('Pending draft');
  });

  it.each(workflows)('protects newer $name field edits from a late success', ({ name, hook, field, submit }) => {
    const mutate = vi.fn();
    hook.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    openEditor(name);
    fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
    fireEvent.change(screen.getByLabelText(field), { target: { value: 'Newer edit' } });
    act(mutate.mock.calls[0][1].onSuccess);
    expect(screen.getByLabelText(field)).toHaveValue('Newer edit');
  });

  it.each(workflows)('protects a reopened $name editor from the previous editor completion', ({ name, hook, field, submit }) => {
    const mutate = vi.fn();
    hook.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    openEditor(name);
    const form = screen.getByRole('button', { name: submit }).closest('form')!;
    fireEvent.submit(form);
    const success = mutate.mock.calls[0][1].onSuccess as () => void;
    const cancel = name === 'coverage'
      ? within(card('Recorded coverages')).getByRole('button', { name: 'Cancel' })
      : within(form).getByRole('button', { name: 'Cancel' });
    fireEvent.click(cancel);
    openEditor(name);
    act(success);
    expect(screen.getByLabelText(field)).toBeInTheDocument();
  });

  it.each(workflows)('retains rejected $name work and closes only the matching successful retry', ({ name, hook, field, submit }) => {
    const mutate = vi.fn();
    hook.mockReturnValue(makeMutation({ mutate }));
    const view = renderPage();
    openEditor(name);
    fireEvent.change(screen.getByLabelText(field), { target: { value: 'Retry draft' } });
    fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
    hook.mockReturnValue(makeMutation({ mutate, error: new Error('Save rejected') }));
    view.rerenderPage();
    expect(screen.getByText('Save rejected')).toBeInTheDocument();
    expect(screen.getByLabelText(field)).toHaveValue('Retry draft');
    hook.mockReturnValue(makeMutation({ mutate }));
    view.rerenderPage();
    fireEvent.submit(screen.getByRole('button', { name: submit }).closest('form')!);
    act(mutate.mock.calls[1][1].onSuccess);
    expect(screen.queryByLabelText(field)).not.toBeInTheDocument();
  });

  it('blocks a removed claim target and retains its original identity through reordering', () => {
    const view = renderPage();
    fireEvent.click(within(card('Recorded coverages')).getAllByRole('button', { name: 'Claim' })[1]);
    fireEvent.change(screen.getByLabelText('Claim title'), { target: { value: 'Paint evidence' } });
    mockWarranties.mockReturnValue(makeQuery({ items: [makeWarranty()] }));
    view.rerenderPage();
    const submit = screen.getByRole('button', { name: 'Record claim' });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest('form')!);
    expect(mockClaim().mutate).not.toHaveBeenCalled();
    mockWarranties.mockReturnValue(makeQuery({
      items: [makeWarranty({ id: 2, label: 'Renamed coverage' }), makeWarranty()],
    }));
    view.rerenderPage();
    fireEvent.submit(submit.closest('form')!);
    expect(mockClaim().mutate).toHaveBeenCalledWith(
      expect.objectContaining({ warranty_id: 2, title: 'Paint evidence' }), expect.any(Object),
    );
  });

  it('does not close pending claim evidence when its warranty disappears before success', () => {
    const mutate = vi.fn();
    mockClaim.mockReturnValue(makeMutation({ mutate }));
    const view = renderPage();
    openEditor('claim');
    fireEvent.change(screen.getByLabelText('Claim title'), { target: { value: 'Retained evidence' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Record claim' }).closest('form')!);
    mockWarranties.mockReturnValue(makeQuery({ items: [] }));
    view.rerenderPage();
    act(mutate.mock.calls[0][1].onSuccess);
    expect(screen.getByLabelText('Claim title')).toHaveValue('Retained evidence');
    expect(screen.getByRole('button', { name: 'Record claim' })).toBeDisabled();
  });

  it('requires cancelling the current claim before opening another target and ignores the old completion', () => {
    const mutate = vi.fn();
    mockClaim.mockReturnValue(makeMutation({ mutate }));
    renderPage();
    openEditor('claim');
    fireEvent.change(screen.getByLabelText('Claim title'), { target: { value: 'Battery evidence' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Record claim' }).closest('form')!);
    const success = mutate.mock.calls[0][1].onSuccess as () => void;
    const actions = within(card('Recorded coverages')).getAllByRole('button', { name: 'Claim' });
    expect(actions[1]).toBeDisabled();
    fireEvent.click(actions[1]);
    expect(screen.getByLabelText('Claim title')).toHaveValue('Battery evidence');
    const form = screen.getByRole('button', { name: 'Record claim' }).closest('form')!;
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(actions[1]);
    expect(screen.getByLabelText('Claim title')).toHaveValue('');
    fireEvent.change(screen.getByLabelText('Claim title'), { target: { value: 'Paint evidence' } });
    act(success);
    expect(screen.getByLabelText('Claim title')).toHaveValue('Paint evidence');
    fireEvent.submit(screen.getByRole('button', { name: 'Record claim' }).closest('form')!);
    expect(mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ warranty_id: 2, title: 'Paint evidence' }), expect.any(Object),
    );
  });

  it('does not delete after vehicle scope changes while confirmation is open', async () => {
    const view = renderPage();
    fireEvent.click(removeButton('Battery Shield'));
    changeVehicle(8);
    view.rerenderPage();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await act(async () => {});
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });
});

describe('WarrantyCommandPage — saved date preferences', () => {
  it.each([
    ['de-DE', 'America/Los_Angeles', '2026-01-01T00:30:00Z', '31.'],
    ['fr-FR', 'Asia/Tokyo', '2026-01-01T23:30:00Z', '2'],
  ])('formats all expiry and ledger instants in %s / %s across day boundaries', (locale, tz, instant, day) => {
    const defaults = settingsHook.useSettings();
    vi.spyOn(settingsHook, 'useSettings').mockReturnValue({
      ...defaults, locale,
      settings: { ...defaults.settings, locale, tz_display_default: 'user', timezone_user: tz },
    });
    const timezone = vi.spyOn(timezoneHook, 'useTimezone').mockReturnValue(tz);
    const overview = makeOverview();
    const coverage = overview.coverages[0];
    coverage.time_expiry_at = instant;
    coverage.projected_expiry_at = instant;
    coverage.capacity_retention_pct = 68;
    coverage.capacity_floor_breach_at = instant;
    coverage.claims[0].opened_at = instant;
    overview.next_expiry_at = instant;
    const warranty = makeWarranty({ start_at: instant });
    mockOverview.mockReturnValue(makeQuery(overview));
    mockWarranties.mockReturnValue(makeQuery({ items: [warranty] }));
    renderPage();

    const expected = formatDateTime(instant, { locale, tz });
    expect(expected).toContain(day);
    expect(timezone).toHaveBeenCalledWith('user');
    expect(card('Recorded coverages')).toHaveTextContent(expected);
    expect(card('Claim ledger')).toHaveTextContent(expected);
    expect(summaryMetric('Coverage posture', 'next')).toHaveTextContent(expected);
    const burnDown = card('Coverage burn-down');
    expect(burnDown).toHaveTextContent(`expires ${expected}`);
    expect(burnDown).toHaveTextContent(`Projected end ${expected}`);
    expect(burnDown).toHaveTextContent(`Projected to reach the floor around ${expected}`);
    expect(warranty.start_at).toBe(instant);
    expect(coverage.claims[0].opened_at).toBe(instant);

    fireEvent.click(screen.getByRole('button', { name: 'Add coverage' }));
    fireEvent.change(screen.getByLabelText('Coverage start'), { target: { value: '2026-03-08' } });
    expect(screen.getByLabelText('Coverage start')).toHaveValue('2026-03-08');
    fireEvent.submit(screen.getByRole('button', { name: 'Save coverage' }).closest('form')!);
    expect(mockCreate().mutate).toHaveBeenCalledWith(
      expect.objectContaining({ start_at: '2026-03-08T00:00:00.000Z' }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it.each(['not-a-date', ''])('keeps invalid or missing dates unknown (%s)', (date) => {
    const overview = makeOverview();
    const coverage = overview.coverages[0];
    coverage.time_expiry_at = date;
    coverage.projected_expiry_at = date || null;
    coverage.claims[0].opened_at = date;
    overview.next_expiry_at = date || null;
    mockOverview.mockReturnValue(makeQuery(overview));
    mockWarranties.mockReturnValue(makeQuery({ items: [makeWarranty({ start_at: date })] }));
    renderPage();
    expect(card('Recorded coverages')).toHaveTextContent('—');
    expect(card('Claim ledger')).toHaveTextContent('—');
    expect(card('Coverage burn-down')).toHaveTextContent('expires —');
    expect(card('Coverage burn-down')).toHaveTextContent('Projected end —');
    expect(summaryMetric('Coverage posture', 'next')).not.toHaveTextContent('Invalid Date');
    expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument();
  });
});

describe('WarrantyCommandPage — enum display mappings', () => {
  it.each<[WarrantyKind, string]>([
    ['basic', 'Basic'], ['drivetrain', 'Drivetrain'], ['battery', 'Battery'],
    ['corrosion', 'Corrosion'], ['tires', 'Tires'], ['aftermarket', 'Aftermarket'],
    ['extended', 'Extended'],
  ])('labels %s coverage consistently while submitting its wire value', (kind, label) => {
    const warranty = makeWarranty({ kind });
    const overview = makeOverview();
    overview.coverages[0].warranty = warranty;
    mockOverview.mockReturnValue(makeQuery(overview));
    mockWarranties.mockReturnValue(makeQuery({ items: [warranty] }));
    renderPage();

    expect(card('Recorded coverages')).toHaveTextContent(`Tesla · ${label}`);
    expect(card('Coverage burn-down')).toHaveTextContent(`Tesla · ${label}`);
    fireEvent.click(screen.getByRole('button', { name: 'Add coverage' }));
    const select = screen.getByRole('combobox', { name: 'Coverage type' });
    expect(within(select).getByRole('option', { name: label })).toHaveValue(kind);
    fireEvent.change(select, { target: { value: kind } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save coverage' }).closest('form')!);
    expect(mockCreate().mutate).toHaveBeenCalledWith(
      expect.objectContaining({ kind }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    expect(warranty.kind).toBe(kind);
  });

  it.each([
    ['time', 'Time', 'active', 'Active', 'critical', 'Critical'],
    ['distance', 'Distance', 'expiring', 'Expiring', 'high', 'High'],
    ['capacity', 'Capacity', 'expired', 'Expired', 'medium', 'Medium'],
    ['time', 'Time', 'active', 'Active', 'low', 'Low'],
  ])('labels %s / %s / %s without rewriting source enums', (binding, bindingLabel, status, statusLabel, severity, severityLabel) => {
    const overview = makeOverview();
    const coverage = overview.coverages[0];
    coverage.binding_limit = binding;
    coverage.status = status;
    coverage.readiness = [{ code: 'evidence', label: 'Recorded evidence', detail: 'Available', severity, satisfied: true }];
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();

    expect(within(card('Coverage burn-down')).getByText(bindingLabel, { exact: true })).toBeInTheDocument();
    expect(within(card('Coverage burn-down')).getByText(statusLabel, { exact: true })).toBeInTheDocument();
    expect(within(card('Claim readiness checklist')).getByText(severityLabel, { exact: true })).toBeInTheDocument();
    expect(coverage.binding_limit).toBe(binding);
    expect(coverage.status).toBe(status);
    expect(coverage.readiness[0].severity).toBe(severity);
    expect(card('Claim ledger')).toHaveTextContent('$123.45');
    expect(card('Claim ledger')).toHaveTextContent('Full claim evidence retained.');
  });

  it('uses translations for the same recognized tokens across their display surfaces', () => {
    translations['ownership.warranty.kind.battery'] = 'Batterie';
    translations['ownership.warranty.binding.time'] = 'Temps';
    translations['ownership.warranty.severity.high'] = 'Élevée';
    translations['ownership.warranty.status.expiring'] = 'Expire bientôt';
    const overview = makeOverview();
    overview.coverages[0].status = 'expiring';
    overview.coverages[0].readiness = [
      { code: 'evidence', label: 'Recorded evidence', detail: 'Available', severity: 'high', satisfied: true },
    ];
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();
    expect(card('Recorded coverages')).toHaveTextContent('Tesla · Batterie');
    expect(card('Coverage burn-down')).toHaveTextContent('Tesla · Batterie');
    expect(card('Coverage burn-down')).toHaveTextContent('Temps');
    expect(card('Coverage burn-down')).toHaveTextContent('Expire bientôt');
    expect(card('Claim readiness checklist')).toHaveTextContent('Élevée');
    fireEvent.click(screen.getByRole('button', { name: 'Add coverage' }));
    expect(within(screen.getByRole('combobox', { name: 'Coverage type' }))
      .getByRole('option', { name: 'Batterie' })).toHaveValue('battery');
  });

  it.each(['Future_TOKEN_v2', 'constructor'])('preserves unknown %s tokens verbatim without crashing or mutating records', (token) => {
    const overview = makeOverview();
    const coverage = overview.coverages[0];
    const warranty = { ...coverage.warranty, kind: token };
    const futureCoverage = {
      ...coverage, warranty, status: token, binding_limit: token,
      readiness: [{ code: 'future', label: 'Future evidence', detail: 'Retained detail', severity: token, satisfied: false }],
      claims: [{ ...coverage.claims[0], status: token }],
    };
    mockOverview.mockReturnValue(makeQuery({ ...overview, coverages: [futureCoverage] }));
    mockWarranties.mockReturnValue(makeQuery({ items: [warranty] }));
    renderPage();

    expect(card('Recorded coverages')).toHaveTextContent(`Tesla · ${token}`);
    expect(within(card('Coverage burn-down')).getAllByText(token, { exact: true })).toHaveLength(2);
    expect(within(card('Claim readiness checklist')).getByText(token, { exact: true })).toBeInTheDocument();
    expect(within(card('Claim ledger')).getByText(token, { exact: true })).toBeInTheDocument();
    expect(card('Claim ledger')).toHaveTextContent('$123.45');
    expect(card('Claim ledger')).toHaveTextContent('Full claim evidence retained.');
    expect(futureCoverage.claims[0].status).toBe(token);
    expect(warranty.kind).toBe(token);
    expect(mockClaim().mutate).not.toHaveBeenCalled();
  });
});

describe('WarrantyCommandPage — confirm-gated delete', () => {
  it.each<[ClaimStatus, string]>([
    ['draft', 'Brouillon'],
    ['submitted', 'Soumise'],
    ['approved', 'Approuvée'],
    ['denied', 'Refusée'],
    ['closed', 'Clôturée'],
  ])('renders the translated recorded %s claim status without implying verification', (status, label) => {
    translations[`ownership.warranty.status.${status}`] = label;
    const overview = makeOverview();
    overview.coverages[0].claims[0].status = status;
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();

    const row = within(card('Claim ledger')).getByText('Observed warranty claim').closest('tr')!;
    expect(within(row).getByText(label)).toBeInTheDocument();
    expect(within(row).queryByText(status, { exact: true })).not.toBeInTheDocument();
    expect(row).not.toHaveTextContent(/verified/i);
    expect(row).toHaveTextContent('$123.45');
    expect(row).toHaveTextContent('Full claim evidence retained.');
    expect(overview.coverages[0].claims[0].status).toBe(status);
    expect(mockClaim().mutate).not.toHaveBeenCalled();
  });

  it('uses the real coverage brief while keeping contract provenance, projected expiry and claim amounts', () => {
    mockOverview.mockReturnValue(makeQuery(makeOverview()));
    renderPage();
    expectOperationalBand('Coverage posture', ['active', 'expiring', 'next', 'odometer', 'claimed']);
    expect(summaryMetric('Coverage posture', 'active')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Coverage posture', 'expiring')).toHaveAttribute('data-value-state', 'value');
    expect(summaryMetric('Coverage posture', 'claimed')).toHaveTextContent('$123.45');
    expect(summaryMetric('Coverage posture', 'odometer')).toHaveTextContent('Derived from recorded drives');
    fireEvent.click(within(card('Coverage posture')).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('TeslaSync does not know your contract');
    expect(screen.getByRole('dialog')).toHaveTextContent('Derived from recorded drives');
    expect(mockRemove().mutate).not.toHaveBeenCalled();
  });

  it('keeps overview-owned claim history and amounts visible when the separate coverage register fails', () => {
    mockOverview.mockReturnValue(makeQuery(makeOverview()));
    mockWarranties.mockReturnValue({ ...makeQuery(undefined), error: new Error('register failed') });
    renderPage();

    const ledger = card('Claim ledger');
    expect(within(ledger).getByText('Observed warranty claim')).toBeInTheDocument();
    expect(within(ledger).getByText('$123.45')).toBeInTheDocument();
    expect(within(ledger).getByText('Full claim evidence retained.')).toBeInTheDocument();
    expect(within(ledger).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(card('Coverage posture')).toHaveTextContent('$123.45');
    expect(screen.getByText('complete-warranty-digest')).toBeInTheDocument();
    expect(mockOverview).toHaveBeenCalledWith(7);
    expect(mockWarranties).toHaveBeenCalledWith(7);
    expect(mockClaim().mutate).not.toHaveBeenCalled();
  });

  it('marks a failed overview as unavailable claim history, not a successful empty register', () => {
    const refetch = vi.fn();
    mockOverview.mockReturnValue({ ...makeQuery(undefined), error: new Error('overview failed'), refetch });
    renderPage();

    expect(screen.getByText('Battery Shield')).toBeInTheDocument();
    const ledger = card('Claim ledger');
    expect(within(ledger).queryByText('No claims recorded yet.')).not.toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('retains claim history with the overview retry, independently of a healthy register', () => {
    const refetch = vi.fn();
    const registerRefetch = vi.fn();
    mockOverview.mockReturnValue({ ...makeQuery(makeOverview()), error: new Error('overview refresh failed'), refetch });
    mockWarranties.mockReturnValue({ ...makeQuery({ items: [makeWarranty()] }), refetch: registerRefetch });
    renderPage();

    const ledger = card('Claim ledger');
    expect(within(ledger).getByText('Observed warranty claim')).toBeInTheDocument();
    expect(within(ledger).getByText(/Previously loaded data remains visible/)).toBeInTheDocument();
    fireEvent.click(within(ledger).getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(registerRefetch).not.toHaveBeenCalled();
    expect(within(card('Recorded coverages')).queryByText(/Previously loaded data remains visible/)).not.toBeInTheDocument();
  });

  it('opens a danger confirm naming the coverage instead of deleting on click', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Battery Shield'));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete this warranty?')).toBeInTheDocument();
    expect(dialog.textContent).toContain('Battery Shield');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('deletes only after the dialog is confirmed', async () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Paint Guard'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }),
    );

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    expect(mutate).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not delete when the dialog is cancelled', () => {
    const mutate = vi.fn();
    mockRemove.mockReturnValue(makeMutation({ mutate }));
    renderPage();

    fireEvent.click(removeButton('Battery Shield'));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );

    expect(mutate).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('marks only the deleting row pending while the mutation is in flight', () => {
    mockRemove.mockReturnValue(makeMutation({ isPending: true, variables: 2 }));
    renderPage();

    expect(removeButton('Paint Guard')).toBeDisabled();
    expect(removeButton('Battery Shield')).not.toBeDisabled();
  });
});


describe('WarrantyCommandPage — restrained shared adoption', () => {
  it('offers coverage entry only when the overview confirms no recorded coverage', () => {
    mockOverview.mockReturnValue(makeQuery({ ...makeOverview(), coverages: [] }));
    mockWarranties.mockReturnValue(makeQuery({ items: [] }));
    renderPage();

    const checklist = within(card('Claim readiness checklist'));
    expect(checklist.getByText('No coverage recorded, so nothing to evaluate.')).toBeInTheDocument();
    expect(checklist.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    fireEvent.click(checklist.getByRole('button', { name: 'Add coverage' }));
    expect(screen.getByLabelText('Coverage start')).toBeInTheDocument();
    expect(mockCreate().mutate).not.toHaveBeenCalled();
  });

  it.each([{ readiness: [] }, { readiness: null }])('keeps recorded coverage with $readiness checks distinct from no coverage', ({ readiness }) => {
    const overview = makeOverview();
    const refetch = vi.fn();
    mockOverview.mockReturnValue({
      ...makeQuery({
        ...overview,
        coverages: [{ ...overview.coverages[0], readiness }],
      }),
      refetch,
    });
    renderPage();

    const checklist = within(card('Claim readiness checklist'));
    expect(checklist.queryByText('No coverage recorded, so nothing to evaluate.')).not.toBeInTheDocument();
    expect(checklist.getByText('No supported data is available yet.')).toBeInTheDocument();
    expect(checklist.queryByRole('button', { name: 'Add coverage' })).not.toBeInTheDocument();
    expect(card('Coverage burn-down')).toHaveTextContent('Battery Shield');
    fireEvent.click(checklist.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(mockCreate().mutate).not.toHaveBeenCalled();
  });

  it('does not infer no coverage from an unavailable coverage assessment', () => {
    const refetch = vi.fn();
    mockOverview.mockReturnValue({
      ...makeQuery(undefined), error: new Error('assessment unavailable'), refetch,
    });
    renderPage();

    const checklist = within(card('Claim readiness checklist'));
    expect(checklist.queryByText('No coverage recorded, so nothing to evaluate.')).not.toBeInTheDocument();
    expect(checklist.queryByRole('button', { name: 'Add coverage' })).not.toBeInTheDocument();
    fireEvent.click(checklist.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
    expect(card('Recorded coverages')).toHaveTextContent('Battery Shield');
  });

  it.each([{ coverages: [] }, { coverages: null }])('does not infer no coverage from $coverages assessments when the register has coverage', ({ coverages }) => {
    const refetch = vi.fn();
    mockOverview.mockReturnValue({ ...makeQuery({ ...makeOverview(), coverages }), refetch });
    renderPage();

    const checklist = within(card('Claim readiness checklist'));
    expect(checklist.getByText('No supported data is available yet.')).toBeInTheDocument();
    expect(checklist.queryByText('No coverage recorded, so nothing to evaluate.')).not.toBeInTheDocument();
    fireEvent.click(checklist.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps initial readiness loading distinct from no coverage without offering an assessment retry', () => {
    mockOverview.mockReturnValue({ ...makeQuery(undefined), isLoading: true, isPending: true });
    renderPage();

    const checklist = within(card('Claim readiness checklist'));
    expect(checklist.queryByText('No coverage recorded, so nothing to evaluate.')).not.toBeInTheDocument();
    expect(checklist.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(checklist.queryByRole('button', { name: 'Add coverage' })).not.toBeInTheDocument();
    expect(card('Recorded coverages')).toHaveTextContent('Battery Shield');
  });

  it('keeps every section mounted for authoritative empty sources', () => {
    mockOverview.mockReturnValue(makeQuery({ ...makeOverview(), coverages: [] }));
    mockWarranties.mockReturnValue(makeQuery({ items: [] }));
    renderPage();
    for (const title of ['Coverage posture', 'Coverage burn-down', 'Claim readiness checklist',
      'Recorded coverages', 'Claim ledger', 'Evidence bundle', 'Evidence, quality, and limitations']) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    }
    expect(screen.getByText('No warranties recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('No claims recorded yet.')).toBeInTheDocument();
    expect(screen.getByText('• Interpreting contract exclusions — readiness is factual, not legal advice')).toBeInTheDocument();
    expect(screen.getByText('• Filing the claim with the provider on your behalf')).toBeInTheDocument();
  });

  it('uses named shared usage bars without changing source values or bounded presentation', () => {
    const overview = makeOverview();
    overview.coverages[0].time_used_pct = 125;
    overview.coverages[0].distance_used_pct = -5;
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();
    expect(screen.getByRole('progressbar', { name: 'Time consumed' })).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByRole('progressbar', { name: 'Distance consumed' })).toHaveAttribute('aria-valuenow', '0');
    expect(overview.coverages[0].time_used_pct).toBe(125);
    expect(overview.coverages[0].distance_used_pct).toBe(-5);
  });

  it.each([
    [null, null],
    [null, -2],
    [68, null],
    [0, 0],
    [68, -2],
  ])('keeps the battery subsection with retention %s and headroom %s', (retention, headroom) => {
    const overview = makeOverview();
    overview.coverages[0].capacity_retention_pct = retention;
    overview.coverages[0].capacity_headroom_pct = headroom;
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();

    const burnDown = within(card('Coverage burn-down'));
    expect(burnDown.getByText('Battery retention vs. warranty floor')).toBeInTheDocument();
    const expectedRetention = retention == null ? 'Unknown' : formatPct(retention);
    const expectedHeadroom = headroom == null ? 'Unknown' : formatPct(headroom);
    expect(burnDown.getByText(`${expectedRetention} · ${expectedHeadroom} headroom`)).toBeInTheDocument();
    expect(overview.coverages[0].capacity_retention_pct).toBe(retention);
    expect(overview.coverages[0].capacity_headroom_pct).toBe(headroom);
  });

  it('localizes unknown battery retention and headroom', () => {
    translations['common.unknown'] = 'Unbekannt';
    mockOverview.mockReturnValue(makeQuery(makeOverview()));
    renderPage();

    expect(within(card('Coverage burn-down')).getByText('Unbekannt · Unbekannt headroom')).toBeInTheDocument();
  });

  it.each([null, 68])('keeps non-battery capacity metadata conditional on retention %s', (retention) => {
    const overview = makeOverview();
    overview.coverages[0].warranty.kind = 'basic';
    overview.coverages[0].capacity_retention_pct = retention;
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();

    const label = within(card('Coverage burn-down')).queryByText('Battery retention vs. warranty floor');
    if (retention == null) {
      expect(label).not.toBeInTheDocument();
    } else {
      expect(label).toBeInTheDocument();
      expect(within(card('Coverage burn-down')).getByText(`${formatPct(retention)} · Unknown headroom`)).toBeInTheDocument();
    }
  });

  it('keeps unknown usage unknown and signed battery headroom intact', () => {
    const overview = makeOverview();
    overview.coverages[0].time_used_pct = Number.NaN;
    overview.coverages[0].capacity_retention_pct = 68;
    overview.coverages[0].capacity_headroom_pct = -2;
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();
    const bar = screen.getByRole('progressbar', { name: 'Time consumed' });
    expect(bar).not.toHaveAttribute('aria-valuenow');
    expect(bar).toHaveAttribute('aria-valuetext', 'No reading');
    expect(screen.getByText(/-2.*headroom/)).toBeInTheDocument();
    expect(overview.coverages[0].capacity_headroom_pct).toBe(-2);
  });

  it('names readiness outcomes independently of semantic color', () => {
    const overview = makeOverview();
    overview.coverages[0].readiness = [
      { code: 'recorded', label: 'Recorded evidence', detail: 'Available', severity: 'high', satisfied: true },
      { code: 'missing', label: 'Missing evidence', detail: 'Unavailable', severity: 'critical', satisfied: false },
    ];
    mockOverview.mockReturnValue(makeQuery(overview));
    renderPage();
    expect(within(card('Claim readiness checklist')).getByRole('img', { name: 'Yes' })).toBeInTheDocument();
    expect(within(card('Claim readiness checklist')).getByRole('img', { name: 'No' })).toBeInTheDocument();
  });

  it('keeps readiness rows identified by warranty ID and check code through duplicate labels, renaming and reordering', () => {
    const overview = makeOverview();
    const first = overview.coverages[0];
    first.readiness = [
      { code: 'evidence', label: 'First contract evidence', detail: 'Available', severity: 'low', satisfied: true },
      { code: 'receipt', label: 'First contract receipt', detail: 'Unavailable', severity: 'high', satisfied: false },
    ];
    const second: WarrantyCoverage = {
      ...first,
      warranty: makeWarranty({ id: 2, label: first.warranty.label }),
      readiness: [
        { code: 'evidence', label: 'Second contract evidence', detail: 'Unavailable', severity: 'critical', satisfied: false },
      ],
      claims: [],
    };
    overview.coverages = [first, second];
    mockOverview.mockReturnValue(makeQuery(overview));
    const view = renderPage();
    const checklist = () => within(card('Claim readiness checklist'));
    const firstRow = checklist().getByText('First contract evidence').closest('tr')!;
    const receiptRow = checklist().getByText('First contract receipt').closest('tr')!;
    const secondRow = checklist().getByText('Second contract evidence').closest('tr')!;

    expect(firstRow).not.toBe(secondRow);
    expect(within(firstRow).getByRole('img', { name: 'Yes' })).toBeInTheDocument();
    expect(within(secondRow).getByRole('img', { name: 'No' })).toBeInTheDocument();
    expect(checklist().getAllByText('Battery Shield')).toHaveLength(3);

    mockOverview.mockReturnValue(makeQuery({
      ...overview,
      coverages: [
        second,
        {
          ...first,
          warranty: { ...first.warranty, label: 'Renamed contract' },
          readiness: [...first.readiness].reverse(),
        },
      ],
    }));
    view.rerenderPage();

    expect(checklist().getByText('First contract evidence').closest('tr')).toBe(firstRow);
    expect(checklist().getByText('First contract receipt').closest('tr')).toBe(receiptRow);
    expect(checklist().getByText('Second contract evidence').closest('tr')).toBe(secondRow);
    expect(firstRow).toHaveTextContent('Renamed contract');
    expect(receiptRow).toHaveTextContent('Renamed contract');
    expect(secondRow).toHaveTextContent('Battery Shield');
    expect(first.warranty.label).toBe('Battery Shield');
    expect(mockClaim().mutate).not.toHaveBeenCalled();
  });

  it('keeps initial overview loading independent of the ready coverage register', () => {
    mockOverview.mockReturnValue({ ...makeQuery(undefined), isLoading: true, isPending: true });
    renderPage();
    expect(screen.getByText('Battery Shield')).toBeInTheDocument();
    expect(within(card('Claim ledger')).queryByText('No claims recorded yet.')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Coverage burn-down' })).toBeInTheDocument();
    expect(mockClaim().mutate).not.toHaveBeenCalled();
  });

  it('retains cached overview claims when refresh is paused', () => {
    mockOverview.mockReturnValue({ ...makeQuery(makeOverview()), fetchStatus: 'paused' });
    renderPage();
    expect(within(card('Claim ledger')).getByText('Observed warranty claim')).toBeInTheDocument();
    expect(within(card('Claim ledger')).getByText(/Cached evidence remains visible/)).toBeInTheDocument();
    expect(screen.getByText('complete-warranty-digest')).toBeInTheDocument();
  });

  it('preserves raw SI coverage submission and confirmed claim recording', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Add coverage' }));
    fireEvent.change(screen.getByLabelText(/Label/), { target: { value: 'Entered contract' } });
    const save = screen.getByRole('button', { name: 'Save coverage' });
    fireEvent.submit(save.closest('form')!);
    expect(mockCreate().mutate).toHaveBeenCalledWith(expect.objectContaining({
      vehicle_id: 7, label: 'Entered contract', start_odometer_m: 0,
      term_s: 1460 * 86400, term_distance_m: 80467, capacity_floor_pct: null,
      deductible_minor: 0, currency: 'USD',
    }), expect.objectContaining({ onSuccess: expect.any(Function) }));
    const row = screen.getByText('Battery Shield').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Claim' }));
    fireEvent.change(screen.getByLabelText(/Claim title/), { target: { value: 'Recorded claim' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Record claim' }).closest('form')!);
    expect(mockClaim().mutate).toHaveBeenCalledWith({
      warranty_id: 1, confirmed: true, title: 'Recorded claim', status: 'draft',
      amount_minor: 0, evidence_note: '',
    }, expect.objectContaining({ onSuccess: expect.any(Function) }));
  });
});
