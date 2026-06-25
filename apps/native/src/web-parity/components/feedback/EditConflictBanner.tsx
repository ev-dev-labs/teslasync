// Native parity port of web/src/components/feedback/EditConflictBanner.tsx.
//
// The web banner is an in-place "another browser tab is editing this" warning.
// It wraps the web `useEditLease(resourceKey)` hook and renders an AlertBanner
// only when this tab does NOT own the edit lease AND a peer tab has announced
// ownership. Two siblings it depends on are NOT in the native parity manifest,
// so native-safe equivalents are inlined here:
//
//   - useEditLease (web/src/hooks/useEditLease): the web hook elects an
//     edit-lease owner across browser tabs of the same origin over the
//     BroadcastChannel-backed `lib/broadcast` bus (with a localStorage
//     storage-event fallback). React Native runs as a single app instance —
//     there is no BroadcastChannel, no localStorage `storage` events, and no
//     concept of "another tab of the same origin" — so the cross-tab transport
//     is structurally unavailable. The native port therefore reports the same
//     stable no-conflict snapshot the web hook itself returns from its opt-out
//     branch (`{ isOwner: false, otherTab: null, claim: noop }`): no peer can
//     ever announce ownership without a bus, and claim() is a no-op because
//     there is no previous owner to take the lease from. By the banner's own
//     `if (isOwner || otherTab === null) return null` guard this means the
//     conflict banner never surfaces on native — the correct behaviour for a
//     single-instance mobile app.
//
//   - AlertBanner (./AlertBanner) + Button (@/components/ui) + AlertTriangle
//     (lucide-react): none of these exist in the native tree, so the warning
//     AlertBanner is rendered inline with React Native primitives + theme
//     tokens (warning surface/border/text), the lucide AlertTriangle becomes a
//     decorative SemanticIcon name="warning", and the ghost "Take over editing"
//     Button becomes a compact ghost Pressable.
//
// The web `data-resource-key` / `data-other-tab-id` debug attributes have no
// React Native analogue (arbitrary data-* attributes are web-only) and are
// dropped; e2e targeting uses the preserved testIDs instead. The web
// role="status" + aria-live="polite" status region is preserved as an
// accessible polite live region around the title/body text.

import React, {useCallback, useMemo} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      // Mirror i18next `{{name}}` interpolation against the web fallback copy.
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// useEditLease — native-safe port of web/src/hooks/useEditLease.ts.
//
// React Native has no BroadcastChannel / localStorage / peer tabs, so the
// cross-tab edit-lease election cannot run. The hook returns the same stable
// no-conflict snapshot the web hook exposes from its opt-out branch.
// ---------------------------------------------------------------------------

interface OtherTabInfo {
  /** Stable per-tab identifier of the peer that holds the lease. */
  tabId: string;
  /** Wall-clock time at which the peer claimed the lease. */
  claimedAt: number;
}

interface UseEditLeaseResult {
  /** This tab currently owns the edit lease for the resource. */
  isOwner: boolean;
  /**
   * Information about a peer tab that holds the lease. Always `null` on native
   * because no peer tab can announce ownership without a broadcast bus.
   */
  otherTab: OtherTabInfo | null;
  /**
   * Forcibly take over the edit lease. No-op on native — there is no previous
   * owner to yield the lease.
   */
  claim: () => void;
}

function useEditLease(_resourceKey: string): UseEditLeaseResult {
  const claim = useCallback(() => {
    // No-op on native: no peer tab exists to take the edit lease from.
  }, []);

  return useMemo<UseEditLeaseResult>(
    () => ({isOwner: false, otherTab: null, claim}),
    [claim],
  );
}

/**
 * In-place "another tab is editing this" warning.
 *
 * Wraps {@link useEditLease} for a `resourceKey` and renders the warning banner
 * only when this tab does NOT currently own the edit lease AND a peer tab has
 * been observed claiming it. On native there is never a peer tab, so the banner
 * stays hidden — see the file header for the cross-tab transport caveat.
 *
 * The banner exposes two affordances per the design:
 *
 *   - **Take over editing** — calls `claim()` on the lease (a no-op on native).
 *   - **Switch to other tab** — informational only.
 */
export interface EditConflictBannerProps {
  /**
   * Stable identifier for the resource being edited. Two tabs with the same
   * `resourceKey` race to own the edit lease; different keys are independent.
   * Convention is `<feature>/<scope>/<id>` — e.g. `settings/anonymous/general`,
   * `automation/42`, `alert-rules/list`.
   */
  resourceKey: string;
  /**
   * Optional human-readable noun used in the banner copy. Falls back to a
   * generic "this resource" string when omitted.
   */
  resourceLabel?: string;
}

export function EditConflictBanner({
  resourceKey,
  resourceLabel,
}: EditConflictBannerProps): React.ReactElement | null {
  const t = useNativeTranslationFallback();
  const {isOwner, otherTab, claim} = useEditLease(resourceKey);

  // No banner when this tab is the owner OR when no peer has announced
  // ownership yet — a fresh page load with no peer is not a conflict.
  if (isOwner || otherTab === null) {
    return null;
  }

  const title = t(
    'editConflict.banner.title',
    'Another browser tab is editing this',
  );
  const body = resourceLabel
    ? t(
        'editConflict.banner.bodyWithLabel',
        '{{resource}} is open in another tab of this browser. Saving here will overwrite changes made there.',
        {resource: resourceLabel},
      )
    : t(
        'editConflict.banner.body',
        'This resource is open in another tab of this browser. Saving here will overwrite changes made there.',
      );

  return (
    <View style={styles.banner} testID="edit-conflict-banner">
      <SemanticIcon decorative name="warning" size="sm" style={styles.icon} />
      <View style={styles.content}>
        <View
          accessibilityLabel={`${title}. ${body}`}
          accessibilityLiveRegion="polite"
          accessible>
          <AppText style={styles.title} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.body}>{body}</AppText>
        </View>
        <View style={styles.actionRow}>
          <Pressable
            accessibilityLabel={t(
              'editConflict.banner.takeOver',
              'Take over editing',
            )}
            accessibilityRole="button"
            onPress={claim}
            style={({pressed}) => [
              styles.takeOverButton,
              pressed && styles.pressed,
            ]}
            testID="edit-conflict-take-over">
            <AppText style={styles.takeOverText} weight="semibold">
              {t('editConflict.banner.takeOver', 'Take over editing')}
            </AppText>
          </Pressable>
          <AppText
            style={styles.switchHint}
            testID="edit-conflict-switch-hint"
            tone="muted">
            {t(
              'editConflict.banner.switchHint',
              'Or switch to your other tab to keep editing there.',
            )}
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  banner: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.lg,
  },
  body: {
    color: colors.warning,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  content: {
    flex: 1,
  },
  icon: {
    marginTop: 2,
  },
  pressed: {
    opacity: 0.82,
  },
  switchHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  takeOverButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  takeOverText: {
    color: colors.textPrimary,
    fontSize: 12,
    lineHeight: 16,
  },
  title: {
    color: colors.warning,
    fontSize: 14,
    lineHeight: 20,
  },
});

export default EditConflictBanner;
