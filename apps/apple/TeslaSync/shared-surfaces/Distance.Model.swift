//
//  Distance.Model.swift
//  TeslaSync — P4 shared surface · 0085 · Distance (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade (P1/S10) for the
//  distance renderer. The view binds through `DistanceModel`; no networking lives in the view (the web
//  source has none — it reads its props plus the synchronous `useUnits()` preference bag). The model
//  owns the current input snapshot, exposes the pure resolved projection the view renders, adopts new
//  props / units when the host re-renders (`sync(_:)`), and emits the `view.opened` diagnostics event
//  exactly once when the surface first appears. The surface always presents content (the formatted
//  value or the em-dash sentinel — there is no pre-content loading gate because the source has no
//  fetch), so the first appearance is the open moment.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared-core diagnostics
/// sink (consent-gated + redacted there). The slug is a static, non-identifying constant.
public protocol DistanceTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogDistanceTelemetry: DistanceTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves a localized string by key with an English fallback, so the views and the adapter hold no
/// hardcoded user-facing literals.
public typealias DistanceResolve = @Sendable (_ key: String, _ fallback: String) -> String

/// Resolves the surface's strings by key with the English fallback. The web source renders no
/// translatable copy (the unit label is the user's preference symbol and the number is locale-
/// formatted), so the only key is the native empty-state VoiceOver label. Keys live in the "Distance"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time; kept per-surface so
/// each parallel prompt owns its own strings.
public enum DistanceStrings {
    public static let table = "Distance"

    public static let string: DistanceResolve = { key, fallback in
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State-holder (P1/S8 layer)

/// The surface's observable view-model. Holds the current input snapshot, exposes the resolved
/// projection the view renders, adopts new props / units via `sync(_:)` (the parity of the web
/// component re-rendering with changed props or a changed `useUnits()` preference), and emits the
/// `view.opened` diagnostics event exactly once when the surface first appears. There is no async
/// source because the web source has no data dependency; the host owns the data and the active units.
@MainActor
@Observable
public final class DistanceModel {
    public private(set) var resolved: DistanceResolved

    public var phase: DistanceResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private var input: DistanceInput
    @ObservationIgnored private let telemetry: any DistanceTelemetry
    @ObservationIgnored private let strings: DistanceResolve
    @ObservationIgnored private var didEmitOpen = false

    public init(
        input: DistanceInput,
        telemetry: any DistanceTelemetry = OSLogDistanceTelemetry(),
        strings: @escaping DistanceResolve = DistanceStrings.string
    ) {
        self.input = input
        self.telemetry = telemetry
        self.strings = strings
        resolved = DistanceProjection.resolve(input, strings: strings)
    }

    /// Records the surface open exactly once. Idempotent across re-appears; the surface always
    /// presents content, so the first appearance is the open moment.
    public func start() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: DistanceMeta.surfaceSlug)
    }

    /// Symmetry with `start()` for the view lifecycle; the surface holds no resources to release.
    public func stop() {}

    /// Adopt a new input snapshot — the parity of the web component re-rendering with changed props or
    /// a changed `useUnits()` preference. Recomputes the resolved projection; idempotent for an
    /// unchanged snapshot.
    public func sync(_ newInput: DistanceInput) {
        guard newInput != input else { return }
        input = newInput
        resolved = DistanceProjection.resolve(input, strings: strings)
    }
}
