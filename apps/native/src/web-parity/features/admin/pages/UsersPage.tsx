// Native parity port of web/src/features/admin/pages/UsersPage.tsx.
//
// Admin "Subjects" page: a minimal list of distinct subjects that currently
// hold an active auth session, each with a per-row "Impersonate" control. Every
// behaviour of the web page is preserved one-for-one:
//   - The same hook wiring and local names: status = useImpersonationStatus();
//     open = isImpersonationOpenMode(status.data);
//     active = isImpersonationActive(status.data);
//     candidates = useImpersonationCandidates({ enabled: !open }).
//   - The same derived value: subjects = candidates.data?.mode === 'session'
//     ? candidates.data.candidates : [].
//   - The identical five-way render order inside the panel: open-mode notice ->
//     loading spinner -> ErrorDisplay (with onRetry -> candidates.refetch()) ->
//     EmptyState ("No other subjects") -> the subjects list. Branch conditions
//     are byte-for-byte the same (open / candidates.isLoading / candidates.isError
//     / subjects.length === 0 / else).
//   - Every i18n key keeps its English default string (intent preserved):
//     impersonation.users.title/subtitle/openMode/emptyTitle/emptyMessage and
//     the UserImpersonateButton + ConfirmDialog keys.
//   - The web data-testid hooks become RN testID props verbatim:
//     users-page-open-mode / users-page-loading / users-page-list /
//     users-page-row-{subject} / user-impersonate-button-{subject}.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) => fallback shim reproducing i18next `{{name}}`
//     interpolation against the English fallback copy (the impersonate aria +
//     confirm message both interpolate {{subject}}).
//   - @/components/layout PageContainer -> inline native PageContainer (ScrollView
//     page with a title + subtitle header and a PageErrorBoundary). The web
//     loading/error/empty/copyLink/query PageContainer affordances are NOT used
//     by this page (it passes only title + subtitle), so they are intentionally
//     not reproduced.
//   - @/components/ui GlassPanel -> the existing native GlassPanel.
//   - @/components/feedback Spinner -> inline native Spinner (ActivityIndicator).
//   - @/components/feedback EmptyState -> inline native EmptyState
//     (optional icon + optional title + message).
//   - @/components/feedback ErrorDisplay -> inline native ErrorDisplay mirroring
//     the web status-branching card (404 / 401-403 / 5xx / network+offline) with
//     the same onRetry contract. Its react-router-dom navigate() /
//     window.location.href = '/login' actions route through a best-effort
//     Linking.openURL (no in-app router on native), and @/hooks/useOnlineStatus
//     degrades to a mount snapshot of the api client's last connection status
//     (React Native has no navigator.onLine / online-offline events). This page
//     only ever passes `error` + `onRetry`.
//   - ../components/UserImpersonateButton (web sibling component) -> inlined here
//     as a native UserImpersonateButton: same useState(open) + useStartImpersonation
//     wiring, same handleClick (no-op while disabled/pending) + handleConfirm
//     (close dialog, then start the mutation), rendering a ghost/sm Button and a
//     warning-variant ConfirmDialog. Its lucide-react UserCog icon maps to the
//     shared SemanticIcon 'userCheck' glyph; @/components/ui Button ->
//     inline native Button; @/components/ui ConfirmDialog -> inline native
//     Modal-backed ConfirmDialog supporting the props this caller uses
//     (open/title/message/confirmLabel/cancelLabel/variant/onConfirm/onCancel),
//     with backdrop + Android-back routed to onCancel.
//
// CSS vars / Tailwind map to tokens: --text-primary -> textPrimary,
// --text-secondary -> textSecondary, --text-muted -> textMuted; the amber warning
// surface/border/foreground -> warningSurface/warningBorder/warning; the
// divide-white/[0.06] row separators -> a hairline top border on each row after
// the first; font-mono -> a Platform-selected monospace family. No DOM-only
// modules, HTML elements, react-i18next, lucide-react, Recharts, Leaflet, or web
// UI components are imported — only react, react-native primitives, the ported
// web-parity useImpersonation hooks + api client, and existing apps/native
// SemanticIcon / AppText / GlassPanel / theme tokens.

