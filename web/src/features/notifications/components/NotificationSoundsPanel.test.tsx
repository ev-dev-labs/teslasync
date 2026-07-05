/**
 * NotificationSoundsPanel — per-channel notification-audio settings.
 *
 * The panel has no network state: it reads/writes the localStorage-backed
 * `notificationSound` external store and drives a tiny WebAudio player. These
 * tests pin every observable facet of the single export:
 *
 *   • structure — title/subtitle, the master switch, one labelled switch +
 *     "Test" button per real category, the "Channels" heading, and the volume
 *     slider all render;
 *   • master toggle — enabling calls setNotificationSoundPrefs({ master }) AND
 *     primes the AudioContext (the bug fix: the old volume-0 "pre-warm" never
 *     constructed a context because playNotificationSound bails on the
 *     zero-volume guard first); disabling neither primes nor throws;
 *   • per-channel toggles — flip the correct category on/off via a shallow
 *     perCategory patch, and reflect the stored enabled state via aria-checked;
 *   • Test buttons — force master+category on and a non-zero volume even when
 *     the panel master is off (the button is itself the authorising gesture);
 *   • the one-time autoplay hint — hidden when master is off, shown when on,
 *     DISMISSED once a Test actually plays (the second bug fix: the dismissed
 *     flag was previously dead — only ever set false), and kept visible when
 *     audio is still blocked;
 *   • volume slider — reflects the stored volume as a percentage, disables
 *     when master is off, and threads edits back as a 0..1 fraction;
 *   • accessibility — programmatic names on the switch/slider/Test controls and
 *     decorative (aria-hidden) icon glyphs;
 *   • null-safety — an undefined stored volume degrades to 0% / a forced 0.5
 *     test volume instead of NaN, and a sparse perCategory renders unchecked
 *     rather than throwing.
 *
 * The `notificationSound` module is partially mocked: the real category list is
 * kept (the grid maps over it) while the live-prefs hook, the store mutator,
 * the player, and the audio-prime primitive are swapped for spies. Real i18n is
 * loaded so `t(key, default, vars)` resolves the English copy + interpolation.
 * `@testing-library/user-event` is not installed in this repo, so interactions
 * are driven with `fireEvent`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import '@/i18n';

import type {
  NotificationSoundCategory,
  NotificationSoundPrefs,
  NotificationSoundPrefsPatch,
  PlayResult,
} from '@/lib/notificationSound';

// Spies the panel calls into. Declared before vi.mock so the (hoisted) factory
// can close over them; each test drives their return values per scenario.
const mockUseSoundPrefs = vi.fn();
const setPrefsSpy = vi.fn();
const playSpy = vi.fn();
const primeSpy = vi.fn();

vi.mock('@/lib/notificationSound', async () => {
  const actual = await vi.importActual<typeof import('@/lib/notificationSound')>(
    '@/lib/notificationSound',
  );
  return {
    ...actual,
    useNotificationSoundPrefs: (): NotificationSoundPrefs =>
      mockUseSoundPrefs() as NotificationSoundPrefs,
    setNotificationSoundPrefs: (patch: NotificationSoundPrefsPatch): void => {
      setPrefsSpy(patch);
    },
    playNotificationSound: (
      category: NotificationSoundCategory,
      prefs?: NotificationSoundPrefs,
    ): PlayResult => playSpy(category, prefs) as PlayResult,
    primeNotificationAudio: (): boolean => primeSpy() as boolean,
  };
});

import { NotificationSoundsPanel } from './NotificationSoundsPanel';
import { NOTIFICATION_SOUND_CATEGORIES } from '@/lib/notificationSound';

/** English category labels as they appear in en.json (used for control names). */
const CATEGORY_LABELS: Record<NotificationSoundCategory, string> = {
  critical_alert: 'Critical alerts',
  warning_alert: 'Warning alerts',
  info_alert: 'Informational alerts',
  charge_complete: 'Charge complete',
  drive_complete: 'Drive complete',
  automation_run: 'Automation runs',
  achievement: 'Achievements',
};

const MASTER_NAME = 'Enable notification sounds';
const HINT_RE = /Some browsers require a click/i;

function makePrefs(overrides: Partial<NotificationSoundPrefs> = {}): NotificationSoundPrefs {
  const base = Object.fromEntries(
    NOTIFICATION_SOUND_CATEGORIES.map((c) => [c, false]),
  ) as NotificationSoundPrefs['perCategory'];
  return {
    master: false,
    volume: 0.6,
    ...overrides,
    perCategory: { ...base, ...overrides.perCategory },
  };
}

