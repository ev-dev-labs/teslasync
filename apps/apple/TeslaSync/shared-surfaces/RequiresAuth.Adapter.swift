//
//  RequiresAuth.Adapter.swift
//  TeslaSync — P4 shared surface · 0137 · RequiresAuth (Apple)
//
//  The testable, dependency-free projection core for the auth-gated section wrapper — the faithful
//  port of components/feedback/RequiresAuth.tsx and the `useAuthMode` contract it binds to.
//  Everything here is pure Foundation so the gate decision (the verbatim port of the web
//  loading / forward-auth / open ladder), the per-capability test-id builder (web
//  `requiresAuthEmptyTestId`), the lock notice copy (web `requiresAuth.title` / `.body` /
//  `.bodyWithHint`), and the render-phase resolution are all unit-tested without a bundle or a view.
//
//  Web parity notes:
//    • The web wrapper renders the lock notice while `isLoading || !data` (NOT the children — a
//      half-mounted section would tear down its in-flight queries), renders the children when
//      `mode === 'forward_auth' && capabilities[capability]`, and renders the lock notice otherwise
//      (open mode, or a forward-auth capability the operator disabled). `RequiresAuthProjection`
//      reproduces that exact ladder.
//    • The lock notice body is vendor-neutral: when the operator set the `provider_hint` it is
//      surfaced verbatim ("…provider (authentik)…"); otherwise the generic provider list
//      ("Authentik, Authelia, oauth2-proxy, Keycloak, or similar") is used. `RequiresAuthCopy`
//      holds both templates with the exact web English defaults.
//    • The stable `requires-auth-empty-{capability}` selector → `RequiresAuthProjection.testID`,
//      set as the lock notice's accessibility identifier so UI tests can assert a section is gated.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event, kept in the dependency-free
/// core so the projection's unit tests can reach it without importing SwiftUI.
public enum RequiresAuthSurface {
    public static let slug = "RequiresAuth"
}

// MARK: - Auth deployment mode (web `AuthMode`)

/// The resolved deployment auth mode (web `AuthMode = 'open' | 'forward_auth'`), plus the
/// pre-first-response `unknown` the native surface uses while the contract is loading. The string
/// is the source of truth (web note): never derive the mode from `subjectHeader` being set.
public enum AuthDeploymentMode: String, Sendable, Equatable, CaseIterable {
    /// No upstream identity provider configured (web `'open'`).
    case open
    /// A ForwardAuth-shaped reverse proxy is in front of TeslaSync (web `'forward_auth'`).
    case forwardAuth = "forward_auth"
    /// The contract has not resolved yet (native loading sentinel; web models this as `!data`).
    case unknown
}

// MARK: - Capability matrix (web `AuthModeCapabilities`)

/// The capability flag a wrapped section needs in order to mount (web `RequiresAuthCapability =
/// keyof AuthModeCapabilities`). The `key` mirrors the backend-supplied snake_case flag name and is
/// the suffix of the stable `requires-auth-empty-{capability}` selector (web `requiresAuthEmptyTestId`).
public enum RequiresAuthCapability: String, Sendable, Equatable, CaseIterable {
    case stepUpReauth = "step_up_reauth"
    case totpEnrollment = "totp_enrollment"
    case sessionList = "session_list"
    case impersonation
    case rbac

    /// The backend-supplied flag name (web `keyof AuthModeCapabilities`), used in the selector.
    public var key: String {
        rawValue
    }
}

/// Per-feature gate the contract reports (web `AuthModeCapabilities`). Every field is `false` in
/// open mode and `true` in forward-auth mode; the subscript reads a flag by `RequiresAuthCapability`
/// so the gate decision is a single lookup (web `data.capabilities[capability]`).
public struct AuthModeCapabilities: Sendable, Equatable {
    public var stepUpReauth: Bool
    public var totpEnrollment: Bool
    public var sessionList: Bool
    public var impersonation: Bool
    public var rbac: Bool

    public init(
        stepUpReauth: Bool = false,
        totpEnrollment: Bool = false,
        sessionList: Bool = false,
        impersonation: Bool = false,
        rbac: Bool = false
    ) {
        self.stepUpReauth = stepUpReauth
        self.totpEnrollment = totpEnrollment
        self.sessionList = sessionList
        self.impersonation = impersonation
        self.rbac = rbac
    }

