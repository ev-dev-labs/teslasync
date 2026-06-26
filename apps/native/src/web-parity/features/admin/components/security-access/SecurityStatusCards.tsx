/**
 * Native parity port of
 * web/src/features/admin/components/security-access/SecurityStatusCards.tsx.
 *
 * The web file is the Security & Access overview's status grid: a responsive
 * `grid-cols-1 md:2 lg:3` of six GlassPanel cards (Lock Status, Sentry Mode,
 * Doors, Windows, HomeLink, Guest Mode). Each card derives an icon, a colour and
 * a value from the latest `SecurityEvent`, and the whole grid is replaced by six
 * loading skeletons while `isLoading` is true. This native port preserves that
 * contract 1:1 — the six cards, the exact state -> {icon, colour, value} mapping,
 * every translation key, the door/window helper logic, and the loading skeleton
 * grid — using React Native primitives + the existing native AppText / GlassPanel
 * / design tokens.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L1): replaced by a native-safe
 *     `t(key, def?)` fallback returning the English default (or the key), keeping
 *     every `admin.security.*` translation key + i18n intent. The non-translated
 *     `windowSummary` literals ('—', 'All Closed', 'N Open/Venting') stay raw,
 *     exactly as the web helper emits them.
 *   - `@/lib/cn` (web L2): dropped — Tailwind class merging is meaningless on RN;
 *     the per-card state colour is applied via a shared token tone style map.
 *   - lucide-react Lock / Unlock / ShieldCheck / ShieldAlert / DoorClosed /
 *     DoorOpen / Home / UserCheck (web L3-12): rendered as decorative AppText
 *     glyph stand-ins (the established native inline-icon approach), hidden from
 *     a11y via importantForAccessibility. The icon *identity* still switches with
 *     state (Lock<->Unlock, ShieldCheck<->ShieldAlert, DoorClosed<->DoorOpen).
 *   - `@/components/ui/GlassPanel` (web L13): mapped to the native GlassPanel.
 *   - `@/components/feedback/Skeleton` (web L14): no native parity port yet, so a
 *     reduce-motion-aware Animated pulse skeleton (the proven PageSkeleton
 *     pattern) is reproduced locally — six 120px placeholder cards.
 *   - `@/components/motion/FadeIn` (web L15, framer-motion): reproduced locally as
 *     an Animated opacity 0->1 + translateY 12->0 wrapper honouring `delay={0.1}`
 *     (100 ms) and the OS reduce-motion setting (renders final state, no entry
 *     animation) — the same contract as the web `useMotionPreference` FadeIn.
 *   - `@/types/admin` `SecurityEvent` (web L16) + `@/lib/typeGuards`
 *     `asNonEmptyString` (web L17) + `./helpers` doorClosed / allWindowsClosed /
 *     windowSummary (web L18): not yet parity-ported, so the type and the exact
 *     helper logic are reproduced locally (verbatim ports) so the card behaviour
 *     is byte-for-byte identical.
 *   - The responsive `grid-cols-1 md:2 lg:3` becomes a single-column native stack
 *     (the natural phone layout analog), with `gap-4` -> rowGap 16 and
 *     `mb-6` -> marginBottom 24.
 */
import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  type AccessibilityState,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, typography} from '../../../../../theme/tokens';

/* ── native-safe port of `@/types/admin` SecurityEvent ──────────────────── */

export interface SecurityEvent {
  id: string;
  locked: boolean | null;
  sentryMode: string | boolean | null;
  doorState: string | boolean | null;
  fdWindow: string | boolean | null;
  fpWindow: string | boolean | null;
  rdWindow: string | boolean | null;
  rpWindow: string | boolean | null;
  homelinkNearby: boolean | null;
  guestMode: boolean | null;
  homelinkDeviceCount: number | null;
  guestModeMobileAccessState: string | null;
  driverSeatOccupied: boolean | null;
  centerDisplay: string | boolean | null;
  speedLimitMode: string | boolean | null;
  valetModeEnabled: boolean | null;
  serviceMode: boolean | null;
  pairedPhoneKeyCount: number | null;
  lightsHazardsActive: boolean | null;
  lightsHighBeams: boolean | null;
  lightsTurnSignal: string | null;
  driverSeatBelt: string | null;
  passengerSeatBelt: string | null;
  createdAt: string;
}

/* ── native-safe port of `@/lib/typeGuards` + `./helpers` ───────────────── */

type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

