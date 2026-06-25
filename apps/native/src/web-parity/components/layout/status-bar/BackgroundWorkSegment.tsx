// Native parity port of web/src/components/layout/status-bar/BackgroundWorkSegment.tsx.
//
// Footer status-bar segment that surfaces in-flight background work (CSV
// exports, settings saves, ad-hoc registered jobs). Hidden entirely when
// nothing is running so the bar stays quiet during normal use (web L53
// `if (!hasJobs) return null`). Tapping the segment toggles a popover listing
// the running jobs.
//
// Native-safe adaptations (documented in the sidecar):
//
//   - The web `@/hooks/useBackgroundJobs` hook + module store is NOT yet ported
//     under the native web-parity tree, so — following the established
//     inline-the-missing-hook precedent (LiveIndicator inlines `useLiveConnection`,
//     AnnouncerRegion inlines `useAnnouncer`, KeyboardShortcutsModal inlines its
//     shortcut registry) — a faithful native-safe copy is inlined below. All of
//     its real dependencies exist natively: `useExportJobs`/`ExportJobSummary`
//     (web-parity/api/hooks/useExports), `useIsMutating` (@tanstack/react-query),
//     and `useSyncExternalStore` (react). Behavior, identifiers, the module-scoped
//     custom-job pub/sub, `registerJob`, and the test helper are preserved
//     verbatim so export + mutation + custom jobs all surface exactly as on web.
//
//   - `lucide-react` glyphs (Loader2 spinner, FileDown/Save/Sparkles kind icons)
//     have no native package here (no react-native-svg / vector-icons), so they
//     are drawn with React Native `View`/`Animated.View` primitives, mirroring
//     the LiveIndicator port's View-drawn glyphs. The kind icons are decorative
//     (web `aria-hidden`) and the spinner honors the OS reduce-motion preference.
//
//   - The shared web `Tooltip` (`@/components/ui`) is a hover/focus DOM tooltip
//     with no React Native equivalent (same finding as the Avatar port). Its
//     content ("Background work in progress · N tasks") is preserved as the
//     trigger's `accessibilityHint` so the same information stays available to
//     assistive tech.
//
//   - The absolutely-positioned DOM popover plus its browser-only dismiss wiring
//     (`document` `mousedown` click-outside listener + `Escape` `keydown`,
//     web L36-51, and the `containerRef`) are replaced by a transparent RN
//     `Modal`: a full-screen backdrop `Pressable` reproduces click-outside, and
//     `onRequestClose` reproduces the Escape/back dismissal. The popover card is
//     anchored bottom-right (the web `bottom-full right-0` intent) since RN has
//     no DOM anchor to measure against.
//
//   - `react-i18next` is not wired in native; every i18n key + English fallback
//     is preserved through a native translation fallback that also interpolates
//     the `{{count}}` placeholder used by `statusBar.background.many`.
//
//   - Tailwind utility classes / CSS vars are resolved to literal token values
//     (amber-300 `#fcd34d`, glass-border/surface-1/text-* via the native theme
//     tokens), and DOM `div`/`button`/`span` become `View`/`Pressable`/`AppText`.
//
// No DOM elements, lucide-react, Recharts, Leaflet, or old web UI components are
// imported — only React Native primitives, native tokens, and the native
// useExports parity hook.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useIsMutating } from '@tanstack/react-query';

import { AppText } from '../../../../components/ui/AppText';
import { colors, shadows } from '../../../../theme/tokens';
import {
  useExportJobs,
  type ExportJobSummary,
} from '../../../api/hooks/useExports';

// text-amber-300 — the segment foreground (icon + label) and the per-row spinner.
const AMBER_300 = '#fcd34d';

// ────────────────────────────────────────────────────────────────────────────
// Inlined native-safe port of web/src/hooks/useBackgroundJobs.ts
//
// Single source of truth for "is there work happening in the background?".
// Aggregates three independent signals: active export jobs (queued/processing),
// in-flight TanStack mutations, and ad-hoc registrations via `registerJob`. The
// store is intentionally module-scoped + observable (not a React context) so any
// code path can call `registerJob` without living inside a provider tree.
// ────────────────────────────────────────────────────────────────────────────

