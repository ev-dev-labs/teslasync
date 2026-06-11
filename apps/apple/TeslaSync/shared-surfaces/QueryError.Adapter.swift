//
//  QueryError.Adapter.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  The testable, dependency-light core for the QueryError shared surface — the SwiftUI parity of
//  `components/feedback/QueryError.tsx`. Everything here is pure (Foundation only): the reduced
//  failure value the surface branches on (the web `error: unknown` distilled to the `ApiError.status`
//  + the `isTransientWaiting` classification it actually reads), the failure-mode axis (the web's five
//  branches: transient-waiting / 404 / 401·403 / 5xx / network·offline), the per-mode SF Symbol, the
//  recovery affordance (web `Button` CTAs: Back-to-list / Sign in / Retry / Retry-when-online), the
//  banner text (facade-resolved copy + the `{{thing}}` interpolation), the resolved render payload,
//  and the VoiceOver label builder. No store, no bundle, no rendered view, so each piece is unit
//  tested in isolation.
//
//  Parity note: the web `QueryError` is a fully-controlled presentational component — the caller
//  passes the failed query `error`, the optional `onRetry`, the optional `resourceName`, and the
//  optional `listHref`; the component reduces those to copy + a CTA per failure mode. `QueryFailure`
//  reproduces the bits the web reads (`isApiError(error) ? error.status : undefined` and
//  `isTransientWaiting(error)`); `QueryErrorMode.classify(failure:online:)` reproduces the branch
//  ladder; `QueryErrorContent.make(...)` reproduces the per-branch copy + CTA. The rose tint and the
//  layout are applied at the view boundary (P1/S9 tokens), never here.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias QueryErrorResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Failure (web `error: unknown`, reduced to what QueryError reads)

/// The bits of a failed query the web `QueryError` actually branches on, distilled to a pure value.
/// The web reads two things off the raw error: `status` (`isApiError(error) ? error.status :
/// undefined`) and whether it is a recoverable wait (`isTransientWaiting(error)` — a `RateLimitError`
/// or `UpstreamUnavailableError`). The composition root classifies the real `Error` into one of these
/// at the boundary; the surface and its tests stay free of the HTTP/transport types.
public struct QueryFailure: Sendable, Equatable {
    /// The HTTP status when the failure is an `ApiError`; `nil` for a transport/unknown error (web
    /// `isApiError(error) ? error.status : undefined`). The sentinel `0` is what the web fetch throws
    /// when the browser is offline at request time.
    public let status: Int?

    /// Whether the failure is a recoverable wait — a rate-limit (`429`/`RATE_LIMITED`) or an open
    /// upstream breaker (`503`/`UPSTREAM_BREAKER_OPEN`). Mirrors the web `isTransientWaiting(error)`;
    /// when set it wins over `status`, exactly as the web checks it before the status ladder.
    public let isTransientWaiting: Bool

    public init(status: Int? = nil, isTransientWaiting: Bool = false) {
        self.status = status
        self.isTransientWaiting = isTransientWaiting
    }

    /// A rate-limited failure (web `RateLimitError`: `429` / `RATE_LIMITED`) — a transient wait.
    public static let rateLimited = QueryFailure(status: 429, isTransientWaiting: true)

    /// An upstream-breaker-open failure (web `UpstreamUnavailableError`: `503` /
    /// `UPSTREAM_BREAKER_OPEN`) — a transient wait.
    public static let upstreamUnavailable = QueryFailure(status: 503, isTransientWaiting: true)

    /// An `ApiError` with the given HTTP status (web `isApiError(error)` true).
    public static func http(_ status: Int) -> QueryFailure {
        QueryFailure(status: status)
    }

    /// A transport / unknown failure with no HTTP status (web `isApiError(error)` false → `status`
    /// `undefined`) — the network/unknown branch.
    public static let network = QueryFailure(status: nil)

    /// The offline sentinel the web fetch throws when `navigator.onLine` is false (`status === 0`).
    public static let offline = QueryFailure(status: 0)
}

// MARK: - Failure mode (web render branches)

