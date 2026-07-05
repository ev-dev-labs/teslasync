/**
 * BrowserNotificationsKpis — notification-surface KPI band contract.
 *
 * A pure presentational band that turns three inputs (browser permission +
 * support, per-event web-push prefs, and — read from hooks — tab-signal
 * settings and sound-channel prefs) into four MetricCards. These tests pin
 * every facet:
 *   - the permission KPI's four mutually-exclusive branches (unsupported wins
 *     over any permission, then granted / denied / default), each stating its
 *     status in *words* and carrying the matching neon colour (not colour
 *     alone) so the band stays legible for colour-blind users;
 *   - the push-events count (0/1/2 of 2) and its "N of M on" subtitle;
 *   - the tab-signals KPI, including the settings-still-loading branch that
 *     renders an em-dash with no subtitle rather than a fabricated count, the
 *     default-on behaviour (absent flags read as enabled), and explicit
 *     off/one-off splits;
 *   - the sound-channels count against the real category list (master gate +
 *     per-category filter, 0..N of N);
 *   - accessibility: the band is a labelled region and every metric icon is
 *     decorative (aria-hidden), so assistive tech announces labels/values, not
 *     glyphs;
 *   - defensive null-safety: an undefined `pushPrefs` prop and a malformed
 *     sound-prefs object degrade to honest zeros instead of throwing.
 * Nothing touches the network — the two data hooks are mocked and the
 * component is otherwise pure, reading only i18n resources.
 */
import { type ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@/i18n';

import { neonColorMap } from '@/lib/tokens';
import type { AppSettings } from '@/api/types';
import type { WebPushPreferences } from '@/hooks/useNotificationListener';
import type {
  NotificationSoundCategory,
  NotificationSoundPrefs,
} from '@/lib/notificationSound';

// The band reads settings via the react-query hook; a bare render() has no
// QueryClient, so stub it and drive `.data` per scenario.
const mockUseSettings = vi.fn();
vi.mock('@/api/hooks/useSettings', () => ({
  useSettings: () => mockUseSettings(),
}));

// Keep NOTIFICATION_SOUND_CATEGORIES real (the band counts against it) while
// swapping only the live-prefs hook for a controllable spy.
const mockUseSoundPrefs = vi.fn();
vi.mock('@/lib/notificationSound', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationSound')>(
    '@/lib/notificationSound',
  );
  return {
    ...actual,
    useNotificationSoundPrefs: () => mockUseSoundPrefs(),
  };
});

import { BrowserNotificationsKpis } from './BrowserNotificationsKpis';
import { NOTIFICATION_SOUND_CATEGORIES } from '@/lib/notificationSound';

type Props = ComponentProps<typeof BrowserNotificationsKpis>;

const TOTAL_CHANNELS = NOTIFICATION_SOUND_CATEGORIES.length;
/** Em-dash (U+2014) the band renders for a tab count that isn't known yet. */
const EM_DASH = '—';

const LABEL_PERMISSION = 'Browser permission';
const LABEL_PUSH = 'Push events';
const LABEL_TAB = 'Tab signals';
const LABEL_SOUND = 'Sound channels';
const ALL_LABELS = [LABEL_PERMISSION, LABEL_PUSH, LABEL_TAB, LABEL_SOUND];

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...overrides } as AppSettings;
}

function soundPrefs(
  master: boolean,
  active: NotificationSoundCategory[] = [],
): NotificationSoundPrefs {
  const perCategory = Object.fromEntries(
    NOTIFICATION_SOUND_CATEGORIES.map((c) => [c, active.includes(c)]),
  ) as NotificationSoundPrefs['perCategory'];
  return { master, perCategory, volume: 0.6 };
}

function baseProps(overrides: Partial<Props> = {}): Props {
  return {
    permission: 'default',
    notificationsSupported: true,
    pushPrefs: { alerts: false, exportStatus: false },
    ...overrides,
  };
}

function renderKpis(overrides: Partial<Props> = {}) {
  return render(<BrowserNotificationsKpis {...baseProps(overrides)} />);
}

