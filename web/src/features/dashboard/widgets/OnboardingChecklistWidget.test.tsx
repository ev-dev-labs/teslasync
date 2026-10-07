/**
 * OnboardingChecklistWidget — behaviour + hardening tests.
 *
 * OnboardingChecklistWidget is a dashboard tile that projects the live
 * onboarding-checklist state (`useChecklistTasks`) onto one of three surfaces
 * inside `WidgetShell`:
 *   - hidden      → a small "removed" footprint with a Restart affordance,
 *                   shown when the user dismissed the widget OR the 24h
 *                   post-completion celebration window has elapsed
 *                   (decided by the REAL `shouldHideChecklist`).
 *   - active      → a progress header (done/total + %, an accessible
 *                   `progressbar`), one row per visible task (completion glyph,
 *                   title, description, and a CTA button only while incomplete),
 *                   and — once every task is complete — a celebratory footer.
 *   - empty       → an explicit "no setup steps" empty state (never a blank
 *                   panel) when the hook yields zero tasks.
 *
 * The single stateful dependency (`useChecklistTasks`) is mocked at its module
 * boundary so every orchestration branch is exercised deterministically, while
 * the REAL `shouldHideChecklist` / `COMMAND_PALETTE_CTA` / `CELEBRATION_WINDOW_MS`
 * still run (via the partial mock) so the hide logic is integration-tested.
 * `useNavigate` is mocked to a hoisted spy to assert CTA routing without a real
 * router. `react-i18next` is echo-mocked (returns the English fallback,
 * interpolating `{{var}}`) so assertions target rendered English. Network is
 * never touched.
 *
 * Facets covered:
 *   - hidden (dismissed)         → "hidden" title, Restart wired to `restart`,
 *                                  full checklist suppressed.
 *   - hidden (celebration over)  → "all set" title after the window elapses.
 *   - active progress header     → done/total text, rounded %, progressbar
 *                                  aria-valuenow / aria-valuemax.
 *   - task rows                  → title + description; completed rows are
 *                                  flagged and CTA-less; incomplete rows expose
 *                                  a CTA.
 *   - CTA routing                → non-palette CTA → `navigate(ctaTo)`; palette
 *                                  sentinel → `toggle-command-palette` event and
 *                                  NO navigation.
 *   - dismiss                    → header control invokes `dismiss`.
 *   - completion footer          → 100% + celebratory footer inside the window;
 *                                  its dismiss control invokes `dismiss`.
 *   - empty                      → explicit empty state, "0/0 complete", "0%",
 *                                  no task list.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Car } from 'lucide-react';

// Hoisted navigate spy so the react-router-dom factory can reference it.
const navigateSpy = vi.hoisted(() => vi.fn());

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Only useNavigate is intercepted — MemoryRouter et al. stay real.
vi.mock('react-router-dom', async (importActual) => {
  const actual = await importActual<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateSpy };
});

// Replace the stateful hook; keep shouldHideChecklist / COMMAND_PALETTE_CTA /
// CELEBRATION_WINDOW_MS real so the hide branch is integration-tested.
vi.mock('@/features/onboarding/checklist', async (importActual) => {
  const actual = await importActual<typeof import('@/features/onboarding/checklist')>();
  return { ...actual, useChecklistTasks: vi.fn() };
});

// jsdom lacks matchMedia; some transitively-imported UI reaches for it.
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

import OnboardingChecklistWidget from './OnboardingChecklistWidget';
import {
  CELEBRATION_WINDOW_MS,
  COMMAND_PALETTE_CTA,
  useChecklistTasks,
} from '@/features/onboarding/checklist';
import type {
  ChecklistState,
  ChecklistTask,
} from '@/features/onboarding/checklist';
import type { WidgetSize } from './types';

const mockUseChecklist = vi.mocked(useChecklistTasks);

const SIZE: WidgetSize = { cols: 2, rows: 2 };

function makeTask(over: Partial<ChecklistTask> = {}): ChecklistTask {
  return {
    id: 'connect-vehicle',
    titleKey: 'checklist.tasks.connectVehicle.title',
    titleFallback: 'Connect your Tesla',
    descriptionKey: 'checklist.tasks.connectVehicle.description',
    descriptionFallback: 'Link your Tesla account to start syncing data.',
    ctaKey: 'checklist.tasks.connectVehicle.cta',
    ctaFallback: 'Connect',
    ctaTo: '/tesla-account',
    complete: false,
    icon: Car,
    ...over,
  };
}

/** Build a fully-resolved ChecklistState; caller overrides win, gaps derive. */
function makeState(over: Partial<ChecklistState> = {}): ChecklistState {
  const visibleTasks = over.visibleTasks ?? over.tasks ?? [makeTask()];
  const totalCount = over.totalCount ?? visibleTasks.length;
  const completeCount =
    over.completeCount ?? visibleTasks.filter((task) => task.complete).length;
  const allComplete =
    over.allComplete ?? (totalCount > 0 && completeCount === totalCount);
  return {
    tasks: over.tasks ?? visibleTasks,
    visibleTasks,
    completeCount,
    totalCount,
    allComplete,
    dismissed: over.dismissed ?? false,
    completedAt: over.completedAt ?? null,
    dismiss: over.dismiss ?? vi.fn(),
    restart: over.restart ?? vi.fn(),
  };
}