import React, {useCallback, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

import {getConnectionStatus, isApiError} from '../../../api/client';
import {
  isImpersonationActive,
  isImpersonationOpenMode,
  useImpersonationCandidates,
  useImpersonationStatus,
  useStartImpersonation,
} from '../../../api/hooks/useImpersonation';

/* ─── shared types ────────────────────────────────────────────────────── */

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

const MONO_FONT = Platform.select({ios: 'Menlo', android: 'monospace', default: 'monospace'});

/* ─── i18n shim (react-i18next useTranslation) ────────────────────────── */

// Returns the English fallback the source passes as the second argument, with
// i18next `{{name}}` interpolation applied against that fallback when an options
// bag is supplied. Mirrors the established AuditLogPage / QueryError pattern.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ─── native-safe navigation + connectivity (ErrorDisplay deps) ───────── */

// react-router-dom useNavigate() / window.location.href have no native analogue.
// Web route strings are handed to the platform URL handler on a best-effort
// basis; unresolvable routes are swallowed so a failed navigation never crashes
// the error card.
function useNativeHrefNavigation(): (href: string) => void {
  return useCallback((href: string) => {
    Promise.resolve()
      .then(() => Linking.openURL(href))
      .catch(() => undefined);
  }, []);
}

// Native-safe port of web @/hooks/useOnlineStatus. React Native has no
// navigator.onLine and no online/offline events, so live connectivity
// transitions are not observable; we snapshot the api client's last observed
// status at mount and treat only 'offline' as disconnected.
function useOnlineStatus(): boolean {
  const [online] = useState<boolean>(() => getConnectionStatus() !== 'offline');
  return online;
}

/* ─── PageErrorBoundary (web @/components/feedback PageErrorBoundary) ──── */

class PageErrorBoundary extends React.Component<
  {pageName?: string; children: ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};

  static getDerivedStateFromError(): {hasError: boolean} {
    return {hasError: true};
  }

  componentDidCatch(): void {
    // Render-time crashes are contained to this page subtree, mirroring the web
    // PageErrorBoundary; the fallback message replaces the children.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <AppText style={styles.boundaryFallback} tone="danger" variant="caption">
          Something went wrong rendering this page.
        </AppText>
      );
    }
    return this.props.children;
  }
}

/* ─── PageContainer (web @/components/layout PageContainer) ────────────── */

function PageContainer({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}>
      <View style={styles.pageHeader}>
        <AppText style={styles.pageTitle} variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <PageErrorBoundary pageName={title}>{children}</PageErrorBoundary>
    </ScrollView>
  );
}

/* ─── Spinner (web @/components/feedback Spinner) ──────────────────────── */

function Spinner({size = 'md'}: {size?: 'sm' | 'md' | 'lg'}) {
  return (
    <ActivityIndicator
      accessibilityLabel="Loading"
      color={colors.accent}
      size={size === 'sm' ? 'small' : 'large'}
    />
  );
}

/* ─── EmptyState (web @/components/feedback EmptyState) ────────────────── */

