/**
 * BackupActionsCard — React Native parity port of
 * web/src/features/system/components/status/BackupActionsCard.tsx.
 *
 * Wraps the backup-status rows (supplied as `children`) with a "Run quick
 * backup now" mutation button. Behaviors preserved 1:1 from the source:
 *   - Disable the button while the mutation is in flight so a double-press
 *     can't fire two backups (the mutation.isPending guard in handleRun plus
 *     the disabled button).
 *   - Surface success/failure via a toast (native: React Native Alert).
 *   - Invalidate the ['backup-runs'] and ['system-status','backup-stats']
 *     queries after a successful run so the page reflects the new run.
 *   - Permission errors (401/403) surface a clear admin-permission message
 *     rather than the generic "Backup failed: …" message.
 *
 * Browser-only / not-yet-ported web dependencies are reduced explicitly and
 * documented in the .parity.json sidecar:
 *   - lucide-react Play / ExternalLink (web L17): DOM SVG icons → decorative
 *     AppText glyphs (▶ \u25B6 / ↗ \u2197), the established sibling-port
 *     convention; the implicit aria-hidden becomes
 *     importantForAccessibility="no-hide-descendants". The web `animate-pulse`
 *     applied to Play while pending has no inert RN analog and is dropped — the
 *     "Starting…" label already signals the in-flight state.
 *   - react-router-dom Link (web L18): React Native has no DOM anchor / browser
 *     history router, so the "Manage backups & restore" link becomes a
 *     Pressable with accessibilityRole="link"; navigation is delegated to an
 *     optional onNavigate(to) bridge prop wired up by the native navigation
 *     shell (the QuickNav / GuardedLink precedent). The `to="/backup"` path is
 *     preserved verbatim.
 *   - @/components/ui Button (web L19): the web Button (variant="primary"
 *     size="sm") is reproduced as a local native-safe Pressable matching the
 *     visual intent (accent surface, small height, icon + label, disabled +
 *     pressed feedback).
 *   - @/components/feedback/Toast useToast (web L20): no native Toast provider
 *     yet, so a local useToast() bridges success(title)/error(title) to React
 *     Native Alert.alert (the TeslaAccountSection / FleetAPIPage precedent).
 *   - @/api/devtools triggerQuickBackup (web L21) + @/api/client ApiError
 *     (web L22): the already-ported native modules.
 */

import {type ReactNode, useCallback, useMemo} from 'react';
import {Alert, Pressable, StyleSheet, View} from 'react-native';
import {useMutation, useQueryClient} from '@tanstack/react-query';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing, typography} from '../../../../../theme/tokens';
import {triggerQuickBackup} from '../../../../api/devtools';
import {ApiError} from '../../../../api/client';

// lucide-react glyph stand-ins (web L17).
const PLAY_GLYPH = '\u25B6'; // ▶ Play
const EXTERNAL_LINK_GLYPH = '\u2197'; // ↗ ExternalLink

// ── native-safe useToast (web @/components/feedback/Toast, source L20) ──
interface NativeToast {
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

function useToast(): NativeToast {
  return useMemo<NativeToast>(
    () => ({
      success: (title, message) => Alert.alert(title, message),
      error: (title, message) => Alert.alert(title, message),
    }),
    [],
  );
}

interface BackupActionsCardProps {
  /** The DefList rows already rendered for the backup section. */
  children: ReactNode;
  /**
   * Native bridge for the web react-router <Link to="/backup">. Invoked with
   * the destination path ("/backup") when the manage link is pressed. The web
   * file takes only `children`; this is the sole native-navigation addition.
   * Without it a press is an explicit no-op.
   */
  onNavigate?: (to: string) => void;
}

export function BackupActionsCard({children, onNavigate}: BackupActionsCardProps) {
  const qc = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: triggerQuickBackup,
    onSuccess: () => {
      toast.success('Quick backup started');
      qc.invalidateQueries({queryKey: ['backup-runs']});
      qc.invalidateQueries({queryKey: ['system-status', 'backup-stats']});
    },
    onError: (err: unknown) => {
      const status = err instanceof ApiError ? err.status : null;
      if (status === 401 || status === 403) {
        toast.error('Quick backup requires admin permission.');
      } else {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        toast.error(`Backup failed: ${msg}`);
      }
    },
  });

  const handleRun = useCallback(() => {
    if (mutation.isPending) {
      return;
    }
    mutation.mutate();
  }, [mutation]);

  const runLabel = mutation.isPending ? 'Starting…' : 'Run quick backup now';

  return (
    <View style={styles.container} testID="backup-actions-card-root">
      {children}
      <View style={styles.actionRow}>
        <Pressable
          accessibilityLabel={runLabel}
          accessibilityRole="button"
          accessibilityState={{
            busy: mutation.isPending,
            disabled: mutation.isPending,
          }}
          disabled={mutation.isPending}
          onPress={handleRun}
          style={({pressed}) => [
            styles.runButton,
            mutation.isPending && styles.runButtonDisabled,
            pressed && !mutation.isPending && styles.runButtonPressed,
          ]}
          testID="backup-actions-run-button">
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.runGlyph}>
            {PLAY_GLYPH}
          </AppText>
          <AppText style={styles.runLabel} weight="semibold">
            {runLabel}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityLabel="Manage backups & restore"
          accessibilityRole="link"
          onPress={() => onNavigate?.('/backup')}
          style={({pressed}) => [
            styles.manageLink,
            pressed && styles.manageLinkPressed,
          ]}
          testID="backup-actions-manage-link">
          <AppText style={styles.manageLabel}>Manage backups &amp; restore</AppText>
          <AppText
            importantForAccessibility="no-hide-descendants"
            style={styles.manageGlyph}>
            {EXTERNAL_LINK_GLYPH}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md + 4, // space-y-4 (16px)
  },
  actionRow: {
    alignItems: 'center',
    borderTopColor: 'rgba(255, 255, 255, 0.06)', // border-white/[0.06]
    borderTopWidth: 1,
    columnGap: spacing.sm, // gap-2 (8px)
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingTop: spacing.sm, // pt-2 (8px)
    rowGap: spacing.sm,
  },
  runButton: {
    alignItems: 'center',
    backgroundColor: colors.accent, // variant="primary"
    borderRadius: 10,
    columnGap: spacing.sm, // className="gap-2"
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 34, // size="sm"
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  runButtonDisabled: {
    opacity: 0.6,
  },
  runButtonPressed: {
    opacity: 0.82,
  },
  runGlyph: {
    color: colors.background, // dark glyph on accent surface
    fontSize: 13, // h-4 w-4
    lineHeight: 16,
  },
  runLabel: {
    color: colors.background,
    fontSize: typography.caption + 1, // text-sm on a small button
  },
  manageLink: {
    alignItems: 'center',
    borderRadius: 8, // rounded-md
    columnGap: 6, // gap-1.5
    flexDirection: 'row',
    paddingHorizontal: spacing.md, // px-3
    paddingVertical: 6, // py-1.5
  },
  manageLinkPressed: {
    backgroundColor: colors.surfaceHover, // hover:bg-white/[0.04]
  },
  manageLabel: {
    color: colors.accent, // text-cyan-300
    fontSize: 14, // text-sm
  },
  manageGlyph: {
    color: colors.accent,
    fontSize: 12, // h-3.5 w-3.5
    lineHeight: 16,
  },
});
