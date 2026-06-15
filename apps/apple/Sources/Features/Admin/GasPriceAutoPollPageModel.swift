//
//  GasPriceAutoPollPageModel.swift
//  TeslaSync — P4 page · P7 · page:admin/GasPriceAutoPoll (Apple)
//
//  The `@Observable` state holder the Gas Price Auto-Poll page binds to — the SwiftUI
//  parity of web/src/features/admin/pages/GasPriceAutoPollPage.tsx. The web page is a
//  thin `PageContainer` wrapper (`t('gas.title')` + `t('gas.subtitle')` + `usePageTitle`)
//  that hosts the shared `<GasPriceSettings />` surface. This model mirrors that exactly:
//  it resolves the two page-chrome strings from the platform catalog (the manifest's two
//  parity items), owns the child `GasPriceSettingsModel` (P1/S8) the page hosts, and emits
//  the P1/S11 `view.opened` diagnostics event on appear (the native peer of `usePageTitle`
//  registering the surface). No networking lives here — the hosted surface owns its own
//  query/state through its own seam (ADR-004).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the page surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there). The
/// slug is a static, non-identifying constant.
public protocol GasPriceAutoPollTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event.
public struct OSLogGasPriceAutoPollTelemetry: GasPriceAutoPollTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the page-chrome strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the app `Localizable.xcstrings` master
/// catalog (the admin-page convention); the web source keys (`gas.*`, web namespace
/// "settings") are preserved verbatim so a shared catalog resolves identically across
/// web and native.
public enum GasPriceAutoPollStrings {
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: nil, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Page model

/// The page's observable view-model. Resolves the title + subtitle the page chrome
/// renders (the manifest's two parity strings), owns the hosted `GasPriceSettingsModel`,
/// and emits the `view.opened` diagnostics event once. Pure page chrome — no networking
/// or business logic (ADR-004); the hosted surface drives its own data states.
@MainActor
@Observable
public final class GasPriceAutoPollPageModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "GasPriceAutoPollPage"

    /// The page title (web `t('gas.title')`, also the `usePageTitle` document title).
    public let title: String

    /// The page subtitle (web `t('gas.subtitle')`).
    public let subtitle: String

    /// The hosted Gas Price Auto-Poll settings surface (web `<GasPriceSettings />`).
    public let settings: GasPriceSettingsModel

    @ObservationIgnored private let telemetry: any GasPriceAutoPollTelemetry
    @ObservationIgnored private var started = false

    public init(
        settings: GasPriceSettingsModel,
        telemetry: any GasPriceAutoPollTelemetry = OSLogGasPriceAutoPollTelemetry()
    ) {
        title = GasPriceAutoPollStrings.string("gas.title", "Gas Price Auto-Poll")
        subtitle = GasPriceAutoPollStrings.string(
            "gas.subtitle",
            "Automatically fetch US average gas prices from EIA"
        )
        self.settings = settings
        self.telemetry = telemetry
    }

    /// Emits the `view.opened` diagnostics event for the page surface (web `usePageTitle`
    /// registering the surface). Idempotent — fires once per appearance cycle.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
    }

    /// Re-arms the one-shot `view.opened` for the next appearance.
    public func stop() {
        started = false
    }
}
