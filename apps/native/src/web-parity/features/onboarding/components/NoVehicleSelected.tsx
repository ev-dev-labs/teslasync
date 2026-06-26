// Native parity port of web/src/features/onboarding/components/NoVehicleSelected.tsx.
//
// Defensive empty state for pages that require a selected vehicle. The web
// behaviour is preserved one-for-one:
//   - Same props contract: NoVehicleSelectedProps { pageTitle; title?;
//     description? } — pageTitle flows straight through to PageContainer, and
//     title/description are optional overrides for the empty-state copy.
//   - Same i18n keys + English fallback strings:
//       common.noVehicleSelected.title  -> 'No vehicle selected'
//       common.noVehicleSelected.desc   -> 'Add a vehicle to your fleet to see
//                                          data on this page.'
//       common.noVehicleSelected.action -> 'Set up TeslaSync'
//     and the same `title ?? t(...)` / `description ?? t(...)` override logic.
//   - Same action intent: the CTA routes to the '/onboarding' flow.
//   - Same visual intent: a padded GlassPanel wrapping a centered empty state
//     with a vehicle icon, title, message, and a CTA button.
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inline useNativeTranslation(): a stable
//     (key, fallback, options?) shim returning the English fallback (with
//     i18next `{{name}}` interpolation when options are supplied).
//   - react-router-dom useNavigate -> inline useNativeNavigation(): React
//     Native has no in-app router, so the preserved route string is handed to
//     the platform URL handler (Linking.openURL) on a best-effort basis;
//     unresolvable routes are swallowed so a failed navigation never crashes.
//   - lucide-react Car -> the shared native SemanticIcon glyph 'vehicle'
//     (lucide SVG has no native renderer); 'h-12 w-12' maps to size="lg".
//   - @/components/layout PageContainer -> inline native PageContainer (title
//     header + scrollable children), mirroring the web title + children render.
//   - @/components/ui GlassPanel -> the shared native GlassPanel; the web
//     'p-8' padding maps to a panel padding style.
//   - @/components/feedback EmptyState -> inline native EmptyState reproducing
//     the web icon + title + message + imperative `action { label; onClick }`
//     shape (the shared native EmptyState carries no icon/action).

import React, { useCallback, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { SemanticIcon, type SemanticIconName } from '../../../../components/icons/SemanticIcon';
import { AppButton } from '../../../../components/ui/AppButton';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';

/* ── react-i18next useTranslation replacement ──────────── */

type NativeTOptions = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, options?: NativeTOptions) => string;

function useNativeTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string, options?: NativeTOptions) => {
    if (!options) {
      return fallback;
    }
    return Object.keys(options).reduce(
      (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
      fallback,
    );
  }, []);
}

/* ── react-router-dom useNavigate replacement ──────────── */
// No in-app router on native; the preserved web route string is handed to the
// platform URL handler on a best-effort basis and failures are swallowed.

function useNativeNavigation(): (to: string) => void {
  return useCallback((to: string) => {
    Promise.resolve()
      .then(() => Linking.openURL(to))
      .catch(() => undefined);
  }, []);
}

/* ── EmptyState (web @/components/feedback EmptyState) ──── */

function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: SemanticIconName;
  title?: string;
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyRoot}>
      {icon ? <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIconWrap} /> : null}
      {title ? (
        <AppText style={styles.emptyTitle} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
      {action ? (
        <View style={styles.emptyAction}>
          <AppButton label={action.label} onPress={action.onClick} variant="ghost" />
        </View>
      ) : null}
    </View>
  );
}

/* ── PageContainer (web @/components/layout PageContainer) ── */

function PageContainer({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.page}>
      <View style={styles.pageHeader}>
        <AppText variant="title" weight="bold">
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}

interface NoVehicleSelectedProps {
  /** Localized page title (passed straight through to PageContainer). */
  pageTitle: string;
  /** Optional override for the empty-state title. */
  title?: string;
  /** Optional override for the empty-state description. */
  description?: string;
}

export function NoVehicleSelected({ pageTitle, title, description }: NoVehicleSelectedProps) {
  const t = useNativeTranslation();
  const navigate = useNativeNavigation();

  return (
    <PageContainer title={pageTitle}>
      <GlassPanel style={styles.panel}>
        <EmptyState
          icon="vehicle"
          title={title ?? t('common.noVehicleSelected.title', 'No vehicle selected')}
          message={
            description ??
            t(
              'common.noVehicleSelected.desc',
              'Add a vehicle to your fleet to see data on this page.',
            )
          }
          action={{
            label: t('common.noVehicleSelected.action', 'Set up TeslaSync'),
            onClick: () => navigate('/onboarding'),
          }}
        />
      </GlassPanel>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  emptyAction: {
    marginTop: spacing.md,
  },
  emptyIconWrap: {
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  emptyRoot: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.md,
  },
  panel: {
    padding: spacing.xl,
  },
});
