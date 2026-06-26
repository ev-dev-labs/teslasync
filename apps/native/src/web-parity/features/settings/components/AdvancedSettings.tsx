// Native parity port of
// web/src/features/settings/components/AdvancedSettings.tsx.
//
// AdvancedSettings is the "Restore confirmation prompts" panel: it lists every
// action id the user previously silenced via a `<ConfirmDialog>` "Don't ask
// again" checkbox and lets them re-enable individual prompts or all at once. It
// renders a GlassPanel with an IconBox + title/description header (plus a
// conditional "Restore all" button) and then either an EmptyState (nothing
// silenced) or a divided list of silenced keys, each with its own "Restore"
// button.
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next `useTranslation` (web L2) -> a native-safe `useTranslation`
//     hook (no i18n runtime in RN): `t(key, fallback, options?)` returns the
//     fallback verbatim (with {{var}} interpolation), and the namespace argument
//     ('settings') is accepted + ignored. Every i18n KEY string and English
//     fallback — including `useSilenceKeyLabel`'s full `settings.advanced.*`
//     keys vs the panel's namespace-relative `advanced.*` keys — is preserved
//     exactly so the translation intent is unchanged.
//   - lucide-react `ShieldQuestion`/`RotateCcw` (web L3, DOM SVG) -> short text
//     glyphs ('?' for the shield-question header icon; '↺' U+21BA, the exact
//     visual of a counter-clockwise "restore"/undo arrow, for the buttons),
//     rendered inline via AppText and marked decorative for screen readers.
//   - `@/components/ui` GlassPanel/IconBox/Button (web L4) -> the native
//     GlassPanel + inline IconBox (the sole `color="cyan"` call site reproduced
//     with bg-neon-cyan/10 + ring-neon-cyan/20 + text-cyan-300) + inline Button
//     (the sole ghost/sm + leading-icon call shape).
//   - `@/components/motion` FadeIn (web L5) -> inline passthrough View; the web
//     FadeIn is a framer-motion entrance with no drop-in RN parity-layer
//     equivalent, so `delay` (0.24) is accepted and ignored.
//   - `@/components/feedback` EmptyState (web L6) -> inline EmptyState rendering
//     the single `message` (the only prop this call site passes).
//   - `@/lib/confirmSilence` (web L7) `listSilenced`/`unsilence`/
//     `clearAllSilenced` is localStorage-backed. localStorage has no React
//     Native analog and no storage dependency is wired into this parity layer,
//     so the single allowlist key is backed by a native-safe in-memory string
//     cell mirroring the getItem/setItem string contract (the ThemeProvider
//     precedent). Cross-restart persistence is therefore UNAVAILABLE on native;
//     within a session the dedupe/sort/read/write behaviour is identical.
//   - text colours map to AppText tones: `text-[var(--text-primary)]` -> the
//     default primary tone, `text-[var(--text-muted)]` -> tone="muted"; the
//     cyan icon glyph uses an explicit text-cyan-300 colour. DOM `div`/`h2`/`p`/
//     `ul`/`li`/`span` map to View/AppText.
// See the .parity.json sidecar for the line-by-line source map.

import React, {useCallback, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {spacing} from '../../../../theme/tokens';

// ---- Native-safe i18n fallback (web react-i18next useTranslation, L2) --------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(_namespace?: string): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
  return {t};
}

// ---- Native-safe confirm-silence store (web @/lib/confirmSilence, L7) --------
// localStorage -> in-memory string cell (the ThemeProvider precedent). The
// JSON array shape, the dedupe-on-read, and the sorted listing are preserved
// verbatim; only the persistence backend changes, so cross-restart memory is
// UNAVAILABLE on native (documented in the sidecar).

const CONFIRM_SILENCE_STORAGE_KEY = 'teslasync:confirm-silence:v1';
const nativeSilenceStore = new Map<string, string>();

