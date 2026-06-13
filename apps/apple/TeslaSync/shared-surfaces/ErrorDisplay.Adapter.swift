//
//  ErrorDisplay.Adapter.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  The testable, dependency-light core for the ErrorDisplay shared surface — the SwiftUI parity of
//  `components/feedback/ErrorDisplay.tsx`. That component is the status-aware error banner for
//  NON-query failures (mutation failures, imperative fetches). It mirrors `QueryError`'s four status
//  branches (404 / 401·403 / 5xx / network·offline) but, unlike QueryError, it does NOT read the
//  transient-waiting classification and does NOT wire the auto-retry-on-reconnect effect; instead it
//  adds a `compact` density variant for inline contexts (e.g. an error inside a panel).
//
//  Everything here is pure (Foundation only): the reduced failure value (the web `error: unknown`
//  distilled to the `ApiError.status` it reads), the failure-mode axis, the per-mode SF Symbol, the
//  recovery affordance (web `Button` CTAs), the banner text (facade-resolved copy + the `{{thing}}`
//  interpolation), the resolved render payload, the density metrics (web `compact` prop), and the
//  VoiceOver label builder. No store, no bundle, no rendered view — each piece is unit tested alone.
//
//  Parity note: the web `ErrorDisplay` is fully controlled — the caller passes `error`, `onRetry`,
//  `compact`, `resourceName`, and `listHref`. `ErrorFailure` reproduces the only bit it reads
//  (`isApiError(error) ? error.status : undefined`); `ErrorDisplayMode.classify` reproduces the branch
//  ladder; `ErrorDisplayContent.make` the per-branch copy + CTA. Tint + layout live at the view
//  boundary (P1/S9 tokens), never here.
//

import CoreGraphics
import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias ErrorDisplayResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - Failure (web `error: unknown`, reduced to what ErrorDisplay reads)

/// The single bit of a failed operation the web `ErrorDisplay` actually branches on, distilled to a
/// pure value. Unlike `QueryError`, `ErrorDisplay` reads ONLY `status` (`isApiError(error) ?
/// error.status : undefined`) — it does not import `isTransientWaiting`, so there is no transient
/// axis here. The composition root classifies the real `Error` into this at the boundary; the surface
/// and its tests stay free of the HTTP/transport types.
public struct ErrorFailure: Sendable, Equatable {
    /// The HTTP status when the failure is an `ApiError`; `nil` for a transport/unknown error (web
    /// `isApiError(error) ? error.status : undefined`). The sentinel `0` is what the web fetch throws
    /// when the browser is offline at request time.
    public let status: Int?

    public init(status: Int? = nil) {
        self.status = status
    }

    /// An `ApiError` with the given HTTP status (web `isApiError(error)` true).
    public static func http(_ status: Int) -> ErrorFailure {
        ErrorFailure(status: status)
    }

    /// A transport / unknown failure with no HTTP status (web `isApiError(error)` false → `status`
    /// `undefined`) — the network/unknown branch.
    public static let network = ErrorFailure(status: nil)

    /// The offline sentinel the web fetch throws when `navigator.onLine` is false (`status === 0`).
    public static let offline = ErrorFailure(status: 0)
}

// MARK: - Failure mode (web render branches)

