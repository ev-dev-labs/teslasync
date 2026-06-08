//
//  LegacyAlertStudioRedirect.Models.swift
//  TeslaSync — P4 feature view · 0186 · LegacyAlertStudioRedirect (Apple)
//
//  The Foundation-only value types for the legacy Alert Studio redirect — the SwiftUI parity of
//  features/notifications/components/LegacyAlertStudioRedirect.tsx, whose whole body is
//  `<Navigate to={`/notifications/studio${search}`} replace />` driven by `useLocation()`. The web
//  source forwards the location's `search` VERBATIM onto a constant target path, so these types model
//  the inbound location (web `useLocation`), the resolved navigation target (web `<Navigate to>`), the
//  live-state freshness envelope, and the load-status / render-phase enums — all free of SwiftUI so the
//  resolver logic compiles and tests on a plain host.
//

import Foundation

// MARK: - Inbound location (web `useLocation`)

/// One parsed query parameter from the inbound search string. The redirect forwards the raw `search`
/// verbatim (web string concatenation), so these parsed items are a convenience for the native host
/// (forwarding as `URLQueryItem`s) and for diagnostics/tests — they never re-encode the canonical value.
public struct RedirectQueryItem: Sendable, Equatable {
    /// The parameter name (web `URLSearchParams` key), e.g. `draft`.
    public var name: String
    /// The parameter value, or `nil` for a valueless flag (e.g. `?compact`).
    public var value: String?

    public init(name: String, value: String?) {
        self.name = name
        self.value = value
    }
}

/// The inbound route context — the SwiftUI parity of the web `useLocation()` result the component
/// reads. `path` is the legacy entry path (web `/alert-studio`); `rawQuery` is the search WITHOUT the
/// leading `?` (web `location.search` minus its `?`). The redirect only consumes `search`, exactly like
/// the source, but `path` is retained for parity assertions + diagnostics.
public struct RedirectLocation: Sendable, Equatable {
    /// The legacy entry path that triggered the redirect (web `/alert-studio`).
    public var path: String
    /// The query string without its leading `?` (web `location.search` with the `?` stripped).
    public var rawQuery: String

    public init(path: String = LegacyAlertStudioRedirectConfig.webSourcePath, rawQuery: String = "") {
        self.path = path
        self.rawQuery = Self.normalizeRawQuery(rawQuery)
    }

    /// The web `location.search`: the leading `?` is present only when there is a query, and the value
    /// is forwarded verbatim onto the target path (web `` `/notifications/studio${search}` ``).
    public var search: String {
        rawQuery.isEmpty ? "" : "?" + rawQuery
    }

    /// The order-preserving parsed parameters (host convenience; the verbatim `search` stays canonical).
    public var queryItems: [RedirectQueryItem] {
        RedirectQuery.parse(rawQuery)
    }

    /// Accepts either a bare query (`a=1&b=2`) or one that still carries the leading `?` and folds it to
    /// the bare form so `search` reproduces the web `location.search` exactly once.
    static func normalizeRawQuery(_ value: String) -> String {
        value.hasPrefix("?") ? String(value.dropFirst()) : value
    }
}

// MARK: - Query parsing (pure)

/// Splits a raw query string into order-preserving `RedirectQueryItem`s. Pure + Foundation-only so the
/// parse is unit-tested without a bundle; the redirect forwards the raw string verbatim regardless.
public enum RedirectQuery {
    public static func parse(_ rawQuery: String) -> [RedirectQueryItem] {
        let bare = RedirectLocation.normalizeRawQuery(rawQuery)
        guard !bare.isEmpty else { return [] }
        return bare.split(separator: "&", omittingEmptySubsequences: true).map { pair in
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let name = String(parts[0])
            let value = parts.count > 1 ? String(parts[1]) : nil
            return RedirectQueryItem(name: name, value: value)
        }
    }
}

// MARK: - Resolved target (web `<Navigate to>`)

/// The resolved navigation target — the SwiftUI parity of the web `<Navigate to=… replace />`. `path`
/// is the constant target (web `/notifications/studio`); `search` is the inbound search forwarded
/// verbatim; `routeSlug` + `subPath` are the native decomposition the host navigates with (the
/// canonical top-level `AppRoute.notifications` plus its `studio` sub-destination); `replace` mirrors
/// the web `replace` so the legacy entry is not left on the back stack.
public struct RedirectDestination: Sendable, Equatable {
    /// The constant target path (web `/notifications/studio`).
    public var path: String
    /// The inbound `search` forwarded verbatim (web `` `${search}` ``); `""` when there was none.
    public var search: String
    /// The parsed forwarded parameters (host convenience; `search` stays canonical).
    public var queryItems: [RedirectQueryItem]
    /// The canonical native top-level route segment (web `/notifications` → `AppRoute.notifications`).
    public var routeSlug: String
    /// The sub-destination within the route (web `/studio`); empty for the bare-route fallback.
    public var subPath: String
    /// Whether the legacy entry is replaced rather than pushed (web `replace`).
    public var replace: Bool

