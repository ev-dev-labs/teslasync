//
//  ByteSizeConverter.Model.swift
//  TeslaSync — P4 feature view · 0012 · ByteSizeConverter (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10)
//  for the ByteSizeConverter devtools surface. Vendor-agnostic and SwiftUI-free
//  so the model + adapter logic compile and run on a plain host; the SwiftUI
//  chrome lives in ByteSizeConverter.swift.
//
//  Parity target: features/admin/components/devtools/tools/ByteSizeConverter.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` diagnostics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core diagnostics sink, which is consent-gated and
/// redacted there.
public protocol ByteSizeConverterTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event (the slug is a static, non-identifying constant).
public struct OSLogByteSizeConverterTelemetry: ByteSizeConverterTelemetry {
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
public enum ByteSizeConverterSurface {
    public static let slug = "ByteSizeConverter"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "ByteSizeConverter" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time;
/// keeping them per-surface lets each parallel surface prompt own its own strings
/// without editing the shared catalog.
public enum ByteSizeConverterStrings {
    public static let table = "ByteSizeConverter"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - State holder (P1/S8)

/// The observable view-model for the tool. This surface has no remote data — it
/// is a synchronous client-side computation (web parity: the only hook is
/// `useTranslation`), so the state holder owns the value text + selected unit and
/// re-derives the `ByteSizeProjection` on every edit, exposing a render `Phase`
/// for SwiftUI to switch over. No networking lives here.
@MainActor
@Observable
public final class ByteSizeConverterModel {
    /// The mutually-exclusive render branches mirroring the web source: a
    /// parseable value shows the conversion grid (`content`); anything else hides
    /// it (`empty`).
    public enum Phase: Equatable {
        case content
        case empty
    }

    /// The raw value text bound to the input. Editing re-derives the projection,
    /// exactly like the web `useMemo([value, unit])`.
    public var value: String {
        didSet {
            guard value != oldValue else { return }
            recompute()
        }
    }

    /// The selected unit bound to the picker. Changing it re-derives the
    /// projection (and moves the highlighted cell).
    public var unit: ByteSizeUnit {
        didSet {
            guard unit != oldValue else { return }
            recompute()
        }
    }

    /// The five-unit breakdown for the current value + unit, or `nil` when the
    /// value is not a number (web `conversions === null` → grid hidden).
    public private(set) var projection: ByteSizeProjection?

    /// The render phase derived from whether the value parses.
    public var phase: Phase {
        projection == nil ? .empty : .content
    }

    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private let telemetry: any ByteSizeConverterTelemetry
    @ObservationIgnored private var started = false

    public init(
        value: String = "",
        unit: ByteSizeUnit = .bytes,
        locale: Locale = ByteSizeNumeric.defaultLocale,
        telemetry: any ByteSizeConverterTelemetry = OSLogByteSizeConverterTelemetry()
    ) {
        self.locale = locale
        self.telemetry = telemetry
        self.value = value
        self.unit = unit
        projection = ByteSizeProjector.project(value: value, unit: unit, locale: locale)
    }

    /// Emits the `view.opened` diagnostics event once. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: ByteSizeConverterSurface.slug)
    }

    /// Applies a unit selection (web `Select` onChange).
    public func select(unit newUnit: ByteSizeUnit) {
        unit = newUnit
    }

    private func recompute() {
        projection = ByteSizeProjector.project(value: value, unit: unit, locale: locale)
    }
}
