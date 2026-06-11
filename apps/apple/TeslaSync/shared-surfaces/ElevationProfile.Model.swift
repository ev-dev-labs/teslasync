//
//  ElevationProfile.Model.swift
//  TeslaSync — P4 shared surface · 0071 · ElevationProfile (Apple)
//
//  The surface identity, the diagnostics telemetry seam (P1/S11), the localisation facade (P1/S10),
//  and the `@MainActor` model the view binds through. The model owns the sample-series state (P1/S8),
//  the controlled cursor (the native shape of the web `currentIndex` prop), the click → index callback
//  (web `onClickIndex`), the optional retry callback, and the once-only `view.opened` emission —
//  keeping the view a pure function of `resolved(locale:)`. The pure value types + projection live in
//  the `.Source` / `.Projection` files; this file holds the stateful + side-effecting concerns.
//

import Foundation
import Observation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug (P1/S11 `view.opened`). A static,
/// non-identifying constant matching the web component name.
public enum ElevationProfileMeta {
    public static let surfaceSlug = "ElevationProfile"
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol ElevationProfileTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogElevationProfileTelemetry: ElevationProfileTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

/// The testable emission seam: emits `view.opened` exactly once, the first time the surface appears.
/// Returns the new "already emitted" flag so the caller can thread it across appearances without
/// double counting.
public enum ElevationProfileDiagnostics {
    public static func openIfNeeded(
        alreadyEmitted: Bool,
        telemetry: any ElevationProfileTelemetry
    ) -> Bool {
        guard !alreadyEmitted else { return true }
        telemetry.viewOpened(surface: ElevationProfileMeta.surfaceSlug)
        return true
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no
/// hardcoded literals. Keys live in the "ElevationProfile" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time; kept per-surface so each parallel prompt owns
/// its own strings.
public enum ElevationProfileStrings {
    public static let table = "ElevationProfile"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Model (@MainActor owner of the series state + controlled cursor)

/// The `@MainActor` model the view binds through — the home for the sample-series state (P1/S8), the
/// controlled cursor (the native shape of the web `currentIndex` prop), the click → index callback
/// (web `onClickIndex`), the optional retry callback, and the once-only `view.opened` emission. The
/// view stays a pure function of `resolved(locale:)`; this model carries the mutations + side effects
/// off the view.
@MainActor
@Observable
public final class ElevationProfileModel {
    public private(set) var state: LoadableState<[ElevationProfileSample]>
    public private(set) var currentIndex: Int?

    @ObservationIgnored public let distanceUnit: String
    @ObservationIgnored public let height: Double
    @ObservationIgnored private let onClickIndex: (@MainActor (Int) -> Void)?
    @ObservationIgnored private let onRetry: (@MainActor () -> Void)?
    @ObservationIgnored private let telemetry: any ElevationProfileTelemetry
    @ObservationIgnored private var didEmitOpen = false

    public init(
        state: LoadableState<[ElevationProfileSample]>,
        currentIndex: Int? = nil,
        distanceUnit: String = ElevationProfileLayout.defaultDistanceUnit,
        height: Double = ElevationProfileLayout.defaultHeight,
        onClickIndex: (@MainActor (Int) -> Void)? = nil,
        onRetry: (@MainActor () -> Void)? = nil,
        telemetry: any ElevationProfileTelemetry = OSLogElevationProfileTelemetry()
    ) {
        self.state = state
        self.currentIndex = currentIndex
        self.distanceUnit = distanceUnit
        self.height = height
        self.onClickIndex = onClickIndex
        self.onRetry = onRetry
        self.telemetry = telemetry
    }

    /// The view-ready resolved state — recomputed from the series state + the current cursor, localised
    /// with the view's `locale` (the web `fmt` is locale-aware, so the subtitle / summary follow the
    /// active locale).
    public func resolved(locale: Locale = .current) -> ElevationProfileResolved {
        ElevationProfileProjection.resolve(
            ElevationProfileInput.from(state, currentIndex: currentIndex),
            height: height,
            distanceUnit: distanceUnit,
            locale: locale
        )
    }

    /// Whether a retry affordance should be offered (a retry handler was supplied).
    public var canRetry: Bool {
        onRetry != nil
    }

    /// Emits `view.opened` exactly once, the first time the surface appears (idempotent).
    public func markAppeared() {
        didEmitOpen = ElevationProfileDiagnostics.openIfNeeded(
            alreadyEmitted: didEmitOpen,
            telemetry: telemetry
        )
    }

    /// Notifies the host of a tapped sample — the web `onClickIndex(data[idx].index)`. Maps the selected
    /// X (distance) to the nearest plotted sample and emits its `.index` field. No-ops when there is no
    /// series or no handler.
    public func select(distance: Double) {
        guard let onClickIndex else { return }
        let samples = ElevationProfileLogic.sanitized(state.value ?? [])
        guard
            let position = ElevationProfileLogic.nearestArrayPosition(samples, toDistance: distance),
            let index = ElevationProfileLogic.sampleIndex(samples, atArrayPosition: position)
        else { return }
        onClickIndex(index)
    }

    /// Re-requests the data after a failure (the `QueryError` retry affordance).
    public func retry() {
        onRetry?()
    }

    /// Pushes a new series state (the parent re-feeding its state holder).
    public func update(state: LoadableState<[ElevationProfileSample]>) {
        self.state = state
    }

    /// Moves the controlled cursor (the parent updating `currentIndex`).
    public func updateCursor(currentIndex: Int?) {
        self.currentIndex = currentIndex
    }
}
