/**
 * @module components/feedback/RequiresAuth
 *
 * Auth-gated section wrapper.
 *
 * Wrap any section that has no useful behaviour without an upstream
 * identity provider configured. In open mode (or while the
 * /system/auth-mode contract is loading) the wrapper renders a
 * provider-agnostic empty state explaining what to configure; in
 * forward-auth mode (with the relevant capability flag true) the
 * children render unchanged.
 *
 * Why a separate component instead of inlining `if (mode === 'open')
 * <EmptyState …>`:
 *
 *   - Centralises the loading-state policy so a half-resolved auth
 *     contract never briefly flashes the children before hiding them
 *     (would happen if every consumer wrote its own ladder).
 *   - Centralises copy: the SPA must NEVER name a specific IdP
 *     vendor in the placeholder; the operator-supplied
 *     `provider_hint` is rendered verbatim instead so the message
 *     reads naturally for whichever proxy the deployment actually
 *     uses.
 *   - Standardises the test selector
 *     (`requires-auth-empty-{capability}`) so feature pages can
 *     assert "this section is gated" without mocking the hook.
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { LockKeyhole } from 'lucide-react';
import { useAuthMode } from '@/api/hooks/useAuthMode';
import { Heading, Text } from '@/components/ui/Typography';
import { cn } from '@/lib/cn';
import { PermissionGuidanceNotice } from './PermissionGuidanceNotice';
import type { AuthModeCapabilities } from '@/api/types';

/**
 * The keyof the capability matrix the section needs in order to
 * mount. Must match a backend-supplied flag exactly — passing an
 * unknown key would fail the type-check, which is the desired
 * compile-time safety.
 */
export type RequiresAuthCapability = keyof AuthModeCapabilities;

export interface RequiresAuthProps {
  /** Capability flag the wrapped section needs. */
  capability: RequiresAuthCapability;
  /**
   * Short, user-facing feature name interpolated into the placeholder
   * copy. Pass an already-translated string (the wrapper does NOT
   * try to look up `feature` in the i18n bundle — every consumer
   * provides its own translation or i18n-key resolution).
   */
  feature: string;
  /** Section content rendered when the capability is available. */
  children: ReactNode;
  /** Optional className applied to the placeholder container. */
  className?: string;
}

/**
 * Stable test-id builder. Exported so feature-page tests can assert
 * the placeholder is rendered without re-deriving the string.
 */
export function requiresAuthEmptyTestId(capability: RequiresAuthCapability): string {
  return `requires-auth-empty-${capability}`;
}

export function RequiresAuth({ capability, feature, children, className }: RequiresAuthProps) {
  const { t } = useTranslation();
  const { data, isLoading } = useAuthMode();

  // While the contract resolves, render the placeholder rather than
  // the children — flashing a fully-mounted section and then hiding
  // it would tear down any in-progress queries the children kicked
  // off, double-fetch when it remounts, and look broken.
  if (isLoading || !data) {
    return (
      <RequiresAuthPlaceholder
        capability={capability}
        feature={feature}
        providerHint={undefined}
        className={className}
        t={t}
      />
    );
  }

  // forward-auth mode + capability enabled → mount the section.
  if (data.mode === 'forward_auth' && data.capabilities[capability]) {
    return <>{children}</>;
  }

  // Open mode, OR forward-auth mode where the operator has somehow
  // disabled the capability via a backend flag (currently
  // unreachable — the matrix is uniformly true in forward-auth —
  // but we render the same placeholder so future per-capability
  // gating doesn't need a second branch here).
  return (
    <RequiresAuthPlaceholder
      capability={capability}
      feature={feature}
      providerHint={data.provider_hint}
      className={className}
      t={t}
    />
  );
}

interface PlaceholderProps {
  capability: RequiresAuthCapability;
  feature: string;
  providerHint: string | undefined;
  className: string | undefined;
  t: ReturnType<typeof useTranslation>['t'];
}

function RequiresAuthPlaceholder({
  capability,
  feature,
  providerHint,
  className,
  t,
}: PlaceholderProps) {
  // Body copy: when the operator set TESLASYNC_AUTH_PROVIDER_HINT we
  // surface it verbatim ("Sign in via Authentik to enable …"); when
  // they didn't we fall back to the generic "your authentication
  // provider" string. Both forms stay vendor-neutral — TeslaSync
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

  return (
    // We wrap the empty state in a plain <div> rather than reusing
    // <EmptyState> because the audit-empty-state-cta lint requires
    // every <EmptyState> to either ship a CTA or a `// no-action:
    // <reason>` annotation — neither fits naturally here, and the
    // placeholder needs a stable per-capability data-testid that
    // <EmptyState> doesn't expose. Mirrors the pattern used by the
    <div
      role="status"
      data-testid={requiresAuthEmptyTestId(capability)}
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-lg',
        'border border-[var(--border-default)] bg-[var(--bg-elevated)]/40',
        'px-6 py-12 text-center',
        className,
      )}
    >
      <div className="text-[var(--text-muted)]">
        <LockKeyhole aria-hidden className="h-8 w-8" />
      </div>
      <Heading level="panel">{title}</Heading>
      <Text variant="bodySm" as="p" className="max-w-md">
        {body}
      </Text>
      {/* HELP-10. The copy above explains WHY the section is unavailable; this
          adds WHO can change it and WHAT to say when asking. "Set
          FORWARD_AUTH_HEADER" is actionable for an operator reading their own
          install and useless to everyone else, who need to know which person
          to go to. */}
      <PermissionGuidanceNotice
        kind="open_mode"
        className="mt-1 w-full max-w-md text-left"
      />
    </div>
  );
}
