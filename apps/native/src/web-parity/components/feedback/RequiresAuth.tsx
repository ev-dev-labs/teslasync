// Native parity port of web/src/components/feedback/RequiresAuth.tsx.
//
// Auth-gated section wrapper. Wrap any section that has no useful behaviour
// without an upstream identity provider configured. In open mode (or while the
// /system/auth-mode contract is loading) the wrapper renders a
// provider-agnostic empty state explaining what to configure; in forward-auth
// mode (with the relevant capability flag true) the children render unchanged.
//
// The web rationale is preserved exactly:
//   - The loading-state policy is centralised so a half-resolved auth contract
//     never briefly flashes the children before hiding them (which would tear
//     down any in-progress queries the children kicked off).
//   - The placeholder copy NEVER names a specific IdP vendor; the
//     operator-supplied `provider_hint` is rendered verbatim instead so the
//     message reads naturally for whichever proxy the deployment actually uses.
//   - The per-capability test selector (`requires-auth-empty-{capability}`) is
//     standardised so feature screens can assert "this section is gated"
//     without mocking the hook.
//
// Native-safe adaptations (documented in the sidecar):
//   - react-i18next is not wired in native, so the web `useTranslation()` `t`
//     is replaced by a native translation fallback that returns the English
//     defaultValue and interpolates the `{{feature}}` / `{{provider}}`
//     placeholders — the same i18n keys and copy are preserved.
//   - The lucide `LockKeyhole` SVG (browser-only) is replaced by the native
//     SemanticIcon `locked` glyph; `aria-hidden` -> `decorative`.
//   - The shared web `Heading` / `Text` typography and the `div` + Tailwind
//     classes become React Native `View` / `AppText` with theme tokens; the
//     `@/lib/cn` className merge has no native analog, so the optional
//     `className` container override becomes an optional `style` prop.
//   - `role="status"` -> `accessibilityLiveRegion="polite"`; `data-testid` ->
//     `testID`. A plain `View` (not the native EmptyState) is used so the
//     stable per-capability testID is preserved, mirroring the web component.

import React, {useCallback, type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import type {AuthModeCapabilities} from '../../../api/types';
import {SemanticIcon} from '../../../components/icons/SemanticIcon';
import {AppText} from '../../../components/ui/AppText';
import {colors, spacing} from '../../../theme/tokens';
import {useAuthMode} from '../../api/hooks/useAuthMode';

/**
 * The keyof the capability matrix the section needs in order to mount. Must
 * match a backend-supplied flag exactly — passing an unknown key would fail the
 * type-check, which is the desired compile-time safety.
 */
export type RequiresAuthCapability = keyof AuthModeCapabilities;

export interface RequiresAuthProps {
  /** Capability flag the wrapped section needs. */
  capability: RequiresAuthCapability;
  /** Section content rendered when the capability is available. */
  children: ReactNode;
  /**
   * Short, user-facing feature name interpolated into the placeholder copy.
   * Pass an already-translated string (the wrapper does NOT try to look up
   * `feature` in the i18n bundle — every consumer provides its own translation
   * or i18n-key resolution).
   */
  feature: string;
  /**
   * Optional style applied to the placeholder container. Native equivalent of
   * the web `className` override.
   */
  style?: StyleProp<ViewStyle>;
}

/**
 * Stable test-id builder. Exported so feature-screen tests can assert the
 * placeholder is rendered without re-deriving the string.
 */
export function requiresAuthEmptyTestId(
  capability: RequiresAuthCapability,
): string {
  return `requires-auth-empty-${capability}`;
}

type TranslationVars = Record<string, string | undefined>;
type TranslateOptions = TranslationVars & {defaultValue: string};
type NativeTFunction = (key: string, options: TranslateOptions) => string;

// Native i18n fallback: react-i18next is not wired in native, so this returns
// the English defaultValue and interpolates any `{{name}}` placeholders from
// the remaining options — preserving the web i18n keys and copy verbatim.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, options: TranslateOptions) => {
    const {defaultValue, ...vars} = options;
    return defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = vars[name];
      return value === undefined ? '' : String(value);
    });
  }, []);
}

export function RequiresAuth({
  capability,
  children,
  feature,
  style,
}: RequiresAuthProps) {
  const t = useNativeTranslationFallback();
  const {data, isLoading} = useAuthMode();

  // While the contract resolves, render the placeholder rather than the
  // children — flashing a fully-mounted section and then hiding it would tear
  // down any in-progress queries the children kicked off, double-fetch when it
  // remounts, and look broken.
  if (isLoading || !data) {
    return (
      <RequiresAuthPlaceholder
        capability={capability}
        feature={feature}
        providerHint={undefined}
        style={style}
        t={t}
      />
    );
  }

  // forward-auth mode + capability enabled → mount the section.
  if (data.mode === 'forward_auth' && data.capabilities[capability]) {
    return <>{children}</>;
  }

  // Open mode, OR forward-auth mode where the operator has somehow disabled the
  // capability via a backend flag (currently unreachable — the matrix is
  // uniformly true in forward-auth — but we render the same placeholder so
  // future per-capability gating doesn't need a second branch here).
  return (
    <RequiresAuthPlaceholder
      capability={capability}
      feature={feature}
      providerHint={data.provider_hint}
      style={style}
      t={t}
    />
  );
}

RequiresAuth.displayName = 'RequiresAuth';

interface PlaceholderProps {
  capability: RequiresAuthCapability;
  feature: string;
  providerHint: string | undefined;
  style: StyleProp<ViewStyle> | undefined;
  t: NativeTFunction;
}

function RequiresAuthPlaceholder({
  capability,
  feature,
  providerHint,
  style,
  t,
}: PlaceholderProps) {
  // Body copy: when the operator set TESLASYNC_AUTH_PROVIDER_HINT we surface it
  // verbatim ("… via Authentik …"); when they didn't we fall back to the
  // generic vendor-neutral string. Both forms stay vendor-neutral — TeslaSync
  // never claims to integrate with a specific IdP's admin API.
  const bodyKey = providerHint ? 'requiresAuth.bodyWithHint' : 'requiresAuth.body';
  const body = t(bodyKey, {
    defaultValue: providerHint
      ? '{{feature}} is only available when TeslaSync is configured behind an authentication provider ({{provider}}). Set FORWARD_AUTH_HEADER on the API service to enable it.'
      : '{{feature}} is only available when TeslaSync is configured behind an authentication provider (Authentik, Authelia, oauth2-proxy, Keycloak, or similar). Set FORWARD_AUTH_HEADER on the API service to enable it.',
    feature,
    provider: providerHint,
  });
  const title = t('requiresAuth.title', {
    defaultValue: '{{feature}} requires authentication mode',
    feature,
  });

  // A plain View (not the native EmptyState) keeps the stable per-capability
  // testID the gating contract relies on, mirroring the web component.
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[styles.container, style]}
      testID={requiresAuthEmptyTestId(capability)}>
      <SemanticIcon decorative name="locked" size="md" />
      <AppText style={styles.title} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.body} tone="secondary">
        {body}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 13,
    lineHeight: 18,
    maxWidth: 448,
    textAlign: 'center',
  },
  container: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: spacing.md,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  title: {
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
  },
});

export default RequiresAuth;
