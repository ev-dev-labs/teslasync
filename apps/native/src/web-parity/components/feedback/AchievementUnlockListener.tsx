// Native parity port of web/src/components/feedback/AchievementUnlockListener.tsx.
//
// The listener mounts at the app root, drains the realtime `achievement_unlocked`
// SSE queue (via the already-ported web-parity useAchievementUnlocks hook), and
// renders the celebration toast stack. Two of its web siblings are NOT part of the
// native parity manifest, so their native-safe equivalents are inlined here:
//   - useAchievementCelebrationPrefs (web/src/hooks): the web version is
//     localStorage-backed with cross-tab `storage`-event sync. React Native has no
//     localStorage/window, so it becomes an in-memory useSyncExternalStore seeded
//     with the same defaults (showToasts:true, playSound:false, showOnDashboard:true,
//     pushOnUnlock:true). Persistence + the setAchievementCelebrationPrefs setter
//     live in that unconverted module and are out of scope for this listener.
//   - AchievementUnlockedToast / AchievementUnlockedToastStack (./AchievementUnlockedToast):
//     the web toast uses framer-motion (spring entry + emoji confetti), react-router
//     navigate, lucide icons and the AchievementBadge. None of those libs exist in
//     this native tree, so the toast degrades to a static RN card (badge emoji,
//     "Achievement Unlocked" eyebrow, name, 2-line description, View + dismiss
//     actions) with the 6s auto-dismiss timer preserved. The "View" deep-link to
//     /lifetime is not wired (no router in web-parity), so it acknowledges/dismisses.
//
// The optional unlock chime uses the WebAudio API on the web; React Native exposes
// no global AudioContext, so playUnlockChime() guards on a global constructor and
// silently no-ops — exactly the web's own fallback path when WebAudio is absent.

import React, {
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';
import {
  useAchievementUnlocks,
  type AchievementUnlockedEvent,
} from '../../api/hooks/useAchievementUnlocks';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// ---------------------------------------------------------------------------
// Celebration prefs — native-safe in-memory port of the web localStorage hook.
// ---------------------------------------------------------------------------

interface AchievementCelebrationPrefs {
  showToasts: boolean;
  playSound: boolean;
  showOnDashboard: boolean;
  pushOnUnlock: boolean;
}

const DEFAULT_CELEBRATION_PREFS: AchievementCelebrationPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
};

const celebrationPrefsListeners = new Set<() => void>();

function subscribeCelebrationPrefs(listener: () => void): () => void {
  celebrationPrefsListeners.add(listener);
  return () => {
    celebrationPrefsListeners.delete(listener);
  };
}

function getCelebrationPrefsSnapshot(): AchievementCelebrationPrefs {
  return DEFAULT_CELEBRATION_PREFS;
}

function useAchievementCelebrationPrefs(): AchievementCelebrationPrefs {
  return useSyncExternalStore(
    subscribeCelebrationPrefs,
    getCelebrationPrefsSnapshot,
    getCelebrationPrefsSnapshot,
  );
}

// ---------------------------------------------------------------------------
// Unlock chime — native-safe WebAudio port (no-op when no AudioContext exists).
// ---------------------------------------------------------------------------

interface ChimeAudioParam {
  value: number;
  setValueAtTime(value: number, startTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
}

interface ChimeGainNode {
  readonly gain: ChimeAudioParam;
  connect(destination: unknown): void;
}

interface ChimeOscillatorNode {
  type: string;
  readonly frequency: {value: number};
  connect(destination: ChimeGainNode): void;
  start(when: number): void;
  stop(when: number): void;
}

interface ChimeAudioContext {
  readonly currentTime: number;
  readonly destination: unknown;
  createOscillator(): ChimeOscillatorNode;
  createGain(): ChimeGainNode;
}

type ChimeAudioContextConstructor = new () => ChimeAudioContext;

function getAudioContextConstructor(): ChimeAudioContextConstructor | null {
  const scope = globalThis as typeof globalThis & {
    AudioContext?: unknown;
    webkitAudioContext?: unknown;
  };
  const candidate = scope.AudioContext ?? scope.webkitAudioContext;
  return typeof candidate === 'function'
    ? (candidate as ChimeAudioContextConstructor)
    : null;
}

function playUnlockChime(contextRef: {current: ChimeAudioContext | null}): void {
  try {
    const Ctor = getAudioContextConstructor();
    if (!Ctor) {
      return;
    }
    if (!contextRef.current) {
      contextRef.current = new Ctor();
    }
    const ctx = contextRef.current;
    const now = ctx.currentTime;
    // Two-note "ding" — perfect fifth (E5 -> B5).
    const noteFreqs = [659.25, 987.77];
    noteFreqs.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.5);
    });
  } catch {
    // WebAudio unavailable (the default on React Native — no global
    // AudioContext). Silently no-op; the visual toast is the primary
    // affordance, mirroring the web fallback.
  }
}

// ---------------------------------------------------------------------------
// Toast stack — native-safe port of ./AchievementUnlockedToast.
// ---------------------------------------------------------------------------

const ACHIEVEMENT_TOAST_DURATION_MS = 6000;

