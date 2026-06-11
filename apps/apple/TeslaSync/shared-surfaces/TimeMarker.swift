//
//  TimeMarker.swift
//  TeslaSync — P4 shared surface · 0074 · TimeMarker (Apple)
//
//  The SwiftUI surface — the public API of the alert time-marker. The web source pairs the
//  presentational `<TimeMarker>` with the `useAlertContext()` hook that feeds it; SwiftUI's idiomatic
//  equivalent of a React hook reading shared router state is an Environment value, so this file
//  exposes:
//
//    • EnvironmentValues.alertContext — the parity of `useAlertContext()`. It resolves to the active
//      ``AlertContextModel``, or `nil` when no host injected one (so a chart embedded without alert
//      drill-through wiring keeps working unchanged, exactly as a page that never reads the hook).
//    • .alertContext(_:) — the host modifier that injects the model into the environment for every
//      descendant chart and emits the surface's single `view.opened` event on appear.
//    • MarkerSeverity color + symbol tokens — the SwiftUI projection of the web `SEVERITY_STROKE`
//      map (and the `severityTokens` re-export), kept here (not in the Foundation core) because they
//      are `Color` / SF Symbol values. These map onto the theme-aware design tokens (P1/S9) so the
//      marker recolors correctly in light, dark, and high-contrast — an improvement over the web
//      source's hardcoded hex, which only looked right in one theme.
//
//  The chart bridge that turns a resolved marker into a `RuleMark` lives in TimeMarker.Views.swift.
//  No networking, no Tailwind ports, no raw hex — chrome is token-driven (P1/S9) and copy resolves
//  through P1/S10.
//

import SwiftUI

// MARK: - Environment (web `useAlertContext()`)

/// The environment slot carrying the active alert-context model — the SwiftUI analog of the web
/// `useAlertContext()` read. The default is `nil` so a chart outside any host resolves exactly as a
/// page that never lands on a drill-through URL (no marker).
private struct AlertContextEnvironmentKey: EnvironmentKey {
    static let defaultValue: AlertContextModel? = nil
}

public extension EnvironmentValues {
    /// The active alert-context model (web `useAlertContext()`) — `nil` unless a host injected one
    /// via ``SwiftUI/View/alertContext(_:)``. Descendant charts read this to derive the marker x and
    /// to show "viewing alert context" affordances.
    var alertContext: AlertContextModel? {
        get { self[AlertContextEnvironmentKey.self] }
        set { self[AlertContextEnvironmentKey.self] = newValue }
    }
}

// MARK: - Host modifier (web hook wiring)

public extension View {
    /// Injects an ``AlertContextModel`` into the environment for `self` and every descendant chart —
    /// the host wiring that makes `useAlertContext()` resolve. Emits the surface's single
    /// `view.opened` event when the host appears (idempotent across appear/disappear churn).
    func alertContext(_ model: AlertContextModel) -> some View {
        environment(\.alertContext, model)
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }
}

// MARK: - MarkerSeverity → design tokens (web `SEVERITY_STROKE` / `severityTokens`)

public extension MarkerSeverity {
    /// The reference-line / icon color — the theme-aware token projection of the web
    /// `SEVERITY_STROKE` hex (`info → #0ea5e9`, `warn → #f59e0b`, `critical → #ef4444`,
    /// `success → #10b981`). Reads from the design system so it recolors across light / dark /
    /// high-contrast, where the web hex did not.
    var stroke: Color {
        switch self {
        case .info: Color.TS.statusInfo
        case .warn: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        case .success: Color.TS.statusSuccess
        }
    }

    /// A soft background tint for a label chip — the native peer of `severityTokens.bg`
    /// (`bg-{color}/10`).
    var tint: Color {
        stroke.opacity(0.12)
    }

    /// A subtle border for a label chip — the native peer of `severityTokens.border`
    /// (`border-{color}/30`).
    var border: Color {
        stroke.opacity(0.3)
    }

    /// The SF Symbol matching the web `severityTokens.icon` Lucide name (`Info`,
    /// `AlertTriangle`, `AlertOctagon`, `CheckCircle`).
    var symbolName: String {
        switch self {
        case .info: "info.circle.fill"
        case .warn: "exclamationmark.triangle.fill"
        case .critical: "exclamationmark.octagon.fill"
        case .success: "checkmark.circle.fill"
        }
    }

    /// The localized, VoiceOver-friendly severity name, resolved through the P1/S10 facade.
    var localizedName: String {
        switch self {
        case .info: TimeMarkerStrings.string("timeMarker.severity.info", "Info")
        case .warn: TimeMarkerStrings.string("timeMarker.severity.warn", "Warning")
        case .critical: TimeMarkerStrings.string("timeMarker.severity.critical", "Critical")
        case .success: TimeMarkerStrings.string("timeMarker.severity.success", "Success")
        }
    }
}
