//
//  VehiclePaintPicker.Model.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The P1/S10 i18n facade, the P1/S11 telemetry seam, and the P1/S8 observable state-holder for the paint
//  picker. The web `<VehiclePaintPicker>` is a thin presentational control: it reads `useVehiclePaint`
//  and routes taps straight through `setPaint` / `reset`; this model is the native peer. It mirrors the
//  resolved selection as observed state (so the SwiftUI body re-renders when it changes), derives the
//  pure ``VehiclePaintPickerProjection`` via ``VehiclePaintPickerProjector``, writes every mutation
//  through the store seam (web `setPaint` / `reset`), and emits `view.opened` exactly once. No
//  networking, no view code.
//

import Foundation
import Observation
import OSLog

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the views hold no hardcoded
/// literals. Keys live in the "VehiclePaintPicker" table — the exact set the web source resolves
/// (`paint.pickerLabel`, `paint.label`, `paint.detected`, `paint.reset`) plus the localized paint names
/// and the native a11y additions — folded into the app `Localizable.xcstrings` catalog at integration
/// time.
public enum VehiclePaintPickerStrings {
    public static let table = "VehiclePaintPicker"

    /// The facade resolver passed into the pure projector — a `@Sendable (key, fallback) -> String`.
    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// The radiogroup label (web `t('paint.pickerLabel', 'Vehicle paint color')`).
    public static var pickerLabel: String {
        string("paint.pickerLabel", "Vehicle paint color")
    }

    /// The section caption (web `t('paint.label', 'Paint')`).
    public static var sectionLabel: String {
        string("paint.label", "Paint")
    }

    /// The Auto-detected tooltip / hint word (web `t('paint.detected', 'Auto-detected')`).
    public static var detected: String {
        string("paint.detected", "Auto-detected")
    }

    /// The Reset affordance copy (web `t('paint.reset', 'Reset to auto-detected')`).
    public static var reset: String {
        string("paint.reset", "Reset to auto-detected")
    }

    /// VoiceOver value spoken for the active swatch (native a11y addition; web uses the visual ring).
    public static var selectedValue: String {
        string("paint.a11y.selected", "Selected")
    }

    /// VoiceOver hint on a swatch (native a11y addition).
    public static var swatchHint: String {
        string("paint.a11y.swatchHint", "Selects the paint color")
    }

    /// Title of the empty leaf for a degenerate catalog with no palettes (native "never a blank box").
    public static var emptyTitle: String {
        string("paint.empty", "No paint options available")
    }

    /// Supporting line of the empty leaf.
    public static var emptyMessage: String {
        string("paint.emptyMessage", "Paint colors appear here once configured.")
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event. The default logs via `os.Logger`; production injects
/// an adapter forwarding to the consent-gated diagnostics sink. The slug is a static, non-identifying
/// constant.
public protocol VehiclePaintPickerTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe `view.opened` event.
public struct OSLogVehiclePaintPickerTelemetry: VehiclePaintPickerTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - VehiclePaintPickerModel (P1/S8) — selection state + derivation

/// The surface's observable state-holder. Mirrors the store's resolved selection as observed state,
/// derives the view-ready projection, and routes taps through the store seam (the verbatim ports of the
/// web `setPaint` / `reset`), emitting `view.opened` once per instance.
@MainActor
@Observable
public final class VehiclePaintPickerModel {
    /// The resolved selection snapshot (web `useVehiclePaint` read) — drives the SwiftUI re-render.
    public private(set) var state: VehiclePaintState

    public let input: VehiclePaintPickerInput

    @ObservationIgnored private let store: any VehiclePaintStore
    @ObservationIgnored private let palettes: [VehiclePaintPalette]
    @ObservationIgnored private let telemetry: any VehiclePaintPickerTelemetry
    @ObservationIgnored private let resolve: VehiclePaintResolve
    @ObservationIgnored private var didEmitOpen = false

    public init(
        store: any VehiclePaintStore,
        input: VehiclePaintPickerInput,
        palettes: [VehiclePaintPalette] = VehiclePaintCatalog.list,
        telemetry: any VehiclePaintPickerTelemetry = OSLogVehiclePaintPickerTelemetry(),
        resolve: @escaping VehiclePaintResolve = VehiclePaintPickerStrings.string
    ) {
        self.store = store
        self.input = input
        self.palettes = palettes
        self.telemetry = telemetry
        self.resolve = resolve
        state = store.state
    }

    // MARK: Derivation

    /// The resolved, view-ready picker (web render output) — a pure function of the catalog + selection.
    public var projection: VehiclePaintPickerProjection {
        VehiclePaintPickerProjector.resolve(palettes: palettes, state: state, resolve: resolve)
    }

    // MARK: Lifecycle

    /// Emits `view.opened` exactly once, the first time the surface appears (idempotent).
    public func markAppeared() {
        guard !didEmitOpen else { return }
        didEmitOpen = true
        telemetry.viewOpened(surface: VehiclePaintPickerSurface.slug)
    }

    // MARK: Actions (web `setPaint` / `reset`)

    /// Selects a paint — the web swatch `onClick`: write through the store (which normalizes a pick of
    /// the inferred colour to a clear) and re-read the resolved state.
    public func selectPaint(_ id: VehiclePaintPaletteID) {
        store.setPaint(id)
        state = store.state
    }

    /// Clears the override, reverting to the inferred colour — the web Reset `onClick` (`reset`).
    public func reset() {
        store.reset()
        state = store.state
    }
}