/// The failure mode the surface renders — the native mirror of the web `QueryError` branch ladder.
/// `classify(failure:online:)` reproduces the exact web precedence; the enum only owns the mode
/// identity + its SF Symbol so both are asserted without rendering.
public enum QueryErrorMode: String, Sendable, Equatable, CaseIterable {
    /// Transient wait (rate-limit / breaker) — web `isTransientWaiting` branch (web `Clock`).
    case waiting
    /// `404` — the record was deleted or the URL is stale (web `FileQuestion`).
    case notFound
    /// `401` / `403` — session expired or RBAC mismatch (web `Lock`).
    case unauthorized
    /// `5xx` — backend failure (web `Server`).
    case serverError
    /// Network / unknown while the connection is up (web `AlertCircle`).
    case unreachable
    /// Browser offline (`!online` or `status === 0`) — web `WifiOff` branch.
    case offline

    /// The SF Symbol for the mode — the native parity of the web Lucide icon per branch.
    public var symbolName: String {
        switch self {
        case .waiting: "clock"
        case .notFound: "doc.questionmark"
        case .unauthorized: "lock.fill"
        case .serverError: "server.rack"
        case .unreachable: "exclamationmark.circle.fill"
        case .offline: "wifi.slash"
        }
    }

    /// Whether the mode is an assertive failure (web `ErrorState` default `role="alert"` /
    /// `aria-live="assertive"`) versus a calm, non-blocking status (web `role="status"` /
    /// `aria-live="polite"` — the waiting + offline branches). Drives the VoiceOver live-region.
    public var isAssertive: Bool {
        switch self {
        case .waiting, .offline: false
        case .notFound, .unauthorized, .serverError, .unreachable: true
        }
    }

    /// Reproduces the web branch ladder verbatim: `isTransientWaiting` wins first; then the
    /// `ApiError.status` ladder (`404` → `401`/`403` → `≥ 500`); finally the network/unknown branch,
    /// which splits into `offline` when the browser is offline or the fetch threw the `status === 0`
    /// sentinel, else `unreachable`. Pure, so every rung is asserted directly.
    public static func classify(failure: QueryFailure, online: Bool) -> QueryErrorMode {
        if failure.isTransientWaiting {
            return .waiting
        }
        if let status = failure.status {
            if status == 404 {
                return .notFound
            }
            if status == 401 || status == 403 {
                return .unauthorized
            }
            if status >= 500 {
                return .serverError
            }
        }
        let isOffline = !online || failure.status == 0
        return isOffline ? .offline : .unreachable
    }
}

// MARK: - Recovery affordance (web `Button` CTAs)

/// Which recovery action a CTA performs — the native mirror of the web per-branch `Button`s. The
/// view maps each to the bound model verb; the destination (when present) is the web `navigate(...)`
/// target.
public enum QueryErrorActionKind: String, Sendable, Equatable {
    /// Web 404 `Back to list` → `navigate(listHref)`.
    case backToList
    /// Web 401/403 `Sign in` → `navigate('/login')` (web `window.location.href = '/login'`).
    case signIn
    /// Web 5xx / unreachable `Retry` → `onRetry()`.
    case retry
    /// Web offline `Retry when online` → `onRetry()`, rendered disabled until the connection returns.
    case retryWhenOnline
}

/// The resolved CTA the failure mode offers — its verb, its (facade-resolved) label, whether it is
/// enabled (the web offline `disabled={isOffline}`), and the navigation destination for the two
/// navigating verbs. A pure value so the view is a function of it.
public struct QueryErrorAction: Sendable, Equatable {
    public let kind: QueryErrorActionKind
    public let label: QueryErrorText
    public let isEnabled: Bool
    public let destination: String?

    public init(kind: QueryErrorActionKind, label: QueryErrorText, isEnabled: Bool, destination: String? = nil) {
        self.kind = kind
        self.label = label
        self.isEnabled = isEnabled
        self.destination = destination
    }
}

// MARK: - Banner text (facade-resolved copy + `{{thing}}` interpolation)