interface AchievementUnlockedToastProps {
  event: AchievementUnlockedEvent;
  /** Called when the user dismisses the toast or auto-dismiss elapses. */
  onDismiss: () => void;
  /** Auto-dismiss delay in milliseconds. Defaults to 6000. */
  durationMs?: number;
}

function AchievementUnlockedToast({
  event,
  onDismiss,
  durationMs = ACHIEVEMENT_TOAST_DURATION_MS,
}: AchievementUnlockedToastProps): React.ReactElement {
  const t = useNativeTranslationFallback();

  // Auto-dismiss timer (parity with the web toast's window.setTimeout).
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onDismiss]);

  const icon = event.achievement.icon || '🎉';
  const eyebrow = t('achievements.toastEyebrow', 'Achievement Unlocked');
  const viewLabel = t('achievements.view', 'View');
  const dismissLabel = t(
    'achievements.dismiss',
    'Dismiss achievement notification',
  );

  return (
    <View
      accessibilityLabel={`${eyebrow}: ${event.achievement.name}`}
      accessibilityLiveRegion="polite"
      accessible
      style={styles.toast}
      testID="achievement-unlocked-toast">
      <View style={styles.badge}>
        <AppText style={styles.badgeIcon}>{icon}</AppText>
      </View>

      <View style={styles.body}>
        <View style={styles.eyebrowRow}>
          <AppText style={styles.eyebrowIcon}>🏆</AppText>
          <AppText style={styles.eyebrow}>{eyebrow}</AppText>
        </View>
        <AppText style={styles.name} weight="semibold">
          {event.achievement.name}
        </AppText>
        <AppText numberOfLines={2} style={styles.description} tone="secondary">
          {event.achievement.description}
        </AppText>
        <Pressable
          accessibilityLabel={viewLabel}
          accessibilityRole="button"
          onPress={onDismiss}
          style={({pressed}) => [styles.viewAction, pressed && styles.pressed]}>
          <AppText style={styles.viewLabel} weight="semibold">
            {viewLabel} →
          </AppText>
        </Pressable>
      </View>

      <Pressable
        accessibilityLabel={dismissLabel}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onDismiss}
        style={({pressed}) => [styles.dismiss, pressed && styles.pressed]}>
        <AppText style={styles.dismissIcon}>×</AppText>
      </Pressable>
    </View>
  );
}
AchievementUnlockedToast.displayName = 'AchievementUnlockedToast';

interface AchievementUnlockedToastStackProps {
  events: AchievementUnlockedEvent[];
  onDismiss: (achievementId: string) => void;
}

function AchievementUnlockedToastStack({
  events,
  onDismiss,
}: AchievementUnlockedToastStackProps): React.ReactElement {
  return (
    <View pointerEvents="box-none" style={styles.stack}>
      {events.map(event => (
        <AchievementUnlockedToast
          event={event}
          key={event.achievement.id}
          onDismiss={() => onDismiss(event.achievement.id)}
        />
      ))}
    </View>
  );
}
AchievementUnlockedToastStack.displayName = 'AchievementUnlockedToastStack';

// ---------------------------------------------------------------------------
// AchievementUnlockListener — app-root listener + celebration surface.
// ---------------------------------------------------------------------------

export function AchievementUnlockListener(): React.ReactElement | null {
  const {recent, dismiss} = useAchievementUnlocks();
  const prefs = useAchievementCelebrationPrefs();

  // Lazily-allocated, cached-per-mount AudioContext container (web parity for
  // the useMemo<{ctx}> stable holder — a ref is the native-idiomatic shape).
  const audioContextRef = useRef<ChimeAudioContext | null>(null);

  // Key the chime on the queue length (not the full array) so we only chime
  // when a new unlock arrives, not on unrelated re-renders.
  const recentCount = recent.length;
  useEffect(() => {
    if (!prefs.playSound) {
      return;
    }
    if (recentCount === 0) {
      return;
    }
    playUnlockChime(audioContextRef);
  }, [recentCount, prefs.playSound]);

  // Skip rendering the visible stack when the user has opted out, but keep the
  // hook subscription live above so the SSE queue is still drained.
  if (!prefs.showToasts) {
    return null;
  }

  return <AchievementUnlockedToastStack events={recent} onDismiss={dismiss} />;
}
AchievementUnlockListener.displayName = 'AchievementUnlockListener';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexShrink: 0,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  badgeIcon: {
    fontSize: 22,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
  },
  dismiss: {
    borderRadius: 8,
    flexShrink: 0,
    padding: 6,
  },
  dismissIcon: {
    color: colors.textMuted,
    fontSize: 16,
    lineHeight: 16,
  },
  eyebrow: {
    color: colors.warning,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  eyebrowIcon: {
    color: colors.warning,
    fontSize: 12,
  },
  eyebrowRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  name: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  pressed: {
    opacity: 0.7,
  },
  stack: {
    alignItems: 'flex-end',
    gap: 12,
    left: 16,
    position: 'absolute',
    right: 16,
    top: 16,
    zIndex: 110,
  },
  toast: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.warningBorder,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    maxWidth: 360,
    padding: 16,
    width: '100%',
  },
  viewAction: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  viewLabel: {
    color: colors.warning,
    fontSize: 12,
  },
});
