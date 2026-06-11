//
//  ServiceStatus.Adapter.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  The testable, dependency-light core for the service-status surface — the SwiftUI parity of
//  `components/data-display/ServiceStatus.tsx`. The web file ships two presentational pieces that
//  this surface reproduces natively:
//
//    • `ServiceStatusBanner` — the connectivity banner. It subscribes to the browser online/offline
//      status (`getConnectionStatus()` / `onStatusChange`) and, while offline, renders the
//      "You are offline. Data may be stale. Reconnecting automatically…" notice. Online → nothing.
//    • `SystemHealthDot` — the sidebar health indicator. It reads the backend `/system/status`
//      `overall` field (web `useQuery(fetchSystemStatus)`) and paints a dot: `healthy` → green,
//      `degraded` → amber, anything else → red.
//
//  Everything here is pure (Foundation only): the health taxonomy (web `overall` → colour ternary),
//  the connectivity copy, and the VoiceOver label builders. No store, no bundle, no rendered view,
//  so each piece is unit tested in isolation. The colour/tint is applied at the view boundary
//  (P1/S9 tokens), never here.
//

import Foundation

// MARK: - Localization seam (web `t(key, default)`)

/// The string resolver the surface binds against — the native shape of the web `useTranslation`
/// `t(key, fallback)` call. Kept as a plain closure so the pure core has no dependency on a bundle:
/// the production app passes the P1/S10 facade, while tests pass the identity-fallback resolver.
public typealias ServiceStatusResolve = @Sendable (_ key: String, _ fallback: String) -> String

// MARK: - System health level (web `overall` → colour ternary)

/// The health level the dot paints — the native mirror of the web `SystemHealthDot` colour ternary.
/// Derived from the backend `overall` string exactly as the web component does: `"healthy"` → the
/// success tone, `"degraded"` → the warning tone, anything else (`"down"`, `"unhealthy"`, …) → the
/// danger tone. An empty `overall` is treated as "no value" by the projection (the P4 empty state),
/// so it never reaches `forOverall(_:)` at runtime; the mapping still resolves it to `.down` so the
/// function is total.
public enum SystemHealthLevel: String, Sendable, Equatable, CaseIterable {
    case healthy
    case degraded
    case down

    /// Maps the backend `overall` string to a level (web colour ternary). Case-sensitive, matching
    /// the web `===` comparison; unknown / future values fall through to `.down` (web `else`).
    public static func forOverall(_ overall: String) -> SystemHealthLevel {
        switch overall {
        case "healthy": .healthy
        case "degraded": .degraded
        default: .down
        }
    }

    /// The SF Symbol that names the level — kept here (a plain string) so the mapping is asserted
    /// without rendering. The tint is applied at the view boundary (P1/S9 tokens), never here.
    public var systemImageName: String {
        switch self {
        case .healthy: "checkmark.circle.fill"
        case .degraded: "exclamationmark.triangle.fill"
        case .down: "xmark.octagon.fill"
        }
    }

    /// The (key, English fallback) pair for the level's short label — resolved through the P1/S10
    /// facade at the view boundary so the dot label carries no hardcoded literal.
    public var label: (key: String, fallback: String) {
        switch self {
        case .healthy: ("service.status.level.healthy", "Healthy")
        case .degraded: ("service.status.level.degraded", "Degraded")
        case .down: ("service.status.level.down", "Down")
        }
    }
}

// MARK: - Connectivity copy (web `ServiceStatusBanner`)

/// The localized copy keys for the offline banner — the verbatim port of the web
/// `ServiceStatusBanner` string ("You are offline. Data may be stale. Reconnecting automatically…").
/// Split into a heading + body so the native banner reads idiomatically while preserving the exact
/// content. Pure (key, fallback) values resolved through the P1/S10 facade at the view boundary.
public enum ServiceStatusCopy {
    public static let offlineTitleKey = "service.status.offline.title"
    public static let offlineTitleFallback = "You are offline"

    public static let offlineMessageKey = "service.status.offline.message"
    public static let offlineMessageFallback = "Data may be stale. Reconnecting automatically…"
}

// MARK: - Accessibility (testable seam)

/// Builds the surface's VoiceOver strings from already-localised parts, so the spoken content is
/// asserted without rendering the view.
public enum ServiceStatusAccessibility {
    /// The token the localized "System: {status}" template carries for the resolved level label —
    /// the native parity of the web ``title={`System: ${data.overall}`}``.
    public static let statusToken = "{status}"

    /// Builds the dot's accessibility label by substituting the resolved level label into the
    /// localized template (web `System: {overall}`). Tolerates a template missing the token.
    public static func dotLabel(statusLabel: String, template: String) -> String {
        template.replacingOccurrences(of: statusToken, with: statusLabel)
    }

    /// Joins the offline banner's heading + body into one VoiceOver sentence, never doubling a
    /// terminal period when the heading already ends in one.
    public static func bannerLabel(title: String, message: String) -> String {
        guard !title.isEmpty else { return message }
        guard !message.isEmpty else { return title }
        let endsWithTerminal = title.last.map { ".!?".contains($0) } ?? false
        return title + (endsWithTerminal ? " " : ". ") + message
    }
}
