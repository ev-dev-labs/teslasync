//
//  TelemetryPipelineCard.Seams.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  The dependency seams the card binds through, kept apart from the model for the lint
//  length budget: the P1/S11 telemetry (`view.opened`) contract, the P1/S10 i18n facade
//  (the card's strings, since the web source is anonymous), and the navigation seam that
//  reproduces the web `<Link>` destinations (vehicle detail, Tesla account, telemetry
//  coverage, MQTT inspector, all vehicles). No networking lives in the view.
//

import Foundation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated + redacted there.
public protocol TelemetryPipelineTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogTelemetryPipelineTelemetry: TelemetryPipelineTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — the card's i18n keys

/// Resolves the surface's strings by key with the web English value, so the views hold no
/// hardcoded literals. The web source is anonymous (no `t()` calls), so these keys are
/// minted here under the `telemetry.pipeline.*` namespace and live in the
/// "TelemetryPipelineCard" table, folded into the app `Localizable.xcstrings` master at
/// integration time. Kept per-surface so each parallel prompt owns its own strings.
public enum TelemetryPipelineStrings {
    public static let table = "TelemetryPipelineCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// `Text` convenience over `string(_:_:)`, rendered verbatim so interpolated values are
    /// never re-localized.
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Navigation seam (web `<Link to=…>`)

/// The destinations the card links to (web `react-router` paths). Identifiable so a
/// `navigationDestination`/router can switch over them; the raw `path` mirrors the web href
/// for parity assertions.
public enum TelemetryPipelineDestination: Equatable, Sendable, Identifiable {
    case vehicle(id: Int64)
    case teslaAccount
    case telemetryCoverage
    case mqttInspector
    case allVehicles

    public var id: String {
        path
    }

    /// The web `<Link to>` href this destination corresponds to.
    public var path: String {
        switch self {
        case let .vehicle(id): "/vehicles/\(id)"
        case .teslaAccount: "/tesla-account"
        case .telemetryCoverage: "/admin/telemetry/coverage"
        case .mqttInspector: "/mqtt-inspector"
        case .allVehicles: "/vehicles"
        }
    }
}

/// The seam the card routes through, keeping navigation out of the view so each link is
/// unit-testable with a spy. Production injects the app router; previews/tests record the
/// intent.
public protocol TelemetryPipelineNavigator: Sendable {
    func navigate(to destination: TelemetryPipelineDestination)
}

/// `os.Logger`-backed default that records the navigation intent without routing, so
/// previews render the links safely.
public struct OSLogTelemetryPipelineNavigator: TelemetryPipelineNavigator {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "navigation")
    }

    public func navigate(to destination: TelemetryPipelineDestination) {
        logger.info("navigate path=\(destination.path, privacy: .public)")
    }
}