export type BackgroundJobKind = 'export' | 'mutation' | 'custom';

export interface BackgroundJob {
  /** Stable id used for de-duplication. */
  id: string;
  /** Human-readable title shown in the popover (already i18n'd by the caller). */
  label: string;
  /** What kind of work this is — drives the icon shown in the popover. */
  kind: BackgroundJobKind;
  /** Optional secondary line shown beneath the label. */
  description?: string;
  /** ISO timestamp when this job was registered; used for sorting (oldest first). */
  startedAt: string;
}

let customJobs: BackgroundJob[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) {
    fn();
  }
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): BackgroundJob[] {
  return customJobs;
}

/**
 * Register a custom long-running background job. Returns a function that removes
 * the registration when the job completes. Re-registration with the same id is
 * idempotent (the prior entry is replaced).
 */
export function registerJob(
  input: Omit<BackgroundJob, 'startedAt' | 'kind'> & {
    kind?: BackgroundJobKind;
  },
): () => void {
  const job: BackgroundJob = {
    kind: input.kind ?? 'custom',
    startedAt: new Date().toISOString(),
    ...input,
  };
  // Replace any existing entry with the same id so re-registration is idempotent.
  customJobs = [...customJobs.filter(j => j.id !== job.id), job];
  emit();
  return () => {
    customJobs = customJobs.filter(j => j.id !== job.id);
    emit();
  };
}

/** Test-only helper: clear all custom registrations between tests. */
export function __clearBackgroundJobsForTests() {
  customJobs = [];
  emit();
}

export interface UseBackgroundJobsResult {
  /** Combined list of in-flight jobs (export + mutation + custom). */
  jobs: BackgroundJob[];
  /** Convenience flag — true iff `jobs.length > 0`. */
  hasJobs: boolean;
  /** How many jobs are running (cheap re-render guard for badges). */
  count: number;
}

function activeExportJobs(
  jobs: ExportJobSummary[] | undefined,
): BackgroundJob[] {
  if (!jobs) {
    return [];
  }
  return jobs
    .filter(j => j.status === 'queued' || j.status === 'processing')
    .map<BackgroundJob>(j => ({
      id: `export:${j.id}`,
      kind: 'export',
      label: j.file_name || `${j.type} export`,
      description: j.status === 'queued' ? 'Queued' : 'Processing',
      startedAt: j.created_at,
    }));
}

export function useBackgroundJobs(): UseBackgroundJobsResult {
  const { data: exportJobs } = useExportJobs({ pollWhileActive: true });
  const mutationCount = useIsMutating();
  const custom = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Surface a single composite "mutation" entry rather than one row per
  // individual TanStack mutation — most users only care that *something* is in
  // flight, not which save it is.
  const mutationJob: BackgroundJob[] = useMemo(() => {
    if (mutationCount <= 0) {
      return [];
    }
    return [
      {
        id: 'tanstack-mutations',
        kind: 'mutation',
        label:
          mutationCount === 1 ? 'Saving…' : `Saving ${mutationCount} changes…`,
        startedAt: new Date().toISOString(),
      },
    ];
  }, [mutationCount]);

  const exports = useMemo(() => activeExportJobs(exportJobs), [exportJobs]);

  const jobs = useMemo(() => {
    const all = [...exports, ...mutationJob, ...custom];
    return all.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [exports, mutationJob, custom]);

  return { jobs, hasJobs: jobs.length > 0, count: jobs.length };
}

// ────────────────────────────────────────────────────────────────────────────
// Native i18n fallback (react-i18next is not wired in native).
// ────────────────────────────────────────────────────────────────────────────

type TranslationVars = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  vars?: TranslationVars,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, vars?: TranslationVars) => {
      if (!vars) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
        const value = vars[name];
        return value === undefined ? '' : String(value);
      });
    },
    [],
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Spinner (native equivalent of lucide's animate-spin Loader2)
// ────────────────────────────────────────────────────────────────────────────

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

function useSpin(active: boolean): Animated.Value {
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      spin.setValue(0);
      return;
    }

    spin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(spin, {
        duration: 800,
        easing: Easing.linear,
        toValue: 1,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => {
      animation.stop();
    };
  }, [active, spin]);

  return spin;
}

