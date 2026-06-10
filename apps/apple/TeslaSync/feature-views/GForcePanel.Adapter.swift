//
//  GForcePanel.Adapter.swift
//  TeslaSync — P4 feature view · 0169 · GForcePanel (Apple)
//
//  The testable projection core: a cached `GForceSnapshotInput` + `GForceUnitPrefs` → the three
//  view-ready stat tiles (Lateral / Longitudinal / Combined magnitude), reproducing the web source's
//  numeric pipeline VERBATIM so the native surface shows the exact same values as
//  features/driving/components/driving-dynamics/GForcePanel.tsx.
//
//  Deliberately free of SwiftUI (Foundation only) so the formatting + projection + accessibility
//  compile and run on a plain host and are pinned by unit tests; the SwiftUI chrome layers on top in
//  GForcePanel.Views.swift.
//

import Foundation

// MARK: - Number formatting (ported from web lib/numberFormat.ts `fmtNumber`)

/// Locale-aware decimal formatting that mirrors the web `fmtNumber`
/// (`safeNumber(v).toLocaleString(locale, { min/maxFractionDigits })`), rounding half away from zero
/// to match `Intl.NumberFormat`'s default `halfExpand`.
public enum GForceFormat {
    /// The fixed fraction-digit count the web source pins for every g value (`fmtNumber(value, 2)`).
    public static let decimals = 2

    /// `safeNumber` from numberFormat.ts: non-finite inputs collapse to 0.
    public static func safeNumber(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }

    /// `fmtNumber(v, decimals, locale)` — fixed fraction digits, grouped, half-away-from-zero.
    public static func number(
        _ value: Double,
        decimals: Int = GForceFormat.decimals,
        localeIdentifier: String = "en_US"
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = max(0, decimals)
        formatter.maximumFractionDigits = max(0, decimals)
        formatter.roundingMode = .halfUp
        let safe = safeNumber(value)
        return formatter.string(from: NSNumber(value: safe)) ?? String(format: "%.\(max(0, decimals))f", safe)
    }
}

// MARK: - Projected stat tile (web `StatCard`)

/// One projected stat tile: a localized label (the web `StatCard label`), the formatted reading or
/// the web `'—'` sentinel when the reading is absent, and the always-present `g` unit suffix (the
/// web literal `unit="g"`). Mirrors one web `<StatCard icon label value unit="g">`.
public struct GForceStatTile: Identifiable, Equatable, Sendable {
    /// The fixed `g` unit suffix the web renders on every tile (`unit="g"`).
    public static let unit = "g"
    /// The web `'—'` sentinel rendered as the value when a reading is absent.
    public static let emptyValue = "—"

    public let id: String
    public let labelKey: String
    public let labelFallback: String
    public let value: String
    public let hasReading: Bool

    public init(
        id: String,
        labelKey: String,
        labelFallback: String,
        value: String,
        hasReading: Bool
    ) {
        self.id = id
        self.labelKey = labelKey
        self.labelFallback = labelFallback
        self.value = value
        self.hasReading = hasReading
    }

    /// The always-visible unit suffix — the web literal `unit="g"`.
    public var unit: String {
        Self.unit
    }

    /// The resolved (localized) tile label (web `StatCard label`, e.g. "Lateral" / "Combined").
    public var label: String {
        GForcePanelStrings.string(labelKey, labelFallback)
    }

    /// The reading spoken for VoiceOver: the value with its unit when present (e.g. "0.32 g"),
    /// otherwise the localized "no reading" phrase rather than the visual `'—'` sentinel.
    public var spokenValue: String {
        hasReading
            ? "\(value) \(unit)"
            : GForcePanelStrings.string("dynamics.gForce.noReading", "No reading")
    }
}

// MARK: - Projection

/// The fully-projected surface content: the three stat tiles in the web render order — Lateral,
/// Longitudinal, Combined.
public struct GForceProjection: Equatable, Sendable {
    public let tiles: [GForceStatTile]

    public init(tiles: [GForceStatTile]) {
        self.tiles = tiles
    }
}

/// Pure projector: `GForceSnapshotInput` + `GForceUnitPrefs` → `GForceProjection`. Every value is
/// computed with the exact same arithmetic + formatting as the web component so the web and native
/// surfaces show identical numbers side by side.
public enum GForceProjector {
    /// Projects a live snapshot into the three stat tiles (web render order — Lateral, Longitudinal,
    /// Combined). The combined tile is the magnitude `sqrt(lateral² + longitudinal²)` and is only a
    /// reading when BOTH axes are present (web `lateral != null && longitudinal != null`).
    public static func project(reading: GForceSnapshotInput, units: GForceUnitPrefs) -> GForceProjection {
        let lateral = reading.lateralAcceleration
        let longitudinal = reading.longitudinalAcceleration

        let magnitude: Double? = (lateral != nil && longitudinal != nil)
            ? (lateral! * lateral! + longitudinal! * longitudinal!).squareRoot()
            : nil

        let tiles = [
            tile(id: "lateral", labelKey: "dynamics.lateral", labelFallback: "Lateral", reading: lateral, units: units),
            tile(
                id: "longitudinal",
                labelKey: "dynamics.longitudinal",
                labelFallback: "Longitudinal",
                reading: longitudinal,
                units: units
            ),
            tile(
                id: "combined",
                labelKey: "dynamics.combined",
                labelFallback: "Combined",
                reading: magnitude,
                units: units
            )
        ]
        return GForceProjection(tiles: tiles)
    }

    /// Builds one tile the way the web `StatCard` renders for a g reading: the value is
    /// `reading != null ? fmtNumber(reading, 2) : '—'`, the unit is always `'g'`, and `hasReading`
    /// reproduces the web `reading != null` guard that the VoiceOver summary keys off.
    private static func tile(
        id: String,
        labelKey: String,
        labelFallback: String,
        reading: Double?,
        units: GForceUnitPrefs
    ) -> GForceStatTile {
        let hasReading = reading != nil
        let value = hasReading
            ? GForceFormat.number(reading ?? 0, localeIdentifier: units.localeIdentifier)
            : GForceStatTile.emptyValue
        return GForceStatTile(
            id: id,
            labelKey: labelKey,
            labelFallback: labelFallback,
            value: value,
            hasReading: hasReading
        )
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver summary spoken for the g-force stat row. Pure + public so the a11y label
/// content can be unit-tested without rendering the view.
public enum GForceAccessibility {
    /// One spoken phrase per tile, e.g. "Lateral 0.32 g. Longitudinal -0.15 g. Combined 0.35 g".
    public static func summary(for projection: GForceProjection) -> String {
        projection.tiles
            .map { "\($0.label) \($0.spokenValue)" }
            .joined(separator: ". ")
    }
}
