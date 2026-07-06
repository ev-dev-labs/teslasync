/**
 * AutomationCard tests — status variants, firing indicator, toggle/re-enable
 * routing, kebab menu actions, delete-confirm flow, vehicle + stats rows,
 * conflicts, and a11y (roles/labels, aria-expanded, Escape-to-close).
 *
 * Network isolation: the only data-fetching child is <PinButton>, whose
 * `usePinned`/`useTogglePin` hooks are stubbed so the card renders without a
 * QueryClient hitting the wire. A QueryClientProvider is still supplied as a
 * defensive wrapper. i18n is stubbed to echo the English default (with
 * `{{name}}` interpolation) so assertions read against human-visible copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// i18n stub — resolve to the provided English default, honouring both the
// `t(key, 'Default')` and `t(key, { defaultValue, ...vars })` call shapes and
// interpolating `{{var}}` tokens so the delete-confirm copy is readable.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: string | Record<string, unknown>) => {
      if (typeof opts === 'string') return opts || key;
      if (opts && typeof opts === 'object') {
        let out = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
        for (const [k, v] of Object.entries(opts)) {
          if (k === 'defaultValue') continue;
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return out;
      }
      return key;
    },
  }),
}));

// PinButton's data hooks — stub so the card mounts without real network / a
// live QueryClient query. The card under test owns no query hooks itself.
vi.mock('@/api/hooks/usePinned', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/usePinned')>(
    '@/api/hooks/usePinned',
  );
  return {
    ...actual,
    usePinned: () => ({ data: [] }),
    useTogglePin: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

import { AutomationCard } from './AutomationCard';
import type { Automation, AutomationConflict } from '@/api/types';

// ── Fixtures ────────────────────────────────────────────────────────────────

const FIVE_MIN_AGO = new Date(Date.now() - 5 * 60 * 1000).toISOString();

/**
 * Build a fully-populated Automation. The public `Automation` type carries a
 * set of `never`-typed compatibility keys that forbid direct object-literal
 * construction, so we cast through `unknown` (repo convention — see
 * NotificationGroupRow.test.tsx).
 */
function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 7,
    name: 'Precondition at 7am',
    description: null,
    enabled: true,
    vehicle_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    stop_on_failure: false,
    notify_on_run: false,
    notify_on_failure: false,
    seasonal_start: null,
    seasonal_end: null,
    last_triggered_at: null,
    last_success_at: null,
    last_failure_at: null,
    execution_count: 0,
    failure_count: 0,
    consecutive_failures: 0,
    auto_disabled: false,
    auto_disabled_reason: null,
    preset_id: null,
    next_fire_time: null,
    conflicts: [],
    ...overrides,
  } as unknown as Automation;
}

function makeHandlers() {
  return {
    onToggle: vi.fn(),
    onReEnable: vi.fn(),
    onDelete: vi.fn(),
    onTestRun: vi.fn(),
  };
}

function renderCard(
  automation: Automation,
  extra: {
    isFiring?: boolean;
    vehicleName?: string;
    handlers?: ReturnType<typeof makeHandlers>;
  } = {},
) {
  const handlers = extra.handlers ?? makeHandlers();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const utils = render(
    <AutomationCard
      automation={automation}
      isFiring={extra.isFiring ?? false}
      vehicleName={extra.vehicleName}
      onToggle={handlers.onToggle}
      onReEnable={handlers.onReEnable}
      onDelete={handlers.onDelete}
      onTestRun={handlers.onTestRun}
    />,
    { wrapper: Wrapper },
  );
  return { ...utils, handlers };
}

function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Actions menu' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Status badge + toggle state ───────────────────────────────────────────────