function Spinner({ size, color }: { size: number; color: string }) {
  const reduceMotion = useReduceMotion();
  const spinValue = useSpin(!reduceMotion);
  const rotate = spinValue.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });
  const ringWidth = Math.max(1.2, size * 0.12);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[
        styles.spinner,
        {
          borderColor: colors.border,
          borderRadius: size / 2,
          borderTopColor: color,
          borderWidth: ringWidth,
          height: size,
          transform: [{ rotate }],
          width: size,
        },
      ]}
    />
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Kind glyphs (native View-drawn stand-ins for lucide FileDown/Save/Sparkles).
// Decorative (web `aria-hidden`); distinct shapes preserve the per-kind icon.
// ────────────────────────────────────────────────────────────────────────────

function KindGlyph({
  kind,
  size,
  color,
}: {
  kind: BackgroundJobKind;
  size: number;
  color: string;
}) {
  const bar = Math.max(1.4, size * 0.12);

  // Static literals (position/borderRadius/transparent edges) live in the
  // StyleSheet; only the size-derived geometry + the dynamic color stay inline,
  // matching the LiveIndicator glyph pattern (and clearing no-inline-styles).
  if (kind === 'export') {
    // FileDown — a download arrow over a tray.
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.glyph, { height: size, width: size }]}
      >
        <View
          style={[
            styles.glyphAbsolute,
            {
              backgroundColor: color,
              height: size * 0.34,
              left: size / 2 - bar / 2,
              top: size * 0.1,
              width: bar,
            },
          ]}
        />
        <View
          style={[
            styles.glyphTriangle,
            {
              borderLeftWidth: size * 0.18,
              borderRightWidth: size * 0.18,
              borderTopColor: color,
              borderTopWidth: size * 0.2,
              left: size / 2 - size * 0.18,
              top: size * 0.4,
            },
          ]}
        />
        <View
          style={[
            styles.glyphAbsolute,
            {
              backgroundColor: color,
              bottom: size * 0.08,
              height: bar,
              left: size * 0.19,
              width: size * 0.62,
            },
          ]}
        />
      </View>
    );
  }

  if (kind === 'mutation') {
    // Save — a floppy-disk body with a shutter rectangle near the top.
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        style={[styles.glyph, { height: size, width: size }]}
      >
        <View
          style={[
            styles.glyphFloppyBody,
            {
              borderColor: color,
              borderWidth: bar,
              height: size * 0.82,
              width: size * 0.82,
            },
          ]}
        />
        <View
          style={[
            styles.glyphAbsolute,
            {
              backgroundColor: color,
              height: size * 0.22,
              left: size * 0.3,
              top: size * 0.18,
              width: size * 0.4,
            },
          ]}
        />
      </View>
    );
  }

  // Sparkles — a crossed vertical + horizontal bar (a 4-point sparkle star).
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[styles.glyph, { height: size, width: size }]}
    >
      <View
        style={[
          styles.glyphBarRounded,
          {
            backgroundColor: color,
            height: size * 0.92,
            left: size / 2 - bar / 2,
            top: size * 0.04,
            width: bar,
          },
        ]}
      />
      <View
        style={[
          styles.glyphBarRounded,
          {
            backgroundColor: color,
            height: bar,
            left: size * 0.04,
            top: size / 2 - bar / 2,
            width: size * 0.92,
          },
        ]}
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Single job row inside the popover.
// ────────────────────────────────────────────────────────────────────────────

