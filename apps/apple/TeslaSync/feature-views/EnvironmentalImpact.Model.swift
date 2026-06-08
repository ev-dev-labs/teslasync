//
//  EnvironmentalImpact.Model.swift
//  TeslaSync — P4 feature view · 0112 · EnvironmentalImpact (Apple)
//
//  Surface identity (P1/S11 diagnostics slug), telemetry seam (P1/S11
//  `view.opened`), i18n facade (P1/S10), and the pure input value types for the
//  SwiftUI parity of
//  web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx.
//
//  The web component is purely presentational: it receives one
//  `coreStats: CoreStats | null` (the cost-analysis aggregate of the S8 charging
//  sessions) and renders the CO₂ / tree-year / gallons / metric-ton / dollars
//  figures, or the "No data" empty state. It performs no I/O and uses only
//  `useTranslation`. The native surface mirrors that exactly: it binds no store
//  and does no networking — the parent cost-analysis surface maps the shared S8
//  charging holder into `EnvironmentalImpactData` (the four figures this card
//  reads) and supplies the freshness from the live-connection state. Keys arrive
//  SI from the API; the cost-analysis adapter has already derived these display
//  figures, so this value type carries only what the card paints.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `EnvironmentalImpact` feature view.
/// The slug is the value emitted with the P1/S11 `view.opened` diagnostics
/// contract and is referenced by both the view and its tests so the two never
/// drift.
public enum EnvironmentalImpactSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "EnvironmentalImpact"

    /// Reports the surface becoming visible. Factored out of the view's `.task`
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any EnvironmentalImpactTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The view reports its
/// appearance through this protocol so production wiring, previews, and tests can
/// each supply their own sink. It is `Sendable` (members non-isolated) so the
/// view can emit from its `.task` without a main-actor hop.
public protocol EnvironmentalImpactTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no charging totals, VIN,
/// or payload is ever recorded.
public struct OSLogEnvironmentalImpactTelemetry: EnvironmentalImpactTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the
/// view holds no hardcoded literals. Keys live in the "EnvironmentalImpact"
/// table, folded into the app `Localizable.xcstrings` catalog at integration
/// time. The web source keys (`costAnalysis.environment.*`) are preserved
/// verbatim so a shared catalog resolves identically across web and native.
public enum EnvironmentalImpactStrings {
    public static let table = "EnvironmentalImpact"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a `%@`-interpolated string (web inline `{value} unit`).
    public static func format(_ key: String, _ fallbackFormat: String, _ argument: String) -> String {
        String(format: string(key, fallbackFormat), argument)
    }
}

// MARK: - Card input (web `coreStats` subset the card reads)

/// The pure, `Equatable` input for one `EnvironmentalImpact` card — the four
/// figures the web component reads off `CoreStats`
/// (`co2SavedKg`, `treeEquiv`, `gallonsEquiv`, `savings`). The parent maps the
/// cost-analysis aggregate into this; the card never touches the network. The
/// "metric tons" figure is derived (`co2SavedKg / 1000`) exactly like the web.
public struct EnvironmentalImpactData: Equatable, Sendable {
    /// Kilograms of CO₂ avoided vs. an equivalent gas car (web `co2SavedKg`).
    public let co2SavedKg: Double
    /// Tree-years of carbon absorption equivalent (web `treeEquiv`).
    public let treeEquiv: Double
    /// Gallons of gasoline avoided (web `gallonsEquiv`).
    public let gallonsEquiv: Double
    /// Total dollars saved vs. gas (web `savings`).
    public let savings: Double

    public init(co2SavedKg: Double, treeEquiv: Double, gallonsEquiv: Double, savings: Double) {
        self.co2SavedKg = co2SavedKg
        self.treeEquiv = treeEquiv
        self.gallonsEquiv = gallonsEquiv
        self.savings = savings
    }

    /// Web `coreStats.co2SavedKg / 1000` — the "metric tons CO₂" figure.
    public var metricTonsCo2: Double {
        co2SavedKg / 1000
    }
}

// MARK: - Freshness (live / stale / offline) for the cached aggregate

/// Freshness of the cost-analysis aggregate behind the card, mirroring
/// `LiveConnectionState` (ADR-013). The card keeps its cached figures visible and
/// surfaces a stale/offline chip, never hiding the surface. `live` shows the
/// figures with no chip; `stale` flags an aging cache with auto-refresh; `offline`
/// keeps the last cached figures with an offline chip.
public enum EnvironmentalImpactConnection: Equatable, Sendable {
    case live
    case stale
    case offline

    /// Whether the last-known figures should still be treated as usable. They
    /// always are here — the card degrades the chip, it never blanks the data.
    public var hasUsableData: Bool {
        true
    }
}

// MARK: - Card state (every state renders — no hidden surfaces)

/// The render state for the `EnvironmentalImpact` card. The web card is the
/// `loaded` / `empty` pair (`coreStats ? … : "No data"`); the native surface
/// additionally renders the load + error chrome required of every P4 surface so
/// the parent never has to special-case it. No surface is ever hidden behind a
/// null check.
public enum EnvironmentalImpactState: Equatable, Sendable {
    /// Initial fetch of the charging aggregate — skeleton chrome.
    case loading
    /// Resolved with no sessions / no value (web `coreStats == null`) — friendly
    /// empty state, never a blank box.
    case empty
    /// The aggregate failed to load — message + retry affordance.
    case error(message: String?)
    /// The aggregate resolved — the full card with every web figure.
    case loaded(EnvironmentalImpactData)

    /// The resolved figures, if any (convenience for the view/tests).
    public var data: EnvironmentalImpactData? {
        if case let .loaded(value) = self { return value }
        return nil
    }
}