function EmptyState({
  icon,
  title,
  message,
  testID,
}: {
  icon?: SemanticIconName;
  title?: string;
  message: string;
  testID?: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState} testID={testID}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      ) : null}
      {title ? (
        <AppText style={styles.emptyTitle} weight="bold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="secondary" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ─── ErrorAction + ErrorState (web @/components/feedback _ErrorState) ─── */

function ErrorAction({
  label,
  onPress,
  disabled = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.errorActionButton,
        disabled && styles.errorActionDisabled,
        pressed && !disabled && styles.pressed,
      ]}
      testID={testID}>
      <AppText style={styles.errorActionLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

function ErrorState({
  glyph,
  title,
  message,
  action,
  role = 'alert',
  ariaLive = 'assertive',
}: {
  glyph: string;
  title: string;
  message: string;
  action?: ReactNode;
  role?: 'alert' | 'status';
  ariaLive?: 'polite' | 'assertive';
}) {
  return (
    <View
      accessibilityLiveRegion={ariaLive}
      accessibilityRole={role === 'alert' ? 'alert' : undefined}
      style={styles.errorCard}
      testID="users-page-error">
      <View style={styles.errorRow}>
        <View style={styles.errorIconBadge}>
          <AppText style={styles.errorIconGlyph} weight="bold">
            {glyph}
          </AppText>
        </View>
        <View style={styles.errorContent}>
          <AppText style={styles.errorTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.errorMessage}>{message}</AppText>
        </View>
        {action ? <View style={styles.errorActionSlot}>{action}</View> : null}
      </View>
    </View>
  );
}

/* ─── ErrorDisplay (web @/components/feedback ErrorDisplay) ────────────── */

function ErrorDisplay({
  error,
  onRetry,
  resourceName,
  listHref,
}: {
  error: unknown;
  onRetry?: () => void;
  resourceName?: string;
  listHref?: string;
}) {
  const t = useNativeTranslation();
  const navigate = useNativeHrefNavigation();
  const online = useOnlineStatus();

  if (!error) {
    return null;
  }

  const status = isApiError(error) ? error.status : undefined;

  // 404 — record was deleted or URL is wrong.
  if (status === 404) {
    const thing = resourceName ?? t('error.notFound.thingDefault', 'Resource');
    return (
      <ErrorState
        action={
          listHref ? (
            <ErrorAction
              label={t('error.notFound.cta', 'Back to list')}
              onPress={() => navigate(listHref)}
            />
          ) : undefined
        }
        glyph="?"
        message={t('error.notFound.message', 'It may have been deleted or the link is wrong.')}
        title={t('error.notFound.title', '{{thing}} not found', {thing})}
      />
    );
  }

  // 401 / 403 — session expired or RBAC mismatch.
  if (status === 401 || status === 403) {
    return (
      <ErrorState
        action={
          <ErrorAction
            label={t('error.unauthorized.cta', 'Sign in')}
            onPress={() => navigate('/login')}
          />
        }
        glyph="LK"
        message={t('error.unauthorized.message', 'Your session has expired. Please sign in again.')}
        title={t('error.unauthorized.title', 'Sign in required')}
      />
    );
  }

  // 5xx — backend failure.
  if (status !== undefined && status >= 500) {
    return (
      <ErrorState
        action={
          onRetry ? (
            <ErrorAction label={t('error.retry', 'Retry')} onPress={onRetry} />
          ) : undefined
        }
        glyph="SV"
        message={t('error.serverError.message', 'Something went wrong on our end. Please try again.')}
        title={t('error.serverError.title', 'Server error')}
      />
    );
  }

  // Network / offline / unknown.
  const isOffline = !online || status === 0;
  return (
    <ErrorState
      action={
        onRetry ? (
          <ErrorAction
            disabled={isOffline}
            label={
              isOffline
                ? t('error.network.retryWhenOnline', 'Retry when online')
                : t('error.retry', 'Retry')
            }
            onPress={onRetry}
          />
        ) : undefined
      }
      ariaLive={isOffline ? 'polite' : 'assertive'}
      glyph={isOffline ? 'WX' : '!'}
      message={
        isOffline
          ? t('error.network.offlineDetail', "We'll retry automatically when your connection returns.")
          : t('error.network.message', 'Check your internet connection and try again.')
      }
      role={isOffline ? 'status' : 'alert'}
      title={
        isOffline
          ? t('error.network.offlineTitle', "You're offline")
          : t('error.network.title', "Can't reach server")
      }
    />
  );
}

/* ─── Button (web @/components/ui Button) ──────────────────────────────── */

function Button({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  icon?: SemanticIconName;
  accessibilityLabel?: string;
  testID?: string;
}) {
  // The web Button forces disabled while loading (`disabled || loading`).
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{busy: loading, disabled: isDisabled}}
      disabled={isDisabled}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.ghostButton,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.pressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.textSecondary} size="small" style={styles.buttonIcon} />
      ) : icon ? (
        <SemanticIcon decorative name={icon} size="sm" style={styles.buttonIcon} />
      ) : null}
      <AppText style={styles.ghostButtonLabel} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── ConfirmDialog (web @/components/ui ConfirmDialog, used subset) ───── */