/** Read the (category, prefs) argument tuple of the Nth playNotificationSound call. */
function playCall(n = 0): [NotificationSoundCategory, NotificationSoundPrefs] {
  return playSpy.mock.calls[n] as [NotificationSoundCategory, NotificationSoundPrefs];
}

function testButton(category: NotificationSoundCategory) {
  return screen.getByRole('button', { name: `Test ${CATEGORY_LABELS[category]} sound` });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSoundPrefs.mockReturnValue(makePrefs());
  // Default: audio is blocked in jsdom (no AudioContext) so plays no-op.
  playSpy.mockReturnValue({ played: false, reason: 'no_audio_context' } satisfies PlayResult);
  primeSpy.mockReturnValue(true);
});

afterEach(() => cleanup());

describe('NotificationSoundsPanel — structure', () => {
  it('renders the header, master switch, every channel row, and the volume slider', () => {
    render(<NotificationSoundsPanel />);

    expect(screen.getByText('Notification sounds')).toBeInTheDocument();
    expect(screen.getByText(/Play a short cue/i)).toBeInTheDocument();
    expect(screen.getByText('Channels')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: MASTER_NAME })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();

    // 1 master switch + one switch per category; one Test button per category.
    expect(screen.getAllByRole('switch')).toHaveLength(1 + NOTIFICATION_SOUND_CATEGORIES.length);
    for (const cat of NOTIFICATION_SOUND_CATEGORIES) {
      expect(screen.getByRole('switch', { name: CATEGORY_LABELS[cat] })).toBeInTheDocument();
      expect(testButton(cat)).toBeInTheDocument();
    }
  });

  it('reflects the stored per-category enabled state via aria-checked', () => {
    mockUseSoundPrefs.mockReturnValue(
      makePrefs({ master: true, perCategory: { critical_alert: true, warning_alert: false } }),
    );
    render(<NotificationSoundsPanel />);

    expect(screen.getByRole('switch', { name: CATEGORY_LABELS.critical_alert })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: CATEGORY_LABELS.warning_alert })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});

describe('NotificationSoundsPanel — master toggle', () => {
  it('enabling persists master=true and primes the AudioContext', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: false }));
    render(<NotificationSoundsPanel />);

    fireEvent.click(screen.getByRole('switch', { name: MASTER_NAME }));

    expect(setPrefsSpy).toHaveBeenCalledWith({ master: true });
    // The fix: enabling must actually prime the shared context (not the old
    // volume-0 play that never constructed one).
    expect(primeSpy).toHaveBeenCalledTimes(1);
  });

  it('disabling persists master=false and does NOT prime', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true }));
    render(<NotificationSoundsPanel />);

    fireEvent.click(screen.getByRole('switch', { name: MASTER_NAME }));

    expect(setPrefsSpy).toHaveBeenCalledWith({ master: false });
    expect(primeSpy).not.toHaveBeenCalled();
  });
});

describe('NotificationSoundsPanel — per-channel toggles', () => {
  it('turning a channel on emits a shallow perCategory patch', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true }));
    render(<NotificationSoundsPanel />);

    fireEvent.click(screen.getByRole('switch', { name: CATEGORY_LABELS.charge_complete }));

    expect(setPrefsSpy).toHaveBeenCalledWith({ perCategory: { charge_complete: true } });
  });

  it('turning an already-enabled channel off emits the inverse patch', () => {
    mockUseSoundPrefs.mockReturnValue(
      makePrefs({ master: true, perCategory: { critical_alert: true } }),
    );
    render(<NotificationSoundsPanel />);

    fireEvent.click(screen.getByRole('switch', { name: CATEGORY_LABELS.critical_alert }));

    expect(setPrefsSpy).toHaveBeenCalledWith({ perCategory: { critical_alert: false } });
  });
});