    /// Every capability disabled (web open-mode matrix — uniformly `false`).
    public static let allDisabled = AuthModeCapabilities()

    /// Every capability enabled (web forward-auth matrix — uniformly `true`).
    public static let allEnabled = AuthModeCapabilities(
        stepUpReauth: true,
        totpEnrollment: true,
        sessionList: true,
        impersonation: true,
        rbac: true
    )

    /// Reads a single flag (web `capabilities[capability]`).
    public subscript(_ capability: RequiresAuthCapability) -> Bool {
        switch capability {
        case .stepUpReauth: stepUpReauth
        case .totpEnrollment: totpEnrollment
        case .sessionList: sessionList
        case .impersonation: impersonation
        case .rbac: rbac
        }
    }
}

// MARK: - Contract snapshot (web `AuthModeResponse`)

/// The `/system/auth-mode` response projection (web `AuthModeResponse`). `subjectHeader` / `subject`
/// / `providerHint` are omitted in open mode; `providerHint` is the operator-supplied free text the
/// lock notice surfaces verbatim (web note — never used as a routing key).
public struct AuthModeSnapshot: Sendable, Equatable {
    public let mode: AuthDeploymentMode
    public let subjectHeader: String?
    public let subject: String?
    public let providerHint: String?
    public let capabilities: AuthModeCapabilities

    public init(
        mode: AuthDeploymentMode,
        subjectHeader: String? = nil,
        subject: String? = nil,
        providerHint: String? = nil,
        capabilities: AuthModeCapabilities = .allDisabled
    ) {
        self.mode = mode
        self.subjectHeader = subjectHeader
        self.subject = subject
        self.providerHint = providerHint
        self.capabilities = capabilities
    }

    /// An open-mode snapshot (no provider, uniformly-disabled matrix) — the common web fixture.
    public static let open = AuthModeSnapshot(mode: .open, capabilities: .allDisabled)
}

// MARK: - Load status / freshness (P4 leaf axes)

