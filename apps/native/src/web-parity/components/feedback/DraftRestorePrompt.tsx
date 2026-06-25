// Native parity port of web/src/components/feedback/DraftRestorePrompt.tsx.
//
// The web component surfaces unsaved `useFormDraft` work after a tab close,
// browser crash, PWA reload, or auth redirect. It is mounted once globally and:
//   1. Listens for `formDraft.acquired`/`formDraft.released`/`formDraft.committed`
//      BroadcastChannel messages from sibling tabs during a grace period, building
//      a set of draft keys being actively edited elsewhere right now.
//   2. Reads the localStorage-backed draft index (`getDrafts`) and filters out
//      anything in that active set.
//   3. Renders a compact bottom-left card with a "Review" affordance that opens a
//      modal listing every draft with individual "Resume"/"Discard" actions.
//
// This native version reproduces the same public contract (`gracePeriodMs`,
// `skipSessionGuard`) and the same state machine / visual + behavioural intent
// using React Native primitives, the existing AppText + design tokens, and a
// native Modal.
//
// Browser-only dependencies are reduced explicitly and documented in the sidecar:
//   - `@/lib/draftIndex` (localStorage-backed index): React Native has no
//     `localStorage`, and AsyncStorage is not a dependency of this app, so there is
//     no persistent crash-recovery store to read on native. The index is ported as
//     an in-memory, native-safe registry (`registerNativeDraft` + `getDrafts` +
//     `discardDraftEnvelope` + `subscribeDraftIndex`) preserving the validation,
//     pruning-by-discard, most-recent-first sort, and subscriber-notification
//     semantics. On a fresh launch with nothing registered the registry is empty,
//     so the prompt never surfaces -- the explicit "unavailable" state for a
//     platform with no cross-restart browser storage.
//   - `@/lib/broadcast` (BroadcastChannel cross-tab bus): a React Native app is a
//     single instance with no sibling "tabs", so `subscribeBroadcast` is a
//     native-safe no-op that returns an unsubscribe and never fires. `TAB_ID`
//     remains a stable per-runtime identifier. The grace-period collection of
//     cross-tab `formDraft.acquired` claims is preserved structurally but yields an
//     empty active-set on native.
//   - sessionStorage one-shot guard: replaced by a module-level flag that lives for
//     the lifetime of the JS runtime (a relaunch re-prompts, mirroring "new
//     session re-prompts").
//   - react-router-dom `useNavigate` + `window.location.assign`: replaced by an
//     optional `onNavigate(route)` bridge prop (the established native pattern). A
//     native navigator can route the in-app pathname; without it "Resume" still
//     dismisses (explicit no-op nav).
//   - react-i18next `useTranslation`: replaced by a native-safe `t(key, default,
//     params)` fallback that returns the English default with `{{token}}`
//     interpolation and count-based pluralization preserved.
//   - lucide `FileWarning`/`X`: rendered as decorative AppText glyphs.
//   - `@/lib/dateFormat` `formatRelativeTime`: ported verbatim (Just now / Nm ago /
//     Nh ago / localized date) with a guarded toLocale fallback for RN Intl.

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Modal, Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors, shadows, spacing, typography} from '../../../theme/tokens';

// ── native translation fallback (native-safe port of react-i18next) ──
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  defaultValue: string,
  params?: NativeTParams,
) => string;

function interpolate(template: string, params?: NativeTParams): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

function useNativeTranslationFallback(): NativeTFunction {
  return useRef<NativeTFunction>((_key, defaultValue, params) =>
    interpolate(defaultValue, params),
  ).current;
}

// ── relative-time formatter (native-safe port of @/lib/dateFormat) ──
// Verbatim port of formatRelativeTime: "—" for nullish, "Just now" < 1m,
// "{n}m ago" < 60m, "{n}h ago" < 24h, otherwise a localized short date. The
// web call passes a Date built from `entry.savedAt`.
function formatRelativeTime(value: Date | number | string | null | undefined): string {
  if (!value && value !== 0) return '—';
  const d = value instanceof Date ? value : new Date(value);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  try {
    return d.toLocaleDateString(undefined, {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
    });
  } catch {
    // Some React Native runtimes ship a reduced Intl -- fall back to a plain
    // date string so the row still renders a "when".
    return d.toDateString();
  }
}