function renderWidget() {
  return render(
    <MemoryRouter>
      <OnboardingChecklistWidget size={SIZE} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  navigateSpy.mockReset();
  mockUseChecklist.mockReturnValue(makeState());
});

afterEach(() => {
  cleanup();
});

describe('OnboardingChecklistWidget — hidden footprint', () => {
  it('renders the dismissed footprint with a Restart affordance (not the full checklist)', () => {
    const restart = vi.fn();
    mockUseChecklist.mockReturnValue(
      makeState({
        dismissed: true,
        restart,
        visibleTasks: [makeTask({ complete: false })],
      }),
    );
    const { container } = renderWidget();

    expect(screen.getByText('Setup checklist hidden')).toBeInTheDocument();
    // The active task list must NOT render in the hidden state.
    expect(
      container.querySelector('[data-testid="onboarding-checklist"]'),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Restart checklist' }));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('shows the celebratory title once complete but past the celebration window', () => {
    const staleCompletedAt = Date.now() - (CELEBRATION_WINDOW_MS + 60_000);
    mockUseChecklist.mockReturnValue(
      makeState({
        allComplete: true,
        completedAt: staleCompletedAt,
        visibleTasks: [makeTask({ complete: true })],
      }),
    );
    renderWidget();

    // shouldHideChecklist (real) hides it; the title flips to the "all set" copy.
    expect(screen.getByText("You're all set! 🎉")).toBeInTheDocument();
    expect(screen.queryByTestId('onboarding-checklist')).toBeNull();
  });
});

describe('OnboardingChecklistWidget — active checklist', () => {
  it('renders the widget title, progress copy, rounded %, and an accessible progressbar', () => {
    const tasks = [
      makeTask({ id: 'a', complete: true }),
      makeTask({ id: 'b', complete: false }),
      makeTask({ id: 'c', complete: false }),
    ];
    mockUseChecklist.mockReturnValue(
      makeState({ visibleTasks: tasks, totalCount: 3, completeCount: 1 }),
    );
    renderWidget();

    expect(screen.getByText('Get started')).toBeInTheDocument();
    expect(screen.getByText('1/3 complete')).toBeInTheDocument();
    expect(screen.getByText('33%')).toBeInTheDocument();

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '3');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
  });

  it('lists each task with title + description, flags completed rows, and gates the CTA on incompleteness', () => {
    const tasks = [
      makeTask({
        id: 'connect-vehicle',
        titleFallback: 'Connect your Tesla',
        descriptionFallback: 'Link your Tesla account.',
        complete: true,
        ctaFallback: 'Connect',
      }),
      makeTask({
        id: 'pick-theme',
        titleFallback: 'Pick a theme',
        descriptionFallback: 'Choose an accent color.',
        complete: false,
        ctaFallback: 'Open',
        ctaTo: '/settings#appearance',
      }),
    ];
    mockUseChecklist.mockReturnValue(
      makeState({ visibleTasks: tasks, totalCount: 2, completeCount: 1 }),
    );
    const { container } = renderWidget();

    expect(screen.getByText('Connect your Tesla')).toBeInTheDocument();
    expect(screen.getByText('Pick a theme')).toBeInTheDocument();
    expect(screen.getByText('Choose an accent color.')).toBeInTheDocument();

    const completedRow = container.querySelector(
      '[data-testid="checklist-task-connect-vehicle"]',
    );
    const pendingRow = container.querySelector(
      '[data-testid="checklist-task-pick-theme"]',
    );
    expect(completedRow).toHaveAttribute('data-complete', 'true');
    expect(pendingRow).toHaveAttribute('data-complete', 'false');

    // Completed task exposes no CTA; only the incomplete task does.
    expect(screen.queryByRole('button', { name: /Connect/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Open/ })).toBeInTheDocument();
  });
});