describe('NotificationSoundsPanel — Test buttons', () => {
  it('forces master + that category on and passes the stored volume through', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true, volume: 0.6 }));
    render(<NotificationSoundsPanel />);

    fireEvent.click(testButton('warning_alert'));

    expect(playSpy).toHaveBeenCalledTimes(1);
    const [category, prefs] = playCall();
    expect(category).toBe('warning_alert');
    expect(prefs).toMatchObject({ master: true, volume: 0.6 });
    expect(prefs.perCategory.warning_alert).toBe(true);
  });

  it('plays even when the panel master switch is off (the button is the gesture)', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: false, volume: 0.4 }));
    render(<NotificationSoundsPanel />);

    fireEvent.click(testButton('drive_complete'));

    const [category, prefs] = playCall();
    expect(category).toBe('drive_complete');
    expect(prefs.master).toBe(true);
    expect(prefs.perCategory.drive_complete).toBe(true);
  });

  it('substitutes a 0.5 fallback volume when the stored volume is muted (0)', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true, volume: 0 }));
    render(<NotificationSoundsPanel />);

    fireEvent.click(testButton('info_alert'));

    expect(playCall()[1].volume).toBe(0.5);
  });
});

describe('NotificationSoundsPanel — autoplay hint', () => {
  it('is hidden while master is off', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: false }));
    render(<NotificationSoundsPanel />);

    expect(screen.queryByText(HINT_RE)).not.toBeInTheDocument();
  });

  it('is shown once master is on', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true }));
    render(<NotificationSoundsPanel />);

    expect(screen.getByText(HINT_RE)).toBeInTheDocument();
  });

  it('is dismissed after a Test successfully plays', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true }));
    playSpy.mockReturnValue({ played: true } satisfies PlayResult);
    render(<NotificationSoundsPanel />);

    expect(screen.getByText(HINT_RE)).toBeInTheDocument();
    fireEvent.click(testButton('critical_alert'));
    // Audio is now authorised → the one-time hint disappears.
    expect(screen.queryByText(HINT_RE)).not.toBeInTheDocument();
  });

  it('stays visible when a Test still cannot obtain an audio context', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true }));
    playSpy.mockReturnValue({ played: false, reason: 'no_audio_context' } satisfies PlayResult);
    render(<NotificationSoundsPanel />);

    fireEvent.click(testButton('critical_alert'));

    expect(screen.getByText(HINT_RE)).toBeInTheDocument();
  });
});

describe('NotificationSoundsPanel — volume slider', () => {
  it('shows the stored volume as a percentage and is disabled while master is off', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: false, volume: 0.4 }));
    render(<NotificationSoundsPanel />);

    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).toBeDisabled();
    expect(slider).toHaveAttribute('value', '40');
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('is enabled while master is on and threads edits back as a 0..1 fraction', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true, volume: 0.5 }));
    render(<NotificationSoundsPanel />);

    const slider = screen.getByRole('slider', { name: 'Volume' });
    expect(slider).not.toBeDisabled();

    fireEvent.change(slider, { target: { value: '75' } });
    expect(setPrefsSpy).toHaveBeenCalledWith({ volume: 0.75 });
  });
});

describe('NotificationSoundsPanel — accessibility', () => {
  it('names the switch/slider/Test controls and marks every icon decorative', () => {
    mockUseSoundPrefs.mockReturnValue(makePrefs({ master: true }));
    const { container } = render(<NotificationSoundsPanel />);

    expect(screen.getByRole('switch', { name: MASTER_NAME })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
    for (const cat of NOTIFICATION_SOUND_CATEGORIES) {
      expect(testButton(cat)).toBeInTheDocument();
    }

    const svgs = Array.from(container.querySelectorAll('svg'));
    expect(svgs.length).toBeGreaterThan(0);
    expect(svgs.every((s) => s.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
});

describe('NotificationSoundsPanel — null safety', () => {
  it('renders a 0% slider (not NaN) when the stored volume is undefined', () => {
    mockUseSoundPrefs.mockReturnValue(
      makePrefs({ volume: undefined as unknown as number }),
    );

    expect(() => render(<NotificationSoundsPanel />)).not.toThrow();
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveAttribute('value', '0');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('forces a 0.5 test volume when the stored volume is undefined', () => {
    mockUseSoundPrefs.mockReturnValue(
      makePrefs({ master: true, volume: undefined as unknown as number }),
    );
    render(<NotificationSoundsPanel />);

    fireEvent.click(testButton('achievement'));
    expect(playCall()[1].volume).toBe(0.5);
  });

  it('renders a sparse perCategory map as unchecked instead of throwing', () => {
    // Only one category present in the stored map; the rest fall back to false.
    mockUseSoundPrefs.mockReturnValue(
      makePrefs({ master: true, perCategory: { achievement: true } }),
    );

    expect(() => render(<NotificationSoundsPanel />)).not.toThrow();
    expect(screen.getByRole('switch', { name: CATEGORY_LABELS.achievement })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('switch', { name: CATEGORY_LABELS.info_alert })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });
});
