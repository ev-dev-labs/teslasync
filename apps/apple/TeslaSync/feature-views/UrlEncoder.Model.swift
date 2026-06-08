//
//  UrlEncoder.Model.swift
//  TeslaSync — P4 feature view · 0023 · UrlEncoder (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + i18n facade
//  (P1/S10). The view binds through `UrlEncoderModel`; the surface performs no I/O
//  (the web source has no data hooks beyond `useTranslation` — it is a pure
//  client-side transform), so the model owns the input/mode and derives the output.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))`, which is
/// consent-gated and redacted there.
public protocol UrlEncoderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogUrlEncoderTelemetry: UrlEncoderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State holder (P1/S8 seam)

/// The tool's observable view-model. Owns the `mode` + `input` (the web `useState`
/// pair) and derives `result` the way the web `useMemo` does, so the view holds no
/// transform logic. Exposes a `start()` that emits the `view.opened` diagnostics
/// event exactly once.
@MainActor
@Observable
public final class UrlEncoderModel {
    /// The active transform direction (web `mode`).
    public var mode: UrlEncoderMode

    /// The raw text being transformed (web `inputVal`).
    public var input: String

    /// The projected output, recomputed from `input` + `mode` (web `output` memo).
    public var result: UrlEncoderResult {
        UrlEncoderCodec.transform(input, mode: mode)
    }

    @ObservationIgnored private let telemetry: any UrlEncoderTelemetry
    @ObservationIgnored private var started = false

    public init(
        mode: UrlEncoderMode = .encode,
        input: String = "",
        telemetry: any UrlEncoderTelemetry = OSLogUrlEncoderTelemetry()
    ) {
        self.mode = mode
        self.input = input
        self.telemetry = telemetry
    }

    /// The example shown in the empty input (the web textarea prompt, per mode).
    /// Kept as a verbatim literal — the web does not localize it.
    public var exampleInput: String {
        switch mode {
        case .encode: "hello world&foo=bar"
        case .decode: "hello%20world%26foo%3Dbar"
        }
    }

    /// Emits the `view.opened` diagnostics event (P1/S11). Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: UrlEncoderView.surfaceSlug)
    }

    /// Switches the transform direction (web `setMode`).
    public func select(_ mode: UrlEncoderMode) {
        self.mode = mode
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "UrlEncoder" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The keys that
/// come straight from the web source are its bare `t()` arguments (`Url Encoder`,
/// `Url Encoder Desc`, `Encode`, `Decode`, `Input Label`, `Output Label`,
/// `Invalid Input`); the rest back native-only chrome (empty state, accessibility).
public enum UrlEncoderStrings {
    public static let table = "UrlEncoder"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