    public init(
        path: String,
        search: String,
        queryItems: [RedirectQueryItem],
        routeSlug: String,
        subPath: String,
        replace: Bool
    ) {
        self.path = path
        self.search = search
        self.queryItems = queryItems
        self.routeSlug = routeSlug
        self.subPath = subPath
        self.replace = replace
    }

    /// The exact web target string (web `` `/notifications/studio${search}` ``) — the path with the
    /// verbatim search appended, used for parity assertions, deep-link round-tripping, and diagnostics.
    public var fullPath: String {
        path + search
    }
}

// MARK: - Load status (web `useLocation` availability) + render phase

/// The bound source's status for the inbound location. The web hook always yields a location; the
/// native seam additionally models the host being unable to supply one (`unavailable` → empty state)
/// and a failure reading it (`failed` → error state) so every prompt-required state has a real branch.
public enum RedirectLoadStatus: Sendable, Equatable {
    /// No location resolved yet (initial).
    case idle
    /// The host is resolving the inbound location.
    case resolving
    /// The inbound location is available (web `useLocation()` resolved).
    case resolved(RedirectLocation)
    /// The host could not supply an inbound location (defensive — no actionable target).
    case unavailable
    /// Reading the inbound location failed.
    case failed(String)
}

/// What the surface should render. The redirect's primary path is `redirecting` → `resolved` (the
/// automatic `<Navigate replace>` fires on resolve); `empty` + `error` are the defensive branches.
public enum RedirectPhase: Sendable, Equatable {
    /// Resolving the inbound location / dispatching the redirect (web pre-navigation render).
    case redirecting
    /// The target resolved and the automatic redirect was issued.
    case resolved
    /// No inbound location was available (web would still navigate; native shows a safe fallback).
    case empty
    /// Resolving the inbound location failed.
    case error(String)
}

/// Live-stream freshness (ADR-013): drives the freshness chip + the connectivity banner. A redirect is
/// a LOCAL route change, so it proceeds while `offline`; the chip simply communicates connectivity.
public enum RedirectConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

// MARK: - Redirect target constants (web literals)

/// The constant routing the web source bakes in: the legacy entry path (`/alert-studio`), the target
/// (`/notifications/studio`), its native decomposition (`notifications` + `studio`), the safe parent
/// (`/notifications`) used by the empty-state fallback, and the `replace` semantics.
public enum LegacyAlertStudioRedirectConfig {
    /// Web legacy entry path (the route that mounts this component).
    public static let webSourcePath = "/alert-studio"
    /// Web `<Navigate to>` target path.
    public static let targetPath = "/notifications/studio"
    /// The canonical native top-level route segment (parity with `AppRoute.notifications.pathSegment`).
    public static let targetRouteSlug = "notifications"
    /// The sub-destination within the route (web `/studio`).
    public static let targetSubPath = "studio"
    /// The safe parent path for the empty-state fallback (the target's route root).
    public static let parentPath = "/notifications"
    /// Web `replace` — the legacy entry is not left on the back stack.
    public static let replace = true
}

// MARK: - Injected, pre-localized copy (P1/S10) for the pure summary builder

/// The pre-localized strings the projection's accessibility summary needs: the human destination name
/// (web has none — it is anonymous — so this is native chrome) and its parent. Injected so the summary
/// stays Foundation-only and host-testable; the view resolves the real catalog copy via the P1/S10
/// facade.
public struct LegacyAlertStudioRedirectCopy: Sendable, Equatable {
    /// The destination's human name shown in the chrome (e.g. "Alert Studio").
    public var destinationName: String
    /// The destination's parent surface name (e.g. "Notifications").
    public var parentName: String

    public init(destinationName: String = "Alert Studio", parentName: String = "Notifications") {
        self.destinationName = destinationName
        self.parentName = parentName
    }

    /// English fallbacks — used by previews + tests.
    public static let fallback = LegacyAlertStudioRedirectCopy()
}