// ── draft index (in-memory, native-safe port of @/lib/draftIndex) ──
// The web index is localStorage-backed for crash recovery. React Native has no
// localStorage (and AsyncStorage is not a dependency), so there is no
// cross-restart store. The registry below preserves the same entry shape,
// validation, most-recent-first ordering, discard semantics, and same-process
// change notifications, but lives only for the JS runtime's lifetime.
export interface DraftEntry {
  /** Full storage key of the underlying envelope. */
  storageKey: string;
  /** User-supplied logical key (without the version prefix). */
  key: string;
  /** Schema version embedded in the storage key. */
  version: number;
  /** Human-readable label to show in the recovery prompt. */
  label: string;
  /** Where to navigate when the user taps "Resume". */
  route: string;
  /** Last persistence time (epoch ms). Drives the "X minutes ago" copy. */
  savedAt: number;
  /**
   * `true` when the entry was synthesised from a fallback rule because the
   * envelope had no explicit registration. The prompt may render these
   * slightly differently (e.g. a weaker "Resume" affordance).
   */
  fallback?: boolean;
}

const nativeDrafts = new Map<string, DraftEntry>();
const draftIndexSubscribers = new Set<() => void>();

function isValidEntry(value: unknown): value is DraftEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    typeof e.storageKey === 'string' &&
    typeof e.key === 'string' &&
    typeof e.version === 'number' &&
    typeof e.label === 'string' &&
    typeof e.route === 'string' &&
    typeof e.savedAt === 'number' &&
    Number.isFinite(e.savedAt)
  );
}

function notifyDraftIndex(): void {
  for (const handler of draftIndexSubscribers) {
    try {
      handler();
    } catch {
      // Never let one subscriber crash the bus.
    }
  }
}

/**
 * Native host/test seam: register (or refresh) a recoverable draft. Mirrors the
 * web index's `registerDraft`. Without any caller feeding entries the registry
 * stays empty and the prompt never surfaces -- the explicit unavailable state
 * for a platform with no browser crash-recovery storage.
 */
export function registerNativeDraft(entry: DraftEntry): void {
  if (!isValidEntry(entry)) return;
  nativeDrafts.set(entry.storageKey, {...entry, fallback: entry.fallback ?? false});
  notifyDraftIndex();
}

/**
 * Returns every recoverable draft, most-recent first. Mirrors the web
 * `getDrafts` ordering contract.
 */