describe('AutomationCard — status', () => {
  it('renders the automation name and an Active badge with the switch on when enabled', () => {
    renderCard(makeAutomation({ name: 'Morning warmup', enabled: true }));
    expect(screen.getByRole('heading', { name: 'Morning warmup' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('renders a Disabled badge with the switch off when not enabled', () => {
    renderCard(makeAutomation({ enabled: false }));
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('renders an Auto-Disabled badge, forces the switch off, and shows the reason', () => {
    renderCard(
      makeAutomation({
        enabled: true,
        auto_disabled: true,
        auto_disabled_reason: 'Exceeded failure threshold',
      }),
    );
    expect(screen.getByText('Auto-Disabled')).toBeInTheDocument();
    // Auto-disabled must render the switch OFF regardless of the enabled flag.
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Exceeded failure threshold')).toBeInTheDocument();
  });
});

// ── Firing indicator ──────────────────────────────────────────────────────────

describe('AutomationCard — firing indicator', () => {
  it('shows the Firing badge only when isFiring is true', () => {
    const { rerender } = renderCard(makeAutomation(), { isFiring: true });
    expect(screen.getByText('Firing')).toBeInTheDocument();

    rerender(
      <AutomationCard
        automation={makeAutomation()}
        isFiring={false}
        onToggle={vi.fn()}
        onReEnable={vi.fn()}
        onDelete={vi.fn()}
        onTestRun={vi.fn()}
      />,
    );
    expect(screen.queryByText('Firing')).not.toBeInTheDocument();
  });
});

// ── Description ────────────────────────────────────────────────────────────────

describe('AutomationCard — description', () => {
  it('renders the description when present and omits it when null', () => {
    const { rerender } = renderCard(
      makeAutomation({ description: 'Warms the cabin before departure' }),
    );
    expect(screen.getByText('Warms the cabin before departure')).toBeInTheDocument();

    rerender(
      <AutomationCard
        automation={makeAutomation({ description: null })}
        isFiring={false}
        onToggle={vi.fn()}
        onReEnable={vi.fn()}
        onDelete={vi.fn()}
        onTestRun={vi.fn()}
      />,
    );
    expect(
      screen.queryByText('Warms the cabin before departure'),
    ).not.toBeInTheDocument();
  });
});

// ── Toggle / re-enable routing ────────────────────────────────────────────────

describe('AutomationCard — toggle routing', () => {
  it('calls onToggle(id, false) when switching off an enabled automation', () => {
    const { handlers } = renderCard(makeAutomation({ id: 11, enabled: true }));
    fireEvent.click(screen.getByRole('switch'));
    expect(handlers.onToggle).toHaveBeenCalledWith(11, false);
    expect(handlers.onReEnable).not.toHaveBeenCalled();
  });

  it('calls onToggle(id, true) when switching on a disabled automation', () => {
    const { handlers } = renderCard(makeAutomation({ id: 12, enabled: false }));
    fireEvent.click(screen.getByRole('switch'));
    expect(handlers.onToggle).toHaveBeenCalledWith(12, true);
  });

  it('routes to onReEnable(id) — not onToggle — when re-enabling an auto-disabled automation via the switch', () => {
    const { handlers } = renderCard(
      makeAutomation({ id: 13, enabled: true, auto_disabled: true }),
    );
    fireEvent.click(screen.getByRole('switch'));
    expect(handlers.onReEnable).toHaveBeenCalledWith(13);
    expect(handlers.onToggle).not.toHaveBeenCalled();
  });
});

// ── Kebab menu ────────────────────────────────────────────────────────────────

describe('AutomationCard — actions menu', () => {
  it('toggles aria-expanded and reveals the base action items', () => {
    renderCard(makeAutomation({ auto_disabled: false }));
    const trigger = screen.getByRole('button', { name: 'Actions menu' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Test Run' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    // Re-enable is hidden unless the automation is auto-disabled.
    expect(screen.queryByRole('button', { name: 'Re-enable' })).not.toBeInTheDocument();
  });

  it('shows a Re-enable item that calls onReEnable when the automation is auto-disabled', () => {
    const { handlers } = renderCard(
      makeAutomation({ id: 21, auto_disabled: true }),
    );
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Re-enable' }));
    expect(handlers.onReEnable).toHaveBeenCalledWith(21);
  });

  it('invokes onTestRun and closes the menu when Test Run is clicked', () => {
    const { handlers } = renderCard(makeAutomation({ id: 22 }));
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Test Run' }));
    expect(handlers.onTestRun).toHaveBeenCalledWith(22);
    // Menu collapses after the action fires.
    expect(screen.getByRole('button', { name: 'Actions menu' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByRole('button', { name: 'Test Run' })).not.toBeInTheDocument();
  });

  it('closes the menu on Escape', () => {
    renderCard(makeAutomation());
    openMenu();
    expect(screen.getByRole('button', { name: 'Test Run' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Test Run' })).not.toBeInTheDocument();
  });
});

// ── Delete confirmation flow ──────────────────────────────────────────────────

describe('AutomationCard — delete flow', () => {
  it('opens a confirm dialog and calls onDelete only after confirming', () => {
    const { handlers } = renderCard(
      makeAutomation({ id: 31, name: 'Nightly report' }),
    );
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete Automation')).toBeInTheDocument();
    // Interpolated confirmation copy carries the automation name.
    expect(dialog.textContent).toContain('Nightly report');
    expect(handlers.onDelete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(handlers.onDelete).toHaveBeenCalledWith(31);
  });

  it('does not call onDelete when the confirm dialog is cancelled', () => {
    const { handlers } = renderCard(makeAutomation({ id: 32 }));
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(handlers.onDelete).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// ── Vehicle row ────────────────────────────────────────────────────────────────

describe('AutomationCard — vehicle row', () => {
  it('shows the vehicle name when provided', () => {
    renderCard(makeAutomation(), { vehicleName: 'Model 3 LR' });
    expect(screen.getByText('Model 3 LR')).toBeInTheDocument();
    expect(screen.queryByText('All vehicles')).not.toBeInTheDocument();
  });

  it('falls back to "All vehicles" when no vehicle name is provided', () => {
    renderCard(makeAutomation());
    expect(screen.getByText('All vehicles')).toBeInTheDocument();
  });
});

// ── Stats row ──────────────────────────────────────────────────────────────────

describe('AutomationCard — stats row', () => {
  it('shows "Never run" and a zero run count with no failures/next-fire by default', () => {
    const { container } = renderCard(
      makeAutomation({ last_triggered_at: null, execution_count: 0, failure_count: 0 }),
    );
    expect(screen.getByText('Never run')).toBeInTheDocument();
    expect(container.textContent).toContain('Runs: 0');
    expect(container.textContent).not.toContain('Fails:');
    expect(container.textContent).not.toContain('Next:');
  });

  it('shows last-run, run count, failures, and next-fire when populated', () => {
    const { container } = renderCard(
      makeAutomation({
        last_triggered_at: FIVE_MIN_AGO,
        execution_count: 42,
        failure_count: 3,
        next_fire_time: '2026-07-05T07:00:00Z',
      }),
    );
    expect(screen.queryByText('Never run')).not.toBeInTheDocument();
    expect(container.textContent).toContain('Last:');
    expect(container.textContent).toContain('Runs: 42');
    expect(container.textContent).toContain('Fails: 3');
    expect(container.textContent).toContain('Next:');
  });

  it('treats a missing failure_count as zero (null-safety) without rendering Fails', () => {
    const { container } = renderCard(
      makeAutomation({ failure_count: undefined as unknown as number }),
    );
    expect(container.textContent).not.toContain('Fails:');
  });
});

// ── Conflicts ──────────────────────────────────────────────────────────────────

describe('AutomationCard — conflicts', () => {
  it('renders one row per conflict with the peer name and reason for both severities', () => {
    const conflicts: AutomationConflict[] = [
      {
        automation_id: 100,
        automation_name: 'Cabin Overheat Protection',
        reason: 'both fire on cabin temperature',
        severity: 'warning',
      },
      {
        automation_id: 101,
        automation_name: 'Scheduled Departure',
        reason: 'overlapping schedule window',
        severity: 'info',
      },
    ];
    const { container } = renderCard(makeAutomation({ conflicts }));

    expect(screen.getByText(/Cabin Overheat Protection/)).toBeInTheDocument();
    expect(screen.getByText(/Scheduled Departure/)).toBeInTheDocument();
    expect(container.textContent).toContain('both fire on cabin temperature');
    expect(container.textContent).toContain('overlapping schedule window');
    // "Conflict with" prefix appears once per conflict row.
    expect(screen.getAllByText(/Conflict with/)).toHaveLength(2);
  });

  it('renders no conflict rows when the conflicts array is empty', () => {
    renderCard(makeAutomation({ conflicts: [] }));
    expect(screen.queryByText(/Conflict with/)).not.toBeInTheDocument();
  });
});
