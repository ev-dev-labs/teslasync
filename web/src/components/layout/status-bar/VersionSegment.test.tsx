/**
 * VersionSegment behaviour tests.
 *
 * VersionSegment is the footer status-bar chip that surfaces the running
 * app version + git SHA and, on click, opens an "About this build" modal
 * with full provenance, an update-available banner, and links to the
 * changelog / release notes.
 *
 * The file exports a single symbol (VersionSegment); this suite exercises
 * every branch reachable through it:
 *
 *   - the version-label resolution order (server app_version → build →
 *     'dev'), including the `'unknown'` sentinel fallback,
 *   - the accessible-name contract for the trigger (aria-haspopup +
 *     aria-expanded) and the a11y hardening that surfaces BOTH the
 *     update-available and unseen-changelog states in the button's
 *     accessible name (they were previously invisible to screen readers),
 *   - the decorative amber / cyan indicator dots and their precedence,
 *   - the tooltip content (version, uptime, unseen hint),
 *   - the modal: open/close wiring, aria-expanded flip, the optional
 *     provenance rows (chart / go / platform / uptime) and their
 *     hide-when-absent branches, the update banner, and the three footer
 *     actions ("What's new", "Release notes", "Close") + Escape,
 *   - the `uptimeLabel` day/hour/minute formatting branches, surfaced via
 *     the modal's "Server uptime" row.
 *
 * Network is stubbed by mocking the shared `request()` client and routing
 * by URL, mirroring the api-hook test convention. `@testing-library/user-event`
 * is not a dependency of this codebase (web/package.json), so interactions go
 * through `fireEvent`, consistent with the sibling NotificationBellPopover
 * and AI SSE-wiring suites.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  cleanup,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Mock } from 'vitest';
import type { ReactElement } from 'react';
import '@/i18n';

import type { VersionInfo, UpdateCheckResult } from '@/api/types';
import type { UseChangelogResult } from '@/hooks/useChangelog';

// ── Mocks (hoisted by vitest above the imports below) ─────────────────
vi.mock('@/api/client', () => ({
  request: vi.fn(),
}));

vi.mock('@/hooks/useChangelog', () => ({
  useChangelog: vi.fn(),
  openChangelogModal: vi.fn(),
}));

import { request } from '@/api/client';
import { useChangelog, openChangelogModal } from '@/hooks/useChangelog';
import { VersionSegment } from './VersionSegment';

const mockRequest = request as unknown as Mock;
const mockUseChangelog = useChangelog as unknown as Mock;
const mockOpenChangelog = openChangelogModal as unknown as Mock;

// The same Vite `define` that injects these build constants into the
// component also rewrites them in this test module, so reading them here keeps
// the expectations in lock-step with whatever the build stamped (package.json
// version + short git SHA, or their 'dev' fallbacks) — no brittle literals.
const BUILD_VERSION = (import.meta.env.VITE_APP_VERSION as string) || 'dev';
const BUILD_SHA = (import.meta.env.VITE_GIT_SHA as string) || 'dev';

// ── Fixtures / helpers ────────────────────────────────────────────────
const VERSION_URL = '/system/version';
const UPDATE_URL = '/system/update-check';

function makeVersionInfo(overrides: Partial<VersionInfo> = {}): VersionInfo {
  return {
    app_version: '2.3.4',
    chart_version: '2.0.1',
    go_version: 'go1.25.0',
    os: 'linux',
    arch: 'amd64',
    uptime_seconds: 200_000, // → "2d 7h"
    goroutines: 42,
    ...overrides,
  };
}

function makeUpdateCheck(
  overrides: Partial<UpdateCheckResult> = {},
): UpdateCheckResult {
  return {
    current: '2.3.4',
    latest: '2.3.4',
    update_available: false,
    ...overrides,
  };
}

function makeChangelog(
  overrides: Partial<UseChangelogResult> = {},
): UseChangelogResult {
  return {
    entries: [],
    latestVersion: '2.3.4',
    seenVersion: '2.3.4',
    hasUnseen: false,
    newEntries: [],
    markSeen: vi.fn(),
    stampShown: vi.fn(),
    canAutoShow: false,
    hasCompletedOnboarding: true,
    ...overrides,
  };
}

// `newEntries` is only read for its `.length` (the "{{count}} new release(s)"
// interpolation), so shape-cast N stand-in entries.
function entriesOfLength(n: number): UseChangelogResult['newEntries'] {
  return Array.from({ length: n }, (_, i) => ({
    version: `9.9.${i}`,
    date: '2024-01-01',
    title: `Release ${i}`,
  })) as unknown as UseChangelogResult['newEntries'];
}

// Route the mocked request() by URL so BOTH queries resolve deterministically.
function wireRequests(
  opts: {
    version?: VersionInfo | Error;
    update?: UpdateCheckResult | Error;
  } = {},
) {
  const version = opts.version ?? makeVersionInfo();
  const update = opts.update ?? makeUpdateCheck();
  mockRequest.mockImplementation((path: string) => {
    if (path === VERSION_URL) {
      return version instanceof Error
        ? Promise.reject(version)
        : Promise.resolve(version);
    }
    if (path === UPDATE_URL) {
      return update instanceof Error
        ? Promise.reject(update)
        : Promise.resolve(update);
    }
    return Promise.reject(new Error(`unexpected request path: ${path}`));
  });
}

function renderSegment(ui?: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      {ui ?? <VersionSegment />}
    </QueryClientProvider>,
  );
}

async function findResolvedTrigger(): Promise<HTMLElement> {
  renderSegment();
  const trigger = await screen.findByRole('button', {
    name: /TeslaSync version/i,
  });
  // Wait until the /system/version query has resolved into the label.
  await waitFor(() => expect(trigger).toHaveAccessibleName(/v2\.3\.4/));
  return trigger;
}

beforeEach(() => {
  cleanup();
  mockRequest.mockReset();
  mockUseChangelog.mockReset();
  mockOpenChangelog.mockReset();
  wireRequests();
  mockUseChangelog.mockReturnValue(makeChangelog());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Trigger chip ──────────────────────────────────────────────────────
describe('VersionSegment — trigger chip', () => {
  it('renders an accessible chip that advertises a collapsed dialog', async () => {
    const trigger = await findResolvedTrigger();

    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('v2.3.4');
  });

  it('resolves the server app_version in preference to the build fallback', async () => {
    wireRequests({ version: makeVersionInfo({ app_version: '5.6.7' }) });

    renderSegment();
    const trigger = await screen.findByRole('button', {
      name: /TeslaSync version/i,
    });
    await waitFor(() => expect(trigger).toHaveTextContent('v5.6.7'));
    expect(trigger).toHaveAccessibleName(/v5\.6\.7/);
    expect(mockRequest).toHaveBeenCalledWith(VERSION_URL);
  });

  it('falls back to the build version when the server reports "unknown"', async () => {
    wireRequests({ version: makeVersionInfo({ app_version: 'unknown' }) });

    renderSegment();
    const trigger = await screen.findByRole('button', {
      name: /TeslaSync version/i,
    });
    await waitFor(() =>
      expect(mockRequest).toHaveBeenCalledWith(VERSION_URL),
    );
    // The build fallback is used instead of the 'unknown' sentinel.
    expect(trigger).toHaveTextContent(`v${BUILD_VERSION}`);
    expect(trigger).not.toHaveTextContent('unknown');
  });

  it('iconOnly hides the visible version text + dots but keeps the accessible name', async () => {
    wireRequests({ update: makeUpdateCheck({ update_available: true }) });
    mockUseChangelog.mockReturnValue(
      makeChangelog({ hasUnseen: true, newEntries: entriesOfLength(2) }),
    );

    renderSegment(<VersionSegment iconOnly />);

    const trigger = await screen.findByRole('button', {
      name: /TeslaSync version/i,
    });
    await waitFor(() => expect(trigger).toHaveAccessibleName(/v2\.3\.4/));
    // Visible label + indicator dots are suppressed in icon-only mode…
    expect(trigger).not.toHaveTextContent('v2.3.4');
    expect(trigger.querySelector('.bg-amber-400')).toBeNull();
    expect(trigger.querySelector('.bg-cyan-400')).toBeNull();
    // …but the state is still fully described for assistive tech.
    expect(trigger).toHaveAccessibleName(/Update available/i);
    expect(trigger).toHaveAccessibleName(/unseen changelog/i);
  });
});

// ── Update / unseen indicators + a11y ─────────────────────────────────
describe('VersionSegment — update + unseen indicators', () => {
  it('surfaces update-available in the accessible name and shows a decorative amber dot', async () => {
    wireRequests({
      update: makeUpdateCheck({ update_available: true, latest: '2.5.0' }),
    });

    const trigger = await findResolvedTrigger();
    await waitFor(() =>
      expect(trigger).toHaveAccessibleName(/Update available/i),
    );

    const dot = trigger.querySelector('.bg-amber-400');
    expect(dot).not.toBeNull();
    // Dot is purely visual — the state lives in the button's name.
    expect(dot).toHaveAttribute('aria-hidden', 'true');
  });

  it('surfaces unseen-changelog and shows a cyan dot when no update is pending', async () => {
    mockUseChangelog.mockReturnValue(
      makeChangelog({ hasUnseen: true, newEntries: entriesOfLength(3) }),
    );

    const trigger = await findResolvedTrigger();
    expect(trigger).toHaveAccessibleName(/unseen changelog/i);
    expect(trigger.querySelector('.bg-cyan-400')).not.toBeNull();
    expect(trigger.querySelector('.bg-amber-400')).toBeNull();
  });

  it('prefers the amber update dot over the cyan dot while still naming both states', async () => {
    wireRequests({
      update: makeUpdateCheck({ update_available: true, latest: '3.0.0' }),
    });
    mockUseChangelog.mockReturnValue(
      makeChangelog({ hasUnseen: true, newEntries: entriesOfLength(1) }),
    );

    const trigger = await findResolvedTrigger();
    await waitFor(() =>
      expect(trigger).toHaveAccessibleName(/Update available/i),
    );
    expect(trigger).toHaveAccessibleName(/unseen changelog/i);
    // Only one dot renders; update wins the visual slot.
    expect(trigger.querySelector('.bg-amber-400')).not.toBeNull();
    expect(trigger.querySelector('.bg-cyan-400')).toBeNull();
  });

  it('omits both indicators (dots + name clauses) when caught up with no update', async () => {
    const trigger = await findResolvedTrigger();

    expect(trigger.getAttribute('aria-label')).not.toMatch(/Update available/i);
    expect(trigger.getAttribute('aria-label')).not.toMatch(/unseen changelog/i);
    expect(trigger.querySelector('.bg-amber-400')).toBeNull();
    expect(trigger.querySelector('.bg-cyan-400')).toBeNull();
  });
});

// ── Tooltip ───────────────────────────────────────────────────────────
describe('VersionSegment — tooltip', () => {
  it('renders a role="tooltip" carrying version, uptime, and the unseen hint', async () => {
    mockUseChangelog.mockReturnValue(
      makeChangelog({ hasUnseen: true, newEntries: entriesOfLength(3) }),
    );

    renderSegment();

    const tip = screen.getByRole('tooltip');
    await waitFor(() => expect(tip).toHaveTextContent('v2.3.4'));
    expect(tip).toHaveTextContent(/TeslaSync version/);
    expect(tip).toHaveTextContent(/up 2d 7h/);
    expect(tip).toHaveTextContent(/3 new release\(s\)/);
  });

  it('drops the uptime segment when the server reports non-positive uptime', async () => {
    wireRequests({ version: makeVersionInfo({ uptime_seconds: 0 }) });

    renderSegment();

    const tip = screen.getByRole('tooltip');
    await waitFor(() => expect(tip).toHaveTextContent('v2.3.4'));
    expect(tip.textContent ?? '').not.toMatch(/up/i);
  });
});

// ── Modal ─────────────────────────────────────────────────────────────
describe('VersionSegment — About modal', () => {
  async function openModal(): Promise<{ trigger: HTMLElement; dialog: HTMLElement }> {
    const trigger = await findResolvedTrigger();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog');
    return { trigger, dialog };
  }

  it('opens the About dialog on click, flips aria-expanded, and lists core provenance', async () => {
    const { trigger, dialog } = await openModal();

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(
      within(dialog).getByRole('heading', { name: /About this build/i }),
    ).toBeInTheDocument();

    expect(within(dialog).getByText('App version')).toBeInTheDocument();
    expect(within(dialog).getByText('v2.3.4')).toBeInTheDocument();
    expect(within(dialog).getByText('Commit')).toBeInTheDocument();
    // git SHA is a build-time constant (short HEAD sha, or 'dev' fallback).
    expect(within(dialog).getByText(BUILD_SHA)).toBeInTheDocument();
  });

  it('renders the optional chart / go / platform / uptime rows when present', async () => {
    const { dialog } = await openModal();

    expect(within(dialog).getByText('Helm chart')).toBeInTheDocument();
    expect(within(dialog).getByText('v2.0.1')).toBeInTheDocument();
    expect(within(dialog).getByText('Go runtime')).toBeInTheDocument();
    expect(within(dialog).getByText('go1.25.0')).toBeInTheDocument();
    expect(within(dialog).getByText('Platform')).toBeInTheDocument();
    expect(within(dialog).getByText('linux/amd64')).toBeInTheDocument();
    expect(within(dialog).getByText('Server uptime')).toBeInTheDocument();
    expect(within(dialog).getByText('2d 7h')).toBeInTheDocument();
  });

  it('hides the optional rows when the server omits them or reports "unknown"', async () => {
    wireRequests({
      version: makeVersionInfo({
        chart_version: 'unknown',
        go_version: '',
        os: '',
        arch: '',
        uptime_seconds: 0,
      }),
    });

    const { dialog } = await openModal();

    // Core rows always render…
    expect(within(dialog).getByText('App version')).toBeInTheDocument();
    expect(within(dialog).getByText('Commit')).toBeInTheDocument();
    // …optional ones fall away.
    expect(within(dialog).queryByText('Helm chart')).toBeNull();
    expect(within(dialog).queryByText('Go runtime')).toBeNull();
    expect(within(dialog).queryByText('Platform')).toBeNull();
    expect(within(dialog).queryByText('Server uptime')).toBeNull();
  });

  it('renders the update banner with the latest version and message', async () => {
    wireRequests({
      update: makeUpdateCheck({
        update_available: true,
        latest: '2.5.0',
        message: 'Security fixes included.',
      }),
    });

    const { dialog } = await openModal();

    expect(
      within(dialog).getByText(/A newer release is available: v2\.5\.0/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Security fixes included.'),
    ).toBeInTheDocument();
  });

  it('omits the update banner when no update is available', async () => {
    const { dialog } = await openModal();
    expect(
      within(dialog).queryByText(/A newer release is available/),
    ).toBeNull();
  });

  it('"What\'s new" dispatches the changelog modal and closes the About dialog', async () => {
    const { trigger, dialog } = await openModal();

    fireEvent.click(
      within(dialog).getByRole('button', { name: /What's new/i }),
    );

    expect(mockOpenChangelog).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('"Release notes" opens the GitHub releases page in a new tab', async () => {
    const openSpy = vi
      .spyOn(window, 'open')
      .mockReturnValue(null);

    const { dialog } = await openModal();
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Release notes/i }),
    );

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      'https://github.com/ev-dev-labs/teslasync/releases',
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('"Close" dismisses the dialog and restores aria-expanded on the trigger', async () => {
    const { trigger, dialog } = await openModal();

    const closeButtons = within(dialog).getAllByRole('button', {
      name: /^Close$/i,
    });
    // Both the modal header (aria-label) and the footer action are "Close".
    expect(closeButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(closeButtons[closeButtons.length - 1]);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('Escape closes the dialog', async () => {
    const { dialog } = await openModal();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

// ── uptimeLabel formatting (via the modal's Server-uptime row) ────────
describe('VersionSegment — uptime formatting branches', () => {
  const cases: Array<[number, string]> = [
    [200_000, '2d 7h'], // days branch
    [7_000, '1h 56m'], // hours branch
    [150, '2m'], // minutes branch
  ];

  it.each(cases)(
    'formats %d uptime seconds as "%s"',
    async (seconds, expected) => {
      wireRequests({ version: makeVersionInfo({ uptime_seconds: seconds }) });

      const trigger = await findResolvedTrigger();
      fireEvent.click(trigger);
      const dialog = await screen.findByRole('dialog');

      expect(within(dialog).getByText('Server uptime')).toBeInTheDocument();
      expect(within(dialog).getByText(expected)).toBeInTheDocument();
    },
  );
});
