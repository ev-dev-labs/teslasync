/**
 * Permission explanations and request-access guidance (HELP-10).
 *
 * A bare "403 Forbidden" tells the user three untrue things: that they did
 * something wrong, that the data may not exist, and that there is nothing to
 * do next. All three are usually false — the data exists, the account simply
 * is not entitled to it, and someone specific can grant that entitlement.
 *
 * This module turns an access failure into: what happened · who can change it
 * · what to say when you ask · where to go. It distinguishes five blocks that
 * look identical on screen but need different responses:
 *
 *   unauthenticated  — no valid session; sign in again
 *   forbidden        — valid session, insufficient entitlement; ask an admin
 *   open_mode        — the install runs with no identity provider, so
 *                      per-user features cannot exist at all
 *   feature_disabled — the capability is switched off for this deployment
 *   read_only        — writes are suspended (maintenance / as-of browsing)
 *
 * The request-access steps are concrete and copyable on purpose: "ask an
 * administrator" is not guidance, it is a shrug.
 */

import { isApiError } from './resilience'
import { classifyError } from './errorClassification'
import { OPERATIONAL_MODE_READ_ONLY_CODE } from './operationalMode'

export type AccessBlockKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'open_mode'
  | 'feature_disabled'
  | 'read_only'

export interface AccessBlockEvidence {
  error?: unknown
  online?: boolean
  /** True when the deployment reports no forward-auth identity provider. */
  authModeOpen?: boolean
  /** True when the surface is gated behind a feature flag that is off. */
  featureDisabled?: boolean
}

/**
 * Classify an access block.
 *
 * Priority: explicit server codes beat inferred deployment state, because a
 * server that says `AUTH_MODE_OPEN` is describing itself, whereas
 * `authModeOpen` is the SPA's cached belief about the install.
 */
export function classifyAccessBlock(
  evidence: AccessBlockEvidence,
): AccessBlockKind | null {
  if (!evidence) return null

  const code = isApiError(evidence.error) ? evidence.error.code?.toUpperCase() : undefined
  if (code === 'AUTH_MODE_OPEN') return 'open_mode'
  if (code === OPERATIONAL_MODE_READ_ONLY_CODE.toUpperCase()) return 'read_only'

  if (evidence.error != null) {
    const kind = classifyError(evidence.error, evidence.online ?? true)
    if (kind === 'unauthorized') return 'unauthenticated'
    if (kind === 'forbidden') return 'forbidden'
    if (kind === 'unsupported') {
      return evidence.authModeOpen ? 'open_mode' : 'feature_disabled'
    }
  }

  if (evidence.featureDisabled === true) return 'feature_disabled'
  if (evidence.authModeOpen === true) return 'open_mode'
  return null
}

export interface AccessGuidanceStep {
  key: string
  fallback: string
}

export interface AccessGuidance {
  kind: AccessBlockKind
  titleKey: string
  titleFallback: string
  /** What the server actually decided. No blame, no guessing. */
  explanationKey: string
  explanationFallback: string
  /** Who is able to change the outcome. */
  grantedByKey: string
  grantedByFallback: string
  /** Concrete steps to request access. Ordered. */
  steps: readonly AccessGuidanceStep[]
  /** True when retrying could plausibly succeed. */
  retryable: boolean
  actionTo?: string
  actionLabelKey?: string
  actionLabelFallback?: string
}

