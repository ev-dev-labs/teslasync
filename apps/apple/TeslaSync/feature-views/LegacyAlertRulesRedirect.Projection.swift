//
//  LegacyAlertRulesRedirect.Projection.swift
//  TeslaSync — P4 feature view · 0184 · LegacyAlertRulesRedirect (Apple)
//
//  The projected display pieces for the legacy Alert Rules redirect (the human breadcrumb the chrome
//  shows), the diagnostics surface slug (P1/S11 `view.opened`), and the VoiceOver summary builder.
//  Foundation-only so it executes on a plain host and is pinned by tests.
//

import Foundation

// MARK: - Display projection (the human breadcrumb)

/// The view-ready breadcrumb for the resolved target: the parent surface name, the destination name,
/// and the count of forwarded query parameters — so the view holds no formatting logic. Mirrors the
/// data the web `<Navigate to>` encodes (parent route + sub-route + preserved search).
public struct AlertRulesRedirectBreadcrumb: Sendable, Equatable {
    /// The parent surface name (e.g. "Notifications").
    public var parentName: String
    /// The destination name (e.g. "Alert Rules").
    public var destinationName: String
    /// The number of forwarded query parameters (web preserved `search`), for the "carrying N" note.
    public var forwardedParameterCount: Int

    public init(parentName: String, destinationName: String, forwardedParameterCount: Int) {
        self.parentName = parentName
        self.destinationName = destinationName
        self.forwardedParameterCount = forwardedParameterCount
    }

    /// Builds the breadcrumb from the injected copy + the resolved destination (the forwarded-parameter
    /// count comes from the verbatim-preserved query). `destination` is `nil` while still resolving.
    public static func make(
        copy: LegacyAlertRulesRedirectCopy,
        destination: AlertRulesRedirectDestination?
    ) -> AlertRulesRedirectBreadcrumb {
        AlertRulesRedirectBreadcrumb(
            parentName: copy.parentName,
            destinationName: copy.destinationName,
            forwardedParameterCount: destination?.queryItems.count ?? 0
        )
    }
}

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The stable diagnostics slug emitted with the `view.opened` event. Held in the dependency-free core
/// so it is reachable from the projection's unit tests.
public enum LegacyAlertRulesRedirectSurface {
    public static let slug = "LegacyAlertRulesRedirect"
}

// MARK: - Accessibility (VoiceOver summaries)

/// Builds the surface's VoiceOver summary. Copy resolves through an injected localizer
/// (`(key, fallback) -> String`) so the summaries are testable without a bundle, exactly like the
/// view's P1/S10 facade. `destination` is the resolved destination's human name.
public enum LegacyAlertRulesRedirectAccessibility {
    /// The spoken status of the redirect surface for the current phase.
    public static func summary(
        for phase: AlertRulesRedirectPhase,
        destination: String,
        localize: (String, String) -> String
    ) -> String {
        switch phase {
        case .redirecting:
            let template = localize("legacyAlertRulesRedirect.a11y.redirecting", "Redirecting to %@")
            return String(format: template, destination)
        case .resolved:
            let template = localize("legacyAlertRulesRedirect.a11y.resolved", "Opening %@")
            return String(format: template, destination)
        case .empty:
            return localize("legacyAlertRulesRedirect.a11y.empty", "Alert Rules is unavailable")
        case .error:
            return localize("legacyAlertRulesRedirect.a11y.error", "Couldn't open Alert Rules")
        }
    }
}