function loadSilenced(): Set<string> {
  try {
    const raw = nativeSilenceStore.get(CONFIRM_SILENCE_STORAGE_KEY);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return new Set();
    }
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function saveSilenced(set: Set<string>): void {
  try {
    nativeSilenceStore.set(
      CONFIRM_SILENCE_STORAGE_KEY,
      JSON.stringify([...set]),
    );
  } catch {
    // Mirrors the web defensive ignore — a failed write just re-prompts later.
  }
}

/** Re-enable the prompt for a single action id (web `unsilence`). */
function unsilence(key: string): void {
  if (!key) {
    return;
  }
  const s = loadSilenced();
  if (!s.delete(key)) {
    return;
  }
  saveSilenced(s);
}

/** All currently-silenced action ids, sorted for stable rendering. */
function listSilenced(): string[] {
  return [...loadSilenced()].sort();
}

/** Wipe every silenced action id ("Restore all confirmation prompts"). */
function clearAllSilenced(): void {
  try {
    nativeSilenceStore.delete(CONFIRM_SILENCE_STORAGE_KEY);
  } catch {
    // Same defensive ignore as saveSilenced — a failed clear is recoverable.
  }
}

// ---- lucide-react glyphs (web L3) -------------------------------------------

const SHIELD_QUESTION_GLYPH = '?'; // ShieldQuestion — confirmation/question icon
const ROTATE_CCW_GLYPH = '↺'; // RotateCcw — restore / counter-clockwise undo

/**
 * Friendly labels for known silenceKey ids. Falls back to the raw key when an
 * unknown id appears (forward-compat for new adopters that haven't shipped a
 * translation yet). Web L14-29.
 */
function useSilenceKeyLabel(): (key: string) => string {
  const {t} = useTranslation();
  return useCallback(
    (key: string) => {
      switch (key) {
        case 'discard-draft':
          return t(
            'settings.advanced.restoreConfirms.keys.discardDraft',
            'Discard unsaved draft',
          );
        case 'unsaved-navigation':
          return t(
            'settings.advanced.restoreConfirms.keys.unsavedNavigation',
            'Leave page with unsaved changes',
          );
        default:
          return key;
      }
    },
    [t],
  );
}

// ---- IconBox (web @/components/ui IconBox, color="cyan") ---------------------

function IconBox({children}: {children: React.ReactNode}): React.ReactElement {
  return <View style={styles.iconBox}>{children}</View>;
}

// ---- Button (web @/components/ui Button, ghost/sm + leading icon) ------------

function Button({
  children,
  onPress,
  icon,
  style,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  icon?: React.ReactNode;
  /** Web parity props — only the ghost/sm shape is used, so they are inert. */
  variant?: 'ghost';
  size?: 'sm';
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={!onPress}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        pressed && styles.buttonPressed,
        style,
      ]}>
      {icon ?? null}
      <AppText style={styles.buttonLabel} tone="secondary" weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

// ---- RotateCcw icon glyph (web lucide RotateCcw) ----------------------------

function RotateIcon({size}: {size: number}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      tone="secondary"
      style={{fontSize: size, lineHeight: size + 2}}>
      {ROTATE_CCW_GLYPH}
    </AppText>
  );
}

// ---- FadeIn (web @/components/motion FadeIn) — no RN entrance animation ------

function FadeIn({
  children,
}: {
  children: React.ReactNode;
  delay?: number;
}): React.ReactElement {
  // Web FadeIn is a framer-motion entrance; no drop-in parity-layer equivalent,
  // so this is a passthrough and `delay` (0.24) is accepted and ignored.
  return <View>{children}</View>;
}

// ---- EmptyState (web @/components/feedback EmptyState, message-only) ---------