describe('OnboardingChecklistWidget — CTA routing', () => {
  it('navigates to the task target for a non-palette CTA', () => {
    mockUseChecklist.mockReturnValue(
      makeState({
        visibleTasks: [
          makeTask({ id: 'connect-vehicle', ctaTo: '/tesla-account', ctaFallback: 'Connect' }),
        ],
        totalCount: 1,
        completeCount: 0,
      }),
    );
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: /Connect/ }));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/tesla-account');
  });

  it('dispatches toggle-command-palette (and does NOT navigate) for the palette sentinel CTA', () => {
    const handler = vi.fn();
    window.addEventListener('toggle-command-palette', handler);
    mockUseChecklist.mockReturnValue(
      makeState({
        visibleTasks: [
          makeTask({
            id: 'try-command-palette',
            ctaTo: COMMAND_PALETTE_CTA,
            ctaFallback: 'Open',
          }),
        ],
        totalCount: 1,
        completeCount: 0,
      }),
    );
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: /Open/ }));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();

    window.removeEventListener('toggle-command-palette', handler);
  });
});

describe('OnboardingChecklistWidget — dismiss & completion', () => {
  it('invokes dismiss when the header dismiss control is activated', () => {
    const dismiss = vi.fn();
    mockUseChecklist.mockReturnValue(
      makeState({
        dismiss,
        visibleTasks: [makeTask({ complete: false })],
        totalCount: 1,
        completeCount: 0,
      }),
    );
    renderWidget();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  it('renders the celebration footer (100%, no CTAs) inside the window and wires its dismiss control', () => {
    const dismiss = vi.fn();
    const recentCompletedAt = Date.now() - 60_000;
    const tasks = [
      makeTask({ id: 'a', complete: true, ctaFallback: 'Open' }),
      makeTask({ id: 'b', complete: true, ctaFallback: 'Open' }),
    ];
    mockUseChecklist.mockReturnValue(
      makeState({
        allComplete: true,
        completedAt: recentCompletedAt,
        dismiss,
        visibleTasks: tasks,
        totalCount: 2,
        completeCount: 2,
      }),
    );
    renderWidget();

    // Still inside the 24h window — the full checklist stays visible.
    expect(screen.getByTestId('onboarding-checklist')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText("You're all set! 🎉")).toBeInTheDocument();
    // Every task complete → no CTAs.
    expect(screen.queryByRole('button', { name: /Open/ })).toBeNull();

    // Two "Dismiss" affordances exist (header icon-button + footer button);
    // both are wired to dismiss. Activate the footer one.
    const dismissButtons = screen.getAllByRole('button', { name: 'Dismiss' });
    expect(dismissButtons).toHaveLength(2);
    fireEvent.click(dismissButtons[dismissButtons.length - 1]);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe('OnboardingChecklistWidget — empty state', () => {
  it('shows an explicit empty state (never a blank panel) when there are no visible tasks', () => {
    mockUseChecklist.mockReturnValue(
      makeState({ visibleTasks: [], totalCount: 0, completeCount: 0 }),
    );
    renderWidget();

    expect(
      screen.getByText('No setup steps available right now.'),
    ).toBeInTheDocument();
    expect(screen.getByText('0/0 complete')).toBeInTheDocument();
    expect(screen.getByText('0%')).toBeInTheDocument();
    // The empty branch replaces the task list entirely.
    expect(screen.queryByTestId('onboarding-checklist')).toBeNull();
  });
});
