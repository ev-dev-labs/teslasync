//
//  ColorConverter.Model.swift
//  TeslaSync — P4 feature view · 0013 · ColorConverter (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10)
//  for the ColorConverter devtools surface. Vendor-agnostic and SwiftUI-free so
//  the model + adapter logic compile and run on a plain host; the SwiftUI chrome
//  lives in ColorConverter.swift.
//
//  Parity target: features/admin/components/devtools/tools/ColorConverter.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` diagnostics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core diagnostics sink, which is consent-gated and
/// redacted there.
public protocol ColorConverterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event (the slug is a static, non-identifying constant).
public struct OSLogColorConverterTelemetry: ColorConverterTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Surface identity

/// Diagnostics slug for this surface (P1/S11 `view.opened`). Kept out of the
/// SwiftUI view so the model compiles and tests without SwiftUI.
public enum ColorConverterSurface {
    public static let slug = "ColorConverter"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ColorConverter" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time;
/// keeping them per-surface lets each parallel surface prompt own its own strings
/// without editing the shared catalog.
public enum ColorConverterStrings {
    public static let table = "ColorConverter"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State holder (P1/S8)

/// The observable view-model for the tool. This surface has no remote data — it
/// is a synchronous client-side computation (web parity: the only hook is
/// `useTranslation`), so the state holder owns the hex text and re-derives the
/// `ColorConverterProjection` on every edit, exposing a render `Phase` for
/// SwiftUI to switch over. No networking lives here.
@MainActor
@Observable
public final class ColorConverterModel {
    /// The mutually-exclusive render branches mirroring the web source: a
    /// parseable six-digit hex shows the result cards (`content`); anything else
    /// hides them (`empty`, the web `parsed === null`).
    public enum Phase: Equatable {
        case content
        case empty
    }

    /// The raw hex text bound to the input. Editing re-derives the projection,
    /// exactly like the web `useMemo([hex])`.
    public var hex: String {
        didSet {
            guard hex != oldValue else { return }
            recompute()
        }
    }

    /// The decoded projection for the current hex, or `nil` when the hex is not a
    /// six-digit value (web `parsed === null` → result grid hidden).
    public private(set) var projection: ColorConverterProjection?

    /// The render phase derived from whether the hex parses.
    public var phase: Phase {
        projection == nil ? .empty : .content
    }

    @ObservationIgnored private let telemetry: any ColorConverterTelemetry
    @ObservationIgnored private var started = false

    public init(
        hex: String = "#3b82f6",
        telemetry: any ColorConverterTelemetry = OSLogColorConverterTelemetry()
    ) {
        self.telemetry = telemetry
        self.hex = hex
        projection = ColorConverterProjector.project(hex: hex)
    }

    /// Emits the `view.opened` diagnostics event once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ColorConverterSurface.slug)
    }

    private func recompute() {
        projection = ColorConverterProjector.project(hex: hex)
    }
}
