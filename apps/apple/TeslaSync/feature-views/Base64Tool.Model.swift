//
//  Base64Tool.Model.swift
//  TeslaSync — P4 feature view · 0011 · Base64Tool (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the Base64 tool. The view binds through `Base64ToolModel`; the tool is a pure
//  local transform, so there is no network and no `Source` — the model owns the
//  input + mode and derives the result, mirroring the web `useMemo`.
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
public protocol Base64ToolTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogBase64ToolTelemetry: Base64ToolTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "Base64Tool" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum Base64Strings {
    public static let table = "Base64Tool"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - State holder (P1/S8 layer)

/// The tool's observable view-model. Owns the input + mode and derives the
/// `Base64Result` on demand (the web `useMemo`); emits the `view.opened`
/// diagnostics event once on first appearance. No networking lives here.
@MainActor
@Observable
public final class Base64ToolModel {
    /// The current transform direction (web `mode`).
    public var mode: Base64Mode

    /// The raw input text (web `inputVal`).
    public var input: String

    @ObservationIgnored private let telemetry: any Base64ToolTelemetry
    @ObservationIgnored private var started = false

    public init(
        mode: Base64Mode = .encode,
        input: String = "",
        telemetry: any Base64ToolTelemetry = OSLogBase64ToolTelemetry()
    ) {
        self.mode = mode
        self.input = input
        self.telemetry = telemetry
    }

    /// The derived transform result. Recomputed from `input` + `mode` on every
    /// access; `@Observable` tracks the reads so SwiftUI re-renders on change.
    public var result: Base64Result {
        Base64Codec.transform(input, mode: mode)
    }

    /// The example input for the current mode (web input hint).
    public var example: String {
        mode.example
    }

    /// The combined VoiceOver summary for the current result.
    public var accessibilitySummary: String {
        Base64Accessibility.summary(mode: mode, result: result, localize: Base64Strings.string)
    }

    /// Emits the `view.opened` diagnostics event exactly once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Base64Surface.slug)
    }

    /// Switches the transform direction (web `setMode`).
    public func select(_ mode: Base64Mode) {
        self.mode = mode
    }
}
