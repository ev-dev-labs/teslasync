//
//  JsonFormatter.Model.swift
//  TeslaSync — P4 feature view · 0017 · JsonFormatter (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the JsonFormatter tool. The view binds through `JsonFormatterModel`; the tool is
//  a pure local transform, so there is no network and no `Source` — the model owns
//  the input and derives the result, mirroring the web `useMemo`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol JsonFormatterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogJsonFormatterTelemetry: JsonFormatterTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "JsonFormatter" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum JsonFormatterStrings {
    public static let table = "JsonFormatter"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - State holder (P1/S8 layer)

/// The tool's observable view-model. Owns the input and derives the
/// `JsonFormatResult` on demand (the web `useMemo`); emits the `view.opened`
/// diagnostics event once on first appearance. No networking lives here.
@MainActor
@Observable
public final class JsonFormatterModel {
    /// The raw input text (web `inputVal`).
    public var input: String

    @ObservationIgnored private let telemetry: any JsonFormatterTelemetry
    @ObservationIgnored private var started = false

    public init(
        input: String = "",
        telemetry: any JsonFormatterTelemetry = OSLogJsonFormatterTelemetry()
    ) {
        self.input = input
        self.telemetry = telemetry
    }

    /// The derived transform result. Recomputed from `input` on every access;
    /// `@Observable` tracks the reads so SwiftUI re-renders on change.
    public var result: JsonFormatResult {
        JsonPrettyPrinter.format(input)
    }

    /// The combined VoiceOver summary for the current result.
    public var accessibilitySummary: String {
        JsonFormatterAccessibility.summary(result: result, localize: JsonFormatterStrings.string)
    }

    /// The localized, engine-style parse message for an invalid result (web `e.message`).
    public func message(for error: JsonSyntaxError) -> String {
        error.message(localize: JsonFormatterStrings.string)
    }

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: JsonFormatterSurface.slug)
    }
}