/// One line of surface text. `localized` carries a (key, English fallback) pair resolved through the
/// P1/S10 facade (web `t(key, fallback)`); `verbatim` carries an already-resolved runtime string (a
/// caller-supplied `resourceName`); `notFoundTitle` reproduces the web interpolated 404 title
/// (`t('error.notFound.title', '{{thing}} not found', { thing })`) by resolving the nested `thing`
/// then substituting it into the resolved template. Keeping the projection in terms of this enum
/// means it stays pure and tests assert the keys directly.
public indirect enum QueryErrorText: Sendable, Equatable {
    case localized(key: String, fallback: String)
    case verbatim(String)
    case notFoundTitle(thing: QueryErrorText)

    /// The i18next-style interpolation token the web 404 title fallback uses.
    static let thingToken = "{{thing}}"

    /// Resolves the line to a display string. `localized` is resolved through the facade; `verbatim`
    /// is returned as-is; `notFoundTitle` resolves the nested `thing`, resolves the title template,
    /// and substitutes the token (web i18next `{{thing}}` interpolation). Pure — asserted with an
    /// identity resolver.
    public func resolve(_ resolver: QueryErrorResolve) -> String {
        switch self {
        case let .localized(key, fallback):
            return resolver(key, fallback)
        case let .verbatim(value):
            return value
        case let .notFoundTitle(thing):
            let resolvedThing = thing.resolve(resolver)
            let template = resolver("error.notFound.title", "\(QueryErrorText.thingToken) not found")
            return template.replacingOccurrences(of: QueryErrorText.thingToken, with: resolvedThing)
        }
    }
}

// MARK: - Resolved content (the failure-phase payload)

/// The fully-derived failure render — the data render of the surface, reproducing the web `ErrorState`
/// composition for the active branch: the mode, its SF Symbol, the title line, the message line, the
/// optional CTA, and the live-region intent. A pure value so the view is a function of it and snapshot
/// tests assert it directly.
public struct QueryErrorContent: Sendable, Equatable {
    public let mode: QueryErrorMode
    public let symbolName: String
    public let title: QueryErrorText
    public let message: QueryErrorText
    public let action: QueryErrorAction?
    public let isAssertive: Bool

    public init(
        mode: QueryErrorMode,
        title: QueryErrorText,
        message: QueryErrorText,
        action: QueryErrorAction?
    ) {
        self.mode = mode
        symbolName = mode.symbolName
        self.title = title
        self.message = message
        self.action = action
        isAssertive = mode.isAssertive
    }

    /// Builds the resolved content for a mode, reproducing the per-branch copy + CTA of the web
    /// `QueryError`. `resourceName` fills the 404 `{{thing}}` (web `resourceName ?? 'Resource'`);
    /// `listHref` gates the 404 `Back to list` CTA (web — only when a list path is supplied);
    /// `canRetry` gates the 5xx / network `Retry` CTA (web — only when `onRetry` is wired). The
    /// offline CTA is always rendered disabled (web `disabled={isOffline}`).
    public static func make(
        mode: QueryErrorMode,
        resourceName: String?,
        listHref: String?,
        canRetry: Bool
    ) -> QueryErrorContent {
        switch mode {
        case .waiting: waiting()
        case .notFound: notFound(resourceName: resourceName, listHref: listHref)
        case .unauthorized: unauthorized()
        case .serverError: serverError(canRetry: canRetry)
        case .unreachable: unreachable(canRetry: canRetry)
        case .offline: offline(canRetry: canRetry)
        }
    }

    /// Web transient-waiting branch — a calm status with no CTA (the global rate-limit banner owns
    /// the retry countdown, so the surface stays quiet here).
    private static func waiting() -> QueryErrorContent {
        QueryErrorContent(
            mode: .waiting,
            title: .localized(key: "error.waiting.title", fallback: "Waiting for upstream"),
            message: .localized(
                key: "error.waiting.message",
                fallback: "We're pausing requests briefly. Data will refresh automatically."
            ),
            action: nil
        )
    }