function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'warning',
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={open}>
      <View accessibilityRole="alert" accessible style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={onCancel}
          style={styles.backdrop}
        />
        <View style={styles.dialog}>
          <AppText style={styles.dialogTitle} variant="title" weight="bold">
            {title}
          </AppText>
          <View
            style={[
              styles.dialogMessageBox,
              variant === 'danger' ? styles.dialogMessageBoxDanger : styles.dialogMessageBoxWarning,
            ]}>
            <SemanticIcon
              decorative
              name="warning"
              size="sm"
              style={styles.dialogIcon}
            />
            <AppText style={styles.dialogMessage}>{message}</AppText>
          </View>
          <View style={styles.dialogActions}>
            <Pressable
              accessibilityLabel={cancelLabel}
              accessibilityRole="button"
              onPress={onCancel}
              style={({pressed}) => [
                styles.dialogButton,
                styles.dialogCancelButton,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.dialogCancelLabel} weight="semibold">
                {cancelLabel}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={confirmLabel}
              accessibilityRole="button"
              onPress={onConfirm}
              style={({pressed}) => [
                styles.dialogButton,
                variant === 'danger' ? styles.dialogConfirmDanger : styles.dialogConfirmWarning,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.dialogConfirmLabel} weight="semibold">
                {confirmLabel}
              </AppText>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/* ─── UserImpersonateButton (web ../components/UserImpersonateButton) ──── */

interface UserImpersonateButtonProps {
  subject: string;
  disabled?: boolean;
}

function UserImpersonateButton({subject, disabled}: UserImpersonateButtonProps) {
  const t = useNativeTranslation();
  const [open, setOpen] = useState(false);
  const startMut = useStartImpersonation();

  const handleClick = () => {
    if (disabled || startMut.isPending) {
      return;
    }
    setOpen(true);
  };

  const handleConfirm = () => {
    setOpen(false);
    startMut.mutate({subject});
  };

  return (
    <>
      <Button
        accessibilityLabel={t('impersonation.button.aria', 'Impersonate {{subject}}', {subject})}
        disabled={disabled || startMut.isPending}
        icon="userCheck"
        label={
          startMut.isPending
            ? t('impersonation.button.starting', 'Starting…')
            : t('impersonation.button.start', 'Impersonate')
        }
        loading={startMut.isPending}
        onPress={handleClick}
        testID={`user-impersonate-button-${subject}`}
      />
      <ConfirmDialog
        cancelLabel={t('impersonation.confirm.cancel', 'Cancel')}
        confirmLabel={t('impersonation.confirm.confirm', 'Start impersonation')}
        message={t(
          'impersonation.confirm.message',
          'You will see TeslaSync as {{subject}} for up to 15 minutes. The action is logged to the audit log. End the session from the banner when you are done.',
          {subject},
        )}
        onCancel={() => setOpen(false)}
        onConfirm={handleConfirm}
        open={open}
        title={t('impersonation.confirm.title', 'Start impersonation session?')}
        variant="warning"
      />
    </>
  );
}

/* ─── UsersPage (web default export) ──────────────────────────────────── */

export default function UsersPage() {
  const t = useNativeTranslation();
  const status = useImpersonationStatus();
  const open = isImpersonationOpenMode(status.data);
  const active = isImpersonationActive(status.data);
  const candidates = useImpersonationCandidates({enabled: !open});

  const subjects =
    candidates.data?.mode === 'session' ? candidates.data.candidates : [];

  return (
    <PageContainer
      subtitle={t(
        'impersonation.users.subtitle',
        'Active subjects you can impersonate for support. Sessions are limited to 15 minutes and recorded in the audit log.',
      )}
      title={t('impersonation.users.title', 'Subjects')}>
      <GlassPanel style={styles.panel}>
        {open ? (
          <View style={styles.openMode} testID="users-page-open-mode">
            <AppText style={styles.openModeText} tone="secondary">
              {t(
                'impersonation.users.openMode',
                'Impersonation requires forward-auth mode. This install is in open mode, so per-user identity is not available.',
              )}
            </AppText>
          </View>
        ) : candidates.isLoading ? (
          <View style={styles.loadingRow} testID="users-page-loading">
            <Spinner />
          </View>
        ) : candidates.isError ? (
          <ErrorDisplay error={candidates.error} onRetry={() => void candidates.refetch()} />
        ) : subjects.length === 0 ? (
          // no-action: there is no admin remediation for "no other subjects
          // active" — the user must wait for someone else to sign in
          <EmptyState
            message={t(
              'impersonation.users.emptyMessage',
              'No other subjects have an active session right now. Sign someone else in to enable impersonation.',
            )}
            title={t('impersonation.users.emptyTitle', 'No other subjects')}
          />
        ) : (
          <View testID="users-page-list">
            {subjects.map((c, index) => (
              <View
                key={c.subject}
                style={[styles.row, index > 0 && styles.rowDivider]}
                testID={`users-page-row-${c.subject}`}>
                <AppText style={styles.subject}>{c.subject}</AppText>
                <UserImpersonateButton disabled={active} subject={c.subject} />
              </View>
            ))}
          </View>
        )}
      </GlassPanel>
    </PageContainer>
  );
}

/* ─── styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  boundaryFallback: {
    padding: spacing.lg,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    marginRight: spacing.xs,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderAccent,
    borderRadius: 24,
    borderWidth: 1,
    gap: spacing.lg,
    margin: spacing.lg,
    maxWidth: 480,
    padding: spacing.lg,
    width: '92%',
  },
  dialogActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  dialogButton: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: spacing.lg,
  },
  dialogCancelButton: {
    backgroundColor: colors.surfaceGlass,
    borderColor: colors.border,
    borderWidth: 1,
  },
  dialogCancelLabel: {
    color: colors.textPrimary,
  },
  dialogConfirmDanger: {
    backgroundColor: colors.danger,
  },
  dialogConfirmLabel: {
    color: '#ffffff',
  },
  dialogConfirmWarning: {
    backgroundColor: colors.warning,
  },
  dialogIcon: {
    marginTop: 1,
  },
  dialogMessage: {
    color: colors.textPrimary,
    flex: 1,
    lineHeight: 20,
  },
  dialogMessageBox: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  dialogMessageBoxDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  dialogMessageBoxWarning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  dialogTitle: {
    color: colors.textPrimary,
  },
  emptyIcon: {
    marginBottom: spacing.md,
  },
  emptyMessage: {
    maxWidth: 420,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  errorActionButton: {
    alignSelf: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  errorActionDisabled: {
    opacity: 0.48,
  },
  errorActionLabel: {
    color: colors.danger,
    fontSize: 12,
    lineHeight: 16,
  },
  errorActionSlot: {
    flexShrink: 0,
  },
  errorCard: {
    backgroundColor: 'rgba(251, 113, 133, 0.06)',
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    margin: spacing.lg,
    padding: spacing.lg,
  },
  errorContent: {
    flex: 1,
  },
  errorIconBadge: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    marginTop: 2,
    width: 32,
  },
  errorIconGlyph: {
    color: colors.danger,
    fontSize: 13,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  errorMessage: {
    color: 'rgba(251, 113, 133, 0.72)',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  errorRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
  },
  errorTitle: {
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  ghostButtonLabel: {
    color: colors.textPrimary,
  },
  loadingRow: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  openMode: {
    padding: spacing.lg,
  },
  openModeText: {
    lineHeight: 20,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    lineHeight: 18,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    overflow: 'hidden',
  },
  pressed: {
    opacity: 0.82,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
  },
  subject: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontFamily: MONO_FONT,
    fontSize: 13,
    lineHeight: 18,
  },
});