function JobRow({ job }: { job: BackgroundJob }) {
  return (
    <View style={styles.row}>
      <KindGlyph color={colors.textMuted} kind={job.kind} size={14} />
      <View style={styles.rowText}>
        <AppText
          numberOfLines={1}
          style={styles.jobLabel}
          variant="caption"
          weight="semibold"
        >
          {job.label}
        </AppText>
        {job.description ? (
          <AppText numberOfLines={1} style={styles.jobDescription} tone="muted">
            {job.description}
          </AppText>
        ) : null}
      </View>
      <Spinner color={AMBER_300} size={12} />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BackgroundWorkSegment
// ────────────────────────────────────────────────────────────────────────────

export interface BackgroundWorkSegmentProps {
  iconOnly?: boolean;
  /** Native analog of the web container's class hook. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function BackgroundWorkSegment({
  iconOnly = false,
  style,
  testID,
}: BackgroundWorkSegmentProps) {
  const t = useNativeTranslationFallback();
  const { jobs, count, hasJobs } = useBackgroundJobs();
  const [open, setOpen] = useState(false);

  // Web L32-34: close the popover whenever the work drains away.
  useEffect(() => {
    if (!hasJobs) {
      setOpen(false);
    }
  }, [hasJobs]);

  // Web L53: stay completely out of the way when nothing is running.
  if (!hasJobs) {
    return null;
  }

  const summary =
    count === 1
      ? t('statusBar.background.one', '1 task')
      : t('statusBar.background.many', '{{count}} tasks', { count });

  const ariaLabel = t('statusBar.background.aria', 'Background tasks');
  // Web L60-64 Tooltip content, preserved as the trigger's accessibility hint.
  const tooltip = `${t(
    'statusBar.background.tooltip',
    'Background work in progress',
  )} · ${summary}`;

  return (
    <View style={[styles.container, style]}>
      <Pressable
        accessibilityHint={tooltip}
        accessibilityLabel={`${ariaLabel}: ${summary}`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(o => !o)}
        style={({ pressed }) => [
          styles.trigger,
          pressed && styles.triggerPressed,
        ]}
        testID={testID ?? 'background-work-segment'}
      >
        <Spinner color={AMBER_300} size={12} />
        {!iconOnly ? (
          <AppText
            style={styles.triggerLabel}
            variant="caption"
            weight="semibold"
          >
            {summary}
          </AppText>
        ) : null}
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable
          accessible={false}
          onPress={() => setOpen(false)}
          style={styles.backdrop}
        >
          <Pressable
            accessibilityLabel={ariaLabel}
            accessibilityViewIsModal
            // Swallow taps inside the card so they don't dismiss via the backdrop.
            onPress={() => {}}
            style={styles.popover}
          >
            <AppText style={styles.heading} tone="muted">
              {t('statusBar.background.heading', 'Running')}
            </AppText>
            <ScrollView
              contentContainerStyle={styles.listContent}
              style={styles.list}
            >
              {jobs.map(job => (
                <JobRow job={job} key={job.id} />
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

BackgroundWorkSegment.displayName = 'BackgroundWorkSegment';

const styles = StyleSheet.create({
  backdrop: {
    alignItems: 'flex-end',
    flex: 1,
    justifyContent: 'flex-end',
    padding: 12,
  },
  container: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
  },
  glyph: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    position: 'relative',
  },
  glyphAbsolute: {
    position: 'absolute',
  },
  glyphBarRounded: {
    borderRadius: 999,
    position: 'absolute',
  },
  glyphFloppyBody: {
    borderRadius: 2,
  },
  glyphTriangle: {
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    position: 'absolute',
  },
  heading: {
    fontSize: 10,
    letterSpacing: 0.8,
    paddingBottom: 4,
    paddingHorizontal: 6,
    textTransform: 'uppercase',
  },
  jobDescription: {
    fontSize: 10,
    lineHeight: 14,
  },
  jobLabel: {
    color: colors.textPrimary,
  },
  list: {
    maxHeight: 240,
  },
  listContent: {
    rowGap: 4,
  },
  popover: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    maxHeight: 280,
    minWidth: 260,
    padding: 8,
    ...shadows.panel,
  },
  row: {
    alignItems: 'flex-start',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  spinner: {
    flexShrink: 0,
  },
  trigger: {
    alignItems: 'center',
    borderRadius: 4,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  triggerLabel: {
    color: AMBER_300,
    fontSize: 11,
  },
  triggerPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
});

export default BackgroundWorkSegment;