    /// Web 404 branch — the interpolated `{{thing}} not found` title + an optional Back-to-list CTA.
    private static func notFound(resourceName: String?, listHref: String?) -> QueryErrorContent {
        let thing: QueryErrorText = resourceName.map(QueryErrorText.verbatim)
            ?? .localized(key: "error.notFound.thingDefault", fallback: "Resource")
        let action = listHref.map { href in
            QueryErrorAction(
                kind: .backToList,
                label: .localized(key: "error.notFound.cta", fallback: "Back to list"),
                isEnabled: true,
                destination: href
            )
        }
        return QueryErrorContent(
            mode: .notFound,
            title: .notFoundTitle(thing: thing),
            message: .localized(
                key: "error.notFound.message",
                fallback: "It may have been deleted or the link is wrong."
            ),
            action: action
        )
    }

    /// Web 401/403 branch — the Sign-in CTA targeting `/login`.
    private static func unauthorized() -> QueryErrorContent {
        QueryErrorContent(
            mode: .unauthorized,
            title: .localized(key: "error.unauthorized.title", fallback: "Sign in required"),
            message: .localized(
                key: "error.unauthorized.message",
                fallback: "Your session has expired. Please sign in again."
            ),
            action: QueryErrorAction(
                kind: .signIn,
                label: .localized(key: "error.unauthorized.cta", fallback: "Sign in"),
                isEnabled: true,
                destination: "/login"
            )
        )
    }

    /// Web 5xx branch — a manual Retry CTA gated on a wired `onRetry`.
    private static func serverError(canRetry: Bool) -> QueryErrorContent {
        QueryErrorContent(
            mode: .serverError,
            title: .localized(key: "error.serverError.title", fallback: "Server error"),
            message: .localized(
                key: "error.serverError.message",
                fallback: "Something went wrong on our end. Please try again."
            ),
            action: retryAction(canRetry: canRetry)
        )
    }

    /// Web network/unknown branch while the connection is up — a manual Retry CTA.
    private static func unreachable(canRetry: Bool) -> QueryErrorContent {
        QueryErrorContent(
            mode: .unreachable,
            title: .localized(key: "error.network.title", fallback: "Can't reach server"),
            message: .localized(
                key: "error.network.message",
                fallback: "Check your internet connection and try again."
            ),
            action: retryAction(canRetry: canRetry)
        )
    }

    /// Web offline branch — the calm "you're offline" status with a disabled Retry-when-online CTA.
    private static func offline(canRetry: Bool) -> QueryErrorContent {
        let action = canRetry ? QueryErrorAction(
            kind: .retryWhenOnline,
            label: .localized(key: "error.network.retryWhenOnline", fallback: "Retry when online"),
            isEnabled: false,
            destination: nil
        ) : nil
        return QueryErrorContent(
            mode: .offline,
            title: .localized(key: "error.network.offlineTitle", fallback: "You're offline"),
            message: .localized(
                key: "error.network.offlineDetail",
                fallback: "We'll retry automatically when your connection returns."
            ),
            action: action
        )
    }

    /// The enabled `Retry` CTA shared by the 5xx + unreachable branches (web `error.retry`), gated on
    /// a wired `onRetry`.
    private static func retryAction(canRetry: Bool) -> QueryErrorAction? {
        guard canRetry else { return nil }
        return QueryErrorAction(
            kind: .retry,
            label: .localized(key: "error.retry", fallback: "Retry"),
            isEnabled: true,
            destination: nil
        )
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the failure's combined VoiceOver label from already-resolved parts, so the spoken content is
/// asserted without rendering the view. Reads the title then the message as one sentence; parts that
/// already end in terminal punctuation are joined with a single space so the sentence never doubles a
/// period.
public enum QueryErrorAccessibility {
    public static func label(title: String, message: String) -> String {
        var parts: [String] = []
        if !title.isEmpty {
            parts.append(title)
        }
        if !message.isEmpty {
            parts.append(message)
        }
        return parts.reduce(into: "") { accumulated, part in
            guard !accumulated.isEmpty else {
                accumulated = part
                return
            }
            let endsWithTerminal = accumulated.last.map { ".!?".contains($0) } ?? false
            accumulated += (endsWithTerminal ? " " : ". ") + part
        }
    }
}