function EmptyState({message}: {message: string}): React.ReactElement {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/**
 * "Restore confirmation prompts" panel — surfaces every action id the user
 * previously silenced via the `<ConfirmDialog>` "Don't ask again" checkbox and
 * lets them re-enable individual prompts or all at once. Web L31-121.
 */
export function AdvancedSettings(): React.ReactElement {
  const {t} = useTranslation('settings');
  // Local bumper so each unsilence/clear re-reads the store without wiring a
  // global pub/sub. The only writers are this component itself (web L41-43).
  const [tick, setTick] = useState(0);
  const labelFor = useSilenceKeyLabel();

  const handleRestore = useCallback((key: string) => {
    unsilence(key);
    setTick(n => n + 1);
  }, []);

  const handleRestoreAll = useCallback(() => {
    clearAllSilenced();
    setTick(n => n + 1);
  }, []);

  // `tick` is read here so each bump re-derives the snapshot on the resulting
  // re-render — the native expression of the web `tick` bumper + `void tick;`
  // re-render dependency (web L60-62), kept lint-clean (no no-op void).
  const silenced = tick >= 0 ? listSilenced() : [];

  return (
    <FadeIn delay={0.24}>
      <GlassPanel style={styles.panel}>
        <View style={styles.header}>
          <IconBox>
            <AppText
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              weight="bold"
              style={styles.iconBoxGlyph}>
              {SHIELD_QUESTION_GLYPH}
            </AppText>
          </IconBox>
          <View style={styles.headerText}>
            <AppText weight="semibold" style={styles.title}>
              {t('advanced.restoreConfirms.title', 'Confirmation prompts')}
            </AppText>
            <AppText tone="muted" style={styles.description}>
              {t(
                'advanced.restoreConfirms.description',
                'Re-enable “Don’t ask again” prompts you previously silenced.',
              )}
            </AppText>
          </View>
          {silenced.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={handleRestoreAll}
              icon={<RotateIcon size={16} />}>
              {t('advanced.restoreConfirms.restoreAll', 'Restore all')}
            </Button>
          ) : null}
        </View>

        {silenced.length === 0 ? (
          <EmptyState
            // no-action: transient empty state — surfaces when no prompts are
            // silenced; no specific recovery action available.
            message={t(
              'advanced.restoreConfirms.empty',
              'No silenced prompts. Tick “Don’t ask again” on a confirmation dialog to silence it.',
            )}
          />
        ) : (
          <View style={styles.list}>
            {silenced.map((key, index) => (
              <View
                key={key}
                style={[styles.listItem, index > 0 && styles.listDivider]}>
                <AppText numberOfLines={1} style={styles.listLabel}>
                  {labelFor(key)}
                </AppText>
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={() => handleRestore(key)}
                  icon={<RotateIcon size={14} />}>
                  {t('advanced.restoreConfirms.restore', 'Restore')}
                </Button>
              </View>
            ))}
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

AdvancedSettings.displayName = 'AdvancedSettings';

const styles = StyleSheet.create({
  // web GlassPanel `p-5 space-y-4` (L66): padding 20 + 16px vertical gap.
  panel: {
    padding: spacing.lg,
    gap: 16,
  },
  // web header `flex items-center gap-3` (L67).
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // web IconBox cyan md `h-10 w-10 rounded-xl bg-neon-cyan/10 ring-neon-cyan/20`
  // (L68): 40x40, rounded-xl 12, bg/ring at neon-cyan #00f0ff alpha 0.1/0.2.
  iconBox: {
    height: 40,
    width: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 240, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(0, 240, 255, 0.2)',
  },
  // web ShieldQuestion `h-5 w-5`, inherits text-cyan-300 #67e8f9 (L69).
  iconBoxGlyph: {
    fontSize: 18,
    lineHeight: 22,
    color: '#67e8f9',
  },
  // web `flex-1 min-w-0` (L71).
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  // web h2 `text-base font-semibold text-[var(--text-primary)]` (L72).
  title: {
    fontSize: 16,
    lineHeight: 22,
  },
  // web p `text-xs text-[var(--text-muted)]` (L75).
  description: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web Button ghost/sm `h-8 px-3 text-xs` + `gap-2` (L83-90): transparent ghost.
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    borderRadius: 6,
    backgroundColor: 'transparent',
  },
  // web ghost `hover:bg-gray-100 dark:hover:bg-gray-800` -> pressed surface.
  buttonPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  // web button label `font-medium text-xs`.
  buttonLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  // web `ul ... rounded-lg border border-white/[0.06] bg-white/[0.02]` (L102).
  list: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    overflow: 'hidden',
  },
  // web li `flex items-center justify-between gap-3 px-3 py-2` (L104).
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  // web `divide-y divide-white/[0.06]` — top border on every item except first.
  listDivider: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  // web list label span `text-sm text-[var(--text-primary)] truncate` (L105).
  listLabel: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  // web EmptyState `flex flex-col items-center justify-center py-16 text-center`.
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
  },
  // web EmptyState message `Text variant="bodySm"` (text-sm), centered.
  emptyMessage: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
