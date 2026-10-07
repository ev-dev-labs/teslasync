/**
 * CommandHistoryWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans a single hook (`useCommandHistory`, keyed off the resolved
 * vehicle id from `useVehicles`) into two responsive layouts (compact 1×N
 * single-command summary / standard event feed) plus four pure display
 * helpers. This suite drives every export:
 *
 *   - the pure helpers (`formatCommandName`, `commandStatusVisual`,
 *     `commandBadgeVariant`, `commandStatusLabel`) are unit-tested across ALL
 *     branches and the hardened edge cases (null / empty / whitespace command
 *     names that used to render a void label; unknown / missing statuses);
 *   - the component is exercised through its accessible surface for the
 *     loading / empty / error paths of each layout, the populated standard
 *     feed (titles + status subtitles + unknown-status fallback), the compact
 *     single-command summary (badge variant + label, list[0] selection), the
 *     empty-command-name hardening, the vehicle-id resolution (explicit prop →
 *     first vehicle → none), and the refresh interaction.
 *
 * `useCommandHistory` + `useVehicles` are mocked at the hook boundary so no
 * network is touched (the `importActual` spread preserves the modules' other
 * exports, which are transitively imported elsewhere in the render tree).
 * `react-i18next` is stubbed to echo the English fallback and interpolate
 * `{{var}}` tokens so assertions target rendered copy. `@testing-library/
 * user-event` is not installed in this repo (see the sibling BackupMonitorWidget
 * / ChargeSessionChartWidget suites), so the one interaction goes through
 * `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any count/time-bearing copy (DataFreshness, WidgetEventFeed)
// renders as real text.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data sources become controllable vi.fns. `importActual` keeps the
// modules' other exports intact because `@/api/hooks/useVehicles` in particular
// is transitively imported by the globally-mocked timezone helper.
vi.mock('@/api/hooks/useCommands', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useCommands')>(
    '@/api/hooks/useCommands',
  );
  return { ...actual, useCommandHistory: vi.fn() };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
    '@/api/hooks/useVehicles',
  );
  return { ...actual, useVehicles: vi.fn() };
});

import CommandHistoryWidget, {
  formatCommandName,
  commandStatusVisual,
  commandBadgeVariant,
  commandStatusLabel,
} from './CommandHistoryWidget';
import { useCommandHistory } from '@/api/hooks/useCommands';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { CommandLogEntry } from '@/api/hooks/useCommands';
import type { WidgetSize } from './types';

const mockUseCommandHistory = vi.mocked(useCommandHistory);
const mockUseVehicles = vi.mocked(useVehicles);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Identity translate matching the widget's `TranslateFn` contract. */
const tid = (_key: string, fallback: string): string => fallback;

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

let cmdSeq = 0;
function makeCmd(over: Partial<CommandLogEntry> = {}): CommandLogEntry {
  cmdSeq += 1;
  return {
    id: cmdSeq,
    vehicle_id: 1,
    command: 'wake_up',
    params: '{}',
    status: 'success',
    error: '',
    created_at: new Date(Date.UTC(2024, 4, 1, 10, 0, 0)).toISOString(),
    ...over,
  };
}

function renderWidget(size: WidgetSize, vehicleId?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CommandHistoryWidget size={size} vehicleId={vehicleId} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 3, rows: 2 };

beforeEach(() => {
  cmdSeq = 0;
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] } as any);
  mockUseCommandHistory.mockReturnValue(qr());
});

// ── Pure helper: formatCommandName ─────────────────────────────────────────

describe('formatCommandName', () => {
  it('humanises snake_case identifiers and capitalises each word', () => {
    expect(formatCommandName('wake_up')).toBe('Wake Up');
    expect(formatCommandName('honk_horn')).toBe('Honk Horn');
    expect(formatCommandName('set_charge_limit')).toBe('Set Charge Limit');
    expect(formatCommandName('flash')).toBe('Flash');
  });

  it('collapses null / undefined / empty / whitespace to an em-dash', () => {
    expect(formatCommandName(null)).toBe('—');
    expect(formatCommandName(undefined)).toBe('—');
    expect(formatCommandName('')).toBe('—');
    expect(formatCommandName('   ')).toBe('—');
  });
});

// ── Pure helper: commandStatusVisual ───────────────────────────────────────

describe('commandStatusVisual', () => {
  it('maps each known status to its colour + severity with an icon', () => {
    const success = commandStatusVisual('success');
    expect(success.color).toBe('#22c55e');
    expect(success.severity).toBe('info');
    expect(success.icon).toBeTruthy();

    expect(commandStatusVisual('failed').color).toBe('#ef4444');
    expect(commandStatusVisual('failed').severity).toBe('critical');
    expect(commandStatusVisual('pending').color).toBe('#f59e0b');
    expect(commandStatusVisual('pending').severity).toBe('warning');
  });

  it('falls back to a neutral visual for unknown / missing statuses', () => {
    for (const s of ['queued', '', null, undefined] as const) {
      const v = commandStatusVisual(s);
      expect(v.color).toBe('#6b7280');
      expect(v.severity).toBe('info');
      expect(v.icon).toBeTruthy();
    }
  });
});

// ── Pure helpers: commandBadgeVariant / commandStatusLabel ──────────────────

describe('commandBadgeVariant', () => {
  it('maps success/failed to their variants and everything else to warning', () => {
    expect(commandBadgeVariant('success')).toBe('success');
    expect(commandBadgeVariant('failed')).toBe('danger');
    expect(commandBadgeVariant('pending')).toBe('warning');
    expect(commandBadgeVariant('mystery')).toBe('warning');
    expect(commandBadgeVariant(null)).toBe('warning');
  });
});