/**
 * Read the value MetricCard renders for a label. MetricCard emits
 * `<p class="metric-label"><span>{label}</span></p>` immediately followed by
 * `<p class="text-xl">{value}</p>`, so we hop label span → parent → next
 * sibling without coupling to brittle value-node selectors.
 */
function metricValue(label: string): string {
  const labelSpan = screen.getByText(label);
  return labelSpan.parentElement?.nextElementSibling?.textContent ?? '';
}

/** The subtitle node (if any) sits after the value node; null when absent. */
function metricSubtitle(label: string): string | null {
  const labelSpan = screen.getByText(label);
  const valueEl = labelSpan.parentElement?.nextElementSibling;
  return valueEl?.nextElementSibling?.textContent ?? null;
}

/** className of the div wrapping a card's icon glyph — carries the neon text hue. */
function iconTextClass(label: string): string {
  const card = screen.getByText(label).closest('.p-3');
  return card?.querySelector('svg')?.parentElement?.className ?? '';
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults: settings loaded with both tab flags on, sound master off.
  mockUseSettings.mockReturnValue({ data: settings({ tab_badge_enabled: true, critical_flash_enabled: true }) });
  mockUseSoundPrefs.mockReturnValue(soundPrefs(false));
});

describe('BrowserNotificationsKpis — permission KPI', () => {
  it('shows "Unsupported" (amber) when notifications are unavailable, even if permission is granted', () => {
    renderKpis({ notificationsSupported: false, permission: 'granted' });

    // Unsupported must win over the granted permission value.
    expect(metricValue(LABEL_PERMISSION)).toBe('Unsupported');
    expect(iconTextClass(LABEL_PERMISSION)).toContain(neonColorMap.amber.text);
  });

  it('shows "Enabled" (green) when supported and granted', () => {
    renderKpis({ notificationsSupported: true, permission: 'granted' });

    expect(metricValue(LABEL_PERMISSION)).toBe('Enabled');
    expect(iconTextClass(LABEL_PERMISSION)).toContain(neonColorMap.green.text);
  });

  it('shows "Blocked" (red) when the user has denied permission', () => {
    renderKpis({ notificationsSupported: true, permission: 'denied' });

    expect(metricValue(LABEL_PERMISSION)).toBe('Blocked');
    expect(iconTextClass(LABEL_PERMISSION)).toContain(neonColorMap.red.text);
  });

  it('shows "Not enabled" (cyan) in the default, not-yet-asked state', () => {
    renderKpis({ notificationsSupported: true, permission: 'default' });

    expect(metricValue(LABEL_PERMISSION)).toBe('Not enabled');
    expect(iconTextClass(LABEL_PERMISSION)).toContain(neonColorMap.cyan.text);
  });
});

describe('BrowserNotificationsKpis — push-events KPI', () => {
  it('counts both enabled push events as 2/2 with a matching subtitle', () => {
    renderKpis({ pushPrefs: { alerts: true, exportStatus: true } });

    expect(metricValue(LABEL_PUSH)).toBe('2/2');
    expect(metricSubtitle(LABEL_PUSH)).toBe('2 of 2 on');
  });

  it('counts a single enabled push event as 1/2', () => {
    renderKpis({ pushPrefs: { alerts: true, exportStatus: false } });

    expect(metricValue(LABEL_PUSH)).toBe('1/2');
    expect(metricSubtitle(LABEL_PUSH)).toBe('1 of 2 on');
  });

  it('counts no enabled push events as 0/2', () => {
    renderKpis({ pushPrefs: { alerts: false, exportStatus: false } });

    expect(metricValue(LABEL_PUSH)).toBe('0/2');
    expect(metricSubtitle(LABEL_PUSH)).toBe('0 of 2 on');
  });
});

