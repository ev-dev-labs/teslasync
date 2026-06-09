//
//  FleetStatsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0051 · FleetStatsWidget (Apple)
//
//  The composable dashboard surface that wraps the shared FleetStatsBar in the widget
//  chrome — the SwiftUI parity of features/dashboard/widgets/FleetStatsWidget.tsx,
//  which renders `<WidgetShell noPadding …><FleetStatsBar … /></WidgetShell>`.
//
//  This file holds the surface's seams: the P1/S11 telemetry sink, the P1/S10 i18n
//  facade for the widget-only chrome (the parity card strings are owned by the
//  FleetStatsBar surface), the canonical `fleet-stats` registry registration (P4 grid),
//  and the `FleetStatsWidgetModel` view-model. It is SwiftUI-free so the model + seams
//  compile and unit-test on a plain host; the SwiftUI chrome layers on top in
//  FleetStatsWidget.swift.
//
//  The widget owns no data pipeline of its own: it reuses the FleetStatsBar state
//  holder (FleetStatsBarModel + FleetStatsSource, P1/S8) for the vehicles +
//  fleet-analytics + recent drives/charges feed, exactly as the web widget hands its
//  resolved queries down to the FleetStatsBar leaf.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the widget surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there. Kept distinct from the FleetStatsBar
/// telemetry seam so the wrapping widget and the embedded bar each report their own
/// surface slug.
public protocol FleetStatsWidgetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogFleetStatsWidgetTelemetry: FleetStatsWidgetTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — widget chrome only

/// Resolves the widget-chrome strings by key with the English fallback, so the view
/// holds no hardcoded prose. Keys live in the "FleetStatsWidget" table (the registry
/// name/description + the freshness chip + the open affordance); the parity card copy
/// is resolved by the embedded FleetStatsBar through its own "FleetStatsBar" table.
/// Both fold into the app `Localizable.xcstrings` master catalog at integration time.
public enum FleetStatsWidgetStrings {
    public static let table = "FleetStatsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Surface identity + canonical registry registration

/// The widget's diagnostics slug (P1/S11) and its canonical dashboard registration
/// (web `registry/analytics.ts` → "fleet-stats"). Held in the dependency-free seam so
/// it is reachable from the registry unit tests without SwiftUI.
public enum FleetStatsWidgetSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "FleetStatsWidget"

    /// Canonical registry metadata (registry/analytics.ts → "fleet-stats"): a 4×2
    /// analytics widget that resizes from 2×2 up to 4×40.
    public static let registration = DashboardWidgetRegistration(
        id: "fleet-stats",
        nameKey: "widget.fleetStats",
        descriptionKey: "widget.fleetStats.description",
        category: "analytics",
        defaultSize: DashboardWidgetSize(cols: 4, rows: 2),
        minSize: DashboardWidgetSize(cols: 2, rows: 2),
        maxSize: DashboardWidgetSize(cols: 4, rows: 40)
    )
}

// MARK: - State holder (P1/S8)

/// The widget's observable view-model. It composes the shared `FleetStatsBarModel`
/// (the data feed + the five-card projection) and adds the widget-level concerns the
/// web `WidgetShell` owns: the one-shot `view.opened` diagnostics for the widget slug
/// and the freshness/refresh control wiring. The data lifecycle (start/stop/refresh of
/// the underlying queries) stays owned by the embedded `FleetStatsBar` view, so the
/// model never double-drives the source.
@MainActor
@Observable
public final class FleetStatsWidgetModel {
    /// The shared bar state holder this widget renders + reads its freshness from.
    public let bar: FleetStatsBarModel

    @ObservationIgnored private let telemetry: any FleetStatsWidgetTelemetry
    @ObservationIgnored private var trackedOpen = false

    public init(
        bar: FleetStatsBarModel,
        telemetry: any FleetStatsWidgetTelemetry = OSLogFleetStatsWidgetTelemetry()
    ) {
        self.bar = bar
        self.telemetry = telemetry
    }

    /// Convenience composition root used by the dashboard host + previews: builds the
    /// bar model over a `FleetStatsSource` and wraps it with the widget telemetry.
    public convenience init(
        source: any FleetStatsSource,
        telemetry: any FleetStatsWidgetTelemetry = OSLogFleetStatsWidgetTelemetry(),
        barTelemetry: any FleetStatsTelemetry = OSLogFleetStatsTelemetry(),
        locale: Locale = .current
    ) {
        let barModel = FleetStatsBarModel(source: source, telemetry: barTelemetry, locale: locale)
        self.init(bar: barModel, telemetry: telemetry)
    }

    /// Emits the widget's `view.opened` diagnostics event once per appearance episode.
    /// The embedded `FleetStatsBar` view separately starts the data feed (and emits its
    /// own bar-level `view.opened`), so this stays purely the widget-slug signal.
    public func start() {
        guard !trackedOpen else { return }
        trackedOpen = true
        telemetry.viewOpened(surface: FleetStatsWidgetSurface.slug)
    }

    /// Arms the next appearance to re-emit `view.opened` (the widget scrolled off the
    /// dashboard). The bar's own data lifecycle is owned by the bar view.
    public func stop() {
        trackedOpen = false
    }

    /// Re-runs the underlying queries — wired to the freshness chip's refresh tap and
    /// reused as the error-state retry path through the embedded bar.
    public func refresh() {
        bar.refresh()
    }
}
