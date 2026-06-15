//
//  TeslaFeatureFlagsPageModel.swift
//  TeslaSync — P4 page · P7 · page:admin/TeslaFeatureFlags (Apple)
//
//  The `@Observable` state holder the Tesla Feature Flags page binds to — the
//  SwiftUI parity of web/src/features/admin/pages/TeslaFeatureFlagsPage.tsx. The web
//  page is a thin `PageContainer` wrapper (`t('featureConfig.title')` +
//  `t('featureConfig.subtitle')` + `usePageTitle`) that hosts the shared
//  `<FeatureToggles />` surface. This model mirrors that exactly: it resolves the two
//  page-chrome strings from the platform catalog (the manifest's two parity items),
//  owns the child `FeatureTogglesModel` (P1/S8) the page hosts, and emits the P1/S11
//  `view.opened` diagnostics event on appear (the native peer of `usePageTitle`
//  registering the surface). No networking lives here — the hosted surface owns its
//  own query/state through its own seam (ADR-004).
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the page surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there). The
/// slug is a static, non-identifying constant.
public protocol TeslaFeatureFlagsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event.
public struct OSLogTeslaFeatureFlagsTelemetry: TeslaFeatureFlagsTelemetry {
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
/// catalog (the admin-page convention); the web source keys (`featureConfig.*`, web
/// namespace "settings") are preserved verbatim so a shared catalog resolves
/// identically across web and native.
public enum TeslaFeatureFlagsStrings {
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: nil, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Page model

/// The page's observable view-model. Resolves the title + subtitle the page chrome
/// renders (the manifest's two parity strings), owns the hosted `FeatureTogglesModel`,
/// and emits the `view.opened` diagnostics event once. Pure page chrome — no
/// networking or business logic (ADR-004); the hosted surface drives its own data
/// states.
@MainActor
@Observable
public final class TeslaFeatureFlagsPageModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TeslaFeatureFlagsPage"

    /// The page title (web `t('featureConfig.title')`, also the `usePageTitle`
    /// document title).
    public let title: String

    /// The page subtitle (web `t('featureConfig.subtitle')`).
    public let subtitle: String

    /// The hosted Tesla Feature Flags surface (web `<FeatureToggles />`).
    public let toggles: FeatureTogglesModel

    @ObservationIgnored private let telemetry: any TeslaFeatureFlagsTelemetry
    @ObservationIgnored private var started = false

    public init(
        toggles: FeatureTogglesModel,
        telemetry: any TeslaFeatureFlagsTelemetry = OSLogTeslaFeatureFlagsTelemetry()
    ) {
        title = TeslaFeatureFlagsStrings.string("featureConfig.title", "Feature Flags")
        subtitle = TeslaFeatureFlagsStrings.string(
            "featureConfig.subtitle",
            "Tesla account feature configuration"
        )
        self.toggles = toggles
        self.telemetry = telemetry
    }

    /// Emits the `view.opened` diagnostics event for the page surface (web
    /// `usePageTitle` registering the surface). Idempotent — fires once per appearance
    /// cycle.
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