describe('BrowserNotificationsKpis — tab-signals KPI', () => {
  it('renders an em-dash and no subtitle while settings are still loading', () => {
    mockUseSettings.mockReturnValue({ data: undefined });
    renderKpis();

    // A missing settings payload must not be dressed up as a truthful "2/2".
    expect(metricValue(LABEL_TAB)).toBe(EM_DASH);
    expect(metricSubtitle(LABEL_TAB)).toBeNull();
  });

  it('treats absent tab flags as enabled (defaults on) → 2/2', () => {
    // An empty-but-present settings object: neither flag is explicitly false.
    mockUseSettings.mockReturnValue({ data: settings() });
    renderKpis();

    expect(metricValue(LABEL_TAB)).toBe('2/2');
    expect(metricSubtitle(LABEL_TAB)).toBe('2 of 2 on');
  });

  it('counts both tab signals off as 0/2 when explicitly disabled', () => {
    mockUseSettings.mockReturnValue({
      data: settings({ tab_badge_enabled: false, critical_flash_enabled: false }),
    });
    renderKpis();

    expect(metricValue(LABEL_TAB)).toBe('0/2');
    expect(metricSubtitle(LABEL_TAB)).toBe('0 of 2 on');
  });

  it('counts a single disabled tab signal as 1/2', () => {
    mockUseSettings.mockReturnValue({
      data: settings({ tab_badge_enabled: false, critical_flash_enabled: true }),
    });
    renderKpis();

    expect(metricValue(LABEL_TAB)).toBe('1/2');
  });
});

describe('BrowserNotificationsKpis — sound-channels KPI', () => {
  it('reports zero active channels when the master switch is off, regardless of per-category flags', () => {
    // Every category flagged on, but master gates them all to silent.
    mockUseSoundPrefs.mockReturnValue(soundPrefs(false, [...NOTIFICATION_SOUND_CATEGORIES]));
    renderKpis();

    expect(metricValue(LABEL_SOUND)).toBe(`0/${TOTAL_CHANNELS}`);
    expect(metricSubtitle(LABEL_SOUND)).toBe(`0 of ${TOTAL_CHANNELS} on`);
  });

  it('counts only the enabled per-category channels when the master switch is on', () => {
    const active: NotificationSoundCategory[] = ['critical_alert', 'warning_alert', 'charge_complete'];
    mockUseSoundPrefs.mockReturnValue(soundPrefs(true, active));
    renderKpis();

    expect(metricValue(LABEL_SOUND)).toBe(`3/${TOTAL_CHANNELS}`);
    expect(metricSubtitle(LABEL_SOUND)).toBe(`3 of ${TOTAL_CHANNELS} on`);
  });

  it('counts every channel when all are enabled and master is on', () => {
    mockUseSoundPrefs.mockReturnValue(soundPrefs(true, [...NOTIFICATION_SOUND_CATEGORIES]));
    renderKpis();

    expect(metricValue(LABEL_SOUND)).toBe(`${TOTAL_CHANNELS}/${TOTAL_CHANNELS}`);
  });
});

describe('BrowserNotificationsKpis — accessibility & structure', () => {
  it('exposes a labelled region containing all four KPI labels', () => {
    renderKpis();

    expect(
      screen.getByRole('region', { name: /notification status summary/i }),
    ).toBeInTheDocument();
    for (const label of ALL_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('marks every metric icon decorative so assistive tech skips the glyphs', () => {
    const { container } = renderKpis();

    // One decorative icon per card, each hidden from the accessibility tree.
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(4);
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });
});

describe('BrowserNotificationsKpis — null-safety', () => {
  it('degrades an undefined pushPrefs prop to 0/2 without throwing', () => {
    expect(() =>
      renderKpis({ pushPrefs: undefined as unknown as WebPushPreferences }),
    ).not.toThrow();

    expect(metricValue(LABEL_PUSH)).toBe('0/2');
    expect(metricSubtitle(LABEL_PUSH)).toBe('0 of 2 on');
  });

  it('tolerates a malformed sound-prefs object (missing perCategory) as 0 active', () => {
    mockUseSoundPrefs.mockReturnValue({
      master: true,
      perCategory: undefined,
      volume: 0.6,
    } as unknown as NotificationSoundPrefs);

    expect(() => renderKpis()).not.toThrow();
    expect(metricValue(LABEL_SOUND)).toBe(`0/${TOTAL_CHANNELS}`);
  });
});