describe('commandStatusLabel', () => {
  it('translates each status, defaulting unknowns to Pending', () => {
    expect(commandStatusLabel('success', tid)).toBe('Success');
    expect(commandStatusLabel('failed', tid)).toBe('Failed');
    expect(commandStatusLabel('pending', tid)).toBe('Pending');
    expect(commandStatusLabel('mystery', tid)).toBe('Pending');
    expect(commandStatusLabel(undefined, tid)).toBe('Pending');
  });
});

// ── Component: async states ────────────────────────────────────────────────

describe('CommandHistoryWidget states', () => {
  it('renders a skeleton (no title, no empty copy) while loading', () => {
    mockUseCommandHistory.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Command History')).toBeNull();
    expect(screen.queryByText('No commands sent')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there are no commands — standard', () => {
    mockUseCommandHistory.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);
    const empty = screen.getByText('No commands sent');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('shows an empty state when there are no commands — compact', () => {
    mockUseCommandHistory.mockReturnValue(qr({ data: [] }));
    renderWidget(COMPACT);
    expect(screen.getByText('No commands sent')).toBeInTheDocument();
  });

  it('degrades to the empty panel (never blank) but keeps refresh when the query errors', () => {
    mockUseCommandHistory.mockReturnValue(qr({ data: undefined, isError: true }));
    renderWidget(STANDARD);
    // Title still renders (not gated behind data) and the panel is not blank.
    expect(screen.getByText('Command History')).toBeInTheDocument();
    expect(screen.getByText('No commands sent')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });
});

// ── Component: standard layout (event feed) ────────────────────────────────

describe('CommandHistoryWidget standard layout', () => {
  it('renders the title and a humanised, status-annotated row per command', () => {
    mockUseCommandHistory.mockReturnValue(
      qr({
        data: [
          makeCmd({ command: 'wake_up', status: 'success' }),
          makeCmd({ command: 'honk_horn', status: 'failed' }),
        ],
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Command History')).toBeInTheDocument();
    expect(screen.getByText('Wake Up')).toBeInTheDocument();
    expect(screen.getByText('Honk Horn')).toBeInTheDocument();
    // The raw status is threaded through as the row subtitle.
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('failed')).toBeInTheDocument();
  });

  it('renders an unknown status through the neutral fallback without crashing', () => {
    mockUseCommandHistory.mockReturnValue(
      qr({ data: [makeCmd({ command: 'flash_lights', status: 'weird' })] }),
    );
    renderWidget(STANDARD);
    expect(screen.getByText('Flash Lights')).toBeInTheDocument();
    expect(screen.getByText('weird')).toBeInTheDocument();
  });

  it('renders an em-dash title for a blank command name (hardening)', () => {
    mockUseCommandHistory.mockReturnValue(
      qr({ data: [makeCmd({ command: '', status: 'success' })] }),
    );
    renderWidget(STANDARD);
    // Without the formatCommandName guard this row title rendered empty.
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});

// ── Component: compact layout (single-command summary) ─────────────────────

describe('CommandHistoryWidget compact layout', () => {
  it('summarises only the first (newest) command with a status badge', () => {
    mockUseCommandHistory.mockReturnValue(
      qr({
        data: [
          makeCmd({ command: 'wake_up', status: 'success' }),
          makeCmd({ command: 'honk_horn', status: 'failed' }),
        ],
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('Wake Up')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    // Compact shows a single command — later entries are not listed.
    expect(screen.queryByText('Honk Horn')).toBeNull();
  });

  it('shows the Failed badge when the newest command failed', () => {
    mockUseCommandHistory.mockReturnValue(
      qr({ data: [makeCmd({ command: 'lock', status: 'failed' })] }),
    );
    renderWidget(COMPACT);
    expect(screen.getByText('Lock')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows the Pending badge for an unknown newest status', () => {
    mockUseCommandHistory.mockReturnValue(
      qr({ data: [makeCmd({ command: 'vent', status: 'queued' })] }),
    );
    renderWidget(COMPACT);
    expect(screen.getByText('Vent')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('renders an em-dash for a blank newest command name (hardening)', () => {
    mockUseCommandHistory.mockReturnValue(
      qr({ data: [makeCmd({ command: '', status: 'success' })] }),
    );
    renderWidget(COMPACT);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });
});

// ── Component: vehicle-id resolution ───────────────────────────────────────

describe('CommandHistoryWidget vehicle resolution', () => {
  it('keys the history query on the explicit vehicleId prop', () => {
    renderWidget(STANDARD, 7);
    expect(mockUseCommandHistory).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle when no vehicleId prop is given', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 3 }] } as any);
    renderWidget(STANDARD);
    expect(mockUseCommandHistory).toHaveBeenCalledWith('3');
  });

  it('passes undefined (disabling the query) when no vehicle resolves', () => {
    mockUseVehicles.mockReturnValue({ data: [] } as any);
    renderWidget(STANDARD);
    expect(mockUseCommandHistory).toHaveBeenCalledWith(undefined);
  });
});

// ── Component: refresh interaction ─────────────────────────────────────────

describe('CommandHistoryWidget refresh', () => {
  it('invokes refetch when the freshness refresh control is activated', () => {
    const refetch = vi.fn();
    mockUseCommandHistory.mockReturnValue(
      qr({ data: [makeCmd()], refetch, isFetching: false }),
    );
    renderWidget(STANDARD);

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