/// The failure mode the surface renders — the native mirror of the web `ErrorDisplay` branch ladder.
/// `classify(failure:online:)` reproduces the exact web precedence; the enum only owns the mode
/// identity + its SF Symbol so both are asserted without rendering.
public enum ErrorDisplayMode: String, Sendable, Equatable, CaseIterable {
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
        case .notFound: "doc.questionmark"
        case .unauthorized: "lock.fill"
        case .serverError: "server.rack"
        case .unreachable: "exclamationmark.circle.fill"
        case .offline: "wifi.slash"
        }
    }

    /// Whether the mode is an assertive failure (web `_ErrorState` default `role="alert"` /
    /// `aria-live="assertive"`) versus a calm, non-blocking status (web `role="status"` /
    /// `aria-live="polite"` — the offline branch only). Drives the VoiceOver live-region.
    public var isAssertive: Bool {
        switch self {
        case .offline: false
        case .notFound, .unauthorized, .serverError, .unreachable: true
        }
    }

    /// Reproduces the web branch ladder verbatim: the `ApiError.status` ladder (`404` → `401`/`403`
    /// → `≥ 500`), then the network/unknown branch, which splits into `offline` when the browser is
    /// offline or the fetch threw the `status === 0` sentinel, else `unreachable`. Pure, so every rung
    /// is asserted directly.
    public static func classify(failure: ErrorFailure, online: Bool) -> ErrorDisplayMode {
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

// MARK: - Density (web `compact` prop)

/// The banner density — the native mirror of the web `compact` prop. The web `_ErrorState` switches
/// padding, gap, and icon size on `compact` for inline mutation errors (e.g. an error inside a panel)
/// versus the full-bleed banner. The metrics are pure CGFloat values (the P1/S9 spacing tokens) so the
/// compact variant is asserted without rendering; the view reads them at the boundary.
public enum ErrorDisplayDensity: String, Sendable, Equatable, CaseIterable {
    case comfortable
    case compact

    /// Outer padding of the banner tile (web `p-4` vs `p-3`).
    public var containerPadding: CGFloat {
        self == .compact ? TSSpacing.md : TSSpacing.lg
    }

    /// Leading gap between the icon and the text (web `gap-3` vs `gap-2`).
    public var rowSpacing: CGFloat {
        self == .compact ? TSSpacing.sm : TSSpacing.md
    }

    /// Padding inside the tinted icon box (web `p-2` vs `p-1.5`).
    public var iconBoxPadding: CGFloat {
        self == .compact ? TSSpacing.xs : TSSpacing.sm
    }

    /// Point size of the leading SF Symbol (web `h-4 w-4` = 16 vs `h-3.5 w-3.5` = 14).
    public var iconPointSize: CGFloat {
        self == .compact ? 14 : 16
    }
}

// MARK: - Recovery affordance (web `Button` CTAs)

/// Which recovery action a CTA performs — the native mirror of the web per-branch `Button`s. The view
/// maps each to the bound model verb; the destination (when present) is the web `navigate(...)`
/// target.
public enum ErrorDisplayActionKind: String, Sendable, Equatable {
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
public struct ErrorDisplayAction: Sendable, Equatable {
    public let kind: ErrorDisplayActionKind
    public let label: ErrorDisplayText
    public let isEnabled: Bool
    public let destination: String?

    public init(
        kind: ErrorDisplayActionKind,
        label: ErrorDisplayText,
        isEnabled: Bool,
        destination: String? = nil
    ) {
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
/// then substituting it into the resolved template. Keeping the projection in terms of this enum means
/// it stays pure and tests assert the keys directly.
public indirect enum ErrorDisplayText: Sendable, Equatable {
    case localized(key: String, fallback: String)
    case verbatim(String)
    case notFoundTitle(thing: ErrorDisplayText)

    /// The i18next-style interpolation token the web 404 title fallback uses.
    static let thingToken = "{{thing}}"

    /// Resolves the line to a display string. `localized` is resolved through the facade; `verbatim` is
    /// returned as-is; `notFoundTitle` resolves the nested `thing`, resolves the title template, and
    /// substitutes the token (web i18next `{{thing}}` interpolation). Pure — asserted with an identity
    /// resolver.
    public func resolve(_ resolver: ErrorDisplayResolve) -> String {
        switch self {
        case let .localized(key, fallback):
            return resolver(key, fallback)
        case let .verbatim(value):
            return value
        case let .notFoundTitle(thing):
            let resolvedThing = thing.resolve(resolver)
            let template = resolver("error.notFound.title", "\(ErrorDisplayText.thingToken) not found")
            return template.replacingOccurrences(of: ErrorDisplayText.thingToken, with: resolvedThing)
        }
    }
}

// MARK: - Resolved content (the failure-phase payload)

/// The fully-derived failure render — the data render of the surface, reproducing the web `_ErrorState`
/// composition for the active branch: the mode, its SF Symbol, the title line, the message line, the
/// optional CTA, and the live-region intent. A pure value so the view is a function of it and snapshot
/// tests assert it directly.
public struct ErrorDisplayContent: Sendable, Equatable {
    public let mode: ErrorDisplayMode
    public let symbolName: String
    public let title: ErrorDisplayText
    public let message: ErrorDisplayText
    public let action: ErrorDisplayAction?
    public let isAssertive: Bool

    public init(
        mode: ErrorDisplayMode,
        title: ErrorDisplayText,
        message: ErrorDisplayText,
        action: ErrorDisplayAction?
    ) {
        self.mode = mode
        symbolName = mode.symbolName
        self.title = title
        self.message = message
        self.action = action
        isAssertive = mode.isAssertive
    }

    /// Builds the resolved content for a mode, reproducing the per-branch copy + CTA of the web
    /// `ErrorDisplay`. `resourceName` fills the 404 `{{thing}}` (web `resourceName ?? 'Resource'`);
    /// `listHref` gates the 404 `Back to list` CTA (web — only when a list path is supplied);
    /// `canRetry` gates the 5xx / network `Retry` CTA (web — only when `onRetry` is wired). The offline
    /// CTA is always rendered disabled (web `disabled={isOffline}`).
    public static func make(
        mode: ErrorDisplayMode,
        resourceName: String?,
        listHref: String?,
        canRetry: Bool
    ) -> ErrorDisplayContent {
        switch mode {
        case .notFound: notFound(resourceName: resourceName, listHref: listHref)
        case .unauthorized: unauthorized()
        case .serverError: serverError(canRetry: canRetry)
        case .unreachable: unreachable(canRetry: canRetry)
        case .offline: offline(canRetry: canRetry)
        }
    }

    /// Web 404 branch — the interpolated `{{thing}} not found` title + an optional Back-to-list CTA.
    private static func notFound(resourceName: String?, listHref: String?) -> ErrorDisplayContent {
        let thing: ErrorDisplayText = resourceName.map(ErrorDisplayText.verbatim)
            ?? .localized(key: "error.notFound.thingDefault", fallback: "Resource")
        let action = listHref.map { href in
            ErrorDisplayAction(
                kind: .backToList,
                label: .localized(key: "error.notFound.cta", fallback: "Back to list"),
                isEnabled: true,
                destination: href
            )
        }
        return ErrorDisplayContent(
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
    private static func unauthorized() -> ErrorDisplayContent {
        ErrorDisplayContent(
            mode: .unauthorized,
            title: .localized(key: "error.unauthorized.title", fallback: "Sign in required"),
            message: .localized(
                key: "error.unauthorized.message",
                fallback: "Your session has expired. Please sign in again."
            ),
            action: ErrorDisplayAction(
                kind: .signIn,
                label: .localized(key: "error.unauthorized.cta", fallback: "Sign in"),
                isEnabled: true,
                destination: "/login"
            )
        )
    }

    /// Web 5xx branch — a manual Retry CTA gated on a wired `onRetry`.
    private static func serverError(canRetry: Bool) -> ErrorDisplayContent {
        ErrorDisplayContent(
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
    private static func unreachable(canRetry: Bool) -> ErrorDisplayContent {
        ErrorDisplayContent(
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
    private static func offline(canRetry: Bool) -> ErrorDisplayContent {
        let action = canRetry ? ErrorDisplayAction(
            kind: .retryWhenOnline,
            label: .localized(key: "error.network.retryWhenOnline", fallback: "Retry when online"),
            isEnabled: false,
            destination: nil
        ) : nil
        return ErrorDisplayContent(
            mode: .offline,
            title: .localized(key: "error.network.offlineTitle", fallback: "You're offline"),
            message: .localized(
                key: "error.network.offlineDetail",
                fallback: "We'll retry automatically when your connection returns."
            ),
            action: action
        )
    }

    /// The enabled `Retry` CTA shared by the 5xx + unreachable branches (web `error.retry`), gated on a
    /// wired `onRetry`.
    private static func retryAction(canRetry: Bool) -> ErrorDisplayAction? {
        guard canRetry else { return nil }
        return ErrorDisplayAction(
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
public enum ErrorDisplayAccessibility {
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