const GUIDANCE: Record<AccessBlockKind, AccessGuidance> = {
  unauthenticated: {
    kind: 'unauthenticated',
    titleKey: 'accessGuidance.unauthenticated.title',
    titleFallback: 'Your session is no longer valid',
    explanationKey: 'accessGuidance.unauthenticated.explanation',
    explanationFallback:
      'The server did not recognise a signed-in identity for this request. Sessions expire, and signing in again restores exactly the access you had before.',
    grantedByKey: 'accessGuidance.unauthenticated.grantedBy',
    grantedByFallback: 'You — no administrator involvement is needed.',
    steps: [
      {
        key: 'accessGuidance.unauthenticated.step.signIn',
        fallback: 'Sign in again, then return to this page.',
      },
      {
        key: 'accessGuidance.unauthenticated.step.persist',
        fallback:
          'If you are signed out repeatedly, report it — a short session lifetime or a clock skew is usually the cause.',
      },
    ],
    retryable: true,
    actionTo: '/help',
    actionLabelKey: 'accessGuidance.unauthenticated.action',
    actionLabelFallback: 'Report repeated sign-outs',
  },
  forbidden: {
    kind: 'forbidden',
    titleKey: 'accessGuidance.forbidden.title',
    titleFallback: 'Your account is not entitled to this',
    explanationKey: 'accessGuidance.forbidden.explanation',
    explanationFallback:
      'You are signed in, and the server understood the request — it declined it because your account lacks the required role for this resource. The data is not missing.',
    grantedByKey: 'accessGuidance.forbidden.grantedBy',
    grantedByFallback:
      'An administrator of this TeslaSync install, or the owner of the vehicle whose data you need.',
    steps: [
      {
        key: 'accessGuidance.forbidden.step.identify',
        fallback:
          'Note the page you were on and the action you attempted — an administrator needs both to grant the right role.',
      },
      {
        key: 'accessGuidance.forbidden.step.request',
        fallback:
          'Ask an administrator to grant your account access, or ask the vehicle owner to share the vehicle with you.',
      },
      {
        key: 'accessGuidance.forbidden.step.verify',
        fallback: 'Reload after access is granted — changes take effect on the next request.',
      },
    ],
    retryable: false,
    actionTo: '/help',
    actionLabelKey: 'accessGuidance.forbidden.action',
    actionLabelFallback: 'Request access',
  },
  open_mode: {
    kind: 'open_mode',
    titleKey: 'accessGuidance.openMode.title',
    titleFallback: 'This install has no user accounts',
    explanationKey: 'accessGuidance.openMode.explanation',
    explanationFallback:
      'The deployment runs without an identity provider, so there is no per-user identity to attach this feature to. This is a deployment choice, not a fault.',
    grantedByKey: 'accessGuidance.openMode.grantedBy',
    grantedByFallback: 'Whoever operates this deployment.',
    steps: [
      {
        key: 'accessGuidance.openMode.step.explain',
        fallback:
          'Per-user features (sessions, two-factor, personal activity) require a forward-auth identity provider in front of the API.',
      },
      {
        key: 'accessGuidance.openMode.step.request',
        fallback:
          'Ask the operator whether enabling authenticated mode is appropriate for this install.',
      },
    ],
    retryable: false,
    actionTo: '/settings',
    actionLabelKey: 'accessGuidance.openMode.action',
    actionLabelFallback: 'Review deployment settings',
  },
  feature_disabled: {
    kind: 'feature_disabled',
    titleKey: 'accessGuidance.featureDisabled.title',
    titleFallback: 'This feature is switched off for this deployment',
    explanationKey: 'accessGuidance.featureDisabled.explanation',
    explanationFallback:
      'The capability exists in this build but is disabled by configuration, so the server will keep declining it until that changes.',
    grantedByKey: 'accessGuidance.featureDisabled.grantedBy',
    grantedByFallback: 'An administrator, via feature configuration.',
    steps: [
      {
        key: 'accessGuidance.featureDisabled.step.identify',
        fallback: 'Note which feature you were trying to use.',
      },
      {
        key: 'accessGuidance.featureDisabled.step.request',
        fallback:
          'Ask an administrator to enable it, including why you need it — some features carry cost or privacy trade-offs.',
      },
    ],
    retryable: false,
    actionTo: '/settings',
    actionLabelKey: 'accessGuidance.featureDisabled.action',
    actionLabelFallback: 'Open settings',
  },
  read_only: {
    kind: 'read_only',
    titleKey: 'accessGuidance.readOnly.title',
    titleFallback: 'Changes are temporarily disabled',
    explanationKey: 'accessGuidance.readOnly.explanation',
    explanationFallback:
      'The app is in a read-only state — historical browsing or maintenance. Reading works normally; writes are refused so nothing is applied to the wrong point in time.',
    grantedByKey: 'accessGuidance.readOnly.grantedBy',
    grantedByFallback: 'Resolves on its own, or via the operator running maintenance.',
    steps: [
      {
        key: 'accessGuidance.readOnly.step.exit',
        fallback: 'Leave historical (as-of) browsing to return to live mode.',
      },
      {
        key: 'accessGuidance.readOnly.step.wait',
        fallback: 'If maintenance is in progress, wait for it to finish and retry.',
      },
    ],
    retryable: true,
    actionTo: '/system-status',
    actionLabelKey: 'accessGuidance.readOnly.action',
    actionLabelFallback: 'Check system status',
  },
}

/** Full guidance for a block kind. Total over the union — never null. */
export function accessGuidanceFor(kind: AccessBlockKind): AccessGuidance {
  return GUIDANCE[kind]
}

/** Convenience: classify then explain. Null when nothing indicates a block. */
export function explainAccessBlock(
  evidence: AccessBlockEvidence,
): AccessGuidance | null {
  const kind = classifyAccessBlock(evidence)
  return kind ? GUIDANCE[kind] : null
}

/** Every kind, in a stable order for docs and tests. */
export const ACCESS_BLOCK_KINDS: readonly AccessBlockKind[] = [
  'unauthenticated',
  'forbidden',
  'open_mode',
  'feature_disabled',
  'read_only',
] as const