export function getDrafts(): DraftEntry[] {
  return Array.from(nativeDrafts.values()).sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Removes both the registry entry and (web: the underlying envelope) so the
 * recovery prompt's "Discard" clears the draft. Notifies subscribers.
 */
export function discardDraftEnvelope(storageKey: string): void {
  if (nativeDrafts.delete(storageKey)) {
    notifyDraftIndex();
  }
}

/**
 * Subscribes to draft-index changes. Returns an unsubscribe function. Mirrors
 * the web `subscribeDraftIndex` contract (same-process notifications only --
 * native has no cross-tab `storage` event).
 */
export function subscribeDraftIndex(handler: () => void): () => void {
  draftIndexSubscribers.add(handler);
  return () => {
    draftIndexSubscribers.delete(handler);
  };
}

/** Test-only helper: wipe the in-memory registry and its subscribers. */
export function __resetNativeDraftRegistryForTests(): void {
  nativeDrafts.clear();
  draftIndexSubscribers.clear();
}

// ── cross-tab bus (native-safe no-op port of @/lib/broadcast) ──
// A React Native app is a single instance with no sibling tabs, so there is no
// cross-tab claim traffic. `subscribeBroadcast` returns a no-op unsubscribe and
// never fires; `TAB_ID` remains a stable per-runtime id used by the self-filter.
type NativeBroadcastMessage =
  | {type: 'formDraft.acquired'; draftKey: string; tabId: string; ts: number}
  | {type: 'formDraft.released'; draftKey: string; tabId: string}
  | {type: 'formDraft.committed'; draftKey: string};

export const TAB_ID: string = `native-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

function subscribeBroadcast(
  _handler: (msg: NativeBroadcastMessage) => void,
): () => void {
  // No cross-tab transport on native; nothing ever arrives.
  return () => {};
}

// ── one-shot session guard (native-safe port of the sessionStorage flag) ──
// Lives for the lifetime of the JS runtime: a relaunch re-prompts, matching the
// web "fresh session re-prompts" behaviour.
const PROMPT_GRACE_MS = 1500;

let sessionDismissed = false;

function readDismissed(): boolean {
  return sessionDismissed;
}

function writeDismissed(): void {
  sessionDismissed = true;
}

export interface DraftRestorePromptProps {
  /**
   * Test seam: shorten the grace period used to collect cross-tab
   * `formDraft.acquired` claims before the prompt evaluates. Defaults to
   * {@link PROMPT_GRACE_MS}. Production callers should never set this.
   */
  gracePeriodMs?: number;
  /**
   * Test seam: skip the one-shot session guard. Production callers should
   * never set this.
   */
  skipSessionGuard?: boolean;
  /**
   * Native bridge replacing react-router's `navigate`. Invoked with the
   * in-app pathname when the user taps "Resume". When omitted, "Resume"
   * still dismisses the prompt but performs no navigation.
   */
  onNavigate?: (route: string) => void;
}

export function DraftRestorePrompt({
  gracePeriodMs = PROMPT_GRACE_MS,
  skipSessionGuard = false,
  onNavigate,
}: DraftRestorePromptProps = {}) {
  const t = useNativeTranslationFallback();

  const [drafts, setDrafts] = useState<DraftEntry[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const evaluatedRef = useRef(false);

  // Mount-time evaluation: collect cross-tab `acquired` claims during the grace
  // period, then surface anything left over once.
  useEffect(() => {
    if (evaluatedRef.current) return;
    evaluatedRef.current = true;
    if (!skipSessionGuard && readDismissed()) return;

    const activeKeys = new Set<string>();
    const unsubBus = subscribeBroadcast(msg => {
      if (msg.type === 'formDraft.acquired') {
        if (msg.tabId === TAB_ID) return;
        activeKeys.add(msg.draftKey);
      } else if (
        msg.type === 'formDraft.released' ||
        msg.type === 'formDraft.committed'
      ) {
        const key = 'draftKey' in msg ? msg.draftKey : null;
        if (key) activeKeys.delete(key);
      }
    });

    const timer = setTimeout(() => {
      const all = getDrafts();
      const surfaced = all.filter(d => !activeKeys.has(d.storageKey));
      if (surfaced.length > 0) {
        setDrafts(surfaced);
        setShowPrompt(true);
      }
      unsubBus();
    }, gracePeriodMs);

    return () => {
      clearTimeout(timer);
      unsubBus();
    };
  }, [gracePeriodMs, skipSessionGuard]);

  // Keep the modal in sync with the index -- if a draft is discarded elsewhere
  // while the modal is open, the row should disappear here too.
  useEffect(() => {
    if (!reviewOpen) return;
    const handler = () => {
      setDrafts(prev => {
        if (prev.length === 0) return prev;
        const fresh = getDrafts();
        const freshByKey = new Map(fresh.map(d => [d.storageKey, d]));
        const next = prev
          .map(d => freshByKey.get(d.storageKey))
          .filter((d): d is DraftEntry => Boolean(d));
        if (next.length === 0) {
          setReviewOpen(false);
          setShowPrompt(false);
        }
        return next;
      });
    };
    return subscribeDraftIndex(handler);
  }, [reviewOpen]);

  const handleDismiss = useCallback(() => {
    writeDismissed();
    setShowPrompt(false);
    setReviewOpen(false);
  }, []);

  const handleReview = useCallback(() => {
    setReviewOpen(true);
  }, []);

  const handleResume = useCallback(
    (entry: DraftEntry) => {
      writeDismissed();
      setReviewOpen(false);
      setShowPrompt(false);
      // Every recovery route is an in-app pathname; the native navigator
      // resolves it. Without a bridge the prompt simply dismisses.
      if (onNavigate) {
        try {
          onNavigate(entry.route);
        } catch {
          // Defensive: a bad route must not crash the recovery flow.
        }
      }
    },
    [onNavigate],
  );

  const handleDiscard = useCallback((entry: DraftEntry) => {
    discardDraftEnvelope(entry.storageKey);
    setDrafts(prev => {
      const next = prev.filter(d => d.storageKey !== entry.storageKey);
      if (next.length === 0) {
        setReviewOpen(false);
        setShowPrompt(false);
      }
      return next;
    });
  }, []);

  const count = drafts.length;

  if (!showPrompt && !reviewOpen) return null;

  const promptBody = t(
    'draft.recovery.promptBody',
    count === 1
      ? 'You have {{count}} unsaved draft from a previous session.'
      : 'You have {{count}} unsaved drafts from a previous session.',
    {count},
  );

  return (
    <>
      {showPrompt && !reviewOpen ? (
        <View
          accessibilityLiveRegion="polite"
          accessible
          style={styles.card}
          testID="draft-restore-prompt">
          <View style={styles.cardRow}>
            <View style={styles.iconBadge}>
              <AppText
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={styles.iconGlyph}>
                {'\u26A0'}
              </AppText>
            </View>
            <View style={styles.cardBody}>
              <AppText style={styles.cardTitle} weight="semibold">
                {t('draft.recovery.promptTitle', 'Unsaved drafts restored')}
              </AppText>
              <AppText style={styles.cardSubtitle} tone="secondary" variant="caption">
                {promptBody}
              </AppText>
              <View style={styles.cardActions}>
                <ActionButton
                  label={t('draft.recovery.review', 'Review')}
                  onPress={handleReview}
                  testID="draft-restore-prompt-review"
                  variant="primary"
                />
                <ActionButton
                  label={t('draft.recovery.dismiss', 'Dismiss')}
                  onPress={handleDismiss}
                  testID="draft-restore-prompt-dismiss"
                  variant="ghost"
                />
              </View>
            </View>
            <Pressable
              accessibilityLabel={t('draft.recovery.close', 'Close')}
              accessibilityRole="button"
              hitSlop={8}
              onPress={handleDismiss}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.closeGlyph}>{'\u2715'}</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      <Modal
        animationType="fade"
        onRequestClose={handleDismiss}
        transparent
        visible={reviewOpen}>
        <View style={styles.overlay}>
          <Pressable
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onPress={handleDismiss}
            style={styles.backdrop}
          />
          <View style={styles.dialog} testID="draft-restore-modal">
            <AppText style={styles.dialogTitle} variant="title" weight="bold">
              {t('draft.recovery.modalTitle', 'Restore unsaved drafts')}
            </AppText>

            <AppText style={styles.dialogBody} tone="secondary">
              {t(
                'draft.recovery.modalBody',
                'These drafts were saved before this session. Resume to continue editing or discard to clear them.',
              )}
            </AppText>

            {drafts.length === 0 ? (
              <AppText
                style={styles.emptyText}
                testID="draft-restore-modal-empty"
                tone="muted">
                {t('draft.recovery.empty', 'No drafts to restore.')}
              </AppText>
            ) : (
              <ScrollView
                style={styles.list}
                testID="draft-restore-modal-list">
                {drafts.map(entry => (
                  <View
                    key={entry.storageKey}
                    style={styles.row}
                    testID={`draft-restore-row-${entry.storageKey}`}>
                    <View style={styles.rowBody}>
                      <AppText
                        numberOfLines={1}
                        style={styles.rowLabel}
                        weight="semibold">
                        {entry.label ||
                          t('draft.recovery.fallbackLabel', 'Unsaved draft')}
                      </AppText>
                      <AppText
                        style={styles.rowMeta}
                        tone="secondary"
                        variant="caption">
                        {t('draft.recovery.savedAt', 'Saved {{when}}', {
                          when: formatRelativeTime(new Date(entry.savedAt)),
                        })}
                      </AppText>
                    </View>
                    <View style={styles.rowActions}>
                      <ActionButton
                        label={t('draft.recovery.resume', 'Resume')}
                        onPress={() => handleResume(entry)}
                        testID={`draft-restore-resume-${entry.storageKey}`}
                        variant="primary"
                      />
                      <ActionButton
                        label={t('draft.recovery.discard', 'Discard')}
                        onPress={() => handleDiscard(entry)}
                        testID={`draft-restore-discard-${entry.storageKey}`}
                        variant="ghost"
                      />
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}

            <View style={styles.dialogFooter}>
              <ActionButton
                label={t('draft.recovery.close', 'Close')}
                onPress={handleDismiss}
                testID="draft-restore-modal-close"
                variant="ghost"
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
DraftRestorePrompt.displayName = 'DraftRestorePrompt';

function ActionButton({
  label,
  onPress,
  testID,
  variant,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  variant: 'primary' | 'ghost';
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        variant === 'primary' ? styles.primaryButton : styles.ghostButton,
        pressed && styles.pressed,
      ]}
      testID={testID}>
      <AppText
        style={variant === 'primary' ? styles.primaryButtonText : styles.ghostButtonText}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/** Test-only helper: clear the per-session one-shot guard. */
export function __resetDraftRestorePromptForTests(): void {
  sessionDismissed = false;
}

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    bottom: spacing.lg,
    left: spacing.lg,
    maxWidth: 384,
    padding: spacing.md,
    position: 'absolute',
    zIndex: 90,
    ...shadows.panel,
  },
  cardActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cardBody: {
    flex: 1,
    minWidth: 0,
  },
  cardRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  cardSubtitle: {
    marginTop: spacing.xs,
  },
  cardTitle: {
    color: colors.textPrimary,
  },
  closeButton: {
    borderRadius: 8,
    padding: spacing.xs,
  },
  closeGlyph: {
    color: colors.textMuted,
    fontSize: typography.body,
    lineHeight: typography.body,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.lg,
    maxWidth: 560,
    padding: spacing.lg,
    width: '92%',
    ...shadows.panel,
  },
  dialogBody: {
    lineHeight: 22,
  },
  dialogFooter: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.xs,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  emptyText: {
    paddingVertical: spacing.sm,
  },
  ghostButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },
  iconBadge: {
    backgroundColor: colors.warningSurface,
    borderRadius: 10,
    padding: spacing.xs,
  },
  iconGlyph: {
    color: colors.warning,
    fontSize: typography.body,
    lineHeight: typography.body,
  },
  list: {
    maxHeight: 280,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.82,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonText: {
    color: colors.background,
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: colors.textPrimary,
  },
  rowMeta: {
    marginTop: 2,
  },
});
