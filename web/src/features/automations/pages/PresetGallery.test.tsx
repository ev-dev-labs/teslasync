/**
 * PresetGallery — behavioural coverage for the automation-preset card grid.
 *
 * The file exports a single component (`PresetGallery`) whose two private
 * helpers (`PresetCard`, `PresetCardSkeleton`) are exercised through the public
 * surface. `useAutomationPresets` is mocked at the hook boundary so each of the
 * four mutually-exclusive render states — loading / error / empty / loaded —
 * can be driven deterministically and asserted in isolation. No network is
 * touched.
 *
 * Facets covered:
 *   - Query wiring: the `category` prop is threaded to the hook (default +
 *     explicit) so the caching key can never silently drop.
 *   - Loading: four skeleton cards, no interactive controls.
 *   - Error: `QueryError` renders with a working Retry that calls `refetch`,
 *     AND the guard that keeps cached presets visible when a *background*
 *     refetch errors (error + data present → grid, not the error card).
 *   - Empty: the `EmptyState` status region for both `presets: []` and a fully
 *     absent `data` payload (the `?? []` null-safety path).
 *   - Loaded: name, description, per-kind trigger label (all four variants +
 *     the "no trigger" fallback), interpolated action-count badge, and the
 *     icon map (known icon + unknown-icon → Shield fallback).
 *   - Null-safety: a preset whose `triggers`/`actions` arrive `undefined` must
 *     not crash and must degrade to the "no trigger" + "0 actions" copy.
 *   - Interaction: clicking Install navigates to the builder with the preset id.
 *   - a11y: the Install control carries a disambiguating per-preset accessible
 *     name and its decorative icons are `aria-hidden`.
 *
 * i18n is stubbed to echo each `t(key, fallback, opts)` fallback and interpolate
 * `{{var}}` placeholders so assertions read against the English copy.
 * `useNavigate` is mocked to a spy; a `<MemoryRouter>` still wraps every render
 * so the real router context is present for transitive consumers (QueryError).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ReactNode } from 'react';

import { PresetGallery } from './PresetGallery';
import { useAutomationPresets } from '@/api/hooks/useAutomations';
import type { AutomationPreset } from '@/api/types';

// ── i18n stub — echo the fallback, interpolate {{var}} tokens ────────────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      fallback?: string | Record<string, unknown>,
      opts?: Record<string, unknown>,
    ) => {
      const template = typeof fallback === 'string' ? fallback : key;
      const vars = (typeof fallback === 'string' ? opts : fallback) as
        | Record<string, unknown>
        | undefined;
      return template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
        vars && name in vars ? String(vars[name]) : `{{${name}}}`,
      );
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Router — spy on navigate, keep the real MemoryRouter/Link/etc. ───────────
const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

// ── Hook boundary — real module, single overridden export ────────────────────
vi.mock('@/api/hooks/useAutomations', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useAutomations')>();
  return { ...actual, useAutomationPresets: vi.fn() };
});

const mockUsePresets = vi.mocked(useAutomationPresets);

// jsdom lacks matchMedia; framer-motion (via <FadeIn>/<Stagger*>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
type HookResult = ReturnType<typeof useAutomationPresets>;

function hookResult(over: Partial<HookResult> = {}): HookResult {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as HookResult;
}

function makePreset(overrides: Partial<AutomationPreset> = {}): AutomationPreset {
  return {
    id: 'preset-1',
    name: 'Sentry Mode',
    description: 'Enable Sentry when parked away from home.',
    category: 'security',
    icon: 'Shield',
    triggers: [{ kind: 'trigger_schedule', cron_expr: '0 22 * * *', timezone: 'UTC' }],
    conditions: [],
    actions: [{ kind: 'action_command', command_name: 'lock' }],
    stop_on_failure: false,
    notify_on_run: false,
    notify_on_failure: false,
    ...overrides,
  };
}

function renderGallery(props: { category?: string } = {}) {
  return render(
    <MemoryRouter>
      <PresetGallery {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateMock.mockReset();
  mockUsePresets.mockReset();
});

// ── Query wiring ─────────────────────────────────────────────────────────────
describe('PresetGallery — query wiring', () => {
  it('calls the presets hook with no category by default', () => {
    mockUsePresets.mockReturnValue(hookResult({ data: { categories: [], presets: [] } }));
    renderGallery();
    expect(mockUsePresets).toHaveBeenCalledWith(undefined);
  });

  it('threads an explicit category through to the hook (cache key)', () => {
    mockUsePresets.mockReturnValue(hookResult({ data: { categories: [], presets: [] } }));
    renderGallery({ category: 'security' });
    expect(mockUsePresets).toHaveBeenCalledWith('security');
  });
});

// ── Loading state ────────────────────────────────────────────────────────────
describe('PresetGallery — loading state', () => {
  it('renders four skeleton cards and no interactive controls while loading', () => {
    mockUsePresets.mockReturnValue(hookResult({ isLoading: true }));
    const { container } = renderGallery();

    // Each PresetCardSkeleton contributes several animate-pulse placeholders;
    // four cards means comfortably more than four in the tree.
    const pulses = container.querySelectorAll('.animate-pulse');
    expect(pulses.length).toBeGreaterThanOrEqual(4);
    // Skeletons are non-interactive — no Install buttons, no error/empty status.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

// ── Error state ──────────────────────────────────────────────────────────────
describe('PresetGallery — error state', () => {
  it('renders QueryError with a Retry that re-fetches when the query fails', () => {
    const refetch = vi.fn();
    mockUsePresets.mockReturnValue(
      hookResult({ isError: true, error: new Error('boom'), refetch }),
    );
    renderGallery();

    // Network/unknown branch of QueryError for a plain Error.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps showing cached presets when a background refetch errors', () => {
    // isError is true but data is still present — the grid must win over the
    // error card so a transient refetch failure never blanks good content.
    mockUsePresets.mockReturnValue(
      hookResult({
        isError: true,
        error: new Error('stale'),
        data: { categories: [], presets: [makePreset({ id: 'kept', name: 'Kept Preset' })] },
      }),
    );
    renderGallery();

    expect(screen.getByText('Kept Preset')).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

// ── Empty state ──────────────────────────────────────────────────────────────
describe('PresetGallery — empty state', () => {
  it('renders the empty status region when the response has no presets', () => {
    mockUsePresets.mockReturnValue(hookResult({ data: { categories: [], presets: [] } }));
    renderGallery();

    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(screen.getByText('No preset templates available')).toBeInTheDocument();
  });

  it('treats a fully absent data payload as empty (null-safety on data?.presets)', () => {
    mockUsePresets.mockReturnValue(hookResult({ data: undefined }));
    renderGallery();

    expect(screen.getByText('No preset templates available')).toBeInTheDocument();
    // No cards rendered → no Install buttons.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

// ── Loaded — card content ────────────────────────────────────────────────────
describe('PresetGallery — card content', () => {
  it('renders name, description, trigger label and interpolated action count', () => {
    mockUsePresets.mockReturnValue(
      hookResult({
        data: {
          categories: [],
          presets: [
            makePreset({
              actions: [
                { kind: 'action_command', command_name: 'lock' },
                { kind: 'action_command', command_name: 'flash_lights' },
              ],
            }),
          ],
        },
      }),
    );
    renderGallery();

    expect(screen.getByRole('heading', { name: 'Sentry Mode' })).toBeInTheDocument();
    expect(
      screen.getByText('Enable Sentry when parked away from home.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('2 actions')).toBeInTheDocument();
  });

  it('maps a known icon and falls back to Shield for an unknown icon', () => {
    mockUsePresets.mockReturnValue(
      hookResult({
        data: {
          categories: [],
          presets: [
            makePreset({ id: 'a', name: 'Night', icon: 'Moon' }),
            makePreset({ id: 'b', name: 'Mystery', icon: 'DefinitelyNotAnIcon' }),
          ],
        },
      }),
    );
    const { container } = renderGallery();

    expect(container.querySelector('svg.lucide-moon')).not.toBeNull();
    // Unknown icon → the `?? Shield` fallback keeps a valid glyph.
    expect(container.querySelector('svg.lucide-shield')).not.toBeNull();
  });
});

// ── Loaded — trigger label variants ──────────────────────────────────────────
describe('PresetGallery — trigger labels', () => {
  it('renders the mapped label for every trigger kind', () => {
    mockUsePresets.mockReturnValue(
      hookResult({
        data: {
          categories: [],
          presets: [
            makePreset({
              id: 't1',
              name: 'Sched',
              triggers: [{ kind: 'trigger_schedule', cron_expr: '* * * * *', timezone: 'UTC' }],
            }),
            makePreset({
              id: 't2',
              name: 'Evt',
              triggers: [{ kind: 'trigger_event', event_type: 'drive_start' }],
            }),
            makePreset({
              id: 't3',
              name: 'Geo',
              triggers: [{ kind: 'trigger_geofence', place_id: 1, event: 'enter' }],
            }),
            makePreset({
              id: 't4',
              name: 'Sig',
              triggers: [{ kind: 'trigger_signal', signal: 'battery_level', op: '<' }],
            }),
          ],
        },
      }),
    );
    renderGallery();

    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('Vehicle Event')).toBeInTheDocument();
    expect(screen.getByText('Geofence')).toBeInTheDocument();
    expect(screen.getByText('Signal Threshold')).toBeInTheDocument();
  });

  it('shows the "no trigger" fallback for an empty triggers array', () => {
    mockUsePresets.mockReturnValue(
      hookResult({
        data: {
          categories: [],
          presets: [makePreset({ id: 'nt', name: 'No Trigger', triggers: [] })],
        },
      }),
    );
    renderGallery();

    expect(screen.getByText('No trigger configured')).toBeInTheDocument();
  });

  it('does not crash and degrades gracefully when triggers/actions are undefined', () => {
    // Runtime payloads can omit arrays the type marks as required — the guards
    // `triggers?.[0]` and `actions?.length ?? 0` must absorb that.
    const sparse = {
      ...makePreset({ id: 'sparse', name: 'Sparse' }),
      triggers: undefined,
      actions: undefined,
    } as unknown as AutomationPreset;
    mockUsePresets.mockReturnValue(
      hookResult({ data: { categories: [], presets: [sparse] } }),
    );

    expect(() => renderGallery()).not.toThrow();
    expect(screen.getByText('No trigger configured')).toBeInTheDocument();
    expect(screen.getByText('0 actions')).toBeInTheDocument();
  });
});

// ── Interaction + a11y ───────────────────────────────────────────────────────
describe('PresetGallery — install interaction & a11y', () => {
  it('navigates to the builder with the preset id when Install is clicked', () => {
    mockUsePresets.mockReturnValue(
      hookResult({
        data: {
          categories: [],
          presets: [makePreset({ id: 'sentry-away', name: 'Sentry Mode' })],
        },
      }),
    );
    renderGallery();

    fireEvent.click(screen.getByRole('button', { name: 'Install Sentry Mode' }));
    expect(navigateMock).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/automations/new?preset=sentry-away');
  });

  it('gives each Install control a disambiguating per-preset accessible name', () => {
    mockUsePresets.mockReturnValue(
      hookResult({
        data: {
          categories: [],
          presets: [
            makePreset({ id: 'a', name: 'Sentry Mode' }),
            makePreset({ id: 'b', name: 'Away Mode' }),
          ],
        },
      }),
    );
    renderGallery();

    // Two cards → two distinctly-named Install buttons (not two identical ones).
    expect(screen.getByRole('button', { name: 'Install Sentry Mode' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install Away Mode' })).toBeInTheDocument();
  });

  it('marks the decorative Install icon aria-hidden', () => {
    mockUsePresets.mockReturnValue(
      hookResult({
        data: { categories: [], presets: [makePreset({ id: 'a', name: 'Sentry Mode' })] },
      }),
    );
    const { container } = renderGallery();

    const plus = container.querySelector('svg.lucide-plus');
    expect(plus).not.toBeNull();
    expect(plus).toHaveAttribute('aria-hidden', 'true');
  });
});