/// The bound source's load status for the `/system/auth-mode` poll (web `isLoading` / resolved /
/// `ApiError`). The endpoint is designed never to 4xx/5xx, so a failure is a transport problem the
/// native surface renders as an error envelope with retry (P4 contract; the web swallows it into the
/// `!data` lock notice branch).
public enum RequiresAuthLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case failed(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the cached-data banner so a gate
/// decision made from a cached contract read is clearly labelled while reconnecting / offline.
public enum RequiresAuthConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Gate + render phase

/// The web decision: render the wrapped section (`unlocked`) or the lock notice (`locked`). A pure
/// function of the resolved snapshot + the needed capability.
public enum RequiresAuthGate: Sendable, Equatable {
    case unlocked
    case locked
}

/// What the surface renders at the top level. `content` mounts the wrapped section (web
/// `<>{children}</>`); the other cases render the lock notice chrome (every one real, never a blank
/// box — engineering guideline #6). `loading` is the pre-resolution chrome (web shows the
/// lock notice while loading); `locked` is the resolved lock notice (the friendly empty state);
/// `error` is the transport-failure envelope with retry.
public enum RequiresAuthRender: Sendable, Equatable {
    case content
    case loading
    case locked
    case error(String)
}

// MARK: - Copy (port of the web empty-state strings)

/// The lock notice copy templates — the exact web English defaults for `requiresAuth.title`,
/// `requiresAuth.body`, and `requiresAuth.bodyWithHint`. Copy resolves through an injected localizer
/// (P1/S10) and the `{{feature}}` / `{{provider}}` tokens are substituted here, so the views hold no
/// literals and the interpolation is unit-tested without a bundle.
public enum RequiresAuthCopy {
    /// The i18n key for the title (web `t('requiresAuth.title', …)`).
    public static let titleKey = "requiresAuth.title"
    /// The i18n key for the generic, provider-list body (web `t('requiresAuth.body', …)`).
    public static let bodyKey = "requiresAuth.body"
    /// The i18n key for the operator-hint body (web `t('requiresAuth.bodyWithHint', …)`).
    public static let bodyWithHintKey = "requiresAuth.bodyWithHint"

    /// The exact web English default for the title (web `defaultValue`).
    public static let titleDefault = "{{feature}} requires authentication mode"

    /// The exact web English default for the generic body (web `defaultValue`).
    public static let bodyDefault = """
    {{feature}} is only available when TeslaSync is configured behind an authentication provider \
    (Authentik, Authelia, oauth2-proxy, Keycloak, or similar). Set FORWARD_AUTH_HEADER on the API \
    service to enable it.
    """

    /// The exact web English default for the operator-hint body (web `defaultValue`).
    public static let bodyWithHintDefault = """
    {{feature}} is only available when TeslaSync is configured behind an authentication provider \
    ({{provider}}). Set FORWARD_AUTH_HEADER on the API service to enable it.
    """

    /// The full set of i18n keys extracted from the web source — asserted present by the parity test
    /// so a renamed/removed key fails CI rather than silently dropping copy.
    public static let webSourceKeys: [String] = [titleKey, bodyKey, bodyWithHintKey]

    /// Resolves + interpolates the title (web `t('requiresAuth.title', { feature })`).
    public static func title(feature: String, localize: (String, String) -> String) -> String {
        localize(titleKey, titleDefault)
            .replacingOccurrences(of: "{{feature}}", with: feature)
    }

    /// Resolves + interpolates the body. When `providerHint` is present the hint template is used and
    /// the hint is surfaced verbatim; otherwise the generic provider-list template is used (web
    /// `providerHint ? 'requiresAuth.bodyWithHint' : 'requiresAuth.body'`).
    public static func body(
        feature: String,
        providerHint: String?,
        localize: (String, String) -> String
    ) -> String {
        if let providerHint, !providerHint.isEmpty {
            return localize(bodyWithHintKey, bodyWithHintDefault)
                .replacingOccurrences(of: "{{feature}}", with: feature)
                .replacingOccurrences(of: "{{provider}}", with: providerHint)
        }
        return localize(bodyKey, bodyDefault)
            .replacingOccurrences(of: "{{feature}}", with: feature)
    }
}

// MARK: - Projection core (pure)

/// The dependency-free resolution shared by the model and tests: the web gate ladder, the resolved
/// render phase (gate × load status × cache), and the stable per-capability selector.
public enum RequiresAuthProjection {
    /// Verbatim port of the web gate ladder:
    ///   • no snapshot (web `isLoading || !data`) → `locked` (lock notice, never the children).
    ///   • `forward_auth` + the capability enabled (web `data.mode === 'forward_auth' &&
    ///     data.capabilities[capability]`) → `unlocked` (mount the section).
    ///   • open mode, or a forward-auth capability the operator disabled → `locked`.
    public static func resolveGate(
        snapshot: AuthModeSnapshot?,
        capability: RequiresAuthCapability
    ) -> RequiresAuthGate {
        guard let snapshot else { return .locked }
        if snapshot.mode == .forwardAuth, snapshot.capabilities[capability] {
            return .unlocked
        }
        return .locked
    }

    /// The resolved top-level render. When the gate is `unlocked` the section mounts (`content`).
    /// When `locked`, the lock notice chrome is chosen by the load status: a first-load with no
    /// resolved snapshot shows the `loading` chrome (web renders the lock notice while loading) or
    /// the `error` envelope on transport failure; once any snapshot is resolved (fresh or cached) the
    /// `locked` lock notice is shown so a background refresh failure never blanks the section.
    public static func resolveRender(
        status: RequiresAuthLoadStatus,
        snapshot: AuthModeSnapshot?,
        capability: RequiresAuthCapability
    ) -> RequiresAuthRender {
        if resolveGate(snapshot: snapshot, capability: capability) == .unlocked {
            return .content
        }
        if snapshot != nil {
            return .locked
        }
        switch status {
        case .loading:
            return .loading
        case .loaded:
            return .locked
        case let .failed(message):
            return .error(message)
        }
    }

    /// The stable per-capability selector (web `requiresAuthEmptyTestId(capability)` →
    /// `requires-auth-empty-{capability}`), used as the lock notice's accessibility identifier.
    public static func testID(capability: RequiresAuthCapability) -> String {
        "requires-auth-empty-\(capability.key)"
    }
}