/** Returns `v` only when it is a non-empty string; `null` otherwise. */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function parseWindowState(val: unknown): WindowState {
  const raw = asNonEmptyString(val);
  if (!raw) {
    return 'Unknown';
  }
  const lower = raw.toLowerCase();
  if (lower === 'closed' || lower === '0') {
    return 'Closed';
  }
  if (lower.includes('vent')) {
    return 'Venting';
  }
  if (lower.includes('open') || lower !== '0') {
    return 'Open';
  }
  return 'Unknown';
}

function doorClosed(state: unknown): boolean {
  // Backend may emit DoorState as bool/object.
  if (state == null) {
    return true;
  }
  if (typeof state === 'boolean') {
    return !state;
  }
  if (typeof state === 'number') {
    return state === 0;
  }
  if (typeof state === 'object' && !Array.isArray(state)) {
    return Object.values(state as Record<string, unknown>).every(
      v => v === false || v == null,
    );
  }
  const raw = asNonEmptyString(state);
  if (!raw) {
    return true;
  }
  const lower = raw.trim().toLowerCase();
  if (
    lower === '' ||
    lower === 'closed' ||
    lower === 'closedall' ||
    lower === '0' ||
    lower === 'false'
  ) {
    return true;
  }
  if (lower.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.values(parsed).every(v => v === false || v == null);
    } catch {
      /* fall through */
    }
  }
  return false;
}

function allWindowsClosed(ev: SecurityEvent | undefined): boolean {
  if (!ev) {
    return true;
  }
  return [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow]
    .map(parseWindowState)
    .every(s => s === 'Closed');
}

function windowSummary(ev: SecurityEvent | undefined): string {
  if (!ev) {
    return '—';
  }
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(
    parseWindowState,
  );
  const allClosed = states.every(s => s === 'Closed');
  if (allClosed) {
    return 'All Closed';
  }
  const openCount = states.filter(s => s !== 'Closed').length;
  return `${openCount} Open/Venting`;
}

/* ── native translation fallback (native-safe port of react-i18next) ────── */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: returns the English default, else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key: string, fallback?: string) => fallback ?? key,
    [],
  );
}

/* ── reduce-motion preference (drives the skeleton + FadeIn) ────────────── */

const BUSY_STATE: AccessibilityState = {busy: true};

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/* ── decorative glyph stand-ins for the lucide-react icons ──────────────── */

const GLYPH = {
  lock: 'LK',
  unlock: 'UL',
  shieldCheck: 'SC',
  shieldAlert: 'SA',
  doorClosed: 'DC',
  doorOpen: 'DO',
  home: 'HM',
  userCheck: 'UC',
} as const;

/* ── per-card token tone (native-safe port of the Tailwind state colours) ─ */

type Tone = 'success' | 'danger' | 'warning' | 'accent' | 'violet' | 'muted';

interface StatusCardModel {
  key: string;
  glyph: string;
  tone: Tone;
  title: string;
  value: string;
  description: string;
}

/**
 * Reproduces the web card derivation 1:1. The icon + value colour map matches
 * the web Tailwind classes (green->success, red->danger, amber->warning,
 * blue->accent, purple->violet, var(--text-muted)->muted). The truthiness of the
 * raw signal values is preserved exactly (the web reads `latest?.sentryMode`
 * etc. as a plain truthy check).
 */
function buildSecurityCards(
  latest: SecurityEvent | undefined,
  t: NativeTFunction,
): StatusCardModel[] {
  const isLocked = Boolean(latest?.locked);
  const sentryOn = Boolean(latest?.sentryMode);
  const doorsClosed = doorClosed(latest?.doorState);
  const windowsClosed = allWindowsClosed(latest);
  const homelinkNearby = Boolean(latest?.homelinkNearby);
  const guestMode = Boolean(latest?.guestMode);

  return [
    {
      key: 'lock',
      glyph: isLocked ? GLYPH.lock : GLYPH.unlock,
      tone: isLocked ? 'success' : 'danger',
      title: t('admin.security.card.lockStatus', 'Lock Status'),
      value: isLocked
        ? t('admin.security.locked', 'Locked')
        : t('admin.security.unlocked', 'Unlocked'),
      description: t('admin.security.card.lockDesc', 'Vehicle lock state'),
    },
    {
      key: 'sentry',
      glyph: sentryOn ? GLYPH.shieldCheck : GLYPH.shieldAlert,
      tone: sentryOn ? 'accent' : 'muted',
      title: t('admin.security.card.sentryMode', 'Sentry Mode'),
      value: sentryOn
        ? t('admin.security.active', 'Active')
        : t('admin.security.inactive', 'Inactive'),
      description: t(
        'admin.security.card.sentryDesc',
        'Camera surveillance system',
      ),
    },
    {
      key: 'doors',
      glyph: doorsClosed ? GLYPH.doorClosed : GLYPH.doorOpen,
      tone: doorsClosed ? 'success' : 'warning',
      title: t('admin.security.card.doors', 'Doors'),
      value: doorsClosed
        ? t('admin.security.closed', 'Closed')
        : asNonEmptyString(latest?.doorState) ??
          t('admin.security.open', 'Open'),
      description: t('admin.security.card.doorsDesc', 'All vehicle doors'),
    },
    {
      key: 'windows',
      glyph: GLYPH.doorClosed,
      tone: windowsClosed ? 'success' : 'warning',
      title: t('admin.security.card.windows', 'Windows'),
      value: windowSummary(latest),
      description: t('admin.security.card.windowsDesc', 'Window positions'),
    },
    {
      key: 'homelink',
      glyph: GLYPH.home,
      tone: homelinkNearby ? 'violet' : 'muted',
      title: t('admin.security.card.homelink', 'HomeLink'),
      value: homelinkNearby
        ? t('admin.security.nearby', 'Nearby')
        : t('admin.security.away', 'Away'),
      description: t('admin.security.card.homelinkDesc', 'Garage door opener'),
    },
    {
      key: 'guest',
      glyph: GLYPH.userCheck,
      tone: guestMode ? 'warning' : 'muted',
      title: t('admin.security.card.guestMode', 'Guest Mode'),
      value: guestMode
        ? t('admin.security.enabled', 'Enabled')
        : t('admin.security.disabled', 'Disabled'),
      description: t('admin.security.card.guestDesc', 'Temporary access mode'),
    },
  ];
}

/* ── FadeIn (native-safe port of the framer-motion entry animation) ─────── */

function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      delay: delay * 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/* ── loading skeleton (native-safe port of `<Skeleton height={120}>` ×6) ── */

function SecurityStatusCardsSkeleton() {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }

    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [pulse, reduceMotion]);

  const opacity = reduceMotion
    ? 0.6
    : pulse.interpolate({inputRange: [0, 1], outputRange: [1, 0.4]});

  return (
    <View style={styles.grid} testID="security-status-cards-skeleton">
      {Array.from({length: 6}).map((_, i) => (
        <Animated.View
          key={i}
          accessible
          accessibilityLabel="Loading security status"
          accessibilityRole="progressbar"
          accessibilityState={BUSY_STATE}
          style={[styles.skeletonCard, {opacity}]}
          testID={`security-status-card-skeleton-${i}`}
        />
      ))}
    </View>
  );
}

/* ── single status card ─────────────────────────────────────────────────── */

function StatusCard({model}: {model: StatusCardModel}) {
  return (
    <GlassPanel style={styles.card} testID={`security-status-card-${model.key}`}>
      <View style={styles.cardHeader}>
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={[styles.icon, toneStyles[model.tone]]}>
          {model.glyph}
        </AppText>
        <AppText
          accessibilityRole="header"
          style={styles.cardTitle}
          tone="secondary"
          weight="semibold">
          {model.title}
        </AppText>
      </View>
      <AppText
        style={[styles.cardValue, toneStyles[model.tone]]}
        testID={`security-status-card-${model.key}-value`}>
        {model.value}
      </AppText>
      <AppText style={styles.cardDescription} tone="muted" variant="caption">
        {model.description}
      </AppText>
    </GlassPanel>
  );
}

/* ── grid ───────────────────────────────────────────────────────────────── */

interface SecurityStatusCardsProps {
  latest: SecurityEvent | undefined;
  isLoading: boolean;
}

export function SecurityStatusCards({
  latest,
  isLoading,
}: SecurityStatusCardsProps) {
  const t = useNativeTranslationFallback();

  if (isLoading) {
    return <SecurityStatusCardsSkeleton />;
  }

  const cards = buildSecurityCards(latest, t);

  return (
    <FadeIn delay={0.1}>
      <View style={styles.grid} testID="security-status-cards">
        {cards.map(card => (
          <StatusCard key={card.key} model={card} />
        ))}
      </View>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  grid: {
    rowGap: 16,
    marginBottom: 24,
  },
  skeletonCard: {
    height: 120,
    borderRadius: 24,
    backgroundColor: colors.surfaceRaised,
  },
  card: {
    padding: 16,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 12,
    marginBottom: 8,
  },
  icon: {
    fontSize: 15,
    lineHeight: 24,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  cardTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  cardValue: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  cardDescription: {
    marginTop: 4,
    fontSize: typography.caption,
  },
});

const toneStyles = StyleSheet.create<Record<Tone, TextStyle>>({
  success: {color: colors.success},
  danger: {color: colors.danger},
  warning: {color: colors.warning},
  accent: {color: colors.accent},
  violet: {color: colors.violet},
  muted: {color: colors.textMuted},
});
